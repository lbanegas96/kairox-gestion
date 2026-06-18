-- Migration 006: SaaS — función para que un nuevo usuario cree su propio tenant
-- Se llama desde el frontend (OnboardingPage) después del primer login.
-- SECURITY DEFINER para poder insertar en empresas/profiles/configuracion
-- aunque el usuario aún no tiene empresa_id en RLS.

CREATE OR REPLACE FUNCTION create_tenant(
  p_nombre_empresa TEXT,
  p_first_name     TEXT DEFAULT '',
  p_last_name      TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID;
  v_user_id    UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Evitar duplicados: si ya tiene empresa, devolver la existente
  SELECT empresa_id INTO v_empresa_id
  FROM profiles
  WHERE id = v_user_id AND empresa_id IS NOT NULL;

  IF v_empresa_id IS NOT NULL THEN
    RETURN v_empresa_id;
  END IF;

  -- Crear la empresa
  INSERT INTO empresas (nombre)
  VALUES (p_nombre_empresa)
  RETURNING id INTO v_empresa_id;

  -- Crear o actualizar el perfil como admin de esa empresa
  INSERT INTO profiles (id, empresa_id, role, first_name, last_name, active)
  VALUES (v_user_id, v_empresa_id, 'admin', p_first_name, p_last_name, true)
  ON CONFLICT (id) DO UPDATE
    SET empresa_id = v_empresa_id,
        role       = 'admin',
        first_name = CASE WHEN EXCLUDED.first_name <> '' THEN EXCLUDED.first_name ELSE profiles.first_name END,
        last_name  = CASE WHEN EXCLUDED.last_name  <> '' THEN EXCLUDED.last_name  ELSE profiles.last_name  END,
        active     = true;

  -- Sembrar configuracion inicial
  INSERT INTO configuracion (empresa_id, clave, valor)
  VALUES (v_empresa_id, 'nombre_empresa', p_nombre_empresa)
  ON CONFLICT (empresa_id, clave) DO NOTHING;

  RETURN v_empresa_id;
END;
$$;

-- Solo usuarios autenticados pueden llamar esta función
REVOKE ALL ON FUNCTION create_tenant(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_tenant(TEXT, TEXT, TEXT) TO authenticated;
