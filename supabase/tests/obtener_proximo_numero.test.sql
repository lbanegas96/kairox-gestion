-- pgTAP test: public.obtener_proximo_numero
--
-- Riesgo que prueba: la numeración de comprobantes (sesión 30) tenía un bug de
-- concurrencia por usar COUNT(*) sin lock para calcular el "próximo número".
-- El fix (migration 051/052) reemplazó eso por una tabla series_numeracion +
-- SELECT...FOR UPDATE en obtener_proximo_numero. Este test verifica: secuencia
-- simple, aislamiento multi-tenant, y reinicio de período. La concurrencia REAL
-- (2+ conexiones simultáneas peleando por el mismo lock) NO se puede probar
-- dentro de pgTAP — un test de pgTAP corre en una sola conexión/transacción, así
-- que nunca hay una segunda transacción real compitiendo por el lock. Ese caso
-- (Caso 2) se marca con skip() acá y se verifica por separado con múltiples
-- llamadas concurrentes reales — ver supabase/tests/README.md.
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants de prueba dentro
-- de una transacción que termina en ROLLBACK. Nunca toca empresas reales.
-- Los IDs de fixture usan el prefijo 00000000-aaaa.../00000000-bbbb... para que
-- sea obvio que son sintéticos si algo quedara expuesto en logs.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(10);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: 2 tenants de prueba, 100% sintéticos, creados dentro de esta
-- transacción. El trigger AFTER INSERT ON empresas (trg_empresa_seed_series_
-- numeracion) siembra automáticamente las 9 series por tenant.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-aaaa-0000-0000-000000000001', '__PGTAP_TEST__ Tenant A'),
  ('00000000-bbbb-0000-0000-000000000002', '__PGTAP_TEST__ Tenant B');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-aaaa-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-a@kairox.test', now(), now(), now()),
  ('00000000-bbbb-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-b@kairox.test', now(), now(), now());

-- El trigger on_auth_user_created ya insertó la fila en profiles (con
-- empresa_id NULL) al insertar en auth.users arriba — solo hace falta
-- completarla, no insertar de nuevo (insertar de nuevo viola la PK).
UPDATE public.profiles SET empresa_id = '00000000-aaaa-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-aaaa-0000-0000-00000000000a';
UPDATE public.profiles SET empresa_id = '00000000-bbbb-0000-0000-000000000002', role = 'admin' WHERE id = '00000000-bbbb-0000-0000-00000000000b';

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: secuencia simple, mismo tenant, mismo tipo_documento.
-- El segundo número debe ser exactamente el siguiente — no repite, no salta.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-aaaa-0000-0000-00000000000a","role":"authenticated"}', true);

SELECT is(
  public.obtener_proximo_numero('00000000-aaaa-0000-0000-000000000001'::uuid, 'venta'),
  (SELECT to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD')) || '-001',
  'Caso 1a: primer numero de venta para Tenant A es 001'
);

SELECT is(
  public.obtener_proximo_numero('00000000-aaaa-0000-0000-000000000001'::uuid, 'venta'),
  (SELECT to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD')) || '-002',
  'Caso 1b: segundo numero es 002 (consecutivo, no repite ni salta)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: concurrencia real (2+ conexiones simultáneas sobre el mismo tenant
-- y tipo_documento). NO testeable dentro de pgTAP (single-connection). Ver
-- verificación manual en supabase/tests/README.md.
-- ───────────────────────────────────────────────────────────────────────────

SELECT skip(1, 'Concurrencia real requiere 2+ conexiones simultáneas — pgTAP corre en una sola transacción. Verificado por separado (ver README.md), no automatizable acá.');

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: aislamiento multi-tenant. Tenant A y Tenant B pidiendo el mismo
-- tipo_documento ('pedido') intercalado — cada uno con su propia secuencia
-- independiente, sin pisarse entre sí.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-aaaa-0000-0000-00000000000a","role":"authenticated"}', true);
SELECT is(
  public.obtener_proximo_numero('00000000-aaaa-0000-0000-000000000001'::uuid, 'pedido'),
  'PED-' || (SELECT to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD')) || '-001',
  'Caso 3a: Tenant A primer pedido es 001'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-bbbb-0000-0000-00000000000b","role":"authenticated"}', true);
SELECT is(
  public.obtener_proximo_numero('00000000-bbbb-0000-0000-000000000002'::uuid, 'pedido'),
  'PED-' || (SELECT to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD')) || '-001',
  'Caso 3b: Tenant B primer pedido TAMBIEN es 001 (secuencia propia, no continua la de A)'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-aaaa-0000-0000-00000000000a","role":"authenticated"}', true);
SELECT is(
  public.obtener_proximo_numero('00000000-aaaa-0000-0000-000000000001'::uuid, 'pedido'),
  'PED-' || (SELECT to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD')) || '-002',
  'Caso 3c: Tenant A segundo pedido es 002 (no lo afecto la llamada de B)'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-bbbb-0000-0000-00000000000b","role":"authenticated"}', true);
SELECT is(
  public.obtener_proximo_numero('00000000-bbbb-0000-0000-000000000002'::uuid, 'pedido'),
  'PED-' || (SELECT to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD')) || '-002',
  'Caso 3d: Tenant B segundo pedido es 002 (no lo afectaron las 2 llamadas de A)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: reinicio de período. Se simula un período vencido (periodo_actual
-- de hace varios años, proximo_numero en 7) y se confirma que la función
-- detecta el cambio de período, reinicia a 001, y actualiza periodo_actual.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.series_numeracion
SET proximo_numero = 7, periodo_actual = '20200101'
WHERE empresa_id = '00000000-aaaa-0000-0000-000000000001' AND tipo_documento = 'factura';

SELECT set_config('request.jwt.claims', '{"sub":"00000000-aaaa-0000-0000-00000000000a","role":"authenticated"}', true);

SELECT is(
  public.obtener_proximo_numero('00000000-aaaa-0000-0000-000000000001'::uuid, 'factura'),
  'FAC-' || (SELECT to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD')) || '-001',
  'Caso 4a: cambio de periodo reinicia el numero a 001 aunque proximo_numero estuviera en 7'
);

SELECT is(
  (SELECT periodo_actual FROM public.series_numeracion WHERE empresa_id = '00000000-aaaa-0000-0000-000000000001' AND tipo_documento = 'factura'),
  (SELECT to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD')),
  'Caso 4b: periodo_actual se actualiza al periodo nuevo'
);

SELECT is(
  (SELECT proximo_numero FROM public.series_numeracion WHERE empresa_id = '00000000-aaaa-0000-0000-000000000001' AND tipo_documento = 'factura'),
  2,
  'Caso 4c: proximo_numero avanza a 2 tras consumir el 1 del periodo nuevo'
);

SELECT * FROM finish();

ROLLBACK;
