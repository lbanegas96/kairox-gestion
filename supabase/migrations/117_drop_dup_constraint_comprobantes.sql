-- migration 117 — performance: drop constraint UNIQUE duplicado en comprobantes
--
-- comprobantes tiene 2 constraints UNIQUE IDÉNTICOS sobre (empresa_id, numero_venta):
--   - comprobantes_empresa_id_numero_venta_key  (original, de la def de tabla;
--     es el referenciado en el fix de sesión 65 — SE MANTIENE)
--   - uq_comprobantes_empresa_numero             (agregado en migration 094, redundante)
--
-- Verificado: ninguno se referencia por nombre en ON CONFLICT en el código (solo en
-- comentarios/CONTEXT.md). Dropear el redundante NO afecta la unicidad: el original
-- sigue garantizando que no se repita (empresa_id, numero_venta).
--
-- ⚠️ PENDIENTE DE APROBACIÓN — cambio destructivo sobre la tabla crítica de comprobantes.
--
-- ROLLBACK:
--   ALTER TABLE public.comprobantes
--     ADD CONSTRAINT uq_comprobantes_empresa_numero UNIQUE (empresa_id, numero_venta);

ALTER TABLE public.comprobantes DROP CONSTRAINT IF EXISTS uq_comprobantes_empresa_numero;
