-- migration 314 — blindar asientos_contables/asientos_items: partida doble
-- validada server-side + asientos confirmados inmutables (auditoría contable
-- sistemática 2026-08-07, hallazgo CRÍTICO #1, ver INFORME_AUDITORIA_CONTABLE_2026-08-07.md)
--
-- PROBLEMA ENCONTRADO:
--   1. `asientosService.createAsiento` (src/services/planCuentasService.ts) hace INSERT
--      directo desde el cliente (supabase-js) contra asientos_contables/asientos_items,
--      SIN validar en ningún lado que sum(debe) = sum(haber) antes de persistir.
--   2. Las policies RLS `asientos_contables_cud`/`asientos_items_cud` (mig.132) son
--      FOR ALL (INSERT+UPDATE+DELETE) para cualquier usuario con permiso de módulo
--      'configuracion' — SIN ninguna condición sobre `estado`. Un asiento ya
--      'confirmado' (y ya declarado a AFIP) se puede editar o borrar directo desde
--      el navegador, sin pasar por ninguna RPC.
--   3. El chequeo de período cerrado en el flujo automático de venta (crearAsientoVenta)
--      es best-effort desde el cliente: si la RPC `fecha_en_periodo_cerrado` falla por
--      red/timeout, el asiento se postea igual (comentario propio del código: "Non-critical
--      period check — RPC errors never block the sale"). Hallazgo #3 de la misma auditoría.
--
-- FIX: 3 RPCs nuevas SECURITY DEFINER (mismo patrón que registrar_cobro_cliente/
-- regenerar_asiento_cxc, mig.169/181) + REVOKE de escritura directa sobre las tablas.
-- A partir de acá, `asientos_contables`/`asientos_items` son de escritura EXCLUSIVA
-- vía RPC — igual que ya son `cuenta_corriente_imputaciones`, `facturas_saldo_pendiente`,
-- etc. (mig.169).
--
--   - crear_asiento_manual: para el alta manual (ModalNuevoAsiento.jsx) — requiere
--     permiso de módulo 'configuracion', crea en estado 'borrador' (sin validar cuadre
--     todavía — el cuadre se exige recién al confirmar, mismo criterio que hoy).
--   - crear_asiento_automatico: para los 7 sitios de asientosAutoService.* (venta,
--     compra, ajuste de stock, NC/ND cliente y proveedor, reversa) — SIN gate de
--     módulo específico (la acción de negocio que lo dispara ya validó su propio
--     permiso; posteado del asiento es una consecuencia, no una acción nueva), valida
--     partida doble y período cerrado SIEMPRE server-side (bloqueante de verdad, no
--     best-effort), inserta directo en 'confirmado' en una sola transacción atómica
--     (antes eran 2 llamadas separadas desde el cliente — create + confirm — con una
--     ventana real donde podía quedar un asiento 'borrador' huérfano si la segunda
--     fallaba).
--   - confirmar_asiento / anular_asiento: reemplazan los UPDATE directos de
--     confirmarAsiento()/anularAsiento() — validan tenant, permiso, y estado antes de
--     transicionar. confirmar_asiento valida partida doble y período cerrado recién acá
--     (coincide con el criterio de la skill: "validación de cuadre antes de confirmar").
--
-- Una vez confirmado o anulado, un asiento queda inmutable de por vida: ninguna de estas
-- RPCs permite volver a tocar sus líneas, y la escritura directa a la tabla ya no existe
-- para `authenticated`.

-- ── 1) crear_asiento_manual ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_asiento_manual(
  p_empresa_id uuid,
  p_user_id uuid,
  p_fecha date,
  p_descripcion text,
  p_centro_costo_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_asiento_id uuid;
  v_numero text;
  v_total_debe numeric := 0;
  v_total_haber numeric := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('configuracion') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo configuración';
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El asiento debe tener al menos una línea';
  END IF;

  SELECT COALESCE(SUM((x->>'debe')::numeric), 0), COALESCE(SUM((x->>'haber')::numeric), 0)
    INTO v_total_debe, v_total_haber
    FROM jsonb_array_elements(p_items) x;

  v_numero := next_numero_asiento(p_empresa_id);

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, centro_costo_id)
  VALUES
    (p_empresa_id, p_user_id, v_numero, p_fecha, p_descripcion, 'borrador', v_total_debe, v_total_haber, p_centro_costo_id)
  RETURNING id INTO v_asiento_id;

  INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
  SELECT v_asiento_id, p_empresa_id, (x->>'cuenta_id')::uuid, x->>'descripcion',
         COALESCE((x->>'debe')::numeric, 0), COALESCE((x->>'haber')::numeric, 0)
    FROM jsonb_array_elements(p_items) x;

  RETURN jsonb_build_object('id', v_asiento_id, 'numero', v_numero, 'estado', 'borrador');
END;
$function$;

-- ── 2) crear_asiento_automatico ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_asiento_automatico(
  p_empresa_id uuid,
  p_user_id uuid,
  p_fecha date,
  p_descripcion text,
  p_origen text,
  p_origen_id uuid,
  p_centro_costo_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_asiento_id uuid;
  v_numero text;
  v_total_debe numeric := 0;
  v_total_haber numeric := 0;
  v_cerrado boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El asiento debe tener al menos una línea';
  END IF;

  SELECT COALESCE(SUM((x->>'debe')::numeric), 0), COALESCE(SUM((x->>'haber')::numeric), 0)
    INTO v_total_debe, v_total_haber
    FROM jsonb_array_elements(p_items) x;

  IF round(v_total_debe, 2) IS DISTINCT FROM round(v_total_haber, 2) THEN
    RAISE EXCEPTION 'El asiento no está balanceado: debe % vs haber %', v_total_debe, v_total_haber;
  END IF;

  SELECT fecha_en_periodo_cerrado(p_empresa_id, p_fecha) INTO v_cerrado;
  IF COALESCE(v_cerrado, false) THEN
    RAISE EXCEPTION 'Período cerrado: la fecha % pertenece a un período contable cerrado', p_fecha;
  END IF;

  v_numero := next_numero_asiento(p_empresa_id);

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id, centro_costo_id)
  VALUES
    (p_empresa_id, p_user_id, v_numero, p_fecha, p_descripcion, 'confirmado', v_total_debe, v_total_haber, p_origen, p_origen_id, p_centro_costo_id)
  RETURNING id INTO v_asiento_id;

  INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
  SELECT v_asiento_id, p_empresa_id, (x->>'cuenta_id')::uuid, x->>'descripcion',
         COALESCE((x->>'debe')::numeric, 0), COALESCE((x->>'haber')::numeric, 0)
    FROM jsonb_array_elements(p_items) x;

  RETURN jsonb_build_object('id', v_asiento_id, 'numero', v_numero, 'estado', 'confirmado');
END;
$function$;

-- ── 3) confirmar_asiento ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirmar_asiento(p_asiento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_estado text;
  v_fecha date;
  v_total_debe numeric;
  v_total_haber numeric;
  v_cerrado boolean;
BEGIN
  SELECT empresa_id, estado, fecha INTO v_empresa_id, v_estado, v_fecha
    FROM public.asientos_contables WHERE id = p_asiento_id;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Asiento no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el asiento no pertenece a esta empresa';
  END IF;
  IF NOT has_module_permission('configuracion') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo configuración';
  END IF;
  IF v_estado <> 'borrador' THEN
    RAISE EXCEPTION 'Solo se puede confirmar un asiento en borrador (estado actual: %)', v_estado;
  END IF;

  SELECT COALESCE(SUM(debe), 0), COALESCE(SUM(haber), 0) INTO v_total_debe, v_total_haber
    FROM public.asientos_items WHERE asiento_id = p_asiento_id;

  IF round(v_total_debe, 2) IS DISTINCT FROM round(v_total_haber, 2) THEN
    RAISE EXCEPTION 'El asiento no está balanceado: debe % vs haber %', v_total_debe, v_total_haber;
  END IF;

  SELECT fecha_en_periodo_cerrado(v_empresa_id, v_fecha) INTO v_cerrado;
  IF COALESCE(v_cerrado, false) THEN
    RAISE EXCEPTION 'Período cerrado: la fecha % pertenece a un período contable cerrado', v_fecha;
  END IF;

  UPDATE public.asientos_contables
     SET estado = 'confirmado', total_debe = v_total_debe, total_haber = v_total_haber
   WHERE id = p_asiento_id;

  RETURN jsonb_build_object('id', p_asiento_id, 'estado', 'confirmado');
END;
$function$;

-- ── 4) anular_asiento (descarta un borrador — mismo alcance que hoy en TabAsientos.jsx,
--      donde el botón "Anular" solo se muestra para asientos en borrador) ────
CREATE OR REPLACE FUNCTION public.anular_asiento(p_asiento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_estado text;
BEGIN
  SELECT empresa_id, estado INTO v_empresa_id, v_estado
    FROM public.asientos_contables WHERE id = p_asiento_id;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Asiento no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el asiento no pertenece a esta empresa';
  END IF;
  IF NOT has_module_permission('configuracion') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo configuración';
  END IF;
  IF v_estado <> 'borrador' THEN
    RAISE EXCEPTION 'Solo se puede anular un asiento en borrador (estado actual: %)', v_estado;
  END IF;

  UPDATE public.asientos_contables SET estado = 'anulado' WHERE id = p_asiento_id;

  RETURN jsonb_build_object('id', p_asiento_id, 'estado', 'anulado');
END;
$function$;

-- ── 5) Cerrar la escritura directa — de acá en más, exclusiva vía RPC ────────
-- (mismo patrón que mig.169 para cuenta_corriente_imputaciones/facturas_saldo_pendiente)
REVOKE ALL ON public.asientos_contables FROM anon, authenticated;
GRANT SELECT ON public.asientos_contables TO authenticated;

REVOKE ALL ON public.asientos_items FROM anon, authenticated;
GRANT SELECT ON public.asientos_items TO authenticated;

REVOKE EXECUTE ON FUNCTION public.crear_asiento_manual(uuid,uuid,date,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_asiento_manual(uuid,uuid,date,text,uuid,jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.crear_asiento_automatico(uuid,uuid,date,text,text,uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_asiento_automatico(uuid,uuid,date,text,text,uuid,uuid,jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.confirmar_asiento(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirmar_asiento(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.anular_asiento(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.anular_asiento(uuid) TO authenticated;
