-- Migration 381 -- Ajuste por Inflación, Fase 3 (IMPOSITIVO — Ganancias,
-- Ley 27.468, arts. 95/96 LIG). Circuito DISTINTO al contable (RT 6, Fase
-- 1/2): usa una lista legal específica de exclusiones (no
-- naturaleza_monetaria), un solo coeficiente ANUAL para la parte "estática"
-- (no mensual), y ajustes "dinámicos" por movimiento de capital y de
-- bienes excluidos. El resultado NO genera ningún asiento -- es una
-- estimación de apoyo para la Declaración Jurada de Ganancias, no un
-- registro contable. Construido sin contador/asesor impositivo disponible
-- -- mismo criterio de la Fase 0/1: evidencia pública citada, simplificado
-- donde el plan de cuentas de KAIROX no modela un concepto (existencias
-- forestales, inversiones en el exterior, acciones societarias, anticipos
-- que congelan precio, aportes irrevocables sin interés) -- documentado
-- explícitamente como limitación, no como omisión silenciosa.
--
-- Mecánica (art. 95):
--   1) Activo computable = Activo total - activos excluidos (inciso a):
--      acá, Bienes de Uso e Intangibles -- el resto de la lista legal
--      (existencias forestales, acciones, inversiones exterior, etc.) no
--      tiene cuenta propia en el plan de cuentas de KAIROX hoy.
--   2) Pasivo computable = Pasivo total (sin exclusiones -- KAIROX no
--      modela "aportes irrevocables sin interés" como cuenta separada).
--   3) PN computable al inicio = Activo computable - Pasivo computable.
--   4) Ajuste estático = -PN computable inicio * (coeficiente anual - 1),
--      coeficiente anual = índice(mes cierre) / índice(mes cierre del
--      ejercicio ANTERIOR) -- UN SOLO coeficiente, no uno por mes.
--   5) Ajuste dinámico: movimientos del ejercicio en Capital Social (3.1)
--      y en cuentas excluidas, cada uno reexpresado por SU propio mes
--      (esto sí, mes a mes, igual que Fase 1/2).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.calcular_ajuste_impositivo_ganancias(uuid, date, date);
--   ALTER TABLE public.plan_cuentas DROP COLUMN IF EXISTS excluido_ajuste_impositivo;

ALTER TABLE public.plan_cuentas
  ADD COLUMN IF NOT EXISTS excluido_ajuste_impositivo BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.plan_cuentas.excluido_ajuste_impositivo IS
  'Ley 27.468 art. 95 inciso a) -- activos "no computables" para el ajuste por inflación IMPOSITIVO '
  '(Ganancias). Distinto de naturaleza_monetaria (RT 6/contable): acá Inventario SÍ es computable, '
  'pero Bienes de Uso e Intangibles NO. Solo cubre lo que el plan de cuentas de KAIROX modela hoy.';

UPDATE public.plan_cuentas SET excluido_ajuste_impositivo = true WHERE codigo IN ('1.2.1', '1.2.2');

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
  UPDATE plan_cuentas SET excluido_ajuste_impositivo = true
    WHERE empresa_id = p_empresa_id AND codigo IN ('1.2.1', '1.2.2');
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════
-- Cálculo -- solo lectura, no genera asiento. p_fecha_inicio/p_fecha_cierre
-- son el ejercicio FISCAL (normalmente el mismo rango que el ejercicio
-- contable en periodos_contables, pero se pasa libre para no atarlo a esa
-- tabla -- Ganancias se declara una vez al año, no es un "período" que se
-- cierre en el día a día como los mensuales que usa Nalux hoy).
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.calcular_ajuste_impositivo_ganancias(
  p_empresa_id UUID,
  p_fecha_inicio DATE,
  p_fecha_cierre DATE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mes_cierre           DATE;
  v_mes_cierre_anterior  DATE;
  v_indice_cierre        NUMERIC;
  v_indice_cierre_anterior NUMERIC;
  v_activo_computable_inicio NUMERIC := 0;
  v_pasivo_computable_inicio NUMERIC := 0;
  v_pn_computable_inicio NUMERIC;
  v_coef_anual           NUMERIC;
  v_ajuste_estatico      NUMERIC;
  v_ajuste_dinamico      NUMERIC := 0;
  v_detalle_dinamico     JSONB;
  v_meses_sin_indice     JSONB;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: la empresa no coincide con el usuario autenticado';
  END IF;

  v_mes_cierre := date_trunc('month', p_fecha_cierre)::date;
  -- "Mes de cierre del ejercicio anterior" (art. 96) -- el día antes de que
  -- arranque este ejercicio, truncado a mes.
  v_mes_cierre_anterior := date_trunc('month', p_fecha_inicio - interval '1 day')::date;

  SELECT indice INTO v_indice_cierre FROM public.indices_inflacion
  WHERE empresa_id = p_empresa_id AND periodo = v_mes_cierre;
  SELECT indice INTO v_indice_cierre_anterior FROM public.indices_inflacion
  WHERE empresa_id = p_empresa_id AND periodo = v_mes_cierre_anterior;

  IF v_indice_cierre IS NULL OR v_indice_cierre_anterior IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'mensaje', 'Falta el índice de ' ||
        CASE WHEN v_indice_cierre IS NULL THEN to_char(v_mes_cierre, 'MM/YYYY') ELSE to_char(v_mes_cierre_anterior, 'MM/YYYY') END ||
        ' en Configuración → Finanzas -- sin eso no se puede calcular el ajuste estático.'
    );
  END IF;

  v_coef_anual := v_indice_cierre / v_indice_cierre_anterior;

  -- Activo/Pasivo computable al inicio del ejercicio (todo lo confirmado
  -- ANTES de p_fecha_inicio).
  SELECT COALESCE(SUM(ai.debe), 0) - COALESCE(SUM(ai.haber), 0)
    INTO v_activo_computable_inicio
  FROM public.asientos_items ai
  JOIN public.asientos_contables ac ON ac.id = ai.asiento_id
  JOIN public.plan_cuentas pc ON pc.id = ai.cuenta_id
  WHERE ac.empresa_id = p_empresa_id AND ac.estado = 'confirmado' AND ac.fecha < p_fecha_inicio
    AND pc.tipo = 'activo' AND NOT pc.excluido_ajuste_impositivo;

  SELECT COALESCE(SUM(ai.haber), 0) - COALESCE(SUM(ai.debe), 0)
    INTO v_pasivo_computable_inicio
  FROM public.asientos_items ai
  JOIN public.asientos_contables ac ON ac.id = ai.asiento_id
  JOIN public.plan_cuentas pc ON pc.id = ai.cuenta_id
  WHERE ac.empresa_id = p_empresa_id AND ac.estado = 'confirmado' AND ac.fecha < p_fecha_inicio
    AND pc.tipo = 'pasivo';

  v_pn_computable_inicio := v_activo_computable_inicio - v_pasivo_computable_inicio;
  -- Activo > Pasivo (posición activa neta) => pérdida => ajuste negativo.
  v_ajuste_estatico := -v_pn_computable_inicio * (v_coef_anual - 1);

  -- Ajuste dinámico: movimientos del ejercicio en Capital Social (3.1) y en
  -- cuentas excluidas, cada uno reexpresado por su propio mes hasta el
  -- cierre. HABER en 3.1 (aporte) o HABER en excluida (venta) => negativo.
  -- DEBE en 3.1 (retiro) o DEBE en excluida (compra) => positivo.
  WITH movimientos AS (
    SELECT (ai.debe - ai.haber) AS monto, date_trunc('month', ac.fecha)::date AS mes
    FROM public.asientos_items ai
    JOIN public.asientos_contables ac ON ac.id = ai.asiento_id
    JOIN public.plan_cuentas pc ON pc.id = ai.cuenta_id
    WHERE ac.empresa_id = p_empresa_id AND ac.estado = 'confirmado'
      AND ac.fecha BETWEEN p_fecha_inicio AND p_fecha_cierre
      AND (pc.codigo = '3.1' OR (pc.tipo = 'activo' AND pc.excluido_ajuste_impositivo))
  ),
  con_indice AS (
    SELECT m.*, ii.indice AS indice_mes
    FROM movimientos m
    LEFT JOIN public.indices_inflacion ii ON ii.empresa_id = p_empresa_id AND ii.periodo = m.mes
  )
  SELECT
    COALESCE(SUM(CASE WHEN indice_mes IS NULL THEN monto ELSE monto * (v_indice_cierre / indice_mes) END), 0),
    jsonb_agg(DISTINCT to_char(mes, 'YYYY-MM')) FILTER (WHERE indice_mes IS NULL)
    INTO v_ajuste_dinamico, v_meses_sin_indice
  FROM con_indice;

  RETURN jsonb_build_object(
    'ok', true,
    'activo_computable_inicio', round(v_activo_computable_inicio, 2),
    'pasivo_computable_inicio', round(v_pasivo_computable_inicio, 2),
    'pn_computable_inicio', round(v_pn_computable_inicio, 2),
    'coeficiente_anual', round(v_coef_anual, 6),
    'ajuste_estatico', round(v_ajuste_estatico, 2),
    'ajuste_dinamico', round(v_ajuste_dinamico, 2),
    'ajuste_total', round(v_ajuste_estatico + v_ajuste_dinamico, 2),
    'meses_sin_indice', COALESCE(v_meses_sin_indice, '[]'::jsonb)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.calcular_ajuste_impositivo_ganancias(UUID, DATE, DATE) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.calcular_ajuste_impositivo_ganancias(UUID, DATE, DATE) FROM PUBLIC, anon;
