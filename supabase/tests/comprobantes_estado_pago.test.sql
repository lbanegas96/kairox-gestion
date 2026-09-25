-- pgTAP test: `comprobantes.estado_pago` solo admite valores válidos (mig. 412)
--
-- Auditoría 24/09/2026, hallazgo CON-8. Había ventas en «pagado» junto a las «pagada» y los reportes comparan contra
-- 'pagada'. Este test confirma que el CHECK deja pasar los 4 estados que existen (pendiente, parcial, pagada,
-- cancelada), rechaza «pagado» o cualquier otro valor tanto al crear como al actualizar, y que no quedan filas
-- con el valor viejo.
--
-- SEGURIDAD: crea y destruye su propio tenant/comprobantes sintéticos dentro de una transacción
-- que termina en ROLLBACK. Nunca toca empresas ni datos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-fb01-0000-0000-000000000001', '__PGTAP_TEST__ Empresa estado pago');

SELECT throws_like(
  $$INSERT INTO public.comprobantes (empresa_id, numero_venta, estado_pago) VALUES ('00000000-fb01-0000-0000-000000000001', '__PGTAP_TEST__ 1', 'pagado')$$,
  '%comprobantes_estado_pago_check%',
  'Caso 1: «pagado» (el valor mal escrito) ya no se puede guardar'
);

SELECT lives_ok(
  $$INSERT INTO public.comprobantes (id, empresa_id, numero_venta, estado_pago) VALUES
      ('00000000-fb01-0000-0000-0000000000c1', '00000000-fb01-0000-0000-000000000001', '__PGTAP_TEST__ 2', 'pagada'),
      ('00000000-fb01-0000-0000-0000000000c2', '00000000-fb01-0000-0000-000000000001', '__PGTAP_TEST__ 3', 'pendiente'),
      ('00000000-fb01-0000-0000-0000000000c3', '00000000-fb01-0000-0000-000000000001', '__PGTAP_TEST__ 4', 'parcial'),
      ('00000000-fb01-0000-0000-0000000000c4', '00000000-fb01-0000-0000-000000000001', '__PGTAP_TEST__ 5', 'cancelada')$$,
  'Caso 2: pagada, pendiente, parcial y cancelada se guardan normalmente'
);

SELECT throws_like(
  $$UPDATE public.comprobantes SET estado_pago = 'pagado' WHERE id = '00000000-fb01-0000-0000-0000000000c1'$$,
  '%comprobantes_estado_pago_check%',
  'Caso 3: tampoco se puede actualizar una venta a «pagado»'
);

SELECT throws_like(
  $$UPDATE public.comprobantes SET estado_pago = 'anulada' WHERE id = '00000000-fb01-0000-0000-0000000000c1'$$,
  '%comprobantes_estado_pago_check%',
  'Caso 4: ni a un estado que no existe para comprobantes (anulada es de compras)'
);

SELECT is(
  (SELECT count(*)::int FROM public.comprobantes WHERE estado_pago = 'pagado'),
  0,
  'Caso 5: no queda ninguna venta con el valor viejo «pagado»'
);

SELECT is(
  (SELECT convalidated FROM pg_constraint WHERE conrelid = 'public.comprobantes'::regclass AND conname = 'comprobantes_estado_pago_check'),
  true,
  'Caso 6: la restriccion esta validada contra todas las filas existentes'
);

SELECT * FROM finish();

ROLLBACK;
