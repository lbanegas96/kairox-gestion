# Plan de pruebas — para cuando vuelvas (24/08)

Todo lo de abajo está commiteado, pusheado y deployado a producción. Nada de esto se probó en el
navegador todavía (la sesión de prueba quedó deslogueada) — es lo primero que hay que mirar.

---

## 1. Multi-PdV con letra (A/B/C) — lo más importante de probar

Hoy Nalux tiene un solo PdV facturable ("Punto de Venta Principal"), así que **nada se ve distinto
todavía** hasta que cargues un segundo PdV real. La prueba tiene que crear ese segundo PdV para
que el filtro tenga algo que filtrar.

### 1.1 — Crear un segundo PdV y configurarle letras distintas

1. Configuración → Facturación → "+ Nuevo PdV".
2. Cargalo con un número real (ej. el que tenga el PdV nuevo en ARCA), nombre distinto (ej.
   "Sucursal Once").
3. Abajo del switch "Solo para remitos" tiene que aparecer un bloque nuevo **"Factura los tipos"**
   con 3 checkboxes: Factura A / Factura B / Factura C — vienen las 3 tildadas por defecto.
4. Destildá, por ejemplo, "Factura A" (dejá solo B y C) y guardá.
5. Volvé a la tabla de PdV — tiene que haber una columna nueva **"Letras"** (puede estar oculta en
   pantallas chicas, ensanchá la ventana si no la ves) mostrando qué letras tiene cada uno: el
   Principal con "A B C", el nuevo con "B C".

### 1.2 — "Punto de venta por defecto, según letra"

Con 2 PdV facturables activos, debería aparecer un bloque nuevo debajo de "Punto de venta del Modo
Caja" con 3 selectores (Factura A / B / C):

1. El selector de "Factura A" debería tener solo al Principal (el único que la tiene habilitada) —
   y no debería dejarte elegir el PdV nuevo ahí, porque no la tiene tildada.
2. Los selectores de "Factura B" y "Factura C" deberían tener a los dos PdV para elegir.
3. Elegí el PdV nuevo como default de "Factura B", guardá, recargá la página y confirmá que quedó
   guardado (no que volvió al Principal).

### 1.3 — Nueva Factura reacciona a la letra elegida

1. Ventas → Facturas → "Nueva Factura".
2. Con "Tipo de documento" en Ticket (el default al abrir), el selector de "Punto de venta"
   debería mostrar los dos PdV — sin relación con letra, igual que antes de este cambio.
3. Cambiá "Tipo de documento" a "Factura A" — el selector de "Punto de venta" tiene que quedarse
   SOLO con el Principal (el nuevo no tiene A habilitada, no debería aparecer en la lista).
4. Cambiá a "Factura B" — ahora debería aparecer el PdV que marcaste como default de B ya
   preseleccionado, con la opción de cambiar al Principal si querés (los dos tienen B).
5. Volvé a Ticket — debería volver a mostrar los dos PdV sin restricción.

### 1.4 — Qué NO debería romperse (regresión)

- Facturar como venía haciéndolo hasta ahora con el PdV Principal solo, sin tocar la
  configuración nueva — tiene que comportarse exactamente igual que ayer.
- El PdV "Remito" no debería aparecer en ningún lado de esto (ni en "Letras" de la tabla con un
  valor real, ni en los selectores de Nueva Factura) — sigue siendo exclusivo para remitos.

---

## 2. Seguridad — REVOKE de 3 funciones (chequeo rápido, no debería notarse nada)

Esto es un endurecimiento interno, no debería cambiar nada visible. Igual, para estar tranquilos:

1. Cuenta Corriente → Clientes → "Registrar Cobro" sobre alguna factura pendiente real → confirmar
   que el cobro se registra normal (esto usa `registrar_cobro_cliente`, una de las 3 funciones
   tocadas).
2. Cuenta Corriente → Proveedores → "Registrar Pago" → confirmar que también anda normal (usa
   `registrar_pago_proveedor`).
3. Si alguno de los dos tira un error de permisos que antes no tiraba, avisame — sería señal de
   que el REVOKE se pasó de rosca (no debería, ya lo probé con `BEGIN...ROLLBACK` antes de
   aplicarlo, pero la prueba real en pantalla es la que manda).

---

## 3. Pendiente — no depende de probar nada, depende de una decisión tuya

**Catálogo de productos (3.380 productos)** — sigue sin resolver. Cuando puedas, decime si:
- (a) retomamos el scraping de Open Food Facts Argentina desde cero (se perdió el CSV viejo), o
- (b) seguimos con carga manual/parcial, o
- (c) lo dejamos en pausa indefinida.

---

## Si algo falla

Anotá exactamente qué paso, qué esperabas ver y qué viste en cambio — con eso alcanza para que lo
diagnostique rápido cuando retomemos. No hace falta que lo arregles vos ni que canceles nada a
mano; si algo queda en un estado raro mientras probás, avisame antes de tocar la base a mano.
