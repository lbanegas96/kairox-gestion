-- ==============================================================
-- Migration 012: Tabla facturas_proveedor (3-way match OC-Recepción-Factura)
-- Ejecutar en Supabase SQL Editor
-- ==============================================================

CREATE TABLE IF NOT EXISTS public.facturas_proveedor (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  orden_compra_id   uuid UNIQUE REFERENCES public.ordenes_compra(id) ON DELETE SET NULL,
  proveedor_id      uuid REFERENCES public.proveedores(id) ON DELETE SET NULL,
  numero_factura    text NOT NULL,
  fecha_factura     date NOT NULL,
  fecha_vencimiento date,
  monto_total       numeric NOT NULL CHECK (monto_total > 0),
  notas             text,
  estado            text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'pagada', 'vencida', 'anulada')),
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE public.facturas_proveedor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fp_all" ON public.facturas_proveedor
  FOR ALL
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_fp_empresa ON public.facturas_proveedor(empresa_id);
CREATE INDEX IF NOT EXISTS idx_fp_estado  ON public.facturas_proveedor(estado);
