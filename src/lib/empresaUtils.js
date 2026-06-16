import { supabase } from '@/lib/customSupabaseClient';

export async function getEmpresaParaPDF(empresaId) {
  const [{ data: logoRow }, { data: empresa }] = await Promise.all([
    supabase
      .from('configuracion')
      .select('valor')
      .eq('empresa_id', empresaId)
      .eq('clave', 'logo_base64')
      .maybeSingle(),
    supabase
      .from('empresas')
      .select('nombre, afip_cuit, cuit, direccion, condicion_iva, telefono, usa_factura_electronica, rubro')
      .eq('id', empresaId)
      .single(),
  ]);

  const logoRaw = logoRow?.valor ?? null;
  let logo = logoRaw
    ? (logoRaw.startsWith('data:') ? logoRaw : `data:image/png;base64,${logoRaw}`)
    : null;

  // @react-pdf/renderer se cuelga con imágenes >500KB en base64. Skip si es demasiado grande.
  if (logo && logo.length > 500_000) {
    console.warn(`[getEmpresaParaPDF] Logo omitido por tamaño (${Math.round(logo.length / 1024)}KB). Re-subí un logo más chico desde Configuración.`);
    logo = null;
  }

  return {
    logo,
    nombre: empresa?.nombre ?? 'Mi Empresa',
    cuit: empresa?.afip_cuit ?? empresa?.cuit ?? null,
    afip_cuit: empresa?.afip_cuit ?? empresa?.cuit ?? null,
    direccion: empresa?.direccion ?? null,
    condicion_iva: empresa?.condicion_iva ?? null,
    telefono: empresa?.telefono ?? null,
    usa_factura_electronica: empresa?.usa_factura_electronica ?? false,
    rubro: empresa?.rubro ?? null,
  };
}
