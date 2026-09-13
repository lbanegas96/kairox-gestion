-- 13/09 (Luciano): al cancelar un cobro (cancelar_cobro_cliente, mig.367) el
-- movimiento solo cambia `estado` a 'cancelado' — nunca cambia `tipo`/`monto`.
-- La version anterior de este trigger calculaba el delta de clientes.saldo_actual
-- SOLO en base a tipo/monto (revertir OLD, aplicar NEW), asi que en un UPDATE que
-- unicamente cambia `estado` el resultado neto era cero: el saldo cacheado
-- quedaba permanentemente mal (de mas o de menos, segun el caso) despues de
-- cancelar cualquier cobro. Encontrado en vivo (13/09) al cancelar un cobro de
-- prueba: la cuenta corriente de Cta.Cte. quedo con $1.000 de menos deuda de la
-- que realmente correspondia.
--
-- Fix: el efecto de cada fila sobre saldo_actual ahora depende de su estado —
-- una fila 'cancelado' aporta $0, sin importar tipo/monto. Simetrico para
-- INSERT/DELETE (defensivo, hoy los movimientos siempre nacen 'confirmado' y
-- nunca se borran) y para UPDATE (el caso real: cancelar resta el efecto
-- anterior sin volver a aplicarlo).
CREATE OR REPLACE FUNCTION public.fn_update_cliente_saldo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado = 'confirmado' THEN
      UPDATE public.clientes
        SET saldo_actual = saldo_actual + CASE WHEN NEW.tipo = 'DEBE' THEN NEW.monto ELSE -NEW.monto END
      WHERE id = NEW.cliente_id;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.estado = 'confirmado' THEN
      UPDATE public.clientes
        SET saldo_actual = saldo_actual + CASE WHEN OLD.tipo = 'DEBE' THEN -OLD.monto ELSE OLD.monto END
      WHERE id = OLD.cliente_id;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Revertir el efecto anterior solo si estaba confirmado (evita
    -- revertir dos veces si ya estaba cancelado), aplicar el nuevo solo
    -- si queda confirmado (nunca aplica el efecto de una fila cancelada).
    IF OLD.estado = 'confirmado' THEN
      UPDATE public.clientes
        SET saldo_actual = saldo_actual + CASE WHEN OLD.tipo = 'DEBE' THEN -OLD.monto ELSE OLD.monto END
      WHERE id = OLD.cliente_id;
    END IF;
    IF NEW.estado = 'confirmado' THEN
      UPDATE public.clientes
        SET saldo_actual = saldo_actual + CASE WHEN NEW.tipo = 'DEBE' THEN NEW.monto ELSE -NEW.monto END
      WHERE id = NEW.cliente_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
