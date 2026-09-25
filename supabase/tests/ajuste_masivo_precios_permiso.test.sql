-- pgTAP test: ajuste masivo de precios exige permiso de módulo y no es público (mig. 404)
--
-- Auditoría 24/09/2026, hallazgo SEG-4. `ajustar_precios_masivo_catalogo` y `ajustar_precios_masivo`
-- son SECURITY DEFINER (saltean el RLS) y no chequeaban el permiso de módulo: cualquier usuario de la
-- empresa podía cambiar todos los precios llamándolas por API; la primera además era ejecutable
-- por PUBLIC (anon). Este test confirma que ahora:
--   - anon no puede ejecutarlas,
--   - un empleado SIN el módulo (`productos` / `clientes`) recibe "No autorizado" y no cambia nada,
--   - un empleado CON el módulo (y un admin) sigue pudiendo usarlas, solo sobre su empresa.
--
-- SEGURIDAD: crea y destruye sus propios tenants/usuarios/productos sintéticos dentro de una
-- transacción que termina en ROLLBACK. Nunca toca empresas ni datos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(13);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: E1 (admin, empleado sin permisos, empleado con permisos) y E2 (otra empresa).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-f101-0000-0000-000000000001', '__PGTAP_TEST__ Empresa E1'),
  ('00000000-f102-0000-0000-000000000002', '__PGTAP_TEST__ Empresa E2');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-f101-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-precios-adm@kairox.test', now(), now(), now()),
  ('00000000-f101-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-precios-sin@kairox.test', now(), now(), now()),
  ('00000000-f101-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-precios-con@kairox.test', now(), now(), now());

UPDATE public.profiles SET empresa_id = '00000000-f101-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-f101-0000-0000-0000000000a1';
UPDATE public.profiles SET empresa_id = '00000000-f101-0000-0000-000000000001', permissions = '{}'::jsonb WHERE id = '00000000-f101-0000-0000-0000000000a2';
UPDATE public.profiles SET empresa_id = '00000000-f101-0000-0000-000000000001', permissions = '{"productos": true, "clientes": true}'::jsonb WHERE id = '00000000-f101-0000-0000-0000000000a3';

INSERT INTO public.productos (id, empresa_id, nombre, precio_venta, activo) VALUES
  ('00000000-f101-0000-0000-0000000000d1', '00000000-f101-0000-0000-000000000001', '__PGTAP_TEST__ Producto de E1', 1000, true),
  ('00000000-f102-0000-0000-0000000000d2', '00000000-f102-0000-0000-000000000002', '__PGTAP_TEST__ Producto de E2', 1000, true);

INSERT INTO public.listas_precio (id, empresa_id, user_id, nombre, tipo) VALUES
  ('00000000-f101-0000-0000-0000000000e1', '00000000-f101-0000-0000-000000000001', '00000000-f101-0000-0000-0000000000a1', '__PGTAP_TEST__ Lista E1', 'fija');

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 1-3: quién puede ejecutar las funciones (privilegios).
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  has_function_privilege('anon', 'public.ajustar_precios_masivo_catalogo(text,numeric,uuid,text,text,boolean)', 'EXECUTE'),
  false,
  'Caso 1: anon no puede ejecutar el ajuste masivo del catalogo'
);

SELECT is(
  has_function_privilege('authenticated', 'public.ajustar_precios_masivo_catalogo(text,numeric,uuid,text,text,boolean)', 'EXECUTE'),
  true,
  'Caso 2: un usuario con sesion si puede ejecutarlo (el permiso de modulo se chequea adentro)'
);

SELECT is(
  has_function_privilege('anon', 'public.ajustar_precios_masivo(uuid,text,numeric,uuid,text,text,boolean)', 'EXECUTE'),
  false,
  'Caso 3: anon tampoco puede ejecutar el ajuste masivo de listas de precios'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 4-5: el empleado SIN permisos recibe "No autorizado".
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f101-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_like(
  $$SELECT public.ajustar_precios_masivo_catalogo('porcentaje', 10, NULL, NULL, 'ninguno', true)$$,
  'No autorizado: sin permiso%',
  'Caso 4: un empleado sin el modulo productos no puede cambiar los precios del catalogo'
);

SELECT throws_like(
  $$SELECT public.ajustar_precios_masivo('00000000-f101-0000-0000-0000000000e1', 'porcentaje', 10, NULL, NULL, 'ninguno', true)$$,
  'No autorizado: sin permiso%',
  'Caso 5: un empleado sin el modulo clientes no puede cambiar los precios de una lista'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 6-11: el empleado CON permisos sigue pudiendo, solo sobre su empresa.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f101-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT is(
  (SELECT jsonb_array_length(public.ajustar_precios_masivo_catalogo('porcentaje', 10, NULL, NULL, 'ninguno', false) -> 'items')),
  1,
  'Caso 6: la vista previa solo incluye productos de SU empresa'
);

SELECT lives_ok(
  $$SELECT public.ajustar_precios_masivo_catalogo('porcentaje', 10, NULL, NULL, 'ninguno', true)$$,
  'Caso 7: con el modulo productos puede aplicar el ajuste'
);

SELECT lives_ok(
  $$SELECT public.ajustar_precios_masivo('00000000-f101-0000-0000-0000000000e1', 'monto_fijo', 50, NULL, NULL, 'ninguno', true)$$,
  'Caso 8: con el modulo clientes puede aplicar el ajuste a una lista de precios'
);

RESET ROLE;

SELECT is(
  (SELECT precio_venta FROM public.productos WHERE id = '00000000-f101-0000-0000-0000000000d1'),
  1100::numeric,
  'Caso 9: el precio del producto de E1 subio 10 %'
);

SELECT is(
  (SELECT precio_venta FROM public.productos WHERE id = '00000000-f102-0000-0000-0000000000d2'),
  1000::numeric,
  'Caso 10: el precio del producto de E2 no se toco'
);

SELECT is(
  (SELECT precio FROM public.lista_precio_items WHERE lista_precio_id = '00000000-f101-0000-0000-0000000000e1' AND producto_id = '00000000-f101-0000-0000-0000000000d1'),
  1150::numeric,
  'Caso 11: la lista de precios quedo en 1100 + 50'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 12: el admin (que tiene todos los modulos) sigue pudiendo.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f101-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.ajustar_precios_masivo_catalogo('monto_fijo', 0, NULL, NULL, 'ninguno', true)$$,
  'Caso 12: el admin puede usar el ajuste masivo'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 13: sin sesion (anon) ni se llega a ejecutar.
-- ───────────────────────────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;

SELECT throws_like(
  $$SELECT public.ajustar_precios_masivo_catalogo('porcentaje', 1, NULL, NULL, 'ninguno', false)$$,
  'permission denied%',
  'Caso 13: sin sesion la llamada se rechaza por falta de privilegio'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
