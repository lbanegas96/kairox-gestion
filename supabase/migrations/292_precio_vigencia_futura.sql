-- migration 292 — Vigencia futura de precios (fase 2b, última de las 5 features
-- priorizadas de ajuste de precios)
--
-- Permite programar un precio para que entre en vigencia en una fecha futura,
-- sin tocar el precio actual hasta entonces. Se resuelve con 2 columnas nuevas
-- en lista_precio_items + un cron diario que "promueve" el precio programado a
-- precio efectivo el día que corresponde — mismo patrón que mig.207 (CAEA:
-- job diario que promueve estado por fecha), sin necesidad de Edge Function.

ALTER TABLE public.lista_precio_items
  ADD COLUMN IF NOT EXISTS precio_programado numeric(12,2),
  ADD COLUMN IF NOT EXISTS fecha_vigencia_programada date;

COMMENT ON COLUMN public.lista_precio_items.precio_programado IS
  'Precio que reemplazará a "precio" en fecha_vigencia_programada. NULL = sin cambio programado.';

-- ── RPC: programar un precio futuro (no toca el precio actual) ────────────────
CREATE OR REPLACE FUNCTION public.programar_precio_futuro(
  p_lista_precio_id uuid,
  p_producto_id uuid,
  p_precio numeric,
  p_fecha_vigencia date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_precio_actual numeric;
BEGIN
  v_empresa_id := get_my_empresa_id();

  IF p_precio IS NULL OR p_precio <= 0 THEN
    RAISE EXCEPTION 'Precio inválido: %', p_precio;
  END IF;

  IF p_fecha_vigencia IS NULL OR p_fecha_vigencia <= CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha de vigencia debe ser futura: %', p_fecha_vigencia;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.listas_precio
    WHERE id = p_lista_precio_id AND empresa_id = v_empresa_id
  ) THEN
    RAISE EXCEPTION 'Lista de precios no encontrada o sin permiso: %', p_lista_precio_id;
  END IF;

  SELECT COALESCE(
    (SELECT precio FROM public.lista_precio_items WHERE lista_precio_id = p_lista_precio_id AND producto_id = p_producto_id),
    (SELECT precio_venta FROM public.productos WHERE id = p_producto_id AND empresa_id = v_empresa_id)
  ) INTO v_precio_actual;

  IF v_precio_actual IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', p_producto_id;
  END IF;

  INSERT INTO public.lista_precio_items (lista_precio_id, empresa_id, producto_id, precio, precio_programado, fecha_vigencia_programada)
  VALUES (p_lista_precio_id, v_empresa_id, p_producto_id, v_precio_actual, p_precio, p_fecha_vigencia)
  ON CONFLICT (lista_precio_id, producto_id)
  DO UPDATE SET precio_programado = EXCLUDED.precio_programado, fecha_vigencia_programada = EXCLUDED.fecha_vigencia_programada;

  RETURN jsonb_build_object('precio_actual', v_precio_actual, 'precio_programado', p_precio, 'fecha_vigencia', p_fecha_vigencia);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.programar_precio_futuro(uuid, uuid, numeric, date) TO authenticated;

-- ── RPC: cancelar un precio programado ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancelar_precio_programado(
  p_lista_precio_id uuid,
  p_producto_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
BEGIN
  v_empresa_id := get_my_empresa_id();

  UPDATE public.lista_precio_items
  SET precio_programado = NULL, fecha_vigencia_programada = NULL
  WHERE lista_precio_id = p_lista_precio_id
    AND producto_id = p_producto_id
    AND empresa_id = v_empresa_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancelar_precio_programado(uuid, uuid) TO authenticated;

-- ── Cron diario: promover precio_programado → precio cuando llega la fecha ────
DO $$
BEGIN
  PERFORM cron.unschedule('aplicar-precios-programados-diario');
EXCEPTION WHEN OTHERS THEN
  -- job no existía, no-op
END $$;

SELECT cron.schedule(
  'aplicar-precios-programados-diario',
  '5 6 * * *',  -- todos los días a las 06:05 UTC (03:05 ARS) — antes de que abra cualquier local
  $$
  UPDATE public.lista_precio_items
     SET precio = precio_programado,
         precio_programado = NULL,
         fecha_vigencia_programada = NULL
   WHERE fecha_vigencia_programada IS NOT NULL
     AND fecha_vigencia_programada <= CURRENT_DATE;
  $$
);

-- Verificar que quedó registrado:
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'aplicar-precios-programados-diario';

-- ROLLBACK:
-- SELECT cron.unschedule('aplicar-precios-programados-diario');
-- DROP FUNCTION public.programar_precio_futuro(uuid, uuid, numeric, date);
-- DROP FUNCTION public.cancelar_precio_programado(uuid, uuid);
-- ALTER TABLE public.lista_precio_items DROP COLUMN precio_programado, DROP COLUMN fecha_vigencia_programada;
