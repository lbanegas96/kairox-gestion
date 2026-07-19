// Mejora estructural (sesión 78, follow-up del fix de egress): migra el logo
// de cada empresa de base64-en-Postgres (configuracion.valor, clave
// 'logo_base64') al bucket de Storage `logos-empresa` (migration 223).
//
// Este script SOLO se corre UNA VEZ, a mano, apuntando a producción con la
// service_role key. No forma parte del código de la app — es una migración
// de datos puntual. Correrlo de nuevo es seguro (upsert): simplemente vuelve
// a subir lo mismo y no rompe nada, así que no hay problema en re-ejecutarlo
// si aparece una empresa nueva con logo viejo en base64.
//
// IMPORTANTE: nunca pegues la service_role key en el chat con Claude. Este
// script la lee de la variable de entorno SUPABASE_SERVICE_ROLE_KEY — corré
// el script vos mismo desde tu terminal, con tus propias credenciales.
//
// Uso:
//   SUPABASE_URL=https://wuznppxeonmhfcvnqfbf.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/migrar_logo_a_storage.mjs
//
// Qué hace, por cada fila configuracion.clave='logo_base64' que empiece con
// "data:" (es decir, todavía NO migrada):
//   1. Decodifica el base64 a bytes.
//   2. Sube esos bytes a logos-empresa/{empresa_id}/logo.<ext>.
//   3. Actualiza configuracion.valor con la URL pública resultante.
//   4. Borra la fila configuracion.clave='company_logo' de esa empresa si
//      quedó (duplicado viejo — ya no debería existir tras la migration 220,
//      pero por si alguna empresa la recreó desde entonces).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno. Ver comentario de uso arriba.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function dataUrlToBuffer(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const [, mime, base64] = match;
  const ext = mime.includes('png') ? 'png'
    : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg'
    : mime.includes('svg') ? 'svg'
    : mime.includes('webp') ? 'webp'
    : 'png';
  return { buffer: Buffer.from(base64, 'base64'), mime, ext };
}

async function main() {
  const { data: rows, error } = await admin
    .from('configuracion')
    .select('empresa_id, valor')
    .eq('clave', 'logo_base64');
  if (error) throw error;

  const pendientes = (rows ?? []).filter(r => r.valor?.startsWith('data:'));
  console.log(`Encontradas ${rows?.length ?? 0} filas logo_base64, ${pendientes.length} pendientes de migrar (base64 crudo).`);

  for (const row of pendientes) {
    const decoded = dataUrlToBuffer(row.valor);
    if (!decoded) {
      console.warn(`  [SKIP] empresa ${row.empresa_id}: valor no parece un data: URI válido`);
      continue;
    }
    const path = `${row.empresa_id}/logo.${decoded.ext}`;
    const { error: uploadError } = await admin.storage
      .from('logos-empresa')
      .upload(path, decoded.buffer, { upsert: true, contentType: decoded.mime, cacheControl: '3600' });
    if (uploadError) {
      console.error(`  [ERROR] empresa ${row.empresa_id}: ${uploadError.message}`);
      continue;
    }
    const { data: { publicUrl } } = admin.storage.from('logos-empresa').getPublicUrl(path);
    const urlFinal = `${publicUrl}?v=${Date.now()}`;

    const { error: updateError } = await admin
      .from('configuracion')
      .update({ valor: urlFinal })
      .eq('empresa_id', row.empresa_id)
      .eq('clave', 'logo_base64');
    if (updateError) {
      console.error(`  [ERROR] empresa ${row.empresa_id}: subido pero no se pudo actualizar la fila: ${updateError.message}`);
      continue;
    }

    const kb = Math.round(decoded.buffer.length / 1024);
    console.log(`  [OK] empresa ${row.empresa_id}: ${kb}KB → ${urlFinal}`);

    // Limpieza del duplicado viejo, si quedó.
    await admin.from('configuracion').delete().eq('empresa_id', row.empresa_id).eq('clave', 'company_logo');
  }

  console.log('Listo.');
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
