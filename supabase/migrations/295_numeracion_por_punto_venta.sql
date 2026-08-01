-- migration 295 — Numeración interna separada por punto de venta (parcial)
--
-- Última pieza del criterio fiscal unificado (mig.293/294): con selector de
-- PdV real en las facturas, dos PdV usando la MISMA serie generarían el mismo
-- numero_venta el mismo día (ambas parten de formato_fecha+prefijo+dígitos,
-- sin nada que las distinga si el prefijo es igual). Estilo SAP: cada PdV
-- lleva su propia serie de numeración.
--
-- ALCANCE ACOTADO A PROPÓSITO: sólo 'venta' y 'factura' — los dos tipos de
-- documento donde el frontend llama a `obtener_proximo_numero` directamente
-- (useConfirmarVenta/NuevaVentaModal, NuevaFacturaModal). `nota_credito` y
-- `nota_debito_venta` generan su número DENTRO de `crear_nota_credito` /
-- `crear_nota_debito_cliente` (SQL), que no reciben el PdV como parámetro hoy.
-- Tocar esas RPCs es cirugía aparte — `crear_nota_credito` ya tiene un overload
-- huérfano documentado (deuda técnica, mig.264/265) y sumar otro ahí en la
-- misma sesión que el resto de este cambio es más riesgo del que vale la pena.
-- NC/ND por ahora comparten un único correlativo entre todos los PdV — no es
-- incorrecto (los números no se repiten), sólo no está separado por serie.
--
-- GARANTÍA DE SEGURIDAD: el PdV marcado `es_default` de la empresa sigue
-- usando EXACTAMENTE la fila de `series_numeracion` de siempre — mismo
-- prefijo, mismo próximo_numero. Cero impacto en la numeración actual de
-- Nalux (o cualquier empresa con un solo PdV fiscal). Sólo cuando se use un
-- PdV NO default se provisiona una fila nueva, con un prefijo derivado que la
-- distingue (ej. prefijo actual + "2-" para el PdV número 2).

-- ── 1. Columna nueva + constraints ───────────────────────────────────────────
ALTER TABLE public.series_numeracion
  ADD COLUMN IF NOT EXISTS punto_venta_id uuid REFERENCES public.puntos_venta(id) ON DELETE CASCADE;

ALTER TABLE public.series_numeracion
  DROP CONSTRAINT IF EXISTS series_numeracion_empresa_id_tipo_documento_key;

-- A lo sumo una fila "legacy" (punto_venta_id NULL) por empresa+tipo — mismo
-- comportamiento exacto que la UNIQUE original.
CREATE UNIQUE INDEX IF NOT EXISTS idx_series_numeracion_legacy
  ON public.series_numeracion (empresa_id, tipo_documento)
  WHERE punto_venta_id IS NULL;

-- A lo sumo una fila por empresa+tipo+PdV cuando SÍ hay PdV.
CREATE UNIQUE INDEX IF NOT EXISTS idx_series_numeracion_por_pdv
  ON public.series_numeracion (empresa_id, tipo_documento, punto_venta_id)
  WHERE punto_venta_id IS NOT NULL;

-- ── 2. Nuevo overload de 3 parámetros (el de 2 sigue existiendo intacto) ─────
-- El de 2 params ahora filtra explícitamente punto_venta_id IS NULL: así,
-- cualquier caller que NO haya migrado a pasar el PdV (hoy: NC/ND, y los 9
-- tipos de documento no fiscales) sigue leyendo siempre la fila legacy, nunca
-- puede toparse con una fila de PdV ajena — sin esto, con una fila extra ya
-- presente para 'venta', un SELECT sin filtro de PdV sería no determinístico
-- (mismo patrón de bug que useAfipConfig tenía con `.limit(1)`).
CREATE OR REPLACE FUNCTION public.obtener_proximo_numero(p_empresa_id uuid, p_tipo_documento text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.obtener_proximo_numero(p_empresa_id, p_tipo_documento, NULL::uuid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.obtener_proximo_numero(
  p_empresa_id uuid, p_tipo_documento text, p_punto_venta_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_serie       RECORD;
  v_periodo     TEXT;
  v_numero      INTEGER;
  v_max_real    INTEGER;
  v_like_pat    TEXT;
  v_es_scoped   BOOLEAN;
  v_pv_id       uuid;
  v_es_default  BOOLEAN;
  v_pv_numero   INTEGER;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Sólo 'venta' y 'factura' se separan por PdV (ver nota de alcance arriba).
  -- Cualquier otro tipo ignora p_punto_venta_id y usa siempre la fila legacy
  -- — comportamiento 100% idéntico al de antes de esta migración.
  v_es_scoped := p_tipo_documento IN ('venta', 'factura') AND p_punto_venta_id IS NOT NULL;

  IF v_es_scoped THEN
    SELECT es_default, numero INTO v_es_default, v_pv_numero
    FROM public.puntos_venta
    WHERE id = p_punto_venta_id AND empresa_id = p_empresa_id;

    -- El PdV por defecto de la empresa usa la fila legacy de siempre —
    -- garantía de no-impacto en la numeración ya en curso.
    v_es_scoped := COALESCE(v_es_default, false) = false;
  END IF;

  v_pv_id := CASE WHEN v_es_scoped THEN p_punto_venta_id ELSE NULL END;

  SELECT * INTO v_serie
  FROM public.series_numeracion
  WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento
    AND punto_venta_id IS NOT DISTINCT FROM v_pv_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF v_pv_id IS NULL THEN
      -- Fila legacy inexistente (empresa nueva): mismo auto-seed de siempre.
      PERFORM public.seed_series_numeracion(p_empresa_id);
      SELECT * INTO v_serie
      FROM public.series_numeracion
      WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento
        AND punto_venta_id IS NULL
      FOR UPDATE;
    ELSE
      -- Primera vez que este PdV (no default) numera este tipo de documento:
      -- provisionar una fila nueva, clonando formato/dígitos de la legacy y
      -- agregando un prefijo que la distinga (ej. "" -> "2-", "NC-" -> "NC-2-").
      INSERT INTO public.series_numeracion (
        empresa_id, tipo_documento, punto_venta_id, prefijo, formato_fecha, digitos, proximo_numero
      )
      SELECT p_empresa_id, p_tipo_documento, v_pv_id,
             prefijo || v_pv_numero || '-', formato_fecha, digitos, 1
      FROM public.series_numeracion
      WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento AND punto_venta_id IS NULL
      RETURNING * INTO v_serie;
    END IF;
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

  v_like_pat := v_serie.prefijo || COALESCE(v_periodo || '-', '');

  -- El prefijo de cada serie es único por diseño (legacy vs "<legacy>N-" por
  -- PdV), así que el LIKE ya scopea correctamente sin necesitar filtrar
  -- comprobantes.punto_venta_id acá.
  CASE p_tipo_documento
    WHEN 'venta' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(c.numero_venta, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.comprobantes c
      WHERE c.empresa_id = p_empresa_id AND c.tipo = 'venta'
        AND c.numero_venta LIKE v_like_pat || '%'
        AND regexp_replace(c.numero_venta, '.*-', '') ~ '^[0-9]+$';
    WHEN 'factura' THEN
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
    WHEN 'nota_debito_venta' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(c.numero_venta, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.comprobantes c
      WHERE c.empresa_id = p_empresa_id AND c.tipo = 'nota_debito'
        AND c.numero_venta LIKE v_like_pat || '%'
        AND regexp_replace(c.numero_venta, '.*-', '') ~ '^[0-9]+$';
    WHEN 'nota_credito_proveedor' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(ncp.numero_ncp, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.notas_credito_proveedor ncp
      WHERE ncp.empresa_id = p_empresa_id
        AND ncp.numero_ncp LIKE v_like_pat || '%'
        AND regexp_replace(ncp.numero_ncp, '.*-', '') ~ '^[0-9]+$';
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
      v_max_real := NULL;
  END CASE;

  IF v_max_real IS NOT NULL AND v_max_real + 1 > v_numero THEN
    v_numero := v_max_real + 1;
  END IF;

  UPDATE public.series_numeracion
  SET proximo_numero = v_numero + 1,
      periodo_actual = v_periodo
  WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento
    AND punto_venta_id IS NOT DISTINCT FROM v_pv_id;

  RETURN v_serie.prefijo
    || CASE WHEN v_periodo IS NOT NULL THEN v_periodo || '-' ELSE '' END
    || LPAD(v_numero::TEXT, v_serie.digitos, '0');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.obtener_proximo_numero(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_proximo_numero(uuid, text, uuid) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION public.obtener_proximo_numero(uuid, text, uuid);
-- (el de 2 params vuelve a su versión anterior manualmente si hace falta)
-- ALTER TABLE public.series_numeracion DROP CONSTRAINT idx_series_numeracion_legacy;
-- DROP INDEX IF EXISTS idx_series_numeracion_legacy, idx_series_numeracion_por_pdv;
-- ALTER TABLE public.series_numeracion ADD CONSTRAINT series_numeracion_empresa_id_tipo_documento_key UNIQUE (empresa_id, tipo_documento);
-- ALTER TABLE public.series_numeracion DROP COLUMN IF EXISTS punto_venta_id;
