-- 415 — Secreto compartido entre el cron y los workers (auditoría 24/09, SEG-3)
--
-- Los workers (arca-worker, mp-qr-poller, mp-sync-worker, mercadolibre-stock-worker, mercadolibre-catalogo-publicar,
-- tiendanube-stock-worker, tiendanube-catalogo-publicar y tc-diario-sync) se llaman desde el cron por HTTP y están
-- desplegados con `verify_jwt = false` (el cron no tiene sesión de usuario; `tc-diario-sync` sí exige un JWT, pero el
-- cron le manda la clave anónima, que es pública). Sin ninguna verificación propia, cualquiera que conozca la URL puede
-- llamarlos en bucle y forzar llamadas a ARCA, Mercado Pago, Tiendanube o MercadoLibre (bloqueos por exceso de
-- pedidos, consumo del cupo de invocaciones). No permiten inyectar datos (solo procesan colas), por eso es MEDIO.
--
-- Esta migración prepara el lado de la base; el lado de las funciones está en `supabase/functions/_shared/cronAuth.ts`
-- y en el arranque de cada worker.
--   1) Crea el secreto `cron_secret` en Vault (si no existe): 64 caracteres al azar, que nadie tiene que copiar ni
--      conocer. Solo lo leen los jobs de cron (al armar cada llamada) y la función de verificación.
--   2) `verificar_cron_secret(p_secret)`: dice si el secreto recibido es el guardado. Solo la ejecuta service_role,
--      que es con lo que corren las Edge Functions.
--   3) Los 8 jobs de cron pasan a mandar el header `x-cron-secret` (leído de Vault en cada corrida, así rotar el secreto
--      no requiere tocar los jobs). Se agrega al header que ya tenían (la clave anónima como Bearer queda igual), sin
--      reescribir el resto del comando.
--
-- ORDEN DE PUESTA EN PRODUCCIÓN (importa): primero esta migración (los jobs empiezan a mandar el header y los workers
-- viejos lo ignoran), después desplegar los 8 workers con la verificación. Al revés, los workers rechazarían al cron.
-- Para volver atrás basta redesplegar la versión anterior de los workers: el header de más no molesta.
--
-- Idempotente: no vuelve a crear el secreto ni a modificar un job que ya manda el header.

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'cron_secret',
      'Secreto compartido entre los jobs de cron y los workers (header x-cron-secret). Lo genera y lo lee el propio sistema.'
    );
  END IF;
END
$mig$;

CREATE OR REPLACE FUNCTION public.verificar_cron_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(p_secret, '') <> ''
     AND EXISTS (
       SELECT 1 FROM vault.decrypted_secrets
       WHERE name = 'cron_secret' AND decrypted_secret = p_secret
     )
$function$;

REVOKE ALL ON FUNCTION public.verificar_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verificar_cron_secret(text) TO service_role;

DO $mig$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid, command
    FROM cron.job
    WHERE command LIKE '%net.http_post%'
      AND command NOT LIKE '%x-cron-secret%'
      AND command ~ '/functions/v1/(arca-worker|tiendanube-stock-worker|tiendanube-catalogo-publicar|mercadolibre-stock-worker|mercadolibre-catalogo-publicar|tc-diario-sync|mp-sync-worker|mp-qr-poller)'
  LOOP
    PERFORM cron.alter_job(
      r.jobid,
      command := regexp_replace(
        r.command,
        $re$headers\s*:=\s*'(\{[^']*\})'::jsonb$re$,
        $rep$headers := ('\1'::jsonb || jsonb_build_object('x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')))$rep$
      )
    );
  END LOOP;
END
$mig$;
