-- migration 277 — NC de Proveedor: pasa de asiento suelto a documento con ítems+IVA
--
-- CONTEXTO: continúa el espejo Ventas↔Compras (mig.276, ND recibida). A
-- diferencia de la ND, la NC financiera de Proveedor (NuevaNCProveedorModal.jsx)
-- hoy NO tiene tabla de documento propia — es un INSERT directo a
-- `cuenta_corriente_proveedores` sin numeración, sin ítems, sin neto/IVA. Es
-- el gap más grande de los dos porque no hay nada que extender, hay que crear
-- el documento desde cero. Mismo motivo que ND: sin neto/IVA acá,
-- ReporteLibroIVACompras.jsx nunca va a poder reflejar el ajuste al crédito
-- fiscal que implica una NC de proveedor.
--
-- No va a `comprobantes` — es el proveedor quien nos emite esta NC y la
-- declara ante SU AFIP, no la nuestra (mismo criterio que ND recibida y que
-- devoluciones tipo='proveedor', que tampoco tocan AFIP).
--
-- La devolución CON stock (devoluciones tipo='proveedor', compensacion=
-- 'nota_credito') sigue con su propio circuito — no se toca acá.

CREATE TABLE IF NOT EXISTS public.notas_credito_proveedor (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid          NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id            uuid          REFERENCES public.profiles(id) ON DELETE SET NULL,
  numero_ncp         text          NOT NULL,
  proveedor_id       uuid          NOT NULL REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  compra_id          uuid          REFERENCES public.compras(id) ON DELETE SET NULL,
  motivo             text          NOT NULL,
  monto              numeric(12,2) NOT NULL,
  neto_gravado       numeric(12,2) NOT NULL DEFAULT 0,
  iva_discriminado   numeric(12,2) NOT NULL DEFAULT 0,
  moneda             text          NOT NULL DEFAULT 'ARS',
  reembolso_efectivo boolean       NOT NULL DEFAULT false,
  cc_movimiento_id   uuid          REFERENCES public.cuenta_corriente_proveedores(id) ON DELETE SET NULL,
  caja_movimiento_id uuid          REFERENCES public.movimientos_caja(id) ON DELETE SET NULL,
  fecha              date          NOT NULL DEFAULT CURRENT_DATE,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero_ncp)
);

ALTER TABLE public.notas_credito_proveedor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notas_credito_proveedor_all" ON public.notas_credito_proveedor;
CREATE POLICY "notas_credito_proveedor_all" ON public.notas_credito_proveedor
  USING      (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_ncp_empresa    ON public.notas_credito_proveedor(empresa_id);
CREATE INDEX IF NOT EXISTS idx_ncp_proveedor  ON public.notas_credito_proveedor(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_ncp_compra     ON public.notas_credito_proveedor(compra_id);

CREATE TABLE IF NOT EXISTS public.notas_credito_proveedor_items (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_credito_proveedor_id uuid         NOT NULL REFERENCES public.notas_credito_proveedor(id) ON DELETE CASCADE,
  empresa_id               uuid          NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id              uuid          REFERENCES public.productos(id) ON DELETE SET NULL,
  descripcion              text,
  cantidad                 numeric(12,3) NOT NULL,
  precio_unitario          numeric(12,2) NOT NULL,
  alicuota_iva             text          NOT NULL DEFAULT '21',
  subtotal                 numeric(12,2) NOT NULL,
  created_at               timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.notas_credito_proveedor_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notas_credito_proveedor_items_all" ON public.notas_credito_proveedor_items;
CREATE POLICY "notas_credito_proveedor_items_all" ON public.notas_credito_proveedor_items
  USING      (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_ncp_items_ncp ON public.notas_credito_proveedor_items(nota_credito_proveedor_id);

-- ── Numeración: nueva serie 'nota_credito_proveedor' ─────────────────────────
-- Mismo formato que la NC de cliente (NC-, YYYYMMDD, 3 dígitos) pero serie
-- INDEPENDIENTE — series_numeracion está keyed por (empresa_id, tipo_documento),
-- 'nota_credito' (cliente) y 'nota_credito_proveedor' no comparten contador.
ALTER TABLE public.series_numeracion DROP CONSTRAINT IF EXISTS chk_series_tipo_documento;
ALTER TABLE public.series_numeracion ADD CONSTRAINT chk_series_tipo_documento
  CHECK (tipo_documento = ANY (ARRAY['venta'::text, 'factura'::text, 'nota_credito'::text,
    'nota_debito'::text, 'nota_debito_venta'::text, 'nota_credito_proveedor'::text,
    'orden_compra'::text, 'cotizacion'::text, 'pedido'::text, 'entrega'::text,
    'recepcion'::text, 'devolucion'::text]));

INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos)
SELECT id, 'nota_credito_proveedor', 'NC-', 'YYYYMMDD', 3 FROM public.empresas
ON CONFLICT (empresa_id, tipo_documento) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_series_numeracion(p_empresa_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos) VALUES
    (p_empresa_id, 'venta',                  '',     'YYYYMMDD', 3),
    (p_empresa_id, 'factura',                'FAC-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito',           'NC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito_venta',      'ND-',  'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito_proveedor', 'NC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'pedido',                 'PED-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito',            'ND-',  'YYYY',     4),
    (p_empresa_id, 'entrega',                'ENT-', 'YYYY',     4),
    (p_empresa_id, 'recepcion',              'REC-', 'YYYY',     4),
    (p_empresa_id, 'orden_compra',           'OC-',  'ninguno',  5),
    (p_empresa_id, 'cotizacion',             'COT-', 'ninguno',  5)
  ON CONFLICT (empresa_id, tipo_documento) DO NOTHING;
END;
$$;

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
  WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento;

  RETURN v_serie.prefijo
    || CASE WHEN v_periodo IS NOT NULL THEN v_periodo || '-' ELSE '' END
    || LPAD(v_numero::TEXT, v_serie.digitos, '0');
END;
$function$;

-- ── RPC crear_nota_credito_proveedor ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_nota_credito_proveedor(
  p_empresa_id         uuid,
  p_user_id            uuid,
  p_proveedor_id       uuid,
  p_motivo             text,
  p_items              jsonb,
  p_compra_id          uuid    DEFAULT NULL::uuid,
  p_reembolso_efectivo boolean DEFAULT false,
  p_caja_sesion_id     uuid    DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ncp_id UUID; v_numero TEXT; v_cc_id UUID; v_caja_id UUID; v_descripcion TEXT;
  v_item JSONB; v_subtotal_neto NUMERIC := 0; v_total_iva NUMERIC := 0; v_total NUMERIC;
  v_cantidad NUMERIC; v_precio NUMERIC; v_alicuota NUMERIC; v_bruto_item NUMERIC;
  v_neto_item NUMERIC; v_factor NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;
  IF p_proveedor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'proveedor_id no pertenece a la empresa';
  END IF;
  IF p_compra_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.compras WHERE id = p_compra_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'compra_id no pertenece a la empresa';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La NC debe tener al menos un ítem';
  END IF;
  IF p_reembolso_efectivo AND p_caja_sesion_id IS NULL THEN
    RAISE EXCEPTION 'Reembolso en efectivo requiere una caja abierta';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'precio_unitario')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_bruto_item := v_cantidad * v_precio;
    v_factor := CASE v_alicuota WHEN 21 THEN 1.21 WHEN 10.5 THEN 1.105 ELSE 1 END;
    v_neto_item := v_bruto_item / v_factor;
    v_subtotal_neto := v_subtotal_neto + v_neto_item;
    v_total_iva      := v_total_iva + (v_bruto_item - v_neto_item);
  END LOOP;
  v_total := v_subtotal_neto + v_total_iva;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total de la NC debe ser mayor a cero'; END IF;

  v_numero := public.obtener_proximo_numero(p_empresa_id, 'nota_credito_proveedor');
  v_descripcion := 'NC ' || v_numero || ' — ' || p_motivo;

  INSERT INTO public.notas_credito_proveedor (
    empresa_id, user_id, numero_ncp, proveedor_id, compra_id, motivo,
    monto, neto_gravado, iva_discriminado, reembolso_efectivo
  ) VALUES (
    p_empresa_id, p_user_id, v_numero, p_proveedor_id, p_compra_id, p_motivo,
    v_total, v_subtotal_neto, v_total_iva, p_reembolso_efectivo
  ) RETURNING id INTO v_ncp_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'precio_unitario')::NUMERIC;
    INSERT INTO public.notas_credito_proveedor_items (
      nota_credito_proveedor_id, empresa_id, producto_id, descripcion, cantidad, precio_unitario, subtotal, alicuota_iva
    ) VALUES (
      v_ncp_id, p_empresa_id, NULLIF(v_item->>'producto_id', '')::UUID, NULLIF(v_item->>'descripcion', ''),
      v_cantidad, v_precio, v_cantidad * v_precio, COALESCE(v_item->>'alicuota_iva', '21')
    );
  END LOOP;

  INSERT INTO public.cuenta_corriente_proveedores (
    empresa_id, user_id, proveedor_id, tipo, monto, descripcion,
    referencia_id, referencia_tipo, fecha
  ) VALUES (
    p_empresa_id, p_user_id, p_proveedor_id, 'nota_credito', v_total, v_descripcion,
    v_ncp_id, 'nc_proveedor', now()
  ) RETURNING id INTO v_cc_id;

  UPDATE public.notas_credito_proveedor SET cc_movimiento_id = v_cc_id WHERE id = v_ncp_id;

  IF p_reembolso_efectivo THEN
    INSERT INTO public.movimientos_caja (
      empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, is_automatic, fecha
    ) VALUES (
      p_empresa_id, p_user_id, p_caja_sesion_id, 'ingreso', 'NC Proveedor', v_descripcion, v_total, 'Efectivo', true, now()
    ) RETURNING id INTO v_caja_id;

    UPDATE public.notas_credito_proveedor SET caja_movimiento_id = v_caja_id WHERE id = v_ncp_id;
  END IF;

  RETURN jsonb_build_object('nota_credito_proveedor_id', v_ncp_id, 'numero_ncp', v_numero, 'total', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.crear_nota_credito_proveedor(uuid, uuid, uuid, text, jsonb, uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_nota_credito_proveedor(uuid, uuid, uuid, text, jsonb, uuid, boolean, uuid) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.crear_nota_credito_proveedor(uuid, uuid, uuid, text, jsonb, uuid, boolean, uuid);
-- DROP TABLE IF EXISTS public.notas_credito_proveedor_items;
-- DROP TABLE IF EXISTS public.notas_credito_proveedor;
-- DELETE FROM public.series_numeracion WHERE tipo_documento = 'nota_credito_proveedor';
-- (restaurar seed_series_numeracion y obtener_proximo_numero a mig.221/268)
