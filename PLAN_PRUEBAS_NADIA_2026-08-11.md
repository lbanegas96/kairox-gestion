# Plan de Pruebas para Nadia — 2026-08-11

Ayer (10/08) reforzamos el motor de Facturación Electrónica AFIP/ARCA a raíz del incidente de las
7 Facturas C atascadas desde el 06/08 ("estado ambiguo N°35"). El detalle técnico completo está en
`PLAN_ROBUSTEZ_FACTURACION_ARCA.md` — este plan es la versión "para probar con las manos" de eso.

**URL de producción:** `https://kairox-gestion-chi.vercel.app`.

**Antes de empezar:** recordá que ARCA sigue en **homologación** a propósito (todo el sistema
sigue en fase de prueba) — podés facturar sin miedo, no es el ambiente fiscal real todavía.

> Marcá cada caso: ✅ pasó · ⚠️ falló (anotá qué pasó, con captura si podés) · ⬜ no probado

---

## ✅ Resultados — probado por Claude en local (11/08, autorizado por Nadia)

Nadia inició sesión en `localhost:3000` (mismo backend/Supabase que producción) y me pidió
verificar los Bloques 1 y 2 en su lugar. Resultado:

**Bloque 1 — ✅ pasó, con un detalle a pulir.** Abrí el detalle de 20260806-011 ($121.000) en el
Monitor: estado mostrado **"Revisión manual"** (no el texto crudo), motivo correcto y claro
("Se agotaron los 5 reintentos automáticos con backoff — ARCA no respondió o siguió caído en
todos los intentos"), y el toggle **"Ver detalle técnico"** funciona bien en ambos sentidos
(muestra `[10016] El numero o fecha del comprobante no se corresponde...` y vuelve).
⚠️ **Inconsistencia menor encontrada:** el bloque "Último error" sigue mostrando el mensaje humano
fijo del código 10016 — *"...no hace falta que hagas nada todavía"* — que tiene sentido mientras
sigue reintentando, pero queda contradictorio una vez que el comprobante ya pasó a "Revisión
manual / reintentos agotados" (dos frases opuestas, una arriba de la otra, en el mismo panel).
Causa: `mensajeHumano()` en `supabase/functions/_shared/afip.ts` traduce por código de error fijo,
sin variar el texto según si todavía está reintentando o ya se rindió. No rompe nada, es sólo
confuso de leer — queda en el backlog, no se tocó.

Los 3 comprobantes del incidente (20260806-001, -008, -011) terminaron los 5 reintentos sin que
ARCA destrabara el número — están en "Revisión manual" con `motivo_definitivo='reintentos_agotados'`.
No es una falla del fix (ver "Cómo seguimos" más abajo).

**Bloque 2 — ✅ pasó, muy por encima de lo esperado.** Venta de prueba (Lapicera, $2, Efectivo) →
comprobante **20260811-001**. Medido contra la base: encolada a las 14:23:36.05, CAE real
conseguido a las 14:23:37.62 — **1,6 segundos**, contra los ~30 segundos esperados. Numeración
real asignada: `0001-00000040`. Sin errores nuevos en consola (solo el warning preexistente y no
relacionado de `TopClientes.jsx`).

**Bloque 3 — ⬜ no aplica todavía.** Ninguno de los 3 comprobantes tiene un CAE confirmado a mano
en el portal de ARCA — queda pendiente para cuando Nadia/Luciano lo chequeen ahí directamente.

---

## Bloque 1 — Monitor de Facturación AFIP: mensajes humanos y auto-reintento

**Qué se hizo:** antes, cualquier error de ARCA se mostraba en el Monitor con el texto crudo del
web service (código + inglés/XML). Ahora hay un mensaje en español, claro y accionable, con un
toggle para ver el técnico si hace falta. Además, el caso puntual del incidente (3 comprobantes:
20260806-001, -008, -011) que antes requería que alguien los reencolara a mano cada vez, ahora se
reintenta solo.

**Cómo probar:**
1. **Ventas → Monitor de Facturación AFIP** (o donde esté el acceso en el menú).
2. Buscá los comprobantes **20260806-001, 20260806-008 y 20260806-011** (Facturas C, del cliente
   Luciano).
3. ✅ Esperado: estado **"Reintentando"** (no "Error definitivo" ni "Ambiguo" fijo) — si hicieron
   varios ciclos automáticos desde ayer, puede que alguno ya haya resuelto solo (estado
   "Emitida", con CAE) o, si ARCA no se destrabó, puede que ya haya agotado los 5 reintentos y
   esté en **"Error definitivo"**.
4. Abrí el detalle de cualquiera de los 3. ✅ Esperado: el mensaje principal es en español,
   entendible ("El número de comprobante quedó momentáneamente desincronizado con ARCA. El
   sistema lo reintenta e intenta resolverlo solo..."), **no** el texto técnico crudo.
5. Tocá **"Ver detalle técnico"**. ✅ Esperado: cambia a mostrar el código/mensaje original de
   ARCA (`[10016] El numero o fecha...`), con otro botón para volver al mensaje simple.
6. Si alguno de los 3 llegó a **"Error definitivo"**: fijate que ahora hay una etiqueta que
   distingue **por qué** — "Reintentos agotados" (se reintentó 5 veces y no se resolvió) en vez de
   la etiqueta genérica de antes. Si en cambio dice "Ambiguo sin reintento", avisame — sería un
   caso distinto (uno nuevo, no de estos 3) y hay que mirarlo con más atención antes de tocar nada.

**Si algo no sale así:** sacá captura y contame — no hace falta que intentes resolverlo vos.

---

## Bloque 2 — Velocidad: una factura nueva no debería tardar minutos

**Qué se hizo:** antes, una venta recién facturada podía tardar hasta 5 minutos en conseguir CAE
(esperaba al cron). Ahora el sistema despierta al worker apenas se genera la factura — el primer
intento debería verse en segundos.

**Cómo probar:**
1. Hacé una venta cualquiera que facture (Factura A/B/C, monto chico).
2. Andá directo al Monitor de Facturación AFIP y mirala.
3. ✅ Esperado: en menos de ~30 segundos ya debería tener CAE (estado "Emitida") — no hace falta
   esperar los 5 minutos de antes.

**Si tarda más de 1-2 minutos:** no es grave (el cron de siempre sigue como red de seguridad), pero
avisame así lo reviso.

---

## Bloque 3 — "Marcar resuelta" con CAE real (si alguno quedó en Error definitivo)

**Solo si aplica** (si alguno de los 3 comprobantes del Bloque 1 terminó en "Error definitivo" y en
algún momento entrás al portal de ARCA y confirmás a mano que sí tiene CAE):

1. En el Monitor, abrí el comprobante y tocá **"Marcar resuelta"**.
2. ✅ Esperado (nuevo): el diálogo ahora tiene 3 campos opcionales — **CAE**, **Número AFIP** y
   **Vencimiento del CAE**. Antes no existían y el comprobante quedaba "resuelto" sin el CAE legal
   cargado.
3. Completá los 3 (los datos reales que viste en el portal) y confirmá.
4. ✅ Esperado: el comprobante pasa a "Emitida" con esos datos guardados — no solo "marcado como
   resuelto a ciegas".

**Si no hace falta usar este bloque** (los 3 se resolvieron solos): mejor, no hace falta simular
nada — dejalo en ⬜.

---

## Qué contarme al terminar

Para cada bloque: ✅ salió como se esperaba, o ⚠️ algo no coincidió (con captura si podés,
incluyendo el número de comprobante si aplica).

## Cómo seguimos

Con esto, las 3 fases del plan de robustez (`PLAN_ROBUSTEZ_FACTURACION_ARCA.md`) quedan
verificadas por dos personas distintas — yo en el desarrollo, vos en el uso real. Si los 3
comprobantes del incidente original terminan en "Reintentos agotados" sin resolverse solos, no es
una falla del fix (el fix es que ahora fallan de forma clara y sin necesitar reencolado manual
constante) — sería un tema para revisar con más tiempo, sin urgencia dado que seguimos en fase de
prueba.
