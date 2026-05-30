-- =============================================================================
-- MIGRACIÓN 001: Sistema de Auditoría
-- Registra todas las operaciones INSERT/UPDATE/DELETE en tablas críticas
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          BIGSERIAL PRIMARY KEY,
  tabla       TEXT NOT NULL,
  operacion   TEXT NOT NULL CHECK (operacion IN ('INSERT', 'UPDATE', 'DELETE')),
  registro_id UUID,
  empresa_id  UUID,
  user_id     UUID,
  old_data    JSONB,
  new_data    JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_tabla ON public.audit_log(tabla);
CREATE INDEX idx_audit_log_empresa_id ON public.audit_log(empresa_id);
CREATE INDEX idx_audit_log_created_at ON public.audit_log(created_at DESC);
CREATE INDEX idx_audit_log_registro_id ON public.audit_log(registro_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_empresa" ON public.audit_log
  FOR SELECT USING (empresa_id = public.get_my_empresa_id());

-- Función genérica de auditoría
CREATE OR REPLACE FUNCTION public.fn_audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID;
  v_registro_id UUID;
  v_old JSONB;
  v_new JSONB;
BEGIN
  -- Extraer empresa_id y registro_id del registro afectado
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
    v_empresa_id := (OLD::jsonb ->> 'empresa_id')::UUID;
    v_registro_id := (OLD::jsonb ->> 'id')::UUID;
  ELSIF TG_OP = 'INSERT' THEN
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_empresa_id := (NEW::jsonb ->> 'empresa_id')::UUID;
    v_registro_id := (NEW::jsonb ->> 'id')::UUID;
  ELSE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_empresa_id := (NEW::jsonb ->> 'empresa_id')::UUID;
    v_registro_id := (NEW::jsonb ->> 'id')::UUID;
  END IF;

  INSERT INTO public.audit_log(tabla, operacion, registro_id, empresa_id, user_id, old_data, new_data)
  VALUES (TG_TABLE_NAME, TG_OP, v_registro_id, v_empresa_id, auth.uid(), v_old, v_new);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Aplicar trigger en tablas críticas
DO $$
DECLARE
  tablas TEXT[] := ARRAY[
    'comprobantes', 'compras', 'productos', 'clientes',
    'movimientos_caja', 'caja_sesiones', 'cuenta_corriente_movimientos'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_audit_%1$s ON public.%1$s;
      CREATE TRIGGER trg_audit_%1$s
      AFTER INSERT OR UPDATE OR DELETE ON public.%1$s
      FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
    ', t);
  END LOOP;
END;
$$;
