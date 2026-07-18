# Fase 1 — Auditoría de seguridad multi-tenant
**Sesión 76-77 (2026-07-18/19).** Parte del plan de sometimiento a estrés (`.claude/plans/fluffy-sauteeing-panda.md`).

## Resumen ejecutivo

Se auditaron **272 policies RLS** y **~30 RPCs `SECURITY DEFINER`** que reciben `p_empresa_id`
(en su forma final, tras resolver todos los `DROP`/`CREATE` acumulados de 217 migrations), y se
corrió un **test activo** (no solo lectura de código) simulando un ataque real de un tenant contra
otro. Resultado: **el aislamiento multi-tenant funciona correctamente**. Se encontraron y
corrigieron **2 hallazgos**, ninguno explotable desde producción hoy.

---

## Qué se probó

1. **Auditoría estática de RLS** — las 272 `CREATE POLICY` de `supabase/migrations/*.sql`,
   resueltas a su estado final por tabla (rastreando cada `DROP POLICY`/`CREATE POLICY` que
   reemplaza a la anterior). Cubre las ~55 tablas con `empresa_id` del sistema.
2. **Auditoría estática de RPCs** — las ~30 funciones `SECURITY DEFINER` que reciben
   `p_empresa_id`, confirmando el guard `IF p_empresa_id IS DISTINCT FROM get_my_empresa_id()`.
3. **Prueba activa** (`supabase/tests/aislamiento_multitenant.test.sql`, pgTAP, 9 casos): 2
   tenants sintéticos (E1/E2), autenticados de verdad (`SET LOCAL ROLE authenticated` + JWT
   simulado — no la conexión superusuario de siempre, que hubiera dado falsos positivos porque
   bypassea RLS). Con la sesión de E1: intenta leer clientes/productos de E2 (RLS SELECT),
   modificarlos con `UPDATE` directo (RLS UPDATE), e impersonar a E2 pasando su `empresa_id` a
   `registrar_cobro_cliente`, `registrar_pago_proveedor` y `crear_venta`.
4. **Advisors de seguridad** (`get_advisors`, solo lectura, contra el proyecto hosted).
5. Todo corrido contra un **stack de Supabase 100% local** (`supabase start`, Docker ya disponible
   en esta máquina) levantado desde cero con las 217 migrations — primera vez que se usa este
   entorno en el proyecto en vez de `execute_sql` contra el hosted dentro de `BEGIN...ROLLBACK`.

## Qué se detectó y qué se reparó

### 🟢 Detectado y reparado: grant de `authenticated` faltante en `crear_venta`

Al levantar el stack local por primera vez, `crear_venta` (firma actual, 20 parámetros) resultó
**no ejecutable por `authenticated`** — el POS habría estado roto en cualquier réplica desde cero
de las migrations. Investigando la causa: la migration `194_revoke_public_execute_rpcs.sql`
(sesión 60) ya había documentado este mismo patrón para 7 funciones — revocó `EXECUTE FROM
PUBLIC`, y su propio comentario dice explícitamente que el grant a `authenticated` "nunca se
escribió en ninguna migration" para 6 de ellas, porque producción ya lo tenía puesto a mano. En
esa sesión solo se re-otorgó `has_module_permission` (por ser el más urgente); las otras 6
quedaron pendientes.

De esas 6, se confirmó contra el stack local que **solo `crear_venta` seguía afectada** — las
otras 5 (`cambiar_estado_cheque`, `regenerar_asiento_cxc`, `regenerar_asiento_cxp`,
`registrar_pago_proveedor`, `reintentar_cae_comprobante`) ya tienen el grant correcto por alguna
migration posterior.

**Reparado**: `supabase/migrations/217_fix_grant_faltante_crear_venta.sql` — agrega el
`GRANT EXECUTE ... TO authenticated` faltante. **Impacto en producción: ninguno** (confirmado con
`has_function_privilege` contra el proyecto hosted real — ya tenía el grant puesto a mano). El
efecto es que ahora un `supabase db reset` local reproduce fielmente el estado de producción,
necesario para que la Fase 2 (infra de carga) pueda confiar en el stack local. Verificado:
`supabase test db` pasa 151/151 tests después del fix.

### 🟢 Confirmado (no requiere cambio): `record_attempt()` sin guard de tenant

La auditoría estática encontró que `record_attempt()` (rate limiting de intentos de login) recibe
`p_empresa_id` sin validarlo contra el caller. Esto ya había sido revisado y aceptado
explícitamente en `migration 120` ("no manejan datos de tenant expuestos... sin impacto
explotable"). La prueba activa confirmó que el riesgo real es **menor** de lo que sugiere leer
sólo el código: un usuario autenticado común **ni siquiera tiene permiso `EXECUTE`** sobre esta
función (solo la llaman otras RPCs internamente) — no hay superficie de ataque desde el frontend.
Y aunque la hubiera, la tabla destino (`rate_limit_attempts`) tiene una policy `deny-all` que
bloquea cualquier `SELECT`, confirmado insertando una fila a mano y verificando que es inalcanzable
para un tenant autenticado. **No se tocó nada** — es el mismo veredicto que ya tenía el equipo,
ahora con evidencia activa en vez de solo lectura de código.

### Advisors de seguridad (hosted, solo lectura)

0 hallazgos `ERROR`, 58 `WARN` (todos genéricos y pre-existentes — funciones `SECURITY DEFINER`
ejecutables por roles autenticados, mitigadas por los guards internos ya auditados), 2 `INFO`
("RLS enabled, no policy" en `afip_tickets` y `arca_worker_run` — ambas tablas internas usadas
solo por Edge Functions con `service_role`, deny-all correcto e intencional). Sin cambios desde la
última corrida (sesión 75).

## Lo que NO se encontró (y se buscó activamente)

- Ninguna policy RLS sin filtro de `empresa_id` en ninguna de las ~55 tablas del sistema,
  incluyendo la reconfirmación de que `movimientos_uala` (el incidente real de sesión previa) sigue
  correctamente aislado.
- Ninguna RPC `SECURITY DEFINER` que confíe en `p_empresa_id` sin validarlo, más allá del caso ya
  conocido y aceptado de `record_attempt`.
- Ningún caso donde E1 pudo leer, modificar, o impersonar a E2 en la prueba activa (7 de 9 casos
  originalmente diseñados para eso pasaron directo; 2 fallaron primero por un defecto del propio
  test —usar la conexión superusuario sin cambiar de rol— y al corregirlo, pasaron igual).

---

## Listado real de lo que falta probar (Fases 2-4 del plan)

Nada de esto se hizo todavía — es el trabajo que sigue, en el orden acordado.

| Fase | Qué falta | Bloqueada por | Estimación de esfuerzo |
|---|---|---|---|
| **2** | Script de siembra sintética (`scripts/loadtest/seed.mjs`), instalar k6, escribir y correr el Escenario A (multi-tenant concurrente, ramp-up 5→500 empresas) | Nada — el stack local ya está probado y funcionando | Alto (nueva infra desde cero) |
| **3** | Escenario B (contención dentro de una empresa — el lock de `series_numeracion`/`stock_actual`), Escenario C (dashboard, 21 round-trips), Escenario D (cobros/pagos con imputación) | Depende de la infra de la Fase 2 | Medio (reusa infra, son 3 scripts de k6 más) |
| **4** | Playwright con navegadores reales, flujo POS completo por UI, 5→50 sesiones concurrentes | Depende de tener usuarios/empresas sembrados (Fase 2) | Medio-alto (herramienta nueva, Playwright) |

**Nota sobre el hallazgo de reproducibilidad**: la Fase 1 confirmó que el stack local (`supabase
start` desde cero) puede divergir del estado real de producción si algún `GRANT`/fix se aplicó
alguna vez a mano contra el hosted sin migration correspondiente (exactamente lo que pasó con
`crear_venta`). Antes de arrancar la Fase 2, conviene un chequeo rápido similar
(`has_function_privilege` para las funciones que el script de siembra va a llamar) para no
descubrir el mismo tipo de sorpresa a mitad de una corrida de carga.
