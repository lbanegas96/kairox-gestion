-- ════════════════════════════════════════════════════════════════════════════
-- migration 086 — Fix race condition en numeración de devoluciones (DEV-YYYY-NNNN)
-- ════════════════════════════════════════════════════════════════════════════
--
-- BUG (latente, documentado en CONTEXT.md desde migration 083 / sesión 29):
--   crear_devolucion usaba siguiente_numero_documento(p_empresa_id, 'devoluciones',
--   'numero_devolucion', 'DEV') que hace SELECT COUNT(*) FROM devoluciones WHERE
--   numero_devolucion LIKE 'DEV-%' SIN lock — mismo patrón inseguro que tenía
--   crear_venta antes de migration 083 (que causó la colisión ENT-2026-0042 en prod).
--
-- Además, 'devolucion' nunca fue agregado a series_numeracion — no existía la
-- serie en la tabla, por lo que obtener_proximo_numero hubiera fallado hasta ahora.
--
-- FIX (mismo patrón que migration 083):
--   1. Agregar 'devolucion' a seed_series_numeracion para empresas nuevas.
--   2. Backfill de series_numeracion para empresas existentes con proximo_numero
--      calculado desde el máximo número de devolución ya emitido.
--   3. Recrear crear_devolucion para usar obtener_proximo_numero(p_empresa_id,
--      'devolucion') — comparte el source atómico con FOR UPDATE en series_numeracion.
--
-- NOTA: siguiente_numero_documento NO se dropea — puede haber otros callers
-- (ej. crear_devolucion usaba también para NC). El único cambio mínimo aquí
-- es la línea de numeración de devoluciones.

-- ─── Paso 1: agregar 'devolucion' a seed_series_numeracion ──────────────────
CREATE OR REPLACE FUNCTION public.seed_series_numeracion(p_empresa_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id()
     AND (SELECT empresa_id FROM public.profiles WHERE id = auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos) VALUES
    (p_empresa_id, 'venta',        '',      'YYYYMMDD', 3),
    (p_empresa_id, 'factura',      'FAC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito', 'NC-',   'YYYYMMDD', 3),
    (p_empresa_id, 'pedido',       'PED-',  'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito',  'ND-',   'YYYY',     4),
    (p_empresa_id, 'entrega',      'ENT-',  'YYYY',     4),
    (p_empresa_id, 'recepcion',    'REC-',  'YYYY',     4),
    (p_empresa_id, 'orden_compra', 'OC-',   'ninguno',  5),
    (p_empresa_id, 'cotizacion',   'COT-',  'ninguno',  5),
    (p_empresa_id, 'devolucion',   'DEV-',  'YYYY',     4)
  ON CONFLICT (empresa_id, tipo_documento) DO NOTHING;
END;
$$;

-- ─── Paso 2: backfill empresas existentes ───────────────────────────────────
-- Para cada empresa, proximo_numero = max número ya emitido + 1.
-- El formato es DEV-YYYY-NNNN: el número correlativo es el tercer segmento.
INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos, proximo_numero)
SELECT
  e.id,
  'devolucion',
  'DEV-',
  'YYYY',
  4,
  COALESCE(
    (SELECT MAX(CAST(SPLIT_PART(d.numero_devolucion, '-', 3) AS INTEGER)) + 1
     FROM public.devoluciones d
     WHERE d.empresa_id = e.id
       AND d.numero_devolucion ~ '^DEV-[0-9]{4}-[0-9]+$'),
    1
  )
FROM public.empresas e
ON CONFLICT (empresa_id, tipo_documento) DO NOTHING;

-- ─── Paso 3: recrear crear_devolucion usando obtener_proximo_numero ──────────
CREATE OR REPLACE FUNCTION public.crear_devolucion(
  p_empresa_id       UUID,
  p_user_id          UUID,
  p_tipo             TEXT,
  p_items            JSONB,
  p_entrega_id       UUID    DEFAULT NULL,
  p_recepcion_id     UUID    DEFAULT NULL,
  p_comprobante_id   UUID    DEFAULT NULL,
  p_compra_id        UUID    DEFAULT NULL,
  p_cliente_id       UUID    DEFAULT NULL,
  p_proveedor_id     UUID    DEFAULT NULL,
  p_reingresa_stock  BOOLEAN DEFAULT FALSE,
  p_compensacion     TEXT    DEFAULT 'pendiente',
  p_reembolso_efectivo BOOLEAN DEFAULT FALSE,
  p_motivo           TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_devolucion_id    UUID;
  v_numero_dev       TEXT;
  v_item             JSONB;
  v_producto_id      UUID;
  v_cantidad         NUMERIC;
  v_precio_unit      NUMERIC;
  v_subtotal         NUMERIC;
  v_total_dev        NUMERIC := 0;
  v_nc_id            UUID    := NULL;
  v_numero_nc        TEXT    := NULL;
  v_cliente_nombre   TEXT;
  v_caja_sesion_id   UUID;
  v_stock_actual_dev NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- FIX 086: usar obtener_proximo_numero (atómico via FOR UPDATE en
  -- series_numeracion) en vez de siguiente_numero_documento (COUNT* sin lock).
  v_numero_dev := public.obtener_proximo_numero(p_empresa_id, 'devolucion');

  -- ── 1. Cabecera devolución ──────────────────────────────────────────────
  INSERT INTO public.devoluciones (
    empresa_id, user_id, numero_devolucion, tipo,
    entrega_id, recepcion_id, comprobante_id, compra_id,
    cliente_id, proveedor_id,
    reingresa_stock, compensacion, reembolso_efectivo, motivo
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_dev, p_tipo,
    p_entrega_id, p_recepcion_id, p_comprobante_id, p_compra_id,
    p_cliente_id, p_proveedor_id,
    p_reingresa_stock, p_compensacion, p_reembolso_efectivo, p_motivo
  ) RETURNING id INTO v_devolucion_id;

  -- ── 2. Procesar items ───────────────────────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::NUMERIC;
    v_precio_unit := (v_item->>'precio_unitario')::NUMERIC;
    v_subtotal    := v_cantidad * v_precio_unit;
    v_total_dev   := v_total_dev + v_subtotal;

    INSERT INTO public.devolucion_items (
      devolucion_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal,
      comprobante_item_id, detalle_compra_item_id
    ) VALUES (
      v_devolucion_id, p_empresa_id, v_producto_id, v_cantidad, v_precio_unit, v_subtotal,
      NULLIF(v_item->>'comprobante_item_id', '')::UUID,
      NULLIF(v_item->>'detalle_compra_item_id', '')::UUID
    );

    -- Actualizar contador en línea origen
    IF (v_item->>'comprobante_item_id') IS NOT NULL AND (v_item->>'comprobante_item_id') <> '' THEN
      UPDATE public.comprobante_items
      SET cantidad_devuelta = cantidad_devuelta + v_cantidad
      WHERE id = (v_item->>'comprobante_item_id')::UUID;
    END IF;

    IF (v_item->>'detalle_compra_item_id') IS NOT NULL AND (v_item->>'detalle_compra_item_id') <> '' THEN
      UPDATE public.detalle_compras
      SET cantidad_devuelta = cantidad_devuelta + v_cantidad
      WHERE id = (v_item->>'detalle_compra_item_id')::UUID;
    END IF;

    -- ── 3. Reingreso de stock ──────────────────────────────────────────────
    IF p_reingresa_stock THEN
      IF p_tipo = 'cliente' THEN
        UPDATE public.productos
        SET stock_actual = stock_actual + v_cantidad
        WHERE id = v_producto_id AND empresa_id = p_empresa_id;
        INSERT INTO public.movimientos_inventario (
          empresa_id, producto_id, tipo, cantidad, motivo, user_id
        ) VALUES (
          p_empresa_id, v_producto_id, 'ingreso', v_cantidad::INTEGER,
          'Devolucion cliente ' || v_numero_dev, p_user_id
        );
      ELSE
        SELECT stock_actual INTO v_stock_actual_dev
        FROM public.productos
        WHERE id = v_producto_id AND empresa_id = p_empresa_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', v_producto_id;
        END IF;

        IF COALESCE(v_stock_actual_dev, 0) - v_cantidad < 0 THEN
          RAISE EXCEPTION 'Stock insuficiente para devolver al proveedor el producto: %', v_producto_id;
        END IF;

        UPDATE public.productos
        SET stock_actual = stock_actual - v_cantidad
        WHERE id = v_producto_id AND empresa_id = p_empresa_id;
        INSERT INTO public.movimientos_inventario (
          empresa_id, producto_id, tipo, cantidad, motivo, user_id
        ) VALUES (
          p_empresa_id, v_producto_id, 'salida', v_cantidad::INTEGER,
          'Devolucion a proveedor ' || v_numero_dev, p_user_id
        );
      END IF;
    END IF;
  END LOOP;

  -- ── 4. Compensación: Nota de Crédito ──────────────────────────────────
  IF p_compensacion = 'nota_credito' THEN
    v_numero_nc := public.siguiente_numero_documento(
      p_empresa_id, 'comprobantes', 'numero_venta', 'NC'
    );

    SELECT nombre INTO v_cliente_nombre
    FROM public.clientes
    WHERE id = p_cliente_id AND empresa_id = p_empresa_id;

    INSERT INTO public.comprobantes (
      empresa_id, numero_venta, tipo, cliente_id, cliente_nombre, total,
      comprobante_origen_id, motivo_nc, forma_pago, estado_pago
    ) VALUES (
      p_empresa_id, v_numero_nc, 'nota_credito',
      p_cliente_id, COALESCE(v_cliente_nombre, 'Consumidor Final'),
      v_total_dev, p_comprobante_id, p_motivo,
      'Efectivo',
      CASE WHEN p_reembolso_efectivo THEN 'pagada' ELSE 'pendiente' END
    ) RETURNING id INTO v_nc_id;

    -- Items de la NC (replica devolucion_items)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_producto_id := (v_item->>'producto_id')::UUID;
      v_cantidad    := (v_item->>'cantidad')::NUMERIC;
      v_precio_unit := (v_item->>'precio_unitario')::NUMERIC;
      INSERT INTO public.comprobante_items (
        empresa_id, comprobante_id, producto_id,
        cantidad, precio_unitario, subtotal
      ) VALUES (
        p_empresa_id, v_nc_id, v_producto_id,
        v_cantidad::INTEGER, v_precio_unit, v_cantidad * v_precio_unit
      );
    END LOOP;

    -- Impacto financiero
    IF NOT p_reembolso_efectivo THEN
      -- CC HABER → reduce lo que el cliente nos debe
      INSERT INTO public.cuenta_corriente_movimientos (
        empresa_id, cliente_id, tipo, monto, descripcion, comprobante_id
      ) VALUES (
        p_empresa_id, p_cliente_id, 'HABER', v_total_dev,
        'NC ' || v_numero_nc || ' por devolucion ' || v_numero_dev,
        v_nc_id
      );
    ELSE
      -- Reembolso efectivo: verificar caja abierta
      SELECT id INTO v_caja_sesion_id
      FROM public.caja_sesiones
      WHERE empresa_id = p_empresa_id AND estado = 'abierta'
      ORDER BY apertura_fecha DESC LIMIT 1;

      IF v_caja_sesion_id IS NULL THEN
        RAISE EXCEPTION 'Caja cerrada: abri la caja para procesar reembolsos en efectivo';
      END IF;

      INSERT INTO public.movimientos_caja (
        empresa_id, user_id, caja_sesion_id, tipo,
        categoria, concepto, monto, metodo_pago, is_automatic
      ) VALUES (
        p_empresa_id, p_user_id, v_caja_sesion_id,
        CASE WHEN p_tipo = 'cliente' THEN 'egreso' ELSE 'ingreso' END,
        'Devoluciones',
        'Reembolso devolucion ' || v_numero_dev,
        v_total_dev, 'Efectivo', TRUE
      );
    END IF;

    UPDATE public.devoluciones SET nota_credito_id = v_nc_id WHERE id = v_devolucion_id;
  END IF;

  RETURN jsonb_build_object(
    'devolucion_id',     v_devolucion_id,
    'numero_devolucion', v_numero_dev,
    'nota_credito_id',   v_nc_id,
    'numero_nc',         v_numero_nc,
    'total',             v_total_dev
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (comentado):
-- Revertir a siguiente_numero_documento en crear_devolucion:
-- v_numero_dev := public.siguiente_numero_documento(p_empresa_id, 'devoluciones', 'numero_devolucion', 'DEV');
-- ⚠️ Esto reintroduce la race condition. NO revertir sin un fix alternativo.
-- Borrar también las filas de series_numeracion tipo='devolucion' si se hace rollback completo.
