-- pgTAP test: public.sync_uala_to_bancos (trigger AFTER INSERT ON movimientos_uala)
--
-- Fase 2 del PLAN_SEMANA.md, sección 4 — "conciliación bancaria / integración
-- Uala". Reemplaza sync_uala_to_caja.test.sql (sesión 51): a pedido explícito
-- de Luciano, y validado contra la skill sap-reference (Bancos y Caja son
-- módulos distintos en cualquier sistema contable serio — una transferencia
-- de Ualá es un movimiento bancario/fintech, no efectivo físico), el trigger
-- ya NO toca movimientos_caja. Ahora resuelve la cuenta bancaria de la
-- empresa vía `integraciones_bancarias` (proveedor='uala') y llama la misma
-- RPC `insertar_movimiento_bancario_externo` que usa Mercado Pago — mismo
-- patrón, misma tabla (movimientos_bancarios), misma conciliación.
--
-- Caso documentado a propósito (NO es un bug): si la empresa todavía no
-- configuró su cuenta Ualá en Integraciones (sin fila en
-- integraciones_bancarias), el trigger no inserta nada y no lanza error — no
-- hay dónde imputar el movimiento. Es un gate de configuración de una sola
-- vez, no una carrera diaria contra si hay una caja abierta (esa era la
-- falla real del diseño viejo). Casos 4 y 5 versionan ese comportamiento.
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/cuentas de
-- prueba dentro de una transacción que termina en ROLLBACK. Nunca toca
-- empresas reales. set_config a service_role simula el contexto real del
-- Apps Script (único rol con permiso de INSERT en movimientos_uala desde la
-- migration 065).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('role', 'service_role', true);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: Tenant U (con integración Ualá configurada) + Tenant V (sin
-- configurar). El nuevo trigger no usa caja_sesiones/user_id en absoluto —
-- fixtures mucho más simples que la versión vieja.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-dada-0000-0000-000000000001', '__PGTAP_TEST__ Tenant U (con Ualá configurada)'),
  ('00000000-dada-0000-0000-000000000002', '__PGTAP_TEST__ Tenant V (sin configurar)');

INSERT INTO public.cuentas_bancarias (id, empresa_id, nombre, banco, moneda) VALUES
  ('00000000-dada-0000-0000-0000000000c1', '00000000-dada-0000-0000-000000000001', '__PGTAP_TEST__ Cuenta Ualá', 'Ualá', 'ARS');

INSERT INTO public.integraciones_bancarias (empresa_id, proveedor, cuenta_bancaria_id, activo) VALUES
  ('00000000-dada-0000-0000-000000000001', 'uala', '00000000-dada-0000-0000-0000000000c1', true);

-- Tenant V no tiene fila en integraciones_bancarias para 'uala' — a propósito.

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: Tenant U (configurado). Transferencia de 500 con destinatario →
-- debe generar exactamente 1 movimiento_bancario egreso en su cuenta Ualá.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.movimientos_uala (fecha, monto, destinatario, user_id, empresa_id) VALUES
  (now(), 500, 'Proveedor Test', NULL, '00000000-dada-0000-0000-000000000001');

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_bancarios
   WHERE empresa_id = '00000000-dada-0000-0000-000000000001'
     AND tipo = 'egreso' AND origen = 'uala' AND conciliado = false
     AND descripcion = 'Ualá → Proveedor Test' AND monto = 500),
  1,
  'Caso 1a: con integración configurada, genera exactamente 1 movimiento_bancario egreso'
);

SELECT is(
  (SELECT cuenta_bancaria_id FROM public.movimientos_bancarios
   WHERE empresa_id = '00000000-dada-0000-0000-000000000001' AND descripcion = 'Ualá → Proveedor Test'),
  '00000000-dada-0000-0000-0000000000c1'::uuid,
  'Caso 1b: el movimiento queda imputado a la cuenta bancaria configurada para Ualá'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: destinatario NULL → fallback 'Desconocido' (mismo texto que antes).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.movimientos_uala (fecha, monto, destinatario, user_id, empresa_id) VALUES
  (now(), 300, NULL, NULL, '00000000-dada-0000-0000-000000000001');

SELECT is(
  (SELECT descripcion FROM public.movimientos_bancarios
   WHERE empresa_id = '00000000-dada-0000-0000-000000000001' AND monto = 300),
  'Ualá → Desconocido',
  'Caso 2: destinatario NULL cae al fallback "Ualá → Desconocido"'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3: confirmación del reemplazo completo — ninguna de las 2 ventas de
-- arriba tocó movimientos_caja (antes sí, si había una caja abierta).
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_caja WHERE empresa_id = '00000000-dada-0000-0000-000000000001'),
  0,
  'Caso 3: el reemplazo es completo — Ualá ya no genera ningún movimiento_caja'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4 (documentado, no un bug): Tenant V no configuró su integración
-- Ualá → el trigger no inserta nada en movimientos_bancarios y no lanza error.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.movimientos_uala (fecha, monto, destinatario, user_id, empresa_id) VALUES
  (now(), 200, 'Sin configurar', NULL, '00000000-dada-0000-0000-000000000002');

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_bancarios WHERE empresa_id = '00000000-dada-0000-0000-000000000002'),
  0,
  'Caso 4 (documentado): sin integración configurada, no se genera movimiento_bancario (silencioso, sin error)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 5: tampoco cae al camino viejo (movimientos_caja) como fallback.
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_caja WHERE empresa_id = '00000000-dada-0000-0000-000000000002'),
  0,
  'Caso 5: tampoco genera movimientos_caja como fallback cuando no hay integración'
);

SELECT * FROM finish();

ROLLBACK;
