-- ════════════════════════════════════════════════════════════════════════════
-- migration 108 — Motor de ofertas: schema + RPC + crear_venta v2
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Tabla ofertas (con RLS tenant isolation)
-- 2. ALTER comprobante_items → 5 columnas de descuento
-- 3. ALTER comprobantes → descuento global
-- 4. RPC calcular_ofertas_carrito
-- 5. CREATE OR REPLACE crear_venta (backward compatible via COALESCE)
--

-- ═══════════════════════════════════════════
-- 1. Tabla ofertas
-- ═══════════════════════════════════════════

CREATE TABLE ofertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre varchar(100) NOT NULL,
  descripcion text,
  tipo_descuento varchar(20) NOT NULL DEFAULT 'porcentaje',
  valor_descuento numeric(10,2) NOT NULL,
  producto_id uuid REFERENCES productos(id) ON DELETE CASCADE,
  categoria_nombre varchar(100),
  medio_pago varchar(50),
  dia_semana smallint[],
  monto_minimo_carrito numeric(12,2),
  cantidad_minima numeric(10,3),
  fecha_desde date,
  fecha_hasta date,
  activo boolean NOT NULL DEFAULT true,
  prioridad smallint NOT NULL DEFAULT 0,
  acumulable boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT chk_tipo_descuento
    CHECK (tipo_descuento IN ('porcentaje', 'monto_fijo')),
  CONSTRAINT chk_valor_descuento_positivo
    CHECK (valor_descuento >= 0),
  CONSTRAINT chk_porcentaje_maximo
    CHECK (
      (tipo_descuento = 'porcentaje' AND valor_descuento <= 100)
      OR tipo_descuento = 'monto_fijo'
    )
);

ALTER TABLE ofertas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "empresa_aislamiento" ON ofertas
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX idx_ofertas_empresa
  ON ofertas(empresa_id) WHERE activo = true;
CREATE INDEX idx_ofertas_producto
  ON ofertas(producto_id) WHERE activo = true;


-- ═══════════════════════════════════════════
-- 2. ALTER comprobante_items
-- ═══════════════════════════════════════════

ALTER TABLE comprobante_items
  ADD COLUMN IF NOT EXISTS precio_original numeric(12,2),
  ADD COLUMN IF NOT EXISTS descuento_pct numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuento_monto numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS oferta_id uuid REFERENCES ofertas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS descuento_manual_pct numeric(5,2) DEFAULT 0;


-- ═══════════════════════════════════════════
-- 3. ALTER comprobantes
-- ═══════════════════════════════════════════

ALTER TABLE comprobantes
  ADD COLUMN IF NOT EXISTS descuento_global_monto numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuento_global_pct numeric(5,2) DEFAULT 0;


-- ═══════════════════════════════════════════
-- 4. RPC calcular_ofertas_carrito
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION calcular_ofertas_carrito(
  p_empresa_id uuid,
  p_items jsonb,
  p_medio_pago varchar DEFAULT NULL,
  p_total_carrito numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_item jsonb;
  v_oferta record;
  v_dia_actual smallint;
  v_descuento_monto numeric;
  v_precio_final numeric;
  v_item_result jsonb;
BEGIN
  v_dia_actual := EXTRACT(DOW FROM NOW()
    AT TIME ZONE 'America/Argentina/Buenos_Aires')::smallint;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT o.* INTO v_oferta
    FROM ofertas o
    WHERE o.empresa_id = p_empresa_id
      AND o.activo = true
      AND (o.fecha_desde IS NULL OR o.fecha_desde <= CURRENT_DATE)
      AND (o.fecha_hasta IS NULL OR o.fecha_hasta >= CURRENT_DATE)
      AND (
        o.producto_id IS NULL
        OR o.producto_id = (v_item->>'producto_id')::uuid
        OR (
          o.categoria_nombre IS NOT NULL AND
          LOWER(o.categoria_nombre) = LOWER(v_item->>'categoria_nombre')
        )
      )
      AND (o.medio_pago IS NULL OR o.medio_pago = p_medio_pago)
      AND (o.dia_semana IS NULL OR v_dia_actual = ANY(o.dia_semana))
      AND (o.monto_minimo_carrito IS NULL
           OR p_total_carrito >= o.monto_minimo_carrito)
      AND (o.cantidad_minima IS NULL
           OR (v_item->>'cantidad')::numeric >= o.cantidad_minima)
    ORDER BY o.prioridad DESC, o.created_at ASC
    LIMIT 1;

    IF FOUND THEN
      IF v_oferta.tipo_descuento = 'porcentaje' THEN
        v_descuento_monto := (v_item->>'precio_unitario')::numeric
                             * v_oferta.valor_descuento / 100;
        v_precio_final := (v_item->>'precio_unitario')::numeric
                          * (1 - v_oferta.valor_descuento / 100);
      ELSE
        v_descuento_monto := LEAST(
          v_oferta.valor_descuento,
          (v_item->>'precio_unitario')::numeric
        );
        v_precio_final := (v_item->>'precio_unitario')::numeric
                          - v_descuento_monto;
      END IF;

      v_item_result := jsonb_build_object(
        'producto_id', v_item->>'producto_id',
        'oferta_id', v_oferta.id,
        'oferta_nombre', v_oferta.nombre,
        'tipo_descuento', v_oferta.tipo_descuento,
        'valor_descuento', v_oferta.valor_descuento,
        'descuento_monto', ROUND(v_descuento_monto, 2),
        'precio_original', (v_item->>'precio_unitario')::numeric,
        'precio_final', ROUND(v_precio_final, 2),
        'acumulable', v_oferta.acumulable
      );
    ELSE
      v_item_result := jsonb_build_object(
        'producto_id', v_item->>'producto_id',
        'oferta_id', null,
        'oferta_nombre', null,
        'descuento_monto', 0,
        'precio_original', (v_item->>'precio_unitario')::numeric,
        'precio_final', (v_item->>'precio_unitario')::numeric,
        'acumulable', false
      );
    END IF;

    v_result := v_result || jsonb_build_array(v_item_result);
  END LOOP;

  RETURN v_result;
END;
$$;


-- ═══════════════════════════════════════════
-- 5. crear_venta v2 — soporte descuentos
-- ═══════════════════════════════════════════
-- v2: agrega soporte de descuentos por item (motor de ofertas)
-- backward compatible: campos de descuento son opcionales con COALESCE

CREATE OR REPLACE FUNCTION public.crear_venta(
  p_empresa_id       UUID,
  p_user_id          UUID,
  p_numero_venta     TEXT,
  p_fecha            TIMESTAMPTZ,
  p_cliente_id       UUID,
  p_cliente_nombre   TEXT,
  p_total            NUMERIC,
  p_forma_pago       TEXT,
  p_estado_pago      TEXT,
  p_moneda           TEXT,
  p_tipo_cambio_tasa NUMERIC,
  p_monto_paralelo   NUMERIC,
  p_tc_paralelo      NUMERIC,
  p_items            JSONB,
  p_pagos            JSONB,
  p_es_cc            BOOLEAN,
  p_caja_sesion_id   UUID,
  p_pedido_id        UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comprobante_id  UUID;
  v_item            JSONB;
  v_pago            JSONB;
  v_stock_actual    INTEGER;
  v_cantidad        INTEGER;
  v_producto_id     UUID;
  v_alicuota        TEXT;
  v_factor          NUMERIC;
  v_subtotal        NUMERIC;
  v_neto_total      NUMERIC := 0;
  v_iva_total       NUMERIC := 0;
  v_entrega_id      UUID;
  v_numero_entrega  TEXT;
  v_entrega_manual_id UUID := NULL;
  v_dias_credito       INTEGER;
  v_fecha_vencimiento  DATE;
  -- v2: variables de descuento
  v_precio_original      NUMERIC;
  v_descuento_pct        NUMERIC;
  v_descuento_monto_item NUMERIC;
  v_oferta_id            UUID;
  v_descuento_manual_pct NUMERIC;
  v_descuento_global_monto NUMERIC := 0;
  v_descuento_global_pct   NUMERIC := 0;
  v_bruto_total            NUMERIC := 0;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;

  IF p_cliente_id IS NOT NULL THEN
    SELECT dias_credito INTO v_dias_credito
    FROM public.clientes
    WHERE id = p_cliente_id AND empresa_id = p_empresa_id;
  END IF;
  v_fecha_vencimiento := p_fecha::date + COALESCE(v_dias_credito, 0);

  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha,
    cliente_id, cliente_nombre, total, forma_pago,
    estado_pago, moneda, tipo_cambio_tasa,
    monto_paralelo, tc_paralelo, tipo, pedido_id,
    fecha_vencimiento
  ) VALUES (
    p_empresa_id, p_empresa_id, p_numero_venta, p_fecha,
    p_cliente_id, p_cliente_nombre, p_total, p_forma_pago,
    p_estado_pago, p_moneda, p_tipo_cambio_tasa,
    p_monto_paralelo, p_tc_paralelo, 'venta', p_pedido_id,
    v_fecha_vencimiento
  )
  RETURNING id INTO v_comprobante_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::INTEGER;
    v_subtotal    := (v_item->>'subtotal')::NUMERIC;
    v_alicuota    := COALESCE(v_item->>'alicuota_iva', '21');

    -- v2: leer campos de descuento con COALESCE (backward compatible)
    v_precio_original      := COALESCE((v_item->>'precio_original')::NUMERIC,
                                        (v_item->>'precio_unitario')::NUMERIC);
    v_descuento_pct        := COALESCE((v_item->>'descuento_pct')::NUMERIC, 0);
    v_descuento_monto_item := COALESCE((v_item->>'descuento_monto')::NUMERIC, 0);
    v_oferta_id            := NULLIF(v_item->>'oferta_id', '')::UUID;
    v_descuento_manual_pct := COALESCE((v_item->>'descuento_manual_pct')::NUMERIC, 0);

    SELECT stock_actual INTO v_stock_actual
    FROM public.productos
    WHERE id = v_producto_id AND empresa_id = p_empresa_id
    FOR UPDATE;

    IF v_stock_actual IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id;
    END IF;
    IF v_stock_actual < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para producto % (disponible: %, requerido: %)',
        v_producto_id, v_stock_actual, v_cantidad;
    END IF;

    UPDATE public.productos
    SET stock_actual = stock_actual - v_cantidad
    WHERE id = v_producto_id;

    v_factor := CASE v_alicuota
      WHEN '21'   THEN 1.21
      WHEN '10.5' THEN 1.105
      ELSE 1
    END;
    v_neto_total := v_neto_total + (v_subtotal / v_factor);
    v_iva_total  := v_iva_total  + (v_subtotal - (v_subtotal / v_factor));

    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id, producto_id,
      cantidad, precio_unitario, subtotal, alicuota_iva,
      precio_original, descuento_pct, descuento_monto,
      oferta_id, descuento_manual_pct
    ) VALUES (
      v_comprobante_id, p_empresa_id, v_producto_id,
      v_cantidad, (v_item->>'precio_unitario')::NUMERIC,
      v_subtotal, v_alicuota,
      v_precio_original, v_descuento_pct, v_descuento_monto_item,
      v_oferta_id, v_descuento_manual_pct
    );

    -- v2: acumular descuento global
    v_descuento_global_monto := v_descuento_global_monto
                                + (v_descuento_monto_item * v_cantidad);
    v_bruto_total := v_bruto_total + (v_precio_original * v_cantidad);

    INSERT INTO public.movimientos_inventario (
      empresa_id, tenant_id, producto_id,
      tipo, cantidad, motivo, fecha
    ) VALUES (
      p_empresa_id, p_empresa_id, v_producto_id,
      'salida', v_cantidad,
      'Venta #' || p_numero_venta,
      p_fecha
    );
  END LOOP;

  -- v2: calcular porcentaje global
  v_descuento_global_pct := CASE
    WHEN v_bruto_total > 0
    THEN ROUND(v_descuento_global_monto / v_bruto_total * 100, 2)
    ELSE 0
  END;

  UPDATE public.comprobantes
  SET neto_gravado     = ROUND(v_neto_total, 2),
      iva_discriminado = ROUND(v_iva_total, 2),
      descuento_global_monto = v_descuento_global_monto,
      descuento_global_pct = v_descuento_global_pct
  WHERE id = v_comprobante_id;

  IF p_pedido_id IS NOT NULL THEN
    SELECT id INTO v_entrega_manual_id
    FROM public.entregas
    WHERE empresa_id = p_empresa_id
      AND pedido_id  = p_pedido_id
      AND origen     = 'manual'
      AND estado     = 'entregado'
    ORDER BY fecha DESC
    LIMIT 1;
  END IF;

  IF v_entrega_manual_id IS NOT NULL THEN
    UPDATE public.entregas
    SET comprobante_id = v_comprobante_id
    WHERE id = v_entrega_manual_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      UPDATE public.comprobante_items
      SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id
        AND producto_id   = (v_item->>'producto_id')::UUID;
    END LOOP;
  ELSE
    v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
    INSERT INTO public.entregas (
      empresa_id, user_id, numero_entrega, comprobante_id, cliente_id,
      origen, estado, fecha, pedido_id
    ) VALUES (
      p_empresa_id, p_user_id, v_numero_entrega, v_comprobante_id, p_cliente_id,
      'implicita', 'entregado', CURRENT_DATE, p_pedido_id
    ) RETURNING id INTO v_entrega_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.entrega_items (entrega_id, empresa_id, producto_id, cantidad)
      VALUES (
        v_entrega_id, p_empresa_id,
        (v_item->>'producto_id')::UUID,
        (v_item->>'cantidad')::INTEGER
      );
      UPDATE public.comprobante_items
      SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id
        AND producto_id   = (v_item->>'producto_id')::UUID;
    END LOOP;
  END IF;

  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
  LOOP
    IF (v_pago->>'metodo') IS DISTINCT FROM 'Cuenta Corriente' THEN
      INSERT INTO public.movimientos_caja (
        empresa_id, user_id, caja_sesion_id,
        tipo, categoria, concepto,
        monto, metodo_pago, fecha, is_automatic,
        monto_paralelo, tc_paralelo
      ) VALUES (
        p_empresa_id, p_user_id, p_caja_sesion_id,
        'ingreso', 'Venta',
        'Venta #' || p_numero_venta,
        (v_pago->>'monto')::NUMERIC,
        v_pago->>'metodo',
        p_fecha, true,
        NULLIF(v_pago->>'monto_paralelo', '')::NUMERIC,
        NULLIF(v_pago->>'tc_paralelo', '')::NUMERIC
      );
    END IF;
  END LOOP;

  IF p_es_cc AND p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id,
      tipo, monto, descripcion, fecha,
      comprobante_id,
      monto_paralelo, tc_paralelo
    ) VALUES (
      p_empresa_id, p_user_id, p_cliente_id,
      'DEBE', p_total,
      'Venta #' || p_numero_venta,
      p_fecha,
      v_comprobante_id,
      p_monto_paralelo, p_tc_paralelo
    );
  END IF;

  RETURN jsonb_build_object(
    'comprobante_id', v_comprobante_id,
    'numero_venta',   p_numero_venta
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
