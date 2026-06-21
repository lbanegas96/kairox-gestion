-- =============================================================================
-- MIGRATION 057 — Guard de tenant en funciones de seed (contexto-adaptado)
-- =============================================================================
-- Hallazgo BAJO de la auditoría de estabilización (sesión 32):
-- seed_maestros_default(p_empresa_id) y seed_series_numeracion(p_empresa_id) son
-- SECURITY DEFINER, granteadas a `authenticated`, sin ningún guard de tenant.
--
-- CONTEXTO DE EJECUCIÓN REAL (confirmado antes de elegir el guard, no asumido):
-- ninguna de las 2 tiene caller directo en src/ (grep confirmado) — su único
-- invocador real son los triggers AFTER INSERT ON empresas
-- (trg_empresa_seed_maestros / trg_empresa_seed_series_numeracion), que se
-- disparan dentro de create_tenant(), llamada por el usuario que se está dando
-- de alta.
--
-- En ese momento auth.uid() SÍ existe (usuario autenticado real — confirmado que
-- create_tenant() exige `auth.uid() IS NOT NULL`; nunca corre como service_role),
-- pero get_my_empresa_id() devuelve NULL: handle_new_user() crea la fila de
-- profiles con empresa_id NULL en el signup, y create_tenant() hace
-- `INSERT INTO empresas` (lo que dispara el trigger) ANTES de vincular el
-- profile a esa empresa. Por eso el guard service_role-aware de la migration
-- 054 NO aplica acá (el caller nunca es service_role, esa excepción sería
-- irrelevante) y un guard estricto `p_empresa_id = get_my_empresa_id()` hubiera
-- bloqueado TODO alta de empresa nueva — confirmado con create_tenant():
-- `IF v_empresa_id IS NOT NULL THEN RETURN v_empresa_id; END IF;` antes del
-- INSERT INTO empresas, es decir ese INSERT (y por ende el trigger) SOLO se
-- ejecuta para usuarios cuyo profiles.empresa_id es NULL en ese momento.
--
-- Guard elegido (más simple que el de la 054, adaptado al contexto real):
-- permitir la llamada si el empresa_id coincide, O SI el usuario autenticado
-- todavía no tiene ninguna empresa asignada (profiles.empresa_id IS NULL — el
-- caso real de "me acabo de dar de alta"). Esto cierra el hueco real (un
-- usuario que YA pertenece a la Empresa A no puede re-seedear los catálogos de
-- la Empresa B) sin romper el onboarding de tenants nuevos.
--
-- Riesgo residual aceptado (la severidad ya era BAJA en la auditoría): un
-- usuario sin empresa asignada aún podría llamar a estas funciones con el UUID
-- de una empresa ajena ya seedeada — pero ambas usan `ON CONFLICT DO NOTHING`,
-- así que el resultado es un no-op (no lee, no sobrescribe, no borra nada). No
-- se endurece más para no romper un eventual re-seed administrativo de una
-- empresa vieja sin catálogos.
-- =============================================================================

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

  INSERT INTO public.unidades_medida (empresa_id, codigo, descripcion) VALUES
    (p_empresa_id, 'UN',  'Unidad'),
    (p_empresa_id, 'KG',  'Kilogramo'),
    (p_empresa_id, 'GR',  'Gramo'),
    (p_empresa_id, 'LT',  'Litro'),
    (p_empresa_id, 'ML',  'Mililitro'),
    (p_empresa_id, 'MT',  'Metro'),
    (p_empresa_id, 'CM',  'Centímetro'),
    (p_empresa_id, 'CJ',  'Caja'),
    (p_empresa_id, 'PQ',  'Paquete'),
    (p_empresa_id, 'DOC', 'Docena'),
    (p_empresa_id, 'PAR', 'Par')
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

CREATE OR REPLACE FUNCTION public.seed_series_numeracion(p_empresa_id UUID)
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

  INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos) VALUES
    (p_empresa_id, 'venta',        '',     'YYYYMMDD', 3),
    (p_empresa_id, 'factura',      'FAC-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito', 'NC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'pedido',       'PED-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito',  'ND-',  'YYYY',     4),
    (p_empresa_id, 'entrega',      'ENT-', 'YYYY',     4),
    (p_empresa_id, 'recepcion',    'REC-', 'YYYY',     4),
    (p_empresa_id, 'orden_compra', 'OC-',  'ninguno',  5),
    (p_empresa_id, 'cotizacion',   'COT-', 'ninguno',  5)
  ON CONFLICT (empresa_id, tipo_documento) DO NOTHING;
END;
$$;

-- ─── ROLLBACK (si hace falta revertir — versión sin guard) ────────────────────
-- CREATE OR REPLACE FUNCTION public.seed_maestros_default(p_empresa_id UUID)
-- RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   INSERT INTO public.unidades_medida (empresa_id, codigo, descripcion) VALUES
--     (p_empresa_id, 'UN',  'Unidad'), (p_empresa_id, 'KG',  'Kilogramo'),
--     (p_empresa_id, 'GR',  'Gramo'), (p_empresa_id, 'LT',  'Litro'),
--     (p_empresa_id, 'ML',  'Mililitro'), (p_empresa_id, 'MT',  'Metro'),
--     (p_empresa_id, 'CM',  'Centímetro'), (p_empresa_id, 'CJ',  'Caja'),
--     (p_empresa_id, 'PQ',  'Paquete'), (p_empresa_id, 'DOC', 'Docena'),
--     (p_empresa_id, 'PAR', 'Par')
--   ON CONFLICT (empresa_id, codigo) DO NOTHING;
--   INSERT INTO public.condiciones_pago (empresa_id, nombre, dias_credito, descuento_pct) VALUES
--     (p_empresa_id, 'Contado', 0, 0), (p_empresa_id, '15 días', 15, 0),
--     (p_empresa_id, '30 días', 30, 0), (p_empresa_id, '60 días', 60, 0),
--     (p_empresa_id, '90 días', 90, 0)
--   ON CONFLICT (empresa_id, nombre) DO NOTHING;
-- END; $$;
--
-- CREATE OR REPLACE FUNCTION public.seed_series_numeracion(p_empresa_id UUID)
-- RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos) VALUES
--     (p_empresa_id, 'venta',        '',     'YYYYMMDD', 3),
--     (p_empresa_id, 'factura',      'FAC-', 'YYYYMMDD', 3),
--     (p_empresa_id, 'nota_credito', 'NC-',  'YYYYMMDD', 3),
--     (p_empresa_id, 'pedido',       'PED-', 'YYYYMMDD', 3),
--     (p_empresa_id, 'nota_debito',  'ND-',  'YYYY',     4),
--     (p_empresa_id, 'entrega',      'ENT-', 'YYYY',     4),
--     (p_empresa_id, 'recepcion',    'REC-', 'YYYY',     4),
--     (p_empresa_id, 'orden_compra', 'OC-',  'ninguno',  5),
--     (p_empresa_id, 'cotizacion',   'COT-', 'ninguno',  5)
--   ON CONFLICT (empresa_id, tipo_documento) DO NOTHING;
-- END; $$;
