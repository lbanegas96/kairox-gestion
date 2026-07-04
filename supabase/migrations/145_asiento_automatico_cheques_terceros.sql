-- ════════════════════════════════════════════════════════════════════════════
-- migration 145 — Cierre de gap sistémico: Cheques de terceros → contabilización
-- ════════════════════════════════════════════════════════════════════════════
--
-- Gap documentado en PLAN_AUDITORIA.md (Cheques, sesión 44): el módulo de
-- Cheques es un tracker aislado que no impacta el motor contable. La cuenta
-- "1.1.6 Cheques de Terceros en Cartera" ya estaba seedeada en el plan de
-- cuentas pero sin ningún uso real en el código — se implementa acá.
--
-- ESQUEMA PROPUESTO (a validar por el contador — documentado en
-- PLAN_AUDITORIA.md). Solo cheques de terceros (recibidos); cheques propios
-- quedan fuera de este alcance (requieren otra cuenta "Documentos a Pagar"
-- que todavía no existe en el plan de cuentas — pendiente si el contador lo
-- pide):
--   Recibido (INSERT, estado inicial 'en_cartera'):
--     DEBE 1.1.6 Cheques de Terceros en Cartera
--     HABER 1.1.2 Cuentas a Cobrar (si tiene cliente_id) o 4.3 Otros Ingresos
--   Cobrado (transición a 'cobrado', desde cualquier estado previo):
--     DEBE 1.1.1 Caja y Bancos / HABER 1.1.6
--   Rechazado (transición a 'rechazado'): reversa simétrica al recibido —
--     DEBE 1.1.2 (o 4.3) / HABER 1.1.6 — restaura la deuda del cliente.
--
-- No bloqueante: si falta alguna cuenta o el período está cerrado, el cambio
-- de estado del cheque se completa igual (mismo patrón que asientosAutoService).

CREATE OR REPLACE FUNCTION public.fn_asiento_cheque_tercero()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cta_cartera uuid;
  v_cta_contra  uuid;
  v_asiento_id  uuid;
  v_fecha       date;
  v_cerrado     boolean;
  v_desc        text;
BEGIN
  IF NEW.tipo <> 'tercero' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT id INTO v_cta_cartera FROM public.plan_cuentas
    WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.6' AND activa LIMIT 1;
    IF v_cta_cartera IS NULL THEN RETURN NEW; END IF;

    IF TG_OP = 'INSERT' THEN
      v_fecha := COALESCE(NEW.fecha_emision, CURRENT_DATE);
      SELECT fecha_en_periodo_cerrado(NEW.empresa_id, v_fecha) INTO v_cerrado;
      IF COALESCE(v_cerrado, false) THEN RETURN NEW; END IF;

      IF NEW.cliente_id IS NOT NULL THEN
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.2' AND activa LIMIT 1;
      ELSE
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '4.3' AND activa LIMIT 1;
      END IF;
      IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

      v_desc := 'Cheque de tercero recibido — ' || NEW.numero || ' (' || NEW.banco || ')';
      INSERT INTO public.asientos_contables
        (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
      VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
              'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
      RETURNING id INTO v_asiento_id;

      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, NEW.empresa_id, v_cta_cartera, v_desc, NEW.monto, 0),
        (v_asiento_id, NEW.empresa_id, v_cta_contra,  v_desc, 0, NEW.monto);

    ELSIF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
      v_fecha := CURRENT_DATE;
      SELECT fecha_en_periodo_cerrado(NEW.empresa_id, v_fecha) INTO v_cerrado;
      IF COALESCE(v_cerrado, false) THEN RETURN NEW; END IF;

      IF NEW.estado = 'cobrado' AND OLD.estado <> 'cobrado' THEN
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
        IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque de tercero cobrado — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_contra,  v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_cartera, v_desc, 0, NEW.monto);

      ELSIF NEW.estado = 'rechazado' AND OLD.estado <> 'rechazado' THEN
        IF NEW.cliente_id IS NOT NULL THEN
          SELECT id INTO v_cta_contra FROM public.plan_cuentas
          WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.2' AND activa LIMIT 1;
        ELSE
          SELECT id INTO v_cta_contra FROM public.plan_cuentas
          WHERE empresa_id = NEW.empresa_id AND codigo = '4.3' AND activa LIMIT 1;
        END IF;
        IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque de tercero rechazado — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_contra,  v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_cartera, v_desc, 0, NEW.monto);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- no bloqueante: el cheque se registra/actualiza igual sin asiento
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asiento_cheque_tercero_insert ON public.cheques;
CREATE TRIGGER trg_asiento_cheque_tercero_insert
  AFTER INSERT ON public.cheques
  FOR EACH ROW EXECUTE FUNCTION public.fn_asiento_cheque_tercero();

DROP TRIGGER IF EXISTS trg_asiento_cheque_tercero_update ON public.cheques;
CREATE TRIGGER trg_asiento_cheque_tercero_update
  AFTER UPDATE OF estado ON public.cheques
  FOR EACH ROW EXECUTE FUNCTION public.fn_asiento_cheque_tercero();

REVOKE EXECUTE ON FUNCTION public.fn_asiento_cheque_tercero() FROM PUBLIC, anon, authenticated;
