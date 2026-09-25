-- pgTAP test: secreto compartido entre el cron y los workers (mig. 415)
--
-- Auditoría 24/09/2026, hallazgo SEG-3. Confirma que la función que usan los workers para verificar el header
-- `x-cron-secret` acepta el secreto guardado en Vault y rechaza todo lo demás, que solo la puede ejecutar
-- service_role, y que ningún job de cron que llame a uno de los 8 workers quedó sin mandar el header.
--
-- SEGURIDAD: no crea datos ni empresas; corre dentro de una transacción que termina en ROLLBACK.
-- El valor del secreto se lee dentro del test y no se imprime.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(10);

SELECT is(
  (SELECT count(*)::int FROM vault.secrets WHERE name = 'cron_secret'),
  1,
  'Caso 1: existe el secreto cron_secret en Vault (uno solo)'
);

SELECT is(
  (SELECT length(decrypted_secret) FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
  64,
  'Caso 2: tiene 64 caracteres (2 UUID sin guiones), no un valor corto ni adivinable'
);

SELECT is(
  public.verificar_cron_secret((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')),
  true,
  'Caso 3: el secreto guardado se acepta'
);

SELECT is(
  public.verificar_cron_secret('un-secreto-equivocado'),
  false,
  'Caso 4: un secreto equivocado se rechaza'
);

SELECT is(
  public.verificar_cron_secret(NULL) OR public.verificar_cron_secret(''),
  false,
  'Caso 5: sin secreto (nulo o vacio) se rechaza'
);

SELECT is(
  public.verificar_cron_secret(upper((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'))),
  false,
  'Caso 6: no se acepta con otra capitalizacion (comparacion exacta)'
);

SELECT is(
  has_function_privilege('service_role', 'public.verificar_cron_secret(text)', 'EXECUTE'),
  true,
  'Caso 7: service_role (lo que usan las Edge Functions) la puede ejecutar'
);

SELECT is(
  has_function_privilege('authenticated', 'public.verificar_cron_secret(text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.verificar_cron_secret(text)', 'EXECUTE'),
  false,
  'Caso 8: ni un usuario con sesion ni uno anonimo la pueden ejecutar (no sirve para probar secretos a fuerza bruta)'
);

SELECT is(
  has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT')
    OR has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT'),
  false,
  'Caso 9: los usuarios no pueden leer los secretos de Vault directamente'
);

SELECT is(
  (SELECT count(*)::int FROM cron.job
   WHERE command LIKE '%net.http_post%'
     AND command ~ '/functions/v1/(arca-worker|tiendanube-stock-worker|tiendanube-catalogo-publicar|mercadolibre-stock-worker|mercadolibre-catalogo-publicar|tc-diario-sync|mp-sync-worker|mp-qr-poller)'
     AND command NOT LIKE '%x-cron-secret%'),
  0,
  'Caso 10: ningun job de cron que llame a uno de los 8 workers quedo sin mandar el header x-cron-secret'
);

SELECT * FROM finish();

ROLLBACK;
