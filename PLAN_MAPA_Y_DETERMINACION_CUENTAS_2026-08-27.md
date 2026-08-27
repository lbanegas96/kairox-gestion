# Plan de ejecución — Mapa de Relaciones + Motor de Determinación de Cuentas (27/08)

Plan por fases, cada una un punto de corte seguro (queda todo funcionando aunque no se llegue a
la siguiente). Orden: primero lo de bajo riesgo (UI, solo lectura), después lo que toca el
asiento contable real de cada venta.

---

## Contexto — qué encontramos

**Bug 1 (Mapa de Relaciones):** abrir el mapa desde una Cotización se corta en Entrega, aunque el
circuito real llegó hasta la Factura. Causa: `cotizaciones.comprobante_id` solo se escribe en la
conversión directa Cotización→Factura; en el camino real (Cotización→Pedido→Entrega→Factura) nunca
se toca. El mapa, al abrirse desde la cotización, solo mira ese campo — nunca camina hacia los
pedidos para ver si alguno ya se facturó. Confirmado contra datos reales: `COT-00032.comprobante_id`
= null, pero su pedido `PED-20260815-001.comprobante_id` sí apunta a una factura real.

**Bug 2 (Mapa de Relaciones):** una factura pagada al contado no muestra el pago en ningún lado.
El pago existe (`movimientos_caja`, ingreso real con fecha/monto/medio) pero el mapa solo consulta
`cuenta_corriente_movimientos` (la tabla de cancelación de deuda CC) — vacía para una venta que
nunca tuvo deuda que cancelar, porque se cobró en el momento.

**Motor de Determinación de Cuentas:** al investigar el bug 2 aparece algo más grande. Todo el
motor de asientos (`planCuentasService.ts` + varios RPC en SQL) hardcodea qué cuenta contable usa
cada tipo de movimiento (`findCuentaByCodigo(empresaId, '1.1.1')`, etc.) — ~25+ "cables" fijos solo
en ese archivo. KAIROX ya construyó UNA VEZ el patrón correcto para esto
(`determinacion_cuentas_mayor` + `DeterminacionCuentasTab.jsx`, inspirado explícitamente en el
account determination de SAP) pero angosto: solo sirve para clasificar movimientos bancarios
importados al conciliar, nunca se generalizó al resto. Se decide generalizar ese mismo patrón en
vez de agregar un parche puntual.

**Decisión ya tomada** (no traer el plan de cuentas completo de SAP): KAIROX no tiene el archivo
propietario del AR_COA de SAP, y aunque lo tuviera, la mayoría de esas cuentas quedarían sin usar
en una PyME. Se agregan solo las cuentas puntuales que necesite cada cable nuevo — aditivo, no un
reemplazo del plan de cuentas actual.

---

## Fase 1 — Mapa de Relaciones: la cadena desde Cotización llega hasta la Factura

**Riesgo: bajo.** Solo lectura, lógica de UI (`MapaRelaciones.jsx`), no toca ningún dato ni asiento.

- `resolveAndFetch` (rama `cotizacionId`): si `cotizaciones.comprobante_id` es null, en vez de ir
  directo a "sin facturar", camina los pedidos de la cotización (`pedidos.cotizacion_id`) y busca
  si alguno tiene `comprobante_id` propio.
- Diseño ya acordado: **rama por pedido** — si hay más de un pedido facturado, el mapa muestra la
  cotización arriba y, debajo de cada pedido, su propia cadena hasta la factura que le
  corresponda (mismo espíritu que "Otras facturas de este pedido", un nivel más arriba).
- De paso, un segundo hallazgo menor del mismo código: `fetchCadenaPreFactura` solo trae entregas
  del primer pedido encontrado, no de todos — se corrige en la misma pasada ya que se está tocando
  esa función.

**Punto de corte:** funcional y desplegable solo, no depende de nada de las fases siguientes.

---

## Fase 2 — Mapa de Relaciones: mostrar el pago cuando la factura se cobró al contado

**Riesgo: bajo.** Solo lectura, una query nueva + un tipo de nodo nuevo en el mapa.

- `fetchMapaVenta`: agrega una consulta a `movimientos_caja` (`tipo='ingreso'`,
  `comprobante_id=idComprobante`), en paralelo a la que ya existe contra
  `cuenta_corriente_movimientos`.
- Nuevo tipo de nodo, distinto de "Cobro CC" (que es específicamente cancelación de deuda vía
  Cuenta Corriente) — ej. "Cobro en Caja" o "Pago al Contado", con medio de pago y monto.
- No reemplaza nada existente: una venta a Cuenta Corriente sigue mostrando su "Cobro CC" como
  hoy; esto cubre el caso que hoy no muestra nada.

**Punto de corte:** funcional y desplegable solo. Con esto ya queda resuelto el pedido original
completo del Mapa de Relaciones, independiente de si se sigue a la Fase 3 o no.

---

## Fase 3 — Determinación de Cuentas: esquema base (sin conectar nada todavía)

**Riesgo: medio.** Infraestructura nueva, pero nada la consume todavía — cero riesgo de romper un
asiento real en esta fase.

- Tabla nueva `determinacion_asientos`: `empresa_id`, `codigo_cable` (identificador estable, ej.
  `venta.cobro_efectivo`), `cuenta_contable_id`, `descripcion`, `modulo` (para agrupar en la UI).
- RPC de resolución `obtener_cuenta_determinada(empresa_id, codigo_cable)` — devuelve la cuenta
  configurada, y si no hay fila, cae al código hardcodeado de hoy (retrocompatible: ninguna
  empresa existente cambia de comportamiento con solo esta fase).
- Seed automático: cada empresa (incluida Nalux) arranca con sus cables ya sembrados apuntando a
  las mismas cuentas que usa hoy — el paso de "activar" el motor no mueve nada por sí solo.

**Punto de corte:** se puede quedar acá indefinidamente sin ningún efecto visible en producción.

---

## Fase 4 — Determinación de Cuentas: cablear medios de pago (el pedido original)

**Riesgo: alto.** Esto sí toca el asiento real de cada venta nueva — requiere probar a fondo
(`BEGIN...ROLLBACK` contra Nalux real) antes de aplicar.

- `formas_pago` gana `cuenta_contable_id` (columna nueva, nullable) — Efectivo apunta directo a una
  cuenta "Caja"; los medios con `cuenta_bancaria_id` ya resuelven su cuenta contable a través de
  `cuentas_bancarias.plan_cuenta_id` (esa cadena ya existe, mig.214/011).
- `crearAsientoVenta` (JS) y `registrar_cobro_cliente` (SQL) dejan de hardcodear `codigo = '1.1.1'`
  para el cobro al contado — consultan la determinación según la forma de pago elegida.
- UI: extender `DeterminacionCuentasTab.jsx` (o una sección hermana) para configurar estos cables
  sin depender de nosotros — mismo patrón de tabla + modal que ya existe y funciona para la parte
  bancaria.
- Históricos: lo ya contabilizado en `1.1.1` queda como está — el cambio rige para adelante.

**Punto de corte:** acá termina el alcance de esta tanda. El pedido original (medios de pago con
su propia cuenta, configurable, estilo SAP) queda resuelto de punta a punta.

---

## Fuera de alcance de esta tanda (backlog, a propósito)

- Extender el mismo motor de determinación al resto de los ~20 cables restantes (compras, ajustes
  de inventario, notas de crédito/débito, etc.) — mismo patrón, se hace cable por cable cuando se
  priorice, no en esta pasada.
- Determinación de cuentas por Cheques (`1.1.6`, ya existe la cuenta pero nunca se usa desde una
  venta) — candidato natural para una fase futura, mencionado pero no incluido acá.
- Plan de cuentas ampliado estilo SAP completo — descartado por ahora (ver "Decisión ya tomada"
  arriba).

---

## Verificación en cada fase

- `npx eslint`, `npx vitest run` antes de cada commit.
- Fases 3/4: `BEGIN...ROLLBACK` contra Nalux real antes de aplicar cualquier migración.
- Fases 1/2: verificación en vivo en el navegador contra el caso real que reportó Luciano
  (COT-00032 → PED-20260815-001 → FAC-20260815-001) antes de dar por cerrada cada fase.
- Commit + CONTEXT.md al cierre de cada fase (no al final de todo), para que el corte entre fases
  quede documentado aunque no se llegue a la siguiente.
