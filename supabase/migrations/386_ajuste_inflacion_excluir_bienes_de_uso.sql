-- Migration 386 -- Ajuste por Inflación: excluir Bienes de Uso del circuito
-- CONTABLE (RT 6, Fase 1/2/4). Pedido explícito de Luciano (02/09): "lo que
-- quiero hacer respecto al ajuste por inflación es contemplar la
-- revalorización de la mercadería y la moneda más que otra cosa, no quiero
-- que los bienes interfieran en esto ya que no es a lo que apunto por
-- ahora" -- decisión de alcance de producto, no un error técnico.
--
-- Efecto: Bienes de Uso (1.2.1) pasa de 'no_monetaria' (se reexpresaba y
-- generaba RECPAM, tanto en el asiento real de Fase 1/4 como en el reporte
-- de solo lectura de Fase 2) a 'monetaria' (no se toca en ninguno de los
-- dos -- mismo booleano alimenta ambos circuitos). Foco queda en Inventario
-- (Mercaderías) + Patrimonio + cuentas monetarias (RECPAM).
--
-- NO toca Intangibles (1.2.2, no mencionado) ni la Fase 3 (impositivo) --
-- ahí Bienes de Uso ya estaba excluido por mandato legal (Ley 27.468 art.
-- 95 inciso a), vía `excluido_ajuste_impositivo`), coincide con lo que
-- Luciano pide, no hace falta tocar nada.
--
-- Bonus: esto también reduce el alcance del hallazgo de la auditoría sobre
-- la divergencia Fase 1 vs Fase 2 en cuentas de Activo con saldo de
-- apertura -- Bienes de Uso, al no reexpresarse más, deja de ser parte de
-- ese riesgo (Inventario lo sigue siendo, queda anotado para revisión
-- futura si hace falta).
--
-- ROLLBACK:
--   UPDATE public.plan_cuentas SET naturaleza_monetaria = 'no_monetaria' WHERE codigo = '1.2.1';
--   (recrear seed_plan_cuentas con el texto de mig.381)

UPDATE public.plan_cuentas SET naturaleza_monetaria = 'monetaria' WHERE codigo = '1.2.1';

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
    (p_empresa_id, '4.6',   'Revalorización de Inventario (Ganancia)', 'ingreso', 2, true),
    (p_empresa_id, '4.7',   'Resultado por Exposición a la Inflación (RECPAM Ganancia)', 'ingreso', 2, true);
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
    (p_empresa_id, '5.11',  'Revalorización de Inventario (Pérdida)',   'egreso', 2, true),
    (p_empresa_id, '5.12',  'Resultado por Exposición a la Inflación (RECPAM Pérdida)', 'egreso', 2, true);

  UPDATE plan_cuentas SET naturaleza_monetaria = 'monetaria'
    WHERE empresa_id = p_empresa_id AND tipo = 'pasivo';
  UPDATE plan_cuentas SET naturaleza_monetaria = 'monetaria'
    WHERE empresa_id = p_empresa_id AND tipo = 'activo'
      AND codigo IN ('1.1.1', '1.1.2', '1.1.4', '1.1.5', '1.1.6', '1.1.7', '1.1.8');
  UPDATE plan_cuentas SET naturaleza_monetaria = 'monetaria'
    WHERE empresa_id = p_empresa_id AND codigo IN ('4.7', '5.12');
  -- Bienes de Uso NO se reexpresa por ahora (mig.386) -- foco en Inventario + Moneda.
  UPDATE plan_cuentas SET naturaleza_monetaria = 'monetaria'
    WHERE empresa_id = p_empresa_id AND codigo = '1.2.1';
  UPDATE plan_cuentas SET excluido_ajuste_impositivo = true
    WHERE empresa_id = p_empresa_id AND codigo IN ('1.2.1', '1.2.2');
END;
$function$;
