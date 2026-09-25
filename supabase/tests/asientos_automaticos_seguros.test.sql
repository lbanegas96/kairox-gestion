-- pgTAP test: asientos automáticos y manuales seguros — cuentas propias, permiso por tipo e idempotencia (mig. 408)
--
-- Auditoría 24/09/2026, hallazgo SEG-14. `crear_asiento_automatico` (asiento ya CONFIRMADO) no chequeaba que las
-- cuentas de las líneas fueran de la empresa, no exigía ningún permiso de módulo y no era idempotente.
-- `crear_asiento_manual` tampoco validaba las cuentas. Este test confirma que ahora:
--   - una línea con la cuenta de OTRA empresa (o inexistente) se rechaza y no deja rastro en esa cuenta,
--   - cada tipo de asiento exige el módulo desde el que se genera (ventas, compras, productos…),
--     y un tipo que el mapa no conoce se acepta con cualquier módulo operativo pero no sin ninguno,
--   - registrar dos veces el mismo documento (venta, compra…) devuelve el asiento que ya existe en vez de duplicarlo,
--     pero `ajuste_stock` (cuyo origen_id se repite legítimamente) sigue creando uno por cada ajuste,
--   - los flujos normales siguen andando y la función auxiliar del mapa no es ejecutable por los usuarios.
--
-- SEGURIDAD: crea y destruye sus propios tenants/usuarios/cuentas sintéticos dentro de una transacción
-- que termina en ROLLBACK. Nunca toca empresas ni datos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(24);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: dos empresas. La A tiene un admin y usuarios con un solo módulo; la B solo aporta cuentas ajenas.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-f701-0000-0000-000000000001', '__PGTAP_TEST__ Empresa A asientos'),
  ('00000000-f701-0000-0000-000000000002', '__PGTAP_TEST__ Empresa B asientos');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-f701-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-asi-adm@kairox.test',  now(), now(), now()),
  ('00000000-f701-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-asi-sin@kairox.test',  now(), now(), now()),
  ('00000000-f701-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-asi-vent@kairox.test', now(), now(), now()),
  ('00000000-f701-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-asi-comp@kairox.test', now(), now(), now()),
  ('00000000-f701-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-asi-prod@kairox.test', now(), now(), now());

UPDATE public.profiles SET empresa_id = '00000000-f701-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-f701-0000-0000-0000000000a1';
UPDATE public.profiles SET empresa_id = '00000000-f701-0000-0000-000000000001', permissions = '{}'::jsonb                  WHERE id = '00000000-f701-0000-0000-0000000000a2';
UPDATE public.profiles SET empresa_id = '00000000-f701-0000-0000-000000000001', permissions = '{"ventas": true}'::jsonb    WHERE id = '00000000-f701-0000-0000-0000000000a3';
UPDATE public.profiles SET empresa_id = '00000000-f701-0000-0000-000000000001', permissions = '{"compras": true}'::jsonb    WHERE id = '00000000-f701-0000-0000-0000000000a4';
UPDATE public.profiles SET empresa_id = '00000000-f701-0000-0000-000000000001', permissions = '{"productos": true}'::jsonb  WHERE id = '00000000-f701-0000-0000-0000000000a5';

INSERT INTO public.plan_cuentas (id, empresa_id, codigo, nombre, tipo) VALUES
  ('00000000-f701-0000-0000-0000000000c1', '00000000-f701-0000-0000-000000000001', '9.9.1', '__PGTAP_TEST__ A activo',  'activo'),
  ('00000000-f701-0000-0000-0000000000c2', '00000000-f701-0000-0000-000000000001', '9.9.2', '__PGTAP_TEST__ A ingreso', 'ingreso'),
  ('00000000-f701-0000-0000-0000000000c3', '00000000-f701-0000-0000-000000000002', '9.8.1', '__PGTAP_TEST__ B activo',  'activo'),
  ('00000000-f701-0000-0000-0000000000c4', '00000000-f701-0000-0000-000000000002', '9.8.2', '__PGTAP_TEST__ B ingreso', 'ingreso');

-- Dos líneas que cuadran (100 al debe de la primera cuenta, 100 al haber de la segunda).
CREATE FUNCTION public.__pgtap_items(p_a uuid, p_b uuid) RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('cuenta_id', p_a, 'debe', 100, 'haber', 0,   'descripcion', 'd'),
    jsonb_build_object('cuenta_id', p_b, 'debe', 0,   'haber', 100, 'descripcion', 'h')
  )
$$;

-- Asiento automático de la empresa A (por defecto con sus dos cuentas propias). Corre con el rol del que llama.
CREATE FUNCTION public.__pgtap_auto(
  p_origen text,
  p_origen_id uuid DEFAULT NULL,
  p_cuenta_a uuid DEFAULT '00000000-f701-0000-0000-0000000000c1',
  p_cuenta_b uuid DEFAULT '00000000-f701-0000-0000-0000000000c2'
) RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT public.crear_asiento_automatico(
    '00000000-f701-0000-0000-000000000001', '00000000-f701-0000-0000-0000000000a1',
    CURRENT_DATE, '__PGTAP_TEST__ asiento', p_origen, p_origen_id, NULL,
    public.__pgtap_items(p_cuenta_a, p_cuenta_b)
  )
$$;

-- Asiento manual (borrador) de la empresa A.
CREATE FUNCTION public.__pgtap_manual(p_cuenta_a uuid, p_cuenta_b uuid) RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT public.crear_asiento_manual(
    '00000000-f701-0000-0000-000000000001', '00000000-f701-0000-0000-0000000000a1',
    CURRENT_DATE, '__PGTAP_TEST__ manual', NULL,
    public.__pgtap_items(p_cuenta_a, p_cuenta_b)
  )
$$;

GRANT EXECUTE ON FUNCTION public.__pgtap_items(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.__pgtap_auto(text, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.__pgtap_manual(uuid, uuid) TO authenticated;

SET LOCAL ROLE authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 1-7: el admin de la empresa A registra asientos; un mismo documento no se duplica.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f701-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT set_config('pgtap.venta1', (public.__pgtap_auto('venta', '00000000-f701-0000-0000-0000000000d1') ->> 'id'), true);

SELECT is(
  (SELECT estado::text FROM public.asientos_contables WHERE id = current_setting('pgtap.venta1')::uuid),
  'confirmado',
  'Caso 1: el admin registra un asiento de venta con cuentas propias y queda confirmado'
);

SELECT is(
  (public.__pgtap_auto('venta', '00000000-f701-0000-0000-0000000000d1') ->> 'id'),
  current_setting('pgtap.venta1'),
  'Caso 2: registrar de nuevo la misma venta devuelve el asiento que ya existe'
);

SELECT is(
  (public.__pgtap_auto('venta', '00000000-f701-0000-0000-0000000000d1') ->> 'existente'),
  'true',
  'Caso 3: y avisa que ya existia (existente = true)'
);

SELECT is(
  (SELECT count(*)::int FROM public.asientos_contables
   WHERE empresa_id = '00000000-f701-0000-0000-000000000001' AND origen = 'venta' AND origen_id = '00000000-f701-0000-0000-0000000000d1'),
  1,
  'Caso 4: hay un solo asiento de esa venta, no tres'
);

SELECT is(
  (SELECT saldo_actual FROM public.plan_cuentas WHERE id = '00000000-f701-0000-0000-0000000000c1'),
  100::numeric,
  'Caso 5: el saldo de la cuenta no se duplico (100, no 300)'
);

SELECT public.__pgtap_auto('ajuste_stock', '00000000-f701-0000-0000-0000000000d5');
SELECT public.__pgtap_auto('ajuste_stock', '00000000-f701-0000-0000-0000000000d5');

SELECT is(
  (SELECT count(*)::int FROM public.asientos_contables
   WHERE empresa_id = '00000000-f701-0000-0000-000000000001' AND origen = 'ajuste_stock' AND origen_id = '00000000-f701-0000-0000-0000000000d5'),
  2,
  'Caso 6: ajuste_stock no es de una sola vez (su origen_id es el producto): cada ajuste crea su asiento'
);

SELECT isnt(
  (public.__pgtap_auto('compra', '00000000-f701-0000-0000-0000000000d1') ->> 'id'),
  current_setting('pgtap.venta1'),
  'Caso 7: el mismo origen_id con OTRO tipo de asiento (compra) crea uno nuevo y no reusa el de la venta'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 8-11: las cuentas de las líneas deben ser de la empresa del asiento.
-- ───────────────────────────────────────────────────────────────────────────

SELECT throws_like(
  $$SELECT public.__pgtap_auto('venta', '00000000-f701-0000-0000-0000000000d8', '00000000-f701-0000-0000-0000000000c3', '00000000-f701-0000-0000-0000000000c2')$$,
  'El asiento usa una cuenta que no existe o no pertenece a esta empresa%',
  'Caso 8: un asiento automatico con la cuenta de OTRA empresa se rechaza'
);

SELECT throws_like(
  $$SELECT public.__pgtap_auto('venta', '00000000-f701-0000-0000-0000000000d8', '00000000-f701-0000-0000-0000000000c1', '00000000-f701-0000-0000-0000000000ee')$$,
  'El asiento usa una cuenta que no existe o no pertenece a esta empresa%',
  'Caso 9: y con una cuenta que no existe tambien'
);

SELECT throws_like(
  $$SELECT public.__pgtap_manual('00000000-f701-0000-0000-0000000000c1', '00000000-f701-0000-0000-0000000000c4')$$,
  'El asiento usa una cuenta que no existe o no pertenece a esta empresa%',
  'Caso 10: un asiento manual con la cuenta de OTRA empresa tambien se rechaza'
);

SELECT lives_ok(
  $$SELECT public.__pgtap_manual('00000000-f701-0000-0000-0000000000c1', '00000000-f701-0000-0000-0000000000c2')$$,
  'Caso 11: un asiento manual con cuentas propias sigue funcionando'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 12-13: un usuario sin ningún módulo no puede registrar asientos.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f701-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT throws_like(
  $$SELECT public.__pgtap_auto('venta', '00000000-f701-0000-0000-0000000000d9')$$,
  'No autorizado: sin permiso para registrar asientos de tipo venta%',
  'Caso 12: un usuario sin permisos no puede registrar un asiento de venta'
);

SELECT throws_like(
  $$SELECT public.__pgtap_auto('cheque_tercero', '00000000-f701-0000-0000-0000000000d9')$$,
  'No autorizado: sin permiso para registrar asientos de tipo cheque_tercero%',
  'Caso 13: ni uno de un tipo que el mapa no conoce'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 14-16, 21: con el módulo ventas se registran asientos de venta, pero no de compra.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f701-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.__pgtap_auto('venta', '00000000-f701-0000-0000-0000000000d2')$$,
  'Caso 14: con el modulo ventas se registra un asiento de venta'
);

SELECT throws_like(
  $$SELECT public.__pgtap_auto('compra', '00000000-f701-0000-0000-0000000000d6')$$,
  'No autorizado: sin permiso para registrar asientos de tipo compra%',
  'Caso 15: con el modulo ventas NO se registra un asiento de compra'
);

SELECT lives_ok(
  $$SELECT public.__pgtap_auto('cheque_tercero', '00000000-f701-0000-0000-0000000000da')$$,
  'Caso 16: un tipo que el mapa no conoce se acepta con cualquier modulo operativo (aca, ventas)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 17-19: con el módulo compras se registran compras y notas de proveedor (cualquier *_proveedor).
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f701-0000-0000-0000000000a4","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.__pgtap_auto('compra', '00000000-f701-0000-0000-0000000000d3')$$,
  'Caso 17: con el modulo compras se registra un asiento de compra'
);

SELECT lives_ok(
  $$SELECT public.__pgtap_auto('nota_credito_proveedor', '00000000-f701-0000-0000-0000000000d4')$$,
  'Caso 18: y una nota de credito de proveedor'
);

SELECT lives_ok(
  $$SELECT public.__pgtap_auto('cancelacion_nota_credito_proveedor', '00000000-f701-0000-0000-0000000000d4')$$,
  'Caso 19: y su cancelacion (cualquier tipo terminado en _proveedor)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 20-21: con el módulo productos se registran ajustes de stock, pero no ventas.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f701-0000-0000-0000000000a5","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.__pgtap_auto('ajuste_stock', '00000000-f701-0000-0000-0000000000d7')$$,
  'Caso 20: con el modulo productos se registra un ajuste de stock'
);

SELECT throws_like(
  $$SELECT public.__pgtap_auto('venta', '00000000-f701-0000-0000-0000000000db')$$,
  'No autorizado: sin permiso para registrar asientos de tipo venta%',
  'Caso 21: con el modulo productos NO se registra un asiento de venta'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 22-24: la función auxiliar del mapa no es pública y las cuentas ajenas no recibieron ninguna línea.
-- ───────────────────────────────────────────────────────────────────────────

RESET ROLE;

SELECT is(
  has_function_privilege('authenticated', 'public.modulos_para_origen_asiento(text)', 'EXECUTE'),
  false,
  'Caso 22: los usuarios no pueden ejecutar directamente el mapa de modulos por tipo'
);

SELECT is(
  (SELECT count(*)::int FROM public.asientos_items WHERE cuenta_id IN ('00000000-f701-0000-0000-0000000000c3', '00000000-f701-0000-0000-0000000000c4')),
  0,
  'Caso 23: las cuentas de la otra empresa no recibieron ninguna linea (los intentos se revirtieron)'
);

SELECT is(
  (SELECT saldo_actual FROM public.plan_cuentas WHERE id = '00000000-f701-0000-0000-0000000000c3'),
  0::numeric,
  'Caso 24: y el saldo de la cuenta ajena sigue en 0'
);

SELECT * FROM finish();

ROLLBACK;
