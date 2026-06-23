-- ════════════════════════════════════════════════════════════════════════════
-- migration 074 — Hallazgo de PLAN_AUDITORIA_2.md sección 1
-- fecha_en_periodo_cerrado: agregar guard de tenant
-- ════════════════════════════════════════════════════════════════════════════
--
-- Problema (confirmado con BEGIN...ROLLBACK en sesión 53):
--   La función recibía p_empresa_id pero NO verificaba que fuera la del
--   usuario autenticado. Cualquier usuario podía consultar si una fecha
--   estaba en un período cerrado de CUALQUIER empresa, leakeando info
--   del calendario contable cross-tenant.
--
-- Severidad: muy baja (read-only bool, info de calendario), pero rompe
-- consistencia con el patrón de guard del resto del sistema.
--
-- Fix: agregar guard de tenant. Se convierte de SQL STABLE a PLPGSQL para
-- poder usar RAISE EXCEPTION (mismo patrón que insertar_movimiento_bancario_externo).

CREATE OR REPLACE FUNCTION public.fecha_en_periodo_cerrado(
  p_empresa_id UUID,
  p_fecha      DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.periodos_contables
    WHERE empresa_id = p_empresa_id
      AND estado     = 'cerrado'
      AND p_fecha    BETWEEN fecha_inicio AND fecha_cierre
  );
END;
$$;

-- ROLLBACK (comentado): volver a la versión SQL sin guard
-- CREATE OR REPLACE FUNCTION public.fecha_en_periodo_cerrado(p_empresa_id uuid, p_fecha date)
-- RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $$
--   SELECT EXISTS (SELECT 1 FROM public.periodos_contables
--     WHERE empresa_id = p_empresa_id AND estado = 'cerrado'
--       AND p_fecha BETWEEN fecha_inicio AND fecha_cierre);
-- $$;
