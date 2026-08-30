-- migration 368 — Cancelar Pedido (hallazgo Luciano 29/08, probando el
-- circuito completo de Ventas: "no veo la posibilidad de cancelar el
-- pedido" desde su propio detalle).
--
-- El botón para cancelar YA existía, pero solo en la fila de TablaPedidos —
-- ModalDetallePedido (el detalle que se abre al ver un pedido) no lo
-- ofrecía. Al revisar el mecanismo existente (PedidosSection.handleCancelar)
-- se encontró que tampoco tenía ninguna guarda: un UPDATE directo a
-- estado='cancelado' sin RPC, que dejaba cancelar un pedido con entregas ya
-- generadas (mercadería que YA salió físicamente — Regla 8 sap-reference)
-- sin revertir nada ni avisar. Se reemplaza por un RPC con las mismas
-- guardas que ya usan cancelar_factura/cancelar_nota_credito/
-- cancelar_nota_debito.
--
-- Un Pedido no mueve stock ni genera asiento propio (eso lo hacen
-- Entrega/Factura), así que cancelarlo es liviano: solo cambia estado. El
-- motivo se guarda en notas (sin columna propia) para que quede visible en
-- el detalle y en el historial de auditoría (fn_audit_trigger ya está
-- enganchada a pedidos desde mig.017).

CREATE OR REPLACE FUNCTION public.cancelar_pedido(
  p_empresa_id uuid, p_user_id uuid, p_pedido_id uuid, p_motivo text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido RECORD;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  SELECT * INTO v_pedido FROM public.pedidos
  WHERE id = p_pedido_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;

  IF v_pedido.estado = 'cancelado' THEN
    RAISE EXCEPTION 'Este pedido ya está cancelado';
  END IF;

  IF v_pedido.estado = 'facturado' THEN
    RAISE EXCEPTION 'Este pedido ya fue facturado — no se puede cancelar directamente';
  END IF;

  -- Regla 8 (sap-reference): el stock se mueve en el evento físico. Si ya hay
  -- una Entrega viva contra este pedido, la mercadería ya salió — cancelar el
  -- pedido acá dejaría ese movimiento físico sin ningún documento que lo
  -- explique. Hay que anular la Entrega primero (circuito ya existente).
  IF EXISTS (
    SELECT 1 FROM public.entregas
    WHERE pedido_id = p_pedido_id AND empresa_id = p_empresa_id AND estado <> 'anulado'
  ) THEN
    RAISE EXCEPTION 'Este pedido ya tiene entregas registradas — anulalas primero desde Entregas';
  END IF;

  UPDATE public.pedidos
     SET estado = 'cancelado',
         notas = CASE
                    WHEN p_motivo IS NOT NULL AND p_motivo <> '' THEN
                      COALESCE(NULLIF(v_pedido.notas, ''), '')
                        || CASE WHEN v_pedido.notas IS NOT NULL AND v_pedido.notas <> '' THEN ' — ' ELSE '' END
                        || 'Cancelado: ' || p_motivo
                    ELSE v_pedido.notas
                 END,
         updated_at = now()
   WHERE id = p_pedido_id;

  RETURN jsonb_build_object('id', p_pedido_id, 'numero', v_pedido.numero);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancelar_pedido(uuid,uuid,uuid,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancelar_pedido(uuid,uuid,uuid,text) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.cancelar_pedido(uuid,uuid,uuid,text);
