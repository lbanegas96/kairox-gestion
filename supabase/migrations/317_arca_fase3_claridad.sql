-- ════════════════════════════════════════════════════════════════════════════
-- Migration 317 — Fase 3 del plan de robustez AFIP/ARCA (PLAN_ROBUSTEZ_FACTURACION_ARCA.md)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Objetivo: mensajes de error claros y explícitos para un usuario no técnico
-- (hoy solo se ve el string crudo de ARCA, tipo "[10197] Si el comprobante
-- es Debito o Credito, enviar estructura CbteAsoc o PeriodoAsoc").
--
--   1. Columna nueva `error_mensaje_usuario` en `facturas_pendientes_arca` y
--      `error_afip_usuario` en `comprobantes` — el worker (código, no esta
--      migración) va a poblarlas con la traducción a lenguaje humano de los
--      códigos AFIP más frecuentes, calculada por `mensajeHumano()` en
--      `_shared/afip.ts`. El mensaje crudo original NO se pisa (sigue en
--      `error_mensaje`/`error_afip`, para quien quiera el detalle técnico).
--   2. Columna `motivo_definitivo` en `facturas_pendientes_arca` —
--      distingue "el sistema agotó los reintentos" de "el sistema decidió
--      activamente no reintentar" (caso ambiguo, Fase 1). Hoy ambos casos se
--      ven idénticos en el Monitor (intentos=0, mismo badge "Revisión
--      manual"), y son causas raíz completamente distintas.
--   3. Vista `v_facturas_arca_monitor` — expone las 3 columnas nuevas.
--   4. RPC `marcar_cae_resuelto_manual` — gana 3 parámetros opcionales
--      (p_cae, p_numero_afip, p_cae_vencimiento). Antes, marcar un
--      comprobante como "resuelto manualmente" lo dejaba con
--      cae_estado='emitido' pero SIN CAE ni Nº AFIP — legalmente incompleto
--      si el usuario en realidad verificó en el portal ARCA que sí tiene
--      CAE y quiere cargarlo. Sigue funcionando igual si no se pasan (caso
--      "lo emití por fuera del sistema, no me importa el CAE acá").

-- ── 1. Columnas nuevas ───────────────────────────────────────────────────────
ALTER TABLE public.facturas_pendientes_arca
  ADD COLUMN IF NOT EXISTS error_mensaje_usuario TEXT,
  ADD COLUMN IF NOT EXISTS motivo_definitivo TEXT
    CHECK (motivo_definitivo IS NULL OR motivo_definitivo IN ('ambiguo_sin_reintento', 'reintentos_agotados'));

COMMENT ON COLUMN public.facturas_pendientes_arca.error_mensaje_usuario IS
  'Traducción a lenguaje humano de error_mensaje (mensajeHumano() en _shared/afip.ts). error_mensaje sigue siendo el crudo, para detalle técnico.';
COMMENT ON COLUMN public.facturas_pendientes_arca.motivo_definitivo IS
  'ambiguo_sin_reintento = el sistema decidió activamente no reintentar (Fase 1, no pudo reconciliar). reintentos_agotados = se acabaron los 5 intentos con backoff. NULL en filas no terminales.';

ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS error_afip_usuario TEXT;

COMMENT ON COLUMN public.comprobantes.error_afip_usuario IS
  'Traducción a lenguaje humano de error_afip — ver facturas_pendientes_arca.error_mensaje_usuario.';

-- ── 2. Vista del Monitor — expone las columnas nuevas ────────────────────────
-- CREATE OR REPLACE VIEW no admite insertar/renombrar columnas en el medio de
-- la lista (Postgres lo interpreta como rename) — reconstruida a partir de
-- pg_get_viewdef() del estado REAL en producción (incluía columnas de CAEA
-- — modo_autorizacion/caea_registro_id/caea_codigo — agregadas por una
-- migración posterior a la 202 que no estaba reflejada en este archivo
-- local). Las 3 columnas nuevas de esta migración van SOLO al final.
CREATE OR REPLACE VIEW public.v_facturas_arca_monitor
WITH (security_invoker = on) AS
SELECT
  c.id                     AS comprobante_id,
  c.empresa_id,
  c.numero_venta,
  c.fecha,
  c.total,
  c.tipo,
  c.tipo_comprobante_afip,
  c.cliente_nombre,
  c.cae_estado,
  c.cae,
  c.cae_vencimiento,
  c.numero_afip,
  c.error_afip,
  c.relevante_fiscal,
  fpa.intentos,
  fpa.max_intentos,
  fpa.estado            AS estado_cola,
  fpa.error_mensaje     AS error_cola,
  fpa.proximo_intento,
  fpa.updated_at        AS ultima_actividad,
  c.modo_autorizacion,
  c.caea_registro_id,
  cr.caea                AS caea_codigo,
  c.error_afip_usuario,
  fpa.error_mensaje_usuario AS error_cola_usuario,
  fpa.motivo_definitivo
FROM public.comprobantes c
LEFT JOIN public.caea_registros cr ON cr.id = c.caea_registro_id
LEFT JOIN LATERAL (
  SELECT intentos, max_intentos, estado, error_mensaje, error_mensaje_usuario, motivo_definitivo, proximo_intento, updated_at
  FROM public.facturas_pendientes_arca f
  WHERE f.comprobante_id = c.id
  ORDER BY f.created_at DESC
  LIMIT 1
) fpa ON true;

GRANT SELECT ON public.v_facturas_arca_monitor TO authenticated;

-- ── 3. RPC marcar_cae_resuelto_manual — captura opcional del CAE real ────────
CREATE OR REPLACE FUNCTION public.marcar_cae_resuelto_manual(
  p_comprobante_id uuid,
  p_cae text DEFAULT NULL,
  p_numero_afip text DEFAULT NULL,
  p_cae_vencimiento date DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_empresa_id uuid;
BEGIN
  SELECT empresa_id INTO v_empresa_id FROM public.comprobantes WHERE id = p_comprobante_id;
  IF v_empresa_id IS NULL OR v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: comprobante no encontrado o de otra empresa';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  -- Si se informa CAE, el Nº de comprobante AFIP es obligatorio (y viceversa)
  -- — un CAE sin número, o un número sin CAE, no es un dato fiscal completo.
  IF (p_cae IS NOT NULL) IS DISTINCT FROM (p_numero_afip IS NOT NULL) THEN
    RAISE EXCEPTION 'Si cargás el CAE, también tenés que cargar el Nº de comprobante AFIP (y viceversa).';
  END IF;

  UPDATE public.facturas_pendientes_arca SET
    estado = 'emitida',
    cae = COALESCE(p_cae, cae),
    cae_vencimiento = COALESCE(p_cae_vencimiento, cae_vencimiento),
    updated_at = now()
   WHERE comprobante_id = p_comprobante_id;

  UPDATE public.comprobantes SET
    cae_estado = 'emitido',
    error_afip = NULL,
    error_afip_usuario = NULL,
    cae = COALESCE(p_cae, cae),
    numero_afip = COALESCE(p_numero_afip, numero_afip),
    cae_vencimiento = COALESCE(p_cae_vencimiento, cae_vencimiento)
   WHERE id = p_comprobante_id;

  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.marcar_cae_resuelto_manual(uuid, text, text, date) FROM anon;

-- ROLLBACK (comentado):
--   DROP VIEW IF EXISTS public.v_facturas_arca_monitor; (recrear versión mig.202)
--   CREATE OR REPLACE FUNCTION public.marcar_cae_resuelto_manual(uuid) ... (versión mig.202/203)
--   ALTER TABLE public.facturas_pendientes_arca DROP COLUMN error_mensaje_usuario, DROP COLUMN motivo_definitivo;
--   ALTER TABLE public.comprobantes DROP COLUMN error_afip_usuario;
