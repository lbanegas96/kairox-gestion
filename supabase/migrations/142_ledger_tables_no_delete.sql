-- ════════════════════════════════════════════════════════════════════════════
-- migration 142 — Auditoria area #13 (extension): mismo patron de la fuga de
-- comprobantes (mig.141) en otras 3 tablas de libro contable
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hallazgo CRITICO (confirmado con BEGIN...ROLLBACK, mismo patron que
-- comprobantes): cuenta_corriente_movimientos, cuenta_corriente_proveedores y
-- notas_debito tenian policies FOR ALL con solo empresa_id, sin gate de
-- permiso y sin distinguir DELETE. Probado: un staff sin ningun permiso
-- especial borro un movimiento de CxC de $10.000, uno de CxP de $10.000 y una
-- ND de $5.000, cada uno con 1 sola llamada DELETE via API. Cero call-sites
-- de .delete() sobre estas 3 tablas en todo el frontend.
--
-- Fix: mismo patron que mig.141 — dividir en SELECT/INSERT/UPDATE, sin
-- policy de DELETE (queda denegado por RLS default).

DROP POLICY IF EXISTS "cta_cte_empresa" ON public.cuenta_corriente_movimientos;
CREATE POLICY "cta_cte_select" ON public.cuenta_corriente_movimientos
  FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "cta_cte_insert" ON public.cuenta_corriente_movimientos
  FOR INSERT WITH CHECK (empresa_id = get_my_empresa_id());
CREATE POLICY "cta_cte_update" ON public.cuenta_corriente_movimientos
  FOR UPDATE USING (empresa_id = get_my_empresa_id()) WITH CHECK (empresa_id = get_my_empresa_id());

DROP POLICY IF EXISTS "ccp_empresa" ON public.cuenta_corriente_proveedores;
CREATE POLICY "ccp_select" ON public.cuenta_corriente_proveedores
  FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "ccp_insert" ON public.cuenta_corriente_proveedores
  FOR INSERT WITH CHECK (empresa_id = get_my_empresa_id());
CREATE POLICY "ccp_update" ON public.cuenta_corriente_proveedores
  FOR UPDATE USING (empresa_id = get_my_empresa_id()) WITH CHECK (empresa_id = get_my_empresa_id());

DROP POLICY IF EXISTS "notas_debito_all" ON public.notas_debito;
CREATE POLICY "notas_debito_select" ON public.notas_debito
  FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "notas_debito_insert" ON public.notas_debito
  FOR INSERT WITH CHECK (empresa_id = get_my_empresa_id());
CREATE POLICY "notas_debito_update" ON public.notas_debito
  FOR UPDATE USING (empresa_id = get_my_empresa_id()) WITH CHECK (empresa_id = get_my_empresa_id());
