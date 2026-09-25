-- pgTAP test: reversar un asiento confirmado con un contra-asiento (mig. 410)
--
-- Auditoría 24/09/2026, hallazgo CON-3. Un asiento confirmado no se borra ni se anula: se corrige con un
-- contra-asiento. Este test confirma que `reversar_asiento`:
--   - crea el contra-asiento confirmado (líneas invertidas), lo enlaza con el original y deja el saldo en cero,
--   - no reversa dos veces, ni una reversa, ni un borrador, ni un asiento desbalanceado, ni en un período cerrado,
--   - solo lo puede usar un administrador de la empresa del asiento y con un motivo,
--   - se niega si el asiento pertenece a un documento (venta, compra, cobro…), que se deshace cancelando el documento,
--   - permite reversar un duplicado huérfano (el caso real de los 8 de la auditoría),
--   - y que la función que hace el trabajo no es ejecutable por los usuarios.
--
-- SEGURIDAD: crea y destruye sus propios tenants/usuarios/asientos sintéticos dentro de una transacción
-- que termina en ROLLBACK. Nunca toca empresas ni datos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(21);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: dos empresas; en la A un admin y un empleado con el módulo configuración; en la B un admin.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-f901-0000-0000-000000000001', '__PGTAP_TEST__ Empresa A reversa'),
  ('00000000-f901-0000-0000-000000000002', '__PGTAP_TEST__ Empresa B reversa');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-f901-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-rev-adm@kairox.test',  now(), now(), now()),
  ('00000000-f901-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-rev-conf@kairox.test', now(), now(), now()),
  ('00000000-f901-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-rev-admb@kairox.test', now(), now(), now());

UPDATE public.profiles SET empresa_id = '00000000-f901-0000-0000-000000000001', role = 'admin'                                 WHERE id = '00000000-f901-0000-0000-0000000000a1';
UPDATE public.profiles SET empresa_id = '00000000-f901-0000-0000-000000000001', permissions = '{"configuracion": true}'::jsonb WHERE id = '00000000-f901-0000-0000-0000000000a2';
UPDATE public.profiles SET empresa_id = '00000000-f901-0000-0000-000000000002', role = 'admin'                                 WHERE id = '00000000-f901-0000-0000-0000000000a3';

INSERT INTO public.plan_cuentas (id, empresa_id, codigo, nombre, tipo) VALUES
  ('00000000-f901-0000-0000-0000000000c1', '00000000-f901-0000-0000-000000000001', '9.9.1', '__PGTAP_TEST__ A activo',  'activo'),
  ('00000000-f901-0000-0000-0000000000c2', '00000000-f901-0000-0000-000000000001', '9.9.2', '__PGTAP_TEST__ A ingreso', 'ingreso');

-- X1: asiento manual confirmado (sin origen). X2: de un cobro (el movimiento lo tiene vinculado).
-- X3: duplicado huérfano de ese cobro (nadie lo tiene vinculado). X4: borrador. X5: confirmado pero desbalanceado.
-- X6: para el caso del período cerrado. X7: para la función interna con otro origen.
INSERT INTO public.asientos_contables (id, empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id) VALUES
  ('00000000-f901-0000-0000-000000000a01', '00000000-f901-0000-0000-000000000001', '00000000-f901-0000-0000-0000000000a1', 'AS-900001', CURRENT_DATE, '__PGTAP_TEST__ manual',            'confirmado', 100, 100, NULL,            NULL),
  ('00000000-f901-0000-0000-000000000a02', '00000000-f901-0000-0000-000000000001', '00000000-f901-0000-0000-0000000000a1', 'AS-900002', CURRENT_DATE, '__PGTAP_TEST__ cobro vinculado',    'confirmado', 100, 100, 'cobro_cliente', '00000000-f901-0000-0000-0000000000e1'),
  ('00000000-f901-0000-0000-000000000a03', '00000000-f901-0000-0000-000000000001', '00000000-f901-0000-0000-0000000000a1', 'AS-900003', CURRENT_DATE, '__PGTAP_TEST__ duplicado huerfano', 'confirmado', 100, 100, 'cobro_cliente', '00000000-f901-0000-0000-0000000000e1'),
  ('00000000-f901-0000-0000-000000000a04', '00000000-f901-0000-0000-000000000001', '00000000-f901-0000-0000-0000000000a1', 'AS-900004', CURRENT_DATE, '__PGTAP_TEST__ borrador',           'borrador',   100, 100, NULL,            NULL),
  ('00000000-f901-0000-0000-000000000a05', '00000000-f901-0000-0000-000000000001', '00000000-f901-0000-0000-0000000000a1', 'AS-900005', CURRENT_DATE, '__PGTAP_TEST__ desbalanceado',     'confirmado', 100,  50, NULL,            NULL),
  ('00000000-f901-0000-0000-000000000a06', '00000000-f901-0000-0000-000000000001', '00000000-f901-0000-0000-0000000000a1', 'AS-900006', CURRENT_DATE, '__PGTAP_TEST__ periodo cerrado',   'confirmado', 100, 100, NULL,            NULL),
  ('00000000-f901-0000-0000-000000000a07', '00000000-f901-0000-0000-000000000001', '00000000-f901-0000-0000-0000000000a1', 'AS-900007', CURRENT_DATE, '__PGTAP_TEST__ duplicado interno', 'confirmado', 100, 100, 'pago_proveedor', '00000000-f901-0000-0000-0000000000e2');

INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
SELECT a.id, '00000000-f901-0000-0000-000000000001', '00000000-f901-0000-0000-0000000000c1', 'linea debe', 100, 0
FROM public.asientos_contables a WHERE a.empresa_id = '00000000-f901-0000-0000-000000000001';

INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
SELECT a.id, '00000000-f901-0000-0000-000000000001', '00000000-f901-0000-0000-0000000000c2', 'linea haber',
       0, CASE WHEN a.numero = 'AS-900005' THEN 50 ELSE 100 END
FROM public.asientos_contables a WHERE a.empresa_id = '00000000-f901-0000-0000-000000000001';

-- El movimiento de cobro que tiene a X2 como su asiento.
INSERT INTO public.cuenta_corriente_movimientos (id, empresa_id, tipo, monto, metodo_cobro, asiento_id) VALUES
  ('00000000-f901-0000-0000-0000000000e1', '00000000-f901-0000-0000-000000000001', 'HABER', 100, 'Efectivo', '00000000-f901-0000-0000-000000000a02');

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f901-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT set_config('pgtap.saldo_antes', (SELECT saldo_actual::text FROM public.plan_cuentas WHERE id = '00000000-f901-0000-0000-0000000000c1'), true);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 1-5: el admin reversa el asiento manual X1.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('pgtap.rev1', public.reversar_asiento('00000000-f901-0000-0000-000000000a01', 'Se cargó dos veces por error')::text, true);

SELECT is(
  (current_setting('pgtap.rev1')::jsonb ->> 'reversa_de'),
  'AS-900001',
  'Caso 1: el admin reversa un asiento manual confirmado y se informa de cual es la reversa'
);

SELECT is(
  (SELECT count(*)::int FROM public.asientos_items WHERE asiento_id = (current_setting('pgtap.rev1')::jsonb ->> 'id')::uuid
     AND ((cuenta_id = '00000000-f901-0000-0000-0000000000c1' AND haber = 100 AND debe = 0)
       OR (cuenta_id = '00000000-f901-0000-0000-0000000000c2' AND debe = 100 AND haber = 0))),
  2,
  'Caso 2: el contra-asiento tiene las mismas lineas con el debe y el haber invertidos'
);

SELECT is(
  (SELECT estado::text || '|' || origen::text || '|' || (origen_id = '00000000-f901-0000-0000-000000000a01')::text
   FROM public.asientos_contables WHERE id = (current_setting('pgtap.rev1')::jsonb ->> 'id')::uuid),
  'confirmado|reversa_asiento|true',
  'Caso 3: queda confirmado, con origen reversa_asiento y enlazado al asiento reversado'
);

SELECT is(
  (SELECT saldo_actual FROM public.plan_cuentas WHERE id = '00000000-f901-0000-0000-0000000000c1'),
  current_setting('pgtap.saldo_antes')::numeric - 100,
  'Caso 4: la reversa deja el saldo de la cuenta 100 mas abajo (anula el efecto del asiento original)'
);

SELECT throws_like(
  $$SELECT public.reversar_asiento('00000000-f901-0000-0000-000000000a01', 'Otra vez')$$,
  'Este asiento ya fue reversado%',
  'Caso 5: el mismo asiento no se puede reversar dos veces'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 6-11: lo que se rechaza.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  format($$SELECT public.reversar_asiento(%L, 'Reversar la reversa')$$, (current_setting('pgtap.rev1')::jsonb ->> 'id')),
  'Este asiento ya es una reversa%',
  'Caso 6: una reversa no se reversa'
);

SELECT throws_like(
  $$SELECT public.reversar_asiento('00000000-f901-0000-0000-000000000a04', 'Es un borrador')$$,
  'Solo se puede reversar un asiento confirmado%',
  'Caso 7: un borrador no se reversa (para eso esta anular)'
);

SELECT throws_like(
  $$SELECT public.reversar_asiento('00000000-f901-0000-0000-000000000a05', 'Esta desbalanceado')$$,
  'El asiento original no está balanceado%',
  'Caso 8: un asiento desbalanceado no se reversa automaticamente'
);

SELECT throws_like(
  $$SELECT public.reversar_asiento('00000000-f901-0000-0000-000000000a02', 'Cobro vinculado')$$,
  'Este asiento pertenece a un documento%',
  'Caso 9: un asiento que un documento tiene como suyo no se reversa suelto (se cancela el documento)'
);

SELECT throws_like(
  $$SELECT public.reversar_asiento('00000000-f901-0000-0000-000000000a06', 'x')$$,
  'Indicá el motivo de la reversa%',
  'Caso 10: hace falta un motivo escrito'
);

SELECT throws_like(
  $$SELECT public.reversar_asiento('00000000-f901-0000-0000-0000000000ff', 'Asiento inexistente')$$,
  'Asiento no encontrado%',
  'Caso 11: un asiento que no existe da error claro'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 12: el duplicado huérfano de un cobro SÍ se puede reversar (el caso real de la auditoría).
-- ───────────────────────────────────────────────────────────────────────────

SELECT lives_ok(
  $$SELECT public.reversar_asiento('00000000-f901-0000-0000-000000000a03', 'Duplicado del asiento AS-900002')$$,
  'Caso 12: un duplicado huerfano (sin documento que lo tenga vinculado) se puede reversar'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 13-14: la función interna (la que usan las correcciones de datos) admite otro origen.
-- ───────────────────────────────────────────────────────────────────────────

RESET ROLE;

SELECT is(
  (public.reversar_asiento_interno('00000000-f901-0000-0000-000000000a07', 'Duplicado', 'reversa_asiento_duplicado', '00000000-f901-0000-0000-0000000000a1', NULL) ->> 'reversa_de'),
  'AS-900007',
  'Caso 13: la funcion interna reversa el asiento que se le indica'
);

SELECT is(
  (SELECT origen::text FROM public.asientos_contables WHERE origen_id = '00000000-f901-0000-0000-000000000a07'),
  'reversa_asiento_duplicado',
  'Caso 14: y guarda el origen que se le pidio (el de las reversas de duplicados, como en la mig. 397)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 15-16: quién puede.
-- ───────────────────────────────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-f901-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT throws_like(
  $$SELECT public.reversar_asiento('00000000-f901-0000-0000-000000000a06', 'Un empleado con configuracion')$$,
  'No autorizado: solo un administrador%',
  'Caso 15: un empleado, aunque tenga el modulo configuracion, no puede reversar asientos confirmados'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f901-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT throws_like(
  $$SELECT public.reversar_asiento('00000000-f901-0000-0000-000000000a06', 'Admin de otra empresa')$$,
  'No autorizado: el asiento no pertenece a esta empresa%',
  'Caso 16: el admin de OTRA empresa no puede reversar el asiento'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 17-18: período cerrado (cierra el período de hoy en la empresa A).
-- ───────────────────────────────────────────────────────────────────────────

RESET ROLE;

INSERT INTO public.periodos_contables (empresa_id, nombre, fecha_inicio, fecha_cierre, estado) VALUES
  ('00000000-f901-0000-0000-000000000001', '__PGTAP_TEST__ periodo', CURRENT_DATE - 30, CURRENT_DATE + 30, 'cerrado');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-f901-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT throws_like(
  $$SELECT public.reversar_asiento('00000000-f901-0000-0000-000000000a06', 'Periodo cerrado')$$,
  'Período cerrado%',
  'Caso 17: no se reversa con fecha dentro de un periodo contable cerrado'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.asientos_contables WHERE origen_id = '00000000-f901-0000-0000-000000000a06'),
  0,
  'Caso 18: y no se creo ninguna reversa para ese asiento'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 19-21: permisos de ejecución de las funciones.
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  has_function_privilege('authenticated', 'public.reversar_asiento_interno(uuid, text, text, uuid, date)', 'EXECUTE'),
  false,
  'Caso 19: los usuarios no pueden ejecutar la funcion interna (no valida quien llama)'
);

SELECT is(
  has_function_privilege('anon', 'public.reversar_asiento(uuid, text)', 'EXECUTE'),
  false,
  'Caso 20: un usuario sin sesion no puede ejecutar reversar_asiento'
);

SELECT is(
  has_function_privilege('authenticated', 'public.reversar_asiento(uuid, text)', 'EXECUTE'),
  true,
  'Caso 21: un usuario con sesion si (la funcion valida despues que sea admin de la empresa)'
);

SELECT * FROM finish();

ROLLBACK;
