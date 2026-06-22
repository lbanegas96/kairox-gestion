# Plan de la semana — KAIROX Gestión

**Objetivo:** sistema 100% funcional, completo y sin errores antes de fin de semana.
**Generado:** 2026-06-21, tras cerrar la Fase 1 de tests automatizados (sesiones 36-46) + auditoría de arquitectura (saas-architect skill) + revisión de Supabase Advisors.
**Para vos, que arrancás ahora:** este documento es el punto de partida. El detalle técnico completo de todo lo que se hizo está en [CONTEXT.md](CONTEXT.md) — éste es el resumen ejecutable.

---

## 0. Qué cambió en las últimas sesiones (contexto para no pisar trabajo hecho)

Las últimas ~15 sesiones fueron una auditoría exhaustiva de **todo lo que escribe `productos.stock_actual`** (el área que ya causó 2 bugs reales en producción: doble incremento en recepción de OC, fallo silencioso en compras). Se encontraron y arreglaron:

- Doble incremento de stock en recepción de OC (2 caminos UI redundantes) — sesión 31-32.
- Fallo silencioso en `aplicar_compra_producto` (`console.error` en vez de `throw`) — sesión 33.
- 4 riesgos latentes: guards de stock negativo y locks `FOR UPDATE` faltantes en `crear_devolucion`, `increment_stock`, `fn_oc_update_stock`, `aplicar_compra_producto` — sesión 39 (migration 060).
- 2 implementaciones redundantes de "ajuste manual de stock" (ProductosSection.jsx) unificadas en una sola RPC nueva: **`ajustar_stock_manual`** — sesión 38 (migration 059).
- Trazabilidad faltante en `decrement_stock`/`increment_stock` (no insertaban en `movimientos_inventario`) — sesión 42 (migration 062).
- **Infraestructura de tests pgTAP** (`supabase/tests/`) — 9 archivos de test, cubren las 8 RPC `SECURITY DEFINER` que tocan `stock_actual`. Todos corridos de verdad contra el proyecto remoto, todos en verde. Leer `supabase/tests/README.md` antes de tocar nada de esa carpeta — tiene la regla de oro (nunca correr contra empresas reales).

**Migrations nuevas que tenés que tener aplicadas:** 059 a 062. Si tu local no las tiene, son las últimas en `supabase/migrations/` — ya están en el proyecto Supabase remoto (`wuznppxeonmhfcvnqfbf`), aplicadas vía MCP.

**RPC nueva que probablemente no conocés:** `ajustar_stock_manual(p_producto_id, p_tipo, p_cantidad, p_motivo)`. `entrada`/`salida` son delta, `ajuste` es valor absoluto (inventario físico). Es el único punto de entrada hoy para el modal "Movimiento de Stock" de Productos.

---

## 1. 🔴 CRÍTICO — seguridad, antes de cualquier otra cosa

> ✅ **Secciones 1.1, 1.3 y 1.4 RESUELTAS el mismo día** (sesión 47, después de armar este plan — se decidió no esperar a la semana). Falta solo **1.2** (config de Supabase Auth, requiere acceso al Dashboard). Detalle de lo aplicado abajo de cada sub-hallazgo.

Corrí `get_advisors` (security + performance) sobre el proyecto. El hallazgo más importante:

### 1.1 — ✅ RESUELTO: funciones `SECURITY DEFINER` ejecutables por `anon` (sin autenticar) vía REST

**Migrations 063 y 064.** Se revocó `EXECUTE` de `anon` (y de `PUBLIC`, que `anon` hereda) en 31 funciones: las 28 de la lista original de este plan, más **3 que se habían escapado de la primera extracción** y que el re-chequeo con `get_advisors` después de aplicar 063 detectó: `crear_devolucion`, `crear_nota_debito`, `crear_venta` (migration 064). Quedó **una sola excepción a propósito**: `email_exists_in_system` (chequeo pre-signup, confirmado que se llama sin sesión desde `validationUtils.checkEmailExists`).

**Verificado con `has_function_privilege('anon', oid, 'EXECUTE')` sobre las 32 funciones** que el único resultado restante es `email_exists_in_system`. **Regresión**: corrida real (no asumida) de `ajustar_stock_manual.test.sql` (11/11 verde), `crear_recepcion` (trigger `fn_oc_update_stock` sigue disparando bien tras revocarle `EXECUTE` — los triggers no necesitan el grant, los dispara el motor) y `crear_venta` (stock sigue decrementando bien para `authenticated`, y `anon` ahora recibe `permission denied for function` real en vez de fallar por lógica interna).

**Para el resto de las funciones que no se tocaron** (mayormente funciones trigger que `PostgREST` no expone como RPC invocable por su tipo de retorno `trigger`, y que ya estaban indirectamente protegidas): quedan con `EXECUTE` revocado igual por higiene — no hace falta acción adicional.

### 1.4 — ✅ RESUELTO: 9 funciones sin `search_path` inmutable

**Migration 063.** `ALTER FUNCTION ... SET search_path TO 'public'` aplicado a las 9, incluida `fn_calcular_costo_valoracion` (el cálculo central de PPP — no se tocó la lógica, solo el `search_path`, cero riesgo de romper el cálculo).

### 1.2 — Habilitar "Leaked Password Protection"

Configuración de Supabase Auth (Dashboard → Authentication → Policies), no requiere código. Está desactivada hoy.

### 1.3 — ✅ RESUELTO (más grave de lo que parecía): policy RLS de `movimientos_uala`

**Migration 065.** Al revisar el `TO` de la policy `"service role puede insertar"` se confirmó que, a pesar del nombre, **NO** estaba scoped a `service_role` — estaba en `PUBLIC`. Y la tabla además tenía `GRANT INSERT` a nivel tabla para `anon` **y** `authenticated`. Resultado real (no hipotético): **cualquiera, incluso sin login, podía insertar filas arbitrarias en `movimientos_uala`** (tabla de conciliación bancaria con Ualá). Confirmado por grep que el frontend (`MovimientosUala.jsx`) solo hace `SELECT`, nunca `INSERT` — el único INSERT legítimo es el del job de sincronización (`service_role`). Se revocó `INSERT` de tabla para `anon`/`authenticated` y se recreó la policy explícitamente `TO service_role`. Verificado con `pg_policy` que `roles = {service_role}` después del fix.

### 1.2 — Pendiente, requiere Dashboard

"Leaked Password Protection" sigue desactivada — es la única acción de la sección 1 que no se pudo aplicar por SQL (es un toggle en Authentication → Policies del Dashboard de Supabase). Activarla cuando alguien tenga 2 minutos.

---

## 2. 🟡 IMPORTANTE — gaps funcionales encontrados en la auditoría de stock (sesión 44)

Estos NO son bugs de duplicación (ya confirmado que no hay ninguno) — son funcionalidad incompleta, documentados con test real:

### 2.1 — `ordenes_compra.estado` nunca se actualiza solo

Ni `crear_recepcion` ni ningún trigger actualizan el estado de la OC a `recibida_parcial`/`recibida` después de recibir mercadería. La UI (`OrdenesCompraSection.jsx`) tiene toda la lógica visual para esos 2 estados (badges, filtros, colores) pero nada los dispara — una OC queda visualmente en `enviada` para siempre sin importar cuánto se reciba.

**Sugerencia de fix:** un trigger `AFTER UPDATE OF cantidad_recibida ON ordenes_compra_items` (puede ser el mismo `trg_oc_stock` extendido, o uno nuevo) que recalcule el estado del `ordenes_compra` padre comparando `SUM(cantidad_recibida)` vs `SUM(cantidad_pedida)` de todos sus items: si `0 < recibido < pedido` → `recibida_parcial`; si `recibido >= pedido` → `recibida`.

### 2.2 — `crear_recepcion` no valida sobre-recepción

No hay guard server-side contra recibir más de lo pedido — el único límite es el atributo `max` de un `<Input>` en `GenerarRecepcionModal.jsx` (puenteable llamando la RPC directo). Decidir: ¿bloquear con `RAISE` si `cantidad_recibida + cantidad > cantidad_pedida`, o permitirlo a propósito (algunos negocios reciben de más y ajustan después)? Si se decide bloquear, replicar el patrón de guard ya usado en el resto de las RPC de stock (ver sección 4).

### 2.3 — `decrement_stock` es dead code

Sin caller en `src/`. Decidir: ¿eliminarla (con migration de DROP + rollback comentado, como se hizo con las 5 RPC muertas de la sesión 30) o dejarla documentada como utilidad de reserva? Si se mantiene, ya hereda el patrón seguro (confirmado por test).

---

## 3. 🟢 Performance — deuda técnica, no bloqueante esta semana pero rápida de resolver

218 lints de performance en advisors. Los que valen la pena por esfuerzo/impacto:

- **5 policies RLS re-evalúan `auth.uid()`/`auth.jwt()` por fila** en vez de una vez por query (4 en `profiles`, 1 en `movimientos_uala`). Fix: envolver en `(select auth.uid())` en vez de `auth.uid()` directo dentro de la policy. Mejora medible en cualquier tabla con muchas filas.
- **2 índices duplicados** — `proveedores` (`idx_prov_empresa`/`idx_proveedores_empresa`) y `tipos_cambio` (`idx_tc_empresa_moneda_fecha`/`idx_tipos_cambio_empresa_fecha`). `DROP` uno de cada par.
- **`ventas_backup` / `detalle_ventas_backup`**: 2 tablas backup con RLS habilitado pero SIN policy y SIN primary key (aparecen en security Y en performance advisors). Confirmar con Luciano si siguen siendo necesarias — si no, `DROP TABLE`. Si son necesarias, al menos agregarles una PK.
- **90 warnings de "multiple permissive policies"** y **75 FKs sin índice** y **44 índices sin uso**: backlog real, pero no es bloqueante para "sistema funcional esta semana" — anotarlo para una sesión de performance dedicada más adelante, no la prioricen ahora salvo que algo concreto esté lento.

---

## 4. ✅ Testing — qué está cubierto, qué falta (Fase 2 sugerida)

**Cubierto (Fase 1, completa):** las 8 RPC `SECURITY DEFINER` que tocan `stock_actual` — `obtener_proximo_numero`, `decrement_stock`, `increment_stock`, `ajustar_stock_manual`, `crear_recepcion` (test de regresión del bug histórico), `aplicar_compra_producto`, `crear_venta`, `crear_entrega`, `crear_devolucion`. Todas en `supabase/tests/`, formato pgTAP estándar.

**Cómo correrlos:** este entorno no tiene Docker, así que se corrieron pegando el SQL directo vía el MCP de Supabase (ver `supabase/tests/README.md` para el detalle). Si vos tenés Docker instalado:
```bash
npx supabase init   # solo si no existe supabase/config.toml
npx supabase start
npx supabase test db
```
Si funciona así, mejor — es la vía estándar y vas a poder correr todo de una con `pg_prove` en vez de uno por uno.

**No cubierto todavía (Fase 2, sugerida si hay tiempo esta semana):**
- Efectos colaterales de `crear_venta` que no son `stock_actual`: `movimientos_caja`, `cuenta_corriente_movimientos`, entrega implícita.
- Edge function `emitir-cae` (emisión de CAE/AFIP) — sin test automatizado.
- Conciliación bancaria / integración Uala.
- Caja: apertura/cierre, arqueo.

---

## 5. 🖱️ Pruebas manuales en navegador — NO se hicieron esta sesión (todo fue backend/SQL)

Toda la auditoría de las últimas sesiones se hizo a nivel SQL/RPC vía MCP, sin abrir la app en el navegador ni una vez. Antes de decir "100% funcional" hace falta probar esto a mano:

1. **Modal "Movimiento de Stock" en Productos** — confirmar que entrada/salida/ajuste funcionan visualmente y que el mensaje de error se ve claro si el guard bloquea (stock insuficiente, cantidad inválida).
2. **Editar una compra en `CompraRapidaSection`** (agregar ítem, borrar ítem, cambiar cantidad) — confirmar que el motivo nuevo (`Reversión por eliminación de ítem...` / `Ajuste de cantidad por edición...`) no rompe nada visualmente y que el stock se ve correcto después.
3. **Recepción de OC** completa y parcial — recibir una OC en 2 pasos, confirmar que el stock sube correctamente las 2 veces (no debería duplicarse — ya confirmado por test, pero confirmar también la experiencia visual). Tener en cuenta el gap de la sección 2.1: el estado de la OC NO va a cambiar solo, no es un bug nuevo que encuentres.
4. **Devolución a proveedor que excede el stock disponible** — confirmar que el error se muestra de forma clara al usuario, no solo como un toast genérico de Supabase.
5. **`npm run build`** sin errores (ya se corrió varias veces en sesiones anteriores tras cada cambio, pero corré de nuevo tras cualquier cambio que hagas esta semana).

---

## 6. Convenciones a seguir (para no romper lo que ya está hecho)

- **Migrations:** numeración secuencial, la última aplicada es `062`. Antes de crear una nueva: `ls supabase/migrations | tail -5` para confirmar el próximo número libre — si están trabajando los 2 en paralelo, avisarse para no colisionar.
- **Tests:** `supabase/tests/README.md` tiene la regla de oro — nunca correr un test contra una empresa real (ni `db21dfad-...` ni `cbc4db74-...` ni ninguna otra con datos de un cliente). Usar tenants sintéticos dentro de `BEGIN...ROLLBACK`. Si un caso necesita persistencia real entre conexiones (como el test de concurrencia de `obtener_proximo_numero`), pedir confirmación antes de crear datos persistentes y borrarlos apenas termine la verificación.
- **Patrón de cualquier RPC nueva que toque `stock_actual`:** `SELECT...FOR UPDATE` antes de decidir + guard de stock negativo + guard de tenant (`empresa_id = get_my_empresa_id()`) + `INSERT` en `movimientos_inventario` con motivo real, todo en la misma transacción. Está documentado con el detalle de las 8 RPC existentes en `CONTEXT.md`, buscar "Mapa de escritores de stock_actual" (sesión 36).

---

## 7. Orden sugerido para la semana

| Día | Foco |
|---|---|
| 1 | ~~Sección 1 (seguridad)~~ — ✅ ya resuelta el mismo día salvo 1.2 (toggle de Dashboard, 2 min) |
| 2 | Sección 5 (pruebas manuales) + decidir sección 2.1/2.2 (gaps de OC) |
| 3 | Implementar lo que se decidió en 2.1/2.2 + sección 3 (performance, los 3 quick wins) |
| 4 | Fase 2 de tests (sección 4) si da el tiempo, sino seguir con manuales |
| 5 | Regression pass completo, `npm run build`, commit/push final, deploy |

Cualquier duda sobre el por qué de una decisión técnica (por qué `ajuste` es absoluto y no delta, por qué `increment_stock` decide el tipo de movimiento por signo y no por nombre de función, etc.) está razonada en detalle en `CONTEXT.md` — está ordenado por sesión, de más reciente a más vieja.
