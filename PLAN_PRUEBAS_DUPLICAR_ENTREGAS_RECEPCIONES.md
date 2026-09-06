# Plan de Pruebas — Duplicar Entregas/Recepciones + Nueva Recepción manual

**Fecha de build:** 06/09/2026
**Para probar durante la semana:** Luciano / Nadia, contra producción real (Nalux)
**Alcance:** resuelve el pendiente del 14/08 — "falta resolver... una Entrega, volvería a
descontar stock". Migración 392 ya aplicada en producción, commit `b6122a4` pusheado y
deployado en `kairox-gestion-chi.vercel.app`.

---

## Qué cambió (para tener en mente mientras se prueba)

- **Duplicar SÍ vuelve a mover stock real** — a propósito. Es un nuevo evento físico (otro
  envío, otra recepción), igual que "Copiar A" en SAP B1. Si duplicás una Entrega de 3
  unidades, el stock baja 3 unidades DE NUEVO (no es un clon inerte).
- **Recepciones ahora tiene creación manual standalone** (antes no existía — solo nacía de
  confirmar una OC o de Compra Rápida). Nuevo botón "+ Nueva Recepción".
- **Devoluciones NO tiene "Duplicar"** — decisión a propósito, no es un olvido (ver sección
  "Qué NO se construyó" más abajo).

---

## 1. Entregas — "Duplicar" desde el detalle

- [ ] Abrir cualquier Entrega ya entregada → botón **"Duplicar"** (al lado de "Anular", en
  el pie del modal).
- [ ] Confirmar con el checkbox **"Vincular con el original en el Mapa de Relaciones"**
  marcado (por defecto) → se abre "Nueva Entrega" precargada con el mismo cliente e ítems,
  **fecha de hoy** (no la del original).
- [ ] Guardar → verificar:
  - Nueva Entrega aparece en el listado con numeración propia (`ENT-2026-0XXX` siguiente).
  - El **stock del producto bajó** en la cantidad duplicada (sumado a lo que ya había bajado
    el original).
  - Desde el **Mapa de Relaciones** de la entrega duplicada, aparece "Duplicado de
    ENT-2026-XXXX" (el original) con link para navegar.
  - Desde el Mapa de Relaciones del **original**, aparece "Duplicado en ENT-2026-YYYY".
- [ ] Repetir duplicando pero con el checkbox **desmarcado** → la nueva Entrega se crea
  igual (mismo stock, mismo cliente/ítems) pero **sin** aparecer vinculada en ningún Mapa de
  Relaciones (ni del original ni de la nueva).
- [ ] Caso borde: duplicar una Entrega cuyo producto **ya no tiene stock suficiente** →
  debe bloquear con el mismo mensaje de "Stock insuficiente" que ya usa "Nueva Entrega".
- [ ] Caso borde: duplicar una Entrega **anulada** → debe permitirlo igual (tiene sentido:
  "la original se anuló, quiero repetirla bien").

## 2. Recepciones — "Nueva Recepción" manual (feature nueva, no solo Duplicar)

- [ ] Ir a Compras → Recepciones → botón **"+ Nueva Recepción"** (nuevo, antes no existía).
- [ ] Crear una recepción **sin proveedor** (dejar "Sin proveedor") con 1 producto real →
  guardar → verificar que el **stock subió** la cantidad indicada y que aparece en el
  listado con origen "Manual (OC)" (mismo label que usa hoy cualquier recepción manual,
  aunque esta no tenga OC — revisar si el label queda confuso, ver sección de hallazgos).
- [ ] Repetir eligiendo un **proveedor real** del combo.
- [ ] Verificar que esta Recepción manual **no** aparece asociada a ninguna OC ni Compra en
  las columnas "OC"/"Compra" del listado (guion "—" en ambas).

## 3. Recepciones — "Duplicar"

- [ ] En el listado de Recepciones, click en el ícono **Duplicar** (al lado del ícono de
  Mapa de Relaciones) de cualquier fila.
- [ ] Confirmar → se abre "Nueva Recepción" precargada con el mismo proveedor e ítems.
- [ ] Guardar → verificar que el **stock subió de nuevo** (sumado, no reemplazado) y que el
  Mapa de Relaciones muestra el vínculo "Duplicado de.../Duplicado en..." en ambos sentidos,
  igual que Entregas.
- [ ] Duplicar una Recepción que **sí** nació de una OC (origen "Manual (OC)" con número de
  OC real) → el duplicado debe salir **sin** OC asociada (es una recepción standalone nueva,
  no debe inventar un vínculo a la OC del original).

## 4. Regresión — que nada de lo que ya andaba se haya roto

- [ ] "Nueva Entrega" (sin duplicar, desde cero) sigue funcionando igual que antes.
- [ ] Generar una Recepción real desde una Orden de Compra (flujo de siempre, `crear_recepcion`)
  sigue funcionando sin cambios — esta migración no tocó esa función.
- [ ] Compra Rápida sigue generando su recepción implícita sin cambios.
- [ ] "Anular Entrega" sigue funcionando (no se tocó esa RPC, pero confirmar que el botón
  nuevo de "Duplicar" no le robó espacio ni rompió el layout del pie del modal).

## 5. Devoluciones — confirmar que la decisión de no tocar nada fue la correcta

- [ ] Nada nuevo para probar acá — es a propósito. Si en algún momento surge un caso real
  donde "duplicar una devolución" haría falta, avisar para re-evaluar (la decisión de esta
  semana fue que abrir una devolución nueva contra el mismo origen ya alcanza).

---

## Hallazgos a confirmar mientras se prueba (no bloqueantes, quedaron anotados)

- El label "Manual (OC)" en el filtro/badge de Recepciones ahora agrupa dos cosas distintas:
  una recepción generada desde una OC real, y una recepción manual standalone sin ninguna
  OC. Si al usar la feature se nota confuso, es un ajuste de UI chico (separar el label),
  no algo estructural.
- Ninguna migración de datos históricos — `duplicado_de_id` queda `NULL` en todo lo ya
  existente (correcto: nada de lo viejo es "un duplicado de algo").

---

## Verificación técnica ya hecha (no hace falta repetir)

- `BEGIN...ROLLBACK` contra datos reales de Nalux: 2 recepciones (+3 c/u) → 2 entregas
  (-2 c/u) → stock cuadra exacto, ambos duplicados vinculados correctamente, guard de
  producto inexistente lanza la excepción esperada.
- Supabase Advisors post-deploy: `crear_entrega_manual`/`crear_recepcion_manual` solo
  ejecutables por `authenticated`, sin exposición a `anon`.
- Verificado en vivo en el navegador (producción real): los 2 flujos de Duplicar (Entregas y
  Recepciones) y "Nueva Recepción" manual, prefill correcto, sin errores de consola.
