-- migration 244 — puntos_venta.envia_arca (SAP: Serie fiscal vs. Serie interna)
-- + RPC emitir_remito
--
-- CONTEXTO (pedido de Luciano): en SAP se pueden cargar varios puntos de
-- venta y elegir cuál de ellos manda comprobantes a ARCA y cuál queda
-- interno (control propio, numerado con CAI en vez de CAE). Hoy KAIROX
-- soporta múltiples filas en `puntos_venta`, pero el campo `tipo`
-- ('web'/'manual') es puramente decorativo — el trigger que encola a ARCA
-- (fn_queue_factura_arca, migration 087) no lo consulta en absoluto.
--
-- ALCANCE DE ESTA MIGRACIÓN — deliberadamente acotado:
--   1. `puntos_venta.envia_arca` — flag real, default true (no cambia el
--      comportamiento de ningún PdV existente).
--   2. `entregas.punto_venta_id` / `numero_remito` / `cai_remito_usado` /
--      `cai_remito_vencimiento_usado` — para poder emitir un remito real
--      (hoy `cai_remito` se carga en Configuración pero no se usa en
--      ningún lado, confirmado con Luciano: "los remitos por el momento
--      no se emiten, solo se carga el CAI").
--   3. RPC `emitir_remito` — numera atómicamente contra el PdV interno
--      (mismo patrón SELECT...FOR UPDATE que obtener_proximo_numero,
--      migration 221) para que el número de remito nunca se duplique ni
--      salte, igual que exige la numeración CAI ante ARCA.
--
-- NO TOCADO A PROPÓSITO (fuera de alcance, requiere decisión de Luciano):
-- `useAfipConfig.js` sigue eligiendo el PdV activo con
-- `.eq('activo', true).limit(1)` — es decir, hoy el circuito de FACTURACIÓN
-- (crear_venta → useConfirmarVenta → cae_estado='pendiente') sigue usando
-- siempre el mismo único PdV fiscal, sin selector. Tocar ese circuito para
-- soportar múltiples PdV fiscales o un selector por venta es un cambio de
-- mayor alcance sobre código que ya está en producción emitiendo CAE real
-- — no se hizo en este pase. Esta migración resuelve el caso concreto que
-- pidió Luciano (remitos con PdV interno), no una reforma completa del
-- selector de PdV en ventas.

-- ─── Paso 1: envia_arca en puntos_venta ──────────────────────────────────
ALTER TABLE public.puntos_venta
  ADD COLUMN IF NOT EXISTS envia_arca BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.puntos_venta.envia_arca IS
  'true = PdV fiscal, comprobantes emitidos ahí van a ARCA (CAE). false = PdV interno/control propio (ej. remitos con CAI) — nunca se encola a ARCA.';

-- ─── Paso 2: columnas de remito en entregas ──────────────────────────────
ALTER TABLE public.entregas
  ADD COLUMN IF NOT EXISTS punto_venta_id             UUID REFERENCES public.puntos_venta(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS numero_remito              TEXT,
  ADD COLUMN IF NOT EXISTS cai_remito_usado            TEXT,
  ADD COLUMN IF NOT EXISTS cai_remito_vencimiento_usado DATE;

COMMENT ON COLUMN public.entregas.numero_remito IS
  'Número secuencial asignado por emitir_remito() contra puntos_venta.proximo_numero_remito. NULL = todavía no se emitió remito para esta entrega.';
COMMENT ON COLUMN public.entregas.cai_remito_usado IS
  'Snapshot del CAI vigente en puntos_venta al momento de emitir — el CAI del PdV puede renovarse después, este campo preserva el que realmente se usó (dato legal, no debe cambiar retroactivamente).';

CREATE UNIQUE INDEX IF NOT EXISTS idx_entregas_numero_remito_por_pv
  ON public.entregas(punto_venta_id, numero_remito)
  WHERE numero_remito IS NOT NULL;

-- ─── Paso 3: RPC emitir_remito ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.emitir_remito(p_empresa_id uuid, p_entrega_id uuid, p_punto_venta_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entrega     RECORD;
  v_pv          RECORD;
  v_numero      INTEGER;
  v_numero_fmt  TEXT;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el tenant del caller';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  SELECT * INTO v_entrega
  FROM public.entregas
  WHERE id = p_entrega_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrega no encontrada';
  END IF;
  IF v_entrega.numero_remito IS NOT NULL THEN
    RAISE EXCEPTION 'Esta entrega ya tiene remito emitido (Nº %)', v_entrega.numero_remito;
  END IF;

  -- Punto de venta interno: el que se pase explícito, o si no se pasa
  -- ninguno, el primer PdV activo con envia_arca=false de la empresa
  -- (mismo criterio simple que useAfipConfig.js usa para el fiscal).
  IF p_punto_venta_id IS NOT NULL THEN
    SELECT * INTO v_pv
    FROM public.puntos_venta
    WHERE id = p_punto_venta_id AND empresa_id = p_empresa_id
    FOR UPDATE;
  ELSE
    SELECT * INTO v_pv
    FROM public.puntos_venta
    WHERE empresa_id = p_empresa_id AND activo = true AND envia_arca = false
    ORDER BY es_default DESC, numero ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay un punto de venta interno (no fiscal) configurado para remitos. Creá uno en Configuración > Facturación con "Envía a ARCA" desactivado.';
  END IF;
  IF v_pv.cai_remito IS NULL OR v_pv.cai_remito = '' THEN
    RAISE EXCEPTION 'El punto de venta "%" no tiene CAI de remito cargado.', v_pv.nombre;
  END IF;
  IF v_pv.cai_remito_vencimiento IS NOT NULL AND v_pv.cai_remito_vencimiento < CURRENT_DATE THEN
    RAISE EXCEPTION 'El CAI de remito del punto de venta "%" venció el %.', v_pv.nombre, v_pv.cai_remito_vencimiento;
  END IF;

  v_numero := v_pv.proximo_numero_remito;
  v_numero_fmt := LPAD(v_pv.numero::TEXT, 4, '0') || '-' || LPAD(v_numero::TEXT, 8, '0');

  UPDATE public.puntos_venta
  SET proximo_numero_remito = v_numero + 1
  WHERE id = v_pv.id;

  UPDATE public.entregas
  SET punto_venta_id                = v_pv.id,
      numero_remito                 = v_numero_fmt,
      cai_remito_usado              = v_pv.cai_remito,
      cai_remito_vencimiento_usado  = v_pv.cai_remito_vencimiento
  WHERE id = p_entrega_id;

  RETURN jsonb_build_object(
    'entrega_id', p_entrega_id,
    'numero_remito', v_numero_fmt,
    'cai', v_pv.cai_remito,
    'cai_vencimiento', v_pv.cai_remito_vencimiento,
    'punto_venta_nombre', v_pv.nombre
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.emitir_remito(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.emitir_remito(uuid, uuid, uuid) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.emitir_remito(uuid, uuid, uuid);
-- DROP INDEX IF EXISTS public.idx_entregas_numero_remito_por_pv;
-- ALTER TABLE public.entregas DROP COLUMN IF EXISTS punto_venta_id, DROP COLUMN IF EXISTS numero_remito, DROP COLUMN IF EXISTS cai_remito_usado, DROP COLUMN IF EXISTS cai_remito_vencimiento_usado;
-- ALTER TABLE public.puntos_venta DROP COLUMN IF EXISTS envia_arca;
