-- pgTAP test: reporte «Conciliación de cuentas de control» (mig. 414)
--
-- Auditoría 24/09/2026, hallazgo CON-5. Se arma una empresa inventada con libros conocidos: 5 de las 6 cuentas de
-- control concilian a propósito y una (Cuentas a Cobrar) no; y cada uno de los 7 controles de integridad tiene
-- exactamente un caso plantado. El test confirma que la función:
--   - calcula el mayor de cada cuenta (pasivos en positivo) y el subdiario, y marca cuál concilia y cuál no,
--   - detecta cada uno de los casos plantados y NO cuenta los que no corresponden (un duplicado ya reversado,
--     documentos que sí tienen asiento, comprobantes cancelados),
--   - exige el permiso de módulo `reportes` y sesión con empresa,
--   - y no es ejecutable por un usuario sin sesión.
--
-- SEGURIDAD: crea y destruye su propio tenant/usuarios/libros sintéticos dentro de una transacción
-- que termina en ROLLBACK. Nunca toca empresas ni datos reales.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(24);

-- ───────────────────────────────────────────────────────────────────────────
-- Fixtures: la empresa, un admin, un empleado con «reportes» y otro sin permisos.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.empresas (id, nombre) VALUES
  ('00000000-fd01-0000-0000-000000000001', '__PGTAP_TEST__ Empresa conciliacion');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
VALUES
  ('00000000-fd01-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-conc-adm@kairox.test', now(), now(), now()),
  ('00000000-fd01-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-conc-rep@kairox.test', now(), now(), now()),
  ('00000000-fd01-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-conc-sin@kairox.test', now(), now(), now());

UPDATE public.profiles SET empresa_id = '00000000-fd01-0000-0000-000000000001', role = 'admin'                             WHERE id = '00000000-fd01-0000-0000-0000000000a1';
UPDATE public.profiles SET empresa_id = '00000000-fd01-0000-0000-000000000001', permissions = '{"reportes": true}'::jsonb   WHERE id = '00000000-fd01-0000-0000-0000000000a2';
UPDATE public.profiles SET empresa_id = '00000000-fd01-0000-0000-000000000001', permissions = '{}'::jsonb                    WHERE id = '00000000-fd01-0000-0000-0000000000a3';

-- Plan de cuentas mínimo (los códigos son los que usa el reporte).
INSERT INTO public.plan_cuentas (id, empresa_id, codigo, nombre, tipo) VALUES
  ('00000000-fd01-0000-0000-000000000c11', '00000000-fd01-0000-0000-000000000001', '1.1.1', 'Caja y Bancos',           'activo'),
  ('00000000-fd01-0000-0000-000000000c12', '00000000-fd01-0000-0000-000000000001', '1.1.2', 'Cuentas a Cobrar',        'activo'),
  ('00000000-fd01-0000-0000-000000000c13', '00000000-fd01-0000-0000-000000000001', '1.1.3', 'Mercaderias',             'activo'),
  ('00000000-fd01-0000-0000-000000000c14', '00000000-fd01-0000-0000-000000000001', '1.1.4', 'IVA Credito Fiscal',      'activo'),
  ('00000000-fd01-0000-0000-000000000c21', '00000000-fd01-0000-0000-000000000001', '2.1.1', 'Cuentas a Pagar',         'pasivo'),
  ('00000000-fd01-0000-0000-000000000c23', '00000000-fd01-0000-0000-000000000001', '2.1.3', 'IVA Debito Fiscal',       'pasivo'),
  ('00000000-fd01-0000-0000-000000000c31', '00000000-fd01-0000-0000-000000000001', '3.1',   'Capital',                 'patrimonio'),
  ('00000000-fd01-0000-0000-000000000c41', '00000000-fd01-0000-0000-000000000001', '4.1',   'Ventas',                  'ingreso');

-- Comprobantes: V (venta con IVA 210), NC (nota de crédito con IVA 21), V2 (venta SIN asiento) y una venta
-- cancelada (no debe contar en nada).
INSERT INTO public.comprobantes (id, empresa_id, numero_venta, tipo, total, iva_discriminado, estado_pago) VALUES
  ('00000000-fd01-0000-0000-0000000000d1', '00000000-fd01-0000-0000-000000000001', 'PGTAP-V1',  'venta',        1210, 210, 'pagada'),
  ('00000000-fd01-0000-0000-0000000000d2', '00000000-fd01-0000-0000-000000000001', 'PGTAP-NC1', 'nota_credito',  121,  21, 'pagada'),
  ('00000000-fd01-0000-0000-0000000000d3', '00000000-fd01-0000-0000-000000000001', 'PGTAP-V2',  'venta',        1000,   0, 'pagada'),
  ('00000000-fd01-0000-0000-0000000000d4', '00000000-fd01-0000-0000-000000000001', 'PGTAP-V3',  'venta',         500,  87, 'cancelada');

-- Compra K (en el Libro, IVA 21) y su proveedor.
INSERT INTO public.proveedores (id, empresa_id, nombre) VALUES
  ('00000000-fd01-0000-0000-0000000000b1', '00000000-fd01-0000-0000-000000000001', '__PGTAP_TEST__ Proveedor');
INSERT INTO public.compras (id, empresa_id, proveedor_id, numero_factura, total, iva_discriminado, neto_gravado, estado_pago, en_libro_iva) VALUES
  ('00000000-fd01-0000-0000-0000000000e1', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000b1', 'A-0001-00000001', 121, 21, 100, 'pendiente', true);

-- Asientos confirmados (encabezado primero, líneas después: el trigger recalcula el saldo de cada cuenta).
INSERT INTO public.asientos_contables (id, empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id) VALUES
  ('00000000-fd01-0000-0000-000000000a01', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000a1', 'PGTAP-A01', CURRENT_DATE, 'venta V1',             'confirmado', 1210, 1210, 'venta',                     '00000000-fd01-0000-0000-0000000000d1'),
  ('00000000-fd01-0000-0000-000000000a02', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000a1', 'PGTAP-A02', CURRENT_DATE, 'NC1',                  'confirmado',  121,  121, 'nota_credito',              '00000000-fd01-0000-0000-0000000000d2'),
  ('00000000-fd01-0000-0000-000000000a03', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000a1', 'PGTAP-A03', CURRENT_DATE, 'compra K',             'confirmado',  121,  121, 'compra',                    '00000000-fd01-0000-0000-0000000000e1'),
  ('00000000-fd01-0000-0000-000000000a04', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000a1', 'PGTAP-A04', CURRENT_DATE, 'caja',                 'confirmado',  300,  300, NULL,                        NULL),
  ('00000000-fd01-0000-0000-000000000a05', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000a1', 'PGTAP-A05', CURRENT_DATE, 'desbalanceado',        'confirmado',  100,   40, NULL,                        NULL),
  ('00000000-fd01-0000-0000-000000000a06', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000a1', 'PGTAP-A06', CURRENT_DATE, 'duplicado 1',          'confirmado',   10,   10, 'compra',                    '00000000-fd01-0000-0000-0000000000e2'),
  ('00000000-fd01-0000-0000-000000000a07', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000a1', 'PGTAP-A07', CURRENT_DATE, 'duplicado 2',          'confirmado',   10,   10, 'compra',                    '00000000-fd01-0000-0000-0000000000e2'),
  ('00000000-fd01-0000-0000-000000000a08', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000a1', 'PGTAP-A08', CURRENT_DATE, 'duplicado reversado 1', 'confirmado',  10,   10, 'venta',                     '00000000-fd01-0000-0000-0000000000e3'),
  ('00000000-fd01-0000-0000-000000000a09', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000a1', 'PGTAP-A09', CURRENT_DATE, 'duplicado reversado 2', 'confirmado',  10,   10, 'venta',                     '00000000-fd01-0000-0000-0000000000e3'),
  ('00000000-fd01-0000-0000-000000000a10', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000a1', 'PGTAP-A10', CURRENT_DATE, 'reversa del 2do',      'confirmado',  10,   10, 'reversa_asiento_duplicado', '00000000-fd01-0000-0000-000000000a09');

INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
  -- A01 venta V1: Cuentas a Cobrar 1210 / Ventas 1000 / IVA Débito 210
  ('00000000-fd01-0000-0000-000000000a01', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c12', 'x', 1210,    0),
  ('00000000-fd01-0000-0000-000000000a01', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c41', 'x',    0, 1000),
  ('00000000-fd01-0000-0000-000000000a01', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c23', 'x',    0,  210),
  -- A02 NC1: Ventas 100 / IVA Débito 21 / Cuentas a Cobrar 121
  ('00000000-fd01-0000-0000-000000000a02', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c41', 'x',  100,    0),
  ('00000000-fd01-0000-0000-000000000a02', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c23', 'x',   21,    0),
  ('00000000-fd01-0000-0000-000000000a02', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c12', 'x',    0,  121),
  -- A03 compra K: Mercaderías 100 / IVA Crédito 21 / Cuentas a Pagar 121
  ('00000000-fd01-0000-0000-000000000a03', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c13', 'x',  100,    0),
  ('00000000-fd01-0000-0000-000000000a03', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c14', 'x',   21,    0),
  ('00000000-fd01-0000-0000-000000000a03', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c21', 'x',    0,  121),
  -- A04 caja: Caja y Bancos 300 / Ventas 300
  ('00000000-fd01-0000-0000-000000000a04', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c11', 'x',  300,    0),
  ('00000000-fd01-0000-0000-000000000a04', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c41', 'x',    0,  300),
  -- A05 desbalanceado: debe 100 / haber 40 (los dos en Ventas)
  ('00000000-fd01-0000-0000-000000000a05', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c41', 'x',  100,    0),
  ('00000000-fd01-0000-0000-000000000a05', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c41', 'x',    0,   40),
  -- A06/A07 (duplicado sin reversar) y A08/A09/A10 (duplicado ya reversado): Capital 10 / Ventas 10
  ('00000000-fd01-0000-0000-000000000a06', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c31', 'x',   10,    0),
  ('00000000-fd01-0000-0000-000000000a06', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c41', 'x',    0,   10),
  ('00000000-fd01-0000-0000-000000000a07', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c31', 'x',   10,    0),
  ('00000000-fd01-0000-0000-000000000a07', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c41', 'x',    0,   10),
  ('00000000-fd01-0000-0000-000000000a08', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c31', 'x',   10,    0),
  ('00000000-fd01-0000-0000-000000000a08', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c41', 'x',    0,   10),
  ('00000000-fd01-0000-0000-000000000a09', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c31', 'x',   10,    0),
  ('00000000-fd01-0000-0000-000000000a09', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c41', 'x',    0,   10),
  ('00000000-fd01-0000-0000-000000000a10', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c41', 'x',   10,    0),
  ('00000000-fd01-0000-0000-000000000a10', '00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-000000000c31', 'x',    0,   10);

-- Subdiario de clientes: C1 concilia consigo mismo (1210 - 121 = 1089); C2 tiene 500 de movimientos pero su ficha
-- quedó en 450 (saldo desactualizado a propósito). Más un cobro sin cliente por 50.
INSERT INTO public.clientes (id, empresa_id, nombre) VALUES
  ('00000000-fd01-0000-0000-0000000000c1', '00000000-fd01-0000-0000-000000000001', '__PGTAP_TEST__ Cliente 1'),
  ('00000000-fd01-0000-0000-0000000000c2', '00000000-fd01-0000-0000-000000000001', '__PGTAP_TEST__ Cliente 2');
INSERT INTO public.cuenta_corriente_movimientos (empresa_id, cliente_id, tipo, monto, metodo_cobro) VALUES
  ('00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000c1', 'DEBE',  1210, NULL),
  ('00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000c1', 'HABER',  121, NULL),
  ('00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000c2', 'DEBE',   500, NULL),
  ('00000000-fd01-0000-0000-000000000001', NULL,                                   'HABER',   50, NULL);
UPDATE public.clientes SET saldo_actual = 450 WHERE id = '00000000-fd01-0000-0000-0000000000c2';

-- Subdiario de proveedores: la compra K por 121.
INSERT INTO public.cuenta_corriente_proveedores (empresa_id, proveedor_id, tipo, monto) VALUES
  ('00000000-fd01-0000-0000-000000000001', '00000000-fd01-0000-0000-0000000000b1', 'compra', 121);

-- Subdiario de inventario: un producto con stock 10 a costo 10 (vale 100, igual que el mayor) y otro con stock 5 sin costo.
INSERT INTO public.productos (empresa_id, nombre, stock_actual, costo_compra) VALUES
  ('00000000-fd01-0000-0000-000000000001', '__PGTAP_TEST__ Con costo', 10, 10),
  ('00000000-fd01-0000-0000-000000000001', '__PGTAP_TEST__ Sin costo',  5,  0);

-- Subdiario de caja: ingresos 400 - egresos 100 = 300 (igual que el mayor).
INSERT INTO public.movimientos_caja (empresa_id, tipo, categoria, concepto, monto) VALUES
  ('00000000-fd01-0000-0000-000000000001', 'ingreso', 'Venta', '__PGTAP_TEST__ ingreso', 400),
  ('00000000-fd01-0000-0000-000000000001', 'egreso',  'Gasto', '__PGTAP_TEST__ egreso',  100);

-- Una cuenta con el saldo mostrado desactualizado (Capital: 0 real, 999 mostrado... más lo de A06-A10).
UPDATE public.plan_cuentas SET saldo_actual = saldo_actual + 999 WHERE id = '00000000-fd01-0000-0000-000000000c31';

-- Helpers del test: guardan el resultado una vez y lo leen por clave.
CREATE FUNCTION public.__pgtap_linea(p_clave text) RETURNS jsonb LANGUAGE sql
AS $$ SELECT e FROM jsonb_array_elements(current_setting('pgtap.conc')::jsonb -> 'cuentas') e WHERE e ->> 'clave' = p_clave $$;
CREATE FUNCTION public.__pgtap_control(p_clave text) RETURNS jsonb LANGUAGE sql
AS $$ SELECT e FROM jsonb_array_elements(current_setting('pgtap.conc')::jsonb -> 'controles') e WHERE e ->> 'clave' = p_clave $$;
GRANT EXECUTE ON FUNCTION public.__pgtap_linea(text), public.__pgtap_control(text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-fd01-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT set_config('pgtap.conc', public.conciliacion_cuentas_control()::text, true);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 1-7: las cuentas de control.
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  jsonb_array_length(current_setting('pgtap.conc')::jsonb -> 'cuentas'),
  6,
  'Caso 1: el reporte trae las 6 cuentas de control'
);

SELECT is(
  (public.__pgtap_linea('clientes') ->> 'mayor')::numeric || '|' || (public.__pgtap_linea('clientes') ->> 'subdiario')::numeric || '|' || (public.__pgtap_linea('clientes') ->> 'diferencia')::numeric,
  '1089.00|1539.00|-450.00',
  'Caso 2: Cuentas a Cobrar — mayor 1089 (1210 - 121) contra fichas 1539 (1089 + 450): diferencia de -450'
);

SELECT is(
  (public.__pgtap_linea('clientes') ->> 'conciliado')::boolean,
  false,
  'Caso 3: y esa cuenta se marca como NO conciliada'
);

SELECT is(
  (public.__pgtap_linea('proveedores') ->> 'mayor')::numeric || '|' || (public.__pgtap_linea('proveedores') ->> 'subdiario')::numeric || '|' || (public.__pgtap_linea('proveedores') ->> 'conciliado'),
  '121.00|121.00|true',
  'Caso 4: Cuentas a Pagar concilia (el pasivo se muestra en positivo: 121 contra 121)'
);

SELECT is(
  (public.__pgtap_linea('inventario') ->> 'mayor')::numeric || '|' || (public.__pgtap_linea('inventario') ->> 'subdiario')::numeric || '|' || (public.__pgtap_linea('inventario') ->> 'conciliado'),
  '100.00|100.00|true',
  'Caso 5: Inventario concilia (100 contra 10 x 10; el producto sin costo aporta 0)'
);

SELECT is(
  (public.__pgtap_linea('caja_bancos') ->> 'mayor')::numeric || '|' || (public.__pgtap_linea('caja_bancos') ->> 'subdiario')::numeric || '|' || (public.__pgtap_linea('caja_bancos') ->> 'conciliado'),
  '300.00|300.00|true',
  'Caso 6: Caja y Bancos concilia (400 - 100 contra 300)'
);

SELECT is(
  (public.__pgtap_linea('iva_debito') ->> 'mayor')::numeric || '|' || (public.__pgtap_linea('iva_debito') ->> 'subdiario')::numeric || '|' || (public.__pgtap_linea('iva_credito') ->> 'mayor')::numeric || '|' || (public.__pgtap_linea('iva_credito') ->> 'subdiario')::numeric,
  '189.00|189.00|21.00|21.00',
  'Caso 7: los dos IVA concilian; la venta cancelada (IVA 87) no cuenta y la NC resta'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 8-18: los controles de integridad (uno plantado en cada uno).
-- ───────────────────────────────────────────────────────────────────────────

SELECT is(
  jsonb_array_length(current_setting('pgtap.conc')::jsonb -> 'controles'),
  7,
  'Caso 8: el reporte trae los 7 controles de integridad'
);

SELECT is(
  (public.__pgtap_control('cc_sin_cliente') ->> 'casos')::int || '|' || (public.__pgtap_control('cc_sin_cliente') ->> 'monto')::numeric,
  '1|-50.00',
  'Caso 9: un movimiento de cuenta corriente sin cliente (un cobro de 50, o sea -50 en el saldo)'
);

SELECT is(
  (public.__pgtap_control('cc_ficha_vs_movimientos') ->> 'casos')::int || '|' || (public.__pgtap_control('cc_ficha_vs_movimientos') ->> 'monto')::numeric,
  '1|-50.00',
  'Caso 10: un cliente con la ficha en 450 y movimientos por 500'
);

SELECT is(
  (public.__pgtap_control('productos_sin_costo') ->> 'casos')::int,
  1,
  'Caso 11: un producto con stock y sin costo'
);

SELECT is(
  (public.__pgtap_control('cuentas_saldo_desfasado') ->> 'casos')::int,
  1,
  'Caso 12: una cuenta (Capital) con el saldo mostrado distinto del real'
);

SELECT is(
  (public.__pgtap_control('asientos_desbalanceados') ->> 'casos')::int || '|' || (public.__pgtap_control('asientos_desbalanceados') ->> 'monto')::numeric,
  '1|60.00',
  'Caso 13: un asiento confirmado con el debe 60 por encima del haber'
);

SELECT is(
  (public.__pgtap_control('documentos_sin_asiento') ->> 'casos')::int || '|' || (public.__pgtap_control('documentos_sin_asiento') ->> 'monto')::numeric,
  '1|1000.00',
  'Caso 14: una sola venta sin asiento (V2 por 1000); la venta cancelada y los documentos con asiento no cuentan'
);

SELECT is(
  (public.__pgtap_control('asientos_duplicados') ->> 'casos')::int || '|' || (public.__pgtap_control('asientos_duplicados') ->> 'monto')::numeric,
  '1|10.00',
  'Caso 15: un solo documento con asiento duplicado; el que ya tiene su reversa no se cuenta'
);

SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements(current_setting('pgtap.conc')::jsonb -> 'controles') c WHERE c ->> 'estado' = 'revisar'),
  7,
  'Caso 16: los 7 controles quedan en «revisar» (cada uno tiene su caso)'
);

SELECT is(
  (public.__pgtap_control('cc_sin_cliente') -> 'detalle' -> 0 ->> 'monto')::numeric,
  50::numeric,
  'Caso 17: el detalle trae el caso concreto (el cobro de 50)'
);

SELECT is(
  public.__pgtap_control('asientos_duplicados') -> 'detalle' -> 0 ->> 'asientos',
  'PGTAP-A06, PGTAP-A07',
  'Caso 18: y el detalle del duplicado nombra los dos asientos'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Casos 19-24: quién puede.
-- ───────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-fd01-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.conciliacion_cuentas_control()$$,
  'Caso 19: un empleado con el modulo reportes lo puede ver'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-fd01-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT throws_like(
  $$SELECT public.conciliacion_cuentas_control()$$,
  'No autorizado: sin permiso de módulo reportes%',
  'Caso 20: un empleado sin el modulo reportes no'
);

SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);

SELECT throws_like(
  $$SELECT public.conciliacion_cuentas_control()$$,
  'No autorizado%',
  'Caso 21: sin usuario no hay empresa y se rechaza'
);

RESET ROLE;

SELECT is(
  has_function_privilege('anon', 'public.conciliacion_cuentas_control()', 'EXECUTE'),
  false,
  'Caso 22: un usuario sin sesion no puede ejecutarlo'
);

SELECT is(
  has_function_privilege('authenticated', 'public.conciliacion_cuentas_control()', 'EXECUTE'),
  true,
  'Caso 23: un usuario con sesion si (la funcion valida despues empresa y permiso)'
);

SELECT is(
  (SELECT p.provolatile::text FROM pg_proc p WHERE p.oid = 'public.conciliacion_cuentas_control()'::regprocedure),
  's',
  'Caso 24: es de solo lectura (STABLE): no cambia nada al ejecutarse'
);

SELECT * FROM finish();

ROLLBACK;
