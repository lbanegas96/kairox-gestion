# Plan de migración a otra cuenta / proyecto de Supabase

**Contexto:** plan de contingencia por si NO llegamos a pagar el plan Pro y hay que mover
KAIROX (proyecto `wuznppxeonmhfcvnqfbf`, org NALUX) a un proyecto nuevo en otra cuenta antes
de que expire el período de gracia (**17 de agosto de 2026**), momento en que se aplican
restricciones (respuestas HTTP 402) por superar la cuota del plan Gratuito.

> **Aclaración importante primero:** lo que reventó la cuota fue **egress** (6.4 GB de salida),
> no el tamaño de la base (0.11 / 0.5 GB, sobrado). El egress ya se corrigió en código
> (ConfigContext dejó de re-traer el logo base64 en cada montaje — ver `loadtest/REPORTE.md` y
> el commit del fix de logo). **Con ese fix, es muy probable que ya NO se supere la cuota del
> plan Gratuito** y esta migración no haga falta. Este documento es el plan B por si igual se
> decide mover, o si el consumo real de los clientes crece más allá del Free.

---

## Decisión previa: ¿migrar o pagar?

| Opción | Costo | Esfuerzo | Riesgo |
|---|---|---|---|
| **Pagar Pro** (recomendado si el negocio ya factura) | ~USD 25/mes | Cero — un clic | Cero downtime |
| **Migrar a proyecto nuevo (misma u otra cuenta)** | USD 0 (sigue en Free) | Alto — este plan | Downtime + riesgo de perder datos si se hace mal |

Migrar a otro proyecto Free **no resuelve el problema de fondo** si el egress/uso real supera
el Free — solo mueve el problema de lugar y reinicia el contador de cuota. Solo tiene sentido
como puente temporal mientras se resuelve el pago, o si el fix de egress ya dejó el uso
cómodamente dentro del Free y solo se quiere "resetear" el ciclo.

---

## Qué hay que migrar (inventario completo del proyecto)

KAIROX no es solo la base de datos. Un proyecto Supabase tiene 6 superficies con estado, y
**omitir cualquiera rompe la app en producción**:

| # | Superficie | Dónde vive | Cómo se migra |
|---|---|---|---|
| 1 | **Schema + datos** (tablas, RLS, funciones, triggers, tipos) | Postgres | `pg_dump` / `supabase db dump` + restore |
| 2 | **Migrations aplicadas** | `supabase_migrations.schema_migrations` | Se recrean al aplicar `supabase/migrations/` |
| 3 | **Usuarios de Auth** | schema `auth` (`auth.users`, `auth.identities`) | Dump selectivo del schema `auth` — **crítico y delicado** |
| 4 | **Edge Functions** | Deno, deploy aparte del repo | `supabase functions deploy` (código está en `supabase/functions/`) |
| 5 | **Secrets / Vault** | `vault.secrets` + secrets de Edge Functions | **NO se dumpean por seguridad — se recargan a mano** |
| 6 | **Cron jobs (pg_cron)** | `cron.job` | Se recrean con las migrations que los definen |
| 7 | **Config del proyecto** | Panel (Auth providers, SMTP, URLs permitidas, storage buckets) | Manual, panel por panel |

### Lo que NO se puede exportar y hay que rehacer a mano (⚠️ crítico)
- **Access tokens / secrets de integraciones**: token de MercadoPago (está encriptado en Vault,
  migration 205), certificados AFIP/ARCA, `WEBHOOK_SECRET`. Estos **no salen en ningún dump** —
  hay que volver a cargarlos en el proyecto nuevo desde las fuentes originales.
- **Secrets de las Edge Functions** (`arca-worker`, etc.): se setean con
  `supabase secrets set` — no viajan con el código.
- **URLs de webhook** configuradas en paneles externos (MercadoPago, AFIP) — apuntan al
  `project-ref` viejo y hay que reapuntarlas al nuevo.

---

## Procedimiento paso a paso

### Fase 0 — Preparación (sin downtime, se hace con calma antes)
1. **Crear el proyecto nuevo** en la cuenta destino. Anotar el nuevo `project-ref`, la
   `anon key`, la `service_role key` y la connection string.
2. **Confirmar versión de Postgres**: el proyecto nuevo debe ser **≥** la versión del viejo
   (idealmente la misma) para que el restore no falle.
3. **Repo al día**: confirmar que `supabase/migrations/` está 100% sincronizado con producción
   (esta sesión cerró los últimos gaps: migrations 217/218/219 de grants faltantes). Verificar
   con `supabase db diff` contra el proyecto viejo — no debe haber diferencias sin migrar.

### Fase 1 — Dump del proyecto viejo (solo lectura, sin downtime)
```bash
# Schema completo (estructura). Referencia — el repo ya tiene esto en supabase/migrations/.
supabase db dump --db-url "postgresql://...VIEJO..." -f dump_schema.sql

# Datos (sin schema). --data-only para no chocar con el schema recreado por migrations.
supabase db dump --db-url "postgresql://...VIEJO..." --data-only -f dump_data.sql

# Usuarios de Auth: dump selectivo del schema auth (users + identities).
# OJO: NO incluir auth.schema_migrations del proyecto viejo.
pg_dump "postgresql://...VIEJO..." \
  --data-only --schema=auth \
  --table=auth.users --table=auth.identities \
  -f dump_auth.sql

# Storage (si hay buckets con archivos): listar y bajar objetos con la Storage API o el CLI.
# Hoy KAIROX casi no usa Storage (el logo está en la DB como base64 — ver nota final).
```

### Fase 2 — Restore al proyecto nuevo
1. **Aplicar migrations** (recrea todo el schema, RLS, funciones, triggers, cron jobs):
   ```bash
   supabase link --project-ref NUEVO_REF
   supabase db push        # aplica supabase/migrations/ en orden
   ```
2. **Restaurar usuarios de Auth** (`dump_auth.sql`) ANTES que los datos — porque muchas tablas
   tienen FK a `auth.users(id)` vía `profiles`. Verificar que los `id` (UUID) se preserven
   idénticos: toda la data de negocio referencia esos UUIDs.
3. **Restaurar datos de negocio** (`dump_data.sql`). Si hay conflictos de FK, revisar orden de
   inserción (las tablas ledger tienen `NO DELETE` y triggers — puede requerir desactivar
   triggers temporalmente durante el restore: `SET session_replication_role = replica;`).
4. **Recargar secrets a mano** (lo que no viaja en el dump):
   - Token MercadoPago → re-encriptar en Vault (mismo flujo que migration 205).
   - Certificados/credenciales AFIP-ARCA.
   - `supabase secrets set` para las Edge Functions.

### Fase 3 — Edge Functions + Cron
```bash
supabase functions deploy arca-worker --project-ref NUEVO_REF
# ...repetir para cada función en supabase/functions/
```
Verificar que los cron jobs de `pg_cron` quedaron creados (los definen las migrations 102, etc.)
y que apuntan a la URL del proyecto NUEVO, no al viejo.

### Fase 4 — Cutover del frontend (acá SÍ hay downtime, minutos)
1. Actualizar en **Vercel** las env vars: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` al
   proyecto nuevo. (Recordar: el auto-deploy de Vercel está roto — usar
   `npx vercel deploy --prod --yes`, ver memoria del proyecto.)
2. Redeploy del frontend.
3. Reapuntar webhooks externos (MercadoPago, AFIP) al nuevo `project-ref`.

### Fase 5 — Verificación post-migración
- Login real de un usuario existente (confirma que el dump de Auth preservó contraseñas/tokens).
- Crear una venta de prueba por UI (confirma RLS + funciones + triggers + numeración).
- Confirmar que el `arca-worker` corre (cron) y que MercadoPago sincroniza.
- Correr los tests pgTAP (`supabase/tests/`) contra el proyecto nuevo.
- Revisar `get_advisors(security)` en el proyecto nuevo.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Perder usuarios de Auth (no pueden loguear) | Dump selectivo de `auth.users`+`auth.identities` preservando UUIDs; probar login antes del cutover |
| FKs rotas en el restore de datos | Restaurar Auth→profiles→resto en orden; `session_replication_role=replica` durante el load |
| Secrets olvidados (MP/AFIP dejan de andar) | Checklist explícito de Fase 2.4 — son los que NO viajan en el dump |
| Webhooks apuntando al proyecto viejo | Reapuntar en Fase 4.3; el proyecto viejo debe seguir vivo hasta confirmar |
| Downtime largo | Hacer Fases 0-3 con el proyecto viejo EN VIVO; el cutover (Fase 4) es lo único con downtime |
| Volver atrás si algo falla | No borrar el proyecto viejo hasta 1-2 semanas después de verificar el nuevo |

---

## Recomendación

1. **Primera opción: pagar Pro.** Si KAIROX ya tiene clientes reales facturando, USD 25/mes es
   menor que el riesgo y las horas de esta migración. Además el fix de egress ya hecho
   probablemente mantenga el uso dentro de límites razonables.
2. **Si no se puede pagar ahora:** monitorear el egress del ciclo actual **con el fix ya
   desplegado** (dashboard de Uso de Supabase). Si con el fix el egress baja de 5GB, no hace
   falta migrar — el ciclo se resetea solo el 25 de cada mes.
3. **Migrar solo como último recurso**, y con el proyecto viejo intacto como respaldo hasta
   confirmar que el nuevo funciona 100%.

---

## Mejora estructural pendiente (reduce egress y tamaño a futuro)

El logo de la empresa se guarda como **base64 (~960KB) dentro de una columna de Postgres**.
El fix de egress de la sesión 78 evitó que se re-traiga en cada montaje, pero la mejora de
fondo sería **moverlo a Supabase Storage** (servido por CDN, no cuenta como egress de la DB ni
como filas grandes). No es urgente con el fix ya aplicado, pero es la solución arquitectónica
correcta si en el futuro se cargan logos por empresa a escala. Quedó documentado acá como
follow-up, no bloquea la migración.
