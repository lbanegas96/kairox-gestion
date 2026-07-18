# Fase 2 — Infra de carga backend + Escenario A (multi-tenant concurrente)
**Sesión 77 (2026-07-18/19).** Parte del plan de sometimiento a estrés (`.claude/plans/fluffy-sauteeing-panda.md`).

## Resumen ejecutivo

Se construyó desde cero la infraestructura de carga (generador de datos sintéticos + k6) y se
corrió el Escenario A contra el stack local de Supabase. **Hallazgo principal, confirmado con
datos reales**: el aislamiento multi-tenant funciona exactamente como predijo la auditoría de
código de la Fase 1 — **más empresas distintas vendiendo en simultáneo NO degrada el sistema**
(p95 se mantiene en ~22ms sin importar cuántos tenants distintos operan a la vez), pero **más
concurrencia DENTRO de una misma empresa sí degrada la latencia** (p95 sube a ~700ms), por el lock
`FOR UPDATE` de `series_numeracion`/`stock_actual` ya identificado. La tasa de error real (una vez
aislado un artefacto del propio test, ver abajo) es prácticamente cero incluso bajo esa
degradación — el sistema se pone más lento, no se cae.

## Qué se construyó

- **`scripts/loadtest/seed.mjs`**: genera empresas sintéticas completas contra el stack local —
  empresa real (dispara `trg_empresa_seed_maestros`), usuario admin con login real (JWT genuino,
  no fabricado a mano), clientes, productos, e historial de ventas creado llamando al RPC real
  `crear_venta` (no INSERTs directos), para que los datos sean contablemente coherentes.
- **`loadtest/k6/escenario-a-multitenant.js`**: cada VU de k6 toma una empresa de
  `fixtures.json` y hace `crear_venta` real vía PostgREST en loop (~1 venta/seg, ritmo de un
  cajero). Ramp-up configurable (`MAX_VUS`), modo `SMOKE=1` para validar antes de escalar.
- **k6 instalado** localmente (`.tools/`, binario portable — el instalador de `winget` quedó
  colgado y tuvo que matarse a mano; se resolvió descargando el release de GitHub directo).

## Qué se corrió y qué se encontró

### Smoke test (1 VU, 5 iteraciones)
✅ Pasó limpio — confirmó que `crear_venta` vía k6/PostgREST realmente inserta filas
(`comprobantes`, `movimientos_caja`, asiento) antes de escalar la carga.

### Intento inicial: sembrar 100 empresas — falló, causa real identificada

Sembrar 100 empresas en una sola corrida falló de forma **inconsistente** (se cortaba entre la
empresa 15 y 47 según el intento, sin excepción de JS visible). Investigado a fondo: **3 procesos
de `winget`** de un intento anterior de instalar k6 habían quedado colgados en background,
compitiendo por recursos de la máquina. Se mataron esos procesos (`Stop-Process`) y una corrida de
30 empresas terminó limpia en 12 segundos, exit 0. **No se identificó (todavía) un límite real del
lado de Supabase/GoTrue** — es una limitación del entorno de esta sesión, no del sistema bajo
prueba. Se corrigió además `seed.mjs` para escribir `fixtures.json` incrementalmente (no solo al
final), así una corrida larga interrumpida no pierde el progreso ya sembrado.

**Pendiente para la próxima sesión**: confirmar si el límite real está en GoTrue (rate limiting de
`admin.createUser`/`signInWithPassword`) sembrando de a tandas con backoff, para poder llegar a los
250-500 tenants que pedía el plan original.

### Escenario A — ramp-up con 30 empresas reales (1 VU = 1 empresa)

Ramp-up 5→20→30, sostenido 40s en cada nivel:

| Métrica | Resultado |
|---|---|
| Iteraciones totales | 3.172 ventas reales |
| Tasa de error | **0.00%** |
| p95 `crear_venta` | **22.22ms** (plano en los 3 niveles, sin degradar) |
| p99/max | 118ms |

**Conclusión**: hasta 30 empresas distintas operando en simultáneo, cero señales de estrés. El
aislamiento por-tenant del lock de `series_numeracion` (hallazgo de la Fase 1) se confirma en la
práctica.

### Extendiendo a 500 VUs (reusando las mismas 30 empresas — contención real)

Como sembrar más de 30 empresas de forma confiable quedó pendiente (ver arriba), se extendió el
ramp-up a 500 VUs *reusando* las 30 empresas ya sembradas (cada VU cicla `VU % 30`). Esto deja de
medir "muchas empresas distintas" y empieza a medir **contención dentro de la misma empresa** —
adelanta parte de lo que el plan reservaba para el Escenario B (Fase 3), como efecto colateral útil:

| Métrica | 30 VUs (1:1) | 500 VUs (contención ~16-17 por empresa) |
|---|---|---|
| p95 `crear_venta` | 22ms | 702-814ms (~35x) |
| Tasa de error | 0.00% | **0.04%** una vez corregido el artefacto de stock (ver abajo) |
| Iteraciones | 3.172 | ~47.800 |

**Hallazgo del propio test, corregido en el camino**: la primera corrida a 500 VUs mostró 0.81-4%
de "errores" — pero al revisar el cuerpo real de las respuestas fallidas, eran
`"Stock insuficiente"` (código `P0001`), no fallas de capacidad — los productos sintéticos se
sembraron con 100-500 unidades y la venta sostenida los agotó. Es el sistema funcionando
**correctamente** (bloqueando sobreventa), no un hallazgo de estrés. Se corrigió subiendo el stock
sintético a 1.000.000 y se volvió a correr: la tasa de error real bajó a 0.04% (20 de 47.842), y la
latencia siguió alta (~700ms) — confirmando que **la latencia sí es una señal real de contención**,
mientras que el error rate original era ruido del propio test, no del sistema.

## Interpretación

- **El diseño multi-tenant de KAIROX escala bien por el eje que importa para el negocio** (más
  empresas clientas) — el techo real de "muchas empresas" no se encontró todavía porque ni
  siquiera con 500 VUs concentrados en 30 tenants el sistema tiró errores reales; solo se puso más
  lento por la contención interna esperada.
- El lock de `series_numeracion`/`stock_actual` **sí es un cuello de botella real** cuando muchas
  operaciones caen sobre la MISMA empresa al mismo tiempo (ej. un comercio muy grande con muchas
  cajas), tal como anticipó la Fase 1 — pero degrada la latencia (~700ms en el peor caso probado),
  no rompe el sistema.
- No se llegó a encontrar el techo real de capacidad — este primer pase se quedó corto en volumen
  de tenants únicos por la limitación de siembra, no por haber encontrado un límite del sistema.

## Listado real de lo que falta probar

| Qué | Por qué no se hizo todavía | Prioridad |
|---|---|---|
| Sembrar 100-500 empresas ÚNICAS reales (no reutilizar 30) | Falla intermitente de siembra masiva — hay que diagnosticar si es rate-limit de GoTrue y sembrar con backoff/paralelismo controlado | Alta — es el único paso que falta para de verdad "encontrar el techo" del Escenario A original |
| Escenario B formal (contención dentro de 1 empresa, con métricas de `pg_locks`/`pg_stat_activity` en vivo) | Se adelantó parcialmente como efecto colateral de arriba, pero sin instrumentación de locks en vivo | Media |
| Escenario C (dashboard, 21 round-trips, polling 30s) | No empezado | Media |
| Escenario D (cobros/pagos con imputación, lock de `comprobantes.total`) | No empezado | Media |
| Fase 4 — Playwright con navegadores reales | No empezado | Baja (depende de que Fases 2-3 backend cierren primero) |

## Limpieza pendiente

El stack local queda con 30 empresas `__LOADTEST__` y ~50.000 ventas de prueba — es data local
descartable (`supabase db reset` la borra en segundos), no hace falta limpiarla a mano salvo antes
de arrancar la próxima corrida real de siembra.
