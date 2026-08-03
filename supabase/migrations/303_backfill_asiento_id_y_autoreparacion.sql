-- mig.303 — 136 asientos reales sin vincular a su venta/compra (deuda histórica de mig.281)
--          + blindaje autoreparador en regenerar_asiento_venta/compra
--
-- HALLAZGO (barrido de sanidad, 2026-08-03): la mig.281 (2026-07-30 18:54) agregó
-- la columna comprobantes.asiento_id/compras.asiento_id y el código que la
-- escribe (planCuentasService.ts, crearAsientoVenta/crearAsientoCompra), pero
-- NUNCA corrió un backfill para los asientos que ya existían de antes. Verificado
-- con precisión: 100% de los comprobantes/compras con asiento ANTERIORES al
-- 2026-07-30 tienen el vínculo roto (124 de 125 comprobantes, 12 de 12 compras);
-- 100% de los POSTERIORES están bien. No es un bug activo — el código actual
-- funciona correctamente para todo lo nuevo. Es deuda histórica sin backfillear.
--
-- POR QUÉ IMPORTA: el botón "Regenerar asiento" (CompraDetailModal /
-- FacturaDetailModal) sólo mira `compras.asiento_id`/`comprobantes.asiento_id`
-- para decidir si mostrarse. Para cualquiera de estos 136 registros viejos, el
-- botón aparece diciendo "no tiene asiento contable" cuando en realidad SÍ
-- tiene uno real, correcto y confirmado. Si alguien lo clickeaba, las RPCs
-- `regenerar_asiento_venta`/`regenerar_asiento_compra` sólo comprobaban esa
-- misma columna rota antes de insertar — habrían creado un SEGUNDO asiento real,
-- duplicando el impacto contable de esa venta/compra. Verificado antes de tocar
-- nada: 0 duplicados existen hoy (cada comprobante/compra tiene a lo sumo un
-- asiento vía origen_id) — el riesgo estaba armado pero no se había disparado.
--
-- FIX EN DOS PARTES:

-- 1) Backfill — reconectar los 136 vínculos rotos. Seguro: ya se verificó que la
--    relación origen_id es 1 a 1 (sin ambigüedad, sin duplicados existentes).
UPDATE public.comprobantes c
SET asiento_id = a.id
FROM public.asientos_contables a
WHERE a.origen IN ('venta', 'factura')
  AND a.origen_id = c.id
  AND c.asiento_id IS NULL;

UPDATE public.compras c
SET asiento_id = a.id
FROM public.asientos_contables a
WHERE a.origen = 'compra'
  AND a.origen_id = c.id
  AND c.asiento_id IS NULL;

-- 2) Blindaje autoreparador — para que este riesgo no pueda repetirse aunque en
--    el futuro el UPDATE de vinculación vuelva a fallar por el motivo que sea
--    (red cortada, tab cerrada a mitad de camino, etc.). Antes de insertar un
--    asiento nuevo, ahora se busca primero si YA existe uno real por origen_id
--    — si existe, sólo se reconecta el vínculo (autoreparación), nunca se
--    duplica. El guard original (`asiento_id IS NOT NULL` → excepción) se
--    mantiene intacto arriba de este chequeo nuevo.

CREATE OR REPLACE FUNCTION public.regenerar_asiento_venta(p_comprobante_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp RECORD;
  v_cerrado boolean;
  v_cta_cobro uuid; v_cta_ventas uuid; v_cta_iva uuid;
  v_cta_costo uuid; v_cta_inventario uuid;
  v_es_credito boolean;
  v_asiento_id uuid;
  v_fecha_dia date;
  v_total_debe numeric; v_total_haber numeric;
BEGIN
  SELECT c.empresa_id, c.total, c.neto_gravado, c.iva_discriminado, c.forma_pago,
         c.numero_venta, c.fecha::date, c.asiento_id, c.estado_pago, c.tipo, c.costo_mercaderia_vendida
    INTO v_comp
    FROM public.comprobantes c
   WHERE c.id = p_comprobante_id;

  IF v_comp.empresa_id IS NULL THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;
  IF v_comp.empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el comprobante no pertenece a esta empresa';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF v_comp.tipo NOT IN ('venta') THEN
    RAISE EXCEPTION 'Solo se puede regenerar el asiento de una Venta/Factura (usá el flujo de NC/ND para esos documentos)';
  END IF;
  IF v_comp.asiento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este comprobante ya tiene un asiento contable generado';
  END IF;
  IF v_comp.estado_pago = 'cancelada' THEN
    RAISE EXCEPTION 'Este comprobante está cancelado — no aplica generar asiento';
  END IF;

  -- Autoreparación (mig.303): si ya existe un asiento real para este
  -- comprobante (detectado por origen_id) pero el vínculo nunca se guardó
  -- (mismo blindspot que dejó mig.281 sin backfillear), reconectar en vez de
  -- duplicar.
  SELECT id INTO v_asiento_id
    FROM public.asientos_contables
   WHERE origen = 'venta' AND origen_id = p_comprobante_id
   LIMIT 1;
  IF v_asiento_id IS NOT NULL THEN
    UPDATE public.comprobantes SET asiento_id = v_asiento_id WHERE id = p_comprobante_id;
    RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id, 'reconectado', true);
  END IF;

  v_fecha_dia := v_comp.fecha;
  SELECT fecha_en_periodo_cerrado(v_comp.empresa_id, v_fecha_dia) INTO v_cerrado;
  IF COALESCE(v_cerrado, false) THEN
    RAISE EXCEPTION 'El período de esta venta (%) está cerrado — reabrilo en Plan de Cuentas antes de regenerar el asiento', v_fecha_dia;
  END IF;

  v_es_credito := v_comp.forma_pago = 'Cuenta Corriente';
  SELECT id INTO v_cta_cobro  FROM public.plan_cuentas WHERE empresa_id = v_comp.empresa_id AND codigo = (CASE WHEN v_es_credito THEN '1.1.2' ELSE '1.1.1' END) AND activa LIMIT 1;
  SELECT id INTO v_cta_ventas FROM public.plan_cuentas WHERE empresa_id = v_comp.empresa_id AND codigo = '4.1' AND activa LIMIT 1;
  SELECT id INTO v_cta_iva    FROM public.plan_cuentas WHERE empresa_id = v_comp.empresa_id AND codigo = '2.1.3' AND activa LIMIT 1;
  IF v_cta_cobro IS NULL OR v_cta_ventas IS NULL THEN
    RAISE EXCEPTION 'Falta configurar las cuentas contables de Cobro o Ventas en Plan de Cuentas';
  END IF;

  IF COALESCE(v_comp.costo_mercaderia_vendida, 0) > 0 THEN
    SELECT id INTO v_cta_costo      FROM public.plan_cuentas WHERE empresa_id = v_comp.empresa_id AND codigo = '5.1' AND activa LIMIT 1;
    SELECT id INTO v_cta_inventario FROM public.plan_cuentas WHERE empresa_id = v_comp.empresa_id AND codigo = '1.1.3' AND activa LIMIT 1;
  END IF;

  v_total_debe := v_comp.total;
  v_total_haber := v_comp.total;
  IF v_cta_costo IS NOT NULL AND v_cta_inventario IS NOT NULL THEN
    v_total_debe := v_total_debe + v_comp.costo_mercaderia_vendida;
    v_total_haber := v_total_haber + v_comp.costo_mercaderia_vendida;
  END IF;

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (
    v_comp.empresa_id, p_user_id, next_numero_asiento(v_comp.empresa_id), v_fecha_dia,
    'Factura ' || v_comp.numero_venta || ' (regenerado)',
    'confirmado', v_total_debe, v_total_haber, 'venta', p_comprobante_id
  ) RETURNING id INTO v_asiento_id;

  IF v_cta_iva IS NOT NULL AND COALESCE(v_comp.neto_gravado, 0) + COALESCE(v_comp.iva_discriminado, 0) > 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_comp.empresa_id, v_cta_cobro,  'Cobro por venta (regenerado)', v_comp.total, 0),
      (v_asiento_id, v_comp.empresa_id, v_cta_ventas, 'Ingreso por venta (neto, regenerado)', 0, v_comp.neto_gravado),
      (v_asiento_id, v_comp.empresa_id, v_cta_iva,    'IVA Débito Fiscal (regenerado)', 0, v_comp.iva_discriminado);
  ELSE
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_comp.empresa_id, v_cta_cobro,  'Cobro por venta (regenerado)', v_comp.total, 0),
      (v_asiento_id, v_comp.empresa_id, v_cta_ventas, 'Ingreso por venta (regenerado)', 0, v_comp.total);
  END IF;

  IF v_cta_costo IS NOT NULL AND v_cta_inventario IS NOT NULL THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_comp.empresa_id, v_cta_costo,      'Costo de mercadería vendida (regenerado)', v_comp.costo_mercaderia_vendida, 0),
      (v_asiento_id, v_comp.empresa_id, v_cta_inventario, 'Salida de mercadería por venta (regenerado)', 0, v_comp.costo_mercaderia_vendida);
  END IF;

  UPDATE public.comprobantes SET asiento_id = v_asiento_id WHERE id = p_comprobante_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.regenerar_asiento_compra(p_compra_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_compra RECORD;
  v_cerrado boolean;
  v_cta_pago uuid; v_cta_mercaderias uuid; v_cta_iva uuid;
  v_es_credito boolean;
  v_asiento_id uuid;
  v_fecha_dia date;
BEGIN
  SELECT c.empresa_id, c.total, c.neto_gravado, c.iva_discriminado, c.forma_pago,
         COALESCE(c.numero_factura, 'S/N') AS numero_factura, c.fecha::date, c.asiento_id
    INTO v_compra
    FROM public.compras c
   WHERE c.id = p_compra_id;

  IF v_compra.empresa_id IS NULL THEN
    RAISE EXCEPTION 'Compra no encontrada';
  END IF;
  IF v_compra.empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: la compra no pertenece a esta empresa';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;
  IF v_compra.asiento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta compra ya tiene un asiento contable generado';
  END IF;

  -- Autoreparación (mig.303): mismo criterio que regenerar_asiento_venta.
  SELECT id INTO v_asiento_id
    FROM public.asientos_contables
   WHERE origen = 'compra' AND origen_id = p_compra_id
   LIMIT 1;
  IF v_asiento_id IS NOT NULL THEN
    UPDATE public.compras SET asiento_id = v_asiento_id WHERE id = p_compra_id;
    RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id, 'reconectado', true);
  END IF;

  v_fecha_dia := v_compra.fecha;
  SELECT fecha_en_periodo_cerrado(v_compra.empresa_id, v_fecha_dia) INTO v_cerrado;
  IF COALESCE(v_cerrado, false) THEN
    RAISE EXCEPTION 'El período de esta compra (%) está cerrado — reabrilo en Plan de Cuentas antes de regenerar el asiento', v_fecha_dia;
  END IF;

  v_es_credito := v_compra.forma_pago = 'Cuenta Corriente';
  SELECT id INTO v_cta_pago        FROM public.plan_cuentas WHERE empresa_id = v_compra.empresa_id AND codigo = (CASE WHEN v_es_credito THEN '2.1.1' ELSE '1.1.1' END) AND activa LIMIT 1;
  SELECT id INTO v_cta_mercaderias FROM public.plan_cuentas WHERE empresa_id = v_compra.empresa_id AND codigo = '1.1.3' AND activa LIMIT 1;
  SELECT id INTO v_cta_iva         FROM public.plan_cuentas WHERE empresa_id = v_compra.empresa_id AND codigo = '1.1.4' AND activa LIMIT 1;
  IF v_cta_pago IS NULL OR v_cta_mercaderias IS NULL THEN
    RAISE EXCEPTION 'Falta configurar las cuentas contables de Pago o Mercaderías en Plan de Cuentas';
  END IF;

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (
    v_compra.empresa_id, p_user_id, next_numero_asiento(v_compra.empresa_id), v_fecha_dia,
    'Compra ' || v_compra.numero_factura || ' (regenerado)',
    'confirmado', v_compra.total, v_compra.total, 'compra', p_compra_id
  ) RETURNING id INTO v_asiento_id;

  IF v_cta_iva IS NOT NULL AND COALESCE(v_compra.neto_gravado, 0) + COALESCE(v_compra.iva_discriminado, 0) > 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_compra.empresa_id, v_cta_mercaderias, 'Compra de mercadería (neto, regenerado)', v_compra.neto_gravado, 0),
      (v_asiento_id, v_compra.empresa_id, v_cta_iva,         'IVA Crédito Fiscal (regenerado)', v_compra.iva_discriminado, 0),
      (v_asiento_id, v_compra.empresa_id, v_cta_pago,        'Pago por compra (regenerado)', 0, v_compra.total);
  ELSE
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_compra.empresa_id, v_cta_mercaderias, 'Compra de mercadería (regenerado)', v_compra.total, 0),
      (v_asiento_id, v_compra.empresa_id, v_cta_pago,        'Pago por compra (regenerado)', 0, v_compra.total);
  END IF;

  UPDATE public.compras SET asiento_id = v_asiento_id WHERE id = p_compra_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id);
END;
$function$;
