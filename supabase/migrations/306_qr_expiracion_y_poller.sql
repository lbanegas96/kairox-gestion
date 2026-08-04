-- mig.306 — QR MercadoPago Fase 2 (backend): expiración de QRs abandonados
--
-- HALLAZGO QUE MOTIVA ESTA MIGRACIÓN (2026-08-04): `crear_venta_pendiente_qr`
-- **descuenta stock** al generar el QR (crea la entrega y baja `stock_actual`),
-- y `cancelar_venta_pendiente_qr` lo devuelve. Pero esa última exige
-- `get_my_empresa_id()` + `has_module_permission('ventas')`, o sea que **sólo la
-- puede llamar un cajero autenticado — nunca un cron ni un worker**.
--
-- Consecuencia: si el cliente se va sin escanear el QR, el stock queda
-- descontado para siempre y el comprobante en `pendiente` para siempre. Hoy no
-- pasó porque todavía no hay UI que genere QRs (verificado: 0 pendientes en
-- producción), pero en cuanto se publique la Fase 2 se convierte en una **fuga
-- de stock real** en cada cliente que abandona el mostrador.
--
-- Por eso el barrido de expiración no es opcional: es parte del circuito.
--
-- ── Diseño ───────────────────────────────────────────────────────────────────
-- La lógica de reversa (devolver stock, anular entregas, cancelar comprobante)
-- se **extrae a una función interna compartida**, en vez de copiarla en la de
-- expiración. Mismo criterio que se usó con `useArqueoCaja` cuando el cierre de
-- caja del POS y el del panel admin habían divergido: si hay dos copias de la
-- misma reversa, tarde o temprano una se actualiza y la otra no.
--
--   _revertir_venta_qr_interno()  ← la reversa, SIN checks de permisos
--        ↑                    ↑
--   cancelar_...(cajero)   expirar_...(cron/service_role)
--        auth guards          service_role only
--
-- La interna NO valida permisos a propósito: es responsabilidad de cada wrapper,
-- y por eso se le revoca EXECUTE a todo el mundo salvo los roles internos.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) La reversa compartida
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._revertir_venta_qr_interno(
  p_empresa_id     uuid,
  p_comprobante_id uuid,
  p_qr_id          uuid,
  p_estado_qr      text,   -- 'cancelado' (cajero) | 'expirado' (cron)
  p_motivo         text    -- texto que queda en movimientos_inventario
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_comp RECORD; v_entrega RECORD; v_item RECORD;
  v_unidades_devueltas integer := 0;
BEGIN
  IF p_estado_qr NOT IN ('cancelado', 'expirado') THEN
    RAISE EXCEPTION 'Estado de QR inválido para la reversa: %', p_estado_qr;
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes
   WHERE id = p_comprobante_id AND empresa_id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;

  -- Devolver el stock que descontó crear_venta_pendiente_qr.
  FOR v_entrega IN
    SELECT * FROM public.entregas
    WHERE comprobante_id = p_comprobante_id AND empresa_id = p_empresa_id AND estado <> 'anulado'
  LOOP
    FOR v_item IN SELECT * FROM public.entrega_items WHERE entrega_id = v_entrega.id
    LOOP
      UPDATE public.productos SET stock_actual = stock_actual + v_item.cantidad
      WHERE id = v_item.producto_id AND empresa_id = p_empresa_id;

      INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
      VALUES (p_empresa_id, p_empresa_id, v_item.producto_id, 'entrada', v_item.cantidad,
              p_motivo || ' — Venta ' || v_comp.numero_venta, now());

      v_unidades_devueltas := v_unidades_devueltas + v_item.cantidad;
    END LOOP;
    UPDATE public.entregas SET estado = 'anulado' WHERE id = v_entrega.id;
  END LOOP;

  UPDATE public.comprobantes SET estado_pago = 'cancelada' WHERE id = p_comprobante_id;
  UPDATE public.qr_pagos_mp SET estado = p_estado_qr, updated_at = now() WHERE id = p_qr_id;

  RETURN jsonb_build_object(
    'ok', true,
    'comprobante_id', p_comprobante_id,
    'numero_venta', v_comp.numero_venta,
    'estado_qr', p_estado_qr,
    'unidades_devueltas', v_unidades_devueltas
  );
END;
$$;

-- Interna: nadie la llama de afuera. REVOKE FROM PUBLIC (no sólo de anon — ver
-- la lección de mig.304/305: revocar de `anon` cuando el permiso viene de PUBLIC
-- es un no-op silencioso).
REVOKE EXECUTE ON FUNCTION public._revertir_venta_qr_interno(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._revertir_venta_qr_interno(uuid, uuid, uuid, text, text) FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Cancelar desde el POS — mismos guards y mensajes que antes, ahora
--    delegando la reversa en la función compartida.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancelar_venta_pendiente_qr(p_empresa_id uuid, p_comprobante_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_qr RECORD; v_comp RECORD;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  SELECT * INTO v_qr FROM public.qr_pagos_mp
   WHERE comprobante_id = p_comprobante_id AND empresa_id = p_empresa_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay un QR MercadoPago pendiente para este comprobante';
  END IF;

  -- Race real: el cliente puede haber pagado entre que el cajero ve la pantalla
  -- y aprieta Cancelar. El lock de arriba + este recheck lo cubren.
  IF v_qr.estado = 'pagado' THEN
    RAISE EXCEPTION 'El pago de este QR ya fue confirmado — no se puede cancelar. Actualizá la pantalla.';
  END IF;
  IF v_qr.estado <> 'pendiente' THEN
    RETURN jsonb_build_object('ok', true, 'ya_procesado', true, 'estado', v_qr.estado);
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes
   WHERE id = p_comprobante_id AND empresa_id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;
  IF v_comp.estado_pago <> 'pendiente' THEN
    RAISE EXCEPTION 'Este comprobante no está pendiente de pago (estado actual: %)', v_comp.estado_pago;
  END IF;

  RETURN public._revertir_venta_qr_interno(
    p_empresa_id, p_comprobante_id, v_qr.id, 'cancelado', 'Cancelación QR MercadoPago'
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Barrido de expiración — para el cron. service_role únicamente.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expirar_qrs_vencidos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_qr RECORD;
  v_expirados int := 0;
  v_unidades  int := 0;
  v_res jsonb;
BEGIN
  -- SKIP LOCKED: si el cajero está cancelando ese mismo QR en este instante, se
  -- lo saltea y lo agarra la corrida siguiente, en vez de bloquear el barrido.
  FOR v_qr IN
    SELECT * FROM public.qr_pagos_mp
     WHERE estado = 'pendiente' AND expiracion < now()
     ORDER BY expiracion
     FOR UPDATE SKIP LOCKED
  LOOP
    -- Recheck bajo lock: el webhook o el poller pueden haberlo confirmado
    -- justo después del SELECT. Nunca revertir una venta ya cobrada.
    IF EXISTS (SELECT 1 FROM public.qr_pagos_mp WHERE id = v_qr.id AND estado = 'pendiente') THEN
      v_res := public._revertir_venta_qr_interno(
        v_qr.empresa_id, v_qr.comprobante_id, v_qr.id, 'expirado', 'Expiración QR MercadoPago'
      );
      v_expirados := v_expirados + 1;
      v_unidades  := v_unidades + COALESCE((v_res->>'unidades_devueltas')::int, 0);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'expirados', v_expirados, 'unidades_devueltas', v_unidades);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expirar_qrs_vencidos() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expirar_qrs_vencidos() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.expirar_qrs_vencidos() TO service_role;
