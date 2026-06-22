-- Sesión 47 (corrección): la migration 063 revocó anon de 28 funciones, pero
-- la lista original (extraída de un grep sobre un resumen de advisors, no del
-- advisor completo) se quedó corta. Re-corriendo get_advisors después de 063
-- confirmó que quedaron 4 funciones SECURITY DEFINER todavía ejecutables por
-- anon: crear_devolucion, crear_nota_debito, crear_venta, y
-- email_exists_in_system (esta última es la excepción intencional, se deja).
--
-- Callers confirmados antes de revocar (ninguno es pre-auth):
-- - crear_venta: NuevaVentaModal.jsx / useConfirmarVenta.js (requiere sesión).
-- - crear_devolucion: NuevaDevolucionModal.jsx / NuevaDevolucionProveedorModal.jsx.
-- - crear_nota_debito: NuevaNotaDebitoModal.jsx / NuevaNDProveedorModal.jsx.

REVOKE EXECUTE ON FUNCTION public.crear_devolucion(uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, uuid, uuid, boolean, text, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crear_nota_debito(uuid, uuid, text, text, numeric, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crear_venta(uuid, uuid, text, timestamp with time zone, uuid, text, numeric, text, text, text, numeric, numeric, numeric, jsonb, jsonb, boolean, uuid, uuid) FROM PUBLIC, anon;

-- Rollback (comentado): GRANT EXECUTE ON FUNCTION ... TO anon; (no debería
-- revertirse, era parte del hallazgo crítico).
