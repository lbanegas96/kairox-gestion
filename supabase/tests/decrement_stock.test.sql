-- pgTAP test: public.decrement_stock
--
-- decrement_stock es dead code hoy (sin caller en src/, ver CONTEXT.md sesión 36),
-- pero es el patrón "seguro" de referencia: UPDATE relativo + valida negativo
-- DESPUÉS del UPDATE (si negativo, el RAISE revierte toda la función — la
-- atomicidad de una sola declaración SQL hace que el UPDATE parcial no persista).
--
-- Sesión 42 (migration 062): agrega p_motivo opcional + INSERT en
-- movimientos_inventario (tipo 'salida') — antes actualizaba stock_actual sin
-- dejar ningún rastro en el historial de movimientos.
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/productos de
-- prueba dentro de una transacción que termina en ROLLBACK. Nunca toca empresas
-- ni productos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: 2 tenants sintéticos (D y E) + 2 productos en D (uno para el caso
-- normal, otro con stock bajo para el guard de negativo) + 1 producto en E
-- (para el guard de tenant).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-dddd-0000-0000-000000000001', '__PGTAP_TEST__ Tenant D'),
  ('00000000-eeee-0000-0000-000000000002', '__PGTAP_TEST__ Tenant E');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-dddd-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-d@kairox.test', now(), now(), now()),
  ('00000000-eeee-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-e@kairox.test', now(), now(), now());

INSERT INTO public.profiles (id, empresa_id, email) VALUES
  ('00000000-dddd-0000-0000-00000000000d', '00000000-dddd-0000-0000-000000000001', 'pgtap-test-d@kairox.test'),
  ('00000000-eeee-0000-0000-00000000000e', '00000000-eeee-0000-0000-000000000002', 'pgtap-test-e@kairox.test');

INSERT INTO public.productos (id, empresa_id, nombre, stock_actual) VALUES
  ('00000000-dddd-0000-0000-0000000000d1', '00000000-dddd-0000-0000-000000000001', '__PGTAP_TEST__ Producto D1 (stock 10)', 10),
  ('00000000-dddd-0000-0000-0000000000d2', '00000000-dddd-0000-0000-000000000001', '__PGTAP_TEST__ Producto D2 (stock 2)', 2),
  ('00000000-eeee-0000-0000-0000000000e1', '00000000-eeee-0000-0000-000000000002', '__PGTAP_TEST__ Producto E1 (de otro tenant)', 5);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-dddd-0000-0000-00000000000d","role":"authenticated"}', true);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: decremento normal. Producto D1 stock=10, decrementar 3 → 7.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.decrement_stock('00000000-dddd-0000-0000-0000000000d1'::uuid, 3, 'Test pgTAP: decremento normal');

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-dddd-0000-0000-0000000000d1'),
  7,
  'Caso 1: decrement_stock(3) sobre stock=10 deja stock_actual=7'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: guard de negativo. Producto D2 stock=2, intentar decrementar 5 →
-- debe fallar y el stock NO debe modificarse (el RAISE revierte el UPDATE
-- parcial porque todo ocurre dentro de la misma declaración SQL atómica).
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.decrement_stock('00000000-dddd-0000-0000-0000000000d2'::uuid, 5) $$,
  'Stock insuficiente%',
  'Caso 2a: decrement_stock bloquea si el resultado seria negativo'
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-dddd-0000-0000-0000000000d2'),
  2,
  'Caso 2b: stock_actual de D2 no cambio tras el intento bloqueado (sigue en 2)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: guard de tenant. Impersonando al usuario de Tenant D, intentar
-- decrementar un producto que pertenece a Tenant E.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.decrement_stock('00000000-eeee-0000-0000-0000000000e1'::uuid, 1) $$,
  'Producto no encontrado o sin permiso%',
  'Caso 3: decrement_stock bloquea cross-tenant (Tenant D no puede tocar producto de Tenant E)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: movimiento de inventario. El decremento exitoso del Caso 1 ¿generó
-- una fila en movimientos_inventario con el motivo pasado como parámetro?
-- (Sesión 42 / migration 062 — antes esta fila no se generaba.)
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_inventario
   WHERE producto_id = '00000000-dddd-0000-0000-0000000000d1' AND tipo = 'salida' AND cantidad = 3),
  1,
  'Caso 4a: decrement_stock genera un movimiento de inventario tipo salida cantidad 3'
);

SELECT is(
  (SELECT motivo FROM public.movimientos_inventario
   WHERE producto_id = '00000000-dddd-0000-0000-0000000000d1' AND tipo = 'salida' AND cantidad = 3),
  'Test pgTAP: decremento normal',
  'Caso 4b: el motivo pasado como parametro queda guardado en el movimiento'
);

SELECT * FROM finish();

ROLLBACK;
