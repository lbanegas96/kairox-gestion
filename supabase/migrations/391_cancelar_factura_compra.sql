-- Migration 391 -- Fase 2 de PLAN_PARIDAD_COMPRAS.md, alcance CORREGIDO.
--
-- El hallazgo original ("Facturas de Compra sin editar+historial, a
-- diferencia de OC") comparaba contra el documento equivocado. OC es un
-- documento PRE-transaccional (como Cotización/Pedido) -- se edita mientras
-- no movió nada todavía. Una Factura (de Compra O de Venta) es POST-
-- transaccional: ya movió stock, Cuenta Corriente, caja y generó un asiento.
-- Confirmado en el propio código: NO existe ninguna RPC actualizar_venta/
-- actualizar_factura/actualizar_comprobante -- las Facturas de VENTA
-- TAMPOCO se editan por ítems una vez creadas. Construir un
-- "actualizar_factura_compra" con diffing de ítems, como se planeaba
-- originalmente, hubiera introducido una asimetría NUEVA (Compras editable,
-- Ventas no) y un riesgo contable real (reprocesar stock/costo/CxP/asiento
-- de un documento ya posteado sin la lógica de reversión correspondiente).
--
-- La comparación correcta es Factura de Compra vs Factura de VENTA. Ahí SÍ
-- hay una asimetría real: Ventas tiene `cancelar_factura` (mig.259, refinada
-- en 348/351/375) -- reversión completa de stock/CxC/caja/asiento. Compras
-- NO tiene ningún equivalente: `compras.estado_pago` ni siquiera admite
-- 'anulada' todavía (el frontend ya tiene el badge/color para ese estado en
-- ModalDetalleFacturaCompra.jsx y FacturasCompraSection.jsx, anticipando esta
-- función, pero nunca se construyó el lado que la setea). Esta migración
-- construye `cancelar_compra`, simétrica a `cancelar_factura`.
--
-- Historial de auditoría: `compras` ya tenía trg_audit_compras desde antes.
-- `detalle_compras` no tenía ningún trigger de auditoría -- se agrega acá
-- (mismo hallazgo que mig.322 tuvo con ordenes_compra_items) para que un
-- futuro historial visible en la UI (Fase 2, frontend) tenga de dónde leer,
-- aunque hoy los ítems no se editen -- sirve igual para auditar quién generó/
-- anuló la factura y cuándo, vía los propios INSERT/UPDATE de cabecera.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.cancelar_compra(uuid, uuid, uuid, text);
--   DROP TRIGGER IF EXISTS trg_audit_detalle_compras ON public.detalle_compras;
--   ALTER TABLE public.compras DROP CONSTRAINT IF EXISTS compras_estado_pago_check;
--   ALTER TABLE public.compras ADD CONSTRAINT compras_estado_pago_check
--     CHECK (estado_pago = ANY (ARRAY['pendiente','pagada','parcial']));

-- 1) 'anulada' como estado válido de compras.estado_pago.
ALTER TABLE public.compras DROP CONSTRAINT IF EXISTS compras_estado_pago_check;
ALTER TABLE public.compras ADD CONSTRAINT compras_estado_pago_check
  CHECK (estado_pago = ANY (ARRAY['pendiente'::text, 'pagada'::text, 'parcial'::text, 'anulada'::text]));

-- 2) Auditoría de ítems -- detalle_compras nunca tuvo trigger de auditoría.
DROP TRIGGER IF EXISTS trg_audit_detalle_compras ON public.detalle_compras;
CREATE TRIGGER trg_audit_detalle_compras
  AFTER INSERT OR UPDATE OR DELETE ON public.detalle_compras
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- 3) cancelar_compra -- simétrica a cancelar_factura (mig.375).
CREATE OR REPLACE FUNCTION public.cancelar_compra(
  p_empresa_id uuid,
  p_user_id    uuid,
  p_compra_id  uuid,
  p_motivo     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_compra            RECORD;
  v_item               RECORD;
  v_prov_nombre        TEXT;
  v_concepto_esperado  TEXT;
  v_cc_reversado       NUMERIC := 0;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;

  SELECT * INTO v_compra FROM public.compras
  WHERE id = p_compra_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura de compra no encontrada';
  END IF;

  IF v_compra.estado_pago = 'anulada' THEN
    RAISE EXCEPTION 'Esta factura ya está anulada';
  END IF;

  -- Open Item: si ya tiene pagos imputados, no se puede anular directo --
  -- mismo criterio que cancelar_factura con cuenta_corriente_imputaciones.
  IF EXISTS (
    SELECT 1 FROM public.cuenta_corriente_proveedores_imputaciones WHERE factura_compra_id = p_compra_id
  ) THEN
    RAISE EXCEPTION 'Esta factura ya tiene pagos imputados desde Cuenta Corriente — no se puede anular directamente. Generá una Nota de Crédito de Proveedor.';
  END IF;

  -- 1. Reversar stock -- solo ítems con producto de catálogo (los de
  --    servicio, sin producto_id, nunca tocaron inventario, Regla 8 SAP).
  FOR v_item IN
    SELECT * FROM public.detalle_compras
    WHERE compra_id = p_compra_id AND empresa_id = p_empresa_id AND producto_id IS NOT NULL
  LOOP
    UPDATE public.productos SET stock_actual = COALESCE(stock_actual, 0) - v_item.cantidad
    WHERE id = v_item.producto_id AND empresa_id = p_empresa_id;

    INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
    VALUES (p_empresa_id, p_empresa_id, v_item.producto_id, 'salida', v_item.cantidad,
            'Anulación de Factura ' || COALESCE(NULLIF(v_compra.numero_factura, ''), 'S/N'), now());
  END LOOP;

  -- 2. Revertir cantidad_facturada en la OC de origen, si esta factura vino
  --    de "Registrar Factura desde OC" (mig.332).
  IF v_compra.orden_compra_id IS NOT NULL THEN
    FOR v_item IN
      SELECT producto_id, cantidad FROM public.detalle_compras
      WHERE compra_id = p_compra_id AND empresa_id = p_empresa_id AND producto_id IS NOT NULL
    LOOP
      UPDATE public.ordenes_compra_items
      SET cantidad_facturada = GREATEST(0, COALESCE(cantidad_facturada, 0) - v_item.cantidad)
      WHERE orden_id = v_compra.orden_compra_id AND producto_id = v_item.producto_id AND empresa_id = p_empresa_id;
    END LOOP;
  END IF;

  -- 3. Reversar movimientos_caja (solo si se pagó en Efectivo al crearla) --
  --    best-effort por concepto+monto exactos: movimientos_caja no tiene
  --    columna compra_id (comprobante_id es FK estricta a `comprobantes`,
  --    de Ventas, no sirve acá) -- mismo tipo de fallback que ya usa
  --    cancelar_factura para sus filas legacy sin comprobante_id. Documento
  --    de reversa (ingreso especular), nunca se borra el egreso original.
  IF v_compra.proveedor_id IS NOT NULL THEN
    SELECT nombre INTO v_prov_nombre FROM public.proveedores WHERE id = v_compra.proveedor_id;
  END IF;
  v_concepto_esperado := 'Factura proveedor ' || COALESCE(NULLIF(v_compra.numero_factura, ''), 'S/N')
                         || ' — ' || COALESCE(v_prov_nombre, 'Proveedor');

  IF v_compra.forma_pago = 'Efectivo' THEN
    INSERT INTO public.movimientos_caja (
      empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, is_automatic, fecha
    )
    SELECT mc.empresa_id, auth.uid(), mc.caja_sesion_id, 'ingreso', 'Compra',
           'Anulación ' || mc.concepto, mc.monto, mc.metodo_pago, true, now()
    FROM public.movimientos_caja mc
    WHERE mc.empresa_id = p_empresa_id
      AND mc.tipo = 'egreso'
      AND mc.concepto = v_concepto_esperado
      AND mc.monto = v_compra.total
    LIMIT 1;
  END IF;

  -- 4. Reversar Cuenta Corriente del proveedor -- tipo='nota_credito' reduce
  --    la deuda (mismo vocabulario/criterio que crear_nota_credito_proveedor,
  --    mig.332). Solo reversa lo que realmente se cargó como 'compra' contra
  --    esta factura -- nunca asume que fue el 100% del total (por si en el
  --    futuro se admite CC parcial acá también, mismo criterio que mig.375
  --    aplicó del lado ventas).
  IF v_compra.proveedor_id IS NOT NULL THEN
    SELECT COALESCE(SUM(monto), 0) INTO v_cc_reversado
    FROM public.cuenta_corriente_proveedores
    WHERE referencia_id = p_compra_id AND tipo = 'compra' AND empresa_id = p_empresa_id;

    IF v_cc_reversado > 0 THEN
      INSERT INTO public.cuenta_corriente_proveedores (
        empresa_id, user_id, proveedor_id, tipo, monto, descripcion, referencia_id, referencia_tipo, fecha
      ) VALUES (
        p_empresa_id, p_user_id, v_compra.proveedor_id, 'nota_credito', v_cc_reversado,
        'Anulación Factura ' || COALESCE(NULLIF(v_compra.numero_factura, ''), 'S/N') || COALESCE(' — ' || NULLIF(p_motivo, ''), ''),
        p_compra_id, 'anulacion_compra', now()
      );
    END IF;
  END IF;

  -- 5. Estado final.
  UPDATE public.compras SET estado_pago = 'anulada' WHERE id = p_compra_id AND empresa_id = p_empresa_id;

  RETURN jsonb_build_object(
    'compra_id', p_compra_id,
    'numero_factura', v_compra.numero_factura,
    'total', v_compra.total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancelar_compra(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_compra(uuid, uuid, uuid, text) TO authenticated;
