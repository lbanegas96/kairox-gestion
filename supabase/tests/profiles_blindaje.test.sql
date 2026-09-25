-- pgTAP test: blindaje de `profiles` y del alta de usuarios (mig. 403)
--
-- Auditoría 24/09/2026, hallazgo SEG-1. Confirma que un usuario final:
--   - no puede quedar como admin por mandar {"role":"admin"} en el signUp,
--   - no puede cambiar su empresa, su rol, sus permisos ni su estado (ni reactivarse),
--   - sí puede seguir actualizando su nombre y su último ingreso,
-- y que NO se rompe lo legítimo: el admin de la empresa administra a su gente, `create_tenant`
-- sigue armando la empresa del fundador y `service_role` (edge functions) sigue pudiendo todo.
--
-- SEGURIDAD: crea y destruye sus propios tenants/usuarios sintéticos dentro de una transacción
-- que termina en ROLLBACK. Nunca toca empresas ni datos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(20);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: E1 (donde están el admin y el empleado) y E2 (la víctima).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-f001-0000-0000-000000000001', '__PGTAP_TEST__ Empresa E1'),
  ('00000000-f002-0000-0000-000000000002', '__PGTAP_TEST__ Empresa E2 (victima)');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at, raw_user_meta_data)
VALUES
  ('00000000-f001-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-adm1@kairox.test', now(), now(), now(), '{}'::jsonb),
  ('00000000-f001-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-stf1@kairox.test', now(), now(), now(), '{}'::jsonb),
  ('00000000-f001-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-stf2@kairox.test', now(), now(), now(), '{}'::jsonb),
  ('00000000-f002-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-adm2@kairox.test', now(), now(), now(), '{}'::jsonb),
  -- Atacante: se registra mandando role=admin en la metadata del signUp.
  ('00000000-f003-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-atacante@kairox.test', now(), now(), now(), '{"role":"admin","first_name":"Mala","last_name":"Leche"}'::jsonb),
  -- Fundador que todavía no tiene empresa (flujo normal de registro + create_tenant).
  ('00000000-f003-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-fundador@kairox.test', now(), now(), now(), '{}'::jsonb);

-- El trigger on_auth_user_created ya insertó cada perfil (empresa NULL). Se completan como postgres
-- (la conexión del test corre como `postgres`, que el blindaje no restringe).
UPDATE public.profiles SET empresa_id = '00000000-f001-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-f001-0000-0000-0000000000a1';
UPDATE public.profiles SET empresa_id = '00000000-f001-0000-0000-000000000001', permissions = '{"ventas": true}'::jsonb WHERE id = '00000000-f001-0000-0000-0000000000a2';
UPDATE public.profiles SET empresa_id = '00000000-f001-0000-0000-000000000001', active = false WHERE id = '00000000-f001-0000-0000-0000000000a3';
UPDATE public.profiles SET empresa_id = '00000000-f002-0000-0000-000000000002', role = 'admin' WHERE id = '00000000-f002-0000-0000-0000000000b1';

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: el rol nunca sale de la metadata del signUp.
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT role FROM public.profiles WHERE id = '00000000-f003-0000-0000-0000000000c1'),
  'staff',
  'Caso 1: un signUp con metadata role=admin nace como staff (handle_new_user ya no confia en el cliente)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 2-8: el empleado (E1) intenta escalar por su cuenta.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f001-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_like(
  $$UPDATE public.profiles SET permissions = '{"configuracion": true, "caja": true}'::jsonb WHERE id = '00000000-f001-0000-0000-0000000000a2'$$,
  'No autorizado%',
  'Caso 2: el empleado no puede darse permisos de otros modulos'
);

SELECT throws_like(
  $$UPDATE public.profiles SET modo_caja = true WHERE id = '00000000-f001-0000-0000-0000000000a2'$$,
  'No autorizado%',
  'Caso 3: el empleado no puede activarse el Modo Caja'
);

SELECT throws_like(
  $$UPDATE public.profiles SET empresa_id = '00000000-f002-0000-0000-000000000002' WHERE id = '00000000-f001-0000-0000-0000000000a2'$$,
  'No autorizado%',
  'Caso 4: el empleado no puede apuntar su ficha a otra empresa'
);

SELECT throws_like(
  $$UPDATE public.profiles SET role = 'admin' WHERE id = '00000000-f001-0000-0000-0000000000a2'$$,
  'No autorizado%',
  'Caso 5: el empleado no puede subirse el rol a admin'
);

SELECT lives_ok(
  $$UPDATE public.profiles SET last_login_at = now() WHERE id = '00000000-f001-0000-0000-0000000000a2'$$,
  'Caso 6: el empleado si puede actualizar su ultimo ingreso (lo hace el login)'
);

SELECT lives_ok(
  $$UPDATE public.profiles SET first_name = 'Nombre nuevo' WHERE id = '00000000-f001-0000-0000-0000000000a2'$$,
  'Caso 7: el empleado si puede editar su nombre'
);

SELECT is(
  (SELECT permissions ->> 'configuracion' FROM public.profiles WHERE id = '00000000-f001-0000-0000-0000000000a2'),
  NULL,
  'Caso 8: sus permisos quedaron intactos despues de los intentos'
);

-- Empleado desactivado por el admin: no puede reactivarse solo.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-f001-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT throws_like(
  $$UPDATE public.profiles SET active = true WHERE id = '00000000-f001-0000-0000-0000000000a3'$$,
  'No autorizado%',
  'Caso 9: un usuario desactivado no puede reactivarse solo'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 10-11: el atacante recien registrado (sin empresa) intenta entrar a E2.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f003-0000-0000-0000000000c1","role":"authenticated"}', true);

SELECT throws_like(
  $$UPDATE public.profiles SET empresa_id = '00000000-f002-0000-0000-000000000002' WHERE id = '00000000-f003-0000-0000-0000000000c1'$$,
  'No autorizado%',
  'Caso 10: un usuario sin empresa no puede meterse en la empresa de otro'
);

SELECT throws_like(
  $$INSERT INTO public.profiles (id, empresa_id, role) VALUES ('00000000-f003-0000-0000-0000000000c1', '00000000-f002-0000-0000-000000000002', 'admin') ON CONFLICT (id) DO UPDATE SET empresa_id = EXCLUDED.empresa_id, role = EXCLUDED.role$$,
  'No autorizado%',
  'Caso 11: tampoco por la via de un upsert desde el navegador'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 12-15: el admin de E1 administra a su gente (lo legitimo sigue andando).
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f001-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$UPDATE public.profiles SET permissions = '{"ventas": true, "caja": true}'::jsonb WHERE id = '00000000-f001-0000-0000-0000000000a2'$$,
  'Caso 12: el admin puede cambiar los permisos de un empleado de su empresa'
);

SELECT is(
  (SELECT permissions ->> 'caja' FROM public.profiles WHERE id = '00000000-f001-0000-0000-0000000000a2'),
  'true',
  'Caso 13: el cambio de permisos del admin quedo guardado'
);

SELECT lives_ok(
  $$UPDATE public.profiles SET active = false WHERE id = '00000000-f001-0000-0000-0000000000a2'$$,
  'Caso 14: el admin puede desactivar a un empleado de su empresa'
);

SELECT throws_like(
  $$UPDATE public.profiles SET empresa_id = '00000000-f002-0000-0000-000000000002' WHERE id = '00000000-f001-0000-0000-0000000000a2'$$,
  'No autorizado%',
  'Caso 15: ni siquiera el admin puede mudar a un usuario a otra empresa desde el navegador'
);

-- El admin de E1 intenta tocar el perfil del admin de E2: la RLS lo filtra (0 filas, sin error).
UPDATE public.profiles SET permissions = '{"x": true}'::jsonb WHERE id = '00000000-f002-0000-0000-0000000000b1';

-- Se mira lo que quedó guardado como postgres (el admin de E1 ni siquiera vería esa fila).
RESET ROLE;

SELECT is(
  (SELECT permissions ->> 'x' FROM public.profiles WHERE id = '00000000-f002-0000-0000-0000000000b1'),
  NULL,
  'Caso 16: el admin de E1 no puede tocar el perfil del admin de E2 (RLS)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 17-18: create_tenant sigue funcionando para el fundador sin empresa.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f003-0000-0000-0000000000c2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT ok(
  public.create_tenant('__PGTAP_TEST__ Empresa nueva', 'Ana', 'Prueba') IS NOT NULL,
  'Caso 17: create_tenant devuelve la empresa nueva del fundador (el blindaje no rompe el registro)'
);

SELECT is(
  (SELECT role || '/' || (empresa_id IS NOT NULL)::text FROM public.profiles WHERE id = '00000000-f003-0000-0000-0000000000c2'),
  'admin/true',
  'Caso 18: el fundador quedo como admin de su empresa nueva'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 19-20: los caminos del servidor siguen sin restricciones.
-- ───────────────────────────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$UPDATE public.profiles SET permissions = '{"ventas": true}'::jsonb, active = true WHERE id = '00000000-f001-0000-0000-0000000000a2'$$,
  'Caso 19: service_role (edge functions) puede administrar permisos y estado'
);

RESET ROLE;

SELECT lives_ok(
  $$UPDATE public.profiles SET empresa_id = '00000000-f001-0000-0000-000000000001' WHERE id = '00000000-f003-0000-0000-0000000000c1'$$,
  'Caso 20: postgres (migraciones, seeds) puede asignar empresa'
);

SELECT * FROM finish();

ROLLBACK;
