-- migration 279 — Factura de Proveedor del flujo OC → Recepción → Factura
--
-- CONTEXTO: encontrado en el stress-test de Compras pedido esta noche. El
-- "3-way match" (Órdenes de Compra → registrar factura) escribía en
-- `facturas_proveedor` (mig.012) — una tabla que NUNCA se conectó al resto
-- de la contabilidad: no genera movimiento en `cuenta_corriente_proveedores`
-- (la deuda real al proveedor no aparece en su Cuenta Corriente), no la lee
-- `ReporteLibroIVACompras.jsx` (el crédito fiscal de esa factura no se
-- computa), y "Marcar pagada" solo cambiaba un estado sin mover un peso de
-- Caja/Bancos. Verificado antes de escribir esto: `facturas_proveedor` tiene
-- CERO filas en producción — nadie usó el flujo todavía, no hay datos reales
-- que migrar ni que se rompan.
--
-- La app ya tiene el patrón correcto para "factura de proveedor con ítems +
-- IVA real" en `compras`/`detalle_compras` (usado por Compra Rápida y por
-- NuevaFacturaProveedorModal — este último SÍ discrimina IVA por ítem). Esta
-- migración lleva la Factura del flujo OC a ESE mismo lugar, para heredar
-- gratis: Cuenta Corriente Proveedores, Libro IVA Compras, y compatibilidad
-- con Cancelación/NC/ND de Proveedor (que ya usan `compra_id`).
--
-- Alcance deliberadamente acotado (pedido explícito: no engordar esto) — NO
-- se toca hoy: Compra Rápida (IVA fijo 21%, tema aparte) ni
-- NuevaFacturaProveedorModal (falta el asiento contable, tema aparte).
--
-- Diferencia clave con Compra Rápida / NuevaFacturaProveedorModal: acá NO se
-- toca stock ni costo de producto. El stock físico YA se movió en
-- `crear_recepcion` (evento físico, Regla 8 SAP) cuando se recibió la OC —
-- esta Factura es el cierre FINANCIERO de algo que ya ingresó a depósito.
-- Volver a llamar `aplicar_compra_producto` acá duplicaría el stock.
--
-- Convención de precio: costo_unitario es NETO (sin IVA), el IVA se suma
-- aparte por ítem — mismo criterio que NuevaFacturaProveedorModal.jsx
-- (`calcNeto` = cantidad×precio, `totalIva` = neto×alícuota/100). Distinto
-- del criterio "precio final IVA incluido" de mig.276/277 (ND/NC de
-- Proveedor) — ahí el precio SÍ viene con IVA adentro porque replica lo que
-- el proveedor factura como total de línea. Acá el usuario tipea el neto
-- directo desde la factura en papel, que es como ya lo hace
-- NuevaFacturaProveedorModal para mantener un solo criterio en "factura de
-- proveedor con ítems".

-- ── 1. Vínculo compras → orden_compra (para no duplicar factura ni para
--       que ModalDetalleOC pueda encontrar "la" factura de su OC) ──────────
ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS orden_compra_id uuid REFERENCES public.ordenes_compra(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_compras_orden_compra_id_unico
  ON public.compras (orden_compra_id)
  WHERE orden_compra_id IS NOT NULL;

COMMENT ON COLUMN public.compras.orden_compra_id IS
  'Solo se setea cuando esta compra nace de "Registrar Factura" en el flujo OC → Recepción → Factura (mig.279). NULL para Compra Rápida y Facturas de Compra manuales.';

-- ── 2. RPC atómica ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_factura_compra_oc(
  p_empresa_id       uuid,
  p_user_id          uuid,
  p_orden_compra_id  uuid,
  p_numero_factura   text,
  p_fecha_factura    date,
  p_items            jsonb  -- [{producto_id, cantidad, costo_unitario_neto, alicuota_iva}]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_oc RECORD;
  v_compra_id UUID;
  v_cc_id UUID;
  v_item JSONB;
  v_cantidad NUMERIC;
  v_precio NUMERIC;
  v_alicuota NUMERIC;
  v_neto_item NUMERIC;
  v_subtotal_neto NUMERIC := 0;
  v_total_iva NUMERIC := 0;
  v_total NUMERIC;
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

  IF v_oc.estado NOT IN ('recibida', 'recibida_parcial') THEN
    RAISE EXCEPTION 'La OC debe tener al menos una recepción antes de registrar la factura (estado actual: %)', v_oc.estado;
  END IF;

  IF EXISTS (SELECT 1 FROM public.compras WHERE orden_compra_id = p_orden_compra_id) THEN
    RAISE EXCEPTION 'Esta OC ya tiene una factura registrada';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La factura debe tener al menos un ítem';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'costo_unitario_neto')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_neto_item := v_cantidad * v_precio;
    v_subtotal_neto := v_subtotal_neto + v_neto_item;
    v_total_iva      := v_total_iva + (v_neto_item * v_alicuota / 100);
  END LOOP;
  v_total := v_subtotal_neto + v_total_iva;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total de la factura debe ser mayor a cero'; END IF;

  INSERT INTO public.compras (
    empresa_id, user_id, proveedor_id, numero_factura, fecha, orden_compra_id,
    forma_pago, estado_pago, total, neto_gravado, iva_discriminado, moneda, tipo_cambio_tasa
  ) VALUES (
    p_empresa_id, p_user_id, v_oc.proveedor_id, p_numero_factura, p_fecha_factura, p_orden_compra_id,
    v_oc.forma_pago, 'pendiente', v_total, v_subtotal_neto, v_total_iva, 'ARS', 1
  ) RETURNING id INTO v_compra_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'costo_unitario_neto')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    INSERT INTO public.detalle_compras (
      compra_id, empresa_id, producto_id, cantidad, costo_unitario, subtotal, alicuota_iva
    ) VALUES (
      v_compra_id, p_empresa_id, NULLIF(v_item->>'producto_id', '')::UUID,
      v_cantidad, v_precio, v_cantidad * v_precio, v_alicuota::TEXT
    );
  END LOOP;

  -- Open Item: la factura SIEMPRE crea la deuda en Cuenta Corriente. El pago
  -- (inmediato o después) es un evento separado — se salda desde Cuenta
  -- Corriente Proveedores con `registrar_pago_proveedor`, que ya existe y ya
  -- mueve Caja/Bancos y genera su propio asiento. Evita reimplementar acá el
  -- manejo de caja_sesion_id que este diálogo no tiene contexto para hacer bien.
  INSERT INTO public.cuenta_corriente_proveedores (
    empresa_id, user_id, proveedor_id, tipo, monto, descripcion,
    referencia_id, referencia_tipo, fecha
  ) VALUES (
    p_empresa_id, p_user_id, v_oc.proveedor_id, 'compra', v_total,
    'Factura ' || COALESCE(NULLIF(p_numero_factura, ''), 'S/N') || ' — OC ' || v_oc.numero,
    v_compra_id, 'compra_oc', p_fecha_factura
  ) RETURNING id INTO v_cc_id;

  RETURN jsonb_build_object(
    'compra_id', v_compra_id,
    'total', v_total,
    'neto_gravado', v_subtotal_neto,
    'iva_discriminado', v_total_iva,
    'cc_movimiento_id', v_cc_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_factura_compra_oc(uuid, uuid, uuid, text, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_factura_compra_oc(uuid, uuid, uuid, text, date, jsonb) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.registrar_factura_compra_oc(uuid, uuid, uuid, text, date, jsonb);
-- DROP INDEX IF EXISTS public.idx_compras_orden_compra_id_unico;
-- ALTER TABLE public.compras DROP COLUMN IF EXISTS orden_compra_id;
