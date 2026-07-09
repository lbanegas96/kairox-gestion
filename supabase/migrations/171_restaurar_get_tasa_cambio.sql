-- migration 171 — restaura get_tasa_cambio (Fase 3 Multimoneda, sesión 55)
--
-- HALLAZGO: get_tasa_cambio se había eliminado como dead code en la migration
-- 058 ("sin caller en src/ ni interno") — en ese momento era correcto, nadie
-- la llamaba. La migration 170 (diferencia de cambio realizada) la necesita
-- de nuevo para obtener el TC vigente al momento del clearing de una factura
-- en moneda extranjera.
--
-- HALLAZGO 2 (advisors post-deploy): la versión original (migration 013) no
-- validaba que p_empresa_id perteneciera al tenant autenticado — cualquier
-- usuario podía leer el TC de OTRA empresa pasando su empresa_id como
-- parámetro. Impacto bajo (solo expone una tasa de cambio, no datos
-- financieros ni personales), pero se cierra directamente acá por la regla
-- de aislamiento multi-tenant del proyecto (nunca datos de una empresa
-- visibles para otra).
CREATE OR REPLACE FUNCTION public.get_tasa_cambio(
  p_empresa_id uuid,
  p_moneda     text,
  p_fecha      date DEFAULT CURRENT_DATE
)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tasa
  FROM public.tipos_cambio
  WHERE empresa_id = p_empresa_id
    AND (p_empresa_id = get_my_empresa_id() OR auth.role() = 'service_role')
    AND moneda = p_moneda
    AND fecha <= p_fecha
  ORDER BY fecha DESC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_tasa_cambio(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tasa_cambio(uuid, text, date) TO authenticated;
