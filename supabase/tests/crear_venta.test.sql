-- pgTAP test: public.crear_venta
--
-- Alcance acotado a lo documentado en el Mapa de escritores de stock_actual
-- (sesión 36): crear_venta es "el más seguro del sistema" — SELECT...FOR
-- UPDATE + validación de stock + UPDATE relativo, todo en una transacción.
-- Este test cubre esa garantía + el guard de tenant, NO los efectos
-- colaterales de caja/cuenta corriente/entrega (fuera de alcance de la
-- auditoría de stock_actual). Se pasa p_pagos vacío y p_es_cc=false para no
-- necesitar fixtures de caja_sesiones.
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/productos de
-- prueba dentro de una transacción que termina en ROLLBACK. Nunca toca
-- empresas ni productos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(5);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: Tenant N (casos 1, 2, 4) + Tenant O (caso 3, guard de tenant).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-bead-0000-0000-000000000001', '__PGTAP_TEST__ Tenant N'),
  ('00000000-c0de-0000-0000-000000000002', '__PGTAP_TEST__ Tenant O');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-bead-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-n@kairox.test', now(), now(), now()),
  ('00000000-c0de-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-o@kairox.test', now(), now(), now());

-- El trigger on_auth_user_created ya insertó la fila en profiles (con
-- empresa_id NULL) al insertar en auth.users arriba — solo hace falta
-- completarla, no insertar de nuevo (insertar de nuevo viola la PK).
UPDATE public.profiles SET empresa_id = '00000000-bead-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-bead-0000-0000-00000000000b';
UPDATE public.profiles SET empresa_id = '00000000-c0de-0000-0000-000000000002', role = 'admin' WHERE id = '00000000-c0de-0000-0000-00000000000c';

INSERT INTO public.productos (id, empresa_id, nombre, stock_actual) VALUES
  ('00000000-bead-0000-0000-0000000000a1', '00000000-bead-0000-0000-000000000001', '__PGTAP_TEST__ Prod N1 (venta normal, stock 10)', 10),
  ('00000000-bead-0000-0000-0000000000a2', '00000000-bead-0000-0000-000000000001', '__PGTAP_TEST__ Prod N2 (stock insuficiente, stock 2)', 2);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-bead-0000-0000-00000000000b","role":"authenticated"}', true);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: venta normal con stock suficiente. Prod N1 stock=10, vender 3 → 7.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_venta(
  p_empresa_id      := '00000000-bead-0000-0000-000000000001'::uuid,
  p_user_id         := '00000000-bead-0000-0000-00000000000b'::uuid,
  p_numero_venta    := 'V-TEST-1',
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
  p_items           := '[{"producto_id":"00000000-bead-0000-0000-0000000000a1","cantidad":3,"subtotal":300,"precio_unitario":100,"alicuota_iva":"21"}]'::jsonb,
  p_pagos           := '[]'::jsonb,
  p_es_cc           := false,
  p_caja_sesion_id  := NULL
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-bead-0000-0000-0000000000a1'),
  7,
  'Caso 1: crear_venta(3) sobre stock=10 deja stock_actual=7'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: guard de stock insuficiente. Prod N2 stock=2, intentar vender 5 →
-- debe fallar y el stock NO debe modificarse.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.crear_venta(
       p_empresa_id      := '00000000-bead-0000-0000-000000000001'::uuid,
       p_user_id         := '00000000-bead-0000-0000-00000000000b'::uuid,
       p_numero_venta    := 'V-TEST-2',
       p_fecha           := now(),
       p_cliente_id      := NULL,
       p_cliente_nombre  := 'Consumidor Final',
       p_total           := 500,
       p_forma_pago      := 'Efectivo',
       p_estado_pago     := 'pagada',
       p_moneda          := 'ARS',
       p_tipo_cambio_tasa:= 1,
       p_monto_paralelo  := NULL,
       p_tc_paralelo     := NULL,
       p_items           := '[{"producto_id":"00000000-bead-0000-0000-0000000000a2","cantidad":5,"subtotal":500,"precio_unitario":100,"alicuota_iva":"21"}]'::jsonb,
       p_pagos           := '[]'::jsonb,
       p_es_cc           := false,
       p_caja_sesion_id  := NULL
     ) $$,
  'Stock insuficiente%',
  'Caso 2a: crear_venta bloquea si no hay stock suficiente'
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-bead-0000-0000-0000000000a2'),
  2,
  'Caso 2b: stock_actual de N2 no cambio tras el intento bloqueado (sigue en 2)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: guard de tenant. Impersonando al usuario de Tenant N, pasar
-- p_empresa_id de Tenant O.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.crear_venta(
       p_empresa_id      := '00000000-c0de-0000-0000-000000000002'::uuid,
       p_user_id         := '00000000-bead-0000-0000-00000000000b'::uuid,
       p_numero_venta    := 'V-TEST-3',
       p_fecha           := now(),
       p_cliente_id      := NULL,
       p_cliente_nombre  := 'Consumidor Final',
       p_total           := 100,
       p_forma_pago      := 'Efectivo',
       p_estado_pago     := 'pagada',
       p_moneda          := 'ARS',
       p_tipo_cambio_tasa:= 1,
       p_monto_paralelo  := NULL,
       p_tc_paralelo     := NULL,
       p_items           := '[{"producto_id":"00000000-bead-0000-0000-0000000000a1","cantidad":1,"subtotal":100,"precio_unitario":100,"alicuota_iva":"21"}]'::jsonb,
       p_pagos           := '[]'::jsonb,
       p_es_cc           := false,
       p_caja_sesion_id  := NULL
     ) $$,
  'Acceso denegado%',
  'Caso 3: crear_venta bloquea si p_empresa_id no coincide con el usuario autenticado'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: trazabilidad. La venta exitosa del Caso 1 ¿generó exactamente 1
-- movimiento de inventario tipo salida cantidad 3?
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_inventario
   WHERE producto_id = '00000000-bead-0000-0000-0000000000a1' AND tipo = 'salida' AND cantidad = 3),
  1,
  'Caso 4: crear_venta genera exactamente 1 movimiento de inventario tipo salida cantidad 3'
);

SELECT * FROM finish();

ROLLBACK;
