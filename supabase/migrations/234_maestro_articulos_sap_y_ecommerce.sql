-- migration 234 — enriquecer el maestro de artículos al estilo SAP B1 + base
-- para publicar a ecommerce (Tiendanube). Pedido por Luciano (2026-07-22 noche):
-- fuente de verdad = KAIROX, unidireccional KAIROX → canal externo.
--
-- FASE 1a del build "Publicar catálogo KAIROX → Tiendanube"
-- (diseño: docs/DISENO_publicar_catalogo_tiendanube.md).
--
-- ── Flags tipo de artículo (SAP B1 OITM) ────────────────────────────────────
-- SAP Business One modela en el maestro de artículos (OITM) tres flags Y/N
-- independientes que definen en qué procesos participa un artículo:
--   InvntItem  → Artículo de Inventario  (mueve stock)
--   SellItem   → Artículo de Ventas      (aparece en documentos de venta)
--   PrchseItem → Artículo de Compras     (aparece en documentos de compra)
-- KAIROX los replica. Se agrega además `es_servicio` (un servicio nunca es
-- inventariable: mano de obra, flete, honorarios — no tiene stock).
--
-- Defaults elegidos para NO romper nada existente: todos los productos actuales
-- son inventariables + de venta + de compra (que es como se comportan hoy).

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS es_inventariable   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS es_articulo_venta  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS es_articulo_compra boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS es_servicio        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS publicar_ecommerce boolean NOT NULL DEFAULT false;

-- Un servicio no puede ser inventariable (no tiene stock físico). El resto de
-- las combinaciones son válidas (ej. un artículo solo de compra e inventario
-- que no se vende como tal: insumo interno).
ALTER TABLE public.productos
  DROP CONSTRAINT IF EXISTS chk_servicio_no_inventariable;
ALTER TABLE public.productos
  ADD CONSTRAINT chk_servicio_no_inventariable
  CHECK (NOT (es_servicio AND es_inventariable));

COMMENT ON COLUMN public.productos.es_inventariable   IS 'SAP OITM.InvntItem — mueve stock. Un servicio nunca es inventariable.';
COMMENT ON COLUMN public.productos.es_articulo_venta  IS 'SAP OITM.SellItem — participa en documentos de venta.';
COMMENT ON COLUMN public.productos.es_articulo_compra IS 'SAP OITM.PrchseItem — participa en documentos de compra.';
COMMENT ON COLUMN public.productos.es_servicio        IS 'Artículo de servicio (mano de obra, flete, honorarios). Implica no inventariable.';
COMMENT ON COLUMN public.productos.publicar_ecommerce IS 'Si true, el producto se expone/publica a canales de ecommerce conectados (Tiendanube).';

-- ── Imágenes de producto ────────────────────────────────────────────────────
-- Una tabla dedicada (no una columna) porque un producto puede tener varias
-- imágenes ordenadas, y Tiendanube soporta múltiples imágenes por producto.
-- Los archivos viven en Storage (bucket público servido por CDN), la tabla solo
-- guarda la URL + orden — mismo criterio que el logo de empresa (mig.223): NO
-- guardar binarios/base64 en Postgres (la Fase 4 de egress mostró que servir
-- imágenes desde Postgres revienta el egress).
CREATE TABLE IF NOT EXISTS public.producto_imagenes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id  uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  url          text NOT NULL,
  orden        integer NOT NULL DEFAULT 0,
  es_principal boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_producto_imagenes_producto
  ON public.producto_imagenes (producto_id);

-- Una sola imagen principal por producto (índice único parcial).
CREATE UNIQUE INDEX IF NOT EXISTS uq_producto_imagen_principal
  ON public.producto_imagenes (producto_id)
  WHERE es_principal;

ALTER TABLE public.producto_imagenes ENABLE ROW LEVEL SECURITY;

-- RLS: espeja exactamente el patrón de `productos` (SELECT abierto al tenant,
-- escritura solo con permiso de módulo 'productos').
CREATE POLICY producto_imagenes_select ON public.producto_imagenes
  FOR SELECT USING (empresa_id = get_my_empresa_id());

CREATE POLICY producto_imagenes_insert ON public.producto_imagenes
  FOR INSERT WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('productos'));

CREATE POLICY producto_imagenes_update ON public.producto_imagenes
  FOR UPDATE
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('productos'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('productos'));

CREATE POLICY producto_imagenes_delete ON public.producto_imagenes
  FOR DELETE USING (empresa_id = get_my_empresa_id() AND has_module_permission('productos'));

-- ── Bucket de storage para imágenes de producto ────────────────────────────
-- Mismo patrón que `logos-empresa` (mig.223): bucket público (servido por CDN),
-- escritura restringida al tenant dueño del path. Convención de path:
-- `{empresa_id}/{producto_id}/{uuid}.<ext>`.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'productos-imagenes', 'productos-imagenes', true,
  5242880, -- 5MB por imagen
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "productos_imagenes_insert_propio_tenant"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'productos-imagenes'
  AND (storage.foldername(name))[1] = (public.get_my_empresa_id())::text
);

CREATE POLICY "productos_imagenes_update_propio_tenant"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'productos-imagenes'
  AND (storage.foldername(name))[1] = (public.get_my_empresa_id())::text
)
WITH CHECK (
  bucket_id = 'productos-imagenes'
  AND (storage.foldername(name))[1] = (public.get_my_empresa_id())::text
);

CREATE POLICY "productos_imagenes_delete_propio_tenant"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'productos-imagenes'
  AND (storage.foldername(name))[1] = (public.get_my_empresa_id())::text
);

-- SELECT pública para todo el bucket — mismos 2 motivos que mig.223: (1) la
-- Storage API arma sus upload/upsert con RETURNING *, que exige poder "ver" la
-- fila resultante o toda subida falla; (2) el bucket es público igual.
CREATE POLICY "productos_imagenes_select_publico"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'productos-imagenes');

-- ── ROLLBACK (comentado) ────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS "productos_imagenes_select_publico"       ON storage.objects;
-- DROP POLICY IF EXISTS "productos_imagenes_delete_propio_tenant" ON storage.objects;
-- DROP POLICY IF EXISTS "productos_imagenes_update_propio_tenant" ON storage.objects;
-- DROP POLICY IF EXISTS "productos_imagenes_insert_propio_tenant" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'productos-imagenes';
-- DROP TABLE IF EXISTS public.producto_imagenes;
-- ALTER TABLE public.productos DROP CONSTRAINT IF EXISTS chk_servicio_no_inventariable;
-- ALTER TABLE public.productos
--   DROP COLUMN IF EXISTS es_inventariable, DROP COLUMN IF EXISTS es_articulo_venta,
--   DROP COLUMN IF EXISTS es_articulo_compra, DROP COLUMN IF EXISTS es_servicio,
--   DROP COLUMN IF EXISTS publicar_ecommerce;
