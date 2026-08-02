-- migration 297 — QR MercadoPago en el POS (Fase 1: backend)
--
-- Último ítem del roadmap del POS (tanda 2): cobrar con QR dinámico de
-- MercadoPago/MODO. La infraestructura MP existente (mp-sync, mp-webhook) es
-- PURA CONCILIACIÓN — sincroniza pagos ya hechos hacia movimientos_bancarios,
-- no genera cobros nuevos. Se reusa de ahí: lectura del Access Token desde
-- Vault, validación HMAC del webhook, y el patrón "crear ya en pendiente,
-- confirmar después vía cola" que ya usa AFIP (facturas_pendientes_arca +
-- arca-worker).
--
-- DECISIÓN: la venta se crea en estado_pago='pendiente' apenas se genera el
-- QR (mismo momento que hoy se descuenta el stock para Cuenta Corriente) y se
-- confirma cuando llega el webhook de MP.
--
-- POR QUÉ 3 RPCs NUEVAS EN VEZ DE TOCAR crear_venta:
-- 1. crear_venta (mig.287) inserta en movimientos_caja para CUALQUIER método
--    salvo el string exacto 'Cuenta Corriente' — un QR pendiente insertaría
--    el ingreso en caja antes de que llegue el pago.
-- 2. El asiento contable (crearAsientoVenta, planCuentasService.ts:304)
--    postea DEBE 1.1.1 Caja y Bancos salvo esCredito=true — mismo problema.
-- 3. NO HAY PRECEDENTE de generar un asiento fuera del JS del frontend.
--    crearAsientoVenta depende indirectamente de auth.uid() (vía
--    get_my_empresa_id() en fecha_en_periodo_cerrado) — llamado desde una
--    Edge Function con service_role (sin sesión), ese guard fallaría
--    silenciosamente. El asiento de la confirmación por webhook se genera acá
--    en SQL puro, replicando el patrón de regenerar_asiento_venta (mig.281/287,
--    que YA hace exactamente esto sin depender de auth.uid() más allá del
--    guard de autorización, que acá se reemplaza por confiar en p_empresa_id
--    porque el caller es service_role, no un usuario).
--
-- Mismo patrón ya establecido en el repo (registrar_cobro_cliente,
-- cancelar_factura: RPCs dedicadas por flujo, no generalizar el RPC más
-- crítico) — crear_venta queda completamente intacto.

-- ── 1. Tabla de cola: qr_pagos_mp (calco de facturas_pendientes_arca) ───────
CREATE TABLE public.qr_pagos_mp (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  comprobante_id     UUID NOT NULL REFERENCES public.comprobantes(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL,
  caja_sesion_id     UUID REFERENCES public.caja_sesiones(id) ON DELETE SET NULL,
  external_reference TEXT NOT NULL,
  in_store_order_id  TEXT,
  qr_data            TEXT,
  monto              NUMERIC(12,2) NOT NULL,
  estado             TEXT NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente','pagado','expirado','cancelado')),
  payment_id         TEXT,
  expiracion         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_qr_pagos_mp_external_ref ON public.qr_pagos_mp (external_reference);
CREATE INDEX idx_qr_pagos_mp_empresa_estado ON public.qr_pagos_mp (empresa_id, estado);
-- A lo sumo una QR pendiente activa por venta.
CREATE UNIQUE INDEX idx_qr_pagos_mp_una_pendiente ON public.qr_pagos_mp (comprobante_id) WHERE estado = 'pendiente';

ALTER TABLE public.qr_pagos_mp ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_qr_pagos_mp ON public.qr_pagos_mp
  USING (empresa_id = get_my_empresa_id());

-- ── 2. crear_venta_pendiente_qr ──────────────────────────────────────────────
-- Copia acotada del bloque de crear_venta que arma comprobantes+
-- comprobante_items+entrega implícita+stock — SIN loop de pagos, SIN
-- cuenta_corriente_movimientos, SIN encolar AFIP todavía (recién al confirmar
-- el pago). SIN soporte de pedido_id (las ventas QR del POS son standalone,
-- igual que cualquier venta de mostrador).
--
-- El total se calcula 100% server-side sumando los ítems — a diferencia de
-- crear_venta (que confía en p_total del cliente, aceptable porque el cajero
-- confirma visualmente el monto en el momento) acá el monto determina cuánto
-- se le pide al cliente vía un procesador externo sin supervisión humana en
-- el momento del cobro, así que no se confía en un total mandado por el cliente.
CREATE FUNCTION public.crear_venta_pendiente_qr(
  p_empresa_id       uuid,
  p_user_id          uuid,
  p_cliente_id       uuid,
  p_cliente_nombre   text,
  p_items            jsonb,
  p_punto_venta_id   uuid DEFAULT NULL::uuid,
  p_tipo_comprobante_afip text DEFAULT NULL::text,
  p_caja_sesion_id   uuid DEFAULT NULL::uuid,
  p_centro_costo_id  uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comprobante_id UUID; v_item JSONB; v_numero_venta TEXT;
  v_producto_id UUID; v_cantidad INTEGER; v_stock_actual INTEGER;
  v_precio_unitario NUMERIC; v_subtotal NUMERIC; v_alicuota TEXT; v_factor NUMERIC;
  v_neto_total NUMERIC := 0; v_iva_total NUMERIC := 0; v_bruto_total NUMERIC := 0;
  v_costo_unitario NUMERIC; v_costo_total NUMERIC := 0;
  v_entrega_id UUID; v_numero_entrega TEXT;
  v_usa_cc BOOLEAN; v_external_reference TEXT;
  v_fecha TIMESTAMPTZ := now();
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF p_centro_costo_id IS NOT NULL THEN
    SELECT usa_centros_costo INTO v_usa_cc FROM public.empresas WHERE id = p_empresa_id;
    IF NOT COALESCE(v_usa_cc, false) THEN
      RAISE EXCEPTION 'Centros de Costo no está activado para esta empresa.';
    END IF;
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un ítem';
  END IF;

  -- Total server-side (ver comentario arriba) — misma fórmula neto/iva que
  -- crear_venta, sumando bruto por ítem.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_subtotal := ROUND((v_item->>'subtotal')::NUMERIC, 2);
    v_bruto_total := v_bruto_total + v_subtotal;
  END LOOP;
  IF v_bruto_total <= 0 THEN
    RAISE EXCEPTION 'El total de la venta debe ser mayor a cero';
  END IF;

  v_numero_venta := public.obtener_proximo_numero(p_empresa_id, 'venta', p_punto_venta_id);

  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total,
    forma_pago, estado_pago, moneda, tipo_cambio_tasa, tipo,
    punto_venta_id, tipo_comprobante_afip, centro_costo_id
  ) VALUES (
    p_empresa_id, p_empresa_id, v_numero_venta, v_fecha, p_cliente_id,
    COALESCE(p_cliente_nombre, 'Consumidor Final'), ROUND(v_bruto_total, 2),
    'QR MercadoPago', 'pendiente', 'ARS', 1, 'venta',
    p_punto_venta_id, p_tipo_comprobante_afip, p_centro_costo_id
  )
  RETURNING id INTO v_comprobante_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id     := (v_item->>'producto_id')::UUID;
    v_cantidad        := (v_item->>'cantidad')::INTEGER;
    v_subtotal        := ROUND((v_item->>'subtotal')::NUMERIC, 2);
    v_alicuota        := COALESCE(v_item->>'alicuota_iva', '21');
    v_precio_unitario := ROUND((v_item->>'precio_unitario')::NUMERIC, 2);

    SELECT stock_actual, costo_compra INTO v_stock_actual, v_costo_unitario
    FROM public.productos WHERE id = v_producto_id AND empresa_id = p_empresa_id FOR UPDATE;
    IF v_stock_actual IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id;
    END IF;
    IF v_stock_actual < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para producto % (disponible: %, requerido: %)', v_producto_id, v_stock_actual, v_cantidad;
    END IF;
    UPDATE public.productos SET stock_actual = stock_actual - v_cantidad WHERE id = v_producto_id;
    v_costo_total := v_costo_total + (COALESCE(v_costo_unitario, 0) * v_cantidad);

    v_factor := CASE v_alicuota WHEN '21' THEN 1.21 WHEN '10.5' THEN 1.105 ELSE 1 END;
    v_neto_total := v_neto_total + (v_subtotal / v_factor);
    v_iva_total  := v_iva_total  + (v_subtotal - (v_subtotal / v_factor));

    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal,
      alicuota_iva, costo_unitario, cantidad_entregada
    ) VALUES (
      v_comprobante_id, p_empresa_id, v_producto_id, v_cantidad, v_precio_unitario, v_subtotal,
      v_alicuota, v_costo_unitario, v_cantidad
    );

    INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
    VALUES (p_empresa_id, p_empresa_id, v_producto_id, 'salida', v_cantidad, 'Venta #' || v_numero_venta, v_fecha);
  END LOOP;

  UPDATE public.comprobantes SET
    neto_gravado = ROUND(v_neto_total, 2),
    iva_discriminado = ROUND(v_iva_total, 2),
    costo_mercaderia_vendida = ROUND(v_costo_total, 2)
  WHERE id = v_comprobante_id;

  -- Entrega implícita — mismo patrón que crear_venta (POS sin pedido detrás).
  v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
  INSERT INTO public.entregas (empresa_id, user_id, numero_entrega, comprobante_id, cliente_id, origen, estado, fecha)
  VALUES (p_empresa_id, p_user_id, v_numero_entrega, v_comprobante_id, p_cliente_id, 'implicita', 'entregado', CURRENT_DATE)
  RETURNING id INTO v_entrega_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.entrega_items (entrega_id, empresa_id, producto_id, cantidad)
    VALUES (v_entrega_id, p_empresa_id, (v_item->>'producto_id')::UUID, (v_item->>'cantidad')::INTEGER);
  END LOOP;

  v_external_reference := 'KAIROX-' || p_empresa_id::text || '-QR-' || gen_random_uuid()::text;
  INSERT INTO public.qr_pagos_mp (
    empresa_id, comprobante_id, user_id, caja_sesion_id, external_reference, monto, expiracion
  ) VALUES (
    p_empresa_id, v_comprobante_id, p_user_id, p_caja_sesion_id, v_external_reference,
    ROUND(v_bruto_total, 2), now() + interval '10 minutes'
  );

  RETURN jsonb_build_object(
    'comprobante_id', v_comprobante_id,
    'numero_venta', v_numero_venta,
    'total', ROUND(v_bruto_total, 2),
    'external_reference', v_external_reference
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_venta_pendiente_qr(uuid, uuid, uuid, text, jsonb, uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_venta_pendiente_qr(uuid, uuid, uuid, text, jsonb, uuid, text, uuid, uuid) TO authenticated;

-- ── 3. confirmar_pago_qr — llamada SOLO por mp-webhook con service_role ─────
-- Sin sesión de usuario: NO usa get_my_empresa_id(), confía en p_empresa_id
-- directo del caller. GRANT exclusivo a service_role — nadie con el JWT de
-- un usuario normal puede confirmar un pago propio sin pasar por la
-- validación de firma HMAC del webhook (eso vive en mp-webhook, no acá).
--
-- Race-safe / idempotente: lockea qr_pagos_mp FOR UPDATE y sale sin hacer
-- nada si el estado ya no es 'pendiente' (webhook duplicado, o ya cancelado).
--
-- El asiento contable se genera en SQL puro acá, replicando exactamente
-- regenerar_asiento_venta (mig.281/287): DEBE 1.1.1 Caja y Bancos (QR nunca
-- es a crédito, nunca usa el puente 1.1.8 de tarjetas — se acredita directo)
-- / HABER 4.1 Ventas (neto) + 2.1.3 IVA Débito Fiscal / + COGS DEBE 5.1
-- HABER 1.1.3 si costo_mercaderia_vendida>0. Resolución de cuentas por
-- código, permisivo (si falta una cuenta, se omite esa línea sin bloquear).
CREATE FUNCTION public.confirmar_pago_qr(
  p_empresa_id         uuid,
  p_external_reference text,
  p_payment_id         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_qr RECORD; v_comp RECORD;
  v_cta_cobro uuid; v_cta_ventas uuid; v_cta_iva uuid;
  v_cta_costo uuid; v_cta_inventario uuid;
  v_asiento_id uuid; v_total_debe numeric; v_total_haber numeric;
  v_forma_pago_id uuid;
BEGIN
  SELECT * INTO v_qr FROM public.qr_pagos_mp
   WHERE external_reference = p_external_reference AND empresa_id = p_empresa_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR no encontrado para external_reference: %', p_external_reference;
  END IF;

  IF v_qr.estado <> 'pendiente' THEN
    RETURN jsonb_build_object('ok', true, 'ya_procesado', true, 'estado', v_qr.estado);
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes WHERE id = v_qr.comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado para el QR %', p_external_reference;
  END IF;

  SELECT id INTO v_forma_pago_id FROM public.formas_pago
   WHERE empresa_id = p_empresa_id AND nombre = 'QR MercadoPago';

  -- 1. Reconocer el cobro en caja.
  INSERT INTO public.movimientos_caja (
    empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto,
    metodo_pago, fecha, is_automatic, forma_pago_id, comprobante_id
  ) VALUES (
    p_empresa_id, v_qr.user_id, v_qr.caja_sesion_id, 'ingreso', 'Venta',
    'Venta #' || v_comp.numero_venta, v_qr.monto, 'QR MercadoPago', now(), true,
    v_forma_pago_id, v_comp.id
  );

  -- 2. Asiento contable (SQL puro, sin auth.uid() — ver comentario de arriba).
  SELECT id INTO v_cta_cobro     FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
  SELECT id INTO v_cta_ventas    FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '4.1'   AND activa LIMIT 1;
  SELECT id INTO v_cta_iva       FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '2.1.3' AND activa LIMIT 1;
  IF COALESCE(v_comp.costo_mercaderia_vendida, 0) > 0 THEN
    SELECT id INTO v_cta_costo      FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '5.1'   AND activa LIMIT 1;
    SELECT id INTO v_cta_inventario FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.3' AND activa LIMIT 1;
  END IF;

  IF v_cta_cobro IS NOT NULL AND v_cta_ventas IS NOT NULL THEN
    v_total_debe := v_comp.total;
    v_total_haber := v_comp.total;
    IF v_cta_costo IS NOT NULL AND v_cta_inventario IS NOT NULL THEN
      v_total_debe := v_total_debe + v_comp.costo_mercaderia_vendida;
      v_total_haber := v_total_haber + v_comp.costo_mercaderia_vendida;
    END IF;

    INSERT INTO public.asientos_contables
      (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
    VALUES (
      p_empresa_id, v_qr.user_id, next_numero_asiento(p_empresa_id), CURRENT_DATE,
      'Venta ' || v_comp.numero_venta || ' (QR MercadoPago)', 'confirmado', v_total_debe, v_total_haber,
      'venta', v_comp.id
    ) RETURNING id INTO v_asiento_id;

    IF v_cta_iva IS NOT NULL AND COALESCE(v_comp.neto_gravado, 0) + COALESCE(v_comp.iva_discriminado, 0) > 0 THEN
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, p_empresa_id, v_cta_cobro,  'Cobro por venta (QR MercadoPago)', v_comp.total, 0),
        (v_asiento_id, p_empresa_id, v_cta_ventas, 'Ingreso por venta (neto)', 0, v_comp.neto_gravado),
        (v_asiento_id, p_empresa_id, v_cta_iva,    'IVA Débito Fiscal', 0, v_comp.iva_discriminado);
    ELSE
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, p_empresa_id, v_cta_cobro,  'Cobro por venta (QR MercadoPago)', v_comp.total, 0),
        (v_asiento_id, p_empresa_id, v_cta_ventas, 'Ingreso por venta', 0, v_comp.total);
    END IF;

    IF v_cta_costo IS NOT NULL AND v_cta_inventario IS NOT NULL THEN
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, p_empresa_id, v_cta_costo,      'Costo de mercadería vendida', v_comp.costo_mercaderia_vendida, 0),
        (v_asiento_id, p_empresa_id, v_cta_inventario, 'Salida de mercadería por venta', 0, v_comp.costo_mercaderia_vendida);
    END IF;

    UPDATE public.comprobantes SET asiento_id = v_asiento_id WHERE id = v_comp.id;
  END IF;

  UPDATE public.comprobantes SET estado_pago = 'pagada' WHERE id = v_comp.id;
  UPDATE public.qr_pagos_mp SET estado = 'pagado', payment_id = p_payment_id, updated_at = now()
   WHERE id = v_qr.id;

  -- 3. Encolar AFIP recién ahora — reusa el trigger fn_queue_factura_arca ya
  --    existente (dispara con UPDATE OF cae_estado a 'pendiente'). Sólo si
  --    crear_venta_pendiente_qr guardó una letra (empresa con factura
  --    electrónica activa y PdV que envía a ARCA — decidido en el momento de
  --    generar el QR, mismo criterio que useConfirmarVenta.js hoy).
  IF v_comp.tipo_comprobante_afip IS NOT NULL THEN
    UPDATE public.comprobantes SET cae_estado = 'pendiente' WHERE id = v_comp.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'comprobante_id', v_comp.id, 'numero_venta', v_comp.numero_venta);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirmar_pago_qr(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirmar_pago_qr(uuid, text, text) TO service_role;

-- ── 4. cancelar_venta_pendiente_qr ───────────────────────────────────────────
-- Mismo patrón "documento de reversa" que cancelar_factura (mig.259), acotado
-- a lo que una venta QR pendiente puede tener: entrega implícita + stock. Sin
-- movimientos_caja/cuenta_corriente que reversar (todavía no existen — sólo
-- se crean al confirmar el pago). Guard de race: lockea qr_pagos_mp y verifica
-- 'pendiente' antes de cancelar — si el webhook confirmó el pago en el
-- ínterin, no cancela.
CREATE FUNCTION public.cancelar_venta_pendiente_qr(
  p_empresa_id     uuid,
  p_comprobante_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_qr RECORD; v_comp RECORD; v_entrega RECORD; v_item RECORD;
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

  -- Reversar stock de la entrega implícita — mismo patrón que cancelar_factura.
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
              'Cancelación QR MercadoPago — Venta ' || v_comp.numero_venta, now());
    END LOOP;
    UPDATE public.entregas SET estado = 'anulado' WHERE id = v_entrega.id;
  END LOOP;

  UPDATE public.comprobantes SET estado_pago = 'cancelada' WHERE id = p_comprobante_id;
  UPDATE public.qr_pagos_mp SET estado = 'cancelado', updated_at = now() WHERE id = v_qr.id;

  RETURN jsonb_build_object('ok', true, 'comprobante_id', p_comprobante_id, 'numero_venta', v_comp.numero_venta);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancelar_venta_pendiente_qr(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancelar_venta_pendiente_qr(uuid, uuid) TO authenticated;

-- ── 5. Forma de pago "QR MercadoPago" para Nalux ─────────────────────────────
-- tipo_instrumento='billetera' ya existe en el enum (mig.214) — sólo falta el
-- alta de la fila. Sin cuenta_bancaria_id a propósito: si se mapeara, el
-- trigger trg_fn_puente_caja_bancos (mig.000) mirroría el movimiento hacia
-- movimientos_bancarios, duplicando lo que la conciliación MP existente
-- (mp-sync/mp-webhook, sin tocar) ya va a insertar por su cuenta al ver el
-- mismo payment_id.
INSERT INTO public.formas_pago (empresa_id, nombre, tipo_instrumento, activo)
VALUES ('cbc4db74-ec31-4324-bd36-207b7a7bd99a', 'QR MercadoPago', 'billetera', true)
ON CONFLICT (empresa_id, nombre) DO NOTHING;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.cancelar_venta_pendiente_qr(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.confirmar_pago_qr(uuid, text, text);
-- DROP FUNCTION IF EXISTS public.crear_venta_pendiente_qr(uuid, uuid, uuid, text, jsonb, uuid, text, uuid, uuid);
-- DELETE FROM public.formas_pago WHERE empresa_id='cbc4db74-ec31-4324-bd36-207b7a7bd99a' AND nombre='QR MercadoPago';
-- DROP TABLE IF EXISTS public.qr_pagos_mp;
