# Plan de pruebas — Nadia — 18/08/2026

**Estado: probado en vivo con Nadia el 18/08.** Puntos 1 a 4 verificados paso a paso contra Nalux
real (`FAC-20260818-001` Factura de Reserva $30.000 a Nadia Tecera, `FAC-20260818-002` factura
normal $3.000 a Carlos Perez). Punto 5 confirmado con `PED-20260811-002` (precarga a lo entregado)
y con un pedido de prueba armado para el 5.5 — que además destapó un **bug real** (pedido pasaba a
"Facturado" de golpe al facturar sólo una parte, perdiendo el botón para facturar el resto). Ya
corregido y reverificado en vivo — ver `CONTEXT.md`, sección "Sesión 2026-08-18".

Todo lo de acá se construyó la noche del 15/08 (los 5 frentes de "Facturar Pedido") y se
verificó por mi lado en vivo, pero por navegador/base de datos — nadie lo clickeó de punta a
punta con ojos humanos todavía. Justo por ese motivo la última vez (Facturar/Cobrar) aparecieron
7 detalles de uso que yo no hubiera visto solo.

**Dónde probar:** https://kairox-gestion-chi.vercel.app (tenant Nalux)
**Cómo reportar:** anotá al lado de cada punto ✅ / ❌ + qué viste. Si algo falla, sacá captura y
anotá el número de documento con el que pasó.

---

## 1. El modal de Facturar Pedido, en general (Frente 1 — rediseño)

**Por qué:** el modal era angosto y con el buscador de productos viejo (el mismo bug de
desplegable cortado que ya se había arreglado en Cotización/Pedido/OC, pero acá nunca se migró).

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1.1 | Ventas → Pedidos → abrí un pedido en `en_preparacion` → "Facturar pedido" | El modal ocupa casi toda la pantalla, con la grilla densa (como Cotización/Pedido/OC) |
| 1.2 | Buscá un producto en el buscador de un ítem | El desplegable se ve completo, no se corta contra el borde |
| 1.3 | Seleccioná un producto del desplegable | El foco salta solo a Cantidad, **sin** abrirse otro desplegable solo |
| 1.4 | Si el pedido tiene varios ítems precargados, mirá bien al abrir el modal | El foco **no** debería saltar solo a ningún campo ni abrir nada — hasta que vos lo toques |
| 1.5 | Achicá la ventana del navegador (o probá en una pantalla más baja) | La tarjeta de Ítems sigue siendo visible y con scroll propio, nunca desaparece |

---

## 2. Botón "Mapa de relaciones" (Frente 3)

**Por qué:** el modal de Facturar Pedido era el único documento del sistema sin este botón.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 2.1 | En el mismo modal de "Facturar pedido", buscá el botón "Mapa de relaciones" | Aparece (antes no existía acá) |
| 2.2 | Hacé clic | Se abre la cadena Cotización → Pedido (marcado ACTUAL) → Entrega (si tiene), sin cerrar el modal de facturación de fondo |
| 2.3 | Cerrá el mapa | El modal de Facturar Pedido sigue intacto con todos los datos que tenías cargados |

---

## 3. El cobro ya no se mezcla con la factura (Frente 5)

**Por qué:** antes esta pantalla se comportaba como el POS (elegís forma de pago, cobra en el
momento). Ahora se comporta como un ERP: la factura queda como deuda y el cobro es un paso
aparte, después, desde Cuenta Corriente.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 3.1 | Abrí "Facturar pedido" o "Nueva Factura" | **No** hay selector de "Forma de pago" (Efectivo/Tarjeta/etc.) — en su lugar, un cartel: *"Esta factura queda pendiente en la Cuenta Corriente del cliente..."* |
| 3.2 | Intentá crear la factura **sin elegir cliente** | Te frena con un aviso — el cliente ahora es obligatorio siempre (antes solo si elegías Cuenta Corriente) |
| 3.3 | Elegí un cliente y confirmá la factura | Se crea. Andá a la ficha del cliente → Cuenta Corriente: la factura aparece como deuda pendiente |
| 3.4 | Verificá que **no** se generó ningún movimiento de caja por esta factura | Bancos/Caja no debería tener nada nuevo — el cobro todavía no pasó |

---

## 4. Factura de Reserva — facturar sin entregar (Frente 4)

**Por qué:** pedido tuyo — poder facturar un pedido completo por adelantado, sin tener que
entregarlo todavía (la entrega se genera después, por separado).

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 4.1 | Abrí un pedido en `en_preparacion` que **todavía no tuvo ninguna entrega** → "Facturar pedido" | Aparece un checkbox "Factura de Reserva — no entregar todavía" |
| 4.2 | Tildalo y confirmá la factura | Se crea la factura, pero el pedido **no** se marca como entregado ni mueve stock |
| 4.3 | Volvé al pedido | Sigue ofreciendo "Generar Entrega" (para cuando de verdad se entregue más adelante) |
| 4.4 | Abrí un pedido que **ya tuvo** una entrega (total o parcial) → "Facturar pedido" | El checkbox de Reserva **no** aparece (no tiene sentido reservar algo que ya se entregó) |

---

## 5. Facturar lo entregado, no lo pedido (Frente 2)

**Por qué:** bug real que encontró Luciano — si entregaste solo una parte de un pedido, el
sistema igual te ofrecía facturar el pedido completo, dejando facturar de más sin darte cuenta.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 5.1 | Buscá un pedido con **entrega parcial** (algunos ítems entregados, otros no) → "Facturar pedido" | Los ítems vienen precargados con la cantidad **entregada**, no la pedida |
| 5.2 | Mirá el banner del modal | Aclara que "los ítems vienen ajustados a lo pendiente de facturar (no lo pedido)" |
| 5.3 | Si algún ítem no tiene nada entregado todavía | Ese ítem **no aparece** en la lista (no se precarga en cero) |
| 5.4 | Buscá un pedido **sin ninguna entrega todavía** → "Facturar pedido" | Sigue precargando la cantidad pedida completa, como siempre (esto no cambió) |
| 5.5 | Un pedido ya facturado al 100% de lo entregado → "Facturar pedido" | Toast: *"Nada pendiente de facturar..."*, sin abrir un formulario vacío o roto |

---

## 6. De paso — los 7 ajustes que ya probó Luciano (opcional, para que los conozcas)

Estos ya quedaron verificados en vivo por Luciano, no hace falta que los reproduzcas — pero si
usás Facturar/Cobrar en el día a día, vas a notar:
- El combo de productos ahora lista al hacer foco (antes exigía tipear 2 letras).
- Desc%/Cantidad/Precio se seleccionan solos al hacer foco (antes había que borrar el "0" a mano).
- La factura ya no se cierra sola al crearla — queda con el botón "Registrar Cobro" a mano.
- Ese botón ahora abre el cobro con la factura ya marcada y el monto precargado.
- El modal de Cobro tiene checkboxes por factura, con "Queda pendiente: $X (Y%)" en pagos parciales.

---

## Datos de prueba que vas a dejar

Cualquier factura que generes en los puntos 3 y 4 queda como dato real en Nalux (no se puede
borrar por diseño, como el resto de los comprobantes). Si no querés cobrarla de verdad, dejala
pendiente en Cuenta Corriente sin más — no rompe nada que quede así.
