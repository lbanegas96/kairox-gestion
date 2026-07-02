-- migration 126 — Determinación de Cuenta de Mayor (estilo SAP EBS / OBYC)
--
-- Tabla maestra (Customizing) que define QUÉ cuenta contable del plan de cuentas
-- imputa la CONTRAPARTIDA de cada movimiento bancario, según su clave de
-- determinación. El lado del banco ya sale de cuentas_bancarias.plan_cuenta_id.
--
-- Clave de determinación (de más específica a más genérica), inspirada en las
-- posting rules del Electronic Bank Statement de SAP:
--   (cuenta_bancaria_id?, origen, tipo, subtipo?)  →  cuenta_contable_id
--
-- '*' = comodín (aplica a cualquier valor de esa dimensión). subtipo/cuenta_bancaria_id
-- en NULL = "cualquiera". La resolución elige la regla más específica (ver RPC 127).
--
-- RLS: mismo criterio que `configuracion` (migration 119) — lectura para la empresa,
-- escritura SOLO admin. El motor de asientos corre SECURITY DEFINER (bypassa RLS).
--
-- ROLLBACK: DROP TABLE public.determinacion_cuentas_mayor;

CREATE TABLE IF NOT EXISTS public.determinacion_cuentas_mayor (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  origen              text NOT NULL DEFAULT '*',
  tipo                text NOT NULL DEFAULT '*',
  subtipo             text,
  cuenta_bancaria_id  uuid REFERENCES public.cuentas_bancarias(id) ON DELETE CASCADE,
  cuenta_contable_id  uuid NOT NULL REFERENCES public.plan_cuentas(id),
  descripcion         text,
  prioridad           int  NOT NULL DEFAULT 100,
  activo              boolean NOT NULL DEFAULT true,
  created_at          timestamptz DEFAULT now(),
  CONSTRAINT determinacion_tipo_chk   CHECK (tipo   IN ('ingreso','egreso','*')),
  CONSTRAINT determinacion_origen_chk CHECK (origen IN ('mercadopago','uala','manual','csv','email','webhook','*'))
);

CREATE INDEX IF NOT EXISTS idx_determinacion_empresa_activo
  ON public.determinacion_cuentas_mayor (empresa_id, activo);

ALTER TABLE public.determinacion_cuentas_mayor ENABLE ROW LEVEL SECURITY;

CREATE POLICY determinacion_select ON public.determinacion_cuentas_mayor
  FOR SELECT USING (empresa_id = get_my_empresa_id());

CREATE POLICY determinacion_insert ON public.determinacion_cuentas_mayor
  FOR INSERT WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());

CREATE POLICY determinacion_update ON public.determinacion_cuentas_mayor
  FOR UPDATE USING (empresa_id = get_my_empresa_id() AND is_admin())
  WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());

CREATE POLICY determinacion_delete ON public.determinacion_cuentas_mayor
  FOR DELETE USING (empresa_id = get_my_empresa_id() AND is_admin());
