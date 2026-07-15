-- Migration 207 — CAEA: job diario que marca registros vencidos.
--
-- Un CAEA sigue en estado='activo' aunque ya haya pasado fecha_hasta hasta que
-- alguien llame informar-caea. Sin este job, un registro vencido seguiría
-- apareciendo como "vigente" en verificar-caea-vigente y en usar_caea_para_comprobante
-- (mig.206) — ambos ya filtran por fecha_hasta >= CURRENT_DATE, así que no hay
-- riesgo de usar un CAEA vencido para autorizar algo nuevo, pero sin este job el
-- estado en pantalla (Configuración → Facturación) quedaría engañosamente
-- "Activo" cuando en realidad ya no se puede usar y solo falta informarlo.
--
-- Corre 1 vez por día (no necesita más frecuencia — la vigencia es por
-- quincena). Pura escritura en DB, sin llamada a AFIP — no usa pg_net.

DO $$
BEGIN
  PERFORM cron.unschedule('caea-marcar-vencidos-diario');
EXCEPTION WHEN OTHERS THEN
  -- job no existía, no-op
END $$;

SELECT cron.schedule(
  'caea-marcar-vencidos-diario',
  '0 6 * * *',  -- todos los días a las 06:00 UTC (03:00 ARS)
  $$
  UPDATE public.caea_registros
     SET estado = 'vencido', updated_at = now()
   WHERE estado = 'activo'
     AND fecha_hasta < CURRENT_DATE;
  $$
);

-- Verificar que quedó registrado:
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'caea-marcar-vencidos-diario';

-- ROLLBACK:
-- SELECT cron.unschedule('caea-marcar-vencidos-diario');
