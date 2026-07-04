-- pgTAP test: public.crear_entrega
--
-- Mismo patrón que crear_venta: SELECT...FOR UPDATE + validación de stock +
-- UPDATE relativo, todo en una transacción (Mapa de escritores de
-- stock_actual, sesión 36). Único caller real: GenerarEntregaModal.jsx
-- (confirmado por grep fresco).
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/productos/
-- pedidos de prueba dentro de una transacción que termina en ROLLBACK. Nunca
-- toca empresas ni productos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(7);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: Tenant P (casos 1, 2, 4) + Tenant Q (caso 3, guard de tenant).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-feeb-0000-0000-000000000001', '__PGTAP_TEST__ Tenant P'),
  ('00000000-deed-0000-0000-000000000002', '__PGTAP_TEST__ Tenant Q');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-feeb-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-p@kairox.test', now(), now(), now()),
  ('00000000-deed-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-q@kairox.test', now(), now(), now());

-- El trigger on_auth_user_created ya insertó la fila en profiles (con
-- empresa_id NULL) al insertar en auth.users arriba — solo hace falta
-- completarla, no insertar de nuevo (insertar de nuevo viola la PK).
UPDATE public.profiles SET empresa_id = '00000000-feeb-0000-0000-000000000001' WHERE id = '00000000-feeb-0000-0000-00000000000f';
UPDATE public.profiles SET empresa_id = '00000000-deed-0000-0000-000000000002' WHERE id = '00000000-deed-0000-0000-00000000000d';

INSERT INTO public.clientes (id, empresa_id, nombre) VALUES
  ('00000000-feeb-0000-0000-0000000000c1', '00000000-feeb-0000-0000-000000000001', '__PGTAP_TEST__ Cliente P1');

INSERT INTO public.pedidos (id, empresa_id, user_id, numero, cliente_id) VALUES
  ('00000000-feeb-0000-0000-0000000000d1', '00000000-feeb-0000-0000-000000000001', '00000000-feeb-0000-0000-00000000000f', 'PED-TEST-1', '00000000-feeb-0000-0000-0000000000c1');

INSERT INTO public.productos (id, empresa_id, nombre, stock_actual) VALUES
  ('00000000-feeb-0000-0000-0000000000a1', '00000000-feeb-0000-0000-000000000001', '__PGTAP_TEST__ Prod P1 (entrega normal, stock 10)', 10),
  ('00000000-feeb-0000-0000-0000000000a2', '00000000-feeb-0000-0000-000000000001', '__PGTAP_TEST__ Prod P2 (stock insuficiente, stock 2)', 2),
  ('00000000-feeb-0000-0000-0000000000a3', '00000000-feeb-0000-0000-000000000001', '__PGTAP_TEST__ Prod P3 (guard sobre-entrega, stock 100)', 100);

INSERT INTO public.pedido_items (id, pedido_id, empresa_id, producto_id, descripcion, cantidad, precio_unitario, subtotal, cantidad_entregada) VALUES
  ('00000000-feeb-0000-0000-0000000000e1', '00000000-feeb-0000-0000-0000000000d1', '00000000-feeb-0000-0000-000000000001', '00000000-feeb-0000-0000-0000000000a3', 'TEST item P3', 2, 100, 200, 0);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-feeb-0000-0000-00000000000f","role":"authenticated"}', true);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: entrega normal con stock suficiente. Prod P1 stock=10, entregar 3
-- → 7.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_entrega(
  '00000000-feeb-0000-0000-000000000001'::uuid,
  '00000000-feeb-0000-0000-00000000000f'::uuid,
  '00000000-feeb-0000-0000-0000000000d1'::uuid,
  '[{"producto_id":"00000000-feeb-0000-0000-0000000000a1","cantidad":3}]'::jsonb
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-feeb-0000-0000-0000000000a1'),
  7,
  'Caso 1: crear_entrega(3) sobre stock=10 deja stock_actual=7'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: guard de stock insuficiente. Prod P2 stock=2, intentar entregar 5
-- → debe fallar y el stock NO debe modificarse.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.crear_entrega(
       '00000000-feeb-0000-0000-000000000001'::uuid,
       '00000000-feeb-0000-0000-00000000000f'::uuid,
       '00000000-feeb-0000-0000-0000000000d1'::uuid,
       '[{"producto_id":"00000000-feeb-0000-0000-0000000000a2","cantidad":5}]'::jsonb
     ) $$,
  'Stock insuficiente%',
  'Caso 2a: crear_entrega bloquea si no hay stock suficiente'
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-feeb-0000-0000-0000000000a2'),
  2,
  'Caso 2b: stock_actual de P2 no cambio tras el intento bloqueado (sigue en 2)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: guard de tenant. Impersonando al usuario de Tenant P, pasar
-- p_empresa_id de Tenant Q.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.crear_entrega(
       '00000000-deed-0000-0000-000000000002'::uuid,
       '00000000-feeb-0000-0000-00000000000f'::uuid,
       '00000000-feeb-0000-0000-0000000000d1'::uuid,
       '[{"producto_id":"00000000-feeb-0000-0000-0000000000a1","cantidad":1}]'::jsonb
     ) $$,
  'Acceso denegado%',
  'Caso 3: crear_entrega bloquea si p_empresa_id no coincide con el usuario autenticado'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: trazabilidad. La entrega exitosa del Caso 1 ¿generó exactamente 1
-- movimiento de inventario tipo salida cantidad 3?
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_inventario
   WHERE producto_id = '00000000-feeb-0000-0000-0000000000a1' AND tipo = 'salida' AND cantidad = 3),
  1,
  'Caso 4: crear_entrega genera exactamente 1 movimiento de inventario tipo salida cantidad 3'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 5: guard de sobre-entrega. pedido_item de P3 tiene cantidad=2. Entregar
-- 2 (completo) debe funcionar; entregar 1 más después debe bloquear.
-- ───────────────────────────────────────────────────────────────────────────

SELECT lives_ok(
  $$ SELECT public.crear_entrega(
       '00000000-feeb-0000-0000-000000000001'::uuid,
       '00000000-feeb-0000-0000-00000000000f'::uuid,
       '00000000-feeb-0000-0000-0000000000d1'::uuid,
       '[{"producto_id":"00000000-feeb-0000-0000-0000000000a3","cantidad":2,"pedido_item_id":"00000000-feeb-0000-0000-0000000000e1"}]'::jsonb
     ) $$,
  'Caso 5a: entrega completa (2 de 2 pedidos) funciona'
);

SELECT throws_like(
  $$ SELECT public.crear_entrega(
       '00000000-feeb-0000-0000-000000000001'::uuid,
       '00000000-feeb-0000-0000-00000000000f'::uuid,
       '00000000-feeb-0000-0000-0000000000d1'::uuid,
       '[{"producto_id":"00000000-feeb-0000-0000-0000000000a3","cantidad":1,"pedido_item_id":"00000000-feeb-0000-0000-0000000000e1"}]'::jsonb
     ) $$,
  'Sobre-entrega%',
  'Caso 5b: crear_entrega bloquea sobre-entrega cuando ya se entregó todo lo pedido'
);

SELECT * FROM finish();

ROLLBACK;
