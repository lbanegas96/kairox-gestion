-- pgTAP test: aislamiento multi-tenant (RLS + guards de tenant en RPCs)
--
-- Parte de la Fase 1 del plan de sometimiento a estrés (sesión 76-77): antes de
-- someter el sistema a carga, confirmar activamente que dos empresas nunca pueden
-- verse ni tocarse entre sí — no solo leer el código, sino probarlo. Motivado por
-- el antecedente real de este proyecto: una fuga cross-tenant en `movimientos_uala`
-- (policy de SELECT sin filtro de empresa_id, encontrada y corregida en sesión previa).
--
-- La auditoría estática (grep de las 272 CREATE POLICY + ~30 RPCs SECURITY DEFINER con
-- p_empresa_id, en su forma final tras todos los DROP/CREATE acumulados) no encontró
-- ningún gap explotable — este test es la contraparte activa de esa auditoría: monta
-- 2 tenants sintéticos, se autentica como el Tenant E1 y confirma que ni las policies
-- RLS ni las RPCs dejan tocar datos del Tenant E2.
--
-- SEGURIDAD: crea y destruye sus propios tenants/datos de prueba dentro de una
-- transacción que termina en ROLLBACK. Nunca toca empresas ni datos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(9);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: Tenant E1 (el atacante/caller) y Tenant E2 (la víctima).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-e001-0000-0000-000000000001', '__PGTAP_TEST__ Tenant E1'),
  ('00000000-e002-0000-0000-000000000002', '__PGTAP_TEST__ Tenant E2');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-e001-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-e1@kairox.test', now(), now(), now()),
  ('00000000-e002-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-e2@kairox.test', now(), now(), now());

-- El trigger on_auth_user_created ya insertó la fila en profiles (empresa_id NULL)
-- al insertar en auth.users arriba — solo hace falta completarla.
UPDATE public.profiles SET empresa_id = '00000000-e001-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-e001-0000-0000-00000000000a';
UPDATE public.profiles SET empresa_id = '00000000-e002-0000-0000-000000000002', role = 'admin' WHERE id = '00000000-e002-0000-0000-00000000000b';

-- Datos "conocidos" de la víctima (E2) que E1 va a intentar ver/tocar.
INSERT INTO public.clientes (id, empresa_id, nombre) VALUES
  ('00000000-e002-0000-0000-0000000000c1', '00000000-e002-0000-0000-000000000002', '__PGTAP_TEST__ Cliente de E2');

INSERT INTO public.productos (id, empresa_id, nombre, stock_actual) VALUES
  ('00000000-e002-0000-0000-0000000000c2', '00000000-e002-0000-0000-000000000002', '__PGTAP_TEST__ Producto de E2', 50);

-- Nos autenticamos como E1 (el caller) para todo el resto del test. El SET LOCAL
-- ROLE es imprescindible: la conexión de este test corre como `postgres`
-- (rolbypassrls=true), así que sin cambiar a `authenticated` (rolbypassrls=false,
-- el rol real con el que PostgREST atiende a un usuario logueado) ninguna policy
-- RLS se aplicaría y el test daría falsos positivos de fuga cross-tenant.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-e001-0000-0000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1-2: RLS de SELECT — E1 no puede ver clientes/productos de E2.
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.clientes WHERE id = '00000000-e002-0000-0000-0000000000c1'),
  0,
  'Caso 1: E1 no ve el cliente de E2 (RLS SELECT en clientes)'
);

SELECT is(
  (SELECT count(*)::int FROM public.productos WHERE id = '00000000-e002-0000-0000-0000000000c2'),
  0,
  'Caso 2: E1 no ve el producto de E2 (RLS SELECT en productos)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: RLS de UPDATE — un UPDATE directo de E1 contra el producto de E2 no
-- afecta ninguna fila (la policy de UPDATE lo excluye del WHERE efectivo).
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.productos SET stock_actual = 999 WHERE id = '00000000-e002-0000-0000-0000000000c2';

-- Verificar el valor real requiere leer sin el filtro RLS de E1 (que ni siquiera
-- puede ver la fila) — RESET ROLE vuelve a `postgres` (bypassrls) solo para esta
-- lectura de control, no para el propio intento de UPDATE de arriba.
RESET ROLE;
SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-e002-0000-0000-0000000000c2')::int,
  50,
  'Caso 3: UPDATE directo de E1 no modifica el stock del producto de E2 (RLS UPDATE)'
);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-e001-0000-0000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: guard de tenant en registrar_cobro_cliente — E1 no puede impersonar
-- a E2 pasando el empresa_id de E2 como parámetro.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.registrar_cobro_cliente(
       p_empresa_id     := '00000000-e002-0000-0000-000000000002'::uuid,
       p_user_id        := '00000000-e001-0000-0000-00000000000a'::uuid,
       p_cliente_id     := '00000000-e002-0000-0000-0000000000c1'::uuid,
       p_cliente_nombre := 'Cliente de E2',
       p_monto          := 100,
       p_metodo         := 'Efectivo',
       p_fecha          := now()
     ) $$,
  '%No autorizado%',
  'Caso 4: registrar_cobro_cliente rechaza p_empresa_id de E2 cuando el caller es de E1'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 5: mismo guard en registrar_pago_proveedor.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.registrar_pago_proveedor(
       p_empresa_id       := '00000000-e002-0000-0000-000000000002'::uuid,
       p_user_id          := '00000000-e001-0000-0000-00000000000a'::uuid,
       p_proveedor_id     := '00000000-e002-0000-0000-0000000000c1'::uuid,
       p_proveedor_nombre := 'Proveedor de E2',
       p_monto            := 100,
       p_metodo           := 'Efectivo'
     ) $$,
  '%No autorizado%',
  'Caso 5: registrar_pago_proveedor rechaza p_empresa_id de E2 cuando el caller es de E1'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 6: mismo guard en crear_venta (RPC de mayor fan-out del sistema).
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.crear_venta(
       p_empresa_id      := '00000000-e002-0000-0000-000000000002'::uuid,
       p_user_id         := '00000000-e001-0000-0000-00000000000a'::uuid,
       p_numero_venta    := 'V-TEST-AISLAMIENTO',
       p_fecha           := now(),
       p_cliente_id      := NULL,
       p_cliente_nombre  := 'Consumidor Final',
       p_total           := 100,
       p_forma_pago      := 'Efectivo',
       p_estado_pago     := 'pagada',
       p_moneda          := 'ARS',
       p_tipo_cambio_tasa:= 1,
       p_monto_paralelo  := NULL,
       p_tc_paralelo     := NULL,
       p_items           := '[{"producto_id":"00000000-e002-0000-0000-0000000000c2","cantidad":1,"subtotal":100,"precio_unitario":100,"alicuota_iva":"21"}]'::jsonb,
       p_pagos           := '[]'::jsonb,
       p_es_cc           := false,
       p_caja_sesion_id  := NULL,
       p_pedido_id       := NULL
     ) $$,
  '%Acceso denegado%',
  'Caso 6: crear_venta rechaza p_empresa_id de E2 cuando el caller es de E1'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 7: aunque el guard de arriba ya lo impediría, confirmar además que el
-- stock del producto de E2 sigue en 50 después de los intentos — ningún intento
-- fallido dejó un efecto colateral parcial. Misma necesidad de RESET ROLE que
-- el Caso 3: E1 no puede ver la fila para confirmarlo por sí solo.
-- ───────────────────────────────────────────────────────────────────────────

RESET ROLE;
SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-e002-0000-0000-0000000000c2')::int,
  50,
  'Caso 7: el producto de E2 no sufrió ningún efecto colateral tras los intentos fallidos'
);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-e001-0000-0000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 8: record_attempt() — la auditoría estática había encontrado que esta
-- función no valida p_empresa_id contra el caller (riesgo aceptado en mig. 120,
-- por la deny-all de abajo). Corriendo el test de verdad se descubrió que el
-- riesgo real es MENOR de lo que la auditoría de código por sí sola sugería:
-- un usuario autenticado común ni siquiera tiene EXECUTE sobre esta función
-- (solo la llaman otras RPCs internamente) — no hay superficie de ataque desde
-- el frontend en absoluto, más allá de la deny-all que ya mitigaba el gap.
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  has_function_privilege('authenticated', 'public.record_attempt(text,text,uuid)', 'EXECUTE'),
  false,
  'Caso 8: un usuario autenticado común no puede llamar record_attempt directamente (sin superficie de ataque)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 9: y aunque alguien lograra insertar una fila en rate_limit_attempts,
-- es inalcanzable para cualquiera vía SELECT (rla_deny_all) — el riesgo real
-- es cero incluso en el escenario hipotético. Se inserta como postgres (la
-- única forma de probarlo, ya que ni siquiera el propio record_attempt es
-- alcanzable) y se confirma que E1, autenticado, no puede leerla.
-- ───────────────────────────────────────────────────────────────────────────

RESET ROLE;
INSERT INTO public.rate_limit_attempts (action, identifier, empresa_id)
VALUES ('login', 'test@kairox.test', '00000000-e002-0000-0000-000000000002');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-e001-0000-0000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.rate_limit_attempts WHERE identifier = 'test@kairox.test'),
  0,
  'Caso 9: rla_deny_all bloquea el SELECT de cualquier fila de rate_limit_attempts, incluso ya insertada'
);

SELECT * FROM finish();

ROLLBACK;
