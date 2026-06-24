-- ════════════════════════════════════════════════════════════════════════════
-- migration 085 — Trigger BEFORE UPDATE para proteger profiles.role
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO:
--   La policy `profiles_self_update` tiene un WITH CHECK que intenta evitar
--   que el usuario cambie su propio rol. Pero ese check es ineficaz: Postgres
--   evalúa el WITH CHECK DESPUÉS de aplicar el UPDATE sobre la fila, entonces
--   cualquier comparación contra el valor "actual" del role ve ya el valor
--   nuevo y siempre se cumple. (Documentado en migration 084 — el bug existía
--   silenciosamente porque la recursión 42P17 lo enmascaraba: los UPDATEs
--   explotaban antes de llegar a evaluar la lógica.)
--
-- PROBLEMA REAL:
--   Un staff podía hacer `UPDATE profiles SET role='admin' WHERE id=...` sobre
--   sí mismo y la operación pasaba. Escalación de privilegios trivial.
--
-- FIX:
--   Trigger BEFORE UPDATE OF role que compara OLD.role vs NEW.role. A nivel
--   trigger, OLD/NEW son los valores del row pre/post update — sin ambigüedad
--   ni recursión. Permite el cambio solo si:
--     - es admin (is_admin() = true), o
--     - es service_role (webhooks, jobs internos), o
--     - no hay sesión (auth.uid() IS NULL — migraciones/seeds desde Postgres).
--   En cualquier otro caso, RAISE EXCEPTION.

CREATE OR REPLACE FUNCTION public.fn_protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Casos permitidos: sin sesión (migrations/seeds), service_role
    -- (webhooks, jobs), o admin de la misma empresa.
    IF auth.uid() IS NULL
       OR auth.role() = 'service_role'
       OR public.is_admin() THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'No autorizado: el cambio de role requiere permisos de admin';
  END IF;

  RETURN NEW;
END;
$$;

-- Consistencia con migration 063: nunca exponer SECURITY DEFINER a anon.
REVOKE EXECUTE ON FUNCTION public.fn_protect_profile_role() FROM PUBLIC, anon;
-- Los triggers no necesitan grants para `authenticated` — el motor de Postgres
-- los dispara directamente. service_role queda con acceso indirecto vía el
-- propio trigger sin necesidad de GRANT.

DROP TRIGGER IF EXISTS trg_protect_profile_role ON public.profiles;

CREATE TRIGGER trg_protect_profile_role
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_protect_profile_role();

-- ROLLBACK (comentado):
-- DROP TRIGGER IF EXISTS trg_protect_profile_role ON public.profiles;
-- DROP FUNCTION IF EXISTS public.fn_protect_profile_role();
