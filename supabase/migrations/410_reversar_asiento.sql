-- 410 — Reversar un asiento confirmado (contra-asiento), como en SAP (FB08)
--
-- Auditoría 24/09/2026, hallazgo CON-3. Un asiento confirmado no se puede borrar ni anular (`anular_asiento` solo
-- acepta borradores; correcto, no se toca la contabilidad ya asentada): se corrige con un contra-asiento. Pero el
-- sistema solo sabe hacerlo dentro del flujo de cada documento (`cancelacion_venta`, `cancelacion_compra`, …).
-- Cuando un asiento queda MAL sin que haya un documento que cancelar —un duplicado huérfano, como los 8 que
-- encontró la auditoría— no había cómo deshacerlo salvo escribir a mano en la base (así se hizo en la mig. 397).
--
-- Se agregan dos funciones:
--
--   reversar_asiento_interno(asiento, motivo, origen, usuario, fecha) — hace el trabajo. Sin chequeo de usuario:
--     la ejecutan solo el dueño de la base y las otras funciones (NO se la da a authenticated ni a anon). Crea un
--     asiento CONFIRMADO con las mismas líneas y el debe/haber invertido, fecha = hoy (hora Argentina) salvo que se
--     indique otra, `origen` = el que se pida (`reversa_asiento` para el uso normal, `reversa_asiento_duplicado`
--     para los duplicados, igual que la mig. 397) y `origen_id` = el asiento reversado. Rechaza: un asiento que no
--     está confirmado, una reversa (no se reversa una reversa), uno ya reversado, uno desbalanceado y una fecha que
--     cae en un período contable cerrado. Bloquea la fila del asiento para que dos reversas simultáneas no se pisen.
--
--   reversar_asiento(asiento, motivo) — lo que llama la aplicación. Solo un ADMINISTRADOR de la empresa del asiento,
--     con un motivo escrito. Además se niega si algún documento tiene ese asiento como suyo (una venta, una compra,
--     un cobro, un pago, un recuento, un cierre de período…: se detecta mirando TODAS las claves foráneas hacia
--     asientos_contables, así que cubre también las tablas que se agreguen): para deshacer un documento hay que
--     cancelar el documento, que genera su propia reversa y actualiza los saldos de cliente/proveedor/stock.
--     Reversar solo el asiento dejaría el mayor y el documento desalineados.

CREATE OR REPLACE FUNCTION public.reversar_asiento_interno(
  p_asiento_id uuid,
  p_motivo text,
  p_origen text,
  p_user_id uuid,
  p_fecha date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_a           record;
  v_fecha       date;
  v_numero      text;
  v_reversa_id  uuid;
  v_total_debe  numeric;
  v_total_haber numeric;
  v_motivo      text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
  SELECT * INTO v_a FROM public.asientos_contables WHERE id = p_asiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asiento no encontrado';
  END IF;
  IF v_a.estado IS DISTINCT FROM 'confirmado' THEN
    RAISE EXCEPTION 'Solo se puede reversar un asiento confirmado (estado actual: %)', v_a.estado;
  END IF;
  IF v_a.origen LIKE 'reversa\_asiento%' ESCAPE '\' THEN
    RAISE EXCEPTION 'Este asiento ya es una reversa: no se reversa una reversa';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.asientos_contables r
    WHERE r.empresa_id = v_a.empresa_id AND r.origen_id = p_asiento_id
      AND r.origen LIKE 'reversa\_asiento%' ESCAPE '\' AND r.estado = 'confirmado'
  ) THEN
    RAISE EXCEPTION 'Este asiento ya fue reversado';
  END IF;

  SELECT COALESCE(SUM(debe), 0), COALESCE(SUM(haber), 0) INTO v_total_debe, v_total_haber
    FROM public.asientos_items WHERE asiento_id = p_asiento_id;
  IF v_total_debe = 0 AND v_total_haber = 0 THEN
    RAISE EXCEPTION 'El asiento no tiene líneas: no hay nada que reversar';
  END IF;
  IF round(v_total_debe, 2) IS DISTINCT FROM round(v_total_haber, 2) THEN
    RAISE EXCEPTION 'El asiento original no está balanceado (debe % vs haber %): no se puede reversar automáticamente', v_total_debe, v_total_haber;
  END IF;

  v_fecha := COALESCE(p_fecha, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
  IF EXISTS (
    SELECT 1 FROM public.periodos_contables
    WHERE empresa_id = v_a.empresa_id AND estado = 'cerrado' AND v_fecha BETWEEN fecha_inicio AND fecha_cierre
  ) THEN
    RAISE EXCEPTION 'Período cerrado: la fecha % pertenece a un período contable cerrado', v_fecha;
  END IF;

  v_numero := next_numero_asiento(v_a.empresa_id);

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id, centro_costo_id)
  VALUES
    (v_a.empresa_id, p_user_id, v_numero, v_fecha,
     'Reversa de ' || v_a.numero || COALESCE(' — ' || v_motivo, ''),
     'confirmado', v_total_haber, v_total_debe, COALESCE(p_origen, 'reversa_asiento'), p_asiento_id, v_a.centro_costo_id)
  RETURNING id INTO v_reversa_id;

  INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
  SELECT v_reversa_id, i.empresa_id, i.cuenta_id, 'Reversa: ' || COALESCE(i.descripcion, ''), COALESCE(i.haber, 0), COALESCE(i.debe, 0)
    FROM public.asientos_items i
   WHERE i.asiento_id = p_asiento_id;

  RETURN jsonb_build_object('id', v_reversa_id, 'numero', v_numero, 'estado', 'confirmado', 'reversa_de', v_a.numero);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reversar_asiento(p_asiento_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_ref        record;
  v_vinculado  boolean;
BEGIN
  SELECT empresa_id INTO v_empresa_id FROM public.asientos_contables WHERE id = p_asiento_id;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Asiento no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el asiento no pertenece a esta empresa';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado: solo un administrador puede reversar un asiento confirmado';
  END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Indicá el motivo de la reversa (mínimo 5 caracteres)';
  END IF;

  -- ¿Algún documento tiene este asiento como suyo? (cualquier tabla con una clave foránea a asientos_contables,
  -- salvo las líneas del propio asiento)
  FOR v_ref IN
    SELECT c.conrelid::regclass::text AS tabla, a.attname::text AS columna
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.asientos_contables'::regclass
      AND c.conrelid NOT IN ('public.asientos_items'::regclass, 'public.asientos_contables'::regclass)
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', v_ref.tabla, v_ref.columna)
      INTO v_vinculado USING p_asiento_id;
    IF v_vinculado THEN
      RAISE EXCEPTION 'Este asiento pertenece a un documento (%). Para deshacerlo cancelá el documento: la reversa del asiento se genera sola y los saldos quedan al día.', v_ref.tabla;
    END IF;
  END LOOP;

  RETURN public.reversar_asiento_interno(p_asiento_id, btrim(p_motivo), 'reversa_asiento', auth.uid(), NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.reversar_asiento_interno(uuid, text, text, uuid, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reversar_asiento(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reversar_asiento(uuid, text) TO authenticated;
