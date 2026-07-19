-- Extiende el self-heal anti-colision de obtener_proximo_numero a TODOS los
-- tipo_documento, no solo 'venta'. Hallazgo de la investigacion del bug de
-- numeracion de entregas (Fase 4, sesion 78, task "Investigar overloads
-- duplicados de crear_venta").
--
-- Contexto: la version anterior de esta funcion (migration 099,
-- obtener_proximo_numero_self_heal_venta) solo reconciliaba el contador de
-- series_numeracion contra el MAX() real cuando p_tipo_documento = 'venta'.
-- Para el resto de los tipos (entrega, nota_credito, devolucion, nota_debito,
-- recepcion, pedido, cotizacion, orden_compra) NO existia ningun mecanismo de
-- auto-correccion: si el contador se desincronizaba del estado real de su
-- tabla por cualquier via (un insert directo, una migracion de datos, un bug
-- en un caller viejo), la colision quedaba latente para siempre — nunca se
-- curaba sola, a diferencia de 'venta'.
--
-- La investigacion confirmo que la hipotesis original (PostgREST eligiendo un
-- overload viejo de crear_venta) era incorrecta — el unico overload que
-- existe en produccion matchea exactamente los parametros que envian todos
-- los callers reales. Este self-heal parcial es el gap real y de mayor
-- alcance que encontro esa investigacion.
--
-- 'factura' queda sin mapear a proposito: no tiene ningun caller real
-- (`grep obtener_proximo_numero.*'factura'` no devuelve nada en el repo) — es
-- una fila reservada sin uso en series_numeracion. Igual que antes, un tipo
-- sin mapeo simplemente no se autocorrige (mismo comportamiento que tenian
-- todos los tipos no-venta hasta esta migration), no rompe nada.

CREATE OR REPLACE FUNCTION public.obtener_proximo_numero(p_empresa_id uuid, p_tipo_documento text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_serie     RECORD;
  v_periodo   TEXT;
  v_numero    INTEGER;
  v_max_real  INTEGER;
  v_like_pat  TEXT;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT * INTO v_serie
  FROM public.series_numeracion
  WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.seed_series_numeracion(p_empresa_id);
    SELECT * INTO v_serie
    FROM public.series_numeracion
    WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tipo de documento no reconocido: %', p_tipo_documento;
  END IF;

  v_periodo := CASE v_serie.formato_fecha
    WHEN 'YYYYMMDD' THEN to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD')
    WHEN 'YYYY'     THEN to_char(NOW() - INTERVAL '3 hours', 'YYYY')
    ELSE NULL
  END;

  IF v_periodo IS NOT NULL AND v_periodo IS DISTINCT FROM v_serie.periodo_actual THEN
    v_numero := 1;
  ELSE
    v_numero := v_serie.proximo_numero;
  END IF;

  -- Self-heal anti-colision (TODOS los tipos con tabla mapeada): si el
  -- contador quedo atras del maximo real en la tabla de destino para el
  -- prefijo/periodo vigente, avanzar al maximo+1. Solo sube el numero, nunca
  -- lo baja.
  v_like_pat := v_serie.prefijo || COALESCE(v_periodo || '-', '');

  CASE p_tipo_documento
    WHEN 'venta' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(c.numero_venta, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.comprobantes c
      WHERE c.empresa_id = p_empresa_id AND c.tipo = 'venta'
        AND c.numero_venta LIKE v_like_pat || '%'
        AND regexp_replace(c.numero_venta, '.*-', '') ~ '^[0-9]+$';
    WHEN 'nota_credito' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(c.numero_venta, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.comprobantes c
      WHERE c.empresa_id = p_empresa_id AND c.tipo = 'nota_credito'
        AND c.numero_venta LIKE v_like_pat || '%'
        AND regexp_replace(c.numero_venta, '.*-', '') ~ '^[0-9]+$';
    WHEN 'entrega' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(e.numero_entrega, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.entregas e
      WHERE e.empresa_id = p_empresa_id
        AND e.numero_entrega LIKE v_like_pat || '%'
        AND regexp_replace(e.numero_entrega, '.*-', '') ~ '^[0-9]+$';
    WHEN 'devolucion' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(d.numero_devolucion, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.devoluciones d
      WHERE d.empresa_id = p_empresa_id
        AND d.numero_devolucion LIKE v_like_pat || '%'
        AND regexp_replace(d.numero_devolucion, '.*-', '') ~ '^[0-9]+$';
    WHEN 'nota_debito' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(nd.numero_nd, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.notas_debito nd
      WHERE nd.empresa_id = p_empresa_id
        AND nd.numero_nd LIKE v_like_pat || '%'
        AND regexp_replace(nd.numero_nd, '.*-', '') ~ '^[0-9]+$';
    WHEN 'recepcion' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(r.numero_recepcion, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.recepciones r
      WHERE r.empresa_id = p_empresa_id
        AND r.numero_recepcion LIKE v_like_pat || '%'
        AND regexp_replace(r.numero_recepcion, '.*-', '') ~ '^[0-9]+$';
    WHEN 'pedido' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(pe.numero, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.pedidos pe
      WHERE pe.empresa_id = p_empresa_id
        AND pe.numero LIKE v_like_pat || '%'
        AND regexp_replace(pe.numero, '.*-', '') ~ '^[0-9]+$';
    WHEN 'cotizacion' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(q.numero, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.cotizaciones q
      WHERE q.empresa_id = p_empresa_id
        AND q.numero LIKE v_like_pat || '%'
        AND regexp_replace(q.numero, '.*-', '') ~ '^[0-9]+$';
    WHEN 'orden_compra' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(oc.numero, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.ordenes_compra oc
      WHERE oc.empresa_id = p_empresa_id
        AND oc.numero LIKE v_like_pat || '%'
        AND regexp_replace(oc.numero, '.*-', '') ~ '^[0-9]+$';
    ELSE
      v_max_real := NULL; -- tipo sin tabla mapeada (ej. 'factura', reservado sin uso): sin self-heal
  END CASE;

  IF v_max_real IS NOT NULL AND v_max_real + 1 > v_numero THEN
    v_numero := v_max_real + 1;
  END IF;

  UPDATE public.series_numeracion
  SET proximo_numero = v_numero + 1,
      periodo_actual = v_periodo
  WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento;

  RETURN v_serie.prefijo
    || CASE WHEN v_periodo IS NOT NULL THEN v_periodo || '-' ELSE '' END
    || LPAD(v_numero::TEXT, v_serie.digitos, '0');
END;
$function$;
