-- migration 281 — asiento_id en comprobantes/compras + regenerar_asiento_venta/compra
--
-- CONTEXTO: hallazgo de la auditoría contable completa (agente
-- sap-motor-contable-auditor, 2026-07-30). A diferencia de Cuenta Corriente
-- (mig.181/183: `cuenta_corriente_movimientos.asiento_id` + botón "Regenerar"
-- en CuentaCorrienteSection/ProveedoresSection), una Venta o Compra que
-- confirmó su documento pero cuyo asiento falló (período cerrado en su
-- momento, cuenta faltante, o el segundo request nunca llegó — el asiento se
-- dispara en una llamada aparte, no atómica con `crear_venta`/`registrar_
-- factura_compra_oc`) no tenía ninguna forma de detectarse ni de repararse
-- manualmente. Mismo patrón que mig.181, aplicado acá.
--
-- Alcance: solo agrega la columna + la RPC de regeneración. La UI para
-- disparar el botón se agrega en un cambio de frontend aparte (mismo commit).

-- ── 1. Columnas ────────────────────────────────────────────────────────────
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS asiento_id uuid REFERENCES public.asientos_contables(id) ON DELETE SET NULL;

ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS asiento_id uuid REFERENCES public.asientos_contables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comprobantes_asiento_id ON public.comprobantes(asiento_id);
CREATE INDEX IF NOT EXISTS idx_compras_asiento_id ON public.compras(asiento_id);

-- ── 2. regenerar_asiento_venta ───────────────────────────────────────────────
-- Recrea el asiento de una Factura/Venta con neto/IVA discriminado, mismo
-- criterio que `asientosAutoService.crearAsientoVenta` (planCuentasService.ts).
CREATE OR REPLACE FUNCTION public.regenerar_asiento_venta(
  p_comprobante_id uuid,
  p_user_id        uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp RECORD;
  v_cerrado boolean;
  v_cta_cobro uuid; v_cta_ventas uuid; v_cta_iva uuid;
  v_es_credito boolean;
  v_asiento_id uuid;
  v_fecha_dia date;
BEGIN
  SELECT c.empresa_id, c.total, c.neto_gravado, c.iva_discriminado, c.forma_pago,
         c.numero_venta, c.fecha::date, c.asiento_id, c.estado_pago, c.tipo
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

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (
    v_comp.empresa_id, p_user_id, next_numero_asiento(v_comp.empresa_id), v_fecha_dia,
    'Factura ' || v_comp.numero_venta || ' (regenerado)',
    'confirmado', v_comp.total, v_comp.total, 'venta', p_comprobante_id
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

  UPDATE public.comprobantes SET asiento_id = v_asiento_id WHERE id = p_comprobante_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.regenerar_asiento_venta(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerar_asiento_venta(uuid, uuid) TO authenticated;

-- ── 3. regenerar_asiento_compra ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.regenerar_asiento_compra(
  p_compra_id uuid,
  p_user_id   uuid
)
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

REVOKE ALL ON FUNCTION public.regenerar_asiento_compra(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerar_asiento_compra(uuid, uuid) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.regenerar_asiento_venta(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.regenerar_asiento_compra(uuid, uuid);
-- ALTER TABLE public.comprobantes DROP COLUMN IF EXISTS asiento_id;
-- ALTER TABLE public.compras DROP COLUMN IF EXISTS asiento_id;
