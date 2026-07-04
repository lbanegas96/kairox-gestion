-- ════════════════════════════════════════════════════════════════════════════
-- migration 141 — Auditoria area #13 (Comprobantes — lifecycle)
-- comprobantes: quitar DELETE de la policy (documentos se anulan, no se borran)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hallazgo CRITICO (confirmado con BEGIN...ROLLBACK): la policy
-- "comprobantes_all" era FOR ALL con solo empresa_id = get_my_empresa_id().
-- Cualquier usuario autenticado del tenant (staff, no solo admin) pudo borrar
-- una factura de $50.000 con un DELETE directo via API — sin pasar por
-- ninguna pantalla del sistema (0 call-sites de delete() sobre comprobantes
-- en todo el frontend, confirmado por grep). Viola el principio contable
-- basico "los documentos se anulan con una Nota de Credito, nunca se borran"
-- (ya aplicado en el resto del sistema: asientos_contables se anulan,
-- movimientos bancarios contabilizados no se pueden borrar — mig.128).
--
-- Fix: separar la policy en SELECT/INSERT/UPDATE (mismo alcance de tenant
-- que antes) y NO otorgar DELETE. Sin policy de DELETE y con RLS enabled,
-- el DELETE queda denegado por default para cualquier rol no-superuser.

DROP POLICY IF EXISTS "comprobantes_all" ON public.comprobantes;

CREATE POLICY "comprobantes_select" ON public.comprobantes
  FOR SELECT USING (empresa_id = get_my_empresa_id());

CREATE POLICY "comprobantes_insert" ON public.comprobantes
  FOR INSERT WITH CHECK (empresa_id = get_my_empresa_id());

CREATE POLICY "comprobantes_update" ON public.comprobantes
  FOR UPDATE USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

-- Explícitamente sin policy de DELETE: queda denegado por RLS default.
