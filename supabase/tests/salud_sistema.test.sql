-- pgTAP test: chequeo de salud del sistema y aviso (mig. 417)
--
-- Auditoría 24/09/2026, hallazgo OPE-3. Confirma que:
--   - solo el servicio ejecuta el chequeo y lee el historial (ningún usuario de una empresa, ni sin sesión),
--   - el resultado tiene la forma esperada (10 chequeos completos) y el chequeo es de solo lectura,
--   - cada chequeo cambia de estado cuando se planta su caso (todo se mide contra el estado de antes del test, así el
--     resultado no depende de cómo esté la base real ni de una base vacía como la de la CI):
--       tareas programadas, respuestas de los procesos, cola de ARCA, colas de integraciones, QR de Mercado Pago,
--       cotización del dólar, espacio de la base, documentos sin asiento, asientos descuadrados y registros nuevos,
--   - la lógica del aviso: no avisa un "atención" suelto, avisa dos seguidos, avisa un crítico enseguida, no repite,
--     avisa si empeora o pasadas 12 h, avisa una vez al normalizarse, y no manda nada de lo que está sano,
--   - y se purga el historial de más de 30 días.
--
-- SEGURIDAD: crea y destruye sus propios datos, tareas programadas, secreto y filas dentro de una transacción que
-- termina en ROLLBACK (los pedidos HTTP de aviso quedan en la cola de la transacción y se descartan con ella: no sale
-- ninguno). Para probar la cotización sin importar el estado real, pasa por un momento las cotizaciones automáticas a
-- "manual" DENTRO de la transacción; se deshace con el ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(75);

-- Ayuda del test: un chequeo del resultado, por código.
CREATE FUNCTION public.__pgtap_chk(p_res jsonb, p_codigo text) RETURNS jsonb LANGUAGE sql
AS $$ SELECT e FROM jsonb_array_elements(p_res -> 'chequeos') e WHERE e ->> 'codigo' = p_codigo $$;

CREATE FUNCTION public.__pgtap_cola() RETURNS integer LANGUAGE sql
AS $$ SELECT count(*)::int FROM net.http_request_queue WHERE url = 'https://example.invalid/hook-pgtap' $$;

CREATE FUNCTION public.__pgtap_ultimo_aviso() RETURNS text LANGUAGE sql
AS $$ SELECT convert_from(body, 'UTF8')::jsonb ->> 'content' FROM net.http_request_queue
       WHERE url = 'https://example.invalid/hook-pgtap' ORDER BY id DESC LIMIT 1 $$;

-- ───────────────────────────────────────────────────────────────────────────
-- A) Estructura y permisos
-- ───────────────────────────────────────────────────────────────────────────

SELECT is((SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'chequeo_salud_sistema'), 1,
  'A1: existe chequeo_salud_sistema (una sola firma)');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'ejecutar_chequeo_salud'), 1,
  'A2: existe ejecutar_chequeo_salud (una sola firma)');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.salud_sistema_chequeos'::regclass), true,
  'A3: el historial tiene RLS activo');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'salud_sistema_chequeos'), 0,
  'A4: y ninguna política: ningún usuario de una empresa puede leerlo');
SELECT is(has_table_privilege('authenticated', 'public.salud_sistema_chequeos', 'SELECT'), false,
  'A5: un usuario con sesión no tiene permiso de lectura sobre el historial');
SELECT is(has_table_privilege('anon', 'public.salud_sistema_chequeos', 'SELECT'), false,
  'A6: ni uno sin sesión');
SELECT is(has_function_privilege('authenticated', 'public.chequeo_salud_sistema(numeric)', 'EXECUTE'), false,
  'A7: un usuario con sesión no puede ejecutar el chequeo (mira todas las empresas juntas)');
SELECT is(has_function_privilege('anon', 'public.chequeo_salud_sistema(numeric)', 'EXECUTE'), false,
  'A8: ni uno sin sesión');
SELECT is(has_function_privilege('authenticated', 'public.ejecutar_chequeo_salud(jsonb)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.ejecutar_chequeo_salud(jsonb)', 'EXECUTE'), false,
  'A9: nadie sin ser el servicio puede ejecutar el que guarda el historial y manda avisos');
SELECT is(has_function_privilege('service_role', 'public.chequeo_salud_sistema(numeric)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.ejecutar_chequeo_salud(jsonb)', 'EXECUTE'), true,
  'A10: el servicio sí puede ejecutar los dos');

SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.chequeo_salud_sistema()$$, '42501', NULL, 'A11: llamarlo con sesión de usuario da permiso denegado');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.ejecutar_chequeo_salud()$$, '42501', NULL, 'A12: llamarlo sin sesión también');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM cron.job WHERE jobname = 'chequeo-salud-sistema-cada-hora' AND schedule = '7 * * * *' AND active), 1,
  'A13: la tarea programada corre a los 7 minutos de cada hora');

-- ───────────────────────────────────────────────────────────────────────────
-- B) Forma del resultado y solo lectura
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('pgtap.filas0', (SELECT count(*)::text FROM public.salud_sistema_chequeos), true);
SELECT set_config('pgtap.base', public.chequeo_salud_sistema()::text, true);
SELECT set_config('pgtap.filas1', (SELECT count(*)::text FROM public.salud_sistema_chequeos), true);

SELECT ok((current_setting('pgtap.base')::jsonb ->> 'estado') IN ('ok', 'atencion', 'critico'),
  'B1: el estado global es ok / atencion / critico');
SELECT is(jsonb_array_length(current_setting('pgtap.base')::jsonb -> 'chequeos'), 10, 'B2: hay 10 chequeos');
SELECT is((SELECT bool_and((e ->> 'codigo') IS NOT NULL AND (e ->> 'titulo') IS NOT NULL AND (e ->> 'detalle') IS NOT NULL
                          AND (e ->> 'estado') IN ('ok', 'atencion', 'critico'))
             FROM jsonb_array_elements(current_setting('pgtap.base')::jsonb -> 'chequeos') e), true,
  'B3: cada chequeo trae código, título, detalle y un estado válido');
SELECT is((SELECT array_agg(e ->> 'codigo' ORDER BY (e ->> 'codigo') COLLATE "C") FROM jsonb_array_elements(current_setting('pgtap.base')::jsonb -> 'chequeos') e),
  ARRAY['asientos_descuadrados', 'base_de_datos', 'cola_arca', 'colas_integraciones', 'cron_jobs', 'documentos_sin_asiento', 'qr_mercadopago',
        'registros_nuevos', 'tipo_de_cambio', 'workers_respuestas']::text[],
  'B4: son los 10 esperados');
SELECT is(current_setting('pgtap.filas0')::int, current_setting('pgtap.filas1')::int,
  'B5: el chequeo no escribe nada (solo lectura)');

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: una empresa inventada con un caso plantado por cada chequeo
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES ('00000000-fe01-0000-0000-000000000001', '__PGTAP_TEST__ Empresa salud');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES ('00000000-fe01-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-salud-adm@kairox.test', now(), now(), now());
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-salud-' || g || '@kairox.test', now(), now(), now()
  FROM generate_series(1, 25) g;

INSERT INTO public.plan_cuentas (id, empresa_id, codigo, nombre, tipo) VALUES
  ('00000000-fe01-0000-0000-000000000c11', '00000000-fe01-0000-0000-000000000001', '1.1', 'Caja',   'activo'),
  ('00000000-fe01-0000-0000-000000000c41', '00000000-fe01-0000-0000-000000000001', '4.1', 'Ventas', 'ingreso');

INSERT INTO public.proveedores (id, empresa_id, nombre) VALUES
  ('00000000-fe01-0000-0000-0000000000b1', '00000000-fe01-0000-0000-000000000001', '__PGTAP_TEST__ Proveedor');
INSERT INTO public.productos (id, empresa_id, nombre, stock_actual, costo_compra) VALUES
  ('00000000-fe01-0000-0000-0000000000f1', '00000000-fe01-0000-0000-000000000001', '__PGTAP_TEST__ Producto', 1, 1);

-- Documentos: los que SÍ cuentan como "sin asiento" son V1 (venta), V2 (nota de crédito) y C1 (compra). Los otros
-- tienen su razón para no contar: V3 recién creada, V4 cancelada, V5 con asiento, V6 vieja, C2 anulada, C3 con asiento.
INSERT INTO public.comprobantes (id, empresa_id, numero_venta, tipo, total, iva_discriminado, estado_pago, fecha) VALUES
  ('00000000-fe01-0000-0000-0000000000d1', '00000000-fe01-0000-0000-000000000001', 'PGTAP-V1',  'venta',        100, 0, 'pagada',    now() - interval '1 hour'),
  ('00000000-fe01-0000-0000-0000000000d2', '00000000-fe01-0000-0000-000000000001', 'PGTAP-NC2', 'nota_credito', 100, 0, 'pagada',    now() - interval '2 hours'),
  ('00000000-fe01-0000-0000-0000000000d3', '00000000-fe01-0000-0000-000000000001', 'PGTAP-V3',  'venta',        100, 0, 'pagada',    now() - interval '1 minute'),
  ('00000000-fe01-0000-0000-0000000000d4', '00000000-fe01-0000-0000-000000000001', 'PGTAP-V4',  'venta',        100, 0, 'cancelada', now() - interval '1 hour'),
  ('00000000-fe01-0000-0000-0000000000d5', '00000000-fe01-0000-0000-000000000001', 'PGTAP-V5',  'venta',        100, 0, 'pagada',    now() - interval '1 hour'),
  ('00000000-fe01-0000-0000-0000000000d6', '00000000-fe01-0000-0000-000000000001', 'PGTAP-V6',  'venta',        100, 0, 'pagada',    now() - interval '10 days');
INSERT INTO public.compras (id, empresa_id, proveedor_id, numero_factura, total, iva_discriminado, neto_gravado, estado_pago, en_libro_iva, created_at) VALUES
  ('00000000-fe01-0000-0000-0000000000e1', '00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000b1', 'A-0001-00000001', 121, 21, 100, 'pendiente', true, now() - interval '1 hour'),
  ('00000000-fe01-0000-0000-0000000000e2', '00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000b1', 'A-0001-00000002', 121, 21, 100, 'anulada',   true, now() - interval '1 hour'),
  ('00000000-fe01-0000-0000-0000000000e3', '00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000b1', 'A-0001-00000003', 121, 21, 100, 'pendiente', true, now() - interval '1 hour');

-- Asientos: A1 (venta V5) y A2 (compra C3) balanceados; D1 descuadrado (debe 100 / haber 40).
INSERT INTO public.asientos_contables (id, empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id) VALUES
  ('00000000-fe01-0000-0000-000000000a01', '00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000a1', 'PGTAP-S01', CURRENT_DATE, 'venta V5',      'confirmado', 100, 100, 'venta',  '00000000-fe01-0000-0000-0000000000d5'),
  ('00000000-fe01-0000-0000-000000000a02', '00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000a1', 'PGTAP-S02', CURRENT_DATE, 'compra C3',     'confirmado', 100, 100, 'compra', '00000000-fe01-0000-0000-0000000000e3'),
  ('00000000-fe01-0000-0000-000000000a03', '00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000a1', 'PGTAP-S03', CURRENT_DATE, 'descuadrado',  'confirmado', 100,  40, NULL,     NULL);
INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
  ('00000000-fe01-0000-0000-000000000a01', '00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-000000000c11', 'x', 100,   0),
  ('00000000-fe01-0000-0000-000000000a01', '00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-000000000c41', 'x',   0, 100),
  ('00000000-fe01-0000-0000-000000000a02', '00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-000000000c11', 'x', 100,   0),
  ('00000000-fe01-0000-0000-000000000a02', '00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-000000000c41', 'x',   0, 100),
  ('00000000-fe01-0000-0000-000000000a03', '00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-000000000c11', 'x', 100,   0),
  ('00000000-fe01-0000-0000-000000000a03', '00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-000000000c41', 'x',   0,  40);

-- Cola de ARCA: F1 pendiente hace 1 h, F2 reintentando hace 5 h, F3 error nuevo. No cuentan: F4 emitida, F5 con reintento
-- a futuro, F6 procesando hace 5 minutos, F7 error de hace 3 días.
INSERT INTO public.facturas_pendientes_arca (empresa_id, tipo_comprobante, codigo_afip, estado, proximo_intento, created_at, updated_at) VALUES
  ('00000000-fe01-0000-0000-000000000001', 'C', 11, 'pendiente',        now() - interval '1 hour',    now() - interval '1 hour',    now() - interval '1 hour'),
  ('00000000-fe01-0000-0000-000000000001', 'C', 11, 'reintentando',     now() - interval '5 hours',   now() - interval '5 hours',   now() - interval '5 hours'),
  ('00000000-fe01-0000-0000-000000000001', 'C', 11, 'error_definitivo', now() - interval '1 hour',    now() - interval '1 hour',    now() - interval '1 hour'),
  ('00000000-fe01-0000-0000-000000000001', 'C', 11, 'emitida',          now() - interval '9 hours',   now() - interval '9 hours',   now() - interval '9 hours'),
  ('00000000-fe01-0000-0000-000000000001', 'C', 11, 'pendiente',        now() + interval '1 hour',    now() - interval '2 hours',   now() - interval '2 hours'),
  ('00000000-fe01-0000-0000-000000000001', 'C', 11, 'procesando',       now() - interval '5 minutes', now() - interval '5 minutes', now() - interval '5 minutes'),
  ('00000000-fe01-0000-0000-000000000001', 'C', 11, 'error_definitivo', now() - interval '3 days',    now() - interval '3 days',    now() - interval '3 days');

-- Colas de Tiendanube / MercadoLibre: S1 stock pendiente hace 1 h, S2 producto procesando hace 5 h, S3 error nuevo.
-- No cuentan: S4 sincronizado, S5 publicado, S6 error de hace 3 días.
INSERT INTO public.integraciones_stock_pendiente (empresa_id, producto_id, estado, canal, proximo_intento, created_at, updated_at) VALUES
  ('00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000f1', 'pendiente',        'tiendanube', now() - interval '1 hour',  now() - interval '1 hour',  now() - interval '1 hour'),
  ('00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000f1', 'error_definitivo', 'tiendanube', now() - interval '1 hour',  now() - interval '1 hour',  now() - interval '1 hour'),
  ('00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000f1', 'sincronizado',     'tiendanube', now() - interval '9 hours', now() - interval '9 hours', now() - interval '9 hours'),
  ('00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000f1', 'error_definitivo', 'tiendanube', now() - interval '3 days',  now() - interval '3 days',  now() - interval '3 days');
INSERT INTO public.integraciones_producto_pendiente (empresa_id, producto_id, estado, canal, proximo_intento, created_at, updated_at) VALUES
  ('00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000f1', 'procesando', 'mercadolibre', now() - interval '5 hours', now() - interval '5 hours', now() - interval '5 hours'),
  ('00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000f1', 'publicado',  'mercadolibre', now() - interval '9 hours', now() - interval '9 hours', now() - interval '9 hours');

-- QR de Mercado Pago: Q1 pendiente vencido hace 1 h. No cuentan: Q2 pendiente que vence en 1 h, Q3 ya pagado. (Solo puede
-- haber un QR pendiente por comprobante: por eso Q1 y Q2 van sobre comprobantes distintos.)
INSERT INTO public.qr_pagos_mp (empresa_id, comprobante_id, user_id, external_reference, monto, estado, expiracion) VALUES
  ('00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000d1', '00000000-fe01-0000-0000-0000000000a1', 'pgtap-salud-q1', 100, 'pendiente', now() - interval '1 hour'),
  ('00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000d3', '00000000-fe01-0000-0000-0000000000a1', 'pgtap-salud-q2', 100, 'pendiente', now() + interval '1 hour'),
  ('00000000-fe01-0000-0000-000000000001', '00000000-fe01-0000-0000-0000000000d1', '00000000-fe01-0000-0000-0000000000a1', 'pgtap-salud-q3', 100, 'pagado',    now() - interval '1 hour');

-- Respuestas de los procesos: 3000 errores 500 y 100 correctas, todas recién llegadas.
INSERT INTO net._http_response (id, status_code, timed_out, created) SELECT -g, 500, false, now() FROM generate_series(1, 3000) g;
INSERT INTO net._http_response (id, status_code, timed_out, created) SELECT -10000 - g, 200, false, now() FROM generate_series(1, 100) g;

-- Tareas programadas: una que corre cada minuto y nunca corrió, una diaria cuya última corrida fue hace 30 h, y una
-- diaria con una corrida fallida hace 1 h.
SELECT cron.schedule('__pgtap_frecuente', '* * * * *', 'SELECT 1');
SELECT cron.schedule('__pgtap_diario',    '0 3 * * *', 'SELECT 1');
SELECT cron.schedule('__pgtap_fallido',   '0 4 * * *', 'SELECT 1');
-- (runid explícito: el rol que corre el test puede no tener permiso sobre la secuencia de cron.job_run_details)
INSERT INTO cron.job_run_details (runid, jobid, status, start_time, end_time)
  SELECT -1, jobid, 'succeeded', now() - interval '30 hours', now() - interval '30 hours' FROM cron.job WHERE jobname = '__pgtap_diario';
INSERT INTO cron.job_run_details (runid, jobid, status, start_time, end_time)
  SELECT -2, jobid, 'failed', now() - interval '1 hour', now() - interval '1 hour' FROM cron.job WHERE jobname = '__pgtap_fallido';

SELECT set_config('pgtap.desp', public.chequeo_salud_sistema()::text, true);

-- ───────────────────────────────────────────────────────────────────────────
-- C) Cada chequeo cambia cuando se planta su caso (lo medido es la diferencia contra el estado de antes)
-- ───────────────────────────────────────────────────────────────────────────

SELECT is((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'documentos_sin_asiento') -> 'datos' ->> 'documentos')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'documentos_sin_asiento') -> 'datos' ->> 'documentos')::int, 3,
  'C1: suma justo los 3 documentos sin asiento (venta, nota de crédito, compra) y no los recientes, cancelados, anulados, viejos ni con asiento');
SELECT isnt(public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'documentos_sin_asiento') ->> 'estado', 'ok',
  'C2: y el chequeo deja de estar en ok');

SELECT is((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'cola_arca') -> 'datos' ->> 'atascados_30min')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'cola_arca') -> 'datos' ->> 'atascados_30min')::int, 2,
  'C3: cola de ARCA: 2 comprobantes atascados hace más de 30 min (no cuenta el que espera un reintento a futuro ni el que se procesa ahora)');
SELECT is((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'cola_arca') -> 'datos' ->> 'atascados_4h')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'cola_arca') -> 'datos' ->> 'atascados_4h')::int, 1,
  'C4: cola de ARCA: 1 atascado hace más de 4 horas');
SELECT is((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'cola_arca') -> 'datos' ->> 'errores_24h')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'cola_arca') -> 'datos' ->> 'errores_24h')::int, 1,
  'C5: cola de ARCA: 1 error nuevo en 24 h (el de hace 3 días no cuenta)');
SELECT is(public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'cola_arca') ->> 'estado', 'critico',
  'C6: cola de ARCA: con uno atascado hace más de 4 h es crítico');

SELECT is((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'colas_integraciones') -> 'datos' ->> 'atascados_30min')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'colas_integraciones') -> 'datos' ->> 'atascados_30min')::int, 2,
  'C7: integraciones: 2 pedidos atascados hace más de 30 min (uno de stock y uno de catálogo)');
SELECT is((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'colas_integraciones') -> 'datos' ->> 'atascados_4h')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'colas_integraciones') -> 'datos' ->> 'atascados_4h')::int, 1,
  'C8: integraciones: 1 atascado hace más de 4 horas');
SELECT is((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'colas_integraciones') -> 'datos' ->> 'errores_24h')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'colas_integraciones') -> 'datos' ->> 'errores_24h')::int, 1,
  'C9: integraciones: 1 error nuevo en 24 h (el de hace 3 días no cuenta)');
SELECT is(public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'colas_integraciones') ->> 'estado', 'critico',
  'C10: integraciones: con uno atascado hace más de 4 h es crítico');

SELECT is((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'qr_mercadopago') -> 'datos' ->> 'vencidos_sin_baja')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'qr_mercadopago') -> 'datos' ->> 'vencidos_sin_baja')::int, 1,
  'C11: QR: 1 pendiente vencido sin darse de baja (no cuenta el que vence a futuro ni el ya pagado)');
SELECT is(public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'qr_mercadopago') ->> 'estado', 'atencion',
  'C12: QR: pasa a atención');

SELECT is(public.__pgtap_chk(public.chequeo_salud_sistema(1), 'base_de_datos') ->> 'estado', 'critico',
  'C13: base de datos: con un tope de 1 MB (la base pesa más) es crítico');
SELECT is(public.__pgtap_chk(public.chequeo_salud_sistema(100000000), 'base_de_datos') ->> 'estado', 'ok',
  'C14: base de datos: con un tope enorme está ok');

UPDATE public.tipos_cambio SET origen = 'manual' WHERE origen = 'automatico';
SELECT is(public.__pgtap_chk(public.chequeo_salud_sistema(), 'tipo_de_cambio') ->> 'estado', 'ok',
  'C15: cotización: sin cotizaciones automáticas configuradas no aplica (ok)');
INSERT INTO public.tipos_cambio (empresa_id, moneda, tasa, fecha, origen)
VALUES ('00000000-fe01-0000-0000-000000000001', 'USD', 1000, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - 10, 'automatico');
SELECT is(public.__pgtap_chk(public.chequeo_salud_sistema(), 'tipo_de_cambio') ->> 'estado', 'critico',
  'C16: cotización: la última automática es de hace 10 días → crítico');
UPDATE public.tipos_cambio SET fecha = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - 5 WHERE origen = 'automatico';
SELECT is(public.__pgtap_chk(public.chequeo_salud_sistema(), 'tipo_de_cambio') ->> 'estado', 'atencion',
  'C17: cotización: hace 5 días → atención');
UPDATE public.tipos_cambio SET fecha = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - 1 WHERE origen = 'automatico';
SELECT is(public.__pgtap_chk(public.chequeo_salud_sistema(), 'tipo_de_cambio') ->> 'estado', 'ok',
  'C18: cotización: de ayer → ok');

SELECT ok((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'workers_respuestas') -> 'datos' ->> 'con_error')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'workers_respuestas') -> 'datos' ->> 'con_error')::int >= 3000,
  'C19: respuestas: cuenta los 3000 errores nuevos');
SELECT is(public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'workers_respuestas') ->> 'estado', 'critico',
  'C20: respuestas: con más de la mitad de errores es crítico');

SELECT is((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'cron_jobs') -> 'datos' ->> 'atrasadas_frecuentes')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'cron_jobs') -> 'datos' ->> 'atrasadas_frecuentes')::int, 1,
  'C21: tareas: la que corre cada minuto y nunca corrió figura atrasada');
SELECT is((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'cron_jobs') -> 'datos' ->> 'atrasadas_diarias')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'cron_jobs') -> 'datos' ->> 'atrasadas_diarias')::int, 1,
  'C22: tareas: la diaria con su última corrida hace 30 h figura atrasada (la fallida de hace 1 h no)');
SELECT is((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'cron_jobs') -> 'datos' ->> 'fallidas_24h')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'cron_jobs') -> 'datos' ->> 'fallidas_24h')::int, 1,
  'C23: tareas: cuenta la corrida fallida de las últimas 24 h');
SELECT is(public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'cron_jobs') ->> 'estado', 'critico',
  'C24: tareas: con una frecuente atrasada es crítico');
SELECT ok(public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'cron_jobs') ->> 'detalle' LIKE '%__pgtap_frecuente%',
  'C25: y el detalle dice cuál es');

SELECT is((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'asientos_descuadrados') -> 'datos' ->> 'asientos')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'asientos_descuadrados') -> 'datos' ->> 'asientos')::int, 1,
  'C26: asientos: detecta el asiento confirmado con debe 100 y haber 40 (no los balanceados)');
SELECT is(public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'asientos_descuadrados') ->> 'estado', 'critico',
  'C27: asientos: es crítico');

SELECT is((public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'registros_nuevos') -> 'datos' ->> 'usuarios_24h')::int
        - (public.__pgtap_chk(current_setting('pgtap.base')::jsonb, 'registros_nuevos') -> 'datos' ->> 'usuarios_24h')::int, 26,
  'C28: registros: cuenta los 26 usuarios nuevos');
SELECT is(public.__pgtap_chk(current_setting('pgtap.desp')::jsonb, 'registros_nuevos') ->> 'estado', 'atencion',
  'C29: registros: un pico de usuarios nuevos pasa a atención');

SELECT is(current_setting('pgtap.desp')::jsonb ->> 'estado', 'critico',
  'C30: el estado global es el peor de todos (crítico)');

-- ───────────────────────────────────────────────────────────────────────────
-- D) Lógica de los avisos (con resultados inyectados, para no depender del estado real)
-- ───────────────────────────────────────────────────────────────────────────

DELETE FROM public.salud_sistema_chequeos;
DELETE FROM vault.secrets WHERE name = 'alerta_webhook_url';

SELECT set_config('pgtap.r_ok', '{"estado":"ok","chequeos":[{"codigo":"a","titulo":"Cosa sana","estado":"ok","detalle":"todo bien"}]}', true);
SELECT set_config('pgtap.r_att', '{"estado":"atencion","chequeos":[{"codigo":"arca","titulo":"Cola de facturación (ARCA)","estado":"atencion","detalle":"2 atascados"},{"codigo":"a","titulo":"Cosa sana","estado":"ok","detalle":"todo bien"}]}', true);
SELECT set_config('pgtap.r_crit', '{"estado":"critico","chequeos":[{"codigo":"arca","titulo":"Cola de facturación (ARCA)","estado":"critico","detalle":"1 hace más de 4 h"},{"codigo":"db","titulo":"Espacio de la base","estado":"atencion","detalle":"70 %"},{"codigo":"a","titulo":"Cosa sana","estado":"ok","detalle":"todo bien"}]}', true);

-- Sin webhook configurado: el chequeo corre y queda guardado, pero no sale ningún aviso.
SELECT is(public.ejecutar_chequeo_salud(current_setting('pgtap.r_crit')::jsonb) ->> 'aviso_enviado', 'false',
  'D1: sin webhook configurado no se envía nada');
SELECT is((SELECT count(*)::int FROM public.salud_sistema_chequeos WHERE estado = 'critico' AND NOT aviso_abierto), 1,
  'D2: pero el resultado queda guardado, con el aviso sin abrir');

SELECT vault.create_secret('https://example.invalid/hook-pgtap', 'alerta_webhook_url', 'pgtap');
DELETE FROM public.salud_sistema_chequeos;

SELECT is(public.ejecutar_chequeo_salud(current_setting('pgtap.r_att')::jsonb) ->> 'aviso_enviado', 'false',
  'D3: un "atención" en la primera corrida NO avisa (espera a que se repita)');
SELECT is(public.ejecutar_chequeo_salud(current_setting('pgtap.r_att')::jsonb) ->> 'aviso_enviado', 'true',
  'D4: el segundo "atención" seguido SÍ avisa');
SELECT is(public.__pgtap_cola(), 1, 'D5: y quedó un solo pedido en la cola');
SELECT is(public.ejecutar_chequeo_salud(current_setting('pgtap.r_att')::jsonb) ->> 'aviso_enviado', 'false',
  'D6: el tercero seguido no repite el aviso');
SELECT is(public.__pgtap_cola(), 1, 'D7: la cola sigue con un solo pedido');

SELECT is(public.ejecutar_chequeo_salud(current_setting('pgtap.r_crit')::jsonb) ->> 'aviso_enviado', 'true',
  'D8: al empeorar a crítico avisa enseguida');
SELECT is(public.__pgtap_cola(), 2, 'D9: son 2 pedidos');
SELECT ok(public.__pgtap_ultimo_aviso() LIKE '%CRÍTICO%' AND public.__pgtap_ultimo_aviso() LIKE '%Cola de facturación (ARCA)%'
      AND public.__pgtap_ultimo_aviso() LIKE '%Espacio de la base%',
  'D10: el mensaje dice CRÍTICO y nombra los chequeos que no están ok');
SELECT ok(public.__pgtap_ultimo_aviso() NOT LIKE '%Cosa sana%',
  'D11: y no incluye lo que está sano');
SELECT is((SELECT estado_avisado FROM public.salud_sistema_chequeos ORDER BY id DESC LIMIT 1), 'critico',
  'D12: queda anotado que se avisó un crítico');
SELECT is(public.ejecutar_chequeo_salud(current_setting('pgtap.r_crit')::jsonb) ->> 'aviso_enviado', 'false',
  'D13: el crítico repetido sin cambios no vuelve a avisar');
SELECT is(public.ejecutar_chequeo_salud(current_setting('pgtap.r_att')::jsonb) ->> 'aviso_enviado', 'false',
  'D14: bajar de crítico a atención tampoco es un aviso nuevo');
SELECT is(public.__pgtap_cola(), 2, 'D15: la cola sigue en 2');

UPDATE public.salud_sistema_chequeos SET ultimo_aviso_en = now() - interval '13 hours' WHERE id = (SELECT max(id) FROM public.salud_sistema_chequeos);
SELECT is(public.ejecutar_chequeo_salud(current_setting('pgtap.r_att')::jsonb) ->> 'aviso_enviado', 'true',
  'D16: pasadas 12 horas sin resolverse, recuerda');
SELECT is(public.__pgtap_cola(), 3, 'D17: son 3 pedidos');
SELECT ok((SELECT ultimo_aviso_en FROM public.salud_sistema_chequeos ORDER BY id DESC LIMIT 1) > now() - interval '1 minute',
  'D18: y se renueva la hora del último aviso');

SELECT is(public.ejecutar_chequeo_salud(current_setting('pgtap.r_ok')::jsonb) ->> 'aviso_enviado', 'true',
  'D19: al volver todo a ok manda un aviso de "normalizado"');
SELECT ok(public.__pgtap_ultimo_aviso() LIKE '%normalizado%', 'D20: y el mensaje lo dice');
SELECT is((SELECT aviso_abierto FROM public.salud_sistema_chequeos ORDER BY id DESC LIMIT 1), false,
  'D21: el aviso queda cerrado');
SELECT is(public.ejecutar_chequeo_salud(current_setting('pgtap.r_ok')::jsonb) ->> 'aviso_enviado', 'false',
  'D22: y estando todo ok no se vuelve a avisar');
SELECT is(public.__pgtap_cola(), 4, 'D23: la cola quedó en 4');

DELETE FROM public.salud_sistema_chequeos;
SELECT is(public.ejecutar_chequeo_salud(current_setting('pgtap.r_crit')::jsonb) ->> 'aviso_enviado', 'true',
  'D24: un crítico en la primera corrida avisa sin esperar');

INSERT INTO public.salud_sistema_chequeos (ejecutado_en, estado, resultado) VALUES (now() - interval '40 days', 'ok', '{"estado":"ok","chequeos":[]}');
SELECT public.ejecutar_chequeo_salud(current_setting('pgtap.r_ok')::jsonb);
SELECT is((SELECT count(*)::int FROM public.salud_sistema_chequeos WHERE ejecutado_en < now() - interval '30 days'), 0,
  'D25: el historial de más de 30 días se purga');

-- Ejecución "de verdad" (sin resultado inyectado): guarda una fila y el estado devuelto coincide con el guardado.
DELETE FROM public.salud_sistema_chequeos;
SELECT set_config('pgtap.real', public.ejecutar_chequeo_salud()::text, true);
SELECT is(current_setting('pgtap.real')::jsonb ->> 'estado', (SELECT estado FROM public.salud_sistema_chequeos ORDER BY id DESC LIMIT 1),
  'D26: el chequeo real guarda una fila con el mismo estado que devuelve');
SELECT is((SELECT count(*)::int FROM public.salud_sistema_chequeos), 1, 'D27: y es una sola fila');

SELECT * FROM finish();

ROLLBACK;
