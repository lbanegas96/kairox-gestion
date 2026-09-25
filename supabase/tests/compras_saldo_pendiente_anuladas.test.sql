-- pgTAP test: una compra anulada no es deuda pendiente en `compras_saldo_pendiente` (mig. 413)
--
-- Hallazgo nuevo del 25/09 (al armar el reporte de conciliación, CON-5). La vista dejaba saldo pendiente en las
-- compras `anulada`, que después se ofrecían para pagar y engordaban el aging de proveedores. Este test confirma
-- que ahora solo cuentan las compras vivas y con saldo: una anulada y una pagada dan 0, una pendiente da su total y
-- una parcial da lo que falta; y que la vista no perdió `security_invoker` ni los permisos al recrearla.
--
-- SEGURIDAD: crea y destruye su propio tenant/proveedor/compras sintéticos dentro de una transacción
-- que termina en ROLLBACK. Nunca toca empresas ni datos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(7);

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-fc01-0000-0000-000000000001', '__PGTAP_TEST__ Empresa saldo compras');

INSERT INTO public.proveedores (id, empresa_id, nombre) VALUES
  ('00000000-fc01-0000-0000-0000000000b1', '00000000-fc01-0000-0000-000000000001', '__PGTAP_TEST__ Proveedor');

INSERT INTO public.compras (id, empresa_id, proveedor_id, numero_factura, total, estado_pago, en_libro_iva) VALUES
  ('00000000-fc01-0000-0000-0000000000c1', '00000000-fc01-0000-0000-000000000001', '00000000-fc01-0000-0000-0000000000b1', 'T-1', 1000, 'anulada',   false),
  ('00000000-fc01-0000-0000-0000000000c2', '00000000-fc01-0000-0000-000000000001', '00000000-fc01-0000-0000-0000000000b1', 'T-2',  500, 'pendiente', false),
  ('00000000-fc01-0000-0000-0000000000c3', '00000000-fc01-0000-0000-000000000001', '00000000-fc01-0000-0000-0000000000b1', 'T-3',  700, 'pagada',    false),
  ('00000000-fc01-0000-0000-0000000000c4', '00000000-fc01-0000-0000-000000000001', '00000000-fc01-0000-0000-0000000000b1', 'T-4',  900, 'parcial',   false);

SELECT is(
  (SELECT saldo_pendiente FROM public.compras_saldo_pendiente WHERE compra_id = '00000000-fc01-0000-0000-0000000000c1'),
  0::numeric,
  'Caso 1: una compra anulada no tiene saldo pendiente (antes figuraba con su total)'
);

SELECT is(
  (SELECT saldo_pendiente FROM public.compras_saldo_pendiente WHERE compra_id = '00000000-fc01-0000-0000-0000000000c2'),
  500::numeric,
  'Caso 2: una compra pendiente sigue debiendo su total'
);

SELECT is(
  (SELECT saldo_pendiente FROM public.compras_saldo_pendiente WHERE compra_id = '00000000-fc01-0000-0000-0000000000c3'),
  0::numeric,
  'Caso 3: una compra pagada sigue en 0'
);

SELECT is(
  (SELECT saldo_pendiente FROM public.compras_saldo_pendiente WHERE compra_id = '00000000-fc01-0000-0000-0000000000c4'),
  900::numeric,
  'Caso 4: una compra parcial sin imputaciones debe su total (lo que falta, si hubiera pagos imputados)'
);

SELECT is(
  (SELECT count(*)::int FROM public.compras_saldo_pendiente WHERE empresa_id = '00000000-fc01-0000-0000-000000000001' AND saldo_pendiente > 0),
  2,
  'Caso 5: las pantallas que filtran saldo_pendiente > 0 ya no reciben la anulada (quedan la pendiente y la parcial)'
);

SELECT is(
  (SELECT reloptions::text FROM pg_class WHERE oid = 'public.compras_saldo_pendiente'::regclass),
  '{security_invoker=true}',
  'Caso 6: la vista conserva security_invoker (no filtra datos de otras empresas)'
);

SELECT is(
  has_table_privilege('authenticated', 'public.compras_saldo_pendiente', 'SELECT'),
  true,
  'Caso 7: y los usuarios con sesion la siguen pudiendo leer'
);

SELECT * FROM finish();

ROLLBACK;
