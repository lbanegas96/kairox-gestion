-- migration 129 — Hardening concurrencia: FOR UPDATE al leer el movimiento
--
-- HALLAZGO (auditoría sesión 44): contabilizar_movimiento_bancario (migration 127)
-- leía el movimiento sin bloqueo de fila. Dos admins contabilizando el MISMO
-- movimiento en simultáneo podían pasar ambos el guard `asiento_id IS NULL` y crear
-- 2 asientos (uno queda huérfano). Muy improbable en una PyME (1-2 usuarios), pero el
-- patrón correcto para una función de contabilización es tomar un lock de fila —
-- mismo criterio que ya se aplicó a las RPCs de stock (FOR UPDATE).
--
-- Único cambio vs migration 127: `SELECT ... FOR UPDATE` al leer el movimiento.
--
-- ROLLBACK: reaplicar la versión de migration 127 (sin FOR UPDATE).

CREATE OR REPLACE FUNCTION public.contabilizar_movimiento_bancario(p_movimiento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mov        RECORD;
  v_banco_cta  uuid;
  v_contra_cta uuid;
  v_asiento_id uuid;
  v_numero     text;
  v_fecha      date;
  v_cerrado    boolean;
BEGIN
  -- FOR UPDATE: serializa contabilizaciones concurrentes del mismo movimiento
  SELECT * INTO v_mov FROM public.movimientos_bancarios WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimiento no encontrado'; END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_mov.empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: el movimiento no pertenece a tu empresa';
    END IF;
    IF NOT is_admin() THEN
      RAISE EXCEPTION 'No autorizado: solo un administrador puede contabilizar movimientos';
    END IF;
  END IF;

  IF v_mov.asiento_id IS NOT NULL THEN
    RAISE EXCEPTION 'El movimiento ya está contabilizado';
  END IF;

  v_fecha := (v_mov.fecha)::date;

  BEGIN
    SELECT fecha_en_periodo_cerrado(v_mov.empresa_id, v_fecha) INTO v_cerrado;
    IF v_cerrado THEN
      RAISE EXCEPTION 'Período cerrado: la fecha % pertenece a un período contable cerrado', v_fecha;
    END IF;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  SELECT plan_cuenta_id INTO v_banco_cta
  FROM public.cuentas_bancarias WHERE id = v_mov.cuenta_bancaria_id;
  IF v_banco_cta IS NULL THEN
    RAISE EXCEPTION 'La cuenta bancaria no tiene una cuenta contable vinculada. Vinculala en Bancos → Editar cuenta.';
  END IF;

  SELECT cuenta_contable_id INTO v_contra_cta
  FROM public.determinacion_cuentas_mayor d
  WHERE d.empresa_id = v_mov.empresa_id
    AND d.activo
    AND (d.origen = v_mov.origen OR d.origen = '*')
    AND (d.tipo   = v_mov.tipo   OR d.tipo   = '*')
    AND (d.subtipo IS NULL OR d.subtipo = v_mov.subtipo)
    AND (d.cuenta_bancaria_id IS NULL OR d.cuenta_bancaria_id = v_mov.cuenta_bancaria_id)
  ORDER BY
    (d.cuenta_bancaria_id IS NOT NULL) DESC,
    (d.subtipo IS NOT NULL)            DESC,
    (d.origen <> '*')                  DESC,
    (d.tipo   <> '*')                  DESC,
    d.prioridad ASC
  LIMIT 1;

  IF v_contra_cta IS NULL THEN
    RAISE EXCEPTION 'Sin regla de determinación para (origen=%, tipo=%, subtipo=%). Configurá una en Configuración → Determinación de Cuentas.',
      v_mov.origen, v_mov.tipo, COALESCE(v_mov.subtipo, '—');
  END IF;

  v_numero := next_numero_asiento(v_mov.empresa_id);

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (
    v_mov.empresa_id,
    COALESCE(auth.uid(), v_mov.created_by),
    v_numero, v_fecha,
    'Movimiento bancario: ' || COALESCE(v_mov.descripcion, ''),
    'confirmado', v_mov.monto, v_mov.monto, 'banco', v_mov.id
  ) RETURNING id INTO v_asiento_id;

  IF v_mov.tipo = 'ingreso' THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_mov.empresa_id, v_banco_cta,  'Ingreso — ' || COALESCE(v_mov.descripcion, ''), v_mov.monto, 0),
      (v_asiento_id, v_mov.empresa_id, v_contra_cta, COALESCE(v_mov.descripcion, 'Contrapartida'),    0,          v_mov.monto);
  ELSE
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_mov.empresa_id, v_contra_cta, COALESCE(v_mov.descripcion, 'Contrapartida'),    v_mov.monto, 0),
      (v_asiento_id, v_mov.empresa_id, v_banco_cta,  'Egreso — ' || COALESCE(v_mov.descripcion, ''),  0,           v_mov.monto);
  END IF;

  UPDATE public.movimientos_bancarios SET asiento_id = v_asiento_id WHERE id = v_mov.id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id, 'numero', v_numero);
END;
$function$;
