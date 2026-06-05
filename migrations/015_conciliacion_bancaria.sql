-- ==============================================================
-- Migration 015: Reconciliación / Conciliación bancaria
-- extractos_bancarios (metadata) + extracto_lineas (líneas del extracto)
-- Ejecutar en Supabase SQL Editor
-- ==============================================================

-- 1. Metadata de extractos importados
CREATE TABLE IF NOT EXISTS public.extractos_bancarios (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cuenta_bancaria_id  uuid NOT NULL REFERENCES public.cuentas_bancarias(id) ON DELETE CASCADE,
  nombre_archivo      text,
  fecha_desde         date,
  fecha_hasta         date,
  total_debitos       numeric(18,2) NOT NULL DEFAULT 0,
  total_creditos      numeric(18,2) NOT NULL DEFAULT 0,
  movimientos_count   int NOT NULL DEFAULT 0,
  user_id             uuid,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE public.extractos_bancarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eb_empresa" ON public.extractos_bancarios;
CREATE POLICY "eb_empresa" ON public.extractos_bancarios
  FOR ALL
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_eb_empresa ON public.extractos_bancarios(empresa_id);
CREATE INDEX IF NOT EXISTS idx_eb_cuenta  ON public.extractos_bancarios(cuenta_bancaria_id);

-- 2. Líneas del extracto
CREATE TABLE IF NOT EXISTS public.extracto_lineas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  extracto_id           uuid NOT NULL REFERENCES public.extractos_bancarios(id) ON DELETE CASCADE,
  cuenta_bancaria_id    uuid NOT NULL REFERENCES public.cuentas_bancarias(id) ON DELETE CASCADE,
  fecha                 date NOT NULL,
  descripcion           text NOT NULL DEFAULT '',
  monto                 numeric(18,2) NOT NULL CHECK (monto > 0),
  tipo                  text NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  -- NULL = sin conciliar; UUID = match con movimiento registrado
  movimiento_id         uuid REFERENCES public.movimientos_bancarios(id) ON DELETE SET NULL,
  conciliado            boolean NOT NULL DEFAULT false,
  created_at            timestamptz DEFAULT now()
);

ALTER TABLE public.extracto_lineas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "el_empresa" ON public.extracto_lineas;
CREATE POLICY "el_empresa" ON public.extracto_lineas
  FOR ALL
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_el_extracto   ON public.extracto_lineas(extracto_id);
CREATE INDEX IF NOT EXISTS idx_el_cuenta     ON public.extracto_lineas(cuenta_bancaria_id);
CREATE INDEX IF NOT EXISTS idx_el_fecha      ON public.extracto_lineas(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_el_conciliado ON public.extracto_lineas(conciliado);

-- 3. Cuando se concilia una línea, marcar también el movimiento_bancarios.conciliado
CREATE OR REPLACE FUNCTION public.fn_sync_conciliado()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.movimiento_id IS NOT NULL THEN
    UPDATE public.movimientos_bancarios
    SET conciliado = NEW.conciliado
    WHERE id = NEW.movimiento_id;
  END IF;
  -- Si se removió el match, limpiar flag en movimiento anterior
  IF OLD.movimiento_id IS NOT NULL AND NEW.movimiento_id IS DISTINCT FROM OLD.movimiento_id THEN
    UPDATE public.movimientos_bancarios
    SET conciliado = false
    WHERE id = OLD.movimiento_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_conciliado ON public.extracto_lineas;
CREATE TRIGGER trg_sync_conciliado
  AFTER UPDATE OF movimiento_id, conciliado ON public.extracto_lineas
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_conciliado();
