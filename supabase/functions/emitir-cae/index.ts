// supabase/functions/emitir-cae/index.ts
//
// ⛔ DEPRECADO (sesión 64, 2026-06-26).
//
// Emisión SÍNCRONA de CAE desde el frontend. Reemplazado por el patrón asíncrono
// (SAP async posting): la venta encola en `facturas_pendientes_arca` (trigger
// fn_queue_factura_arca) y el `arca-worker` (cron */5) es la ÚNICA fuente de verdad
// que llama a ARCA. El reintento manual va por la RPC `reencolar_caes_pendientes`
// (ver afipService.reintentarCAEsPendientes), nunca por este endpoint.
//
// Esta función además dependía del SDK @nicoo01x/arca-sdk, que NO funciona en Edge
// Runtime (resolver npm roto + TRA mal armado) — ver _shared/wsaa.ts / wsfe.ts para
// la implementación manual que sí funciona, usada por el worker.
//
// Se deja como stub 410 Gone para no romper invocaciones viejas y dejar claro el
// reemplazo. NO reactivar: la doble emisión (frontend + worker sobre la misma
// factura) fue justamente el bug que motivó migrar al patrón de cola.

Deno.serve(() =>
  new Response(
    JSON.stringify({
      error: 'Endpoint deprecado. La emisión de CAE es asíncrona vía arca-worker. ' +
        'Para reintentar usá reencolar_caes_pendientes (afipService.reintentarCAEsPendientes).',
      deprecated: true,
    }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  )
);
