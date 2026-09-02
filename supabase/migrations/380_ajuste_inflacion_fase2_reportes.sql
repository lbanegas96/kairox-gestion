-- Migration 380 -- Ajuste por Inflación, Fase 2 (reporte en moneda homogénea).
-- Generaliza el mecanismo de mig.378 (reexpresar cada rubro no monetario por
-- su mes de origen) para uso de SOLO LECTURA en Balance General y Estado de
-- Resultados -- no genera ningún asiento, es puramente de presentación.
--
-- A diferencia de _lineas_ajuste_por_inflacion (Fase 1, atada a un
-- periodo_id/asiento real), esta función toma un rango de fechas libre
-- (el mismo que ya usa TabBalanceGeneral/TabEstadoResultados) y, si falta
-- el índice de algún mes, NO aborta -- devuelve lo que sí puede calcular más
-- la lista de meses sin índice, para que el reporte se pueda mostrar igual
-- con una advertencia (criterio distinto a Fase 1 a propósito: ahí SÍ se
-- bloquea porque genera un asiento contable real).
--
-- ROLLBACK: DROP FUNCTION IF EXISTS public.calcular_reexpresion_moneda_homogenea(uuid, date, date);

CREATE OR REPLACE FUNCTION public.calcular_reexpresion_moneda_homogenea(
  p_empresa_id UUID,
  p_fecha_desde DATE,   -- NULL = todo el historial (uso: Balance General)
  p_fecha_hasta DATE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mes_hasta      DATE;
  v_indice_hasta   NUMERIC;
  v_montos         JSONB;
  v_meses_sin_indice JSONB;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: la empresa no coincide con el usuario autenticado';
  END IF;

  v_mes_hasta := date_trunc('month', p_fecha_hasta)::date;

  SELECT indice INTO v_indice_hasta FROM public.indices_inflacion
  WHERE empresa_id = p_empresa_id AND periodo = v_mes_hasta;

  -- Sin índice del mes de cierre no hay con qué reexpresar nada -- se
  -- devuelve vacío (el frontend muestra el reporte histórico sin el toggle
  -- disponible), no es un error bloqueante.
  IF v_indice_hasta IS NULL THEN
    RETURN jsonb_build_object('montos', '[]'::jsonb, 'meses_sin_indice', jsonb_build_array(to_char(v_mes_hasta, 'YYYY-MM')), 'indice_hasta_faltante', true);
  END IF;

  -- Todo en UN solo statement: una CTE no sobrevive entre dos SELECT
  -- top-level separados (bug real encontrado acá -- con_indice quedaba
  -- "relation does not exist" en el segundo SELECT).
  WITH movimientos AS (
    SELECT pc.id AS cuenta_id, pc.tipo,
           CASE WHEN pc.tipo IN ('activo', 'egreso')
                THEN COALESCE(SUM(ai.debe), 0) - COALESCE(SUM(ai.haber), 0)
                ELSE COALESCE(SUM(ai.haber), 0) - COALESCE(SUM(ai.debe), 0)
           END AS saldo_relevante,
           date_trunc('month', ac.fecha)::date AS mes
    FROM public.asientos_items ai
    JOIN public.asientos_contables ac ON ac.id = ai.asiento_id
    JOIN public.plan_cuentas pc ON pc.id = ai.cuenta_id
    WHERE ac.empresa_id = p_empresa_id AND ac.estado = 'confirmado'
      AND ac.fecha <= p_fecha_hasta
      AND (p_fecha_desde IS NULL OR ac.fecha >= p_fecha_desde)
      AND pc.naturaleza_monetaria = 'no_monetaria'
    GROUP BY pc.id, pc.tipo, date_trunc('month', ac.fecha)
  ),
  con_indice AS (
    SELECT m.*, ii.indice AS indice_mes
    FROM movimientos m
    LEFT JOIN public.indices_inflacion ii ON ii.empresa_id = p_empresa_id AND ii.periodo = m.mes
  ),
  reexpresado AS (
    SELECT cuenta_id,
           -- Sin índice de ese mes: se suma el saldo histórico sin reexpresar
           -- (mejor una cifra parcialmente ajustada y visible que ocultar el
           -- monto entero de esa cuenta).
           SUM(CASE WHEN indice_mes IS NULL THEN saldo_relevante
                     ELSE saldo_relevante * (v_indice_hasta / indice_mes) END) AS monto_homogeneo
    FROM con_indice
    GROUP BY cuenta_id
  )
  SELECT
    (SELECT jsonb_agg(jsonb_build_object('cuenta_id', cuenta_id, 'monto_homogeneo', round(monto_homogeneo, 2))) FROM reexpresado),
    (SELECT jsonb_agg(DISTINCT to_char(mes, 'YYYY-MM')) FROM con_indice WHERE indice_mes IS NULL)
    INTO v_montos, v_meses_sin_indice;

  RETURN jsonb_build_object(
    'montos', COALESCE(v_montos, '[]'::jsonb),
    'meses_sin_indice', COALESCE(v_meses_sin_indice, '[]'::jsonb),
    'indice_hasta_faltante', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.calcular_reexpresion_moneda_homogenea(UUID, DATE, DATE) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.calcular_reexpresion_moneda_homogenea(UUID, DATE, DATE) FROM PUBLIC, anon;
