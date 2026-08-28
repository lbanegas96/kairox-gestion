-- migration 365 — GRANT faltante en insertar_movimiento_bancario_externo (sync MP roto desde
-- la migración de cuenta de Supabase, 16/08)
--
-- HALLAZGO (27/08, reportado por Luciano: "mis compras de $6.000 y $7.500 en MercadoPago no
-- impactaron"): mismo patrón exacto ya documentado y corregido en mig.330 para
-- fn_persistir_cae_emitido/reintentar_caes_lote — mig.245 (creada bien antes de la migración de
-- cuenta) hace un DROP FUNCTION + CREATE FUNCTION de insertar_movimiento_bancario_externo (para
-- agregar el parámetro p_external_ref) pero nunca vuelve a otorgar EXECUTE a nadie. En el
-- proyecto viejo esto funcionaba porque el GRANT a service_role se había hecho a mano en
-- producción en algún momento, sin migración — ese GRANT ad-hoc no viaja en un dump/restore de
-- esquema. Confirmado: proacl actual es únicamente `{postgres=X/postgres}`, cero acceso para
-- service_role ni authenticated.
--
-- IMPACTO REAL: mp-sync-worker (cron cada 2 min) y mp-sync (botón "Actualizar MP") siguen
-- corriendo sin error visible — la API de MercadoPago responde bien, `ultimo_sync` avanza en cada
-- corrida — pero el INSERT final a movimientos_bancarios falla con "permission denied" en TODOS
-- los pagos, ingresos y egresos por igual, silenciosamente atrapado y logueado por el catch de
-- mpSync.ts. Confirmado en vivo: 30 pagos aprobados reales entre el 16/08 y hoy (incluidas las dos
-- compras que reportó Luciano, $6.000 y $7.500) existen en la API de MercadoPago pero ninguno
-- llegó a movimientos_bancarios.
--
-- FIX: mismo GRANT que mig.330, solo a service_role — únicos callers reales son mp-webhook y
-- mp-sync/mp-sync-worker (los tres corren con la service role key, no hay ningún caller desde el
-- frontend). El backfill de los 30 pagos perdidos se dispara aparte, re-ejecutando el sync real
-- contra la ventana del hueco (no se insertan a mano — se deja que el propio pipeline los traiga,
-- para que pasen por exactamente la misma lógica de dirección/subtipo/descripción que un pago
-- nuevo).
--
-- ROLLBACK (comentado): REVOKE EXECUTE ON FUNCTION public.insertar_movimiento_bancario_externo(uuid, uuid, timestamp with time zone, text, numeric, text, text, text, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.insertar_movimiento_bancario_externo(
  uuid, uuid, timestamp with time zone, text, numeric, text, text, text, text
) TO service_role;
