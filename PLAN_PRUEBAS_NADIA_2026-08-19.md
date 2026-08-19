# Plan de pruebas para Nadia — 19/08

Todo lo de abajo se hizo el 18/08 (noche), ya está commiteado, pusheado a `master` y deployado en
Vercel producción. Nadie lo probó todavía con ojos humanos — la idea es que lo recorras mañana
contra Nalux real y me digas qué encontrás para seguir reparando.

Commits del día (de más viejo a más nuevo), por si querés ver el diff de alguno puntual:
```
07ee543 fix(arca): grants faltantes tras la migracion de cuenta + cierre de verificacion
f2b17b2 fix(ventas): 7 ajustes UX de Nueva Factura y Registrar Cobro
050bead fix(pedidos): pedido pasaba a Facturado antes de tiempo con facturacion parcial
55cd5c9 fix(ventas): NC revierte cantidad_facturada y pregunta si reabrir el pedido
083bf5d feat(compras): facturacion parcial de OC + NC de proveedor reabre (o no) la OC
7fd326c fix(compras): 4 ajustes UX de Ordenes de Compra
```

---

## 1. AFIP — grant faltante corregido (verificación rápida)

Encontramos que `fn_persistir_cae_emitido` no tenía permiso para `service_role` tras la migración
de cuenta — el CAE se emitía en ARCA pero no se guardaba. Ya corregido y verificado con una
Factura C real (`FAC-20260816-003`, CAE `86330766483733`).

- [ ] Facturar algo con AFIP activo (Factura A/B/C, PdV que envía a ARCA) y confirmar que el CAE
      llega solo, sin quedar en "CAE pendiente" para siempre.

## 2. Nueva Factura de Venta + Registrar Cobro — 7 ajustes UX

- [ ] Abrir "Nueva Factura de Venta", hacer foco en Descripción de un ítem **sin tipear nada** →
      debe listar productos igual (antes exigía 2+ caracteres).
- [ ] Cargar un **Desc%** con un solo tipeo, sin tener que borrar el "0" primero (mismo chequeo en
      Cantidad y Precio Unit.).
- [ ] Editar cantidad/precio/descuento de un ítem y mirar que la columna **Subtotal** se actualice
      en vivo (era solo de lectura, ya funcionaba, quedó confirmado).
- [ ] Crear una factura real → el modal **no debe cerrarse solo** — tiene que quedar una pantalla
      de confirmación con "Registrar Cobro" y "Cerrar (Esc)".
- [ ] Desde esa pantalla, click en "Registrar Cobro" → tiene que abrir **Cuenta Corriente con esa
      factura ya tildada** y el monto precargado con su saldo (antes arrancaba en $0 sin nada
      marcado).
- [ ] Repetir "Registrar Cobro" desde el detalle de una factura ya existente (`SaleDetailModal`) —
      mismo resultado.
- [ ] En el diálogo de Cobro: tildar **dos facturas** de un mismo cliente, cobrar **menos** que la
      suma de ambas, y confirmar que alguna queda con "Queda pendiente: $X (Y%)" — el sistema tiene
      que dejarla abierta por la diferencia, no rechazar el cobro.

## 3. Pedidos — no pasa a "Facturado" antes de tiempo

- [ ] Armar (o buscar) un pedido con **2+ ítems**, entregar y facturar **solo uno** → el pedido
      tiene que quedar en "En Preparación" (no "Facturado"), y el botón "Facturar Pedido" sigue
      visible para completar el resto.
- [ ] Facturar el ítem que faltaba → recién ahí pasa a "Facturado".

## 4. Nota de Crédito de Ventas reabre (o no) el Pedido

- [ ] Con un pedido ya "Facturado" (completo), hacer una **Nota de Crédito** sobre una de sus
      facturas (desde el historial de ventas, "Copiar a NC") → tiene que aparecer un diálogo
      "¿Reabrir el pedido X?" con dos opciones: **"Reabrir pedido"** (vuelve a "En Preparación", el
      botón "Facturar Pedido" reaparece) y **"Dejar cerrado"** (no cambia nada).
- [ ] Confirmar que una NC sobre una factura **sin pedido de por medio** (standalone) no dispara
      ningún diálogo.

## 5. Compras — Órdenes de Compra ahora admiten varias facturas parciales

Antes una OC solo admitía **una** Factura de Proveedor para siempre. Ahora es como Ventas: se
puede facturar en partes, la OC pasa a "Facturada" (nuevo estado, badge violeta) recién cuando
está 100% facturada, y una NC de proveedor puede reabrirla.

- [ ] Elegir una OC con 2+ ítems recibidos → "Registrar Factura del Proveedor", facturar **solo
      un ítem** → la OC tiene que seguir en "Recibida" (no "Facturada"), y el botón sigue
      disponible para el resto.
- [ ] Facturar el ítem que faltaba → la OC pasa a **"Facturada"** (badge violeta), se listan las
      2 facturas parciales, y el botón "Registrar Factura" desaparece.
- [ ] Desde "Facturas de Compra", hacer "Copiar a NC" sobre una de esas 2 facturas → tiene que
      aparecer "¿Reabrir la Orden de Compra X?" con las mismas dos opciones de arriba. Probar las
      dos ramas.
- [ ] Confirmar que el ítem de la NC viene **precargado con el producto correcto** (no en blanco) —
      si no lo trae, la reversión no funciona y hay que avisarme.

## 6. Compras — Órdenes de Compra, 4 ajustes UX

- [ ] En el listado de OC, click en **cualquier parte de la fila** (no solo el ícono del ojo) →
      tiene que abrir el detalle.
- [ ] "Nueva OC": hacer foco en **Proveedor** sin tipear nada → tiene que listar todos los
      proveedores (antes exigía escribir).
- [ ] Mismo chequeo en el buscador de **Producto** de cada ítem.
- [ ] Campo **"Entrega esperada"**: confirmar que se ve el ícono de calendario (no solo texto
      "dd/mm/aaaa") y que se puede elegir la fecha con el selector, no solo tipeándola.

---

## Pendiente sin decidir — no tocar

- **MP QR webhook**: reapuntarlo a `https://isvkelrdxwvkfmrfqxxk.supabase.co/functions/v1/mp-webhook`
  y probar un cobro real chico desde el POS. Sigue a cargo de Luciano.
- **MELI Factura A**: sin alcance definido (¿se elige al facturar un pedido de MercadoLibre, o es
  un atributo de la publicación?). No construir nada ahí hasta que Nadia confirme el alcance.
- **El mismo patrón de "reapertura" en Compras vs Ventas** ya quedó simétrico — si aparece algún
  caso raro (por ejemplo, NC parcial que solo acredita parte de un ítem, o varias NC seguidas sobre
  la misma factura) anotar el caso puntual para revisarlo, no asumir que está cubierto.

## Si algo falla

Anotá: qué documento (número), qué acción hiciste, qué esperabas y qué pasó en realidad. Con eso
alcanza para reproducirlo rápido mañana.
