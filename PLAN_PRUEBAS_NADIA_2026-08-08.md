# Plan de Pruebas para Nadia — 2026-08-08

Ayer (07/08), mientras estabas afuera, tu propia sesión y la mía trabajamos en paralelo sobre lo
mismo sin darnos cuenta: las dos replicamos la Fase 3 (canjear puntos) al ERP. La tuya encontró
además un bug real de fondo (el asiento contable no repartía el descuento entre los ítems) y lo
arregló ahí mismo — así que al notar la coincidencia, descarté mi versión (tenía ese mismo bug
sin que yo lo hubiera visto) y me quedé con la tuya, que es la que está deployada ahora. Aparte
de eso, encontré y diseñé el fix para el gap de "las ventas por QR MercadoPago no ganan puntos"
que habías documentado. Este plan cubre las 2 cosas.

**URL de producción:** `https://kairox-gestion-chi.vercel.app`.

---

## Bloque 1 — Canjear puntos en el ERP (Nueva Venta), no sólo en el POS

**Qué se hizo:** el mismo circuito de canje que ya usás en el Modo Caja (POS) ahora también está
en la pantalla **Ventas → Nueva Venta** del ERP, con el mismo fix del reparto proporcional entre
ítems que ya se probó en el POS. Vos misma marcaste esto como pendiente de un click-through real
antes de dar la Fase 3 por 100% cerrada — este bloque es exactamente eso.

**Cómo probar:**
1. Elegí un cliente que ya tenga puntos acumulados (por ejemplo Carlos Perez, que según el
   registro tenía 270 pts hace poco).
2. Ventas → **Nueva Venta**. Agregá algún producto al carrito.
3. Elegí ese cliente en el selector de cliente (columna derecha, debajo de la grilla de formas de
   pago).
4. **Resultado esperado:** debería aparecer el bloque "Canjear puntos" (con ícono de regalo)
   junto al selector de cliente, mostrando el saldo disponible y el máximo canjeable.
5. Cargá una cantidad de puntos a canjear (menor al máximo). **Resultado esperado:** justo debajo
   del Total (arriba de todo) aparece un texto chico "Incluye descuento por puntos: -$N", y el
   Total grande se recalcula al instante.
6. Confirmá la venta. **Resultado esperado:** el PDF del comprobante muestra la línea de
   descuento por puntos, y el saldo de puntos del cliente queda descontado (podés verlo de nuevo
   en el selector de cliente, o en el popover "ojo" del cliente).

**Si algo no sale así:** sacá captura y contame — no hace falta que intentes arreglarlo.

---

## Bloque 2 — QR MercadoPago ganando puntos (⚠️ todavía NO está aplicado — leé esto primero)

**Este bloque todavía no se puede probar.** Encontré que las ventas cobradas con QR MercadoPago
no sumaban puntos (usan un circuito de backend distinto al de las ventas normales), diseñé el
arreglo y lo probé a fondo en sandbox contra Nalux (con datos 100% sintéticos, revertido después
sin dejar rastro) — pero **no lo apliqué a producción** porque toca el circuito real de
confirmación de pagos de MercadoPago y no quise tocar eso sin que Luciano esté para confirmar.

**Qué falta antes de este bloque:** que Luciano confirme y se aplique
`supabase/migrations/313_fidelizacion_puntos_qr.sql`. Una vez aplicada (avisamos acá o en
`CONTEXT.md` cuando pase), la prueba sería:
1. Cobrar una venta con **QR MercadoPago** a un cliente con fidelización activa.
2. Esperar a que se confirme el pago (webhook o el poller, como siempre).
3. Verificar que el cliente sumó los puntos correspondientes (mismo cálculo que cualquier otra
   venta: total ÷ pesos-por-punto).

No hace falta que hagas nada con este bloque todavía — queda anotado acá para no perderlo de
vista.

---

## Qué contarme al terminar

Para el Bloque 1: ✅ salió como se esperaba, o ⚠️ algo no coincidió (con captura si podés).

## Cómo seguimos

Con el Bloque 1 cerrado, Fidelización por Puntos queda funcionando en POS y ERP por igual. Sólo
falta el Bloque 2 (QR) una vez que Luciano confirme la migración 313 — después de eso, el feature
completo (investigación → 4 fases → réplica ERP → gap de QR) queda 100% cerrado.
