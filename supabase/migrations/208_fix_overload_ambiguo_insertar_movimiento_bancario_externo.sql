-- migration 208 — Eliminar el overload ambiguo de insertar_movimiento_bancario_externo
--
-- HALLAZGO (sesión de CI de pgTAP, al hacer correr sync_uala_to_bancos.test.sql de
-- verdad con pg_prove por primera vez): existen 2 versiones de esta función en
-- producción — una de 7 parámetros (mig.054/154) y otra de 8 con p_subtipo DEFAULT
-- NULL (mig.079/154). El trigger sync_uala_to_bancos() la llama con exactamente 7
-- argumentos NOMBRADOS (sin p_subtipo) — una llamada que Postgres no puede resolver
-- de forma única entre "la versión de 7 params" y "la de 8 params con el 8vo en su
-- default", y rompe con:
--   ERROR: function insertar_movimiento_bancario_externo(...) is not unique
--
-- Esto es un bug REAL en producción, no solo del replay de CI: cualquier tenant que
-- configure la integración Ualá (proveedor='uala' en integraciones_bancarias) haría
-- fallar cada transferencia real sincronizada por este trigger. Verificado que hoy
-- NINGÚN tenant tiene esa integración activa (0 filas), así que no hubo pérdida de
-- datos — pero el bug es real y está latente desde que la migration 079 introdujo
-- el parámetro p_subtipo sin retirar la versión de 7 params original.
--
-- La intención original de la 079 (ver su propio comentario) SIEMPRE fue tener una
-- única función canónica con p_subtipo opcional — nunca se quiso mantener 2
-- overloads. Se elimina la de 7 parámetros; la de 8 (con DEFAULT NULL) cubre todos
-- los callers existentes sin cambios: sync_uala_to_bancos() sigue llamando sin
-- p_subtipo (cae en el DEFAULT NULL) y mp-webhook/mp-sync siguen pasándolo explícito.

DROP FUNCTION IF EXISTS public.insertar_movimiento_bancario_externo(
  uuid, uuid, timestamp with time zone, text, numeric, text, text
);

-- ROLLBACK (comentado): recrear la versión de 7 params desde la migration 154
-- (líneas 18-64) si por algún motivo hubiera un caller que dependa de ella —
-- no se encontró ninguno al auditar el repo.
