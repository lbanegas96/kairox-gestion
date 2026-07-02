-- migration 128 — Integridad contable: no borrar un movimiento ya contabilizado
--
-- HALLAZGO (auditoría sesión 44): movimientos_bancarios.delete es un DELETE plano
-- sin ningún chequeo. Si un movimiento ya generó su asiento (asiento_id NOT NULL) y
-- se borra, el asiento queda HUÉRFANO en el libro mayor (sigue confirmado y sumando,
-- pero su documento de origen desaparece) → el mayor se descuadra silenciosamente.
--
-- Como asientos_contables.origen_id NO tiene FK a movimientos_bancarios y la tabla no
-- tiene triggers, nada lo impedía. El borrado ocurre por REST API directa (no por RPC),
-- así que el guard debe estar en la BASE para ser efectivo (defensa en profundidad; la
-- UI además deshabilita el botón).
--
-- Criterio SAP: un documento contabilizado no se borra — primero se REVIERTE
-- (revertir_contabilizacion_movimiento, migration 127) y recién ahí se puede eliminar.
--
-- ROLLBACK:
--   DROP TRIGGER trg_bloquear_delete_mov_contabilizado ON public.movimientos_bancarios;
--   DROP FUNCTION public.trg_fn_bloquear_delete_mov_contabilizado();

CREATE OR REPLACE FUNCTION public.trg_fn_bloquear_delete_mov_contabilizado()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.asiento_id IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede eliminar un movimiento contabilizado. Revertí la contabilización primero.';
  END IF;
  RETURN OLD;
END;
$function$;

-- Postgres nunca chequea EXECUTE al disparar un trigger; revocar es seguro.
REVOKE EXECUTE ON FUNCTION public.trg_fn_bloquear_delete_mov_contabilizado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bloquear_delete_mov_contabilizado ON public.movimientos_bancarios;
CREATE TRIGGER trg_bloquear_delete_mov_contabilizado
  BEFORE DELETE ON public.movimientos_bancarios
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_bloquear_delete_mov_contabilizado();
