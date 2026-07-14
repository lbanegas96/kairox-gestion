import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_API_BASE      = 'https://api.mercadopago.com';

// Mapeo MP payment_type_id → subtipo interno KAIROX
const SUBTIPO_MAP: Record<string, string> = {
  'bank_transfer':  'transferencia',   // CVU / transferencia bancaria
  'account_money':  'qr',              // QR / billetera MP
  'credit_card':    'tarjeta_credito',
  'debit_card':     'tarjeta_debito',
};

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();

    // Solo procesar eventos de tipo 'payment'
    if (body.type !== 'payment' || !body.data?.id) {
      return new Response('OK', { status: 200 });
    }

    const paymentId = String(body.data.id);

    // empresa_id viene como query param configurado en la URL del webhook de MP
    const url       = new URL(req.url);
    const empresaId = url.searchParams.get('empresa_id');
    if (!empresaId) {
      console.error('[mp-webhook] Falta empresa_id en query params');
      return new Response('Bad Request', { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Obtener integración activa de la empresa
    const { data: integracion, error: errInt } = await supabase
      .from('integraciones_bancarias')
      .select('access_token, cuenta_bancaria_id, config')
      .eq('empresa_id', empresaId)
      .eq('proveedor', 'mercadopago')
      .eq('activo', true)
      .single();

    if (errInt || !integracion?.access_token) {
      console.error('[mp-webhook] Integración MP no encontrada para empresa:', empresaId);
      return new Response('Not Found', { status: 404 });
    }

    // ── Validar firma HMAC-SHA256 (obligatoria) ──
    // Sin esto, cualquiera que conozca el empresa_id (visible en la URL del webhook) y un
    // payment_id de MP cualquiera podría forzar la inserción de un movimiento bancario falso.
    const signature     = req.headers.get('x-signature');
    const requestId     = req.headers.get('x-request-id') ?? '';
    const webhookSecret = integracion.config?.webhook_secret;
    if (!webhookSecret) {
      console.error('[mp-webhook] Integración sin webhook_secret configurado — rechazado por seguridad:', empresaId);
      return new Response('Webhook secret not configured', { status: 401 });
    }
    if (!signature) {
      console.error('[mp-webhook] Falta header x-signature:', paymentId);
      return new Response('Unauthorized', { status: 401 });
    }
    const isValid = await validarFirmaMP(signature, paymentId, webhookSecret, requestId);
    if (!isValid) {
      console.error('[mp-webhook] Firma inválida para pago:', paymentId);
      return new Response('Unauthorized', { status: 401 });
    }

    // ── Consultar detalles del pago a la API de MP ───────────────────────────
    const mpResponse = await fetch(`${MP_API_BASE}/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${integracion.access_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!mpResponse.ok) {
      console.error('[mp-webhook] Error consultando pago a MP:', mpResponse.status);
      return new Response('Error', { status: 500 });
    }

    const pago = await mpResponse.json();

    // Solo registrar pagos efectivamente aprobados
    if (pago.status !== 'approved') {
      console.log('[mp-webhook] Pago ignorado — estado:', pago.status, '— id:', paymentId);
      return new Response('OK', { status: 200 });
    }

    // ── Determinar dirección real del dinero ─────────────────────────────────
    // collector_id = quién RECIBE el pago. Si coincide con la cuenta conectada,
    // es un ingreso; si la cuenta conectada es la que paga (payer.id), es un egreso
    // (ej. "Enviar dinero" desde la propia billetera MP, operation_type=money_transfer).
    const mpUserId = integracion.config?.mp_user_id;
    let tipoMovimiento = 'ingreso';
    if (mpUserId != null) {
      tipoMovimiento = String(pago.collector_id) === String(mpUserId) ? 'ingreso' : 'egreso';
    } else {
      console.warn('[mp-webhook] Integración sin mp_user_id guardado — asumiendo ingreso. Re-verificar el Access Token en Configuración para habilitar detección de egresos.');
    }

    // ── Deduplicación: MP puede reenviar el mismo evento más de una vez ──────
    const descripcionPrefix = `MP #${paymentId}`;
    const { data: existente } = await supabase
      .from('movimientos_bancarios')
      .select('id')
      .eq('empresa_id', empresaId)
      .like('descripcion', `${descripcionPrefix}%`)
      .maybeSingle();

    if (existente) {
      console.log('[mp-webhook] Duplicado ignorado — pago ya registrado:', paymentId);
      return new Response(
        JSON.stringify({ ok: true, duplicate: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Mapear tipo de cobro ─────────────────────────────────────────────────
    const subtipo = SUBTIPO_MAP[pago.payment_type_id] ?? null;

    // ── Insertar en KAIROX via RPC ───────────────────────────────────────────
    const descripcion = [
      `MP #${paymentId}`,
      pago.payment_method_id,
      pago.payer?.email ?? pago.payer?.identification?.number ?? 'Pagador desconocido',
    ].filter(Boolean).join(' — ');

    const { data: resultado, error: errRPC } = await supabase.rpc(
      'insertar_movimiento_bancario_externo',
      {
        p_empresa_id:         empresaId,
        p_cuenta_bancaria_id: integracion.cuenta_bancaria_id,
        p_fecha:              pago.date_approved ?? pago.date_created,
        p_descripcion:        descripcion,
        p_monto:              pago.transaction_amount,
        p_tipo:               tipoMovimiento,
        p_origen:             'mercadopago',
        p_subtipo:            subtipo,
      }
    );

    if (errRPC) {
      console.error('[mp-webhook] Error en RPC insertar_movimiento_bancario_externo:', errRPC);
      return new Response('Error', { status: 500 });
    }

    // Actualizar timestamp de último sync (ignorar si la columna no existe)
    const { error: syncError } = await supabase
      .from('integraciones_bancarias')
      .update({ ultimo_sync: new Date().toISOString() })
      .eq('empresa_id', empresaId)
      .eq('proveedor', 'mercadopago');
    if (syncError) {
      console.warn('[mp-webhook] No se pudo actualizar ultimo_sync:', syncError.message);
    }

    console.log('[mp-webhook] ✓ Pago registrado:', paymentId, '— tipo:', tipoMovimiento, '— subtipo:', subtipo, '— movimiento id:', resultado?.id);
    return new Response(
      JSON.stringify({ ok: true, id: resultado?.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[mp-webhook] Error inesperado:', err);
    return new Response('Error', { status: 500 });
  }
});

/**
 * Valida la firma HMAC-SHA256 que MP envía en el header x-signature.
 * Formato: ts=TIMESTAMP,v1=HASH
 * Mensaje firmado: id:{paymentId};request-id:;ts:{ts};
 */
async function validarFirmaMP(
  signatureHeader: string,
  paymentId: string,
  secret: string,
  requestId = '',
): Promise<boolean> {
  try {
    const parts = signatureHeader.split(',');
    const ts = parts.find(p => p.startsWith('ts='))?.split('=')[1];
    const v1 = parts.find(p => p.startsWith('v1='))?.split('=')[1];
    if (!ts || !v1) return false;

    const message = `id:${paymentId};request-id:${requestId};ts:${ts};`;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    const hash = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return hash === v1;
  } catch {
    return false;
  }
}
