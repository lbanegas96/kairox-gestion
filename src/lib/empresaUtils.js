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
  // STORAGE-FIX (sesión 78): el logo ahora se guarda como URL pública de
  // Supabase Storage (migration 223), no como base64/data URI. @react-pdf/
  // renderer soporta <Image src="https://..."> directo — le pasamos la URL
  // tal cual. Se mantiene el fallback a data:/base64 crudo por si queda
  // alguna empresa vieja sin re-subir el logo todavía.
  let logo = logoRaw
    ? (logoRaw.startsWith('http') || logoRaw.startsWith('data:')
        ? logoRaw
        : `data:image/png;base64,${logoRaw}`)
    : null;

  // Solo aplica al caso legacy (data:/base64 crudo) — una URL de Storage
  // siempre es corta, nunca va a pesar 500KB como string.
  if (logo && logo.startsWith('data:') && logo.length > 500_000) {
    console.warn(`[getEmpresaParaPDF] Logo omitido por tamaño (${Math.round(logo.length / 1024)}KB). Re-subí el logo desde Configuración para migrarlo a Storage.`);
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
