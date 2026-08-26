# Plan de prueba integral — Ferretería (cuenta nueva, de punta a punta)

Pedido de Nadia (26/08): crear una empresa nueva y usarla "como si fuera real" — un negocio
completo, con datos argentinos que anden de verdad, probando cada módulo de la app y dejando
documentado qué se rompe para arreglarlo. Con cuidado de no llenar el plan free de Supabase (ver
sección de volumen de datos, abajo).

---

## 0. Por qué ferretería (investigado, no elegido a ojo)

Buscando cómo operan los distintos rubros chicos en Argentina:

- **La mayoría de los kioscos y almacenes son monotributistas** → siempre facturan **Tipo C**
  (sin discriminar IVA), a cualquier cliente. Simple, pero prueba poco: nunca se ve una Factura A,
  nunca hay IVA Crédito/Débito Fiscal en juego.
- **Una ferretería mediana suele ser Responsable Inscripto**: le compra a distribuidoras/mayoristas
  que le facturan A (IVA discriminado — [Dux Software](https://duxsoftware.com.ar/blog/factura-a-vs-factura-b-cuando-usar-cada-una),
  [iProfesional](https://www.iprofesional.com/impuestos/435201-arca-que-es-una-factura-a-b-c-o-m-y-quien-puede-emitir-cada-una)),
  vende a particulares (Ticket/Factura B) y a contratistas/otras empresas con cuenta corriente
  (Factura A). Es el régimen que más tipos de comprobante mezcla en un solo negocio real.
- **Los cheques de pago diferido son un instrumento central de financiamiento entre PyMEs**
  ([ChequeAR](https://chequearapp.com.ar/blog/cheques-pago-diferido)) — muy usados entre
  ferreterías/distribuidoras y sus proveedores, a diferencia de un kiosco que opera casi todo en
  efectivo.
- Buena práctica confirmada para cuenta corriente de proveedores: **nunca dejar un pago "a cuenta"
  sin imputar a una factura concreta** ([PymeInteligente](https://www.pymeinteligente.com.ar/blog/cuenta-corriente-de-proveedores)) —
  esto ya es justo el criterio que sigue `registrar_pago_proveedor` en KAIROX (imputación
  explícita), así que la prueba puede confirmar que se respeta en la práctica.

**Conclusión:** ferretería Responsable Inscripto es el negocio que, operando de forma 100% normal,
obliga a pasar por Factura A + B + Ticket, Cuenta Corriente de clientes Y de proveedores, cheques
propios y de terceros, y compras con IVA discriminado — todo en un solo flujo de negocio real, sin
forzar nada.

---

## 1. El negocio (ficticio, no una empresa real)

- **Nombre:** Ferretería El Tornillo — nombre genérico a propósito, mismo patrón que "El Clavo" o
  "La Llave" (locales de barrio), para que quede claro que es de prueba y no imite a ningún negocio
  real existente.
- **Ubicación:** Merlo, Provincia de Buenos Aires (genérica, no una dirección real).
- **Condición fiscal:** Responsable Inscripto.
- **AFIP/ARCA:** **queda apagado** (switch "Facturación Electrónica AFIP/ARCA" en Configuración →
  Facturación). No tenemos certificado ni CUIT real de homologación para una empresa inventada —
  prender esto sin eso rompería antes de arrancar. Los comprobantes se emiten igual (Factura
  A/B/Ticket), sólo que como documento interno sin CAE — es exactamente lo que la app ya soporta
  para el caso "el local no emite factura electrónica", y no resta nada a lo que hay para probar:
  el circuito AFIP real ya está cubierto por Nalux.

---

## 2. Volumen de datos — techos explícitos, para no repetir el susto del Supabase viejo

Todo esto entra varias veces en el plan free sin acercarse a ningún límite (memoria: 500 MB de
base, y el problema de la vez pasada no fue tamaño sino otra cosa — igual, cuidado por las dudas).
Techos duros, no aproximados:

| Qué | Cantidad tope |
|---|---|
| Productos | 18 |
| Categorías | 3 |
| Proveedores | 3 |
| Clientes con nombre (+ Consumidor Final, que ya existe siempre) | 4 |
| Órdenes de Compra | 3 |
| Facturas de Compra | 4 |
| Cotizaciones | 2 |
| Pedidos | 2 |
| Entregas | 3 |
| Facturas de Venta | 15 |
| Devoluciones | 2 (1 cliente + 1 proveedor) |
| Cheques (propios + de terceros) | 6 |
| Movimientos de caja manuales | 4 |
| Líneas de extracto bancario (CSV chico) | 10 |
| Recuentos de Inventario | 1 |
| Revalorizaciones de Inventario | 1 |

Todo cargado **por la interfaz real**, uno por uno, como lo haría un empleado — nada de inserts
masivos por SQL. Es la única forma de que la prueba encuentre bugs reales (un insert directo se
saltea toda la lógica de RPCs/validaciones donde suelen vivir los bugs).

---

## 3. Línea de tiempo simulada

Todo dentro de una ventana corta y reciente (últimas ~3 semanas de agosto 2026), no fechas
dispersas en el año — más fácil de seguir y de auditar al final.

---

## 4. Fases (orden de ejecución)

### Fase 0 — Alta y configuración
1. Nadia crea la cuenta y la empresa (razón social, CUIT ficticio con dígito verificador válido,
   condición IVA = Responsable Inscripto).
2. Yo entro con su sesión ya logueada y reviso/completo: Plan de Cuentas (seed por defecto),
   Punto de Venta Principal, categorías (Herramientas / Materiales de Construcción / Pinturas y
   Accesorios), formas de pago habilitadas (Efectivo, Transferencia, Tarjeta, Cuenta Corriente,
   Cheque).

### Fase 1 — Catálogo (18 productos)
Ferretería real: tornillos y clavos (con venta por unidad y por caja), pintura (venta por litro),
herramientas manuales (martillo, destornillador, pinza), una herramienta eléctrica (taladro),
cinta métrica, cemento (bolsa, venta por peso si aplica), guantes de trabajo, candado, cerradura.
Precios con rango amplio a propósito ($150 el tornillo suelto → $85.000 el taladro) — bueno para
probar redondeo y cálculo de IVA en ambos extremos. Costo y stock inicial cargados a mano para
cada uno (no en $0 — a diferencia de Nalux, acá no hay excusa del import viejo).

### Fase 2 — Proveedores y Compras
- **2 proveedores:** una distribuidora mayorista (Responsable Inscripto, factura A) y un
  fabricante chico (monotributista, factura C) — para probar que Compras discrimina IVA en un
  caso y no en el otro.
- Una Orden de Compra → Recepción → Factura de Compra completa (3-way match).
- Una Compra Rápida (factura de contado, sin pasar por OC).
- Un pago a proveedor con cheque propio (a 30 días) + un pago en efectivo imputado a una factura
  puntual — nunca "a cuenta" sin destino, seguimos la buena práctica que confirma la
  investigación.
- Una Nota de Crédito de proveedor (por una devolución de materiales dañados).

### Fase 3 — Clientes y Ventas
- **4 clientes con nombre:** un contratista/constructora (compra grande, Cuenta Corriente,
  Factura A), un cliente particular frecuente (Factura B, a veces fía), un cliente nuevo que paga
  siempre de contado, y un cliente moroso a propósito (para que el reporte de Antigüedad de Deuda
  tenga algo real que mostrar).
- Circuito completo al menos una vez: Cotización → Pedido → Entrega → Factura (para probar
  `documentFlowService`, el Mapa de Relaciones).
- Ventas de mostrador por el POS (Punto de Venta): Ticket con efectivo, Ticket con tarjeta,
  Factura B a un particular.
- Al menos una venta con **Factura de Reserva** (Stock Comprometido) — el contratista reserva
  bolsas de cemento que retira en 3 días — para probar mig.349/350 con datos frescos, no los
  viejos de Nalux.
- Una Nota de Crédito a cliente (devolución parcial) + una Nota de Débito (flete cobrado aparte).

### Fase 4 — Finanzas
- Cheques de terceros recibidos como pago de clientes (al menos 2), depositados.
- Movimientos de caja manuales: un retiro para gastos chicos, un ingreso de aporte.
- Cuenta bancaria + un extracto CSV chico (10 líneas) importado y conciliado contra los
  movimientos ya cargados.
- Cierre de una sesión de caja con arqueo.

### Fase 5 — Devoluciones
- Devolución de cliente con reingreso de stock + Nota de Crédito.
- Devolución a proveedor (ya cubierta en Fase 2, se revisa acá el flujo completo end-to-end).

### Fase 6 — Inventario
- Un Recuento de Inventario acotado por categoría, con 1 faltante y 1 sobrante a propósito.
- Una Revalorización de Inventario sobre 2-3 productos.
- Un Ajuste masivo de precios (mig.354) con un porcentaje chico, sobre datos que sí tienen sentido
  subir esta vez — a diferencia de la prueba de hoy, acá el aumento va a significar algo real
  dentro de la propia narrativa (es una ferretería con precios recién cargados, no hace falta
  "inflación" — mejor probarlo como recategorización de precios por proveedor, o simplemente
  omitir el motivo y dejarlo como prueba técnica declarada, sin pretender que sea inflación real).

### Fase 7 — Casos límite
- Cancelar una factura que nunca llegó a tener CAE (no aplica acá al estar AFIP apagado — cae_estado
  siempre 'no_aplica' — de todos modos se prueba que `cancelar_factura` funciona y no rompe nada).
- Opcional, si da el tiempo: dar de alta un segundo Punto de Venta ("Reparto a domicilio") y
  probar Multi-PdV con letra (mig.352/353) con datos reales de un negocio de verdad, no el PdV de
  prueba que se creó en Nalux.

### Fase 8 — Reportes y cierre
Revisar Dashboard, Reportes, Libro IVA, Balance de Comprobación, Estado de Resultados, Cta.
Corriente (clientes y proveedores), Cheques pendientes — todo tiene que reflejar exactamente lo
cargado en las fases anteriores.

### Fase 9 — Deferido a propósito hasta el final
**Tiendanube y MercadoPago no se tocan hasta que Nadia los conecte manualmente** (OAuth requiere
que lo haga ella desde su sesión). Cuando estén conectados, se prueba publicación de catálogo y
sincronización de stock/pedidos como última fase, separada de todo lo de arriba.

---

## 5. Cómo se documentan los hallazgos

Cada fase se cierra con una entrada en `CONTEXT.md` (mismo formato que se usó en toda esta sesión):
qué se probó, qué anduvo bien, qué se rompió y cómo se arregló (con el mismo criterio de siempre —
`BEGIN...ROLLBACK` antes de aplicar cualquier fix a la base). Al final de las 9 fases, un resumen
único con la lista completa de bugs encontrados/arreglados y lo que haya quedado incompleto a
propósito.

---

## 6. Qué necesito de Nadia para arrancar

1. Crear la cuenta y la empresa nueva (razón social "Ferretería El Tornillo" o el nombre que
   prefiera, condición IVA Responsable Inscripto).
2. Avisar cuando esté adentro, con la sesión logueada en el navegador — desde ahí sigo yo,
   fase por fase, narrando cada paso a medida que lo hago.
