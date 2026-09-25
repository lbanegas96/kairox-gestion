// supabase/functions/arca-corregir-nc-historica/index.ts
//
// RETIRADA (auditoria 24/09/2026, hallazgo SEG-2).
//
// Era una herramienta de UN SOLO USO (21/08) para corregir 4 notas de credito historicas ante ARCA.
// Ya cumplio su funcion, y quedo desplegada sin autenticacion (verify_jwt=false), con service_role y
// acceso al certificado y la clave privada de ARCA; con AFIP_ENVIRONMENT=production habria emitido
// notas de credito reales a quien la llamara con un comprobante_id valido.
//
// Se reemplazo por este stub, que responde 410 Gone y no hace nada mas.
// PENDIENTE: borrar la funcion desde el panel de Supabase (Edge Functions -> arca-corregir-nc-historica
// -> Delete) y borrar este archivo.

Deno.serve(() =>
  new Response(
    JSON.stringify({ error: 'Funcion retirada. No hace nada.', retired: true }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  )
);
