-- ════════════════════════════════════════════════════════════════════════════
-- migration 137 — Auditoria area #10 (Conciliacion bancaria)
-- extracto_lineas.movimiento_id: guard de tenant en el match
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hallazgo CRITICO (confirmado con BEGIN...ROLLBACK): matchManual()/autoMatch()
-- en conciliacionService.ts hacen UPDATE extracto_lineas SET movimiento_id=X sin
-- verificar que el movimiento X pertenezca a la MISMA empresa que la linea. La
-- FK solo garantiza que el movimiento exista, no que sea del mismo tenant.
-- Probado: un admin de Empresa A matcheo su linea con un movimiento_bancario de
-- Empresa B, y el trigger fn_sync_conciliado (SECURITY DEFINER, correcto para
-- su proposito) propago el conciliado=true CROSS-TENANT al movimiento de B.
--
-- Fix: trigger BEFORE UPDATE que valida empresa_id coincidente antes de
-- permitir el match. Mismo patron "nunca confiar en el cliente" que otros
-- guards de esta auditoria.

CREATE OR REPLACE FUNCTION public.fn_guard_match_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.movimiento_id IS NOT NULL AND NEW.movimiento_id IS DISTINCT FROM OLD.movimiento_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.movimientos_bancarios
      WHERE id = NEW.movimiento_id AND empresa_id = NEW.empresa_id
    ) THEN
      RAISE EXCEPTION 'No autorizado: el movimiento no pertenece a la misma empresa que la linea de extracto';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_match_tenant ON public.extracto_lineas;
CREATE TRIGGER trg_guard_match_tenant
  BEFORE UPDATE OF movimiento_id ON public.extracto_lineas
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_match_tenant();

REVOKE EXECUTE ON FUNCTION public.fn_guard_match_tenant() FROM PUBLIC, anon, authenticated;
