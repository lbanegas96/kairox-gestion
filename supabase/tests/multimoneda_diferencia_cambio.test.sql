-- pgTAP test: diferencia de cambio realizada en registrar_cobro_cliente
-- (migration 170 — Fase 3 Multimoneda, sesión 55).
--
-- Verifica: ganancia por diferencia de cambio (TC sube entre emisión y cobro),
-- pérdida por diferencia de cambio (TC baja), guard de sobre-imputación en
-- moneda extranjera, y regresión (factura ARS normal sin cambios de
-- comportamiento respecto a antes de esta migration).
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/datos de
-- prueba dentro de una transacción que termina en ROLLBACK. Nunca toca
-- empresas reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(9);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: tenant I, cliente, 3 facturas en USD (tipo_cambio_tasa=1000) +
-- 1 factura en ARS (regresión), 2 tasas de tipos_cambio en fechas distintas.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-aacc-0000-0000-000000000001', '__PGTAP_TEST__ Tenant I');

-- Plan de cuentas del tenant (incluye 4.4/5.9 Diferencia de Cambio) — sin esto
-- el asiento automático se salta en silencio (patrón "no bloqueante" ya
-- existente) y diferencia_cambio se resetea a 0 aunque el cálculo esté bien.
SELECT public.seed_plan_cuentas('00000000-aacc-0000-0000-000000000001');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-aacc-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-i@kairox.test', now(), now(), now());

UPDATE public.profiles SET empresa_id = '00000000-aacc-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-aacc-0000-0000-00000000000a';

INSERT INTO public.clientes (id, empresa_id, nombre) VALUES
  ('00000000-aacc-0000-0000-0000000000c1', '00000000-aacc-0000-0000-000000000001', '__PGTAP_TEST__ Cliente I');

-- TC USD: 1050 al 2026-01-10 (Caso 1, ganancia), 900 al 2026-01-20 (Caso 2, pérdida).
INSERT INTO public.tipos_cambio (empresa_id, moneda, tasa, fecha) VALUES
  ('00000000-aacc-0000-0000-000000000001', 'USD', 1050, '2026-01-10'),
  ('00000000-aacc-0000-0000-000000000001', 'USD', 900,  '2026-01-20');

-- Factura FX-1: 100 USD @ TC origen 1000 = $100.000 ARS.
INSERT INTO public.comprobantes (id, empresa_id, numero_venta, cliente_id, cliente_nombre, total, tipo, moneda, tipo_cambio_tasa, monto_moneda_original)
VALUES
  ('00000000-aacc-0000-0000-0000000000f1', '00000000-aacc-0000-0000-000000000001', '__PGTAP_TEST__ FX-1', '00000000-aacc-0000-0000-0000000000c1', '__PGTAP_TEST__ Cliente I', 100000, 'venta', 'USD', 1000, 100);

-- Factura FX-2: 50 USD @ TC origen 1000 = $50.000 ARS.
INSERT INTO public.comprobantes (id, empresa_id, numero_venta, cliente_id, cliente_nombre, total, tipo, moneda, tipo_cambio_tasa, monto_moneda_original)
VALUES
  ('00000000-aacc-0000-0000-0000000000f2', '00000000-aacc-0000-0000-000000000001', '__PGTAP_TEST__ FX-2', '00000000-aacc-0000-0000-0000000000c1', '__PGTAP_TEST__ Cliente I', 50000, 'venta', 'USD', 1000, 50);

-- Factura FX-3: 20 USD @ TC origen 1000 = $20.000 ARS (para el guard de sobre-imputación).
INSERT INTO public.comprobantes (id, empresa_id, numero_venta, cliente_id, cliente_nombre, total, tipo, moneda, tipo_cambio_tasa, monto_moneda_original)
VALUES
  ('00000000-aacc-0000-0000-0000000000f3', '00000000-aacc-0000-0000-000000000001', '__PGTAP_TEST__ FX-3', '00000000-aacc-0000-0000-0000000000c1', '__PGTAP_TEST__ Cliente I', 20000, 'venta', 'USD', 1000, 20);

-- Factura ARS-1: regresión, sin moneda extranjera.
INSERT INTO public.comprobantes (id, empresa_id, numero_venta, cliente_id, cliente_nombre, total, tipo)
VALUES
  ('00000000-aacc-0000-0000-0000000000f4', '00000000-aacc-0000-0000-000000000001', '__PGTAP_TEST__ ARS-1', '00000000-aacc-0000-0000-0000000000c1', '__PGTAP_TEST__ Cliente I', 30000, 'venta');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-aacc-0000-0000-00000000000a","role":"authenticated"}', true);

CREATE TEMP TABLE tap_output (line text);
CREATE TEMP TABLE caso1_resultado (resultado jsonb);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: Ganancia — TC sube de 1000 (origen) a 1050 (cobro). Cobro 100 USD
-- por $105.000 ARS reales. Factura FX-1 queda cancelada del todo.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO caso1_resultado
SELECT public.registrar_cobro_cliente(
  '00000000-aacc-0000-0000-000000000001'::uuid, '00000000-aacc-0000-0000-00000000000a'::uuid,
  '00000000-aacc-0000-0000-0000000000c1'::uuid, '__PGTAP_TEST__ Cliente I',
  105000, 'Transferencia', '2026-01-10 12:00:00-03'::timestamptz, 'Cobro FX-1', NULL, NULL, NULL,
  '[{"comprobante_id":"00000000-aacc-0000-0000-0000000000f1","monto_moneda_extranjera":100}]'::jsonb
);

INSERT INTO tap_output SELECT is(
  ((SELECT resultado FROM caso1_resultado)->>'diferencia_cambio')::numeric,
  5000::numeric,
  'Caso 1: ganancia por diferencia de cambio = $5.000 (100 USD * (1050-1000))'
);

INSERT INTO tap_output SELECT is(
  (SELECT saldo_pendiente FROM public.facturas_saldo_pendiente WHERE comprobante_id = '00000000-aacc-0000-0000-0000000000f1'),
  0::numeric,
  'Caso 1b: Factura FX-1 queda totalmente cancelada (saldo pendiente 0)'
);

INSERT INTO tap_output SELECT is(
  (SELECT ai.haber FROM public.asientos_items ai
   JOIN public.asientos_contables ac ON ac.id = ai.asiento_id
   JOIN public.plan_cuentas pc ON pc.id = ai.cuenta_id
   WHERE ac.origen_id = ((SELECT resultado FROM caso1_resultado)->>'cc_id')::uuid
     AND pc.codigo = '4.4'),
  5000::numeric,
  'Caso 1c: el asiento tiene $5.000 en el haber de Diferencia de Cambio (Ganancia)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: Pérdida — TC baja de 1000 (origen) a 900 (cobro). Cobro 50 USD por
-- $45.000 ARS reales. Factura FX-2 queda cancelada del todo.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO tap_output SELECT is(
  ((public.registrar_cobro_cliente(
    '00000000-aacc-0000-0000-000000000001'::uuid, '00000000-aacc-0000-0000-00000000000a'::uuid,
    '00000000-aacc-0000-0000-0000000000c1'::uuid, '__PGTAP_TEST__ Cliente I',
    45000, 'Transferencia', '2026-01-20 12:00:00-03'::timestamptz, 'Cobro FX-2', NULL, NULL, NULL,
    '[{"comprobante_id":"00000000-aacc-0000-0000-0000000000f2","monto_moneda_extranjera":50}]'::jsonb
  ))->>'diferencia_cambio')::numeric,
  -5000::numeric,
  'Caso 2: pérdida por diferencia de cambio = -$5.000 (50 USD * (900-1000))'
);

INSERT INTO tap_output SELECT is(
  (SELECT saldo_pendiente FROM public.facturas_saldo_pendiente WHERE comprobante_id = '00000000-aacc-0000-0000-0000000000f2'),
  0::numeric,
  'Caso 2b: Factura FX-2 queda totalmente cancelada (saldo pendiente 0)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: guard — imputar más moneda extranjera de la que la factura tiene
-- pendiente (FX-3 tiene 20 USD, se intentan imputar 25) debe fallar.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO tap_output SELECT throws_like(
  $t$ SELECT public.registrar_cobro_cliente(
    '00000000-aacc-0000-0000-000000000001'::uuid, '00000000-aacc-0000-0000-00000000000a'::uuid,
    '00000000-aacc-0000-0000-0000000000c1'::uuid, '__PGTAP_TEST__ Cliente I',
    26250, 'Efectivo', '2026-01-20 12:00:00-03'::timestamptz, 'Sobre-imputación FX', NULL, NULL, NULL,
    '[{"comprobante_id":"00000000-aacc-0000-0000-0000000000f3","monto_moneda_extranjera":25}]'::jsonb
  ) $t$,
  'El monto imputado%supera el saldo pendiente%',
  'Caso 3: bloquea imputar más moneda extranjera de la que la factura tiene pendiente'
);

INSERT INTO tap_output SELECT is(
  (SELECT saldo_pendiente FROM public.facturas_saldo_pendiente WHERE comprobante_id = '00000000-aacc-0000-0000-0000000000f3'),
  20000::numeric,
  'Caso 3b: el saldo pendiente de FX-3 no cambió tras el intento bloqueado'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4 (regresión): factura en ARS normal, sin monto_moneda_extranjera —
-- se comporta exactamente igual que antes de esta migration (sin diferencia
-- de cambio, saldo pendiente baja por el monto imputado tal cual).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO tap_output SELECT is(
  ((public.registrar_cobro_cliente(
    '00000000-aacc-0000-0000-000000000001'::uuid, '00000000-aacc-0000-0000-00000000000a'::uuid,
    '00000000-aacc-0000-0000-0000000000c1'::uuid, '__PGTAP_TEST__ Cliente I',
    30000, 'Efectivo', '2026-01-20 12:00:00-03'::timestamptz, 'Cobro ARS-1', NULL, NULL, NULL,
    '[{"comprobante_id":"00000000-aacc-0000-0000-0000000000f4","monto":30000}]'::jsonb
  ))->>'diferencia_cambio')::numeric,
  0::numeric,
  'Caso 4: factura en ARS no genera diferencia de cambio (regresión)'
);

INSERT INTO tap_output SELECT is(
  (SELECT saldo_pendiente FROM public.facturas_saldo_pendiente WHERE comprobante_id = '00000000-aacc-0000-0000-0000000000f4'),
  0::numeric,
  'Caso 4b: Factura ARS-1 queda cancelada exactamente por el monto imputado'
);

SELECT * FROM tap_output;

ROLLBACK;
