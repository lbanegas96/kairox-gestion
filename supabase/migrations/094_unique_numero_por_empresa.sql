-- Migration 094: UNIQUE (empresa_id, numero_*) en todas las tablas de documentos
-- Previene duplicados de número por tenant.
-- Pre-requisito: limpiar ENT-2026-0042 duplicado (race condition histórica del 23-Jun-2026).

-- 1. Limpiar el único duplicado histórico: entrega fantasma sin movimiento de inventario
DELETE FROM public.entrega_items
WHERE entrega_id = '1659043e-e621-4eec-8c8c-34c1823a703a';

DELETE FROM public.entregas
WHERE id = '1659043e-e621-4eec-8c8c-34c1823a703a'
  AND empresa_id = 'cbc4db74-ec31-4324-bd36-207b7a7bd99a';

-- 2. Agregar UNIQUE constraints por tenant
ALTER TABLE public.entregas
  ADD CONSTRAINT uq_entregas_empresa_numero UNIQUE (empresa_id, numero_entrega);

ALTER TABLE public.devoluciones
  ADD CONSTRAINT uq_devoluciones_empresa_numero UNIQUE (empresa_id, numero_devolucion);

ALTER TABLE public.comprobantes
  ADD CONSTRAINT uq_comprobantes_empresa_numero UNIQUE (empresa_id, numero_venta);

ALTER TABLE public.pedidos
  ADD CONSTRAINT uq_pedidos_empresa_numero UNIQUE (empresa_id, numero);

ALTER TABLE public.cotizaciones
  ADD CONSTRAINT uq_cotizaciones_empresa_numero UNIQUE (empresa_id, numero);

ALTER TABLE public.ordenes_compra
  ADD CONSTRAINT uq_ordenes_compra_empresa_numero UNIQUE (empresa_id, numero);

ALTER TABLE public.recepciones
  ADD CONSTRAINT uq_recepciones_empresa_numero UNIQUE (empresa_id, numero_recepcion);

ALTER TABLE public.notas_debito
  ADD CONSTRAINT uq_notas_debito_empresa_numero UNIQUE (empresa_id, numero_nd);
