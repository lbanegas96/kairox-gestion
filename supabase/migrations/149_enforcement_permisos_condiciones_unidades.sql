-- migration 149 — Auditoría (área nueva: maestros de Configuración no cubiertos por mig.132)
--
-- Hallazgo: `condiciones_pago` y `unidades_medida` (mig.043) quedaron con la policy
-- original "FOR ALL, solo empresa_id" — el mismo patrón ya identificado y corregido
-- en mig.132 para el resto de las tablas de Configuración (plan_cuentas, listas_precio,
-- determinacion_cuentas_mayor, etc.), pero estas 2 tablas no se incluyeron en ese barrido.
--
-- Probado con BEGIN...ROLLBACK: un staff sin ningún permiso especial pudo (1) insertar
-- una condición de pago falsa ("360 días, 99% descuento") y (2) borrar las 11 unidades
-- de medida reales de su empresa, ambas vía API directa. Ambas tablas son maestros que
-- alimentan cálculos de vencimiento (CxC/CxP) y conversión de stock respectivamente —
-- corromperlas afecta a todos los documentos que las referencian después.
--
-- Fix: mismo patrón que mig.132 — SELECT tenant-only, CUD tenant + has_module_permission
-- ('configuracion'), igual que plan_cuentas/asientos/IVA (ya viven bajo ese módulo en
-- ConfiguracionSection, según convención SAP-style de este proyecto).

DROP POLICY IF EXISTS "condiciones_pago_all" ON public.condiciones_pago;
CREATE POLICY "condiciones_pago_select" ON public.condiciones_pago FOR SELECT
  USING (empresa_id = get_my_empresa_id());
CREATE POLICY "condiciones_pago_cud" ON public.condiciones_pago FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

DROP POLICY IF EXISTS "unidades_medida_all" ON public.unidades_medida;
CREATE POLICY "unidades_medida_select" ON public.unidades_medida FOR SELECT
  USING (empresa_id = get_my_empresa_id());
CREATE POLICY "unidades_medida_cud" ON public.unidades_medida FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));
