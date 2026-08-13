# Extender el "estándar Cotizaciones" al resto de los comprobantes

## Contexto

Cotizaciones se rediseñó por completo (12-13/08) y Pedidos se llevó a la misma paridad (13/08).
Luciano pidió mapear qué de eso aplica al resto de los documentos del sistema antes de seguir
tocando código, "porque sé que hay cosas que fuimos replicando" — y eligió hacer **todo lo
mapeado en una sola tanda** en vez de una parte.

Se auditaron con 2 agentes de exploración en paralelo los 10 documentos restantes (Ventas y
Compras) contra 8 puntos concretos del estándar de Cotizaciones/Pedidos. Resultado completo abajo.
Dos hallazgos importantes cambian el enfoque:

1. **Se encontraron 2 bugs reales** en Facturas de Venta que no son "falta de replicar" — ya están
   rotos hoy y no dependen de ninguna decisión de alcance.
2. **No todos los 8 puntos aplican a todos los documentos.** Los documentos fiscales con CAE
   (Factura de Venta, NC/ND, tanto emitidas como recibidas) correctamente NO deben ganar edición
   con historial — hoy solo se cancelan, y así debe seguir (mismo criterio que ya rige en el
   sistema: un comprobante con CAE no se reedita). El único candidato real a "edición + historial
   completo" es **Órdenes de Compra**, porque es un documento pre-transacción como Cotización/
   Pedido — de hecho ya estaba anotado en memoria como "el siguiente candidato natural".
   Documentos sin precio propio (Entregas, Recepciones, Devoluciones que heredan todo del
   origen) tampoco necesitan autocomplete/IVA/descuento — no aplica por diseño, no es un gap.

## Mapeo completo (resultado de la auditoría)

| Documento | Modal grande | Autocomplete | Enter/foco | IVA línea | Descuento | Edición+historial | Detalle Neto/IVA | PDF |
|---|---|---|---|---|---|---|---|---|
| **Cotizaciones** (ref.) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Pedidos** (ref.) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A |
| Entregas | ❌ chico | N/A | N/A | N/A | N/A | ❌ (solo anular) | N/A | N/A |
| **Factura de Venta** | ⚠️ 5xl | ✅ | ❌ | ✅ (con 27% inválido) | ⚠️ **bug: se pierde** | correcto que NO (CAE) | ❌ falta en pantalla | ⚠️ **bug: sin línea Descuento** |
| NC emitida | ⚠️ 3xl | ❌ | ❌ | ❌ sin UI | ❌ no existe | correcto que NO (solo cancela) | ❌ | ⚠️ comparte FacturaPDF |
| **ND emitida** | ⚠️ 3xl | ❌ | ❌ | ❌ sin UI | ❌ no existe | ❌ **sin cancelar siquiera** | ❌ | ⚠️ comparte FacturaPDF |
| Devolución cliente | ❌ chico | N/A | N/A | ⚠️ heredado | N/A | correcto que NO | ❌ | N/A |
| **Órdenes de Compra** | ❌ 4xl | ⚠️ débil (.limit 6) | ❌ | ❌ | ❌ | ❌ **candidato real** | ❌ | N/A |
| Recepciones | ❌ chico | N/A | N/A | N/A | N/A | N/A (mov. único) | N/A | N/A |
| Factura de Compra | ⚠️ 5xl | ⚠️ precarga 500 | ❌ | ✅ | ❌ no existe | correcto que NO (parcial hoy vía Compra Rápida, no atómico) | ❌ sin modal detalle | N/A |
| NC/ND recibidas | ⚠️ 3xl | ❌ | ❌ | ✅ | ❌ | correcto que NO (solo cancela) | ❌ | N/A |
| Devolución proveedor | ❌ chico | N/A | N/A | ⚠️ heredado | N/A | correcto que NO | ❌ | N/A |

## Plan de ejecución — 4 fases, en orden

### Fase 0 — Bugs reales en Factura de Venta (rápido, primero)

Archivos: `src/components/ventas/NuevaFacturaModal.jsx`, `SaleDetailModal.jsx`,
`pdf/FacturaPDF.jsx`, y una migración nueva para el cancelar de ND.

1. **`descuento_pct` por línea no se persiste.** El INSERT a `comprobante_items` (~línea 277-289)
   nunca manda `descuento_item` — agregar la columna al insert (la tabla ya la tiene, mismo patrón
   que `cotizacion_items`/`pedido_items`).
2. **El resumen de totales y el PDF no muestran "Descuento".** Una vez persistido, agregar la
   línea al resumen (~línea 603-618) y a `FacturaPDF.jsx` con el mismo criterio ya usado en
   `CotizacionPDF.jsx`: `Subtotal` = precio de lista sin descuentos, `Descuento (X%)` = monto
   combinado, formato `Descuento (X%) -$Y`.
3. **`ALICUOTAS` incluye 27%**, que viola el `CHECK` real de la tabla (mismo hallazgo que ya
   documentaba un comentario en `ModalDetalleCotizacion.jsx` sobre este archivo) — sacarlo de la
   lista.
4. **Nota de Débito emitida no tiene ninguna forma de cancelarse.** No existe `cancelar_nota_debito`
   en ningún lado (confirmado por grep). Hay que:
   - Migración nueva: RPC `cancelar_nota_debito` — mismo patrón que `cancelar_nota_credito`
     (mig.267): revierte el efecto en cuenta corriente, marca `estado_pago = 'cancelada'`.
   - `SaleDetailModal.jsx`: extender `esNC`/`puedeCancelar`/la llamada RPC (línea 153-191) para
     cubrir `tipo === 'nota_debito'` además de `nota_credito`.

No se toca la regla de "sin CAE no se puede anular directamente" que ya existe — se mantiene igual
para ND.

### Fase 1 — Órdenes de Compra: paridad completa (mismo patrón mecánico que Pedidos)

Es una réplica directa del trabajo ya hecho en Pedidos — mismos 4 archivos, mismo orden:

1. **Migración** (`orden_compra_items.alicuota_iva` + `ordenes_compra.descuento_global_pct` +
   `trg_audit_orden_compra_items` + RPC `actualizar_orden_compra` con diffing por `id` desde el
   arranque — no repetir el error de delete-all que tuvo la primera versión de Cotizaciones).
   Guard de edición: revisar qué estados tiene OC hoy (`ordenesCompraService.ts`) y aplicar el
   mismo criterio que Pedidos — editable mientras no haya Recepción generada.
2. **`OrdenesCompraSection.jsx`**: robustecer `searchProducto`/`selectProducto` (hoy mezclan
   búsqueda y descripción libre con `.limit(6)` server-side, sin el patrón limpio de
   `prodSearch`/`prodResults`/`prodOpen` de Cotizaciones) + `empresaCondicionIva`-equivalente **no
   aplica acá** (ver nota abajo) + totales con descuento combinado + `handleSave` editar vía RPC.
3. **`FormNuevaOC.jsx`**: full-screen, autocomplete único, atajo Enter + fix de foco
   (`selectProductoYAvanzar`/`cantRefs`), columna IVA, campo Desc. Global %.
4. **`ModalDetalleOC.jsx`**: agrandar, desglose Neto/IVA, botón Editar, Historial de cambios.

**Nota de diseño — "discrimina" no aplica igual que en Ventas:** confirmado por código
(`NuevaFacturaProveedorModal.jsx` ya muestra Neto/IVA **sin condición** de letra) que en Compras
el desglose Neto/IVA se muestra siempre, no según `determinarTipoComprobante()` — como comprador
Responsable Inscripto siempre importa ver el IVA Crédito Fiscal, sin importar qué letra emitió el
proveedor. OC debe seguir ese mismo criterio (Neto/IVA siempre visible), no copiar la lógica de
`discrimina` de Cotizaciones tal cual.

### Fase 2 — Documentos fiscales: mejoras de consistencia, SIN agregar edición

**Factura de Venta** (además de los bugs de la Fase 0): atajo Enter + fix de foco; agregar
desglose Neto/IVA al modal de detalle en pantalla (`SaleDetailModal.jsx` — hoy solo está en el
PDF).

**Factura de Compra**: agregar campo de descuento (no existe ni por línea ni global — es el único
documento con precio real que no lo tiene en absoluto); atajo Enter; cambiar el autocomplete de
"precargar 500 productos" a búsqueda server-side (mismo patrón `.ilike().limit(N)` que ya usa OC,
o el patrón `searchProducto` de Cotizaciones); crear un modal de detalle dedicado (hoy no existe,
solo fila expandible inline en `FacturasCompraSection.jsx`).

### Fase 3 — NC/ND (emitidas y recibidas): autocomplete + IVA visible

Los 4 formularios (`NuevaNCModal.jsx`, `NuevaNDModal.jsx`, `NuevaNCProveedorModal.jsx`,
`NuevaNotaDebitoModal.jsx`) hoy son inputs de texto libre sin buscador de producto cuando se
cargan standalone (sin comprobante de origen). Agregar el mismo autocomplete de Cotizaciones +
(para NC/ND emitidas, que hoy no tienen ningún `<select>` de IVA visible pese a que el campo
existe) la columna de alícuota. Agregar Neto/IVA a los modales de detalle donde falte
(`SaleDetailModal.jsx` para las emitidas, tablas planas de `DevolucionesProveedorSection.jsx`
para las recibidas).

### Fase 4 — Devoluciones (cliente y proveedor): modal de detalle más grande + Neto/IVA

Los ítems se heredan de la factura/compra origen (correcto, no se toca), pero el modal de detalle
(`ModalDetalleDevolucion.jsx`, `DevolucionesTab` en `DevolucionesProveedorSection.jsx`) es chico y
no totaliza Neto/IVA — agrandar y agregar el desglose, mismo criterio que el resto.

### Fuera de alcance (confirmado que no aplica, no es un gap)

Entregas y Recepciones no manejan precio propio — el patrón de autocomplete/IVA/descuento no
aplica por diseño. Si se quiere, se puede agrandar el modal de detalle de ambos por pura
consistencia visual, pero es cosmético y de bajo valor — no incluido a menos que se pida aparte.

## Verificación (mismo criterio que Cotizaciones/Pedidos, por fase)

Por cada fase: `npx eslint` sobre los archivos tocados (0 errores), `npx vitest run` (156/156 o
más si se agregan tests), `npx vite build` limpio. Las migraciones nuevas se aplican con
`apply_migration` y se verifican con SQL envuelto en `BEGIN ... ROLLBACK` contra datos reales de
producción (Nalux) simulando el JWT de un perfil real, igual que se hizo para `actualizar_pedido`
— confirmando: cálculo de subtotal/descuento/total exacto, que el guard de estado bloquea
correctamente, que solo se auditan los ítems que cambiaron de verdad (no ruido), y que `anon` no
puede ejecutar la RPC nueva. Commit + push a GitHub + deploy a Vercel al cierre de cada fase (no
esperar a que las 4 fases estén listas), y actualizar CONTEXT.md/memoria con cada una.
