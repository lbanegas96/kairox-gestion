-- migration 393 — Cancelar Orden de Compra (hallazgo Luciano 09/09, auditando
-- paridad OC vs Pedido de Ventas): el detalle de OC no ofrecía ningún botón
-- para cancelar — el único lugar era la fila de TablaOrdenesCompra, con un
-- UPDATE directo a estado='cancelada' (ordenesCompraService.cancelar) sin
-- ninguna guarda. Mismo patrón exacto que cancelar_pedido (mig.368): se
-- reemplaza por una RPC con las mismas guardas (no cancelar si ya facturada,
-- no cancelar si ya cancelada, no cancelar si ya hay Recepciones activas —
-- Regla 8 sap-reference, la mercadería ya entró físicamente).
--
-- Una OC no mueve stock ni genera asiento propio (eso lo hacen
-- Recepción/Factura de Compra), así que cancelarla es liviano: solo cambia
-- estado. El motivo se guarda en notas para que quede visible en el detalle
-- y en el historial de auditoría (fn_audit_trigger ya está enganchada a
-- ordenes_compra desde antes).

CREATE OR REPLACE FUNCTION public.cancelar_orden_compra(
  p_empresa_id uuid, p_user_id uuid, p_orden_compra_id uuid, p_motivo text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_oc RECORD;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;

  SELECT * INTO v_oc FROM public.ordenes_compra
  WHERE id = p_orden_compra_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;

  IF v_oc.estado = 'cancelada' THEN
    RAISE EXCEPTION 'Esta orden de compra ya está cancelada';
  END IF;

  IF v_oc.estado = 'facturada' THEN
    RAISE EXCEPTION 'Esta orden de compra ya fue facturada — no se puede cancelar directamente';
  END IF;

  -- Regla 8 (sap-reference): el stock se mueve en el evento físico. Si algún
  -- ítem ya tiene cantidad_recibida > 0, la mercadería ya entró físicamente —
  -- cancelar acá dejaría ese movimiento sin ningún documento que lo explique.
  -- OJO: se chequea cantidad_recibida directo (no recepciones.orden_compra_id)
  -- porque una recepción puede vincularse a nivel de ÍTEM
  -- (recepcion_items.orden_compra_item_id) sin que el header de recepciones
  -- tenga orden_compra_id seteado — verificado con datos reales (09/09): una
  -- OC con ítems recibidos y CERO filas en recepciones con ese orden_compra_id.
  IF EXISTS (
    SELECT 1 FROM public.ordenes_compra_items
    WHERE orden_id = p_orden_compra_id AND empresa_id = p_empresa_id AND cantidad_recibida > 0
  ) THEN
    RAISE EXCEPTION 'Esta orden de compra ya tiene mercadería recibida — no se puede cancelar directamente';
  END IF;

  UPDATE public.ordenes_compra
     SET estado = 'cancelada',
         notas = CASE
                    WHEN p_motivo IS NOT NULL AND p_motivo <> '' THEN
                      COALESCE(NULLIF(v_oc.notas, ''), '')
                        || CASE WHEN v_oc.notas IS NOT NULL AND v_oc.notas <> '' THEN ' — ' ELSE '' END
                        || 'Cancelada: ' || p_motivo
                    ELSE v_oc.notas
                 END,
         updated_at = now()
   WHERE id = p_orden_compra_id;

  RETURN jsonb_build_object('id', p_orden_compra_id, 'numero', v_oc.numero);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancelar_orden_compra(uuid,uuid,uuid,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancelar_orden_compra(uuid,uuid,uuid,text) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.cancelar_orden_compra(uuid,uuid,uuid,text);
