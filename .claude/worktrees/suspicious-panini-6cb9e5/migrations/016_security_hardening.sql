-- ==============================================================
-- Migration 016: Security Hardening
-- 1. RLS en configuracion (faltaba completamente)
-- 2. Políticas admin-only en profiles (role + permissions)
-- 3. Audit triggers faltantes (profiles, ordenes_compra, periodos_contables, configuracion)
-- 4. Tabla rate_limit_attempts para control de intentos
-- 5. Función is_admin() reutilizable
-- Ejecutar en Supabase SQL Editor
-- ==============================================================

-- ================================================================
-- 1. FUNCIÓN HELPER: is_admin()
-- Verifica si el usuario autenticado tiene rol 'admin' en su empresa
-- ================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND active = true
  );
$$;

-- ================================================================
-- 2. RLS EN TABLA configuracion (CRÍTICO — faltaba totalmente)
-- ================================================================
ALTER TABLE public.configuracion ENABLE ROW LEVEL SECURITY;

-- Cualquier miembro del tenant puede leer la configuración
CREATE POLICY "config_select" ON public.configuracion
  FOR SELECT USING (empresa_id = public.get_my_empresa_id());

-- Solo admin puede modificar la configuración
CREATE POLICY "config_insert" ON public.configuracion
  FOR INSERT WITH CHECK (empresa_id = public.get_my_empresa_id() AND public.is_admin());

CREATE POLICY "config_update" ON public.configuracion
  FOR UPDATE USING (empresa_id = public.get_my_empresa_id() AND public.is_admin());

CREATE POLICY "config_delete" ON public.configuracion
  FOR DELETE USING (empresa_id = public.get_my_empresa_id() AND public.is_admin());

-- ================================================================
-- 3. POLÍTICAS GRANULARES EN profiles
-- ================================================================

-- Eliminar política genérica existente si existe
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;

-- Cada usuario puede ver y actualizar SU PROPIO perfil (datos básicos)
-- pero NO puede cambiar su propio rol ni permissions
CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Bloquear auto-escalada: el usuario no puede cambiar su propio role
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

-- Solo admin puede modificar role y permissions de otros usuarios
CREATE POLICY "profiles_admin_update" ON public.profiles
  FOR UPDATE
  USING (public.is_admin() AND empresa_id = public.get_my_empresa_id())
  WITH CHECK (public.is_admin() AND empresa_id = public.get_my_empresa_id());

-- Solo admin puede insertar nuevos perfiles en su empresa
CREATE POLICY "profiles_admin_insert" ON public.profiles
  FOR INSERT
  WITH CHECK (
    empresa_id = public.get_my_empresa_id()
    AND public.is_admin()
  );

-- Solo admin puede eliminar perfiles (soft-delete preferred)
CREATE POLICY "profiles_admin_delete" ON public.profiles
  FOR DELETE
  USING (public.is_admin() AND empresa_id = public.get_my_empresa_id() AND id != auth.uid());

-- ================================================================
-- 4. RATE LIMIT — tabla de intentos (login, invitación, etc.)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.rate_limit_attempts (
  id          bigserial PRIMARY KEY,
  action      text NOT NULL,               -- 'login', 'invite_user', 'create_user', etc.
  identifier  text NOT NULL,               -- email o IP
  empresa_id  uuid REFERENCES public.empresas(id),
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rla_action_id ON public.rate_limit_attempts(action, identifier, created_at DESC);

-- Función: verificar si se excedió el rate limit
-- Retorna true si el identificador superó max_attempts en window_minutes
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_action      text,
  p_identifier  text,
  p_max         int DEFAULT 5,
  p_window_min  int DEFAULT 15
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) >= p_max
  FROM public.rate_limit_attempts
  WHERE action      = p_action
    AND identifier  = p_identifier
    AND created_at  >= now() - (p_window_min || ' minutes')::interval;
$$;

-- Función: registrar intento
CREATE OR REPLACE FUNCTION public.record_attempt(
  p_action     text,
  p_identifier text,
  p_empresa_id uuid DEFAULT NULL
)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.rate_limit_attempts(action, identifier, empresa_id)
  VALUES (p_action, p_identifier, p_empresa_id);
  -- Limpiar intentos viejos (>24h) para no crecer indefinidamente
  DELETE FROM public.rate_limit_attempts
  WHERE created_at < now() - interval '24 hours';
$$;

ALTER TABLE public.rate_limit_attempts ENABLE ROW LEVEL SECURITY;

-- Solo SECURITY DEFINER functions acceden; usuarios no pueden leer/escribir directamente
CREATE POLICY "rla_deny_all" ON public.rate_limit_attempts
  FOR ALL USING (false);

-- ================================================================
-- 5. AUDIT TRIGGERS faltantes
-- ================================================================

-- Extender la lista de tablas auditadas
DO $$
DECLARE
  tablas TEXT[] := ARRAY[
    'profiles',
    'ordenes_compra',
    'periodos_contables',
    'configuracion',
    'cotizaciones',
    'cuenta_corriente_proveedores',
    'tipos_cambio'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_audit_%1$s ON public.%1$s;
      CREATE TRIGGER trg_audit_%1$s
      AFTER INSERT OR UPDATE OR DELETE ON public.%1$s
      FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
    ', t);
  END LOOP;
END;
$$;

-- ================================================================
-- 6. AUDIT LOG — proteger contra manipulación
--    Solo INSERT permitido (SECURITY DEFINER functions); nunca UPDATE/DELETE por usuarios
-- ================================================================
DROP POLICY IF EXISTS "audit_log_empresa" ON public.audit_log;

CREATE POLICY "audit_log_select" ON public.audit_log
  FOR SELECT USING (empresa_id = public.get_my_empresa_id());

-- INSERT solo desde SECURITY DEFINER (fn_audit_trigger ya es SECURITY DEFINER, saltea RLS)
-- No se crea política INSERT → usuarios normales no pueden insertar directamente

-- ================================================================
-- 7. PERIODOS CONTABLES — solo admin puede cerrar/reabrir
-- ================================================================
DROP POLICY IF EXISTS "pc_empresa" ON public.periodos_contables;

CREATE POLICY "pc_select" ON public.periodos_contables
  FOR SELECT USING (empresa_id = public.get_my_empresa_id());

CREATE POLICY "pc_admin_write" ON public.periodos_contables
  FOR ALL
  USING  (empresa_id = public.get_my_empresa_id() AND public.is_admin())
  WITH CHECK (empresa_id = public.get_my_empresa_id() AND public.is_admin());
