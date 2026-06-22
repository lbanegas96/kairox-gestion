-- pgTAP test: public.aplicar_compra_producto
--
-- RPC llamada desde CompraRapidaSection.jsx ("Nueva Compra" y edición de
-- compra para ítems nuevos). Centraliza el cálculo de costo según
-- empresas.metodo_valoracion_stock (sesión 29). Sesión 39 (migration 060)
-- agregó FOR UPDATE al SELECT que lee stock_actual/costo_compra antes de
-- calcular el costo — el trigger sobre ordenes_compra_items NO bloqueaba esa
-- fila, dejando el cálculo de PPP expuesto a leer datos obsoletos bajo
-- concurrencia. Ya verificado a mano en sesión 39 (sin test); se versiona acá.
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/productos de
-- prueba dentro de una transacción que termina en ROLLBACK. Nunca toca
-- empresas ni productos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(9);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: Tenant L (casos 1, 2, 4, 5 — cambia de método a mitad de archivo)
-- + Tenant M (caso 3, guard de tenant).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre, metodo_valoracion_stock) VALUES
  ('00000000-aced-0000-0000-000000000001', '__PGTAP_TEST__ Tenant L', 'ultimo_costo'),
  ('00000000-cede-0000-0000-000000000002', '__PGTAP_TEST__ Tenant M', 'ultimo_costo');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-aced-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-l@kairox.test', now(), now(), now()),
  ('00000000-cede-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-m@kairox.test', now(), now(), now());

INSERT INTO public.profiles (id, empresa_id, email) VALUES
  ('00000000-aced-0000-0000-00000000000a', '00000000-aced-0000-0000-000000000001', 'pgtap-test-l@kairox.test'),
  ('00000000-cede-0000-0000-00000000000c', '00000000-cede-0000-0000-000000000002', 'pgtap-test-m@kairox.test');

INSERT INTO public.productos (id, empresa_id, nombre, stock_actual, costo_compra) VALUES
  ('00000000-aced-0000-0000-0000000000a1', '00000000-aced-0000-0000-000000000001', '__PGTAP_TEST__ Prod L1 (ultimo_costo)', 10, 50),
  ('00000000-aced-0000-0000-0000000000a2', '00000000-aced-0000-0000-000000000001', '__PGTAP_TEST__ Prod L2 (PPP)', 20, 100),
  ('00000000-cede-0000-0000-0000000000a3', '00000000-cede-0000-0000-000000000002', '__PGTAP_TEST__ Prod M1 (otro tenant)', 5, 0);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-aced-0000-0000-00000000000a","role":"authenticated"}', true);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: incremento normal con metodo='ultimo_costo'. Prod L1 stock=10,
-- costo=50. Compra 5 a costo_nuevo=80 → costo_compra=80 (ultimo costo, no
-- promedio), stock_actual=15.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.aplicar_compra_producto('00000000-aced-0000-0000-0000000000a1'::uuid, 5, 80);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-aced-0000-0000-0000000000a1'),
  15,
  'Caso 1a: aplicar_compra_producto(5) sobre stock=10 deja stock_actual=15'
);

SELECT is(
  (SELECT costo_compra FROM public.productos WHERE id = '00000000-aced-0000-0000-0000000000a1'),
  80::numeric,
  'Caso 1b: con metodo ultimo_costo, costo_compra pasa a 80 (el costo nuevo, sin promediar)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: PPP con stock previo. Cambia Tenant L a promedio_ponderado. Prod L2
-- stock=20, costo=100. Compra 10 a costo_nuevo=200 →
-- PPP=(20*100+10*200)/30=133.33, stock_actual=30.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.empresas SET metodo_valoracion_stock = 'promedio_ponderado' WHERE id = '00000000-aced-0000-0000-000000000001';

SELECT public.aplicar_compra_producto('00000000-aced-0000-0000-0000000000a2'::uuid, 10, 200);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-aced-0000-0000-0000000000a2'),
  30,
  'Caso 2a: aplicar_compra_producto(10) sobre stock=20 deja stock_actual=30'
);

SELECT is(
  (SELECT round(costo_compra, 2) FROM public.productos WHERE id = '00000000-aced-0000-0000-0000000000a2'),
  round(4000.0 / 30, 2),
  'Caso 2b: costo PPP = (20*100+10*200)/30 = 133.33'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: guard de tenant. Tenant L no puede aplicar compra sobre un producto
-- de Tenant M.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.aplicar_compra_producto('00000000-cede-0000-0000-0000000000a3'::uuid, 1, 10) $$,
  'Producto no encontrado o sin permiso%',
  'Caso 3: aplicar_compra_producto bloquea cross-tenant'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: secuencia encadenada en modo PPP (confirma que el FOR UPDATE de la
-- sesión 39 no rompe el flujo normal — el segundo cálculo debe partir del
-- stock/costo YA actualizado por el primero, no de datos obsoletos).
-- Prod L2 ahora en stock=30, costo=133.33. Compra 5 mas a costo_nuevo=300 →
-- PPP=(30*133.33+5*300)/35.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.aplicar_compra_producto('00000000-aced-0000-0000-0000000000a2'::uuid, 5, 300);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-aced-0000-0000-0000000000a2'),
  35,
  'Caso 4a: segunda compra encadenada deja stock_actual=35 (30+5), parte del valor ya actualizado'
);

SELECT is(
  (SELECT round(costo_compra, 2) FROM public.productos WHERE id = '00000000-aced-0000-0000-0000000000a2'),
  round((30 * (4000.0/30) + 5 * 300) / 35, 2),
  'Caso 4b: el segundo costo PPP parte del costo YA actualizado por la primera llamada, no de un valor obsoleto'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 5: el valor RETURN de la función coincide con lo que quedó guardado en
-- productos.costo_compra (consistencia del valor devuelto al caller). Se
-- vuelve a 'ultimo_costo' para que el resultado esperado sea trivial (999,
-- sin promediar) — separado en 2 statements (no 2 subqueries en el mismo
-- SELECT) para no depender del orden de evaluación de subqueries volátiles.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.empresas SET metodo_valoracion_stock = 'ultimo_costo' WHERE id = '00000000-aced-0000-0000-000000000001';

CREATE TEMP TABLE caso5_resultado (costo_devuelto numeric);
INSERT INTO caso5_resultado
SELECT public.aplicar_compra_producto('00000000-aced-0000-0000-0000000000a1'::uuid, 1, 999);

SELECT is(
  (SELECT costo_devuelto FROM caso5_resultado),
  999::numeric,
  'Caso 5a: el RETURN de aplicar_compra_producto es 999 (ultimo_costo)'
);

SELECT is(
  (SELECT costo_compra FROM public.productos WHERE id = '00000000-aced-0000-0000-0000000000a1'),
  999::numeric,
  'Caso 5b: el costo_compra guardado coincide con el valor devuelto por RETURN'
);

SELECT * FROM finish();

ROLLBACK;
