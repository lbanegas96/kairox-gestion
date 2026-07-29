-- migration 268 — habilita 'nota_debito' como tipo de comprobante + numeración
--
-- Rediseño de ND (Nota de Débito), aprobado por el usuario tras el gap-analysis
-- vs SAP: la ND emitida a un Cliente pasa a vivir en `comprobantes` (tipo=
-- 'nota_debito') + `comprobante_items`, igual que Factura y NC — así hereda
-- gratis Open Item real (facturas_saldo_pendiente ya lee de comprobantes),
-- Document Flow, y el criterio precio-final-IVA-incluido de todo el sistema.
--
-- La ND recibida de Proveedor NO se toca acá — sigue viviendo en la tabla
-- `notas_debito` (Compras tiene su propio circuito de CxP), migration aparte
-- le agrega ítems+IVA sin tocar esto.
--
-- Datos históricos de `notas_debito` (tipo='emitida') NO se migran — el
-- circuito nuevo aplica solo hacia adelante, mismo criterio que las 3 NC
-- infladas que se dejaron intactas.

-- 1. comprobantes.tipo — agregar 'nota_debito' al CHECK existente
ALTER TABLE public.comprobantes DROP CONSTRAINT comprobantes_tipo_check;
ALTER TABLE public.comprobantes ADD CONSTRAINT comprobantes_tipo_check
  CHECK (tipo = ANY (ARRAY['venta'::text, 'nota_credito'::text, 'nota_debito'::text]));

-- 2. series_numeracion — nueva serie 'nota_debito_venta' (mismo formato que
--    'nota_credito': prefijo ND-, YYYYMMDD, 3 dígitos). La key 'nota_debito'
--    existente NO se toca — sigue numerando la tabla `notas_debito` (proveedor).
--    chk_series_tipo_documento whitelist también necesita la key nueva.
ALTER TABLE public.series_numeracion DROP CONSTRAINT chk_series_tipo_documento;
ALTER TABLE public.series_numeracion ADD CONSTRAINT chk_series_tipo_documento
  CHECK (tipo_documento = ANY (ARRAY['venta'::text, 'factura'::text, 'nota_credito'::text,
    'nota_debito'::text, 'nota_debito_venta'::text, 'orden_compra'::text, 'cotizacion'::text,
    'pedido'::text, 'entrega'::text, 'recepcion'::text, 'devolucion'::text]));

INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos)
SELECT id, 'nota_debito_venta', 'ND-', 'YYYYMMDD', 3 FROM public.empresas
ON CONFLICT (empresa_id, tipo_documento) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_series_numeracion(p_empresa_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos) VALUES
    (p_empresa_id, 'venta',              '',     'YYYYMMDD', 3),
    (p_empresa_id, 'factura',            'FAC-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito',       'NC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito_venta',  'ND-',  'YYYYMMDD', 3),
    (p_empresa_id, 'pedido',             'PED-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito',        'ND-',  'YYYY',     4),
    (p_empresa_id, 'entrega',            'ENT-', 'YYYY',     4),
    (p_empresa_id, 'recepcion',          'REC-', 'YYYY',     4),
    (p_empresa_id, 'orden_compra',       'OC-',  'ninguno',  5),
    (p_empresa_id, 'cotizacion',         'COT-', 'ninguno',  5)
  ON CONFLICT (empresa_id, tipo_documento) DO NOTHING;
END;
$$;

-- 3. obtener_proximo_numero — self-heal para 'nota_debito_venta' (lee MAX de
--    comprobantes tipo='nota_debito', igual patrón que 'nota_credito').
--    Copia fiel del resto de la función (mig.221).
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
    WHEN 'nota_debito_venta' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(c.numero_venta, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.comprobantes c
      WHERE c.empresa_id = p_empresa_id AND c.tipo = 'nota_debito'
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
      v_max_real := NULL;
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

-- ROLLBACK (comentado):
-- ALTER TABLE public.comprobantes DROP CONSTRAINT comprobantes_tipo_check;
-- ALTER TABLE public.comprobantes ADD CONSTRAINT comprobantes_tipo_check
--   CHECK (tipo = ANY (ARRAY['venta'::text, 'nota_credito'::text]));
-- ALTER TABLE public.series_numeracion DROP CONSTRAINT chk_series_tipo_documento;
-- ALTER TABLE public.series_numeracion ADD CONSTRAINT chk_series_tipo_documento
--   CHECK (tipo_documento = ANY (ARRAY['venta'::text, 'factura'::text, 'nota_credito'::text,
--     'nota_debito'::text, 'orden_compra'::text, 'cotizacion'::text, 'pedido'::text,
--     'entrega'::text, 'recepcion'::text, 'devolucion'::text]));
-- DELETE FROM public.series_numeracion WHERE tipo_documento = 'nota_debito_venta';
-- (restaurar seed_series_numeracion y obtener_proximo_numero a mig.221)
