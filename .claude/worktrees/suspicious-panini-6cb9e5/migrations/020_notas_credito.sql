-- ==============================================================
-- Migration 020: Notas de crédito / Devoluciones
-- Agrega tipo, estado_pago y origen a comprobantes
-- Ejecutar en Supabase SQL Editor
-- ==============================================================

-- 1. Columna tipo (venta | nota_credito)
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'venta'
    CHECK (tipo IN ('venta', 'nota_credito'));

-- 2. estado_pago (ya lo usa el código pero no estaba en schema)
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS estado_pago TEXT NOT NULL DEFAULT 'pagada'
    CHECK (estado_pago IN ('pagada', 'pendiente', 'parcial', 'cancelada'));

-- Retroactivos: ventas existentes sin estado_pago quedan como 'pagada'
UPDATE public.comprobantes
  SET estado_pago = 'pagada'
  WHERE estado_pago IS NULL;

-- 3. Referencia al comprobante original (para NC)
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS comprobante_origen_id UUID
    REFERENCES public.comprobantes(id) ON DELETE SET NULL;

-- 4. Motivo de la nota de crédito
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS motivo_nc TEXT;

-- Índices
CREATE INDEX IF NOT EXISTS idx_comprobantes_tipo
  ON public.comprobantes(tipo);

CREATE INDEX IF NOT EXISTS idx_comprobantes_origen
  ON public.comprobantes(comprobante_origen_id)
  WHERE comprobante_origen_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comprobantes_estado_pago
  ON public.comprobantes(estado_pago);
