-- migration 323 — Hardening: agregar filtro empresa_id explícito a los DELETE/UPDATE de ítems
-- en actualizar_cotizacion/actualizar_pedido/actualizar_orden_compra y al UPDATE de
-- cancelar_nota_debito.
--
-- HALLAZGO (revisión de código automática, 13/08, ángulo "Conventions: CLAUDE.md compliance"):
-- CLAUDE.md — regla de oro — dice explícitamente "Nunca hacer queries sin filtro de empresa_id".
-- Las 4 RPCs de edición/cancelación construidas hoy (mig.319/320/321/322) validan empresa_id UNA
-- SOLA VEZ contra la cabecera (cotizaciones/pedidos/ordenes_compra/comprobantes) al principio de
-- la función, pero el DELETE y el UPDATE de ítems que siguen filtran solo por
-- cotizacion_id/pedido_id/orden_id (o por id de comprobante en el caso de la ND) — sin repetir
-- `empresa_id = v_empresa_id` en esa misma sentencia.
--
-- No es explotable hoy: el id de la cabecera (cotizacion_id/pedido_id/orden_id/comprobante_id) ya
-- fue validado contra la empresa del usuario antes de este punto, y cada fila de ítem solo puede
-- pertenecer a la cabecera vía FK — así que un atacante no puede colar un id de otra empresa
-- porque el paso previo ya lo hubiera rechazado. Pero es una desviación real de la regla del
-- CLAUDE.md, y una defensa en profundidad barata: si algún día esta función se reescribe para
-- aceptar una lista de ids o se reordenan los checks, el filtro repetido en cada sentencia evita
-- que ese error se convierta en un DELETE/UPDATE cross-tenant real. Costo cero: como todas las
-- filas ya pertenecen a la empresa validada, agregar el filtro no cambia ningún resultado, solo
-- lo hace explícito en cada sentencia (defensa en profundidad, no un fix de un bug activo).

-- 1. actualizar_cotizacion (mig.318/319)
CREATE OR REPLACE FUNCTION public.actualizar_cotizacion(
  p_cotizacion_id   uuid,
  p_cliente_id      uuid,
  p_cliente_nombre  text,
  p_items           jsonb,
  p_notas           text DEFAULT NULL,
  p_condiciones_pago text DEFAULT NULL,
  p_fecha_vencimiento date DEFAULT NULL,
  p_moneda          text DEFAULT 'ARS',
  p_tipo_cambio_tasa numeric DEFAULT 1,
  p_descuento       numeric DEFAULT 0
)
RETURNS public.cotizaciones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id   uuid;
  v_estado       text;
  v_item         jsonb;
  v_item_id      uuid;
  v_subtotal     numeric := 0;
  v_item_subtotal numeric;
  v_total        numeric;
  v_cotizacion   public.cotizaciones;
  v_keep_ids     uuid[];
BEGIN
  SELECT empresa_id, estado INTO v_empresa_id, v_estado
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización no encontrada';
  END IF;
  IF v_empresa_id IS DISTINCT FROM public.get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: la cotización no pertenece a tu empresa';
  END IF;
  IF v_estado = 'convertida' THEN
    RAISE EXCEPTION 'No se puede editar una cotización ya convertida en venta — el cambio debería hacerse en el documento generado, no acá.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La cotización necesita al menos un ítem';
  END IF;

  -- Bug real encontrado por revisión automática (13/08): sin esto, un typo como "150"
  -- en vez de "15" en el % de descuento producía un total negativo persistido en un
  -- documento real, sin ningún error. Clamp defensivo — el mismo se aplica también a
  -- descuento_item de cada línea, más abajo.
  p_descuento := LEAST(GREATEST(COALESCE(p_descuento, 0), 0), 100);

  v_keep_ids := ARRAY(
    SELECT (elem->>'id')::uuid FROM jsonb_array_elements(p_items) elem WHERE elem->>'id' IS NOT NULL
  );

  DELETE FROM public.cotizacion_items
  WHERE cotizacion_id = p_cotizacion_id
    AND empresa_id = v_empresa_id
    AND id <> ALL(COALESCE(v_keep_ids, ARRAY[]::uuid[]));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := NULLIF(v_item->>'id', '')::uuid;
    v_item_subtotal := (COALESCE((v_item->>'cantidad')::numeric, 0) * COALESCE((v_item->>'precio_unitario')::numeric, 0))
                        * (1 - LEAST(GREATEST(COALESCE((v_item->>'descuento_item')::numeric, 0), 0), 100) / 100);
    v_subtotal := v_subtotal + v_item_subtotal;

    IF v_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.cotizacion_items WHERE id = v_item_id AND cotizacion_id = p_cotizacion_id AND empresa_id = v_empresa_id
    ) THEN
      UPDATE public.cotizacion_items SET
        producto_id     = NULLIF(v_item->>'producto_id', '')::uuid,
        descripcion     = COALESCE(v_item->>'descripcion', ''),
        cantidad        = COALESCE((v_item->>'cantidad')::numeric, 0),
        precio_unitario = COALESCE((v_item->>'precio_unitario')::numeric, 0),
        descuento_item  = LEAST(GREATEST(COALESCE((v_item->>'descuento_item')::numeric, 0), 0), 100),
        subtotal        = v_item_subtotal,
        unidad_medida   = v_item->>'unidad_medida',
        alicuota_iva    = COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
      WHERE id = v_item_id
        AND empresa_id = v_empresa_id
        AND (
          producto_id     IS DISTINCT FROM NULLIF(v_item->>'producto_id', '')::uuid OR
          descripcion     IS DISTINCT FROM COALESCE(v_item->>'descripcion', '') OR
          cantidad        IS DISTINCT FROM COALESCE((v_item->>'cantidad')::numeric, 0) OR
          precio_unitario IS DISTINCT FROM COALESCE((v_item->>'precio_unitario')::numeric, 0) OR
          descuento_item  IS DISTINCT FROM LEAST(GREATEST(COALESCE((v_item->>'descuento_item')::numeric, 0), 0), 100) OR
          subtotal        IS DISTINCT FROM v_item_subtotal OR
          unidad_medida   IS DISTINCT FROM (v_item->>'unidad_medida') OR
          alicuota_iva    IS DISTINCT FROM COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
        );
    ELSE
      INSERT INTO public.cotizacion_items (
        cotizacion_id, empresa_id, producto_id, descripcion, cantidad, precio_unitario,
        descuento_item, subtotal, unidad_medida, alicuota_iva
      ) VALUES (
        p_cotizacion_id, v_empresa_id,
        NULLIF(v_item->>'producto_id', '')::uuid,
        COALESCE(v_item->>'descripcion', ''),
        COALESCE((v_item->>'cantidad')::numeric, 0),
        COALESCE((v_item->>'precio_unitario')::numeric, 0),
        LEAST(GREATEST(COALESCE((v_item->>'descuento_item')::numeric, 0), 0), 100),
        v_item_subtotal,
        v_item->>'unidad_medida',
        COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
      );
    END IF;
  END LOOP;

  v_total := v_subtotal * (1 - COALESCE(p_descuento, 0) / 100);

  UPDATE public.cotizaciones SET
    cliente_id         = p_cliente_id,
    cliente_nombre      = p_cliente_nombre,
    notas               = p_notas,
    condiciones_pago    = p_condiciones_pago,
    fecha_vencimiento   = p_fecha_vencimiento,
    moneda              = p_moneda,
    tipo_cambio_tasa    = p_tipo_cambio_tasa,
    descuento           = COALESCE(p_descuento, 0),
    subtotal            = v_subtotal,
    total               = v_total
  WHERE id = p_cotizacion_id AND empresa_id = v_empresa_id
  RETURNING * INTO v_cotizacion;

  RETURN v_cotizacion;
END;
$$;

-- 2. actualizar_pedido (mig.320)
CREATE OR REPLACE FUNCTION public.actualizar_pedido(
  p_pedido_id         uuid,
  p_cliente_id        uuid,
  p_cliente_nombre    text,
  p_items             jsonb,
  p_notas             text DEFAULT NULL,
  p_fecha_entrega     date DEFAULT NULL,
  p_referencia_cliente text DEFAULT NULL,
  p_moneda            text DEFAULT 'ARS',
  p_tipo_cambio_tasa  numeric DEFAULT 1,
  p_descuento_global_pct numeric DEFAULT 0
)
RETURNS public.pedidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id    uuid;
  v_estado        text;
  v_item          jsonb;
  v_item_id       uuid;
  v_subtotal      numeric := 0;
  v_item_subtotal numeric;
  v_total         numeric;
  v_descuento_monto numeric;
  v_pedido        public.pedidos;
  v_keep_ids      uuid[];
BEGIN
  SELECT empresa_id, estado INTO v_empresa_id, v_estado
  FROM public.pedidos
  WHERE id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM public.get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el pedido no pertenece a tu empresa';
  END IF;
  IF v_estado <> 'borrador' THEN
    RAISE EXCEPTION 'Solo se puede editar un pedido en estado Borrador — una vez confirmado puede tener entregas generadas.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El pedido necesita al menos un ítem';
  END IF;

  -- Bug real encontrado por revisión automática (13/08): mismo clamp que actualizar_cotizacion.
  p_descuento_global_pct := LEAST(GREATEST(COALESCE(p_descuento_global_pct, 0), 0), 100);

  v_keep_ids := ARRAY(
    SELECT (elem->>'id')::uuid FROM jsonb_array_elements(p_items) elem WHERE elem->>'id' IS NOT NULL
  );

  DELETE FROM public.pedido_items
  WHERE pedido_id = p_pedido_id
    AND empresa_id = v_empresa_id
    AND id <> ALL(COALESCE(v_keep_ids, ARRAY[]::uuid[]));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := NULLIF(v_item->>'id', '')::uuid;
    v_item_subtotal := (COALESCE((v_item->>'cantidad')::numeric, 0) * COALESCE((v_item->>'precio_unitario')::numeric, 0))
                        * (1 - LEAST(GREATEST(COALESCE((v_item->>'descuento_item')::numeric, 0), 0), 100) / 100);
    v_subtotal := v_subtotal + v_item_subtotal;

    IF v_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.pedido_items WHERE id = v_item_id AND pedido_id = p_pedido_id AND empresa_id = v_empresa_id
    ) THEN
      UPDATE public.pedido_items SET
        producto_id     = NULLIF(v_item->>'producto_id', '')::uuid,
        descripcion     = COALESCE(v_item->>'descripcion', ''),
        cantidad        = COALESCE((v_item->>'cantidad')::numeric, 0),
        precio_unitario = COALESCE((v_item->>'precio_unitario')::numeric, 0),
        descuento_item  = LEAST(GREATEST(COALESCE((v_item->>'descuento_item')::numeric, 0), 0), 100),
        subtotal        = v_item_subtotal,
        unidad_medida   = v_item->>'unidad_medida',
        alicuota_iva    = COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
      WHERE id = v_item_id
        AND empresa_id = v_empresa_id
        AND (
          producto_id     IS DISTINCT FROM NULLIF(v_item->>'producto_id', '')::uuid OR
          descripcion     IS DISTINCT FROM COALESCE(v_item->>'descripcion', '') OR
          cantidad        IS DISTINCT FROM COALESCE((v_item->>'cantidad')::numeric, 0) OR
          precio_unitario IS DISTINCT FROM COALESCE((v_item->>'precio_unitario')::numeric, 0) OR
          descuento_item  IS DISTINCT FROM LEAST(GREATEST(COALESCE((v_item->>'descuento_item')::numeric, 0), 0), 100) OR
          subtotal        IS DISTINCT FROM v_item_subtotal OR
          unidad_medida   IS DISTINCT FROM (v_item->>'unidad_medida') OR
          alicuota_iva    IS DISTINCT FROM COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
        );
    ELSE
      INSERT INTO public.pedido_items (
        pedido_id, empresa_id, producto_id, descripcion, cantidad, precio_unitario,
        descuento_item, subtotal, unidad_medida, alicuota_iva
      ) VALUES (
        p_pedido_id, v_empresa_id,
        NULLIF(v_item->>'producto_id', '')::uuid,
        COALESCE(v_item->>'descripcion', ''),
        COALESCE((v_item->>'cantidad')::numeric, 0),
        COALESCE((v_item->>'precio_unitario')::numeric, 0),
        LEAST(GREATEST(COALESCE((v_item->>'descuento_item')::numeric, 0), 0), 100),
        v_item_subtotal,
        v_item->>'unidad_medida',
        COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
      );
    END IF;
  END LOOP;

  v_total := v_subtotal * (1 - COALESCE(p_descuento_global_pct, 0) / 100);
  v_descuento_monto := v_subtotal - v_total;

  UPDATE public.pedidos SET
    cliente_id           = p_cliente_id,
    cliente_nombre        = p_cliente_nombre,
    notas                 = p_notas,
    fecha_entrega         = p_fecha_entrega,
    referencia_cliente    = p_referencia_cliente,
    moneda                = p_moneda,
    tipo_cambio_tasa      = p_tipo_cambio_tasa,
    descuento_global_pct  = COALESCE(p_descuento_global_pct, 0),
    subtotal              = v_subtotal,
    descuento             = v_descuento_monto,
    total                 = v_total,
    updated_at            = now()
  WHERE id = p_pedido_id AND empresa_id = v_empresa_id
  RETURNING * INTO v_pedido;

  RETURN v_pedido;
END;
$$;

-- 3. actualizar_orden_compra (mig.322)
CREATE OR REPLACE FUNCTION public.actualizar_orden_compra(
  p_orden_id              uuid,
  p_proveedor_id          uuid,
  p_proveedor_nombre      text,
  p_items                 jsonb,
  p_notas                 text DEFAULT NULL,
  p_fecha_entrega_esperada date DEFAULT NULL,
  p_forma_pago            text DEFAULT 'Efectivo',
  p_moneda                text DEFAULT 'ARS',
  p_tipo_cambio_tasa      numeric DEFAULT 1,
  p_descuento_global_pct  numeric DEFAULT 0
)
RETURNS public.ordenes_compra
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id    uuid;
  v_estado        text;
  v_item          jsonb;
  v_item_id       uuid;
  v_subtotal      numeric := 0;
  v_item_subtotal numeric;
  v_total         numeric;
  v_oc            public.ordenes_compra;
  v_keep_ids      uuid[];
BEGIN
  SELECT empresa_id, estado INTO v_empresa_id, v_estado
  FROM public.ordenes_compra
  WHERE id = p_orden_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;
  IF v_empresa_id IS DISTINCT FROM public.get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: la orden de compra no pertenece a tu empresa';
  END IF;
  IF NOT public.has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;
  IF v_estado NOT IN ('borrador', 'enviada') THEN
    RAISE EXCEPTION 'Solo se puede editar una orden de compra en Borrador o Enviada — una vez que hay Recepción registrada ya hubo movimiento de stock real.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La orden de compra necesita al menos un ítem';
  END IF;

  -- Bug real encontrado por revisión automática (13/08): mismo clamp que actualizar_cotizacion.
  p_descuento_global_pct := LEAST(GREATEST(COALESCE(p_descuento_global_pct, 0), 0), 100);

  v_keep_ids := ARRAY(
    SELECT (elem->>'id')::uuid FROM jsonb_array_elements(p_items) elem WHERE elem->>'id' IS NOT NULL
  );

  DELETE FROM public.ordenes_compra_items
  WHERE orden_id = p_orden_id
    AND empresa_id = v_empresa_id
    AND id <> ALL(COALESCE(v_keep_ids, ARRAY[]::uuid[]));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := NULLIF(v_item->>'id', '')::uuid;
    v_item_subtotal := (COALESCE((v_item->>'cantidad_pedida')::numeric, 0) * COALESCE((v_item->>'costo_unitario')::numeric, 0))
                        * (1 - LEAST(GREATEST(COALESCE((v_item->>'descuento_item')::numeric, 0), 0), 100) / 100);
    v_subtotal := v_subtotal + v_item_subtotal;

    IF v_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.ordenes_compra_items WHERE id = v_item_id AND orden_id = p_orden_id AND empresa_id = v_empresa_id
    ) THEN
      UPDATE public.ordenes_compra_items SET
        producto_id     = NULLIF(v_item->>'producto_id', '')::uuid,
        descripcion     = COALESCE(v_item->>'descripcion', ''),
        cantidad_pedida = COALESCE((v_item->>'cantidad_pedida')::numeric, 0),
        costo_unitario  = COALESCE((v_item->>'costo_unitario')::numeric, 0),
        descuento_item  = LEAST(GREATEST(COALESCE((v_item->>'descuento_item')::numeric, 0), 0), 100),
        subtotal        = v_item_subtotal,
        unidad_medida   = v_item->>'unidad_medida',
        alicuota_iva    = COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
      WHERE id = v_item_id
        AND empresa_id = v_empresa_id
        AND (
          producto_id     IS DISTINCT FROM NULLIF(v_item->>'producto_id', '')::uuid OR
          descripcion     IS DISTINCT FROM COALESCE(v_item->>'descripcion', '') OR
          cantidad_pedida IS DISTINCT FROM COALESCE((v_item->>'cantidad_pedida')::numeric, 0) OR
          costo_unitario  IS DISTINCT FROM COALESCE((v_item->>'costo_unitario')::numeric, 0) OR
          descuento_item  IS DISTINCT FROM LEAST(GREATEST(COALESCE((v_item->>'descuento_item')::numeric, 0), 0), 100) OR
          subtotal        IS DISTINCT FROM v_item_subtotal OR
          unidad_medida   IS DISTINCT FROM (v_item->>'unidad_medida') OR
          alicuota_iva    IS DISTINCT FROM COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
        );
    ELSE
      INSERT INTO public.ordenes_compra_items (
        orden_id, empresa_id, producto_id, descripcion, cantidad_pedida, cantidad_recibida,
        costo_unitario, subtotal, unidad_medida, alicuota_iva, descuento_item
      ) VALUES (
        p_orden_id, v_empresa_id,
        NULLIF(v_item->>'producto_id', '')::uuid,
        COALESCE(v_item->>'descripcion', ''),
        COALESCE((v_item->>'cantidad_pedida')::numeric, 0),
        0,
        COALESCE((v_item->>'costo_unitario')::numeric, 0),
        v_item_subtotal,
        v_item->>'unidad_medida',
        COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21'),
        LEAST(GREATEST(COALESCE((v_item->>'descuento_item')::numeric, 0), 0), 100)
      );
    END IF;
  END LOOP;

  v_total := v_subtotal * (1 - COALESCE(p_descuento_global_pct, 0) / 100);

  UPDATE public.ordenes_compra SET
    proveedor_id            = p_proveedor_id,
    proveedor_nombre        = p_proveedor_nombre,
    notas                   = p_notas,
    fecha_entrega_esperada  = p_fecha_entrega_esperada,
    forma_pago              = COALESCE(p_forma_pago, forma_pago),
    moneda                  = p_moneda,
    tipo_cambio_tasa        = p_tipo_cambio_tasa,
    descuento_global_pct    = COALESCE(p_descuento_global_pct, 0),
    subtotal                = v_subtotal,
    total                   = v_total,
    updated_at              = now()
  WHERE id = p_orden_id AND empresa_id = v_empresa_id
  RETURNING * INTO v_oc;

  RETURN v_oc;
END;
$$;

-- 4. cancelar_nota_debito (mig.321)
CREATE OR REPLACE FUNCTION public.cancelar_nota_debito(
  p_empresa_id     uuid,
  p_user_id        uuid,
  p_comprobante_id uuid,
  p_motivo         text DEFAULT NULL
)
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

  UPDATE public.comprobantes SET estado_pago = 'cancelada' WHERE id = p_comprobante_id AND empresa_id = p_empresa_id;

  RETURN jsonb_build_object(
    'comprobante_id', p_comprobante_id,
    'numero_venta',   v_comp.numero_venta,
    'total',          v_comp.total
  );
END;
$function$;

-- Sin cambios en REVOKE/GRANT — ya estaban correctos (anon sin acceso, authenticated sí) en las
-- migraciones originales; CREATE OR REPLACE conserva los privilegios existentes de la función.
