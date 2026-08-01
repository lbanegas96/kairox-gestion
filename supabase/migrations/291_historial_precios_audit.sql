-- migration 291 — Historial de cambios de precio (fase 2 de ajuste de precios)
--
-- CORRECCIÓN sobre el intento original de esta migración: se pensó que
-- `lista_precio_items` no tenía auditoría (a diferencia de `productos`,
-- cubierta desde mig.001), y se agregó un trigger `trg_audit_lista_precio_items`
-- reusando `fn_audit_trigger()`. Al probar en vivo aparecieron eventos
-- DUPLICADOS en `audit_log` — resultó que mig.021 (creación original de
-- Listas de Precio) YA había creado un trigger equivalente con otro nombre
-- (`audit_lista_precio_items`, sin el prefijo `trg_` usado en mig.001/143),
-- que el grep inicial no encontró por buscar solo el patrón `trg_audit_*`.
--
-- Este archivo documenta la corrección: el trigger duplicado
-- (`trg_audit_lista_precio_items`) fue dropeado en producción. No se
-- necesita ningún cambio de esquema — `lista_precio_items` ya estaba
-- auditada desde el día uno. El historial de precios (`listaPreciosService
-- .getHistorialPrecio`) lee directamente de `audit_log`, que ya tenía los
-- datos correctos.

-- No-op intencional: el trigger duplicado ya fue eliminado manualmente.
DROP TRIGGER IF EXISTS trg_audit_lista_precio_items ON public.lista_precio_items;
