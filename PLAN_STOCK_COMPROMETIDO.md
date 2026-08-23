# Plan: Estados de Inventario (Libre / Comprometido / Pedido) — estilo SAP B1

**Estado:** planificación únicamente — Luciano pidió explícitamente analizar esto y medir la
magnitud del cambio, no construirlo todavía (23/08).

## Disparador

Revisando el bug de `cancelar_factura` (ver `CONTEXT.md`, ítem del 23/08 — el RPC reponía stock
de una Entrega manual que seguía vigente), Luciano planteó el tema de fondo: hoy `productos.
stock_actual` es un único número que mezcla "lo que tengo" con "lo que ya vendí pero no entregué".
En SAP, el inventario se ve en capas:

- **Libre / disponible para venta** — lo que se puede prometer a un cliente nuevo hoy.
- **Comprometido** — vendido (facturado o con Pedido confirmado) pero todavía no entregado. Sigue
  físicamente en el depósito, pero ya tiene dueño.
- **Pedido a proveedor, no recibido** — en tránsito de compra (OC enviada, sin Recepción).

Hoy KAIROX no distingue nada de esto: `stock_actual` es "lo que hay", punto. Facturar con
`p_factura_reserva=true` (mig.328, ver más abajo) evita duplicar el descuento de stock, pero **no
reserva nada** — ese stock sigue apareciendo como 100% libre y se lo puede vender a otro cliente
mientras tanto.

## Lo que YA existe (no arrancamos de cero)

### Factura de Reserva (mig.328, `PLAN_FACTURAR_PEDIDO_5_FRENTES.md`, Frente 4)

Ya construido y en producción: `crear_venta(..., p_factura_reserva boolean DEFAULT false)`.
Cuando se marca desde "Facturar Pedido", la factura se emite completa **sin tocar
`stock_actual`** y **sin generar ninguna Entrega** — el `pedido_items` sigue esperando "Generar
Entrega" más adelante, que es cuando el stock se descuenta de verdad. Esto ya resuelve la mitad
del problema (evita el doble descuento, respeta Regla 8: el stock se mueve una sola vez, en el
evento físico) — **pero la otra mitad, la reserva en sí, no existe**: nada le dice al resto del
sistema "estas 5 unidades ya tienen dueño, no las ofrezcas de nuevo".

### `puedeFacturar`/`GenerarMovimientoModal` — chequeo de stock ya existe, pero es ciego a reservas

`GenerarMovimientoModal.jsx` (arreglado hoy mismo, ver `CONTEXT.md`) ya clampa la cantidad a
entregar contra `productos.stock_actual` para que no se pueda generar una Entrega con más de lo
que hay. Pero si dos Facturas de Reserva compiten por el mismo producto, ninguna de las dos ve a
la otra — ambas leen el mismo `stock_actual` sin descontar lo ya comprometido por la otra.

### Superficie real de `stock_actual` — 31 archivos

Un grep de `stock_actual` en `src/` encuentra **31 archivos** que lo leen o lo escriben —
`ProductosSection.jsx`/`TablaInventario.jsx` (grilla de inventario), `PanelProductos.jsx`/
`PanelCarrito.jsx`/`NuevaVentaModal.jsx` (POS, chequeo de disponibilidad al vender), `NuevaFacturaModal.jsx`,
`AlertasStockBanner.jsx` (alertas de stock bajo), `dashboardService.ts`/`StockYCobranzas.jsx`
(dashboard), `useProductosSnapshot.js`/`offlineDb.js` (caché offline del POS), `CSVImportModal.jsx`,
`CommandPalette.jsx`, reportes, etc. Cualquier cambio real al significado de "cuánto stock tengo"
tiene que decidir, archivo por archivo, si ese lugar debe mostrar **libre** o **libre + comprometido**.

## Diseño (para cuando se retome)

### 1. No agregar una columna que haya que mantener sincronizada a mano

La opción ingenua —`productos.stock_comprometido numeric`, actualizada a mano en cada INSERT/
UPDATE relevante— es frágil: cualquier RPC nueva que toque `comprobante_items`/`pedido_items` sin
acordarse de mantenerla la desincroniza (mismo tipo de bug que ya pasó con `comprobantes.
neto_gravado`/`iva_discriminado` en NULL para 35 de 158 facturas viejas, resuelto recalculando
desde los ítems en vez de confiar en un campo cacheado — ver `SaleDetailModal.jsx`).

**Mejor opción: calcularlo, no guardarlo.** Comprometido = suma de `comprobante_items.cantidad`
de facturas con `estado_pago <> 'cancelada'` cuyo `cantidad_entregada < cantidad` para ese
producto (ya existe esa columna, la usa Pedido/Entrega). Se puede exponer como:
- Una vista (`productos_stock_disponible`, patrón ya usado en `facturas_saldo_pendiente` mig.169)
  con `stock_actual`, `stock_comprometido`, `stock_disponible = stock_actual - stock_comprometido`.
- O una función `stock_disponible(producto_id)` para chequeos puntuales (ej. dentro de
  `crear_venta`/`crear_entrega` al validar que alcance).

Esto evita tocar el schema de `productos` y evita cualquier riesgo de desincronización — el costo
es que cada lugar que hoy hace `SELECT stock_actual` tiene que decidir si necesita cambiar a la
vista nueva.

### 2. Dónde SÍ hay que cambiar comportamiento (no solo mostrar un número nuevo)

- **`crear_venta`** (Factura de Reserva): al facturar, en vez de no tocar nada, debería validar
  contra `stock_disponible` (no contra `stock_actual` a secas) para no reservar más de lo que
  realmente queda libre — hoy no valida nada en absoluto en el modo reserva.
- **`GenerarMovimientoModal.jsx`** (arreglado hoy): el clamp de cantidad a entregar sigue siendo
  correcto tal cual está (compara contra `stock_actual`, que es lo físico) — no necesita cambiar,
  la Entrega SÍ puede tomar de "lo comprometido" porque es precisamente cuando ese compromiso se
  efectiviza.
- **POS (`NuevaVentaModal.jsx`/`PanelCarrito.jsx`)**: si se quiere que el vendedor de mostrador no
  pueda vender algo ya comprometido por una Factura de Reserva del ERP, acá es donde hay que
  cambiar el chequeo de disponibilidad — hoy compara contra `stock_actual` a secas.
- **`AlertasStockBanner.jsx`**: una alerta de "stock bajo" que hoy mira `stock_actual` podría estar
  mostrando verde cuando en realidad ya no queda nada libre para vender.

### 3. Qué NO tocar

- El chequeo de stock en `GenerarMovimientoModal.jsx` para Entregas (correcto tal cual, ya
  arreglado hoy — Regla 8 se sigue respetando).
- `crear_entrega`/`emitir_remito`: no cambian, siguen operando sobre `stock_actual` real.
- El modo Recepción de `GenerarMovimientoModal.jsx` (compras, siempre suma) — sin cambios.

## Magnitud del cambio

**No es chico.** Aunque el mecanismo de "Factura de Reserva" (la mitad más difícil — evitar el
doble descuento) ya está construido y probado, falta la mitad que le da sentido al concepto: que
ese compromiso bloquee stock para terceros. Eso implica:

1. Una migración nueva (vista o función `stock_disponible`) — chica en sí misma.
2. Decidir, uno por uno, en cuáles de los **31 archivos** que hoy leen `stock_actual` corresponde
   pasar a leer disponible-vs-comprometido, y cuáles deliberadamente siguen mirando el stock físico
   real (ej. Recepciones, ajustes de inventario, recuento — a esos no les importa el compromiso
   comercial). Estimado: 6-10 de los 31 son candidatos reales (POS, Facturar Pedido/Reserva,
   alertas de stock, la grilla de Productos, dashboard) — el resto (offline cache, CSV import,
   reportes de compras) probablemente no aplica.
3. UI nueva: en la grilla de Productos y en cualquier selector de producto para vender, mostrar
   "Libre: X · Comprometido: Y" en vez de un solo número — cambio visible en varias pantallas.
4. Decidir la regla de negocio para cuando el compromiso choca con la realidad (ej. alguien vendió
   por POS algo que ya estaba comprometido por una Factura de Reserva vieja — ¿se bloquea la venta,
   se avisa, o se permite igual?) — esto es una conversación de producto, no solo de código.

## Preguntas para retomar con Luciano antes de construir

1. ¿El compromiso debe **bloquear** la venta a otro cliente (dura, tipo "no se puede"), o solo
   **advertir** ("este producto ya tiene N unidades comprometidas, ¿confirmás igual?")? SAP B1
   por defecto solo informa, no bloquea — pero es configurable.
2. ¿Esto aplica solo a Factura de Reserva (Facturar Pedido), o también a un Pedido simplemente
   **confirmado** todavía sin facturar? SAP considera comprometido desde la Orden de Venta, no
   recién en la Factura — sería un alcance más amplio que lo que Luciano describió hoy ("todo
   aquel stock que fue facturado pero no entregado" apunta a factura, no a pedido).
3. ¿Vale la pena resolver primero el punto más chico y ya identificado — Frente 4 de
   `PLAN_FACTURAR_PEDIDO_5_FRENTES.md` está incompleto (reserva sin bloqueo real) — antes de
   sumarle además la capa "Pedido a proveedor no recibido" (que ya existe conceptualmente en OC/
   Recepciones, pero tampoco se expone hoy como parte de un estado de inventario unificado)?
