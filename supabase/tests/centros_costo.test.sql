-- pgTAP test: centros_costo (migration 168, Fase 1 del plan de 4 frentes contables)
--
-- Verifica: aislamiento multi-tenant (RLS), asignación opcional a un comprobante,
-- regresión (comprobante sin centro de costo sigue funcionando igual que hoy) y
-- que borrar un centro de costo no rompe los comprobantes que ya lo tenían
-- asignado (ON DELETE SET NULL, no cascada).
--
-- SEGURIDAD: este archivo crea y destruye sus propios tenants/datos de prueba
-- dentro de una transacción que termina en ROLLBACK. Nunca toca empresas reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: 2 tenants sintéticos (F y G).
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-ffff-0000-0000-000000000001', '__PGTAP_TEST__ Tenant F'),
  ('00000000-9999-0000-0000-000000000002', '__PGTAP_TEST__ Tenant G');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-ffff-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-f@kairox.test', now(), now(), now()),
  ('00000000-9999-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-test-g@kairox.test', now(), now(), now());

-- role='admin' porque comprobantes_insert exige has_module_permission('ventas')
-- (migration 132) y el default de profiles.role es 'staff' sin permisos.
UPDATE public.profiles SET empresa_id = '00000000-ffff-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-ffff-0000-0000-00000000000f';
UPDATE public.profiles SET empresa_id = '00000000-9999-0000-0000-000000000002', role = 'admin' WHERE id = '00000000-9999-0000-0000-000000000009';

INSERT INTO public.centros_costo (id, empresa_id, nombre) VALUES
  ('00000000-ffff-0000-0000-0000000000c1', '00000000-ffff-0000-0000-000000000001', '__PGTAP_TEST__ Sucursal Centro'),
  ('00000000-9999-0000-0000-0000000000c2', '00000000-9999-0000-0000-000000000002', '__PGTAP_TEST__ Sucursal Norte (Tenant G)');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-ffff-0000-0000-00000000000f","role":"authenticated"}', true);
-- SET LOCAL ROLE es imprescindible acá: sin esto, la conexión sigue siendo el
-- rol admin/superuser que corre la migración (BYPASSRLS) y las políticas de
-- RLS ni se evalúan — el test daría falsos positivos de aislamiento roto.
SET LOCAL ROLE authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: RLS — Tenant F solo ve su propio centro de costo, no el de Tenant G.
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.centros_costo WHERE nombre LIKE '__PGTAP_TEST__%'),
  1,
  'Caso 1: RLS aisla centros_costo — Tenant F no ve el centro de costo de Tenant G'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: asignar centro_costo_id a un comprobante nuevo.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.comprobantes (id, empresa_id, numero_venta, cliente_nombre, total, tipo, centro_costo_id)
VALUES ('00000000-ffff-0000-0000-0000000000b1', '00000000-ffff-0000-0000-000000000001', '__PGTAP_TEST__ 0001', 'Consumidor Final', 1000, 'venta', '00000000-ffff-0000-0000-0000000000c1');

SELECT is(
  (SELECT centro_costo_id FROM public.comprobantes WHERE id = '00000000-ffff-0000-0000-0000000000b1'),
  '00000000-ffff-0000-0000-0000000000c1'::uuid,
  'Caso 2: el comprobante queda vinculado al centro de costo elegido'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 3 (regresión): comprobante SIN centro de costo — sigue insertando
-- igual que antes de esta migration, columna queda NULL, nada se rompe.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.comprobantes (id, empresa_id, numero_venta, cliente_nombre, total, tipo)
VALUES ('00000000-ffff-0000-0000-0000000000b2', '00000000-ffff-0000-0000-000000000001', '__PGTAP_TEST__ 0002', 'Consumidor Final', 500, 'venta');

SELECT is(
  (SELECT centro_costo_id FROM public.comprobantes WHERE id = '00000000-ffff-0000-0000-0000000000b2'),
  NULL,
  'Caso 3: comprobante sin centro de costo asignado inserta igual que antes (columna NULL)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 4: actualizado — el gap que este comentario documentaba ("la FK no
-- valida tenant, un centro de costo ajeno puede colarse si se lo fuerza") se
-- cerró después con la migration 187 (trigger fn_validar_tenant_centro_costo,
-- BEFORE INSERT/UPDATE OF centro_costo_id en comprobantes/compras/
-- asientos_contables). Ahora un comprobante de Tenant F NO puede apuntar al
-- centro_costo_id de Tenant G — el trigger lo bloquea con excepción. Este caso
-- se actualizó para probar esa mejora real en vez de la limitación vieja.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $t$ INSERT INTO public.comprobantes (id, empresa_id, numero_venta, cliente_nombre, total, tipo, centro_costo_id)
      VALUES ('00000000-ffff-0000-0000-0000000000b3', '00000000-ffff-0000-0000-000000000001', '__PGTAP_TEST__ 0003', 'Consumidor Final', 100, 'venta', '00000000-9999-0000-0000-0000000000c2') $t$,
  '%no pertenece a la empresa del registro%',
  'Caso 4: el trigger de la mig.187 bloquea asignar un centro de costo de otro tenant (hardening real, ya no es un gap documentado)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 5: ON DELETE SET NULL — borrar el centro de costo del Caso 2 no borra
-- el comprobante, solo le limpia la referencia.
-- ───────────────────────────────────────────────────────────────────────────

DELETE FROM public.centros_costo WHERE id = '00000000-ffff-0000-0000-0000000000c1';

SELECT is(
  (SELECT count(*)::int FROM public.comprobantes WHERE id = '00000000-ffff-0000-0000-0000000000b1'),
  1,
  'Caso 5a: borrar el centro de costo NO borra el comprobante (no hay cascada)'
);

SELECT is(
  (SELECT centro_costo_id FROM public.comprobantes WHERE id = '00000000-ffff-0000-0000-0000000000b1'),
  NULL,
  'Caso 5b: el comprobante queda con centro_costo_id=NULL tras borrar el centro de costo'
);

SELECT * FROM finish();

ROLLBACK;
