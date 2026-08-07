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

## Bloque 2 — QR MercadoPago ganando puntos (✅ ya aplicado, listo para probar)

**Qué se hizo:** las ventas cobradas con QR MercadoPago no sumaban puntos (usan un circuito de
backend distinto al de las ventas normales). Lo probé a fondo en sandbox contra Nalux (con datos
100% sintéticos, revertido después sin dejar rastro), y **Luciano ya confirmó y se aplicó a
producción** (`supabase/migrations/313_fidelizacion_puntos_qr.sql`) — verificado después de
aplicar: la función tiene el fix, sólo `service_role` puede ejecutarla, sin alertas de seguridad
nuevas.

**Cómo probar (con un pago real, no hay forma de simular el webhook de MP):**
1. Cobrar una venta con **QR MercadoPago** a un cliente con fidelización activa.
2. Esperar a que se confirme el pago (webhook o el poller `mp-qr-poller`, como siempre — hasta
   ~60-70s).
3. **Resultado esperado:** el cliente suma los puntos correspondientes (total ÷ pesos-por-punto,
   redondeado hacia abajo) — podés verificarlo en el popover "ojo" del cliente (Saldo de Puntos)
   o pidiéndome que lo cruce contra `movimientos_puntos`.

**Si algo no sale así:** sacá captura y contame, con el número de venta/comprobante.

---

## Qué contarme al terminar

Para cada bloque: ✅ salió como se esperaba, o ⚠️ algo no coincidió (con captura si podés).

## Cómo seguimos

Con los 2 bloques cerrados, Fidelización por Puntos queda 100% cerrada de punta a punta:
investigación → 4 fases (backend, configuración, ganar, canjear) → réplica al ERP → gap de QR
resuelto. Ya no queda nada pendiente de este feature.
