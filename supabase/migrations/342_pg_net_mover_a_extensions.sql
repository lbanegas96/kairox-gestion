-- mig.342 — Mover la extensión pg_net del schema public al schema extensions.
--
-- HALLAZGO (auditoría de advisors de Supabase, WARN extension_in_public):
-- pg_net es la única extensión del proyecto registrada en `public` — todas las
-- demás (pgcrypto, uuid-ossp, pgtap, pg_stat_statements) ya viven en el schema
-- dedicado `extensions`, que es el patrón establecido de este proyecto.
--
-- POR QUÉ ES SEGURO: las funciones reales de pg_net (http_get, http_post, etc.)
-- YA viven en su propio schema `net`, no en `public` — confirmado con
-- pg_depend. Lo único que estaba mal ubicado era el registro de la extensión
-- en sí (pg_extension.extnamespace). Los 8 cron jobs del proyecto (arca-worker,
-- mp-qr-poller, mp-sync, mercadolibre-*, tiendanube-*, tc-diario-sync) llaman
-- todos `net.http_post(...)` — ninguno usa `public.*` — así que no cambia
-- ninguna llamada existente.
--
-- pg_net NO admite `ALTER EXTENSION ... SET SCHEMA` (control file marca
-- relocatable=false, confirmado en vivo: "extension pg_net does not support
-- SET SCHEMA"). Por eso hace falta DROP + CREATE. Se hace dentro de la misma
-- transacción de la migración para que ningún cron job pueda ver un estado
-- intermedio sin `net.http_post`: si algún cron intenta llamarlo justo en ese
-- instante, Postgres lo hace esperar (lock) hasta el COMMIT, no falla.
--
-- Confirmado que nada del proyecto depende estructuralmente de pg_net aparte
-- de sus propios objetos (pg_depend sobre vistas/funciones de otros schemas
-- que referencien algo de `net.*`: 0 filas). Probado con BEGIN...ROLLBACK
-- antes de aplicar: DROP + CREATE corre limpio, net.http_get sigue respondiendo
-- (devolvió request_id) apenas termina el CREATE.

DROP EXTENSION pg_net;
CREATE EXTENSION pg_net SCHEMA extensions;
