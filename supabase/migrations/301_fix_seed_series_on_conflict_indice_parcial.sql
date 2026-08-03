-- mig.301 — BUG CRÍTICO: no se podía dar de alta una empresa nueva
--
-- Descubierto el 2026-08-03 probando el guard restaurado por la mig.300 (el test
-- destapó el bug; NO lo introdujo — la mig.300 copió el mismo ON CONFLICT que ya
-- estaba desde antes).
--
-- CAUSA RAÍZ: la mig.295 (numeración por punto de venta) reemplazó el índice
-- único plano `(empresa_id, tipo_documento)` de `series_numeracion` por dos
-- índices PARCIALES:
--   - idx_series_numeracion_legacy  → UNIQUE (empresa_id, tipo_documento)
--                                     WHERE punto_venta_id IS NULL
--   - idx_series_numeracion_por_pdv → UNIQUE (empresa_id, tipo_documento, punto_venta_id)
--                                     WHERE punto_venta_id IS NOT NULL
--
-- Pero `seed_series_numeracion` siguió con `ON CONFLICT (empresa_id, tipo_documento)`
-- a secas. En Postgres un ON CONFLICT NO puede resolver a un índice parcial si no
-- se repite el predicado WHERE del índice → ERROR 42P10 "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification".
--
-- POR QUÉ ERA CRÍTICO (verificado, no asumido):
--   1. El error es de PLANIFICACIÓN, no de datos. Comprobado con un
--      `INSERT ... SELECT ... WHERE false ON CONFLICT (empresa_id, tipo_documento)`
--      que no inserta ninguna fila y AUN ASÍ tira 42P10 → falla el 100% de las
--      veces, para cualquier empresa, exista o no la fila.
--   2. El trigger `trg_empresa_seed_series_numeracion` (AFTER INSERT ON empresas)
--      está activo (tgenabled='O') y llama a esta función en cada alta.
--   3. Ni `trg_fn_seed_series_numeracion` ni `create_tenant()` tienen manejador de
--      excepciones (el único EXCEPTION de create_tenant es un RAISE, no un
--      WHEN...THEN), así que la excepción propagaba y hacía rollback del alta entera.
--
--   Encadenado: alta de usuario → create_tenant() → INSERT INTO empresas → trigger
--   → 42P10 → rollback → NADIE PODÍA REGISTRAR UNA EMPRESA NUEVA.
--
-- POR QUÉ NADIE LO NOTÓ: la última empresa se creó el 2026-07-24 y la mig.295 se
-- aplicó el 2026-08-01. No hubo ningún alta nueva en esa ventana.
--
-- FIX: alinear el ON CONFLICT con el índice parcial que corresponde. Esta función
-- siempre inserta con `punto_venta_id` NULL (ni siquiera nombra la columna), así
-- que el índice aplicable es idx_series_numeracion_legacy y el predicado a repetir
-- es `WHERE punto_venta_id IS NULL`.
--
-- Se conserva íntegro todo lo demás: el guard de tenant restaurado por la mig.300
-- y los 11 tipos de documento. CREATE OR REPLACE preserva los GRANT.

CREATE OR REPLACE FUNCTION public.seed_series_numeracion(p_empresa_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard de tenant (mig.057, restaurado por mig.300).
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id()
     AND (SELECT empresa_id FROM public.profiles WHERE id = auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  INSERT INTO public.series_numeracion (empresa_id, tipo_documento, prefijo, formato_fecha, digitos) VALUES
    (p_empresa_id, 'venta',                  '',     'YYYYMMDD', 3),
    (p_empresa_id, 'factura',                'FAC-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito',           'NC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito_venta',      'ND-',  'YYYYMMDD', 3),
    (p_empresa_id, 'nota_credito_proveedor', 'NC-',  'YYYYMMDD', 3),
    (p_empresa_id, 'pedido',                 'PED-', 'YYYYMMDD', 3),
    (p_empresa_id, 'nota_debito',            'ND-',  'YYYY',     4),
    (p_empresa_id, 'entrega',                'ENT-', 'YYYY',     4),
    (p_empresa_id, 'recepcion',              'REC-', 'YYYY',     4),
    (p_empresa_id, 'orden_compra',           'OC-',  'ninguno',  5),
    (p_empresa_id, 'cotizacion',             'COT-', 'ninguno',  5)
  -- El predicado WHERE es OBLIGATORIO para que resuelva al índice parcial.
  ON CONFLICT (empresa_id, tipo_documento) WHERE punto_venta_id IS NULL DO NOTHING;
END;
$$;
