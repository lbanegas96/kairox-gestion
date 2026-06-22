-- pgTAP test: public.sync_uala_to_caja (trigger AFTER INSERT ON movimientos_uala)
--
-- Fase 2 del PLAN_SEMANA.md, sección 4 — "conciliación bancaria / integración
-- Uala sin test". El trigger trigger_uala_to_caja (función sync_uala_to_caja)
-- es el único punto que conecta una transferencia de Ualá con la caja
-- registrada en el sistema: busca la caja_sesion ABIERTA del usuario
-- (cierre_fecha IS NULL) y le inserta un movimiento 'egreso' automático.
-- movimientos_uala no tiene columna 'tipo' — toda fila representa una salida
-- de dinero ("Ualá → destinatario"), por eso el tipo es siempre 'egreso', sin
-- mirar signo ni nada mas.
--
-- Caso documentado a propósito (NO es un bug, es el diseño actual): si el
-- usuario no tiene ninguna caja_sesion abierta en ese momento, el trigger no
-- inserta nada y no lanza error — la transferencia de Ualá queda sin
-- reflejarse en movimientos_caja, silenciosamente. Casos 3 y 4 de este
-- archivo versionan ese comportamiento tal cual existe hoy.
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/usuarios/cajas
-- de prueba dentro de una transacción que termina en ROLLBACK. Nunca toca
-- empresas reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(5);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: Tenant U (todos los casos). El trigger trg_empresa_caja_principal
-- ya crea la "Caja Principal" en `cajas` al insertar la empresa — no hace
-- falta insertarla a mano.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-dada-0000-0000-000000000001', '__PGTAP_TEST__ Tenant U');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-dada-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-ua@kairox.test', now(), now(), now()),
  ('00000000-dada-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-ub@kairox.test', now(), now(), now()),
  ('00000000-dada-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-uc@kairox.test', now(), now(), now());

-- El trigger on_auth_user_created ya insertó la fila en profiles (con
-- empresa_id NULL) al insertar en auth.users arriba — solo hace falta
-- completarla, no insertar de nuevo (insertar de nuevo viola la PK).
UPDATE public.profiles SET empresa_id = '00000000-dada-0000-0000-000000000001' WHERE id IN (
  '00000000-dada-0000-0000-00000000000a',
  '00000000-dada-0000-0000-00000000000b',
  '00000000-dada-0000-0000-00000000000c'
);

-- Usuario A: tiene una caja_sesion ABIERTA (el caso normal).
INSERT INTO public.caja_sesiones (id, empresa_id, caja_id, user_id, abierto_por, monto_inicial, estado, apertura_fecha)
SELECT '00000000-dada-0000-0000-00000000000d', '00000000-dada-0000-0000-000000000001', c.id,
       '00000000-dada-0000-0000-00000000000a', '00000000-dada-0000-0000-00000000000a', 1000, 'abierta', now()
FROM public.cajas c WHERE c.empresa_id = '00000000-dada-0000-0000-000000000001';

-- Usuario B: no tiene ninguna caja_sesion (ni abierta ni cerrada).

-- Usuario C: tiene una caja_sesion, pero CERRADA.
INSERT INTO public.caja_sesiones (id, empresa_id, caja_id, user_id, abierto_por, cerrado_por, monto_inicial, estado, apertura_fecha, cierre_fecha)
SELECT '00000000-dada-0000-0000-00000000000e', '00000000-dada-0000-0000-000000000001', c.id,
       '00000000-dada-0000-0000-00000000000c', '00000000-dada-0000-0000-00000000000c', '00000000-dada-0000-0000-00000000000c',
       1000, 'cerrada', now() - INTERVAL '1 day', now() - INTERVAL '1 hour'
FROM public.cajas c WHERE c.empresa_id = '00000000-dada-0000-0000-000000000001';

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: usuario con caja abierta. Transferencia Ualá de 500 con destinatario
-- → debe generar exactamente 1 movimiento_caja egreso, ligado a esa sesion.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.movimientos_uala (fecha, monto, destinatario, user_id, empresa_id) VALUES
  (now(), 500, 'Proveedor Test', '00000000-dada-0000-0000-00000000000a', '00000000-dada-0000-0000-000000000001');

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_caja
   WHERE user_id = '00000000-dada-0000-0000-00000000000a'
     AND tipo = 'egreso' AND categoria = 'Otro Egreso'
     AND concepto = 'Ualá → Proveedor Test' AND monto = 500
     AND metodo_pago = 'Transferencia' AND is_automatic = true),
  1,
  'Caso 1a: transferencia Ualá con caja abierta genera exactamente 1 movimiento_caja egreso'
);

SELECT is(
  (SELECT caja_sesion_id FROM public.movimientos_caja
   WHERE user_id = '00000000-dada-0000-0000-00000000000a' AND concepto = 'Ualá → Proveedor Test'),
  '00000000-dada-0000-0000-00000000000d'::uuid,
  'Caso 1b: el movimiento queda ligado a la caja_sesion abierta correcta'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: destinatario NULL → el concepto cae al fallback 'Desconocido'.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.movimientos_uala (fecha, monto, destinatario, user_id, empresa_id) VALUES
  (now(), 300, NULL, '00000000-dada-0000-0000-00000000000a', '00000000-dada-0000-0000-000000000001');

SELECT is(
  (SELECT concepto FROM public.movimientos_caja
   WHERE user_id = '00000000-dada-0000-0000-00000000000a' AND monto = 300),
  'Ualá → Desconocido',
  'Caso 2: destinatario NULL cae al fallback "Ualá → Desconocido"'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3 (comportamiento documentado, no un bug): usuario SIN ninguna
-- caja_sesion. El trigger no inserta nada y tampoco lanza error.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.movimientos_uala (fecha, monto, destinatario, user_id, empresa_id) VALUES
  (now(), 200, 'Sin caja', '00000000-dada-0000-0000-00000000000b', '00000000-dada-0000-0000-000000000001');

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_caja WHERE user_id = '00000000-dada-0000-0000-00000000000b'),
  0,
  'Caso 3 (documentado): sin ninguna caja_sesion, no se genera movimiento_caja (silencioso, sin error)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4 (comportamiento documentado, no un bug): usuario con caja_sesion
-- existente pero CERRADA. El trigger filtra por cierre_fecha IS NULL, así
-- que tampoco inserta nada para una sesion ya cerrada.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.movimientos_uala (fecha, monto, destinatario, user_id, empresa_id) VALUES
  (now(), 150, 'Caja cerrada', '00000000-dada-0000-0000-00000000000c', '00000000-dada-0000-0000-000000000001');

SELECT is(
  (SELECT count(*)::int FROM public.movimientos_caja WHERE user_id = '00000000-dada-0000-0000-00000000000c'),
  0,
  'Caso 4 (documentado): con la unica caja_sesion CERRADA, no se genera movimiento_caja'
);

SELECT * FROM finish();

ROLLBACK;
