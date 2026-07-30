-- migration 274 — DROP de las columnas legacy puntos_venta.ultimo_numero_a/b/c
--
-- CONTEXTO: mig.273 las reemplazó por puntos_venta_numeracion (indexada por
-- CbteTipo real de AFIP, no por letra). Se dejaron marcadas como DEPRECADAS
-- ahí mismo, a propósito, hasta confirmar que arca-worker funcionaba en
-- producción contra la tabla nueva sin el guard de ambigüedad. Nadia pidió
-- esperar ~1 semana desde el deploy del worker antes de dropear.
--
-- Verificado antes de escribir esto:
--   - `puntos_venta_numeracion` tiene fila viva (PV1, cbte_tipo 11,
--     ultimo_numero 34, updated_at 2026-07-29 20:02 UTC) — el worker ya
--     está leyendo/escribiendo la tabla nueva en producción.
--   - `grep` en src/ y supabase/functions/ no encuentra ninguna lectura ni
--     escritura de ultimo_numero_a/b/c fuera de comentarios explicativos en
--     arca-worker/index.ts (mig.273).
--   - No hay riesgo de rollback del worker en este momento (ya lleva
--     comprobantes reales emitidos sobre la tabla nueva hoy mismo).
--
-- Es DROP físico de columna, no anulación lógica — correcto acá porque son
-- contadores técnicos internos (no un documento contable), ya reemplazados
-- por su equivalente correcto, y el histórico que representaban queda
-- preservado en los propios `comprobantes.numero_afip` emitidos.

ALTER TABLE public.puntos_venta
  DROP COLUMN IF EXISTS ultimo_numero_a,
  DROP COLUMN IF EXISTS ultimo_numero_b,
  DROP COLUMN IF EXISTS ultimo_numero_c;

-- ROLLBACK (comentado — requeriría además re-sembrar valores, no es trivial):
-- ALTER TABLE public.puntos_venta
--   ADD COLUMN ultimo_numero_a INTEGER NOT NULL DEFAULT 0,
--   ADD COLUMN ultimo_numero_b INTEGER NOT NULL DEFAULT 0,
--   ADD COLUMN ultimo_numero_c INTEGER NOT NULL DEFAULT 0;
