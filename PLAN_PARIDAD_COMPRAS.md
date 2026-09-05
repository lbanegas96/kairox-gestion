# Auditoría de Paridad — Compras vs. Ventas (KAIROX Gestión)

**Fecha:** 04/09/2026
**Pedido de Luciano:** "auditoría de compras basándome en todos los cambios que hicimos en ventas, considerando solo lo necesario para dicho módulo, para que quede operativo como Ventas".
**Metodología:** relevamiento de código (Explore agent, con cita de archivo:línea) + marco funcional SAP Business One (skill `sap-reference`) + revisión contable de paridad (skill `auditor-contable`). Los 2 hallazgos más graves (🔴) fueron **re-verificados por mí directamente**, línea por línea, antes de escribirlos acá — no se reporta nada solo por confianza en el relevamiento automático.

---

## Resumen ejecutivo

Compras está **más maduro de lo esperado** en Document Flow (Mapa de Relaciones, Duplicar) pero tiene **1 bug de compliance real ya en producción** (IVA de Facturas de Compra registradas desde una OC, ver 🔴 #1) y **una asimetría de trazabilidad** (Facturas de Compra sin editar+historial, mientras que Cotizaciones/Pedidos/OC ya lo tienen). El resto son gaps de herramientas de gestión (Cuenta Corriente de Proveedores, aging de CxP) — reales, pero no bugs.

**2 hallazgos 🔴 críticos, 3 🟡 importantes, 2 🟢 mejoras, y 3 falsos positivos aclarados** (cosas que parecían asimetría pero no lo son).

---

## 🔴 Crítico — corregir antes de seguir usando "Registrar Factura desde OC"

### 1. IVA duplicado al registrar una Factura de Compra desde una Orden de Compra

**Este es, con alta probabilidad, un bug activo en producción ahora mismo**, no solo un gap de features.

- `OrdenesCompraSection.jsx:23-25` (comentario del propio código): `costo_unitario` de un ítem de OC es **siempre el precio final CON IVA incluido** — mismo criterio que Cotizaciones/Pedidos/Ventas.
- `OrdenesCompraSection.jsx:169`, función `abrirModalFactura()`: copia ese valor bruto directo a un campo llamado `costo_unitario_neto` — `costo_unitario_neto: i.costo_unitario`.
- `ModalRegistrarFactura.jsx:23-25`: ese campo se usa como si fuera de verdad el neto sin IVA — `subtotalNeto = cantidad × costo_unitario_neto`, `totalIva = subtotalNeto × alícuota/100`, `total = subtotalNeto + totalIva`.

**Resultado:** si un ítem cuesta realmente $121 (neto $100 + 21% IVA = $21), la Factura de Compra registrada desde la OC calcula: `subtotalNeto=$121` (¡el bruto, tratado como neto!) → `totalIva=$25,41` → `total=$146,41`. **El sistema factura ~21% de más y declara Crédito Fiscal IVA por encima del real** — impacto directo en compliance AFIP (RG 3685, Libro IVA Compras) y en el balance (Mercaderías se carga a un costo inflado).

**Adicional en la misma línea:** `OrdenesCompraSection.jsx:170` hardcodea `alicuota_iva: 21` sin leer `i.alicuota_iva` real del ítem de la OC — un producto exento o al 10.5% también se calcula mal.

**Alcance:** solo afecta el flujo "Registrar Factura" disparado **desde el detalle de una OC** (`ModalDetalleOC.jsx` → `abrirModalFactura`). El flujo de Factura de Compra standalone / "Duplicar" (`NuevaFacturaProveedorModal.jsx`) copia el precio correctamente (confirmado por el relevamiento, línea 102) y no tiene este problema.

**Fix sugerido:** en `abrirModalFactura` (`OrdenesCompraSection.jsx:162-172`), dividir `i.costo_unitario` por el factor de IVA de `i.alicuota_iva` antes de asignarlo a `costo_unitario_neto` (mismo patrón `FACTOR_IVA` que ya existe en la línea 26 del mismo archivo, hoy sin usar en esta función) y copiar `alicuota_iva: i.alicuota_iva` en vez del literal `21`.

### 2. Moneda y tipo de cambio se pierden al facturar una OC en moneda extranjera

`supabase/migrations/332_ordenes_compra_facturacion_parcial.sql:118-121` — `registrar_factura_compra_oc` inserta la Factura de Compra con `moneda='ARS', tipo_cambio_tasa=1` **hardcodeados**, ignorando `v_oc.moneda`/`v_oc.tipo_cambio_tasa` de la Orden de Compra original. Una OC pactada en USD termina generando una Factura de Compra en ARS con TC=1 — la deuda con el proveedor en Cuenta Corriente queda expresada en el monto equivocado.

**Fix sugerido:** pasar `v_oc.moneda, v_oc.tipo_cambio_tasa` en el INSERT en vez de los literales, mismo patrón que ya usa el resto de los documentos multi-moneda del sistema (Regla 6 de `sap-reference`).

---

## 🟡 Importante

### 3. Facturas de Compra sin "Editar" ni historial de auditoría

Órdenes de Compra **ya tiene** este patrón completo (RPC `actualizar_orden_compra` con diffing por id + historial vía `audit_log`, visible en `ModalDetalleOC.jsx` — mismo nivel que Cotizaciones/Pedidos). Facturas de Compra, no:

- `ModalDetalleFacturaCompra.jsx:176-180` solo tiene "Duplicar", no "Editar" ni "Historial de cambios".
- `comprasService.ts` no tiene `update()` con diffing ni `getHistorial()`.
- Existe `ModalEditarCompra.jsx`, pero solo lo usa `CompraRapidaSection.jsx` (flujo legacy) — hace un `update` directo a las tablas, sin pasar por RPC y **sin escribir en `audit_log`**.

**Bajo el criterio del auditor contable**, esto es una brecha de trazabilidad real: una Factura de Compra que se edita sin dejar rastro auditable es un riesgo de control interno, mismo tipo de hallazgo que ya se corrigió del lado Cotizaciones/Pedidos (mig.318/320).

**Alcance sugerido:** construir `actualizar_factura_compra` (RPC con diffing) + conectar un botón "Editar"/"Historial" real en `ModalDetalleFacturaCompra.jsx`, mismo patrón que ya está probado en OC — no hay que inventar nada nuevo, es portar el patrón existente.

### 4. Cuenta Corriente de Proveedores por detrás en herramientas de gestión

Comparado con `ClientDetailModal.jsx` (lado clientes):

| | Clientes | Proveedores |
|---|---|---|
| Tamaño de modal | `size="wide"` | `max-w-3xl` |
| Filtro de fecha Desde/Hasta | Sí, real | No existe |
| Límite de filas | `.limit(50)` solo si no hay filtro | `.limit(100)` fijo, sin alternativa |
| PDF de Estado de Cuenta | Sí (`imprimirEstadoCuenta`) | No existe |

`src/lib/imprimirEstadoCuenta.jsx` está codeado exclusivamente para `clienteId`/tabla `clientes` — no hay variante para proveedor.

**Alcance sugerido:** mismo trabajo que ya se hizo para Cuenta Corriente de Clientes esta semana (modal wide, filtros de fecha reales, PDF), replicado sobre `ProveedoresSection.jsx` + una función `imprimirEstadoCuentaProveedor` (probablemente generalizar `imprimirEstadoCuenta.jsx` para aceptar `proveedorId` en vez de duplicar el archivo entero).

### 5. Sin reporte de Antigüedad de Saldos (aging) para Proveedores

El reporte "Cartera de Clientes" (`reportDefinitions.jsx`) tiene columnas de aging 0-30/31-60/61-90/+90. **No existe ningún reporte equivalente para Proveedores** — `REPORTS` (la lista de reportes disponibles) no tiene ninguna entrada de proveedores/CxP.

Bajo RT FACPCE esto no es una exigencia normativa formal (es control de gestión, no requisito de exposición), pero sin esto la empresa no puede planificar pagos ni detectar su propia mora de forma sistemática — mismo valor de negocio que ya tiene Cartera de Clientes del lado cobros.

**Alcance sugerido:** nuevo reporte "Cartera de Proveedores" en `reportDefinitions.jsx`, mismo cálculo de aging que ya existe para clientes, aplicado a `cuenta_corriente_proveedores`.

---

## 🟢 Mejoras (menor prioridad)

### 6. NC/ND de Proveedor sin Mapa de Relaciones
`DevolucionesProveedorSection.jsx` no importa `MapaRelaciones`, mientras que `ModalDetalleDevolucion.jsx` (lado ventas) sí lo tiene. Gap de Document Flow (Regla 3 de `sap-reference`), fácil de portar.

### 7. Reporte de Compras con menos opciones de agrupamiento
Compras tiene 3 (día/método de pago/proveedor) contra 4 de Ventas (+ "por lista de precios"). Ver más abajo por qué esto **no es un gap real** — considerar en cambio agregar "por categoría de producto", que sí tendría sentido de negocio propio en Compras.

---

## Lo que NO es un gap (aclarado a propósito, para no perseguir falsos positivos)

- **Recepciones sin "Duplicar":** correcto tal cual está. Una Recepción es un evento físico (mercadería que llegó), igual que una Entrega del lado ventas — y Entregas **tampoco** tiene "Duplicar". Es consistencia, no asimetría.
- **Reporte de Compras sin agrupamiento "por lista de precios":** SAP Business One no tiene "listas de precio de compra" seleccionables por el usuario — el mecanismo correcto es el "Último Precio de Compra" (`costo_compra` actualizado automáticamente en cada compra real), que KAIROX **ya implementa** desde la Fase A/B de Listas de Precio. No hay ningún concepto equivalente que arrastrar del lado compras — la ausencia es estructuralmente correcta, no un gap.
- **COGS/valuación de inventario en compras:** confirmado correcto sin anomalías (`aplicar_compra_producto`, `fn_oc_update_stock`, mig.388) — no requiere ningún cambio.
- **Paridad IVA Crédito Fiscal / Débito Fiscal:** confirmado sin riesgo — la Fase C/D de Listas de Precio tocó exclusivamente archivos de Ventas, nunca compartidos con Compras, así que la paridad confirmada el 30/07 sigue intacta.
- **NC/ND de Proveedor — patrón contable y reversión de stock/costo:** confirmado simétrico contra su equivalente de Ventas (`crearAsientoNotaProveedor`/`crearAsientoReversaNotaProveedor` en `planCuentasService.ts`, mismo patrón de partida doble que el lado clientes). Esto respondía la pregunta abierta que había dejado la revisión contable preliminar — **sin asimetría, no había ningún riesgo de RT 17 acá**.

---

## Plan de fases sugerido (mismo criterio que Listas de Precio A-D)

1. **✅ Fase 1 (🔴 urgente) — CERRADA (04/09):** fix de IVA duplicado + moneda/TC hardcodeados en "Registrar Factura desde OC". mig.390 (`registrar_factura_compra_oc`) + `OrdenesCompraSection.jsx`/`ModalRegistrarFactura.jsx`. Probado con `BEGIN...ROLLBACK` simulando una OC en USD/350 (total pasó de $544.500 mal calculado a $450.000,03 correcto) y verificado en vivo contra OC-00005 real en el navegador (precio neto $24.793,39 = 30000/1.21, alícuota real 21%, sin registrar la factura real). Revisión `auditor-contable` del asiento automático: sin riesgo, `crearAsientoCompra` hereda los totales directo de la RPC, no los recalcula — el asiento queda bien imputado automáticamente. Facturas ya registradas ANTES del fix (con el cálculo viejo, infladas) se dejan como están — no se tocan retroactivamente (RT 17: un ajuste a un registro ya emitido se hace con un asiento de ajuste explícito, no reescribiendo el historial); pendiente que Luciano/Nadia revisen manualmente si alguna factura histórica quedó inflada desde que existe esta función (mig.332, 18/08).
2. **✅ Fase 2 (🟡) — CERRADA (04/09), ALCANCE CORREGIDO durante la implementación:** el hallazgo original ("editar + historial para Facturas de Compra, portando el patrón de OC") comparaba contra el documento equivocado — OC es PRE-transaccional (como Cotización/Pedido), una Factura (Compra o Venta) es POST-transaccional. Se confirmó en el código que las Facturas de VENTA TAMPOCO tienen edición con diffing de ítems (no existe `actualizar_venta`/`actualizar_factura`) — construirla para Compras hubiera sido una asimetría NUEVA y un riesgo contable real. La comparación correcta era Factura de Compra vs. Factura de Venta: ahí sí faltaba `cancelar_compra`, simétrica a `cancelar_factura` (Ventas). mig.391: RPC `cancelar_compra` (reversión de stock, `cantidad_facturada` de la OC de origen, caja si fue Efectivo, Cuenta Corriente del proveedor), `compras.estado_pago` ahora admite `'anulada'`, trigger de auditoría en `detalle_compras` + "Historial de cambios" visible, botón "Anular Factura" en `ModalDetalleFacturaCompra.jsx`. Probado con `BEGIN...ROLLBACK` (compra ligada a OC: stock/`cantidad_facturada`/CxP revertidos correctamente; compra en Efectivo: caja revertida; doble anulación bloqueada) y en vivo en el navegador contra una factura real (sin confirmar la anulación). Revisión `auditor-contable`: circuito equivalente a `cancelar_factura`, sin riesgos bloqueantes — 2 mejoras 🟢 anotadas (columna `compra_id` en `movimientos_caja` para el matching de reversa de caja sin ambigüedad; no anular una factura que ya tuvo una NC de Proveedor parcial aplicada, ajustar esos casos a mano).
3. **✅ Fase 3 (🟡) — CERRADA (04/09):** Cuenta Corriente de Proveedores a la par de Clientes. Modal ahora `size="wide"` (mismo shell que Clientes, con la restructuración shrink-0/flex-1 correspondiente para que las 3 solapas — Cuenta Corriente/Historial OC/Ficha — scrolleen bien dentro del alto fijo del shell). `proveedoresService.getCuentaCorriente` ahora acepta `fechaDesde`/`fechaHasta` reales (antes `.limit(100)` fijo sin alternativa). Botón "Descargar PDF" nuevo (`imprimirEstadoCuentaProveedor.jsx`) — reutiliza `EstadoCuentaPDF.jsx` generalizándolo (`entidadLabel` dinámico + `esDebito` explícito por fila en vez de chequear `tipo==='DEBE'` literal) en vez de duplicar el componente completo. Sin migraciones ni cálculos nuevos — probado en vivo en el navegador (filtro de fecha, descarga de PDF sin errores de consola, las 3 solapas). Revisión `auditor-contable`: sin riesgo, la generalización del PDF no mezcla la polaridad de Clientes/Proveedores porque cada caller calcula su propio `esDebito` antes de pasarlo al componente compartido.
4. **✅ Fase 4 — HALLAZGO CORREGIDO, sin trabajo pendiente (04/09):** el informe original decía "sin reporte de Antigüedad de Saldos para Proveedores", basado en que `reportDefinitions.jsx` (el módulo Reportes) no tiene una entrada 'proveedores'. Al retomar esta fase se confirmó que **el reporte ya existe**, sólo que vive en otro lugar: `ProveedoresSection.jsx` tiene una solapa "Antigüedad de Deuda" completa (mig.314, previa a esta sesión) que reutiliza el mismo componente `TabAntiguedad.jsx` que usa Cartera de Clientes — 4 bandas (0-30/31-60/61-90/+90) con montos y conteo, tabla detallada, drill-down "Ver detalle" al proveedor. Verificado en vivo con datos reales de Nalux. No hacía falta construir nada — el hallazgo original fue un falso positivo por buscar en el lugar equivocado (mismo tipo de error de comparación que corrigió la Fase 2).
5. **✅ Fase 5 (🟢) — CERRADA (05/09), última fase del plan:** Mapa de Relaciones en NC/ND de Proveedor + agrupamiento "por categoría" en reporte de Compras.
   - **Parte A:** `DevolucionesProveedorSection.jsx` ahora importa `MapaRelaciones` (sin tocar ese componente) y expone un botón "Mapa de relaciones" (columna "Acc.") en las 3 sub-tablas — `DevolucionesTab` (ya traía `compra_id`), `NotasDebitoRecibidas` y `NotasCreditoRecibidas` (se agregó `compra_id` a sus SELECT). Estado `mapaCompraId`/`isMapaOpen` centralizado en el componente padre, un único `<MapaRelaciones>` compartido por las 3 solapas — mismo patrón que `FacturasCompraSection.jsx`.
   - **Parte B:** nueva opción "Por categoría de producto" en `GROUP_BY_OPTIONS_POR_REPORTE.compras`/`GROUP_KEY_FN_POR_REPORTE.compras` (`reportDefinitions.jsx`). El SELECT de compras en `ReportesSection.jsx` ahora trae `detalle_compras(productos(categoria_id, categorias(nombre)))`; cada fila calcula su categoría: si todos los ítems comparten una sola categoría, esa; si hay más de una, literal `'Varias categorías'` (confirmado con SQL real contra Nalux que sí existen facturas con ítems de 2 categorías — tomar "la primera" habría sido engañoso); sin producto/categoría, `'Sin categoría'`. Limitación conocida, anotada pero no bloqueante: al agrupar a nivel de header (no de línea), una factura mixta aporta su total completo entero al bucket "Varias categorías" en vez de prorratearse — mismo límite que tiene SAP a nivel de documento (el prorrateo por línea existe, pero no a nivel de reporte de cabecera).
   - **Hallazgo real encontrado por `auditor-contable` al revisar esta fase, corregido en el mismo commit:** `MapaRelaciones.jsx`'s `compraNodo` nunca pasaba `estado_pago` al nodo (el SELECT no lo traía, y el objeto del nodo no tenía el campo) — mismo bug que ya se había corregido del lado Ventas el 23/08 (`compNodo` sí lo tiene, con comentario explícito in situ). Efecto: una Factura de Compra **anulada** (mig.391, Fase 2) se veía en el Mapa exactamente igual que una vigente, sin badge rojo ni ningún indicio — justo el tipo de caso que se vuelve más frecuente al agregar 3 entry points nuevos desde NC/ND de Proveedor. Fix de 2 líneas: agregar `estado_pago` al SELECT de `fetchMapaCompra` + `estado: mapa.compra.estado_pago` en `compraNodo`. `estadoColor()` ya reconocía `/anulad/` en rojo, solo faltaba el dato. Verificado en vivo: una Factura de Compra "Pagada" ahora muestra su badge verde en el Mapa (antes no mostraba ninguno).
   - Sin migraciones — ambos cambios son SELECT + agrupamiento en cliente, sin tocar asientos/CC/stock/RPCs. Verificado en vivo en el navegador (los 3 accesos a Mapa de Relaciones desde Devoluciones/ND/NC recibidas, resolviendo cada uno la compra correcta; el groupBy "Por categoría de producto" mostrando "Electrónica (3)" y "Varias categorías (3)" con datos reales). Revisión `auditor-contable`: sin riesgo de cross-tenant (`empresa_id` filtrado en cada query + RLS), sin riesgo de `compra_id` nulo (los 3 botones tienen guard `&&`).

---

## Próximos pasos

**Las 5 fases de este plan están cerradas y en producción — PLAN_PARIDAD_COMPRAS.md queda completo.** Compras opera hoy a la par de Ventas en Document Flow, motor contable (asientos + reversión de stock/CC/caja), Cuenta Corriente y reporting. Quedan 2 hallazgos aparte, sin relación con la paridad Compras/Ventas en sí (ver abajo), a decisión de Luciano/Nadia.

## Hallazgo aparte #2 — bug real encontrado durante la verificación de Fase 5, no corregido acá

Al verificar en vivo el nuevo acceso a Mapa de Relaciones apareció en consola un error 400 real,
sin relación con Fase 5: `ProveedoresSection.jsx` (solapa "Antigüedad de Deuda", mig.314) intenta
leer `proveedores.saldo_actual` — columna que **no existe** en `proveedores` (a diferencia de
`clientes`, que sí la tiene). El error se traga en silencio (el `Promise.all` no chequea el
`error` de esa query), así que la reconciliación que esa solapa agregó específicamente para no
sobreestimar la deuda de un proveedor con pagos sin imputar **nunca se ejecuta** — cae siempre al
monto crudo `saldo_pendiente`. No sobreestima por mucho en la mayoría de los casos, pero es un
gap real del motor de aging de Proveedores, independiente de este plan. Se dejó anotado como
tarea aparte (no se tocó en esta sesión) para no mezclar alcance con el cierre de Fase 5.

## Hallazgo aparte, pendiente de decisión de Luciano

Verificado en vivo en la solapa "Antigüedad de Deuda" de Proveedores: las filas de prueba
`TEST-PARCIAL-001/002`, `FAC-PROV-TEST-001/002` (proveedor "Alibaba", ligadas a OC-00003) siguen
en producción y **suman ~$200.472,80 a la banda "0-30 días"** del reporte real — no son datos de
esta sesión, quedaron de una prueba anterior. No se tocaron. Si Luciano confirma que son
descartables, se pueden anular (vía el nuevo botón "Anular Factura" de la Fase 2, que además las
saca del cálculo de aging) o eliminar directamente.
