-- Migration 401 -- Ajuste por Inflación: fix del saldo de apertura + Memoria de cálculo.
--
-- 1) FIX en `_lineas_ajuste_por_inflacion` (mig.378, ajustada en mig.385/386).
--    La CTE `apertura` (saldo de las cuentas de PATRIMONIO NETO no monetarias al
--    inicio del período) hacía
--        FROM plan_cuentas pc
--        LEFT JOIN asientos_items ai      ON ai.cuenta_id = pc.id
--        LEFT JOIN asientos_contables ac  ON ac.id = ai.asiento_id
--                                        AND ac.estado = 'confirmado' AND ac.fecha < v_fecha_inicio
--    y después sumaba `ai.haber`/`ai.debe`. Como los filtros de estado y de fecha
--    están en el ON de un LEFT JOIN, NO sacan filas de `asientos_items`: el saldo
--    de apertura terminaba siendo el saldo de la cuenta de TODA la historia
--    (movimientos posteriores al inicio del período y asientos no confirmados
--    incluidos). Comprobado con datos reales de Nalux (24/09): la cuenta 3.2
--    Resultados Acumulados tiene un único movimiento de $230.000 del 07/07/2026
--    (asiento de apertura) y aun así el ajuste de Junio (que empieza el 01/06)
--    la tomaba como saldo inicial y proponía $4.340,34 de ajuste; el de Julio
--    $4.862,14. Lo correcto en los dos casos es $0 (no había saldo de apertura).
--    Ningún período de ninguna empresa tiene todavía un ajuste generado
--    (periodos_contables.asiento_ajuste_inflacion_id IS NULL en todos), así que
--    corregirlo no cambia ningún asiento ya posteado.
--    Fix: JOIN (inner) en vez de LEFT JOIN — las cuentas sin movimientos
--    anteriores al período no tienen filas y de todos modos el HAVING descartaba
--    saldo 0. El resto de la función queda idéntico.
--    (`calcular_reexpresion_moneda_homogenea` y
--    `calcular_ajuste_impositivo_ganancias` ya usan JOIN con los filtros en el
--    WHERE: no tenían este problema.)
--
-- 2) NUEVA `memoria_calculo_ajuste_por_inflacion(p_periodo_id)` -- solo lectura.
--    "Papel de trabajo" del ajuste: el detalle cuenta por cuenta y mes por mes
--    (saldo, índice del mes, coeficiente, saldo reexpresado, ajuste) que
--    `_lineas_ajuste_por_inflacion` agrega antes de devolver, más las líneas y el
--    RECPAM oficiales (los mismos que va a postear generar_ajuste_por_inflacion)
--    y un control que compara la suma del detalle contra esas líneas. Valida
--    empresa y levanta el mismo error claro por índices faltantes que el ajuste
--    real (porque arranca llamando a calcular_preview_ajuste_por_inflacion).
--
-- ROLLBACK: CREATE OR REPLACE de `_lineas_ajuste_por_inflacion` con los dos JOIN
-- de `apertura` como LEFT JOIN (mig.385/386) y DROP FUNCTION de
-- `memoria_calculo_ajuste_por_inflacion(uuid)`.

CREATE OR REPLACE FUNCTION public._lineas_ajuste_por_inflacion(p_periodo_id uuid)
 RETURNS TABLE(cuenta_id uuid, codigo text, nombre text, tipo text, monto_ajuste numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id    UUID;
  v_fecha_inicio  DATE;
  v_fecha_cierre  DATE;
  v_mes_cierre    DATE;
  v_mes_apertura  DATE;
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
  v_mes_apertura := date_trunc('month', v_fecha_inicio - interval '1 day')::date;

  SELECT indice INTO v_indice_cierre FROM public.indices_inflacion
  WHERE empresa_id = v_empresa_id AND periodo = v_mes_cierre;
  IF v_indice_cierre IS NULL THEN
    RAISE EXCEPTION 'Falta cargar el índice de inflación del mes de cierre (%) en Configuración → Finanzas', to_char(v_mes_cierre, 'MM/YYYY');
  END IF;

  SELECT m INTO v_mes_faltante FROM generate_series(v_mes_apertura, v_mes_cierre, interval '1 month') AS g(m)
  WHERE NOT EXISTS (SELECT 1 FROM public.indices_inflacion ii WHERE ii.empresa_id = v_empresa_id AND ii.periodo = g.m::date)
  LIMIT 1;
  IF v_mes_faltante IS NOT NULL THEN
    RAISE EXCEPTION 'Falta cargar el índice de inflación de % en Configuración → Finanzas', to_char(v_mes_faltante, 'MM/YYYY');
  END IF;

  RETURN QUERY
  WITH
  apertura AS (
    SELECT pc.id AS cuenta_id, pc.codigo, pc.nombre, pc.tipo,
           COALESCE(SUM(ai.haber), 0) - COALESCE(SUM(ai.debe), 0) AS saldo_relevante,
           v_mes_apertura AS mes
    FROM public.plan_cuentas pc
    JOIN public.asientos_items ai ON ai.cuenta_id = pc.id
    JOIN public.asientos_contables ac ON ac.id = ai.asiento_id
      AND ac.estado = 'confirmado' AND ac.fecha < v_fecha_inicio
    WHERE pc.empresa_id = v_empresa_id AND pc.tipo = 'patrimonio'
      AND pc.naturaleza_monetaria = 'no_monetaria' AND pc.permite_movimientos
    GROUP BY pc.id, pc.codigo, pc.nombre, pc.tipo
    HAVING COALESCE(SUM(ai.haber), 0) - COALESCE(SUM(ai.debe), 0) <> 0
  ),
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

-- Sigue siendo helper interno (mig.379): CREATE OR REPLACE conserva los permisos,
-- se repite el REVOKE por las dudas.
REVOKE EXECUTE ON FUNCTION public._lineas_ajuste_por_inflacion(UUID) FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.memoria_calculo_ajuste_por_inflacion(p_periodo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id    UUID := get_my_empresa_id();
  v_periodo       RECORD;
  v_mes_cierre    DATE;
  v_mes_apertura  DATE;
  v_indice_cierre NUMERIC;
  v_preview       JSONB;
  v_detalle       JSONB;
  v_suma_detalle  NUMERIC;
  v_suma_lineas   NUMERIC;
  v_asiento       JSONB := NULL;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT id, empresa_id, nombre, fecha_inicio, fecha_cierre, estado, asiento_ajuste_inflacion_id
    INTO v_periodo
  FROM public.periodos_contables WHERE id = p_periodo_id;

  IF v_periodo.id IS NULL OR v_periodo.empresa_id IS DISTINCT FROM v_empresa_id THEN
    RAISE EXCEPTION 'No autorizado: el período no pertenece a tu empresa';
  END IF;

  -- Levanta el mismo error claro por índices faltantes que el ajuste real y trae
  -- las líneas + el RECPAM OFICIALES (los que postea generar_ajuste_por_inflacion).
  v_preview := public.calcular_preview_ajuste_por_inflacion(p_periodo_id);

  v_mes_cierre := date_trunc('month', v_periodo.fecha_cierre)::date;
  v_mes_apertura := date_trunc('month', v_periodo.fecha_inicio - interval '1 day')::date;

  SELECT indice INTO v_indice_cierre FROM public.indices_inflacion
  WHERE empresa_id = v_empresa_id AND periodo = v_mes_cierre;

  WITH
  apertura AS (
    SELECT pc.id AS cuenta_id, pc.codigo, pc.nombre, pc.tipo,
           COALESCE(SUM(ai.haber), 0) - COALESCE(SUM(ai.debe), 0) AS saldo_relevante,
           v_mes_apertura AS mes, 'apertura'::text AS origen
    FROM public.plan_cuentas pc
    JOIN public.asientos_items ai ON ai.cuenta_id = pc.id
    JOIN public.asientos_contables ac ON ac.id = ai.asiento_id
      AND ac.estado = 'confirmado' AND ac.fecha < v_periodo.fecha_inicio
    WHERE pc.empresa_id = v_empresa_id AND pc.tipo = 'patrimonio'
      AND pc.naturaleza_monetaria = 'no_monetaria' AND pc.permite_movimientos
    GROUP BY pc.id, pc.codigo, pc.nombre, pc.tipo
    HAVING COALESCE(SUM(ai.haber), 0) - COALESCE(SUM(ai.debe), 0) <> 0
  ),
  movimientos AS (
    SELECT pc.id AS cuenta_id, pc.codigo, pc.nombre, pc.tipo,
           CASE WHEN pc.tipo IN ('activo', 'egreso')
                THEN COALESCE(SUM(ai.debe), 0) - COALESCE(SUM(ai.haber), 0)
                ELSE COALESCE(SUM(ai.haber), 0) - COALESCE(SUM(ai.debe), 0)
           END AS saldo_relevante,
           date_trunc('month', ac.fecha)::date AS mes, 'movimiento'::text AS origen
    FROM public.asientos_items ai
    JOIN public.asientos_contables ac ON ac.id = ai.asiento_id
    JOIN public.plan_cuentas pc ON pc.id = ai.cuenta_id
    WHERE ac.empresa_id = v_empresa_id AND ac.estado = 'confirmado'
      AND ac.fecha BETWEEN v_periodo.fecha_inicio AND v_periodo.fecha_cierre
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
  detalle AS (
    SELECT t.codigo, t.nombre, t.tipo, t.origen, t.mes, t.saldo_relevante,
           ii.indice,
           v_indice_cierre / ii.indice AS coeficiente,
           t.saldo_relevante * (v_indice_cierre / ii.indice) AS saldo_reexpresado,
           t.saldo_relevante * ((v_indice_cierre / ii.indice) - 1) AS ajuste
    FROM todas t
    JOIN public.indices_inflacion ii ON ii.empresa_id = v_empresa_id AND ii.periodo = t.mes
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'codigo', d.codigo, 'nombre', d.nombre, 'tipo', d.tipo,
      'origen', d.origen, 'mes', d.mes,
      'saldo', round(d.saldo_relevante, 2),
      'indice', d.indice,
      'coeficiente', round(d.coeficiente, 6),
      'saldo_reexpresado', round(d.saldo_reexpresado, 2),
      'ajuste', round(d.ajuste, 2)
    ) ORDER BY d.codigo, d.mes), '[]'::jsonb),
    COALESCE(SUM(d.ajuste), 0)
  INTO v_detalle, v_suma_detalle
  FROM detalle d;

  SELECT COALESCE(SUM(l.monto_ajuste), 0) INTO v_suma_lineas
  FROM public._lineas_ajuste_por_inflacion(p_periodo_id) l;

  IF v_periodo.asiento_ajuste_inflacion_id IS NOT NULL THEN
    SELECT jsonb_build_object('id', ac.id, 'numero', ac.numero, 'fecha', ac.fecha)
      INTO v_asiento
    FROM public.asientos_contables ac
    WHERE ac.id = v_periodo.asiento_ajuste_inflacion_id AND ac.empresa_id = v_empresa_id;
  END IF;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object(
      'id', v_periodo.id, 'nombre', v_periodo.nombre,
      'fecha_inicio', v_periodo.fecha_inicio, 'fecha_cierre', v_periodo.fecha_cierre,
      'estado', v_periodo.estado
    ),
    'indice_cierre', jsonb_build_object('mes', v_mes_cierre, 'indice', v_indice_cierre),
    'detalle', v_detalle,
    'lineas', v_preview -> 'lineas',
    'recpam_ganancia', v_preview -> 'recpam_ganancia',
    'recpam_perdida', v_preview -> 'recpam_perdida',
    'recpam_neto', v_preview -> 'recpam_neto',
    'asiento', v_asiento,
    -- Control: la suma del detalle tiene que coincidir con las líneas oficiales
    -- (las cuentas con ajuste redondeado a $0 quedan fuera de las líneas, por eso
    -- se tolera una diferencia de centavos).
    'control', jsonb_build_object(
      'suma_detalle', round(v_suma_detalle, 2),
      'suma_lineas', round(v_suma_lineas, 2),
      'diferencia', round(v_suma_detalle - v_suma_lineas, 2)
    )
  );
END;
$function$;

-- Función nueva: Postgres da EXECUTE a PUBLIC/anon por default (ver mig.379).
REVOKE EXECUTE ON FUNCTION public.memoria_calculo_ajuste_por_inflacion(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.memoria_calculo_ajuste_por_inflacion(UUID) TO authenticated;
