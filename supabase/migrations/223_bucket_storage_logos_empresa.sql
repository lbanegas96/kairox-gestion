-- Mejora estructural (sesión 78, follow-up del fix de egress): mover el logo
-- de empresa de base64-en-Postgres a Supabase Storage (servido por CDN).
--
-- Crea el bucket público `logos-empresa`. Convención de path:
-- `{empresa_id}/logo.<ext>` — un logo por empresa, se pisa al re-subir.
--
-- Lectura: pública (bucket public=true), sin policy — así se sirve directo
-- por CDN sin pegarle a Postgres ni pasar por auth, que es todo el punto del
-- cambio (la Fase 4 encontró que servir el logo como base64 vía PostgREST
-- fue lo que generó 6.4GB de egress en un ciclo).
--
-- Escritura: solo el usuario autenticado de la empresa dueña del path
-- (primer segmento = empresa_id), igual patrón que el resto de las RLS de
-- tenant en este proyecto.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'logos-empresa', 'logos-empresa', true,
  5242880, -- 5MB, mismo límite que ya validaba el frontend
  ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "logos_empresa_insert_propio_tenant"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'logos-empresa'
  AND (storage.foldername(name))[1] = (public.get_my_empresa_id())::text
);

-- WITH CHECK explícito (no alcanza con USING): el frontend sube con
-- upsert=true, que Postgres ejecuta como INSERT ... ON CONFLICT DO UPDATE.
-- Para ese camino, Postgres exige que la policy de UPDATE tenga su propio
-- WITH CHECK (si no, "new row violates row-level security policy" incluso
-- cuando el USING matchea) — confirmado reproduciendo el error real contra
-- el stack local antes de aplicar a producción.
CREATE POLICY "logos_empresa_update_propio_tenant"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'logos-empresa'
  AND (storage.foldername(name))[1] = (public.get_my_empresa_id())::text
)
WITH CHECK (
  bucket_id = 'logos-empresa'
  AND (storage.foldername(name))[1] = (public.get_my_empresa_id())::text
);

CREATE POLICY "logos_empresa_delete_propio_tenant"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'logos-empresa'
  AND (storage.foldername(name))[1] = (public.get_my_empresa_id())::text
);

-- SELECT pública para TODO el bucket (no solo el propio tenant): necesaria
-- por dos motivos.
--   1. La Storage API arma sus queries de upload/upsert con `RETURNING *` —
--      Postgres exige que el rol pueda "ver" la fila resultante vía una
--      policy de SELECT para que el RETURNING no falle, incluso si el INSERT/
--      UPDATE en sí ya está permitido. Sin esto, TODA subida fallaba con
--      "new row violates row-level security policy" aunque el WITH CHECK de
--      INSERT/UPDATE matcheara perfecto — confirmado reproduciendo el error
--      real contra el stack local antes de aplicar a producción.
--   2. El bucket es público (`public=true`) — cualquiera puede leer un logo
--      vía la URL pública igual, así que no hay nada que este SELECT
--      restrinja de más.
CREATE POLICY "logos_empresa_select_publico"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'logos-empresa');
