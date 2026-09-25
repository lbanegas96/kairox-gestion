-- CORRECCIÓN DE DATOS (no es una migración de esquema) — reversar los 8 asientos duplicados de Nalux
--
-- ⚠️  NO APLICAR sin el OK de Luciano: depende de la decisión «empresa limpia vs regularizar Nalux»
--     (ver PENDIENTES_LUCIANO_AUDITORIA.md, punto 3). Si se decide empezar con una empresa limpia, esto no hace falta.
--     Requiere la mig. 410 (reversar_asiento_interno) aplicada.
--
-- Auditoría 24/09/2026, hallazgos CON-2 y CON-3. Son 8 asientos que quedaron DUPLICADOS (el mismo documento tiene dos
-- asientos confirmados) y suman de más en el mayor. En 7 casos el duplicado nació de «Regenerar asiento» sobre un
-- cobro/pago cuyo asiento original existía sin vínculo (mig. 409 lo evita hacia adelante); en el octavo, de la doble
-- imputación de una Factura por OC (mig. 397 reversó otras 3 y dejó esta).
--
-- Se reversa el asiento HUÉRFANO (el que el documento NO tiene vinculado) de cada par; el vinculado queda como el
-- asiento vigente del documento:
--
--   cobros   AS-000131 ($10.000) · AS-000141 ($50.012) · AS-000159 ($6.320)   →  $66.332
--   pagos    AS-000132 ($40.000) · AS-000142 ($6.415)  · AS-000160 ($1.500) · AS-000164 ($500)   →  $48.415
--   compra   AS-000318 ($550.000,66)  (la compra Amazon, factura 889998899888, quedó vinculada al AS-000319)
--
-- Igual que la mig. 397: contra-asiento CONFIRMADO con origen `reversa_asiento_duplicado` y origen_id = el asiento
-- reversado, fecha = el día en que se aplica (los períodos anteriores no se reescriben).
--
-- Seguro de repetir: cada fila se reversa solo si sigue confirmada, sin reversa previa, sin vínculo con el documento
-- y con su par vigente todavía vinculado; si algo no cumple, se saltea y lo avisa (NOTICE) sin fallar.
--
-- Vista previa (solo lectura), para ver qué reversaría:
--   SELECT a.numero, a.origen, a.total_debe, a.estado FROM public.asientos_contables a
--   WHERE a.empresa_id = 'cbc4db74-ec31-4324-bd36-207b7a7bd99a'
--     AND a.numero IN ('AS-000131','AS-000141','AS-000159','AS-000132','AS-000142','AS-000160','AS-000164','AS-000318');

DO $fix$
DECLARE
  c_empresa constant uuid := 'cbc4db74-ec31-4324-bd36-207b7a7bd99a';  -- Nalux
  r          record;
  v_vinculo  uuid;
  v_par      boolean;
  v_res      jsonb;
  v_hechos   int := 0;
BEGIN
  FOR r IN
    SELECT a.id, a.numero, a.user_id, a.origen, a.origen_id, a.estado, a.total_debe
    FROM public.asientos_contables a
    WHERE a.empresa_id = c_empresa
      AND a.numero IN ('AS-000131', 'AS-000141', 'AS-000159', 'AS-000132', 'AS-000142', 'AS-000160', 'AS-000164', 'AS-000318')
    ORDER BY a.numero
  LOOP
    IF r.estado <> 'confirmado' THEN
      RAISE NOTICE '% se saltea: no está confirmado (%)', r.numero, r.estado;
      CONTINUE;
    END IF;

    -- ¿Qué asiento tiene vinculado el documento?
    v_vinculo := CASE r.origen
      WHEN 'cobro_cliente'  THEN (SELECT m.asiento_id FROM public.cuenta_corriente_movimientos m WHERE m.id = r.origen_id)
      WHEN 'pago_proveedor' THEN (SELECT m.asiento_id FROM public.cuenta_corriente_proveedores m WHERE m.id = r.origen_id)
      WHEN 'compra'         THEN (SELECT c.asiento_id   FROM public.compras c                    WHERE c.id = r.origen_id)
    END;

    IF v_vinculo IS NULL OR v_vinculo = r.id THEN
      RAISE NOTICE '% se saltea: es el asiento vinculado al documento (o el documento no tiene vínculo), no un huérfano', r.numero;
      CONTINUE;
    END IF;

    -- El par vigente (el vinculado) tiene que seguir confirmado y por el mismo importe.
    SELECT EXISTS (
      SELECT 1 FROM public.asientos_contables p
      WHERE p.id = v_vinculo AND p.estado = 'confirmado' AND p.total_debe = r.total_debe
    ) INTO v_par;
    IF NOT v_par THEN
      RAISE NOTICE '% se saltea: su par vinculado no está confirmado o no coincide en el importe', r.numero;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.asientos_contables x
      WHERE x.empresa_id = c_empresa AND x.origen_id = r.id AND x.origen LIKE 'reversa\_asiento%' ESCAPE '\' AND x.estado = 'confirmado'
    ) THEN
      RAISE NOTICE '% se saltea: ya tiene una reversa', r.numero;
      CONTINUE;
    END IF;

    v_res := public.reversar_asiento_interno(
      r.id,
      'duplicado huérfano — el documento ya tiene su asiento vigente (auditoría 24/09, CON-2/CON-3)',
      'reversa_asiento_duplicado',
      r.user_id,
      NULL
    );
    v_hechos := v_hechos + 1;
    RAISE NOTICE '% reversado → %', r.numero, v_res ->> 'numero';
  END LOOP;

  RAISE NOTICE 'Duplicados reversados: % de 8', v_hechos;
END
$fix$;
