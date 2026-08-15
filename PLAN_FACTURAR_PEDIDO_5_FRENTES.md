# Facturar Pedido — 5 frentes pendientes (para Nadia)

Luciano revisó "Facturar Pedido" en vivo el 15/08 y encontró 5 problemas. Se
investigó a fondo el código para los 5 (ver detalle de cada uno abajo) y se
diseñó el Frente 2 al detalle de implementación — pero **no se construyó
nada todavía, los 5 frentes están pendientes**. Esto queda documentado para
que la próxima persona/sesión los tome directamente, sin tener que
re-investigar desde cero.

Screenshots de referencia (modal "Facturar Pedido" y el detalle de la venta
resultante) están en la conversación original con Luciano — pedirle si hacen
falta de nuevo.

---

## Frente 1 — Visual/diseño (PENDIENTE)

El modal "Facturar Pedido — PED-..." (`NuevaFacturaModal.jsx`) no respeta la
línea de diseño que se viene construyendo en el resto de la app (comparar con
`FormNuevaCotizacion.jsx`/`FormNuevaOC.jsx`, que ya pasaron por el rediseño
denso estilo SAP). Sin investigar todavía qué puntualmente está desalineado —
Luciano solo marcó "la visual no respeta la línea", habría que sentarse con
él a repasar qué específicamente cambiar.

## Frente 2 — Facturar lo entregado, no lo pedido (PENDIENTE — diseño ya cerrado)

Si un Pedido tuvo una Entrega (total o parcial), la Factura debe facturar
**solo lo efectivamente entregado** — nunca lo pedido. Si se entregó todo, se
factura todo; si fue parcial, se factura esa parcialidad y el resto queda
pendiente para cuando se entregue.

**Hallazgo clave: el backend ya está bien, no hace falta tocarlo.** La RPC
`crear_venta` (`supabase/migrations/156_crear_venta_fix_facturacion_pedido.sql:124-198`,
vigente sin cambios de lógica en `325b_fix_crear_venta_overload_duplicado.sql`)
ya calcula el tope correcto por ítem:
- Si hubo Entrega manual (`entregas` con `origen='manual', estado='entregado'`
  para ese `pedido_id`) → tope = `cantidad_entregada - cantidad_facturada`, sin
  mover stock (ya se movió en `crear_entrega`).
- Si nunca hubo Entrega manual → tope = `cantidad - cantidad_facturada`,
  entrega implícita, sí mueve stock (comportamiento histórico sin cambios).
- Ya rechaza con `RAISE EXCEPTION` si se factura de más.

**El bug es 100% de frontend**: `NuevaFacturaModal.jsx:140-150` precarga los
ítems directamente desde `pedido.pedido_items[].cantidad` (la cantidad
PEDIDA), ignorando `cantidad_entregada`/`cantidad_facturada` — por eso el
modal siempre ofrece facturar el pedido completo, aunque solo se haya
entregado una parte. Este único punto de entrada cubre los dos botones
("Facturar Pedido" en `PedidosSection.jsx:739` y "Facturar Entrega" en
`EntregasSection.jsx:423`, vía `pedidoAFacturar`) — ambos ya traen
`pedido_items(*)` completo (incluye `cantidad_entregada`/`cantidad_facturada`
porque usan `select('*, pedido_items(*)')`), así que **no hace falta tocar
los callers**, solo `NuevaFacturaModal.jsx`.

### Cambio a implementar

En `NuevaFacturaModal.jsx`, dentro del `useEffect` de pre-carga (rama
`if (pedido?.id)`, línea ~137-150):

1. Consultar `entregas` para saber si hubo una manual `entregado` para ese
   `pedido_id` (mismo criterio exacto que la RPC, mig.156 líneas 124-135):
   ```js
   supabase.from('entregas').select('id')
     .eq('empresa_id', user.empresa_id).eq('pedido_id', pedido.id)
     .eq('origen', 'manual').eq('estado', 'entregado')
     .order('fecha', { ascending: false }).limit(1).maybeSingle()
   ```
2. Por cada `pedido_items[]`, calcular `maxFacturable`:
   - con entrega manual → `cantidad_entregada - cantidad_facturada`
   - sin entrega manual → `cantidad - cantidad_facturada`
3. Filtrar los ítems con `maxFacturable <= 0` (nada pendiente para ese ítem).
4. Precargar `items` con `cantidad: maxFacturable` (no la cantidad pedida) —
   el usuario sigue pudiendo editarla a mano si hace falta, pero el default ya
   es correcto.
5. Si no queda ningún ítem facturable (`itemsFacturables.length === 0`),
   mostrar un toast claro ("Nada pendiente de facturar — este pedido ya está
   totalmente facturado según lo entregado") en vez de abrir un formulario
   vacío o dejar que el usuario choque con la excepción del RPC recién al
   confirmar.

No hace falta tocar el banner informativo existente del modal ("Vinculada al
Pedido... si el pedido ya tuvo una Entrega, el stock no se vuelve a
descontar...") — ya describe correctamente el comportamiento de stock;
opcionalmente sumar una frase corta aclarando que los ítems ya vienen
ajustados a lo pendiente de facturar.

### Verificación sugerida al construirlo

- `npx eslint`/`npx vitest run`/`npx vite build` tras el cambio.
- Verificación en vivo (browser real) contra datos de Nalux, sin fabricar
  datos: buscar un Pedido con Entrega parcial real (o generar una entrega
  parcial de prueba con rollback si no existe ninguna) y confirmar que
  "Facturar Pedido" precarga solo lo entregado; buscar un Pedido nunca
  entregado y confirmar que sigue precargando lo pedido completo (sin
  regresión); probar "Facturar Entrega" desde `EntregasSection.jsx` también.

## Frente 3 — Mapa de Relaciones faltante en "Facturar Pedido" (PENDIENTE)

El modal `NuevaFacturaModal.jsx` no tiene ningún botón de "Mapa de
relaciones" — a diferencia de casi todos los demás documentos del sistema
(Cotización, Pedido, OC, Factura de Compra, etc., que ya lo tienen desde las
Fases 0-4 de `PLAN_COMPROBANTES_ESTANDAR.md`). Agregar el mismo patrón: botón
que abre `<MapaRelaciones pedidoId={pedido.id} .../>` (o `comprobanteId` si ya
existe uno). Chico, mecánico, bajo riesgo.

## Frente 4 — Factura de Reserva (PENDIENTE, funcionalidad nueva de verdad)

Pedido de Luciano: poder facturar el pedido COMPLETO sin que haya habido
ninguna Entrega todavía, y que el movimiento de stock (la Entrega real)
ocurra recién DESPUÉS, por separado.

**Estado actual confirmado por investigación (15/08):** no existe hoy ningún
concepto de "facturar sin entregar" — grep de `requiere_entrega`/
`factura_reserva`/`reserva` en migraciones y `src/` no encontró nada. Hoy el
único camino sin Entrega previa es: `crear_venta` factura Y entrega
implícitamente en el mismo paso (siempre mueve stock — ver
`supabase/migrations/156_crear_venta_fix_facturacion_pedido.sql:124-198`).

**Lo que hay que diseñar antes de construir:**
1. Nueva rama en `crear_venta` (o RPC nueva) que permita facturar el pedido
   completo SIN mover stock y SIN que exista una Entrega — necesita un flag
   nuevo (ej. `p_factura_reserva boolean`).
2. Verificar si `crear_entrega`/`GenerarMovimientoModal.jsx` (tipo="entrega")
   ya soporta generar una Entrega para un Pedido que quedó en estado
   `facturado` — probablemente NO, porque el flujo de estados de Pedido
   (`getEstado()` en `src/components/pedidos/shared.js`) puede no contemplar
   "facturado pero todavía sin entregar". Revisar esto primero.
3. Confirmar con Luciano el nombre/UX exacto: ¿un checkbox "Factura de
   Reserva (no entregar todavía)" en el propio modal de Facturar Pedido? ¿Un
   botón separado?
4. Impacto en Mapa de Relaciones / Document Flow: hoy asume que Entrega viene
   antes que Factura — revisar `MapaRelaciones.jsx` (`fetchMapaVenta`) para
   confirmar que sigue funcionando si la Entrega llega DESPUÉS del
   comprobante.

## Frente 5 — Desacoplar el cobro de la emisión (PENDIENTE, cambio de comportamiento)

Pedido de Luciano, textual: "aquí no debe comportarse como venta POS, aquí se
debe comportar como un ERP y como lo hace SAP". Hoy `NuevaFacturaModal.jsx`
pide "Forma de pago" (Efectivo/Transferencia/Tarjeta/Cuenta Corriente) y
cobra en el momento — igual que el POS. SAP real: la Factura se EMITE (con
CAE si corresponde) sin cobrar nada; siempre queda como deuda en Cuenta
Corriente (Open Item); el COBRO se hace DESPUÉS, en un módulo separado, donde
se busca por cliente, se traen todas sus facturas pendientes, se
seleccionan cuáles pagar (con su total) y se elige el medio de pago (efectivo,
transferencia, cheque, tarjeta). Nota de Luciano: "se percibe en la factura y
se retiene en el pago" (percepciones a nivel línea de factura, retenciones a
nivel del cobro) — depende de configuración, tenerlo en cuenta para el diseño
pero no es bloqueante.

**Hallazgo clave de la investigación (15/08): el sistema de Cobro con Open
Item YA EXISTE y funciona** — no es que haya que construirlo de cero:
- `src/components/sections/CuentaCorrienteSection.jsx` (tab Clientes) ya
  busca cliente, trae sus facturas abiertas vía la vista
  `facturas_saldo_pendiente` (`fetchFacturasAbiertas`, línea ~284), permite
  imputar a una o varias facturas con auto-distribución FIFO
  (`autoDistribuirFIFO`, línea ~321) y elegir medio de pago desde el maestro
  `formas_pago`.
- El modal es `src/components/cuenta-corriente/ModalCobro.jsx`.
- Todo pasa por la RPC `registrar_cobro_cliente`
  (`handleRegisterPayment`, `CuentaCorrienteSection.jsx` línea ~353-473).
- El patrón Open Item (saber cuánto de una factura puntual sigue impago) está
  en `supabase/migrations/169_cxc_cxp_imputacion_factura.sql` — tabla
  `cuenta_corriente_imputaciones` + vista `facturas_saldo_pendiente`.

**Lo que sí falta / hay que decidir:**
1. **Sacar el bloque "Forma de pago" de `NuevaFacturaModal.jsx`** (línea ~27
   `FORMAS_PAGO`, línea ~281 `isCC`, y los dos caminos de INSERT que hoy
   condicionan `movimientos_caja` vs Cuenta Corriente según el medio elegido
   — ver línea ~446-479). La factura del ERP debe SIEMPRE ir por el camino
   DEBE en `cuenta_corriente_movimientos` (Open Item), nunca por
   `movimientos_caja`/`p_pagos` de `crear_venta`.
2. Confirmar que "Cheque" existe como fila activa en el maestro `formas_pago`
   de Nalux (`ConfiguracionSection.jsx` lo administra) — si no está, agregarlo
   ahí es un dato de configuración, no código.
3. **Alcance confirmado con Luciano:** el cambio aplica IGUAL a Facturar
   Pedido, Facturar Entrega, y también a "Nueva Factura" standalone (mismo
   modal `NuevaFacturaModal.jsx` en los 3 casos) — comportamiento uniforme,
   nunca se comporta como POS. El POS (`NuevaVentaModal.jsx`, Modo Caja) NO
   se toca — sigue cobrando en el momento, es un circuito distinto a
   propósito.
4. Evaluar si conviene mover visualmente el botón "Cobrar"/acceso a
   `ModalCobro.jsx` hacia el módulo de Bancos (`CuentasBancariasSection.jsx`)
   en vez de dejarlo solo en Cuenta Corriente — hoy Bancos no tiene ningún
   flujo de cobro a clientes, solo conciliación. Definir con Luciano si hace
   falta ese traslado/enlace o si Cuenta Corriente ya es un lugar aceptable.

---

**Orden sugerido para retomar:** Frente 3 (chico, rápido) → Frente 1 (visual,
después de confirmar con Luciano qué cambiar puntualmente) → Frente 5 (grande
pero mayormente "sacar código", el sistema de Cobro ya existe) → Frente 4
(el más grande, requiere RPC nueva y repensar el flujo de estados de Pedido).
