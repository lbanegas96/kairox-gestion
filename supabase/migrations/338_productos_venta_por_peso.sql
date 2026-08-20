-- Migration 338 — Modelo de datos para "productos pesables" (venta por peso/volumen).
-- Bloque 1 de 4 (Nadia, 20/08) — pensado para verdulerías/fiambrerías/panaderías,
-- sumado al target actual de ferreterías/distribuidoras. Solo esquema — no toca
-- crear_venta ni ningún frontend todavía (eso es Bloque 3), a propósito: se prueba
-- insertando un producto pesable de test SIN pasar por el flujo de venta real.
--
-- AUDITORÍA PREVIA (resumen, ver hilo completo para el detalle):
--   * codigo_barras ya es nullable — nada que tocar ahí.
--   * unidad_medida_id ya tira del maestro `unidades_medida` (mig.188, con
--     magnitud masa/volumen/longitud/cantidad + factor_base) — se reusa tal cual
--     para el selector de kg/g/lt/ml, no se crea un maestro nuevo.
--   * unidad_venta_id/factor_conversion_venta/precio_venta_pack (mig.189) es el
--     sistema de VENTA POR PACK ("1 Caja = 12 unidades enteras") — a propósito
--     NO se toca ni se reusa acá, es un caso de uso distinto (pack vs. peso
--     fraccionario). tipo_venta/precio_por_kg_litro son campos nuevos, separados.
--   * codigo_afip_unidad es metadata simple SIN lógica asociada por ahora —
--     confirmado que WSFEv1 (AFIP/ARCA) hoy manda solo totales por alícuota, no
--     itemiza renglones (ver comentario de mig.189 y `_shared/wsfe.ts`) — no hace
--     falta tocar nada del módulo AFIP en este bloque. Si en el futuro se itemizan
--     facturas (proyecto aparte), ahí se activa.
--   * De las columnas `cantidad`/`stock_*` en integer, ya estaban en
--     numeric(12,3) por otra necesidad (entrega parcial): pedido_items,
--     entrega_items, devolucion_items. Faltan las 5 de abajo.
--   * RLS: las policies de las 4 tablas tocadas son a nivel de fila
--     (empresa_id = get_my_empresa_id()), no por columna — cubren los campos/
--     tipos nuevos sin cambios, confirmado con pg_policies antes de escribir esto.
--   * Sin CHECK constraints, triggers con lógica dependiente del tipo, ni
--     vistas/funciones haciendo división entera sobre estas 5 columnas —
--     confirmado antes de tocar nada (grep + pg_constraint + information_schema.triggers).
--   * Único efecto colateral conocido, no bloqueante: `stock_actual` ahora puede
--     viajar con decimales al worker de sync de stock a MercadoLibre/Tiendanube
--     (mig. de integraciones) si algún día se mapea un producto pesable a esos
--     canales — ninguno vende por peso hoy, se revisa si aparece el caso real.
--
-- Nada de esto rompe lo que ya funciona: default 'unidad' para todo lo existente,
-- sin backfill real (los enteros ya guardados son válidos como numeric(12,3) tal
-- cual, con .000 implícito).
--
-- ROLLBACK:
--   ALTER TABLE public.productos
--     DROP COLUMN IF EXISTS tipo_venta,
--     DROP COLUMN IF EXISTS precio_por_kg_litro,
--     DROP COLUMN IF EXISTS codigo_afip_unidad;
--   ALTER TABLE public.productos ALTER COLUMN stock_actual TYPE INTEGER USING stock_actual::INTEGER;
--   ALTER TABLE public.productos ALTER COLUMN stock_minimo TYPE INTEGER USING stock_minimo::INTEGER;
--   ALTER TABLE public.comprobante_items ALTER COLUMN cantidad TYPE INTEGER USING cantidad::INTEGER;
--   ALTER TABLE public.movimientos_inventario ALTER COLUMN cantidad TYPE INTEGER USING cantidad::INTEGER;
--   ALTER TABLE public.detalle_compras ALTER COLUMN cantidad TYPE INTEGER USING cantidad::INTEGER;
--   (los ALTER COLUMN TYPE de vuelta a INTEGER fallan si para entonces ya hay
--   cantidades fraccionarias reales guardadas — revisar antes de correr el rollback)

-- ─── productos: tipo de venta + precio por kg/litro + metadata AFIP ─────────────
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS tipo_venta TEXT NOT NULL DEFAULT 'unidad'
    CHECK (tipo_venta IN ('unidad', 'peso', 'volumen')),
  ADD COLUMN IF NOT EXISTS precio_por_kg_litro NUMERIC(12, 2)
    CHECK (precio_por_kg_litro IS NULL OR precio_por_kg_litro >= 0),
  ADD COLUMN IF NOT EXISTS codigo_afip_unidad SMALLINT;

COMMENT ON COLUMN public.productos.tipo_venta IS
  'unidad = venta entera de siempre (default, no rompe nada existente). peso/volumen = producto pesable, cantidad en el carrito admite decimales (kg/lt).';
COMMENT ON COLUMN public.productos.precio_por_kg_litro IS
  'Solo aplica si tipo_venta <> unidad. Nullable a propósito: no se fuerza consistencia con tipo_venta en este bloque, la carga guiada la hace el frontend (Bloque 2).';
COMMENT ON COLUMN public.productos.codigo_afip_unidad IS
  'Metadata interna, SIN lógica asociada todavía (WSFEv1 hoy no itemiza renglones de factura, no lo consume nada). Referencia: tabla de unidades de medida de AFIP (01=kg, 05=litros, 07=unidad, etc.) — se activa si en el futuro se itemizan facturas.';

-- ─── Cantidad fraccionaria: las 5 columnas que faltaban (integer → numeric) ─────
-- Mismo precision/scale que pedido_items/entrega_items/devolucion_items, que ya
-- estaban en numeric(12,3) por otra necesidad — se iguala el resto de la cascada.
--
-- stock_actual: Postgres no deja hacer ALTER COLUMN TYPE mientras exista un
-- trigger con lista de columnas explícita sobre esa columna (encontrado
-- simulando esta migración con BEGIN...ROLLBACK antes de aplicar nada):
--   trg_queue_stock_canales AFTER UPDATE OF stock_actual ON productos
--     EXECUTE FUNCTION fn_queue_stock_canales()
-- (encola sync de stock a MercadoLibre/Tiendanube). Se recrea idéntico después
-- del ALTER — mismo nombre, mismo timing, misma función, cero cambio de
-- comportamiento.
DROP TRIGGER IF EXISTS trg_queue_stock_canales ON public.productos;

ALTER TABLE public.productos
  ALTER COLUMN stock_actual TYPE NUMERIC(12, 3) USING stock_actual::NUMERIC(12, 3),
  ALTER COLUMN stock_minimo TYPE NUMERIC(12, 3) USING stock_minimo::NUMERIC(12, 3);

CREATE TRIGGER trg_queue_stock_canales
  AFTER UPDATE OF stock_actual ON public.productos
  FOR EACH ROW EXECUTE FUNCTION public.fn_queue_stock_canales();

ALTER TABLE public.comprobante_items
  ALTER COLUMN cantidad TYPE NUMERIC(12, 3) USING cantidad::NUMERIC(12, 3);

ALTER TABLE public.movimientos_inventario
  ALTER COLUMN cantidad TYPE NUMERIC(12, 3) USING cantidad::NUMERIC(12, 3);

ALTER TABLE public.detalle_compras
  ALTER COLUMN cantidad TYPE NUMERIC(12, 3) USING cantidad::NUMERIC(12, 3);
