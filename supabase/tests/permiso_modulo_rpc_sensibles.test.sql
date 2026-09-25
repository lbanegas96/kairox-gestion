-- pgTAP test: las 15 RPC sensibles exigen el permiso del módulo desde el que se usan (mig. 406)
--
-- Auditoría 24/09/2026, hallazgo SEG-12. Estas funciones son SECURITY DEFINER (saltean el RLS) y
-- escribían datos sin chequear `has_module_permission`. Este test llama a las 15 con argumentos
-- nulos (el chequeo está al principio, antes de usar ningún argumento) con distintos usuarios y
-- confirma que:
--   - un usuario SIN permisos es rechazado en las 15,
--   - un admin no es rechazado en ninguna (pasa el chequeo y falla, si corresponde, por otro motivo),
--   - cada módulo abre solo las funciones que le corresponden (productos, ventas, pedidos, compras, clientes),
--   - y el flujo real sigue andando: un usuario con `productos` ajusta stock de verdad.
--
-- SEGURIDAD: crea y destruye sus propios tenants/usuarios/productos sintéticos dentro de una
-- transacción que termina en ROLLBACK. Nunca toca empresas ni datos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: una empresa con un admin y usuarios que tienen un solo módulo cada uno.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-f501-0000-0000-000000000001', '__PGTAP_TEST__ Empresa permisos RPC');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-f501-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-rpc-adm@kairox.test',  now(), now(), now()),
  ('00000000-f501-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-rpc-sin@kairox.test',  now(), now(), now()),
  ('00000000-f501-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-rpc-prod@kairox.test', now(), now(), now()),
  ('00000000-f501-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-rpc-vent@kairox.test', now(), now(), now()),
  ('00000000-f501-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-rpc-comp@kairox.test', now(), now(), now()),
  ('00000000-f501-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-rpc-cli@kairox.test',  now(), now(), now()),
  ('00000000-f501-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-rpc-ped@kairox.test',  now(), now(), now());

UPDATE public.profiles SET empresa_id = '00000000-f501-0000-0000-000000000001', role = 'admin' WHERE id = '00000000-f501-0000-0000-0000000000a1';
UPDATE public.profiles SET empresa_id = '00000000-f501-0000-0000-000000000001', permissions = '{}'::jsonb                  WHERE id = '00000000-f501-0000-0000-0000000000a2';
UPDATE public.profiles SET empresa_id = '00000000-f501-0000-0000-000000000001', permissions = '{"productos": true}'::jsonb WHERE id = '00000000-f501-0000-0000-0000000000a3';
UPDATE public.profiles SET empresa_id = '00000000-f501-0000-0000-000000000001', permissions = '{"ventas": true}'::jsonb    WHERE id = '00000000-f501-0000-0000-0000000000a4';
UPDATE public.profiles SET empresa_id = '00000000-f501-0000-0000-000000000001', permissions = '{"compras": true}'::jsonb    WHERE id = '00000000-f501-0000-0000-0000000000a5';
UPDATE public.profiles SET empresa_id = '00000000-f501-0000-0000-000000000001', permissions = '{"clientes": true}'::jsonb   WHERE id = '00000000-f501-0000-0000-0000000000a6';
UPDATE public.profiles SET empresa_id = '00000000-f501-0000-0000-000000000001', permissions = '{"pedidos": true}'::jsonb    WHERE id = '00000000-f501-0000-0000-0000000000a7';

INSERT INTO public.productos (id, empresa_id, nombre, stock_actual, costo_compra, precio_venta, activo) VALUES
  ('00000000-f501-0000-0000-0000000000d1', '00000000-f501-0000-0000-000000000001', '__PGTAP_TEST__ Producto', 10, 100, 200, true);

-- Devuelve, ordenadas y separadas por coma, las funciones (de las 15, llamadas con argumentos nulos) que
-- rechazaron al usuario actual por falta de permiso de módulo. Corre con el rol del que llama (SECURITY
-- INVOKER), o sea con el usuario simulado. La lista va embebida en la función (y no en una tabla) porque
-- una tabla nueva en public puede nacer con RLS activado y el usuario simulado no vería ninguna fila.
CREATE FUNCTION public.__pgtap_rechazadas() RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
  v text := '';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('actualizar_cotizacion',                 'SELECT public.actualizar_cotizacion(NULL::uuid,NULL::uuid,NULL::text,NULL::jsonb,NULL::text,NULL::text,NULL::date,NULL::text,NULL::numeric,NULL::numeric)'),
    ('actualizar_pedido',                     'SELECT public.actualizar_pedido(NULL::uuid,NULL::uuid,NULL::text,NULL::jsonb,NULL::text,NULL::date,NULL::text,NULL::text,NULL::numeric,NULL::numeric)'),
    ('ajustar_stock_manual',                  'SELECT public.ajustar_stock_manual(NULL::uuid,NULL::text,NULL::integer,NULL::text)'),
    ('crear_recuento_inventario',             'SELECT public.crear_recuento_inventario(NULL::uuid)'),
    ('confirmar_recuento_inventario',         'SELECT public.confirmar_recuento_inventario(NULL::uuid)'),
    ('anular_recuento_inventario',            'SELECT public.anular_recuento_inventario(NULL::uuid)'),
    ('set_asiento_recuento_inventario',       'SELECT public.set_asiento_recuento_inventario(NULL::uuid,NULL::uuid)'),
    ('crear_revalorizacion_inventario',       'SELECT public.crear_revalorizacion_inventario(NULL::uuid)'),
    ('confirmar_revalorizacion_inventario',   'SELECT public.confirmar_revalorizacion_inventario(NULL::uuid)'),
    ('anular_revalorizacion_inventario',      'SELECT public.anular_revalorizacion_inventario(NULL::uuid)'),
    ('set_asiento_revalorizacion_inventario', 'SELECT public.set_asiento_revalorizacion_inventario(NULL::uuid,NULL::uuid)'),
    ('aplicar_compra_producto',               'SELECT public.aplicar_compra_producto(NULL::uuid,NULL::numeric,NULL::numeric)'),
    ('programar_precio_futuro',               'SELECT public.programar_precio_futuro(NULL::uuid,NULL::uuid,NULL::numeric,NULL::date)'),
    ('cancelar_precio_programado',            'SELECT public.cancelar_precio_programado(NULL::uuid,NULL::uuid)'),
    ('recalcular_precios_lista_factor',       'SELECT public.recalcular_precios_lista_factor(NULL::uuid,NULL::boolean)')
  ) AS t(nombre, llamada) ORDER BY nombre LOOP
    BEGIN
      EXECUTE r.llamada;
    EXCEPTION WHEN others THEN
      IF SQLERRM LIKE 'No autorizado: sin permiso de módulo%' THEN
        v := v || r.nombre || ',';
      END IF;
    END;
  END LOOP;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.__pgtap_rechazadas() TO authenticated;

SET LOCAL ROLE authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 1: un usuario SIN permisos es rechazado en las 15.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f501-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM unnest(string_to_array(rtrim(public.__pgtap_rechazadas(), ','), ',')) x),
  15,
  'Caso 1: un usuario sin ningun permiso es rechazado en las 15 funciones'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 2: el admin no es rechazado en ninguna.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f501-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  public.__pgtap_rechazadas(),
  '',
  'Caso 2: el admin pasa el chequeo en las 15 funciones'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 3-7: cada módulo abre solo lo que le corresponde.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f501-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT is(
  public.__pgtap_rechazadas(),
  'actualizar_cotizacion,actualizar_pedido,cancelar_precio_programado,programar_precio_futuro,recalcular_precios_lista_factor,',
  'Caso 3: con productos se abren 10 funciones (stock, recuentos, revalorizaciones, compra) y se rechazan las de ventas/pedidos/listas'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f501-0000-0000-0000000000a4","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM unnest(string_to_array(rtrim(public.__pgtap_rechazadas(), ','), ',')) x WHERE x IN ('actualizar_cotizacion', 'actualizar_pedido')),
  0,
  'Caso 4: con ventas se abren actualizar_cotizacion y actualizar_pedido'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f501-0000-0000-0000000000a5","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM unnest(string_to_array(rtrim(public.__pgtap_rechazadas(), ','), ',')) x WHERE x = 'aplicar_compra_producto'),
  0,
  'Caso 5: con compras se abre aplicar_compra_producto (la usa Compras al recibir mercaderia)'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f501-0000-0000-0000000000a6","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM unnest(string_to_array(rtrim(public.__pgtap_rechazadas(), ','), ',')) x WHERE x IN ('programar_precio_futuro', 'cancelar_precio_programado', 'recalcular_precios_lista_factor')),
  0,
  'Caso 6: con clientes se abren las 3 funciones de listas de precios'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f501-0000-0000-0000000000a7","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM unnest(string_to_array(rtrim(public.__pgtap_rechazadas(), ','), ',')) x WHERE x = 'actualizar_pedido'),
  0,
  'Caso 7: con pedidos se abre actualizar_pedido (la pantalla de Pedidos se gobierna por ese modulo)'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Caso 8: el flujo real sigue andando — un usuario con productos ajusta stock de verdad.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-f501-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT public.ajustar_stock_manual('00000000-f501-0000-0000-0000000000d1', 'entrada', 5, '__PGTAP_TEST__ ajuste');

RESET ROLE;

SELECT is(
  (SELECT stock_actual FROM public.productos WHERE id = '00000000-f501-0000-0000-0000000000d1'),
  15::numeric,
  'Caso 8: el ajuste de stock de un usuario con el modulo productos se aplico (10 + 5)'
);

SELECT * FROM finish();

ROLLBACK;
