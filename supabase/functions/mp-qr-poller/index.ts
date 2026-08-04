/**
 * mp-qr-poller — confirma los cobros por QR consultando la API de MercadoPago,
 * sin depender del webhook. Disparado POR EL CRON.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * `confirmar_pago_qr` (la que marca la venta como pagada, genera el asiento y
 * dispara AFIP) sólo la llamaba `mp-webhook`. Y el webhook viene **rechazando
 * las notificaciones reales de MP con 401 (firma HMAC inválida)** desde antes
 * del 2026-08-01: se verificó que el algoritmo del código es exactamente el que
 * documenta MP, así que el problema es el `webhook_secret` guardado, que hay que
 * rotar desde el panel de MP (cuenta de Luciano — pendiente al 2026-08-04).
 *
 * Con el webhook caído, una venta por QR real se queda en `pendiente` para
 * siempre aunque el cliente haya pagado. Este worker cierra ese circuito
 * preguntándole a MP directamente, que es el mismo patrón que `mp-sync-worker`
 * ya usa con éxito para los movimientos bancarios.
 *
 * NO reemplaza al webhook ni lo vuelve innecesario: cuando el secreto se
 * arregle, ambos caminos van a convivir. Es seguro que compitan porque
 * `confirmar_pago_qr` lockea con `FOR UPDATE` y es **idempotente** (si el estado
 * ya no es `pendiente` devuelve `ya_procesado` sin tocar nada). Tener las dos
 * vías es además lo correcto de por sí: los webhooks se pierden.
 *
 * Alcance: todas las empresas con integración MP activa que tengan QRs
 * `pendiente` sin expirar. Al final corre `expirar_qrs_vencidos()`, que devuelve
 * el stock de los QRs que el cliente abandonó (crear_venta_pendiente_qr descuenta
 * stock al generar el QR — sin este barrido, cada abandono lo dejaría descontado
 * para siempre).
 *
 * Auth: service_role. Desplegar con `verify_jwt=false`, mismo criterio que
 * `arca-worker` y `mp-sync-worker`. No devuelve datos de ningún tenant.
 * Sin CORS a propósito: no se invoca desde el browser.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MP_API_BASE = 'https://api.mercadopago.com';

const adminClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

interface QrPendiente {
  id: string;
  empresa_id: string;
  external_reference: string;
  comprobante_id: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });

  try {
    // 1. QRs pendientes que todavía no vencieron. Los vencidos NO se consultan:
    //    de esos se ocupa expirar_qrs_vencidos() más abajo.
    const { data: pendientes, error: errQr } = await adminClient
      .from('qr_pagos_mp')
      .select('id, empresa_id, external_reference, comprobante_id')
      .eq('estado', 'pendiente')
      .gt('expiracion', new Date().toISOString());

    if (errQr) {
      console.error('[mp-qr-poller] Error leyendo qr_pagos_mp:', errQr.message);
      return new Response(JSON.stringify({ error: errQr.message }), { status: 500 });
    }

    let confirmados = 0;
    let consultados = 0;

    if (pendientes?.length) {
      // Agrupar por empresa: el Access Token es por empresa, y así se lee de
      // Vault una sola vez aunque haya varios QRs abiertos del mismo mostrador.
      const porEmpresa = new Map<string, QrPendiente[]>();
      for (const qr of pendientes as QrPendiente[]) {
        const lista = porEmpresa.get(qr.empresa_id) ?? [];
        lista.push(qr);
        porEmpresa.set(qr.empresa_id, lista);
      }

      for (const [empresaId, qrs] of porEmpresa) {
        const { data: accessToken, error: vaultErr } = await adminClient.rpc('vault_secret_read', {
          p_name: `mp_access_token_${empresaId}`,
        });
        if (vaultErr || !accessToken) {
          console.error('[mp-qr-poller] Sin Access Token en Vault para empresa:', empresaId);
          continue;
        }

        for (const qr of qrs) {
          consultados++;
          try {
            // Buscar el pago por external_reference — es el mismo identificador
            // que se le mandó a MP al crear la orden QR (mp-qr-crear).
            const res = await fetch(
              `${MP_API_BASE}/v1/payments/search?external_reference=${encodeURIComponent(qr.external_reference)}`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            if (!res.ok) {
              console.error('[mp-qr-poller] MP respondió', res.status, 'para', qr.external_reference);
              continue;
            }

            const body = await res.json();
            const aprobado = (body.results ?? []).find(
              (p: { status?: string }) => p.status === 'approved',
            );
            if (!aprobado) continue; // todavía no pagó — se reintenta en la próxima corrida

            // confirmar_pago_qr es idempotente y lockea: si el webhook llegó a
            // procesarlo en el ínterin, devuelve ya_procesado sin duplicar nada.
            const { data: confirmRes, error: confirmErr } = await adminClient.rpc('confirmar_pago_qr', {
              p_empresa_id: empresaId,
              p_external_reference: qr.external_reference,
              p_payment_id: String(aprobado.id),
            });
            if (confirmErr) {
              console.error('[mp-qr-poller] Error confirmar_pago_qr:', qr.external_reference, confirmErr.message);
              continue;
            }
            if (!confirmRes?.ya_procesado) {
              confirmados++;
              console.log('[mp-qr-poller] ✓ Pago confirmado por polling:', qr.external_reference, '— payment', aprobado.id);
            }
          } catch (e) {
            console.error('[mp-qr-poller] Error consultando', qr.external_reference, (e as Error).message);
          }
        }
      }
    }

    // 2. Devolver el stock de los QRs que el cliente abandonó. Corre siempre,
    //    aunque no haya habido pendientes vigentes que consultar.
    const { data: expRes, error: expErr } = await adminClient.rpc('expirar_qrs_vencidos');
    if (expErr) {
      console.error('[mp-qr-poller] Error expirar_qrs_vencidos:', expErr.message);
    }

    const expirados = expRes?.expirados ?? 0;
    if (confirmados || expirados) {
      console.log(`[mp-qr-poller] Completado. Consultados: ${consultados}, confirmados: ${confirmados}, expirados: ${expirados}`);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        consultados,
        confirmados,
        expirados,
        unidades_devueltas: expRes?.unidades_devueltas ?? 0,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    console.error('[mp-qr-poller]', (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
