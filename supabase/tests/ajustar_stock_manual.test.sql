-- pgTAP test: public.ajustar_stock_manual
--
-- RPC que unificó (sesión 38, migration 059) los 2 caminos redundantes de
-- "ajuste manual de stock" (productosService.adjustStock() + el inline de
-- ProductosSection.jsx). Único punto de entrada hoy desde el modal
-- "Movimiento de Stock". Semántica: entrada/salida son DELTA, ajuste es VALOR
-- ABSOLUTO (inventario físico) — no confundir con increment_stock/
-- decrement_stock, que son siempre delta.
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/productos de
-- prueba dentro de una transacción que termina en ROLLBACK. Nunca toca empresas
-- ni productos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(11);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: Tenant H (la mayoría de los casos) + Tenant I (guard de tenant).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-beef-0000-0000-000000000001', '__PGTAP_TEST__ Tenant H'),
  ('00000000-feed-0000-0000-000000000002', '__PGTAP_TEST__ Tenant I');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-beef-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-h@kairox.test', now(), now(), now()),
  ('00000000-feed-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-i@kairox.test', now(), now(), now());

INSERT INTO public.profiles (id, empresa_id, email) VALUES
  ('00000000-beef-0000-0000-00000000000b', '00000000-beef-0000-0000-000000000001', 'pgtap-test-h@kairox.test'),
  ('00000000-feed-0000-0000-00000000000f', '00000000-feed-0000-0000-000000000002', 'pgtap-test-i@kairox.test');

INSERT INTO public.productos (id, empresa_id, nombre, stock_actual) VALUES
  ('00000000-beef-0000-0000-00000000aa01', '00000000-beef-0000-0000-000000000001', '__PGTAP_TEST__ Producto H1 (stock 10, entrada)', 10),
  ('00000000-beef-0000-0000-00000000aa02', '00000000-beef-0000-0000-000000000001', '__PGTAP_TEST__ Producto H2 (stock 10, salida)', 10),
  ('00000000-beef-0000-0000-00000000aa03', '00000000-beef-0000-0000-000000000001', '__PGTAP_TEST__ Producto H3 (stock 2, salida bloqueada)', 2),
  ('00000000-beef-0000-0000-00000000aa04', '00000000-beef-0000-0000-000000000001', '__PGTAP_TEST__ Producto H4 (stock 10, ajuste)', 10),
  ('00000000-feed-0000-0000-00000000aa05', '00000000-feed-0000-0000-000000000002', '__PGTAP_TEST__ Producto I1 (de otro tenant)', 5);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-beef-0000-0000-00000000000b","role":"authenticated"}', true);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: entrada. Producto H1 stock=10, entrada de 5 → 15.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.ajustar_stock_manual('00000000-beef-0000-0000-00000000aa01'::uuid, 'entrada', 5, 'Test pgTAP: entrada normal');

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-beef-0000-0000-00000000aa01'),
  15,
  'Caso 1: ajustar_stock_manual entrada(5) sobre stock=10 deja stock_actual=15'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: salida normal. Producto H2 stock=10, salida de 3 → 7.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.ajustar_stock_manual('00000000-beef-0000-0000-00000000aa02'::uuid, 'salida', 3, 'Test pgTAP: salida normal');

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-beef-0000-0000-00000000aa02'),
  7,
  'Caso 2: ajustar_stock_manual salida(3) sobre stock=10 deja stock_actual=7'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: salida bloqueada. Producto H3 stock=2, salida de 5 → debe fallar y
-- el stock NO debe modificarse (ya validado a mano en sesión 39, sesión 38 en
-- realidad — se versiona acá).
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.ajustar_stock_manual('00000000-beef-0000-0000-00000000aa03'::uuid, 'salida', 5, 'Test pgTAP: salida bloqueada') $$,
  'Stock insuficiente%',
  'Caso 3a: ajustar_stock_manual bloquea salida que dejaria stock negativo'
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-beef-0000-0000-00000000aa03'),
  2,
  'Caso 3b: stock_actual de H3 no cambio tras el intento bloqueado (sigue en 2)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: ajuste a valor absoluto (NO delta). Producto H4 stock=10, ajuste a
-- 2 → stock_actual=2 (no 8, que seria delta).
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.ajustar_stock_manual('00000000-beef-0000-0000-00000000aa04'::uuid, 'ajuste', 2, 'Test pgTAP: ajuste por inventario fisico');

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-beef-0000-0000-00000000aa04'),
  2,
  'Caso 4: ajustar_stock_manual ajuste(2) sobre stock=10 deja stock_actual=2 (valor absoluto, no delta)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 5: cantidad negativa bloqueada. El guard de cantidad<0 corre ANTES de
-- tocar el producto (ver función), así que aplica a cualquier tipo, no solo
-- 'ajuste'. Probado con 'ajuste' como pide el caso, sobre H4 (ahora en 2).
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.ajustar_stock_manual('00000000-beef-0000-0000-00000000aa04'::uuid, 'ajuste', -1, 'Test pgTAP: cantidad negativa') $$,
  'Cantidad inválida%',
  'Caso 5a: ajustar_stock_manual bloquea cantidad negativa'
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-beef-0000-0000-00000000aa04'),
  2,
  'Caso 5b: stock_actual de H4 no cambio tras el intento bloqueado (sigue en 2)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 6: guard de tenant. Tenant H intentando ajustar un producto de Tenant I.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.ajustar_stock_manual('00000000-feed-0000-0000-00000000aa05'::uuid, 'entrada', 1, 'Test pgTAP: cross-tenant') $$,
  'Producto no encontrado o sin permiso%',
  'Caso 6: ajustar_stock_manual bloquea cross-tenant'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 7: movimiento de inventario. El ajuste exitoso del Caso 1 ¿generó una
-- fila en movimientos_inventario con tipo y motivo correctos?
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_inventario
   WHERE producto_id = '00000000-beef-0000-0000-00000000aa01' AND tipo = 'entrada' AND cantidad = 5),
  1,
  'Caso 7a: ajustar_stock_manual genera un movimiento de inventario tipo entrada cantidad 5'
);

SELECT is(
  (SELECT motivo FROM public.movimientos_inventario
   WHERE producto_id = '00000000-beef-0000-0000-00000000aa01' AND tipo = 'entrada' AND cantidad = 5),
  'Test pgTAP: entrada normal',
  'Caso 7b: el motivo pasado como parametro queda guardado en el movimiento'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 8: tipo inválido.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.ajustar_stock_manual('00000000-beef-0000-0000-00000000aa01'::uuid, 'cualquier_cosa', 1, 'Test pgTAP: tipo invalido') $$,
  'Tipo de movimiento inválido%',
  'Caso 8: ajustar_stock_manual bloquea tipo invalido con mensaje claro'
);

SELECT * FROM finish();

ROLLBACK;
