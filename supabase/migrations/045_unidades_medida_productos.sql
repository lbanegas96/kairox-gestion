-- Migration 045: conectar el maestro unidades_medida a productos
-- Aplicada via MCP Supabase. Resultado: 11/11 productos auto-mapeados, 0 sin mapear
-- (todos tenían unidad_medida = 'Unidad', que matchea la descripción del maestro).

-- Agregar FK opcional, sin tocar la columna de texto existente (productos.unidad_medida)
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS unidad_medida_id UUID REFERENCES public.unidades_medida(id) ON DELETE SET NULL;

-- Mapeo automático: si el texto en unidad_medida coincide con la descripción o código
-- de alguna unidad del maestro de la misma empresa, completar el FK automáticamente.
UPDATE public.productos p
SET unidad_medida_id = um.id
FROM public.unidades_medida um
WHERE p.empresa_id = um.empresa_id
  AND p.unidad_medida_id IS NULL
  AND (
    LOWER(TRIM(p.unidad_medida)) = LOWER(um.codigo)
    OR LOWER(TRIM(p.unidad_medida)) = LOWER(um.descripcion)
  );
