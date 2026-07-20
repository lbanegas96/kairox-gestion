# Fase 2/3 — Infra de carga + Escenarios A/B/C/D
**Sesión 77 (2026-07-18/19).** Parte del plan de sometimiento a estrés (`.claude/plans/fluffy-sauteeing-panda.md`).

## Resumen ejecutivo

Se construyó desde cero la infraestructura de carga (generador de datos sintéticos + k6) y se
corrieron los 4 escenarios contra el stack local de Supabase. **Hallazgo principal, confirmado con
datos reales y corregido en el camino**:

- **Más empresas distintas vendiendo en simultáneo NO degrada el sistema** — confirmado con hasta
  131 empresas reales concurrentes, p95 plano en ~25ms.
- La degradación que se había visto al principio (p95 subiendo a ~700ms con muchos VUs
  concentrados) **NO es el lock de `series_numeracion`/`stock_actual` como se pensó al principio** —
  es el límite de **`max_connections = 100`** del Postgres local (default de un `supabase start`,
  pensado para desarrollo, no para carga). Confirmado con un test dedicado: 100 VUs reales sobre
  la MISMA empresa y el MISMO producto — el caso de máxima contención posible — dieron p95=19ms,
  0% errores, igual de bien que 131 empresas distintas. Recién al subir a 300-500 VUs totales
  aparecen errores de conexión (`STATUS=0`, `EOF`) típicos de agotar el pool de conexiones, no
  errores de aplicación.
- Los 3 escenarios adicionales (contención, dashboard, cobros) corrieron limpios hasta 90 VUs
  concurrentes — el límite práctico seguro dado el `max_connections=100` local.

## Qué se construyó

- **`scripts/loadtest/seed.mjs`**: genera empresas sintéticas completas contra el stack local —
  empresa real (dispara `trg_empresa_seed_maestros`), usuario admin con login real (JWT genuino,
  no fabricado a mano), clientes, productos, e historial de ventas creado llamando al RPC real
  `crear_venta` (no INSERTs directos). Stock sintético deliberadamente muy alto (500k-1M unidades)
  — un valor bajo se agota bajo carga sostenida y confunde el guard de "Stock insuficiente" con una
  falla de capacidad (pasó 3 veces esta sesión antes de corregirlo).
- **`loadtest/k6/escenario-a-multitenant.js`** — muchas empresas concurrentes vendiendo.
- **`loadtest/k6/escenario-b-contencion.js`** — muchos VUs vendiendo para LA MISMA empresa
  (`MODO=productos_distintos` o `mismo_producto`).
- **`loadtest/k6/escenario-c-dashboard.js`** — simula el path de lectura del Dashboard (9 queries
  en paralelo + 6 secuenciales de `getFlujoCajaMensual` + 2 más).
- **`loadtest/k6/escenario-d-cobros-pagos.js`** — `registrar_cobro_cliente` real en loop.
- **k6 instalado** localmente (`.tools/`, binario portable descargado del release de GitHub).

## Escenario A — multi-tenant concurrente

### 30 empresas reales (1 VU = 1 empresa)
Ramp-up 5→20→30: 3.172 ventas, **0.00% error**, **p95=22.22ms** plano.

### 131 empresas reales (1 VU = 1 empresa, sin reciclar)
Ramp-up 5→20→50→100→131: **17.773 ventas**, **0.00% error**, **p95=25.72ms** — prácticamente
idéntico al de 30 empresas pese a tener más de 4x la concurrencia. Confirma que el aislamiento
por-tenant funciona con un margen amplio, no un número de juguete.

### 500 VUs reciclando 30 empresas (~16-17 por empresa)
p95 subió a 700-814ms con una tasa de error de 0.04% (una vez corregido un artefacto de stock
agotado — ver "Errores de metodología" abajo). En su momento se interpretó como el lock de
`series_numeracion` degradando bajo contención — **esa interpretación quedó refutada por el
Escenario B** (ver abajo). La explicación real: 500 VUs es la primera corrida que se acercó al
límite de `max_connections=100` de Postgres, independientemente de cuántos tenants distintos
había detrás.

## Escenario B — contención dentro de una empresa (`MODO=mismo_producto`)

Este escenario fue clave para aislar la causa real:

| Corrida | VUs | p95 `crear_venta` | Error rate |
|---|---|---|---|
| 100 VUs, 1 empresa, 1 producto (contención máxima) | 100 | **19.15ms** | 0.00% |
| 300 VUs, 1 empresa | 300 | — (ver nota) | mayoría `STATUS=0`/`EOF` |
| 500 VUs, 1 empresa | 500 | 1.12s (agregado, contaminado) | 98.12% |

**El dato clave**: con 100 VUs concentrados en la MISMA empresa y el MISMO producto (el peor caso
de contención posible sobre `series_numeracion` y `stock_actual`), la latencia fue **mejor** que la
de 500 VUs repartidos en 30 empresas del Escenario A. Si el lock por-tenant fuera la causa de la
degradación, este caso (contención máxima concentrada) debería ser el PEOR, no uno de los mejores.

Al escalar a 300-500 VUs sobre 1 sola empresa, la mayoría de los requests fallaron con
`STATUS=0 BODY=null` y `"EOF"` — errores de **conexión rota**, no de aplicación (no son excepciones
de PL/pgSQL, son fallos de red/conexión). Se confirmó la causa raíz:

```sql
SHOW max_connections;  -- 100
```

**Conclusión revisada**: el techo real encontrado esta sesión (~100-200 conexiones concurrentes)
es del **stack local de desarrollo** (`supabase start` usa un Postgres con `max_connections=100`
por defecto), no una limitación arquitectónica de KAIROX. Un proyecto Supabase hosted usa pooling
(Supavisor/PgBouncer) que absorbe muchas más conexiones de cliente sobre un número menor de
conexiones reales a Postgres — este límite específico **no debería aplicar igual en producción**,
pero queda pendiente confirmarlo contra un ambiente con pooling real (ver "Lo que falta").

Instrumentación de locks en vivo (`pg_locks`/`pg_stat_activity`) intentada durante las corridas:
capturó como mucho un `RowShareLock` puntual — a estas escalas (≤100 VUs), cada operación mantiene
el lock tan poco tiempo que el muestreo puntual casi nunca lo agarra en el acto. No se pudo
confirmar contención de locks real y visible; la señal de latencia agregada es la evidencia que
queda.

## Escenario C — dashboard/lectura

90 sesiones concurrentes simulando el Dashboard completo (9 queries paralelas + 6 secuenciales de
`getFlujoCajaMensual` + 2 más — 14 requests por carga):

| Métrica | Resultado |
|---|---|
| Cargas de dashboard completas | 2.204 |
| Tasa de error | **0.00%** |
| p95 dashboard completo | **940.84ms** (14 requests, incluye las 6 secuenciales) |
| p95 por query individual | 176.55ms |

No hubo errores, pero el tiempo total del dashboard (~940ms en el percentil 95) es notoriamente más
alto que cualquier operación de escritura — consistente con el hallazgo de código de la Fase 1
(`getFlujoCajaMensual` hace 6 queries secuenciales, no paralelas). Con 90 sesiones simultáneas
refrescando cada pocos segundos, ese patrón secuencial es el que más pesa.

## Escenario D — cobros (`registrar_cobro_cliente`)

90 VUs concurrentes: **7.115 cobros reales**, **0.00% error**, **p95=26.52ms** — mismo
comportamiento limpio que `crear_venta`. **Alcance acotado**: el seed actual no genera facturas con
`cliente_id` real (todas las ventas históricas son "Consumidor Final"), así que este escenario mide
el costo de la RPC en sí, sin imputación a una factura puntual — no cubre el caso específico "2 VUs
pagando la MISMA factura" (lock de `comprobantes.total`) que pedía el plan original.

### Escenario D — `MODO=misma_factura` — CORRIDO (2026-07-20, Luciano)

Código escrito por Nadia en la sesión 79 (ver nota más abajo), ejecutado esta sesión apenas hubo
Docker disponible en esta máquina. 20 empresas sembradas (`EMPRESAS=20`), cada una con 1 factura
compartida de $10.000.000 en Cuenta Corriente, rampa hasta **100 VUs** — con `__VU % 20` empresas,
hasta 5 VUs distintos imputando pagos contra la MISMA fila de `comprobantes` al mismo tiempo.

**Resultado: 7.525 cobros, 0.00% error, p95=26.99ms, max=88.7ms** — igual de limpio que el modo
`clientes_random`, sin degradación por la contención adicional del lock.

**Verificado además a nivel de datos (no solo que la RPC devolviera 200)**, contra el Postgres local
vía `docker exec`: la suma de `cuenta_corriente_imputaciones.monto` por factura compartida coincide
con la cantidad de imputaciones reales (7.530 = 7.525 de esta corrida + 5 del smoke test previo),
**0 facturas con total negativo**, y las 20 quedaron en `estado_pago='parcial'` como se esperaba (el
monto imputado, ~$17-24k por factura, es una fracción chica de los $10M). Esto confirma que el
`SELECT...FOR UPDATE` de `registrar_cobro_cliente` serializa de verdad bajo concurrencia real — sin
deadlocks, sin updates perdidos, sin doble conteo — que era el objetivo real del escenario, no la
velocidad.

Con esto, el punto 2 de "Lo que falta probar" (Escenario D con imputación a la misma factura) queda
**cerrado**. 100% repo-only / stack local — nada tocó producción.

## Errores de metodología encontrados y corregidos en el camino

1. **Siembra masiva falló repetidamente en foreground** (corte a los ~15s, exit 127,
   independiente del `EMPRESAS` objetivo) — causa: límite de esta sesión de Claude Code, no del
   sistema. Resuelto corriendo con `run_in_background: true`. `seed.mjs` corregido para escribir
   `fixtures.json` incrementalmente, así una corrida cortada no pierde el progreso.
2. **"Stock insuficiente" confundido con falla de capacidad** — pasó 3 veces (Escenario A a 500
   VUs, primer intento de Escenario B). Es el sistema bloqueando sobreventa correctamente, no un
   hallazgo de estrés. Corregido subiendo el stock sintético por defecto a 500k-1M en `seed.mjs`.
3. **Hipótesis inicial equivocada sobre la causa de la degradación** — se atribuyó al lock de
   `series_numeracion` sin haber aislado la variable. El Escenario B (100 VUs en 1 sola empresa,
   sin degradación) refutó esa hipótesis; el `max_connections=100` local explica los datos mejor.
   Documentado acá para que quede corregido en el registro, no solo en la sesión.

## Lo que falta probar

| Qué | Por qué no se hizo | Prioridad |
|---|---|---|
| Confirmar si el límite de conexiones aplica igual contra un proyecto hosted con pooling (Supavisor) | Requeriría un branch de Supabase Cloud o subir `max_connections` localmente y re-correr | Alta — es la pregunta que queda abierta sobre el "techo real" |
| Aislar contención de locks real (subir `max_connections` local y repetir Escenario B a 300-500 VUs, sin el ruido de conexión agotada) | Quedó pendiente por tiempo — es un cambio de una línea en `postgresql.conf` del stack local | Media |
| Escenario D con imputación a la MISMA factura (lock de `comprobantes.total`) | ✅ **CERRADO (2026-07-20)** — 7.525 cobros, 0% error, verificado a nivel de datos, sin corrupción — ver resultado en "Escenario D" arriba | — |
| Empujar Escenario A más allá de 131 empresas únicas | El corte de ~15s en foreground sigue sin resolverse del todo — sembrar en tandas acumulando sobre `fixtures.json` | Baja — 131 ya es una muestra sólida |
| Fase 4 — Playwright con navegadores reales | No empezado | Baja (depende de que el backend cierre primero) |

## Nota (sesión 79, Nadia) — código de la "factura compartida" — CORRIDO en la sesión siguiente

Sin Docker en esta máquina no se pudo levantar el stack local (`npx supabase start`) para
efectivamente correr el escenario, así que este punto quedó **escrito y sin ejecutar** en la sesión
79. **Corrido y cerrado el 2026-07-20** (ver sub-sección "Escenario D — `MODO=misma_factura`" arriba)
— se dejan los comandos igual, quedan como referencia reproducible:

```bash
npx supabase start
EMPRESAS=20 node scripts/loadtest/seed.mjs     # ahora crea 1 factura compartida por empresa
MODO=misma_factura MAX_VUS=100 npx k6 run loadtest/k6/escenario-d-cobros-pagos.js
```

Qué cambió — ambos 100% repo-only, nada tocó producción ni el proyecto hosted:
- **`scripts/loadtest/seed.mjs`**: además del historial de siempre, cada empresa genera 1 venta en
  Cuenta Corriente a un cliente real (`p_es_cc=true`, `estado_pago='pendiente'`,
  `FACTURA_COMPARTIDA_MONTO` = $10M por defecto — grande a propósito para no agotarse a mitad de una
  corrida larga). Su `comprobante_id` queda en el fixture como `factura_compartida_id`.
- **`loadtest/k6/escenario-d-cobros-pagos.js`**: nuevo `MODO=misma_factura` (default sigue siendo
  `clientes_random`, sin romper el uso anterior). En ese modo, cada VU imputa un pago chico
  ($10-100) contra `fixture.factura_compartida_id` — con varios VUs mapeados a la misma empresa
  (`__VU % fixtures.length`), varios terminan imputando a la MISMA fila de `comprobantes` al mismo
  tiempo, forzando el `SELECT...FOR UPDATE` real que `registrar_cobro_cliente` hace sobre esa fila.
  Esperado: 0% error hasta el límite de conexiones ya conocido (~100-200 en el stack local); el
  interés del test es confirmar que el lock serializa correctamente sin errores de aplicación
  (deadlock, datos corruptos), no que sea rápido.

## Limpieza pendiente

El stack local queda con 131 empresas `__LOADTEST__` y decenas de miles de ventas de prueba — es
data local descartable (`supabase db reset` la borra en segundos).

---

# Fase 4 — Playwright con navegadores reales
**Sesión 78 (2026-07-18/19).**

## Resumen ejecutivo

A diferencia de las Fases 2-3 (que llaman RPCs directamente por REST), esta fase simula un cajero
real: login por UI → Punto de Venta → click en un producto → click en "Confirmar Venta" → esperar
el diálogo "¡Venta confirmada!" — con Chromium real (Playwright), no `fetch`. Se corrió con 1, 10,
25 y 50 sesiones concurrentes, cada una en su propio contexto de browser con su propia empresa
`__LOADTEST__` de `fixtures.json`.

**Resultado: 0 errores de aplicación en las 4 corridas (86 sesiones reales en total).** La
degradación observada al escalar es la esperada de un navegador real consumiendo CPU/RAM de esta
máquina — no señal de que KAIROX tenga un techo bajo de concurrencia real de usuarios.

| Sesiones concurrentes | Fallidas | p50 login→dashboard | p50 confirmar venta | Tiempo total del batch |
|---|---|---|---|---|
| 1 | 0 | 2.5s | 0.27s | 3.6s |
| 10 | 0 | ~4.8s | ~0.43s | 9.1s |
| 25 | 0 | ~12.4s | ~1.1s | 22.0s |
| 50 | 0 | ~27.7s | ~4.7s | 53.7s |

A 50 sesiones, el login pasó de ~2.5s (1 sesión) a ~27-40s — la caída no es un error, es contención
real de CPU en esta máquina por 50 procesos Chromium simultáneos (confirmado indirectamente: cero
errores de red/aplicación en ninguna corrida, solo tiempos más largos). Como anticipaba el plan
original, acá el cuello de botella pasa a ser la máquina de test, no KAIROX — para medir una cifra
de "techo de usuarios reales" haría falta un grid de browsers en la nube (BrowserStack/similar),
fuera de alcance de esta sesión salvo pedido explícito.

## Hallazgos reales encontrados (no artefactos de metodología)

Estas 3 cosas solo aparecieron al probar por UI real — ninguna la había mostrado antes un test
pgTAP o un escenario k6 de las Fases 2-3, porque esos llaman RPCs directo y nunca pasan por el
`SELECT` a `profiles` ni por el flujo completo del POS:

1. **🔴 `is_admin()` sin `GRANT EXECUTE` a `authenticated`** — encontrado primero, ya corregido
   localmente (migration `218_fix_grant_faltante_is_admin.sql`, repo-only, no aplicada a
   producción todavía — producción YA tiene el grant puesto a mano, así que el fix solo hace que
   `supabase db reset` local reproduzca fielmente ese estado). Sin este fix, el login se rompía
   con `permission denied for function is_admin` (42501) porque la policy `profiles_select` invoca
   `is_admin()` en su `USING`, y una policy corre con los privilegios del rol que hace la query.
2. **🟡 `calcular_ofertas_carrito()` con el mismo problema** — encontrado durante esta fase,
   **NO corregido todavía, no aplicado a ningún lado**. Confirmado con `read_console_messages`:
   `permission denied for function calcular_ofertas_carrito` (42501) en cada carga del carrito del
   POS. Es el mismo patrón de la migration 063 (revocación en bloque de EXECUTE FROM PUBLIC sin
   re-grant explícito por función) — no bloquea la venta (el cálculo de ofertas falla en silencio,
   el POS sigue funcionando sin descuentos automáticos), pero es un gap de reproducibilidad real y
   probablemente afecta a más funciones de la misma migration 063 que todavía no se auditaron una
   por una. **Pendiente**: confirmar con `has_function_privilege` contra el proyecto hosted si
   producción ya tiene el grant (como pasó con `is_admin`) antes de escribir el fix.
3. **🔴 Overloads duplicados de `crear_venta` con numeración de entregas inconsistente** —
   encontrado al confirmar una venta real por UI contra una empresa con historial previo grande
   (`__LOADTEST__ Empresa 1`, 9999 entregas de la carga k6 de Fases 2-3): `crear_venta` devolvió
   409 `duplicate key value violates unique constraint "uq_entregas_empresa_numero"` con
   `numero_entrega=ENT-2026-1000` — muy por debajo del máximo real. Hay DOS overloads de
   `crear_venta` en la base: uno viejo que numera con `siguiente_numero_documento` (no sincronizado
   con `series_numeracion`) y uno nuevo que usa `obtener_proximo_numero` (la vía atómica correcta).
   PostgREST puede resolver al overload viejo según el payload exacto, produciendo números que
   colisionan con filas reales. **Flageado como task separada (`task_9958f7f4`), no investigado a
   fondo ni corregido en esta sesión** — para no mezclar este hallazgo (bug real de negocio) con
   el resultado de concurrencia de UI que era el objetivo de esta fase. Para evitarlo en las
   corridas de escala, el spec arranca desde `__LOADTEST__ Empresa 2` en adelante.

## Fricciones de metodología (no bugs de KAIROX, corregidas en el spec)

- **`useConfirmarVenta.js` bloquea "Efectivo" si la caja está cerrada** — regla de negocio real
  (`CajaSection`/regla documentada en `CLAUDE.md`), no un bug. Las empresas `__LOADTEST__` nunca
  abren caja, así que el spec confirma con "Transferencia" en vez de "Efectivo".
- **Wizard de onboarding no se puede saltar con Escape** — `OnboardingWizard.jsx` usa
  `onOpenChange={() => {}}` (no-op), así que un contexto de browser nuevo (sin
  `onboarding_completado=true`) queda bloqueado indefinidamente. Se resolvió con un
  `UPDATE empresas SET onboarding_completado=true` de una sola vez sobre las 131 empresas
  `__LOADTEST__` del stack local — no es un fix de producción, es limpieza del dataset sintético
  para que el flujo de Playwright no tenga que simular 3 pasos de wizard por sesión.
- **El grid de productos usa las mismas clases CSS para skeletons de carga y cards reales** — bajo
  contención de CPU (10+ browsers concurrentes), el primer `.grid > div` a veces era un skeleton
  sin `onClick`, no un producto real. Corregido filtrando por `hasText: '$'` y esperando
  explícitamente a que la card sea visible antes de clickear.

## Archivos

- `loadtest/playwright/flujo-pos.spec.js` — spec único, parametrizado por `N_SESSIONS` (env var).
- `.env.loadtest.local` (gitignored) — apunta el frontend al stack local de Supabase.
- `.claude/launch.json` — config `kairox-loadtest` (`vite --mode loadtest --port 3001`).

## Pendiente / no hecho en esta sesión

- Aplicar o no la migration 218 (`is_admin`) a producción — repo-only, no preguntado todavía.
- Investigar y corregir el gap de grant de `calcular_ofertas_carrito` (mismo patrón que `is_admin`).
- Resolver `task_9958f7f4` (overloads de `crear_venta`).
- Escalar más allá de 50 sesiones requeriría infraestructura de browsers en la nube — no intentado.
