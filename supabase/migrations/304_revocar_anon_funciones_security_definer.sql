-- mig.304 — Revocar `anon` de las 10 funciones SECURITY DEFINER que lo tenían
--
-- Cierra el último ítem abierto de la auditoría de seguridad del 2026-08-03
-- (los 10 WARN `anon_security_definer_function_executable` de los advisors).
--
-- CONTEXTO: la auditoría ya había verificado que ninguna de las 10 era
-- explotable HOY — 8 se defienden con `get_my_empresa_id()` (que para `anon`
-- devuelve NULL, así que el guard dispara), 1 es una función de trigger y 1
-- (`email_exists_in_system`) no toca datos de tenant. Esto es defensa en
-- profundidad: si mañana alguien edita una de estas funciones y sin querer se
-- lleva puesto el guard, el GRANT a `anon` convierte ese descuido en un agujero
-- accesible SIN LOGIN. Sacando el GRANT, ese escenario deja de ser posible por
-- construcción, independientemente de lo que pase con el cuerpo de la función.
--
-- CORRECCIÓN sobre lo documentado antes: la auditoría había anotado
-- `email_exists_in_system` como "riesgo aceptado, la necesita el alta de
-- usuarios". **Eso era incorrecto.** Verificado con grep sobre todo `src/`: su
-- único caller es `validationUtils.checkEmailExists`, y a ese lo llama
-- únicamente `UsuariosSection.jsx:150` — la pantalla de administración de
-- usuarios, que es AUTENTICADA. `AuthPage.jsx` (el registro/login público) NO la
-- usa. O sea que el GRANT a `anon` nunca hizo falta, y encima habilitaba
-- enumeración de emails registrados sin login. Se revoca también.
--
-- VERIFICADO ANTES DE REVOCAR (para no romper nada):
--   - Las 8 RPCs de negocio se llaman siempre desde pantallas autenticadas
--     (services/, modals de ventas y compras, ProductosSection, PedidosSection).
--     Ninguna se ejecuta antes del login.
--   - `insertar_movimiento_bancario_externo` la llama `mp-webhook`, pero con
--     `SUPABASE_SERVICE_ROLE_KEY` → rol `service_role`, no `anon`. Revocar `anon`
--     no la afecta.
--   - `fn_punto_venta_unico_default` retorna `trigger`: PostgREST no expone
--     funciones que retornan `trigger`, y Postgres verifica EXECUTE sobre la
--     función de un trigger al CREAR el trigger, no cada vez que se dispara.
--     Se prueba explícitamente después de aplicar (ver commit).
--
-- `authenticated` y `service_role` NO se tocan: todo el uso real del sistema
-- sigue funcionando igual.

REVOKE EXECUTE ON FUNCTION public.ajustar_precios_masivo(uuid, text, numeric, uuid, text, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ajustar_stock_manual(uuid, text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancelar_precio_programado(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.crear_nota_credito(uuid, uuid, uuid, text, text, jsonb, uuid, uuid, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.crear_nota_debito_cliente(uuid, uuid, uuid, text, text, jsonb, uuid, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.email_exists_in_system(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_punto_venta_unico_default() FROM anon;
REVOKE EXECUTE ON FUNCTION public.insertar_movimiento_bancario_externo(uuid, uuid, timestamptz, text, numeric, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.obtener_proximo_numero(uuid, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.programar_precio_futuro(uuid, uuid, numeric, date) FROM anon;
