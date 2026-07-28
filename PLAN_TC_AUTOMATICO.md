# Plan de desarrollo — Tipo de cambio diario automático

**Estado:** ✅ **CONSTRUIDO Y EN PRODUCCIÓN** (2026-07-28). Fases A, B, C y D completas.
**Origen:** conversación 2026-07-25 con Luciano — confirmó la dirección, pidió el plan completo antes de construir nada.

---

## ✅ Qué quedó construido (2026-07-28, Nadia)

| Fase | Entregable | Estado |
|------|-----------|--------|
| A | Migración `260_tc_automatico.sql` (`empresas.tc_automatico`, `tipos_cambio.origen`) | ✅ Aplicada a producción |
| A | Edge Function `tc-diario-sync` | ✅ Deployada, v1 ACTIVE |
| B | Cron `tc-diario-sync-8am-ar` (`0 11 * * *`), migración `261_pg_cron_tc_diario_sync.sql` | ✅ Registrado, jobid 10 |
| C | Sub-toggle en Configuración → Finanzas (`TabFinanzas.jsx`) | ✅ |
| D | Piloto: activado para Nalux | ✅ |

**Decisión de la sección 3 resuelta:** la cotización es el **dólar OFICIAL vendedor**
(`GET https://dolarapi.com/v1/dolares/oficial`, campo `venta`) — confirmado por Nadia el
2026-07-28. El texto del `TipoCambioModal` que sugería "dólar blue vendedor" quedó
desactualizado respecto de esta decisión.

**Dos cosas que se agregaron más allá del plan original:**
1. **Nunca pisar un TC manual.** Si alguien cargó el TC a mano hoy (`origen='manual'`), el
   cron lo respeta y no lo sobrescribe — esa decisión humana gana. Solo refresca filas que
   escribió la propia función. Verificado en vivo.
2. **El cron corre todos los días, fines de semana incluidos.** El caso borde de la sección 5
   se resolvió así: el gate busca un TC con `fecha = hoy`, de modo que si sábado y domingo no
   se escribiera fila, toda operación de fin de semana quedaría bloqueada. Con el mercado
   cerrado dolarapi devuelve la cotización del viernes, que además es el tratamiento
   financiero correcto (valuar al cierre del último día hábil).

**Hallazgo grave encontrado durante la construcción, corregido en la misma sesión:** el "gate
estricto" que la sección 2 daba por sentado **solo existía en el POS**. `CajaSection`,
`CompraRapidaSection`, `NuevaFacturaProveedorModal` y `CuentaCorrienteSection` no bloqueaban:
guardaban `monto_paralelo = NULL` en silencio. Resultado real medido en Nalux: **0% de
cobertura** sobre 144 comprobantes, 16 compras y 162 movimientos de caja. Ver CONTEXT.md,
sesión 2026-07-28.

---

## 1. Problema que resuelve

Hoy, cuando una empresa activa "Moneda Paralela" (`empresas.usa_tc_paralelo`), el sistema exige que alguien cargue el tipo de cambio (TC) del día a mano (`TipoCambioModal`) antes de poder cerrar la primera operación — venta, compra, cotización u orden de compra — de esa jornada. Si nadie lo carga, esas operaciones quedan **bloqueadas** (correcto y deseado, ver sección 3), pero en la práctica esto generó huecos reales: hay registros históricos sin TC porque nadie lo cargó ese día.

La automatización no reemplaza el control — lo hace innecesario la mayoría de los días, cargando el TC solo automáticamente antes de que alguien lo necesite.

## 2. Decisiones ya tomadas (confirmadas por Luciano, no rediscutir)

1. **Opt-in por empresa.** Cada empresa con moneda paralela activa elige, en Configuración, si quiere cargar el TC **a mano** (como hoy) o **automático**. Ninguna empresa existente cambia de comportamiento sin que alguien prenda el toggle.
2. **El gate estricto NO se toca.** Si `usa_tc_paralelo=true` y no hay TC de hoy, ninguna transacción se cierra — sin excepciones, automatización incluida. Si el job automático falla, el sistema cae al mismo cartel manual de siempre. Nunca se inventa ni se reutiliza un TC viejo silenciosamente.

## 3. Por qué NO scrapear la web de BNA

BNA no publica una API oficial — solo una página HTML (`bna.com.ar/Cotizador`). Los proyectos que la scrapean (ej. `dantebarba/cotizacion-bna` en GitHub) avisan ellos mismos que "puede no funcionar adecuadamente" si el banco cambia el diseño de la página — es una fuente frágil y no oficial.

**Fuente elegida: [dolarapi.com](https://dolarapi.com)** — API gratuita, documentada, sin API key, mantenida activamente, con endpoint dedicado al dólar oficial (`GET https://dolarapi.com/v1/dolares/oficial`, respuesta `{ compra, venta, casa, nombre, moneda, fechaActualizacion }`). Es la fuente más cercana al valor de mostrador de BNA sin depender de scraping.

**Pendiente de confirmar antes de construir:** verificar contra el TC que hoy carga Luciano a mano un par de días, para confirmar que el valor de dolarapi.com (`venta`) coincide con el criterio que la empresa usa hoy (el modal actual sugiere "tipo de cambio vendedor del día, ej. dólar blue vendedor" — hay que decidir si dolarapi's "oficial" es el criterio correcto o si hace falta otro endpoint/fuente para el dólar blue específicamente).

## 4. Arquitectura

```
Cron diario (08:00 AR)
        │
        ▼
Edge Function "tc-diario-sync"
        │
        ├──► GET dolarapi.com (cotización del día)
        │
        └──► UPSERT tipos_cambio (por cada empresa con auto activado)
                    │
                    ▼
        Módulos operativos (Venta, Compra, Cotización, OC)
        ya encuentran el TC cargado — el gate no se activa

Si dolarapi falla → no rompe nada → cae al banner manual existente
```

### 4.1 Migración de base de datos

```sql
-- empresas: opt-in por empresa, default false (nadie cambia sin elegirlo)
ALTER TABLE public.empresas
  ADD COLUMN tc_automatico boolean NOT NULL DEFAULT false;

-- tipos_cambio: trazabilidad de origen — útil si alguna vez hay que auditar
-- por qué se usó tal tasa un día puntual.
ALTER TABLE public.tipos_cambio
  ADD COLUMN origen text NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('manual', 'automatico'));
```

`tipoCambioService.upsert` (ya existe, usado por `TipoCambioModal`) sigue escribiendo `origen='manual'` sin cambios — es 100% backward-compatible.

### 4.2 Edge Function `tc-diario-sync` (Deno, mismo patrón que `mp-webhook`/`arca-worker`)

Pseudocódigo:

```ts
// 1. Traer todas las empresas con usa_tc_paralelo=true AND tc_automatico=true
const empresas = await supabase.from('empresas')
  .select('id, moneda_paralela')
  .eq('usa_tc_paralelo', true)
  .eq('tc_automatico', true);

// 2. Traer la cotización UNA sola vez (no una vez por empresa)
//    — hoy solo USD vía dolarapi.com; EUR/BRL quedan fuera de la v1
//    (dolarapi no las cubre igual de bien, revisar antes de extender).
const cotizacion = await fetch('https://dolarapi.com/v1/dolares/oficial').then(r => r.json());

// 3. Por cada empresa, upsert individual con try/catch — un error en una
//    empresa no debe frenar el resto del batch.
for (const empresa of empresas) {
  if (empresa.moneda_paralela !== 'USD') continue; // fuera de alcance v1
  try {
    await supabase.from('tipos_cambio').upsert({
      empresa_id: empresa.id,
      moneda: 'USD',
      fecha: hoyAR(),
      tasa: cotizacion.venta,
      origen: 'automatico',
    }, { onConflict: 'empresa_id,moneda,fecha' });
  } catch (e) {
    console.error(`[tc-diario-sync] Falló empresa ${empresa.id}:`, e.message);
    // seguir con la próxima empresa, no relanzar
  }
}
```

### 4.3 Cron

Supabase soporta `pg_cron` + `pg_net` para llamar una Edge Function por HTTP desde el propio Postgres. Config aproximada:

```sql
SELECT cron.schedule(
  'tc-diario-sync',
  '0 11 * * *', -- 11:00 UTC = 08:00 AR (Argentina no tiene horario de verano desde 2009, offset fijo)
  $$ SELECT net.http_post(
       url := 'https://<project>.supabase.co/functions/v1/tc-diario-sync',
       headers := '{"Authorization": "Bearer <service_role_key>"}'::jsonb
     ); $$
);
```

### 4.4 UI — Configuración → Finanzas

Al lado del toggle existente "Usar Moneda Paralela", un sub-toggle (solo visible/habilitado si el primero está prendido):

> ☐ Actualizar automáticamente todos los días (fuente: dolarapi.com)
> Si lo apagás, seguís cargando el TC vos mismo como hoy.

Default: **apagado** para toda empresa nueva y existente — nadie pasa a automático sin elegirlo explícitamente.

## 5. Casos borde a resolver durante la construcción (no ahora)

- **Fin de semana / feriado:** el mercado cambiario no opera, dolarapi puede devolver el mismo valor del último día hábil. Decidir si el cron simplemente no corre sábados/domingos (dejando vigente el TC del viernes, que es lo que pasaría hoy si nadie carga nada) o si igual escribe una fila idéntica cada día.
- **Multi-moneda:** v1 solo cubre USD. Si una empresa tiene `moneda_paralela` distinta, no se le ofrece el toggle automático (o se le muestra deshabilitado con una nota) hasta verificar soporte de esa moneda en dolarapi.com.
- **Caída de dolarapi.com:** el try/catch por empresa asegura que un fallo de red no frena el batch ni bloquea nada — simplemente esa empresa no recibe el TC de hoy y ve el banner manual de siempre, sin degradar el resto de las empresas.

## 6. Fases de implementación sugeridas (para cuando se decida construir)

1. **Fase A** — migración (columnas nuevas) + Edge Function, invocada a mano (sin cron) para probar contra 1 empresa real con `BEGIN...ROLLBACK` primero, después aplicar de verdad.
2. **Fase B** — cron job + verificación de que corre sola un par de días antes de ofrecerla a nadie.
3. **Fase C** — UI del toggle en Configuración.
4. **Fase D** — rollout piloto: activar primero para una sola empresa (¿Nalux?) antes de habilitar el toggle para todas.

## 7. Testing antes de aplicar a producción

- `BEGIN...ROLLBACK` contra Supabase real para la migración, mismo patrón ya usado toda la sesión.
- Probar la Edge Function manualmente contra dolarapi.com real (no mockeada) antes de cronearla, comparando el valor devuelto contra el TC que Luciano cargaría a mano ese mismo día.
