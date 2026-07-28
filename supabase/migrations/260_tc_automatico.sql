-- 260_tc_automatico.sql
-- Carga automática del tipo de cambio diario (PLAN_TC_AUTOMATICO.md, fase A).
--
-- Contexto del problema que resuelve: con `usa_tc_paralelo=true`, alguien tiene
-- que cargar el TC del día a mano antes de la primera operación de la jornada.
-- En la práctica no pasa: en Nalux se cargó TC solo 6 días desde que se activó,
-- y la cobertura de `monto_paralelo` quedó en 0% sobre 144 comprobantes,
-- 16 compras y 162 movimientos de caja.
--
-- Aditivo y backward-compatible:
--   - `tc_automatico` arranca en false → ninguna empresa existente cambia de
--     comportamiento sin que alguien prenda el toggle en Configuración.
--   - `origen` arranca en 'manual' → las 13 filas históricas de `tipos_cambio`
--     quedan correctamente marcadas como cargadas a mano, que es lo que fueron.
--   - `tipoCambioService.upsert` (usado por TipoCambioModal) no cambia: sigue
--     escribiendo sin especificar `origen`, y el DEFAULT lo marca 'manual'.

-- Opt-in por empresa. Default false a propósito (decisión de Luciano, §2 del plan).
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS tc_automatico boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.empresas.tc_automatico IS
  'Si true, el cron tc-diario-sync carga el TC del día automáticamente desde dolarapi.com (dólar oficial vendedor). Requiere usa_tc_paralelo=true y moneda_paralela=USD. Default false: nadie pasa a automático sin elegirlo.';

-- Trazabilidad: permite auditar por qué se usó tal tasa un día puntual.
ALTER TABLE public.tipos_cambio
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tipos_cambio_origen_check'
  ) THEN
    ALTER TABLE public.tipos_cambio
      ADD CONSTRAINT tipos_cambio_origen_check
      CHECK (origen IN ('manual', 'automatico'));
  END IF;
END $$;

COMMENT ON COLUMN public.tipos_cambio.origen IS
  'manual = cargado por un usuario vía TipoCambioModal | automatico = cargado por la Edge Function tc-diario-sync desde dolarapi.com.';

-- Refrescar el cache de esquema de PostgREST para que el frontend vea las columnas nuevas.
NOTIFY pgrst, 'reload schema';
