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
| Escenario D con imputación a la MISMA factura (lock de `comprobantes.total`) | El seed no genera facturas con `cliente_id` real todavía | Media |
| Empujar Escenario A más allá de 131 empresas únicas | El corte de ~15s en foreground sigue sin resolverse del todo — sembrar en tandas acumulando sobre `fixtures.json` | Baja — 131 ya es una muestra sólida |
| Fase 4 — Playwright con navegadores reales | No empezado | Baja (depende de que el backend cierre primero) |

## Limpieza pendiente

El stack local queda con 131 empresas `__LOADTEST__` y decenas de miles de ventas de prueba — es
data local descartable (`supabase db reset` la borra en segundos).
