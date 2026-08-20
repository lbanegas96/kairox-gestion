-- Migration 334 -- Cuentas contables + series de numeración para
-- Recuento de Inventario y Revalorización de Inventario.
--
-- OJO: el plan original tenía 5.9/4.4 para estas cuentas -- pero esos códigos
-- YA ESTÁN TOMADOS por "Diferencia de Cambio (Pérdida/Ganancia)" (mig.170/209).
-- plan_cuentas tiene UNIQUE(empresa_id, codigo) -- hubiera fallado la migración
-- entera al primer INSERT. Se detectó ANTES de aplicar nada, releyendo
-- seed_plan_cuentas vigente. Próximos códigos libres: 5.10/5.11 y 4.5/4.6.
--
-- ROLLBACK:
--   Revertir seed_plan_cuentas/seed_series_numeracion al body de la mig.209/301
--   (sin estas filas) + DELETE de las filas de plan_cuentas/series_numeracion con
--   estos codigo/tipo_documento nuevos.

-- ── 1) seed_plan_cuentas: 4 cuentas nuevas para toda empresa NUEVA ──────────
CREATE OR REPLACE FUNCTION public.seed_plan_cuentas(p_empresa_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM plan_cuentas WHERE empresa_id = p_empresa_id LIMIT 1) THEN
    RETURN;
  END IF;
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '1',     'ACTIVO',                    'activo', 1, false),
    (p_empresa_id, '1.1',   'Activo Corriente',          'activo', 2, false),
    (p_empresa_id, '1.1.1', 'Caja y Bancos',             'activo', 3, true),
    (p_empresa_id, '1.1.2', 'Cuentas a Cobrar',          'activo', 3, true),
    (p_empresa_id, '1.1.3', 'Mercaderías / Inventario',  'activo', 3, true),
    (p_empresa_id, '1.1.4', 'IVA Crédito Fiscal',        'activo', 3, true),
    (p_empresa_id, '1.1.5', 'Otros Activos Corrientes',  'activo', 3, true),
    (p_empresa_id, '1.1.6', 'Cheques de Terceros en Cartera',      'activo', 3, true),
    (p_empresa_id, '1.1.7', 'Deudores por Cheques Rechazados',     'activo', 3, true),
    (p_empresa_id, '1.2',   'Activo No Corriente',       'activo', 2, false),
    (p_empresa_id, '1.2.1', 'Bienes de Uso (neto)',      'activo', 3, true),
    (p_empresa_id, '1.2.2', 'Intangibles',               'activo', 3, true);
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '2',     'PASIVO',                    'pasivo', 1, false),
    (p_empresa_id, '2.1',   'Pasivo Corriente',          'pasivo', 2, false),
    (p_empresa_id, '2.1.1', 'Cuentas a Pagar',           'pasivo', 3, true),
    (p_empresa_id, '2.1.2', 'Sueldos y Cargas Sociales', 'pasivo', 3, true),
    (p_empresa_id, '2.1.3', 'IVA Débito Fiscal',         'pasivo', 3, true),
    (p_empresa_id, '2.1.4', 'Impuestos a Pagar',         'pasivo', 3, true),
    (p_empresa_id, '2.1.5', 'Otros Pasivos Corrientes',  'pasivo', 3, true),
    (p_empresa_id, '2.1.6', 'Documentos a Pagar',        'pasivo', 3, true),
    (p_empresa_id, '2.2',   'Pasivo No Corriente',       'pasivo', 2, false),
    (p_empresa_id, '2.2.1', 'Deudas Financieras LP',     'pasivo', 3, true);
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '3',     'PATRIMONIO NETO',           'patrimonio', 1, false),
    (p_empresa_id, '3.1',   'Capital Social',            'patrimonio', 2, true),
    (p_empresa_id, '3.2',   'Resultados Acumulados',     'patrimonio', 2, true),
    (p_empresa_id, '3.3',   'Resultado del Ejercicio',   'patrimonio', 2, true);
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '4',     'INGRESOS',                  'ingreso', 1, false),
    (p_empresa_id, '4.1',   'Ventas de Productos',       'ingreso', 2, true),
    (p_empresa_id, '4.2',   'Ventas de Servicios',       'ingreso', 2, true),
    (p_empresa_id, '4.3',   'Otros Ingresos',            'ingreso', 2, true),
    (p_empresa_id, '4.4',   'Diferencia de Cambio (Ganancia)', 'ingreso', 2, true),
    (p_empresa_id, '4.5',   'Diferencias de Inventario (Sobrantes)',   'ingreso', 2, true),
    (p_empresa_id, '4.6',   'Revalorización de Inventario (Ganancia)', 'ingreso', 2, true);
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '5',     'EGRESOS / GASTOS',          'egreso', 1, false),
    (p_empresa_id, '5.1',   'Costo de Mercaderías',      'egreso', 2, true),
    (p_empresa_id, '5.2',   'Gastos de Personal',        'egreso', 2, true),
    (p_empresa_id, '5.3',   'Gastos Comerciales',        'egreso', 2, true),
    (p_empresa_id, '5.4',   'Gastos de Administración',  'egreso', 2, true),
    (p_empresa_id, '5.5',   'Gastos Financieros',        'egreso', 2, true),
    (p_empresa_id, '5.6',   'Impuestos y Tasas',         'egreso', 2, true),
    (p_empresa_id, '5.7',   'Amortizaciones',            'egreso', 2, true),
    (p_empresa_id, '5.8',   'Otros Gastos',              'egreso', 2, true),
    (p_empresa_id, '5.9',   'Diferencia de Cambio (Pérdida)', 'egreso', 2, true),
    (p_empresa_id, '5.10',  'Diferencias de Inventario (Faltantes)',    'egreso', 2, true),
    (p_empresa_id, '5.11',  'Revalorización de Inventario (Pérdida)',   'egreso', 2, true);
END;
$function$;

-- ── 2) Backfill idempotente para empresas ya existentes (Nalux) ────────────
INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos)
SELECT e.id, '4.5', 'Diferencias de Inventario (Sobrantes)', 'ingreso', 2, true
FROM public.empresas e
WHERE EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id AND p.codigo = '4.5');

INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos)
SELECT e.id, '4.6', 'Revalorización de Inventario (Ganancia)', 'ingreso', 2, true
FROM public.empresas e
WHERE EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id AND p.codigo = '4.6');

INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos)
SELECT e.id, '5.10', 'Diferencias de Inventario (Faltantes)', 'egreso', 2, true
FROM public.empresas e
WHERE EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id AND p.codigo = '5.10');

INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos)
SELECT e.id, '5.11', 'Revalorización de Inventario (Pérdida)', 'egreso', 2, true
FROM public.empresas e
WHERE EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id AND p.codigo = '5.11');

-- ── 3) series_numeracion tiene un CHECK explícito de tipo_documento aparte
-- del seed -- hay que ampliarlo o el INSERT de series_numeracion (backfill y
-- seed) falla con 23514 "violates check constraint chk_series_tipo_documento"
-- (detectado en vivo simulando esta migración con BEGIN...ROLLBACK).
ALTER TABLE public.series_numeracion DROP CONSTRAINT IF EXISTS chk_series_tipo_documento;
ALTER TABLE public.series_numeracion ADD CONSTRAINT chk_series_tipo_documento
  CHECK (tipo_documento = ANY (ARRAY[
    'venta','factura','nota_credito','nota_debito','nota_debito_venta','nota_credito_proveedor',
    'orden_compra','cotizacion','pedido','entrega','recepcion','devolucion',
    'recuento_inventario','revalorizacion_inventario'
  ]));

-- ── 4) seed_series_numeracion: 2 tipos de documento nuevos ──────────────────
-- Mismo criterio que la mig.301 vigente (ON CONFLICT debe repetir el predicado
-- del índice parcial idx_series_numeracion_legacy, WHERE punto_venta_id IS NULL).
CREATE OR REPLACE FUNCTION public.seed_series_numeracion(p_empresa_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id()
     AND (SELECT empresa_id FROM public.profiles WHERE id = auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos) VALUES
    (p_empresa_id, 'venta',                  '',     'YYYYMMDD', 3),
    (p_empresa_id, 'factura',                'FAC-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito',           'NC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito_venta',      'ND-',  'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito_proveedor', 'NC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'pedido',                 'PED-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito',            'ND-',  'YYYY',     4),
    (p_empresa_id, 'entrega',                'ENT-', 'YYYY',     4),
    (p_empresa_id, 'recepcion',              'REC-', 'YYYY',     4),
    (p_empresa_id, 'orden_compra',           'OC-',  'ninguno',  5),
    (p_empresa_id, 'cotizacion',             'COT-', 'ninguno',  5),
    (p_empresa_id, 'recuento_inventario',       'RC-', 'YYYYMMDD', 3),
    (p_empresa_id, 'revalorizacion_inventario', 'RV-', 'YYYYMMDD', 3)
  ON CONFLICT (empresa_id, tipo_documento) WHERE punto_venta_id IS NULL DO NOTHING;
END;
$$;

-- Backfill idempotente para empresas ya existentes.
INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos)
SELECT e.id, 'recuento_inventario', 'RC-', 'YYYYMMDD', 3
FROM public.empresas e
WHERE NOT EXISTS (
  SELECT 1 FROM public.series_numeracion sn
  WHERE sn.empresa_id = e.id AND sn.tipo_documento = 'recuento_inventario' AND sn.punto_venta_id IS NULL
);

INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos)
SELECT e.id, 'revalorizacion_inventario', 'RV-', 'YYYYMMDD', 3
FROM public.empresas e
WHERE NOT EXISTS (
  SELECT 1 FROM public.series_numeracion sn
  WHERE sn.empresa_id = e.id AND sn.tipo_documento = 'revalorizacion_inventario' AND sn.punto_venta_id IS NULL
);
