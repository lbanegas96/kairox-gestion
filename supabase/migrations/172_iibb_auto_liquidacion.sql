-- migration 172 — IIBB auto-liquidación (Fase 4, última del plan de 4 frentes
-- contables, sesión 55, 2026-07-09).
--
-- Decisiones confirmadas con Luciano antes de programar:
--   - Soportar AMBAS modalidades: jurisdicción única y Convenio Multilateral.
--   - Los coeficientes de distribución de Convenio Multilateral son DATO MAESTRO
--     cargado a mano (como en la vida real: el contador los determina una vez al
--     año vía DDJJ CM05) — el sistema solo los APLICA, no los calcula desde
--     ventas por provincia (eso requeriría un subsistema nuevo de ventas por
--     jurisdicción que hoy no existe).
--   - Nalux opera hoy en jurisdicción única — el modo CM queda construido y
--     disponible pero no configurado/activo para ellos.
--
-- Base imponible: se reusa EXACTAMENTE la misma lógica que TabIVA.jsx usa para
-- el débito fiscal (comprobantes.tipo='venta' en el período, neto_gravado con
-- fallback total/1.21) — consistencia con el reporte de IVA ya existente.
--
-- Cuentas contables: se reusan '5.6' (Impuestos y Tasas) y '2.1.4' (Impuestos a
-- Pagar), ya seedeadas para toda empresa desde migration 004 — no hace falta
-- crear cuentas nuevas.

-- ─── Paso 1: configuración de modalidad en empresas ──────────────────────────

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS modalidad_iibb TEXT NOT NULL DEFAULT 'jurisdiccion_unica'
    CHECK (modalidad_iibb IN ('jurisdiccion_unica', 'convenio_multilateral')),
  ADD COLUMN IF NOT EXISTS jurisdiccion_iibb TEXT NULL; -- solo usado en modo jurisdicción única

-- ─── Paso 2: coeficientes de distribución (Convenio Multilateral) ───────────
-- Mismo patrón que alicuotas_impuestos (migration 032): maestro simple con
-- vigencia, cargado a mano desde la UI.

CREATE TABLE IF NOT EXISTS public.iibb_coeficientes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  jurisdiccion   TEXT NOT NULL,
  coeficiente    NUMERIC(6,4) NOT NULL CHECK (coeficiente > 0 AND coeficiente <= 100), -- porcentaje, ej: 45.0000 = 45%
  vigencia_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  vigencia_hasta DATE,
  activo         BOOLEAN NOT NULL DEFAULT true,
  observaciones  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.iibb_coeficientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "iibb_coeficientes_all" ON public.iibb_coeficientes;
CREATE POLICY "iibb_coeficientes_all" ON public.iibb_coeficientes
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_iibb_coeficientes_empresa_activo
  ON public.iibb_coeficientes(empresa_id, activo) WHERE activo = true;

-- ─── Paso 3: liquidaciones generadas ─────────────────────────────────────────
-- Snapshot de cada liquidación calculada — igual que facturas_pendientes_arca
-- o asientos_contables, un registro histórico inmutable una vez confirmado.
-- Escritura EXCLUSIVA vía los 2 RPCs de abajo (SECURITY DEFINER) — RLS de
-- solo lectura, mismo criterio que cuenta_corriente_imputaciones.

CREATE TABLE IF NOT EXISTS public.iibb_liquidaciones (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL,
  periodo_desde         DATE NOT NULL,
  periodo_hasta         DATE NOT NULL,
  modalidad             TEXT NOT NULL CHECK (modalidad IN ('jurisdiccion_unica', 'convenio_multilateral')),
  base_imponible_total  NUMERIC(14,2) NOT NULL,
  detalle               JSONB NOT NULL, -- [{jurisdiccion, coeficiente, base_imponible, alicuota, monto}]
  monto_total           NUMERIC(14,2) NOT NULL,
  estado                TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'confirmada')),
  asiento_id            UUID REFERENCES public.asientos_contables(id),
  fecha_generacion      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_confirmacion    TIMESTAMPTZ
);

ALTER TABLE public.iibb_liquidaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "iibb_liquidaciones_select" ON public.iibb_liquidaciones;
CREATE POLICY "iibb_liquidaciones_select" ON public.iibb_liquidaciones
  FOR SELECT USING (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_iibb_liquidaciones_empresa_periodo
  ON public.iibb_liquidaciones(empresa_id, periodo_desde DESC);

REVOKE ALL ON public.iibb_liquidaciones FROM anon, authenticated;
GRANT SELECT ON public.iibb_liquidaciones TO authenticated;

-- ─── Paso 4: generar_liquidacion_iibb ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.generar_liquidacion_iibb(
  p_empresa_id    UUID,
  p_user_id       UUID,
  p_periodo_desde DATE,
  p_periodo_hasta DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_modalidad          TEXT;
  v_jurisdiccion_unica TEXT;
  v_base_total         NUMERIC := 0;
  v_detalle            JSONB := '[]'::jsonb;
  v_monto_total        NUMERIC := 0;
  v_alicuota           NUMERIC;
  v_coef               RECORD;
  v_suma_coeficientes  NUMERIC := 0;
  v_base_jurisdiccion  NUMERIC;
  v_monto_jurisdiccion NUMERIC;
  v_liquidacion_id     UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('configuracion') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso para liquidar impuestos';
  END IF;
  IF p_periodo_hasta < p_periodo_desde THEN
    RAISE EXCEPTION 'El período hasta no puede ser anterior al período desde';
  END IF;

  SELECT modalidad_iibb, jurisdiccion_iibb INTO v_modalidad, v_jurisdiccion_unica
  FROM public.empresas WHERE id = p_empresa_id;

  -- Base imponible: misma lógica que la Posición IVA (TabIVA.jsx) — ventas del
  -- período, neto_gravado con fallback total/1.21 para comprobantes viejos
  -- sin discriminar.
  SELECT COALESCE(SUM(COALESCE(neto_gravado, total / 1.21)), 0) INTO v_base_total
  FROM public.comprobantes
  WHERE empresa_id = p_empresa_id
    AND tipo = 'venta'
    AND fecha >= p_periodo_desde::timestamptz
    AND fecha <  (p_periodo_hasta + 1)::timestamptz;

  IF v_modalidad = 'convenio_multilateral' THEN
    FOR v_coef IN
      SELECT jurisdiccion, coeficiente FROM public.iibb_coeficientes
      WHERE empresa_id = p_empresa_id AND activo = true
        AND vigencia_desde <= p_periodo_hasta
        AND (vigencia_hasta IS NULL OR vigencia_hasta >= p_periodo_hasta)
    LOOP
      v_suma_coeficientes := v_suma_coeficientes + v_coef.coeficiente;
    END LOOP;

    IF v_suma_coeficientes = 0 THEN
      RAISE EXCEPTION 'No hay coeficientes de Convenio Multilateral vigentes para este período. Cargalos en Impuestos > IIBB.';
    END IF;
    IF ABS(v_suma_coeficientes - 100) > 0.01 THEN
      RAISE EXCEPTION 'Los coeficientes vigentes suman % (deberían sumar 100) — revisá la carga antes de liquidar', v_suma_coeficientes;
    END IF;

    FOR v_coef IN
      SELECT jurisdiccion, coeficiente FROM public.iibb_coeficientes
      WHERE empresa_id = p_empresa_id AND activo = true
        AND vigencia_desde <= p_periodo_hasta
        AND (vigencia_hasta IS NULL OR vigencia_hasta >= p_periodo_hasta)
      ORDER BY jurisdiccion
    LOOP
      SELECT alicuota INTO v_alicuota
      FROM public.alicuotas_impuestos
      WHERE empresa_id = p_empresa_id AND impuesto = 'IIBB' AND jurisdiccion = v_coef.jurisdiccion
        AND activo = true
        AND vigencia_desde <= p_periodo_hasta
        AND (vigencia_hasta IS NULL OR vigencia_hasta >= p_periodo_hasta)
      ORDER BY vigencia_desde DESC LIMIT 1;

      IF v_alicuota IS NULL THEN
        RAISE EXCEPTION 'Falta la alícuota de IIBB para % — cargala en Impuestos > Alícuotas', v_coef.jurisdiccion;
      END IF;

      v_base_jurisdiccion  := ROUND(v_base_total * v_coef.coeficiente / 100, 2);
      v_monto_jurisdiccion := ROUND(v_base_jurisdiccion * v_alicuota / 100, 2);
      v_monto_total        := v_monto_total + v_monto_jurisdiccion;

      v_detalle := v_detalle || jsonb_build_object(
        'jurisdiccion', v_coef.jurisdiccion,
        'coeficiente', v_coef.coeficiente,
        'base_imponible', v_base_jurisdiccion,
        'alicuota', v_alicuota,
        'monto', v_monto_jurisdiccion
      );
    END LOOP;
  ELSE
    -- Jurisdicción única
    IF v_jurisdiccion_unica IS NULL OR v_jurisdiccion_unica = '' THEN
      RAISE EXCEPTION 'No hay jurisdicción de IIBB configurada para esta empresa. Configurala en Impuestos > IIBB.';
    END IF;

    SELECT alicuota INTO v_alicuota
    FROM public.alicuotas_impuestos
    WHERE empresa_id = p_empresa_id AND impuesto = 'IIBB' AND jurisdiccion = v_jurisdiccion_unica
      AND activo = true
      AND vigencia_desde <= p_periodo_hasta
      AND (vigencia_hasta IS NULL OR vigencia_hasta >= p_periodo_hasta)
    ORDER BY vigencia_desde DESC LIMIT 1;

    IF v_alicuota IS NULL THEN
      RAISE EXCEPTION 'Falta la alícuota de IIBB para % — cargala en Impuestos > Alícuotas', v_jurisdiccion_unica;
    END IF;

    v_monto_total := ROUND(v_base_total * v_alicuota / 100, 2);

    v_detalle := jsonb_build_array(jsonb_build_object(
      'jurisdiccion', v_jurisdiccion_unica,
      'coeficiente', 100,
      'base_imponible', v_base_total,
      'alicuota', v_alicuota,
      'monto', v_monto_total
    ));
  END IF;

  INSERT INTO public.iibb_liquidaciones
    (empresa_id, user_id, periodo_desde, periodo_hasta, modalidad, base_imponible_total, detalle, monto_total)
  VALUES
    (p_empresa_id, p_user_id, p_periodo_desde, p_periodo_hasta, v_modalidad, v_base_total, v_detalle, v_monto_total)
  RETURNING id INTO v_liquidacion_id;

  RETURN jsonb_build_object(
    'id', v_liquidacion_id,
    'modalidad', v_modalidad,
    'base_imponible_total', v_base_total,
    'detalle', v_detalle,
    'monto_total', v_monto_total
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.generar_liquidacion_iibb(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generar_liquidacion_iibb(uuid, uuid, date, date) TO authenticated;

-- ─── Paso 5: confirmar_liquidacion_iibb ──────────────────────────────────────
-- Genera el asiento contable (devengado): Debe Impuestos y Tasas (5.6) /
-- Haber Impuestos a Pagar (2.1.4) — el pago efectivo se registra después con
-- el flujo normal de Caja/Bancos (egreso manual), igual que cualquier otro
-- pago de impuestos hoy.

CREATE OR REPLACE FUNCTION public.confirmar_liquidacion_iibb(
  p_empresa_id     UUID,
  p_user_id        UUID,
  p_liquidacion_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_liq              RECORD;
  v_cta_impuestos    UUID;
  v_cta_a_pagar      UUID;
  v_asiento_id       UUID;
  v_asiento_generado BOOLEAN := false;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('configuracion') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso para liquidar impuestos';
  END IF;

  SELECT * INTO v_liq FROM public.iibb_liquidaciones
  WHERE id = p_liquidacion_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La liquidación no existe o no pertenece a esta empresa';
  END IF;
  IF v_liq.estado = 'confirmada' THEN
    RAISE EXCEPTION 'Esta liquidación ya fue confirmada';
  END IF;

  BEGIN
    SELECT id INTO v_cta_impuestos FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '5.6' AND activa LIMIT 1;
    SELECT id INTO v_cta_a_pagar   FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '2.1.4' AND activa LIMIT 1;

    IF v_cta_impuestos IS NOT NULL AND v_cta_a_pagar IS NOT NULL AND v_liq.monto_total > 0 THEN
      INSERT INTO public.asientos_contables
        (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
      VALUES (
        p_empresa_id, p_user_id, next_numero_asiento(p_empresa_id), CURRENT_DATE,
        'Liquidación IIBB ' || to_char(v_liq.periodo_desde, 'MM/YYYY'),
        'confirmado', v_liq.monto_total, v_liq.monto_total, 'iibb_liquidacion', v_liq.id
      ) RETURNING id INTO v_asiento_id;

      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, p_empresa_id, v_cta_impuestos, 'IIBB devengado del período', v_liq.monto_total, 0),
        (v_asiento_id, p_empresa_id, v_cta_a_pagar,   'IIBB a pagar', 0, v_liq.monto_total);

      v_asiento_generado := true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_asiento_generado := false;
  END;

  UPDATE public.iibb_liquidaciones
  SET estado = 'confirmada', asiento_id = v_asiento_id, fecha_confirmacion = NOW()
  WHERE id = p_liquidacion_id;

  RETURN jsonb_build_object('ok', true, 'asiento_generado', v_asiento_generado);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirmar_liquidacion_iibb(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirmar_liquidacion_iibb(uuid, uuid, uuid) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.confirmar_liquidacion_iibb(uuid, uuid, uuid);
-- DROP FUNCTION IF EXISTS public.generar_liquidacion_iibb(uuid, uuid, date, date);
-- DROP TABLE IF EXISTS public.iibb_liquidaciones;
-- DROP TABLE IF EXISTS public.iibb_coeficientes;
-- ALTER TABLE public.empresas DROP COLUMN IF EXISTS jurisdiccion_iibb, DROP COLUMN IF EXISTS modalidad_iibb;
