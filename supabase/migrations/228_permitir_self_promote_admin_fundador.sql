-- migration 228 — permitir que create_tenant() promueva a admin al usuario
-- fundador de una empresa nueva (bug encontrado al arreglar el onboarding)
--
-- CONTEXTO: el signup público nunca llamó a create_tenant() (ver fix en
-- SupabaseAuthContext.jsx, handleSession) — quedó como código muerto desde
-- que se escribió (migration 006). Al arreglar el llamado y probarlo de
-- punta a punta recién ahora, create_tenant() falla con:
--   "No autorizado: el cambio de role requiere permisos de admin"
-- Causa: el trigger fn_protect_profile_role (migration 085, cierre real de
-- una escalación de privilegios — un staff podía hacerse admin de su propia
-- empresa con un UPDATE directo) solo permite el cambio de role si quien
-- llama ya es admin, es service_role, o no hay sesión. El usuario fundador
-- de una empresa nueva no cumple ninguna: tiene sesión, no es admin todavía
-- (es 'staff', el default de handle_new_user), y no es service_role.
--
-- FIX: agregar una 4ta condición, acotada al caso real de bootstrap —
-- permitir el auto-ascenso a 'admin' SOLO si la fila no tenía empresa antes
-- (OLD.empresa_id IS NULL) Y la tiene después (NEW.empresa_id IS NOT NULL).
-- No reabre el hueco de la migration 085 porque:
--   1. El WITH CHECK de la policy profiles_update (mig. 158) ya exige que un
--      self-update vía REST directo mantenga role = get_my_role() — esta
--      condición nueva del trigger nunca se llega a evaluar por esa vía,
--      el auto-ascenso vía REST sigue bloqueado en la capa de RLS.
--   2. create_tenant() es SECURITY DEFINER (bypassea RLS) pero tiene su
--      propio guard: si el caller YA tiene empresa_id, retorna temprano sin
--      tocar la fila — solo llega al UPDATE cuando empresa_id era NULL.
--   3. Un staff de una empresa YA existente (empresa_id NOT NULL) nunca
--      cumple "OLD.empresa_id IS NULL", así que sigue sin poder auto-ascender
--      dentro de su empresa actual — el caso que 085 vino a cerrar sigue
--      cerrado.
--
-- Verificado con BEGIN...ROLLBACK contra prod real: create_tenant() para un
-- usuario sin empresa corre limpio con este cambio; repetir el mismo intento
-- para un usuario que YA tiene empresa (simulado) sigue bloqueado.

CREATE OR REPLACE FUNCTION public.fn_protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Casos permitidos: sin sesión (migrations/seeds), service_role
    -- (webhooks, jobs), admin de la misma empresa, o el usuario fundador
    -- de una empresa recién creada (bootstrap vía create_tenant()).
    IF auth.uid() IS NULL
       OR auth.role() = 'service_role'
       OR public.is_admin()
       OR (OLD.empresa_id IS NULL AND NEW.empresa_id IS NOT NULL AND NEW.role = 'admin') THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'No autorizado: el cambio de role requiere permisos de admin';
  END IF;

  RETURN NEW;
END;
$$;

-- ROLLBACK (comentado): CREATE OR REPLACE FUNCTION fn_protect_profile_role() con
-- el body previo (sin la 4ta condición OLD.empresa_id IS NULL AND ...).
