-- migration 364 — Determinación de Cuentas (Fase 3/4): hardening tras auditoría contable
--
-- Auditoría (agente sap-motor-contable-auditor, 27/08) sobre mig.361-363 marcó 3 gaps 🟡, ninguno
-- 🔴 explotable hoy. Al verificar cada uno contra el estado VIVO de la base (no solo contra el
-- texto de las migraciones históricas) uno resultó ser un falso positivo:
--
-- 1. FALSO POSITIVO — el agente leyó `formas_pago_all` (mig.214, escritura abierta a toda la
--    empresa) y marcó que `cuenta_contable_id` (mig.363) quedaba sin gate de admin. En vivo, la
--    tabla ya tiene policies `formas_pago_cud_insert/update/delete` que exigen
--    `has_module_permission('configuracion')` — más granular que `is_admin()` (admite permisos
--    por usuario, no solo el rol admin) — aplicadas en algún momento posterior a mig.214 y anterior
--    a esta tanda. Confirmado con un `UPDATE` real de `cuenta_contable_id` como un usuario `staff`
--    sin ese permiso: 0 filas afectadas. No se toca nada acá — aplicar el fix que proponía el
--    agente habría reemplazado esta policy más fina por una más gruesa (regresión real).
-- 2. `cuenta_contable_id`/`cuenta_bancaria_id` de `formas_pago` solo garantizan que la fila
--    referenciada exista (FK), no que sea de la MISMA empresa — sigue siendo un gap real e
--    independiente del punto 1 (a quien SÍ tiene permiso de configuración no lo frena nada de
--    apuntar el cobro al plan de cuentas de otro tenant, por error de copy/paste de un UUID o un
--    bug futuro en el frontend). Se cierra con un trigger de validación cross-tenant.
-- 3. Los 2 RPC nuevos (`obtener_cuenta_determinada`, `obtener_cuenta_forma_pago`) tenían el GRANT a
--    `authenticated` pero les faltaba el REVOKE explícito de PUBLIC — Postgres otorga EXECUTE a
--    PUBLIC por defecto en toda función nueva. Sin explotación real hoy (ambas cortan solas ante
--    `auth.uid()` nulo), pero mismo patrón que el proyecto ya aplicó 3 veces (mig.063/341/353) — se
--    había vuelto a omitir acá. Se cierra con el mismo REVOKE.
--
-- ROLLBACK (comentado):
--   DROP TRIGGER trg_formas_pago_cuentas_misma_empresa ON public.formas_pago;
--   DROP FUNCTION public.fn_check_formas_pago_cuentas_misma_empresa();
--   GRANT EXECUTE ON FUNCTION public.obtener_cuenta_determinada(uuid, text, text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.obtener_cuenta_forma_pago(uuid, uuid, text) TO PUBLIC;

-- Trigger: cuenta_contable_id / cuenta_bancaria_id deben pertenecer a la misma empresa que la
-- forma de pago. cuenta_bancaria_id ya existía desde mig.214 con el mismo hueco estructural — se
-- cierra acá de paso, mismo trigger, sin migración aparte.
CREATE OR REPLACE FUNCTION public.fn_check_formas_pago_cuentas_misma_empresa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.cuenta_contable_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.plan_cuentas
    WHERE id = NEW.cuenta_contable_id AND empresa_id = NEW.empresa_id
  ) THEN
    RAISE EXCEPTION 'La cuenta contable no pertenece a la misma empresa que la forma de pago';
  END IF;

  IF NEW.cuenta_bancaria_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cuentas_bancarias
    WHERE id = NEW.cuenta_bancaria_id AND empresa_id = NEW.empresa_id
  ) THEN
    RAISE EXCEPTION 'La cuenta bancaria no pertenece a la misma empresa que la forma de pago';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_formas_pago_cuentas_misma_empresa
  BEFORE INSERT OR UPDATE OF cuenta_contable_id, cuenta_bancaria_id ON public.formas_pago
  FOR EACH ROW EXECUTE FUNCTION public.fn_check_formas_pago_cuentas_misma_empresa();

-- Defensa en profundidad — mismo patrón que mig.353.
REVOKE EXECUTE ON FUNCTION public.obtener_cuenta_determinada(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.obtener_cuenta_forma_pago(uuid, uuid, text) FROM PUBLIC;
