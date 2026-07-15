// supabase/functions/probar-conexion-afip/index.ts
// Valida que el certificado AFIP/ARCA esté cargado en el Vault y que ARCA responda.
// Usa implementación manual WSAA+WSFE (sin SDK).
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
    const empresaId = auth.empresaId;

    const { data: empresa } = await adminClient
      .from('empresas')
      .select('afip_cuit')
      .eq('id', empresaId)
      .single();
    if (!empresa?.afip_cuit) throw new Error('CUIT no configurado en la empresa.');

    const { data: pv } = await adminClient
      .from('puntos_venta')
      .select('numero')
      .eq('empresa_id', empresaId)
      .eq('activo', true)
      .order('numero', { ascending: true })
      .limit(1)
      .single();
    if (!pv) throw new Error('No hay puntos de venta activos. Configurá al menos uno en la sección Facturación.');

    const { data: certPem } = await adminClient.rpc('vault_secret_read', { p_name: `afip_cert_${empresaId}` });
    const { data: keyPem }  = await adminClient.rpc('vault_secret_read', { p_name: `afip_key_${empresaId}` });
    if (!certPem || !keyPem) {
      throw new Error('Certificado AFIP no configurado. Generá el CSR y subí el .crt desde el portal ARCA.');
    }

    const environment = Deno.env.get('AFIP_ENVIRONMENT') === 'production' ? 'production' : 'sandbox';
    const lastNumber = await getLastVoucherNumber(
      adminClient,
      empresaId,
      empresa.afip_cuit,
      certPem,
      keyPem,
      environment,
      pv.numero,
      11, // Factura C — la más común
    );

    return new Response(
      JSON.stringify({ ok: true, lastNumber, pvNumero: pv.numero, cuit: empresa.afip_cuit, environment }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message ?? String(err) }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
