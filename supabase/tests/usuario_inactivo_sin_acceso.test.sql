-- pgTAP test: un usuario desactivado no accede a los datos de su empresa (mig. 407)
--
-- Auditoría 24/09/2026, hallazgo SEG-13. `get_my_empresa_id()` no miraba `profiles.active`: un usuario
-- desactivado por el admin conservaba su empresa y seguía leyendo las tablas de lectura abierta y
-- ejecutando RPC que solo validan la empresa. Este test confirma que ahora, al desactivarlo:
--   - deja de ver los datos de la empresa (productos, empresa) y de poder usar las RPC,
--   - pero sigue viendo SU propia fila de profiles (la app la usa para mostrar «Cuenta inactiva»),
-- y que al reactivarlo recupera el acceso, sin afectar al admin ni a otros usuarios activos.
--
-- SEGURIDAD: crea y destruye sus propios tenants/usuarios/productos sintéticos dentro de una
-- transacción que termina en ROLLBACK. Nunca toca empresas ni datos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(9);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: una empresa con un admin, un empleado activo y un empleado que luego se desactiva.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-f601-0000-0000-000000000001', '__PGTAP_TEST__ Empresa inactivos');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-f601-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-inact-adm@kairox.test', now(), now(), now()),
  ('00000000-f601-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-inact-emp@kairox.test', now(), now(), now()),
  ('00000000-f601-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-inact-otro@kairox.test', now(), now(), now());

UPDATE public.profiles SET empresa_id = '00000000-f601-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-f601-0000-0000-0000000000a1';
UPDATE public.profiles SET empresa_id = '00000000-f601-0000-0000-000000000001', permissions = '{"productos": true}'::jsonb WHERE id = '00000000-f601-0000-0000-0000000000a2';
UPDATE public.profiles SET empresa_id = '00000000-f601-0000-0000-000000000001', permissions = '{"productos": true}'::jsonb WHERE id = '00000000-f601-0000-0000-0000000000a3';

INSERT INTO public.productos (id, empresa_id, nombre, costo_compra, precio_venta, activo) VALUES
  ('00000000-f601-0000-0000-0000000000d1', '00000000-f601-0000-0000-000000000001', '__PGTAP_TEST__ Producto', 500, 1000, true);

SET LOCAL ROLE authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: el empleado activo ve la empresa y sus productos.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f601-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.productos WHERE id = '00000000-f601-0000-0000-0000000000d1'),
  1,
  'Caso 1: un empleado activo ve los productos de su empresa'
);

-- ───────────────────────────────────────────────────────────────────────────
-- El admin desactiva al empleado (lo legitimo, desde el panel de Usuarios).
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f601-0000-0000-0000000000a1","role":"authenticated"}', true);

UPDATE public.profiles SET active = false WHERE id = '00000000-f601-0000-0000-0000000000a2';

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 2-6: el empleado desactivado ya no accede a nada de la empresa.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f601-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  public.get_my_empresa_id(),
  NULL,
  'Caso 2: un usuario desactivado ya no tiene empresa (get_my_empresa_id devuelve NULL)'
);

SELECT is(
  (SELECT count(*)::int FROM public.productos WHERE id = '00000000-f601-0000-0000-0000000000d1'),
  0,
  'Caso 3: ya no lee los productos (ni su costo de compra)'
);

SELECT is(
  (SELECT count(*)::int FROM public.empresas WHERE id = '00000000-f601-0000-0000-000000000001'),
  0,
  'Caso 4: ya no ve los datos de su empresa'
);

SELECT throws_like(
  $$SELECT public.ajustar_precios_masivo_catalogo('porcentaje', 10, NULL, NULL, 'ninguno', false)$$,
  'No autorizado%',
  'Caso 5: las funciones que dependen de la empresa lo rechazan'
);

SELECT is(
  (SELECT active FROM public.profiles WHERE id = '00000000-f601-0000-0000-0000000000a2'),
  false,
  'Caso 6: si puede leer SU propia ficha (la app la usa para mostrar «Cuenta inactiva» y cerrar la sesion)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 7: el otro empleado, activo, sigue normal.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f601-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.productos WHERE id = '00000000-f601-0000-0000-0000000000d1'),
  1,
  'Caso 7: un empleado activo de la misma empresa sigue viendo sus productos'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 8-9: el admin reactiva al empleado y este recupera el acceso.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f601-0000-0000-0000000000a1","role":"authenticated"}', true);

UPDATE public.profiles SET active = true WHERE id = '00000000-f601-0000-0000-0000000000a2';

SELECT is(
  (SELECT active FROM public.profiles WHERE id = '00000000-f601-0000-0000-0000000000a2'),
  true,
  'Caso 8: el admin puede reactivar al empleado'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f601-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.productos WHERE id = '00000000-f601-0000-0000-0000000000d1'),
  1,
  'Caso 9: reactivado, el empleado vuelve a ver los productos'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
