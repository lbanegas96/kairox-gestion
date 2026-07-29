/**
 * Lógica de sincronización de pagos de MercadoPago → movimientos_bancarios.
 *
 * Extraída de `mp-sync/index.ts` (sesión 2026-07-29) para poder compartirla
 * entre los dos puntos de entrada, que tienen posturas de auth distintas a
 * propósito:
 *   - `mp-sync`        → usuario admin logueado, acotado a SU empresa. Es el
 *                        botón "Actualizar MP" del frontend.
 *   - `mp-sync-worker` → el cron, sin usuario. Itera TODAS las integraciones
 *                        activas con service_role.
 *
 * La consulta a `integraciones_bancarias` queda DELIBERADAMENTE en cada
 * caller, no acá: es justamente el punto donde se decide el alcance (una
 * empresa vs. todas), y esconderlo en un helper compartido haría fácil
 * perder el filtro por `empresa_id` sin darse cuenta — que es exactamente el
 * agujero que cerró el commit `7bccea5`. Este módulo recibe las integraciones
 * ya resueltas y solo hace el trabajo.
 *
 * El comportamiento del sync es idéntico al que tenía `mp-sync` antes de la
 * extracción — no se cambió ninguna regla de negocio.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MP_API_BASE = 'https://api.mercadopago.com';

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

export interface IntegracionMP {
  empresa_id: string;
  cuenta_bancaria_id: string;
  ultimo_sync: string | null;
  // deno-lint-ignore no-explicit-any
  config: any;
}

/** Columnas que ambos callers deben pedir de `integraciones_bancarias`. */
export const MP_INTEGRACION_COLS = 'empresa_id, cuenta_bancaria_id, ultimo_sync, config';

/**
 * Sincroniza los pagos aprobados de cada integración recibida e inserta los
 * que falten en `movimientos_bancarios`. Nunca lanza: un error de una empresa
 * se loguea y se sigue con la siguiente (una integración rota no puede frenar
 * al resto, que es lo que se espera del cron).
 *
 * Devuelve la cantidad total de movimientos insertados.
 */
export async function sincronizarIntegracionesMP(
  supabase: SupabaseClient,
  integraciones: IntegracionMP[],
  logPrefix = '[mp-sync]',
): Promise<number> {
  let totalInsertados = 0;

  for (const integ of integraciones) {
    try {
      // El Access Token vive cifrado en Vault, no en la tabla — mismo mecanismo que
      // el certificado AFIP (vault_secret_read, service_role-only).
      const { data: accessToken, error: vaultErr } = await supabase.rpc('vault_secret_read', {
        p_name: `mp_access_token_${integ.empresa_id}`,
      });
      if (vaultErr || !accessToken) {
        console.error(`${logPrefix} Token no encontrado en Vault para empresa:`, integ.empresa_id);
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
        console.error(`${logPrefix} Error MP API empresa:`, integ.empresa_id, mpRes.status);
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
          console.error(`${logPrefix} Error RPC pago:`, paymentId, errRPC);
        } else {
          totalInsertados++;
          console.log(`${logPrefix} ✓ Insertado:`, paymentId, 'tipo:', tipoMovimiento, 'subtipo:', subtipo, 'empresa:', integ.empresa_id);
        }
      }

      await supabase
        .from('integraciones_bancarias')
        .update({ ultimo_sync: hasta })
        .eq('empresa_id', integ.empresa_id)
        .eq('proveedor', 'mercadopago');

    } catch (err) {
      console.error(`${logPrefix} Error empresa:`, integ.empresa_id, err);
    }
  }

  return totalInsertados;
}
