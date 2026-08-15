-- migration 327 — Duplicar documentos: columna duplicado_de_id (self-FK nullable)
--
-- Última pieza del plan de comprobantes (14-15/08): duplicar cualquier documento con precio
-- propio (Cotización/Pedido/OC/Factura Venta/Factura Compra/NC/ND) en uno nuevo, con fecha de
-- hoy, numeración propia, y un vínculo OPCIONAL de trazabilidad hacia el original si el usuario
-- elige "vincular en el Mapa de Relaciones".
--
-- Mismo patrón que comprobantes.comprobante_origen_id: ON DELETE SET NULL, sin trigger de
-- auditoría (dato de trazabilidad de un solo insert, nunca se edita después). No es una tabla de
-- relaciones genérica a propósito — no existe ese patrón en el schema, cada vínculo cruzado ya es
-- una columna FK dedicada (comprobante_origen_id, cotizacion_id, pedido_id, etc.).
--
-- Entregas, Recepciones y Devoluciones quedan fuera (no tienen precio propio / mueven stock /
-- siempre atadas 1:1 a un origen específico) — no ganan esta columna.

ALTER TABLE public.cotizaciones
  ADD COLUMN IF NOT EXISTS duplicado_de_id UUID REFERENCES public.cotizaciones(id) ON DELETE SET NULL;

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS duplicado_de_id UUID REFERENCES public.pedidos(id) ON DELETE SET NULL;

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS duplicado_de_id UUID REFERENCES public.ordenes_compra(id) ON DELETE SET NULL;

-- comprobantes cubre Factura de Venta, NC emitida y ND emitida (mismo tipo=venta/nota_credito/nota_debito)
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS duplicado_de_id UUID REFERENCES public.comprobantes(id) ON DELETE SET NULL;

ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS duplicado_de_id UUID REFERENCES public.compras(id) ON DELETE SET NULL;

ALTER TABLE public.notas_debito
  ADD COLUMN IF NOT EXISTS duplicado_de_id UUID REFERENCES public.notas_debito(id) ON DELETE SET NULL;

ALTER TABLE public.notas_credito_proveedor
  ADD COLUMN IF NOT EXISTS duplicado_de_id UUID REFERENCES public.notas_credito_proveedor(id) ON DELETE SET NULL;

-- Índices sólo donde vale la pena resolver "duplicados de este" en el Mapa de Relaciones sin
-- full scan — mismo criterio que el resto del schema (índices en columnas de FK usadas en JOIN).
CREATE INDEX IF NOT EXISTS idx_cotizaciones_duplicado_de       ON public.cotizaciones(duplicado_de_id)       WHERE duplicado_de_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pedidos_duplicado_de            ON public.pedidos(duplicado_de_id)            WHERE duplicado_de_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_duplicado_de     ON public.ordenes_compra(duplicado_de_id)     WHERE duplicado_de_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comprobantes_duplicado_de       ON public.comprobantes(duplicado_de_id)       WHERE duplicado_de_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_compras_duplicado_de            ON public.compras(duplicado_de_id)            WHERE duplicado_de_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notas_debito_duplicado_de       ON public.notas_debito(duplicado_de_id)       WHERE duplicado_de_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notas_credito_prov_duplicado_de ON public.notas_credito_proveedor(duplicado_de_id) WHERE duplicado_de_id IS NOT NULL;

-- rollback:
-- DROP INDEX IF EXISTS idx_cotizaciones_duplicado_de, idx_pedidos_duplicado_de, idx_ordenes_compra_duplicado_de,
--   idx_comprobantes_duplicado_de, idx_compras_duplicado_de, idx_notas_debito_duplicado_de, idx_notas_credito_prov_duplicado_de;
-- ALTER TABLE public.cotizaciones DROP COLUMN IF EXISTS duplicado_de_id;
-- ALTER TABLE public.pedidos DROP COLUMN IF EXISTS duplicado_de_id;
-- ALTER TABLE public.ordenes_compra DROP COLUMN IF EXISTS duplicado_de_id;
-- ALTER TABLE public.comprobantes DROP COLUMN IF EXISTS duplicado_de_id;
-- ALTER TABLE public.compras DROP COLUMN IF EXISTS duplicado_de_id;
-- ALTER TABLE public.notas_debito DROP COLUMN IF EXISTS duplicado_de_id;
-- ALTER TABLE public.notas_credito_proveedor DROP COLUMN IF EXISTS duplicado_de_id;
