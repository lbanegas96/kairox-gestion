-- ==============================================================
-- Migration 010: Eliminar tablas legacy ventas / detalle_ventas
-- ReportesSection ya lee de comprobantes/comprobante_items
-- NuevaVentaModal ya no escribe en estas tablas
-- ==============================================================

-- Backup por seguridad (pueden dropearse luego de verificar)
CREATE TABLE IF NOT EXISTS public.ventas_backup AS SELECT * FROM public.ventas;
CREATE TABLE IF NOT EXISTS public.detalle_ventas_backup AS SELECT * FROM public.detalle_ventas;

-- Eliminar tablas legacy
DROP TABLE IF EXISTS public.detalle_ventas;
DROP TABLE IF EXISTS public.ventas;
