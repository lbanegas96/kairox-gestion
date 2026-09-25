-- 403 — Blindaje de `profiles` y del alta de usuarios
--
-- Auditoría 24/09/2026, hallazgo SEG-1. Dos huecos que combinados permitían a CUALQUIER persona
-- que se registre quedar como administradora de OTRA empresa (solo hace falta conocer el UUID de
-- la empresa víctima, que aparece en las URLs públicas de imágenes de productos y logos):
--
--   a) `handle_new_user` tomaba el rol de `raw_user_meta_data->>'role'`, un dato que manda el
--      cliente en el signUp. Un registro con {"role":"admin"} nacía como admin (sin empresa).
--   b) La política `profiles_update` deja a cada usuario editar su propia fila y solo exige que
--      `role` no cambie; el único trigger (`trg_protect_profile_role`) mira solo `role`.
--      `empresa_id`, `tenant_id`, `permissions`, `active` y `modo_caja` quedaban libres: un
--      usuario podía apuntar su ficha a otra empresa, darse permisos de cualquier módulo o
--      reactivarse si el admin lo había desactivado.
--
-- Arreglo:
--   1) `handle_new_user`: el rol de un usuario nuevo es SIEMPRE 'staff'. Solo `create_tenant`
--      (que corre en el servidor) convierte al fundador de una empresa en 'admin'.
--   2) Trigger `trg_proteger_profiles`: cuando el cambio lo hace un usuario final (PostgREST
--      corre con el rol `authenticated`/`anon`):
--        - nadie cambia `id`, `empresa_id` ni `tenant_id` desde el navegador (ni un admin);
--        - un usuario común solo puede tocar su nombre, apellido y `last_login_at`;
--        - `role`, `permissions`, `active`, `modo_caja`, `email` y `created_at` solo los cambia
--          el admin de la misma empresa.
--      Las funciones internas (`create_tenant`, `handle_new_user`), `service_role` (edge
--      functions invite-user/delete-user), las migraciones y los seeds corren con otro rol y
--      no se ven afectados. Se detecta por `current_user` (NO por auth.uid()): dentro de una
--      función SECURITY DEFINER el rol efectivo es el del dueño de la función.

-- ── 1) El rol nunca sale de la metadata del signUp ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    'staff'
  );
  RETURN NEW;
END;
$$;

-- ── 2) Lo que un usuario final puede cambiar en `profiles` ─────────────────────────────────────
-- Función SECURITY INVOKER a propósito: necesita ver el rol con el que llegó el pedido.
CREATE OR REPLACE FUNCTION public.fn_proteger_profiles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_admin_misma_empresa boolean;
BEGIN
  -- Solo se restringe el pedido directo de un usuario final.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Un admin puede dar de alta un perfil de SU empresa (lo permite la política de INSERT).
    IF NEW.empresa_id IS NOT NULL
       AND public.is_admin()
       AND NEW.empresa_id = public.get_my_empresa_id() THEN
      RETURN NEW;
    END IF;
    -- Cualquier otro: solo un perfil en blanco (sin empresa, sin permisos, como staff).
    IF NEW.empresa_id IS NOT NULL
       OR NEW.tenant_id IS NOT NULL
       OR NEW.role <> 'staff'
       OR COALESCE(NEW.permissions, '{}'::jsonb) <> '{}'::jsonb
       OR NEW.modo_caja THEN
      RAISE EXCEPTION 'No autorizado: un usuario no puede crear un perfil con empresa, rol o permisos';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE ----------------------------------------------------------------------------------
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'No autorizado: no se puede cambiar la empresa de un usuario desde el navegador';
  END IF;

  v_admin_misma_empresa := OLD.empresa_id IS NOT NULL
                           AND public.is_admin()
                           AND OLD.empresa_id = public.get_my_empresa_id();

  IF NOT v_admin_misma_empresa AND (
        NEW.role        IS DISTINCT FROM OLD.role
     OR NEW.permissions IS DISTINCT FROM OLD.permissions
     OR NEW.active      IS DISTINCT FROM OLD.active
     OR NEW.modo_caja   IS DISTINCT FROM OLD.modo_caja
     OR NEW.email       IS DISTINCT FROM OLD.email
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'No autorizado: solo un administrador de la empresa puede cambiar permisos, estado o rol';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_proteger_profiles() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_proteger_profiles ON public.profiles;
CREATE TRIGGER trg_proteger_profiles
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_proteger_profiles();
