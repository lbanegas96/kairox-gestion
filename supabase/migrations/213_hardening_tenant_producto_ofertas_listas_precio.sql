-- migration 213 — Hardening: validar que producto_id pertenezca al tenant en
-- ofertas y lista_precio_items
--
-- HALLAZGO (barrido de seguridad de Ofertas + Listas de precio, sesión 72): las 3 tablas del
-- módulo (ofertas, listas_precio, lista_precio_items) tienen RLS correcto (empresa_id =
-- get_my_empresa_id() en las 4 operaciones) y calcular_ofertas_carrito valida tenant. Datos
-- verificados 100% limpios: 0 filas con producto_id/lista_precio_id de otro tenant hoy.
--
-- Pero ni ofertas.producto_id ni lista_precio_items.producto_id validan que ese producto
-- pertenezca a la misma empresa del registro:
--   - lista_precio_items no tiene NINGÚN FK sobre producto_id (solo el FK a listas_precio).
--   - ofertas.producto_id sí tiene FK a productos(id), pero productos.id es globalmente único,
--     así que el FK sólo garantiza que el producto EXISTE, no que sea del mismo tenant.
--
-- SEVERIDAD: INFO / defensa en profundidad — NO es una vulnerabilidad explotable. La RLS ya
-- impide que un usuario de la Empresa A VEA productos de la Empresa B (el JOIN a productos se
-- filtra por RLS y devuelve vacío), así que una fila con producto_id ajeno queda como basura
-- muda en la lista de A: no filtra datos de B, no afecta a B, ni cambia ningún precio de B. Es
-- del mismo tipo (y aún más benigno) que el hardening de crear_cheque de la mig.211.
--
-- Se cierra con el MISMO patrón/idioma que ya usa el repo para exactamente este caso: el trigger
-- fn_validar_tenant_centro_costo de la mig.187 (BEFORE INSERT/UPDATE, valida pertenencia al
-- tenant). producto_id es NULLABLE en ofertas (oferta por categoría o global) — sólo se valida
-- si viene con valor.

CREATE OR REPLACE FUNCTION public.fn_validar_tenant_producto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.producto_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.productos p
      WHERE p.id = NEW.producto_id
        AND p.empresa_id = NEW.empresa_id
    ) THEN
      RAISE EXCEPTION 'producto_id no pertenece a la empresa del registro';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Postgres nunca chequea EXECUTE al disparar un trigger; revocar es seguro (mismo criterio
-- que la mig.128/187 para sus funciones de trigger).
REVOKE EXECUTE ON FUNCTION public.fn_validar_tenant_producto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validar_tenant_producto_ofertas ON public.ofertas;
CREATE TRIGGER trg_validar_tenant_producto_ofertas
  BEFORE INSERT OR UPDATE OF producto_id ON public.ofertas
  FOR EACH ROW EXECUTE FUNCTION public.fn_validar_tenant_producto();

DROP TRIGGER IF EXISTS trg_validar_tenant_producto_lista_precio_items ON public.lista_precio_items;
CREATE TRIGGER trg_validar_tenant_producto_lista_precio_items
  BEFORE INSERT OR UPDATE OF producto_id ON public.lista_precio_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_validar_tenant_producto();

-- ROLLBACK (comentado):
--   DROP TRIGGER trg_validar_tenant_producto_ofertas ON public.ofertas;
--   DROP TRIGGER trg_validar_tenant_producto_lista_precio_items ON public.lista_precio_items;
--   DROP FUNCTION public.fn_validar_tenant_producto();
