-- Migration 333 -- RPC productos_stock_bajo(empresa_id).
--
-- Contexto (19/08 noche, previo a importar ~3.400 productos de un catálogo
-- kiosco/almacén): dashboardService.getKPIs y productosService.getLowStock
-- traían TODOS los productos activos de la empresa (sin límite) y filtraban
-- "stock_actual <= stock_minimo" del lado del cliente en JS. Con ~300
-- productos eso era barato; con miles de productos multiplica los bytes
-- transferidos en cada carga -- y el Dashboard (que usa este KPI) se ve en
-- CADA login, no es una pantalla ocasional. Mismo patrón de riesgo que el
-- incidente previo de egress con el logo en base64 (ver CONTEXT.md).
--
-- Fix: mover el filtro a SQL server-side -- PostgREST no soporta comparar
-- dos columnas entre sí en un filtro simple (stock_actual <= stock_minimo),
-- así que hace falta una function. SECURITY INVOKER (default) para que siga
-- respetando la RLS existente de productos (productos_select, mig.132) --
-- p_empresa_id es un filtro adicional, no un bypass de RLS.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.productos_stock_bajo(uuid);

CREATE OR REPLACE FUNCTION public.productos_stock_bajo(p_empresa_id uuid)
RETURNS TABLE (
  id            uuid,
  nombre        text,
  stock_actual  integer,
  stock_minimo  integer,
  unidad_medida text
)
LANGUAGE sql
STABLE
AS $$
  SELECT id, nombre, stock_actual, stock_minimo, unidad_medida
  FROM public.productos
  WHERE empresa_id = p_empresa_id
    AND activo = true
    AND stock_actual <= stock_minimo
  ORDER BY nombre;
$$;

GRANT EXECUTE ON FUNCTION public.productos_stock_bajo(uuid) TO authenticated;
