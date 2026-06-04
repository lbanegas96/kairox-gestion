-- Migration 005: Fix configuracion table RLS + unique constraint for multi-tenancy
-- Problema: el upsert fallaba con 403 porque faltaba empresa_id en el payload
-- y el unique constraint era solo (clave) en vez de (empresa_id, clave)

-- 1. Asegurarse de que la columna empresa_id existe
ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;

-- 2. Eliminar el constraint único anterior (si era solo por clave)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'configuracion_clave_key'
    AND conrelid = 'configuracion'::regclass
  ) THEN
    ALTER TABLE configuracion DROP CONSTRAINT configuracion_clave_key;
  END IF;
END $$;

-- 3. Agregar constraint único correcto para multi-tenancy
ALTER TABLE configuracion
  DROP CONSTRAINT IF EXISTS configuracion_empresa_id_clave_key;

ALTER TABLE configuracion
  ADD CONSTRAINT configuracion_empresa_id_clave_key UNIQUE (empresa_id, clave);

-- 4. Asegurarse de que RLS está habilitado
ALTER TABLE configuracion ENABLE ROW LEVEL SECURITY;

-- 5. Política SELECT: ver solo la config de tu empresa
DROP POLICY IF EXISTS "Configuracion: select propia empresa" ON configuracion;
CREATE POLICY "Configuracion: select propia empresa"
  ON configuracion FOR SELECT
  USING (empresa_id = get_my_empresa_id());

-- 6. Política INSERT: insertar solo para tu empresa
DROP POLICY IF EXISTS "Configuracion: insert propia empresa" ON configuracion;
CREATE POLICY "Configuracion: insert propia empresa"
  ON configuracion FOR INSERT
  WITH CHECK (empresa_id = get_my_empresa_id());

-- 7. Política UPDATE: actualizar solo tu empresa
DROP POLICY IF EXISTS "Configuracion: update propia empresa" ON configuracion;
CREATE POLICY "Configuracion: update propia empresa"
  ON configuracion FOR UPDATE
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

-- 8. Política DELETE: solo admins de tu empresa
DROP POLICY IF EXISTS "Configuracion: delete propia empresa" ON configuracion;
CREATE POLICY "Configuracion: delete propia empresa"
  ON configuracion FOR DELETE
  USING (empresa_id = get_my_empresa_id());
