-- migration 361 — Determinación de Cuentas: esquema base del motor genérico (Fase 3)
--
-- CONTEXTO (PLAN_MAPA_Y_DETERMINACION_CUENTAS_2026-08-27.md): todo el motor de asientos
-- (planCuentasService.ts + varios RPC en SQL) hardcodea qué cuenta contable usa cada tipo de
-- movimiento (findCuentaByCodigo(empresaId, '1.1.1'), etc.) — ~25+ "cables" fijos. KAIROX ya
-- tiene el patrón correcto para esto (determinacion_cuentas_mayor, mig.126) pero angosto: solo
-- sirve para clasificar movimientos bancarios importados al conciliar. Esta migration generaliza
-- ese mismo patrón (estilo SAP OBYC/account determination) a un motor genérico por "código de
-- cable" estable, reutilizable por cualquier módulo — no reemplaza la 126, que sigue resolviendo
-- su caso puntual (reglas de matching sobre extractos bancarios).
--
-- Alcance de ESTA migration: solo el esquema (tabla + RPC de resolución). Ningún módulo la
-- consume todavía — cero riesgo de romper un asiento real. La Fase 4 (mismo plan) cablea el caso
-- concreto que motivó esto (medios de pago) con un mecanismo más directo y específico
-- (formas_pago.cuenta_contable_id, ver mig.363) — este motor genérico queda listo para los ~20
-- cables restantes (compras, ajustes de inventario, NC/ND, etc.) que se irán sumando cable por
-- cable, cuando se priorice cada uno — no se siembra ningún cable acá a propósito, porque
-- inventar codigo_cable para módulos que todavía no lo consumen sería sembrar filas sin dueño.
--
-- RLS: mismo criterio que determinacion_cuentas_mayor (mig.126) — lectura para la empresa,
-- escritura solo admin.
--
-- ROLLBACK: DROP FUNCTION public.obtener_cuenta_determinada(uuid, text, text);
--           DROP TABLE public.determinacion_asientos;

CREATE TABLE public.determinacion_asientos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  codigo_cable        text NOT NULL,   -- identificador estable, ej. 'venta.cobro_efectivo'
  cuenta_contable_id  uuid NOT NULL REFERENCES public.plan_cuentas(id),
  descripcion         text,
  modulo              text,            -- agrupador para la UI (ej. 'ventas', 'compras')
  activo              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(empresa_id, codigo_cable)
);

CREATE INDEX idx_determinacion_asientos_empresa_activo
  ON public.determinacion_asientos (empresa_id, activo);

ALTER TABLE public.determinacion_asientos ENABLE ROW LEVEL SECURITY;

CREATE POLICY determinacion_asientos_select ON public.determinacion_asientos
  FOR SELECT USING (empresa_id = get_my_empresa_id());

CREATE POLICY determinacion_asientos_insert ON public.determinacion_asientos
  FOR INSERT WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());

CREATE POLICY determinacion_asientos_update ON public.determinacion_asientos
  FOR UPDATE USING (empresa_id = get_my_empresa_id() AND is_admin())
  WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());

CREATE POLICY determinacion_asientos_delete ON public.determinacion_asientos
  FOR DELETE USING (empresa_id = get_my_empresa_id() AND is_admin());

-- RPC de resolución: si hay un cable configurado y activo, devuelve su cuenta; si no, cae al
-- código hardcodeado de hoy (p_codigo_fallback) — retrocompatible por diseño, ningún caller
-- existente cambia de comportamiento hasta que alguien configure el cable explícitamente.
CREATE OR REPLACE FUNCTION public.obtener_cuenta_determinada(
  p_empresa_id uuid, p_codigo_cable text, p_codigo_fallback text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cuenta_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  SELECT cuenta_contable_id INTO v_cuenta_id
  FROM public.determinacion_asientos
  WHERE empresa_id = p_empresa_id AND codigo_cable = p_codigo_cable AND activo = true;

  IF v_cuenta_id IS NULL AND p_codigo_fallback IS NOT NULL THEN
    SELECT id INTO v_cuenta_id
    FROM public.plan_cuentas
    WHERE empresa_id = p_empresa_id AND codigo = p_codigo_fallback AND activa;
  END IF;

  RETURN v_cuenta_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.obtener_cuenta_determinada(uuid, text, text) TO authenticated;
