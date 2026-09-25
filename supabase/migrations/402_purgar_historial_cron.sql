-- 402 — Purga del historial de tareas programadas (cron.job_run_details)
--
-- Auditoría 24/09/2026, hallazgo OPE-2: `cron.job_run_details` (el historial de "corrió / no
-- corrió" de pg_cron) pesaba 201 MB de los 254 MB de la base (79 %) y crece ~5-6 MB por día,
-- porque pg_cron no la purga sola. El plan Free de Supabase tiene un tope de 500 MB: a
-- principios de noviembre la base habría pasado a solo lectura y el POS habría dejado de
-- registrar ventas.
--
-- 1) Vaciado inicial con TRUNCATE (no DELETE): un DELETE no devuelve el espacio al sistema
--    operativo y `pg_database_size` seguiría contando los 201 MB hasta un VACUUM FULL (que no
--    puede correr dentro de una migración). Solo se borra el historial de ejecuciones; no hay
--    ningún dato del negocio en esa tabla. Las tareas programadas en sí (cron.job) no se tocan.
-- 2) Tarea diaria (06:15 UTC = 03:15 en Argentina, sin tráfico) que conserva los últimos 3
--    días: alcanza para diagnosticar una falla y mantiene la tabla en unos 20 MB.
--
-- Idempotente: `cron.schedule` con el mismo nombre actualiza la tarea, no la duplica.

TRUNCATE TABLE cron.job_run_details;

SELECT cron.schedule(
  'purgar-historial-cron-diario',
  '15 6 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days'$$
);
