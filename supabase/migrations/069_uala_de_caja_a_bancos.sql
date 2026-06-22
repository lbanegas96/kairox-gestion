-- Sesión 51 (continuación): Ualá pasa de "Caja" a "Bancos".
--
-- Hallazgo (revisión skill sap-reference + pedido explícito de Luciano):
-- una transferencia de Ualá es un movimiento bancario/fintech, no efectivo
-- físico. El trigger viejo (sync_uala_to_caja) la insertaba en
-- movimientos_caja atada a la caja_sesion ABIERTA del usuario en ese momento
-- — eso mezcla la conciliación bancaria con el arqueo de caja, y además
-- dependía de que alguien tuviera la caja abierta (si no, la transferencia
-- se perdía en silencio, sin error). El sistema YA tiene la arquitectura
-- correcta para esto (igual que Mercado Pago): cuentas_bancarias +
-- movimientos_bancarios + integraciones_bancarias + la RPC
-- insertar_movimiento_bancario_externo. Esta migration conecta Ualá a ese
-- mismo camino — reemplazo completo, no en paralelo (decisión confirmada).
--
-- 'uala' ya estaba habilitado en integraciones_bancarias_proveedor_check
-- desde sesión 39 (a propósito, "para cuando exista la integración") — solo
-- faltaba movimientos_bancarios_origen_check y el trigger.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Habilitar 'uala' como origen válido en movimientos_bancarios.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.movimientos_bancarios DROP CONSTRAINT movimientos_bancarios_origen_check;
ALTER TABLE public.movimientos_bancarios ADD CONSTRAINT movimientos_bancarios_origen_check
  CHECK (origen = ANY (ARRAY['manual'::text, 'csv'::text, 'email'::text, 'webhook'::text, 'mercadopago'::text, 'uala'::text]));

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Reemplazar el trigger. movimientos_uala sigue siendo la tabla de
-- aterrizaje del Apps Script (no se toca esa parte) — solo cambia qué pasa
-- DESPUÉS del INSERT.
-- ───────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trigger_uala_to_caja ON public.movimientos_uala;
DROP FUNCTION IF EXISTS public.sync_uala_to_caja();

CREATE OR REPLACE FUNCTION public.sync_uala_to_bancos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cuenta_bancaria_id UUID;
BEGIN
  SELECT cuenta_bancaria_id INTO v_cuenta_bancaria_id
  FROM public.integraciones_bancarias
  WHERE empresa_id = NEW.empresa_id
    AND proveedor  = 'uala'
    AND activo     = true;

  -- Si la empresa todavía no configuró su cuenta Ualá en Integraciones, no
  -- hay dónde imputar el movimiento — se omite en silencio (documentado,
  -- mismo principio que el camino viejo: nunca bloquear el INSERT que ya
  -- llegó del Apps Script vía Gmail, eso perdería el dato de origen).
  IF v_cuenta_bancaria_id IS NOT NULL THEN
    PERFORM public.insertar_movimiento_bancario_externo(
      p_empresa_id         := NEW.empresa_id,
      p_cuenta_bancaria_id := v_cuenta_bancaria_id,
      p_fecha              := NEW.fecha,
      p_descripcion        := 'Ualá → ' || COALESCE(NEW.destinatario, 'Desconocido'),
      p_monto              := NEW.monto,
      p_tipo               := 'egreso',
      p_origen             := 'uala'
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trigger_uala_to_bancos
  AFTER INSERT ON public.movimientos_uala
  FOR EACH ROW EXECUTE FUNCTION public.sync_uala_to_bancos();

-- ───────────────────────────────────────────────────────────────────────────
-- Rollback (comentado):
-- ALTER TABLE public.movimientos_bancarios DROP CONSTRAINT movimientos_bancarios_origen_check;
-- ALTER TABLE public.movimientos_bancarios ADD CONSTRAINT movimientos_bancarios_origen_check
--   CHECK (origen = ANY (ARRAY['manual'::text, 'csv'::text, 'email'::text, 'webhook'::text, 'mercadopago'::text]));
-- DROP TRIGGER IF EXISTS trigger_uala_to_bancos ON public.movimientos_uala;
-- DROP FUNCTION IF EXISTS public.sync_uala_to_bancos();
-- CREATE OR REPLACE FUNCTION public.sync_uala_to_caja()
-- RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   v_sesion_id UUID;
-- BEGIN
--   SELECT id INTO v_sesion_id FROM caja_sesiones
--   WHERE user_id = NEW.user_id AND cierre_fecha IS NULL
--   ORDER BY apertura_fecha DESC LIMIT 1;
--   IF v_sesion_id IS NOT NULL THEN
--     INSERT INTO movimientos_caja (
--       user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto,
--       monto, metodo_pago, is_automatic
--     ) VALUES (
--       NEW.user_id, NEW.empresa_id, v_sesion_id, NEW.fecha, 'egreso', 'Otro Egreso',
--       'Ualá → ' || COALESCE(NEW.destinatario, 'Desconocido'), NEW.monto, 'Transferencia', true
--     );
--   END IF;
--   RETURN NEW;
-- END;
-- $function$;
-- CREATE TRIGGER trigger_uala_to_caja AFTER INSERT ON public.movimientos_uala
--   FOR EACH ROW EXECUTE FUNCTION sync_uala_to_caja();
