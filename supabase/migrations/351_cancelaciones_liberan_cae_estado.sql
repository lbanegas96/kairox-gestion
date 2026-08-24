-- mig.351 — cancelar_factura/cancelar_nota_credito/cancelar_nota_debito dejaban
-- cae_estado='error' para siempre en un comprobante cancelado.
--
-- HALLAZGO (barrido general de la app pedido por Nadia, 24/08): las 3 funciones de
-- cancelación directa (sin pasar por NC/ND — sólo permitida cuando el comprobante
-- nunca llegó a tener CAE de verdad, ver el guard `cae_estado NOT IN ('emitido',
-- 'pendiente', 'pendiente_caea')` que ya tenía cada una) actualizan
-- `comprobantes.estado_pago = 'cancelada'` pero NUNCA tocan `cae_estado` — queda
-- en 'error' (o 'error_definitivo') para siempre.
--
-- IMPACTO real, confirmado con el caso de hoy (FAC-20260823-001, cancelada
-- directamente en esta misma sesión por tener cae_estado='error'): el Monitor de
-- Facturación AFIP la sigue mostrando como "Con error", infla ese contador, y dejaba
-- los botones "Reintentar"/"Usar CAEA" activos sobre un comprobante que ya no
-- representa una venta real -- reintentar emitirle un CAE ahora sería directamente
-- incorrecto.
--
-- FIX: agregar `cae_estado = 'no_aplica'` al UPDATE final de las 3. Es el valor
-- correcto y ya establecido en el sistema para "no hace falta ninguna acción de
-- AFIP sobre este comprobante" (mismo que usan los Tickets) -- MonitorFacturacionAFIP.jsx
-- ya excluye 'no_aplica' tanto de REINTENTABLES como del filtro por defecto
-- (ESTADOS_DEFAULT), así que no hace falta tocar el frontend para nada.
-- Es seguro incondicionalmente: por el guard de arriba, al llegar a este punto
-- cae_estado sólo puede ser 'error', 'error_definitivo', 'no_aplica' o NULL --
-- nunca 'emitido'/'pendiente'/'pendiente_caea' (esos ya cortaron con RAISE EXCEPTION
-- antes de llegar acá).
--
-- Dato aparte, corregido en la base para el único caso ya afectado (no hace falta
-- migración de datos separada, es la misma fila que ya se iba a tocar hoy):
-- FAC-20260823-001 pasa de cae_estado='error' a 'no_aplica' en el mismo momento
-- en que se aplica esta migración (ver UPDATE puntual al final).

CREATE OR REPLACE FUNCTION public.cancelar_factura(p_empresa_id uuid, p_user_id uuid, p_comprobante_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp     RECORD;
  v_entrega  RECORD;
  v_item     RECORD;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes
  WHERE id = p_comprobante_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;

  IF v_comp.tipo <> 'venta' THEN
    RAISE EXCEPTION 'Solo se pueden cancelar Facturas de Venta (tipo actual: %)', v_comp.tipo;
  END IF;

  IF v_comp.estado_pago = 'cancelada' THEN
    RAISE EXCEPTION 'Esta factura ya está cancelada';
  END IF;

  IF COALESCE(v_comp.cae_estado, 'no_aplica') IN ('emitido', 'pendiente', 'pendiente_caea') THEN
    RAISE EXCEPTION 'Esta factura tiene CAE emitido (o en trámite ante AFIP) — no se puede cancelar directamente. Generá una Nota de Crédito para anularla.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cuenta_corriente_imputaciones WHERE factura_comprobante_id = p_comprobante_id
  ) THEN
    RAISE EXCEPTION 'Esta factura ya tiene cobros imputados desde Cuenta Corriente — no se puede cancelar directamente. Generá una Nota de Crédito.';
  END IF;

  -- 1. Reversar stock SOLO de la entrega 'implicita' ligada a esta factura
  --    (nace junto con crear_venta en el mismo paso — cancelar la factura
  --    deshace también esa entrega). Una entrega 'manual' preexistente NO
  --    se toca: la mercadería salió en ESE evento, sigue afuera, y la
  --    entrega sigue siendo un documento válido — solo se desvincula para
  --    poder refacturarla.
  FOR v_entrega IN
    SELECT * FROM public.entregas
    WHERE comprobante_id = p_comprobante_id AND empresa_id = p_empresa_id AND estado <> 'anulado'
  LOOP
    IF v_entrega.origen = 'implicita' THEN
      FOR v_item IN
        SELECT * FROM public.entrega_items WHERE entrega_id = v_entrega.id
      LOOP
        UPDATE public.productos SET stock_actual = stock_actual + v_item.cantidad
        WHERE id = v_item.producto_id AND empresa_id = p_empresa_id;

        INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
        VALUES (p_empresa_id, p_empresa_id, v_item.producto_id, 'entrada', v_item.cantidad,
                'Cancelación de Factura ' || v_comp.numero_venta, now());
      END LOOP;

      UPDATE public.entregas SET estado = 'anulado' WHERE id = v_entrega.id;
    ELSE
      UPDATE public.entregas SET comprobante_id = NULL WHERE id = v_entrega.id;
    END IF;
  END LOOP;

  -- 2. Revertir cantidad_facturada en pedido_items si esta factura vino de un pedido
  IF v_comp.pedido_id IS NOT NULL THEN
    FOR v_item IN
      SELECT ci.producto_id, ci.cantidad
      FROM public.comprobante_items ci
      WHERE ci.comprobante_id = p_comprobante_id AND ci.producto_id IS NOT NULL
    LOOP
      UPDATE public.pedido_items
      SET cantidad_facturada = GREATEST(0, COALESCE(cantidad_facturada, 0) - v_item.cantidad)
      WHERE pedido_id = v_comp.pedido_id AND producto_id = v_item.producto_id AND empresa_id = p_empresa_id;
    END LOOP;
  END IF;

  -- 3. Reversar movimientos_caja — documento de reversa (egreso especular),
  --    nunca se borra el ingreso original. Match por comprobante_id (mig.257)
  --    con fallback por concepto para filas legacy sin ese vínculo.
  INSERT INTO public.movimientos_caja (
    empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, is_automatic, fecha, comprobante_id
  )
  SELECT empresa_id, auth.uid(), caja_sesion_id, 'egreso', 'Venta',
         'Cancelación Factura ' || v_comp.numero_venta, monto, metodo_pago, true, now(), p_comprobante_id
  FROM public.movimientos_caja mc
  WHERE mc.empresa_id = p_empresa_id
    AND mc.tipo = 'ingreso'
    AND (
      mc.comprobante_id = p_comprobante_id
      OR (mc.comprobante_id IS NULL AND mc.concepto IN ('Venta #' || v_comp.numero_venta, 'Factura ' || v_comp.numero_venta))
    );

  -- 4. Reversar cuenta corriente (si la factura generó deuda) — HABER
  --    especular, nunca se borra el DEBE original.
  IF v_comp.cliente_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cuenta_corriente_movimientos
    WHERE comprobante_id = p_comprobante_id AND tipo = 'DEBE'
  ) THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha
    ) VALUES (
      p_empresa_id, auth.uid(), v_comp.cliente_id, p_comprobante_id, 'HABER', v_comp.total,
      'Cancelación Factura ' || v_comp.numero_venta || COALESCE(' — ' || NULLIF(p_motivo, ''), ''), now()
    );
  END IF;

  -- 5. Estado final — mig.351: cae_estado también pasa a 'no_aplica', no sólo
  --    estado_pago='cancelada' (antes quedaba huérfana en el Monitor AFIP para siempre).
  UPDATE public.comprobantes SET estado_pago = 'cancelada', cae_estado = 'no_aplica' WHERE id = p_comprobante_id;

  RETURN jsonb_build_object(
    'comprobante_id', p_comprobante_id,
    'numero_venta',   v_comp.numero_venta,
    'total',          v_comp.total
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_nota_credito(p_empresa_id uuid, p_user_id uuid, p_comprobante_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp RECORD;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes
  WHERE id = p_comprobante_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;

  IF v_comp.tipo <> 'nota_credito' THEN
    RAISE EXCEPTION 'Solo se pueden cancelar Notas de Crédito (tipo actual: %)', v_comp.tipo;
  END IF;

  IF v_comp.estado_pago = 'cancelada' THEN
    RAISE EXCEPTION 'Esta Nota de Crédito ya está cancelada';
  END IF;

  IF COALESCE(v_comp.cae_estado, 'no_aplica') IN ('emitido', 'pendiente', 'pendiente_caea') THEN
    RAISE EXCEPTION 'Esta Nota de Crédito tiene CAE emitido (o en trámite ante AFIP) — no se puede cancelar directamente.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cuenta_corriente_imputaciones ci
    JOIN public.cuenta_corriente_movimientos cm ON cm.id = ci.cobro_movimiento_id
    WHERE cm.comprobante_id = p_comprobante_id
  ) THEN
    RAISE EXCEPTION 'Esta Nota de Crédito ya fue imputada contra la factura de origen — no se puede cancelar directamente.';
  END IF;

  -- Reversar cuenta corriente (HABER original) — DEBE especular, nunca se
  -- borra el HABER original.
  IF v_comp.cliente_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cuenta_corriente_movimientos
    WHERE comprobante_id = p_comprobante_id AND tipo = 'HABER'
  ) THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha
    ) VALUES (
      p_empresa_id, auth.uid(), v_comp.cliente_id, p_comprobante_id, 'DEBE', v_comp.total,
      'Cancelación NC ' || v_comp.numero_venta || COALESCE(' — ' || NULLIF(p_motivo, ''), ''), now()
    );
  END IF;

  -- Desvincular de la Devolución origen (si la hubo) para que quede
  -- disponible y se pueda generar una NC nueva más adelante.
  UPDATE public.devoluciones
     SET nota_credito_id = NULL, compensacion = 'pendiente'
   WHERE nota_credito_id = p_comprobante_id AND empresa_id = p_empresa_id;

  -- mig.351: mismo fix que cancelar_factura, cae_estado también a 'no_aplica'.
  UPDATE public.comprobantes SET estado_pago = 'cancelada', cae_estado = 'no_aplica' WHERE id = p_comprobante_id;

  RETURN jsonb_build_object(
    'comprobante_id', p_comprobante_id,
    'numero_venta',   v_comp.numero_venta,
    'total',          v_comp.total
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_nota_debito(p_empresa_id uuid, p_user_id uuid, p_comprobante_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp RECORD;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes
  WHERE id = p_comprobante_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;

  IF v_comp.tipo <> 'nota_debito' THEN
    RAISE EXCEPTION 'Solo se pueden cancelar Notas de Débito (tipo actual: %)', v_comp.tipo;
  END IF;

  IF v_comp.estado_pago = 'cancelada' THEN
    RAISE EXCEPTION 'Esta Nota de Débito ya está cancelada';
  END IF;

  IF COALESCE(v_comp.cae_estado, 'no_aplica') IN ('emitido', 'pendiente', 'pendiente_caea') THEN
    RAISE EXCEPTION 'Esta Nota de Débito tiene CAE emitido (o en trámite ante AFIP) — no se puede cancelar directamente.';
  END IF;

  -- Bug real encontrado por revisión automática (13/08): esto se había copiado tal cual de
  -- cancelar_nota_credito, que chequea `cobro_movimiento_id` porque el HABER de una NC actúa
  -- como el lado "cobro" al imputarse contra una factura ajena. Una ND es lo opuesto — su propio
  -- movimiento es un DEBE (una deuda, como una factura), así que si se le imputó un cobro, ESE
  -- comprobante aparece como `factura_comprobante_id` (mismo criterio que cancelar_factura,
  -- mig.259) — nunca como `cobro_movimiento_id`. La versión original de esta guarda nunca
  -- matcheaba nada, dejando cancelar una ND que ya tenía un cobro aplicado y generando una
  -- reversión HABER completa por encima del cobro ya imputado (saldo de cliente subestimado).
  IF EXISTS (
    SELECT 1 FROM public.cuenta_corriente_imputaciones WHERE factura_comprobante_id = p_comprobante_id
  ) THEN
    RAISE EXCEPTION 'Esta Nota de Débito ya tiene cobros imputados desde Cuenta Corriente — no se puede cancelar directamente.';
  END IF;

  IF v_comp.cliente_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cuenta_corriente_movimientos
    WHERE comprobante_id = p_comprobante_id AND tipo = 'DEBE'
  ) THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha
    ) VALUES (
      p_empresa_id, auth.uid(), v_comp.cliente_id, p_comprobante_id, 'HABER', v_comp.total,
      'Cancelación ND ' || v_comp.numero_venta || COALESCE(' — ' || NULLIF(p_motivo, ''), ''), now()
    );
  END IF;

  -- mig.351: mismo fix que cancelar_factura, cae_estado también a 'no_aplica'.
  UPDATE public.comprobantes SET estado_pago = 'cancelada', cae_estado = 'no_aplica' WHERE id = p_comprobante_id AND empresa_id = p_empresa_id;

  RETURN jsonb_build_object(
    'comprobante_id', p_comprobante_id,
    'numero_venta',   v_comp.numero_venta,
    'total',          v_comp.total
  );
END;
$function$;

-- Corrige el único caso ya afectado por el bug (FAC-20260823-001, cancelada hoy
-- mismo antes de este fix) — no hace falta esperar a la próxima cancelación.
UPDATE public.comprobantes
   SET cae_estado = 'no_aplica'
 WHERE numero_venta = 'FAC-20260823-001'
   AND estado_pago = 'cancelada'
   AND cae_estado = 'error';
