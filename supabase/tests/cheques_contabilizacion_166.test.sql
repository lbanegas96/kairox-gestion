-- pgTAP test: contabilización de cheques (migration 166)
--
-- Cubre los 2 triggers nuevos/reescritos de la migration 166:
-- fn_asiento_cheque_propio (nuevo) y fn_asiento_cheque_tercero (endoso +
-- cuenta dedicada de rechazados). No re-testea el camino "recibido" de
-- cheques de terceros (ya cubierto conceptualmente por mig.145, sin test
-- pgTAP propio en su momento) — foco en lo nuevo/cambiado acá.
--
-- SEGURIDAD: crea y destruye su propio tenant de prueba dentro de una
-- transacción que termina en ROLLBACK. Nunca toca empresas reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(10);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: Tenant J, admin (para bypasear has_module_permission sin cargar
-- el jsonb de permisos), plan de cuentas mínimo, 1 proveedor.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-cafe-0000-0000-000000000001', '__PGTAP_TEST__ Tenant J (cheques)');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-cafe-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-cheques@kairox.test', now(), now(), now());

-- El trigger on_auth_user_created ya insertó la fila en profiles — solo
-- completarla (rol admin para bypasear has_module_permission sin cargar jsonb).
UPDATE public.profiles SET empresa_id = '00000000-cafe-0000-0000-000000000001', role = 'admin'
WHERE id = '00000000-cafe-0000-0000-00000000000a';

SELECT set_config('request.jwt.claims', '{"sub":"00000000-cafe-0000-0000-00000000000a","role":"authenticated"}', true);

SELECT public.seed_plan_cuentas('00000000-cafe-0000-0000-000000000001'::uuid);

INSERT INTO public.proveedores (id, empresa_id, nombre) VALUES
  ('00000000-cafe-0000-0000-0000000000f1', '00000000-cafe-0000-0000-000000000001', '__PGTAP_TEST__ Proveedor J1');

-- Helper de saldo por cuenta, para no repetir el JOIN en cada assert.
CREATE OR REPLACE FUNCTION pg_temp.saldo_cuenta(p_empresa_id uuid, p_codigo text)
RETURNS numeric LANGUAGE sql AS $$
  SELECT COALESCE(SUM(ai.debe - ai.haber), 0)
  FROM public.asientos_items ai
  JOIN public.plan_cuentas pc ON pc.id = ai.cuenta_id
  WHERE pc.empresa_id = p_empresa_id AND pc.codigo = p_codigo;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1-3: Cheque PROPIO — pendiente → entregado → cobrado.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_cheque_propio(
  '00000000-cafe-0000-0000-000000000001'::uuid, '00000000-cafe-0000-0000-00000000000a'::uuid,
  'PP-0001', 'Banco Nación', 50000, CURRENT_DATE, CURRENT_DATE + 30,
  NULL, '00000000-cafe-0000-0000-0000000000f1'::uuid, NULL, 'Test pgTAP propio 1'
);

SELECT is(
  pg_temp.saldo_cuenta('00000000-cafe-0000-0000-000000000001', '2.1.6'),
  0::numeric,
  'Caso 1: cheque propio recién creado (pendiente) — sin asiento, 2.1.6 en 0'
);

SELECT public.cambiar_estado_cheque(
  (SELECT id FROM public.cheques WHERE numero = 'PP-0001' AND empresa_id = '00000000-cafe-0000-0000-000000000001'),
  '00000000-cafe-0000-0000-00000000000a'::uuid, 'entregado', 'Test entrega'
);

SELECT is(
  pg_temp.saldo_cuenta('00000000-cafe-0000-0000-000000000001', '2.1.6'),
  (-50000)::numeric,
  'Caso 2: entregado — 2.1.6 Documentos a Pagar queda en Haber 50000 (DEBE 2.1.1/HABER 2.1.6)'
);

SELECT public.cambiar_estado_cheque(
  (SELECT id FROM public.cheques WHERE numero = 'PP-0001' AND empresa_id = '00000000-cafe-0000-0000-000000000001'),
  '00000000-cafe-0000-0000-00000000000a'::uuid, 'cobrado', 'Test debitado por el banco'
);

SELECT is(
  pg_temp.saldo_cuenta('00000000-cafe-0000-0000-000000000001', '2.1.6'),
  0::numeric,
  'Caso 3: cobrado/debitado — 2.1.6 vuelve a 0 (DEBE 2.1.6/HABER 1.1.1), transitorio cancelado'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4-5: Cheque PROPIO — entregado → rechazado (reversa) vs.
-- pendiente → rechazado directo (sin asiento, nunca hubo evento económico).
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_cheque_propio(
  '00000000-cafe-0000-0000-000000000001'::uuid, '00000000-cafe-0000-0000-00000000000a'::uuid,
  'PP-0002', 'Banco Nación', 8000, CURRENT_DATE, CURRENT_DATE + 30,
  NULL, '00000000-cafe-0000-0000-0000000000f1'::uuid, NULL, 'Test pgTAP propio 2 (rebota)'
);
SELECT public.cambiar_estado_cheque(
  (SELECT id FROM public.cheques WHERE numero = 'PP-0002' AND empresa_id = '00000000-cafe-0000-0000-000000000001'),
  '00000000-cafe-0000-0000-00000000000a'::uuid, 'entregado', NULL
);
SELECT public.cambiar_estado_cheque(
  (SELECT id FROM public.cheques WHERE numero = 'PP-0002' AND empresa_id = '00000000-cafe-0000-0000-000000000001'),
  '00000000-cafe-0000-0000-00000000000a'::uuid, 'rechazado', 'Test rebote'
);

SELECT is(
  pg_temp.saldo_cuenta('00000000-cafe-0000-0000-000000000001', '2.1.6'),
  0::numeric,
  'Caso 4: propio entregado→rechazado — reversa deja 2.1.6 en 0 otra vez (deuda proveedor viva de nuevo)'
);

SELECT public.crear_cheque_propio(
  '00000000-cafe-0000-0000-000000000001'::uuid, '00000000-cafe-0000-0000-00000000000a'::uuid,
  'PP-0003', 'Banco Nación', 1234, CURRENT_DATE, CURRENT_DATE + 30,
  NULL, NULL, NULL, 'Test pgTAP propio 3 (anulado antes de entregar)'
);
SELECT public.cambiar_estado_cheque(
  (SELECT id FROM public.cheques WHERE numero = 'PP-0003' AND empresa_id = '00000000-cafe-0000-0000-000000000001'),
  '00000000-cafe-0000-0000-00000000000a'::uuid, 'rechazado', 'Anulado sin entregar'
);

SELECT is(
  (SELECT count(*)::int FROM public.asientos_contables WHERE origen_id = (SELECT id FROM public.cheques WHERE numero = 'PP-0003')),
  0,
  'Caso 5: propio pendiente→rechazado (nunca entregado) — cero asientos generados'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 6-8: Cheque de TERCERO — endoso a proveedor (fix del bug real).
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_cheque_tercero(
  '00000000-cafe-0000-0000-000000000001'::uuid, '00000000-cafe-0000-0000-00000000000a'::uuid,
  'TT-0001', 'Banco Galicia', 30000, CURRENT_DATE, CURRENT_DATE + 30,
  NULL, NULL, 'Test pgTAP tercero 1 (endoso)'
);

SELECT public.cambiar_estado_cheque(
  (SELECT id FROM public.cheques WHERE numero = 'TT-0001' AND empresa_id = '00000000-cafe-0000-0000-000000000001'),
  '00000000-cafe-0000-0000-00000000000a'::uuid, 'endosado', 'Endosado a proveedor J1',
  '00000000-cafe-0000-0000-0000000000f1'::uuid
);

SELECT is(
  pg_temp.saldo_cuenta('00000000-cafe-0000-0000-000000000001', '1.1.6'),
  0::numeric,
  'Caso 6: tercero endosado — 1.1.6 Cartera vuelve a 0 (salió al endosar, no espera al cobrado)'
);

SELECT is(
  (SELECT count(*)::int FROM public.asientos_contables WHERE origen_id = (SELECT id FROM public.cheques WHERE numero = 'TT-0001')),
  2,
  'Caso 6b: tercero endosado — exactamente 2 asientos (recibido + endoso), ninguno de más'
);

SELECT public.cambiar_estado_cheque(
  (SELECT id FROM public.cheques WHERE numero = 'TT-0001' AND empresa_id = '00000000-cafe-0000-0000-000000000001'),
  '00000000-cafe-0000-0000-00000000000a'::uuid, 'cobrado', 'El proveedor lo depositó y se acreditó'
);

SELECT is(
  (SELECT count(*)::int FROM public.asientos_contables WHERE origen_id = (SELECT id FROM public.cheques WHERE numero = 'TT-0001')),
  2,
  'Caso 7 (bug fix real): endosado→cobrado NO genera un 3er asiento — antes de mig.166 hubiese debitado Caja y Bancos sin que entrara efectivo real'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 9: Cheque de TERCERO — rechazado directo (en_cartera→rechazado) va a
-- la cuenta dedicada 1.1.7, no a 1.1.2/4.3 como antes de mig.166.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_cheque_tercero(
  '00000000-cafe-0000-0000-000000000001'::uuid, '00000000-cafe-0000-0000-00000000000a'::uuid,
  'TT-0002', 'Banco Galicia', 7000, CURRENT_DATE, CURRENT_DATE + 30,
  NULL, NULL, 'Test pgTAP tercero 2 (rechazado directo)'
);
SELECT public.cambiar_estado_cheque(
  (SELECT id FROM public.cheques WHERE numero = 'TT-0002' AND empresa_id = '00000000-cafe-0000-0000-000000000001'),
  '00000000-cafe-0000-0000-00000000000a'::uuid, 'rechazado', 'Rebotó'
);

SELECT is(
  pg_temp.saldo_cuenta('00000000-cafe-0000-0000-000000000001', '1.1.7'),
  7000::numeric,
  'Caso 8: tercero en_cartera→rechazado — va a 1.1.7 Deudores por Cheques Rechazados, no a 1.1.2'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 10: rechazado DESPUÉS de un endoso — reinstala la deuda del proveedor.
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.crear_cheque_tercero(
  '00000000-cafe-0000-0000-000000000001'::uuid, '00000000-cafe-0000-0000-00000000000a'::uuid,
  'TT-0003', 'Banco Galicia', 9000, CURRENT_DATE, CURRENT_DATE + 30,
  NULL, NULL, 'Test pgTAP tercero 3 (endosado y despues rechazado)'
);
SELECT public.cambiar_estado_cheque(
  (SELECT id FROM public.cheques WHERE numero = 'TT-0003' AND empresa_id = '00000000-cafe-0000-0000-000000000001'),
  '00000000-cafe-0000-0000-00000000000a'::uuid, 'endosado', NULL,
  '00000000-cafe-0000-0000-0000000000f1'::uuid
);
SELECT public.cambiar_estado_cheque(
  (SELECT id FROM public.cheques WHERE numero = 'TT-0003' AND empresa_id = '00000000-cafe-0000-0000-000000000001'),
  '00000000-cafe-0000-0000-00000000000a'::uuid, 'rechazado', 'Rebotó en manos del proveedor'
);

-- Nota: no se compara el saldo acumulado de 2.1.1 del tenant (arrastra el DEBE
-- permanente de TT-0001/PP-0001, que no deben revertirse — esos cheques se
-- cobraron bien). Se aisla el efecto neto de ESTE cheque por origen_id: el
-- DEBE del endoso (2.1.1) queda cancelado por el HABER del rechazo (2.1.1),
-- dejando la deuda del proveedor exactamente donde estaba antes de endosar.
SELECT is(
  (SELECT COALESCE(SUM(ai.debe - ai.haber), 0)
   FROM public.asientos_items ai
   JOIN public.asientos_contables ac ON ac.id = ai.asiento_id
   JOIN public.plan_cuentas pc ON pc.id = ai.cuenta_id
   WHERE ac.origen_id = (SELECT id FROM public.cheques WHERE numero = 'TT-0003') AND pc.codigo = '2.1.1'),
  0::numeric,
  'Caso 9: tercero endosado→rechazado — el efecto neto de este cheque en 2.1.1 es 0 (endoso y reversa se cancelan, la deuda del proveedor queda intacta)'
);

SELECT * FROM finish();

ROLLBACK;
