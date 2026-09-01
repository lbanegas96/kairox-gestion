-- Migration 378 -- Ajuste por Inflación, Fase 1 (RT 6, método indirecto por
-- partida doble). Diseño completo en PLAN_AJUSTE_POR_INFLACION.md — construido
-- SIN validación de un contador matriculado (Nalux no tiene uno disponible),
-- con la mejor evidencia pública citada en el artifact "Circuito de Ajuste
-- por Inflación". Las 4 decisiones donde la norma deja margen (patrimonio de
-- apertura del primer ejercicio, tratamiento de Inventario, granularidad
-- mensual, IPC vs IPIM) quedan documentadas ahí para corregir si alguien
-- las revisa después.
--
-- Método: cada rubro NO monetario (Bienes de Uso, Inventario, Patrimonio
-- Neto, Ingresos, Egresos) se reexpresa por su coeficiente (índice de cierre
-- / índice de origen) y se asienta contra una cuenta transitoria de RECPAM.
-- El RECPAM sale solo -- es lo que hace falta para que el asiento cierre.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.generar_ajuste_por_inflacion(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.calcular_preview_ajuste_por_inflacion(uuid);
--   DROP FUNCTION IF EXISTS public._lineas_ajuste_por_inflacion(uuid);
--   ALTER TABLE public.periodos_contables DROP COLUMN IF EXISTS asiento_ajuste_inflacion_id;
--   DROP TABLE IF EXISTS public.indices_inflacion;
--   DELETE FROM public.plan_cuentas WHERE codigo IN ('4.7', '5.12');
--   ALTER TABLE public.plan_cuentas DROP COLUMN IF EXISTS naturaleza_monetaria;

-- ═══════════════════════════════════════════════════════════════════════
-- 1) Maestro: plan_cuentas.naturaleza_monetaria
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.plan_cuentas
  ADD COLUMN IF NOT EXISTS naturaleza_monetaria TEXT NOT NULL DEFAULT 'no_monetaria'
    CHECK (naturaleza_monetaria IN ('monetaria', 'no_monetaria'));

COMMENT ON COLUMN public.plan_cuentas.naturaleza_monetaria IS
  'RT 6 -- monetaria: ya expresada en pesos de hoy (Caja, CxC, CxP, deudas), no se reexpresa. '
  'no_monetaria: arrastra el poder adquisitivo de su fecha de origen (Bienes de Uso, Inventario, '
  'Patrimonio, Ingresos, Egresos) -- se reexpresa y genera RECPAM.';

-- Backfill: todo lo que ya es 'pasivo' es monetario (deudas en pesos nominales).
-- Dentro de 'activo', solo el activo financiero/corriente es monetario -- el
-- resto (Inventario, Bienes de Uso, Intangibles) queda con el default
-- 'no_monetaria'. Aplica a TODAS las empresas por igual, mismo criterio que
-- usa Xubio (fuente #2 del artifact).
UPDATE public.plan_cuentas SET naturaleza_monetaria = 'monetaria' WHERE tipo = 'pasivo';
UPDATE public.plan_cuentas SET naturaleza_monetaria = 'monetaria'
  WHERE tipo = 'activo' AND codigo IN ('1.1.1', '1.1.2', '1.1.4', '1.1.5', '1.1.6', '1.1.7', '1.1.8');

-- ═══════════════════════════════════════════════════════════════════════
-- 2) Cuentas RECPAM -- dedicadas, mismo criterio que Diferencias de
--    Inventario/Revalorización (una cuenta de ganancia, una de pérdida).
--    naturaleza_monetaria = 'monetaria' a propósito: el propio RECPAM no debe
--    volver a reexpresarse en ejercicios futuros.
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos, naturaleza_monetaria)
SELECT empresa_id, '4.7', 'Resultado por Exposición a la Inflación (RECPAM Ganancia)', 'ingreso', 2, true, 'monetaria'
FROM public.plan_cuentas WHERE codigo = '4'
ON CONFLICT (empresa_id, codigo) DO NOTHING;

INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos, naturaleza_monetaria)
SELECT empresa_id, '5.12', 'Resultado por Exposición a la Inflación (RECPAM Pérdida)', 'egreso', 2, true, 'monetaria'
FROM public.plan_cuentas WHERE codigo = '5'
ON CONFLICT (empresa_id, codigo) DO NOTHING;

-- Mismo alta para empresas nuevas futuras.
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

  -- Cuentas financieras y todo el pasivo nacen 'monetaria' -- mismo criterio
  -- que el backfill de arriba, para que una empresa nueva no dependa de un
  -- segundo paso manual.
  UPDATE plan_cuentas SET naturaleza_monetaria = 'monetaria'
    WHERE empresa_id = p_empresa_id AND tipo = 'pasivo';
  UPDATE plan_cuentas SET naturaleza_monetaria = 'monetaria'
    WHERE empresa_id = p_empresa_id AND tipo = 'activo'
      AND codigo IN ('1.1.1', '1.1.2', '1.1.4', '1.1.5', '1.1.6', '1.1.7', '1.1.8');
  UPDATE plan_cuentas SET naturaleza_monetaria = 'monetaria'
    WHERE empresa_id = p_empresa_id AND codigo IN ('4.7', '5.12');
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════
-- 3) Configuración: índice de inflación por mes (mismo patrón que
--    tipos_cambio -- un coeficiente que varía por fecha, carga manual).
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.indices_inflacion (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  periodo     DATE NOT NULL,              -- primer día del mes (ej. 2026-01-01)
  indice      NUMERIC(14, 4) NOT NULL CHECK (indice > 0),
  origen      TEXT NOT NULL DEFAULT 'manual',  -- FACPCE no publica API oficial -- carga manual
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (empresa_id, periodo)
);

ALTER TABLE public.indices_inflacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "indices_inflacion_all" ON public.indices_inflacion
  FOR ALL USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

COMMENT ON TABLE public.indices_inflacion IS
  'Índice IPC mensual (en reemplazo del IPIM discontinuado por INDEC en 2016, '
  'criterio FACPCE desde 2018) para el coeficiente de reexpresión = índice cierre / índice origen.';

-- ═══════════════════════════════════════════════════════════════════════
-- 4) Punto de enganche en Cierre de Ejercicio
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.periodos_contables
  ADD COLUMN IF NOT EXISTS asiento_ajuste_inflacion_id UUID REFERENCES public.asientos_contables(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 5) Cálculo -- función interna compartida por preview y generación real.
--    Devuelve una línea consolidada por cuenta afectada (positivo = hay que
--    reexpresarla hacia arriba, nunca da negativo en un contexto
--    inflacionario monotónico, pero el signo se respeta igual por robustez).
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._lineas_ajuste_por_inflacion(p_periodo_id UUID)
RETURNS TABLE (cuenta_id UUID, codigo TEXT, nombre TEXT, tipo TEXT, monto_ajuste NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id    UUID;
  v_fecha_inicio  DATE;
  v_fecha_cierre  DATE;
  v_mes_cierre    DATE;
  v_indice_cierre NUMERIC;
  v_mes_faltante  DATE;
BEGIN
  SELECT empresa_id, fecha_inicio, fecha_cierre
    INTO v_empresa_id, v_fecha_inicio, v_fecha_cierre
  FROM public.periodos_contables WHERE id = p_periodo_id;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Período no encontrado';
  END IF;

  v_mes_cierre := date_trunc('month', v_fecha_cierre)::date;

  SELECT indice INTO v_indice_cierre FROM public.indices_inflacion
  WHERE empresa_id = v_empresa_id AND periodo = v_mes_cierre;
  IF v_indice_cierre IS NULL THEN
    RAISE EXCEPTION 'Falta cargar el índice de inflación del mes de cierre (%) en Configuración → Finanzas', to_char(v_mes_cierre, 'MM/YYYY');
  END IF;

  -- Validar que estén todos los índices mensuales del ejercicio antes de calcular nada.
  SELECT m INTO v_mes_faltante FROM generate_series(date_trunc('month', v_fecha_inicio)::date, v_mes_cierre, interval '1 month') AS g(m)
  WHERE NOT EXISTS (SELECT 1 FROM public.indices_inflacion ii WHERE ii.empresa_id = v_empresa_id AND ii.periodo = g.m::date)
  LIMIT 1;
  IF v_mes_faltante IS NOT NULL THEN
    RAISE EXCEPTION 'Falta cargar el índice de inflación de % en Configuración → Finanzas', to_char(v_mes_faltante, 'MM/YYYY');
  END IF;

  RETURN QUERY
  WITH
  -- Patrimonio Neto de apertura: todo lo anterior al período tratado como
  -- originado el primer día del período (decisión documentada en el
  -- artifact -- KAIROX no tiene el historial real de cada aporte).
  apertura AS (
    SELECT pc.id AS cuenta_id, pc.codigo, pc.nombre, pc.tipo,
           COALESCE(SUM(ai.haber), 0) - COALESCE(SUM(ai.debe), 0) AS saldo_relevante,
           date_trunc('month', v_fecha_inicio)::date AS mes
    FROM public.plan_cuentas pc
    LEFT JOIN public.asientos_items ai ON ai.cuenta_id = pc.id
    LEFT JOIN public.asientos_contables ac ON ac.id = ai.asiento_id
      AND ac.estado = 'confirmado' AND ac.fecha < v_fecha_inicio
    WHERE pc.empresa_id = v_empresa_id AND pc.tipo = 'patrimonio'
      AND pc.naturaleza_monetaria = 'no_monetaria' AND pc.permite_movimientos
    GROUP BY pc.id, pc.codigo, pc.nombre, pc.tipo
    HAVING COALESCE(SUM(ai.haber), 0) - COALESCE(SUM(ai.debe), 0) <> 0
  ),
  -- Movimientos del propio ejercicio en cuentas no monetarias, agrupados por
  -- mes calendario (granularidad documentada en el artifact, §7 punto 3).
  movimientos AS (
    SELECT pc.id AS cuenta_id, pc.codigo, pc.nombre, pc.tipo,
           CASE WHEN pc.tipo IN ('activo', 'egreso')
                THEN COALESCE(SUM(ai.debe), 0) - COALESCE(SUM(ai.haber), 0)
                ELSE COALESCE(SUM(ai.haber), 0) - COALESCE(SUM(ai.debe), 0)
           END AS saldo_relevante,
           date_trunc('month', ac.fecha)::date AS mes
    FROM public.asientos_items ai
    JOIN public.asientos_contables ac ON ac.id = ai.asiento_id
    JOIN public.plan_cuentas pc ON pc.id = ai.cuenta_id
    WHERE ac.empresa_id = v_empresa_id AND ac.estado = 'confirmado'
      AND ac.fecha BETWEEN v_fecha_inicio AND v_fecha_cierre
      AND pc.naturaleza_monetaria = 'no_monetaria'
    GROUP BY pc.id, pc.codigo, pc.nombre, pc.tipo, date_trunc('month', ac.fecha)
    HAVING CASE WHEN pc.tipo IN ('activo', 'egreso')
                THEN COALESCE(SUM(ai.debe), 0) - COALESCE(SUM(ai.haber), 0)
                ELSE COALESCE(SUM(ai.haber), 0) - COALESCE(SUM(ai.debe), 0)
           END <> 0
  ),
  todas AS (
    SELECT * FROM apertura
    UNION ALL
    SELECT * FROM movimientos
  ),
  con_coeficiente AS (
    SELECT t.cuenta_id, t.codigo, t.nombre, t.tipo,
           t.saldo_relevante * ((v_indice_cierre / ii.indice) - 1) AS ajuste
    FROM todas t
    JOIN public.indices_inflacion ii ON ii.empresa_id = v_empresa_id AND ii.periodo = t.mes
  )
  SELECT c.cuenta_id, c.codigo::text, c.nombre::text, c.tipo::text, SUM(c.ajuste) AS monto_ajuste
  FROM con_coeficiente c
  GROUP BY c.cuenta_id, c.codigo, c.nombre, c.tipo
  HAVING round(SUM(c.ajuste), 2) <> 0
  ORDER BY c.codigo;
END;
$function$;

GRANT EXECUTE ON FUNCTION public._lineas_ajuste_por_inflacion(UUID) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6) Preview -- mismo cálculo, sin generar nada. El frontend lo muestra
--    antes de que el usuario confirme (mismo patrón que Recuento/Revalorización).
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.calcular_preview_ajuste_por_inflacion(p_periodo_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id UUID := get_my_empresa_id();
  v_periodo_empresa UUID;
  v_lineas JSONB;
  v_total_ganancia NUMERIC := 0;
  v_total_perdida NUMERIC := 0;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT empresa_id INTO v_periodo_empresa FROM public.periodos_contables WHERE id = p_periodo_id;
  IF v_periodo_empresa IS DISTINCT FROM v_empresa_id THEN
    RAISE EXCEPTION 'No autorizado: el período no pertenece a tu empresa';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'cuenta_id', l.cuenta_id, 'codigo', l.codigo, 'nombre', l.nombre,
           'tipo', l.tipo, 'monto_ajuste', round(l.monto_ajuste, 2)
         ) ORDER BY l.codigo),
         COALESCE(SUM(CASE WHEN l.tipo IN ('activo', 'egreso') AND l.monto_ajuste > 0 THEN l.monto_ajuste
                            WHEN l.tipo NOT IN ('activo', 'egreso') AND l.monto_ajuste < 0 THEN -l.monto_ajuste
                            ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN l.tipo NOT IN ('activo', 'egreso') AND l.monto_ajuste > 0 THEN l.monto_ajuste
                            WHEN l.tipo IN ('activo', 'egreso') AND l.monto_ajuste < 0 THEN -l.monto_ajuste
                            ELSE 0 END), 0)
    INTO v_lineas, v_total_ganancia, v_total_perdida
  FROM public._lineas_ajuste_por_inflacion(p_periodo_id) l;

  RETURN jsonb_build_object(
    'lineas', COALESCE(v_lineas, '[]'::jsonb),
    'recpam_ganancia', v_total_ganancia,
    'recpam_perdida', v_total_perdida,
    'recpam_neto', v_total_ganancia - v_total_perdida
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.calcular_preview_ajuste_por_inflacion(UUID) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 7) Generación real -- un solo asiento, mismas validaciones que
--    crear_asiento_automatico (reutilizada acá para no duplicar el chequeo
--    de cuadre ni el de período cerrado).
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.generar_ajuste_por_inflacion(p_periodo_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id       UUID;
  v_nombre           TEXT;
  v_fecha_cierre     DATE;
  v_asiento_ajuste_id UUID;
  v_cta_ganancia     UUID;
  v_cta_perdida      UUID;
  v_items            JSONB := '[]'::jsonb;
  v_linea            RECORD;
  v_resultado        JSONB;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado: el ajuste por inflación requiere rol admin';
  END IF;

  SELECT empresa_id, nombre, fecha_cierre, asiento_ajuste_inflacion_id
    INTO v_empresa_id, v_nombre, v_fecha_cierre, v_asiento_ajuste_id
  FROM public.periodos_contables WHERE id = p_periodo_id FOR UPDATE;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Período no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el período no pertenece a tu empresa';
  END IF;
  IF v_asiento_ajuste_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este período ya tiene un ajuste por inflación generado';
  END IF;

  SELECT id INTO v_cta_ganancia FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '4.7' AND activa LIMIT 1;
  SELECT id INTO v_cta_perdida  FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '5.12' AND activa LIMIT 1;
  IF v_cta_ganancia IS NULL OR v_cta_perdida IS NULL THEN
    RAISE EXCEPTION 'Faltan las cuentas 4.7/5.12 (RECPAM) en el plan de cuentas';
  END IF;

  FOR v_linea IN SELECT * FROM public._lineas_ajuste_por_inflacion(p_periodo_id) LOOP
    IF (v_linea.tipo IN ('activo', 'egreso')) = (v_linea.monto_ajuste > 0) THEN
      -- Activo/Egreso con ajuste positivo, o Patrimonio/Pasivo/Ingreso con
      -- ajuste negativo (caso raro, índice bajó): DEBE la cuenta / HABER ganancia.
      v_items := v_items || jsonb_build_object('cuenta_id', v_linea.cuenta_id, 'descripcion',
        'Ajuste por inflación — ' || v_nombre, 'debe', round(abs(v_linea.monto_ajuste), 2), 'haber', 0);
      v_items := v_items || jsonb_build_object('cuenta_id', v_cta_ganancia, 'descripcion',
        'Ajuste por inflación — ' || v_nombre, 'debe', 0, 'haber', round(abs(v_linea.monto_ajuste), 2));
    ELSE
      v_items := v_items || jsonb_build_object('cuenta_id', v_cta_perdida, 'descripcion',
        'Ajuste por inflación — ' || v_nombre, 'debe', round(abs(v_linea.monto_ajuste), 2), 'haber', 0);
      v_items := v_items || jsonb_build_object('cuenta_id', v_linea.cuenta_id, 'descripcion',
        'Ajuste por inflación — ' || v_nombre, 'debe', 0, 'haber', round(abs(v_linea.monto_ajuste), 2));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_items) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'asiento_id', NULL, 'mensaje', 'Sin partidas no monetarias con saldo en el ejercicio — no se generó asiento');
  END IF;

  v_resultado := public.crear_asiento_automatico(
    v_empresa_id, p_user_id, v_fecha_cierre,
    'Ajuste por Inflación (RT 6) — ' || v_nombre,
    'ajuste_inflacion', p_periodo_id, NULL, v_items
  );

  UPDATE public.periodos_contables
  SET asiento_ajuste_inflacion_id = (v_resultado->>'id')::uuid
  WHERE id = p_periodo_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_resultado->>'id', 'numero', v_resultado->>'numero');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generar_ajuste_por_inflacion(UUID, UUID) TO authenticated;
