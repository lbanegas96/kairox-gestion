-- ════════════════════════════════════════════════════════════════════════════
-- Migration 337 — Grant de más a `anon` en las RPCs de Recuento/Revalorización
-- de Inventario (334/335/336), encontrado investigando el bug de "Recuento no
-- encontrado" del 20/08.
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO: mientras se investigaba (con los logs reales de Supabase) por qué
-- "Confirmar Recuento" fallaba siempre desde la pantalla, se encontró un
-- problema de seguridad real y separado: las 10 funciones nuevas de las
-- migraciones 335/336 solo tienen `GRANT EXECUTE ... TO authenticated`, pero
-- nunca se les revocó el EXECUTE implícito que Postgres otorga a PUBLIC al
-- crear una función — y `anon` hereda todo lo de PUBLIC. Confirmado con
-- has_function_privilege('anon', ..., 'EXECUTE') = true en las 10.
--
-- Comparado contra el resto del proyecto (crear_nota_credito, crear_venta,
-- registrar_factura_compra_oc, ajustar_stock_manual): esas SÍ tienen
-- anon_puede = false — o sea que esto es un gap puntual de esta feature, no
-- un patrón del proyecto. Mismo criterio de fix ya usado en la mig.330
-- (REVOKE FROM PUBLIC, anon, authenticated + GRANT explícito a quien
-- corresponda).
--
-- Impacto real acotado: las 10 funciones son SECURITY DEFINER pero ya
-- verifican `get_my_empresa_id() IS NULL → RAISE EXCEPTION` internamente, así
-- que un anónimo real solo podía chocar con "No autorizado", no leer ni
-- escribir datos de ninguna empresa. Igual se corrige — "nunca confiar en el
-- cliente" aplica también a capas que ya están protegidas por otro lado.

REVOKE EXECUTE ON FUNCTION public.crear_recuento_inventario(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirmar_recuento_inventario(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.anular_recuento_inventario(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_asiento_recuento_inventario(uuid, uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.crear_revalorizacion_inventario(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirmar_revalorizacion_inventario(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.anular_revalorizacion_inventario(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_asiento_revalorizacion_inventario(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crear_recuento_inventario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_recuento_inventario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_recuento_inventario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_asiento_recuento_inventario(uuid, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.crear_revalorizacion_inventario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_revalorizacion_inventario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_revalorizacion_inventario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_asiento_revalorizacion_inventario(uuid, uuid) TO authenticated;

-- ROLLBACK (comentado):
--   GRANT EXECUTE ON FUNCTION public.crear_recuento_inventario(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.confirmar_recuento_inventario(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.anular_recuento_inventario(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.set_asiento_recuento_inventario(uuid, uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.crear_revalorizacion_inventario(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.confirmar_revalorizacion_inventario(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.anular_revalorizacion_inventario(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.set_asiento_revalorizacion_inventario(uuid, uuid) TO PUBLIC;
