-- mig.302 — Los buckets públicos permitían LISTAR todos los archivos de todas las empresas
--
-- Hallazgo de los advisors de Supabase (2 WARN: public_bucket_allows_listing).
--
-- SITUACIÓN: `logos-empresa` y `productos-imagenes` son buckets públicos y están
-- bien diseñados del lado de ESCRITURA — las políticas de INSERT/UPDATE/DELETE ya
-- exigen `(storage.foldername(name))[1] = get_my_empresa_id()::text`, o sea que
-- cada empresa sólo puede escribir dentro de la carpeta que lleva su propio
-- empresa_id. Eso está perfecto y no se toca.
--
-- El problema es sólo el SELECT: `logos_empresa_select_publico` y
-- `productos_imagenes_select_publico` daban SELECT al rol `public` (que incluye
-- `anon`) sobre TODO el bucket, sin ninguna restricción de carpeta.
--
-- POR QUÉ SOBRA ESA POLÍTICA: en un bucket público los objetos se sirven por
-- `/storage/v1/object/public/<bucket>/<path>` SIN consultar RLS — esa es
-- literalmente la definición de bucket público. La política de SELECT sobre
-- `storage.objects` no habilita ver las imágenes: habilita **listarlas**
-- (`supabase.storage.from(...).list()`), que es otra cosa.
--
-- QUÉ SE FILTRABA (verificado en vivo, no asumido — simulando el rol `anon`):
-- un anónimo podía listar los **15 archivos** de los dos buckets y enumerar
-- **3 empresa_id distintos**. Como las carpetas SON los empresa_id, eso es
-- enumeración de inquilinos: cuántas empresas hay, sus UUID (que son la clave de
-- tenant de todo el sistema), cuántos productos con imagen tiene cada una y los
-- nombres de archivo. Las imágenes en sí ya son públicas a propósito (se sirven
-- en el catálogo), pero el listado no hace falta para eso.
--
-- VERIFICADO ANTES DE TOCAR NADA: la app NO usa `.list()` sobre ninguno de los dos
-- buckets. Sólo usa `getPublicUrl()` (puro string del lado del cliente, ni
-- siquiera pega a la API), `upload()` (política de INSERT) y `remove()` (política
-- de DELETE) — ver `ProductoImagenes.jsx` y `ConfiguracionSection.jsx`. Los `.list(`
-- que aparecen en el grep son constructores de `queryKey` de react-query, no del
-- Storage. Las edge functions usan `service_role`, que no pasa por RLS.
--
-- FIX: en vez de borrar la política (que dejaría a un usuario sin poder listar ni
-- su propia carpeta si algún día se agrega una galería), se la reemplaza por una
-- acotada: sólo `authenticated`, y sólo su propio empresa_id — el mismo criterio
-- que ya usan INSERT/UPDATE/DELETE en estos buckets. `anon` deja de poder listar.
--
-- Las imágenes públicas siguen viéndose exactamente igual: no dependen de esto.

-- ── logos-empresa ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "logos_empresa_select_publico" ON storage.objects;

CREATE POLICY "logos_empresa_select_propio_tenant"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'logos-empresa'
    AND (storage.foldername(name))[1] = (get_my_empresa_id())::text
  );

-- ── productos-imagenes ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "productos_imagenes_select_publico" ON storage.objects;

CREATE POLICY "productos_imagenes_select_propio_tenant"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'productos-imagenes'
    AND (storage.foldername(name))[1] = (get_my_empresa_id())::text
  );
