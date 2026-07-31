-- migration 282 — Cheques: visibilizar y permitir regenerar un asiento contable fallido
--
-- HALLAZGO (auditoría contable, sesión 2026-07-30): fn_asiento_cheque_tercero y
-- fn_asiento_cheque_propio (mig.145/166/182) envuelven TODO el bloque contable en
-- `EXCEPTION WHEN OTHERS THEN NULL`. Si falta una cuenta del plan (1.1.6, 1.1.7,
-- 2.1.6, etc.) o cualquier otro error inesperado, el cheque cambia de estado
-- normalmente pero el asiento NUNCA se genera — y no queda ningún rastro visible
-- para el usuario (a diferencia del patrón usado en Ventas/Compras: toast +
-- botón "Regenerar asiento", mig.281).
--
-- Fix: en vez de tragarse el error en silencio, se registra en una tabla de log
-- (cheques_asiento_errores) y se agrega un RPC regenerar_asiento_cheque que
-- reconstruye el asiento correspondiente al estado ACTUAL del cheque, con la
-- misma lógica que el trigger. Sigue siendo no bloqueante: el cambio de estado
-- del cheque nunca falla por esto.

-- 1) Tabla de log de asientos fallidos
CREATE TABLE IF NOT EXISTS public.cheques_asiento_errores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cheque_id     uuid NOT NULL REFERENCES public.cheques(id),
  empresa_id    uuid NOT NULL,
  estado        text NOT NULL,
  error_mensaje text,
  resuelto      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resuelto_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_cheques_asiento_errores_pendientes
  ON public.cheques_asiento_errores (empresa_id) WHERE NOT resuelto;

ALTER TABLE public.cheques_asiento_errores ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.cheques_asiento_errores
  USING (empresa_id = get_my_empresa_id());

-- 2) fn_asiento_cheque_tercero: loguear en vez de tragarse el error
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

      ELSIF NEW.estado = 'cobrado' AND OLD.estado <> 'cobrado' THEN
        IF OLD.estado = 'endosado' THEN RETURN NEW; END IF;

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

-- 3) fn_asiento_cheque_propio: mismo cambio
CREATE OR REPLACE FUNCTION public.fn_asiento_cheque_propio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cta_documentos uuid;
  v_cta_cxp        uuid;
  v_cta_caja       uuid;
  v_asiento_id     uuid;
  v_fecha          date;
  v_cerrado        boolean;
  v_desc           text;
BEGIN
  IF NEW.tipo <> 'propio' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT id INTO v_cta_documentos FROM public.plan_cuentas
    WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.6' AND activa LIMIT 1;
    IF v_cta_documentos IS NULL THEN RETURN NEW; END IF;

    IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
      v_fecha := CURRENT_DATE;
      SELECT fecha_en_periodo_cerrado(NEW.empresa_id, v_fecha) INTO v_cerrado;
      IF COALESCE(v_cerrado, false) THEN RETURN NEW; END IF;

      IF NEW.estado = 'entregado' AND OLD.estado <> 'entregado' THEN
        IF NEW.proveedor_id IS NULL THEN RETURN NEW; END IF;
        SELECT id INTO v_cta_cxp FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
        IF v_cta_cxp IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque propio entregado — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_propio', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_cxp,        v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_documentos, v_desc, 0, NEW.monto);

      ELSIF NEW.estado = 'cobrado' AND OLD.estado <> 'cobrado' THEN
        SELECT id INTO v_cta_caja FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
        IF v_cta_caja IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque propio cobrado/debitado — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_propio', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_documentos, v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_caja,       v_desc, 0, NEW.monto);

        IF NEW.cuenta_bancaria_id IS NOT NULL THEN
          INSERT INTO public.movimientos_bancarios
            (empresa_id, cuenta_bancaria_id, fecha, descripcion, monto, tipo, origen, conciliado, asiento_id, created_by)
          VALUES (NEW.empresa_id, NEW.cuenta_bancaria_id, v_fecha, v_desc, NEW.monto, 'egreso', 'cheque', false, v_asiento_id, NEW.user_id);
        END IF;

      ELSIF NEW.estado = 'rechazado' AND OLD.estado = 'entregado' THEN
        SELECT id INTO v_cta_cxp FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
        IF v_cta_cxp IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque propio rechazado — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_propio', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_documentos, v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_cxp,        v_desc, 0, NEW.monto);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.cheques_asiento_errores (cheque_id, empresa_id, estado, error_mensaje)
    VALUES (NEW.id, NEW.empresa_id, NEW.estado, SQLERRM);
  END;

  RETURN NEW;
END;
$function$;

-- 4) RPC regenerar_asiento_cheque: reconstruye el asiento del estado ACTUAL del
-- cheque, reusando la misma lógica que los triggers de arriba. Solo actúa si hay
-- un error pendiente logueado (evita duplicar un asiento que sí se generó bien).
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

  -- estado inmediatamente anterior al actual, para las mismas ramas condicionales
  -- que usan los triggers (ej. cobrado/rechazado que vienen de 'endosado')
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

    ELSIF v_estado = 'cobrado' THEN
      IF v_estado_anterior = 'endosado' THEN
        RAISE EXCEPTION 'Un cheque cobrado que venía de "endosado" no genera asiento propio (ya se contabilizó al endosarlo)';
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

-- ROLLBACK (comentado): DROP FUNCTION regenerar_asiento_cheque; recrear
-- fn_asiento_cheque_tercero/fn_asiento_cheque_propio con el body previo a esta
-- migration (EXCEPTION WHEN OTHERS THEN NULL, sin insertar en cheques_asiento_errores);
-- DROP TABLE cheques_asiento_errores.
