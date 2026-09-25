-- 405 — Confirmar (o anular) un asiento recalcula el saldo de sus cuentas
--
-- Auditoría 24/09/2026, hallazgo CON-4. `plan_cuentas.saldo_actual` se recalcula con
-- `trg_asiento_item_saldo` cuando cambian las LÍNEAS de un asiento, y `recalcular_saldo_cuenta`
-- suma solo asientos en estado 'confirmado'. Pero un asiento manual nace como 'borrador' (sus
-- líneas se insertan con el asiento todavía sin confirmar, o sea sin sumar) y `confirmar_asiento`
-- solo cambia el ESTADO del encabezado: nada recalculaba. Resultado: el Plan de Cuentas no
-- mostraba el impacto del asiento hasta que otra línea tocara esa misma cuenta. Caso real en
-- Nalux: cuenta 5.4 Gastos de Administración mostraba $ 130.000 y el mayor decía $ 150.000
-- (AS-000118); la suma de todos los saldos daba −$ 20.000 en vez de 0.
--
-- Arreglo:
--   1) Trigger sobre el cambio de ESTADO del asiento (cubre confirmar_asiento y cualquier otra
--      ruta futura): cuando entra o sale de 'confirmado', recalcula todas las cuentas de sus líneas.
--   2) Recalculo único de todas las cuentas que hoy estén desfasadas (solo toca las que difieren).

CREATE OR REPLACE FUNCTION public.trg_asiento_estado_saldo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado
     AND (NEW.estado = 'confirmado' OR OLD.estado = 'confirmado') THEN
    FOR r IN SELECT DISTINCT cuenta_id FROM public.asientos_items WHERE asiento_id = NEW.id LOOP
      PERFORM public.recalcular_saldo_cuenta(r.cuenta_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_asiento_estado_saldo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_asiento_estado_saldo ON public.asientos_contables;
CREATE TRIGGER trg_asiento_estado_saldo
  AFTER UPDATE OF estado ON public.asientos_contables
  FOR EACH ROW
  WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION public.trg_asiento_estado_saldo();

-- Recalculo único: mismo criterio que `recalcular_saldo_cuenta` (debe − haber de asientos confirmados).
UPDATE public.plan_cuentas pc
SET saldo_actual = m.saldo
FROM (
  SELECT c.id,
         COALESCE((
           SELECT SUM(ai.debe - ai.haber)
           FROM public.asientos_items ai
           JOIN public.asientos_contables a ON a.id = ai.asiento_id
           WHERE ai.cuenta_id = c.id AND a.estado = 'confirmado'
         ), 0) AS saldo
  FROM public.plan_cuentas c
) m
WHERE m.id = pc.id
  AND pc.saldo_actual IS DISTINCT FROM m.saldo;
