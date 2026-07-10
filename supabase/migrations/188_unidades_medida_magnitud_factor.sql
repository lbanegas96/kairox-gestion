-- Migration 188 — Conversión general entre unidades de medida (grupo de UM SAP).
-- Sesión 59 (2026-07-10).
--
-- CONTEXTO Y DISTINCIÓN CLAVE (a fuego, para no confundir con mig.186):
--   * mig.186 (`productos.unidad_compra_id` + `factor_conversion_compra`) es un
--     factor de EMPAQUE por producto: "1 Caja de ESTE producto = 12 unidades".
--     Ese 12 es arbitrario por producto (una caja de tornillos trae 100, una de
--     heladeras trae 1) — no hay relación física fija entre "Caja" y "Unidad".
--   * Esta migración modela lo OTRO: conversión FÍSICA fija entre unidades de la
--     misma magnitud, independiente del producto — "1 TN = 1000 KG" siempre.
--     Es el "grupo de unidades de medida" de SAP B1 / dimensión ISO de S/4HANA.
--
-- MODELO: cada unidad pertenece a una `magnitud` (masa/volumen/longitud/cantidad)
-- y guarda su `factor_base` = cuántas unidades BASE de esa magnitud representa.
-- La unidad base de cada magnitud es la que tiene factor_base = 1.
--   - masa      → base GR:  MG=0.001, GR=1, KG=1000, TN=1000000
--   - volumen   → base ML:  ML=1, LT=1000
--   - longitud  → base CM:  MM=0.1, CM=1, MT=100, KM=100000
--   - cantidad  → base UN:  UN=1, PAR=2, DOC=12
--   - (NULL)    → sin magnitud: Caja, Paquete — empaques SIN conversión física fija
--
-- Convertir A→B (misma magnitud):  qty_B = qty_A * factor_base(A) / factor_base(B).
--
-- Todo aditivo: columnas nullable, sin tocar ninguna lógica de negocio existente.
-- Las unidades sin magnitud siguen funcionando igual que antes.

-- ─── Paso 1: columnas nuevas (aditivas, nullable) ────────────────────────────
ALTER TABLE public.unidades_medida
  ADD COLUMN IF NOT EXISTS magnitud    TEXT,
  ADD COLUMN IF NOT EXISTS factor_base NUMERIC(20,6);

-- magnitud válida o NULL (unidad "suelta", sin grupo de conversión)
ALTER TABLE public.unidades_medida
  DROP CONSTRAINT IF EXISTS chk_um_magnitud;
ALTER TABLE public.unidades_medida
  ADD CONSTRAINT chk_um_magnitud
  CHECK (magnitud IS NULL OR magnitud IN ('masa', 'volumen', 'longitud', 'cantidad'));

-- factor positivo si está seteado
ALTER TABLE public.unidades_medida
  DROP CONSTRAINT IF EXISTS chk_um_factor_positivo;
ALTER TABLE public.unidades_medida
  ADD CONSTRAINT chk_um_factor_positivo
  CHECK (factor_base IS NULL OR factor_base > 0);

-- magnitud y factor van juntos (o ambos NULL = unidad suelta, o ambos seteados)
ALTER TABLE public.unidades_medida
  DROP CONSTRAINT IF EXISTS chk_um_magnitud_factor_coherente;
ALTER TABLE public.unidades_medida
  ADD CONSTRAINT chk_um_magnitud_factor_coherente
  CHECK (
    (magnitud IS NULL AND factor_base IS NULL) OR
    (magnitud IS NOT NULL AND factor_base IS NOT NULL)
  );

-- ─── Paso 2: seed actualizado (empresas nuevas) ──────────────────────────────
-- CREATE OR REPLACE conservando el guard de tenant de mig.057. Ahora inserta
-- magnitud + factor_base y agrega TN / MG / MM / KM al estándar precargado.
CREATE OR REPLACE FUNCTION public.seed_maestros_default(p_empresa_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id()
     AND (SELECT empresa_id FROM public.profiles WHERE id = auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  INSERT INTO public.unidades_medida (empresa_id, codigo, descripcion, magnitud, factor_base) VALUES
    -- cantidad (base UN)
    (p_empresa_id, 'UN',  'Unidad',      'cantidad', 1),
    (p_empresa_id, 'PAR', 'Par',         'cantidad', 2),
    (p_empresa_id, 'DOC', 'Docena',      'cantidad', 12),
    -- masa (base GR)
    (p_empresa_id, 'MG',  'Miligramo',   'masa', 0.001),
    (p_empresa_id, 'GR',  'Gramo',       'masa', 1),
    (p_empresa_id, 'KG',  'Kilogramo',   'masa', 1000),
    (p_empresa_id, 'TN',  'Tonelada',    'masa', 1000000),
    -- volumen (base ML)
    (p_empresa_id, 'ML',  'Mililitro',   'volumen', 1),
    (p_empresa_id, 'LT',  'Litro',       'volumen', 1000),
    -- longitud (base CM)
    (p_empresa_id, 'MM',  'Milímetro',   'longitud', 0.1),
    (p_empresa_id, 'CM',  'Centímetro',  'longitud', 1),
    (p_empresa_id, 'MT',  'Metro',       'longitud', 100),
    (p_empresa_id, 'KM',  'Kilómetro',   'longitud', 100000),
    -- sin magnitud (empaques sin conversión física fija)
    (p_empresa_id, 'CJ',  'Caja',        NULL, NULL),
    (p_empresa_id, 'PQ',  'Paquete',     NULL, NULL)
  ON CONFLICT (empresa_id, codigo) DO NOTHING;

  INSERT INTO public.condiciones_pago (empresa_id, nombre, dias_credito, descuento_pct) VALUES
    (p_empresa_id, 'Contado', 0, 0),
    (p_empresa_id, '15 días', 15, 0),
    (p_empresa_id, '30 días', 30, 0),
    (p_empresa_id, '60 días', 60, 0),
    (p_empresa_id, '90 días', 90, 0)
  ON CONFLICT (empresa_id, nombre) DO NOTHING;
END;
$$;

-- ─── Paso 3: sembrar unidades nuevas en empresas existentes ─────────────────
-- Re-corre el seed por cada empresa. Las 11 unidades viejas caen en
-- ON CONFLICT DO NOTHING (no se tocan); solo se insertan TN/MG/MM/KM nuevas.
DO $$
DECLARE v_empresa RECORD;
BEGIN
  FOR v_empresa IN SELECT id FROM public.empresas LOOP
    PERFORM public.seed_maestros_default(v_empresa.id);
  END LOOP;
END $$;

-- ─── Paso 4: backfill de magnitud/factor en las unidades PRE-existentes ──────
-- El seed no las toca (DO NOTHING), así que se completan acá por código. Solo
-- afecta filas cuyo codigo es uno de los estándar y que todavía no tienen
-- magnitud cargada (no piso ninguna configuración manual del usuario).
UPDATE public.unidades_medida SET magnitud = 'cantidad', factor_base = 1       WHERE codigo = 'UN'  AND magnitud IS NULL;
UPDATE public.unidades_medida SET magnitud = 'cantidad', factor_base = 2       WHERE codigo = 'PAR' AND magnitud IS NULL;
UPDATE public.unidades_medida SET magnitud = 'cantidad', factor_base = 12      WHERE codigo = 'DOC' AND magnitud IS NULL;
UPDATE public.unidades_medida SET magnitud = 'masa',     factor_base = 0.001   WHERE codigo = 'MG'  AND magnitud IS NULL;
UPDATE public.unidades_medida SET magnitud = 'masa',     factor_base = 1       WHERE codigo = 'GR'  AND magnitud IS NULL;
UPDATE public.unidades_medida SET magnitud = 'masa',     factor_base = 1000    WHERE codigo = 'KG'  AND magnitud IS NULL;
UPDATE public.unidades_medida SET magnitud = 'masa',     factor_base = 1000000 WHERE codigo = 'TN'  AND magnitud IS NULL;
UPDATE public.unidades_medida SET magnitud = 'volumen',  factor_base = 1       WHERE codigo = 'ML'  AND magnitud IS NULL;
UPDATE public.unidades_medida SET magnitud = 'volumen',  factor_base = 1000    WHERE codigo = 'LT'  AND magnitud IS NULL;
UPDATE public.unidades_medida SET magnitud = 'longitud', factor_base = 0.1     WHERE codigo = 'MM'  AND magnitud IS NULL;
UPDATE public.unidades_medida SET magnitud = 'longitud', factor_base = 1       WHERE codigo = 'CM'  AND magnitud IS NULL;
UPDATE public.unidades_medida SET magnitud = 'longitud', factor_base = 100     WHERE codigo = 'MT'  AND magnitud IS NULL;
UPDATE public.unidades_medida SET magnitud = 'longitud', factor_base = 100000  WHERE codigo = 'KM'  AND magnitud IS NULL;
-- CJ / PQ quedan sin magnitud (NULL) a propósito.

-- ─── ROLLBACK (comentado) ────────────────────────────────────────────────────
-- ALTER TABLE public.unidades_medida
--   DROP CONSTRAINT IF EXISTS chk_um_magnitud,
--   DROP CONSTRAINT IF EXISTS chk_um_factor_positivo,
--   DROP CONSTRAINT IF EXISTS chk_um_magnitud_factor_coherente,
--   DROP COLUMN IF EXISTS magnitud,
--   DROP COLUMN IF EXISTS factor_base;
-- (y restaurar seed_maestros_default de mig.057 desde su bloque ROLLBACK)
-- Nota: TN/MG/MM/KM sembradas quedarían huérfanas de columnas; borrarlas con
-- DELETE FROM unidades_medida WHERE codigo IN ('TN','MG','MM','KM') si se revierte.
