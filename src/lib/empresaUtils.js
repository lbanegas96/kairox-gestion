import { supabase } from '@/lib/customSupabaseClient';

export async function getEmpresaParaPDF(empresaId) {
  const [{ data: logoRow }, { data: empresa }, { data: configRows }] = await Promise.all([
    supabase
      .from('configuracion')
      .select('valor')
      .eq('empresa_id', empresaId)
      .eq('clave', 'logo_base64')
      .maybeSingle(),
    supabase
      .from('empresas')
      .select('nombre, afip_cuit, cuit, condicion_iva, usa_factura_electronica, numero_ingresos_brutos, fecha_inicio_actividades')
      .eq('id', empresaId)
      .single(),
    // Dirección/teléfono/rubro/email/localidad/provincia se editan en Configuración →
    // Empresa, que los guarda como filas clave/valor acá — NO en las columnas homónimas
    // de `empresas` (quedaron huérfanas de una versión anterior de la pantalla y podían
    // tener datos viejos, ej. Nalux: empresas.direccion="Córdoba" vs. la dirección real
    // "General Paz 1142" guardada en configuracion).
    supabase
      .from('configuracion')
      .select('clave, valor')
      .eq('empresa_id', empresaId)
      .in('clave', ['direccion', 'telefono', 'rubro', 'email_empresa', 'localidad', 'provincia', 'cp']),
  ]);

  const cfg = Object.fromEntries((configRows ?? []).map(r => [r.clave, r.valor]));

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

  const localidadProvincia = [cfg.localidad, cfg.provincia].filter(Boolean).join(', ');
  const direccion = [cfg.direccion || null, localidadProvincia || null].filter(Boolean).join(' — ') || null;

  return {
    logo,
    nombre: empresa?.nombre ?? 'Mi Empresa',
    cuit: empresa?.afip_cuit ?? empresa?.cuit ?? null,
    afip_cuit: empresa?.afip_cuit ?? empresa?.cuit ?? null,
    direccion,
    condicion_iva: empresa?.condicion_iva ?? null,
    telefono: cfg.telefono || null,
    email: cfg.email_empresa || null,
    usa_factura_electronica: empresa?.usa_factura_electronica ?? false,
    rubro: cfg.rubro || null,
    numero_ingresos_brutos: empresa?.numero_ingresos_brutos ?? null,
    fecha_inicio_actividades: empresa?.fecha_inicio_actividades ?? null,
  };
}
