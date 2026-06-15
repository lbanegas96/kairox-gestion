-- =============================================================================
-- 042_retroactive_audit_y_triggers.sql
-- RETROACTIVA — Solo documentación. NO re-aplicar en Supabase (ya ejecutada).
-- Documenta:
--   · fn_audit_trigger  — reemplazada row_to_json por to_jsonb
--   · fn_update_cliente_saldo + trigger trg_update_cliente_saldo
--   · v_saldo_proveedores
-- =============================================================================

-- -----------------------------------------------------------------------------
-- fn_audit_trigger — función genérica de auditoría para cualquier tabla
-- Cambio documentado: migrada de row_to_json() a to_jsonb() para evitar
-- problemas de serialización con tipos UUID y JSONB en versiones PG ≥ 14.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit_trigger()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_empresa_id  UUID;
  v_registro_id UUID;
  v_old         JSONB;
  v_new         JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old         := to_jsonb(OLD);
    v_new         := NULL;
    v_empresa_id  := (to_jsonb(OLD) ->> 'empresa_id')::UUID;
    v_registro_id := (to_jsonb(OLD) ->> 'id')::UUID;
  ELSIF TG_OP = 'INSERT' THEN
    v_old         := NULL;
    v_new         := to_jsonb(NEW);
    v_empresa_id  := (to_jsonb(NEW) ->> 'empresa_id')::UUID;
    v_registro_id := (to_jsonb(NEW) ->> 'id')::UUID;
  ELSE
    v_old         := to_jsonb(OLD);
    v_new         := to_jsonb(NEW);
    v_empresa_id  := (to_jsonb(NEW) ->> 'empresa_id')::UUID;
    v_registro_id := (to_jsonb(NEW) ->> 'id')::UUID;
  END IF;

  INSERT INTO public.audit_log(tabla, operacion, registro_id, empresa_id, user_id, old_data, new_data)
  VALUES (TG_TABLE_NAME, TG_OP, v_registro_id, v_empresa_id, auth.uid(), v_old, v_new);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- fn_update_cliente_saldo — mantiene clientes.saldo_actual sincronizado
-- automáticamente con cada INSERT / UPDATE / DELETE en cuenta_corriente_movimientos.
-- DEBE  → aumenta el saldo (el cliente nos debe más)
-- HABER → reduce el saldo (el cliente pagó / se le acreditó)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_update_cliente_saldo()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.clientes
      SET saldo_actual = saldo_actual + CASE WHEN NEW.tipo = 'DEBE' THEN NEW.monto ELSE -NEW.monto END
    WHERE id = NEW.cliente_id;

  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.clientes
      SET saldo_actual = saldo_actual + CASE WHEN OLD.tipo = 'DEBE' THEN -OLD.monto ELSE OLD.monto END
    WHERE id = OLD.cliente_id;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Revertir el movimiento anterior antes de aplicar el nuevo
    UPDATE public.clientes
      SET saldo_actual = saldo_actual + CASE WHEN OLD.tipo = 'DEBE' THEN -OLD.monto ELSE OLD.monto END
    WHERE id = OLD.cliente_id;
    UPDATE public.clientes
      SET saldo_actual = saldo_actual + CASE WHEN NEW.tipo = 'DEBE' THEN NEW.monto ELSE -NEW.monto END
    WHERE id = NEW.cliente_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Trigger que dispara fn_update_cliente_saldo en cada cambio de CC clientes
DROP TRIGGER IF EXISTS trg_update_cliente_saldo ON public.cuenta_corriente_movimientos;
CREATE TRIGGER trg_update_cliente_saldo
  AFTER INSERT OR UPDATE OR DELETE ON public.cuenta_corriente_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.fn_update_cliente_saldo();

-- -----------------------------------------------------------------------------
-- v_saldo_proveedores — saldo consolidado de deuda por proveedor
-- Replica la vista original; las columnas tipo en cuenta_corriente_proveedores
-- pueden ser 'HABER'/'DEBE' (valores internos) o los legacy enumerados abajo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_saldo_proveedores AS
SELECT
  p.id          AS proveedor_id,
  p.empresa_id,
  p.nombre,
  p.cuit,
  COALESCE(SUM(
    CASE
      WHEN m.tipo = ANY(ARRAY['compra'::text, 'nota_debito'::text]) THEN  m.monto
      WHEN m.tipo = ANY(ARRAY['pago'::text,   'nota_credito'::text]) THEN -m.monto
      ELSE 0::numeric
    END
  ), 0::numeric) AS saldo_deuda
FROM public.proveedores p
LEFT JOIN public.cuenta_corriente_proveedores m
  ON m.proveedor_id = p.id AND m.empresa_id = p.empresa_id
WHERE p.activo = true
GROUP BY p.id, p.empresa_id, p.nombre, p.cuit;
