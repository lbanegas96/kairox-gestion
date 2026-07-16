-- =============================================================================
-- MIGRACIÓN 008: Workflow aprobación OC + Cierre de períodos contables
-- =============================================================================

-- ── 1. Agregar estado pendiente_aprobacion a ordenes_compra ───────────────────
-- Primero eliminamos la constraint existente y la recreamos con el nuevo valor.
ALTER TABLE public.ordenes_compra
  DROP CONSTRAINT IF EXISTS ordenes_compra_estado_check;

ALTER TABLE public.ordenes_compra
  ADD CONSTRAINT ordenes_compra_estado_check
  CHECK (estado IN ('borrador','pendiente_aprobacion','enviada','recibida_parcial','recibida','cancelada'));

-- ── 2. Tabla de períodos contables ────────────────────────────────────────────
-- NOTA CI: el diseño original de esta tabla (empresa_id, anio, mes, cerrado)
-- quedó obsoleto — en producción se rediseñó ad-hoc a la forma que crea
-- la migration 027_cierre_periodos.sql (id, nombre, fecha_inicio/cierre,
-- estado, etc.), que es la que se usa en todo el resto del código
-- (016, 074, 098, 136, 143, 150). Se saca la definición vieja de acá para
-- que 027 sea la única dueña de la tabla al replayar desde cero en CI.
