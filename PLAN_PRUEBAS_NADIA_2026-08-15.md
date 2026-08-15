# Plan de pruebas — Nadia — 15/08/2026

Todo lo de acá se construyó la madrugada del 14/08 probando el circuito
**Cotización → Pedido → Entrega** en vivo. Está deployado en producción.

**Dónde probar:** https://kairox-gestion-chi.vercel.app (tenant Nalux)
**Cómo reportar:** anotá al lado de cada punto ✅ / ❌ + qué viste. Si algo falla, sacá captura y
anotá el número de documento con el que pasó.

> ⚠️ **Ojo antes de arrancar:** hay un problema **ya conocido** que NO hay que reportar como bug
> nuevo — el botón **"Facturar Entrega"** abre la pantalla del Punto de Venta (con métodos de
> pago, buscador de productos, etc.) en vez del formulario de factura del ERP. Está mal, Luciano
> ya lo detectó y se arregla el 15/08. Ver PENDIENTE #1 en CONTEXT.md.
> Si igual querés probar que la factura **sale bien**, hacelo; lo que está mal es la pantalla, no
> el resultado.

---

## 1. Copiar Cotización a Pedido — aviso de duplicado

**Por qué:** se podían generar pedidos duplicados de la misma cotización sin ningún aviso.
COT-00027 tenía 3 pedidos colgando y nadie se había enterado.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1.1 | Ventas → Cotizaciones. Abrí una cotización **Aprobada o Enviada** que **nunca** se copió a pedido. Clic en "Copiar a Pedido" | Va directo al formulario de Pedido, **sin ningún aviso** |
| 1.2 | Guardá ese pedido. Volvé a la misma cotización y clic en "Copiar a Pedido" de nuevo | Ahora **sí** aparece el cartel *"Esta cotización ya generó un pedido"*, nombrando el pedido que ya existe |
| 1.3 | En ese cartel, clic en **"Volver"** | No se crea nada. Contá los pedidos: tiene que seguir habiendo uno solo |
| 1.4 | Repetí y clic en **"Crear otro pedido igual"** | Se crea un segundo pedido. Es correcto: SAP permite copiar en tandas, la idea es que sea una decisión consciente |
| 1.5 | Probá con COT-00027 (ya tiene 3 pedidos) | El cartel tiene que decir *"ya fue copiada a 3 pedidos"* (en plural, con el número correcto) |

---

## 2. Crear un Pedido — el documento queda abierto

**Por qué:** al crear un pedido el modal se cerraba y te dejaba en la lista, sin camino a la entrega.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 2.1 | Ventas → Pedidos → "Nuevo Pedido". Cargá un producto y guardá | **No se cierra todo.** Se abre el detalle del pedido recién creado, a pantalla completa |
| 2.2 | Mirá el pie del modal | Botones fijos abajo: **Cerrar**, **Editar Pedido**, **Avanzar a Confirmado**. No hay que scrollear para verlos |
| 2.3 | Clic en "Avanzar a Confirmado" | El modal **sigue abierto**. Aparece "Generar Entrega" y **desaparece "Editar Pedido"** (confirmado ya no se edita) |
| 2.4 | Clic en "Generar Entrega" y confirmá | Salta solo a la pestaña **Entregas** con la entrega nueva abierta |
| 2.5 | Probá cerrar con la tecla **Escape** y con el botón **Cerrar** | Cierra solo cuando vos querés |

---

## 3. Entrega de un pedido SIN cliente (bug real de la base) — ✅ validado 14/08 noche

**Por qué:** no se podía entregar un pedido sin cliente. El error decía *"Pedido no encontrado o
no pertenece a la empresa"*, que era mentira.

Este bloque quedó fuera del barrido de Nadia (probó 1, 2, 4, 5 y 6). Se validó aparte, directo
contra la base, dentro de transacciones con `ROLLBACK` (sin dejar datos): `crear_entrega` sobre un
pedido "Sin cliente" generó `ENT-2026-0140` sin error; `crear_recepcion` sobre una OC con
proveedor escrito a mano generó `REC-2026-0018` sin error. Igual conviene que lo repitas una vez
desde la UI cuando llegues acá, para confirmar también el mensaje en pantalla.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 3.1 | Nuevo Pedido dejando el cliente en **"Sin cliente"**. Cargá un producto y guardá | Se crea normal |
| 3.2 | Confirmalo y generá la entrega | **Se genera bien.** Antes tiraba el error de "pedido no encontrado" |
| 3.3 | Lo mismo con un pedido **con** cliente | Sigue funcionando igual que siempre |
| 3.4 | **Compras** (mismo bug, mismo fix): Orden de Compra escribiendo el proveedor a mano, sin elegirlo de la lista. Generá la Recepción | Se genera bien |

---

## 4. Mapa de Relaciones — cadena antes de facturar

**Por qué:** el Mapa estaba anclado en la factura. Si la cadena no llegó a facturarse, mostraba
un solo nodo suelto y el tramo Cotización → Pedido → Entrega era invisible.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 4.1 | Abrí una **Entrega sin facturar** que venga de un pedido → "Mapa de relaciones" | Se ve la cadena completa: **Cotización → Pedido → Entrega**, con la entrega marcada **ACTUAL** |
| 4.2 | Lo mismo desde el **Pedido** | Misma cadena, con el pedido marcado ACTUAL |
| 4.3 | Lo mismo desde la **Cotización** | Misma cadena, con la cotización marcada ACTUAL |
| 4.4 | Abrí el Mapa de **COT-00027** (la de los 3 pedidos) | Tienen que aparecer **los 3 pedidos**, no solo uno |
| 4.5 | Clic en cualquier nodo del mapa | Abre el preview de ese documento con sus ítems |
| 4.6 | Abrí el Mapa de una venta **ya facturada** (las de siempre) | **No se rompió nada**: sigue mostrando la cadena completa hasta la factura, NC/ND, devoluciones y cobros |

> 4.6 es importante: se tocó un componente compartido por Ventas **y** Compras. Mirá también el
> Mapa de una **Factura de Compra** y de una **Recepción**.

---

## 5. Detalle de Entrega — cabecera nueva

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 5.1 | Ventas → Entregas → abrí cualquier entrega | Modal a **pantalla completa**, igual que Cotizaciones y Pedidos |
| 5.2 | Mirá la cabecera | Grilla con: Estado, Origen, Fecha, Unidades entregadas, Cliente, CUIT/DNI, Domicilio, Pedido de origen, Remito, CAI, Vto. CAI, Factura |
| 5.3 | Verificá que los datos sean **correctos**, no solo que aparezcan | Compará el CUIT y el domicilio contra la ficha del cliente. Las unidades tienen que ser la suma de los ítems |
| 5.4 | Entrega **sin remito emitido** | En "Remito" dice *"Sin emitir"* arriba, y abajo aparece el botón **Emitir remito** |
| 5.5 | Emití el remito | El número aparece arriba en la grilla y el botón de emitir desaparece (no tiene que quedar duplicado) |
| 5.6 | Descargá el PDF del remito | El PDF **NO** cambió: solo los datos obligatorios de ARCA (emisor con CUIT y cond. IVA, número, fecha, CAI + vencimiento, receptor, detalle **sin precios**, firma) |
| 5.7 | Entrega **anulada** y entrega **ya facturada** | En ninguna de las dos aparece "Facturar Entrega" |
| 5.8 | Entrega del **POS** (origen "Manual" vs "POS") | Las del POS ya vienen facturadas, no ofrecen facturar |

---

## 6. Regresión — que no hayamos roto lo de antes

Se tocaron archivos compartidos, así que hay que barrer alrededor.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 6.1 | **Editar** una cotización en borrador: cambiá cantidad, precio, % descuento e IVA de una línea | Guarda bien, los totales dan y el Historial de cambios muestra solo lo que cambió |
| 6.2 | Editar un **Pedido** en borrador | Ídem |
| 6.3 | Editar una **Orden de Compra** en borrador/enviada | Ídem |
| 6.4 | En cualquiera de esos formularios, poné **150** en un % de descuento | Se limita a 100%. El total **nunca** puede quedar negativo |
| 6.5 | Editando un documento, borrá el precio de una línea y guardá | Te **frena con un error claro**. NO puede desaparecer la línea en silencio |
| 6.6 | Mientras editás, fijate que **no exista** el botón "Limpiar" | Solo aparece al crear, nunca al editar (si no, guardaba un duplicado) |
| 6.7 | Atajo **Enter** en la grilla de ítems (Cotización, Pedido, OC) | Selecciona el producto del desplegable y salta el foco a Cantidad |
| 6.8 | Circuito completo de POS/Modo Caja: una venta normal con Efectivo | Sin cambios, todo igual que siempre |
| 6.9 | Facturar un **Pedido** desde el detalle del pedido | Funciona (aunque abre la pantalla del POS — ver el aviso del principio) |

---

## 7. Datos de prueba que dejamos

Están en la base y **no hace falta borrarlos**, pero para que no te confundan:

- Pedidos **PED-20260814-001, -002, -003, -004**
- Entregas **ENT-2026-0136** y **ENT-2026-0137**
- Cotización **COT-00029**
- Movieron stock real de **Batidora Eléctrica** y **Camiseta Argentina**

Si querés dejar limpio, se pueden cancelar/anular (la anulación de entrega repone el stock).

---

## Qué NO está terminado (no lo reportes como bug)

1. **"Facturar Entrega" y "Facturar Pedido" abren el POS** en vez del formulario de factura del
   ERP → se arregla el 15/08.
2. **Duplicar documentos** (estilo SAP) → pedido por Luciano, todavía no construido.
3. **Compras** no recibió nada de esta tanda: generar una Recepción desde una OC sigue dejándote
   en la OC, no te lleva a la recepción. Es a propósito: primero se cierra Ventas y después baja
   todo junto a Compras.
4. Del plan `PLAN_COMPROBANTES_ESTANDAR.md` faltan las Fases 2/3/4: Factura de Venta (Enter +
   Neto/IVA en pantalla), NC/ND (buscador de producto + IVA visible) y Devoluciones (modal más
   grande + Neto/IVA).
