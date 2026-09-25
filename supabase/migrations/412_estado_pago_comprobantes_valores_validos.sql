-- 412 — `comprobantes.estado_pago`: solo valores válidos
--
-- Auditoría 24/09/2026, hallazgo CON-8 (calidad de datos). `compras.estado_pago` ya tiene su CHECK, pero
-- `comprobantes.estado_pago` no tenía ninguno y en la base aparecían 2 valores distintos para lo mismo: «pagada»
-- (167 filas) y «pagado» (2). Las vistas y los reportes comparan contra 'pagada', así que una venta en «pagado» no
-- contaba como cobrada. Los 2 casos son ventas de prueba (QA397-V1 y QA397-V2, del 18/09, cargadas a mano); ningún
-- código de la aplicación ni de la base escribe «pagado» en esta tabla (las funciones que contienen esa palabra son
-- las del cobro por QR y hablan de otra tabla, `qr_pagos_mp`). Se revisaron todos los lugares que escriben
-- `estado_pago` (el frontend, `crear_venta`, cheques, cobros y cancelaciones): solo producen pendiente, parcial,
-- pagada y cancelada.
--
-- Arreglo: (1) las 2 filas pasan a «pagada»; (2) un CHECK que solo admite los 4 estados que existen. Así una
-- carga manual o un cambio de código futuro con un valor mal escrito falla en el momento en vez de ensuciar los
-- reportes en silencio.
--
-- No se toca `movimientos_inventario.tipo`: ya tiene su CHECK; que existan `entrada` e `ingreso` (y `salida`/`egreso`)
-- es un problema de nombres repartido en ~16 funciones, y unificarlo tiene más riesgo que beneficio por ahora.

UPDATE public.comprobantes SET estado_pago = 'pagada' WHERE estado_pago = 'pagado';

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.comprobantes'::regclass AND conname = 'comprobantes_estado_pago_check'
  ) THEN
    ALTER TABLE public.comprobantes
      ADD CONSTRAINT comprobantes_estado_pago_check
      CHECK (estado_pago IN ('pendiente', 'parcial', 'pagada', 'cancelada'));
  END IF;
END
$mig$;
