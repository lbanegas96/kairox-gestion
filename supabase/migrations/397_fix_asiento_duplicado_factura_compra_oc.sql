-- Migration 397 -- Asiento duplicado en "Registrar Factura desde OC" (17/09/2026).
--
-- Hallazgo de Luciano probando en vivo una OC con 3 recepciones y 3 facturas
-- parciales en momentos distintos ("controlá la contabilidad y el stock"):
-- cada una de las 3 facturas terminó con DOS asientos confirmados en el
-- Libro Diario por el mismo importe, uno de ellos huérfano (sin
-- compras.asiento_id apuntándolo, pero igual sumando en el Balance de
-- Comprobación).
--
-- Causa raíz: `OrdenesCompraSection.jsx` ya generaba su propio asiento del
-- lado del cliente para esta factura, con `esCredito: true` fijo -- ese
-- SIEMPRE fue el único mecanismo que existía (comentario original: "mismo
-- patrón que Compra Rápida... esta factura SIEMPRE crea Open Item en CC").
-- La migración 396 (fix #1 de la Auditoría de Circuitos, "registrar_factura_
-- compra_oc nunca genera asiento") agregó una SEGUNDA generación atómica del
-- lado del servidor sin saber que ya existía esa del cliente -- duplicando
-- el asiento en cada factura por OC, y encima con la cuenta equivocada (la
-- del servidor evaluaba Caja/CxP según forma_pago, pero una Factura por OC
-- SIEMPRE carga a Cuenta Corriente del proveedor sin importar forma_pago --
-- el pago es un paso separado, mig.279).
--
-- Fix: `regenerar_asiento_compra` ahora trata como crédito (CxP) cualquier
-- compra con `orden_compra_id` -- no solo las de forma_pago='Cuenta
-- Corriente' -- para que el asiento generado del lado servidor por fin sea
-- el correcto. La otra mitad (sacar la llamada duplicada del cliente) va en
-- el mismo commit, en OrdenesCompraSection.jsx.

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
         c.orden_compra_id,
         COALESCE(c.numero_factura, 'S/N') AS numero_factura, c.fecha::date, c.asiento_id
    INTO v_compra
    FROM public.compras c
   WHERE c.id = p_compra_id;

  IF v_compra.empresa_id IS NULL THEN
    RAISE EXCEPTION 'Compra no encontrada';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_compra.empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: la compra no pertenece a esta empresa';
    END IF;
    IF NOT has_module_permission('compras') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
    END IF;
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

  -- Fix mig.397: una Factura por OC SIEMPRE carga a Cuenta Corriente del
  -- proveedor (registrar_factura_compra_oc inserta cuenta_corriente_
  -- proveedores sin condicionar por forma_pago) -- el pago es un paso
  -- separado (Registrar Pago), sin importar lo que diga forma_pago.
  v_es_credito := v_compra.forma_pago = 'Cuenta Corriente' OR v_compra.orden_compra_id IS NOT NULL;
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
    'Compra ' || v_compra.numero_factura,
    'confirmado', v_compra.total, v_compra.total, 'compra', p_compra_id
  ) RETURNING id INTO v_asiento_id;

  IF v_cta_iva IS NOT NULL AND COALESCE(v_compra.neto_gravado, 0) + COALESCE(v_compra.iva_discriminado, 0) > 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_compra.empresa_id, v_cta_mercaderias, 'Compra de mercadería (neto)', v_compra.neto_gravado, 0),
      (v_asiento_id, v_compra.empresa_id, v_cta_iva,         'IVA Crédito Fiscal', v_compra.iva_discriminado, 0),
      (v_asiento_id, v_compra.empresa_id, v_cta_pago,        'Pago por compra', 0, v_compra.total);
  ELSE
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_compra.empresa_id, v_cta_mercaderias, 'Compra de mercadería', v_compra.total, 0),
      (v_asiento_id, v_compra.empresa_id, v_cta_pago,        'Pago por compra', 0, v_compra.total);
  END IF;

  UPDATE public.compras SET asiento_id = v_asiento_id WHERE id = p_compra_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id);
END;
$function$;
