-- ════════════════════════════════════════════════════════════════════════════
-- migration 143 — Auditoria area #15 (Audit log — cobertura)
-- Agregar trg_audit_* (fn_audit_trigger generica, ya existe) a 4 tablas
-- criticas de dinero/seguridad que no tenian trazabilidad
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hallazgo: solo 14 tablas tenian trg_audit_* (clientes, comprobantes,
-- compras, cotizaciones, cuenta_corriente_movimientos/proveedores,
-- movimientos_caja, ordenes_compra, pedidos, productos, profiles,
-- tipos_cambio, caja_sesiones, configuracion). Confirmado con
-- BEGIN...ROLLBACK: cerrar un periodo contable (periodos_contables, mig.136 —
-- justo la tabla cuyo RLS de escritura arreglamos por ser explotable por
-- staff) no deja NINGUN rastro en audit_log. Mismo vacio en notas_debito
-- (documento de deuda), movimientos_bancarios y asientos_contables (el
-- libro mayor mismo).
--
-- Fix: reusar fn_audit_trigger() (ya SECURITY DEFINER, ya probada en 14
-- tablas) — mismo patron, AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.

CREATE TRIGGER trg_audit_periodos_contables
  AFTER INSERT OR UPDATE OR DELETE ON public.periodos_contables
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

CREATE TRIGGER trg_audit_notas_debito
  AFTER INSERT OR UPDATE OR DELETE ON public.notas_debito
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

CREATE TRIGGER trg_audit_movimientos_bancarios
  AFTER INSERT OR UPDATE OR DELETE ON public.movimientos_bancarios
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

CREATE TRIGGER trg_audit_asientos_contables
  AFTER INSERT OR UPDATE OR DELETE ON public.asientos_contables
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
