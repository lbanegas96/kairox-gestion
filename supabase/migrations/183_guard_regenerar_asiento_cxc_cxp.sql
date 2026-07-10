-- Cierre del pendiente documentado al final de la Fase 5 (mig.181): "exponer el botón
-- Regenerar en el histórico de movimientos" — hoy solo aparecía en el toast del momento
-- del cobro/pago, así que los ~27 históricos (mayormente pre-2026-07-06) no tenían forma
-- de regenerarse desde ninguna pantalla.
--
-- Antes de exponer el botón en un listado genérico se encontró, con datos reales de
-- producción, que regenerar_asiento_cxc/cxp NO validan que la fila sea un cobro/pago
-- real (efectivo/transferencia/tarjeta) — solo filtran por tipo='HABER'/'pago'. Eso
-- significa que también "regenerarían" un asiento de "cobro en efectivo" para filas que
-- NO son plata real:
--   - Cheques (mig.182): crear_cheque_tercero inserta HABER con cheque_id — su asiento
--     real ya existe (DEBE 1.1.6 Cheques en Cartera / HABER 1.1.2), vía el trigger de
--     cheques. "Regenerar" fabricaría un segundo asiento con DEBE Caja, como si hubiese
--     entrado efectivo de verdad.
--   - Notas de Crédito / devoluciones (crear_nota_credito, crear_devolucion): insertan
--     HABER con comprobante_id apuntando a la NC (nunca a la factura original) y NUNCA
--     setean metodo_cobro — es una reducción de deuda sin plata real. Confirmado con
--     8 filas reales en producción (todas "NC ..."). "Regenerar" también fabricaría un
--     DEBE Caja falso.
--   - En cambio, hay un estilo VIEJO de cobro (pre-mig.130, sin tabla de imputación) que
--     SÍ es plata real y SÍ liga comprobante_id a la FACTURA que cancela, pero además
--     siempre seteó metodo_cobro (ej. "Cobro Efectivo - Fact. ...") — 1 fila real así en
--     producción. La regla no puede ser "excluir por comprobante_id": tiene que combinar
--     ambas señales para no descartar cobros reales del backlog histórico.
--
-- Regla validada contra los datos reales de Nalux (20 candidatos CxC + 6 CxP, 0 falsos
-- positivos de cheque/NC coladas):
--   CxC regenerable  := cheque_id IS NULL AND NOT (comprobante_id IS NOT NULL AND metodo_cobro IS NULL)
--   CxP regenerable  := cheque_id IS NULL   (ND recibida ya usa tipo='nota_debito', distinto de 'pago')

CREATE OR REPLACE FUNCTION public.regenerar_asiento_cxc(p_movimiento_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid; v_monto numeric; v_dif_cambio_total numeric; v_cliente_nombre text;
  v_fecha_dia date; v_asiento_id_existente uuid; v_cerrado boolean;
  v_cheque_id uuid; v_comprobante_id uuid; v_metodo_cobro text;
  v_cta_caja uuid; v_cta_cxc uuid; v_cta_dif_gan uuid; v_cta_dif_perd uuid;
  v_monto_cxc_cancelado numeric; v_total_asiento numeric; v_asiento_id uuid;
BEGIN
  SELECT ccm.empresa_id, ccm.monto, ccm.dif_cambio_total, ccm.fecha::date, ccm.asiento_id,
         ccm.cheque_id, ccm.comprobante_id, ccm.metodo_cobro, COALESCE(c.nombre, 'cliente')
    INTO v_empresa_id, v_monto, v_dif_cambio_total, v_fecha_dia, v_asiento_id_existente,
         v_cheque_id, v_comprobante_id, v_metodo_cobro, v_cliente_nombre
    FROM public.cuenta_corriente_movimientos ccm
    LEFT JOIN public.clientes c ON c.id = ccm.cliente_id
   WHERE ccm.id = p_movimiento_id AND ccm.tipo = 'HABER';

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Cobro no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el cobro no pertenece a esta empresa';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF v_asiento_id_existente IS NOT NULL THEN
    RAISE EXCEPTION 'Este cobro ya tiene un asiento contable generado';
  END IF;
  IF v_cheque_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este movimiento corresponde a un cheque recibido, no a un cobro en efectivo/transferencia — su asiento ya se genera desde el módulo de Cheques';
  END IF;
  IF v_comprobante_id IS NOT NULL AND v_metodo_cobro IS NULL THEN
    RAISE EXCEPTION 'Este movimiento corresponde a una Nota de Crédito o devolución, no a un cobro real — no aplica generar un asiento de "cobro recibido" para él';
  END IF;

  SELECT fecha_en_periodo_cerrado(v_empresa_id, v_fecha_dia) INTO v_cerrado;
  IF COALESCE(v_cerrado, false) THEN
    RAISE EXCEPTION 'El período de este cobro (%) está cerrado — reabrilo en Plan de Cuentas antes de regenerar el asiento', v_fecha_dia;
  END IF;

  v_dif_cambio_total := COALESCE(v_dif_cambio_total, 0);
  SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
  SELECT id INTO v_cta_cxc  FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '1.1.2' AND activa LIMIT 1;
  IF v_cta_caja IS NULL OR v_cta_cxc IS NULL THEN
    RAISE EXCEPTION 'Falta configurar las cuentas contables de Caja (1.1.1) o Cuentas a Cobrar (1.1.2) en Plan de Cuentas';
  END IF;
  IF v_dif_cambio_total <> 0 THEN
    SELECT id INTO v_cta_dif_gan  FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '4.4' AND activa LIMIT 1;
    SELECT id INTO v_cta_dif_perd FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '5.9' AND activa LIMIT 1;
    IF v_cta_dif_gan IS NULL OR v_cta_dif_perd IS NULL THEN
      RAISE EXCEPTION 'Falta configurar las cuentas de Diferencia de Cambio (4.4/5.9) en Plan de Cuentas';
    END IF;
  END IF;

  v_monto_cxc_cancelado := v_monto - v_dif_cambio_total;
  v_total_asiento       := v_monto + GREATEST(-v_dif_cambio_total, 0);

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (
    v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha_dia,
    'Cobro a ' || v_cliente_nombre || ' (regenerado)',
    'confirmado', v_total_asiento, v_total_asiento, 'cobro_cliente', p_movimiento_id
  ) RETURNING id INTO v_asiento_id;

  INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
    (v_asiento_id, v_empresa_id, v_cta_caja, 'Cobro recibido', v_monto, 0),
    (v_asiento_id, v_empresa_id, v_cta_cxc,  'Cancelación parcial/total de deuda', 0, v_monto_cxc_cancelado);
  IF v_dif_cambio_total > 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_empresa_id, v_cta_dif_gan, 'Diferencia de cambio ganada (clearing, regenerado)', 0, v_dif_cambio_total);
  ELSIF v_dif_cambio_total < 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_empresa_id, v_cta_dif_perd, 'Diferencia de cambio perdida (clearing, regenerado)', -v_dif_cambio_total, 0);
  END IF;

  UPDATE public.cuenta_corriente_movimientos SET asiento_id = v_asiento_id WHERE id = p_movimiento_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.regenerar_asiento_cxp(p_movimiento_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid; v_monto numeric; v_dif_cambio_total numeric; v_proveedor_nombre text;
  v_fecha_dia date; v_asiento_id_existente uuid; v_cerrado boolean; v_cheque_id uuid;
  v_cta_caja uuid; v_cta_cxp uuid; v_cta_dif_gan uuid; v_cta_dif_perd uuid;
  v_monto_cxp_cancelado numeric; v_total_asiento numeric; v_asiento_id uuid;
BEGIN
  SELECT ccp.empresa_id, ccp.monto, ccp.dif_cambio_total, ccp.fecha::date, ccp.asiento_id,
         ccp.cheque_id, COALESCE(p.nombre, 'proveedor')
    INTO v_empresa_id, v_monto, v_dif_cambio_total, v_fecha_dia, v_asiento_id_existente,
         v_cheque_id, v_proveedor_nombre
    FROM public.cuenta_corriente_proveedores ccp
    LEFT JOIN public.proveedores p ON p.id = ccp.proveedor_id
   WHERE ccp.id = p_movimiento_id AND ccp.tipo = 'pago';

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Pago no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el pago no pertenece a esta empresa';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;
  IF v_asiento_id_existente IS NOT NULL THEN
    RAISE EXCEPTION 'Este pago ya tiene un asiento contable generado';
  END IF;
  IF v_cheque_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este movimiento corresponde a un cheque propio entregado, no a un pago en efectivo/transferencia — su asiento ya se genera desde el módulo de Cheques';
  END IF;

  SELECT fecha_en_periodo_cerrado(v_empresa_id, v_fecha_dia) INTO v_cerrado;
  IF COALESCE(v_cerrado, false) THEN
    RAISE EXCEPTION 'El período de este pago (%) está cerrado — reabrilo en Plan de Cuentas antes de regenerar el asiento', v_fecha_dia;
  END IF;

  v_dif_cambio_total := COALESCE(v_dif_cambio_total, 0);
  SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
  SELECT id INTO v_cta_cxp  FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
  IF v_cta_caja IS NULL OR v_cta_cxp IS NULL THEN
    RAISE EXCEPTION 'Falta configurar las cuentas contables de Caja (1.1.1) o Proveedores (2.1.1) en Plan de Cuentas';
  END IF;
  IF v_dif_cambio_total <> 0 THEN
    SELECT id INTO v_cta_dif_gan  FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '4.4' AND activa LIMIT 1;
    SELECT id INTO v_cta_dif_perd FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '5.9' AND activa LIMIT 1;
    IF v_cta_dif_gan IS NULL OR v_cta_dif_perd IS NULL THEN
      RAISE EXCEPTION 'Falta configurar las cuentas de Diferencia de Cambio (4.4/5.9) en Plan de Cuentas';
    END IF;
  END IF;

  v_monto_cxp_cancelado := v_monto - v_dif_cambio_total;
  v_total_asiento       := v_monto + GREATEST(-v_dif_cambio_total, 0);

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (
    v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha_dia,
    'Pago a ' || v_proveedor_nombre || ' (regenerado)',
    'confirmado', v_total_asiento, v_total_asiento, 'pago_proveedor', p_movimiento_id
  ) RETURNING id INTO v_asiento_id;

  INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
    (v_asiento_id, v_empresa_id, v_cta_cxp,  'Cancelación parcial/total de deuda', v_monto_cxp_cancelado, 0),
    (v_asiento_id, v_empresa_id, v_cta_caja, 'Pago realizado', 0, v_monto);
  IF v_dif_cambio_total > 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_empresa_id, v_cta_dif_perd, 'Diferencia de cambio perdida (clearing, regenerado)', v_dif_cambio_total, 0);
  ELSIF v_dif_cambio_total < 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_empresa_id, v_cta_dif_gan, 'Diferencia de cambio ganada (clearing, regenerado)', 0, -v_dif_cambio_total);
  END IF;

  UPDATE public.cuenta_corriente_proveedores SET asiento_id = v_asiento_id WHERE id = p_movimiento_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id);
END;
$function$;
