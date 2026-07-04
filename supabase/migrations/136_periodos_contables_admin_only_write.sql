-- ════════════════════════════════════════════════════════════════════════════
-- migration 136 — Auditoria area #9 (Periodos contables / Cierre)
-- periodos_contables: INSERT/UPDATE solo admin (era solo-UI, RLS no lo verificaba)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hallazgo (confirmado con BEGIN...ROLLBACK): la UI de PlanCuentasSection.jsx
-- gatea los botones de Crear/Cerrar/Reabrir periodo con `isAdmin`, pero la
-- policy RLS de periodos_contables (migration 027) solo verifica empresa_id,
-- no rol. Un staff no-admin pudo INSERTAR un periodo nuevo y CERRAR periodos
-- existentes via API directa (probado: 2 filas afectadas). Mismo patron que
-- el hallazgo de Usuarios/Permisos (mig.132): control de acceso solo-UI.
--
-- Fix: INSERT/UPDATE ahora requieren is_admin() ademas de empresa_id. SELECT
-- se mantiene tenant-only (staff puede ver el estado de los periodos, solo no
-- puede modificarlos).

DROP POLICY IF EXISTS "periodos_insert" ON public.periodos_contables;
CREATE POLICY "periodos_insert" ON public.periodos_contables
  FOR INSERT WITH CHECK (empresa_id = public.get_my_empresa_id() AND public.is_admin());

DROP POLICY IF EXISTS "periodos_update" ON public.periodos_contables;
CREATE POLICY "periodos_update" ON public.periodos_contables
  FOR UPDATE USING (empresa_id = public.get_my_empresa_id() AND public.is_admin());

NOTIFY pgrst, 'reload schema';
