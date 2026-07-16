-- pgTAP test: public.increment_stock
--
-- Llamado desde CompraRapidaSection.jsx (handleSaveEdit) para revertir/ajustar
-- stock al editar una compra ya registrada. Acepta `quantity` NEGATIVO a
-- propósito (revertir un ítem borrado o reducido) — el guard de la sesión 39
-- (migration 060) valida el RESULTADO (stock_actual + quantity >= 0), no el
-- signo del parámetro, justamente para no romper ese uso legítimo.
--
-- Sesión 42 (migration 062): agrega p_motivo opcional + INSERT en
-- movimientos_inventario — antes actualizaba stock_actual sin dejar ningún
-- rastro en el historial de movimientos. El tipo de movimiento se decide por
-- el SIGNO real de `quantity` (>=0 → 'entrada', <0 → 'salida'), no fijo en
-- 'entrada', porque revertir una compra físicamente RETIRA stock.
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/productos de
-- prueba dentro de una transacción que termina en ROLLBACK. Nunca toca empresas
-- ni productos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: 2 tenants sintéticos (F y G) + 2 productos en F + 1 producto en G
-- (para el guard de tenant).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-face-0000-0000-000000000001', '__PGTAP_TEST__ Tenant F'),
  ('00000000-cafe-0000-0000-000000000002', '__PGTAP_TEST__ Tenant G');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-face-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-f@kairox.test', now(), now(), now()),
  ('00000000-cafe-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-g@kairox.test', now(), now(), now());

-- El trigger on_auth_user_created ya insertó la fila en profiles (con
-- empresa_id NULL) al insertar en auth.users arriba — solo hace falta
-- completarla, no insertar de nuevo (insertar de nuevo viola la PK).
UPDATE public.profiles SET empresa_id = '00000000-face-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-face-0000-0000-00000000000f';
UPDATE public.profiles SET empresa_id = '00000000-cafe-0000-0000-000000000002', role = 'admin' WHERE id = '00000000-cafe-0000-0000-00000000000c';

INSERT INTO public.productos (id, empresa_id, nombre, stock_actual) VALUES
  ('00000000-face-0000-0000-0000000000f1', '00000000-face-0000-0000-000000000001', '__PGTAP_TEST__ Producto F1 (stock 10)', 10),
  ('00000000-face-0000-0000-0000000000f2', '00000000-face-0000-0000-000000000001', '__PGTAP_TEST__ Producto F2 (stock 10)', 10),
  ('00000000-cafe-0000-0000-0000000000a1', '00000000-cafe-0000-0000-000000000002', '__PGTAP_TEST__ Producto G1 (de otro tenant)', 5);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-face-0000-0000-00000000000f","role":"authenticated"}', true);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: incremento normal. Producto F1 stock=10, incrementar 5 → 15.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.increment_stock('00000000-face-0000-0000-0000000000f1'::uuid, 5, 'Test pgTAP: incremento normal');

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-face-0000-0000-0000000000f1'),
  15,
  'Caso 1: increment_stock(5) sobre stock=10 deja stock_actual=15'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: cantidad negativa LEGÍTIMA (revertir). Producto F2 stock=10,
-- increment_stock(-3) → 7. Debe funcionar, no bloquear por el signo.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.increment_stock('00000000-face-0000-0000-0000000000f2'::uuid, -3, 'Test pgTAP: reversion (cantidad negativa)');

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-face-0000-0000-0000000000f2'),
  7,
  'Caso 2: increment_stock(-3) sobre stock=10 deja stock_actual=7 (revertir funciona)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2b: cantidad negativa EXCESIVA. Producto F2 ahora en 7,
-- increment_stock(-15) dejaría -8 → debe fallar, stock_actual sin cambios.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.increment_stock('00000000-face-0000-0000-0000000000f2'::uuid, -15) $$,
  'Stock insuficiente%',
  'Caso 2b: increment_stock bloquea si la cantidad negativa deja el resultado en negativo'
);

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-face-0000-0000-0000000000f2'),
  7,
  'Caso 2b: stock_actual de F2 no cambio tras el intento bloqueado (sigue en 7)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: guard de tenant. Impersonando al usuario de Tenant F, intentar
-- incrementar un producto que pertenece a Tenant G.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.increment_stock('00000000-cafe-0000-0000-0000000000a1'::uuid, 1) $$,
  'Producto no encontrado o sin permiso%',
  'Caso 3: increment_stock bloquea cross-tenant (Tenant F no puede tocar producto de Tenant G)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: movimiento de inventario. (Sesión 42 / migration 062 — antes estas
-- filas no se generaban.) Confirma además que el tipo se decide por el SIGNO
-- real de quantity, no fijo en 'entrada': el incremento positivo del Caso 1
-- queda como 'entrada', y la reversión negativa del Caso 2 queda como 'salida'.
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_inventario
   WHERE producto_id = '00000000-face-0000-0000-0000000000f1' AND tipo = 'entrada' AND cantidad = 5),
  1,
  'Caso 4a: increment_stock(+5) genera un movimiento tipo entrada cantidad 5'
);

SELECT is(
  (SELECT motivo FROM public.movimientos_inventario
   WHERE producto_id = '00000000-face-0000-0000-0000000000f1' AND tipo = 'entrada' AND cantidad = 5),
  'Test pgTAP: incremento normal',
  'Caso 4b: el motivo pasado como parametro queda guardado en el movimiento'
);

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_inventario
   WHERE producto_id = '00000000-face-0000-0000-0000000000f2' AND tipo = 'salida' AND cantidad = 3),
  1,
  'Caso 4c: increment_stock(-3) genera un movimiento tipo salida cantidad 3 (NO entrada, refleja la direccion real)'
);

SELECT * FROM finish();

ROLLBACK;
