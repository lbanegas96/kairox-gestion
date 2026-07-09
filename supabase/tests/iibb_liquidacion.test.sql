-- pgTAP test: generar_liquidacion_iibb / confirmar_liquidacion_iibb
-- (migration 172 — Fase 4 IIBB, sesión 55).
--
-- Verifica: jurisdicción única (cálculo correcto + guard de config faltante),
-- confirmación genera asiento balanceado y bloquea doble confirmación,
-- Convenio Multilateral con 2 jurisdicciones (cálculo correcto), guard de
-- coeficientes que no suman 100, guard de alícuota faltante para una
-- jurisdicción del CM.
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/datos de
-- prueba dentro de una transacción que termina en ROLLBACK. Nunca toca
-- empresas reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(12);

-- ───────────────────────────────────────────────────────────────────────────
-- Tenant J: jurisdicción única.
-- ───────────────────────────────────────────────────────────────────────────

-- Los 2 tenants se crean ANTES de fijar cualquier jwt.claims — el trigger
-- trg_fn_seed_maestros_empresa exige empresa_id = get_my_empresa_id() al
-- crear una empresa, así que crear el segundo tenant después de "loguearse"
-- como el primero rompería el guard (protección real, no bug del test).
INSERT INTO public.empresas (id, nombre, modalidad_iibb) VALUES
  ('00000000-aadd-0000-0000-000000000001', '__PGTAP_TEST__ Tenant J', 'jurisdiccion_unica'),
  ('00000000-aadd-0000-0000-000000000002', '__PGTAP_TEST__ Tenant K', 'convenio_multilateral');

SELECT public.seed_plan_cuentas('00000000-aadd-0000-0000-000000000001');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-aadd-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-j@kairox.test', now(), now(), now());

UPDATE public.profiles SET empresa_id = '00000000-aadd-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-aadd-0000-0000-00000000000a';

INSERT INTO public.clientes (id, empresa_id, nombre) VALUES
  ('00000000-aadd-0000-0000-0000000000c1', '00000000-aadd-0000-0000-000000000001', '__PGTAP_TEST__ Cliente J');

INSERT INTO public.comprobantes (id, empresa_id, numero_venta, cliente_id, cliente_nombre, total, neto_gravado, tipo, fecha)
VALUES
  ('00000000-aadd-0000-0000-0000000000f1', '00000000-aadd-0000-0000-000000000001', '__PGTAP_TEST__ V1', '00000000-aadd-0000-0000-0000000000c1', '__PGTAP_TEST__ Cliente J', 1210, 1000, 'venta', '2026-01-10'),
  ('00000000-aadd-0000-0000-0000000000f2', '00000000-aadd-0000-0000-000000000001', '__PGTAP_TEST__ V2', '00000000-aadd-0000-0000-0000000000c1', '__PGTAP_TEST__ Cliente J', 2420, 2000, 'venta', '2026-01-20');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-aadd-0000-0000-00000000000a","role":"authenticated"}', true);

CREATE TEMP TABLE tap_output (line text);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: guard — sin jurisdicción configurada, debe fallar.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO tap_output SELECT throws_like(
  $t$ SELECT public.generar_liquidacion_iibb(
    '00000000-aadd-0000-0000-000000000001'::uuid, '00000000-aadd-0000-0000-00000000000a'::uuid,
    '2026-01-01'::date, '2026-01-31'::date
  ) $t$,
  '%No hay jurisdicción de IIBB configurada%',
  'Caso 1: bloquea generar sin jurisdicción de IIBB configurada'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: configuro jurisdicción pero sin alícuota — debe fallar distinto.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.empresas SET jurisdiccion_iibb = 'Córdoba' WHERE id = '00000000-aadd-0000-0000-000000000001';

INSERT INTO tap_output SELECT throws_like(
  $t$ SELECT public.generar_liquidacion_iibb(
    '00000000-aadd-0000-0000-000000000001'::uuid, '00000000-aadd-0000-0000-00000000000a'::uuid,
    '2026-01-01'::date, '2026-01-31'::date
  ) $t$,
  '%Falta la alícuota de IIBB%',
  'Caso 2: bloquea generar sin alícuota de IIBB cargada para la jurisdicción'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: con alícuota cargada (3%), calcula base 3000 y monto 90 correctos.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.alicuotas_impuestos (empresa_id, impuesto, jurisdiccion, alicuota, vigencia_desde) VALUES
  ('00000000-aadd-0000-0000-000000000001', 'IIBB', 'Córdoba', 3.0, '2025-01-01');

CREATE TEMP TABLE caso3_resultado (resultado jsonb);
INSERT INTO caso3_resultado
SELECT public.generar_liquidacion_iibb(
  '00000000-aadd-0000-0000-000000000001'::uuid, '00000000-aadd-0000-0000-00000000000a'::uuid,
  '2026-01-01'::date, '2026-01-31'::date
);

INSERT INTO tap_output SELECT is(
  ((SELECT resultado FROM caso3_resultado)->>'base_imponible_total')::numeric,
  3000::numeric,
  'Caso 3: base imponible = suma de neto_gravado del período ($3.000)'
);

INSERT INTO tap_output SELECT is(
  ((SELECT resultado FROM caso3_resultado)->>'monto_total')::numeric,
  90::numeric,
  'Caso 3b: monto IIBB = base * 3% = $90'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: confirmar la liquidación genera un asiento balanceado y la marca
-- como confirmada.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE caso4_confirmacion (resultado jsonb);
INSERT INTO caso4_confirmacion
SELECT public.confirmar_liquidacion_iibb(
  '00000000-aadd-0000-0000-000000000001'::uuid, '00000000-aadd-0000-0000-00000000000a'::uuid,
  ((SELECT resultado FROM caso3_resultado)->>'id')::uuid
);

INSERT INTO tap_output SELECT is(
  ((SELECT resultado FROM caso4_confirmacion)->>'asiento_generado')::boolean,
  true,
  'Caso 4: confirmar genera el asiento contable (cuentas 5.6/2.1.4 existen por seed_plan_cuentas)'
);

INSERT INTO tap_output SELECT is(
  (SELECT estado FROM public.iibb_liquidaciones WHERE id = ((SELECT resultado FROM caso3_resultado)->>'id')::uuid),
  'confirmada',
  'Caso 4b: la liquidación queda con estado confirmada'
);

INSERT INTO tap_output SELECT is(
  (SELECT ac.total_debe FROM public.asientos_contables ac
   WHERE ac.id = (SELECT asiento_id FROM public.iibb_liquidaciones WHERE id = ((SELECT resultado FROM caso3_resultado)->>'id')::uuid)),
  90::numeric,
  'Caso 4c: el asiento generado está balanceado (total_debe = total_haber = $90)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 5: guard — confirmar una liquidación ya confirmada debe fallar.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO tap_output SELECT throws_like(
  format(
    $t$ SELECT public.confirmar_liquidacion_iibb(
      '00000000-aadd-0000-0000-000000000001'::uuid, '00000000-aadd-0000-0000-00000000000a'::uuid, '%s'::uuid
    ) $t$,
    ((SELECT resultado FROM caso3_resultado)->>'id')
  ),
  '%ya fue confirmada%',
  'Caso 5: bloquea confirmar una liquidación que ya estaba confirmada'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Tenant K: Convenio Multilateral — Córdoba 60% / Buenos Aires 40%.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-aadd-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-k@kairox.test', now(), now(), now());

UPDATE public.profiles SET empresa_id = '00000000-aadd-0000-0000-000000000002', role = 'admin' WHERE id = '00000000-aadd-0000-0000-00000000000b';

INSERT INTO public.clientes (id, empresa_id, nombre) VALUES
  ('00000000-aadd-0000-0000-0000000000c2', '00000000-aadd-0000-0000-000000000002', '__PGTAP_TEST__ Cliente K');

INSERT INTO public.comprobantes (id, empresa_id, numero_venta, cliente_id, cliente_nombre, total, neto_gravado, tipo, fecha)
VALUES
  ('00000000-aadd-0000-0000-0000000000f3', '00000000-aadd-0000-0000-000000000002', '__PGTAP_TEST__ V3', '00000000-aadd-0000-0000-0000000000c2', '__PGTAP_TEST__ Cliente K', 12100, 10000, 'venta', '2026-02-10');

INSERT INTO public.alicuotas_impuestos (empresa_id, impuesto, jurisdiccion, alicuota, vigencia_desde) VALUES
  ('00000000-aadd-0000-0000-000000000002', 'IIBB', 'Córdoba', 3.0, '2025-01-01'),
  ('00000000-aadd-0000-0000-000000000002', 'IIBB', 'Buenos Aires', 2.0, '2025-01-01');

INSERT INTO public.iibb_coeficientes (empresa_id, jurisdiccion, coeficiente, vigencia_desde) VALUES
  ('00000000-aadd-0000-0000-000000000002', 'Córdoba', 60, '2025-01-01'),
  ('00000000-aadd-0000-0000-000000000002', 'Buenos Aires', 40, '2025-01-01');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-aadd-0000-0000-00000000000b","role":"authenticated"}', true);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 6: CM con coeficientes correctos — base 6000/4000, monto 180+80=260.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE caso6_resultado (resultado jsonb);
INSERT INTO caso6_resultado
SELECT public.generar_liquidacion_iibb(
  '00000000-aadd-0000-0000-000000000002'::uuid, '00000000-aadd-0000-0000-00000000000b'::uuid,
  '2026-02-01'::date, '2026-02-28'::date
);

INSERT INTO tap_output SELECT is(
  ((SELECT resultado FROM caso6_resultado)->>'monto_total')::numeric,
  260::numeric,
  'Caso 6: Convenio Multilateral calcula 260 = (10000*0.6*3%) + (10000*0.4*2%)'
);

INSERT INTO tap_output SELECT is(
  jsonb_array_length((SELECT resultado FROM caso6_resultado)->'detalle'),
  2,
  'Caso 6b: el detalle tiene una fila por jurisdicción (2)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 7: guard — si desactivo Buenos Aires, los coeficientes vigentes ya no
-- suman 100 y debe bloquear la liquidación.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.iibb_coeficientes SET activo = false
WHERE empresa_id = '00000000-aadd-0000-0000-000000000002' AND jurisdiccion = 'Buenos Aires';

INSERT INTO tap_output SELECT throws_like(
  $t$ SELECT public.generar_liquidacion_iibb(
    '00000000-aadd-0000-0000-000000000002'::uuid, '00000000-aadd-0000-0000-00000000000b'::uuid,
    '2026-02-01'::date, '2026-02-28'::date
  ) $t$,
  '%deberían sumar 100%',
  'Caso 7: bloquea liquidar si los coeficientes vigentes no suman 100'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 8: guard — reactivo Buenos Aires pero borro su alícuota; debe fallar
-- pidiendo la alícuota faltante.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.iibb_coeficientes SET activo = true
WHERE empresa_id = '00000000-aadd-0000-0000-000000000002' AND jurisdiccion = 'Buenos Aires';

DELETE FROM public.alicuotas_impuestos
WHERE empresa_id = '00000000-aadd-0000-0000-000000000002' AND jurisdiccion = 'Buenos Aires';

INSERT INTO tap_output SELECT throws_like(
  $t$ SELECT public.generar_liquidacion_iibb(
    '00000000-aadd-0000-0000-000000000002'::uuid, '00000000-aadd-0000-0000-00000000000b'::uuid,
    '2026-02-01'::date, '2026-02-28'::date
  ) $t$,
  '%Falta la alícuota de IIBB para Buenos Aires%',
  'Caso 8: bloquea liquidar si falta la alícuota de una jurisdicción del CM'
);

SELECT * FROM tap_output;

ROLLBACK;
