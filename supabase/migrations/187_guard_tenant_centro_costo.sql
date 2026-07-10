-- migration 187 — Hardening: validar que centro_costo_id pertenezca a la misma
-- empresa que el registro (comprobantes/compras/asientos_contables), 2026-07-10.
--
-- Gap: centro_costo_id (mig.168) es una FK simple a centros_costo(id) sin
-- validar el tenant. RLS protege las consultas normales de la UI (siempre
-- filtra por empresa_id = get_my_empresa_id()), pero un INSERT/UPDATE directo
-- vía API (con un centro_costo_id válido de OTRA empresa, ambas dentro de RLS
-- propia) podía colar una referencia cross-tenant sin que nada lo impidiera.
-- Defensa en profundidad: mismo espíritu que el trigger fn_queue_factura_arca
-- que ya valida relevante_fiscal como segunda capa.

CREATE OR REPLACE FUNCTION public.fn_validar_tenant_centro_costo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.centro_costo_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.centros_costo cc
      WHERE cc.id = NEW.centro_costo_id
        AND cc.empresa_id = NEW.empresa_id
    ) THEN
      RAISE EXCEPTION 'centro_costo_id no pertenece a la empresa del registro';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_tenant_centro_costo ON public.comprobantes;
CREATE TRIGGER trg_validar_tenant_centro_costo
  BEFORE INSERT OR UPDATE OF centro_costo_id ON public.comprobantes
  FOR EACH ROW EXECUTE FUNCTION public.fn_validar_tenant_centro_costo();

DROP TRIGGER IF EXISTS trg_validar_tenant_centro_costo ON public.compras;
CREATE TRIGGER trg_validar_tenant_centro_costo
  BEFORE INSERT OR UPDATE OF centro_costo_id ON public.compras
  FOR EACH ROW EXECUTE FUNCTION public.fn_validar_tenant_centro_costo();

DROP TRIGGER IF EXISTS trg_validar_tenant_centro_costo ON public.asientos_contables;
CREATE TRIGGER trg_validar_tenant_centro_costo
  BEFORE INSERT OR UPDATE OF centro_costo_id ON public.asientos_contables
  FOR EACH ROW EXECUTE FUNCTION public.fn_validar_tenant_centro_costo();

-- fn_validar_tenant_centro_costo es una función de trigger interna, no un RPC:
-- se revoca EXECUTE de anon/authenticated para que no quede invocable directo
-- vía /rest/v1/rpc/... (los triggers siguen disparando igual, corren con el
-- privilegio del dueño de la función, no con el del rol que hace el UPDATE).
REVOKE EXECUTE ON FUNCTION public.fn_validar_tenant_centro_costo() FROM PUBLIC, anon, authenticated;

-- ROLLBACK (comentado):
-- DROP TRIGGER IF EXISTS trg_validar_tenant_centro_costo ON public.asientos_contables;
-- DROP TRIGGER IF EXISTS trg_validar_tenant_centro_costo ON public.compras;
-- DROP TRIGGER IF EXISTS trg_validar_tenant_centro_costo ON public.comprobantes;
-- DROP FUNCTION IF EXISTS public.fn_validar_tenant_centro_costo();
