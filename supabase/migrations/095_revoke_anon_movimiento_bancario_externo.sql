-- Migration 095: REVOKE EXECUTE en overload nuevo de insertar_movimiento_bancario_externo
-- El overload con p_subtipo (agregado en la migración Ualá) omitió el REVOKE FROM anon/public.
-- El overload original (sin p_subtipo, OID 19874) ya tenía anon=false correctamente.

REVOKE EXECUTE ON FUNCTION public.insertar_movimiento_bancario_externo(
  uuid, uuid, timestamptz, text, numeric, text, text, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.insertar_movimiento_bancario_externo(
  uuid, uuid, timestamptz, text, numeric, text, text, text
) FROM anon;

GRANT EXECUTE ON FUNCTION public.insertar_movimiento_bancario_externo(
  uuid, uuid, timestamptz, text, numeric, text, text, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.insertar_movimiento_bancario_externo(
  uuid, uuid, timestamptz, text, numeric, text, text, text
) TO service_role;
