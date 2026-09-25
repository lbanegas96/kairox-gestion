-- pgTAP test: confirmar / anular un asiento recalcula el saldo de sus cuentas (mig. 405)
--
-- Auditoría 24/09/2026, hallazgo CON-4. Un asiento manual nace 'borrador' (sus líneas no suman) y
-- `confirmar_asiento` solo cambiaba el estado del encabezado: `plan_cuentas.saldo_actual` quedaba
-- desfasado hasta que otra línea tocara la cuenta. Este test confirma que ahora el saldo se
-- actualiza al confirmar y al anular, y que el recalculo único corrige un saldo desfasado.
--
-- SEGURIDAD: crea y destruye su propio tenant/usuario/plan de cuentas sintéticos dentro de una
-- transacción que termina en ROLLBACK. Nunca toca empresas ni datos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: una empresa, su admin y dos cuentas.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-f201-0000-0000-000000000001', '__PGTAP_TEST__ Empresa saldos');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-f201-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-saldos-adm@kairox.test', now(), now(), now());

UPDATE public.profiles SET empresa_id = '00000000-f201-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-f201-0000-0000-0000000000a1';

INSERT INTO public.plan_cuentas (id, empresa_id, codigo, nombre, tipo) VALUES
  ('00000000-f201-0000-0000-0000000000c1', '00000000-f201-0000-0000-000000000001', '9.9.1', '__PGTAP_TEST__ Cuenta activo', 'activo'),
  ('00000000-f201-0000-0000-0000000000c2', '00000000-f201-0000-0000-000000000001', '9.9.2', '__PGTAP_TEST__ Cuenta pasivo', 'pasivo');

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 1-4: asiento manual (borrador → confirmado) por el mismo camino que usa la pantalla.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f201-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT set_config(
  'pgtap.asiento_id',
  (public.crear_asiento_manual(
    '00000000-f201-0000-0000-000000000001',
    '00000000-f201-0000-0000-0000000000a1',
    CURRENT_DATE,
    '__PGTAP_TEST__ asiento manual',
    NULL,
    '[{"cuenta_id":"00000000-f201-0000-0000-0000000000c1","debe":100,"haber":0,"descripcion":"d"},{"cuenta_id":"00000000-f201-0000-0000-0000000000c2","debe":0,"haber":100,"descripcion":"h"}]'::jsonb
  ) ->> 'id'),
  true
);

RESET ROLE;

SELECT is(
  (SELECT saldo_actual FROM public.plan_cuentas WHERE id = '00000000-f201-0000-0000-0000000000c1'),
  0::numeric,
  'Caso 1: mientras el asiento es borrador el saldo no cambia'
);

SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.confirmar_asiento(current_setting('pgtap.asiento_id')::uuid)$$,
  'Caso 2: el admin confirma el asiento'
);

RESET ROLE;

SELECT is(
  (SELECT saldo_actual FROM public.plan_cuentas WHERE id = '00000000-f201-0000-0000-0000000000c1'),
  100::numeric,
  'Caso 3: al confirmar, la cuenta del debe suma 100 (antes quedaba en 0)'
);

SELECT is(
  (SELECT saldo_actual FROM public.plan_cuentas WHERE id = '00000000-f201-0000-0000-0000000000c2'),
  -100::numeric,
  'Caso 4: al confirmar, la cuenta del haber queda en -100 (convencion debe - haber)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 5: el asiento sale de 'confirmado' → los saldos vuelven atras.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.asientos_contables SET estado = 'anulado' WHERE id = current_setting('pgtap.asiento_id')::uuid;

SELECT is(
  (SELECT saldo_actual FROM public.plan_cuentas WHERE id = '00000000-f201-0000-0000-0000000000c1'),
  0::numeric,
  'Caso 5: si el asiento deja de estar confirmado, el saldo vuelve a 0'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 6-8: el recalculo único corrige un saldo desfasado y no toca los que ya estan bien.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.asientos_contables SET estado = 'confirmado' WHERE id = current_setting('pgtap.asiento_id')::uuid;

-- Se desfasa a mano el saldo de la cuenta 1 (simula el caso real de la cuenta 5.4 de Nalux).
UPDATE public.plan_cuentas SET saldo_actual = 80 WHERE id = '00000000-f201-0000-0000-0000000000c1';

SELECT is(
  (SELECT saldo_actual FROM public.plan_cuentas WHERE id = '00000000-f201-0000-0000-0000000000c1'),
  80::numeric,
  'Caso 6: precondicion, el saldo de la cuenta 1 esta desfasado (80 en vez de 100)'
);

-- Mismo UPDATE que el recalculo unico de la migracion 405.
UPDATE public.plan_cuentas pc
SET saldo_actual = m.saldo
FROM (
  SELECT c.id,
         COALESCE((
           SELECT SUM(ai.debe - ai.haber)
           FROM public.asientos_items ai
           JOIN public.asientos_contables a ON a.id = ai.asiento_id
           WHERE ai.cuenta_id = c.id AND a.estado = 'confirmado'
         ), 0) AS saldo
  FROM public.plan_cuentas c
) m
WHERE m.id = pc.id
  AND pc.saldo_actual IS DISTINCT FROM m.saldo;

SELECT is(
  (SELECT saldo_actual FROM public.plan_cuentas WHERE id = '00000000-f201-0000-0000-0000000000c1'),
  100::numeric,
  'Caso 7: el recalculo unico dejo la cuenta 1 en 100'
);

SELECT is(
  (SELECT saldo_actual FROM public.plan_cuentas WHERE id = '00000000-f201-0000-0000-0000000000c2'),
  -100::numeric,
  'Caso 8: y la cuenta 2, que ya estaba bien, sigue en -100'
);

SELECT * FROM finish();

ROLLBACK;
