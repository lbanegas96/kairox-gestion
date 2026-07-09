-- pgTAP test: registrar_cobro_cliente con imputación por factura (migration 169)
--
-- Verifica: imputación total, imputación parcial dividida en 2 facturas,
-- guard de sobre-imputación (monto > saldo pendiente de la factura), guard
-- de suma imputada > monto del cobro, y regresión (cobro SIN imputaciones
-- se comporta exactamente igual que antes de esta migration).
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/datos de
-- prueba dentro de una transacción que termina en ROLLBACK. Nunca toca
-- empresas reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: tenant H, cliente, 2 facturas ($1000 y $500).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-aabb-0000-0000-000000000001', '__PGTAP_TEST__ Tenant H');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-aabb-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-h@kairox.test', now(), now(), now());

UPDATE public.profiles SET empresa_id = '00000000-aabb-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-aabb-0000-0000-00000000000a';

INSERT INTO public.clientes (id, empresa_id, nombre) VALUES
  ('00000000-aabb-0000-0000-0000000000c1', '00000000-aabb-0000-0000-000000000001', '__PGTAP_TEST__ Cliente H');

INSERT INTO public.comprobantes (id, empresa_id, numero_venta, cliente_id, cliente_nombre, total, tipo)
VALUES
  ('00000000-aabb-0000-0000-0000000000f1', '00000000-aabb-0000-0000-000000000001', '__PGTAP_TEST__ F001', '00000000-aabb-0000-0000-0000000000c1', '__PGTAP_TEST__ Cliente H', 1000, 'venta'),
  ('00000000-aabb-0000-0000-0000000000f2', '00000000-aabb-0000-0000-000000000001', '__PGTAP_TEST__ F002', '00000000-aabb-0000-0000-0000000000c1', '__PGTAP_TEST__ Cliente H', 500,  'venta');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-aabb-0000-0000-00000000000a","role":"authenticated"}', true);

CREATE TEMP TABLE tap_output (line text);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: cobro de $1000 imputado en su totalidad a la Factura 1.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO tap_output SELECT is(
  ((public.registrar_cobro_cliente(
    '00000000-aabb-0000-0000-000000000001'::uuid, '00000000-aabb-0000-0000-00000000000a'::uuid,
    '00000000-aabb-0000-0000-0000000000c1'::uuid, '__PGTAP_TEST__ Cliente H',
    1000, 'Transferencia', now(), 'Cobro F001', NULL, NULL, NULL,
    '[{"comprobante_id":"00000000-aabb-0000-0000-0000000000f1","monto":1000}]'::jsonb
  ))->>'ok')::boolean,
  true,
  'Caso 1: registrar_cobro_cliente con imputación total devuelve ok=true'
);

INSERT INTO tap_output SELECT is(
  (SELECT saldo_pendiente FROM public.facturas_saldo_pendiente WHERE comprobante_id = '00000000-aabb-0000-0000-0000000000f1'),
  0::numeric,
  'Caso 1b: Factura 1 queda con saldo pendiente 0 tras la imputación total'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: cobro parcial de $300 imputado a la Factura 2 ($500 → $200 pendiente).
-- ───────────────────────────────────────────────────────────────────────────

SELECT public.registrar_cobro_cliente(
  '00000000-aabb-0000-0000-000000000001'::uuid, '00000000-aabb-0000-0000-00000000000a'::uuid,
  '00000000-aabb-0000-0000-0000000000c1'::uuid, '__PGTAP_TEST__ Cliente H',
  300, 'Efectivo', now(), 'Cobro parcial F002', NULL, NULL, NULL,
  '[{"comprobante_id":"00000000-aabb-0000-0000-0000000000f2","monto":300}]'::jsonb
);

INSERT INTO tap_output SELECT is(
  (SELECT saldo_pendiente FROM public.facturas_saldo_pendiente WHERE comprobante_id = '00000000-aabb-0000-0000-0000000000f2'),
  200::numeric,
  'Caso 2: Factura 2 ($500) con cobro parcial de $300 queda en $200 pendiente'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: guard — imputar más de lo pendiente en Factura 2 (quedan $200,
-- se intenta imputar $9999) debe fallar y no modificar nada.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO tap_output SELECT throws_like(
  $t$ SELECT public.registrar_cobro_cliente(
    '00000000-aabb-0000-0000-000000000001'::uuid, '00000000-aabb-0000-0000-00000000000a'::uuid,
    '00000000-aabb-0000-0000-0000000000c1'::uuid, '__PGTAP_TEST__ Cliente H',
    9999, 'Efectivo', now(), 'Sobre-imputación', NULL, NULL, NULL,
    '[{"comprobante_id":"00000000-aabb-0000-0000-0000000000f2","monto":9999}]'::jsonb
  ) $t$,
  'El monto imputado%supera el saldo pendiente%',
  'Caso 3: bloquea imputar más de lo que la factura tiene pendiente'
);

INSERT INTO tap_output SELECT is(
  (SELECT saldo_pendiente FROM public.facturas_saldo_pendiente WHERE comprobante_id = '00000000-aabb-0000-0000-0000000000f2'),
  200::numeric,
  'Caso 3b: el saldo pendiente de Factura 2 no cambió tras el intento bloqueado'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: guard — la suma imputada no puede superar el monto del cobro.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO tap_output SELECT throws_like(
  $t$ SELECT public.registrar_cobro_cliente(
    '00000000-aabb-0000-0000-000000000001'::uuid, '00000000-aabb-0000-0000-00000000000a'::uuid,
    '00000000-aabb-0000-0000-0000000000c1'::uuid, '__PGTAP_TEST__ Cliente H',
    50, 'Efectivo', now(), 'Imputa más que el cobro', NULL, NULL, NULL,
    '[{"comprobante_id":"00000000-aabb-0000-0000-0000000000f2","monto":150}]'::jsonb
  ) $t$,
  'La suma imputada a facturas%no puede superar el monto del cobro%',
  'Caso 4: bloquea si la suma imputada supera el monto total del cobro'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 5 (regresión): cobro SIN imputaciones — se comporta exactamente igual
-- que antes de esta migration (reduce saldo corrido, sin tocar ninguna
-- factura puntual).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO tap_output SELECT is(
  ((public.registrar_cobro_cliente(
    '00000000-aabb-0000-0000-000000000001'::uuid, '00000000-aabb-0000-0000-00000000000a'::uuid,
    '00000000-aabb-0000-0000-0000000000c1'::uuid, '__PGTAP_TEST__ Cliente H',
    100, 'Efectivo', now(), 'Cobro genérico sin imputar'
  ))->>'ok')::boolean,
  true,
  'Caso 5: cobro sin p_imputaciones sigue funcionando (modo legado)'
);

INSERT INTO tap_output SELECT is(
  (SELECT saldo_pendiente FROM public.facturas_saldo_pendiente WHERE comprobante_id = '00000000-aabb-0000-0000-0000000000f2'),
  200::numeric,
  'Caso 5b: un cobro genérico sin imputar NO afecta el saldo pendiente de ninguna factura puntual'
);

SELECT * FROM tap_output;

ROLLBACK;
