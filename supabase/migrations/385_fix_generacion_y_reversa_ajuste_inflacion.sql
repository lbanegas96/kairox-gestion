-- Migration 385 -- Ajuste por Inflación: 2 fixes encontrados en la auditoría
-- contable de código pedida por Luciano (02/09).
--
-- ═══════════════════════════════════════════════════════════════════════
-- BUG CRÍTICO ENCONTRADO Y CONFIRMADO EN VIVO (BEGIN...ROLLBACK contra Nalux
-- real): generar_ajuste_por_inflacion (mig.378) llama a
-- crear_asiento_automatico (mig.314) para postear el asiento -- pero esa
-- función SIEMPRE llama a fecha_en_periodo_cerrado() y bloquea con
-- excepción si la fecha cae en un período 'cerrado'. El botón "Ajuste por
-- Inflación" en TabPeriodos.jsx SOLO aparece cuando el período YA está
-- 'cerrado' (es su precondición) -- así que la función se auto-bloqueaba
-- SIEMPRE. Confirmado con una simulación real: marcar un período de Nalux
-- como 'cerrado' y llamar generar_ajuste_por_inflacion() -> "ERROR: Período
-- cerrado: la fecha 2026-07-31 pertenece a un período contable cerrado".
--
-- Nunca se detectó antes porque:
--   1. Ningún período de Nalux estuvo REALMENTE 'cerrado' en producción
--      todavía (ambos períodos reales siguen 'abierto').
--   2. El recorrido de Luciano y el de Nadia (dos validaciones previas)
--      pararon deliberadamente en la VISTA PREVIA (calcular_preview_...),
--      que no pasa por este camino -- nunca se probó "Confirmar" de verdad.
--
-- Mismo problema ya resuelto correctamente en cerrar_ejercicio_contable
-- (mig.283): esa función NO usa crear_asiento_automatico, inserta directo
-- en asientos_contables/asientos_items -- es el patrón correcto para un
-- asiento que por diseño se genera DESPUÉS de cerrar el período. Fix acá:
-- el mismo patrón, para generar_ajuste_por_inflacion.
--
-- ═══════════════════════════════════════════════════════════════════════
-- SEGUNDO FIX: reversa. Pedido explícito de Luciano tras la auditoría --
-- generar_ajuste_por_inflacion posteaba directo en 'confirmado' (nunca
-- 'borrador'), así que anular_asiento (que solo actúa sobre 'borrador') no
-- servía, y no existía ningún crearAsientoReversaAjusteInflacion como sí
-- existe para venta/cobro/NC. Se agrega revertir_ajuste_por_inflacion,
-- mismo patrón de reversa que el resto del sistema (asiento original
-- INTOCABLE, se postea uno nuevo con debe/haber invertidos) pero con
-- inserción directa (mismo motivo que el fix de arriba: el período sigue
-- cerrado, crear_asiento_automatico lo seguiría bloqueando).
--
-- ROLLBACK: recrear generar_ajuste_por_inflacion con el texto de mig.378
-- (llamando a crear_asiento_automatico) y DROP FUNCTION
-- revertir_ajuste_por_inflacion(uuid, uuid).

CREATE OR REPLACE FUNCTION public.generar_ajuste_por_inflacion(p_periodo_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id       UUID;
  v_nombre           TEXT;
  v_fecha_cierre     DATE;
  v_asiento_ajuste_id UUID;
  v_cta_ganancia     UUID;
  v_cta_perdida      UUID;
  v_nuevo_asiento_id UUID;
  v_numero           TEXT;
  v_desc             TEXT;
  v_linea            RECORD;
  v_total_debe       NUMERIC := 0;
  v_total_haber      NUMERIC := 0;
  v_lineas_generadas INT := 0;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado: el ajuste por inflación requiere rol admin';
  END IF;

  SELECT empresa_id, nombre, fecha_cierre, asiento_ajuste_inflacion_id
    INTO v_empresa_id, v_nombre, v_fecha_cierre, v_asiento_ajuste_id
  FROM public.periodos_contables WHERE id = p_periodo_id FOR UPDATE;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Período no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el período no pertenece a tu empresa';
  END IF;
  IF v_asiento_ajuste_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este período ya tiene un ajuste por inflación generado';
  END IF;

  SELECT id INTO v_cta_ganancia FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '4.7' AND activa LIMIT 1;
  SELECT id INTO v_cta_perdida  FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '5.12' AND activa LIMIT 1;
  IF v_cta_ganancia IS NULL OR v_cta_perdida IS NULL THEN
    RAISE EXCEPTION 'Faltan las cuentas 4.7/5.12 (RECPAM) en el plan de cuentas';
  END IF;

  v_desc := 'Ajuste por Inflación (RT 6) — ' || v_nombre;

  -- Inserción DIRECTA (no vía crear_asiento_automatico) -- mismo motivo y
  -- mismo patrón que cerrar_ejercicio_contable (mig.283): este asiento por
  -- diseño se genera con el período YA cerrado, y crear_asiento_automatico
  -- bloquearía cualquier fecha dentro de un período 'cerrado' sin excepción.
  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha_cierre, v_desc,
          'confirmado', 0, 0, 'ajuste_inflacion', p_periodo_id)
  RETURNING id, numero INTO v_nuevo_asiento_id, v_numero;

  FOR v_linea IN SELECT * FROM public._lineas_ajuste_por_inflacion(p_periodo_id) LOOP
    IF (v_linea.tipo IN ('activo', 'egreso')) = (v_linea.monto_ajuste > 0) THEN
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
      VALUES (v_nuevo_asiento_id, v_empresa_id, v_linea.cuenta_id, v_desc, round(abs(v_linea.monto_ajuste), 2), 0);
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
      VALUES (v_nuevo_asiento_id, v_empresa_id, v_cta_ganancia, v_desc, 0, round(abs(v_linea.monto_ajuste), 2));
    ELSE
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
      VALUES (v_nuevo_asiento_id, v_empresa_id, v_cta_perdida, v_desc, round(abs(v_linea.monto_ajuste), 2), 0);
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
      VALUES (v_nuevo_asiento_id, v_empresa_id, v_linea.cuenta_id, v_desc, 0, round(abs(v_linea.monto_ajuste), 2));
    END IF;
    v_total_debe := v_total_debe + round(abs(v_linea.monto_ajuste), 2);
    v_total_haber := v_total_haber + round(abs(v_linea.monto_ajuste), 2);
    v_lineas_generadas := v_lineas_generadas + 1;
  END LOOP;

  IF v_lineas_generadas = 0 THEN
    DELETE FROM public.asientos_contables WHERE id = v_nuevo_asiento_id;
    RETURN jsonb_build_object('ok', true, 'asiento_id', NULL, 'mensaje', 'Sin partidas no monetarias con saldo en el ejercicio — no se generó asiento');
  END IF;

  UPDATE public.asientos_contables
  SET total_debe = v_total_debe, total_haber = v_total_haber
  WHERE id = v_nuevo_asiento_id;

  UPDATE public.periodos_contables
  SET asiento_ajuste_inflacion_id = v_nuevo_asiento_id
  WHERE id = p_periodo_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_nuevo_asiento_id, 'numero', v_numero);
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════
-- revertir_ajuste_por_inflacion -- deshace un ajuste confirmado por error.
-- El asiento original NUNCA se toca (queda 'confirmado' de por vida, mismo
-- criterio de inmutabilidad que el resto del sistema) -- se postea uno
-- NUEVO con debe/haber invertidos, fechado el mismo día que el original
-- (para que el efecto neto en ESE período quede en cero, como si el error
-- nunca hubiera pasado). Libera periodos_contables.asiento_ajuste_inflacion_id
-- para poder generar el ajuste de nuevo, correctamente, después.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.revertir_ajuste_por_inflacion(p_periodo_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id        UUID;
  v_nombre            TEXT;
  v_fecha_cierre      DATE;
  v_asiento_original  UUID;
  v_nuevo_asiento_id  UUID;
  v_numero            TEXT;
  v_desc              TEXT;
  v_total_debe        NUMERIC := 0;
  v_total_haber       NUMERIC := 0;
  v_item              RECORD;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado: revertir el ajuste por inflación requiere rol admin';
  END IF;

  SELECT empresa_id, nombre, fecha_cierre, asiento_ajuste_inflacion_id
    INTO v_empresa_id, v_nombre, v_fecha_cierre, v_asiento_original
  FROM public.periodos_contables WHERE id = p_periodo_id FOR UPDATE;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Período no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el período no pertenece a tu empresa';
  END IF;
  IF v_asiento_original IS NULL THEN
    RAISE EXCEPTION 'Este período no tiene un ajuste por inflación generado para revertir';
  END IF;

  v_desc := 'Reversa — Ajuste por Inflación (RT 6) — ' || v_nombre;

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha_cierre, v_desc,
          'confirmado', 0, 0, 'reversa_ajuste_inflacion', p_periodo_id)
  RETURNING id, numero INTO v_nuevo_asiento_id, v_numero;

  FOR v_item IN
    SELECT cuenta_id, debe, haber FROM public.asientos_items WHERE asiento_id = v_asiento_original
  LOOP
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
    VALUES (v_nuevo_asiento_id, v_empresa_id, v_item.cuenta_id, v_desc, v_item.haber, v_item.debe);
    v_total_debe := v_total_debe + v_item.haber;
    v_total_haber := v_total_haber + v_item.debe;
  END LOOP;

  IF v_total_debe = 0 AND v_total_haber = 0 THEN
    DELETE FROM public.asientos_contables WHERE id = v_nuevo_asiento_id;
    RAISE EXCEPTION 'El asiento original no tiene líneas -- nada para revertir';
  END IF;

  UPDATE public.asientos_contables
  SET total_debe = v_total_debe, total_haber = v_total_haber
  WHERE id = v_nuevo_asiento_id;

  -- Libera el período para poder generar el ajuste de nuevo. El asiento
  -- original queda intacto en el Libro Mayor (con su reversa al lado) --
  -- nunca se borra ni se modifica, mismo criterio de inmutabilidad de
  -- mig.314.
  UPDATE public.periodos_contables
  SET asiento_ajuste_inflacion_id = NULL
  WHERE id = p_periodo_id;

  RETURN jsonb_build_object('ok', true, 'asiento_reversa_id', v_nuevo_asiento_id, 'numero', v_numero);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.revertir_ajuste_por_inflacion(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revertir_ajuste_por_inflacion(UUID, UUID) TO authenticated;
