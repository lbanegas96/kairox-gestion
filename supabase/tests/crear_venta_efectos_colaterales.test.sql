-- pgTAP test: public.crear_venta — efectos colaterales (Fase 2, sección 4 del
-- PLAN_SEMANA.md).
--
-- crear_venta.test.sql ya cubre stock_actual + guards (tenant, stock
-- insuficiente). Este archivo cubre lo que ESE test deja fuera de alcance a
-- propósito: movimientos_caja, cuenta_corriente_movimientos y la lógica de
-- entrega (implícita vs. reconciliación con una entrega manual existente).
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/productos/
-- pedidos de prueba dentro de una transacción que termina en ROLLBACK. Nunca
-- toca empresas ni productos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(10);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: Tenant R, un cliente, un pedido (para el caso de entrega manual)
-- y 5 productos (uno por caso que necesita su propio stock).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-cafe-0000-0000-000000000001', '__PGTAP_TEST__ Tenant R');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-cafe-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-r@kairox.test', now(), now(), now());

-- El trigger on_auth_user_created ya insertó la fila en profiles (con
-- empresa_id NULL) al insertar en auth.users arriba — solo hace falta
-- completarla, no insertar de nuevo (insertar de nuevo viola la PK).
UPDATE public.profiles SET empresa_id = '00000000-cafe-0000-0000-000000000001', role = 'admin'
WHERE id = '00000000-cafe-0000-0000-00000000000c';

INSERT INTO public.clientes (id, empresa_id, nombre) VALUES
  ('00000000-cafe-0000-0000-0000000000c1', '00000000-cafe-0000-0000-000000000001', '__PGTAP_TEST__ Cliente R1');

INSERT INTO public.pedidos (id, empresa_id, user_id, numero, cliente_id) VALUES
  ('00000000-cafe-0000-0000-0000000000d1', '00000000-cafe-0000-0000-000000000001', '00000000-cafe-0000-0000-00000000000c', 'PED-TEST-CC1', '00000000-cafe-0000-0000-0000000000c1');

-- Entrega manual ya hecha para ese pedido (p.ej. "entrega contra pedido"
-- generada desde GenerarEntregaModal ANTES de facturar) — todavía no tiene
-- comprobante_id porque la venta que la factura es justamente la que vamos
-- a crear en el Caso 6.
INSERT INTO public.entregas (id, empresa_id, user_id, numero_entrega, cliente_id, origen, estado, pedido_id) VALUES
  ('00000000-cafe-0000-0000-0000000000e1', '00000000-cafe-0000-0000-000000000001', '00000000-cafe-0000-0000-00000000000c', 'ENT-TEST-MANUAL-1', '00000000-cafe-0000-0000-0000000000c1', 'manual', 'entregado', '00000000-cafe-0000-0000-0000000000d1');

INSERT INTO public.productos (id, empresa_id, nombre, stock_actual) VALUES
  ('00000000-cafe-0000-0000-0000000000a1', '00000000-cafe-0000-0000-000000000001', '__PGTAP_TEST__ Prod R1 (pago Efectivo)', 10),
  ('00000000-cafe-0000-0000-0000000000a2', '00000000-cafe-0000-0000-000000000001', '__PGTAP_TEST__ Prod R2 (pago Cuenta Corriente)', 10),
  ('00000000-cafe-0000-0000-0000000000a3', '00000000-cafe-0000-0000-000000000001', '__PGTAP_TEST__ Prod R3 (es_cc=true)', 10),
  ('00000000-cafe-0000-0000-0000000000a4', '00000000-cafe-0000-0000-000000000001', '__PGTAP_TEST__ Prod R4 (es_cc=false)', 10),
  ('00000000-cafe-0000-0000-0000000000a5', '00000000-cafe-0000-0000-000000000001', '__PGTAP_TEST__ Prod R5 (entrega implicita)', 10),
  ('00000000-cafe-0000-0000-0000000000a6', '00000000-cafe-0000-0000-000000000001', '__PGTAP_TEST__ Prod R6 (reconciliar entrega manual)', 10);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-cafe-0000-0000-00000000000c","role":"authenticated"}', true);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: pago "Efectivo" en p_pagos → debe generar 1 movimiento_caja
-- ingreso/Venta por el monto del pago.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_venta(
  p_empresa_id      := '00000000-cafe-0000-0000-000000000001'::uuid,
  p_user_id         := '00000000-cafe-0000-0000-00000000000c'::uuid,
  p_numero_venta    := 'V-CASO1',
  p_fecha           := now(),
  p_cliente_id      := NULL,
  p_cliente_nombre  := 'Consumidor Final',
  p_total           := 300,
  p_forma_pago      := 'Efectivo',
  p_estado_pago     := 'pagada',
  p_moneda          := 'ARS',
  p_tipo_cambio_tasa:= 1,
  p_monto_paralelo  := NULL,
  p_tc_paralelo     := NULL,
  p_items           := '[{"producto_id":"00000000-cafe-0000-0000-0000000000a1","cantidad":1,"subtotal":300,"precio_unitario":300,"alicuota_iva":"21"}]'::jsonb,
  p_pagos           := '[{"metodo":"Efectivo","monto":300}]'::jsonb,
  p_es_cc           := false,
  p_caja_sesion_id  := NULL
);

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_caja
   WHERE empresa_id = '00000000-cafe-0000-0000-000000000001'
     AND concepto = 'Venta #V-CASO1' AND tipo = 'ingreso' AND categoria = 'Venta'
     AND monto = 300 AND metodo_pago = 'Efectivo' AND is_automatic = true),
  1,
  'Caso 1: pago Efectivo genera exactamente 1 movimiento_caja ingreso/Venta por 300'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: pago "Cuenta Corriente" en p_pagos → NO debe generar movimiento_caja
-- (el loop de pagos lo excluye explícitamente, es deuda, no caja).
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_venta(
  p_empresa_id      := '00000000-cafe-0000-0000-000000000001'::uuid,
  p_user_id         := '00000000-cafe-0000-0000-00000000000c'::uuid,
  p_numero_venta    := 'V-CASO2',
  p_fecha           := now(),
  p_cliente_id      := '00000000-cafe-0000-0000-0000000000c1'::uuid,
  p_cliente_nombre  := '__PGTAP_TEST__ Cliente R1',
  p_total           := 300,
  p_forma_pago      := 'Cuenta Corriente',
  p_estado_pago     := 'pendiente',
  p_moneda          := 'ARS',
  p_tipo_cambio_tasa:= 1,
  p_monto_paralelo  := NULL,
  p_tc_paralelo     := NULL,
  p_items           := '[{"producto_id":"00000000-cafe-0000-0000-0000000000a2","cantidad":1,"subtotal":300,"precio_unitario":300,"alicuota_iva":"21"}]'::jsonb,
  p_pagos           := '[{"metodo":"Cuenta Corriente","monto":300}]'::jsonb,
  p_es_cc           := true,
  p_caja_sesion_id  := NULL
);

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_caja WHERE concepto = 'Venta #V-CASO2'),
  0,
  'Caso 2: pago Cuenta Corriente NO genera movimiento_caja'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: p_es_cc=true + cliente → debe generar 1 cuenta_corriente_movimientos
-- DEBE por p_total, asociado al comprobante creado.
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.cuenta_corriente_movimientos ccm
   JOIN public.comprobantes c ON c.id = ccm.comprobante_id
   WHERE ccm.cliente_id = '00000000-cafe-0000-0000-0000000000c1'
     AND ccm.tipo = 'DEBE' AND ccm.monto = 300
     AND c.numero_venta = 'V-CASO2'),
  1,
  'Caso 3: es_cc=true genera 1 movimiento DEBE en cuenta corriente por el total, ligado al comprobante'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: p_es_cc=false con cliente → NO debe tocar cuenta_corriente_movimientos
-- aunque haya cliente_id (la cuenta corriente es opt-in, no automática).
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_venta(
  p_empresa_id      := '00000000-cafe-0000-0000-000000000001'::uuid,
  p_user_id         := '00000000-cafe-0000-0000-00000000000c'::uuid,
  p_numero_venta    := 'V-CASO4',
  p_fecha           := now(),
  p_cliente_id      := '00000000-cafe-0000-0000-0000000000c1'::uuid,
  p_cliente_nombre  := '__PGTAP_TEST__ Cliente R1',
  p_total           := 200,
  p_forma_pago      := 'Efectivo',
  p_estado_pago     := 'pagada',
  p_moneda          := 'ARS',
  p_tipo_cambio_tasa:= 1,
  p_monto_paralelo  := NULL,
  p_tc_paralelo     := NULL,
  p_items           := '[{"producto_id":"00000000-cafe-0000-0000-0000000000a4","cantidad":1,"subtotal":200,"precio_unitario":200,"alicuota_iva":"21"}]'::jsonb,
  p_pagos           := '[{"metodo":"Efectivo","monto":200}]'::jsonb,
  p_es_cc           := false,
  p_caja_sesion_id  := NULL
);

SELECT is(
  (SELECT count(*)::int FROM public.cuenta_corriente_movimientos WHERE descripcion = 'Venta #V-CASO4'),
  0,
  'Caso 4: es_cc=false NO genera movimiento en cuenta corriente aunque haya cliente_id'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 5: sin p_pedido_id → crear_venta debe generar su propia entrega
-- "implicita" ya entregada, con su entrega_item, y marcar cantidad_entregada
-- en comprobante_items.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_venta(
  p_empresa_id      := '00000000-cafe-0000-0000-000000000001'::uuid,
  p_user_id         := '00000000-cafe-0000-0000-00000000000c'::uuid,
  p_numero_venta    := 'V-CASO5',
  p_fecha           := now(),
  p_cliente_id      := NULL,
  p_cliente_nombre  := 'Consumidor Final',
  p_total           := 400,
  p_forma_pago      := 'Efectivo',
  p_estado_pago     := 'pagada',
  p_moneda          := 'ARS',
  p_tipo_cambio_tasa:= 1,
  p_monto_paralelo  := NULL,
  p_tc_paralelo     := NULL,
  p_items           := '[{"producto_id":"00000000-cafe-0000-0000-0000000000a5","cantidad":2,"subtotal":400,"precio_unitario":200,"alicuota_iva":"21"}]'::jsonb,
  p_pagos           := '[{"metodo":"Efectivo","monto":400}]'::jsonb,
  p_es_cc           := false,
  p_caja_sesion_id  := NULL
);

SELECT is(
  (SELECT count(*)::int FROM public.entregas e
   JOIN public.comprobantes c ON c.id = e.comprobante_id
   WHERE c.numero_venta = 'V-CASO5' AND e.origen = 'implicita' AND e.estado = 'entregado'),
  1,
  'Caso 5a: crear_venta sin pedido genera su propia entrega implicita ya entregada'
);

SELECT is(
  (SELECT ei.cantidad::int FROM public.entrega_items ei
   JOIN public.entregas e ON e.id = ei.entrega_id
   JOIN public.comprobantes c ON c.id = e.comprobante_id
   WHERE c.numero_venta = 'V-CASO5'),
  2,
  'Caso 5b: la entrega implicita tiene su entrega_item con la cantidad vendida (2)'
);

SELECT is(
  (SELECT ci.cantidad_entregada::int FROM public.comprobante_items ci
   JOIN public.comprobantes c ON c.id = ci.comprobante_id
   WHERE c.numero_venta = 'V-CASO5'),
  2,
  'Caso 5c: comprobante_items.cantidad_entregada queda en 2 (igual a lo vendido)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 6: con p_pedido_id de un pedido que YA tiene una entrega manual
-- entregada → crear_venta debe reconciliar (vincular comprobante_id a esa
-- entrega existente) en vez de crear una entrega implicita duplicada.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_venta(
  p_empresa_id      := '00000000-cafe-0000-0000-000000000001'::uuid,
  p_user_id         := '00000000-cafe-0000-0000-00000000000c'::uuid,
  p_numero_venta    := 'V-CASO6',
  p_fecha           := now(),
  p_cliente_id      := '00000000-cafe-0000-0000-0000000000c1'::uuid,
  p_cliente_nombre  := '__PGTAP_TEST__ Cliente R1',
  p_total           := 800,
  p_forma_pago      := 'Efectivo',
  p_estado_pago     := 'pagada',
  p_moneda          := 'ARS',
  p_tipo_cambio_tasa:= 1,
  p_monto_paralelo  := NULL,
  p_tc_paralelo     := NULL,
  p_items           := '[{"producto_id":"00000000-cafe-0000-0000-0000000000a6","cantidad":4,"subtotal":800,"precio_unitario":200,"alicuota_iva":"21"}]'::jsonb,
  p_pagos           := '[{"metodo":"Efectivo","monto":800}]'::jsonb,
  p_es_cc           := false,
  p_caja_sesion_id  := NULL,
  p_pedido_id       := '00000000-cafe-0000-0000-0000000000d1'::uuid
);

SELECT is(
  (SELECT count(*)::int FROM public.entregas WHERE pedido_id = '00000000-cafe-0000-0000-0000000000d1'),
  1,
  'Caso 6a: sigue habiendo 1 sola entrega para ese pedido (no se duplico una implicita)'
);

SELECT is(
  (SELECT c.numero_venta FROM public.entregas e
   JOIN public.comprobantes c ON c.id = e.comprobante_id
   WHERE e.id = '00000000-cafe-0000-0000-0000000000e1'),
  'V-CASO6',
  'Caso 6b: la entrega manual preexistente quedo vinculada al comprobante de V-CASO6'
);

SELECT is(
  (SELECT ci.cantidad_entregada FROM public.comprobante_items ci
   JOIN public.comprobantes c ON c.id = ci.comprobante_id
   WHERE c.numero_venta = 'V-CASO6'),
  4::numeric,
  'Caso 6c: comprobante_items.cantidad_entregada tambien se completa al reconciliar con entrega manual'
);

SELECT * FROM finish();

ROLLBACK;
