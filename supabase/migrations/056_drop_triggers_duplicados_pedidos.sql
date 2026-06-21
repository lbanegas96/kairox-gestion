-- =============================================================================
-- MIGRATION 056 — Eliminar triggers duplicados en pedidos
-- =============================================================================
-- Hallazgo MEDIO de la auditoría de estabilización (sesión 32). pg_trigger
-- confirmó 2 pares idénticos sobre public.pedidos:
--   audit_pedidos          AFTER INSERT OR DELETE OR UPDATE -> fn_audit_trigger()
--   trg_audit_pedidos       AFTER INSERT OR DELETE OR UPDATE -> fn_audit_trigger()
--   set_pedidos_updated_at  BEFORE UPDATE -> fn_set_updated_at()
--   trg_pedidos_updated_at  BEFORE UPDATE -> fn_set_updated_at()
-- Cada INSERT/UPDATE/DELETE sobre pedidos generaba 2 filas en audit_log y
-- recalculaba updated_at 2 veces.
--
-- Se conservan los `trg_*`: es la convención que usa el resto del sistema sin
-- excepción (trg_audit_ordenes_compra, trg_audit_productos, trg_oc_updated_at,
-- trg_proveedores_updated_at, trg_cotizaciones_updated_at, etc. — migrations 001
-- y 016). `audit_pedidos`/`set_pedidos_updated_at` vienen de
-- 017_pedidos_condiciones.sql (anterior a que existiera la convención trg_*) y
-- no tienen ninguna referencia especial en ninguna otra migration ni en src/
-- (grep confirmado: solo aparecen en la 017 que los creó).
-- =============================================================================

DROP TRIGGER IF EXISTS audit_pedidos ON public.pedidos;
DROP TRIGGER IF EXISTS set_pedidos_updated_at ON public.pedidos;

-- ─── ROLLBACK (si hace falta revertir) ────────────────────────────────────────
-- CREATE TRIGGER audit_pedidos
--   AFTER INSERT OR DELETE OR UPDATE ON public.pedidos
--   FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
--
-- CREATE TRIGGER set_pedidos_updated_at
--   BEFORE UPDATE ON public.pedidos
--   FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
