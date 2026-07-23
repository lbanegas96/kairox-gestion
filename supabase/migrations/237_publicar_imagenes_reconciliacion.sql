-- migration 237 — completar la publicación KAIROX → Tiendanube para que la
-- ACTUALIZACIÓN sea 100% (incluye imágenes). Pedido de Luciano tras probar:
-- el update solo mandaba nombre/descripción/precio y se salteaba las imágenes,
-- y cambiar SOLO una imagen no re-publicaba nada.
--
-- Dos piezas:
--   1. `external_image_id` en producto_imagenes: guarda el id que TN asigna a
--      cada imagen al subirla, para poder reconciliar (subir nuevas / borrar las
--      que se quitaron) sin re-subir todo en cada edición.
--   2. Trigger en producto_imagenes: al agregar/cambiar/borrar una imagen de un
--      producto publicable, re-encola la publicación (antes solo lo hacía el
--      trigger sobre `productos`, así que un cambio de solo-imagen no disparaba).
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_queue_publicar_imagenes ON public.producto_imagenes;
--   DROP FUNCTION IF EXISTS public.fn_queue_publicar_imagenes();
--   ALTER TABLE public.producto_imagenes DROP COLUMN IF EXISTS external_image_id;

ALTER TABLE public.producto_imagenes
  ADD COLUMN IF NOT EXISTS external_image_id text;

COMMENT ON COLUMN public.producto_imagenes.external_image_id IS
  'Id de la imagen en Tiendanube (lo asigna TN al subirla). Permite reconciliar sin re-subir todo.';

-- Trigger: re-encolar publicación cuando cambian las imágenes de un producto
-- publicable. Cubre INSERT (nueva imagen), DELETE (imagen quitada) y UPDATE de
-- campos visibles (url / principal). IGNORA el UPDATE que solo setea
-- external_image_id — ese lo escribe el propio worker al sincronizar, y
-- re-encolar por eso generaría un ciclo extra innecesario.
CREATE OR REPLACE FUNCTION public.fn_queue_publicar_imagenes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_producto_id uuid;
  v_empresa_id  uuid;
  v_publicar    boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_producto_id := OLD.producto_id;
  ELSE
    -- Update que solo tocó external_image_id (lo hace el worker) → no re-encolar.
    IF TG_OP = 'UPDATE'
       AND NEW.url          IS NOT DISTINCT FROM OLD.url
       AND NEW.es_principal IS NOT DISTINCT FROM OLD.es_principal THEN
      RETURN NEW;
    END IF;
    v_producto_id := NEW.producto_id;
  END IF;

  SELECT p.empresa_id, p.publicar_ecommerce
    INTO v_empresa_id, v_publicar
  FROM public.productos p
  WHERE p.id = v_producto_id;

  IF v_publicar IS NOT TRUE THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.integraciones_canales ic
    WHERE ic.empresa_id = v_empresa_id AND ic.canal = 'tiendanube' AND ic.activo = true
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.integraciones_producto_pendiente (empresa_id, producto_id, estado, proximo_intento)
  VALUES (v_empresa_id, v_producto_id, 'pendiente', now())
  ON CONFLICT (empresa_id, producto_id) WHERE estado NOT IN ('publicado', 'error_definitivo')
  DO NOTHING;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_queue_publicar_imagenes() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_queue_publicar_imagenes ON public.producto_imagenes;
CREATE TRIGGER trg_queue_publicar_imagenes
  AFTER INSERT OR UPDATE OR DELETE ON public.producto_imagenes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_queue_publicar_imagenes();
