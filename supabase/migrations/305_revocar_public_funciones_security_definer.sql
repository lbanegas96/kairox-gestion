-- mig.305 — El revoke de la mig.304 fue un NO-OP: había que revocar de PUBLIC, no de anon
--
-- LA MIG.304 NO HIZO NADA. Se verificó después de aplicarla: el conteo de
-- funciones ejecutables por `anon` seguía en 10, idéntico a antes.
--
-- POR QUÉ (gotcha de Postgres, para no repetirlo): el ACL de estas funciones era
--   {=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- Ese primer `=X` (sin rol a la izquierda del `=`) significa **PUBLIC tiene
-- EXECUTE**. En Postgres todos los roles heredan de PUBLIC, así que `anon` podía
-- ejecutarlas por herencia, NO por un GRANT directo. `REVOKE ... FROM anon`
-- intenta quitar un permiso directo que nunca existió → no cambia nada, y encima
-- no da error, así que pasa desapercibido salvo que se verifique el resultado.
--
-- EL REVOKE CORRECTO es `FROM PUBLIC`, y es seguro precisamente por cómo está
-- armado ese ACL: `authenticated` y `service_role` tienen entradas EXPLÍCITAS
-- (`authenticated=X/postgres`, `service_role=X/postgres`) que sobreviven intactas
-- al revoke de PUBLIC. El único que pierde el acceso es quien lo tenía sólo por
-- herencia: `anon`. Es el mismo patrón que ya había usado la mig.063
-- (`REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon;`) — la 304 copió sólo la
-- mitad de esa fórmula.
--
-- El análisis de seguridad y las verificaciones de no-rotura siguen siendo los de
-- la mig.304 (ver ese archivo): las 8 RPCs de negocio sólo se llaman desde
-- pantallas autenticadas; `insertar_movimiento_bancario_externo` la llama
-- `mp-webhook` con `service_role`; `email_exists_in_system` sólo la usa
-- `UsuariosSection.jsx` (pantalla autenticada), NO el registro público, así que
-- revocarla además cierra la enumeración de emails sin login; y
-- `fn_punto_venta_unico_default` retorna `trigger` (Postgres verifica EXECUTE al
-- CREAR el trigger, no en cada disparo — se prueba explícitamente tras aplicar).

REVOKE EXECUTE ON FUNCTION public.ajustar_precios_masivo(uuid, text, numeric, uuid, text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ajustar_stock_manual(uuid, text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancelar_precio_programado(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crear_nota_credito(uuid, uuid, uuid, text, text, jsonb, uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crear_nota_debito_cliente(uuid, uuid, uuid, text, text, jsonb, uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.email_exists_in_system(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_punto_venta_unico_default() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insertar_movimiento_bancario_externo(uuid, uuid, timestamptz, text, numeric, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.obtener_proximo_numero(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.programar_precio_futuro(uuid, uuid, numeric, date) FROM PUBLIC;
