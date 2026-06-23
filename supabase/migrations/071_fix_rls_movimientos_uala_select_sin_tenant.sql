-- CRÍTICO (auditoría sesión 52): la policy SELECT de movimientos_uala solo
-- chequeaba auth.role()='authenticated', sin filtrar por empresa_id. Cualquier
-- usuario autenticado de CUALQUIER empresa podía leer los movimientos Ualá de
-- TODAS las empresas (confirmado: MovimientosUala.jsx tampoco filtra por
-- empresa_id en el cliente, depende 100% de RLS). Fuga real de datos
-- financieros cross-tenant, no hipotética — hay datos reales en la tabla
-- (empresa db21dfad-..., 15 filas).
--
-- Fix: agregar el filtro de empresa_id = get_my_empresa_id(), mismo patrón
-- que el resto de las ~50 tablas multi-tenant del sistema.

DROP POLICY IF EXISTS "usuarios autenticados pueden leer" ON public.movimientos_uala;

CREATE POLICY "usuarios autenticados pueden leer su empresa" ON public.movimientos_uala
  FOR SELECT
  TO authenticated
  USING (empresa_id = (select public.get_my_empresa_id()));

-- Rollback (comentado, NO recomendado aplicar — reintroduce la fuga):
-- DROP POLICY IF EXISTS "usuarios autenticados pueden leer su empresa" ON public.movimientos_uala;
-- CREATE POLICY "usuarios autenticados pueden leer" ON public.movimientos_uala
--   USING ((select auth.role()) = 'authenticated'::text);
