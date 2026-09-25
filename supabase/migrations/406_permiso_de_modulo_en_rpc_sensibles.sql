-- 406 — Permiso de módulo en las RPC sensibles que no lo chequeaban
--
-- Auditoría 24/09/2026, hallazgo SEG-12. Estas funciones son SECURITY DEFINER (saltean el RLS) y
-- ESCRIBEN datos, pero no llamaban a `has_module_permission`: cualquier usuario de la empresa, aunque
-- no tuviera el módulo, podía ejecutarlas por API (ajustar stock y costos, crear/confirmar/anular
-- recuentos y revalorizaciones de inventario —que generan asientos—, editar cotizaciones y pedidos,
-- programar/cancelar precios y recalcular listas por factor).
--
-- Ninguna de las 15 es llamada por otra función de la base (solo desde el frontend), así que agregar el
-- chequeo no puede romper un flujo interno. El permiso que se exige es el del módulo desde el que se
-- usa cada una (Sidebar.jsx) y el que ya exige el RLS de las tablas que tocan:
--
--   ventas .............. actualizar_cotizacion
--   pedidos o ventas .... actualizar_pedido            (la pantalla se gobierna por `pedidos`, el RLS por `ventas`)
--   productos ........... ajustar_stock_manual, crear/confirmar/anular_recuento_inventario,
--                         set_asiento_recuento_inventario, crear/confirmar/anular_revalorizacion_inventario,
--                         set_asiento_revalorizacion_inventario
--   compras o productos . aplicar_compra_producto      (la usa Compras al recibir mercadería, pero modifica productos)
--   clientes ............ programar_precio_futuro, cancelar_precio_programado, recalcular_precios_lista_factor
--                         (Listas de Precios se gobierna por `clientes`)
--
-- Método: en vez de retipear 13 cuerpos (con riesgo de alterarlos), la migración lee la definición
-- vigente con `pg_get_functiondef` e inserta el chequeo justo después del BEGIN principal; la función
-- se recrea idéntica (mismos argumentos, DEFAULTs, SECURITY DEFINER, search_path y permisos de ejecución).
-- Idempotente: si el chequeo ya está, la función no se toca. Las 2 restantes (`set_asiento_*`) son
-- funciones SQL de una sola sentencia sin BEGIN: se reescriben en plpgsql con el chequeo, y además
-- validan que el asiento sea de la misma empresa.
--
-- `has_module_permission` devuelve true para admins y para `service_role`, y false para un usuario
-- inactivo o sin el módulo.

DO $mig$
DECLARE
  r       record;
  v_def   text;
  v_guard text;
  v_nuevo text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, g.condicion, g.modulos
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    JOIN (VALUES
      ('actualizar_cotizacion',                 $c$has_module_permission('ventas')$c$,                                              'ventas'),
      ('actualizar_pedido',                     $c$(has_module_permission('pedidos') OR has_module_permission('ventas'))$c$,        'pedidos o ventas'),
      ('ajustar_stock_manual',                  $c$has_module_permission('productos')$c$,                                           'productos'),
      ('crear_recuento_inventario',             $c$has_module_permission('productos')$c$,                                           'productos'),
      ('confirmar_recuento_inventario',         $c$has_module_permission('productos')$c$,                                           'productos'),
      ('anular_recuento_inventario',            $c$has_module_permission('productos')$c$,                                           'productos'),
      ('crear_revalorizacion_inventario',       $c$has_module_permission('productos')$c$,                                           'productos'),
      ('confirmar_revalorizacion_inventario',   $c$has_module_permission('productos')$c$,                                           'productos'),
      ('anular_revalorizacion_inventario',      $c$has_module_permission('productos')$c$,                                           'productos'),
      ('aplicar_compra_producto',               $c$(has_module_permission('compras') OR has_module_permission('productos'))$c$,     'compras o productos'),
      ('programar_precio_futuro',               $c$has_module_permission('clientes')$c$,                                            'clientes'),
      ('cancelar_precio_programado',            $c$has_module_permission('clientes')$c$,                                            'clientes'),
      ('recalcular_precios_lista_factor',       $c$has_module_permission('clientes')$c$,                                            'clientes')
    ) AS g(nombre, condicion, modulos) ON g.nombre = p.proname
  LOOP
    v_def := pg_get_functiondef(r.oid);

    IF position('[mig.406]' IN v_def) > 0 THEN
      CONTINUE;  -- ya tiene el chequeo
    END IF;

    v_guard := format(
      E'\n  -- [mig.406] permiso de módulo (auditoría SEG-12)\n  IF NOT %s THEN\n    RAISE EXCEPTION ''No autorizado: sin permiso de módulo (%s)'';\n  END IF;',
      r.condicion, r.modulos
    );

    -- Primer BEGIN que está solo en su línea = el BEGIN principal de la función.
    v_nuevo := regexp_replace(v_def, E'(\\r?\\nBEGIN)(\\r?\\n)', '\1' || v_guard || '\2', 'i');

    IF v_nuevo = v_def THEN
      RAISE EXCEPTION 'mig.406: no se encontró el BEGIN principal de %', r.proname;
    END IF;

    EXECUTE v_nuevo;
  END LOOP;
END
$mig$;

-- Vincular el asiento a un recuento / una revalorización: mismo comportamiento que antes, con el
-- permiso de módulo y verificando que el asiento sea de la misma empresa.
CREATE OR REPLACE FUNCTION public.set_asiento_recuento_inventario(p_recuento_id uuid, p_asiento_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- [mig.406] permiso de módulo (auditoría SEG-12)
  IF NOT has_module_permission('productos') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo (productos)';
  END IF;

  UPDATE public.recuentos_inventario
  SET asiento_id = p_asiento_id
  WHERE id = p_recuento_id
    AND empresa_id = get_my_empresa_id()
    AND EXISTS (SELECT 1 FROM public.asientos_contables a WHERE a.id = p_asiento_id AND a.empresa_id = get_my_empresa_id());
END;
$$;

CREATE OR REPLACE FUNCTION public.set_asiento_revalorizacion_inventario(p_revalorizacion_id uuid, p_asiento_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- [mig.406] permiso de módulo (auditoría SEG-12)
  IF NOT has_module_permission('productos') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo (productos)';
  END IF;

  UPDATE public.revalorizaciones_inventario
  SET asiento_id = p_asiento_id
  WHERE id = p_revalorizacion_id
    AND empresa_id = get_my_empresa_id()
    AND EXISTS (SELECT 1 FROM public.asientos_contables a WHERE a.id = p_asiento_id AND a.empresa_id = get_my_empresa_id());
END;
$$;
