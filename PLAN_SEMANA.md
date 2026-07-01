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

## 0. 🔥 URGENTE — de la revisión del commit de Nadia (sesión 49), antes que nada

Nadia hizo testing manual en el navegador (sección 5 de este plan) y corrigió 5 bugs reales (`e9120e5`, `19d9932`) — overall buen trabajo, la sección 5 queda prácticamente cerrada. Revisando su diff aparecieron 3 cosas que necesitan acción inmediata:

### 0.1 — ✅ RESUELTO: dato real de cliente restaurado

`productos.stock_actual = 0` para **"Maquina de afeitar para hombres"** (`8b5f3bd4-812d-4ecd-ac4b-382818f9ba2d`, empresa `cbc4db74-...`). Reconstruí la causa exacta desde `movimientos_inventario`: a las 19:55:01 del 22/06 hay un movimiento `tipo='ajuste', cantidad=1, motivo=''` — un "Ajuste por Inventario Físico" de prueba en el modal de Productos, que con la semántica de `ajustar_stock_manual` **pisa el stock a un valor absoluto** (no resta/suma) — sea cual fuera el stock real en ese momento, quedó en 1. 17 segundos después, otro movimiento `salida, cantidad=1, motivo='Devolucion a proveedor DEV-2026-0010'` lo dejó en 0.

No se pudo reconstruir matemáticamente el valor correcto desde `movimientos_inventario` (las compras de este producto se aplicaron vía `aplicar_compra_producto`, que por diseño no inserta movimiento — sesión 36). Luciano confirmó el stock físico real: **10 unidades**. Aplicado con `ajustar_stock_manual('8b5f3bd4-...', 'ajuste', 10, 'Corrección post-testing manual sesión 49 (stock real confirmado por Luciano)')` — la misma RPC, usada como corresponde. Verificado: `stock_actual = 10`.

### 0.2 — "Ícono de Devolver no aparece" — no es un bug, está en otro módulo

Confirmé en el código: el botón "Devolver a proveedor" vive en `FacturasCompraSection.jsx` (línea ~305), dentro del menú de acciones (⋮) de cada factura de compra — **no** en `OrdenesCompraSection.jsx`, que es donde Nadia lo buscaba (tiene sentido que no lo haya encontrado ahí). Además solo se muestra si `compra.estado_pago !== 'anulada'`. No hace falta ningún fix de código — solo avisarle a Nadia dónde está. Sin acción pendiente más que esa aclaración.

### 0.3 — ✅ RESUELTO: patrón de "fallo silencioso" reintroducido en `CompraRapidaSection.jsx`

En el fix del bug #3 (parámetros de `decrement_stock`), el branch de "ítem eliminado al editar una compra" había cambiado de `throw` a `console.warn` si fallaba la reversión de stock — el `DELETE` de `detalle_compras` seguía de largo igual. Restaurado a `throw` (mismo patrón que sesión 33) en los 2 puntos (ítem eliminado, ajuste de cantidad), y restaurado el `p_motivo` descriptivo con el número de factura en las 2 llamadas a `increment_stock`/`decrement_stock` del branch "ítem existente modificado" (se había perdido en el caso `increment_stock`, que además ni capturaba el error). Build verificado, exit 0.

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

### 1.2 — 🔒 BLOQUEADO por plan de Supabase (no es un pendiente de configuración)

Luciano encontró el toggle correcto: Authentication → Iniciar sesión / Proveedores → Email → **"Prevent use of leaked passwords"** (NO está en "Políticas" ni en "Contraseñas", esas son otras cosas — RLS y WebAuthn respectivamente). Lo activó, pero al guardar Supabase tira un cartel pidiendo upgradear: **esta función requiere plan Pro o superior**, y el proyecto (`NALUX`) está en plan **Gratis**. No se puede activar sin pagar el plan Pro de Supabase.

**Acción real pendiente:** decisión de negocio (¿vale la pena el plan Pro ahora?), no una tarea técnica de 2 minutos. Mientras se decide, queda documentado como riesgo aceptado conocido — no es explotable de forma directa (solo reduce una capa de defensa contra contraseñas reusadas/filtradas), pero conviene revisarlo si en algún momento se sube de plan.

---

## 2. 🟡 IMPORTANTE — gaps funcionales encontrados en la auditoría de stock (sesión 44)

Estos NO son bugs de duplicación (ya confirmado que no hay ninguno) — son funcionalidad incompleta, documentados con test real:

### 2.1 — ✅ RESUELTO (sesión 50, migration 066): `ordenes_compra.estado` ahora se actualiza solo

Trigger nuevo `trg_oc_recalcular_estado` (función `fn_oc_recalcular_estado`) en `ordenes_compra_items`, `AFTER UPDATE OF cantidad_recibida`: recalcula el estado del `ordenes_compra` padre comparando `SUM(cantidad_recibida)` vs `SUM(cantidad_pedida)` de todos sus items — `0` recibido → se mantiene `enviada`; `0 < recibido < pedido` → `recibida_parcial`; `recibido >= pedido` → `recibida`. No toca OCs en `borrador`/`pendiente_aprobacion` (todavía no enviadas) ni `cancelada` (no las revive). Separado de `trg_oc_stock` (responsabilidad distinta: estado vs stock/costo).

Verificado con `BEGIN...ROLLBACK`: OC enviada → recibir 6 de 10 → `recibida_parcial` → recibir los 4 restantes → `recibida`. Test pgTAP `crear_recepcion.test.sql` actualizado (los Casos 2 y 3, que antes documentaban el gap, ahora confirman la transición automática).

### 2.2 — ✅ RESUELTO (sesión 50, migration 066): `crear_recepcion` ahora bloquea la sobre-recepción

Decisión confirmada: bloquear (no permitir recibir más de lo pedido). Agregado `SELECT cantidad_pedida, cantidad_recibida ... FOR UPDATE` + `RAISE EXCEPTION` si `cantidad_recibida + cantidad > cantidad_pedida`, antes de cualquier `INSERT` del loop (falla rápido, sin nada a medio insertar). Mismo patrón de lock que el resto de las RPC de stock — evita que 2 recepciones concurrentes del mismo ítem superen el límite pasando ambas el chequeo antes de que cualquiera confirme.

Verificado: recibir 8 de una OC de 5 ahora lanza `'La cantidad a recibir (8) superaria lo pedido...'`, sin modificar `cantidad_recibida` ni `stock_actual`. Test pgTAP actualizado (Caso 4, que antes documentaba el gap, ahora confirma el bloqueo).

### 2.3 — `decrement_stock` ya NO es dead code (actualizado, sesión 49)

El commit de Nadia le agregó 2 callers reales en `CompraRapidaSection.jsx` (edición de compras: revertir ítem eliminado, reducir cantidad de un ítem existente) — correctamente, con los parámetros nuevos (`p_producto_id`, `p_cantidad`, `p_motivo`). Ya no hace falta decidir si eliminarla. Sigue heredando el patrón seguro (lock + guard de negativo, confirmado por `decrement_stock.test.sql`) — pero ver **0.3** arriba: el caller nuevo no propaga el error si la RPC falla.

---

## 3. 🟢 Performance — deuda técnica, no bloqueante esta semana pero rápida de resolver

218 lints de performance en advisors. Los que valen la pena por esfuerzo/impacto:

- ✅ **RESUELTO (sesión 50, migration 067):** 5 policies RLS que re-evaluaban `auth.uid()`/`auth.role()` por fila (4 en `profiles`, 1 en `movimientos_uala`) — reescritas con `(select auth.uid())`/`(select auth.role())`, misma lógica exacta, verificado con `BEGIN...ROLLBACK` (un usuario sigue viendo solo su propio profile) y con `get_advisors` (el lint `auth_rls_initplan` bajó de 5 a 0).
- ✅ **RESUELTO (sesión 50, migration 067):** 2 índices duplicados — `idx_prov_empresa` (duplicaba `idx_proveedores_empresa`) y `idx_tc_empresa_moneda_fecha` (duplicaba `idx_tipos_cambio_empresa_fecha`), ambos dropeados. Confirmado con `get_advisors` (lint `duplicate_index` bajó de 2 a 0).
- ✅ **RESUELTO (sesión 50, migration 068):** `ventas_backup` / `detalle_ventas_backup` — confirmado por contenido (Luciano revisó las filas): eran restos del esquema viejo `ventas`/`detalle_ventas` previo a la migración a `comprobantes`, de los primeros días del sistema (fechas 02-03/06), ya reemplazados por 8 comprobantes reales de la misma empresa en ese mismo rango. Sin ninguna FK de otra tabla apuntando a estas 2 (confirmado por `pg_constraint` antes de borrar). `DROP TABLE` de ambas — el contenido completo (14 filas en total) queda embebido en el comentario de rollback de la migration, 100% recuperable desde el historial de git si algún día hiciera falta.
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

**Fase 2 — en progreso (sesión 51):**
- ✅ **RESUELTO:** efectos colaterales de `crear_venta` (`movimientos_caja`, `cuenta_corriente_movimientos`, entrega implícita/reconciliación con entrega manual). Nuevo archivo `supabase/tests/crear_venta_efectos_colaterales.test.sql`, 10/10 verde. Cubre: pago no-CC genera movimiento de caja, pago "Cuenta Corriente" no lo genera, `es_cc=true` genera el DEBE en cuenta corriente, `es_cc=false` no lo genera aunque haya cliente, venta sin pedido genera su propia entrega implícita ya entregada, venta con `p_pedido_id` de una entrega manual preexistente reconcilia (vincula `comprobante_id`) en vez de duplicar.
- ✅ **RESUELTO (rediseñado, sesión 51 continuación):** conciliación bancaria / integración Uala. Luciano hizo notar — y tenía razón, confirmado contra la skill `sap-reference` — que una transferencia de Ualá es un movimiento bancario/fintech, NO efectivo físico: no debería tocar Caja, debería tocar Bancos (igual que Mercado Pago). El primer test (`sync_uala_to_caja`) había documentado el diseño viejo tal cual estaba, pero el diseño viejo era el problema en sí mismo. **Reemplazo completo (migration 069):** el trigger (renombrado `trigger_uala_to_bancos` / `sync_uala_to_bancos`) ya no toca `movimientos_caja` — resuelve la cuenta bancaria de la empresa vía `integraciones_bancarias` (proveedor `'uala'`, ya habilitado desde sesión 39) y llama la misma RPC `insertar_movimiento_bancario_externo` que usa Mercado Pago, escribiendo en `movimientos_bancarios`. Se agregó `ConfigUalaModal.jsx` (espejo simplificado de `ConfigMercadoPagoModal`, sin token) + una card real en Configuración → Integraciones para que cada empresa elija qué `cuenta_bancaria_id` es su Ualá. Nuevo archivo `supabase/tests/sync_uala_to_bancos.test.sql`, 6/6 verde. **Efecto colateral bueno:** esto también cierra el hallazgo anterior — ya no depende de si hay una caja abierta, depende de si la integración está configurada (un setup de una sola vez, no una carrera diaria). Si no está configurada, el movimiento se omite en silencio, documentado (Casos 4 y 5), igual de a propósito que antes pero ya no ligado a un cajero.
- **Patrón establecido para el resto del sistema:** cualquier integración bancaria/fintech nueva (transferencias, billeteras, etc.) debe seguir este mismo camino — `integraciones_bancarias` + `cuentas_bancarias` + `insertar_movimiento_bancario_externo` → `movimientos_bancarios`. Nunca un atajo directo a `movimientos_caja`.

**Pendiente todavía:** edge function `emitir-cae` (emisión de CAE/AFIP) — no es testeable con pgTAP (llama servicios SOAP/REST reales de AFIP, no es una función SQL); Caja (apertura/cierre, arqueo) sin test — tampoco hay RPC `SECURITY DEFINER` involucrada, la lógica vive 100% en `CajaContext.jsx`/`CajaApertura.jsx`/`CajaCierre.jsx` haciendo `INSERT`/`UPDATE` directo desde el cliente, así que esto sería un test manual en navegador, no un test pgTAP.

**Hallazgo de regresión (sesión 51), ya resuelto:** al escribir el test nuevo, el fixture estándar (`INSERT INTO auth.users` seguido de `INSERT INTO public.profiles`) que usan los 9 archivos de Fase 1 rompía con `duplicate key value violates unique constraint "profiles_pkey"`. Causa: el trigger `on_auth_user_created` (función `handle_new_user`, existe desde antes de sesión 36) ya inserta la fila en `profiles` automáticamente al insertar en `auth.users` — el segundo `INSERT` explícito viola la PK. Esto significa que los 9 tests de Fase 1 estaban rotos hoy si se los volvía a correr literal (no es un problema de mi test nuevo, es un problema de fixture compartido). **Se corrigieron los 9 archivos** (reemplazado el `INSERT INTO public.profiles` por un `UPDATE ... SET empresa_id = ... WHERE id = ...`, ya que la fila la crea el trigger con `empresa_id` NULL) y se re-corrió cada uno de punta a punta: los 9 siguen 100% en verde con el fix. De paso se corrigió un segundo bug pre-existente y no relacionado en `obtener_proximo_numero.test.sql` (usaba la columna `confirmed_at`, que hoy es una columna generada en `auth.users` — se cambió a `email_confirmed_at` como los demás archivos).

---

## 5. ✅ Pruebas manuales en navegador — hechas por Nadia (sesión 49)

> Nadia cubrió los 5 puntos de esta sección y corrigió lo que encontró (ver sección 0 arriba para lo que su revisión dejó pendiente).

1. ✅ **Modal "Movimiento de Stock" en Productos** — probado, encontró el mensaje de error con UUID crudo y lo arregló (bug #1).
2. ✅ **Editar una compra en `CompraRapidaSection`** — probado, encontró y arregló 3 bugs reales (#2, #3, #4: `empresa_id` faltante, parámetros incorrectos de `decrement_stock`, `increment_stock` con negativo).
3. ✅ **Recepción de OC** completa y parcial — probado, confirmado que el stock no se duplica (consistente con el test pgTAP de sesión 44).
4. ✅ **Devolución a proveedor que excede el stock** — probado, encontró y arregló el mensaje de error con UUID crudo (bug #5).
5. ✅ **`npm run build`** — verificado, exit 0.

---

## 6. Convenciones a seguir (para no romper lo que ya está hecho)

- **Migrations:** numeración secuencial, la última aplicada es `070`. Antes de crear una nueva: `ls supabase/migrations | tail -5` para confirmar el próximo número libre — si están trabajando los 2 en paralelo, avisarse para no colisionar.
- **Tests:** `supabase/tests/README.md` tiene la regla de oro — nunca correr un test contra una empresa real (ni `db21dfad-...` ni `cbc4db74-...` ni ninguna otra con datos de un cliente). Usar tenants sintéticos dentro de `BEGIN...ROLLBACK`. Si un caso necesita persistencia real entre conexiones (como el test de concurrencia de `obtener_proximo_numero`), pedir confirmación antes de crear datos persistentes y borrarlos apenas termine la verificación.
- **Patrón de cualquier RPC nueva que toque `stock_actual`:** `SELECT...FOR UPDATE` antes de decidir + guard de stock negativo + guard de tenant (`empresa_id = get_my_empresa_id()`) + `INSERT` en `movimientos_inventario` con motivo real, todo en la misma transacción. Está documentado con el detalle de las 8 RPC existentes en `CONTEXT.md`, buscar "Mapa de escritores de stock_actual" (sesión 36).

---

## 7. Orden sugerido para la semana

| Día | Foco |
|---|---|
| 1 | ~~Sección 1~~ ✅, ~~Sección 5~~ ✅, ~~Sección 0~~ ✅, ~~Sección 2~~ ✅ y ~~Sección 3 (completa)~~ ✅ — todas resueltas salvo 1.2 (🔒 bloqueado por plan Supabase, no por configuración — ver detalle). |
| 2 | Fase 2 de tests (sección 4) — en progreso: `crear_venta` (efectos colaterales) ✅, conciliación Uala ✅. `emitir-cae` y Caja quedan fuera de alcance de pgTAP (ver sección 4). |
| 3 | Regression pass completo, `npm run build`, commit/push final, deploy — ✅ hecho, deploy disparado a producción. |
| 3+ | Segunda auditoría (sección 8, sesión 52) — en progreso. |

---

## 8. 🔴 Segunda auditoría (sesión 52) — más allá de `stock_actual`

A pedido explícito: revisión de arriba a abajo de TODO lo que NO se auditó en las sesiones 36-51 (esas se centraron en `stock_actual` + exposición de RPCs a `anon` + performance). Esta ronda cubre: cobertura de RLS en TODAS las tablas multi-tenant (no solo las de stock), guards de tenant en RPCs no relacionadas a stock, precisión de cálculos financieros, y patrones de manejo de errores. Metodología: consulta directa a `pg_policy`/`pg_class` para mapear cobertura real (no asumida), + grep dirigido en frontend, + verificación con `BEGIN...ROLLBACK` de cada hallazgo antes y después del fix.

### 8.1 — ✅ RESUELTO (CRÍTICO): fuga cross-tenant real en `movimientos_uala`

**Migration 071.** La policy de SELECT (`"usuarios autenticados pueden leer"`) solo chequeaba `auth.role() = 'authenticated'`, sin filtrar por `empresa_id`. Confirmado con `BEGIN...ROLLBACK` (no hipotético): un usuario autenticado de la Empresa X podía leer los movimientos Ualá de la Empresa Y completos (destinatario, monto, fecha) — `MovimientosUala.jsx` tampoco filtra por `empresa_id` en el cliente, dependía 100% de RLS. Reescrita a `empresa_id = get_my_empresa_id()`, mismo patrón que las ~50 tablas multi-tenant del sistema. Verificado: usuario de Tenant X ya no ve la fila de Tenant Y.

### 8.2 — ✅ RESUELTO: `profiles` no permitía a un admin ver a sus colegas

**Migration 072.** La única policy SELECT de `profiles` era `id = auth.uid()` — no existía ninguna policy que permitiera ver perfiles de OTROS usuarios de la misma empresa. Confirmado con `BEGIN...ROLLBACK`: un admin que consulta `profiles WHERE empresa_id = su_empresa` recibía **solo su propia fila**, nunca la de sus compañeros — `UsuariosSection.jsx` (gestión de usuarios, pantalla solo para admins) depende de esto y hoy muestra la lista de usuarios vacía/incompleta en producción. Es el caso inverso al 8.1: no es una fuga, es una restricción excesiva que rompe funcionalidad real. Agregada policy `profiles_admin_select` (`is_admin() AND empresa_id = get_my_empresa_id()`), mismo patrón que `profiles_admin_update/insert/delete`. Grep confirmó que ningún otro componente del sistema necesita ver perfiles de otros usuarios — no se amplió más allá de lo necesario. Verificado: admin ahora ve 2 filas (la propia + la del colega), un `staff` sigue viendo solo 1.

### Pendiente en esta auditoría — TODO CERRADO (sesiones 38 y 41, ver CONTEXT.md)

- ~~Guards de tenant en RPCs `SECURITY DEFINER` no relacionadas a `stock_actual`~~ — ✅ sesión 38.
  Auditadas las 27 funciones `SECURITY DEFINER` del schema. Hallazgo real: `calcular_ofertas_carrito`
  sin ningún guard (corregido, migration 120). Confirmado que cheques/retenciones/asientos
  contables NO tienen RPCs propias — operan por RLS directo, ya cubierto en el barrido de
  sesión 52 de arriba (8.0). Notas de crédito/débito: guard correcto, sin cambios.
- ~~Precisión de cálculos financieros~~ — ✅ sesión 41. Hallazgo real: `subtotal = precio*cantidad`
  en JS no siempre da 2 decimales limpios (ruido IEEE754, ej. `45.45*3 = 136.35000000000002`,
  confirmado en ~30% de combinaciones comunes). Corregido con `ROUND(...,2)` defensivo dentro de
  `crear_venta` (migration 123) — protege a todos los callers sin tocar el frontend.
- ~~Patrones de manejo de errores fuera de `stock_actual`~~ — ✅ sesión 41. Auditadas ~25 escrituras
  críticas: el 100% muestra toast al usuario cuando falla. Sin hallazgos esta vez (a diferencia
  de sesiones 33 y 49, que sí encontraron catches silenciosos reales).
- Edge functions: ya auditadas `invite-user`, `create-user`, `delete-user`, `generar-csr`, `emitir-cae`, `mp-webhook` (sesión 47-48) — falta nada nuevo salvo que se agregue una.

Cualquier duda sobre el por qué de una decisión técnica (por qué `ajuste` es absoluto y no delta, por qué `increment_stock` decide el tipo de movimiento por signo y no por nombre de función, etc.) está razonada en detalle en `CONTEXT.md` — está ordenado por sesión, de más reciente a más vieja.
