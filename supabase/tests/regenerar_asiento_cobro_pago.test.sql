-- pgTAP test: «Regenerar asiento» de cobros y pagos reconecta el que ya existe en vez de duplicarlo (mig. 409)
--
-- Auditoría 24/09/2026, hallazgo CON-2. `regenerar_asiento_cxc` / `regenerar_asiento_cxp` solo miraban `asiento_id`:
-- un cobro o pago cuyo asiento existía pero sin vínculo se duplicaba al regenerar (7 pares reales). Este test confirma
-- que ahora: (1) si el asiento ya existe se reconecta y no se crea otro, (2) si no existe se genera como siempre,
-- (3) un cobro cancelado no se puede regenerar, y (4) los chequeos de siempre (ya vinculado, permiso) siguen.
--
-- SEGURIDAD: crea y destruye su propio tenant/usuarios/movimientos sintéticos dentro de una transacción
-- que termina en ROLLBACK. Nunca toca empresas ni datos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(16);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: una empresa con un admin y un usuario sin permisos, las cuentas que usan las funciones
-- (Caja 1.1.1, Cuentas a Cobrar 1.1.2, Proveedores 2.1.1), un proveedor, cobros y pagos.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-f801-0000-0000-000000000001', '__PGTAP_TEST__ Empresa regenerar');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-f801-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-reg-adm@kairox.test', now(), now(), now()),
  ('00000000-f801-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-reg-sin@kairox.test', now(), now(), now());

UPDATE public.profiles SET empresa_id = '00000000-f801-0000-0000-000000000001', role = 'admin'       WHERE id = '00000000-f801-0000-0000-0000000000a1';
UPDATE public.profiles SET empresa_id = '00000000-f801-0000-0000-000000000001', permissions = '{}'::jsonb WHERE id = '00000000-f801-0000-0000-0000000000a2';

INSERT INTO public.plan_cuentas (id, empresa_id, codigo, nombre, tipo) VALUES
  ('00000000-f801-0000-0000-0000000000c1', '00000000-f801-0000-0000-000000000001', '1.1.1', '__PGTAP_TEST__ Caja',                'activo'),
  ('00000000-f801-0000-0000-0000000000c2', '00000000-f801-0000-0000-000000000001', '1.1.2', '__PGTAP_TEST__ Cuentas a Cobrar',   'activo'),
  ('00000000-f801-0000-0000-0000000000c3', '00000000-f801-0000-0000-000000000001', '2.1.1', '__PGTAP_TEST__ Proveedores',        'pasivo');

INSERT INTO public.proveedores (id, empresa_id, nombre) VALUES
  ('00000000-f801-0000-0000-0000000000b1', '00000000-f801-0000-0000-000000000001', '__PGTAP_TEST__ Proveedor');

-- Cobros (HABER): m1 con un asiento existente sin vínculo, m2 sin ningún asiento, m3 cancelado sin asiento.
INSERT INTO public.cuenta_corriente_movimientos (id, empresa_id, tipo, monto, metodo_cobro, estado) VALUES
  ('00000000-f801-0000-0000-0000000000e1', '00000000-f801-0000-0000-000000000001', 'HABER', 1000, 'Efectivo', 'confirmado'),
  ('00000000-f801-0000-0000-0000000000e2', '00000000-f801-0000-0000-000000000001', 'HABER', 2000, 'Efectivo', 'confirmado'),
  ('00000000-f801-0000-0000-0000000000e3', '00000000-f801-0000-0000-000000000001', 'HABER', 3000, 'Efectivo', 'cancelado');

-- Pagos: q1 con un asiento existente sin vínculo, q2 sin ningún asiento.
INSERT INTO public.cuenta_corriente_proveedores (id, empresa_id, proveedor_id, tipo, monto) VALUES
  ('00000000-f801-0000-0000-0000000000f1', '00000000-f801-0000-0000-000000000001', '00000000-f801-0000-0000-0000000000b1', 'pago', 500),
  ('00000000-f801-0000-0000-0000000000f2', '00000000-f801-0000-0000-000000000001', '00000000-f801-0000-0000-0000000000b1', 'pago', 700);

-- Los asientos «huérfanos» (confirmados, con su origen, pero el movimiento no los tiene vinculados).
INSERT INTO public.asientos_contables (id, empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id) VALUES
  ('00000000-f801-0000-0000-000000000a01', '00000000-f801-0000-0000-000000000001', '00000000-f801-0000-0000-0000000000a1', 'PGTAP-1', CURRENT_DATE, '__PGTAP_TEST__ cobro original', 'confirmado', 1000, 1000, 'cobro_cliente',  '00000000-f801-0000-0000-0000000000e1'),
  ('00000000-f801-0000-0000-000000000a02', '00000000-f801-0000-0000-000000000001', '00000000-f801-0000-0000-0000000000a1', 'PGTAP-2', CURRENT_DATE, '__PGTAP_TEST__ pago original',  'confirmado',  500,  500, 'pago_proveedor', '00000000-f801-0000-0000-0000000000f1');

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f801-0000-0000-0000000000a1","role":"authenticated"}', true);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 1-5: cobro con asiento existente sin vínculo → se reconecta, no se duplica.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('pgtap.r1', public.regenerar_asiento_cxc('00000000-f801-0000-0000-0000000000e1', '00000000-f801-0000-0000-0000000000a1')::text, true);

SELECT is(
  (current_setting('pgtap.r1')::jsonb ->> 'reconectado'),
  'true',
  'Caso 1: un cobro cuyo asiento ya existia (sin vinculo) se reconecta'
);

SELECT is(
  (current_setting('pgtap.r1')::jsonb ->> 'asiento_id'),
  '00000000-f801-0000-0000-000000000a01',
  'Caso 2: y devuelve el asiento original'
);

SELECT is(
  (SELECT count(*)::int FROM public.asientos_contables WHERE origen = 'cobro_cliente' AND origen_id = '00000000-f801-0000-0000-0000000000e1'),
  1,
  'Caso 3: no se creo un segundo asiento (antes quedaban dos)'
);

SELECT is(
  (SELECT asiento_id::text FROM public.cuenta_corriente_movimientos WHERE id = '00000000-f801-0000-0000-0000000000e1'),
  '00000000-f801-0000-0000-000000000a01',
  'Caso 4: el cobro quedo vinculado a su asiento'
);

SELECT throws_like(
  $$SELECT public.regenerar_asiento_cxc('00000000-f801-0000-0000-0000000000e1', '00000000-f801-0000-0000-0000000000a1')$$,
  'Este cobro ya tiene un asiento contable generado%',
  'Caso 5: con el vinculo guardado, regenerar sigue rechazandose como siempre'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 6-8: cobro sin ningún asiento → se genera como siempre.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('pgtap.r2', public.regenerar_asiento_cxc('00000000-f801-0000-0000-0000000000e2', '00000000-f801-0000-0000-0000000000a1')::text, true);

SELECT is(
  (current_setting('pgtap.r2')::jsonb ->> 'ok'),
  'true',
  'Caso 6: un cobro sin asiento se regenera normalmente'
);

SELECT is(
  (SELECT count(*)::int FROM public.asientos_contables WHERE origen = 'cobro_cliente' AND origen_id = '00000000-f801-0000-0000-0000000000e2'),
  1,
  'Caso 7: y queda exactamente un asiento'
);

SELECT is(
  (current_setting('pgtap.r2')::jsonb ->> 'reconectado'),
  NULL::text,
  'Caso 8: esta vez no fue una reconexion (se creo uno nuevo)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 9-10: un cobro cancelado no se regenera.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$SELECT public.regenerar_asiento_cxc('00000000-f801-0000-0000-0000000000e3', '00000000-f801-0000-0000-0000000000a1')$$,
  'Este cobro está cancelado%',
  'Caso 9: un cobro cancelado no se puede regenerar'
);

SELECT is(
  (SELECT count(*)::int FROM public.asientos_contables WHERE origen = 'cobro_cliente' AND origen_id = '00000000-f801-0000-0000-0000000000e3'),
  0,
  'Caso 10: y no se le creo ningun asiento'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 11-14: lo mismo para los pagos a proveedores.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('pgtap.r3', public.regenerar_asiento_cxp('00000000-f801-0000-0000-0000000000f1', '00000000-f801-0000-0000-0000000000a1')::text, true);

SELECT is(
  (current_setting('pgtap.r3')::jsonb ->> 'reconectado'),
  'true',
  'Caso 11: un pago cuyo asiento ya existia (sin vinculo) se reconecta'
);

SELECT is(
  (SELECT count(*)::int FROM public.asientos_contables WHERE origen = 'pago_proveedor' AND origen_id = '00000000-f801-0000-0000-0000000000f1'),
  1,
  'Caso 12: y no se duplica'
);

SELECT is(
  (SELECT asiento_id::text FROM public.cuenta_corriente_proveedores WHERE id = '00000000-f801-0000-0000-0000000000f1'),
  '00000000-f801-0000-0000-000000000a02',
  'Caso 13: el pago quedo vinculado a su asiento'
);

SELECT is(
  (public.regenerar_asiento_cxp('00000000-f801-0000-0000-0000000000f2', '00000000-f801-0000-0000-0000000000a1') ->> 'ok'),
  'true',
  'Caso 14: un pago sin asiento se regenera normalmente'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 15-16: el chequeo de permiso de módulo sigue funcionando.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f801-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT throws_like(
  $$SELECT public.regenerar_asiento_cxc('00000000-f801-0000-0000-0000000000e2', '00000000-f801-0000-0000-0000000000a2')$$,
  'No autorizado: sin permiso de módulo ventas%',
  'Caso 15: un usuario sin el modulo ventas no regenera cobros'
);

SELECT throws_like(
  $$SELECT public.regenerar_asiento_cxp('00000000-f801-0000-0000-0000000000f2', '00000000-f801-0000-0000-0000000000a2')$$,
  'No autorizado: sin permiso de módulo compras%',
  'Caso 16: ni pagos sin el modulo compras'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
