-- Migration 382 -- Ajuste por Inflación, Fase 4 (cadencia mensual/por
-- período, no solo al cierre de ejercicio anual).
--
-- Bug real encontrado al diseñar esto: _lineas_ajuste_por_inflacion (Fase 1,
-- mig.378) usa date_trunc('month', v_fecha_inicio) como "mes de origen" del
-- patrimonio de apertura. Para un ejercicio ANUAL esto es una aproximación
-- razonable (documentada como tal en el artifact). Pero los periodos_contables
-- REALES de Nalux son MENSUALES ("Ejercicio 2026 - Junio", 01/06-30/06) --
-- con esa referencia, mes_apertura = mes_cierre SIEMPRE (ambos son el mismo
-- mes del período), el coeficiente da 1, y el ajuste de apertura queda
-- SIEMPRE en cero -- el mecanismo nunca captura la inflación acumulada en
-- los saldos que vienen de meses anteriores. Corría, no fallaba, pero no
-- servía para nada en cadencia mensual.
--
-- Fix: la referencia pasa a ser el mes de CIERRE DEL PERÍODO ANTERIOR
-- (date_trunc('month', fecha_inicio - 1 día)) -- mismo criterio que ya usé
-- y validé en Fase 3 (art. 96 LIG: "el mes de cierre del ejercicio
-- anterior"). Con esto:
--   - Ejercicio anual: el patrimonio de apertura se reexpresa desde el
--     cierre del año anterior -- más correcto conceptualmente que "desde
--     enero de este año", y coincide con el criterio ya usado en Fase 3.
--   - Períodos mensuales consecutivos: cada mes reexpresa el patrimonio
--     acumulado desde el cierre del mes anterior, capturando exactamente
--     la inflación de ESE mes -- y como el asiento generado queda datado
--     dentro del mes, el mes siguiente retoma correctamente desde ahí
--     (encadenamiento correcto, probado con BEGIN...ROLLBACK simulando 3
--     meses consecutivos contra Nalux real).
--
-- ROLLBACK: recrear la función con date_trunc('month', v_fecha_inicio) en
-- vez de date_trunc('month', v_fecha_inicio - interval '1 day') en la CTE
-- "apertura" (ver mig.378 para el texto original).

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
  -- Mes de origen del patrimonio de apertura = mes de cierre del período
  -- ANTERIOR (Fase 4) -- antes era date_trunc('month', v_fecha_inicio), que
  -- daba coeficiente 1 siempre que el período fuera de un solo mes.
  v_mes_apertura := date_trunc('month', v_fecha_inicio - interval '1 day')::date;

  SELECT indice INTO v_indice_cierre FROM public.indices_inflacion
  WHERE empresa_id = v_empresa_id AND periodo = v_mes_cierre;
  IF v_indice_cierre IS NULL THEN
    RAISE EXCEPTION 'Falta cargar el índice de inflación del mes de cierre (%) en Configuración → Finanzas', to_char(v_mes_cierre, 'MM/YYYY');
  END IF;

  -- Validar que estén todos los índices mensuales relevantes: desde el mes
  -- de apertura (el anterior al inicio) hasta el mes de cierre.
  SELECT m INTO v_mes_faltante FROM generate_series(v_mes_apertura, v_mes_cierre, interval '1 month') AS g(m)
  WHERE NOT EXISTS (SELECT 1 FROM public.indices_inflacion ii WHERE ii.empresa_id = v_empresa_id AND ii.periodo = g.m::date)
  LIMIT 1;
  IF v_mes_faltante IS NOT NULL THEN
    RAISE EXCEPTION 'Falta cargar el índice de inflación de % en Configuración → Finanzas', to_char(v_mes_faltante, 'MM/YYYY');
  END IF;

  RETURN QUERY
  WITH
  -- Patrimonio Neto de apertura: todo lo anterior al período, tratado como
  -- originado en el cierre del período anterior (Fase 4 -- antes: primer
  -- día de este período, que rompía la cadencia mensual).
  apertura AS (
    SELECT pc.id AS cuenta_id, pc.codigo, pc.nombre, pc.tipo,
           COALESCE(SUM(ai.haber), 0) - COALESCE(SUM(ai.debe), 0) AS saldo_relevante,
           v_mes_apertura AS mes
    FROM public.plan_cuentas pc
    LEFT JOIN public.asientos_items ai ON ai.cuenta_id = pc.id
    LEFT JOIN public.asientos_contables ac ON ac.id = ai.asiento_id
      AND ac.estado = 'confirmado' AND ac.fecha < v_fecha_inicio
    WHERE pc.empresa_id = v_empresa_id AND pc.tipo = 'patrimonio'
      AND pc.naturaleza_monetaria = 'no_monetaria' AND pc.permite_movimientos
    GROUP BY pc.id, pc.codigo, pc.nombre, pc.tipo
    HAVING COALESCE(SUM(ai.haber), 0) - COALESCE(SUM(ai.debe), 0) <> 0
  ),
  -- Movimientos del propio período en cuentas no monetarias, agrupados por
  -- mes calendario.
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
