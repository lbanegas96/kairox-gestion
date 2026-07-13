-- Migration 202 — Monitor de Facturación AFIP (equivalente al eDocument Cockpit de SAP)
-- (sesión 60 cont. 5, 2026-07-12).
--
-- Contexto: hasta ahora la única vista del circuito de CAE en la UI era una lista
-- que mostraba SOLO las facturas con error/pendientes (`facturas_pendientes_arca`
-- filtrado a estados no-terminales). Se reemplaza por un Monitor completo: TODOS
-- los comprobantes con TODOS sus estados fiscales, con filtros — el patrón del
-- "Manage Electronic Documents" de SAP S/4HANA (la lista de errores pasa a ser
-- solo un filtro sobre esa grilla).
--
-- Esta migración crea:
--   1. Vista `v_facturas_arca_monitor` — fuente de datos del monitor. Toma
--      `comprobantes` como canónico (cae_estado es el estado fiscal legal: no_aplica
--      / pendiente / error / error_definitivo / emitido) y LEFT JOIN LATERAL a la
--      última fila de la cola para el detalle de reintentos (intentos, error de cola).
--      security_invoker=on → aplica la RLS del usuario que consulta (aislamiento
--      multi-tenant por empresa_id vía las policies ya existentes de comprobantes y
--      facturas_pendientes_arca). SIN security_invoker la vista correría como owner
--      y filtraría datos de todas las empresas — obligatorio acá.
--   2. RPC `reintentar_caes_lote(uuid[])` — reintento en lote (acción masiva SAP),
--      atómico, con guard de empresa + permiso de módulo 'ventas'. GUARD CLAVE: nunca
--      re-encola un comprobante ya 'emitido' ni 'no_aplica' — solo error/
--      error_definitivo/pendiente — para no re-emitir un CAE válido (evita duplicar
--      el comprobante fiscal en AFIP). Devuelve la cantidad realmente re-encolada.
--      Reemplaza el `.update()` suelto desde el frontend (mismo patrón de "escritura
--      suelta sin RPC" corregido en CxC/CxP/ND/Cheques esta auditoría).
--   3. RPC `marcar_cae_resuelto_manual(uuid)` — override manual "Resuelta" (cuando el
--      usuario emitió el comprobante por fuera, en el portal ARCA) — atómico, con los
--      mismos guards. Reemplaza el otro `.update()` suelto.
--
-- Validado con BEGIN...ROLLBACK impersonando al admin de Nalux: la vista devuelve
-- solo los comprobantes de la empresa (143, con el desglose correcto por estado); el
-- lote re-encola un comprobante en error → 'pendiente' y DEJA intacto uno ya
-- 'emitido' (devuelve 1, no 2).

-- ── 1. Vista del monitor ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_facturas_arca_monitor
WITH (security_invoker = on) AS
SELECT
  c.id                     AS comprobante_id,
  c.empresa_id,
  c.numero_venta,
  c.fecha,
  c.total,
  c.tipo,                          -- venta | nota_credito
  c.tipo_comprobante_afip,         -- A | B | C | null
  c.cliente_nombre,
  c.cae_estado,                    -- no_aplica | pendiente | error | error_definitivo | emitido
  c.cae,
  c.cae_vencimiento,
  c.numero_afip,
  c.error_afip,
  c.relevante_fiscal,
  fpa.intentos,
  fpa.max_intentos,
  fpa.estado            AS estado_cola,      -- estado fino del worker (reintentando/procesando…)
  fpa.error_mensaje     AS error_cola,
  fpa.proximo_intento,
  fpa.updated_at        AS ultima_actividad
FROM public.comprobantes c
LEFT JOIN LATERAL (
  SELECT intentos, max_intentos, estado, error_mensaje, proximo_intento, updated_at
  FROM public.facturas_pendientes_arca f
  WHERE f.comprobante_id = c.id
  ORDER BY f.created_at DESC
  LIMIT 1
) fpa ON true;

GRANT SELECT ON public.v_facturas_arca_monitor TO authenticated;

-- ── 2. RPC: reintento en lote ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reintentar_caes_lote(p_comprobante_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid := get_my_empresa_id();
  v_id uuid; v_estado text; v_pv uuid; v_tipo text; v_fila_id uuid;
  v_count integer := 0;
BEGIN
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  FOREACH v_id IN ARRAY p_comprobante_ids LOOP
    SELECT cae_estado, punto_venta_id, COALESCE(tipo_comprobante_afip,'B')
      INTO v_estado, v_pv, v_tipo
      FROM public.comprobantes
     WHERE id = v_id AND empresa_id = v_empresa_id;

    -- Saltar: inexistente / de otra empresa / sin PdV / ya emitido / no aplica.
    -- NUNCA re-encolar un 'emitido' (re-emitiría un CAE válido → duplicado en AFIP).
    IF v_estado IS NULL OR v_pv IS NULL
       OR v_estado NOT IN ('error','error_definitivo','pendiente') THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_fila_id
      FROM public.facturas_pendientes_arca
     WHERE comprobante_id = v_id
     ORDER BY created_at DESC LIMIT 1
     FOR UPDATE;

    IF v_fila_id IS NOT NULL THEN
      UPDATE public.facturas_pendientes_arca
         SET estado='pendiente', intentos=0, proximo_intento=now(),
             error_mensaje=NULL, updated_at=now()
       WHERE id = v_fila_id;
    ELSE
      INSERT INTO public.facturas_pendientes_arca (
        empresa_id, comprobante_id, punto_venta_id, tipo_comprobante,
        codigo_afip, payload_arca, estado, proximo_intento
      ) VALUES (
        v_empresa_id, v_id, v_pv, v_tipo,
        CASE v_tipo WHEN 'A' THEN 1::smallint WHEN 'C' THEN 11::smallint ELSE 6::smallint END,
        '{}'::jsonb, 'pendiente', now()
      );
    END IF;

    UPDATE public.comprobantes SET cae_estado='pendiente', error_afip=NULL WHERE id = v_id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- ── 3. RPC: marcar como resuelta manualmente (override) ───────────────────────
CREATE OR REPLACE FUNCTION public.marcar_cae_resuelto_manual(p_comprobante_id uuid)
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

  UPDATE public.facturas_pendientes_arca SET estado='emitida', updated_at=now()
   WHERE comprobante_id = p_comprobante_id;
  UPDATE public.comprobantes SET cae_estado='emitido', error_afip=NULL
   WHERE id = p_comprobante_id;
  RETURN true;
END;
$function$;

-- ── 4. Least-privilege: quitar EXECUTE al rol anon ────────────────────────────
-- Mismo criterio que crear_venta / reencolar_caes_pendientes / reintentar_cae_comprobante:
-- solo authenticated/service_role las invocan. (Los guards internos ya las bloquearían
-- para anon, pero se revoca igual para no disparar el advisor security_definer_rpc_anon.)
REVOKE EXECUTE ON FUNCTION public.reintentar_caes_lote(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.marcar_cae_resuelto_manual(uuid) FROM anon;
