import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAdmin } from '../_shared/auth.ts';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_API_BASE       = 'https://api.mercadopago.com';

// FIX-CORS-MP-SYNC — permite invocar mp-sync desde el browser (botón "Actualizar")
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUBTIPO_MAP: Record<string, string> = {
  'bank_transfer':  'transferencia',
  'account_money':  'qr',
  'credit_card':    'tarjeta_credito',
  'debit_card':     'tarjeta_debito',
};

const METHOD_LABEL: Record<string, string> = {
  'account_money': 'Billetera MercadoPago',
  'cvu':           'Transferencia CVU',
  'credit_card':   'Tarjeta de crédito',
  'debit_card':    'Tarjeta de débito',
  'visa':          'Visa',
  'master':        'Mastercard',
  'amex':          'American Express',
  'naranja':       'Naranja',
  'cabal':         'Cabal',
};

serve(async (req) => {
  // FIX-CORS-MP-SYNC — responder preflight antes de correr cualquier lógica
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Solo admin de la propia empresa puede disparar el sync — antes cualquier usuario
  // autenticado de cualquier tenant podía forzar el sync (e inserción de movimientos) de TODAS
  // las empresas, porque no había chequeo de rol ni de alcance por empresa_id.
  const auth = await verifyAdmin(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: integraciones, error: errInt } = await supabase
    .from('integraciones_bancarias')
    .select('empresa_id, cuenta_bancaria_id, ultimo_sync, config')
    .eq('proveedor', 'mercadopago')
    .eq('activo', true)
    .eq('empresa_id', auth.empresaId);

  if (errInt || !integraciones?.length) {
    console.log('[mp-sync] Sin integraciones MP activas');
    return new Response(JSON.stringify({ ok: true, synced: 0 }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, // FIX-CORS-MP-SYNC
    });
  }

  let totalInsertados = 0;

  for (const integ of integraciones) {
    try {
      // El Access Token vive cifrado en Vault, no en la tabla — mismo mecanismo que
      // el certificado AFIP (vault_secret_read, service_role-only).
      const { data: accessToken, error: vaultErr } = await supabase.rpc('vault_secret_read', {
        p_name: `mp_access_token_${integ.empresa_id}`,
      });
      if (vaultErr || !accessToken) {
        console.error('[mp-sync] Token no encontrado en Vault para empresa:', integ.empresa_id);
        continue;
      }

      // Si no hay último sync, tomar últimas 72 horas
      const desde = integ.ultimo_sync
        ? new Date(integ.ultimo_sync).toISOString()
        : new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
      const hasta = new Date().toISOString();

      const mpRes = await fetch(
        `${MP_API_BASE}/v1/payments/search?sort=date_created&criteria=asc&status=approved&begin_date=${desde}&end_date=${hasta}&limit=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!mpRes.ok) {
        console.error('[mp-sync] Error MP API empresa:', integ.empresa_id, mpRes.status);
        continue;
      }

      const { results } = await mpRes.json();
      if (!results?.length) {
        // Igual actualizamos ultimo_sync para no reescanear
        await supabase
          .from('integraciones_bancarias')
          .update({ ultimo_sync: hasta })
          .eq('empresa_id', integ.empresa_id)
          .eq('proveedor', 'mercadopago');
        continue;
      }

      const mpUserId = integ.config?.mp_user_id;

      for (const pago of results) {
        const paymentId = String(pago.id);

        // Deduplicar por descripcion
        const { data: existente } = await supabase
          .from('movimientos_bancarios')
          .select('id')
          .eq('empresa_id', integ.empresa_id)
          .like('descripcion', `MP #${paymentId}%`)
          .maybeSingle();

        if (existente) continue;

        // Dirección real del dinero: collector_id = quién recibe. Si no coincide
        // con la cuenta conectada, es un egreso (ej. "Enviar dinero" saliente).
        let tipoMovimiento = 'ingreso';
        if (mpUserId != null) {
          tipoMovimiento = String(pago.collector_id) === String(mpUserId) ? 'ingreso' : 'egreso';
        }

        const subtipo    = SUBTIPO_MAP[pago.payment_type_id] ?? null;
        const metodoLabel = METHOD_LABEL[pago.payment_method_id] ?? pago.payment_method_id;
        const descripcion = [
          `MP #${paymentId}`,
          metodoLabel,
          pago.payer?.email ?? pago.payer?.identification?.number ?? 'Pagador desconocido',
        ].filter(Boolean).join(' — ');

        const { error: errRPC } = await supabase.rpc('insertar_movimiento_bancario_externo', {
          p_empresa_id:         integ.empresa_id,
          p_cuenta_bancaria_id: integ.cuenta_bancaria_id,
          p_fecha:              pago.date_approved ?? pago.date_created,
          p_descripcion:        descripcion,
          p_monto:              pago.transaction_amount,
          p_tipo:               tipoMovimiento,
          p_origen:             'mercadopago',
          p_subtipo:            subtipo,
        });

        if (errRPC) {
          console.error('[mp-sync] Error RPC pago:', paymentId, errRPC);
        } else {
          totalInsertados++;
          console.log('[mp-sync] ✓ Insertado:', paymentId, 'tipo:', tipoMovimiento, 'subtipo:', subtipo, 'empresa:', integ.empresa_id);
        }
      }

      await supabase
        .from('integraciones_bancarias')
        .update({ ultimo_sync: hasta })
        .eq('empresa_id', integ.empresa_id)
        .eq('proveedor', 'mercadopago');

    } catch (err) {
      console.error('[mp-sync] Error empresa:', integ.empresa_id, err);
    }
  }

  console.log(`[mp-sync] Completado. Insertados: ${totalInsertados}`);
  return new Response(JSON.stringify({ ok: true, synced: totalInsertados }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, // FIX-CORS-MP-SYNC
  });
});
