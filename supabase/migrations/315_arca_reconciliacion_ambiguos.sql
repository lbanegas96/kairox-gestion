-- ════════════════════════════════════════════════════════════════════════════
-- Migration 315 — Fase 1 del plan de robustez AFIP/ARCA (PLAN_ROBUSTEZ_FACTURACION_ARCA.md)
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO: 06/08-10/08, 7 Facturas C quedaron en error_definitivo porque
-- arca-worker detectó "estado ambiguo" (FECompUltimoAutorizado adelantado
-- respecto al contador local) y se rindió directo a revisión manual, sin
-- reintentar ni verificar si el comprobante en disputa era el nuestro.
-- Auditoría de código + enfoque SAP + investigación de mercado confirmaron la
-- misma causa raíz: falta el segundo paso de reconciliación (FECompConsultar,
-- que trae el detalle real con su CAE) antes de rendirse. Patrón estándar de
-- la industria: "confirm-before-repeat".
--
-- Esta migración es el soporte de base de datos para esa reconciliación
-- (implementada en arca-worker/index.ts + _shared/wsfe.ts + _shared/afip.ts,
-- desplegados junto con esta migración — ver "Orden de despliegue" al final):
--
--   1. RPC `fn_persistir_cae_emitido` — la reconciliación, cuando encuentra
--      que el comprobante ambiguo SÍ es el nuestro, tiene que persistir el CAE
--      encontrado. El código viejo hacía esto con 3 llamadas HTTP sueltas en
--      un Promise.all (arca-worker/index.ts:305-333) — no atómico: si el
--      proceso se corta a mitad de camino, puede quedar un comprobante
--      "fantasma" (CAE real en ARCA, pero cae_estado='pendiente' para siempre
--      en KAIROX, con su fila de cola trabada en 'procesando', invisible al
--      worker). Esta RPC hace las 3 escrituras en una única transacción de
--      Postgres. Es worker-only (auth.role()='service_role'), nunca
--      invocable por un usuario humano — el CAE que persiste es la fuente de
--      verdad legal de un comprobante fiscal, no hay ningún caso de uso
--      legítimo para que un tenant la llame directo.
--
--   2. Hardening de permisos en `facturas_pendientes_arca`: la migración 082
--      le dio a `authenticated` GRANT directo de INSERT/UPDATE/DELETE sobre
--      la tabla, pero las 3 RPCs que la tocan (reintentar_caes_lote,
--      marcar_cae_resuelto_manual, y ahora fn_persistir_cae_emitido) son
--      todas SECURITY DEFINER — no lo necesitan. Ese grant amplio contradice
--      el patrón que el propio proyecto ya sigue en otras tablas fiscales
--      (ver puntos_venta_numeracion, migración 273: "SIN policy de escritura
--      → nadie puede tocarla desde la app, solo service_role"). Se achica a
--      SELECT únicamente, confirmado sin uso de escritura directa desde el
--      frontend (grep sobre src/: todos los .from('facturas_pendientes_arca')
--      existentes son SELECT).
--
-- ── Orden de despliegue ──────────────────────────────────────────────────────
-- 1. Aplicar esta migración (inocua sola: crea una función que nadie llama
--    todavía con el código viejo, y el REVOKE no rompe nada porque no hay
--    escrituras directas desde el frontend).
-- 2. Desplegar `arca-worker` con el código nuevo (incluye _shared/wsfe.ts y
--    _shared/afip.ts actualizados).
--
-- ── Verificación post-despliegue ─────────────────────────────────────────────
-- Sobre uno de los comprobantes reales atascados (Factura C, PdV1, N°35):
--   SELECT cae_estado, cae, numero_afip, error_afip FROM comprobantes WHERE numero_afip LIKE '%-00000035';
-- Tras el próximo ciclo del worker, si el N°35 en ARCA es efectivamente
-- nuestro (mismo total/documento), debería quedar cae_estado='emitido' con
-- el CAE real, SIN intervención manual.

-- ── 1. RPC: persistencia atómica del CAE encontrado (worker-only) ───────────
CREATE OR REPLACE FUNCTION public.fn_persistir_cae_emitido(
  p_fpa_id             uuid,
  p_comprobante_id     uuid,
  p_empresa_id         uuid,
  p_punto_venta_id     uuid,
  p_cbte_tipo          integer,
  p_cae                text,
  p_cae_vencimiento    date,
  p_numero_afip        text,
  p_numero_correlativo integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Nunca invocable por un usuario humano — el CAE que esta función persiste
  -- es la fuente de verdad legal de un comprobante fiscal. Mismo patrón de
  -- guard que usar_caea_para_comprobante (migración 225).
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'No autorizado: función interna de arca-worker';
  END IF;

  UPDATE public.comprobantes
     SET cae              = p_cae,
         cae_vencimiento  = p_cae_vencimiento,
         cae_estado       = 'emitido',
         numero_afip      = p_numero_afip,
         error_afip       = NULL
   WHERE id = p_comprobante_id AND empresa_id = p_empresa_id;

  -- GREATEST: nunca retrocede el contador aunque llegue un número menor al
  -- ya conocido (defensivo ante una reconciliación fuera de orden).
  INSERT INTO public.puntos_venta_numeracion (empresa_id, punto_venta_id, cbte_tipo, ultimo_numero, updated_at)
  VALUES (p_empresa_id, p_punto_venta_id, p_cbte_tipo, p_numero_correlativo, now())
  ON CONFLICT (punto_venta_id, cbte_tipo) DO UPDATE
    SET ultimo_numero = GREATEST(public.puntos_venta_numeracion.ultimo_numero, EXCLUDED.ultimo_numero),
        updated_at    = now();

  UPDATE public.facturas_pendientes_arca
     SET estado           = 'emitida',
         cae              = p_cae,
         cae_vencimiento  = p_cae_vencimiento,
         numero_arca      = p_numero_correlativo,
         updated_at       = now()
   WHERE id = p_fpa_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_persistir_cae_emitido(uuid, uuid, uuid, uuid, integer, text, date, text, integer)
  FROM PUBLIC, anon, authenticated;

-- ── 2. Hardening: facturas_pendientes_arca solo por RPC, nunca .update() suelto ─
REVOKE INSERT, UPDATE, DELETE ON public.facturas_pendientes_arca FROM authenticated;
-- SELECT se mantiene (lo usa v_facturas_arca_monitor con security_invoker, y
-- useNotifications.js para el badge de "requiere intervención").

-- ROLLBACK (comentado):
--   DROP FUNCTION IF EXISTS public.fn_persistir_cae_emitido(uuid, uuid, uuid, uuid, integer, text, date, text, integer);
--   GRANT INSERT, UPDATE, DELETE ON public.facturas_pendientes_arca TO authenticated;
--   -- y redesplegar arca-worker con la versión anterior (Promise.all de 3 updates sueltos).
