-- pgTAP test: public.crear_devolucion
--
-- La rama "devolución a proveedor" (reingresa_stock=true, tipo!='cliente')
-- tenía un riesgo latente documentado en sesión 36 y resuelto en sesión 39
-- (migration 060): podía dejar stock_actual negativo, sin lock previo. El
-- Caso 3 de este archivo versiona esa verificación (ya hecha a mano en
-- sesión 39). Se usa p_compensacion='pendiente' (default) en todos los casos
-- para no necesitar fixtures de nota de crédito / caja_sesiones — fuera de
-- alcance de la auditoría de stock_actual.
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/productos de
-- prueba dentro de una transacción que termina en ROLLBACK. Nunca toca
-- empresas ni productos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: Tenant R (casos 1, 2, 3, 5, 6) + Tenant S (caso 4, guard tenant).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-fade-0000-0000-000000000001', '__PGTAP_TEST__ Tenant R'),
  ('00000000-aff0-0000-0000-000000000002', '__PGTAP_TEST__ Tenant S');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-fade-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-r@kairox.test', now(), now(), now()),
  ('00000000-aff0-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-s@kairox.test', now(), now(), now());

INSERT INTO public.profiles (id, empresa_id, email) VALUES
  ('00000000-fade-0000-0000-00000000000f', '00000000-fade-0000-0000-000000000001', 'pgtap-test-r@kairox.test'),
  ('00000000-aff0-0000-0000-00000000000a', '00000000-aff0-0000-0000-000000000002', 'pgtap-test-s@kairox.test');

INSERT INTO public.productos (id, empresa_id, nombre, stock_actual) VALUES
  ('00000000-fade-0000-0000-0000000000a1', '00000000-fade-0000-0000-000000000001', '__PGTAP_TEST__ Prod R1 (devolucion cliente, stock 10)', 10),
  ('00000000-fade-0000-0000-0000000000a2', '00000000-fade-0000-0000-000000000001', '__PGTAP_TEST__ Prod R2 (devolucion proveedor normal, stock 10)', 10),
  ('00000000-fade-0000-0000-0000000000a3', '00000000-fade-0000-0000-000000000001', '__PGTAP_TEST__ Prod R3 (guard negativo proveedor, stock 2)', 2),
  ('00000000-fade-0000-0000-0000000000a5', '00000000-fade-0000-0000-000000000001', '__PGTAP_TEST__ Prod R5 (reingresa_stock=false, stock 10)', 10);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-fade-0000-0000-00000000000f","role":"authenticated"}', true);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: devolución de cliente con reingreso de stock. Prod R1 stock=10,
-- devolver 3 → 13 (incremento).
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_devolucion(
  p_empresa_id      := '00000000-fade-0000-0000-000000000001'::uuid,
  p_user_id         := '00000000-fade-0000-0000-00000000000f'::uuid,
  p_tipo            := 'cliente',
  p_items           := '[{"producto_id":"00000000-fade-0000-0000-0000000000a1","cantidad":3,"precio_unitario":100}]'::jsonb,
  p_reingresa_stock := true
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-fade-0000-0000-0000000000a1'),
  13,
  'Caso 1: devolucion de cliente con reingreso deja stock_actual=13 (10+3)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: devolución a proveedor, normal (con stock suficiente). Prod R2
-- stock=10, devolver 4 → 6 (decremento).
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_devolucion(
  p_empresa_id      := '00000000-fade-0000-0000-000000000001'::uuid,
  p_user_id         := '00000000-fade-0000-0000-00000000000f'::uuid,
  p_tipo            := 'proveedor',
  p_items           := '[{"producto_id":"00000000-fade-0000-0000-0000000000a2","cantidad":4,"precio_unitario":100}]'::jsonb,
  p_reingresa_stock := true
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-fade-0000-0000-0000000000a2'),
  6,
  'Caso 2: devolucion a proveedor normal deja stock_actual=6 (10-4)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3 (REGRESION sesion 39 / migration 060): guard de negativo en la rama
-- proveedor. Prod R3 stock=2, intentar devolver 5 → debe fallar y el stock
-- NO debe modificarse.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.crear_devolucion(
       p_empresa_id      := '00000000-fade-0000-0000-000000000001'::uuid,
       p_user_id         := '00000000-fade-0000-0000-00000000000f'::uuid,
       p_tipo            := 'proveedor',
       p_items           := '[{"producto_id":"00000000-fade-0000-0000-0000000000a3","cantidad":5,"precio_unitario":100}]'::jsonb,
       p_reingresa_stock := true
     ) $$,
  'Stock insuficiente para devolver al proveedor%',
  'Caso 3a (REGRESION sesion 39): crear_devolucion bloquea devolucion a proveedor que dejaria stock negativo'
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-fade-0000-0000-0000000000a3'),
  2,
  'Caso 3b: stock_actual de R3 no cambio tras el intento bloqueado (sigue en 2)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: guard de tenant.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.crear_devolucion(
       p_empresa_id      := '00000000-aff0-0000-0000-000000000002'::uuid,
       p_user_id         := '00000000-fade-0000-0000-00000000000f'::uuid,
       p_tipo            := 'cliente',
       p_items           := '[{"producto_id":"00000000-fade-0000-0000-0000000000a1","cantidad":1,"precio_unitario":100}]'::jsonb,
       p_reingresa_stock := true
     ) $$,
  'No autorizado%',
  'Caso 4: crear_devolucion bloquea si p_empresa_id no coincide con el usuario autenticado'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 5: reingresa_stock=false. Prod R5 stock=10, devolver 7 SIN reingresar
-- → stock NO debe cambiar (la rama de stock se omite por completo).
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_devolucion(
  p_empresa_id      := '00000000-fade-0000-0000-000000000001'::uuid,
  p_user_id         := '00000000-fade-0000-0000-00000000000f'::uuid,
  p_tipo            := 'cliente',
  p_items           := '[{"producto_id":"00000000-fade-0000-0000-0000000000a5","cantidad":7,"precio_unitario":100}]'::jsonb,
  p_reingresa_stock := false
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-fade-0000-0000-0000000000a5'),
  10,
  'Caso 5: con reingresa_stock=false, stock_actual NO cambia (sigue en 10)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 6: trazabilidad. Las devoluciones exitosas con reingreso (Casos 1 y 2)
-- ¿generaron exactamente 1 movimiento de inventario cada una, con el tipo
-- correcto ('ingreso' para cliente, 'salida' para proveedor)?
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_inventario
   WHERE producto_id = '00000000-fade-0000-0000-0000000000a1' AND tipo = 'ingreso' AND cantidad = 3),
  1,
  'Caso 6a: devolucion de cliente genera exactamente 1 movimiento tipo ingreso cantidad 3'
);

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_inventario
   WHERE producto_id = '00000000-fade-0000-0000-0000000000a2' AND tipo = 'salida' AND cantidad = 4),
  1,
  'Caso 6b: devolucion a proveedor genera exactamente 1 movimiento tipo salida cantidad 4'
);

SELECT * FROM finish();

ROLLBACK;
