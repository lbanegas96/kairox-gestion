-- ════════════════════════════════════════════════════════════════════════════
-- migration 075 — Hallazgo de PLAN_AUDITORIA_2.md sección 1
-- siguiente_numero_documento: guard de tenant + whitelist de tabla/columna
-- ════════════════════════════════════════════════════════════════════════════
--
-- Problemas (confirmados con BEGIN...ROLLBACK en sesión 53):
--   1. Sin guard de tenant: cualquier usuario podía obtener el próximo número
--      de cualquier empresa pasando su empresa_id (info disclosure trivial:
--      "Tenant Y tiene 4 entregas en 2026").
--   2. EXECUTE format('... %I ...', p_tabla, p_columna) sin whitelist:
--      aunque %I (quote_ident) mitiga SQL injection clásico, permite apuntar
--      a CUALQUIER tabla del schema public con columna `empresa_id` para
--      contar filas — info disclosure indirecto.
--
-- Severidad: baja (solo conteo, no data), pero patrón inseguro y rompe
-- consistencia con el resto del sistema.
--
-- Fix:
--   1. Guard de tenant (igual que el resto de las RPC con p_empresa_id).
--   2. Whitelist explícita de combinaciones (tabla, columna, prefijo)
--      según los 2 únicos callers reales (confirmado por grep en pg_proc):
--        - crear_venta:      ('entregas', 'numero_entrega', 'ENT')
--        - crear_devolucion: ('devoluciones', 'numero_devolucion', 'DEV')

CREATE OR REPLACE FUNCTION public.siguiente_numero_documento(
  p_empresa_id UUID,
  p_tabla      TEXT,
  p_columna    TEXT,
  p_prefijo    TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anio  TEXT    := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  v_count INTEGER;
  v_query TEXT;
BEGIN
  -- Guard de tenant
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  -- Whitelist de combinaciones (tabla, columna, prefijo) permitidas.
  -- Si se agrega un caller nuevo, agregar acá explícitamente.
  IF NOT (
       (p_tabla = 'entregas'     AND p_columna = 'numero_entrega'    AND p_prefijo = 'ENT')
    OR (p_tabla = 'devoluciones' AND p_columna = 'numero_devolucion' AND p_prefijo = 'DEV')
  ) THEN
    RAISE EXCEPTION 'Combinación (tabla, columna, prefijo) no permitida: (%, %, %)',
      p_tabla, p_columna, p_prefijo;
  END IF;

  v_query := format(
    'SELECT COUNT(*) FROM public.%I WHERE empresa_id = $1 AND %I LIKE $2',
    p_tabla, p_columna
  );
  EXECUTE v_query INTO v_count
    USING p_empresa_id, p_prefijo || '-' || v_anio || '-%';
  RETURN p_prefijo || '-' || v_anio || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
END;
$$;

-- ROLLBACK (comentado): volver a la versión sin guard ni whitelist
-- CREATE OR REPLACE FUNCTION public.siguiente_numero_documento(p_empresa_id uuid, p_tabla text, p_columna text, p_prefijo text)
-- RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
--   DECLARE v_anio TEXT := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT; v_count INTEGER; v_query TEXT;
--   BEGIN
--     v_query := format('SELECT COUNT(*) FROM public.%I WHERE empresa_id = $1 AND %I LIKE $2', p_tabla, p_columna);
--     EXECUTE v_query INTO v_count USING p_empresa_id, p_prefijo || '-' || v_anio || '-%';
--     RETURN p_prefijo || '-' || v_anio || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
--   END;
-- $$;
