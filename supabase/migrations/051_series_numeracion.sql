-- =============================================================================
-- MIGRATION 051 — Series de Numeración (SAP Number Ranges) parametrizables
-- =============================================================================
-- Reemplaza la generación de número de comprobante hardcodeada y duplicada en
-- cada módulo (frontend con SELECT MAX + padStart, o la función genérica
-- siguiente_numero_documento() que usaba COUNT(*) sin lock) por una única
-- fuente atómica: obtener_proximo_numero().
--
-- Tipos migrados (9, los que pidió la consigna): venta, factura, nota_credito,
-- nota_debito, orden_compra, cotizacion, pedido, entrega, recepcion.
-- 'devolucion' queda FUERA a propósito — no estaba en el alcance pedido, sigue
-- usando siguiente_numero_documento() sin cambios (no se toca esa función, la
-- sigue necesitando crear_devolucion()).
--
-- Columna `periodo_actual` (no pedida literalmente en la consigna, agregada por
-- necesidad real): Venta/Factura/NC/Pedido reinician su secuencia cada DÍA y
-- Entrega/Recepción/ND cada AÑO — sin trackear a qué período corresponde
-- proximo_numero, un contador puramente incremental cambiaría el formato visible
-- al cliente de un día para el otro (ej. pasaría de "20260620-001" a
-- "20260620-004" si ya se emitieron 3 facturas ayer). Esta columna es la que
-- permite reiniciar a 1 cuando cambia el día/año, preservando el comportamiento
-- actual exacto.
-- =============================================================================

-- 1. Tabla ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.series_numeracion (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo_documento  TEXT NOT NULL,
  prefijo         TEXT NOT NULL DEFAULT '',
  formato_fecha   TEXT NOT NULL DEFAULT 'ninguno',
  digitos         INTEGER NOT NULL DEFAULT 4,
  proximo_numero  INTEGER NOT NULL DEFAULT 1,
  periodo_actual  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 'devolucion' se agregó en producción a mano (ALTER TABLE, sin migration) cuando
  -- la 086 sumó ese tipo a seed_series_numeracion — verificado contra el CHECK real
  -- de prod (pg_get_constraintdef), que ya lo tiene. Se agrega acá para que el
  -- replay desde cero no reviente al insertar la fila 'devolucion' del seed.
  CONSTRAINT chk_series_tipo_documento CHECK (tipo_documento IN (
    'venta', 'factura', 'nota_credito', 'nota_debito',
    'orden_compra', 'cotizacion', 'pedido', 'entrega', 'recepcion', 'devolucion'
  )),
  CONSTRAINT chk_series_formato_fecha CHECK (formato_fecha IN ('YYYYMMDD', 'YYYY', 'ninguno')),
  UNIQUE (empresa_id, tipo_documento)
);

ALTER TABLE public.series_numeracion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "series_numeracion_all" ON public.series_numeracion;
CREATE POLICY "series_numeracion_all" ON public.series_numeracion
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

-- 2. Seed con los DEFAULT que reproducen EXACTO el formato actual de cada tipo --
-- (mismo patrón que seed_maestros_default de Unidades de Medida)
CREATE OR REPLACE FUNCTION public.seed_series_numeracion(p_empresa_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos) VALUES
    (p_empresa_id, 'venta',        '',     'YYYYMMDD', 3),
    (p_empresa_id, 'factura',      'FAC-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito', 'NC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'pedido',       'PED-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito',  'ND-',  'YYYY',     4),
    (p_empresa_id, 'entrega',      'ENT-', 'YYYY',     4),
    (p_empresa_id, 'recepcion',    'REC-', 'YYYY',     4),
    (p_empresa_id, 'orden_compra', 'OC-',  'ninguno',  5),
    (p_empresa_id, 'cotizacion',   'COT-', 'ninguno',  5)
  ON CONFLICT (empresa_id, tipo_documento) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_series_numeracion(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_series_numeracion(UUID) TO authenticated;

-- 3. Auto-seed para empresas nuevas — mismo patrón que trg_empresa_seed_maestros
CREATE OR REPLACE FUNCTION public.trg_fn_seed_series_numeracion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.seed_series_numeracion(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_empresa_seed_series_numeracion ON public.empresas;
CREATE TRIGGER trg_empresa_seed_series_numeracion
  AFTER INSERT ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_seed_series_numeracion();

-- 4. Seed retroactivo para empresas existentes (valores DEFAULT) ---------------
DO $$
DECLARE v_empresa RECORD;
BEGIN
  FOR v_empresa IN SELECT id FROM public.empresas LOOP
    PERFORM public.seed_series_numeracion(v_empresa.id);
  END LOOP;
END $$;

-- 5. Backfill: proximo_numero/periodo_actual = continuación exacta de lo emitido
-- hasta ahora por cada empresa, para no pisar ni repetir ningún número ya usado.
-- Timezone fijo UTC-3 (Argentina no observa horario de verano) — mismo criterio
-- que getNowAR()/getTodayAR() en src/lib/dateUtils.js, para que "hoy"/"este año"
-- coincidan entre el backfill (ahora) y obtener_proximo_numero() (de acá en más).

-- 5a. venta — comprobantes.numero_venta sin prefijo: "YYYYMMDD-NNN"
UPDATE public.series_numeracion sn
SET periodo_actual = to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD'),
    proximo_numero = COALESCE((
      SELECT MAX((regexp_match(c.numero_venta, '^([0-9]{8})-([0-9]+)$'))[2]::INT) + 1
      FROM public.comprobantes c
      WHERE c.empresa_id = sn.empresa_id
        AND c.numero_venta ~ ('^' || to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD') || '-[0-9]+$')
    ), 1)
WHERE sn.tipo_documento = 'venta';

-- 5b. factura — "FAC-YYYYMMDD-NNN"
UPDATE public.series_numeracion sn
SET periodo_actual = to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD'),
    proximo_numero = COALESCE((
      SELECT MAX((regexp_match(c.numero_venta, '^FAC-[0-9]{8}-([0-9]+)$'))[1]::INT) + 1
      FROM public.comprobantes c
      WHERE c.empresa_id = sn.empresa_id
        AND c.numero_venta ~ ('^FAC-' || to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD') || '-[0-9]+$')
    ), 1)
WHERE sn.tipo_documento = 'factura';

-- 5c. nota_credito — "NC-YYYYMMDD-NNN"
UPDATE public.series_numeracion sn
SET periodo_actual = to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD'),
    proximo_numero = COALESCE((
      SELECT MAX((regexp_match(c.numero_venta, '^NC-[0-9]{8}-([0-9]+)$'))[1]::INT) + 1
      FROM public.comprobantes c
      WHERE c.empresa_id = sn.empresa_id
        AND c.numero_venta ~ ('^NC-' || to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD') || '-[0-9]+$')
    ), 1)
WHERE sn.tipo_documento = 'nota_credito';

-- 5d. pedido — pedidos.numero "PED-YYYYMMDD-NNN"
UPDATE public.series_numeracion sn
SET periodo_actual = to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD'),
    proximo_numero = COALESCE((
      SELECT MAX((regexp_match(p.numero, '^PED-[0-9]{8}-([0-9]+)$'))[1]::INT) + 1
      FROM public.pedidos p
      WHERE p.empresa_id = sn.empresa_id
        AND p.numero ~ ('^PED-' || to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD') || '-[0-9]+$')
    ), 1)
WHERE sn.tipo_documento = 'pedido';

-- 5e. entrega — entregas.numero_entrega "ENT-YYYY-NNNN"
UPDATE public.series_numeracion sn
SET periodo_actual = to_char(NOW() - INTERVAL '3 hours', 'YYYY'),
    proximo_numero = COALESCE((
      SELECT MAX((regexp_match(e.numero_entrega, '^ENT-[0-9]{4}-([0-9]+)$'))[1]::INT) + 1
      FROM public.entregas e
      WHERE e.empresa_id = sn.empresa_id
        AND e.numero_entrega ~ ('^ENT-' || to_char(NOW() - INTERVAL '3 hours', 'YYYY') || '-[0-9]+$')
    ), 1)
WHERE sn.tipo_documento = 'entrega';

-- 5f. recepcion — recepciones.numero_recepcion "REC-YYYY-NNNN"
UPDATE public.series_numeracion sn
SET periodo_actual = to_char(NOW() - INTERVAL '3 hours', 'YYYY'),
    proximo_numero = COALESCE((
      SELECT MAX((regexp_match(r.numero_recepcion, '^REC-[0-9]{4}-([0-9]+)$'))[1]::INT) + 1
      FROM public.recepciones r
      WHERE r.empresa_id = sn.empresa_id
        AND r.numero_recepcion ~ ('^REC-' || to_char(NOW() - INTERVAL '3 hours', 'YYYY') || '-[0-9]+$')
    ), 1)
WHERE sn.tipo_documento = 'recepcion';

-- 5g. nota_debito — notas_debito.numero_nd "ND-YYYY-NNNN"
UPDATE public.series_numeracion sn
SET periodo_actual = to_char(NOW() - INTERVAL '3 hours', 'YYYY'),
    proximo_numero = COALESCE((
      SELECT MAX((regexp_match(nd.numero_nd, '^ND-[0-9]{4}-([0-9]+)$'))[1]::INT) + 1
      FROM public.notas_debito nd
      WHERE nd.empresa_id = sn.empresa_id
        AND nd.numero_nd ~ ('^ND-' || to_char(NOW() - INTERVAL '3 hours', 'YYYY') || '-[0-9]+$')
    ), 1)
WHERE sn.tipo_documento = 'nota_debito';

-- 5h. orden_compra — ordenes_compra.numero "OC-NNNNN" (global, sin fecha)
UPDATE public.series_numeracion sn
SET proximo_numero = COALESCE((
      SELECT MAX(CAST(REGEXP_REPLACE(oc.numero, '[^0-9]', '', 'g') AS INT)) + 1
      FROM public.ordenes_compra oc
      WHERE oc.empresa_id = sn.empresa_id
    ), 1)
WHERE sn.tipo_documento = 'orden_compra';

-- 5i. cotizacion — cotizaciones.numero "COT-NNNNN" (global, sin fecha)
UPDATE public.series_numeracion sn
SET proximo_numero = COALESCE((
      SELECT MAX(CAST(REGEXP_REPLACE(co.numero, '[^0-9]', '', 'g') AS INT)) + 1
      FROM public.cotizaciones co
      WHERE co.empresa_id = sn.empresa_id
    ), 1)
WHERE sn.tipo_documento = 'cotizacion';

-- 6. RPC atómica — única fuente de numeración de ahora en más -----------------
-- SELECT...FOR UPDATE bloquea la fila hasta el commit, evitando que dos llamadas
-- concurrentes lean el mismo proximo_numero (el bug real de siguiente_numero_documento,
-- que usaba COUNT(*) sin lock y podía repetir/saltar números).
--
-- NOTA FUTURA (Q3 2026): cuando lleguen las series específicas por tipo de
-- comprobante AFIP (A/B/C/E), este es el punto de extensión natural — agregar
-- p_punto_venta o una clave compuesta (tipo_documento + letra AFIP) en vez de
-- una serie única por tipo_documento. No implementado todavía, a propósito.
CREATE OR REPLACE FUNCTION public.obtener_proximo_numero(
  p_empresa_id UUID,
  p_tipo_documento TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_serie     RECORD;
  v_periodo   TEXT;
  v_numero    INTEGER;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT * INTO v_serie
  FROM public.series_numeracion
  WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Empresa sin series seedeadas (no debería pasar tras el trigger, pero por
    -- robustez la creamos al vuelo en vez de fallar).
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

  UPDATE public.series_numeracion
  SET proximo_numero = v_numero + 1,
      periodo_actual = v_periodo
  WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento;

  RETURN v_serie.prefijo
    || CASE WHEN v_periodo IS NOT NULL THEN v_periodo || '-' ELSE '' END
    || LPAD(v_numero::TEXT, v_serie.digitos, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_proximo_numero(UUID, TEXT) TO authenticated;
