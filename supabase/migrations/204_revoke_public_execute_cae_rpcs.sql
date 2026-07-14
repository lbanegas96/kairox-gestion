-- Migration 204 — REVOKE EXECUTE FROM PUBLIC en 2 RPCs que quedaron afuera del
-- barrido de la mig.194 (hallazgo, barrido final de sesión 63, 2026-07-14).
--
-- Mismo bug exacto que documentó la mig.194: revocar `FROM anon` es un no-op
-- cuando el grant real que deja pasar a `anon` es `PUBLIC=EXECUTE` (anon lo
-- hereda de PUBLIC). Confirmado con el advisor de seguridad de Supabase
-- (anon_security_definer_function_executable) + query directa a
-- information_schema.routine_privileges: ambas funciones tienen fila PUBLIC
-- pero ninguna fila explícita para anon (la 194 no las incluyó porque
-- marcar_cae_resuelto_manual no existía todavía — se creó en mig.203 — y
-- reintentar_caes_lote quedó afuera del barrido original).
--
-- Nota de seguridad: defensa en profundidad, no había exploit activo. Los
-- guards internos de ambas funciones (get_my_empresa_id() + has_module_permission)
-- ya bloquean a anon a nivel lógico — anon no tiene empresa_id, así que
-- cualquier llamada cae en "No autorizado" antes de tocar datos.

REVOKE EXECUTE ON FUNCTION public.marcar_cae_resuelto_manual(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reintentar_caes_lote(uuid[]) FROM PUBLIC;

-- ROLLBACK (comentado): GRANT EXECUTE ON FUNCTION public.<fn>(...) TO PUBLIC;
-- (no debería hacer falta — authenticated conserva su grant explícito).
