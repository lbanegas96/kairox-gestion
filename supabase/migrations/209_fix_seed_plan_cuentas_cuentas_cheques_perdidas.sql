-- migration 209 — Recuperar las 3 cuentas de cheques perdidas de seed_plan_cuentas
--
-- HALLAZGO (sesión de CI de pgTAP, al hacer correr cheques_contabilizacion_166.test.sql
-- de verdad por primera vez con pg_prove): los triggers fn_asiento_cheque_propio y
-- fn_asiento_cheque_tercero (mig.166) dependen de 3 cuentas del plan de cuentas:
--   2.1.6 "Documentos a Pagar", 1.1.6 "Cheques de Terceros en Cartera",
--   1.1.7 "Deudores por Cheques Rechazados".
--
-- La propia migration 166 SÍ las agregó a seed_plan_cuentas en su momento (línea 89-101
-- de ese archivo). Pero la migration 170 (multimoneda_diferencia_cambio), al redefinir
-- la MISMA función para agregar las cuentas 4.4/5.9 de diferencia de cambio, copió una
-- versión de la función ANTERIOR a la 166 — perdiendo silenciosamente esas 3 cuentas.
-- La migration 193 (solo agregaba SET search_path, "sin cambiar ninguna lógica" según
-- su propio comentario) heredó esa versión ya incompleta sin notarlo.
--
-- BUG REAL EN PRODUCCIÓN desde que corrió la migration 170: toda empresa creada desde
-- entonces (vía create_tenant(), que llama a este seed) quedó SIN estas 3 cuentas. Como
-- los triggers de cheques tienen `EXCEPTION WHEN OTHERS THEN NULL` (silencian cualquier
-- error) y además chequean "IF v_cta_X IS NULL THEN RETURN NEW" antes de intentar nada,
-- el síntoma es 100% silencioso: el cheque cambia de estado con éxito, pero el asiento
-- contable correspondiente simplemente nunca se crea. Ningún error, ningún log.
--
-- Verificado contra las 2 empresas reales de producción: Nalux (cbc4db74-...) tiene las
-- 3 cuentas (se las agregaron a mano en algún momento); la empresa del fundador
-- (db21dfad-...) solo tiene 2 de las 3 (le falta 1.1.6) — evidencia de que esto se viene
-- parchando a mano, no a través del seed real.

-- 1) Corregir seed_plan_cuentas para toda empresa NUEVA de acá en más.
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
    (p_empresa_id, '4.4',   'Diferencia de Cambio (Ganancia)', 'ingreso', 2, true);
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
    (p_empresa_id, '5.9',   'Diferencia de Cambio (Pérdida)', 'egreso', 2, true);
END;
$function$;

-- 2) Retroactivo para empresas ya existentes que se crearon entre la 170 y hoy y
-- quedaron sin alguna de las 3 cuentas (mismo patrón idempotente que ya usó la 166
-- para 2.1.6/1.1.7 en su momento). WHERE NOT EXISTS evita duplicar en las empresas
-- que ya las tienen (parcheadas a mano).
INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos)
SELECT e.id, '1.1.6', 'Cheques de Terceros en Cartera', 'activo', 3, true
FROM public.empresas e
WHERE EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id AND p.codigo = '1.1.6');

INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos)
SELECT e.id, '1.1.7', 'Deudores por Cheques Rechazados', 'activo', 3, true
FROM public.empresas e
WHERE EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id AND p.codigo = '1.1.7');

INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos)
SELECT e.id, '2.1.6', 'Documentos a Pagar', 'pasivo', 3, true
FROM public.empresas e
WHERE EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id AND p.codigo = '2.1.6');

-- ROLLBACK (comentado): CREATE OR REPLACE FUNCTION seed_plan_cuentas con el body de
-- la migration 193 (sin las 3 cuentas) + DELETE de las filas que insertó el paso 2
-- que coincidan con created_at posterior a esta migration.
