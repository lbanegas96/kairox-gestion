-- migration 285 — Cheques de tercero: cerrar el blindspot de 'depositado' y 'descontado'
--
-- HALLAZGO (revisión cruzada de mig.282, sesión 2026-07-31): mig.282 arregló que
-- un asiento que FALLA quede logueado en cheques_asiento_errores. Pero encontró
-- un blindspot más silencioso todavía: los estados 'depositado' y 'descontado'
-- (ambos válidos en TRANSICIONES_TERCERO, shared.jsx) no tienen NINGUNA rama en
-- fn_asiento_cheque_tercero ni en regenerar_asiento_cheque. No fallan: no existen.
-- Por eso no lanzan excepción, no se loguean como error, y nadie se entera.
--
-- Verificado en producción antes de escribir esto: hay 1 cheque real de $80.000
-- (Banco Nación, tercero) en estado 'depositado' con 0 asientos y 0 errores.
--
-- ── Decisión por estado (son casos distintos, no se tratan igual) ──────────────
--
-- 'depositado' → NO genera asiento, Y ESTÁ BIEN ASÍ. El cheque sigue siendo el
--   mismo activo (un cheque de tercero todavía no cobrado); solo cambió de lugar
--   físico (de mi cartera al banco). No hay hecho económico que contabilizar.
--   El circuito ya cierra bien: al pasar a 'cobrado' se hace Debe 1.1.1 Caja /
--   Haber 1.1.6 Cartera, que es el asiento correcto y completo.
--   Lo que sí se arregla acá: que `regenerar_asiento_cheque` explique eso en vez
--   de tirar el mensaje genérico "Estado X no genera asiento contable", que hace
--   pensar que es un bug.
--   (Nota: si en el futuro se quisiera reflejar el depósito en tránsito haría
--   falta una cuenta puente tipo "Valores al Cobro" que hoy NO existe en el plan
--   — no se inventa una acá.)
--
-- 'descontado' → SÍ es un hecho económico real y hoy NO se contabiliza: el banco
--   adelanta la plata antes del vencimiento. El dinero entra al descontar, no al
--   cobrar. Hoy el asiento recién aparece si alguien después marca 'cobrado' —
--   y si nunca lo marca, el cheque queda en cartera contablemente para siempre
--   aunque la plata ya entró. Se agrega la rama que contabiliza el ingreso en el
--   momento correcto, y se evita el doble asiento al pasar después a 'cobrado'
--   (mismo criterio que ya se usa para 'endosado').
--
-- ⚠️ LIMITACIÓN CONOCIDA, deliberada, del asiento de 'descontado': se contabiliza
--   por el monto BRUTO del cheque. El gasto financiero del descuento (la quita
--   del banco) no se registra porque `cheques` no tiene ningún campo donde se
--   capture el neto acreditado ni la tasa. Esto NO es una regresión: hoy ese
--   gasto tampoco se registra (el asiento de 'cobrado' también usa el bruto).
--   Lo único que cambia es CUÁNDO se reconoce el ingreso, que pasa a ser correcto.
--   Registrar el gasto financiero contra 5.5 requiere agregar el campo de monto
--   neto + su input en la UI de cambio de estado — queda documentado como
--   pendiente, fuera del alcance de este fix.

-- ── 1) fn_asiento_cheque_tercero: agregar rama 'descontado' + guard en 'cobrado' ──
CREATE OR REPLACE FUNCTION public.fn_asiento_cheque_tercero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cta_cartera   uuid;
  v_cta_contra    uuid;
  v_cta_rechazado uuid;
  v_asiento_id    uuid;
  v_fecha         date;
  v_cerrado       boolean;
  v_desc          text;
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

      IF NEW.estado = 'endosado' AND OLD.estado <> 'endosado' THEN
        IF NEW.proveedor_id IS NULL THEN RETURN NEW; END IF;
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
        IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque de tercero endosado a proveedor — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_contra,  v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_cartera, v_desc, 0, NEW.monto);

      -- NUEVO (mig.285): el banco adelanta la plata al descontar. El ingreso se
      -- reconoce ACÁ, no al marcarlo 'cobrado' después. Monto bruto — ver la nota
      -- de limitación al inicio de esta migración.
      ELSIF NEW.estado = 'descontado' AND OLD.estado <> 'descontado' THEN
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
        IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque de tercero descontado en banco — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_contra,  v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_cartera, v_desc, 0, NEW.monto);

        IF NEW.cuenta_bancaria_id IS NOT NULL THEN
          INSERT INTO public.movimientos_bancarios
            (empresa_id, cuenta_bancaria_id, fecha, descripcion, monto, tipo, origen, conciliado, asiento_id, created_by)
          VALUES (NEW.empresa_id, NEW.cuenta_bancaria_id, v_fecha, v_desc, NEW.monto, 'ingreso', 'cheque', false, v_asiento_id, NEW.user_id);
        END IF;

      ELSIF NEW.estado = 'cobrado' AND OLD.estado <> 'cobrado' THEN
        -- Si venía de 'endosado' o de 'descontado', el hecho económico YA se
        -- contabilizó en ese momento (mig.285 agregó el caso 'descontado'):
        -- volver a asentar acá duplicaría el ingreso.
        IF OLD.estado IN ('endosado', 'descontado') THEN RETURN NEW; END IF;

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

        IF NEW.cuenta_bancaria_id IS NOT NULL THEN
          INSERT INTO public.movimientos_bancarios
            (empresa_id, cuenta_bancaria_id, fecha, descripcion, monto, tipo, origen, conciliado, asiento_id, created_by)
          VALUES (NEW.empresa_id, NEW.cuenta_bancaria_id, v_fecha, v_desc, NEW.monto, 'ingreso', 'cheque', false, v_asiento_id, NEW.user_id);
        END IF;

      ELSIF NEW.estado = 'rechazado' AND OLD.estado <> 'rechazado' THEN
        SELECT id INTO v_cta_rechazado FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.7' AND activa LIMIT 1;
        IF v_cta_rechazado IS NULL THEN RETURN NEW; END IF;

        IF OLD.estado = 'endosado' THEN
          SELECT id INTO v_cta_contra FROM public.plan_cuentas
          WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
          IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

          v_desc := 'Cheque de tercero rechazado (endosado a proveedor) — ' || NEW.numero || ' (' || NEW.banco || ')';
          INSERT INTO public.asientos_contables
            (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
          VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                  'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
          RETURNING id INTO v_asiento_id;

          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, NEW.empresa_id, v_cta_rechazado, v_desc, NEW.monto, 0),
            (v_asiento_id, NEW.empresa_id, v_cta_contra,    v_desc, 0, NEW.monto);

        -- NUEVO (mig.285): si venía de 'descontado', la plata ya había entrado y
        -- el banco ahora la reclama de vuelta. La contrapartida es Caja (sale la
        -- plata), no Cartera (el cheque ya no estaba en cartera).
        ELSIF OLD.estado = 'descontado' THEN
          SELECT id INTO v_cta_contra FROM public.plan_cuentas
          WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
          IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

          v_desc := 'Cheque de tercero rechazado (descontado en banco) — ' || NEW.numero || ' (' || NEW.banco || ')';
          INSERT INTO public.asientos_contables
            (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
          VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                  'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
          RETURNING id INTO v_asiento_id;

          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, NEW.empresa_id, v_cta_rechazado, v_desc, NEW.monto, 0),
            (v_asiento_id, NEW.empresa_id, v_cta_contra,    v_desc, 0, NEW.monto);

          IF NEW.cuenta_bancaria_id IS NOT NULL THEN
            INSERT INTO public.movimientos_bancarios
              (empresa_id, cuenta_bancaria_id, fecha, descripcion, monto, tipo, origen, conciliado, asiento_id, created_by)
            VALUES (NEW.empresa_id, NEW.cuenta_bancaria_id, v_fecha, v_desc, NEW.monto, 'egreso', 'cheque', false, v_asiento_id, NEW.user_id);
          END IF;

        ELSE
          v_desc := 'Cheque de tercero rechazado — ' || NEW.numero || ' (' || NEW.banco || ')';
          INSERT INTO public.asientos_contables
            (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
          VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                  'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
          RETURNING id INTO v_asiento_id;

          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, NEW.empresa_id, v_cta_rechazado, v_desc, NEW.monto, 0),
            (v_asiento_id, NEW.empresa_id, v_cta_cartera,   v_desc, 0, NEW.monto);
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.cheques_asiento_errores (cheque_id, empresa_id, estado, error_mensaje)
    VALUES (NEW.id, NEW.empresa_id, NEW.estado, SQLERRM);
  END;

  RETURN NEW;
END;
$function$;

-- ── 2) regenerar_asiento_cheque: misma lógica nueva + mensajes que explican ────
CREATE OR REPLACE FUNCTION public.regenerar_asiento_cheque(p_cheque_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id     uuid;
  v_tipo           text;
  v_estado         text;
  v_numero         text;
  v_banco          text;
  v_monto          numeric;
  v_cliente_id     uuid;
  v_proveedor_id   uuid;
  v_cuenta_bancaria_id uuid;
  v_estado_anterior text;
  v_cta_cartera    uuid;
  v_cta_rechazado  uuid;
  v_cta_documentos uuid;
  v_cta_contra     uuid;
  v_cta_caja       uuid;
  v_asiento_id     uuid;
  v_fecha          date;
  v_desc           text;
  v_pendientes     int;
BEGIN
  SELECT empresa_id, tipo, estado, numero, banco, monto, cliente_id, proveedor_id, cuenta_bancaria_id
    INTO v_empresa_id, v_tipo, v_estado, v_numero, v_banco, v_monto, v_cliente_id, v_proveedor_id, v_cuenta_bancaria_id
  FROM public.cheques WHERE id = p_cheque_id FOR UPDATE;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Cheque no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el cheque no pertenece a tu empresa';
  END IF;
  IF NOT has_module_permission('cheques') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo cheques';
  END IF;

  SELECT count(*) INTO v_pendientes
  FROM public.cheques_asiento_errores
  WHERE cheque_id = p_cheque_id AND estado = v_estado AND NOT resuelto;
  IF v_pendientes = 0 THEN
    RAISE EXCEPTION 'Este cheque no tiene un asiento pendiente de regenerar para su estado actual';
  END IF;

  SELECT estado_anterior INTO v_estado_anterior
  FROM public.cheques_historial
  WHERE cheque_id = p_cheque_id AND estado_nuevo = v_estado
  ORDER BY fecha DESC LIMIT 1;

  v_fecha := CURRENT_DATE;

  IF v_tipo = 'tercero' THEN
    SELECT id INTO v_cta_cartera FROM public.plan_cuentas
    WHERE empresa_id = v_empresa_id AND codigo = '1.1.6' AND activa LIMIT 1;
    IF v_cta_cartera IS NULL THEN
      RAISE EXCEPTION 'Falta la cuenta 1.1.6 (Cheques de Terceros en Cartera) en el plan de cuentas';
    END IF;

    IF v_estado = 'en_cartera' THEN
      IF v_cliente_id IS NOT NULL THEN
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = v_empresa_id AND codigo = '1.1.2' AND activa LIMIT 1;
      ELSE
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = v_empresa_id AND codigo = '4.3' AND activa LIMIT 1;
      END IF;
      IF v_cta_contra IS NULL THEN RAISE EXCEPTION 'Falta la cuenta contrapartida en el plan de cuentas'; END IF;

      v_desc := 'Cheque de tercero recibido — ' || v_numero || ' (' || v_banco || ') (regenerado)';
      INSERT INTO public.asientos_contables
        (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
      VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha, v_desc,
              'confirmado', v_monto, v_monto, 'cheque_tercero', p_cheque_id)
      RETURNING id INTO v_asiento_id;
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, v_empresa_id, v_cta_cartera, v_desc, v_monto, 0),
        (v_asiento_id, v_empresa_id, v_cta_contra,  v_desc, 0, v_monto);

    ELSIF v_estado = 'endosado' THEN
      IF v_proveedor_id IS NULL THEN RAISE EXCEPTION 'El cheque no tiene proveedor de endoso asignado'; END IF;
      SELECT id INTO v_cta_contra FROM public.plan_cuentas
      WHERE empresa_id = v_empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
      IF v_cta_contra IS NULL THEN RAISE EXCEPTION 'Falta la cuenta 2.1.1 (Cuentas a Pagar)'; END IF;

      v_desc := 'Cheque de tercero endosado a proveedor — ' || v_numero || ' (' || v_banco || ') (regenerado)';
      INSERT INTO public.asientos_contables
        (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
      VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha, v_desc,
              'confirmado', v_monto, v_monto, 'cheque_tercero', p_cheque_id)
      RETURNING id INTO v_asiento_id;
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, v_empresa_id, v_cta_contra,  v_desc, v_monto, 0),
        (v_asiento_id, v_empresa_id, v_cta_cartera, v_desc, 0, v_monto);

    -- NUEVO (mig.285)
    ELSIF v_estado = 'descontado' THEN
      SELECT id INTO v_cta_contra FROM public.plan_cuentas
      WHERE empresa_id = v_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
      IF v_cta_contra IS NULL THEN RAISE EXCEPTION 'Falta la cuenta 1.1.1 (Caja y Bancos)'; END IF;

      v_desc := 'Cheque de tercero descontado en banco — ' || v_numero || ' (' || v_banco || ') (regenerado)';
      INSERT INTO public.asientos_contables
        (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
      VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha, v_desc,
              'confirmado', v_monto, v_monto, 'cheque_tercero', p_cheque_id)
      RETURNING id INTO v_asiento_id;
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, v_empresa_id, v_cta_contra,  v_desc, v_monto, 0),
        (v_asiento_id, v_empresa_id, v_cta_cartera, v_desc, 0, v_monto);

      IF v_cuenta_bancaria_id IS NOT NULL THEN
        INSERT INTO public.movimientos_bancarios
          (empresa_id, cuenta_bancaria_id, fecha, descripcion, monto, tipo, origen, conciliado, asiento_id, created_by)
        VALUES (v_empresa_id, v_cuenta_bancaria_id, v_fecha, v_desc, v_monto, 'ingreso', 'cheque', false, v_asiento_id, p_user_id);
      END IF;

    ELSIF v_estado = 'cobrado' THEN
      IF v_estado_anterior IN ('endosado', 'descontado') THEN
        RAISE EXCEPTION 'Un cheque cobrado que venía de "%" no genera asiento propio (el ingreso ya se contabilizó en ese momento)', v_estado_anterior;
      END IF;
      SELECT id INTO v_cta_contra FROM public.plan_cuentas
      WHERE empresa_id = v_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
      IF v_cta_contra IS NULL THEN RAISE EXCEPTION 'Falta la cuenta 1.1.1 (Caja y Bancos)'; END IF;

      v_desc := 'Cheque de tercero cobrado — ' || v_numero || ' (' || v_banco || ') (regenerado)';
      INSERT INTO public.asientos_contables
        (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
      VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha, v_desc,
              'confirmado', v_monto, v_monto, 'cheque_tercero', p_cheque_id)
      RETURNING id INTO v_asiento_id;
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, v_empresa_id, v_cta_contra,  v_desc, v_monto, 0),
        (v_asiento_id, v_empresa_id, v_cta_cartera, v_desc, 0, v_monto);

      IF v_cuenta_bancaria_id IS NOT NULL THEN
        INSERT INTO public.movimientos_bancarios
          (empresa_id, cuenta_bancaria_id, fecha, descripcion, monto, tipo, origen, conciliado, asiento_id, created_by)
        VALUES (v_empresa_id, v_cuenta_bancaria_id, v_fecha, v_desc, v_monto, 'ingreso', 'cheque', false, v_asiento_id, p_user_id);
      END IF;

    ELSIF v_estado = 'rechazado' THEN
      SELECT id INTO v_cta_rechazado FROM public.plan_cuentas
      WHERE empresa_id = v_empresa_id AND codigo = '1.1.7' AND activa LIMIT 1;
      IF v_cta_rechazado IS NULL THEN RAISE EXCEPTION 'Falta la cuenta 1.1.7 (Cheques Rechazados)'; END IF;

      IF v_estado_anterior = 'endosado' THEN
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = v_empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
        IF v_cta_contra IS NULL THEN RAISE EXCEPTION 'Falta la cuenta 2.1.1 (Cuentas a Pagar)'; END IF;

        v_desc := 'Cheque de tercero rechazado (endosado a proveedor) — ' || v_numero || ' (' || v_banco || ') (regenerado)';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha, v_desc,
                'confirmado', v_monto, v_monto, 'cheque_tercero', p_cheque_id)
        RETURNING id INTO v_asiento_id;
        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, v_empresa_id, v_cta_rechazado, v_desc, v_monto, 0),
          (v_asiento_id, v_empresa_id, v_cta_contra,    v_desc, 0, v_monto);

      -- NUEVO (mig.285)
      ELSIF v_estado_anterior = 'descontado' THEN
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = v_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
        IF v_cta_contra IS NULL THEN RAISE EXCEPTION 'Falta la cuenta 1.1.1 (Caja y Bancos)'; END IF;

        v_desc := 'Cheque de tercero rechazado (descontado en banco) — ' || v_numero || ' (' || v_banco || ') (regenerado)';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha, v_desc,
                'confirmado', v_monto, v_monto, 'cheque_tercero', p_cheque_id)
        RETURNING id INTO v_asiento_id;
        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, v_empresa_id, v_cta_rechazado, v_desc, v_monto, 0),
          (v_asiento_id, v_empresa_id, v_cta_contra,    v_desc, 0, v_monto);

        IF v_cuenta_bancaria_id IS NOT NULL THEN
          INSERT INTO public.movimientos_bancarios
            (empresa_id, cuenta_bancaria_id, fecha, descripcion, monto, tipo, origen, conciliado, asiento_id, created_by)
          VALUES (v_empresa_id, v_cuenta_bancaria_id, v_fecha, v_desc, v_monto, 'egreso', 'cheque', false, v_asiento_id, p_user_id);
        END IF;

      ELSE
        v_desc := 'Cheque de tercero rechazado — ' || v_numero || ' (' || v_banco || ') (regenerado)';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha, v_desc,
                'confirmado', v_monto, v_monto, 'cheque_tercero', p_cheque_id)
        RETURNING id INTO v_asiento_id;
        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, v_empresa_id, v_cta_rechazado, v_desc, v_monto, 0),
          (v_asiento_id, v_empresa_id, v_cta_cartera,   v_desc, 0, v_monto);
      END IF;

    ELSIF v_estado = 'depositado' THEN
      -- Ver la nota al inicio de mig.285: 'depositado' no genera asiento por
      -- diseño, no por olvido. El mensaje lo explica para que nadie lo lea como bug.
      RAISE EXCEPTION 'El estado "depositado" no genera asiento por diseño: el cheque sigue siendo el mismo activo, solo cambió de ubicación física. El asiento se genera al pasar a "cobrado".';
    ELSE
      RAISE EXCEPTION 'Estado % no genera asiento contable', v_estado;
    END IF;

  ELSE -- propio
    SELECT id INTO v_cta_documentos FROM public.plan_cuentas
    WHERE empresa_id = v_empresa_id AND codigo = '2.1.6' AND activa LIMIT 1;
    IF v_cta_documentos IS NULL THEN
      RAISE EXCEPTION 'Falta la cuenta 2.1.6 (Documentos a Pagar) en el plan de cuentas';
    END IF;

    IF v_estado = 'entregado' THEN
      IF v_proveedor_id IS NULL THEN RAISE EXCEPTION 'El cheque no tiene proveedor asignado'; END IF;
      SELECT id INTO v_cta_contra FROM public.plan_cuentas
      WHERE empresa_id = v_empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
      IF v_cta_contra IS NULL THEN RAISE EXCEPTION 'Falta la cuenta 2.1.1 (Cuentas a Pagar)'; END IF;

      v_desc := 'Cheque propio entregado — ' || v_numero || ' (' || v_banco || ') (regenerado)';
      INSERT INTO public.asientos_contables
        (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
      VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha, v_desc,
              'confirmado', v_monto, v_monto, 'cheque_propio', p_cheque_id)
      RETURNING id INTO v_asiento_id;
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, v_empresa_id, v_cta_contra,     v_desc, v_monto, 0),
        (v_asiento_id, v_empresa_id, v_cta_documentos, v_desc, 0, v_monto);

    ELSIF v_estado = 'cobrado' THEN
      SELECT id INTO v_cta_caja FROM public.plan_cuentas
      WHERE empresa_id = v_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
      IF v_cta_caja IS NULL THEN RAISE EXCEPTION 'Falta la cuenta 1.1.1 (Caja y Bancos)'; END IF;

      v_desc := 'Cheque propio cobrado/debitado — ' || v_numero || ' (' || v_banco || ') (regenerado)';
      INSERT INTO public.asientos_contables
        (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
      VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha, v_desc,
              'confirmado', v_monto, v_monto, 'cheque_propio', p_cheque_id)
      RETURNING id INTO v_asiento_id;
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, v_empresa_id, v_cta_documentos, v_desc, v_monto, 0),
        (v_asiento_id, v_empresa_id, v_cta_caja,       v_desc, 0, v_monto);

      IF v_cuenta_bancaria_id IS NOT NULL THEN
        INSERT INTO public.movimientos_bancarios
          (empresa_id, cuenta_bancaria_id, fecha, descripcion, monto, tipo, origen, conciliado, asiento_id, created_by)
        VALUES (v_empresa_id, v_cuenta_bancaria_id, v_fecha, v_desc, v_monto, 'egreso', 'cheque', false, v_asiento_id, p_user_id);
      END IF;

    ELSIF v_estado = 'rechazado' THEN
      SELECT id INTO v_cta_contra FROM public.plan_cuentas
      WHERE empresa_id = v_empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
      IF v_cta_contra IS NULL THEN RAISE EXCEPTION 'Falta la cuenta 2.1.1 (Cuentas a Pagar)'; END IF;

      v_desc := 'Cheque propio rechazado — ' || v_numero || ' (' || v_banco || ') (regenerado)';
      INSERT INTO public.asientos_contables
        (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
      VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha, v_desc,
              'confirmado', v_monto, v_monto, 'cheque_propio', p_cheque_id)
      RETURNING id INTO v_asiento_id;
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, v_empresa_id, v_cta_documentos, v_desc, v_monto, 0),
        (v_asiento_id, v_empresa_id, v_cta_contra,     v_desc, 0, v_monto);
    ELSE
      RAISE EXCEPTION 'Estado % no genera asiento contable', v_estado;
    END IF;
  END IF;

  UPDATE public.cheques_asiento_errores
  SET resuelto = true, resuelto_at = now()
  WHERE cheque_id = p_cheque_id AND estado = v_estado AND NOT resuelto;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.regenerar_asiento_cheque(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerar_asiento_cheque(uuid, uuid) TO authenticated;

-- ROLLBACK (comentado): recrear fn_asiento_cheque_tercero y regenerar_asiento_cheque
-- con el body de mig.282 (sin las ramas 'descontado' ni el guard OLD.estado IN
-- ('endosado','descontado') en 'cobrado').
