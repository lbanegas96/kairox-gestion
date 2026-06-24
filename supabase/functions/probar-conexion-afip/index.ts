// supabase/functions/probar-conexion-afip/index.ts
// Valida que el certificado AFIP/ARCA esté cargado en el Vault y que ARCA responda.
// Llama a getLastVoucherNumber en el primer PdV activo con Factura C (tipo 11).
// Devuelve { ok: true, lastNumber, pvNumero, cuit } o { ok: false, error }.
import { buildCorsHeaders, verifyAdmin, adminClient } from '../_shared/auth.ts';
import { getLastVoucherNumber } from '../_shared/afip.ts';

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const auth = await verifyAdmin(req);
    if (!auth.ok || !auth.empresaId) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // 1. CUIT de la empresa
    const { data: empresa } = await adminClient
      .from('empresas')
      .select('afip_cuit')
      .eq('id', auth.empresaId)
      .single();
    if (!empresa?.afip_cuit) throw new Error('CUIT no configurado en la empresa.');

    // 2. Primer punto de venta activo
    const { data: pv } = await adminClient
      .from('puntos_venta')
      .select('numero')
      .eq('empresa_id', auth.empresaId)
      .eq('activo', true)
      .order('numero', { ascending: true })
      .limit(1)
      .single();
    if (!pv) throw new Error('No hay puntos de venta activos. Configurá al menos uno en la sección Facturación.');

    // 3. Cert + clave desde Vault
    const { data: certPem } = await adminClient.rpc('vault_secret_read', { p_name: `afip_cert_${auth.empresaId}` });
    const { data: keyPem }  = await adminClient.rpc('vault_secret_read', { p_name: `afip_key_${auth.empresaId}` });
    if (!certPem || !keyPem) {
      throw new Error('Certificado AFIP no configurado. Generá el CSR y subí el .crt desde el portal ARCA.');
    }

    // 4. Llamada de prueba: último número emitido para Factura C en ese PdV
    const environment = Deno.env.get('AFIP_ENVIRONMENT') === 'production' ? 'production' : 'sandbox';
    const lastNumber = await getLastVoucherNumber(
      empresa.afip_cuit,
      certPem,
      keyPem,
      environment,
      pv.numero,
      11, // Factura C — la más común
    );

    return new Response(
      JSON.stringify({ ok: true, lastNumber, pvNumero: pv.numero, cuit: empresa.afip_cuit }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
