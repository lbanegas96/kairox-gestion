// supabase/functions/arca-corregir-nc-historica/index.ts
//
// ⛔ RETIRADA (auditoría 24/09/2026, hallazgo SEG-2).
//
// Era una herramienta de UN SOLO USO (21/08) para corregir 4 notas de crédito históricas ante ARCA.
// Ya cumplió su función, y quedó desplegada sin autenticación (verify_jwt=false), con service_role y
// acceso al certificado y la clave privada de ARCA; con AFIP_ENVIRONMENT=production habría emitido
// notas de crédito reales a quien la llamara con un comprobante_id válido.
//
// Se reemplazó por este stub, que responde 410 Gone y no hace nada más.
// PENDIENTE: borrar la función desde el panel de Supabase (Edge Functions → arca-corregir-nc-historica
// → Delete) y borrar este archivo.

Deno.serve(() =>
  new Response(
    JSON.stringify({ error: 'Función retirada. No hace nada.', retired: true }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  )
);
