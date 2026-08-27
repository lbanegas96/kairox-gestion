# KAIROX Gestión — Contexto de Sesión

## ✅ Resueltos — los 6 hallazgos "documentados, sin corregir" de la Fase 2-5 de Nadia

Luciano pidió arrancar por acá al retomar. Los 6 quedaron cerrados — 4 con fix real, 2 confirmados
como **no ser bugs** tras investigar a fondo (documentado abajo el porqué de cada uno, para no
volver a levantarlos en falso).

### ✅ Corregidos (con evidencia real de producción antes de aplicar)

1. **Fecha ignorada en Nueva Factura de Venta** — el campo se mostraba editable pero el submit
   siempre usaba `getNowAR()`. Fix: `getDateFromInputAR(fecha)`, mismo patrón ya usado en
   `CajaSection`/`CompraRapidaSection`. También corregido en el asiento contable asociado.
2. **`crear_cheque_propio` no imputaba contra la compra vinculada** (mig.358) — asimetría real
   contra `crear_cheque_tercero`. Mismo patrón de imputación, probado con `BEGIN...ROLLBACK`.
3. **`compras_saldo_pendiente` ignoraba `estado_pago='pagada'`** (mig.359) — encontradas **5+
   compras reales de Nalux** (una de $7.500.000) mostrando el saldo completo pendiente pese a estar
   pagadas. Riesgo real de pago duplicado vía "Pagar varias facturas". Fix: `saldo_pendiente=0` si
   `estado_pago='pagada'`. Verificado post-aplicación: 0 casos falsos, sin regresión en pendientes.
4. **NC de proveedor no vinculaba la devolución de origen** (mig.360 + UI) — a diferencia del lado
   cliente (`crear_nota_credito`, ya recibe `p_devolucion_id`), `crear_nota_credito_proveedor`
   nunca tuvo el parámetro equivalente. Se agregó `devoluciones.nota_credito_proveedor_id` (columna
   propia — `nota_credito_id` es FK a `comprobantes`, tabla de venta, no sirve acá), el parámetro al
   RPC (con `DROP FUNCTION` explícito para no dejar un overload huérfano, mismo patrón mig.215), y
   un botón "Generar NC" nuevo en el listado de Devoluciones a Proveedor. De paso, el mapa de badges
   del frontend nunca tuvo la clave `'nota_credito'` — aunque el backend lo seteara bien, se seguía
   viendo "Sin definir". Verificado en vivo: el badge ya muestra bien las devoluciones ya
   compensadas. El click-through completo del botón no se probó en vivo (no hay ninguna devolución
   real en estado `'pendiente'` ahora mismo para probar sin mutar datos).

### ❌ Investigados a fondo — NO eran bugs reales (importante no repetir el hallazgo)

5. **"IVA duplicado" en Copiar a NC de Proveedor** — el cálculo está BIEN. Verificado
   matemáticamente contra la compra real (A-0001-00003421): sumando `costo_unitario` de sus 3
   líneas da $277.000 (neto, matching la OC de origen) y ×1,21 da $335.170 exacto (el total real de
   la factura). **`NC-20260827-001` ($19.000) en Ferretería NADIA probablemente quedó subvaluada**
   por la corrección manual que se le hizo — el valor bruto correcto era $22.990. Vale la pena que
   alguien la revise.
6. **Cheque de tercero "Depositado" sin movimiento bancario** — es diseño correcto (mig.285,
   documentado ahí mismo: "no hay hecho económico que contabilizar" en tránsito). El movimiento
   bancario SÍ se genera correctamente al llegar a **"Cobrado"** — probado en vivo con
   `BEGIN...ROLLBACK` contra el cheque real de $80.000 (Banco Nación) que sigue en `depositado` en
   producción: asiento balanceado + fila en `movimientos_bancarios` vinculada a la cuenta elegida,
   todo correcto. Nadia se quedó en "Depositado" y nunca probó el paso siguiente.

`eslint` limpio y 159/159 tests en cada fix. Todo commiteado — pendiente confirmar push/deploy.

---

## 📋 Cierre de sesión 27/08 — para que Luciano siga

Día largo probando el plan de prueba integral con la empresa ficticia **Ferretería NADIA**, de
punta a punta por la UI real (no SQL directo salvo excepciones puntuales, documentadas y
justificadas cada vez). Plan completo en
[PLAN_PRUEBA_INTEGRAL_FERRETERIA_2026-08-26.md](PLAN_PRUEBA_INTEGRAL_FERRETERIA_2026-08-26.md).
**Fases 1 a 5 completas hoy** (catálogo → proveedores/compras → clientes/ventas → finanzas →
devoluciones). Quedan **Fases 6 a 9** (Inventario, Casos límite, Reportes, Tiendanube/MercadoPago —
esta última explícitamente frenada hasta que Nadia la conecte a mano).

**Todo commiteado y pusheado a GitHub** — nada quedó a mitad de camino, cada fase es su propio commit
(o el mismo commit que el fix que destapó, cuando el bug se encontró probando esa fase).

### Bugs reales encontrados y corregidos hoy (con migración aplicada + verificada)
- **mig.356** — `crear_cheque_propio`/`crear_cheque_tercero` sin `GRANT EXECUTE` para `authenticated`:
  ningún cheque se podía registrar en producción, en silencio (toast de error fuera del viewport).
- **mig.357** — `seed_series_numeracion()` nunca sembraba el tipo `'devolucion'`: ninguna devolución
  (proveedor ni cliente) funcionaba en empresas nuevas. Sembrado retroactivo para las que ya
  existían y les faltaba.

### Bugs reales encontrados y documentados, **sin corregir** (quedan para una sesión de desarrollo)
- El campo "Fecha" de "Nueva Factura de Venta" (financiera) se ignora — el comprobante siempre se
  graba con la fecha/hora actual del servidor, sin importar lo que se cargue a mano. Bloquea carga
  retroactiva legítima (Fase 3).
- `crear_cheque_propio` no imputa `cuenta_corriente_proveedores_imputaciones` (a diferencia de
  `crear_cheque_tercero`, que sí lo hace del lado cliente) — asimetría real (Fase 2).
- Depositar un cheque de tercero no genera ningún movimiento bancario ni toca el saldo de ninguna
  cuenta — Cheques y Bancos quedan desconectados en ese punto (Fase 4).
- `crear_nota_credito_proveedor` nunca actualiza `devoluciones.compensacion`/`nota_credito_id`
  (a diferencia de `crear_nota_credito`, lado cliente, mig.264) y no hay ningún punto de entrada en
  la UI para generar esa NC vinculada desde la devolución — el listado de Devoluciones a Proveedor
  va a mostrar "Sin definir" para siempre, aunque la NC exista y ya haya compensado (Fase 5).

Cada uno con su hallazgo completo (causa raíz, evidencia, cómo se verificó) en la sección de la fase
correspondiente, más abajo en este mismo archivo.

**Siguiente paso:** Fase 6 (Inventario — Recuento con faltante/sobrante, Revalorización, Ajuste
masivo de precios mig.354).

---

## ✅ Fase 5 completa — Devoluciones (Ferretería NADIA)

Continuación de la Fase 4 (abajo). Se probaron los dos circuitos de devolución de punta a punta:
devolución de cliente con reingreso físico de stock + Nota de Crédito vinculada, y la revisión
completa (encontrada incompleta) del circuito de devolución a proveedor ya cargado en la Fase 2.

### Lo que se probó

- **Devolución de cliente con reingreso de stock:** sobre FAC-20260827-002 (Marcos Herrera, circuito
  real Pedido→Entrega→Factura), vía el kebab de la factura → "Devolver mercadería" (la única entrada
  que carga los ítems reales desde `comprobante_items` — el botón "Nueva Devolución" suelto de la
  pestaña Devoluciones nunca los carga, ver Hallazgo de diseño abajo). Se devolvió 1 de los 3 Pincel
  Nº10 (defectuoso, "cerdas sueltas") con **"Reingresar productos al stock" tildado**; el Rodillo se
  dejó en 0 a propósito porque ya había sido acreditado completo en la NC-20260827-001 de la Fase 3.
  Verificado en base: `DEV-2026-0002` creada (`reingresa_stock=true`), movimiento de inventario
  `ingreso` de 1 unidad con motivo "Devolucion cliente DEV-2026-0002", `comprobante_items.cantidad_devuelta`
  del Pincel pasó de 0 a 1 (Rodillo se mantuvo en 0, sin duplicar el crédito). Al cerrar el modal
  apareció un diálogo nuevo y correcto — "¿Reabrir el pedido PED-20260827-002?" porque la NC dejó
  cantidad sin facturar en un pedido ya marcado "Facturado" — se eligió "Dejar cerrado" (no correspondía
  reabrirlo, es una devolución real, no un reemplazo pendiente de reenvío).
- **Nota de Crédito de la devolución:** desde el detalle de `DEV-2026-0002` ("Ver mapa de relaciones" →
  "Generar Nota de Crédito") — a diferencia del "Copiar a NC" de la Fase 3 (que parte de la factura
  completa), este botón está vinculado a la devolución puntual y vino con el ítem correcto pre-cargado
  (Pincel Nº10, cantidad 1, $1.900). Resultado: `NC-20260827-002`, correctamente linkeada
  (`devoluciones.nota_credito_id`) y acreditada en cuenta corriente. Saldo final de Marcos Herrera
  verificado: DEBE $9.300 (FAC-002) − HABER $3.600 (NC-001, Fase 3) − HABER $1.900 (NC-002) =
  **$3.800 pendiente**, matemática correcta (quedan 2 Pinceles sin devolver, $3.800).
- **Devolución a proveedor (revisión end-to-end de DEV-2026-0001, Fase 2):** confirmado el circuito
  completo — devolución con salida de stock (2 bolsas de cemento, `movimientos_inventario` tipo
  `salida`), y una Nota de Crédito de proveedor real (`NC-20260827-001` en `notas_credito_proveedor`,
  $19.000) que sí impactó `cuenta_corriente_proveedores` (HABER $19.000, motivo con referencia textual
  "ver DEV-2026-0001"). Ver el bug real que esto destapó abajo.

### 🟡 Hallazgo — la devolución a proveedor nunca queda marcada como compensada, aunque la NC exista y aplique

`devoluciones.compensacion` de `DEV-2026-0001` sigue en `'pendiente'` (la UI la muestra como
"Sin definir") **incluso siete horas después de que `NC-20260827-001` fue creada y acreditó
correctamente los $19.000 en la cuenta corriente del proveedor**. Causa raíz confirmada leyendo
código: `crear_nota_credito` (cliente, mig.264) recibe un `p_devolucion_id` opcional y, si viene,
hace `UPDATE devoluciones SET nota_credito_id=…, compensacion='nota_credito' WHERE … tipo='cliente'`
— así es como `DEV-2026-0002` de este mismo Fase 5 sí quedó bien reflejada. `crear_nota_credito_proveedor`
(proveedor, mig.277) **nunca recibió el parámetro equivalente**: su firma no tiene `p_devolucion_id`
y el body no toca la tabla `devoluciones` en ningún punto — solo inserta en `notas_credito_proveedor`
+ `cuenta_corriente_proveedores`, vinculado a la compra por `compra_id`, no a la devolución. Además,
a diferencia del lado cliente (que tiene un diálogo de detalle con "Ver mapa de relaciones" +
"Generar Nota de Crédito" directamente desde la devolución), el listado "Devoluciones a Proveedor"
no tiene ningún punto de entrada — ninguna fila es clickeable a un detalle — así que hoy es
estructuralmente imposible generar una NC de proveedor *vinculada* a su devolución: el único puente
entre ambos registros es el texto libre "(ver DEV-2026-0001)" que se agrega al motivo de la NC, sin
ningún FK real. Quien mire el listado de Devoluciones a Proveedor para saber cuáles siguen
pendientes de compensar va a ver TODAS como "Sin definir" para siempre, hayan sido compensadas o no.
**No se corrigió en esta sesión** — el arreglo real implica cambiar la firma de
`crear_nota_credito_proveedor` (DROP + CREATE, agregar `p_devolucion_id`) y construir un punto de
entrada nuevo en el listado de Devoluciones a Proveedor (detalle + botón "Generar NC"), que es
trabajo de feature, no un patch angosto tipo GRANT — queda documentado para una sesión de desarrollo
aparte.

### Hallazgo de diseño (ya documentado, reconfirmado) — el modal "Nueva Devolución" suelto nunca muestra ítems
Reconfirmado al intentar usarlo primero: abrir "Nueva Devolución" desde el botón de la pestaña
Devoluciones (sin partir del kebab de una factura puntual) nunca carga ítems — por diseño, es una
devolución financiera pura sin movimiento de stock (`origen` viene `null`, así que
`NuevaDevolucionModal.jsx` nunca llama a `fetchItems`). Para devolución física con reingreso de
stock, el único camino es el kebab "..." de la factura específica → "Devolver mercadería".

**Siguiente paso:** Fase 6 (Inventario — Recuento con faltante/sobrante, Revalorización, Ajuste
masivo de precios mig.354).

---

## ✅ Fase 4 completa — Finanzas (Ferretería NADIA)

Continuación de la Fase 3 (abajo). Se probó de punta a punta: cheques de terceros recibidos y
depositados, movimientos de caja manuales, cuenta bancaria con extracto CSV importado y conciliado,
y cierre de caja con arqueo (con diferencia real).

### Lo que se cargó
- **2 cheques de terceros** recibidos como pago: $100.000 de Construcciones Alvarado (imputado
  contra FAC-20260827-001, bajó su deuda de $275.000 a $175.000 — confirmado) y $30.000 de Almacén
  Don Rulo (imputado contra su factura vieja). Ambos marcados "Depositado" después.
- **Movimientos de caja manuales:** retiro de $5.000 (gastos chicos) + ingreso de $50.000 (aporte de
  capital, categoría Inversión).
- **Cuenta bancaria nueva:** "Banco Nación Cta. Cte.", vinculada a 1.1.1 — Caja y Bancos del Plan de
  Cuentas. Se cargaron 3 movimientos manuales (los 2 depósitos de cheques + el pago por transferencia
  a Bianchi Herrajes de Fase 2, $102.000) — saldo $28.000.
- **Extracto CSV de 10 líneas** importado por el flujo correcto de Conciliación (no el botón genérico
  de la pestaña Cuentas — ver hallazgo de UX abajo). Auto-Match encontró las 3 coincidencias reales
  y dejó 7 líneas pendientes (comisiones, IVA sobre comisión, impuestos, un débito de servicio, una
  acreditación y una transferencia recibida que el sistema no tenía registradas) — resultado esperado
  de una conciliación real, sin bugs en el mecanismo de matching.
- **Cierre de caja con arqueo:** saldo esperado $90.500 (efectivo), contado real $90.300 — diferencia
  de -$200 (faltante) calculada y mostrada correctamente por el sistema, con observación registrada.

### 🟡 Hallazgo — depositar un cheque de tercero no genera movimiento bancario real
Cambiar el estado de un cheque de tercero a "Depositado" (acción "Mover" en Cartera de Terceros) no
inserta nada en `movimientos_bancarios` ni afecta el saldo de ninguna cuenta bancaria — confirmado
verificando la tabla directamente tras depositar los 2 cheques (vacía). El módulo de Cheques y el de
Bancos quedan desconectados en este punto: si alguien quiere que el saldo bancario refleje esos
depósitos, tiene que cargarlos a mano como movimiento manual (que es lo que se hizo acá para poder
seguir con la conciliación) — no hay ningún aviso de esto en la UI al depositar.

### 🟡 Hallazgo de UX — dos botones "Importar CSV" con comportamiento completamente distinto
En Bancos hay dos botones con el mismo texto exacto "Importar CSV": el del header superior (visible
en todas las pestañas) abre `ImportCSVModal`, que agrega los movimientos **directo** a la cuenta
como si fueran ciertos, sin comparar contra nada. El de dentro de la pestaña **Conciliación** es un
componente distinto (`ConciliacionTab`) que crea un extracto aparte para compararlo contra lo ya
cargado (auto-match + match manual) — el flujo real de conciliación. No hay forma de distinguirlos
por el texto del botón; usarlos al revés (como pasó acá al principio) deja movimientos duplicados en
la cuenta. Se corrigió a mano (`DELETE` de los 10 duplicados) antes de seguir con el flujo correcto.
Vale la pena que Nadia/Luciano lo tengan en cuenta — es fácil de repetir con datos reales.

**Siguiente paso:** Fase 5 (Devoluciones) — no arrancada todavía.

---

## ✅ Fase 3 completa — Clientes y Ventas (Ferretería NADIA)

Continuación de la Fase 2 (abajo). Se probó de punta a punta: 4 clientes con perfiles distintos,
el circuito completo Cotización → Pedido → Entrega → Factura, ventas de mostrador (POS y circuito
corto), Factura de Reserva (Stock Comprometido), NC/ND a cliente, y un cliente moroso real para el
reporte de Antigüedad de Deuda.

### Lo que se cargó
- **4 clientes:** Construcciones Alvarado S.A. (contratista, RI, Cuenta Corriente 30 días, Factura A),
  Marcos Herrera (particular frecuente, DNI, Factura B, "a veces fía" — 15 días), Julieta Sosa
  (nueva, siempre contado), Almacén Don Rulo (moroso a propósito, Monotributo, Factura C).
- **Circuito completo:** COT-00001 (Aprobada) → "Copiar a Pedido" → PED-20260827-001 (Confirmado →
  Generar Entrega) → ENT-2026-0001 → "Facturar Entrega" (Factura A) → FAC-20260827-001 ($194.500).
  Verificado en el Mapa de Relaciones: la cadena completa se ve correctamente encadenada — confirma
  en vivo el fix de Bug 1 de Luciano de hoy mismo.
- **Ventas de mostrador:** 2 tickets desde el POS (Efectivo $8.100, Tarjeta Crédito $15.500 con
  2,5 litros de pintura — probó venta por volumen con decimales en el POS) + 1 Factura B a Marcos
  Herrera vía circuito corto Pedido→Entrega→Facturar ($9.300, queda en Cuenta Corriente).
- **Factura de Reserva (Stock Comprometido):** Alvarado reserva 5 bolsas de cemento (retira en 3
  días) — pedido facturado con el checkbox "Factura de Reserva" **sin** generar Entrega. Verificado
  contra `productos_stock_disponible`: `stock_actual=68, stock_comprometido=5, stock_disponible=63`
  — mig.349/350 funcionando correctamente con datos frescos.
- **NC a cliente:** devolución parcial sobre FAC-20260827-002 (solo el rodillo de pintura, no el
  pincel) — $3.600, vía "Copiar a NC" desde el kebab de la factura.
- **ND a cliente:** flete cobrado aparte sobre FAC-20260827-001 — $8.000, motivo "Flete adicional"
  (ya venía como opción predefinida).
- **Cliente moroso real:** factura a Almacén Don Rulo con antigüedad forzada (ver hallazgo de abajo)
  — el reporte de Antigüedad de Deuda la muestra correctamente en la banda **61-90 días, $44.500**.

### 🟡 Hallazgo — el campo "Fecha" en "Nueva Factura de Venta" (financiera) se ignora
Al crear una factura desde ese modal con una fecha manual (ej. 13/06/2026, para simular una venta
vieja), el comprobante se graba igual con la fecha/hora **actual** del servidor — el valor del campo
no tiene ningún efecto, ni en `fecha` ni en `fecha_vencimiento`. Esto bloquea cualquier caso de uso
legítimo de carga retroactiva (una venta de ayer que se olvidaron de cargar, saldos iniciales al
migrar un cliente, etc.). Para poder probar el reporte de Antigüedad de Deuda con un caso real, se
corrigió la fecha de esa factura puntual (FAC-20260827-004) con un `UPDATE` directo documentado —
excepción explícita para generar el dato de prueba, no una corrección del bug en sí, que queda
pendiente de arreglar en el código (`NuevaFacturaVentaModal` o como se llame el componente real).

### Hallazgos menores de la fase
- El menú "..." (kebab) de acciones en el listado de Facturas de Venta tiene el mismo comportamiento
  errático de posicionamiento que ya se vio en Compras — se evitó usando el número de factura
  ("Ver detalle") o, cuando hacía falta el menú puntualmente, aislando la fila con los filtros antes
  de abrirlo. Sigue sin confirmarse si es un bug real de producto o un artefacto de esta sesión de
  automatización.
- El POS (Caja) **no** tiene selector de tipo de comprobante — siempre emite "Ticket". Para una
  Factura A/B/C con descuento de stock real no hay atajo directo: hay que pasar por
  Pedido → Entrega → Facturar (el mismo circuito completo). Documentado como el comportamiento
  esperado del sistema, no un bug — pero vale la pena que Nadia/Luciano lo tengan en cuenta si
  esperaban poder emitir una Factura B directa desde el mostrador.

**Siguiente paso:** Fase 4 (Finanzas) — no arrancada todavía.

---

## ✅ Fase 2 completa — Proveedores y Compras (Ferretería NADIA) + 2 bugs críticos encontrados y arreglados

Continuación de la Fase 1 (abajo). Se probó de punta a punta: 2 proveedores (RI/Factura A y
Monotributo/Factura C), Orden de Compra → Recepción → Factura de Compra (3-way match completo),
Compra Rápida, pago con cheque propio a 30 días, pago en efectivo imputado a una factura puntual, y
Nota de Crédito de proveedor por devolución de mercadería dañada. **En el camino aparecieron 2 bugs
que bloqueaban funcionalidad real en producción — no solo en la empresa de prueba — ya arreglados y
verificados en vivo:**

### 🔴 Bug grave #1 — Ningún cheque (propio ni de tercero) se podía registrar en producción
`crear_cheque_propio()` y `crear_cheque_tercero()` son `SECURITY DEFINER` con sus propias
validaciones internas (`empresa_id = get_my_empresa_id()` + `has_module_permission('cheques')`),
pero nunca tuvieron `GRANT EXECUTE` para `authenticated` — mismo patrón exacto que el bug de
`seed_plan_cuentas` de la sesión anterior (mig.355). El modal mostraba el toast de error (se
renderiza fuera de `<main>`, fácil de no ver — por eso pareció "no pasó nada" al principio) pero el
cheque nunca se guardaba. Confirmado con `BEGIN...ROLLBACK` simulando el rol `authenticated`:
`permission denied for function crear_cheque_propio`. **Fix:** mig.356, `GRANT EXECUTE` en ambas —
son seguras porque ya validan todo lo necesario internamente.

### 🔴 Bug grave #2 — Ninguna devolución (a proveedor ni de cliente) funcionaba en empresas nuevas
`obtener_proximo_numero()` ya sabe contar el tipo `'devolucion'` (tiene su propio `WHEN` en el
`CASE`), pero `seed_series_numeracion()` — la función que siembra las series numéricas de una
empresa nueva — nunca incluyó `'devolucion'` en su lista. Resultado: `obtener_proximo_numero()` no
encuentra la fila, intenta sembrarla vía el fallback (que tampoco la crea) y termina lanzando
`Tipo de documento no reconocido: devolucion` — bloqueando **tanto devoluciones a proveedor como de
cliente**, porque comparten el mismo tipo de documento. De las 7 empresas existentes, 5 ya tenían la
fila sembrada a mano en algún momento pasado (incluida Nalux, por eso nunca se notó en producción
real) — las 2 que no la tenían (incluida Ferretería NADIA, por ser nueva) quedaban bloqueadas.
**Fix:** mig.357, se agrega `'devolucion'` al seed + se siembra retroactivo para las empresas que ya
existían y les faltaba. Verificado con `BEGIN...ROLLBACK` antes de aplicar, y en vivo después.

### 📋 Hallazgos documentados, sin arreglar todavía (fuera de alcance de hoy)
- **`compras_saldo_pendiente` no descuenta compras ya pagadas directo**: la vista solo resta lo que
  está imputado en `cuenta_corriente_proveedores_imputaciones`, ignorando
  `compras.estado_pago = 'pagada'`. Una Compra Rápida pagada por Transferencia/Efectivo en el
  momento sigue apareciendo con el saldo completo pendiente en el modal "Pagar varias facturas" —
  riesgo real de pago duplicado si alguien lo usa sin revisar. Confirmado con Bianchi Herrajes
  ($102.000 pagados, seguía figurando con saldo pendiente ahí).
- **`crear_cheque_propio` no imputa el monto contra la factura vinculada**: aunque el modal permite
  elegir la "Compra asociada" del cheque, la función solo guarda esa referencia (`compra_id`) — no
  inserta nada en `cuenta_corriente_proveedores_imputaciones`. El saldo pendiente de la factura no
  baja aunque el cheque ya esté emitido y vinculado. A diferencia de `crear_cheque_tercero` (para
  clientes), que sí imputa correctamente contra la factura del comprobante.
- **"Copiar a NC" desde una Factura de Compra duplica el IVA**: al copiar el precio unitario de la
  factura original al formulario de NC de Proveedor, lo multiplica por 1,21 antes de copiarlo —
  pero el campo destino ya espera el precio bruto (con IVA incluido) y vuelve a aplicar el factor.
  Resultado: una NC "Copiar a NC" sobre una factura real sale ~21% inflada si no se corrige el
  precio a mano antes de guardar (confirmado matemáticamente: $9.500 costo real → el formulario
  precargaba $11.495 → total $22.990 en vez de los $19.000 reales).
- **Menú "..." (kebab) en la lista de Facturas de Compra, comportamiento errático de posicionamiento**:
  al clickear el kebab de una fila que no es la primera visible, el menú a veces no abre, o abre
  anclado visualmente a otra fila. No confirmado como bug real de producto (podría ser un artefacto
  de la automatización de browser de esta sesión) — evitado usando el link del número de factura
  ("Ver detalle") en su lugar, que sí es confiable.

**Verificación de datos de Fase 2** (Ferretería NADIA): OC-00001 ($277.000, recibida) → Factura
A-0001-00003421 ($335.170) → cheque propio $200.000 (30 días) + Compra Rápida en efectivo $12.600
(otra factura) → devolución DEV-2026-0001 (2 bolsas de cemento, reingresa stock) → NC-20260827-001
($19.000, correctamente calculada a mano tras el hallazgo de arriba). Stock de Cemento verificado
end-to-end: 60 (inicial) → 80 (+20 recepción OC) → 78 (-2 devolución).

**Siguiente paso:** Fase 3 (Clientes y Ventas) — no arrancada todavía.

---

## ✅ Fase 1 completa — Catálogo de "Ferretería NADIA" cargado (18/18 productos)

Continuación del [PLAN_PRUEBA_INTEGRAL_FERRETERIA_2026-08-26.md](PLAN_PRUEBA_INTEGRAL_FERRETERIA_2026-08-26.md).
Antes de esto se verificó en vivo el fix de Luciano (PdV sin AFIP) — confirmado funcionando: la
sección "Puntos de Venta" ahora aparece en Configuración → Facturación aunque la empresa tenga
facturación electrónica apagada, con el PdV rotulado "(interno, no factura)".

**18 productos cargados a mano vía UI real** (no seed/SQL), con costos y precios realistas de
ferretería argentina, en 3 categorías:
- **Herramientas (6):** Martillo Carpintero, Destornillador Phillips, Pinza Universal, Taladro
  Percutor Eléctrico ($85.000, el extremo caro), Cinta Métrica, Sierra Manual.
- **Materiales de Construcción (7):** Tornillo suelto ($150, el extremo barato) y por caja x100,
  Clavos, Cemento Portland (bolsa 50kg), Cerradura de Embutir, Candado, Alambre Galvanizado.
- **Pinturas y Accesorios (5):** Pintura Látex (única con venta por **litro**, no por unidad),
  Pincel, Rodillo, Guantes de Trabajo, Cinta de Enmascarar.

Verificado 18/18 contra la base real (no solo la UI) — categorías, costos, precios y stock
coinciden exactamente con lo cargado.

**Hallazgo para investigar en Fase 8 (Reportes), no un bug confirmado todavía:** los productos con
`tipo_venta != 'unidad'` (acá, la Pintura Látex) guardan su precio en una columna separada
`precio_por_kg_litro`, y `precio_venta` les queda en `0` — es el diseño de mig.338, no un error de
carga (confirmado: `TablaInventario.jsx` y `useProductosSnapshot.js` ya saben leer la columna
correcta según `tipo_venta`, y el listado de Inventario muestra el precio bien). Lo que falta
confirmar es si **todos** los reportes/pantallas que suman o muestran `precio_venta` (Revalorización
de Inventario, Listas de Precios, Dashboard) también contemplan este split — si alguno no lo hace,
va a mostrar $0 para este producto. Ya anotado como punto de prueba específico para cuando se llegue
a Fase 8, no se investigó más a fondo ahora para no desviarse de Fase 1.

**Nota de proceso:** al crear el 3er producto, el primer click fue sobre el botón de cerrar el modal
(no sobre "Crear Producto") — el producto no se guardó y recién se detectó al verificar. A partir de
ahí cada alta se verificó explícitamente contra el DOM (valores + click al botón real, confirmado
por texto) antes de continuar, y los 18 se re-verificaron por SQL al final.

**Siguiente paso:** Fase 2 (Proveedores y Compras) — no arrancada todavía, a la espera de que Nadia
confirme si sigue ahora o corta acá.

---

## 📋 Cierre de sesión 27/08 — para que Luciano siga

Día de construcción variada: se cerró el gating de AFIP en Puntos de Venta (abajo), un pedido de
UI del POS que salió mal al primer intento y se corrigió en el segundo, y las 2 fases "chicas" del
plan grande de Mapa de Relaciones + Determinación de Cuentas. **Las Fases 3/4 de ese plan (el motor
de Determinación de Cuentas propiamente dicho) quedan para mañana** — ver
[PLAN_MAPA_Y_DETERMINACION_CUENTAS_2026-08-27.md](PLAN_MAPA_Y_DETERMINACION_CUENTAS_2026-08-27.md).

**Todo lo de hoy commiteado, pusheado a GitHub y deployado a producción** — nada quedó a mitad de
camino, cada fix de abajo es su propio commit atómico y se verificó en vivo antes de pasar al
siguiente.

---

## ✅ Resuelto — Carrito del POS: ancho fluido, no más franja negra

Pedido de Luciano: el carrito del POS (Modo Caja) se sentía chico en pantallas anchas. **Primer
intento (rechazado en vivo):** anchos fijos en px por breakpoint (`420px` → `600px` en pantallas
grandes) — Luciano lo probó en su pantalla real y encontró el problema esperable: en cualquier
resolución que no coincidiera exacto con esos valores fijos, quedaba una franja negra sin usar en
vez de dársela al carrito. Corrección señalada: *"esto es web, tiene que ajustarse a CUALQUIER
resolución"*.

**Segundo hallazgo, más profundo:** incluso corrigiendo el wrapper a un ancho fluido (`md:w-[38%]`
con piso `380px` y techo `640px`), la franja negra seguía apareciendo — resultó que
`PanelCarrito.jsx` tenía su **propio** ancho fijo hardcodeado en su div raíz
(`md:w-[360px] lg:w-[420px]`), totalmente independiente y desincronizado del wrapper que se acababa
de arreglar. El wrapper crecía bien (confirmado con `getBoundingClientRect`, sin espacio muerto a
ese nivel), pero el contenido de adentro se quedaba angostado en sus 420px de siempre — la franja
negra estaba *dentro* del panel, no al costado, por eso las mediciones del wrapper daban falso
positivo de que ya estaba bien.

**Fix final**: `PanelCarrito.jsx` pasa a `w-full` a secas — el ancho se controla en un solo lugar
(el wrapper de `ModoCajaLayout.jsx`). Verificado con `getBoundingClientRect` en 5 anchos distintos
(800/1024/1440/1920/2560px): la suma de productos + carrito llena exactamente el 100% del espacio
disponible en los 5, sin excepción. `eslint` limpio, 159/159 tests (10/10 en `PanelCarrito.test.jsx`).

**Lección para la próxima vez que se toque un ancho de panel**: verificar con `getBoundingClientRect`
del elemento HIJO real que se está viendo en pantalla, no solo del wrapper — un componente puede
tener su propio ancho fijo escondido más adentro que el wrapper nunca sabe que existe.

---

## ✅ Resuelto — Mapa de Relaciones: 2 bugs reales encontrados por Luciano (Fases 1 y 2)

Plan completo en
[PLAN_MAPA_Y_DETERMINACION_CUENTAS_2026-08-27.md](PLAN_MAPA_Y_DETERMINACION_CUENTAS_2026-08-27.md).

**Bug 1 — la cadena desde Cotización se cortaba en Entrega.** Causa: `cotizaciones.comprobante_id`
solo lo escribe la conversión DIRECTA Cotización→Factura; en el camino real (Cotización→"Copiar a"
Pedido→Entrega→Factura, el más común) ese campo nunca se toca. El mapa, al abrirse desde la
cotización, solo miraba ese campo roto — nunca caminaba hacia los pedidos para ver si alguno ya se
facturó. Confirmado contra datos reales: `COT-00032.comprobante_id = null`, pero su pedido
`PED-20260815-001.comprobante_id` sí apunta a una factura viva.

Complicación real encontrada en el propio caso de Luciano: una cotización puede tener MÁS de un
pedido, cada uno facturado por separado (COT-00032 tiene 2, con 2 facturas distintas). **Fix**:
nueva función `fetchRamasCotizacion()` camina TODOS los pedidos de la cotización y arma una rama
completa (pedido→entregas→factura) por cada uno — nuevo modo de render `cotizacion_ramas`. Verificado
en vivo contra Nalux real: las 2 ramas se ven completas, cada una con su propio estado de pago
(Pagada / Pendiente).

**Bug 2 — una factura pagada al contado no mostraba el pago en ningún lado.** El pago sí existe
(`movimientos_caja`, ingreso real con fecha/monto/medio) pero el mapa solo consultaba
`cuenta_corriente_movimientos` — vacía para una venta que nunca tuvo deuda que cancelar (Regla 5
sap-reference: Caja se toca en Factura con pago inmediato, no en Cuenta Corriente). **Fix**: nueva
query a `movimientos_caja` en `fetchMapaVenta`, nuevo tipo de nodo "Pago al Contado" (distinto de
"Cobro CC"). Verificado en vivo: `FAC-20260815-001` ahora muestra "Pago al Contado · Efectivo ·
$24.950,00" en Documentos Derivados.

`eslint` limpio, 159/159 tests en ambas fases.

---

## ✅ Resuelto — Popup del asiento contable: ya no deja franjas vacías

Bug real (Luciano, 27/08): *"el asiento se ve mal, veo muchos espacios en blanco"* al cambiar la
resolución. Causa: `ModalDetalleAsiento` usaba `size="wide"` (el shell casi-pantalla-completa
pensado para documentos con grilla ancha — Cotización, OC, Factura), pero su contenido real es una
tabla simple de 3 columnas con pocas líneas, encerrada en un ancho fijo centrado adentro de ese
shell enorme — cuanto más ancha la pantalla, más franja vacía a los costados y abajo.

**Fix**: nuevo `size="medium"` en el `Dialog` compartido (`ui/dialog.jsx`) — ancho fijo (`max-w-3xl`,
768px) en vez de crecer con el viewport, alto ajustado al contenido (`max-h-[85vh]`) en vez de
`92vh` fijo. Aditivo: `size="wide"`/`"default"` sin cambios, cero riesgo para el resto de los
modales. Verificado con `getBoundingClientRect` a 1800px de ancho: el popup mide 768×547, fijo,
centrado — antes se hubiera estirado a más de 1500px. `eslint` limpio, 159/159 tests.

---

## 📋 Pendiente para mañana — motor de Determinación de Cuentas (Fases 3/4)

Nace de investigar por qué el pago al contado no tenía cuenta contable propia por medio de pago —
Luciano confirmó que quiere generalizar el patrón que KAIROX ya construyó una vez para conciliación
bancaria (`determinacion_cuentas_mayor` + `DeterminacionCuentasTab.jsx`, inspirado en el account
determination de SAP) al resto del motor de asientos, que hoy hardcodea ~25+ cuentas por código
fijo (`findCuentaByCodigo(empresaId, '1.1.1')`, etc.) en `planCuentasService.ts` y varios RPC SQL.
Diseño completo, con las decisiones ya tomadas, en
[PLAN_MAPA_Y_DETERMINACION_CUENTAS_2026-08-27.md](PLAN_MAPA_Y_DETERMINACION_CUENTAS_2026-08-27.md)
— Fase 3 (esquema base, aditivo) y Fase 4 (cablear medios de pago, el pedido original). Alcance
mayor, toca el asiento real de cada venta nueva — arrancar con `BEGIN...ROLLBACK` contra Nalux real
antes de aplicar cualquier migración.

---

## ✅ Resuelto — Puntos de Venta ya no dependen de completar el wizard de AFIP

Luciano frenó la sesión al leer la limitación de diseño documentada abajo ("no hay forma de crear
un PdV sin certificado AFIP real") — la señaló como una violación real del principio SAP que él
mismo pidió en su momento (mig.244: "cuantos PdV se quiera, un flag decide cuál manda a ARCA") y
pidió revisar todo el circuito antes de tocar código.

**Confirmado con evidencia, no era un problema de diseño de datos — el modelo ya estaba bien
construido:** `puntos_venta.envia_arca` (mig.244), `useAfipConfig.js` (resuelve el PdV activo
independiente de si la empresa factura electrónicamente), `series_numeracion` por PdV (mig.295/296,
sin colisión de numeración entre PdV fiscales e internos), y el modal "Nuevo/Editar PdV" (ya tenía
el switch "Envía a ARCA") — todo esto ya seguía el principio SAP correctamente. El bug era **puro
gating de UI**: en `TabFacturacion.jsx` la sección entera "Puntos de Venta" (botón + tabla) estaba
envuelta en `{afipConfig.usa_factura_electronica && (...)}`, y la única forma de poner ese flag en
`true` era completar el wizard de 3 pasos, que exige subir un `.crt` real de ARCA. No existía
ningún camino para crear un PdV puramente interno sin depender de nosotros insertándolo por SQL.

**Fix**:
- `TabFacturacion.jsx` — sección "Puntos de Venta" ya no depende de `usa_factura_electronica`,
  siempre visible. Textos corregidos (ya no asumen que todo PdV está dado de alta en ARCA).
- `ConfiguracionSection.jsx` — un PdV nuevo nace con `envia_arca` = estado actual de AFIP de la
  empresa (antes: siempre `true`, engañoso si AFIP está apagado). `puntoVentaActivo` ahora prefiere
  un PdV fiscal si existe, en vez de asumir que el primero de la lista lo es (relevante recién
  ahora que un PdV interno puede crearse antes que uno fiscal). El upsert del wizard de AFIP fija
  `envia_arca=true` explícito, para no dejar un PdV interno preexistente con el flag viejo si el
  número coincide.

Verificado en vivo contra Nalux (AFIP activo, sin mutar datos reales): tabla y modal renderizan
igual que antes, texto y default nuevos correctos. **No probado en vivo con una empresa con AFIP
apagado** (la cuenta de prueba "Ferretería NADIA" requiere credenciales que no tengo) — la lógica
se verificó leyendo el código de punta a punta, pero falta la confirmación visual de que crear un
PdV interno desde cero funciona con AFIP apagado. `eslint` limpio, 159/159 tests.

---

## 📋 Cierre de sesión 26/08 — para que Luciano siga

Nadia pidió armar una cuenta completamente nueva ("Ferretería NADIA") y probarla de punta a punta
como si fuera un negocio real — plan completo en
**[PLAN_PRUEBA_INTEGRAL_FERRETERIA_2026-08-26.md](PLAN_PRUEBA_INTEGRAL_FERRETERIA_2026-08-26.md)**.
Se llegó a completar sólo la **Fase 0** (alta y configuración) antes de cortar la sesión — nada de
Fase 1 en adelante (catálogo, proveedores, ventas, etc.) está hecho todavía.

**Lo bueno**: la Fase 0 por sí sola ya encontró y arregló 4 bugs reales (ver las secciones de abajo,
todas fechadas 26/08) — vale la pena leerlas, en particular la de "Empresas sin Facturación
Electrónica no podían facturar NADA", que es grave y afectaba (hasta hoy) a cualquier empresa nueva
que decidiera no usar AFIP, no sólo a la de prueba.

**Lo que queda pendiente, sin resolver hoy:**
- **Retomar el plan desde la Fase 1** (cargar el catálogo de 18 productos de la ferretería) en
  cuanto alguien retome esta prueba — la cuenta `mi.negocio029@gmail.com` / "Ferretería NADIA" ya
  está lista para seguir (empresa configurada, Plan de Cuentas con 45 cuentas, 1 Punto de Venta
  interno creado).
- **Limitación de diseño encontrada, no arreglada**: no existe forma en la UI de crear un Punto de
  Venta sin subir un certificado AFIP real, ni siquiera para un negocio que nunca va a facturar
  electrónicamente. Ver detalle en la sección del bug de AFIP-gating más abajo. Es una decisión de
  producto (¿vale la pena un botón "PdV interno, sin AFIP"?), no algo urgente.
- **Las 2 cuentas de prueba viejas** (`nadiatecera13@gmail.com` "Creativas",
  `equipokairox.ia@gmail.com` "Mi Negocio M.T") siguen sin borrar — Nadia dijo que las borra ella
  cuando pueda (borrado de usuarios de Auth no es algo que se pueda hacer por acá, ver más abajo).

---

## ✅ Resuelto (26/08) — Empresas sin Facturación Electrónica no podían facturar NADA (bug grave)

El hallazgo más importante de la Fase 0-3 del plan de prueba integral. Al intentar crear el primer
Punto de Venta para "Ferretería NADIA" (empresa de prueba, AFIP apagado a propósito — sin
certificado real no tiene sentido prenderlo) se encontraron dos problemas encadenados:

**1. No hay forma de crear un Punto de Venta sin subir un certificado AFIP real.** El único lugar
de la UI para dar de alta un PdV es el wizard de "Activar Facturación Electrónica" (Configuración →
Facturación), y su paso 2 exige subir un archivo `.crt` real firmado por ARCA — imposible de
conseguir para una empresa ficticia (ARCA es un sistema real, no hay forma de generar un
certificado válido para un CUIT inventado). **No es un bug de código, es una limitación de diseño
real**: hoy no existe un camino para configurar un PdV puramente interno sin pasar por todo el
flujo de AFIP. Pendiente para Nadia decidir si vale la pena construir un botón separado ("Crear
Punto de Venta interno, sin AFIP") — no se construyó hoy, fuera del alcance de "arreglar lo
encontrado". Se insertó el PdV directo por SQL para esta empresa de prueba puntual (única excepción
al criterio de "todo por la interfaz" del plan, justificada porque la interfaz no ofrece otro
camino).

**2. Con el PdV ya creado, Nueva Factura seguía sin mostrarlo — bug real, mucho más grave.** El
selector de "Punto de venta" no aparecía en ningún lado, ni con el PdV ya insertado. Revisando el
código: **`NuevaFacturaModal.jsx`, `NuevaNCModal.jsx`, `NuevaNDModal.jsx` y el hook `useAfipConfig`
(compartido por el POS vía `useConfirmarVenta`) tenían un `if (!emp.usa_factura_electronica) return`
ANTES de resolver el punto de venta** — cortaban toda la lógica de resolución de PdV (heredado del
origen / default de la empresa / fallback) apenas veían que la empresa no factura electrónicamente.

Esto contradice directamente el propio diseño documentado en los comentarios del código ("el PdV es
el único selector, `envia_arca` define si va a ARCA — no `usa_factura_electronica`") y el caso de
uso que la propia app dice soportar ("el local no emite factura electrónica", visible en el
selector de Modo Caja). **Impacto real: ninguna empresa con AFIP apagado podía facturar absolutamente
nada — ni un Ticket — ni desde el ERP ni desde el POS.** En el POS específicamente, cada venta se
hubiera creado con `punto_venta_id: null` (confirmado leyendo `useConfirmarVenta.js`). Nunca se
notó porque Nalux siempre tuvo AFIP prendido desde el principio — recién se manifestó al crear una
empresa nueva con la decisión consciente de dejarlo apagado.

**Fix**: se sacó el corte temprano en los 4 lugares — la resolución de PdV corre siempre ahora;
`usa_factura_electronica` sigue siendo la única variable que decide si se envía a ARCA
(`afipActivo`/`envia_arca`), nunca si se resuelve el punto de venta. Verificado en vivo contra
"Ferretería NADIA" tras el deploy: Nueva Factura ahora muestra "PdV 1 — Punto de Venta Principal
(interno)" con el aviso correcto de que no emite CAE. `eslint` limpio en los 4 archivos.

---

## ✅ Resuelto (26/08) — "Inicializar Plan Estándar" no hacía nada — permiso nunca otorgado (mig.355)

Segundo hallazgo real de la Fase 0, mismo plan de prueba. En Plan de Cuentas → "Inicializar Plan
Estándar" (empresa recién creada, plan vacío): el botón no hacía absolutamente nada — sin toast de
error, sin ninguna cuenta nueva, ni con click por `ref` ni por coordenada, ni tras recargar la
página entera. Antes de dar por descartado un problema de automatización, se probó el RPC directo
por SQL simulando el rol `authenticated` real: **`permission denied for function
seed_plan_cuentas`**.

**Causa confirmada**: su ACL real era `{postgres=X/postgres}` — ni `PUBLIC` ni `authenticated`
tenían `EXECUTE`. A diferencia de sus 3 funciones hermanas del mismo flujo de alta (`create_tenant`,
`seed_maestros_default`, `seed_series_numeracion` — las 3 con el grant correcto, por eso formas de
pago y series de numeración sí se auto-sembraron bien), a ésta se le olvidó el `GRANT` de vuelta en
algún momento (mismo patrón "revoke en lote, grant individual olvidado" ya visto 2 veces antes en
esta sesión, mig.304/305 y mig.353). **Impacto real: ninguna empresa nueva podía sembrar su Plan de
Cuentas desde la interfaz** — nadie lo había notado porque Nalux ya lo tenía de antes de que existiera
este botón.

**Verificado seguro antes de otorgar el permiso**: la función es `SECURITY INVOKER` (no `DEFINER`)
y no valida `p_empresa_id` por su cuenta, pero el `INSERT` que hace queda sujeto a la política RLS
real de `plan_cuentas` (`empresa_id = get_my_empresa_id() AND has_module_permission('configuracion')`
en el `WITH CHECK`) — nadie puede usarlo para sembrarle cuentas a una empresa ajena, RLS lo corta
solo. **Fix (mig.355)**: `GRANT EXECUTE ON FUNCTION seed_plan_cuentas(uuid) TO authenticated`, sin
más. Verificado en vivo: 45 cuentas creadas al clickear el botón después del grant.

---

## ✅ Resuelto (26/08) — Fase 0 de la prueba integral: el Asistente de bienvenida guardaba en el lugar equivocado

Primer hallazgo real de `PLAN_PRUEBA_INTEGRAL_FERRETERIA_2026-08-26.md`, apenas arrancando la Fase
0 (alta y configuración). Completé el `OnboardingWizard` (Nombre, Rubro=Ferretería, CUIT, Teléfono,
Ciudad) y al ir a Configuración → Empresa a completar Condición IVA, **todo aparecía vacío**
(Rubro/Dirección/Teléfono/CUIT) — ni siquiera un hard reload de la página lo mostraba, así que no
era caché.

**Causa real — dos fuentes de datos distintas para lo mismo:**
- `OnboardingWizard.jsx` escribe `rubro`/`telefono`/`direccion`/`cuit` **directo en columnas de
  `empresas`**.
- `ConfiguracionSection.jsx` (desde la sesión 78, comentario propio en el código: "EGRESS-FIX")
  lee esos mismos 3 campos de contacto de la tabla **`configuracion`** (clave/valor) — un cambio de
  arquitectura posterior que el wizard nunca se enteró que existía.
- Peor con el CUIT: Configuración usa `empresas.afip_cuit` (el campo real, el que leen **todos**
  los PDFs/tickets/recibos — `TicketPrint.jsx`, `ReciboPago.jsx`, `ComprobantePDF.jsx`,
  `FacturaPDF.jsx`, etc.), mientras el wizard sólo tocaba `empresas.cuit`, una columna que **no lee
  nada más en toda la app** (confirmado con grep). Impacto real: **cualquier ticket o recibo
  impreso de una empresa recién creada por el wizard salía sin CUIT**, sin que nadie se enterara
  hasta imprimir uno.

**Fix** (`OnboardingWizard.jsx`, `handleGuardarEmpresa`): además de la columna vieja, ahora
también escribe `afip_cuit` (sólo si son 11 dígitos válidos, mismo criterio que Configuración) y
upsertea `rubro`/`telefono`/`direccion` en `configuracion` con las mismas claves que
`ConfiguracionSection.jsx` lee. No se tocó nada de lo existente — las columnas viejas de `empresas`
siguen escribiéndose igual (las sigue leyendo el propio wizard al reabrirse).

Corregido a mano en la base para "Ferretería NADIA" (la empresa ya había pasado por el wizard
viejo antes del fix) y verificado recargando Configuración → Empresa: Rubro, Dirección, Teléfono y
CUIT aparecen todos bien ahora. Completada además Condición IVA = Responsable Inscripto, Localidad,
CP y Provincia (campos que el wizard nunca colecta, se completan una sola vez a mano).

---

## ✅ Resuelto (26/08) — Registro con email ya existente mentía "cuenta creada"

Encontrado en vivo por Nadia, arrancando el plan de la ferretería de abajo: quiso crear cuentas de
prueba con `nadiatecera13@gmail.com` y `equipokairox.ia@gmail.com` — las dos ya tenían cuenta
confirmada de antes (24/07 "Creativas" y 10/08 "Mi Negocio M.T", esta última con nombre "Mirta
Perez", con toda la pinta de ser una prueba vieja del formulario de registro, quizás de Luciano).
El formulario le mostró igual el cartel verde "Cuenta creada exitosamente" las dos veces, y al
volver a intentar loguearse con la contraseña que acababa de poner, "Credenciales inválidas" — la
contraseña nueva nunca se guardó en ningún lado.

**Causa real**: Supabase `auth.signUp()` no devuelve error cuando el email ya tiene una cuenta
confirmada — es a propósito, misma lógica de seguridad por la que `signIn` ya muestra
"Credenciales inválidas" genérico en vez de "no existe ese usuario" (para que nadie pueda usar
estas pantallas para enumerar qué emails están registrados en el sistema). La señal que sí expone
Supabase, documentada para este caso exacto: `data.user.identities` viene como array vacío.

**Fix** (`SupabaseAuthContext.jsx`, función `signUp`): si `identities.length === 0`, tira un error
claro ("Ya existe una cuenta con ese email...") en vez de éxito falso. De paso, un segundo bug en
el mismo lugar: `signUp()` nunca mostraba ningún cartel de error para NADA — ni siquiera errores
reales de Supabase — porque `AuthPage.jsx` asumía que el context ya avisaba, pero no lo hacía
nunca. Se agregó el toast destructivo genérico para cualquier error de registro.

**No probado end-to-end** — reproducirlo de verdad requiere escribir una contraseña real en el
formulario de registro, algo que no corresponde hacer sin ser la persona dueña de esa cuenta.
Verificado en cambio: `eslint` limpio, el formulario de registro sigue renderizando sin errores de
consola. Falta que Nadia confirme el mensaje nuevo la próxima vez que alguien intente registrarse
con un email repetido.

**Las 2 cuentas de prueba viejas siguen sin borrar** — Nadia pidió el borrado pero es un
`auth.users` DELETE, una de las pocas cosas que quedan estrictamente para que lo haga ella misma
desde el panel de Supabase (Authentication → Users). Cuando lo haga, falta limpiar también las 2
filas de `empresas` huérfanas que van a quedar (`profiles` se borra en cascada con el usuario,
`empresas` no) — son chiquitas (Creativas: 4 productos/2 comprobantes/1 cliente; Mi Negocio M.T: 2
productos/1 comprobante), esa limpieza de tablas de negocio sí la puedo hacer yo cuando avise.

Nadia terminó registrándose con un tercer email nuevo (`mi.negocio029@gmail.com`, sin cuentas
previas) — empresa **"Ferretería NADIA"**, arranca el plan de abajo.

---

## 📋 Plan propuesto (26/08) — Prueba integral de punta a punta con cuenta nueva (ferretería)

Nadia pidió armar una empresa nueva de prueba, "como si fuera real", para ejercitar toda la app de
punta a punta (ventas, compras, caja, cheques, cuenta corriente, inventario) con datos argentinos
realistas — y encontrar/arreglar lo que se rompa en el camino. Plan completo, con la investigación
que llevó a elegir el rubro, en **[PLAN_PRUEBA_INTEGRAL_FERRETERIA_2026-08-26.md](PLAN_PRUEBA_INTEGRAL_FERRETERIA_2026-08-26.md)**.

Resumen: **ferretería Responsable Inscripto** (no kiosco/almacén — esos suelen ser
monotributistas y sólo facturan C, mucho más simple) para forzar Factura A + B + Ticket, cuenta
corriente de clientes Y proveedores, y cheques propios/de terceros en un solo negocio. AFIP/ARCA
queda apagado (empresa ficticia, sin CUIT de homologación real). Techos de volumen de datos
explícitos para no acercarse a ningún límite del plan free. Tiendanube/MercadoPago quedan para el
final, a propósito, porque requieren que Nadia conecte OAuth manualmente.

**Estado: cuenta creada** (`mi.negocio029@gmail.com`, empresa "Ferretería NADIA" — no hizo falta el
nombre ficticio del plan, quedó con su nombre real elegido por Nadia). Arrancando Fase 0. Ver
sección de arriba por el bug de registro que hubo que resolver en el camino antes de poder crearla.

---

## ✅ Resuelto (26/08) — Las 8 ventas viejas sin asiento contable ya tienen asiento

Cerraba el último pendiente real de la tabla "Estado de pendientes al 2026-08-21". Eran 8 ventas
de junio-agosto (`20260602-001/002/003`, `20260618-001`, `20260619-001`, `20260707-001/002`,
`20260806-003`) sin `asiento_id`, todas pagadas — no necesitaba código nuevo, la RPC
`regenerar_asiento_venta` (mig.281/303) ya existe y hace exactamente esto, un clic por venta desde
el punto ámbar de `SaleDetailModal.jsx`. Se llamó directo por SQL (mismo resultado que clickear,
más rápido para 8) con `SET LOCAL role authenticated` + JWT simulado.

**Dato que resultaba dudoso y se verificó antes de tocar nada**: 3 de las 8 (las del 02/06) son
anteriores a que existiera el plan de cuentas de Nalux (creado 02/06 22:28, mismo día). La duda era
si `regenerar_asiento_venta` iba a rechazarlas por eso. No las rechaza — valida contra el plan de
cuentas **actual**, no contra el que había en el momento de la venta, así que las 3 entraron sin
problema.

Probado con `BEGIN...ROLLBACK` primero (las 8 devolvieron `ok:true`), aplicado después en un solo
`COMMIT`. Verificado post-aplicación: los 8 asientos (`AS-000254` a `AS-000261`) quedaron
`confirmado` y balanceados (`total_debe = total_haber` en los 8), y una consulta final confirma
**0 ventas sin asiento** en Nalux.

---

## ✅ Construido y aplicado (26/08) — Ajuste masivo de precios del catálogo (mig.354)

Nadia pidió un aumento general de precios por inflación. **Hallazgo antes de construir nada**:
"Ajuste masivo" ya existía (mig.290) pero sólo toca `lista_precio_items` — y en Nalux real las 3
listas (Cliente VIP, Mayorista, Precio VIP) cubren 2-4 productos cada una, mientras el catálogo
tiene 68 productos activos que venden por `productos.precio_venta` directo. O sea: la función que
ya existía no servía para lo que Nadia necesitaba. Se le presentó la disyuntiva y eligió el
catálogo base.

**mig.354** — `ajustar_precios_masivo_catalogo(...)`, hermano de mig.290 con el mismo contrato
(preview con `p_aplicar=false` que no escribe nada + apply con el mismo cálculo, filtro por
categoría/búsqueda, 4 modos de redondeo).

**Diferencia deliberada vs mig.290: excluye `precio_venta = 0`.** 50 de los 68 productos activos
están en $0 (import de Open Food Facts del 19/08, precio pendiente de carga manual). Un aumento
porcentual sobre $0 da $0, pero el redondeo `terminar_99` (`FLOOR(0/100)*100+99`) los hubiera
convertido en $99 de la nada — un precio inventado, no un aumento. Se filtran server-side.

**Frontend**: botón "Ajuste masivo" en Inventario + modal con preview (misma UX que
ListasPrecioSection, deliberadamente — es la misma tarea en otro lugar).
`productosService.ajustarPreciosMasivo()`.

**Probado con `BEGIN...ROLLBACK` contra Nalux real antes de aplicar** (preview y apply real dentro
de la misma transacción, verificados contra Mate/Termo Stanley), `eslint` limpio, 159/159 tests,
`vite build` OK (16 min — el proyecto es grande, no es un problema del cambio).

**Probado en vivo y luego REVERTIDO** — la herramienta queda lista para usar, pero los precios de
Nalux quedaron como estaban. Secuencia completa, para que no se malinterprete el audit_log:

1. Se aplicó +15% con redondeo $X99 → 18 productos ajustados (18:43:11 UTC), verificado en la base.
2. Efecto colateral del redondeo: "Lapicera" pasó de $2 → $99 (no es un bug del cálculo:
   $2 + 15% = $2,30, y `terminar_99` lo empuja al siguiente $X99 — es la consecuencia lógica de
   redondear a $X99 un precio de 1 cifra). Nadia pidió corregirla a $2500 (18:46:52 UTC).
3. Al preguntarle Nadia **"¿por qué estamos haciendo esto?"**, quedó claro que el aumento no tenía
   sentido: el catálogo de Nalux es data de prueba (la Lapicera valía $2, el costo $1, 50 de 68
   productos en $0), no hay clientes reales ni precios desactualizados por inflación. Se le aplicó
   un aumento por inflación a un catálogo inventado. **La pregunta correcta antes de aplicar
   hubiera sido "¿lo aplico de verdad o alcanza con dejar la herramienta lista?"** — en su lugar se
   le ofreció elegir un porcentaje, que es una pregunta que da por sentado el "sí".
4. Nadia pidió revertir. Se revirtieron los 17 productos a su precio exacto previo.

**Cómo se revirtió (importante si vuelve a pasar): NO se puede deshacer con matemática.** El
redondeo a $X99 es lossy — $1.150, $1.200 y $1.210 con +15% caen todos en $1.399, así que dividir
por 1,15 no devuelve el original. Se reconstruyó desde `audit_log` (`old_data->>'precio_venta'` de
las filas con `created_at = '2026-08-26 18:43:11.869702+00'`), probado con `BEGIN...ROLLBACK`
antes de aplicar y verificado fila por fila después (17/17 en su valor original).

**La Lapicera quedó en $2500 a propósito** — es un cambio manual posterior pedido explícitamente
por Nadia, no parte del ajuste masivo, así que se excluyó de la reversión.

---

## 📋 Catálogo de kiosco (3.380 productos) — pausado indefinido, decisión de Nadia (26/08)

Luciano le había dejado 3 opciones explícitas a Nadia en `PLAN_PRUEBAS_LUCIANO_2026-08-24.md`
(retomar el scraping desde cero / carga manual-parcial / pausar indefinido). Nadia eligió pausar:
**"pausalo por ahora, seguimos con otra cosa."** No es un pendiente abierto — no volver a preguntar
qué hacer con esto hasta que ella o Luciano lo traigan de nuevo.

---

## ✅ Verificado en vivo (26/08) — Multi-PdV con letra + REVOKE de anon: los dos OK

Luciano dejó los dos ítems de abajo (Multi-PdV Fase 1 y el REVOKE de mig.353) sin probar en el
navegador — su sesión también estaba deslogueada. Nadia se logueó y se corrió
`PLAN_PRUEBAS_LUCIANO_2026-08-24.md` completo en vivo contra Nalux real:

- **Multi-PdV con letra**: se creó un tercer PdV real ("Sucursal Once", N° 3) con Factura B y C
  habilitadas (sin A). La columna "Letras" de la tabla, el bloque "PdV por defecto según letra"
  (probado además con reload de página para confirmar que persiste) y el filtro de Nueva Factura
  por tipo de documento — todos funcionaron exactamente como está documentado. Se probó también un
  caso más exigente que el propio plan: parado en "Sucursal Once" con Factura B, cambiar a Factura A
  (donde ese PdV no es válido) — salta correctamente al único PdV que sí sirve (Principal).
  **Único matiz encontrado, de redacción del plan de pruebas, no del código**: el paso 1.3.4 decía
  que al cambiar de letra "debería aparecer preseleccionado" el default de esa letra — en la
  práctica eso sólo pasa si el PdV que ya estaba elegido deja de ser válido para la letra nueva. Como
  "Punto de Venta Principal" sirve para las 3 letras, casi nunca se da ese salto — es el mismo
  comportamiento que Luciano ya había dejado anotado como "conocido, no bug" en su propio commit.
- **REVOKE de mig.353**: se registró un Cobro real de $100 a "Luciano" (saldo $107.880 → $107.780)
  y un Pago real de $100 a "Alibaba" (saldo $8.904,80 → $8.804,80) — las dos funciones
  (`registrar_cobro_cliente`/`registrar_pago_proveedor`) andan perfecto después del REVOKE.

**Sobre "encontré unas fallas" que Luciano le comentó a Nadia por fuera del chat**: se investigó a
fondo antes de probar en vivo — `audit_log`, actividad reciente en su propia cuenta de prueba
(empresa `aa1aa886-...`, separada de Nalux), advisors de seguridad de Supabase — sin encontrar
ningún rastro de dato roto o escritura fallida. El visor de logs de Supabase (`query_logs`) además
devolvió error de servidor en el momento de investigar, así que no se pudieron revisar logs crudos
de esa vía. Con las pruebas en vivo de arriba sin reproducir nada, la conclusión más probable es un
error visual que nunca llegó a escribir en la base — no se encontró nada que arreglar. Si Luciano
recuerda algún detalle más (pantalla exacta, mensaje de error), queda abierto para perseguirlo puntual.

**Datos de prueba que quedaron en Nalux a propósito** (confirmado con Nadia — "son datos de prueba,
no hay nada real"): el PdV "Sucursal Once" (N° 3) y los dos movimientos de $100 de arriba.

---

## ✅ Resuelto — REVOKE EXECUTE de `anon` en 3 funciones, defensa en profundidad

Último ítem del barrido de seguridad del 24/08 (`registrar_cobro_cliente`, `registrar_pago_proveedor`,
`fn_entrega_snapshot_destino`) — no había agujero real (ya probado con el ataque real, ver más
abajo), pero quedaba prolijo cerrarlo igual.

**Casi repito el mismo error que ya está documentado en mig.304→305**: el ACL real de estas 3 es
`{=X/postgres, postgres=X/postgres}` — ese `=X` sin rol a la izquierda es **PUBLIC**, no `anon`.
Un primer intento con `REVOKE ... FROM anon` fue un no-op silencioso (se verificó con
`has_function_privilege` después de aplicarlo: `anon_puede` seguía en `true`) — mismo gotcha que
ya le pasó al proyecto una vez. A diferencia del caso de mig.305, acá tampoco había una entrada
`authenticated=X/postgres` explícita: `authenticated` también accedía solo por herencia de PUBLIC,
así que revocar de PUBLIC a secas hubiera roto Cobros y Pagos para usuarios reales.

**mig.353** — el fix correcto: `REVOKE ... FROM PUBLIC` + `GRANT ... TO authenticated` explícito
en el mismo paso para las 2 funciones de negocio; `fn_entrega_snapshot_destino` (función de
trigger, ningún código del frontend la llama directo — confirmado con grep) se revoca sin GRANT a
nadie, porque un trigger se dispara con los privilegios de su dueño, no con los del rol que hizo el
INSERT/UPDATE que lo activó. Probado con `BEGIN...ROLLBACK` antes de aplicar (verificado
`anon_puede=false`, `authenticated_puede=true` dentro de la misma transacción) y reconfirmado
después de aplicar en serio.

---

## ✅ Construido — Multi-PdV con letra (A/B/C), Fase 1

Retoma `PLAN_MULTI_PDV_LETRA_POS_ERP.md`. Luciano respondió las 3 preguntas abiertas:
1. Sí, debe ser configurable desde Configuración (hoy el POS/ERP usan un único PdV "general" sin
   relación con la letra elegida) — construir la parametrización.
2. Puede haber cuantos PdV se quiera — se construyó la tabla relacional (`puntos_venta_letras`),
   no el atajo de columna array que el plan proponía solo para el caso de 1-2 PdV.
3. Solo Ventas — Compras queda fuera de alcance, sin tocar.

**mig.352** — tabla `puntos_venta_letras` (`punto_venta_id`, `letra` CHECK A/B/C,
`es_default_para_letra`), RLS por `empresa_id`, índice único parcial que garantiza un solo default
por letra por empresa. **Backfill preserva el comportamiento actual**: todo PdV activo no-`solo_remito`
recibe las 3 letras habilitadas (hoy cualquiera aparece para cualquier letra, sin relación), y el
PdV `es_default` de la empresa queda además default para las 3 — si nadie toca nada, la resolución
sigue siendo exactamente la misma que antes de esta migración. Verificado con `BEGIN...ROLLBACK`
contra Nalux real antes de aplicar, y con una consulta después de aplicar: Nalux queda con
"Punto de Venta Principal" con las 3 letras (todas default) y "Remito" sin ninguna (correcto,
`solo_remito=true`).

**Frontend, 3 archivos:**
- `ConfiguracionSection.jsx` — modal de alta/edición de PdV con 3 checkboxes "Factura A/B/C"
  (ocultas si el PdV es `solo_remito`, no tiene sentido ahí). El guardado sincroniza
  `puntos_venta_letras` por diferencia (agrega lo tildado nuevo, borra lo destildado) en vez de
  delete-then-insert a lo bruto — así no se pierde `es_default_para_letra` en cada guardado de
  rutina (ej. cambiar el CAI del remito). Nuevo handler `handleSetDefaultPvLetra` para el punto
  siguiente.
- `TabFacturacion.jsx` — columna "Letras" en la tabla de PdV; bloque nuevo "Punto de venta por
  defecto, según letra" (3 selects A/B/C, cada uno solo con los PdV habilitados para esa letra) —
  solo se muestra si hay más de un PdV facturable (con 1 solo no hay nada que elegir).
- `NuevaFacturaModal.jsx` — el selector de PdV ahora reacciona a la letra elegida en "Tipo de
  documento": con Ticket (sin CAE, sin letra) muestra todos igual que antes; con Factura A/B/C se
  filtra a los PdV habilitados para esa letra, con fallback a la lista completa si por algún motivo
  ninguno está configurado (nunca deja a alguien sin PdV para elegir). Si el PdV elegido deja de
  ser válido al cambiar de letra, salta automáticamente al default de la nueva letra.

**Importante — nada visible cambia todavía para Nalux**: hoy solo tiene 1 PdV facturable
("Punto de Venta Principal"), así que el selector filtrado siempre resuelve a ese mismo PdV sin
importar la letra — el comportamiento es idéntico al de ayer hasta que se cargue un segundo PdV
real y se lo configure con letras distintas.

**Sin verificar en vivo en el navegador** — la sesión de prueba estaba deslogueada y no corresponde
resolver eso escribiendo la contraseña. Verificado en su lugar: migración probada con
`BEGIN...ROLLBACK` contra Nalux real, aplicada y confirmada con `SELECT` directo, `eslint` 0
errores, 159/159 tests, `vite build` limpio, y revisión manual línea por línea de la lógica de
filtrado (sin bugs encontrados, un matiz de UX menor documentado en el código: si volvés de
Factura B a Factura A y el PdV que quedó seleccionado para B también sirve para A, no vuelve solo
al default de A — sigue siendo válido, solo no es "el que hubieras esperado"). **Falta la prueba
real en el navegador antes de dar esto por cerrado.**

---

## 📋 Cierre de sesión 24/08 — para que Luciano siga

Todo lo de abajo (Stock Comprometido Fase 1, barrido general de bugs, fix de la pastilla NC en
Devoluciones) quedó **commiteado, pusheado a `master` y verificado** — nada a mitad de camino.

**Lo único que quedó sin resolver, a propósito, porque depende de una decisión que no es mía ni
de Nadia sola:**

1. **Importación del resto del catálogo (3.380 productos)** — sigue pausada. Hoy Nadia creía que
   vos ya la habías hecho ("Luciano hizo eso de la importación") pero se verificó contra la base
   real (`codigo_sku` con los prefijos del import) y **sigue en 49** (el lote de prueba de 50 del
   20/08, menos el producto corrupto que se limpió ese mismo día) — los otros 3.380 no se tocaron.
   El CSV de esa sesión (`catalogo_kiosco_kairox.csv`) vivía en el scratchpad de esa sesión vieja,
   no en el repo — **ya no existe**, retomarlo implica volver a correr el scraping de Open Food
   Facts Argentina desde cero (el script `transformar_catalogo.js` tampoco quedó guardado en el
   repo, era de un solo uso). Ver la sección "2026-08-19 (noche)" más abajo para todo el detalle
   de cómo se hizo la primera vez, si sirve de referencia para rehacerlo.
2. **Multi-PdV con letra (A/B/C)** — ver sección propia más abajo. Tiene 3 preguntas de diseño
   que necesitan que estés vos en la conversación, no se puede seguir sin eso.

Le pregunté a Nadia cuál de las dos retomar y no llegamos a una respuesta clara antes de que
cortara la sesión — quedan las dos abiertas, a definir con vos.

---

## 🔧 Barrido general de bugs (24/08) — pedido por Nadia: "toda la app completa"

Recorrido completo de la app buscando errores sueltos. Hallazgos, en orden de severidad:

1. **`cae_estado` no se liberaba al cancelar un comprobante directamente** (real, corregido,
   mig.351 — `supabase/migrations/351_cancelaciones_liberan_cae_estado.sql`). Las 3 funciones de
   cancelación directa (`cancelar_factura`, `cancelar_nota_credito`, `cancelar_nota_debito` — sólo
   aplican cuando el comprobante nunca llegó a tener CAE de verdad) actualizaban
   `estado_pago='cancelada'` pero nunca tocaban `cae_estado`, que quedaba en `'error'` (o
   `'error_definitivo'`) para siempre. Encontrado con el caso real `FAC-20260823-001` (cancelada en
   esta misma sesión durante una prueba en vivo): seguía apareciendo como "Con error" en el Monitor
   de Facturación AFIP, inflando ese contador y con los botones "Reintentar"/"Usar CAEA" activos
   sobre un comprobante que ya no representa una venta real. Fix: las 3 ahora setean
   `cae_estado='no_aplica'` en el UPDATE final (mismo valor que ya usan los Tickets;
   `MonitorFacturacionAFIP.jsx` ya excluye `'no_aplica'` tanto de `REINTENTABLES` como de
   `ESTADOS_DEFAULT`, no hizo falta tocar el frontend). Probado con `BEGIN...ROLLBACK` contra
   producción antes de aplicar, y el único caso ya afectado (`FAC-20260823-001`) se corrigió al
   mismo tiempo — verificado con SQL directo que quedó en `'no_aplica'`.

2. **`TopClientes.jsx` usaba `c.nombre` como `key` de React** (real, menor, corregido). Dos
   clientes distintos pueden compartir nombre a propósito — un cliente real llamado "Consumidor
   Final" y las ventas sin cliente identificado (agrupadas aparte, ver el comentario de
   `dashboardService.ts` sobre la sesión 59) ambos se muestran como "Consumidor Final" pero son
   filas distintas — causaba key duplicada en React (warning en consola, no rompía la UI). Cambiado
   a `key={i}` (la lista no se reordena por interacción del usuario, así que el índice es estable).
   El agrupamiento del backend (`dashboardService.ts` líneas ~194-201, por `cliente_id ?? nombre:...`)
   ya era correcto — el bug era sólo el `key` del frontend.

3. **"NC" + "NC-..." duplicado en Devoluciones** (cosmético, **corregido** — Nadia pidió el fix
   después de que se lo mostrara). `CompensacionBadge` en `DevolucionesSection.jsx` mostraba una
   pastilla con el texto "NC" pegada a `dev.nota_credito.numero_venta`, que ya viene formateado
   como "NC-20260707-003" — quedaba "NC" + "NC-20260707-003" uno al lado del otro. Fix: la
   pastilla ahora muestra el `numero_venta` real cuando ya hay NC vinculada, y sólo cae al label
   genérico "NC" si todavía no se vinculó ninguna. `eslint` limpio, HMR verificado sin errores de
   compilación.

### Verificaciones automáticas (toda la app, 24/08)

- `npx eslint src` → **0 errores** (3170 warnings, casi todos `react/prop-types`, ruido de estilo).
- `npx vite build` → build de producción limpio, sin errores.
- `npx vitest run` → **159/159 tests pasan**, 18 archivos, 0 fallas.

### Integridad de datos reales en Nalux — todo verificado en cero

Asientos descuadrados (debe≠haber): 0 · stock físico negativo: 0 · `stock_disponible` negativo: 0 ·
cheques en estado inválido: 0 · `saldo_pendiente > total` en compras: 0 · `movimientos_caja` con
monto negativo: 0 · OC con recibido > pedido: 0 · `pedido_items` facturado > cantidad: 0 ·
`comprobante_items` entregada > cantidad: 0 · entregas huérfanas: 0.

Tres cosas que a primera vista parecían problemas y **no lo son** (verificadas, no descartadas):

- **11 comprobantes con `total` ≠ suma de ítems**: en los 11 la diferencia es *exactamente* el
  `iva_discriminado`. El subtotal de ítems es neto y el total lleva IVA — correcto.
- **1 cliente con saldo negativo** (Carlos Perez, −27.300): es saldo *a favor*, y el
  `saldo_actual` coincide exacto con la suma de sus movimientos de cuenta corriente.
- **8 ventas viejas sin asiento contable** (junio–06/08) — ✅ **resueltas el mismo 26/08**, ver
  sección al principio de este archivo. Las 3 anteriores al plan de cuentas (02/06 22:28) entraron
  igual, sin problema.

### Seguridad — repasada contra la política del proyecto, sin agujeros

- **RLS activo con políticas en las 24 tablas** que el frontend consulta filtrando sólo por FK.
- **Las 6 vistas tienen `security_invoker`** (`compras_saldo_pendiente`, `facturas_saldo_pendiente`,
  `productos_stock_disponible`, `retenciones_acumulado_mensual`, `v_saldo_proveedores`,
  `v_facturas_arca_monitor`) — la lección de mig.340 quedó aplicada de forma consistente.
- **3 funciones `SECURITY DEFINER` ejecutables por `anon`** (`registrar_cobro_cliente`,
  `registrar_pago_proveedor`, `fn_entrega_snapshot_destino`) que marca el advisor de Supabase:
  se probó el ataque de verdad (`SET LOCAL role anon` + llamada real dentro de una transacción con
  ROLLBACK) y **las dos que mueven plata cortan con "No autorizado: empresa_id no coincide con el
  usuario autenticado"**. La tercera es una función de trigger, no se puede invocar con sentido por
  RPC. Recomendación pendiente, no urgente: hacer `REVOKE EXECUTE ... FROM anon` igual, por
  defensa en profundidad.
- `afip_tickets` y `arca_worker_run` con RLS y 0 políticas = deny-all, y ninguna se toca desde el
  frontend (grep sin resultados): sólo las usa el worker con `service_role`. Correcto por diseño.
- Sin secretos hardcodeados: las apariciones de `APP_USR-` en `ConfigMercadoPagoModal.jsx` son
  texto de ayuda y validación de formato, ningún token real.

**Corrección del mismo día:** acá había dicho "gratis, 1 clic" para activar *Leaked Password
Protection* — no es así, ver el hallazgo ya documentado el 20/08 (sección del plan free más abajo)
y su reconfirmación en vivo hoy: **requiere plan Pro de Supabase**, bloqueado en el free que usa
Nalux. Es la misma decisión consciente de Nadia sobre el plan free, no un pendiente nuevo.

### Límite honesto de este barrido

El recorrido fue por **código y base de datos**, no por click-through visual: la sesión del
navegador se cerró a mitad del barrido y no se puede volver a entrar sin que Nadia escriba la
contraseña. Los dos bugs reales de esta lista se encontraron leyendo código y consultando la base,
no clickeando. Lo que **no** quedó verificado en vivo: que cada modal abra y cada botón responda
visualmente en pantalla.

## ✅ Verificado (24/08) — "Ver asiento" en Facturas de Compra y Recuento/Revalorización: ya estaba hecho

Nadia pidió retomar el pendiente de replicar `VerAsientoButton` en el resto de los documentos
(nota vieja, ver tabla del 21/08 más abajo). Antes de escribir código se chequeó qué documentos
generan asiento de verdad hoy — consulta directa a `asientos_contables.origen` en Nalux real:

- `venta` (160 filas), `compra` (16), `nota_credito`/`nota_credito_proveedor` (4/3),
  `cobro_cliente`/`pago_proveedor`/cheques/banco/movimiento_caja — todo lo que se espera.
- `recepcion_oc`: **1 sola fila, de junio** — ningún camino de código actual la genera (grep de
  `src/` sin resultados), es un resabio de una versión vieja del sistema, no algo que pase hoy.
- `orden_compra`: **cero filas, nunca existió** — una OC no genera asiento por diseño (es un
  pedido a proveedor, el evento contable pasa recién al facturar).
- `ajuste_stock`: **cero filas** — existe el código en `asientosAutoService.ts` pero
  `ajustar_stock_manual` (la función que corre de verdad) nunca lo llama. Código muerto.

Con esto, de los 5 documentos que se habían anotado como pendientes, sólo 2 tienen un asiento real
para mostrar: **Facturas de Compra** y **Recuento/Revalorización de Inventario**. Al revisar el
código, **los 3 ya tenían el botón correctamente cableado** —
`ModalDetalleFacturaCompra.jsx`/`ModalDetalleRecuento.jsx`/`ModalDetalleRevalorizacion.jsx`, todos
con `<VerAsientoButton asientoId={...} />` — Luciano ya lo había hecho el 22/08 (commit `7e06f4c`,
la misma tanda donde construyó el componente). La nota de "pendiente" había quedado vieja.

Verificado en vivo contra Nalux real: abierta `TEST-PARCIAL-001` (Factura de Compra real) → "Ver
asiento" → `AS-000234`, balanceado ($18.972,80 debe = haber), origen "compra" correcto.

**No se tocó código — no hacía falta.** OC/Recepciones/Ajustes de stock quedan sin el botón a
propósito (mostrarían "nada" siempre, ya que no generan asiento hoy) — si en algún momento se
decide que ajustes de stock con valorización SÍ deberían generar asiento, es una feature nueva
(conectar `ajustar_stock_manual` a `asientosAutoService`), no un simple cableado de UI.

## ✅ Resuelto (24/08) — Stock Comprometido, Fase 1 (sólo Factura de Reserva) — construido y aplicado

Retomando `PLAN_STOCK_COMPROMETIDO.md` (ver más abajo, sección "para revisar" ya resuelta). Nadia
habló con Luciano y las 3 preguntas abiertas del plan quedaron respondidas: **bloquea de verdad**
(no es un simple aviso — "si ya está reservado no tiene por qué venderse a otra persona"), sólo
cuenta desde que se **factura** (no desde el Pedido confirmado sin facturar), y el alcance queda
sólo en Factura de Reserva por ahora (Órdenes de Compra queda para una fase 2 futura).

**Hallazgo real antes de construir nada** (ver auditoría en el chat): la base real de Nalux ya
tenía 85 líneas de `comprobante_items` con `cantidad > cantidad_entregada` sin ser reservas
reales — ninguna tenía `pedido_id` (una Factura de Reserva real siempre lo requiere). Eran datos
de prueba de los primeros meses del proyecto (jun-ago/2026, la app todavía no está en el mercado,
confirmado con Nadia que no hay uso real todavía). Sin limpiarlos, "Batidora Eléctrica" hubiera
quedado con `stock_disponible = -15` y nadie podría venderla nunca más. Se limpiaron las 85 (se
marcan como ya entregadas) dejando sólo las 3 reservas reales (Mate, Termo Stanley, Lapicera — las
2 Facturas de Reserva reales del 15/08 y 18/08, con Pedido real detrás).

**mig.349** — vista `productos_stock_disponible` (`security_invoker=true`, mismo motivo que
mig.340): `stock_disponible = stock_actual - stock_comprometido`, calculado en vivo desde
`comprobante_items`/`comprobantes` (facturas `tipo='venta'`, no `cancelada`, con
`cantidad > cantidad_entregada`) — nada se guarda en una columna aparte, evita el riesgo de
desincronización. Incluye la limpieza de datos de arriba.

**mig.350** — `crear_venta` ahora valida contra `stock_disponible` en vez de `stock_actual` a
secas, **para los dos casos** (Factura de Reserva y venta física): antes la reserva no validaba
nada de stock en absoluto. Se agregó lock de fila (`SELECT ... FOR UPDATE` sobre `productos`)
también en el camino de reserva — antes no lockeaba nada ahí, así que 2 reservas simultáneas del
mismo producto podían leer el mismo "disponible" antes de que ninguna comitee y sobre-comprometer
igual. `costo_unitario` del ítem se neutraliza a `NULL` en modo reserva (mismo comportamiento que
antes, ya que el `SELECT` que lo trae ahora es incondicional por el lock).

Probado con `BEGIN...ROLLBACK` contra Nalux real antes de aplicar, usando un Pedido real de "Mate"
(subiendo temporalmente su cantidad pedida sólo dentro de la transacción para poder probar el
límite): pedir 99 unidades (excede disponible=98) fue rechazado con el mensaje de stock
insuficiente citando el disponible real; pedir 50 (dentro de lo disponible) funcionó y el
comprometido subió exactamente en 50; el stock físico no se movió en ningún caso (una reserva
sigue sin tocar `stock_actual`, sólo ahora valida antes de dejar pasar). Aplicado después del test
en verde — verificado en producción que los 3 productos con reserva real siguen con los números
correctos (Lapicera 96 disponibles, Mate 98, Termo Stanley 6).

**UI "Libre/Comprometido" — construida el mismo día, 2 bloques:**

- **Bloque 1**: nuevo hook `useStockDisponible(empresaId)` (`src/hooks/useStockDisponible.js`) —
  trae de `productos_stock_disponible` sólo los productos con algo comprometido (`gt
  stock_comprometido 0`, mismo criterio de egress que mig.333), devuelve un
  `Map<producto_id, {...}>`. Sin react-query a propósito, para servir tanto a componentes que ya
  lo usan (`ProductosSection.jsx`) como al POS con `useState`/`useEffect` simple
  (`PanelProductos.jsx`). Grilla de Productos (`TablaInventario.jsx`) y tarjetas del POS
  (`PanelProductos.jsx`) muestran "Libre: X · Comprometido: Y" bajo el stock cuando corresponde.
  `getStockLevel()` del POS pasa a calcular "bajo"/"sin stock" sobre lo disponible, no el físico a
  secas, para que el vendedor vea el mismo límite que `crear_venta` va a validar de verdad.
- **Bloque 2**: `AlertasStockBanner.jsx` (banner de stock bajo del POS) — mismo criterio de
  disponible, línea "Comprometido: N" cuando corresponde.
  `NuevaVentaModal.jsx`/`nueva-venta/PanelCarrito.jsx` (selector de producto del ERP, usado desde
  "Convertir Cotización en Venta") — mismo hook, dropdown muestra "Libre: X", y
  `handleAddToCart` valida contra disponible en vez de `stock_actual` a secas (aviso temprano,
  coherente con lo que el servidor valida igual).

Verificado en vivo contra Nalux real en los 3 lugares con el caso real de "Mate": POS, grilla de
Productos y dropdown del ERP muestran los tres "101 físico / Libre: 98" de forma consistente.

**No se tocó a propósito**: el widget "Alertas de Stock" del Dashboard — es una vista previa de 8
ítems que ya linkea a "Ver todos" (la grilla de Productos, que ya muestra el detalle correcto).
Órdenes de Compra/Recepción como capa adicional del estado de inventario sigue siendo Fase 2,
fuera de alcance.

---

## 📋 Pendiente — Multi-PdV con letra (POS/ERP)

Sigue sin decisión ni una línea de código, ver `PLAN_MULTI_PDV_LETRA_POS_ERP.md`. Hallazgo clave ya
hecho: KAIROX NO necesita clonar el modelo de 3 tablas de SAP B1 (Puntos de emisión / Serie de
folio / Relación) porque ARCA devuelve el folio real vía CAE — `series_numeracion` ya soporta
multi-PdV sin cambios. 3 preguntas abiertas para retomar con Luciano (¿el POS necesita elegir
letra al vender? ¿cuántos PdV reales va a tener una empresa en la práctica, alcanza un campo
simple en vez de una tabla nueva? ¿aplica también a Compras?).

---

## ✅ Resuelto (23/08) — Mapa: trazabilidad se cortaba con múltiples facturas por pedido + Asiento ahora es documento completo

Sexta tanda del mismo día. Con FAC-20260823-001 ya cancelada, Nadia refacturó el mismo pedido y
quedó FAC-20260823-002 (`0001-00000048` con CAE) vigente — el primer caso real en Nalux de un
Pedido con más de una Factura. Luciano marcó que el Mapa de Relaciones "se corta, según el
documento que levante muestra uno o el otro camino, no todos los documentos de ese movimiento", y
pidió además que el Asiento sea un documento completo, no un popup.

**Bug real encontrado mientras se armaba el fix (no cosmético — daba un dato falso):** la query de
entregas en `fetchMapaVenta` trae por `pedido_id` (para agarrar la entrega manual del pedido) pero
nunca filtraba por a qué comprobante está atada — al abrir el Mapa de la factura VIEJA (cancelada),
mostraba igual la entrega ENT-2026-0149 en su cadena, aunque esa entrega ya había pasado a
pertenecer a la factura NUEVA tras la cancelación (mig.348 la desvincula, no la anula). Encima el
primer intento de fix no funcionó: el filtro comparaba `entrega.comprobante_id` pero esa columna
nunca se pedía en el `.select()` — comparar contra `undefined` siempre daba "sin dueño" y dejaba
pasar todo. Los dos bugs juntos hacían que la cadena mintiera, no solo que estuviera incompleta.

**Fix (`MapaRelaciones.jsx`):**
1. `comprobante_id` agregado al `.select()` de entregas — sin esto el filtro de abajo era un no-op.
2. Entregas ligadas a OTRO comprobante del mismo pedido se descartan de la cadena actual.
3. Query nueva — todas las demás facturas del mismo `pedido_id` — sección propia "Otras facturas
   de este pedido" (no mezclada con "Documentos derivados": no son derivados DE esta factura, son
   hermanas del mismo pedido).

Verificado en los dos sentidos con el caso real: abrir desde FAC-20260823-001 (cancelada) muestra
Pedido→Factura (sin la entrega, que ya no es suya) + "Otras facturas: 0001-00000048"; abrir desde
0001-00000048 muestra Pedido→Entrega→Factura (su cadena real) + "Otras facturas: FAC-20260823-001
(Cancelada)".

**`ModalDetalleAsiento.jsx` — de popup (`max-w-lg`) a documento completo (`size="wide"`)**, mismo
patrón de header/footer que Entrega/Factura (ícono `BookMarked`, `border-b`/`border-t`, `DialogFooter`
con Cerrar). Contenido sin cambios de fondo — la restyling de campos ya se había hecho en la tanda
anterior, esto solo cambia el shell.

`eslint` 0 errores, 159/159 tests, build OK. **Sin pushear ni deployar todavía.**

---

## ✅ Resuelto (23/08) — Mapa de Relaciones: factura cancelada no se distinguía + "Cobro CC" mal etiquetado + Asiento rediseñado

Quinta tanda del mismo día, sobre la misma FAC-20260823-001 ya cancelada. Luciano abrió el Mapa de
Relaciones y el detalle del asiento con las capturas de referencia de SAP B1 al lado y marcó 3 gaps:

1. **La factura cancelada se veía igual que una vigente en el Mapa.** `compNodo` (el nodo "actual"
   de la cadena) nunca recibía `estado` — y peor, ni siquiera estaba disponible: la query principal
   de `fetchMapaVenta` (`MapaRelaciones.jsx`) seleccionaba `comprobantes` sin pedir `estado_pago`.
   Se agregó esa columna al SELECT y se pasa como `estado: mapa.comp.estado_pago` al nodo —
   `estadoColor()` ya sabía pintar `/cancelad/` en rojo, solo faltaba el dato. Verificado en vivo:
   el nodo FACTURA ahora muestra la píldora roja "cancelada" (`bg-kx-red/10 text-kx-red`), mismo
   lenguaje visual que el resto de KAIROX (no se copió el ícono de SAP, se usó el propio).
2. **"¿Qué es esto?" — la reversa de cancelación aparecía como "Cobro CC".** `cancelar_factura`/
   `cancelar_nota_credito`/`cancelar_nota_debito` insertan un HABER en
   `cuenta_corriente_movimientos` para revertir la deuda — mismo tipo de fila que un cobro real
   (`registrar_cobro_cliente`), y el Mapa las mostraba con el mismo chip verde "Cobro CC", como si
   hubiera entrado plata. Se agregó un tipo de chip nuevo, `reversa_cc` (ícono `Ban`, gris neutro),
   distinguido por el prefijo fijo `'Cancelación'` que usan todas esas RPCs — heurística simple y
   confiable (grep contra 30+ migraciones confirmó que ningún cobro real empieza así).
3. **`ModalDetalleAsiento.jsx` no coincidía con el diseño del resto de documentos.** Tenía su propio
   grid "Label: valor" en vez de las mayúsculas+tracking-wide (`Campo`) que ya usan Entrega/OC/
   Factura. Se migró a ese mismo patrón local (no ameritaba el shell tabulado completo de
   `DocumentoTabs` — es un modal "peek", no un documento de nivel superior) y se ensanchó un poco
   (`max-w-lg` → `max-w-2xl`). **Ojo:** se decidió NO copiar los campos específicos de SAP B1 de la
   captura de referencia (Serie/POI/Código de emplazamiento fiscal/montos en "MS" multi-moneda-
   sistema/jurisdicción fiscal) — son conceptos de la localización israelí/HANA sin equivalente en
   el esquema impositivo argentino de KAIROX. Se mantuvo la misma información que ya mostraba
   (fecha, origen + número de documento, centro de costo, descripción, líneas, totales), solo con
   el estilo homogeneizado.

Verificado en vivo contra Nalux real (mismo caso FAC-20260823-001/ENT-2026-0149/PED-20260823-001):
Mapa muestra "FACTURA...cancelada" en rojo y "REVERSA CC / Cancelación Factura..." como chip
separado. `eslint` 0 errores, 159/159 tests, build OK. **Sin pushear ni deployar todavía.**

---

## ✅ Resuelto (23/08) — Cancelar Factura: el cartel de confirmación quedaba pegado entre aperturas

Cuarta tanda del mismo día. Luciano probó "Cancelar Factura" sobre FAC-20260823-001 (letra A, sin
CAE — `cae_estado='error'` — el caso exacto que el RPC `cancelar_factura` (mig.259) permite
revertir directo, sin pasar por Nota de Crédito). Al confirmar, el modal se cerró; al reabrir la
misma factura, el cartel "¿Cancelar Factura...?" volvía a aparecer solo. Se verificó contra la DB
real (`isvkelrdxwvkfmrfqxxk`) que la factura **seguía `estado_pago='pendiente'`** — la cancelación
nunca se aplicó — y que no hay ningún log (`postgres_logs`/`edge_logs`) de que el RPC se haya
llegado a invocar. El RPC en sí no tenía ningún guard que la bloqueara (sin CAE, sin imputaciones
de CC, sin movimientos de caja) — el problema era 100% de frontend.

**Causa real:** `SaleDetailModal.jsx` no se desmonta al cerrarse — el padre solo cambia `open` y el
componente devuelve `null`, la instancia sigue viva. El `useEffect` que resetea el estado al cerrar
(`open === false`) limpiaba `sale`/`items`/`flow`/`isEditing`, pero **no** `showCancelarConfirm`,
`motivoCancelacion` ni `cancelando`. Si el `AlertDialog` de confirmación quedaba abierto (ej. el
usuario cierra el modal completo con Escape o clickeando afuera, en vez de "Volver") sin haber
confirmado, `showCancelarConfirm` quedaba en `true` para siempre — al reabrir esa misma factura,
el cartel reaparecía solo, sin que nadie lo pidiera, y encima con `sale` recién refetcheado (por
eso el fondo mostraba los datos reales y el cartel a la vez). Fix: el `useEffect` de cierre ahora
también resetea esos 3 estados.

Reproducido y verificado en vivo, sin mutar datos reales: abrir la factura → Cancelar Factura →
Escape (cierra todo con el cartel abierto) → reabrir la misma factura → antes reaparecía el
cartel, ahora muestra el detalle normal. `eslint` 0 errores, 159/159 tests, build OK. **Sin
pushear ni deployar todavía.**

---

## ✅ Resuelto (23/08) — Factura: no dejaba el documento nuevo a la vista + diseño distinto al de Entrega

Tercera tanda del mismo día. Luciano abrió FAC-20260823-001 (la factura real generada desde
ENT-2026-0149) y encontró dos problemas de UX/consistencia, no de datos:

1. **"Facturar Entrega" no dejaba nada a la vista.** Mismo problema que ya se había resuelto para
   Pedido → Entrega (`PedidosSection.handleEntregaSuccess`, que navega directo al documento nuevo
   en vez de volver a la lista) pero nunca se replicó para Entrega → Factura. Al facturar una
   entrega, el modal de Entrega se cerraba, se creaba la factura, y el usuario quedaba en la lista
   de Entregas sin ver ni la entrega base ni la factura nueva — había que ir a buscarla a mano.
   Fix en `EntregasSection.jsx` (`handleSaleSuccessDesdeEntrega`): mismo criterio que Pedidos,
   llama `onNavigate('factura', comprobanteId)` al terminar, así el documento recién creado queda
   en pantalla (estilo SAP B1: el documento agregado se muestra, no se vuelve al origen).
2. **El diseño de Factura no coincidía con el de Entrega.** Comparando ambos modales lado a lado:
   Entrega/OC ya usaban labels de cabecera en MAYÚSCULAS (`text-kx-text-3 uppercase
   tracking-wide`) + ícono antes del título + tabla de ítems "plana" (sin caja, sin fondo de
   header); Factura (`SaleDetailModal.jsx`) era la única que usaba el `CampoDato`/`GrillaCampos`
   genérico (sentence-case) para la cabecera y una tabla con caja/borde/fondo/hover — la única
   "distinta" de las cuatro. Se readaptó Factura al patrón mayoritario (Entrega + OC): cabecera
   con el mismo componente `Campo` local (mayúsculas), ícono `Receipt` verde antes del número de
   comprobante, tabla de ítems sin caja con el mismo criterio de Neto gravado/IVA/TOTAL que ya usa
   Pedido — sin sacar ningún dato de los que ya mostraba (CUIT/DNI, Pedido de origen, Entrega,
   desglose de IVA, tabs de Comunicación Electrónica/Contabilidad/Logística). De paso se encontró
   y corrigió un bug real de HTML inválido: el campo "Estado de pago" mete un `<EstadoBadge>`
   (que renderiza un `<div>` vía el `Badge` de shadcn) — el wrapper de `Campo` pasó de `<p>` a
   `<div>` para no anidar `<div>` dentro de `<p>`.

Verificado en vivo contra Nalux real (FAC-20260823-001 real, con Pedido/Entrega/Factura
encadenados) — DOM confirmado vía JS (`innerText` del diálogo), sin warnings de nesting ni
errores de consola nuevos. `eslint` 0 errores, 159/159 tests, build OK. **Sin pushear ni
deployar todavía** — Luciano pidió seguir reparando antes de subir nada.

---

## ✅ Resuelto (23/08) — 3 arreglos chicos: crash de stock, menú Editar/Duplicar, Cotización sin cliente

Sesión de "arreglos simples" tras probar en producción. Tres hallazgos reales, no cosméticos:

1. **Cotización perdía el `cliente_id` al reeditarse.** El input de Cliente en
   `FormNuevaCotizacion.jsx` es texto libre a propósito (permite escribir uno nuevo), pero
   **cualquier tecla** en ese campo dispara `cliente_id: ''` — no solo cuando el texto final deja
   de matchear a nadie. Si el campo se tocaba y el texto final terminaba coincidiendo con un
   cliente real, `cliente_id` se guardaba en NULL igual: la cotización quedaba con
   `cliente_nombre` correcto (por eso se veía bien en el detalle) pero desvinculada del cliente
   real, rompiendo "Copiar a Pedido" (`PedidosSection.jsx` solo lee `cliente_id`, sin fallback).
   Fix en `handleSubmit` (`CotizacionesSection.jsx`): si el nombre final coincide exacto con un
   cliente real, resuelve el id igual aunque no se haya clickeado la opción del desplegable.
   **Se encontraron y repararon 14 cotizaciones históricas más** con el mismo patrón (desde el
   08/06) via UPDATE puntual contra prod — quedó 1 sin resolver (`COT-00001`, "Marta Perez", sin
   cliente activo con ese nombre).
2. **Crash real generando Entrega con cantidades parciales.** `GenerarMovimientoModal.jsx`
   precargaba "A entregar" con todo el pendiente del pedido sin mirar `stock_actual` — un ítem
   con 0 en stock aparecía igual con cantidad lista para confirmar, y el RPC `crear_entrega` lo
   rechazaba recién al guardar (se sentía como un crash). Fix acotado a Entrega vía flag
   `necesitaStock` (Recepción no lo necesita, siempre suma): el tope de cada ítem pasa a ser
   `min(pendiente, stockDisponible)`, precargado clampeado, input deshabilitado en 0, con aviso
   "Sin stock disponible" / "Stock disponible: X".
3. **Editar/Duplicar detrás de un menú "···".** Pedido explícito: esos botones tienen que seguir
   disponibles pero no tan a mano como el resto — riesgo de click accidental. Nuevo
   `MenuAccionesDocumento.jsx` (icono + dropdown), reusado en los 4 documentos que ya ofrecían
   esta posibilidad (Cotización, Pedido, OC, Factura de Compra). El `onSelect` + `setTimeout`
   del ítem de menú no es cosmético — mismo workaround que ya usa `HistorialVentas.jsx` para que
   Radix termine su cleanup de foco antes de que Editar/Duplicar abran otro Dialog encima; sin
   eso la página se congela.

Verificado en vivo contra Nalux real. `eslint` 0 errores, 159/159 tests, build OK.

---

## ✅ Resuelto (23/08) — ajustes de Punto de Venta, remito y flujo de Pedidos

Mismo día, segunda tanda — 3 ajustes más chicos, uno grande solo planificado (no construido, a
pedido explícito de Luciano).

1. **"En Preparación" pasa a ser opcional** (`empresas.usa_estado_en_preparacion`, mig.347,
   default `true`). Útil para cadenas de suministro grandes; estorba a procesos más acotados.
   Instrucción explícita de Luciano al diseñarlo: **"ninguna configuración debería interferir con
   el histórico, solo de aquí para adelante"** — apagar el toggle NUNCA migra pedidos que ya
   estén en `en_preparacion`; en cambio, `PedidosSection.jsx` muestra un aviso propio ("Hay N
   pedidos en 'En Preparación' de antes...") si queda alguno huérfano, para poder tratarlos a
   mano. Centralizado en `getSiguienteEstado(estadoActual, usaEnPreparacion)` (`pedidos/shared.jsx`)
   — reemplaza el `getEstado(x).next` estático en los 3 lugares que calculaban "cuál es el
   siguiente estado" por separado (`PedidosSection`, `TablaPedidos`, `ModalDetallePedido`).
2. **El PdV de remito ya no aparece en "Nueva Factura".** Investigado: `envia_arca=false` NO
   alcanza como criterio de exclusión — el propio `TabFacturacion.jsx` ya lo usa a propósito para
   el PdV interno del Modo Caja (POS que no manda a ARCA pero SÍ factura internamente, caso
   legítimo). La distinción real es otra: un PdV puede existir ÚNICAMENTE para numerar remitos
   (CAI de remito) — nueva columna `puntos_venta.solo_remito` (mig.346), con su propio switch en
   el form de PdV, excluido del select de `NuevaFacturaModal.jsx`. `emitir_remito` prioriza PdV
   `solo_remito=true` al resolver el PdV interno por defecto (antes tomaba "el primero con
   `envia_arca=false`" a secas). Bonus: el selector ahora muestra `"PdV {numero} — {nombre}"` en
   vez de `"{numero} · {nombre}"`, mismo formato que ya usaba el selector del Modo Caja.
3. **Remito: CAI + vencimiento al pie, destino en el encabezado.** Investigado antes de tocar
   nada: el vencimiento del CAI **no se puede sacar** — RG AFIP lo exige mostrado en el documento
   impreso, igual que el vencimiento del CAE en una factura. Se reubicó (CAI + vencimiento pasan
   al pie de `RemitoPDF.jsx`, mismo bloque que el pie de página existente) y el espacio que dejó
   libre en el encabezado ahora lo ocupa el destino de la mercadería + datos del comprador
   ("Entregar a" con nombre, dirección, ciudad y CUIT/DNI, todo junto para no repetirlo después).
   La caja "RECEPTOR" separada que existía antes se sacó (quedaría duplicando lo del encabezado);
   sobrevive una caja chica de Transportista, solo si hay transportista cargado. No bloquea la
   emisión si falta el domicilio — muestra "Sin domicilio de entrega cargado" en su lugar
   (mismo criterio de aviso honesto que el resto de la sesión, no gate duro).
4. **[PLAN_MULTI_PDV_LETRA_POS_ERP.md](PLAN_MULTI_PDV_LETRA_POS_ERP.md) — documentado, NO
   construido**, a pedido explícito de Luciano ("si querés solo planificalo... para encarar más
   tarde"). Hallazgo clave de la investigación: KAIROX **no necesita** un calco del modelo de 3
   tablas de SAP (Puntos de emisión / Serie de folio / Relación serie-documento) — esa numeración
   pre-reservada es del régimen viejo de AFIP; KAIROX ya usa CAE en línea (WSFEV1), donde ARCA
   devuelve el folio real, no hace falta pre-asignarlo local. El gap real es de config/selección
   (qué PdV ofrecer según la letra elegida), no de numeración — mucho más chico de lo que parecía
   por las capturas de SAP. El documento deja 3 preguntas abiertas para retomarlo.

Verificado en vivo contra Nalux real (toggle de En Preparación probado y revertido a `true`,
selector de PdV sin "Remito", generación de PDF del remito sin errores en consola contra una
entrega real). `eslint` 0 errores, 159/159 tests, build OK. **Sin pushear ni deployar todavía —
Luciano pidió seguir reparando antes de subir nada.**

---

## ✅ Auditoría (22/08 noche) — motor contable + seguridad + regresión, antes del deploy final del día

Antes de cerrar la sesión más larga del 22/08 (items 5, 6, 7 + los 3 hallazgos de arriba), Luciano
pidió una revisión explícita de que nada se hubiera roto. Se corrió `npx eslint src` completo (0
errores en todo el repo), `npx vitest run` (159/159) y `npx vite build` en limpio, y se
desplegaron 3 agentes especializados en paralelo sobre el diff completo del día
(`c6d6d7c..HEAD`, 8 commits):

- **`sap-motor-contable-auditor`** — comparó carácter por carácter los cuerpos de
  `registrar_cobro_cliente`/`registrar_pago_proveedor` (mig.343) contra sus versiones previas: el
  único diff real es el parámetro `p_referencia_pago` nuevo y la columna que agrega al INSERT —
  toda la lógica de débito/haber, cuentas del plan (1.1.1/1.1.2/1.1.8/2.1.1/4.4/5.9), diferencia
  de cambio y el guard `total_debe=total_haber` quedaron intactos. Confirmó que mig.345 no toca
  ninguna tabla contable, y que `TabContabilidad.jsx`/`documentFlowService.ts` son 100% lectura.
- **`appsec-secure-coding`** — sin hallazgos críticos ni altos. Los checks de autorización
  (`get_my_empresa_id()`, `has_module_permission`) siguen intactos en las 2 RPCs tocadas; el
  trigger de mig.345 queda acotado por RLS aunque es `SECURITY DEFINER`; sin secretos ni datos
  reales commiteados; sin `dangerouslySetInnerHTML`/`innerHTML` en el nuevo recibo imprimible.
  Único ítem informativo (no introducido hoy, preexistente): 2 queries de solo lectura sin filtro
  `empresa_id` explícito además de RLS — no es una fuga, es higiene para el futuro.
- **`frontend-architect`** — revisión línea por línea de `SaleDetailModal.jsx` (el archivo editado
  con un script de Node por rango de líneas, el método más propenso a error de la sesión): JSX
  balanceado, sin fragmentos huérfanos del panel viejo de CAE, las 4 funciones críticas
  (`handleReintentarCae`, `handleCancelarFactura`, `handleRegenerarAsiento`, `handleUpdateStatus`)
  siguen conectadas correctamente tras mover las acciones al footer. Sin imports rotos tras borrar
  `DocumentFlowPanel.jsx`.

**Cerrado el único punto que los agentes dejaron "a confirmar"** (no tenían acceso al proyecto
Supabase desde su sandbox): se corrió en vivo contra `isvkelrdxwvkfmrfqxxk` —
`select proname, count(*) from pg_proc where proname in (...) group by proname` da **1 versión**
de cada RPC (no quedó el overload viejo), y un chequeo de integridad real sobre TODA la tabla
`asientos_contables` (no solo el diff de hoy) — **0 asientos con `total_debe ≠ total_haber`** en
toda la base de Nalux.

**Veredicto: motor contable íntegro, sin hallazgos de seguridad bloqueantes, sin regresiones de
frontend.** Deploy autorizado.

---

## ✅ Resuelto (22/08 noche) — 3 hallazgos probando el item 7 en producción

Luciano probó el item 7 recién deployado y encontró 3 problemas reales, con capturas comparando
Factura vs Entrega. Los 3 se rastrearon a causas concretas y se corrigieron:

**1. El sidebar tapaba modales de alta ("Nueva Cotización" clippeada, texto cortado).**
El rollout de `size="wide"` (item 5) migró los modales de *detalle* pero se salteó los de
**alta**: `FormNuevaCotizacion` (vía `CotizacionesSection.jsx`), `ModalPedidoForm.jsx`,
`OrdenesCompraSection.jsx` (Nueva OC) y `NuevaFacturaModal.jsx` seguían con su propio
`max-w-[96vw]` manual, que no descuenta el ancho del sidebar (z-60). Los 4 pasaron a
`size="wide"`. De paso se corrigió `MapaRelaciones.jsx` en modo `fullscreen` (mismo patrón,
usaba `size={fullscreen ? 'wide' : 'default'}` con `twMerge` dedupeando `max-w-5xl` contra el
`max-w-lg` de `size="default"` en el modo no-fullscreen).

**2. El diseño de Factura seguía sin ser igual al de Entrega.** Dos causas:
- El header eran dos tarjetas sueltas ("Cliente" + "Estado de Pago") en vez de la
  `GrillaCampos`/`CampoDato` unificada que ya usa Entrega — con las acciones (Registrar Cobro,
  Cancelar Factura, editar estado) embebidas ahí en vez de vivir en el footer.
- El flujo del documento usaba `DocumentFlowPanel.jsx` (tarjetas con monto/fecha/estado,
  fetch propio vía `documentFlowService`), un componente visualmente distinto al `DocumentFlow.jsx`
  de pastillas-con-flechas que usa Entrega/OC/Compra.
- Se rediseñó `SaleDetailModal.jsx`: header en grilla (Estado de pago editable inline / Forma de
  pago / Fecha / Cliente / CUIT-DNI / Pedido u Cotización de origen / Entrega), acciones movidas
  al footer (mismo layout que Entrega: Cerrar+Cancelar a la izquierda, Registrar Cobro+Imprimir a
  la derecha), y el flujo pasó a usar `DocumentFlow` con chips construidos desde
  `documentFlowService`. Se agregaron los tipos `venta`/`cobro_cc` al `CHIP_CONFIG` compartido.
  **`DocumentFlowPanel.jsx` quedó sin uso — se borró** (era dead code después del cambio).
- Bonus real (no cosmético): `documentFlowService.ts` no traía la Entrega vinculada al
  comprobante, así que el flujo de Factura mostraba "PEDIDO → VENTA" sin el eslabón físico
  intermedio que Entrega sí mostraba ("PED → ENT → FAC"). Se agregó el fetch de `entregas` por
  `comprobante_id` — ahora la cadena es idéntica en ambos documentos.

**3. No se podía "cargar" el punto de venta, y el número mostrado no era el folio real.**
Investigando encontramos que `numero_afip` (formato `"0001-00000047"`, PdV+folio) **ya vivía en
la base** desde que existe facturación electrónica — pero casi ninguna pantalla lo usaba como
número principal, mostraban `numero_venta` (el correlativo interno, `"FAC-20260822-001"`), que
ni el cliente ni ARCA reconocen. `FacturaPDF.jsx` y `ReporteLibroIVA.jsx` ya hacían el fallback
correcto (`numero_afip ?? numero_venta`); el resto no. Se creó
[`src/lib/numeroComprobante.js`](src/lib/numeroComprobante.js) — `formatNumeroComprobante()`
devuelve `"{letra} {numero_afip}"` cuando hay CAE, si no cae a `numero_venta` — y se aplicó en:
título de `SaleDetailModal`, columna principal de `HistorialVentas`, línea "Nro:" de
`ComprobantePrintModal` (bug real: mostraba el interno aunque arriba ya mostrara el folio),
y los nodos `venta`/`nota_credito` de `documentFlowService`. **Quedan sin tocar a propósito**
(mismo patrón, extensible si se pide): ticket del POS, Cheques, y otras referencias cruzadas de
solo lectura (ej. `ModalDetallePedido` mostrando el número de la factura vinculada).

Además, el selector de Punto de Venta en `NuevaFacturaModal.jsx` **existía pero estaba oculto**:
solo se mostraba si `tipoDoc !== 'Ticket'`, y el modal abre con `tipoDoc='Ticket'` por defecto —
el usuario nunca lo veía sin cambiar antes el tipo de documento. El PdV se guarda siempre
independientemente del tipo (`punto_venta_id` en el insert, línea ~500), así que ocultarlo no
tenía sustento funcional. Ahora es siempre visible, con un mensaje que explica que con Ticket no
se emite CAE (antes esa explicación tampoco existía).

**Verificado en vivo contra producción real (Nalux):** modal de Nueva Cotización con
`left: 252px` (ya no tapado), sidebar clickeable con el modal abierto; Nueva Factura con el
selector de PdV visible desde el arranque; Factura `FAC-20260822-001` (sin CAE, PdV no fiscal)
con el header/flujo idénticos a Entrega, mostrando `ENT-2026-0148` en la cadena; Factura con CAE
real mostrando `"C 0001-00000047"` como título Y en el listado. `npx eslint` 0 errores (solo
warnings pre-existentes), `npx vitest run` 159/159, `npx vite build` OK.

---

## ✅ Resuelto (22/08) — Item 7: shell tabulado estilo SAP + direcciones de socios de negocio

Último ítem del plan de rediseño del 22/08, y el único que Luciano quiso conversar antes de
construir ("cuando lleguemos al 7, hagamos un stop y veamos qué es lo que realmente vamos a
poner"). El alcance se acordó en esa charla; se descartó "Anexos/Adjuntos".

**El aporte de Luciano que cambió el diseño:** planteó que si copiábamos la solapa de Entregas de
SAP, había que tocar también la carga de clientes y proveedores para que la entrega pudiera
seguir los datos de dirección. Al mapearlo apareció que tenía razón, y algo peor:

- `clientes` tenía SOLO `direccion` (texto libre) — sin localidad, provincia ni CP.
- `proveedores` estaba **más** completo (tenía localidad y provincia), al revés de lo necesario.
- `entregas` no tenía ninguna columna de destino.
- Y `RemitoPDF.jsx` imprimía `cliente.direccion` a secas: **el remito salía sin localidad ni CP,
  inservible para que un transportista entregara.** Un documento operativo roto, no cosmética.

**Solapas construidas** (3 de 4 fueron puro frontend, sin migración — los datos ya existían):

| Solapa | Contenido | Backend |
|---|---|---|
| Contenido | Ítems, totales, flujo del documento | — |
| Comunicación Electrónica | CAE, vto., estado, tipo comprobante, N° ARCA, PdV, CAE vs CAEA, error legible | ya existía |
| Contabilidad | Asiento (reusa `VerAsientoButton` del item 4), centro de costo, vencimiento, moneda/TC, COGS | ya existía |
| Logística | Domicilio de destino, transportista, observaciones | **mig.345** |

**Decisiones de diseño que conviene no revertir:**

1. **Primitivas compartidas en `src/components/shared/documento/`** (`DocumentoTabs.jsx` con
   `DocumentoTabsList` / `DocumentoTab` / `PanelSeccion` / `CampoDato` / `GrillaCampos` /
   `SolapaVacia`). La consistencia que pidió Luciano ("es mandatorio que todos los comprobantes
   tengan el mismo diseño") no puede depender de que cada modal copie clases a mano — el estilo
   vive en un solo lugar y los documentos componen.
2. **Solapas con subrayado, no pastillas.** Las pastillas ya significan "navegación de sección"
   (ej. `CuentaCorrienteSection`); el subrayado significa "estás dentro de un documento". Son dos
   niveles de jerarquía distintos, igual que en SAP.
3. **Punto ámbar en la solapa** cuando tiene algo accionable (CAE con error, asiento faltante).
   El usuario ve el problema sin abrir las 4 solapas. Usarlo solo para cosas accionables — no
   para "este documento no tiene X y está bien".
4. **La Entrega CONGELA el domicilio** (Regla 7). Si el cliente se muda, el remito viejo tiene que
   seguir diciendo dónde se entregó. Las columnas `destino_*` son texto plano e independientes de
   dónde salió la dirección: el día que exista una tabla `direcciones` multi-dirección, se agrega
   `destino_direccion_id` al lado y estas siguen funcionando sin romperse.
5. **El congelado se hace con un TRIGGER**, no modificando `crear_entrega` / `crear_entrega_manual`.
   Son dos RPCs distintas y agregarles parámetros nos volvía a exponer al bug de sobrecarga de
   `CREATE OR REPLACE` que ya mordió dos veces (`crear_venta` el 14/08, `registrar_cobro_cliente`
   el 22/08). El trigger cubre ambos caminos sin tocar ninguna firma.
6. **Sin backfill, a propósito.** Las entregas viejas quedan con `destino_*` en NULL; el frontend
   cae al maestro y **avisa en ámbar** que ese domicilio puede no ser el de aquel momento.
   Rellenarlas afirmaría algo que no podemos verificar.
7. **`transportista` es texto libre** en el documento (como `observaciones`), no un maestro creado
   al vuelo — eso violaría la Regla 2. Si hace falta un maestro, se agrega `transportista_id` al
   lado y este campo queda como snapshot del nombre.
8. **La Entrega no lleva solapa Contabilidad** (no genera asiento propio: el costo se contabiliza
   en la Factura, mig.287) y **la Factura no congela domicilio** (eso es del evento físico,
   Regla 8). Sus solapas son Contenido · Logística · Remito. Que un documento tenga 3 solapas y
   otro 4 es correcto: el diseño es idéntico, la cantidad de información varía.

**Verificado en vivo contra producción real (Nalux):** las 4 solapas de Factura
(`FAC-20260822-001`) y las 3 de Entrega (`ENT-2026-0148`); el trigger probado con
`BEGIN...ROLLBACK` en dos casos — sin destino explícito copia los 4 campos del maestro, con
destino explícito ese valor gana y se completa el resto (0 filas persistidas, confirmado). La
solapa Comunicación Electrónica muestra correctamente el estado `no_aplica` nombrando el PdV
("Punto de Venta Principal" está como no fiscal). `npx eslint` 0 errores, `npx vitest run`
159/159, `npx vite build` OK.

**Pendiente natural (no urgente):** extender el shell tabulado al resto de los modales de
documento (OC, Factura de Compra, Cotización, Pedido, Devoluciones, Recuento, Revalorización) —
las primitivas ya están, es composición. Y cargar los domicilios reales de los clientes de Nalux:
hoy varios tienen dirección pero sin localidad ni CP (ej. Carlos Perez, "Av. Puerto madeo").

---

## ✅ Resuelto (22/08) — Rediseño de Cobro/Pago, item 6 del plan (referencia por método + comprobante imprimible)

Sexto ítem del plan de rediseño de documentos iniciado el 22/08 (magnitud "🔴 Grande" original;
items 1-5 — nav bug, formato unificado, Mapa de Relaciones, Ver Asiento, ancho de modales — ya
cerrados antes de este). Alcance acordado: **solo** lo pedido explícitamente ("revisar el
comprobante de pago" + embeber medio de pago). El rediseño tabulado tipo SAP con solapa de
"Comunicación Electrónica" (item 7) sigue pendiente de la charla de scope explícita que Luciano
pidió antes de tocarlo.

**Qué se hizo (simétrico en Cuenta Corriente de clientes y de proveedores):**

1. **Campo de referencia condicional por método de pago** — `ModalCobro.jsx` (clientes) y el
   diálogo de pago de `ProveedoresSection.jsx` (proveedores) ahora muestran un campo extra según
   `formas_pago.tipo_instrumento` de la forma seleccionada: "N° de operación / referencia" en
   transferencia/billetera, "N° de cupón / autorización" en tarjeta débito/crédito. Efectivo no
   muestra nada. Antes solo existía "Nota" (texto libre sin campo dedicado).
2. **Columna `referencia_pago`** nueva en `cuenta_corriente_movimientos` y
   `cuenta_corriente_proveedores` (mig. 343) — el valor viaja por un parámetro nuevo
   `p_referencia_pago` en `registrar_cobro_cliente` y `registrar_pago_proveedor`.
3. **Comprobante de Pago imprimible** — `src/components/shared/ReciboPago.jsx`, mismo patrón que
   `TicketPrint.jsx` del POS (nodo oculto siempre en el DOM + `@media print` inyectado por
   `src/lib/printRecibo.js` + `window.print()`). Se arma en memoria al confirmar el cobro/pago
   (sin ida y vuelta al servidor) con contraparte, monto, método, referencia, facturas imputadas y
   saldo anterior/nuevo. Botón "Imprimir" aparece como acción del toast de éxito. No es un
   comprobante fiscal — usa un N° interno (primeros 8 caracteres del id del movimiento), no
   numeración ARCA.

**Bug real encontrado aplicando la migration — mismo patrón que el de `crear_venta` del 14/08:**
`CREATE OR REPLACE FUNCTION` con un parámetro nuevo (`p_referencia_pago`) no reemplazó las
funciones existentes — creó una sobrecarga nueva, quedaron 2 versiones de cada RPC (13 y 14 args)
conviviendo en prod. Se detectó reconsultando `pg_get_function_arguments` después de aplicar la
migration (ya es costumbre verificar esto tras cualquier `CREATE OR REPLACE` que agregue params) y
se corrigió con `DROP FUNCTION` explícito de las firmas viejas (mig. 344) antes de dar por cerrado
el item.

**Verificado:** `npx eslint` sin errores nuevos (solo warnings pre-existentes de prop-types),
`npx vitest run` 159/159, `npx vite build` OK. En vivo contra producción real (Nalux): el campo de
referencia aparece/desaparece correctamente al cambiar método de pago, tanto en el cobro a
"Jhon V." (clientes) como en el pago a "Alibaba" (proveedores) — verificado sin someter ningún
cobro/pago real (dev preview comparte la base con producción, no se mutan datos de prueba).

**Migración aplicada a prod** (`isvkelrdxwvkfmrfqxxk`) con confirmación explícita de Luciano antes
de ejecutar — mig. 343 + 344 (fix del overload), ambas ya en `supabase/migrations/`.

---

## ✅ Resuelto (14/08 tarde) — "Facturar Entrega/Pedido" ya no abre el POS

Era el PENDIENTE #1 que Luciano dejó anotado la noche del 14/08 (ver historial abajo para el
diagnóstico original). Resumen del fix:

**Qué se hizo:** en vez de escribir una RPC nueva que duplicara la lógica de Document Flow de
`crear_venta` (skip de stock si el pedido ya tuvo Entrega manual, tope de sobre-facturación contra
`pedido_items`, vínculo `pedidos.comprobante_id` / `entregas.comprobante_id`, COGS), se **extendió
`crear_venta`** (mig. 325) con 3 parámetros opcionales al final de la firma —
`p_tipo_comprobante_afip`, `p_punto_venta_id`, `p_referencia_cliente` (`DEFAULT NULL`, las 3
columnas ya existían en `comprobantes`) — así los llamadores existentes (POS, "Copiar
cotización→venta") no cambian ni una línea. `NuevaFacturaModal.jsx` ganó un prop `pedido`: cuando
viene seteado, precarga ítems/cliente desde el pedido (mismo criterio que ya usaba
`NuevaVentaModal`: `precio_unitario`/`descuento_item` de `pedido_items` sin descontar) y
`handleConfirmar` llama a la RPC extendida en vez del INSERT manual standalone (que sigue 100%
igual para facturas sin pedido — nunca mueve stock). `EntregasSection.jsx` y `PedidosSection.jsx`
ahora abren `NuevaFacturaModal` con ese prop en vez de `NuevaVentaModal`.

**Bug real encontrado probando la migration antes de tocar el frontend:** `CREATE OR REPLACE
FUNCTION` en Postgres sólo reemplaza si la lista de TIPOS de parámetros es idéntica. Al agregarle
3 parámetros nuevos a `crear_venta`, Postgres no la reemplazó — creó una **sobrecarga nueva**, y
quedaron dos versiones de `crear_venta` conviviendo (22 y 25 parámetros). Cualquier llamada normal
del POS/ERP hubiera fallado con `function ... is not unique` (ambigüedad, PostgREST no puede
elegir). Se detectó probando la migration contra datos reales (pedido con Entrega manual previa,
dentro de una transacción con `ROLLBACK`) antes de tocar una sola línea de frontend — se arregló
con `DROP FUNCTION` explícito de la sobrecarga vieja (mig. 325b) antes de seguir. **Lección para
cualquier migration futura que le agregue parámetros a una función existente:** verificar después
con `SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = '...'` que quedó
una sola versión — `CREATE OR REPLACE` no es suficiente por sí solo.

**Verificado antes de aplicar:** dos llamadas reales contra la base (pedido `PED-20260814-001`,
que ya tenía una Entrega manual confirmada) dentro de transacciones con `ROLLBACK` — (1) llamada
"vieja" sin los 3 parámetros nuevos → sin ambigüedad, stock se descontó normal (caso sin pedido
vinculado); (2) llamada nueva con `p_pedido_id` + los 3 campos de factura → stock NO se volvió a
descontar (ya había Entrega), `comprobantes.tipo_comprobante_afip/punto_venta_id/referencia_cliente`
quedaron guardados, `pedido_items.cantidad_facturada` se actualizó. `npx eslint` sin errores nuevos,
`npx vitest run` 156/156, `npx vite build` OK.

**Verificado en vivo por Nadia (14/08 tarde), local:** Facturar Pedido abrió `NuevaFacturaModal`
(no el POS), generó `FAC-20260814-001` correctamente vinculada a `PED-20260814-004`, y quedó
encadenada en el Flujo del Documento Pedido → Entrega → Factura. Confirmado también contra la base:
un solo movimiento de stock (el de la Entrega original, no uno nuevo de la factura) y
`costo_mercaderia_vendida = 0` en el comprobante (correcto — el costo ya se había contabilizado).

---

## ✅ Resuelto (14/08 tarde) — barrido con el plan de pruebas de Nadia

Nadia corrió los 6 bloques de `PLAN_PRUEBAS_NADIA_2026-08-15.md` en local (no en producción, ya
que el fix de arriba todavía no estaba deployado). Bloques 1, 2, 4, 5 y 6 pasaron limpios. De paso
aparecieron 3 bugs reales más, los 3 arreglados y verificados:

1. **`ModalDetallePedido.jsx` — columna Subtotal mostraba $0,00.** La columna calculaba
   `cantidad_entregada × precio` (el monto ya entregado — que ya tenía su propio renglón "Total
   entregado" aparte) en vez del subtotal real de la línea. Un pedido recién creado, sin nada
   entregado todavía, mostraba $0,00 en todas las filas. Dato en la base siempre estuvo bien — era
   puramente visual. Fix: usar `item.subtotal` directo, mismo criterio que ya usaba
   `ModalDetalleOC.jsx` (Compras) correctamente.
2. **Desplegable de producto cortado en Cotizaciones/Pedidos/OC.** La lista de ítems tiene su
   propio scroll interno, y el desplegable de autocompletar (`position: absolute` dentro de la
   fila) quedaba recortado por ese contenedor — apenas se veía la primera sugerencia, cortada al
   medio. Nuevo componente compartido `src/components/shared/ProductoAutocomplete.jsx`: el
   desplegable se renderiza en un portal a `<body>` con `position: fixed`, así ningún scroll lo
   puede recortar (se reposiciona solo, y abre hacia arriba si no entra abajo). Reemplazado en los
   3 formularios. Verificado en vivo en los tres: desplegable completo y selección funcionando.
3. **`PedidosSection.jsx` — editar un pedido volvía a la lista en vez de reabrir el detalle.** Al
   crear un pedido nuevo, el detalle se reabría solo (bloque 2 del plan, arreglo de Luciano
   anoche) — pero al EDITAR uno existente y guardar, el código nunca hacía lo mismo, así que
   volvía a la lista y había que re-entrar a mano para ver el pedido actualizado. Fix: la misma
   variable que reabre el detalle tras crear ahora también se setea tras editar. Verificado en
   vivo con `PED-20260814-005`.

`npx eslint` sin errores nuevos, `npx vitest run` 156/156, `npx vite build` OK — verificado después
de cada uno de los 3 fixes.

**Dos falsos positivos descartados, documentados para no repetir la duda:** en un momento tanto
Nadia como yo vimos filas de ítems "vacías" pese a tener datos correctos (confirmado contra el
HTML/DOM directo). Causa: cuando el panel del navegador pierde el foco un instante, Chrome no
repinta y el último frame capturado queda con contenido viejo/en blanco — no es un bug de la app.
Se resuelve solo con un clic o scroll que fuerce un repintado.

---

## Sesión del 14/08 (madrugada) — flujo Cotización → Pedido → Entrega

Luciano probó el circuito completo en vivo y salieron 6 hallazgos. Todos arreglados, verificados
en el navegador contra datos reales y deployados.

**Bugs de flujo (commit `a4c8baf`)**
1. **Copiar Cotización a Pedido sin ningún aviso** — COT-00027 tenía **3 pedidos** generados sin
   que nadie se enterara. Ahora confirma antes, mostrando los pedidos que ya existen. No se
   bloquea (SAP B1 permite copiar en tandas), pero deja de ser silencioso. La verificación relee
   la base, no la caché de react-query, así que también detecta un pedido creado hace un minuto.
2. **Al crear un Pedido el modal se cerraba** y dejaba al usuario en la lista, sin camino a la
   entrega. Ahora el documento recién creado queda abierto con sus acciones de continuación
   fijas al pie (Confirmar → Generar Entrega → Facturar), igual que en SAP B1: cerrar es decisión
   del usuario. "Avanzar" ya no cierra el detalle y la entrega lo resincroniza.
3. **`ModalDetallePedido.jsx` era `max-w-3xl`** mientras Cotizaciones ya estaba a pantalla
   completa — el comentario del código *ya decía* "mismo formato grande que Cotizaciones", pero
   el tamaño nunca se había actualizado.

**Bug real de producción en la base (mig.324, commit `aa0ee58`)**
4. **No se podía generar una Entrega de un pedido sin cliente.** `crear_entrega` usaba
   `cliente_id IS NULL` como prueba de que el pedido no existe:
   ```sql
   SELECT cliente_id INTO v_cliente_id FROM pedidos WHERE id = ...;
   IF v_cliente_id IS NULL THEN RAISE EXCEPTION 'Pedido no encontrado...';
   ```
   Pero KAIROX permite el socio de negocio en texto libre, así que un pedido "Sin cliente" es
   válido y tiene `cliente_id` NULL → **nunca** se le podía entregar, y el error mentía diciendo
   que el pedido no existía o era de otra empresa. **`crear_recepcion` tenía el mismo bug con
   `proveedor_id`**: una OC con el proveedor escrito a mano no se podía recibir jamás.
   Había 2 pedidos de Nalux bloqueados por esto. Fix: preguntar existencia con `FOUND`.
5. **La entrega generada no se abría** — había que ir a buscarla a mano a la pestaña Entregas.
   `crear_entrega`/`crear_recepcion` ya devolvían el id; `GenerarMovimientoModal` solo pasaba el
   número hacia arriba y tiraba el id. Ahora salta a Entregas con el documento abierto.

**Mapa de Relaciones (commit `a07246d`)**
6. **El Mapa estaba anclado en la factura.** Si la cadena todavía no se había facturado, mostraba
   un único nodo suelto con el cartel "todavía sin facturar" — o sea que **todo el tramo
   Cotización → Pedido → Entrega era invisible**, justo el que más se mira mientras el negocio
   está en curso. Los vínculos ya existían en la base (`pedidos.cotizacion_id`,
   `entregas.pedido_id`); nadie los caminaba si no había factura. Verificado en vivo:
   COT-00029 → PED-20260814-004 → ENT-2026-0137. Si una cotización se copió a varios pedidos,
   ahora los lista a todos (y el problema del punto 1 se ve de un vistazo).

**Detalle de Entrega (commit `bb30cd3`)**
7. Modal a pantalla completa + cabecera en grilla con datos que **ya se traían y no se mostraban**:
   CUIT/DNI y domicilio del cliente, pedido de origen, CAI del remito y su vencimiento, unidades
   entregadas y número de factura. Botón "Facturar Entrega" (ver PENDIENTE #1: está mal
   implementado, abre el POS).
   **`RemitoPDF.jsx` no se tocó a propósito**: ya imprime solo lo obligatorio de ARCA (emisor con
   CUIT y condición IVA, número, fecha, CAI + vencimiento, receptor, detalle **sin precios**,
   firma). Criterio de Luciano: el modal puede mostrar todo, el documento legal solo lo obligatorio.

**Decidido y NO construido todavía — Duplicar documentos estilo SAP (para el 15/08)**
Luciano lo pidió como atajo para acortar pasos, en la misma línea que las teclas rápidas.
Definiciones que ya dio:
- Aplica a **todos** los documentos.
- **Mensaje de advertencia** antes de duplicar, para evitar errores.
- Al duplicar, **preguntar si vincular el duplicado con el original** en el Mapa de Relaciones
  (como SAP): si sí, se crea la relación; si no, nace un documento totalmente independiente.
- Copia **todos los datos menos la fecha** — la fecha se controla, no debe heredar una fecha pasada.
- Respeta la numeración: correlativo nuevo vía `obtener_proximo_numero`.
Falta resolver dos casos de riesgo antes de construir: duplicar una **Factura** (no puede nacer
con CAE) y duplicar una **Entrega** (vuelve a descontar stock).

**Datos de prueba que quedaron en la base** (Nalux, base de test): PED-20260814-001/002/003/004,
ENT-2026-0136/0137, COT-00029. Movieron stock real de Batidora Eléctrica y Camiseta Argentina.

---

## ✅ Revisión automática de las Fases 0+1 — 5 bugs reales encontrados y ARREGLADOS (13/08)

A pedido explícito ("desplegá pruebas exhaustivas... si encontrás errores repáralos"), se corrió
`/code-review` con 8 ángulos en paralelo sobre todo lo construido en las Fases 0 y 1. Bugs reales
confirmados y corregidos (mig.323 + cambios de frontend), todos verificados en vivo contra
producción con `ROLLBACK`:

1. **`cancelar_nota_debito` chequeaba la columna equivocada** de `cuenta_corriente_imputaciones`
   — copiado de `cancelar_nota_credito` sin ajustar la lógica al caso opuesto (una ND es deuda,
   no crédito). El guard nunca matcheaba nada: se podía cancelar una ND con un cobro ya imputado,
   generando una reversión de más (saldo de cliente subestimado). Corregido para chequear
   `factura_comprobante_id`, mismo criterio que `cancelar_factura`. Verificado: simulé un cobro
   imputado contra una ND real y confirmé que ahora bloquea; confirmé también que una ND sin
   imputar se sigue pudiendo cancelar normal.
2. **Sin clamp de 0-100% en los % de descuento** (global y por línea) en las 3 RPCs de edición +
   los 3 `create()` — un typo como "150" en vez de "15" producía un total negativo persistido en
   un documento real, sin ningún error. Agregado `LEAST/GREATEST` en las RPCs y un helper
   `clampPct` en los 3 servicios/secciones (doble capa). Verificado: 150% quedó clampeado a 100%,
   total $0 (no negativo).
3. **"Limpiar" durante una edición** (Cotizaciones/OC) limpiaba `editingId` sin cerrar el modal —
   guardar después creaba un documento **duplicado** en vez de actualizar el original. Oculto el
   botón mientras se está editando.
4. **Un ítem con descripción pero cantidad/precio inválido se sacaba en silencio** del payload al
   guardar — y el diffing de la RPC lo interpreta como "se sacó" y lo **borra** del documento real
   sin ningún aviso (ej. el usuario borra el precio sin querer al editar, un ítem entero
   desaparece). Ahora bloquea el guardado con un error claro en vez de perder la línea
   calladamente (Cotizaciones/Pedidos/OC).
5. **Hardening**: las 3 RPCs de edición no repetían el filtro `empresa_id` en el DELETE/UPDATE de
   ítems (regla de oro de CLAUDE.md) — no explotable hoy (el id de cabecera ya estaba validado),
   pero se agrega como defensa en profundidad.

De paso: `openNew`/`openEdit` en los 3 módulos ahora limpian `prodSearch`/`prodResults`/
`prodOpen` — un desplegable de autocomplete podía quedar abierto en una fila en blanco al abrir
un documento distinto.

**No se tocó** (señalado por la revisión pero no son bugs, o quedan fuera de alcance): duplicación
de código entre Cotizaciones/Pedidos/OC (`FACTOR_IVA`, `HistorialItem`, `getHistorial`, atajo
Enter — todos copy-pasteados en vez de compartidos; observación de arquitectura válida, no un
error, requeriría un refactor grande fuera del alcance de "extender el patrón" — candidato para
una sesión aparte si se decide). 156/156 tests, `eslint` 0 errores, build limpio.

## 📋 Plan en curso: extender el estándar Cotizaciones al resto de comprobantes (13/08)

Ver `PLAN_COMPROBANTES_ESTANDAR.md` en la raíz del repo para el mapeo completo (10 documentos
auditados contra 8 puntos del estándar) y las 4 fases de ejecución. Progreso:

- **Fase 0 (bugs reales en Factura de Venta) — ✅ ARREGLADA (13/08):**
  1. El % de descuento por línea se cargaba en la UI pero nunca se guardaba en
     `comprobante_items` (columna `descuento_pct`, existía sin usar) — quedaba invisible para
     siempre. Ahora se persiste y se muestra en el resumen de totales y en `FacturaPDF.jsx`
     ("Descuento (X%) -$Y", mismo formato que `CotizacionPDF.jsx`). El flujo "Copiar a Factura"
     también copia el descuento del origen.
  2. `ALICUOTAS` incluía 27%, que viola el CHECK real de la columna — sacado.
  3. **Nota de Débito emitida no tenía ninguna forma de cancelarse** (a diferencia de Factura y
     NC) — nueva RPC `cancelar_nota_debito` (mig.321, mismo patrón que `cancelar_nota_credito`
     mig.267, especular: HABER revierte el DEBE original). `SaleDetailModal.jsx` generalizado
     para Factura/NC/ND en vez del booleano `esNC` que solo contemplaba 2 casos.
  Verificado en vivo: ND real creada+cancelada dentro de una transacción con `ROLLBACK` —
  saldo de cuenta corriente vuelve exacto, guard de doble cancelación funciona, `anon` sin
  poder ejecutar la RPC. 156/156 tests, `eslint` 0 errores, build limpio.
- **Fase 1 (Órdenes de Compra, paridad completa) — ✅ ARREGLADA (13/08):** OC no tenía NINGUNA
  forma de editarse (solo cambiar estado o cancelar) — agregado desde cero, con diffing por id
  desde el arranque (mig.322: `alicuota_iva`, `descuento_item`, `descuento_global_pct`, RPC
  `actualizar_orden_compra`, `trg_audit_ordenes_compra_items`). Formulario full-screen con
  autocomplete robusto (antes mezclaba búsqueda y descripción libre en un campo sin desplegable
  controlado), atajo Enter con el fix de foco ya probado en Cotizaciones/Pedidos, Neto/IVA
  SIEMPRE visible en el detalle (a diferencia de Ventas, en Compras no se condiciona a ninguna
  letra). Editable mientras estado IN ('borrador','enviada') — antes de que haya Recepción
  generada. Verificado en vivo (OC-00010, ROLLBACK): 1 modificado + 1 agregado → 2 filas de
  auditoría exactas, guard de estado bloqueando, `anon` sin poder ejecutar la RPC.
- Fase 2 (Factura Venta/Compra, consistencia sin edición), Fase 3 (NC/ND), Fase 4 (Devoluciones)
  — pendientes.

## ✅ Pedidos: 3° bug del checklist, ARREGLADO — unidad_medida se perdía al editar (13/08)

Luciano se fue a entrenar y pidió seguir sin su presencia con lo que se pudiera. Se tomó el bug
que Nadia había dejado en el backlog (ver sección de checklist más abajo): **editar un Pedido
borraba la `unidad_medida` de los ítems que no se volvían a tocar.**

Causa raíz confirmada: `openEdit()` en `PedidosSection.jsx` no incluía `unidad_medida` al
precargar los ítems en el formulario de edición — la RPC `actualizar_pedido` hace lo que se le
pide, así que sin ese campo en el payload lo pisaba con `null`. Fix de una línea, mismo patrón
que ya usa `handleEditarClick()` en `CotizacionesSection.jsx`.

**No se tocó la fila ya afectada en producción** (PED-20260813-001, ítem "Termo Stanley 1L
Original") — sigue en `null`, mismo criterio que Nadia ya había decidido para el resto de los
datos de esa prueba (dejarlos como están, sin revertir).

Verificado: `eslint` 0 errores, 156/156 tests, `vite build` limpio. Es un fix puramente de
frontend (no toca SQL/RPC), así que no requirió verificación adicional contra la base.

## ✅ Barrido general — 2° bug real encontrado y ARREGLADO (13/08)

A pedido de Nadia ("hacé un barrido de todo para ver si no quedó algún bug suelto"), después del
checklist de Cotizaciones/Pedidos (ver sección de abajo):

**🐛→✅ Bug real, corregido:** el detalle abierto de un Pedido **no se refrescaba al avanzar de
estado** (Borrador→Confirmado→En Preparación) — la mutación se guardaba bien en la base (la fila
de la tabla sí cambiaba), pero el modal seguía mostrando el estado viejo hasta cerrarlo y
reabrirlo. **Es el mismo bug exacto que Luciano ya había encontrado y corregido el 11/08 en
Cotizaciones/OC/Proveedores** (commit `f137a54`), pero ese fix nunca llegó a Pedidos. Causa
distinta porque Pedidos no usa react-query para el detalle (era una key mal invalidada en los
otros 3) sino un estado plano (`detailPedido`) que `handleAvanzar` nunca actualizaba. Corregido:
sincronizarlo a mano cuando el pedido mutado es el que está abierto. **Verificado en vivo**:
avancé PED-20260813-001 dos veces seguidas sin cerrar el modal, se actualizó solo cada vez.

**Barrido de consola:** las 10 secciones principales de la app (Cotizaciones, Pedidos, Entregas,
Facturas, Órdenes de Compra, Inventario, Bancos, Cheques, Plan de Cuentas, Configuración) sin
errores nuevos — solo el warning preexistente y no relacionado de `TopClientes.jsx`. Descarga de
PDF de una cotización probada en vivo (no solo por código): abre sin error.

Verificado: `eslint` 0 errores, 156/156 tests, `vite build` limpio.

## ✅ Checklist Cotizaciones/Pedidos probado en vivo por Claude — 12/13 OK, 1 bug real (13/08)

Nadia pidió correr en su lugar el checklist que había quedado pendiente (ver más abajo, ahora
marcado). Todo probado en local con su sesión, contra el mismo backend de producción — algunos
casos generaron datos reales que **quedaron así a propósito, sin revertir** (decisión de Nadia):
edité **COT-00025** (subí la cantidad de un ítem) y creé/edité **PED-20260813-001**.

**Cotizaciones (8/8 ✅):** Enter selecciona el producto resaltado sin agregar fila vacía; Tab
avanza dentro de la misma fila (a Unidad), nunca vuelve a Cliente; Enter en un campo suelto SÍ
agrega fila y enfoca la nueva Descripción; ítem con 10% de descuento propio → el resumen muestra
"Subtotal $10.000 / Descuento -$1.000 / Total $9.000" (antes el descuento quedaba invisible,
absorbido en el Subtotal); línea del PDF confirmada por código (`Descuento ({pct}%)`); edición con
historial limpio — **comparación en vivo, mismo documento**: mi edición de hoy generó **1 sola
línea** ("Ítem modificado: Aramis TESTE Azul marino"), mientras una edición vieja (de antes del fix
mig.319) sigue mostrando el ruido original (7 líneas de "quitado"/"agregado" para un solo cambio
real) — se ve el antes/después lado a lado en el mismo historial; cotización Convertida (COT-00018)
no ofrece "Editar".

**Pedidos (4/5 ✅, 1 sin poder probar):** formulario a pantalla completa (658×557 en viewport
686×606) con el mismo buscador único; Enter/Tab igual que Cotizaciones; descuento global 10% de
$30.000 → -$3.000 exacto; pedido en estado distinto de Borrador (PED-20260811-002, En Preparación)
sin botón Editar, ni en la tabla ni en el detalle. **Sin probar:** el desglose Neto/IVA para
cliente Responsable Inscripto — verificado por SQL que **ningún cliente real de Nalux está cargado
como RI** (todos `CF` o sin condición), así que no hay forma de probarlo con datos reales hoy. No
es un bug, es que falta el dato — la función que decide (`determinarTipoComprobante`) es la misma
que ya está confirmada funcionando en Cotizaciones y en las facturas reales.

### 🐛→✅ Bug real encontrado — editar un Pedido borraba la "Unidad de Medida" de los ítems no tocados

**ARREGLADO (13/08, ver sección al principio del archivo).** Al editar PED-20260813-001 (agregar
un ítem, sacar otro, modificar un tercero), el ítem que quedó sin tocar ("Termo Stanley 1L
Original") apareció en el historial como "modificado" — comparando el detalle técnico del
registro de auditoría: todos los campos idénticos excepto `unidad_medida: "Unidad"` → `null`.
Causa raíz: `openEdit()` en `PedidosSection.jsx` no pasaba `unidad_medida` al precargar los ítems
para editar. Corregido con el mismo patrón que ya usa `handleEditarClick()` en
`CotizacionesSection.jsx`. La fila ya afectada en producción (ese ítem de PED-20260813-001) sigue
en `null` — no se tocó, mismo criterio que Nadia decidió para el resto de esos datos de prueba.

No se pudo verificar ni el flujo de cámara con hardware real ni nada que necesite una cámara física
(el entorno de pruebas no tiene acceso). Sin errores nuevos en consola en todo el recorrido (solo
el warning preexistente y no relacionado de `TopClientes.jsx`).

## 🧪 Checklist Cotizaciones/Pedidos (13/08) — ✅ probado, ver resultado arriba

- [x] Abrir "Nueva Cotización", escribir el nombre de un producto en Descripción/Producto hasta
      que aparezca en el desplegable, presionar **Enter**.
      **Esperado:** selecciona ese producto (llena precio, unidad e IVA solo), NO agrega una fila
      vacía nueva.
- [x] Después de elegir un producto (con Enter o con click), presionar **Tab**.
      **Esperado:** el foco avanza al campo Cantidad de esa misma fila. NO debería saltar de
      vuelta al campo Cliente al principio del formulario.
- [x] En una fila sin desplegable abierto (cursor en Cantidad, Precio, IVA o %Desc.), presionar
      **Enter**. **Esperado:** agrega una fila nueva y le pasa el foco a Descripción.
- [x] Cargar un ítem con **% Desc.** propio (ej. 10%) y dejar el "Desc. Global %" en 0.
      **Esperado:** el resumen de totales ahora SÍ muestra una línea "Descuento" con el monto
      correspondiente (antes quedaba invisible, el Subtotal ya lo absorbía en silencio).
- [x] Descargar el PDF de esa misma cotización — confirmado por código, no se descargó el archivo.
      **Esperado:** la línea "Descuento" del PDF muestra el monto Y el porcentaje entre
      paréntesis, ej. "Descuento (10%) -$X".
- [x] Abrir una cotización en estado Borrador/Enviada/Aprobada/Rechazada → botón "Editar".
      Cambiar la cantidad de UN solo ítem, dejar los demás igual, guardar.
- [x] Abrir "Historial de cambios" en el detalle. **Esperado:** aparece un solo registro para el
      ítem que se tocó — los demás ítems (sin cambios) NO deberían aparecer como "quitado" ni
      "agregado".
- [x] Intentar editar una cotización en estado **Convertida**. **Esperado:** no ofrece el botón
      "Editar".
- [x] Abrir "Nuevo Pedido". Formulario a pantalla completa, mismo campo único de búsqueda.
- [x] Repetir las pruebas de Enter/Tab/foco, ahora en Pedidos.
- [ ] Cargar un pedido con Desc. Global % — **descuento global confirmado, desglose Neto/IVA con
      cliente RI sin probar (no hay cliente RI real en los datos de Nalux)**.
- [x] Editar un pedido en Borrador (agregar+sacar+modificar) y revisar su Historial de cambios —
      **bug real encontrado, ver arriba**.
- [x] Confirmar que un pedido que YA NO está en Borrador no muestra el botón Editar (tabla y
      detalle).

---

## ✅ Pedidos: paridad con Cotizaciones — IVA, descuento global, edición con historial (13/08)

Pedido explícito de Luciano: "aplicar lo que tengamos en cotización... todo lo que construimos".
Mismo patrón replicado, con las reglas propias de Pedido respetadas:

- **Formulario denso a pantalla completa** (`ModalPedidoForm.jsx`, 96vw/92vh) — reemplaza el
  `<select>` del catálogo entero + campo de descripción libre separado por un único campo con
  autocomplete (mismo patrón que `FormNuevaCotizacion.jsx`), atajo Enter para agregar fila, con
  el fix de foco ya aplicado en Cotizaciones (reenfoca Cantidad después de elegir producto).
- **IVA por línea**: `pedido_items.alicuota_iva` (mig.320). **Descuento global %**:
  `pedidos.descuento_global_pct` — columna NUEVA, separada de la `descuento` ya existente (que
  sigue guardando el monto $ ya calculado, mismo significado que siempre tuvo desde mig.252; no
  se reutilizó para no romper esa semántica).
- **Edición atómica con diffing por id DESDE EL INICIO**: RPC `actualizar_pedido` (mig.320) —
  UPDATE solo lo que cambió, INSERT lo nuevo, DELETE lo sacado. A diferencia de la primera
  versión de Cotizaciones (que arrancó con delete-all+insert-all y tuvo que corregirse en
  mig.319 tras el bug de historial con ruido), acá se aplicó el patrón correcto directo — ver
  `feedback_patron_edicion_historial_documentos.md`.
- **Guard de edición**: se mantiene la regla YA existente (`estado === 'borrador'`) — más
  estricta que Cotizaciones a propósito, un pedido confirmado/en preparación puede ya tener
  Entregas generadas y no hay guard de negocio pensado para permitir editar cantidades después.
- **Historial de cambios**: reusa `audit_log` — `pedidos` ya estaba enganchada (mig.017);
  `pedido_items` enganchada ahora (mig.320).
- **Modal de detalle** agrandado a `max-w-3xl` con columna IVA, desglose Neto/IVA condicional
  (`discrimina` vía `determinarTipoComprobante`, igual que Cotizaciones), descuento combinado
  línea+global, botón "Editar Pedido" y la misma sección colapsable de Historial.

**Fuera de alcance a propósito**: no se tocó Entregas ni Facturación (la alícuota de
`pedido_items` no se propaga automáticamente a esos documentos) — el pedido era aplicar el
patrón al documento Pedido en sí, no rediseñar el flujo aguas abajo.

De paso: `CotizacionPDF.jsx` ahora también muestra el % de descuento aplicado junto al monto en
la línea "Descuento" del PDF (antes solo mostraba el monto en pesos).

Verificado en vivo contra producción (PED-20260812-001, real) dentro de transacciones con
`ROLLBACK`: edición con 1 ítem modificado + 1 agregado + 1 quitado → exactamente 3 filas de
auditoría (no 6, el ítem sin tocar no generó ninguna), cálculo de subtotal/descuento/total
exacto, guard de estado no-borrador bloqueando correctamente, `anon` sin poder ejecutar la RPC.
Sin persistir nada. 156/156 tests, `eslint` 0 errores, `vite build` limpio.

---

## ✅ Cotizaciones: edición con historial + IVA por línea + descuento global (12/08)

Pedido de Luciano, investigado contra SAP B1 y el mercado (Salesforce/HubSpot/Zoho/QuickBooks
Estimates) antes de construir — las tres fuentes convergieron en la misma regla, aplicada acá:

- **Edición**: nueva RPC `actualizar_cotizacion` (SECURITY DEFINER, transacción atómica
  cabecera+ítems). Editable en Borrador/Enviada/Aprobada/Rechazada; **bloqueada una vez
  Convertida** (ya generó una venta real — el cambio va en ese documento, no reescribiendo el
  original). Botón "Editar" en el detalle reusa el mismo modal/form de "Nueva Cotización".
- **Historial de cambios**: reusa `audit_log`/`fn_audit_trigger()` que YA existía (mig.001) y
  YA estaba enganchada a `cotizaciones` — solo faltaba engancharla a `cotizacion_items`
  (mig.318). Vista legible en el detalle con toggle a JSON crudo, mismo patrón que "Ver detalle
  técnico" del Monitor ARCA.
- **IVA por línea**: `cotizacion_items.alicuota_iva` nueva (mismo patrón que
  `comprobante_items`/`devolucion_items`, mig.262), autocompletada desde `productos.alicuota_iva`
  al elegir un producto. La letra probable (A/B/C) sale de `determinarTipoComprobante()` — la
  misma función que ya deciden las facturas reales — **no un toggle manual en Configuración**
  (se descartó esa idea: podría desincronizarse de lo que la ley determina según la condición de
  IVA del emisor y el receptor). Neto/IVA se muestran solo si da "A", igual que `FacturaPDF.jsx`
  ya hace — aplicado también al PDF de la cotización.
- **Descuento global**: `cotizaciones.descuento` ya existía desde la migración original (002,
  nunca conectado a la UI) — ahora tiene su campo en el formulario, aplicado después de los
  descuentos por línea (mismo orden que SAP).

Verificado: 153/153 tests, `eslint` 0 errores, `vite build` limpio. La RPC se probó contra un
comprobante real (COT-00006) dentro de una transacción con `ROLLBACK` — cálculos exactos y el
guard de "convertida" bloqueando correctamente (probado contra COT-00001), sin persistir nada.
También se encontró y corrigió al pasar: `anon` podía ejecutar la RPC pese al `REVOKE ALL FROM
PUBLIC` (Supabase da grants por defecto a `anon` en funciones nuevas, no cubiertos por ese
revoke genérico — mig.318b).

De paso, mientras se armaba esto: el combo de productos cortaba a 10 resultados incluso con el
buscador vacío (con Nalux en 17 productos activos, 7 nunca aparecían) — subido a 50.

### Fixes posteriores encontrados por Luciano probando en vivo (13/08)

1. **Enter en el combo de productos agregaba fila en vez de seleccionar** — el atajo "Enter
   agrega ítem" le ganaba al Enter de confirmar el producto resaltado en el desplegable. Ahora
   Enter prioriza seleccionar el producto si el desplegable está abierto con resultados.
2. **Tab después de elegir un producto saltaba a Cliente** en vez de seguir en la fila — el
   `<button>` del desplegable se desmontaba al seleccionar y el navegador perdía el foco
   (reseteado a `<body>`), así el siguiente Tab arrancaba desde el principio del formulario.
   Ahora se reenfoca Cantidad explícitamente después de seleccionar (click o Enter).
3. **Los totales no mostraban el descuento por línea** — "Subtotal" ya venía con los descuentos
   de línea aplicados en silencio, así un ítem con % Desc. propio y 0% global no dejaba ningún
   rastro visible en el resumen. Ahora "Subtotal" es precio de lista sin descuentos y
   "Descuento" suma línea + global — mismo criterio que ya usaba `CotizacionPDF.jsx` (que nunca
   tuvo este bug). Aplicado también en `ModalDetalleCotizacion.jsx`.
4. **Historial de cambios con ruido inentendible** — cada guardado de una edición borraba y
   reinsertaba TODOS los ítems (mig.318 original), así el historial mostraba cada ítem como
   "quitado"+"agregado" en cada save, se hubiera tocado o no. Corregido en mig.319: la RPC ahora
   recibe el `id` de cada ítem existente y diffea — `UPDATE` solo si algo cambió de verdad
   (`IS DISTINCT FROM` campo a campo), `INSERT` solo lo nuevo, `DELETE` solo lo sacado. Un ítem
   intacto no genera ninguna fila de auditoría. **Patrón a replicar tal cual en Pedidos/OC** — no
   repetir el delete-all+insert-all original.

Verificado: 156/156 tests, `eslint` 0 errores, `vite build` limpio. La RPC v2 se probó contra
COT-00025 (real, con descuento de línea) dentro de transacciones con `ROLLBACK`: edición con un
solo campo cambiado → 1 fila de auditoría (no 3); ítem nuevo agregado → 1 INSERT; ítem quitado →
1 DELETE; ítems intactos → 0 filas; guard de "convertida" (COT-00001) sigue bloqueando. `anon`
sigue sin poder ejecutar la RPC (`has_function_privilege` en false). Sin persistir nada.

## 🔧 Escaneo por cámara — cuelgue real en producción, cambiado a diagnóstico directo (12/08)

Nadia probó el escaneo en tanda en producción y encontró un problema más serio que el anterior:
**con el permiso de cámara ya concedido de antes, la pantalla queda en negro y nunca conecta** — no
vuelve a pedir permiso, no muestra error, se queda así hasta que salta el timeout de 10s. Se
descartó que fuera otra pestaña/app usando la cámara (confirmado con ella). El error de consola que
mandó ("A listener indicated an asynchronous response...") es de una extensión de Chrome, no
relacionado.

**Causa del cambio (no se pudo confirmar la causa RAÍZ — no hay forma de reproducir un cuelgue de
`getUserMedia` sin la cámara física real):** hasta ahora se usaba `reader.decodeFromConstraints()`,
que le pide la cámara a `getUserMedia` **por dentro**, como caja negra — si algo se cuelga ahí
adentro, no hay manera de saber si el problema es el pedido a la cámara en sí o algo posterior en
la librería ZXing.

**Cambio (12/08):** se separó el pedido de cámara de la decodificación. Ahora se llama
`navigator.mediaDevices.getUserMedia()` directamente, envuelto en un `Promise.race` con un timeout
propio de 10s — si el timeout gana la carrera, se dispara un `AbortError` explícito. Recién con el
stream ya obtenido se lo pasa a `reader.decodeFromStream()` (método público de la misma librería,
que es lo que `decodeFromConstraints` hace internamente de todos modos). Con esto, la próxima vez
que pase, el mensaje de error va a decir con precisión si el problema fue conseguir la cámara del
sistema operativo o algo posterior — antes decía un genérico "tardó demasiado" sin distinguir nada.
Mensaje de error también mejorado: sugiere directamente cerrar otras pestañas/programas que puedan
tener la cámara tomada (Zoom, Teams, otra pestaña de KAIROX, la app Cámara de Windows).

Verificado: `eslint` 0 errores, 153/153 tests, `vite build` limpio. **No se pudo verificar que esto
resuelva el cuelgue real** — el entorno de pruebas no tiene acceso a cámara física. Si vuelve a
pasar, el mensaje de error que va a mostrar ahora es la pista clave para el próximo paso.

## ✅ Escaneo por cámara — escaneo en tanda + beep (12/08, pedido de Nadia)

Nadia probó los fixes de velocidad/apertura y los confirmó andando, y pidió dos mejoras de UX
mientras tanto: que la cámara **no se cierre** al leer un código (hoy había que reabrirla producto
por producto), y un **sonido de confirmación** como los lectores de supermercado.

**`EscanerCamaraModal.jsx` — reescrito para escaneo continuo:**
- El modal ya no se cierra solo al detectar un código. Queda abierto, cada lectura se suma a una
  lista lateral ("Escaneados — N productos") con nombre + código, y sigue escaneando.
- **Anti-repetición:** el mismo código leído dos veces en menos de 2s se ignora — sin esto, un
  producto quieto frente al lente se cargaría decenas de veces por segundo (la cámara decodifica
  varias veces por segundo).
- **Beep sintetizado con Web Audio** (no un archivo de audio — no agrega peso al bundle, no puede
  fallar por 404/caché): tono agudo corto si el código existe en el catálogo, dos tonos graves si
  no. El `AudioContext` se crea al abrir el modal, que es un click del usuario — el gesto que los
  navegadores exigen para permitir audio.
- **Flash de color** sobre el video (verde/rojo, 600ms) como refuerzo visual del mismo resultado,
  para cuando el local tiene ruido y no se escucha el beep.
- `onDetectado` cambió de contrato: antes no devolvía nada (el padre mostraba un toast y cerraba el
  modal), ahora devuelve `{ ok, nombre }` para que el modal arme su propia lista. Actualizado en
  `PanelProductos.jsx` (`handleDetectadoCamara`).
- El callback vive en un `ref` para que un re-render del padre (agregar cada producto dispara
  render de `PanelProductos`) no reinicie la cámara a mitad del escaneo — el efecto que abre la
  cámara depende solo de `open`, no de la identidad de `onDetectado`.

Verificado: `eslint`/tests/`vite build` limpios, modal probado en el navegador (abre, muestra la
lista vacía, el camino de error sigue andando — la cámara real no se puede probar en este entorno).
**Pendiente: que Nadia confirme en producción** que el beep suena y la lista se va llenando bien
escaneando varios productos seguidos.

## ✅ Escaneo por cámara — 3 causas encontradas y arregladas (12/08)

Luciano había diagnosticado el 12/08 que el escáner no abría en PC por pedir la cámara trasera como
restricción estricta, y lo dejó anotado sin arreglar. Nadia lo volvió a probar y aportó el síntoma
que destrabó el caso: **"hay que acercar mucho el producto para que tome el código"**, en PC *y* en
celular. Eso mostró que el `facingMode` era solo una de tres causas, y ni la más importante:

1. **Resolución de video (la causa principal):** nunca se le pedía calidad a la cámara → el
   navegador entregaba ~640x480, resolución a la que un código de barras solo se lee casi pegado al
   lente. Ahora pide `1280x720` ideales.
2. **Sin enfoque continuo:** la cámara quedaba fija en un plano (de ahí el "queda en negro un buen
   rato" en celular). Agregado `focusMode: 'continuous'` en `advanced`, para que el navegador que
   no lo soporte lo ignore en vez de fallar el pedido entero.
3. **Lector probando todos los formatos:** `BrowserMultiFormatReader` prueba QR/DataMatrix/PDF417/
   Aztec en cada cuadro. Cambiado a `BrowserMultiFormatOneDReader` (solo códigos lineales de
   retail: EAN-13/EAN-8/UPC/Code128/Code39/ITF) — bastante menos trabajo por cuadro.

Más el fix de `facingMode: { ideal: 'environment' }` que Luciano ya había propuesto (con fallback a
cualquier cámara **solo** ante errores de restricción, no ante permiso denegado — reintentar ahí no
arregla nada y le dispara al usuario un segundo cartel de permiso), y un **corte de seguridad a los
10s** para que el modal no quede colgado en negro con el spinner girando indefinidamente.

Se agregó además un indicador de **la resolución real** que entregó la cámara, abajo a la derecha
del video: si dice `1280×720` la mejora se aplicó; si dice `640×480`, esa cámara no da más (límite
físico del hardware, no del código). Sirve para diagnosticar de un vistazo sin adivinar.

Verificado: `eslint` 0 errores, 153/153 tests, `vite build` limpio, camino de error probado en el
navegador. Detalle completo en `PLAN_PRUEBAS_MAESTRO_2026-08-11.md`, sección C.1.

**2ª vuelta — Nadia probó en producción y quedó así:**
- **Celular: ✅ resuelto**, ahora lee el código al instante (antes no lo tomaba).
- **PC: 🟡 lee, pero cuesta** — hay que enfocar un rato. Esperable: las webcams de notebook son de
  foco fijo y baja calidad. El indicador de resolución del modal lo confirma de un vistazo (si en
  PC dice `640×480` y en celular `1280×720`, es límite del hardware, no del código). Para el
  mostrador el lector físico (keyboard wedge) sigue siendo el camino recomendado.
- **Apertura lenta con pantalla negra: 🔴 seguía pasando en ambos** — y ya pasaba antes de todos
  estos cambios (lo reportó Luciano en la primera prueba del Bloque C), no lo introdujo ninguno.
  **Causa:** pedirle alta resolución a `getUserMedia` *de entrada* obliga al hardware a arrancar
  directamente en ese modo — era el precio de la mejora de la 1ª vuelta. **Fix (aplicado):**
  arranque en dos etapas — abrir con lo mínimo (`facingMode` y nada más) para que el video aparezca
  cuanto antes, y recién con la cámara andando subir a 1280x720 + enfoque continuo vía
  `track.applyConstraints()`, que ajusta sin reiniciar el dispositivo. Si la cámara no lo soporta,
  falla solo ese ajuste y el escaneo sigue igual. Más feedback honesto mientras carga ("Encendiendo
  la cámara…" y, a los 2,5s, "algunas cámaras tardan unos segundos") en vez de un rectángulo negro
  mudo. **Pendiente: que Nadia confirme en producción si la apertura mejoró.**

## 📌 Pendiente (sin urgencia) — repo de GitHub público, bajo cuenta personal (12/08)

Verificado hoy: el repo (`github.com/lbanegas96/kairox-gestion`) está **público** y vive en la
cuenta **personal** de Luciano, no en una organización. Nadia preguntó si conviene pasarlo a
privado y le preocupaba que eso tumbara el deploy de Vercel — aclarado que no es así, queda
anotado acá para cuando decidan hacerlo:

- **Pasar el repo a privado NO tira abajo el sitio ya deployado** — Vercel sigue sirviendo lo que
  ya está construido, no depende de que el repo siga siendo público en el momento del cambio.
- **Lo único que puede verse afectado:** los **próximos** pushes podrían dejar de auto-deployar si
  la integración GitHub↔Vercel no tiene permiso para leer repos privados (depende de cómo esté
  instalada la GitHub App de Vercel en la cuenta). Se soluciona en 2 minutos desde GitHub →
  Settings → Applications → Vercel (o desde el panel de Vercel), dándole acceso al repo. No hay
  ventana de downtime real si se hace con calma.
- **Por qué conviene hacerlo en algún momento:** con el repo público, cualquiera puede ver toda la
  arquitectura y lógica de negocio (no las claves — esas están bien afuera vía `.gitignore` — pero
  sí toda la estructura de RLS, el diseño del sistema, y este mismo `CONTEXT.md` con bastante
  detalle operativo interno). No es urgente, pero es una mejora de seguridad razonable para un
  sistema multi-tenant con datos financieros reales.
- **Sugerencia aparte, no pedida:** en algún momento también podría convenir mover el repo de la
  cuenta personal de Luciano a una organización de GitHub compartida (Kairox IA), para que el
  acceso no dependa de una sola persona — pero eso es un tema aparte, más grande, para decidir con
  calma y no se toca ahora.

No se tocó nada — el repo sigue público como está. Sin relación con la migración de Supabase (son
sistemas distintos), por eso queda documentado acá aparte y no en `PLAN_MIGRACION_SUPABASE.md`.

## ✅ Bloque A del Plan Maestro — fix del Mapa de Relaciones (Cotizaciones) verificado en vivo (12/08)

Nadia bajó el trabajo de Luciano de esta mañana y me pidió correr el Bloque A de
`PLAN_PRUEBAS_MAESTRO_2026-08-11.md` (el único bloque que nos tocaba a nosotras — el resto es de
Luciano: celular, sus ojos, o su decisión). Probado en local con su sesión, contra el mismo
backend de producción.

**Resultado: ✅ pasó completo.** El nodo Cotización aparece al principio de la cadena y el badge
"actual" marca correctamente — probado en 4 cotizaciones convertidas distintas (COT-00018, -00017,
-00014, -00001), confirmado a nivel de clase CSS (`ring-2`), no solo leyendo el texto. Sin
regresión: abrir el mapa desde una Factura o un Pedido facturado sigue marcando "actual" bien,
como siempre. Sin errores nuevos en consola. Detalle completo en
`PLAN_PRUEBAS_MAESTRO_2026-08-11.md`, Bloque A.

**Con esto, el fix de Luciano de ayer queda confirmado por una segunda persona (código + prueba en
vivo) — no queda ningún hilo de prueba abierto salvo lo que ya era exclusivamente de Luciano**
(Bloque B rebrand, C.1 escaneo de cámara en PC sin arreglar todavía, E acciones administrativas, F
decisión de Supabase — sigue sin resolverse, quedan 5 días al 17/08).

## 🧪 Bloque C del Plan Maestro — C.2 OK, C.1 con hallazgo diagnosticado (12/08)

Luciano corrió el Bloque C (hardware real) de `PLAN_PRUEBAS_MAESTRO_2026-08-11.md` desde su celular:

- **C.2 (QR MercadoPago, cobro real) — ✅ listo y OK.**
- **C.1 (escaneo de código de barras por cámara) — ⚠️ anduvo, con 2 problemas:** demora mucho en
  levantar la cámara, y **desde la cámara de una PC no funciona** (sí desde el celular).

**Causa ya diagnosticada leyendo el código, NO arreglada todavía** (queda para la próxima sesión):
`EscanerCamaraModal.jsx` pide la cámara con `facingMode: 'environment'` como restricción **estricta**
(cámara trasera obligatoria). Una PC/notebook normalmente solo tiene cámara frontal — al no poder
cumplir esa restricción exacta, el navegador tarda en negociar antes de fallar, o rechaza el acceso
directamente. **Fix propuesto:** cambiar a `{ ideal: 'environment' }` en vez de la forma estricta,
para que caiga de forma prolija a la única cámara disponible en vez de demorar/fallar — sin tocar el
comportamiento ya correcto en celular (que sí tiene trasera y la sigue prefiriendo). Detalle completo
en `PLAN_PRUEBAS_MAESTRO_2026-08-11.md`, sección C.1.

Quedan sin probar todavía: Bloque B (rebrand visual) y Bloque E (2 acciones administrativas).

## 🧪 Plan Maestro de Pruebas — barrido completo de todo lo pendiente (11/08)

`PLAN_PRUEBAS_MAESTRO_2026-08-11.md` junta en un solo documento **todo** lo que seguía abierto,
disperso hasta ahora en varios planes sueltos: verificar el fix del Mapa de Relaciones de hoy
(Nadia, Bloque A), confirmar visualmente el rebrand de colores (Luciano, Bloque B), las 2 pruebas
que necesitan hardware real — cámara y QR MercadoPago (Luciano con su celular, Bloque C) —, un
repaso informativo del motor ARCA ya cerrado (Bloque D), y 2 acciones administrativas de un click
(Bloque E). Todo lo demás del proyecto (Fidelización, Multi-caja, Modo Offline, COGS, Cierre de
Ejercicio, etc.) ya está confirmado cerrado — no hace falta retestear nada de eso.

## ✅ 3 items de backlog cerrados mientras se espera la decisión de Supabase (11/08)

Mientras Luciano decide entre pagar Pro o migrar (ver sección de abajo), se avanzó con el backlog
menor que había quedado documentado, sin tocar nada relacionado a la migración:

1. **Filas huérfanas en la cola ARCA — investigadas, no borradas.** 3 filas de
   `facturas_pendientes_arca` con `comprobante_id=NULL` (FK `ON DELETE SET NULL`) eran restos de
   comprobantes de prueba del 06/08 rechazados por ARCA y luego borrados — invisibles en el Monitor
   (la vista arranca `FROM comprobantes`), sin riesgo, pero un `DELETE` de limpieza quedó bloqueado
   por el clasificador de auto mode (acción destructiva en prod). **Pendiente: confirmar con
   Luciano si se borran** — comando ya armado, solo falta luz verde.
2. **Mensaje contradictorio de `mensajeHumano()` — resuelto.** El código 10016 mostraba siempre
   "no hace falta que hagas nada todavía" incluso después de agotar los 5 reintentos automáticos,
   contradictorio al lado del badge "reintentos agotados". Ahora `mensajeHumano(raw, {agotado})`
   distingue ambos casos. `arca-worker` redeployado (v26). Los 3 comprobantes del incidente
   (06-001/-008/-011) tuvieron su mensaje ya guardado corregido a mano (UPDATE dirigido, no
   destructivo) para que Nadia no vea el texto viejo si los revisa mañana.
3. **Bug del Mapa de Relaciones ("actual" no marca desde Cotizaciones) — resuelto.**
   `MapaRelaciones.jsx` nunca armaba un nodo de cotización en la cadena. Al investigar se encontró
   que el intento inicial de fix (basado en `comprobantes.cotizacion_id`) hubiera sido inefectivo:
   esa columna existe en el schema pero está **siempre en NULL** en los datos reales — la relación
   real vive al revés, en `cotizaciones.comprobante_id` (confirmado: 6/20 cotizaciones convertidas
   la tienen poblada). Corregido para buscar por esa columna; ahora la cotización aparece como
   nodo propio en la cadena (Cotización → Pedido → Entrega → Factura) y el badge "actual" marca
   correctamente. Deployado a Vercel.

Verificado: 153/153 tests, `eslint` 0 errores (solo warnings preexistentes de PropTypes), `vite
build` limpio. No se pudo verificar visualmente en el navegador (sin sesión activa ni credenciales
a mano) — verificación fue a nivel de código + consultas SQL directas contra los datos reales.

## 🔴 DECISIÓN PARA LUCIANO — Plan free de Supabase vence el 17/08, elegir camino (11/08)

**Leer esto primero.** La organización NALUX sigue en plan `free` de Supabase (verificado en vivo
hoy contra la API: `get_organization` devuelve `"plan":"free"`) y el proyecto queda **restringido
desde el 17/08/2026** por cuota excedida — quedan **6 días** desde hoy. Si no se resuelve, se cae
la producción de todos los clientes.

Nadia planteó el tema: el producto todavía no factura como para justificar pagar un plan pago, y
hoy no hay presupuesto para eso. Dos caminos, a decidir entre los dos:

1. **Pagar el plan Pro** (~US$25/mes) en la cuenta actual — resuelve esto en minutos, sin ningún
   riesgo de migración, cuando/si hay presupuesto.
2. **Migrar todo a una organización nueva, también en plan free** — compra tiempo sin gastar, pero
   es trabajo técnico real y no es una solución permanente (si el uso sigue creciendo, se puede
   volver a topar con el mismo límite ahí).

**Quedó documentado en detalle, paso a paso, en [`PLAN_MIGRACION_SUPABASE.md`](PLAN_MIGRACION_SUPABASE.md)**
— qué se copia, qué hay que rehacer a mano (importante: el token de MercadoPago y el certificado de
AFIP están en el Vault de Supabase, encriptado por proyecto, **no se pueden copiar** — hay que
volver a cargarlos desde la propia pantalla de Configuración de KAIROX, no es "empezar de cero" la
integración, solo re-pegar el mismo dato), y las 9 fases de ejecución si se elige migrar.

**No se tocó nada todavía** — es sólo el documento, a la espera de que Luciano decida cuál de los
dos caminos tomar. Si elige migrar, Claude puede hacer todo el trabajo técnico (volcado de datos,
redeploy de funciones, verificación); si elige pagar, no hace falta hacer nada de esto.

## ✅ Plan de robustez ARCA — Bloques 1 y 2 verificados en vivo por Claude (11/08)

Nadia bajó el trabajo de Luciano de anoche (plan de robustez de facturación AFIP/ARCA, ver sección
de abajo), inició sesión en `localhost:3000` y me pidió probar los Bloques 1 y 2 de
`PLAN_PRUEBAS_NADIA_2026-08-11.md` en su lugar (mismo backend/Supabase que producción). Resultado
completo y detallado en ese archivo — resumen:

- **Bloque 1 (Monitor de Facturación AFIP) — ✅ pasó.** Estado "Revisión manual" con motivo claro
  ("se agotaron los 5 reintentos..."), toggle "Ver detalle técnico" funcionando en ambos sentidos.
  ⚠️ Encontré una inconsistencia menor: el mensaje humano del "Último error" queda desactualizado
  una vez que el comprobante ya se rindió (sigue diciendo "no hace falta que hagas nada todavía"
  al lado de "se agotaron los reintentos"). No se tocó — queda en el backlog, no rompe nada.
- **Bloque 2 (velocidad) — ✅ pasó, mejor de lo esperado.** Venta de prueba $2 (20260811-001):
  **1,6 segundos** entre encolar y conseguir CAE real (0001-00000040), contra los ~30s esperados.
- **Bloque 3 — ⬜ no aplica todavía** (ninguno de los 3 comprobantes del incidente tiene CAE
  confirmado a mano en el portal de ARCA).

Los 3 comprobantes del incidente original (20260806-001/-008/-011) agotaron sus reintentos
automáticos y quedaron en "Revisión manual" — comportamiento esperado del fix, no una falla (ARCA
nunca destrabó esos 3 números puntuales). Sin urgencia, sistema sigue en homologación.

## ✅ Plan de robustez del motor de Facturación AFIP/ARCA — 3 fases completas (10/08)

Pedido de Luciano tras el incidente de abajo ("Facturas C sin CAE"): reforzar el motor de emisión
existente en 3 ejes — que reintente solo lo máximo posible, que no demore, y que los mensajes de
error sean claros. Metodología: barrido del motor actual + auditoría de código dedicada
(`sap-motor-contable-auditor`) + enfoque SAP (`sap-b1-consultor`) + investigación de mercado —
las 3 fuentes convergieron en la misma causa raíz. Plan completo en
`PLAN_ROBUSTEZ_FACTURACION_ARCA.md`.

**Causa raíz confirmada:** el worker solo consultaba `FECompUltimoAutorizado` (cuenta el último
número) pero nunca `FECompConsultar` (trae el comprobante real, con su CAE) — por eso ante
ambigüedad se rendía directo a revisión manual en vez de verificar primero. Patrón estándar de la
industria ausente: "confirm-before-repeat".

**Fase 1 — Reconciliación automática (mig.315, `arca-worker` v21):**
`feCompConsultar`/`consultarComprobante` nuevos; ante ambigüedad, el worker ahora consulta cada
número en disputa contra ARCA (total + documento) antes de rendirse — si matchea, persiste el CAE
real sin re-emitir; si no, recién ahí intenta CAEA y después revisión manual (antes esa rama nunca
llegaba a intentar CAEA). Persistencia del CAE movida a una RPC atómica
(`fn_persistir_cae_emitido`, una sola transacción — antes 3 updates HTTP sueltos con riesgo real de
"CAE fantasma"). Recuperación de filas `'procesando'` colgadas >10min. Hardening de permisos en
`facturas_pendientes_arca` (solo RPC, ya no `.update()` directo desde `authenticated`).

**Fase 2 — Velocidad (mig.316):** `fn_queue_factura_arca` ahora despierta a `arca-worker` con un
`net.http_post` fire-and-forget apenas encola algo nuevo (mismo patrón ya probado del cron de
mig.102) — el primer intento ocurre en segundos, no hasta 5 min. `max_intentos` default
sincronizado a 5 (antes 3 en la tabla vs. 5 hardcodeado en el worker — la barra del Monitor mentía).

**Fase 3 — Claridad de errores (mig.317, `arca-worker` v22):** diccionario `mensajeHumano()` en
`_shared/afip.ts` traduce los códigos AFIP más frecuentes (10016, 10197, 10246, 15008, 15004) a
lenguaje humano accionable, guardado en paralelo (`error_mensaje_usuario`/`error_afip_usuario`) sin
pisar el mensaje técnico crudo. Nueva columna `motivo_definitivo` distingue "el sistema decidió no
reintentar" (ambigüedad) de "se agotaron los 5 reintentos" — antes se veían idénticos en el
Monitor. `MonitorFacturacionAFIP.jsx` y `SaleDetailModal.jsx` muestran el mensaje humano por
defecto con un toggle "Ver detalle técnico"; el diálogo "Marcar resuelta" ahora puede capturar el
CAE/Nº AFIP/vencimiento real si el usuario lo verificó a mano en el portal (antes dejaba el
comprobante "emitido" sin esos datos, legalmente incompleto).

**Verificado en vivo contra los 7 Facturas C reales atascados desde el 06/08:** 5 resueltos
(20260810-002 reconciliado directo al CAE real N°35 sin consumir número nuevo; 06-006, 10-005,
10-001, 10-006 emitidos con numeración real nueva una vez que el contador se puso al día).

**Los 3 restantes (06-001 $3.000, 06-008 $25.000 — apareció después, no estaba en el lote
original de 7 —, y 06-011 $121.000) repetían `[10016]` de forma consistente incluso con el
contador local ya al día.** Se probó y descartó la hipótesis de "un número específico quemado"
(fallback `ultimo+1`→`ultimo+2` desplegado v24, probado en vivo, `ultimo+2` rechazado igual —
revertido en v25). **Fix real:** `classifyArcaError` reclasificó `[10016]` de `'data'` a
`'ambiguous'` — antes exigía reencolar a mano cada vez; ahora reintenta solo con backoff
exponencial como cualquier error transitorio. Confirmado en producción (v25, ACTIVA): los 3
comprobantes están en `estado='reintentando'` con `intentos` subiendo automáticamente sin
intervención humana. Si ARCA no resuelve el desincronismo solo, caen a `error_definitivo` con
`motivo_definitivo='reintentos_agotados'` tras 5 intentos — parada segura y clara. Detalle
completo en `PLAN_ROBUSTEZ_FACTURACION_ARCA.md`.

Verificado además: `npx eslint` 0 errores (solo warnings preexistentes de PropTypes), `npx vite
build` limpio, 153/153 tests, probado en vivo en el Monitor (toggle técnico funcionando, mensaje
humano visible, sin errores nuevos en consola — el único warning es uno preexistente y no
relacionado de `TopClientes.jsx`).

## ✅ Facturas C sin CAE desde el 06/08 — causa raíz resuelta, 5/7 casos cerrados (ver arriba)

Aparte, ya documentado y con dueño desde antes: 16 comprobantes viejos (03/07 al 08/07) atascados
por RG 5616 (Condición IVA del receptor), marcados en el propio `error_mensaje` como
"no-relevante temporalmente el 2026-07-08 — fix de CondicionIVAReceptorId escrito pero no
deployado". Ese ya estaba en el radar de Luciano, no es un hallazgo nuevo.

## 🐛 Bug real — Mapa de Relaciones: "actual" nunca marca desde Cotizaciones (hallado 10/08)

Circuito completo probado en vivo (Claude, navegación autónoma por pedido de Nadia — "entrá y
revisá, todo lo que puedas probar hacelo"). Resultado: **funciona bien en 6 de los 7 puntos de
entrada**, con un bug real y reproducible en uno.

**Lo que anduvo bien:** barra de resumen (pasos/total/derivados), scroll de la cadena, click en un
nodo no-actual abre el panel de preview inline sin cerrar el modal, botón "Cerrar preview",
"Ver documento completo", toggle de pantalla completa, "Sin documentos relacionados — comprobante
independiente" (venta de POS sin relaciones), "Sin documentos relacionados — factura independiente"
(factura de compra cargada directa, sin recepción), lado Compras (Recepción→Factura), "Recepción
todavía sin facturar" (mensaje correcto), y el punto de entrada desde Pedidos (`ModalDetallePedido`
→ "Mapa de relaciones") marca bien el nodo "actual".

**El bug:** abrir el Mapa de Relaciones desde una Cotización ya convertida en venta **nunca marca
ningún nodo como "actual"** — se ve la cadena completa (Entrega→Factura) pero sin el badge violeta
que indica "estás viendo esto desde acá". Causa raíz (confirmada leyendo el código, no es
timing): en `src/components/shared/MapaRelaciones.jsx`, `resolveAndFetch()` guarda
`activoId = cotizacionId` (línea 291) pero después llama a `fetchMapaVenta()`, que arma la cadena
con nodos `origen/pedido/entregas/comprobante` — **nunca un nodo de tipo cotización**. Como
`isActivo(id)` compara contra nodos que existen en la cadena, un id de cotización nunca va a
matchear ninguno → el bug es 100% determinístico, no depende de qué cotización se abra. Afecta a
las 21 cotizaciones convertidas de Nalux (y a cualquier empresa). Los otros 4 puntos de entrada
(Pedido, Entrega, Recepción, Devolución) sí funcionan porque esas tablas SÍ generan su propio nodo
en la cadena.

Nota aparte, no confirmada como bug: al abrir el mapa desde un Pedido facturado hubo **una vez**
un flash de "No se pudo cargar el mapa de relaciones" que se resolvió solo al reintentar (la
segunda vez cargó perfecto, con "actual" bien marcado). Puede ser sólo lentitud de red del entorno
local — no se pudo reproducir de nuevo — pero si Nadia/Luciano lo llegan a ver en producción,
anotarlo.

No se tocó código — es un hallazgo para que Nadia/Luciano decidan cuándo entra en el backlog. No es
grave (visual/informativo, no rompe nada ni toca datos), pero sí un bug real en 1 de los 5 puntos
de acceso nuevos de la Fase 3 del rediseño (09/08).

---

**Última actualización:** 2026-08-10, noche (Claude — plan de robustez del motor AFIP/ARCA,
3 fases completas y deployadas a producción, ver sección de arriba. Resumen:

1. **Motor de Facturación AFIP/ARCA — reforzado en 3 ejes** (reintento automático, velocidad,
   claridad de errores), a pedido de Luciano tras el incidente de las Facturas C sin CAE de más
   abajo. Investigación (auditoría de código + enfoque SAP + mercado) + `PLAN_ROBUSTEZ_FACTURACION_ARCA.md`
   + mig.315/316/317 + `arca-worker` v21→v22, todo en producción. Verificado en vivo contra los 7
   comprobantes reales atascados: **5 resueltos** (1 reconciliado sin consumir número nuevo, 4 con
   numeración real nueva), **2 siguen en `error_datos`** (mismo `[10016]` en 3 reintentos,
   probable caché de ARCA, no una carrera de nuestro lado) — reintentar más tarde desde el Monitor.
   Apareció además un tercer comprobante suelto en error (20260806-008, $25.000) no investigado
   todavía.
2. **Fidelización por Puntos — 100% cerrada** (mismo hilo, antes de esto), las 3 fases confirmadas
   en vivo por Nadia en POS y ERP. Bug de UX documentado, no resuelto (falta botón directo "Nueva
   Venta" en el ERP).
3. **Bug de impresión del ticket 80mm** — corregido y confirmado por Nadia en producción.
4. **Fase 3 del rediseño del Mapa de Relaciones** — deployada el 09/08, verificada en vivo. 1 bug
   real sin resolver (badge "actual" no marca desde Cotizaciones) — cosmético, en el backlog.

Antes de este cierre, mismo hilo (09/08): Fases 1 y 2 del rediseño del Mapa de Relaciones. Y antes
de eso (07/08): auditoría contable sistemática de las 10 áreas — mig.314.

Pendiente real para la próxima sesión: los 2 (o 3, con el hallazgo suelto) comprobantes que
siguen sin CAE — reintentar desde el Monitor de Facturación AFIP cuando haya pasado más tiempo.

Nada queda a medio hacer ni sin commitear — repo sincronizado con origin/master.)

## 🐛 Ticket 80mm imprimía con columnas pegadas — corregido (10/08)

Nadia reportó: al exportar el ticket a PDF desde Adobe (probablemente "Guardar como PDF" en vez
de mandarlo directo a una impresora térmica real), la tabla de ítems salía con las columnas
literalmente pegadas sin espacio — "CantDescripción" y "$16.000,00$16.000,00" en la misma
palabra, ilegible.

**Causa real:** `TicketPrint.jsx` usaba CSS Grid (`grid-cols-[3ch_1fr_9ch_9ch]`) para la tabla de
ítems del formato 80mm — funciona bien en una impresora térmica real, pero algunos exportadores
de "imprimir a PDF" no calculan correctamente columnas grid con unidades `ch`/`fr` y las colapsan
sin separación. El formato A4 (al lado, en el mismo archivo) ya usaba una `<table>` HTML normal
y no tenía este problema — las tablas HTML son el layout más robusto entre motores de
impresión/PDF distintos.

**Fix:** se cambió el formato 80mm para usar también una `<table>` HTML (misma estructura y
alineación visual que antes: Cant/Descripción/P.Unit/Total), en vez de CSS grid. Sin cambios de
contenido ni de datos — sólo el layout de esa tabla.

**Confirmado por Nadia en vivo (10/08):** volvió a exportar un ticket a PDF (comprobante
20260810-002) y las columnas ya se ven separadas — "Cant Descripción P.Unit Total" y cada fila
con sus valores bien alineados. Cerrado.

Verificado: 9/9 tests de `TicketPrint.test.jsx` en verde (siguen pasando sin cambios), suite
completa 153/153, `eslint`/`vite build` en 0 errores.

## ✅ Mapa de Relaciones — rediseño estilo SAP B1, Fase 3 (puntos de acceso) — 09/08

Completa el rediseño de 3 fases (Fases 1/2 el 08/08, detalle más abajo). Hasta ahora el mapa solo
se podía abrir desde el documento final de cada circuito (Factura de venta / Factura de compra),
igual que en SAP B1 — ahora se puede abrir desde **cualquier eslabón**: Cotizaciones (ícono en la
fila), Pedidos (botón junto a "Flujo del documento" en el detalle), Entregas (ídem), Recepciones
(ícono en la fila, lado Compras), y Devoluciones — cliente y proveedor comparten el mismo
componente de detalle, así que un solo cambio cubrió los dos circuitos.

**Cómo se resuelve sin duplicar lógica:** `MapaRelaciones.jsx` ganó 5 props de entrada nuevas
(`cotizacionId`, `pedidoId`, `entregaId`, `recepcionId`, `devolucionId`). Cada una se resuelve al
comprobante/compra ancla vía los FK directos que ya tenía el schema (`pedidos.comprobante_id`,
`entregas.comprobante_id`, `recepciones.compra_id`, `devoluciones.comprobante_id`/`.compra_id`
según `tipo`) — cero cambios en `fetchMapaVenta`/`fetchMapaCompra`, que ya estaban probados desde
la Fase 1. El nodo "ACTUAL" ahora es el que efectivamente se abrió (nuevo estado `activoId` +
helper `isActivo(id)`), no siempre la factura como antes.

**Caso nuevo manejado con gracia:** si el documento de origen todavía no tiene comprobante/compra
vinculado (ej. un Pedido en borrador, una Cotización sin convertir), se muestra un mensaje
explícito ("todavía sin facturar") en vez de fallar o mostrar un mapa vacío confuso.

**Probado en vivo contra datos reales de producción** (solo lectura, sin mutar nada — sesión con
usuario ya logueado en el navegador de pruebas): pedido facturado (PED-20260707-001) → cadena
completa de 3 pasos con el Pedido marcado ACTUAL y la Factura como nodo clickeable aparte; pedido
en borrador (PED-20260725-003) → "Pedido todavía sin facturar..."; recepción (REC-2026-0012) →
resolvió bien la compra vinculada, badge "Compras" correcto; cotización aprobada sin convertir
(COT-00021) → "Cotización todavía sin facturar...". Cero errores nuevos en consola en los 4 casos.
Lint/build limpios, 153/153 tests.

## ✅ Mapa de Relaciones — rediseño estilo SAP B1, Fases 1 y 2 — 08/08

Pedido de Luciano: replicar la idea del Relationship Map del cliente web de SAP Business One
(capturas de referencia), con estilo KAIROX, totalmente funcional. Antes de construir: barrido de
lo que ya existía (`src/components/shared/MapaRelaciones.jsx` — el motor de datos ya era sólido,
el problema era solo visual) + estudio de mercado sobre el Relationship Map real de SAP B1 (qué
le gusta a los usuarios, qué les molesta). Plan completo con las 4 fases en
`PLAN_MAPA_RELACIONES.md`.

**Fase 1 (rediseño visual):** ícono por tipo de documento (antes solo color de borde), badges de
estado con color unificado, barra de resumen del circuito ("N pasos · Total · N derivados", al
estilo de la cabecera de SAP), cadena principal en scroll horizontal en vez de `flex-wrap` (ya no
se desordena con cadenas largas — el problema visual concreto que señaló Luciano), conector tipo
stepper, botón de pantalla completa. Sin tocar la lógica de datos. Se evaluó sumar React Flow
mencionado en el plan original pero se decidió no meter una dependencia nueva justo antes de las
pruebas de esta noche.

**Fase 2 (preview inline al hacer clic) — la mejora sobre SAP, no solo la copia:** el hallazgo más
repetido en la investigación de mercado fue que el Relationship Map de SAP "solo da alto nivel" —
para ver qué hay adentro de cada documento hay que abrirlo aparte, perdiendo el contexto del
circuito completo. Ahora un clic en cualquier nodo navegable (origen, pedido, entrega, NC,
devolución, recepción) abre un panel al costado DENTRO del mismo modal con los ítems reales del
documento — el header no pide nada nuevo (ya viaja en el nodo), solo los ítems se buscan aparte,
por tabla de detalle según el tipo (`comprobante_items`/`pedido_items`/`entrega_items`/
`recepcion_items`/`devolucion_items`, con `devolucion_prov` como alias de `devolucion` ya que
comparten tabla). Botón "Ver documento completo" para el que igual quiere navegar de una — ese sí
cierra el mapa (comportamiento viejo, ahora es una acción explícita en vez de la única opción).

**Probado en vivo contra una venta real** (20260806-011, Entrega→Factura, sesión activa de Nadia
en el navegador de pruebas — sin mutar nada, solo lectura): clic en el nodo Entrega mostró sus 4
ítems reales (Máquina de afeitar, Batidora Eléctrica, Mate, Celulares) sin cerrar el mapa; clic en
la ✕ del preview devolvió el layout a ancho completo; el botón de pantalla completa funcionó bien.
Verificado además: lint/build limpios, 153/153 tests, sin errores nuevos en consola (el único
warning que aparece es uno preexistente y no relacionado, de `TopClientes.jsx` en el Dashboard —
key duplicada "Consumidor Final", anotado pero no es de esta sesión).

**Queda la Fase 3** (agregar el botón "Mapa de relaciones" también en Cotizaciones, Pedidos,
Recepciones y modales de NC/ND — hoy solo está en el documento final de cada circuito, Ventas y
Compras) para después de las pruebas de esta noche.

**Circuito de pruebas completo sumado a `PLAN_PRUEBAS_SABADO_2026-08-08.md` (sección 5)** — cubre
ambos lados (Ventas/Compras), cadena larga vs. sin relaciones, cada tipo de nodo clickeable, cierre
del preview, pantalla completa, y navegación real desde "Ver documento completo".

## ✅ Auditoría contable sistemática (10 áreas) — 3 hallazgos, los 3 ya resueltos — mig.314

Pedido explícito de Luciano ("vamos con las auditorías faltantes"): correr la skill
`auditor-contable` completa contra el repo real (no memoria de sesiones previas), score por las
10 áreas RT FACPCE/IFRS. Informe completo en `INFORME_AUDITORIA_CONTABLE_2026-08-07.md`. Score:
6/10 verde, 3 amarillo, 1 rojo al momento de auditar.

**🔴 Crítico (el único rojo), resuelto mismo día:** `asientos_contables`/`asientos_items` no
tenían ninguna protección server-side — ni un trigger/constraint validaba `sum(debe)=sum(haber)`
antes de insertar, ni la política RLS (mig.132) distinguía `estado`, así que cualquier staff con
el permiso "Configuración" podía editar o borrar un asiento ya confirmado (y ya declarado a AFIP)
directo desde el navegador, sin pasar por ninguna RPC. Verificado que el gap era real antes de
tocar nada (`has_table_privilege('authenticated', 'asientos_contables', 'INSERT') = true`).

**Fix (mig.314):** 4 RPCs `SECURITY DEFINER` nuevas (`crear_asiento_manual`,
`crear_asiento_automatico`, `confirmar_asiento`, `anular_asiento`) + `REVOKE ALL ... FROM anon,
authenticated` sobre ambas tablas (mismo patrón "escritura exclusiva vía RPC" que
`cuenta_corriente_imputaciones`, mig.169) — de acá en más la única forma de tocar un asiento es
por RPC, y esas RPCs validan partida doble y período cerrado server-side antes de escribir. Los 7
sitios de `asientosAutoService.*` (venta, compra, ajuste de stock, NC/ND cliente y proveedor,
reversa) pasaron de 2 llamadas separadas (crear + confirmar, con ventana real de asiento huérfano
si la segunda fallaba) a una sola llamada atómica.

**Probado en sandbox contra Nalux ANTES de aplicar** (`BEGIN...ROLLBACK`, simulando la sesión de
un admin real vía `SET LOCAL request.jwt.claim.sub`): 7/7 casos correctos — automático balanceado
→ confirmado, automático desbalanceado → rechazado con el mensaje esperado, manual → borrador →
confirmar → confirmado, anular → anulado, INSERT/UPDATE directo como `authenticated` → rechazado
por falta de privilegios. Cero residuo (verificado después: 0 funciones nuevas y 0 filas de test
en la base real antes del `ROLLBACK`; confirmado que el gap seguía abierto justo antes de aplicar
la migración de verdad). Aplicada a producción con confirmación explícita de Luciano.

**🟡 Importante #1, resuelto:** el aging de deuda (antigüedad 0-30/31-60/61-90/+90 días) solo
existía para Clientes (`TabAntiguedad.jsx`). Agregada la misma pestaña para Proveedores en
`ProveedoresSection.jsx` (que no tenía Tabs a nivel de sección todavía — se agregó), reutilizando
la vista `compras_saldo_pendiente` ya existente. `TabAntiguedad.jsx` se generalizó con props
`entityLabel`/`onVerDetalle` en vez de callbacks específicos de Cliente, para servir a los dos.

**🟡 Importante #2, resuelto como efecto directo del fix crítico:** el bloqueo de período cerrado
para el flujo automático de ventas/compras/etc. era best-effort desde el cliente (si la RPC de
chequeo fallaba por red, el asiento se posteaba igual). Ahora `crear_asiento_automatico` lo valida
siempre server-side, de forma bloqueante, para las 7 rutas automáticas.

**🟢 Mejoras (no bloqueantes, no se tocaron):** reporte de valorización de inventario a fecha de
corte histórico, centros de costo a nivel de línea (hoy solo a nivel de documento).

Verificado: lint/build limpios, 153/153 tests, `get_advisors` post-deploy sin hallazgos nuevos
más allá del esperado ("SECURITY DEFINER callable por authenticated", mismo patrón que
`abrir_caja_sesion` y el resto de las RPCs del proyecto — intencional), sin errores de consola en
producción tras el deploy.

**Confirmado con una venta real por Nadia (10/08):** venta 20260810-006 ($25.000, Efectivo)
generó el asiento AS-000215 automáticamente, **confirmado** (no borrador), balanceado — Debe
$35.000 = Haber $35.000 (la venta $25.000 + el costo de mercadería $10.000, partida doble
estándar). De paso se revisaron también los asientos de las ventas de fidelización de hoy
(20260810-002 a 006, incluida una por QR MercadoPago) — todos confirmados y balanceados. **El fix
de mig.314 queda verificado en producción real, no sólo en sandbox.**

## ✅ Las 2 auditorías contables pendientes ya estaban cerradas — confirmado 07/08

Luciano preguntó si quedaban cosas por auditar, aparte de lo ya cubierto en el barrido general.
Revisé el código real (no solo memoria/CONTEXT.md) contra las 2 auditorías que se habían iniciado
en sesiones previas y encontré que **las dos ya estaban resueltas**, sin que quedara registrado en
ningún resumen consolidado hasta ahora:

- **Cheques → Bancos ("Valores en Cartera")**: cobrar/depositar un cheque sí genera movimiento en
  `movimientos_bancarios`, y el rechazo sí restaura la deuda del cliente — resuelto hace más de una
  semana en 10 migraciones (028→211). El único gap real que quedaba (asiento fallido silencioso) ya
  se había cerrado en mig.282 (ver [[project_cheques_asiento_fallido_mig282]]).
- **Devolución → Nota de Crédito**: confirmado en `supabase/migrations/263_crear_devolucion_sin_nc_automatica.sql`
  — la Devolución es una copia fiel de la Factura que anula (mismos ítems/precio/alícuota real de
  IVA) y **ya no dispara la NC automáticamente**; la NC pasó a ser una acción explícita y separada
  (`crear_nota_credito(p_devolucion_id)`, mig.264) desde el detalle de la Devolución — exactamente
  el rediseño que se había pedido, con el agregado de que corrigió de raíz 2 bugs reales que tenía
  la rama vieja: la NC nunca se encolaba a AFIP, y siempre asumía IVA 21% sin importar la alícuota
  real del ítem.

**No queda ninguna auditoría contable abierta.** Lo único pendiente de construir (no de auditar) es
lo que ya figura en `ROADMAP.md`: WhatsApp (comprobantes + links de cobro) es el único ítem real de
"construir" sin empezar — el resto del roadmap está deliberadamente pausado o fuera de alcance.

**Última actualización previa:** 2026-08-07 (Claude — barrido general del sistema a pedido de Luciano,
de cara al objetivo de `ROADMAP.md` de conseguir el primer cliente en agosto. Login rebrandeado
con el sistema de diseño `kx-*` + logo real; encontrado que el mismo estilo viejo sigue en 32
archivos más (88 ocurrencias) — alcance del rebrand queda a decisión de Luciano, ver
`PLAN_PRUEBAS_SABADO_2026-08-08.md`. `ROADMAP.md` actualizado — 2 adapters que decía pendientes
ya están hechos. Sin gaps funcionales nuevos encontrados en el flujo de ventas/facturación; suite
153/153 en verde. Plan de pruebas de mañana sábado para Luciano+Claude en
`PLAN_PRUEBAS_SABADO_2026-08-08.md` — el de Nadia sigue siendo `PLAN_PRUEBAS_NADIA_2026-08-08.md`.)

## 🔍 Barrido general del sistema (07/08) — resultado

Pedido por Luciano: "qué falta, qué queda, tanto para revisar como para terminar", contrastado
contra el roadmap de mercado (`ROADMAP.md`) y lo ya construido.

**A. `ROADMAP.md` estaba desactualizado en 2 puntos** (corregido): decía "falta publicar catálogo
KAIROX→Tiendanube" (ya está hecho desde el 22/07) y marcaba el stock bidireccional de MercadoLibre
como problema abierto (ya resuelto con una decisión de diseño explícita: KAIROX es la única fuente
de verdad del stock, con cola + reintentos, mismo patrón que Tiendanube — la garantía de no
sobreventa la da `crear_venta` con `FOR UPDATE`, verificada en vivo el 06/08).

**B. Gaps reales de código:** ninguno en el flujo de ventas/facturación/asientos (esas rutas están
limpias de TODOs). Lo que sí hay son 3 cosas ya diferidas **a propósito**, con nota explícita en el
código de por qué no están hechas todavía: series AFIP por letra en vez de por tipo de documento
(nota "Q3 2026" en `TabFacturacion.jsx`), valoración de stock FIFO (solo activo
`ultimo_costo`/`promedio_ponderado` por ahora), y el Bearer del cron de `mp-sync` hardcodeado en la
migración (es la `anon key`, pública por diseño — bajo riesgo, pero sigue siendo un TODO abierto).
Ninguno bloquea nada hoy.

**C. Suite de tests:** 153/153 en verde, sin deuda técnica visible.

**D. Pendientes técnicos ya conocidos** (sin cambios, ver la sección con ese nombre más abajo):
dominio propio para email, CbteAsoc en `informar-caea`, 4 NC históricas mal declaradas ante ARCA,
MELI Factura A.

**E. Hallazgo de branding (no estaba en el pedido original, lo encontré revisando el login):** el
login (`AuthPage.jsx`) tenía colores hardcodeados viejos (`#00D4FF`/`#A855F7`, cian/violeta) y
estaba forzado a modo oscuro siempre, ignorando el sistema de diseño `kx-*` (violeta, con soporte
claro/oscuro) que usa el resto de la app — y cuando no hay logo de empresa cacheado (dispositivo
nuevo, el caso del primer cliente) mostraba un ícono genérico en vez de la marca real de KAIROX.
**Corregido:** ahora usa los tokens `kx-*` y muestra `/kairox-logo.png` como fallback. De paso,
`index.html` tenía el favicon default de Vite (`/vite.svg`) en vez del logo — corregido, más
`theme-color`/`apple-touch-icon`/`meta description`. Verificado: lint y build limpios, 153/153
tests, colores computados correctos en ambos temas contra el servidor de dev — no pude sacar
captura real por una limitación del entorno de pruebas, queda para que Luciano lo confirme
mañana.

**✅ El mismo estilo viejo estaba en 32 archivos más (88 ocurrencias)** — Ventas, Compras, Cheques,
Plan de Cuentas, Caja, Reportes, Configuración, y el resto del flujo de auth (`OnboardingPage.jsx`,
`ResetPasswordPage.jsx`, `PasswordRecoveryModal.jsx`). Luciano eligió hacer el rebrand completo de
una — ya está hecho y deployado: 0 ocurrencias del color viejo en `src/`, lint/build limpios,
153/153 tests, sin errores de consola en producción. Dos puntos a confirmar visualmente (no hay
forma de sacar capturas en este entorno): botones sólidos que pasaron de texto negro a blanco
sobre el violeta (por contraste WCAG AA en modo claro), y `PlanCuentasSection.jsx` (era la que más
se apartaba del patrón dual claro/oscuro del resto de la app). Detalle en
`PLAN_PRUEBAS_SABADO_2026-08-08.md`.

## 🧪 Plan de pruebas para Nadia (mañana) — QR MercadoPago + escaneo por cámara

Dos cosas para probar en producción, apuntando siempre a la empresa de test (no tocar clientes
reales — ver regla de no mutar datos en vivo). Reportar cualquier resultado inesperado con
captura de pantalla y hora exacta (ayuda a cruzar contra los logs).

**1) Cobro por QR de MercadoPago — regresión del fix de CORS**
- Abrir el POS **desde la URL de producción normal** (`kairox-gestion-chi.vercel.app` o el
  dominio que uses día a día) — no hace falta buscar una URL de deploy específica, cualquier
  entrada sirve para confirmar que no volvió el error.
- Hacer una venta de prueba y cobrar con "QR MercadoPago".
- ✅ Esperado: el QR se genera sin error en pantalla ni en la consola del navegador (F12 →
  Console, no debería aparecer nada en rojo con "CORS" o "Failed to fetch").
- Escanear el QR con la app de MercadoPago y pagar un monto chico de prueba.
- ✅ Esperado: la venta se confirma sola en el POS entre 60 y 70 segundos después de pagado (no
  hace falta refrescar la pantalla) — esto lo hace el poller automático, no el webhook.
- Si el QR no se genera o tarda más de 2 minutos en confirmar: anotar la hora y avisar.

**2) Escaneo de código de barras con la cámara — feature nueva, primera prueba real**
- Este es el que más necesita probarse con hardware real — hasta ahora sólo se probó en un
  navegador de escritorio sin cámara real disponible.
- Entrar al POS **desde el celular** (Android y, si hay a mano, un iPhone — son los dos casos que
  importa diferenciar).
- En el buscador de productos, tocar el ícono de cámara a la derecha del campo de búsqueda.
- El navegador va a pedir permiso de cámara → aceptar.
- ✅ Esperado: se abre un modal con el video de la cámara trasera (no la frontal/selfie) y un
  recuadro guía en el centro.
- Apuntar a un código de barras real de un producto cargado en el sistema.
- ✅ Esperado: en cuanto el código entra en foco y se lee bien, el modal se cierra solo, el
  producto se agrega al carrito y aparece un toast de confirmación (`✓ Nombre del producto × 1`).
- Probar también con un código que **no** exista en el catálogo (tachar un código con marcador y
  escanearlo, o usar el código de un producto de prueba que no esté cargado).
- ✅ Esperado: toast rojo "Código no encontrado" — el modal se cierra pero no agrega nada al
  carrito.
- Probar decir que no al permiso de cámara (denegarlo cuando el navegador pregunta).
- ✅ Esperado: mensaje claro dentro del modal ("Permiso de cámara denegado...") sin que la
  pantalla se rompa ni tire error.
- Si en iPhone la cámara no abre o el modal queda cargando para siempre: esto es justo lo que no
  se pudo probar en el sandbox — es el dato más importante de todo este plan.

## ✅ Escaneo de código de barras con la cámara — construido

Luciano pidió arrancar esto ("de paso arranca con el 2") tras confirmar que el ancho de papel
térmico está bien. Complemento del lector físico (keyboard wedge) para un mostrador secundario sin
lector o venta ambulante desde un celular — no lo reemplaza para el mostrador principal.

Nuevo componente `EscanerCamaraModal.jsx` + botón de cámara junto al buscador en
`PanelProductos.jsx`. Usa `@zxing/browser` (decodificación en JS puro contra el stream de
`getUserMedia`) en vez de la `BarcodeDetector` nativa del navegador — esa API **no existe en
Safari/iOS** (ningún iPhone/iPad), así que con ZXing el escaneo funciona igual en Android y en
iPhone. La búsqueda por `codigo_barras` se extrajo a una función compartida (`buscarPorCodigo`)
para no duplicar la lógica entre el Enter del lector físico y la detección por cámara.

Verificado: build + lint limpios, suite de tests 153/153 sin romper nada, y probado en vivo en el
navegador — el botón abre el modal, y como el sandbox de testing no puede otorgar permiso de
cámara real, se confirmó el path de manejo de error (mensaje claro de "permiso denegado", sin
crashear, cierre limpio sin errores en consola). El flujo con cámara real (feedback en vivo del
escaneo) queda pendiente de que Luciano lo pruebe con su celular.

## ✅ Bug de CORS en el cobro por QR — corregido y redeployado en las 23 funciones afectadas

Vercel emite una URL nueva y única en cada `vercel deploy` (ej.
`kairox-gestion-4x0kytc7g-k-gestion.vercel.app`), además del alias estable
`kairox-gestion-chi.vercel.app`. El allowlist de CORS de las edge functions era una lista fija
de orígenes exactos — no contemplaba esas URLs de deploy, así que entrar por una de ellas
rompía el preflight de `mp-qr-crear` (bloqueaba cobrar por QR).

Fix: además de la lista fija, aceptar cualquier origen que matchee el patrón real de las URLs de
deploy de este proyecto (`kairox-gestion-<hash>-k-gestion.vercel.app`). Verificado con `curl`
contra producción real (no se puede simular esto desde el navegador — el header `Origin` no se
puede falsear desde JS): el origen exacto de tu captura ahora recibe
`Access-Control-Allow-Origin` correcto; un origen ajeno (`evil.com`) sigue rechazado.

El fix vive en `_shared/auth.ts`, compartido por las 23 edge functions afectadas — a pedido de
Luciano ("redeploya, así no nos topamos con errores") se redeployaron **las 23**, no solo
`mp-qr-crear`: `create-user`, `delete-user`, `generar-csr`, `invite-user`, `mp-save-config`,
`mp-verify-token`, `tiendanube-compliance-webhook`, `verificar-caea-vigente`,
`integraciones-oauth-iniciar`, `mercadolibre-catalogo`, `mercadolibre-catalogo-publicar`,
`mercadolibre-categorias`, `mercadolibre-pedidos-webhook`, `mercadolibre-stock-worker`,
`tiendanube-catalogo`, `tiendanube-catalogo-publicar`, `tiendanube-pedidos-webhook`,
`tiendanube-stock-worker`, `arca-worker`, `probar-conexion-afip`, `solicitar-caea`,
`informar-caea`, `mp-sync`, y `mp-qr-crear` (ya deployado antes, versión 9). El más sensible,
`arca-worker` (worker fiscal por cron), se verificó post-deploy con una invocación manual —
respondió `{"procesados":0,"mensaje":"Cola vacía"}`, sin errores.

## 🖨️📷 Impresora térmica y lector de código de barras — revisados, sin cambios necesarios

Investigué el código actual y comparé contra lo que usa el mercado en 2026 (fuentes abajo):

- **Impresora térmica**: hoy imprime vía `window.print()` con `@page { size: 80mm auto }` — el
  navegador manda la página al driver de la impresora instalada en Windows. Es el enfoque
  correcto: la alternativa "moderna" (WebUSB directo, sin diálogo) sólo funciona en Chrome/Edge y
  **en Windows específicamente falla si la impresora ya tiene un driver instalado** (que es como
  vienen casi todas) — el driver se la "adueña" y WebUSB no puede acceder. Nada para tocar.
- **Papel 80mm vs 58mm**: confirmado por investigación — 80mm es el estándar para comercio con
  factura electrónica (58mm se usa más en datáfonos de tarjeta, texto obligatorio no entra bien).
  KAIROX ya usa 80mm por default. Sin pedido explícito de agregar 58mm, no se toca.
- **Lector de código de barras**: ya usa el estándar del mercado (modo "keyboard wedge" — el
  95%+ de los lectores comerciales vienen así de fábrica, cero configuración del lado de KAIROX).
  Tiene además una defensa activa (auto-refocus del buscador tras cualquier click) contra la
  única limitación documentada de esta tecnología ("si el foco no está en el campo correcto, el
  texto va a parar a otro lado"). Ya era una fortaleza marcada en el análisis de mercado del POS.
- **Escaneo por cámara:** evaluado y luego construido a pedido de Luciano — ver sección
  "✅ Escaneo de código de barras con la cámara" al principio de este documento. Se descartó la
  `BarcodeDetector` nativa del navegador (no existe en Safari/iOS) en favor de `@zxing/browser`.

---

# 👉 EMPEZÁ POR ACÁ (Luciano)

## ✅ Bug que encontraste recién (venta CC con "cliente ya seleccionado") — arreglado

Reproduje exactamente lo de tu captura (POS mobile, Cuenta Corriente, warning "CC requiere
cliente seleccionado" con el cliente visible en el dropdown) y encontré la causa real, más
grave de lo que parecía:

**`ClienteSelector.jsx` disparaba dos actualizaciones de estado al crear un cliente por "Alta
rápida"** — una correcta (selecciona el cliente con el objeto completo) y otra que buscaba ese
mismo cliente recién creado en una lista que todavía no se había actualizado, fallaba, y pisaba
la selección con `null`. El desplegable seguía mostrando bien el nombre (por eso en tu captura
se veía "seleccionado"), pero por dentro la venta no tenía cliente real asociado.

**Con Cuenta Corriente esto se nota** (bloquea con el warning que viste). **Con cualquier otro
medio de pago fallaba en silencio** — verifiqué en vivo con datos sintéticos: antes del fix, una
venta en Efectivo después de crear un cliente por Alta Rápida se confirmaba sin ningún error,
pero quedaba grabada con `cliente_id: null` / "Consumidor Final" en la base, en vez del cliente
real recién creado. Corregido y re-verificado con el mismo repro exacto (Efectivo y Cuenta
Corriente) — ahora el cliente queda bien atribuido en los dos casos, incluidos los puntos de
fidelización. Todo el dato de prueba revertido después.

**De paso, un hallazgo aparte (no relacionado, pero taponaba la consola mientras investigaba):**
el "ping activo" de conectividad (`useOnlineStatus.js`) pegaba a `/rest/v1/`, que **siempre**
devuelve 401 para el rol `anon` de este proyecto (RLS le niega la función `get_my_empresa_id` a
propósito — no era falta de apikey, lo confirmé mandando el apikey completo y seguía dando 401).
`supabase-js` parchea `fetch` globalmente y logueaba cada uno como error de consola cada 20
segundos — exactamente el ruido que se veía en tu captura, tapando la pista real. Cambiado a
`GET /auth/v1/health` (endpoint público de verdad, sólo necesita el apikey) — 200 limpio,
verificado en vivo, la consola ya no se llena solo.

`npx eslint`/`npx vite build` en 0 errores, 153/153 tests en verde, deployado y verificado
contra el bundle real de producción.

**Importante — esto fue una pasada dirigida a lo que reportaste, no un barrido de "todos los
casos posibles"**: encontré estos 2 problemas siguiendo tu reporte, pero no hice pruebas
exhaustivas de cada combinación de descuentos/ofertas/atajos/pago mixto. Si seguís probando y
encontrás algo más, avisame igual que esta vez.

## ✅ mig.313 aplicada — QR MercadoPago ya suma puntos

**`supabase/migrations/313_fidelizacion_puntos_qr.sql` está aplicada a producción**, con tu
confirmación. Cierra el gap de "las ventas por QR MercadoPago no ganan puntos". Ya había quedado
probada de punta a punta en sandbox antes de aplicarla (`BEGIN...ROLLBACK` contra Nalux, con
datos 100% sintéticos, 0 rastro después — detalle completo en `PLAN_FIDELIZACION_PUNTOS.md`), así
que se aplicó tal cual, sin volver a probar. Verificado después de aplicar: la función tiene el
fix, `GRANT` sólo a `service_role` (ni `authenticated` ni `anon` pueden ejecutarla), y 0 alertas
de seguridad nuevas en `get_advisors`.

**Probado parcialmente en vivo por Nadia (10/08):** cobro real por QR de $2 (venta 20260810-005,
Luciano Rosa) — el pago se acreditó bien, pero $2 con el ratio actual (100 pesos = 1 punto) da
`floor(2/100) = 0` puntos, así que no hay forma de confirmar desde este monto si el mecanismo de
sumar puntos realmente corrió (0 puntos y "no corrió" se ven exactamente igual). **Sigue pendiente
un cobro real más grande (~$100+) para confirmarlo de una vez** — Nadia decidió dejarlo así por
ahora, no es urgente retomarlo.

**De paso, Nadia preguntó por la demora de ~60-70s en confirmar el pago — no es nada nuevo:** es
el mismo problema del webhook de MP con 401 ya documentado hace tiempo (ver "🔴 Secreto de firma
de MP" más abajo) — Luciano ya roteó la clave una vez y se revisó el código dos veces, sigue sin
resolverse, próximo paso sería contactar al soporte de MP directamente. El poller de 1 minuto
(`mp-qr-poller`) sigue siendo la red de seguridad mientras tanto, funcionando como se espera.

**Nota de coordinación (sin impacto en vos, sólo para que quede registrado):** mientras
trabajaba en esto, Nadia (en su propia sesión, en paralelo) ya había replicado la Fase 3 al ERP
Y de paso encontró y arregló un bug real que mi propia réplica también tenía sin darme cuenta
(el descuento de puntos se restaba sólo del total, sin repartirlo entre los ítems — eso
desbalanceaba el asiento contable automático y, con factura electrónica activa, la factura a
ARCA hubiera informado el monto bruto en vez del cobrado). Al traer sus cambios descarté mi
versión (tenía el bug) y me quedé con la de ella. **Mi versión con el bug llegó a estar
deployada en producción unos minutos** (hasta que hice `git fetch` y encontré su commit) — sin
uso real conocido de "canjear puntos" en Nueva Venta en esa ventana, y redeployado con la versión
correcta apenas se detectó.

---

**🆕 Fidelización por Puntos — arrancó hoy (07/08), Fase 0 (backend) ya aplicada y probada.**
Investigación de mercado en `INVESTIGACION_FIDELIZACION_PUNTOS.md` (confirma el hueco: ni Tango
ni Fudo lo resuelven nativo) y plan de 4 fases en `PLAN_FIDELIZACION_PUNTOS.md`. Decisiones de
Nadia: canje = descuento directo en pesos, gratis para todas las empresas, sin vencimiento.
mig.312: columnas nuevas en `empresas`/`clientes`, tabla `movimientos_puntos` (ledger auditable),
`crear_venta` gana `p_puntos_canjeados` (patrón DROP+CREATE de siempre). De paso se cerró un gap
de seguridad que se había escapado: `anon` todavía tenía EXECUTE directo sobre `crear_venta`
(mig.309 sólo había revocado de `PUBLIC`). Probado en vivo contra Nalux con datos 100%
sintéticos (simulando una sesión real vía JWT — necesario porque la función valida
`get_my_empresa_id()`): ganar + canjear puntos, saldo insuficiente rechazado limpio,
fidelización desactivada rechazada limpio, y **una venta sin tocar puntos sigue funcionando
idéntico a hoy** (cero regresión). Todo el dato de prueba revertido, Nalux quedó como estaba.
**Fase 1 (Configuración por empresa) también ya está hecha y probada en vivo (07/08).** Card
nueva "Fidelización por Puntos" en Configuración → Finanzas (mismo lugar que Moneda
Paralela/Centros de Costo/Cajas): toggle `usa_fidelizacion` + 2 inputs de ratio
(`puntos_pesos_por_punto`/`puntos_valor_pesos`) + resumen en vivo + botón "Guardar" explícito.
Sin migración nueva (usa las columnas de la Fase 0). `npx eslint`/`npx vite build` en 0 errores.
**Nadia lo probó en Nalux:** activó, cargó 100/1, guardó, recargó — quedó igual, confirmado.

**⚠️ Importante, corregido después de revisar `crear_venta` con más cuidado:** activar el toggle
**no es sólo una pantalla que no hace nada todavía** — la lógica de "ganar puntos" ya vive en
`crear_venta` desde la Fase 0 y corre en toda venta real con cliente asociado, en POS y ERP, sin
depender de ninguna UI nueva. Desde que Nadia guardó la configuración, **los clientes de Nalux ya
empezaron a acumular puntos de verdad** (auditable en `movimientos_puntos`), aunque todavía no
hay pantalla que lo muestre — eso es lo único que falta de la Fase 2. Canjear sí es un gate real
de la Fase 3 (ningún caller de `crear_venta` hoy manda `p_puntos_canjeados`, así que nadie puede
canjear todavía). Avisado esto, **Nadia decidió dejarlo activo** — los puntos siguen sumando en
segundo plano.

**Fase 2 (Ganar puntos, visible) también ya está hecha (07/08).** Un solo componente cubre los
dos circuitos de venta: `ClienteDrillDown.jsx` (el popover "ojo" del selector de cliente,
compartido por POS y ERP) ahora muestra "Saldo de Puntos" junto al de Cuenta Corriente, sólo si
la empresa tiene fidelización activa. Además, cada venta que suma puntos ahora avisa en el
momento: toast "+N puntos" y banner en el ticket del POS (`TicketPrint.jsx`) y en el PDF del ERP
(`TicketPDF.jsx`). Sin cambios de backend — sólo lee `puntos_ganados`, que `crear_venta` ya
devolvía desde la Fase 0. 5 tests nuevos, suite completa 140/140 en verde, `eslint`/`vite build`
en 0 errores.

**Nadia probó Fase 2 en vivo y encontró 3 bugs de UI, ya arreglados (07/08):** el popover del
"ojo" se cortaba contra el borde derecho de la pantalla (`ClienteDrillDown.jsx`, `left-0` →
`right-0`); el botón "Confirmar Venta" quedaba tapado en ventanas de navegador bajas (faltaba
`min-h-0` en el listado de items del carrito del POS — mismo bug ya resuelto en el PanelCarrito
hermano del ERP, se copió el fix); los puntos ganados no se veían lo suficiente (sólo estaban en
el toast efímero) — ahora también hay un badge "¡Ganaste N puntos!" en el modal "¡Venta
confirmada!". Los 3 fixes verificados contra la sesión real de Nadia (popover completo dentro de
pantalla mostrando "270 pts" de Carlos Perez, botón 100% visible en un viewport de 660px de
alto). **Gap real encontrado de paso:** las ventas por QR MercadoPago no ganan puntos — usan un
RPC distinto (`crear_venta_pendiente_qr`) que no pasa por la lógica de puntos de `crear_venta`.
**Cerrado más tarde el mismo día (mig.313) y ya aplicado a producción.**

Sigue la **Fase 3 (Canjear puntos — input en el checkout, descuento aplicado)** recién con el
próximo "dale" — detalle completo en `PLAN_FIDELIZACION_PUNTOS.md`.

**✅ Nadia corrió el plan de pruebas hoy (07/08), en `kairox-gestion-chi.vercel.app` — resultado
de cada bloque:**

- **Bloque 1 (sesión vieja, 1+ hora offline reconectando):** ✅ salió perfecto — encontró en el
  camino el bug de la apertura offline abandonada (ver abajo), se arregló en vivo, y quedó
  re-verificado: las 5 ventas que cobró durante la prueba terminaron en la base, cada una una
  sola vez, con numeración real (`20260806-001` a `005`).
- **Bloque 2, Escenario A (wifi conectado sin internet real):** ⚠️ **salteado** — no tenía forma
  de armar esa red específica hoy. Sigue sin verificarse, no es grave (el mecanismo del "ping
  activo" ya está andando, sólo falta el caso límite exacto).
- **Bloque 2, Escenario B (conexión que entra y sale varias veces seguidas):** ✅ 5-6 cortes de
  wifi seguidos, una sola venta sincronizada al final, sin duplicados (confirmado contra la base:
  `20260806-006`).
- **Bloque 3 (multi-caja con sus propios ojos):** ✅ 2 cajas simultáneas en 2 ventanas del
  navegador, selector apareció bien, tooltip de "no se puede cambiar con turno abierto" anduvo,
  los 2 arqueos de cierre cuadraron perfecto ($0,00 de diferencia en ambos), y pudo desactivar la
  caja de prueba después de cerrar el turno.

**Con esto, Modo Offline del POS y Multi-caja quedan 100% cerrados** (salvo el Escenario A de
arriba, anotado como pendiente real, no fingido como probado).

**🐛 Bug real encontrado y arreglado (07/08): apertura offline abandonada varaba ventas reales.**
Nadia estaba corriendo el Bloque 1 del plan de pruebas (`PLAN_PRUEBAS_NADIA_2026-08-06.md`) y
encontró esto en producción real, con plata real:

- Intentó "abrir caja sin conexión" desde un arranque en frío (la pestaña nunca había cargado la
  lista de cajas con internet todavía) — quedó encolada localmente pero sin uso real.
- Después abrió la caja de nuevo, esta vez bien, ya con internet — sesión real creada
  (`b61ebb84...`).
- El poll periódico de `CajaContext.fetchCurrentSession` (corre cada 30s) — estando offline, sin
  poder reconfirmar la sesión real por red — "resucitó" la apertura vieja abandonada de Dexie y
  **pisó la sesión real en memoria**. Las siguientes 4 ventas que cobró (offline, reales, ~$160.000
  entre las 4) quedaron encoladas contra una sesión que el servidor no reconocía, sin forma de
  sincronizar solas nunca — un callejón sin salida.
- **Nada se perdió ni se duplicó**: esas 4 ventas nunca llegaron al servidor (0 riesgo de stock/
  plata mal contados), sólo quedaron atascadas del lado del cliente. La 5ta venta de la prueba (la
  primera que hizo, antes de que esto pasara) sí había sincronizado bien — confirmado directo
  contra la base (`comprobantes`, numeración real `20260806-001`).

**Arreglo (ver sección detallada más abajo):** nueva función `reconciliarAperturasViejas()` — en
vez de dejar un conflicto de apertura muerto, lo resuelve contra la sesión que efectivamente ganó
(reasigna las ventas dependientes también). Se llama desde 3 lugares: `useSyncEngine` (cuando el
servidor devuelve `conflict:true` al sincronizar), y `CajaContext` (`openSession` online y
`fetchCurrentSession` al confirmar una sesión real) — más un guard nuevo para que el poll
periódico offline nunca vuelva a pisar una sesión real ya confirmada con un dato viejo de Dexie.
21 tests nuevos, 132/132 en verde, 0 errores de lint/build. **Deployado — las 4 ventas de Nadia
deberían terminar de sincronizar solas la próxima vez que la app haga el poll (máximo 30s) con
ella conectada, sin que tenga que hacer nada.**

**✅ Nuevo: Multi-caja simultánea.** El Modo Caja ya soporta 2+ puntos de cobro físicos abiertos
al mismo tiempo (cada cajero elige con cuál trabaja al entrar, se recuerda por dispositivo). Plan
completo y resultado de la verificación en vivo: `PLAN_MULTI_CAJA.md`. Resumen: la base de datos
ya soportaba esto de fábrica (índice único por caja, no por empresa) — el trabajo fue sacar el
cuello de botella del frontend (`resolveActiveCaja` siempre traía la caja más vieja), agregar el
selector, un badge para cambiar de caja (deshabilitado con turno abierto), un CRUD de cajas nuevo
en Configuración → Finanzas, y cerrar un gap de seguridad menor en `abrir_caja_sesion` (mig.311,
no validaba que la caja fuera de la empresa del caller). Probado en vivo: 2 sesiones simultáneas
sin pisarse, conflicto manejado en la tercera, bloqueo de desactivar una caja con turno abierto,
y el hardening de seguridad rechazando una caja de otro tenant — todo revertido después, Nalux
quedó con 1 sola caja como antes. 123/123 tests, 0 errores de lint/build. **07/08: Nadia lo
corrió también con sus propios ojos (Bloque 3) — 2 cajas simultáneas, tooltip, arqueos
perfectos. 100% cerrado.**

**Modo Offline del POS — las 4 fases del plan están hechas y con tests en verde.**
**07/08: las 3 verificaciones que sólo se podían hacer con dispositivos/red reales quedaron
cerradas** (carrera de stock el 06/08, sesión vieja + reconexión intermitente hoy) — salvo un
escenario puntual sin forma de armarlo hoy, ver la lista al final de esta sección.

- ✅ **Fase 0** (backend) — idempotencia en `crear_venta` + `abrir_caja_sesion`, mig.309/310.
- ✅ **Fase 1** (Nadia, 05/08) — PWA instalable + detección de conectividad.
- ✅ **Fase 2** (Nadia, 05/08) — snapshot local (Dexie) de productos/clientes/formas de
  pago/centros de costo/datos de empresa.
- ✅ **Fase 3** (Nadia, 05/08) — cola de ventas offline (Efectivo/Transferencia) + motor de
  sincronización. **Ya se puede cobrar sin conexión de verdad**, no sólo navegar el catálogo.
  Ver sección detallada más abajo.

**✅ Resuelto (06/08): "ping activo" en `useOnlineStatus`.** El plan original pedía sumar un
ping liviano a Supabase además de `navigator.onLine`, porque ese último da falso positivo con
wifi conectado a un router sin salida real a internet. Implementado: `HEAD` a
`{SUPABASE_URL}/rest/v1/` cada 20s (timeout 4s) mientras `navigator.onLine` es `true`;
`isOnline` final = `navOnline && pingOk`. 8/8 tests nuevos en verde. Commit `ce56092`.

**✅ Resuelto (06/08): carrera de stock con 2 ventas concurrentes, contra producción real.**
Ver sección detallada más abajo — una ganó, la otra falló limpio con "Stock insuficiente",
sin negativos ni duplicados. Todo el dato de prueba revertido.

**✅ Ya verificado hoy (07/08) por Nadia, en vivo contra producción** (ver el resumen de los 3
bloques al principio de esta sección): JWT viejo reconectando, conexión entrando y saliendo
varias veces, y multi-caja con sus propios ojos.

**Lo único que sigue sin poder verificarse:**
1. Escenario A del Bloque 2 (wifi "conectado" a un router sin salida real a internet) — Nadia no
   tenía forma de armar esa red hoy. No es grave (el "ping activo" que lo cubre ya está andando y
   probado con mocks, `useOnlineStatus.test.js`), pero quedó sin el check contra un caso real.
   Retomar si en algún momento hay a mano un router que se pueda apagar sin perder el wifi.

Plan de pruebas usado hoy, con el detalle completo de cada bloque: `PLAN_PRUEBAS_NADIA_2026-08-06.md`.

### 📌 Fidelización por puntos — las 4 fases completas (07/08), en POS y ERP

Investigación + plan de 4 fases ya armados (`INVESTIGACION_FIDELIZACION_PUNTOS.md` /
`PLAN_FIDELIZACION_PUNTOS.md`), decisiones de negocio tomadas por Nadia, **Fase 0 (backend)
aplicada y probada en vivo (mig.312)**, **Fase 1 (Configuración: toggle + ratios en Finanzas)
probada en vivo por Nadia** (activó, cargó 100/1, guardó, recargó, quedó igual — activa en Nalux
ahora mismo) y **Fase 2 (Ganar puntos, visible) probada en vivo por Nadia** — el saldo se ve en
el drill-down del cliente (POS y ERP) y cada venta avisa "+N puntos" en el momento (encontró y ya
se arreglaron 3 bugs de UI de paso, ver detalle arriba).

**Fase 3 (Canjear puntos) construida y probada en vivo por Nadia en el POS** —
`PanelCarrito.jsx`: card "Canjear puntos" cerca del total, sólo con conexión + fidelización
activa + cliente con saldo, clampeada en vivo al saldo disponible y a no dejar el total negativo.
Redención **no soportada offline** a propósito (necesita el saldo real del servidor). Ticket/
modal de venta muestran "Descuento por puntos (N)".

**🐛 Otro "Confirmar Venta cortado", encontrado y arreglado en vivo (07/08):** el fix anterior
(`min-h-0`) no alcanzaba con carritos con oferta automática (2 líneas extra: Subtotal/Ahorro).
Causa real: el propio `<div>` raíz de `PanelCarrito.jsx` tenía `flex-shrink-0` — clase pensada
para el ANCHO, pero como ese div vive dentro de un wrapper `flex-col` que ya fija el ancho por
su cuenta, `flex-shrink-0` terminaba aplicando a la ALTURA y anulaba el `min-h-0`. Fix: sacar esa
clase (el ancho ya lo controla el wrapper). Verificado en vivo: con Batidora Eléctrica (dispara
oferta) en un viewport de 638px, el botón pasó de cortarse 24px por debajo a quedar completo.

**🐛 BUG real de fondo, encontrado revisando el mecanismo con más cuidado (no cosmético):** el
asiento contable automático no se enteraba del descuento por puntos — `crear_venta` calcula
`neto_gravado`/`iva_discriminado` sumando los ítems, sin saber nada de `p_total`. El asiento
quedaba desbalanceado por el monto exacto del canje, y una eventual factura AFIP con
fidelización activa reportaría el monto bruto, distinto al cobrado. **Decisión de Nadia:**
repartir el descuento proporcionalmente entre los productos de la venta — mismo criterio fiscal
que ya usan las ofertas automáticas, así el IVA queda sobre lo que el cliente realmente pagó.
Arreglado en `useConfirmarVenta.js` (POS) antes de replicar el mismo patrón en el ERP, para no
duplicar el problema.

**Fase 3 también construida en el ERP (`NuevaVentaModal.jsx`)** — mismo circuito, ya con el fix
del reparto proporcional incluido desde el vínculo. Diferencias: el selector de cliente ahí es
un `<select>` simple en `PanelPago.jsx` (no el componente compartido del POS); `calculateTotal()`
(la única función de total del archivo, usada en ~6 lugares) pasó a devolver el neto del canje,
lo que corrigió automáticamente todos sus usos de una vez; sin modo offline (no aplica el guard).

Suite completa **153/153 en verde**, `eslint`/`vite build` en 0 errores en las dos pantallas.

**Probado en vivo por Nadia en el ERP (10/08).** Encontrado en el camino: `NuevaVentaModal.jsx`
no tiene un botón de entrada directa — sólo se abre facturando un Pedido (avanzado hasta "En
Preparación") o convirtiendo una Cotización; "Nueva Venta" del header y de Acciones Rápidas
llevan al POS, y "Nueva Factura" abre un modal distinto sin canje. Una vez encontrado el camino
correcto (Pedidos → avanzar 2 veces → ícono de recibo "Facturar pedido"), probó el circuito
completo: comprobante 20260810-004, canjeó 200 puntos sobre "Mouse plano" ($5.000 → $4.800), el
PDF mostró "Descuento por puntos (200) -$200,00" y "¡Ganaste 48 puntos!" — todo correcto.

**Con esto, Fidelización por Puntos queda 100% cerrada** — las 4 fases (backend, configuración,
ganar puntos, canjear puntos) confirmadas en vivo por Nadia en los dos circuitos de venta
(POS y ERP). No queda nada pendiente de este feature.

---

## ✅ Modo Offline del POS — Fase 0 (backend, idempotencia) — mig.309/310

Primera fase del plan de modo offline del POS (plan completo en
`PLAN_MODO_OFFLINE_POS.md`). El POS podrá seguir vendiendo en
**Efectivo y Transferencia** sin internet — Tarjeta/QR MP/Cuenta Corriente quedan
bloqueados porque necesitan hablar con un tercero (banco/MP) en el momento.
CAEA (recién resuelto) **no** resuelve este problema — es para cuando ARCA está
caído pero el servidor de KAIROX sigue con internet, un caso distinto.

**mig.309** — `crear_venta` gana `p_client_uuid uuid DEFAULT NULL` (patrón
DROP+CREATE, no `CREATE OR REPLACE`, para no repetir el overload huérfano de
mig.264/308). Con `client_uuid`, un `pg_advisory_xact_lock` serializa reintentos
antes de tocar stock — si ya existe una venta con ese `client_uuid`, devuelve el
resultado existente (`duplicate:true`) sin descontar stock de nuevo. Sin
`client_uuid` (NULL), comportamiento idéntico al de siempre — cero cambio para
el ERP y el POS online.

**mig.310** — nueva RPC `abrir_caja_sesion` (reemplaza el INSERT directo que
hace `CajaContext.openSession`), mismo patrón de idempotencia + maneja el
choque contra `uq_caja_sesion_abierta` (dos aperturas casi simultáneas — una
offline, una online) devolviendo `{conflict:true, ...la sesión que ganó}` en vez
de dejar pasar el error crudo de Postgres.

Ambas funciones nuevas: `REVOKE ALL FROM PUBLIC` + `GRANT authenticated`
explícito — una función nueva por defecto le da EXECUTE a PUBLIC (mismo agujero
que Nadia cerró en mig.304/305 para las funciones viejas; acá se evita desde el
origen).

**Probado en vivo contra producción (Nalux), vía fetch con JWT real desde el
navegador:**
- `crear_venta` con `client_uuid` dos veces → 1ra `duplicate:false` (crea la
  venta), 2da `duplicate:true` (mismo `comprobante_id`, mismo `numero_venta`) —
  verificado en la base: 1 sola fila en `comprobantes`/`movimientos_caja`/
  `movimientos_inventario`, stock descontado una sola vez.
- `abrir_caja_sesion`: apertura normal → reintento con mismo `client_uuid`
  (`duplicate:true`, mismo `sesion_id`) → apertura con `client_uuid` distinto
  mientras la primera sigue abierta (simula 2 dispositivos) → `conflict:true`
  con los datos de la sesión que ganó, sin error crudo.
- Todo revertido después: 0 comprobantes con `client_uuid` remanentes, stock y
  numeración devueltos a como estaban, sesión de prueba borrada.

## ✅ Modo Offline del POS — Fase 1 (PWA instalable + detección de conectividad)

Segunda fase del plan. Sin tocar `crear_venta` ni ninguna cola offline todavía — sólo la base
para que el POS se pueda instalar como app y sepa si hay conexión.

**PWA instalable** — `vite-plugin-pwa@0.21.2` (pineado ahí porque es la última versión que
sigue soportando Vite 4; la serie 1.x ya pide Vite 5+). Configurado en `vite.config.js`:
- `manifest`: nombre/colores de KAIROX, íconos apuntando al logo existente
  (`public/kairox-logo.png`, 1254×1254 — se referencia igual en 192/512/512-maskable; no hay
  íconos redimensionados de verdad todavía, es cosmético, no bloquea la instalación).
- **A propósito, sin ningún `runtimeCaching`**: el `generateSW` default de workbox sólo
  precachea archivos del build (`**/*.{js,css,html,ico,png,svg,woff2}`) — ninguna llamada a
  Supabase pasa por el service worker ni se cachea. Verificado después del build: `dist/sw.js`
  tiene **0 menciones** de `supabase`/`rest/v1`/`auth/v1` (`grep -c` sobre el archivo generado).
  Cachear datos/ventas es la Fase 2+, no ésta.
- `devOptions.enabled` queda en su default (`false`): el SW no se registra corriendo
  `npm run dev`, para no arrastrar assets viejos cacheados mientras se desarrolla.

**Detección de conectividad** — `useOnlineStatus()` (`src/hooks/useOnlineStatus.js`):
`navigator.onLine` + los eventos `online`/`offline` del browser. Límite conocido y aceptado a
propósito: `navigator.onLine` sólo dice si hay una interfaz de red activa, no si hay salida
real a internet ni si Supabase específicamente es alcanzable (wifi conectado a un router sin
internet reporta `true`) — un chequeo real (ping a la API) es de una fase posterior.

**Badge en el POS** — `ModoCajaLayout.jsx` muestra "Sin conexión" en la topbar (mismo estilo
que los badges de Caja/PdV que ya existían) sólo cuando `isOnline === false`; oculto el resto
del tiempo para no sumar ruido. Por ahora es sólo un aviso — no bloquea ni habilita nada
todavía, eso llega con la cola offline real.

**Probado:**
- Build: `PWA v0.21.2, mode generateSW, precache 72 entries (5603.23 KiB)` — genera
  `dist/sw.js`, `dist/workbox-*.js`, `dist/manifest.webmanifest` correctamente, con los íconos
  y colores esperados.
- **No se pudo probar clickeando en el navegador real** (requiere estar logueada, y no se
  ingresan credenciales por política) — se verificó en cambio con un **test automatizado**
  nuevo, `src/hooks/__tests__/useOnlineStatus.test.js` (5 casos: arranca reflejando
  `navigator.onLine`, reacciona a `offline`→`online`, limpia el listener al desmontar). 33/33
  tests del proyecto en verde (28 preexistentes + 5 nuevos).
- `npx eslint`: 0 errores. `npx vite build`: ✓.

## ✅ Modo Offline del POS — Fase 2 (snapshot local read-only, Dexie)

Tercera fase del plan (`PLAN_MODO_OFFLINE_POS.md`). Todavía **no se puede cobrar sin
conexión** — eso es la Fase 3. Esta fase sólo hace que el catálogo/clientes/formas de pago
sigan siendo buscables si se corta la red, en vez de que el POS se quede con paneles vacíos.

**Nuevo `src/lib/offlineDb.js`** — base local (IndexedDB vía Dexie) con 5 tablas:
`productos`, `clientes`, `formasPago`, `centrosCosto`, `empresaMeta`. Todas indexadas por
`empresa_id` — mismo aislamiento multi-tenant que en el backend, replicado acá porque el
snapshot vive en el dispositivo del cajero. `guardarSnapshot(tabla, empresaId, filas)` borra
primero todo lo de esa empresa en esa tabla y recién ahí inserta lo nuevo (reemplazo completo,
no acumula productos dados de baja o renombrados). `empresaMeta` es un registro único por
empresa (logo/nombre/CUIT/dirección para el encabezado del ticket), no una lista.

**Nuevo `src/hooks/useProductosSnapshot.js`** — mientras hay conexión, refresca en Dexie
**todos** los productos activos de la empresa (a diferencia de `PanelProductos`, que sólo trae
los primeros 200 que matchean la búsqueda — el snapshot necesita el catálogo completo porque no
sabe de antemano qué va a buscar el cajero sin red). Expone `buscarOffline(query)` (filtra por
nombre/SKU) y `buscarPorCodigoBarras(codigo)` para el flujo de escaneo.

**Modificados** (mismo patrón en los 3: `if (!isOnline) { leer de Dexie; return }` antes del
fetch a Supabase, y el fetch online guarda su resultado en Dexie al final):
- `PanelProductos.jsx` — búsqueda por nombre/SKU y por código de barras (Enter en el
  buscador) caen al snapshot sin red. Aviso visual bajo el buscador: "Sin conexión — mostrando
  catálogo guardado, puede estar desactualizado" (el stock que se ve puede no reflejar ventas
  hechas en otro dispositivo desde el último refresco — se avisa, no se oculta el riesgo).
- `ModoCajaLayout.jsx` — logo/nombre/datos de empresa (para el ticket) y formas de pago activas.
- `PanelCarrito.jsx` — clientes y centros de costo.

**Por qué el enfoque es "cae a Dexie si `!isOnline`" y no "intentá Supabase y si falla, Dexie"**:
más simple y predecible — evita que el cajero espere un timeout de red colgado antes de ver el
fallback. Contrapartida conocida (mismo gap que ya estaba documentado en la Fase 1): si
`navigator.onLine` da un falso positivo (wifi sin salida real a internet), el POS va a intentar
Supabase igual y el cajero va a esperar el timeout. Ver nota sobre el "ping activo" pendiente en
el bloque "EMPEZÁ POR ACÁ".

**Instalado:** `dexie@^4.4.4`, `dexie-react-hooks@^1.1.7` (no se terminó usando `useLiveQuery`
de esta última en esta fase — el snapshot no necesita reactividad entre pestañas todavía; queda
disponible para cuando la Fase 3 sí la necesite). También `fake-indexeddb` (sólo devDependency
de test: jsdom, el entorno de Vitest, no implementa IndexedDB — sin este shim los tests que
tocan `offlineDb.js` tiran error al abrir la base). Verificado con `npm audit`: **0
vulnerabilidades nuevas** — sigue en 13 (6 moderate, 5 high, 2 critical), todas preexistentes
(jspdf, xlsx, vite, vitest, undici, brace-expansion), ninguna de los 3 paquetes agregados.

**Probado:**
- Tests nuevos: `src/lib/__tests__/offlineDb.test.js` (6 casos — guardar/leer, aislamiento
  entre empresas, que un refresco reemplaza el snapshot viejo en vez de acumularlo, lista vacía,
  `empresaMeta`, `null`/`undefined` no explotan) y
  `src/hooks/__tests__/useProductosSnapshot.test.js` (4 casos — refresca online, un error de
  Supabase no borra lo que ya había, offline no llama a Supabase y busca por nombre/SKU/código
  de barras desde el snapshot, sin `empresa_id` no explota).
- Suite completa: **43/43 tests en verde** (33 preexistentes + 10 nuevos).
- `npx eslint`: 0 errores (sólo warnings preexistentes de `react/prop-types`, ya estaban en
  todo el proyecto — nunca se usa PropTypes acá).
- `npx vite build`: ✓ en 5m 9s, PWA con 72 entries precacheadas, sin regresión en el resto de
  los bundles.
- **No se pudo probar clickeando en el navegador real logueada** (misma limitación que la
  Fase 1 — no se ingresan credenciales por política). Se abrió igual el preview sin login para
  confirmar que la app carga sin errores de consola con las nuevas dependencias (Dexie, etc.)
  antes de la pantalla de login — 0 errores.

## ✅ Modo Offline del POS — Fase 3 (cola de ventas + sincronización) — YA SE PUEDE COBRAR OFFLINE

Última fase del plan (`PLAN_MODO_OFFLINE_POS.md`). A diferencia de las Fases 1/2 (que sólo
avisaban/permitían navegar), ésta es la que de verdad habilita cobrar sin conexión —
**Efectivo y Transferencia únicamente** (por `tipo_instrumento`, mig.214 — Tarjeta/QR
MercadoPago/Cuenta Corriente necesitan hablar con un tercero en el momento y quedan
deshabilitados con tooltip "Necesita conexión a internet").

Es la fase de mayor riesgo real de todo el feature: toca el camino que genera cada venta y
mueve stock/caja. El diseño mantiene el camino **online exactamente igual que antes** (mismas
RPC, mismo orden) y agrega el camino offline como una rama nueva — verificado con tests que
comparan explícitamente que el camino online no cambió de comportamiento.

**Datos locales nuevos (`offlineDb.js` → `version(2)`):**
- `ventasPendientes` — cada venta encolada: `client_uuid` (dedupe real), `numero_provisorio`
  (etiqueta tipo `OFFLINE-123456`, sólo visual — el número fiscal real recién se asigna al
  sincronizar, porque `obtener_proximo_numero` necesita red), `payload` (los mismos `p_*` que
  siempre recibió `crear_venta`, menos `p_numero_venta`), `itemsSnapshot`, `cliente_condicion_iva`
  (para el post-proceso de AFIP), `caja_sesion_id`/`caja_sesion_client_uuid` (según si la sesión
  de caja ya tenía id real o también está encolada), y `estado`: `pendiente` → `sincronizada` |
  `conflicto`.
- `cajaSesionesPendientes` — mismo patrón para una apertura de caja hecha sin conexión.
- Nuevo `medioPagoDisponibleOffline(nombre, formasPago)` — decide por `tipo_instrumento`
  (`efectivo`/`transferencia` = sí, todo lo demás no), **no por el nombre** de la forma de pago
  (que cada empresa puede editar). 'Cuenta Corriente' no tiene fila en `formas_pago` (es una
  modalidad de venta a crédito, no un instrumento) y siempre está bloqueada.

**`useVentaOfflineQueue.js`** — envoltorio reactivo (`dexie-react-hooks`) sobre la cola, usado
por el badge de la topbar y por `useArqueoCaja`.

**`useSyncEngine.js`** — corre apenas hay conexión (al montar si ya arranca online, o en la
transición offline→online), con un lock (`isSyncing`) para no correr dos veces en paralelo:
1. Sincroniza `cajaSesionesPendientes` primero (viejo→nuevo) vía `abrir_caja_sesion` — antes que
   las ventas, porque una venta encolada puede depender de una sesión que todavía no tenía id
   real. Si el servidor devuelve `conflict:true` (otra caja ya abrió), esa apertura queda marcada
   para resolución manual — **no** tiene un "anular" seguro (ver limitación abajo).
2. Sincroniza `ventasPendientes` (viejo→nuevo — importa para la numeración fiscal correlativa),
   resolviendo `caja_sesion_id` real si dependía de una apertura recién sincronizada **o de una
   sincronizada en una corrida anterior** (reconexión intermitente — verificado con test
   específico). Llama `obtener_proximo_numero` recién acá (ya hay red) y después `crear_venta`
   con el `client_uuid`.
   - Éxito → guarda el `numero_venta`/`comprobante_id` reales, corre
     `finalizarVentaPosterior` (asiento contable + encolado a ARCA).
   - **Guard importante**: si el resultado es `duplicate:true` (la venta ya se había
     sincronizado en un intento anterior y sólo faltaba marcarla local), **no** se vuelve a
     llamar `finalizarVentaPosterior` — evita un asiento contable duplicado en un reintento.
   - Error (ej. stock insuficiente re-validado por el servidor) → esa venta puntual queda
     `conflicto` y **la cola sigue con las siguientes**, no se frena entera.

**Refactor en `useConfirmarVenta.js`**: el post-proceso de una venta exitosa (asiento contable +
encolado a ARCA) se sacó a un hook propio, **`useFinalizarVentaPosterior.js`**, para que lo
llamen tanto el camino online (sin cambios) como `useSyncEngine` después de sincronizar una
venta offline — sin duplicar esa lógica en dos lugares. Rama nueva en `confirmar()`: si no hay
conexión y todos los pagos son Efectivo/Transferencia, encola en vez de llamar al servidor,
decrementa el stock del snapshot local (Fase 2) de forma optimista (sólo para que el mismo
dispositivo no se sobre-venda a sí mismo entre varias ventas encoladas — la validación real es
la del servidor al sincronizar), y devuelve un comprobante con `numero_venta` provisorio +
`_offline: true`.

**`CajaContext.jsx`**: `openSession` ahora usa la RPC `abrir_caja_sesion` (mig.310) en el camino
online — antes hacía un INSERT directo (pendiente señalado desde la Fase 0). Sin conexión,
encola la apertura y arma una sesión "local" (`_pendingSync: true`, sin `id` real, con
`client_uuid`) contra la que ya se puede vender. `fetchCurrentSession` recupera esa sesión
pendiente desde Dexie si se recarga la página offline a mitad de turno (si no, se "perdería" la
caja abierta y el cajero terminaría abriendo una segunda por error). `closeSession` se bloquea
con un toast si hay ventas o aperturas sin sincronizar.

**UI**: `PanelCarrito.jsx` deshabilita Tarjeta/QR/CC offline con tooltip (atajo `Alt+1..4`
respeta el mismo guard); `SyncStatusPanel.jsx` (badge "N sin sincronizar" en la topbar, oculto
si no hay nada pendiente) + `SyncConflictModal.jsx` (detalle, botón "Reintentar ahora", "Anular
venta" en conflictos — revierte sólo el stock local, la venta nunca tocó stock real);
`TicketPrint.jsx` muestra "PROVISORIO — pendiente de sincronizar"; el modal de éxito post-venta
también avisa cuando el comprobante es offline; `useArqueoCaja.js` suma una línea informativa
(`pendienteSyncEfectivo`/`Transferencia`) separada del `esperado` (que sigue siendo 100%
verdad-servidor).

**Limitación conocida, no resuelta a propósito (edge case raro):** si la apertura de caja
offline de un dispositivo entra en conflicto con la de otro (ambos abrieron la misma caja
física casi al mismo tiempo), no hay un "anular" seguro para esa apertura ni para las ventas que
dependan de ella — quedan pendientes de resolución manual. El propio plan marca las carreras
multi-dispositivo como algo que necesita probarse con hardware real, no simulable acá.

**Probado (automatizado, Vitest + mocks de Supabase):**
- 24 tests nuevos en `offlineDb.test.js` (cola, `medioPagoDisponibleOffline`, stock local).
- `useVentaOfflineQueue.test.js` (5), `useSyncEngine.test.js` (11 — éxito simple, `duplicate`
  no duplica el asiento, conflicto no frena la cola, orden cronológico, apertura antes que
  ventas, apertura sincronizada en una corrida anterior resuelve una venta nueva, apertura en
  conflicto no vende, lock anti-concurrencia), `useConfirmarVenta.test.js` (9 — camino online
  intacto + rama offline), `useFinalizarVentaPosterior.test.js` (6), `CajaContext.test.jsx` (7),
  `PanelCarrito.test.jsx` (5 — botones deshabilitados offline), `SyncStatusPanel.test.jsx` (5),
  `TicketPrint.test.jsx` (3), `useArqueoCaja.test.jsx` (5).
- Suite completa: **117/117 tests en verde** (43 previos de Fase 1/2 + 74 nuevos).
- `npx eslint`: 0 errores (sólo warnings preexistentes de `react/prop-types`).
- `npx vite build`: ✓ (ver resultado exacto al pie de esta sección).
- Nota técnica: se agregó `esbuild: { jsx: 'automatic' }` a `vitest.config.js` — sin eso,
  cualquier test que renderice un componente `.jsx` directamente (no sólo un hook) fallaba con
  "React is not defined" (ese archivo no usa el plugin de React que sí tiene `vite.config.js`).

**Lo que NO se pudo probar desde este entorno con mocks (honesto, no se va a fingir) — son
justo los puntos que el propio plan marca como los más exigentes de verificar:**
1. ~~**Carrera de stock con 2 dispositivos offline** vendiendo el mismo último ítem~~ — ✅
   **resuelto el 06/08, ver sección "Carrera de stock" más abajo.** No hacía falta 2
   dispositivos reales: se disparó `Promise.all` con 2 llamadas directas a la RPC `crear_venta`
   (mismo camino que usaría el motor de sync de cada dispositivo) contra un producto real puesto
   en `stock_actual=1`, con `client_uuid` distinto en cada una — eso alcanza para probar el lock
   del lado del servidor, que es la garantía real (el resto es orquestación en el cliente, ya
   cubierta por los tests de Nadia).
2. **JWT viejo (1+ hora offline) reconectando** sin pedir re-login — no se puede simular dejar
   una sesión colgada una hora real en este entorno.
3. **Red real degradada** (throttling, desconectar el adaptador físico) — el entorno sólo puede
   emular `navigator.onLine`, no una red real intermitente.

Los 2 que quedan (JWT viejo, red real degradada) necesitan que Nadia/Luciano los prueben en vivo
con el POS instalado en un dispositivo real antes de confiar el 100% en el feature para un día
de mucho movimiento.

## 🐛 Bug real de producción — apertura offline abandonada varaba ventas (07/08)

Encontrado por Nadia corriendo el Bloque 1 de `PLAN_PRUEBAS_NADIA_2026-08-06.md`, con datos
reales de Nalux (no un test, plata de verdad). Reconstruido paso a paso, verificado contra la
base (`caja_sesiones`, `comprobantes`):

1. Con la notebook ya offline desde el arranque de esa pestaña (nunca había cargado `cajas` con
   internet todavía en esa sesión del navegador), intentó **"Abrir caja" sin conexión**. Quedó
   encolada en Dexie (`cajaSesionesPendientes`), pero ella no llegó a usarla — vio un error al
   intentar vender y asumió que no había funcionado.
2. Reconectó, **abrió la caja de nuevo** — esta vez sí, sesión real creada online
   (`b61ebb84-eefe-...`, `apertura_fecha` 2026-08-06 10:46 UTC, `client_uuid: null` — confirmado
   por SQL directo).
3. Desconectó otra vez y cobró **5 ventas offline** a lo largo de ~75 minutos (mezclando Efectivo
   y Transferencia — el badge "N sin sincronizar" fue subiendo bien 1→5, sin pisarse).
4. Reconectó. Sólo **1 de las 5 sincronizó** (la primera, $3.000 — confirmado en `comprobantes`,
   numeración real `20260806-001`). Las otras 4 quedaron "Esperando conexión" para siempre, y el
   panel mostró la apertura del paso 1 como **"Conflicto — Ya había otra caja abierta al
   sincronizar"**.

**Causa raíz:** `CajaContext.fetchCurrentSession` corre cada 30s (`setInterval`) para revisar si
hay una sesión real abierta. Estando offline, esa consulta a `caja_sesiones` no puede llegar al
servidor — pero el código, al no encontrar respuesta, caía a un fallback pensado para otro caso
("recargué la página offline, recuperá lo que había en Dexie") y **restauraba la apertura vieja
abandonada del paso 1 como si fuera la sesión actual**, pisando la sesión real del paso 2 que
seguía en memoria. Las ventas del paso 3, cobradas después de ese pisado, quedaron con la
apertura vieja como referencia — y como esa apertura nunca iba a tener un id real (el servidor
correctamente la rechaza porque ya hay otra sesión abierta para esa caja), no tenían forma de
sincronizar solas nunca. Un callejón sin salida real, no cosmético.

**Impacto real:** ninguno en datos — las 4 ventas nunca llegaron al servidor (0 stock/plata mal
contados, 0 duplicados). Sólo quedaron atascadas del lado del navegador de Nadia hasta que se
arregló el código.

**Arreglo — `reconciliarAperturasViejas(empresaId, cajaId, sesionRealId)` (`offlineDb.js`):** en
vez de dejar un conflicto de apertura como callejón sin salida, lo resuelve contra la sesión que
efectivamente ganó — al cajero le da lo mismo bajo qué número haya quedado la caja realmente
abierta, sólo quiere que su venta entre. Reasigna también cualquier venta que dependiera del
`client_uuid` de la apertura vieja. Se llama desde:
- **`useSyncEngine.sincronizarAperturas`** — cuando el servidor devuelve `conflict:true` al
  sincronizar, en vez de sólo `marcarAperturaConflicto`.
- **`CajaContext.openSession`** (camino online, éxito) — por si había una apertura vieja de la
  misma caja esperando.
- **`CajaContext.fetchCurrentSession`** — apenas confirma una sesión real, reconcilia cualquier
  apertura vieja de esa caja antes de que el poll periódico tenga chance de toparse con ella.

**Guard nuevo en `fetchCurrentSession`:** si ya había una sesión real (no `_pendingSync`)
confirmada en memoria, y la consulta no trae nada nuevo (típico estando offline — la llamada de
red directamente no llega), **ya no cae al fallback de Dexie** — lo deja como estaba. El fallback
de recuperación original (mount en frío offline con una apertura pendiente en Dexie) se probó
aparte con una contraprueba, sigue funcionando igual que antes.

**Probado:** 21 tests nuevos (`offlineDb.test.js` +7, `useSyncEngine.test.js` reescribe el caso
de conflicto, `CajaContext.test.jsx` +3 — incluye la reproducción exacta del bug con mocks, y la
contraprueba de que el mount en frío offline sigue andando). Suite completa: **132/132 en verde**.
`npx eslint`: 0 errores. `npx vite build`: ✓. Deployado.

**Para Nadia — no hace falta que hagas nada:** la próxima vez que la app haga el poll automático
(máximo 30 segundos, ya conectada) debería reconciliar las 4 ventas stranded solas. Si en un par
de minutos el óvalo "sin sincronizar" no bajó a 0, avisá — ahí sí reviso a mano contra la base.

## ✅ Carrera de stock — verificado en vivo contra producción (06/08)

Prueba real, no mock: 2 llamadas concurrentes (`Promise.all`) a la RPC `crear_venta` vía
`fetch` con JWT real de Nalux, cada una con `client_uuid` distinto, compitiendo por la última
unidad de un producto de prueba (`Aramis TESTE Azul marino`, bajado a propósito de
`stock_actual=5849` a `1` para el test).

**Resultado:**
- Venta A → `200 OK`, `duplicate:false`, crea el comprobante y descuenta el stock a `0`.
- Venta B → `400`, `"Stock insuficiente para producto ... (disponible: 0, requerido: 1)"` — el
  `SELECT ... FOR UPDATE` sobre `productos.stock_actual` (mig.309) serializó las dos llamadas:
  la segunda vio el stock ya en `0` y abortó toda su transacción, sin error crudo de Postgres,
  sin stock negativo, sin comprobante duplicado.

**Todo el dato de prueba revertido después:** `stock_actual` de vuelta en `5849`, comprobante +
ítems + movimiento de caja + movimiento de inventario + entrega + ítem de entrega borrados,
`series_numeracion` de `entrega` devuelta de `112` a `111` (la venta usó un `numero_venta` de
prueba fijo, no consumió la serie fiscal real de ventas — sólo la de entregas, por el
`obtener_proximo_numero(..., 'entrega')` interno de `crear_venta`).

Esta es la validación que de verdad importa para el modo offline: confirma que aunque 2 cajas
físicas sincronicen al mismo tiempo por el mismo último ítem, el servidor nunca deja pasar una
sobreventa silenciosa — la segunda cae en conflicto manejado, que es exactamente el
comportamiento que `SyncConflictModal.jsx` está preparado para mostrarle al cajero.

## ✅ Barrido final del backlog del 04-05/08 — 3 ítems cerrados

- **mig.308** aplicada a producción y pusheada — elimina el overload huérfano de 8 args de
  `crear_nota_credito` (ver sección más abajo).
- **Tienda MP huérfana borrada.** Se confirmó con la API de MP (`GET /users/{id}/stores/search`)
  que había exactamente 2 tiendas en la cuenta de Nalux: `85561798` (la que usa el sistema hoy) y
  `85563668` (huérfana del primer intento fallido del 01/08, antes de descubrir que `external_id`
  no podía tener guiones — nunca tuvo una caja/POS asociada). Se borró la huérfana con
  `DELETE /users/{id}/stores/{store_id}` — verificado, queda solo 1 tienda.
- **Criterio fiscal unificado (mig.293-296): revisado, sin nada suelto.** La sección "Alcance NO
  cubierto" de mig.295 quedó explícitamente resuelta en mig.296 (numeración de NC/ND por PdV). No
  hay ningún cabo suelto de ese trabajo.

## ✅ Trámite del PdV CAEA en AFIP — RESUELTO, desbloquea la contingencia automática

ARCA confirmó el alta del PdV **2** para CAEA en la empresa de pruebas "CAEA Test" (CUIT
`20393249006`, homologación). Esto era el único bloqueante documentado en `CAEA_IMPLEMENTACION.md`
para la contingencia automática del `arca-worker` (`intentarCaeaContingencia`, repo-only desde
migration 225). Se corrigió `empresas.afip_pv_numero` de `1` (placeholder viejo) a `2` (el PdV real
que AFIP asignó) para esa empresa. Detalle completo en `CAEA_IMPLEMENTACION.md`.

**Sigue sin poder probarse en vivo hoy:** la ventana de solicitud de CAEA por quincena recién abre
el **12/08** (2da quincena de agosto) — antes de esa fecha AFIP devuelve error 15008. Cuando se abra
la ventana: 1) probar "Solicitar CAEA" manual desde `ConfiguracionSection` con la empresa CAEA Test,
2) si funciona, desplegar la contingencia automática del `arca-worker` (repo-only hoy).

## ✅ mig.308 — corrección: esta nota había quedado desactualizada, SÍ está aplicada

Esta sección decía "NO aplicada a prod todavía, pendiente de confirmación" — quedó así de un
borrador anterior a que Luciano la aplicara. **Verificado hoy directamente contra la base**
(`list_migrations`): `308_drop_overload_huerfano_crear_nota_credito` figura aplicada
(`20260805015310`), consistente con la sección "Barrido final del backlog" más abajo, que sí
decía "aplicada y pusheada". No hace falta ninguna acción — era sólo un cabo suelto de
redacción, no un problema real.

`DROP FUNCTION` del overload de 8 args de `crear_nota_credito` (deuda técnica anotada desde mig.264).
Confirmado en sandbox (`BEGIN...ROLLBACK`) que el drop no rompe nada — sin callers en `src/` ni en
`supabase/functions/` (el único caller, `NuevaNCModal.jsx`, siempre manda `p_referencia_cliente`/
`p_punto_venta_id`, así que Postgres ya resolvía siempre a la versión de 10 args). Hallazgo nuevo: no
era solo deuda cosmética — `authenticated` todavía tenía `EXECUTE` sobre la versión vieja, que no
revierte COGS en devoluciones (mig.288) ni respeta el punto de venta (mig.294-296).

## 🔴 Secreto de firma de MP — Luciano lo actualizó, PERO sigue fallando (dato nuevo)

Luciano entró al panel (`panel.mercadopago.com.ar` → kairox-gestion → Webhooks → Configurar
notificaciones → Modo productivo) y confirmó: evento marcado **"Pagos (legacy)"** ✓, URL configurada
coincide exacto con la que usamos ✓. Copió la "Clave secreta" que muestra esa pantalla y se actualizó
en `integraciones_bancarias.config.webhook_secret` de Nalux.

**Se probó en vivo con un pago real de $2 (venta `20260804-010`):** el webhook (`type=payment&data.id=...`)
**siguió devolviendo 401** — tres reintentos, mismos que antes. El pago se confirmó igual, pero por
`mp-qr-poller` (~70s), no por el webhook. Esto **descarta la hipótesis de "secreto desactualizado"**:
ya se probó con el valor que el panel muestra HOY para el evento "Pagos (legacy)" en modo productivo,
y tampoco coincide. Puede ser que ese evento/legacy use un esquema de firma distinto al que documenta
MP para webhooks v2, o que exista otro secreto en otro lugar del panel no explorado todavía.
**No es urgente resolverlo** — `mp-qr-poller` ya cubre el 100% de los casos con ~60-70s de latencia.
Si se retoma, la próxima pista a seguir sería contactar al soporte de MP directamente, ya que se
descartaron tanto el código (revisado línea por línea dos veces) como el secreto configurado.

---

# 👉 EMPEZÁ POR ACÁ (Luciano)

Nadia cerró la jornada del **04/08**. Todo lo que sigue está **aplicado, probado en vivo (incluido
un pago real) y pusheado** — no hay nada a medias ni ningún trabajo interrumpido.

### ⏰ Lo único con reloj corriendo — y sigue sin moverse

**El plan de Supabase de NALUX sigue en `free`.** Verificado de nuevo hoy 04/08 (no cambió desde
ayer). Los proyectos se restringen el **17/08/2026 — quedan 13 días**. Si se restringe, **se cae la
producción de todos los clientes**. Es billing, va por tu cuenta.

### 🔴 El secreto de firma de MP — tampoco se movió

Sigue bloqueando la confirmación automática del QR (aunque el QR **ya funciona igual**, ver abajo).
`webhook_secret` en la base sin tocar desde el **27/06** — mismo estado que ayer. Detalle completo y
la consulta para comparar el prefijo sin exponer el valor: sección **"PARA LUCIANO"** más abajo.

### 🔒 Un clic, gratis — sigue pendiente

**Supabase → Authentication → Policies → "Leaked password protection".** Lo puede hacer cualquiera
de los dos.

---

### ✅ Lo grande de hoy: QR MercadoPago queda 100% funcional, con y sin tu secreto

Se cerró la Fase 2 completa (modal en el POS, cancelar, expiración automática) **y** se agregó
`mp-qr-poller` — un worker que confirma los pagos consultando la API de MP directamente, sin
depender del webhook. Cuando rotes el secreto, las dos vías van a convivir sin problema (la RPC de
confirmación es idempotente). Mientras tanto, el cajero espera hasta ~60s en vez de nada.

**Se probó con un pago real de $5** (Nadia → tu cuenta de MP) — circuito completo: QR → pago →
confirmación por polling → asiento contable balanceado. Después, revisando el ticket impreso,
apareció un bug propio de hoy (no preexistente): el frontend nunca le mandaba el punto de venta ni
el tipo de comprobante a la función que crea el QR, así que **ninguna venta por QR se iba a encolar
a ARCA**, ni siquiera las del PdV fiscal real. Se corrigió y se verificó con una venta real (PdV 1,
`envia_arca=true`) que el circuito de facturación ahora sí queda bien armado — se canceló antes de
confirmarla para no pedir un CAE real de prueba, y se verificó el encolado a ARCA aparte con datos
100% sintéticos y aislados, borrados en segundos.

### ⚠️ Dos bugs que estaban vivos en producción antes de ayer, ya corregidos

Los menciono porque **no los habíamos detectado antes** y valen como contexto:

1. **No se podía dar de alta ninguna empresa nueva** (mig.301). Roto desde el **01/08** por la
   mig.295, que cambió un índice único plano por dos parciales sin actualizar el `ON CONFLICT` de
   `seed_series_numeracion`. Nadie lo notó porque no hubo altas en esa ventana.
2. **136 asientos contables reales estaban desvinculados de su venta/compra** (mig.303), deuda de la
   mig.281 que nunca corrió backfill. El botón "Regenerar asiento" decía *"no tiene asiento"* sobre
   registros que **sí lo tenían** — un clic habría **duplicado el asiento contable**. 0 duplicados
   verificados. Las RPCs quedaron blindadas para autorepararse en vez de duplicar.

### 📌 Trabajo de desarrollo que queda (nada urgente)

El resto (4 NC históricas → contador, overload huérfano de `crear_nota_credito`, `CbteAsoc` en CAEA,
dominio en Resend, 1-2 tiendas MP huérfanas) está en la tabla de **"Estado de pendientes"** más
abajo, todo sin urgencia y sin nada bloqueado por vos salvo lo de arriba.

**🚫 No construir sin pedido explícito:** MELI Factura A.

### 📊 Resumen acumulado de las últimas dos jornadas (03 y 04/08)

12 commits · 9 migraciones (299-307) aplicadas y probadas en vivo contra producción, incluido un
pago real · QR MercadoPago completo de punta a punta (backend + Fase 2 + poller) · advisors de
seguridad **99 → 85**, sin ningún hallazgo de nivel **ERROR** y sin ninguna función ejecutable por
`anon` · alta de empresas y 136 asientos desvinculados, corregidos · lint y build en 0 errores en
cada entrega · 2 worktrees fantasma eliminados (rescatando antes un fix que había quedado sin
commitear).

---

# ✅ QR MercadoPago Fase 2 — COMPLETA (mig.306/307) — 2026-08-04

El cobro por QR **ya funciona de punta a punta**, incluso con el webhook todavía roto.

### El hallazgo que cambió el diseño

`crear_venta_pendiente_qr` **descuenta stock** al generar el QR, y
`cancelar_venta_pendiente_qr` lo devuelve — pero esta última exige
`get_my_empresa_id()` + permiso de módulo, o sea que **sólo la puede llamar un cajero autenticado,
nunca un cron**. Sin barrido de expiración, cada cliente que se va del mostrador sin escanear
dejaría el stock descontado **para siempre**. No había pasado porque no existía UI que generara QRs
(0 pendientes en producción), pero publicar la Fase 2 sin esto habría abierto una fuga de stock real.

### Cómo se resolvió que el QR funcione sin el secreto de Luciano

`confirmar_pago_qr` (la que marca la venta pagada, genera el asiento y dispara AFIP) sólo la llamaba
`mp-webhook`, que viene rechazando las notificaciones de MP con 401. Se agregó **`mp-qr-poller`**:
consulta la API de MP directamente por cada QR pendiente y confirma los pagados. Es el mismo patrón
que `mp-sync-worker` ya usa con éxito para los movimientos bancarios.

**No reemplaza al webhook** — cuando el secreto se rote, ambos caminos conviven. Es seguro que
compitan porque `confirmar_pago_qr` lockea con `FOR UPDATE` y es **idempotente** (devuelve
`ya_procesado` sin tocar nada). Tener las dos vías es lo correcto igual: los webhooks se pierden.

### Piezas

- **mig.306** — la reversa (stock + entregas + comprobante) se **extrae a
  `_revertir_venta_qr_interno`**, compartida entre cancelar (cajero) y expirar (cron), para que no
  puedan divergir — mismo criterio que se usó con `useArqueoCaja`. Nueva `expirar_qrs_vencidos()`,
  service_role-only, con `FOR UPDATE SKIP LOCKED` (si el cajero está cancelando ese mismo QR, lo
  saltea en vez de bloquear el barrido) y recheck bajo lock para **nunca revertir una venta ya
  cobrada**.
- **`mp-qr-poller`** (edge function nueva, `verify_jwt=false` como los otros workers) — confirma
  pagos y corre el barrido de expiración.
- **mig.307** — cron cada minuto. **Sin clave embebida**: a diferencia de los crons anteriores
  (que hardcodean la anon key — hay un TODO al respecto en mig.109), éste no necesita header porque
  la función va con `verify_jwt=false`. Verificado con `curl` sin headers → `HTTP 200`.
- **Frontend** — `useCobroQR` (crear, pollear cada 3s, cancelar) + `ModalCobroQR` +
  bifurcación en `PanelCarrito.handleConfirmar`. El modal **no se cierra con Escape ni clickeando
  afuera** mientras espera: la venta ya existe con stock descontado, salir sin cancelar la dejaría
  colgada. El QR se bloquea en pago mixto (no se puede conciliar una parte pendiente con otra ya
  cobrada).

### Probado en vivo contra producción

Circuito real completo con `crear_venta_pendiente_qr` (no filas armadas a mano):
venta de 3 unidades → **stock 5850 → 5847** ✓ (confirma que el problema era real) → se fuerza el
vencimiento → `expirar_qrs_vencidos()` devuelve `{expirados: 1, unidades_devueltas: 3}` →
**stock de vuelta en 5850** ✓, comprobante `cancelada` ✓, QR `expirado` ✓, entrega anulada ✓,
movimiento de inventario con su rastro ✓. Todo limpiado después, numeración restaurada — verificado
en cero. Cron corriendo cada minuto, todas las corridas `succeeded`. Lint 0 errores, build ✓.

### ⚠️ Latencia conocida, y desaparece sola

Con el webhook caído, la confirmación la trae el cron **cada minuto** — el cajero puede esperar
hasta ~60s. El modal lo dice explícitamente en vez de quedarse mudo. **En cuanto Luciano rote el
`webhook_secret`, la confirmación vuelve a ser instantánea** y el poller queda sólo como respaldo.

### ✅ Probado con un pago real de $5 (Nadia → Luciano, MercadoPago) — 2026-08-04

Antes de la prueba se le asignó al POS el PdV 2 "Remito" (`envia_arca=false`), temporal, para no
emitir un CAE real e irreversible — mismo mecanismo de la mig.293. Se revirtió después.

**Resultado, verificado en la base:**
- Confirmación en **71 segundos** (19:44:50 → 19:46:01) — consistente con el cron de 60s, ya que el
  webhook sigue rechazando las notificaciones.
- `payment_id` de MP (`171160934391`) coincide exacto con la "Operación" que mostró la app del
  pagador.
- Comprobante `20260804-009`, `estado_pago='pagada'`, `cae_estado='no_aplica'` (no se encoló a ARCA,
  como correspondía con el PdV no fiscal) ✓
- `movimientos_caja`: ingreso $5, `estado_liquidacion='acreditado'` ✓
- Asiento **AS-000203**, balanceado $6,00 = $6,00 (incluye COGS): Debe Caja $5 + Debe Costo
  Mercaderías $1 / Haber Ventas $4,13 + Haber IVA Débito $0,87 + Haber Inventario $1 ✓

**Aclaración sobre la pantalla de MP:** la confirmación de pago en la app del pagador sólo muestra
monto y a quién le pagó ("Luciano Banegas") — no el título/número de venta que sí le mandamos a MP
al crear el QR (`mp-qr-crear` los incluye). Es un límite de esa pantalla de MP, no algo corregible
de nuestro lado. Pendiente de revisar: si el **ticket que imprime el POS** sí muestra bien el número
de venta.

**Limpieza:** asiento+ítems, movimiento de caja, entrega+ítems, movimiento de inventario (stock
devuelto), comprobante+ítems, QR, numeración revertida a 9, producto de prueba "Llavero Auto"
borrado, PdV del POS revertido a `NULL`. Verificado contra la foto de "antes" tomada al inicio —
**coincide número por número** en las 8 métricas comparadas (comprobantes, asientos, movimientos de
caja, QRs, cola ARCA, stock, numeración, PdV).

### 🔴→✅ Al revisar el ticket: el QR NUNCA se estaba encolando a ARCA — bug propio de hoy, corregido

Revisando por qué el ticket mostraba "CAE pendiente" en una venta que nunca iba a tener CAE, apareció
algo más grave: **`useCobroQR.js` nunca resolvía ni mandaba `punto_venta_id`/`tipo_comprobante_afip`**
a `mp-qr-crear` — quedaban siempre en `NULL`. La RPC (`crear_venta_pendiente_qr`) ya estaba preparada
para recibirlos y usarlos bien (numeración por PdV, columna en el comprobante); el gap era 100%
frontend. Consecuencia real: **ninguna venta por QR se iba a encolar a ARCA jamás, ni siquiera las
que pasaran por el PdV fiscal real de Nalux.** Bug introducido en la sesión de hoy (mig.306/307), no
preexistente — no llegó a afectar ninguna venta real: la única que hubo fue la de $5 de la prueba
(que además usó a propósito el PdV no fiscal), ya limpiada.

**Fix:** `useCobroQR` ahora llama `useAfipConfig('pos')` (mismo hook y mismo criterio que ya usa
`useConfirmarVenta` para las ventas normales) y resuelve `punto_venta_id` +
`determinarTipoComprobante(...)` (`null` si el PdV no envía a ARCA) antes de invocar `mp-qr-crear`.
De paso, `TicketPrint.jsx` ahora recibe `venta.cae_estado` y sólo muestra "CAE pendiente" cuando
corresponde — antes lo mostraba siempre que la empresa facturara electrónicamente, sin importar si
*ese* comprobante puntual iba a tener CAE alguna vez.

**Probado en vivo contra producción, con mucho cuidado de no pedir un CAE real por error:**
1. Venta real de $1.200 (Aramis TESTE) por QR desde el POS real → verificado en la base ANTES de
   confirmar nada: `punto_venta_id` = PdV 1 (el fiscal real, `envia_arca=true`), `tipo_comprobante_afip='C'`
   — **la resolución del PdV/tipo ya funciona correctamente**. Como confirmar esta venta real habría
   pedido un CAE real, se **canceló** desde el botón del modal antes de simular nada — verificado:
   stock de vuelta a 5850, 0 en cola ARCA, `cae_estado='no_aplica'`.
2. Para probar que `confirmar_pago_qr` sí encola a ARCA cuando el PdV es fiscal, sin arriesgar un CAE
   real: comprobante + QR **completamente sintéticos y aislados** (sin tocar stock/productos reales),
   confirmados vía la RPC real → `cae_estado` pasó a `'pendiente'` y apareció una fila real en
   `facturas_pendientes_arca` (tipo `C`) ✓ — confirma que el circuito completo funciona. Borrado
   **en segundos**, muy por debajo de la ventana de 5 minutos del cron de `arca-worker` — nunca hubo
   riesgo de que se llamara a la API real de ARCA.
3. Todo lo demás limpiado: el comprobante cancelado del navegador se borró entero (no se dejó como
   registro "cancelada" porque es 100% de prueba), numeración devuelta a 9, movimientos de inventario
   (salida + reversa) borrados. Verificado contra el estado de siempre: **coincide exacto** en las
   6 métricas comparadas.

`npx eslint`: 0 errores (75 warnings preexistentes de `react/prop-types`). `npx vite build`: ✓.

---

## ✅ `anon` ya no puede ejecutar NINGUNA función SECURITY DEFINER — mig.304/305

Cierra el último ítem abierto de la auditoría: los 10 WARN
`anon_security_definer_function_executable`. **Resultado: 10 → 0.**

**Por qué se hizo aunque ninguna era explotable hoy:** es defensa en profundidad. Las 10 ya se
defendían (8 con `get_my_empresa_id()`, que para `anon` devuelve NULL y dispara el guard; 1 es
función de trigger; 1 no toca datos de tenant). Pero mientras exista el permiso, cualquier futura
edición que se lleve puesto un guard por descuido convierte ese error en un agujero **accesible sin
login**. Sacando el permiso, ese escenario deja de ser posible por construcción.

### ⚠️ Gotcha de Postgres — la mig.304 fue un NO-OP silencioso

**La mig.304 hizo `REVOKE ... FROM anon` y no cambió absolutamente nada.** Se detectó porque
después de aplicarla el conteo seguía en 10, idéntico a antes.

El ACL de estas funciones era:
```
{=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
```
Ese primer `=X` (sin rol a la izquierda del `=`) significa **`PUBLIC` tiene EXECUTE**. En Postgres
todos los roles heredan de `PUBLIC`, así que `anon` podía ejecutarlas **por herencia, no por un
GRANT directo**. `REVOKE ... FROM anon` intenta quitar un permiso directo que nunca existió → no
hace nada, **y no tira error**, así que pasa desapercibido salvo que se verifique el resultado.

**El revoke correcto es `FROM PUBLIC`** (mig.305), y es seguro precisamente por cómo está armado
ese ACL: `authenticated` y `service_role` tienen entradas **explícitas** que sobreviven intactas. El
único que pierde acceso es quien lo tenía sólo por herencia: `anon`. Es el mismo patrón que ya usaba
la mig.063 (`REVOKE ... FROM PUBLIC, anon;`) — la 304 copió sólo la mitad de la fórmula.

**Lección:** después de un `REVOKE`/`GRANT`, verificar siempre el resultado con
`has_function_privilege()`. Un revoke que no aplica **no falla, simplemente no hace nada**.

### 🔄 Corrección de lo documentado antes: `email_exists_in_system`

La auditoría la había anotado como *"riesgo aceptado — la necesita el alta de usuarios, sacarla
rompe el registro"*. **Eso era incorrecto.** Verificado con grep sobre todo `src/`: su único caller
es `validationUtils.checkEmailExists`, y a ese lo llama únicamente `UsuariosSection.jsx:150` — la
pantalla de **administración de usuarios**, que es autenticada. `AuthPage.jsx` (el registro/login
público) **no la usa**. O sea que el GRANT a `anon` nunca hizo falta, y encima habilitaba
enumeración de emails registrados sin login. Se revocó: **ese agujero también quedó cerrado**, sin
ningún trade-off.

**Probado en vivo contra producción:**
- `anon` → `permission denied for function email_exists_in_system` ✓ (enumeración cerrada)
- `authenticated` (el caso real de UsuariosSection) → sigue devolviendo `true`/`false` correctamente ✓
- `service_role` sobre `insertar_movimiento_bancario_externo` (la usa `mp-webhook`) → intacto ✓
- **Trigger `fn_punto_venta_unico_default`**: se disparó un UPDATE real sobre `puntos_venta` como
  usuario autenticado y **funcionó sin error**, confirmando que Postgres verifica el EXECUTE de una
  función de trigger al CREAR el trigger, no en cada disparo. Invariante intacto: 2 PdV default,
  los mismos de antes, 0 empresas con más de uno ✓

### 📊 Advisors de seguridad — jornada completa

| Hallazgo | Inicio | Final |
|---|---|---|
| 🔴 ERROR `security_definer_view` | 1 | **0** (mig.299) |
| WARN `anon_security_definer_function_executable` | 10 | **0** (mig.305) |
| WARN `public_bucket_allows_listing` | 2 | **0** (mig.302) |
| WARN `authenticated_security_definer_function_executable` | 82 | **81** (mig.300) |
| WARN `auth_leaked_password_protection` | 1 | 1 — *toggle del dashboard, ver arriba* |
| WARN `extension_in_public` | 1 | 1 — menor, sin impacto de aislamiento |
| INFO `rls_enabled_no_policy` | 2 | 2 — tablas de workers, cerradas de hecho |
| **TOTAL** | **99** | **85** |

Sin hallazgos de nivel ERROR, y sin ninguna función ejecutable por `anon`.

---

## ✅ 136 asientos reales sin vincular a su venta/compra — mig.303

Salió del **barrido de sanidad** de cierre de jornada.

**El hallazgo:** la **mig.281** (2026-07-30 18:54) agregó `comprobantes.asiento_id` /
`compras.asiento_id` y el código que las escribe (`planCuentasService.ts`), pero **nunca corrió un
backfill** para los asientos que ya existían. Verificado con precisión quirúrgica: **100% de los
registros ANTERIORES al 2026-07-30 tenían el vínculo roto** (124 de 125 comprobantes, 12 de 12
compras) y **100% de los posteriores estaban bien**. No era un bug activo — el código actual
funciona correctamente para todo lo nuevo. Era deuda histórica sin backfillear.

**Por qué importaba (riesgo armado, no disparado):** el botón "Regenerar asiento"
(`CompraDetailModal` / `FacturaDetailModal`) sólo mira esa columna para decidir si mostrarse. Para
esos 136 registros viejos el botón aparecía diciendo *"no tiene asiento contable"* cuando en
realidad **sí tenía uno real, correcto y confirmado**. Y las RPCs `regenerar_asiento_venta` /
`regenerar_asiento_compra` sólo comprobaban esa misma columna rota antes de insertar → un clic
habría creado un **SEGUNDO asiento real**, duplicando el impacto contable de esa venta/compra.
Verificado antes de tocar nada: **0 duplicados existían** — nadie lo había clickeado todavía.

**Fix en dos partes:**
1. **Backfill** de los 136 vínculos (`UPDATE ... FROM asientos_contables ... WHERE origen_id = c.id`).
   Seguro porque se verificó que la relación por `origen_id` es 1 a 1, sin ambigüedad.
2. **Blindaje autoreparador** en ambas RPCs: antes de insertar, ahora buscan si **ya existe** un
   asiento real por `origen_id`. Si existe, sólo reconectan el vínculo y devuelven
   `{reconectado: true}` — **nunca duplican**. Así el riesgo no puede repetirse aunque el UPDATE de
   vinculación vuelva a fallar en el futuro (red cortada, tab cerrada a mitad de camino). El guard
   original (`asiento_id IS NOT NULL` → excepción) se mantiene intacto arriba del chequeo nuevo.

**Probado en vivo contra producción:**
- Backfill: **136 → 0 vínculos rotos**, y el total de asientos **se mantuvo en 201** (ni uno creado) ✓
- Guard principal: sobre una compra real ya reconectada → `"Esta compra ya tiene un asiento
  contable generado"`, sin duplicar ✓
- **Rama de autoreparación**: se reprodujo el escenario histórico exacto con datos sintéticos
  (compra + asiento real con el vínculo roto a propósito) → devolvió `{ok:true, reconectado:true}`
  con el **mismo** `asiento_id`, la compra quedó con **1 solo asiento** ✓
- Limpieza: datos de prueba borrados, total de vuelta a **201**, 0 fantasmas ✓

---

## 🧹 Barrido de sanidad 2026-08-03 — resto de los chequeos

Todo lo demás salió limpio. Se verificó: 0 asientos desbalanceados, 0 sesiones de caja abiertas,
0 cheques con error de asiento sin resolver, 0 comprobantes de venta/factura sin ítems, 0
comprobantes con `cae` pero sin `numero_afip`, 0 tarjetas pendientes de liquidación vencidas +5
días, 0 QRs colgados, 0 comprobantes con `cae_estado='error'`, 9/9 cron jobs activos, logs de edge
functions 100% `POST 200`, advisors de performance sin ningún ERROR, **28/28 tests unitarios verdes**,
lint y build en 0 errores.

**Worktrees fantasma eliminados.** Había dos copias del proyecto colgadas de sesiones viejas:
`.claude/worktrees/epic-sutherland-3e03f8` (branch `claude/epic-sutherland-3e03f8`, del 30/07) y
`suspicious-panini-6cb9e5` (17/06, 76K de basura suelta, ni siquiera registrada como worktree en
git). Vitest escaneaba la primera, así que **contaba cada test dos veces** (reportaba "56 tests"
cuando en realidad son 28) y fallaba con un spec de Playwright que no podía resolver
`scripts/loadtest/fixtures.json` porque el worktree había quedado incompleto. Tras limpiar: 28/28
tests reales, 0 failed suites, y la corrida bajó de **223s a 55s**.

**Antes de borrar se rescató un fix real que había quedado sin commitear ahí** — ver la sección de
Compra Rápida más abajo. Se verificó byte a byte (`diff --strip-trailing-cr`) que el contenido ya
estuviera a salvo en master antes de eliminar nada, y la branch se borró con `git branch -d` (no
`-D`) para que el propio git confirmara que estaba mergeada.

---

## ✅ Editar una compra ya no pisa la hora de la fecha

Rescatado del worktree fantasma antes de limpiarlo — era el bug de truncamiento de fecha en Compra
Rápida que estaba anotado como pendiente deferido.

**El bug:** `handleEditClick` hacía `compra.fecha.split('T')[0]` para poblar el input `date`
(correcto — el input necesita `YYYY-MM-DD`), pero después `handleSaveEdit` mandaba **ese mismo
string truncado** al UPDATE. Resultado: cada vez que alguien editaba una compra —aunque no tocara
el campo Fecha— la hora original se perdía.

**El fix** guarda el timestamp completo en `editForm.fechaOriginal` y, al guardar, compara: si el
usuario no tocó la fecha reusa el timestamp original intacto; si la cambió la reconstruye con
`getDateFromInputAR` (el mismo criterio que ya usa "Nueva Compra": hoy → hora actual, otro día →
12:00 neutro), que además evita el corrimiento de día por timezone.

**Basura limpiada:** 8 filas huérfanas en `facturas_pendientes_arca` (`comprobante_id=NULL`,
`error_definitivo`, del 28-31/07). Diagnóstico: el FK es `ON DELETE SET NULL`, así que al borrar los
comprobantes de las pruebas end-to-end de mig.286 y 293-296, las filas de la cola quedaban
desconectadas y el worker las marcaba en error. Basura de auditoría, no bug funcional. Los 16
errores que quedan son las 4 NC históricas × reintentos, ya documentadas como tema del contador.

---

# 📋 PARA LUCIANO — 3 cosas que sólo podés hacer vos

> Escrito por Nadia/Claude el **2026-08-03**, reconfirmado sin cambios el **2026-08-04** (ninguna de
> las tres se movió). Las tres están fuera del alcance del código: dependen de cuentas o paneles a
> los que Nadia no tiene acceso.

### 1. 🔴 Secreto de firma de MercadoPago — bloquea el cobro por QR

El bug del webhook de QR (mig.297/298) **no se puede cerrar sin vos**: la cuenta de MercadoPago está
a tu nombre.

**Qué hacer:** [panel.mercadopago.com.ar](https://www.mercadopago.com.ar/developers/panel) → tu
aplicación → **Webhooks** → copiar el **"Secreto de firma"** actual.

**Lo que ya verificamos (2026-08-03):** se revisó `mp-webhook` línea por línea y la validación HMAC
está implementada exactamente como documenta MP
(`id:{payment_id};request-id:{x-request-id};ts:{ts};`, HMAC-SHA256, hex) — **no hay bug de código**.
Confirma tu diagnóstico. El `webhook_secret` guardado en `integraciones_bancarias.config` para Nalux
tiene 64 chars y **no se toca desde el 2026-06-27**. Todo apunta a que ése no es el que MP usa hoy
para firmar.

Para comparar sin pegar el secreto en ningún lado, corré esto y contrastá el prefijo con lo que
muestra el panel (el valor completo **nunca** va al repo ni al chat):
```sql
SELECT left(config->>'webhook_secret', 6) AS prefijo, length(config->>'webhook_secret') AS largo, updated_at
FROM integraciones_bancarias WHERE proveedor = 'mercadopago';
```

Con ese valor el fix es inmediato: un `UPDATE` de una fila + repetir una prueba de pago real chico.
**Mientras tanto, toda venta por QR queda en `pendiente` para siempre** hasta que alguien la confirme
a mano. El dinero SÍ aparece en Bancos (lo trae `mp-sync-worker` por polling independiente); lo que
no ocurre es marcar la venta como pagada, generar el asiento y disparar AFIP.

### 2. ⏳ Plan de Supabase — los proyectos se restringen el 17/08/2026

Verificado hoy: la organización **NALUX sigue en plan `free`**, y el dashboard avisaba que los
proyectos quedan restringidos desde el **17 de agosto**. Quedan **2 semanas**. Es tema de billing, va
por tu cuenta. Si el proyecto se restringe, se cae la producción de todos los clientes.

### 3. 🔒 Activar "Leaked password protection" — ~~1 clic, gratis~~ ⚠️ requiere plan Pro

**Supabase → Authentication → Policies → "Leaked password protection".** No se puede activar por
migración ni por MCP, es un toggle del dashboard. Hace que Supabase rechace contraseñas que
aparecen en filtraciones conocidas (HaveIBeenPwned). Dado que el sistema maneja datos contables de
varias empresas, conviene. Lo puede hacer cualquiera de los dos.

**Actualización 20/08:** no es gratis como decía esta nota — probado en vivo, el dashboard deja
tildar el toggle pero al guardar devuelve `402 Payment Required`. Sólo disponible en plan Pro o
superior. Como partial mitigation, el 21/08 se subió la política de contraseña del lado servidor a
8 caracteres + mayúscula/minúscula/número (Auth → Providers → Email → Password requirements, sin
costo) — no es lo mismo que bloquear contraseñas filtradas, pero reduce el riesgo de las más
débiles mientras se sigue en free.

---

# 🗂️ Estado de pendientes al 2026-08-03

> ⚠️ **Desactualizada** — esta tabla es una foto histórica del 03/08, no se mantiene al día.
> Varios ítems que acá figuran "abiertos" ya se cerraron después (el secreto de firma de MP, el
> plan free, el toggle de leaked passwords). Ver **"🗂️ Estado de pendientes al 2026-08-21"**
> (al final del archivo) para la lista real y vigente.

**Cerrados hoy** (4 migraciones, todas probadas en vivo contra producción y pusheadas):
- ✅ mig.299 — `facturas_saldo_pendiente` ignoraba el RLS (fuga multi-tenant, era el único ERROR)
- ✅ mig.300 — guard de tenant regresionado + `record_attempt` sobre-expuesta
- ✅ mig.301 — **el alta de empresas nuevas estaba rota desde el 01/08** (nadie lo había notado)
- ✅ mig.302 — buckets públicos permitían listar archivos de todas las empresas

**Cerrados por Luciano el 01/08, verificados hoy:** las 2 sesiones de caja anómalas (la del 28/07 y
la que quedó abierta desde el 29/05). No queda ninguna sesión abierta en el sistema (30/30 cerradas).

**Verificados hoy como YA RESUELTOS** (el CONTEXT.md tenía notas viejas que decían lo contrario):
- El "gap de no relevante fiscal en el POS" → lo resolvió mig.293/294/295, y el badge de solo
  lectura es una decisión de diseño deliberada, no un descuido.
- "No hay forma de regenerar un asiento de venta/compra" → `regenerar_asiento_venta` y
  `regenerar_asiento_compra` existen desde mig.281.

**Abiertos, ordenados por prioridad:**

| Qué | De quién | Nota |
|---|---|---|
| ~~Secreto de firma de MP~~ | — | ✅ Resuelto — el QR de MP funciona de punta a punta desde el 04/08 (fila de abajo), no podría si esto siguiera bloqueado. |
| ~~Plan free vence 17/08~~ | — | Resuelto el 20/08 como **decisión consciente**, no como upgrade: Nadia confirmó "queda free por ahora, dejalo así". La fecha límite ya pasó y no se rompió nada. |
| ~~Toggle leaked passwords~~ | — | Intentado el 20/08: **no se puede activar en plan free** (`402 Payment Required` al guardar, confirmado en vivo). No es "1 clic" como decía acá — requiere plan Pro. |
| ~~QR MercadoPago Fase 2~~ | — | ✅ **HECHO** el 04/08 (mig.306/307): modal, polling, cancelar, cron de expiración y AFIP funcionando de punta a punta — probado con un pago real. |
| ~~Revocar `GRANT` de `anon`~~ | — | ✅ **HECHO** el 03/08 (mig.304/305): `anon` pasó de 10 funciones ejecutables a **0**. |
| Dominio propio en Resend | Nadia | Deferido a propósito. Gmail SMTP ya resuelve el bloqueo total. |
| 4 NC históricas mal declaradas ante ARCA | Contador de Nalux | No es corregible por código |
| CbteAsoc en `informar-caea` | Equipo | Sin urgencia — probar recién a partir del 12/08 (ver PdV CAEA arriba) |
| ~~Tienda MP huérfana en la cuenta de Nalux~~ | — | ✅ **HECHO** el 05/08 — verificado con la API de MP y borrada |
| ~~Overload huérfano de `crear_nota_credito` (8 args)~~ | — | ✅ **HECHO** el 05/08 (mig.308) |
| ~~Trámite del PdV CAEA en AFIP~~ | — | ✅ **HECHO** el 05/08 — ver sección arriba |
| Venta puntual no fiscal en el POS | Equipo | **No es un gap hoy** — sólo haría falta si aparece el caso de uso (muestra gratis, consumo interno) |
| MELI Factura A | — | Deferido. **No construir sin pedido explícito.** |

---

## ✅ Buckets públicos permitían LISTAR archivos de todas las empresas — mig.302

Los 2 WARN `public_bucket_allows_listing` de los advisors.

**Situación:** `logos-empresa` y `productos-imagenes` estaban **bien** del lado de escritura — las
políticas de INSERT/UPDATE/DELETE ya exigían
`(storage.foldername(name))[1] = get_my_empresa_id()::text`, o sea que cada empresa sólo escribe en
la carpeta que lleva su propio `empresa_id`. Eso no se tocó. El problema era sólo el **SELECT**:
las políticas `*_select_publico` daban SELECT al rol `public` (que incluye `anon`) sobre **todo** el
bucket, sin restricción de carpeta.

**La distinción clave:** en un bucket público los objetos se sirven por
`/storage/v1/object/public/<bucket>/<path>` **sin consultar RLS** — esa es la definición de bucket
público. La política de SELECT sobre `storage.objects` no habilita **ver** las imágenes: habilita
**listarlas** (`.list()`), que es otra cosa.

**Qué se filtraba (verificado en vivo simulando el rol `anon`, no asumido):** un anónimo podía
listar los **15 archivos** de ambos buckets y enumerar **3 `empresa_id` distintos**. Como las
carpetas SON los `empresa_id`, eso es enumeración de inquilinos: cuántas empresas hay, sus UUID (la
clave de tenant de todo el sistema), cuántos productos con imagen tiene cada una y los nombres de
archivo.

**Verificado antes de tocar nada:** la app NO usa `.list()` sobre ninguno de los dos buckets — sólo
`getPublicUrl()` (puro string del lado del cliente, ni siquiera pega a la API), `upload()` (INSERT) y
`remove()` (DELETE), en `ProductoImagenes.jsx` y `ConfiguracionSection.jsx`. Los `.list(` del grep
son constructores de `queryKey` de react-query, no del Storage. Las edge functions usan
`service_role`, que no pasa por RLS.

**Fix:** en vez de borrar la política (que dejaría a un usuario sin poder listar ni su propia carpeta
si algún día se agrega una galería), se reemplazó por una acotada: sólo `authenticated` y sólo su
propio `empresa_id` — el mismo criterio que ya usaban INSERT/UPDATE/DELETE ahí.

**Probado en vivo contra producción:**
- `anon` listando → **0 archivos, 0 empresas** ✓ (antes: 15 archivos, 3 empresas)
- usuario de Nalux listando → **13 archivos, 1 sola carpeta** (la suya) ✓
- **Las imágenes públicas siguen sirviéndose** — comprobado con `curl` real y sin ningún header de
  autenticación: logo Nalux `HTTP 200 image/jpeg 16907 bytes`, logo CAEA Test `HTTP 200 image/png
  45780 bytes`, imagen de producto `HTTP 200 image/jpeg 25395 bytes` ✓. Esta era la premisa
  riesgosa del cambio (si un bucket público NO sirviera sin RLS, se habrían roto todas las imágenes
  del sistema), por eso se verificó por HTTP y no por deducción.

### 📊 Advisors de seguridad — antes vs. después de la jornada

| Hallazgo | Antes | Ahora |
|---|---|---|
| 🔴 ERROR `security_definer_view` | 1 | **0** (mig.299) |
| WARN `public_bucket_allows_listing` | 2 | **0** (mig.302) |
| WARN `authenticated_security_definer_function_executable` | 82 | **81** (mig.300) |
| WARN `anon_security_definer_function_executable` | 10 | 10 |
| WARN `auth_leaked_password_protection` | 1 | 1 |
| WARN `extension_in_public` | 1 | 1 |
| INFO `rls_enabled_no_policy` | 2 | 2 |
| **TOTAL** | **99** | **95** |

**El proyecto ya no tiene ningún hallazgo de nivel ERROR.**

**Lo que queda y por qué NO se tocó:**
- **`auth_leaked_password_protection`** — es un toggle del dashboard de Supabase
  (Authentication → Policies → "Leaked password protection"), no hay forma de activarlo por
  migración ni por MCP. **Lo tiene que hacer Nadia o Luciano a mano.** Gratis, un clic: hace que
  Supabase rechace contraseñas que aparecen en filtraciones conocidas (HaveIBeenPwned).
- **`anon_security_definer_function_executable` (10)** — auditadas una por una: 8 se defienden con
  `get_my_empresa_id()` (que para `anon` devuelve NULL, así que el guard dispara), 1 es una función
  de trigger (PostgREST no expone funciones que retornan `trigger`) y 1 es `email_exists_in_system`,
  que **necesita** ser anon-ejecutable porque la usa el alta de usuarios. Revocar los GRANT de
  `anon` sobre las 8 no-esenciales sería higiene de defensa en profundidad — candidato para la
  próxima tanda, no urgente.
- **`rls_enabled_no_policy` (2)** — `afip_tickets` y `arca_worker_run` tienen RLS activo sin
  políticas, o sea **cerradas de hecho**: nadie accede. Es lo correcto para tablas internas de
  workers; el advisor lo marca como INFO, no como problema.
- **`extension_in_public`** — menor, sin impacto de aislamiento.

---

## 🔴 BUG CRÍTICO ya corregido: no se podía dar de alta una empresa nueva — mig.301

Apareció **probando el guard restaurado por la mig.300** — el test lo destapó, la mig.300 no lo
introdujo (copió el mismo `ON CONFLICT` que ya estaba desde antes).

**Causa raíz:** la **mig.295** (numeración por punto de venta) reemplazó el índice único plano
`(empresa_id, tipo_documento)` de `series_numeracion` por dos índices **parciales**
(`idx_series_numeracion_legacy` … `WHERE punto_venta_id IS NULL` e `idx_series_numeracion_por_pdv`
… `WHERE punto_venta_id IS NOT NULL`). Pero `seed_series_numeracion` siguió con
`ON CONFLICT (empresa_id, tipo_documento)` a secas. **Postgres no resuelve un `ON CONFLICT` a un
índice parcial si no se repite su predicado `WHERE`** → `ERROR 42P10`.

**Por qué era crítico** (verificado paso a paso, no asumido):
1. El error es de **planificación**, no de datos — comprobado con un `INSERT … WHERE false` que no
   inserta ninguna fila y **aun así** tira 42P10. O sea: fallaba el 100% de las veces.
2. El trigger `trg_empresa_seed_series_numeracion` (AFTER INSERT ON empresas) está activo.
3. Ni el trigger ni `create_tenant()` tienen manejador de excepciones (el único `EXCEPTION` de
   `create_tenant` es un `RAISE`, no un `WHEN…THEN`), así que la excepción propagaba.

Encadenado: alta de usuario → `create_tenant()` → `INSERT INTO empresas` → trigger → 42P10 →
**rollback del alta entera. Nadie podía registrar una empresa nueva.**

**Por qué nadie lo notó:** la última empresa se creó el **2026-07-24** y la mig.295 se aplicó el
**2026-08-01**. No hubo ningún alta en esa ventana.

**Fix (mig.301):** repetir el predicado del índice parcial —
`ON CONFLICT (empresa_id, tipo_documento) WHERE punto_venta_id IS NULL DO NOTHING`. La función
siempre inserta con `punto_venta_id` NULL (ni siquiera nombra la columna), así que el índice
aplicable es el `legacy`.

**Probado en vivo end-to-end contra producción:** se creó una empresa real de prueba
(`ZZZ-TEST-301-BORRAR`) → el trigger sembró **las 11 series correctamente** ✓ (antes el INSERT
entero hacía rollback) → `seed_maestros_default` también corrió bien (15 unidades de medida,
5 condiciones de pago, 4 formas de pago) ✓ → empresa borrada, `ON DELETE CASCADE` limpió las 35
filas → **verificado en cero**, totales de vuelta a 60 series / 5 empresas ✓. El guard de tenant
sigue rechazando el cruce de empresas después del cambio ✓.

**Lección para no repetirlo:** cuando una migración cambia un índice único plano por uno **parcial**,
hay que revisar TODOS los `ON CONFLICT` que apuntaban a él — no fallan al aplicar la migración, sino
la próxima vez que alguien ejecuta el `INSERT`. Acá pasaron 2 días sin que nadie lo notara sólo
porque no hubo altas nuevas.

---

## ✅ Auditoría de las 82 funciones SECURITY DEFINER — mig.300

Balance general **tranquilizador**: de las 82 ejecutables por `authenticated`, **69 ya estaban bien
defendidas** — 50 con guard explícito (`RAISE` si `p_empresa_id` no coincide con
`get_my_empresa_id()`), 19 que derivan el tenant del JWT sin confiar en parámetros. Otras 7 son
funciones de trigger (PostgREST no expone funciones que retornan `trigger`, no hay superficie de
ataque) y 1 tiene el guard inline en el `WHERE` (`get_tasa_cambio`). **Sólo 2 problemas reales**,
ambos regresiones silenciosas:

**1. `seed_series_numeracion` perdió el guard de tenant de la mig.057.** Rastreado exactamente: la
057 lo puso, la **086 lo respetó**, y la **mig.268 lo borró** al redefinir la función para agregar
`nota_debito_venta` — se copió el cuerpo anterior a la 057. La mig.277 arrastró el mismo error.
Quedó a la vista porque su hermana `seed_maestros_default` (guardada por la misma 057) **sí lo
conserva**. Severidad baja (el `ON CONFLICT DO NOTHING` lo vuelve no-op contra una empresa ya
sembrada — el mismo "riesgo residual aceptado" que la 057 documentaba), pero es un control que
desapareció sin que nadie lo note. Se restauró el guard **exacto** de la 057, no uno más estricto:
el escape `…AND el usuario ya tiene empresa asignada` es imprescindible, porque durante el alta de
un tenant nuevo `get_my_empresa_id()` todavía devuelve NULL y un guard estricto rompería **todo**
alta de empresa.

**2. `record_attempt` era ejecutable por `authenticated`, contra lo que afirma un test propio.**
`supabase/tests/aislamiento_multitenant.test.sql` (Caso 8) asegura que un usuario autenticado NO
puede llamarla; en producción el ACL era `{postgres, authenticated, service_role}` — **el test
estaba fallando**. No lo causó ninguna migración del repo: viene de los *default privileges* de
Supabase al crear la función (mig.016), y la mig.063 revocó de `PUBLIC` y `anon` pero no de
`authenticated`. Verificado antes de revocar que la función está **completamente huérfana** — 0
llamadores en `src/`, en `supabase/functions/` y en `pg_proc` (el comentario del propio test, que
decía "sólo la llaman otras RPCs internamente", tampoco era exacto). Severidad baja hoy porque el
rate limiting no está cableado a nada; si se cableara, un atacante autenticado podría llamar
`record_attempt('login','victima@mail')` N veces y dejar esa cuenta bloqueada. Revocado antes de que
el riesgo exista. `check_rate_limit` se dejó como está: es de sólo lectura y no expone datos de
ningún tenant.

**Riesgo aceptado, documentado, NO cambiado:** `email_exists_in_system` es ejecutable por `anon` sin
validación alguna → permite enumerar si un email está registrado. Pero lo usa
`src/lib/validationUtils.js:11` para el alta de usuarios, que por definición ocurre **antes** del
login; sacarlo rompe el registro. Es el trade-off clásico enumeración/UX. Si algún día molesta, la
mitigación es rate-limitear la llamada, no quitarla.

---

## ✅ Blindspot multi-tenant: `facturas_saldo_pendiente` ignoraba el RLS — mig.299

Encontrado revisando los advisors de Supabase (único hallazgo nivel **ERROR** del proyecto).

**El hallazgo:** de las 5 vistas del esquema `public`, `facturas_saldo_pendiente` era la **única**
sin `security_invoker`. Sin esa opción Postgres ejecuta la vista con los permisos de su dueño
(`postgres`, superusuario) en vez de los de quien consulta — o sea **el RLS de `comprobantes` no se
aplicaba**. Y la vista por dentro tampoco filtra por `empresa_id`. Su gemela `compras_saldo_pendiente`
(mig.169, la misma vista del lado de Compras) ya lo tenía bien, igual que las otras tres: era un
descuido puntual, no una decisión de diseño.

**Impacto:** `anon` y `authenticated` tienen `GRANT SELECT` sobre la vista. Cualquier usuario logueado
de cualquier empresa podía pegarle al endpoint REST sin ningún filtro y leer las facturas impagas de
**todas** las empresas: razón social del cliente, número de comprobante, monto adeudado y vencimiento.
Es exactamente lo que `CLAUDE.md` prohíbe ("un usuario de Empresa A ve datos de Empresa B") y son
datos comerciales + personales alcanzados por la Ley 25.326.

**Alcance real al momento de arreglarlo:** 27 filas, todas de una sola empresa (Nalux) — el agujero
estaba abierto pero **todavía no se había materializado ninguna fuga entre inquilinos**. Se activaba
solo con que una segunda empresa tuviera una factura impaga.

**Fix (mig.299):** `ALTER VIEW public.facturas_saldo_pendiente SET (security_invoker = true);` — una
línea, alineando la vista con las otras cuatro. Seguro porque `comprobantes` (3 políticas) y
`cuenta_corriente_imputaciones` (1 política) ya tenían RLS activo y funcionando.

**Además, en el frontend:** `fetchFacturasAbiertas` (`CuentaCorrienteSection.jsx`) consultaba la vista
filtrando **sólo por `cliente_id`, sin `empresa_id`** — otra cosa que `CLAUDE.md` prohíbe. Se le
agregó el filtro como defensa en profundidad (el RLS ya lo cubre, pero no se deja una query sin
filtro de empresa). El otro call-site (Antigüedad de saldos) ya lo mandaba bien.

**Probado en vivo contra producción**, simulando cada rol con `SET LOCAL role` + `request.jwt.claims`:
- **A · usuario de Nalux** → ve sus 27 filas, $1.852.962 ✓ (no se rompió nada)
- **B · usuario de otra empresa (Creativas)** → ve **0 filas** ✓ (antes veía las 27 de Nalux)
- **C · `anon` sin login** → `permission denied for function get_my_empresa_id` ✓ (bloqueo duro)

`npx eslint` sobre `CuentaCorrienteSection.jsx`: 0 errores (4 warnings preexistentes de prop-types /
exhaustive-deps, patrón ya presente en el archivo).

**Pendientes de seguridad que quedaron anotados, NO tocados** (cada uno es una tanda en sí misma):
82 funciones `SECURITY DEFINER` ejecutables por `authenticated` + 10 por `anon` (WARN — hay que
auditar una por una); 2 buckets públicos (`logos-empresa`, `productos-imagenes`) con política SELECT
amplia que permite **listar** todos los archivos, no sólo acceder por URL; protección de contraseñas
filtradas desactivada en Auth (es un toggle del dashboard); `extension_in_public`; y 2 tablas con RLS
activo pero sin políticas (`afip_tickets`, `arca_worker_run` — cerradas de hecho, sin acceso).

## Retomado 2026-08-20 — Nadia pidió seguir con seguridad

Se volvió a pedir el reporte de advisors EN VIVO (no confiar en la nota vieja, ya desactualizada
por el trabajo del propio día): 89 hallazgos totales, no 82+10+resto como decía arriba — bajó solo
porque hoy mismo, antes de esto, ya se habían corregido 8 de los 10 `anon` (mig.337, Recuento/
Revalorización).

**Hallazgo nuevo, nivel ERROR, no estaba en la nota vieja — corregido (mig.340):**
`v_saldo_proveedores` había perdido `security_invoker` -- mismo bug que `facturas_saldo_pendiente`
(mig.299) pero **más grave**: `anon`, SIN LOGIN, tenía SELECT y podía leer nombre/CUIT/saldo de
deuda de los proveedores de TODAS las empresas. La propia mig.299 decía en su comentario que
`v_saldo_proveedores` YA tenía el flag en ese momento (03/08) -- se había seteado a mano, sin
migración, y se perdió en la migración de cuenta del 16/08 (mismo patrón de drift de siempre).
Probado con `BEGIN...ROLLBACK` simulando los 3 roles antes de aplicar: empresa real ve sus 12
filas, otra empresa ve 0, `anon` bloqueado con error de permiso.

**3 funciones más corregidas (mig.341):** `productos_stock_bajo` (¡la que yo mismo apliqué ayer,
mig.333 — le faltaba el mismo REVOKE que le puse a todo lo demás ese día, y le faltaba
`search_path`!), `marcar_cae_resuelto_manual` (se saca `anon`, se mantiene `authenticated` porque
la usa `MonitorFacturacionAFIP.jsx`), `rls_auto_enable` (es un event trigger, no se llama nunca
directo, revocar el EXECUTE no afecta que siga disparándose solo al crear tablas).

**Estado actual del reporte de advisors, verificado después de aplicar:** 0 ERROR, 0 `anon`
ejecutable, 0 `search_path` mutable. Quedaban: 79 funciones ejecutables por `authenticated` (la tanda
grande — **auditada por SQL directo, ver abajo, resultó no-issue**), 2 tablas
RLS-sin-política (INFO, confirmado no-issue, `afip_tickets`/`arca_worker_run` cerradas de hecho),
`extension_in_public` (`pg_net` — **cerrado 2026-08-21, mig.342, ver abajo**),
protección de contraseñas filtradas (**confirmado en vivo que NO se puede activar en plan free** —
ver nota de la sección del plan free más arriba, `402 Payment Required` al guardar).

**Auditoría de las 79 funciones `authenticated_security_definer_function_executable` (misma tarde,
Nadia dijo "seguí con las otras cosas, ya vengo"):** el nombre del lint es engañoso — no dice que
haya algo mal, sólo que existen funciones `SECURITY DEFINER` invocables por `authenticated` (que es
exactamente cómo está diseñada toda la capa de RPCs del sistema — `crear_venta`, `crear_nota_credito`,
etc. — a propósito, para poder validar `empresa_id` del lado servidor en vez de confiar en el
cliente). Auditado con una query SQL directa sobre `pg_proc`/`has_function_privilege`: de las 79,
**ninguna tiene `anon_exec = true` y todas tienen `search_path` explícito seteado** (`search_path=public`,
una con `search_path=public, vault`) — los dos problemas reales que si existieran ameritarían un
fix ya están cerrados.

**Segunda pasada, 21/08 — revisión de lógica interna, a pedido de Nadia ("vamos con el 3"):** de
las 79, 37 reciben `p_empresa_id` como parámetro explícito — las 37 validan ese valor contra
`get_my_empresa_id()` en el cuerpo, son `SECURITY INVOKER` (protegidas por RLS de la tabla, ej.
`productos_stock_bajo`, `next_numero_asiento`), o delegan a una versión que sí valida (el overload
de 2 args de `obtener_proximo_numero` llama directo al de 3 args, que valida). De las 42 restantes
que NO reciben `p_empresa_id`: 4 son funciones de "identidad propia" que no lo necesitan
(`is_admin`, `get_my_role`, `has_module_permission`, `create_tenant` — todo derivado de `auth.uid()`),
2 son `SECURITY INVOKER`, y las 36 que quedan sí usan `get_my_empresa_id()` en el cuerpo. De esas 36,
se leyeron línea por línea las 7 de mayor riesgo real (mueven plata/contabilidad):
`anular_asiento`, `confirmar_asiento`, `cambiar_estado_cheque`, `contabilizar_movimiento_bancario`,
`revertir_contabilizacion_movimiento`, `ajustar_stock_manual`, `acreditar_movimiento_caja`. Las 7
siguen el mismo patrón defensivo sin excepción: traen el registro por el ID recibido, comparan su
`empresa_id` real contra `get_my_empresa_id()` y `RAISE EXCEPTION` si no coincide (antes de tocar
nada), varias chequean además `has_module_permission()`, y las que también corren desde cron tienen
guard de `auth.role() = 'service_role'` para no bloquearse a sí mismas. No se encontró ningún caso
real de cross-tenant. Las ~29 funciones restantes no se leyeron línea por línea (quedan
disponibles para una pasada exhaustiva si se quiere garantía del 100%, pero la consistencia del
patrón en la muestra de mayor riesgo da confianza razonable de que no es código ad-hoc).

**Los 2 buckets públicos de Storage (`logos-empresa`, `productos-imagenes`), mismo momento:**
`public = true` a nivel bucket (correcto y necesario — así se ven los logos/fotos de producto sin
login, ej. en tickets o catálogos compartidos). Revisadas las políticas de `storage.objects`: las 8
políticas (`SELECT`/`INSERT`/`UPDATE`/`DELETE` × 2 buckets) están **todas** restringidas a
`{authenticated}` + `foldername = empresa_id` propio — no hay ninguna política que le dé a `anon`
acceso de listado. Probado en vivo con `SET LOCAL role anon`: `SELECT count(*) FROM storage.objects
WHERE bucket_id='productos-imagenes'` devuelve `0` filas. Conclusión: `anon` puede bajar un archivo
si ya conoce la URL pública exacta (es el propósito del bucket público), pero **no puede listar ni
enumerar** el contenido de la carpeta de otra empresa. No es el problema que se había anotado —
cerrado como no-issue, no hace falta ningún cambio de política.

**`pg_net` movido a `extensions` — cerrado 2026-08-21 (mig.342), con Nadia mirando los logs en
vivo:** resultó menos riesgoso de lo que parecía al principio. Las funciones reales de pg_net
(`http_get`, `http_post`, etc.) YA vivían en su propio schema `net`, no en `public` — lo único mal
ubicado era el registro de la extensión en sí. Los 8 cron jobs del proyecto llaman todos
`net.http_post(...)`, ninguno usa `public.*`, así que no había ninguna llamada que cambiar.
Encontrado en el camino: pg_net **no admite** `ALTER EXTENSION ... SET SCHEMA` (control file
`relocatable=false`) — hace falta `DROP EXTENSION` + `CREATE EXTENSION ... SCHEMA extensions` en la
misma transacción (así ningún cron ve un estado intermedio sin `net.http_post`; si alguno intenta
llamarlo justo en ese instante, Postgres lo hace esperar el lock, no falla). Probado con
`BEGIN...ROLLBACK` antes de aplicar, y aplicado mirando en vivo `cron.job_run_details` y los logs de
Edge Functions: los 6 cron jobs que corren cada 1-5 min (`mp-qr-poller`, `tiendanube-catalogo-worker`,
`tiendanube-stock-worker`, `mercadolibre-catalogo-worker`, `mercadolibre-stock-worker`,
`arca-worker`) siguieron en `succeeded` en la ventana exacta de la migración, y sus Edge Functions
correspondientes se siguieron invocando normal segundos después. `pg_extension` confirmado sin
ninguna extensión en `public` después del fix. Con esto se cierra el último pendiente de la tanda de
seguridad del 20/08 — advisors en estado limpio salvo el toggle de leaked-password (bloqueado por
plan free, ver más abajo) y la auditoría de código de las 79 funciones (no urgente, ver arriba).

**Actualización 2026-08-20 — decisión consciente, no reabrir como urgente:** la fecha límite
(17/08/2026) ya pasó, verificado ese día que la organización seguía en `free` y nada se rompió.
Le pregunté a Nadia directo: **"queda free por ahora, dejalo así"** — es una decisión tomada, no
un olvido de Luciano. No volver a marcar esto como pendiente urgente en futuras sesiones a menos
que Nadia lo pida ella misma.

**Consecuencia real y concreta de quedarse en `free`, encontrada el mismo día:** el toggle
"Prevent use of leaked passwords" (Auth → Providers → Email) de este pendiente de seguridad
**no se puede activar** en plan free — el dashboard lo deja tildar visualmente, pero al guardar
devuelve `402 Payment Required` y vuelve a quedar apagado al recargar. Confirmado en vivo con
Nadia mirando la pantalla. Si en algún momento se sube a Pro, este es un toggle suelto para
activar (no depende de ninguna migración del repo).

**Reconfirmado el 24/08**, durante el barrido general de la app: mismo toggle, mismo resultado.
El panel ahora lo deja marcar como "Powered by the HaveIBeenPwned.org Pwned Passwords API...
**Only available on Pro plan and above**" — más explícito que el 20/08, pero la misma conclusión.
Se canceló el cambio sin guardar (no se intentó forzar el `402` de nuevo). Sigue siendo la
decisión consciente de Nadia sobre el plan free, no un pendiente nuevo — ver
[[project_supabase_plan_free_decision]] en la memoria de Claude.

### Recupero de contraseña roto otra vez — no por el SMTP, por config de URL perdida (mismo drift)

Nadia probó el flujo real de "Olvidé mi contraseña" para confirmar el fix de SMTP (ver arriba) y
encontró dos problemas nuevos, **ninguno relacionado con Gmail SMTP en sí** — SMTP entregaba bien,
el problema estaba en otro panel de Auth que también quedó sin migrar:

**1) `Authentication → URL Configuration` — perdido en la migración del 16/08, igual que el SMTP:**
- `Site URL` estaba en `http://localhost:3000` (el default de desarrollo de Supabase).
- `Redirect URLs` estaba **vacío**, ninguna URL en la lista blanca.

El código (`AuthPage.jsx:99`, `UsuariosSection.jsx:182`) manda `redirectTo: window.location.origin`
— o sea, al pedir el reset desde `kairox-gestion-chi.vercel.app`, le pide a Supabase volver ahí.
Como esa URL no estaba en la lista blanca, Supabase caía al *fallback* (`Site URL` = localhost) y
el link del mail llevaba a una página rota. Corregido a mano en el dashboard (no es una migración
de SQL, es config de proyecto — mismo tipo de config que ya se había perdido con el SMTP):
- `Site URL` → `https://kairox-gestion-chi.vercel.app`
- `Redirect URLs` → `https://kairox-gestion-chi.vercel.app` y `https://kairox-gestion-chi.vercel.app/**`

**2) Ruido esperado, no es un bug:** en los logs de `auth_logs` aparecen intentos de `/verify` con
`"Email link is invalid or has expired" / "One-time token not found"` justo al mismo segundo que un
`/verify` exitoso (`303`) — es el escaneo automático de links de Gmail (u otro filtro de seguridad
de correo) abriendo el link para revisarlo antes de que el usuario lo toque, lo que "quema" el
token de un solo uso. Confundió a Nadia al principio (parecía "mail vacío" porque estaba mirando un
mail más viejo en la bandeja, no el último). **Probado de punta a punta después del fix:** mail con
contenido completo → click → `kairox-gestion-chi.vercel.app` → formulario "Nueva Contraseña"
funcionando. Confirmado por Nadia en vivo ("anda perfecto").

**Nota para la próxima migración de cuenta de Supabase (si vuelve a pasar):** además de RLS/grants/
triggers, agregar a la checklist manual: `Auth → URL Configuration` (Site URL + Redirect URLs) y
`Auth → Emails → SMTP Settings` — ninguno de los dos se exporta con los dumps de schema/datos, se
pierden en silencio y sólo se notan cuando alguien intenta recuperar la contraseña.

### Política de contraseña (8 caracteres + mayúscula/minúscula/número) + ojito para verla

A pedido de Nadia, mismo criterio que "otras apps": mínimo 8 caracteres con mayúscula, minúscula y
número. Dos partes:

1. **Servidor (Supabase Auth → Providers → Email):** `Minimum password length` 6→8, `Password
   requirements` de "No required characters" a "Lowercase, uppercase letters and digits". Supabase
   ahora rechaza de por sí cualquier alta/cambio de contraseña que no cumpla — no depende de que el
   frontend valide bien.
2. **Frontend:** nueva función `validatePasswordBasic()` en `src/lib/securityUtils.js` (8 caracteres
   + regex de mayúscula/minúscula/número, mensaje de error específico por regla) — mismo criterio
   que el servidor, para que el mensaje de error coincida con lo que Supabase va a exigir igual.
   Se aplica en `ResetPasswordPage.jsx` (siempre — es la pantalla de "elegí tu nueva contraseña") y
   en `AuthPage.jsx` **sólo al registrarse** (`!isLogin`), nunca al iniciar sesión — exigirle la
   regla nueva a un login con una contraseña vieja más corta rompería a usuarios existentes.
   (Nota: ya existía en el repo un `validatePasswordStrength()` más estricto — 12 caracteres +
   símbolo — en el mismo archivo, pero huérfano, ningún componente lo importaba. No se tocó ni se
   usó acá porque pide más de lo que Nadia pidió; queda como validador alternativo disponible si en
   algún momento se quiere una política más dura.)

**Ojito para mostrar/ocultar contraseña:** nuevo componente `src/components/ui/password-input.jsx`
(`PasswordInput`, envuelve el `<Input>` de siempre + botón con ícono `Eye`/`EyeOff` de lucide-react,
`tabIndex={-1}` para no interrumpir el tab entre campos). Reemplaza los `<Input type="password">` en
`ResetPasswordPage.jsx` (nueva contraseña + confirmar) y `AuthPage.jsx` (login/registro). No se tocó
`ConfigMercadoPagoModal.jsx` (tiene 2 campos `type="password"` pero son credenciales de MP, no
contraseñas de usuario — fuera del pedido de hoy).

`npx eslint`/`npx vitest run` (159/159) sin errores nuevos. `npx vite build` corrido en paralelo.

---

## ⚠️ QR MercadoPago en el POS — Fase 1 (backend) lista, con un bug real pendiente — mig.297/298

Último ítem del roadmap del POS (tanda 2). Se construyó el backend completo del cobro por QR
Dinámico de MercadoPago: la venta se crea en `estado_pago='pendiente'` apenas se genera el QR
(mismo patrón "crear ya en pendiente, confirmar después vía cola" que ya usa AFIP con
`facturas_pendientes_arca`/`arca-worker`), y se confirma cuando llega el webhook de MP.

**Por qué no se pudo reusar `crear_venta`:** inserta en `movimientos_caja` para cualquier método
salvo el string exacto `'Cuenta Corriente'`, y `crearAsientoVenta` (JS) postea el DEBE a Caja y
Bancos salvo `esCredito=true` — ambos reconocerían el QR como cobrado antes de tiempo. Tampoco
había precedente de generar un asiento contable fuera del JS del frontend (`crearAsientoVenta`
depende indirectamente de `auth.uid()`, que no existe en un webhook con `service_role`). Por eso:
3 RPCs nuevas dedicadas, con el asiento de confirmación en SQL puro.

**mig.297 (`supabase/migrations/297_qr_mercadopago_pos.sql`):**
- Tabla `qr_pagos_mp` (empresa_id, comprobante_id, user_id, external_reference único, in_store_order_id, qr_data, monto, estado pendiente/pagado/expirado/cancelado, payment_id, expiracion). Índice único parcial: máximo un QR `pendiente` por comprobante.
- `crear_venta_pendiente_qr` — copia acotada de `crear_venta` (sin loop de pagos, sin CC, sin encolar AFIP todavía), calcula el total 100% server-side (nunca confía en un total mandado por el cliente, porque acá dispara un cobro externo desatendido). `GRANT` a `authenticated`.
- `confirmar_pago_qr` — la pieza sensible. Llamada **solo** por `mp-webhook` con `service_role` (GRANT exclusivo a `service_role`, revocado de `authenticated`). Lockea `qr_pagos_mp` FOR UPDATE, es idempotente (no-op si ya no está `pendiente`), inserta `movimientos_caja`, genera el asiento en SQL puro (DEBE 1.1.1 Caja y Bancos / HABER 4.1 Ventas + 2.1.3 IVA Débito Fiscal / + COGS DEBE 5.1 HABER 1.1.3 si aplica — mismo criterio permisivo que `regenerar_asiento_venta`: cuenta faltante → se omite esa línea, nunca bloquea), marca `comprobantes.estado_pago='pagada'`.
- `cancelar_venta_pendiente_qr` — mismo patrón de reversa de stock que `cancelar_factura`, con lock+recheck de `qr_pagos_mp.estado` para que un cajero no pueda cancelar una venta que el webhook ya confirmó en el ínterin (race real).
- `formas_pago` — fila "QR MercadoPago" (`tipo_instrumento='billetera'`) **sin** `cuenta_bancaria_id` a propósito: si se le asignara una, el trigger `trg_fn_puente_caja_bancos` duplicaría lo que la conciliación MP existente (`mp-sync-worker`) ya inserta en `movimientos_bancarios` por su cuenta.

**mig.298:** el QR original vencía a los 10 minutos y un test real expiró antes de poder escanearlo — se subió a 15 minutos (`crear_venta_pendiente_qr` y `expiration_date` en `mp-qr-crear`).

**Edge function nueva `mp-qr-crear`:** dos clientes Supabase a propósito — `userClient` (JWT del caller) solo para `crear_venta_pendiente_qr` (así `auth.uid()`/RLS resuelven igual que cualquier venta del frontend, la autorización real vive en el RPC) y `adminClient` (`service_role`) para Vault + llamadas a la API de MP. Dado de alta de tienda+caja MP una única vez por empresa (persistido en `integraciones_bancarias.config.mp_store_id`/`mp_external_pos_id`), con 6 gotchas reales de la API de Stores/POS de MP descubiertos en vivo (no documentados claramente): sin campo `country` en `location` (probar 'AR'/'ARG' da `unknown_country`), `latitude`/`longitude` son obligatorios aunque no figuren como tal, `external_id` debe ser alfanumérico sin guiones y corto (máx. ~20 chars). El `store_id` se persiste apenas se crea (antes de intentar el POS) para no generar tiendas duplicadas si falla el segundo paso.

**`mp-webhook` (existente, editado, bloque aditivo sin `return` — sigue cayendo a la conciliación bancaria de siempre):** si `pago.external_reference` matchea una fila `qr_pagos_mp` pendiente, llama `confirmar_pago_qr`. Verificado que NO duplica con `movimientos_bancarios` (que sigue viniendo, sin tocar, de `mp-sync-worker`/`mp-webhook` de siempre).

### 🔴 Bug real encontrado en la prueba en vivo — sin resolver

Se probó con un pago real de $100 vía QR (Nalux). El pago fue aprobado por MP, pero **el webhook
`mp-webhook` rechazó la notificación real 3 veces con 401 (firma HMAC inválida)** — la venta se
quedó en `pendiente` y **no se confirmó sola**. Se tuvo que confirmar manualmente reproduciendo la
lógica del webhook (fetch a `/v1/payments/{id}` + `confirmar_pago_qr`) para dejar la venta
correctamente `pagada`, con el asiento (`AS-000202`, balanceado) y `movimientos_bancarios`
sincronizado por separado por `mp-sync-worker` (sin duplicar).

**Diagnóstico hecho:** se agregó logging temporal (`_webhook_debug_temp`, ya eliminado) que
capturó el próximo reintento real de MP. Los datos estaban bien formados — `payment_id` correcto,
`x-request-id` presente (UUID real de 36 chars, no vacío), `ts`/`v1` con formato válido, ambos
hashes de 64 chars (SHA-256 hex) — pero **el hash calculado nunca coincidió con el `v1` recibido**,
con el algoritmo exacto que documenta MP (`id:{data.id};request-id:{x-request-id};ts:{ts};`).
Esto descarta un bug de parseo/formato en el código y apunta a que **el `webhook_secret` guardado
en `integraciones_bancarias.config` (Vault-free, vive en el config JSON) para Nalux no es el que
MP usa realmente para firmar hoy** — no fue rotado en esta sesión (`updated_at` de la integración:
2026-06-27), así que puede estar desalineado desde antes, o corresponder a otra suscripción de
webhook del panel de MP.

**Impacto real:** como `mp-sync-worker` sincroniza `movimientos_bancarios` por polling
independientemente del webhook, el dinero SIEMPRE termina apareciendo en Bancos — pero
`confirmar_pago_qr` (que marca la venta como pagada, genera el asiento y dispara AFIP) **depende
100% de que el webhook valide la firma correctamente**. Sin eso, una venta QR real se queda
`pendiente` para siempre hasta que alguien la revise a mano. Este bug puede ser preexistente y
afectar también la conciliación de Tarjeta/Transferencia — pero ahí pasa desapercibido porque el
polling compensa; en QR es la única vía.

**Próximo paso (no hecho, requiere el panel de MP):** entrar a panel.mercadopago.com.ar → tu app →
Webhooks → copiar el "Secreto de firma" actual y compararlo/actualizarlo contra
`integraciones_bancarias.config.webhook_secret` de Nalux. Después, repetir la prueba de pago real
para confirmar que el webhook ya no da 401.

**Alcance NO cubierto (Fase 2, deliberadamente fuera de esta sesión):** modal del QR en el POS
(`PanelCarrito.jsx`), polling/Realtime sobre `qr_pagos_mp.estado`, botón cancelar desde la UI,
cron de barrido para expirar QRs abandonados. Gaps menores documentados en el código:
`empresas.direccion` es texto libre (MP Stores necesita campos estructurados, hoy usa
placeholders de Córdoba Capital para lat/long); pueden existir 1-2 tiendas MP huérfanas en la
cuenta real de Nalux de intentos fallidos antes de que se agregara la persistencia inmediata del
`store_id`.

**Probado en vivo (Nalux, pago real de $100):** QR generado y escaneado con la app real de MP ✓,
pago aprobado por MP ✓, venta confirmada manualmente con asiento balanceado y sin duplicar el
lado bancario ✓, webhook automático **falló** (pendiente de fix, ver arriba) ✗.

---

## ✅ Atajos de teclado en el Modo Caja (POS)

Siguiente ítem del roadmap del POS tras el análisis de mercado. Mapeo: **F2** cobra (Confirmar Venta), **F4** vuelve el foco al buscador de productos, **F8** enfoca el selector de cliente, **Alt+1..Alt+4** elige el medio de pago por posición (soporta pago mixto — activa/desactiva igual que un click). Se evitaron deliberadamente F1/F3/F5/F6/F10/F11/F12 por ser atajos reservados del navegador en Windows (ayuda, buscar en página, recargar, foco a la barra de direcciones, fullscreen, devtools) — F2/F4/F8 y Alt+dígito están libres en Chrome/Edge/Firefox.

**Arquitectura:** `src/hooks/useAtajosPOS.js` — un único listener `keydown` en `window`, montado una sola vez en `ModoCajaLayout`. En vez de que cada panel escuche sus propias teclas, `ModoCajaLayout` pasa un `ref` mutable (`posApiRef`) que `PanelProductos` y `PanelCarrito` van completando en sus propios `useEffect` con las funciones que sólo ellos pueden ejecutar (`focusBuscador`, `confirmar`, `focusCliente`, `seleccionarMedioPago`) — mismo patrón de "un solo punto de verdad" que ya usaba `Dashboard.jsx` para su propio `Escape` global. El guard `[role="dialog"][data-state="open"]` (ya existente en el refocus del buscador) se reusa tal cual para no interceptar teclas mientras hay un modal Radix abierto (por ejemplo, no permitir que F2 dispare `confirmar` de nuevo con el modal "Venta confirmada" abierto).

**Hints visuales:** badge "F2" en el botón Confirmar Venta, números 1-4 en la esquina de los primeros 4 botones de medio de pago, tooltips (`title`) "Atajo: F4"/"Atajo: F8" en buscador y selector de cliente.

**Limitación conocida (no es bug):** en viewport mobile (`<768px`), `ModoCajaLayout` usa tabs Productos/Carrito y oculta el panel no activo con `display:none` — F4 no puede enfocar un input oculto. Es una consecuencia esperada del layout responsive existente, no algo introducido por esta feature.

**Probado en vivo:** Alt+2 activó "Tarjeta Crédito" pasando a pago mixto junto con "Efectivo" ✓; F8 movió el foco al `<select>` de cliente ✓; F4 (en viewport desktop 1280×800) devolvió el foco al buscador ✓. Ningún atajo disparó comportamiento del navegador (recarga, buscar en página, etc.). `npx eslint` y `npx vite build`: 0 errores.

---

## ✅ Numeración de NC/ND separada por punto de venta — mig.296

Cierra el pendiente explícito dejado por mig.295 ("Alcance NO cubierto" más abajo). El motor `obtener_proximo_numero` (3-arg) ya soportaba `nota_credito`/`nota_debito_venta` en su CASE de recuento real — sólo el gate `v_es_scoped` los excluía (`p_tipo_documento IN ('venta', 'factura')`). El cambio real fue mínimo: ampliar ese gate a los 4 tipos + hacer que `crear_nota_credito`/`crear_nota_debito_cliente` reciban y usen `p_punto_venta_id`.

**Lección de Postgres (nueva, para no repetir el error):** intenté primero extender las RPCs con `CREATE OR REPLACE FUNCTION` agregando `p_punto_venta_id uuid DEFAULT NULL` al final de la lista de argumentos existente. **No funciona como yo esperaba** — Postgres identifica una función por su lista de tipos de argumentos; agregar un parámetro (aunque tenga DEFAULT) no reemplaza nada, crea un OVERLOAD nuevo y deja el viejo vivo en paralelo (verificado en sandbox: apareció un tercer overload de `crear_nota_credito`). La forma correcta de "extender en el lugar" es `DROP FUNCTION` (firma exacta) + `CREATE FUNCTION` (firma nueva) — mismo conteo total de overloads que antes. Se usó así: el overload huérfano de 8 args de `crear_nota_credito` (mig.264, deuda técnica ya documentada) sigue intacto y sin tocar; la versión de 9 args se reemplazó por una de 10 (agrega `p_punto_venta_id`); `crear_nota_debito_cliente` pasó de 8 a 9 args de la misma forma.

**Garantía de seguridad (misma que mig.295):** el PdV `es_default` sigue usando la fila legacy de siempre — sólo un PdV no-default provisiona una serie nueva.

**Frontend:** `NuevaNCModal`/`NuevaNDModal` ahora pasan `p_punto_venta_id` (ya lo resolvían para mostrar el aviso, sólo faltaba mandarlo al RPC). Como el RPC graba `punto_venta_id` en el `INSERT` de forma atómica, se sacó el `UPDATE comprobantes SET punto_venta_id=...` suelto que hacía el frontend después — una escritura menos, sin ventana entre "comprobante creado" y "PdV grabado".

**Probado en vivo contra producción (Nalux), vía curl con JWT real:**
- NC con PdV 1 (default) → `NC-20260801-001` (serie legacy, sin fila nueva) ✓
- NC con PdV 2 (no-default, interno) → `NC-2-20260801-001` (fila nueva provisionada, prefijo distinto, arranca en 1) ✓
- ND con PdV 2 (no-default) → `ND-2-20260801-001` ✓; ND con PdV 1 (default) → `ND-20260801-001` ✓
- Los 4 comprobantes de prueba quedaron con `punto_venta_id` correcto grabado por el RPC (confirmado por SELECT, sin necesitar el UPDATE separado)
- Todo revertido: 4 comprobantes + ítems + movimientos de CC borrados (0 fantasmas verificado), las 2 filas de serie nuevas (PdV 2) borradas, `proximo_numero` de las 2 filas legacy devuelto a 1
- `npx eslint` y `npx vite build`: 0 errores

---

## ✅ Criterio fiscal unificado: el punto de venta es el ÚNICO selector — mig.294/295

Pregunta de Luciano tras mig.293: "¿cómo unificamos el criterio entre ERP y POS?". Se investigó cómo lo resuelve SAP: **no hay dos selectores** (PdV + relevancia). Hay uno: la Serie/PdV, y de ahí se DERIVA si el documento es fiscal. Se aplicó ese modelo.

**mig.294 — `es_default` funcional:** existía la columna hace tiempo, se mostraba y editaba en Configuración, pero **nada la leía** (verificado: 0 PdV con `es_default=true` en las 3 empresas). Trigger que garantiza un único default por empresa (índice único parcial) + backfill al PdV fiscal que cada empresa ya usaba (cero cambio de comportamiento) + `useAfipConfig` ahora lo usa en la cadena de resolución.

**mig.295 — numeración separada por PdV** (alcance acotado a propósito: sólo `venta`/`factura`, ver más abajo). `series_numeracion` suma `punto_venta_id` nullable; `obtener_proximo_numero` gana un overload de 3 params (el de 2 sigue existiendo, ahora filtra explícitamente `punto_venta_id IS NULL` para no volverse ambiguo). **Garantía de seguridad de la migración**: el PdV `es_default` de la empresa sigue usando la fila legacy de siempre — sólo un PdV NO-default provisiona una fila nueva, con prefijo derivado (`"" → "2-"`, `"NC-" → "NC-2-"`).

**Cambio de UI — se sacó el checkbox "No relevante para AFIP" en 4 lugares** (`NuevaVentaModal`, `NuevaFacturaModal`, `NuevaNCModal`, `NuevaNDModal`), reemplazado por:
- **ERP (Factura/Venta):** selector de PdV real. Si el elegido tiene `envia_arca=false`, aviso "Comprobante interno: no se emite CAE ni se informa a ARCA".
- **NC/ND:** el PdV se **hereda** del comprobante origen (no se elige) — una NC que anula una factura fiscal tiene que ser fiscal. Sin origen (standalone), usa el PdV por defecto.
- **POS:** badge de sólo lectura en el topbar ("PdV 1"), configurable únicamente desde Configuración → Facturación (admin).

**Bugs reales encontrados y corregidos en el camino** (el mismo patrón, 4 veces):
1. `useAfipConfig` — `.limit(1)` sin ORDER BY ni filtro `envia_arca` (ya arreglado en mig.293).
2. `NuevaFacturaModal.jsx` — copia idéntica del mismo bug, no detectada en mig.293 por revisar sólo `useAfipConfig`.
3. `NuevaNCModal.jsx` — ídem, ahora además con herencia del PdV origen.
4. `NuevaNDModal.jsx` — ídem.

**Bug propio introducido y detectado por lint antes de llegar a producción:** al reemplazar el checkbox por el selector en los 4 modales, quedó una llamada huérfana `setNoRelevanteFiscal(false)` en el reset-al-cerrar de los 4 archivos — crasheaba el modal entero (error boundary de `VentasSection`) apenas se abría. `grep` inicial no lo encontró por mayúsculas; `npx eslint` (`no-undef`) lo detectó al toque. Corregido antes de cualquier commit — nunca llegó a producción.

**Alcance NO cubierto en esta migración — RESUELTO en mig.296 (ver sección de arriba):** `crear_nota_credito`/`crear_nota_debito_cliente` generaban el número dentro del RPC SQL, sin recibir el PdV.

**Probado en vivo contra producción (Nalux):**
- `NuevaFacturaModal`: selector de PdV, cambiar a "2 · Remito (interno)" muestra el aviso correcto ✓, sin crashear.
- POS: badge "PdV 1" visible en el topbar ✓.
- Numeración (vía curl con JWT real, ya que `execute_sql` no tiene contexto de `auth.uid()`): PdV default → `20260801-001` (serie legacy, sin crear fila) ✓; PdV no-default → `2-20260801-001` (fila nueva, prefijo distinto, arranca en 1) ✓; llamada de 2 args sin PdV → `20260801-002` (sigue la misma serie legacy) ✓. Todo revertido después: `proximo_numero` vuelto a 1, fila de prueba del PdV no-default eliminada — verificado en cero, 0 comprobantes fantasma.
- `npx eslint` sobre los 5 archivos tocados: 0 errores. Build limpio. 84 tests unitarios verdes.

---


## ✅ Punto de venta propio para el POS + opt-out de ARCA — mig.293

Pregunta de Luciano: *"¿el POS debería tener su propio punto de venta? ¿debería poder elegir si va por ARCA o no, pensando en un local chico que no factura?"*. Respuesta: sí a ambas — y continúa el pendiente que la **mig.244 dejó documentado explícitamente** (creó `puntos_venta.envia_arca` pero nunca lo cableó al circuito de facturación).

**Por qué el POS debe poder tener PdV propio:** AFIP exige un PdV por modalidad de emisión (si el mostrador suma controlador fiscal, va obligatoriamente en otro PdV); numeración independiente del back-office; y conciliación por canal.

**Dos necesidades distintas, no confundirlas:**
| Necesidad | Alcance | Mecanismo |
|---|---|---|
| Local que **no factura** electrónicamente | Permanente | PdV con `envia_arca=false` |
| Venta puntual no fiscal | Por comprobante | `comprobantes.relevante_fiscal=false` (ya existía, sólo el ERP lo expone) |

**DOS BUGS LATENTES QUE ESTO CERRÓ:**
1. `useAfipConfig` elegía el PdV con `.eq('activo',true).limit(1)` — **sin ORDER BY ni filtrar `envia_arca`**. No determinístico: Nalux tiene el PdV 1 (fiscal) y el 2 ("Remito", envia_arca=false), y nada garantizaba cuál se usaba para facturar.
2. `envia_arca=false` **no impedía** que el comprobante fuera a ARCA — el trigger `fn_queue_factura_arca` sólo mira `relevante_fiscal`. Ahora el frontend no marca `cae_estado='pendiente'` si el PdV resuelto no envía a ARCA, así que el trigger nunca se dispara.

**Fix:** `empresas.pos_punto_venta_id` (NULL = el mismo PdV que el resto). `useAfipConfig(contexto)` acepta `'pos' | 'erp'`, resuelve el PdV de forma determinística (PdV del POS si está configurado; si no, primer PdV activo **con envia_arca=true**, ordenado por número) y `afipActivo` ahora exige además que el PdV envíe a ARCA. Selector nuevo en Configuración → Facturación, con aviso explícito cuando el PdV elegido no factura.

**Probado en vivo end-to-end (Nalux)** — venta REAL de mostrador con pago mixto sobre un PdV interno de prueba:
- Selector guardó y avisó "Las ventas de mostrador no se enviarán a ARCA" ✓
- Venta $1.200 = $700 Efectivo + $500 Transferencia → **2 filas en `movimientos_caja`**, una por medio ✓ (esto cierra la verificación pendiente del pago mixto)
- `cae_estado='no_aplica'`, `punto_venta_id=NULL`, **0 filas en `facturas_pendientes_arca`** ✓ — nunca se encoló a ARCA
- Asiento balanceado $2.200=$2.200, con COGS incluido (mig.287): Debe 1.1.1 $1.200 + Debe 5.1 $1.000 / Haber 4.1 $991,74 + Haber 2.1.3 $208,26 + Haber 1.1.3 $1.000 ✓
- **Todo limpiado**: asiento, movimientos, comprobante, entrega, stock restaurado a 5851, sesión de caja, PdV de prueba, TC del día, rastros de auditoría, y el correlativo devuelto a 1 para no dejar salto de numeración — verificado en cero.

**Observación para más adelante (no es bug):** el asiento manda TODO el cobro a `1.1.1 Caja y Bancos`, aunque la venta se haya cobrado parte en efectivo y parte por transferencia. Como la cuenta es literalmente "Caja y Bancos" (combinada), es correcto hoy; si en algún momento se separan Caja y Banco en cuentas distintas, `crearAsientoVenta` va a necesitar partir el débito por medio de pago.

---


## ✅ Pago mixto en el POS — arquitectura compartida con el ERP

Segunda mejora de POS priorizada. **Hallazgo que simplificó el trabajo:** el pago mixto NO había que diseñarlo — ya existía completo en el camino ERP (`NuevaVentaModal` → `useMultipago`), y el backend también: `crear_venta` ya itera `jsonb_array_elements(p_pagos)` creando un `movimientos_caja` por pago. El único que armaba un solo pago era el POS.

**Decisión de arquitectura (pregunta explícita de Luciano — que venta mostrador y venta ERP sean compatibles):**
- **Se comparte la lógica, no la presentación.** `useMultipago` (ya testeado, 14 tests) es la capa común: maneja exclusividad de Cuenta Corriente, validación de que los montos sumen el total, formato argentino y resolución de `forma_pago_id`.
- La presentación queda separada a propósito: el ERP usa `PanelPago` (sidebar con moneda, centro de costo, AFIP, TC paralelo); el POS usa una grilla compacta y táctil. Reusar `PanelPago` en el POS habría arrastrado todo el contexto ERP a una pantalla de mostrador.
- Ambos caminos convergen en el mismo array `pagos` → misma RPC → mismo asiento. Por construcción no pueden divergir.

**Decisión de negocio (Luciano):** las ofertas condicionadas a un medio de pago (existe una activa, "Descuento transferencia") **sólo aplican cuando ese medio cubre el 100% de la venta**. En pago mixto el POS manda `p_medio_pago = null` al motor de ofertas. Sin esto, pagar $1 por transferencia desbloquearía el descuento sobre todo el carrito.

**Probado en vivo (Nalux):** carrito $1.200 → tocar Efectivo + Transferencia activa el modo mixto con input por medio ✓ → $700 muestra "Falta asignar $500,00" ✓ → +$500 muestra "✓ Pago completo" y habilita Confirmar ✓ → tocar Cuenta Corriente colapsa a CC sola, esconde los inputs y exige cliente ✓. Los 14 tests de `useMultipago` siguen verdes.

**Límite honesto de esta verificación:** NO se confirmó una venta mixta real en producción. Nalux tiene `usa_factura_electronica=true` y el POS —a diferencia del ERP— **no tiene el checkbox "No relevante para AFIP"**, así que una venta de prueba encolaría un CAE real e irreversible ante ARCA. Lo verificado es toda la construcción/validación de los pagos; el tramo `crear_venta` con múltiples pagos es código sin cambios que el ERP ya ejercita a diario en producción.

**Gap detectado — ya RESUELTO por mig.293/294/295 (ver secciones de abajo):** el POS no tenía el escape fiscal que sí tiene el ERP. Se cerró, pero no con un checkbox por venta — con `empresas.pos_punto_venta_id` (Configuración → Facturación → "Punto de venta del Modo Caja"): un admin puede asignarle al POS un PdV con `envia_arca=false` y ninguna venta de mostrador se encola a ARCA mientras dure. **Verificado 2026-08-03 (Nadia/Claude):** es una decisión de diseño a propósito, no un descuido — `ModoCajaLayout.jsx` muestra el PdV como badge **de solo lectura** (comentario explícito en el código: "SOLO LECTURA. Se configura únicamente desde Configuración → Facturación (admin)"). El cajero no puede optar por venta si esa venta va o no a ARCA — sólo un admin puede, a nivel de todo el mostrador. Correcto desde compliance: evita que un cajero decida unilateralmente saltear la factura fiscal de una venta puntual. Si en el futuro se necesita marcar UNA venta puntual del POS como no-fiscal (ej. muestra gratis, consumo interno) sin tocar la config global, ese sí sería un gap real — no implementado hoy, a propósito.

---


## ✅ Arqueo real al cerrar caja desde el POS — BUG DE DINERO CORREGIDO

Primera de las mejoras de POS priorizadas tras el análisis de mercado (ver sección siguiente).

**HALLAZGO (bug, no feature):** cerrar caja desde el POS (`ModoCajaLayout.jsx`) llamaba `closeSession(monto, '', 0, 0)` — con `esperado=0` y `diferencia=0` **hardcodeados**, y esos valores se **persisten** en `caja_sesiones`. Es decir: cualquier faltante o sobrante quedaba invisible, grabado como "diferencia $0". El arqueo real (que suma `movimientos_caja` por método) existía sólo en `CajaCierre.jsx`, usado desde el panel administrativo. Dos caminos de cierre, dos comportamientos distintos.

**Ya había afectado datos reales:** la sesión del **2026-07-28** (`87d0f6d2`) tiene `monto_inicial=$150.000` e `ingresos_efectivo=$30.000` → su esperado real era **$180.000**, pero quedó grabado `esperado=0, diferencia=0`. **Corregido por Luciano el 2026-08-01**: `monto_final_esperado` recalculado a `$180.000` desde `movimientos_caja`; `monto_final_real`/`diferencia` quedaron en `NULL` a propósito (el efectivo contado nunca se registró, así que no se asumió un valor) — documentado en `observaciones` de la fila.

**Fix:**
- Nuevo hook `src/hooks/useArqueoCaja.js` — **fuente única** del cálculo de arqueo, extraído de `CajaCierre.jsx`. Ambos caminos de cierre lo consumen, así no pueden volver a divergir.
- `CajaCierre.jsx` refactorizado para usarlo (comportamiento idéntico; el pre-llenado del saldo real ahora está guardado con un `useRef` para que un refetch no pise lo que el usuario tipeó).
- `ModoCajaLayout.jsx`: el modal de cierre ahora muestra el arqueo completo (inicial / ingresos / egresos / **esperado**), la **diferencia en vivo** con color (✓ Cuadra / ↑ Sobrante / ↓ Faltante), y campo de observaciones que se resalta cuando no cuadra. Pasa los valores reales a `closeSession`.
- Dos guardas contra reintroducir el bug: `staleTime: 0` en el hook (cada venta cambia el esperado — un arqueo cacheado grabaría una diferencia falsa), refetch al abrir el modal, y el botón "Cerrar caja" queda deshabilitado mientras el arqueo carga (si no, `esperado` sería 0 otra vez).
- Se agregó validación de monto inválido (antes `|| 0` convertía silenciosamente basura en 0).

**Probado en vivo contra producción (Nalux)** desde el POS real: caja abierta con $12.345 → el modal mostró "Esperado en caja $12.345" ✓ → conté $12.000 → mostró **-345,00 ↓ Faltante** en rojo ✓ → cerré con observación → verificado en DB: `esperado=12345.00, diferencia=-345.00` ✓ (antes ambos habrían sido 0). Sesión de prueba y su rastro de auditoría eliminados — verificado en cero, 29 sesiones cerradas como al inicio.

**Anomalía preexistente detectada — ya RESUELTA:** había una sesión de caja abierta desde el **2026-05-29** (`606de6ee`, empresa "KAIROX Gestión" — tenant interno, no un cliente real) con `monto_inicial=$2.030.036` y sin `cierre_fecha`, un turno que quedó abierto más de dos meses. **Cerrada administrativamente por Luciano el 2026-08-01**: `monto_final_esperado` recalculado a `$1.981.242,05` desde `movimientos_caja` ($2.030.036 inicial + $9.979,61 ingresos efectivo − $58.773,56 egresos efectivo); `monto_final_real`/`diferencia` en `NULL` (nadie contó el efectivo real, `cerrado_por` en `NULL` porque no lo cerró un cajero) — documentado en `observaciones` de la fila. Verificado 2026-08-03 (Nadia/Claude): no quedan sesiones abiertas en todo el sistema (30/30 en estado `cerrada`).

---


## ✅ Vigencia futura de precios — mig.292

Última de las 5 features priorizadas del trabajo de precios (después de mig.290/291). Permite programar un precio para que entre en vigencia en una fecha futura, sin tocar el precio actual hasta entonces — botón "Programar precio futuro" (icono calendario) por producto en `ListasPrecioSection.jsx`.

**Diseño:** 2 columnas nuevas en `lista_precio_items` (`precio_programado`, `fecha_vigencia_programada`) + un cron diario (`pg_cron`, mismo patrón que mig.207 CAEA — sin necesidad de Edge Function) que corre a las 03:05 ART y promueve `precio_programado → precio` cuando `fecha_vigencia_programada <= CURRENT_DATE`. RPCs `programar_precio_futuro` (valida fecha futura, no toca el precio actual) y `cancelar_precio_programado`.

**Probado en vivo contra producción (Nalux):** programé $1.200→$2.000 con vigencia 10/8/2026 sobre el producto de test — el precio mostrado siguió en $1.200, apareció el badge "Cambia a $2.000 el 10/8/2026" ✓. Probé "cancelar" → precio programado se limpió correctamente ✓. Verifiqué la lógica exacta del cron ejecutándola manualmente sobre el item de test con fecha=hoy → promovió correctamente a $2.000 y limpió los campos ✓. Item de test eliminado después — verificado en cero.

**Con esto, las 5 features priorizadas de ajuste de precios quedan completas: ajuste masivo con filtros, preview, redondeo, historial, y vigencia futura.**

---

## ✅ Historial de cambios de precio — mig.291

Fase 2 del trabajo de precios (después de mig.290). Se agregó un botón "Ver historial" por producto en el modal de precios de cada lista, que muestra quién cambió el precio, cuándo, y de cuánto a cuánto — leyendo directamente de `audit_log` (sin tabla nueva).

**Hallazgo durante la construcción, corregido en el momento:** se creyó que `lista_precio_items` no tenía trigger de auditoría (a diferencia de `productos`, cubierta desde mig.001) porque el grep inicial solo buscó el patrón `trg_audit_*`. Al aplicar un trigger nuevo (`trg_audit_lista_precio_items`) y probar en vivo aparecieron eventos duplicados en `audit_log` — investigando se confirmó que mig.021 (creación original de Listas de Precio) YA había creado un trigger equivalente con otro nombre (`audit_lista_precio_items`). Se dropeó el trigger duplicado inmediatamente, se corrigió mig.291 a un no-op documentado, y se limpiaron las filas de auditoría generadas por la prueba fallida. **Ninguna funcionalidad quedó rota en producción** — el error se detectó y corrigió en el mismo ciclo de prueba antes de dar por cerrado.

`listaPreciosService.getHistorialPrecio(listaId, productoId)` — filtra `audit_log` por `tabla='lista_precio_items'` y `producto_id` (usando `.or()` sobre `old_data`/`new_data` para no traer toda la tabla), cruza `user_id` con `profiles` para mostrar nombre.

**Probado en vivo contra producción (Nalux):** verificado en un producto real ("Mate", lista "Precio VIP") mostrando su único evento real ("Precio inicial: $1.500 — Nadia Tecera"), solo lectura, sin mutar nada.

---

## ✅ Ajuste masivo de precios en Listas de Precios — mig.290

Investigación previa (post-auditoría Inventario/COGS): `ListasPrecioSection` solo permitía editar precio producto por producto. En PyME argentina con inflación alta esto es inviable para catálogos reales. Se investigó qué ofrece el mercado (Tango, Dragonfish, Bejerman, Xubio) y se identificaron 5 features candidatas; se construyeron las 3 de mejor ROI en esta tanda: ajuste masivo filtrable, preview antes de aplicar, y redondeo configurable. Quedan pendientes para más adelante: historial de cambios de precio y vigencia futura (ver [[project_investigar_ajuste_masivo_listas_precio]]).

**Fix (mig.290):**
- RPC `ajustar_precios_masivo(lista_precio_id, tipo_ajuste, valor, categoria_id?, busqueda?, redondeo?, aplicar)` — un único cálculo usado tanto para preview (`p_aplicar=false`, no escribe nada) como para aplicar (`p_aplicar=true`, hace upsert real) para que preview y resultado nunca diverjan.
  - Precio base: el ya guardado en la lista si existe, si no `productos.precio_venta` (mismo criterio que la UI existente).
  - Ajuste: `porcentaje` o `monto_fijo`, filtrable por categoría y por texto de búsqueda.
  - Redondeo: `ninguno` / `decena` ($X0) / `centena` ($X00) / `terminar_99` ($X99).
- `listaPreciosService.ajustarPreciosMasivo` (nuevo método) y modal "Ajuste masivo" en `ListasPrecioSection.jsx`: form de tipo/valor/categoría/redondeo → botón "Previsualizar cambios" (tabla actual→nuevo, nada se graba) → botón "Aplicar a N productos" (recién ahí escribe).

**Probado en vivo end-to-end contra producción (Nalux)**, desde la UI real de Listas de Precios → lista "Mayorista" → filtro "TESTE" (producto de test preexistente) → +10% con redondeo $X99 → preview mostró $1.200→$1.399 ✓ → aplicar → toast "Precios actualizados ✓, 1 producto ajustado" → verificado en DB (`lista_precio_items.precio = 1399.00`) ✓. Ítem de test eliminado después — verificado en cero.

---

## ✅ Ajuste manual de stock genera asiento contable — mig.289

Tercer y último gap de la auditoría de Inventario/COGS: `ajustar_stock_manual` (mig.059, botón "Ajustar Stock" en Productos) cambiaba `stock_actual` y registraba en `movimientos_inventario`, pero nunca generaba asiento — mismo patrón de gap que Ventas (mig.287) pero para correcciones manuales (rotura, faltante, inventario físico). A diferencia de COGS, acá había ambigüedad de negocio real (¿una "entrada" es carga inicial o hallazgo?, ¿una "salida" es pérdida real o corrección de error?) — se le preguntó a Luciano y decidió: **siempre generar asiento**, sin distinguir motivo por ahora.

**Fix (mig.289):**
- `ajustar_stock_manual` cambia de `RETURNS void` a `RETURNS jsonb` (requirió `DROP FUNCTION` primero — Postgres no permite cambiar el tipo de retorno con `CREATE OR REPLACE`), devolviendo `{delta, costo_unitario}`.
- `crearAsientoAjusteStock` (nuevo método en `planCuentasService.ts`) — no bloqueante, mismo patrón que Ventas/NC:
  - Faltante (`delta < 0`): Debe `5.8 Otros Gastos` / Haber `1.1.3 Mercaderías-Inventario`.
  - Sobrante (`delta > 0`): Debe `1.1.3` / Haber `4.3 Otros Ingresos`.
- `ProductosSection.jsx` (`handleSubmitMovimiento`) llama al nuevo método tras `productosService.adjustStock`, con `.catch()` no bloqueante (toast solo si es período cerrado).

**Probado en vivo end-to-end contra producción (Nalux)**, desde la UI real de Inventario: "Ajustar Stock" → Salida (Venta/Pérdida) → 1 unidad de "Aramis TESTE Azul marino" (costo $1.000, producto de test preexistente) → stock bajó de 5851 a 5850 ✓ → asiento generado correcto y balanceado: **Debe 5.8 Otros Gastos $1.000 / Haber 1.1.3 Mercaderías-Inventario $1.000** ✓. Todo limpiado por completo después (asiento+ítems, movimiento de inventario, stock restaurado a 5851) — verificado en cero.

**Con esto, la auditoría de Inventario/COGS queda cerrada: los 3 gaps encontrados (COGS en venta, NC no revertía COGS, ajuste manual sin asiento) están resueltos y probados en vivo.**

---


## ✅ La Nota de Crédito revierte el Costo de Mercadería Vendida — mig.288

Continuación directa de mig.287: con el costo ya contabilizándose en cada venta, verificado que `crear_devolucion` restaura el stock físico correctamente al devolver mercadería, pero la NC que compensa esa devolución solo revertía Ventas + IVA contra CxC — nunca tocaba `5.1 Costo de Mercaderías` ni `1.1.3 Inventario`. Asimetría real: stock vuelve, venta se revierte, pero el costo original quedaba cargado para siempre.

**Fix (mig.288):**
- `crear_nota_credito` calcula el costo a revertir uniendo `devolucion_items.comprobante_item_id` con `comprobante_items.costo_unitario` (mig.287) — **solo si la devolución asociada tiene `reingresa_stock=true`** (una NC financiera sin devolución física no debe tocar Inventario). Se guarda en `comprobantes.costo_mercaderia_vendida` (mismo campo que usan las Ventas) y se devuelve en el jsonb.
- `crearAsientoNotaCliente` (JS) agrega 2 líneas si el monto es > 0 y existen las cuentas 1.1.3/5.1: `Debe 1.1.3 Mercaderías/Inventario / Haber 5.1 Costo de Mercaderías`.

**Hallazgo colateral, no relacionado, no corregido:** existe un overload huérfano de `crear_nota_credito` con 8 parámetros (sin `p_referencia_cliente`) que quedó vivo desde mig.264 — mig.265/266 nunca lo dropearon antes de agregar la versión de 9 parámetros. No afecta a la app real (`NuevaNCModal.jsx` siempre manda los 9), solo se manifestó al llamar la RPC directo por curl con exactamente 8 params (PostgREST no puede resolver el overload). Anotado como deuda técnica, no se tocó.

**Probado en vivo end-to-end contra producción (Nalux)**, cadena completa vía RPCs reales (mismo usuario autenticado, mismo `access_token` de sesión) — venta test $1.200 (costo $1.000) → devolución con `reingresa_stock=true` → NC generada desde la devolución:
- `crear_nota_credito` devolvió `costo_mercaderia_vendida: 1000.00` ✓ (calculado correctamente)
- Asiento verificado con la estructura completa (5 líneas, balanceado $2.200=$2.200): Debe Ventas $991,74 + Debe IVA Débito $208,26 / Haber CxC $1.200, **Debe Inventario $1.000 / Haber Costo de Mercaderías $1.000** ✓
- Todo limpiado por completo (asiento, NC, devolución, venta original, movimientos, stock restaurado) — verificado en cero.

**Con esto, el circuito Venta→COGS→Devolución→NC queda completo y simétrico.**

---


## ✅ Costo de Mercadería Vendida (COGS) en el asiento de venta — mig.287

Arrancando la auditoría de Inventario/COGS, se encontró el hallazgo más grande de toda la ronda de auditorías: `crear_venta` decrementa `productos.stock_actual` correctamente al vender, pero el asiento contable de la venta **nunca generó la línea de Costo de Mercadería Vendida**. Verificado en producción antes de tocar nada: Ventas acumuladas $7.633.841, Costo de Mercaderías real $0, y `1.1.3 Mercaderías/Inventario` con $8.285.520 de Debe (compras) y **$0 de Haber histórico** — el activo de Inventario nunca se consumía contablemente aunque el stock físico sí bajara. Consecuencia real: el margen/Resultado del Ejercicio que mostraba el sistema estaba sobreestimado en el 100% del costo de lo vendido.

**Fix (mig.287), snapshot del costo al momento de vender (no el costo actual, que puede cambiar después por compras posteriores):**
- `comprobante_items.costo_unitario` (nueva columna) — `crear_venta` la captura desde `productos.costo_compra` en el mismo `SELECT ... FOR UPDATE` que ya usaba para chequear stock, en el momento exacto de la venta.
- `comprobantes.costo_mercaderia_vendida` (nueva columna) — acumula el total, mismo patrón que `neto_gravado`/`iva_discriminado` (mig.280).
- `crearAsientoVenta` (`planCuentasService.ts`) agrega 2 líneas nuevas si el monto es > 0 y existen las cuentas 5.1/1.1.3: `Debe 5.1 Costo de Mercaderías / Haber 1.1.3 Mercaderías-Inventario`. No bloqueante — si falta alguna cuenta, el resto del asiento se genera igual.
- `regenerar_asiento_venta` (mig.281) también extendido para incluir estas líneas al regenerar.
- **Gap conocido, no corregido acá:** si el producto viene de una entrega manual previa (`p_pedido_id` con entrega ya hecha), el stock ya se movió en ESE evento anterior y su costo no se captura en esta llamada — haría falta capturarlo en el momento de la entrega, no de la factura (caso raro, documentado en el código).

**Probado en vivo end-to-end contra producción (Nalux)**, desde el POS real (no solo el RPC): venta de 1 unidad de "Aramis TESTE Azul marino" (producto de test preexistente, costo $1.000) por $1.200 en efectivo →
- `comprobantes.costo_mercaderia_vendida = $1.000` ✓
- Asiento generado con 5 líneas, balanceado ($2.200 = $2.200): Debe Caja $1.200 / Haber Ventas $991,74 + IVA Débito $208,26 (=$1.200) / **Debe Costo de Mercaderías $1.000 / Haber Mercaderías-Inventario $1.000** ✓
- Todo limpiado por completo después (asiento+ítems, comprobante+ítems, entrega+ítems, movimiento de caja, movimiento de inventario) y stock restaurado a su valor original — verificado.

---


## ✅ Liquidación de tarjetas en POS (crear_venta) — mig.286

Último pendiente que dejó Luciano ("Para Nadia, mañana"): `crear_venta` (POS) quedó fuera del alcance de mig.216, que solo cubrió `registrar_cobro_cliente` (Cuenta Corriente). Una venta de POS pagada con tarjeta acreditaba el bruto directo a `1.1.1 Caja y Bancos` el mismo día, sin pasar por la cuenta puente `1.1.8 Tarjetas a Acreditar` — la plata en realidad tarda 8-10 días hábiles y entra por el neto (Comunicación BCRA A 7153).

**Fix (mig.286), mismo patrón exacto que mig.216, en dos capas:**
- **`crear_venta` (RPC)**: en el loop de pagos (una venta de POS puede tener VARIOS pagos — split efectivo+tarjeta), por cada pago resuelve `dias_acreditacion`/`comision_porcentaje` de su `forma_pago_id` y completa las columnas de liquidación de `movimientos_caja` (`estado_liquidacion`, `monto_comision`, `monto_neto`, `fecha_acreditacion_estimada`) igual que ya hacía `registrar_cobro_cliente`. Devuelve `monto_pendiente_liquidacion` en el jsonb de retorno.
- **`crearAsientoVenta` (`planCuentasService.ts`)**: si recibe `montoPendienteLiquidacion > 0` y existe la cuenta `1.1.8`, parte la línea de "cobro" en dos — la porción inmediata sigue a `1.1.1`/`1.1.2` como siempre, la porción pendiente va a `1.1.8`. Si no hay monto pendiente o no existe `1.1.8`, cae exactamente al comportamiento de siempre (no rompe nada para quien no usa esto).

**Hallazgo de arquitectura durante el testing:** el POS real (pantalla "Punto de Venta" / Modo Caja, `ModoCajaLayout.jsx` → `PanelCarrito.jsx`) usa el hook `useConfirmarVenta.js` para confirmar la venta — **no** la función `handleConfirmSale` de `NuevaVentaModal.jsx`, que tiene su propia llamada a `crear_venta` en paralelo (posiblemente un flujo de "Nueva Venta" desde otro punto de entrada, o código legacy — no se investigó cuál). Se aplicó el fix en **los dos lugares** por consistencia, pero el que de verdad se probó en vivo es `useConfirmarVenta.js`, que es el que efectivamente ejecuta el Punto de Venta.

**Probado en vivo end-to-end contra producción (Nalux)** — se activó temporalmente `dias_acreditacion=10`/`comision_porcentaje=3` en la forma de pago real "Tarjeta Crédito" (estaba en 0, nunca se había configurado en ninguna empresa) para poder ejercitar el circuito, y se revirtió a 0 al terminar:
1. Venta POS $50.000 con "Tarjeta Crédito" → asiento generado: **Debe 1.1.8 Tarjetas a Acreditar $50.000** (antes iba a 1.1.1) / Haber Ventas $41.322,31 + IVA Débito $8.677,69 ✓
2. `movimientos_caja`: `estado_liquidacion='pendiente'`, comisión $1.500 (3%), neto $48.500, fecha estimada 10/08 (hoy+10) ✓
3. Apareció automáticamente en **Bancos → Tarjetas pendientes** (sin ningún cambio de UI necesario — la vista ya filtraba por `estado_liquidacion='pendiente'` de forma genérica): "Bruto pendiente $50.000" / "Neto a acreditar $48.500" ✓
4. Botón "Marcar acreditada" → `acreditar_movimiento_caja` (ya existente, mig.216) generó el asiento de liquidación y el movimiento bancario por el neto — el saldo de "Mercado Pago personal" subió exactamente $48.500 ✓
5. Todo limpiado por completo (asientos, movimiento bancario, movimientos_caja, comprobante, stock revertido) y la forma de pago devuelta a `dias_acreditacion=0` — verificado con conteo en cero.

**Con esto, los 3 pendientes que dejó Luciano quedan cerrados**: repaso cruzado de Cheques/Cierre de Ejercicio/Traslado (ver abajo) y liquidación de tarjetas en POS.

---

## ✅ Repaso cruzado de la sesión de Luciano (Cheques, Cierre de Ejercicio, Traslado)

Pedido explícito de Luciano: como Cheques/Cierre de Ejercicio/Traslado a Acumulados se hicieron sin una segunda revisión cruzada, se revisó código + datos reales antes de seguir con la liquidación de tarjetas POS.

**Cierre de Ejercicio (mig.283) y Traslado a Acumulados (mig.284): sin hallazgos.** Revisados línea por línea (balanceo, guards de permisos/idempotencia, caso borde resultado_neto=0) y el cableado de `TabPeriodos.jsx`. Todo consistente.

**Cheques (mig.282): encontrado y cerrado un blindspot real (mig.285).** mig.282 solo cubre asientos que TIRAN EXCEPCIÓN (cuenta faltante, etc.) — pero los estados `'depositado'` y `'descontado'` (ambos válidos en `TRANSICIONES_TERCERO`, `shared.jsx`) no tenían NINGUNA rama en `fn_asiento_cheque_tercero` ni en `regenerar_asiento_cheque`. No fallaban: directamente no existían — así que no quedaban ni logueados en `cheques_asiento_errores`. Verificado en producción antes de tocar nada: 1 cheque real de $80.000 en `depositado` con 0 asientos y 0 errores; y un caso histórico real de $500.500 que pasó por `descontado` sin generar ningún asiento en su momento.

**Fix (mig.285), decisión por estado (no son iguales):**
- `'depositado'` → sigue sin generar asiento, **a propósito**: el cheque sigue siendo el mismo activo, solo cambió de ubicación física. El circuito ya cierra bien al llegar a `'cobrado'`. Se corrigió solo el mensaje de `regenerar_asiento_cheque` para explicar esto en vez de sonar a bug.
- `'descontado'` → **sí es un hecho económico real** (el banco adelanta la plata antes del vencimiento) que no se contabilizaba. Se agregó la rama: Debe 1.1.1 Caja / Haber 1.1.6 Cartera, con guard para no duplicar el asiento si después pasa a `'cobrado'` (mismo criterio que ya existía para `'endosado'`). También se agregó la rama de rechazo viniendo de `'descontado'` (contrapartida Caja, no Cartera, porque la plata ya había entrado).
- **Limitación conocida y documentada**: se contabiliza por el monto BRUTO — `cheques` no tiene campo para el neto/tasa de descuento, así que el gasto financiero de la quita del banco no se registra (no es una regresión, tampoco se registraba antes). Backlog separado si se necesita.

**Probado en vivo contra producción (Nalux)**, cheque de tercero sintético $1.000:
- `en_cartera → descontado`: generó el asiento nuevo correcto (Debe Caja $1.000 / Haber Cartera $1.000) — antes no generaba nada.
- `descontado → cobrado`: confirmado que **no** generó un segundo asiento (el guard funcionó) — quedó en 2 asientos totales (recepción + descontado), no 3.
- Cheque de prueba, asientos e historial limpiados por completo, verificado con conteo en cero.

**Dato adicional del repaso, no arreglado (fuera de alcance, mismo criterio que las 7 facturas sin asiento que ya había dejado Luciano):** 6 cheques de junio (incluido el de $500.500) sin ningún asiento — anteriores a que los triggers estuvieran completos. No se corrigen retroactivamente sin pedido explícito.

---

## ✅ Nota histórica — pendientes que dejó Luciano, ambos CERRADOS

Cerrando la auditoría de Bancos (sesión 2026-07-31, Luciano), se revisó Conciliación bancaria (OK, sin gaps) y quedaron 2 pendientes para el día siguiente: liquidación de tarjetas en POS, y repasar/probar en vivo Cheques/Cierre de Ejercicio/Traslado.

1. ~~Extender `crear_venta` para la liquidación de tarjetas~~ — **HECHO** (mig.286, ver sección de arriba al tope del archivo). Probado en vivo end-to-end contra producción.
2. ~~Repasar y probar en vivo lo de Cheques/Cierre de Ejercicio/Traslado~~ — **HECHO** (ver sección de abajo): Cierre de Ejercicio y Traslado sin hallazgos; Cheques encontró y cerró un blindspot real (mig.285, 'depositado'/'descontado'), probado en vivo.

Detalle completo de memoria: `project_pendiente_liquidacion_tarjetas_pos.md`, `project_cheques_asiento_fallido_mig282.md`, `project_pendiente_cierre_ejercicio_sap.md`.

---


## ✅ Traslado a Resultados Acumulados — segundo paso del cierre SAP (mig.284)

Completa lo que mig.283 dejó explícitamente fuera de alcance: pasar el saldo de `3.3 Resultado del Ejercicio` a `3.2 Resultados Acumulados` una vez cerrado el ejercicio, dejando 3.3 en cero para el próximo.

**Fix (mig.284):**
- `periodos_contables.resultado_neto` (nueva columna) — `cerrar_ejercicio_contable` ahora guarda el neto calculado ahí, en vez de que el traslado tenga que releer el saldo actual de 3.3 (que podría mezclar el resultado de varios ejercicios cerrados y no trasladados aún). Cada traslado mueve exactamente lo que le corresponde a SU período.
- `periodos_contables.asiento_traslado_id` (nueva columna) — vínculo 1:1, no se puede trasladar dos veces.
- RPC `trasladar_resultado_acumulados(p_periodo_id, p_user_id)` — requiere `asiento_cierre_id` ya generado, admin, no trasladado antes, resultado neto ≠ 0. Un asiento de 2 líneas: lleva 3.3 a cero, acredita o debita 3.2 por el mismo monto.
- Botón "Trasladar a Acumulados" en `TabPeriodos.jsx`, visible solo cuando `asiento_cierre_id` existe, `asiento_traslado_id` no, y `resultado_neto != 0`. Badge "Trasladado" una vez hecho.

**Probado en vivo contra producción (Nalux), con datos sintéticos y aislados** (mismo criterio: rango 2020-01, sin actividad real): asiento test Venta $5.000 → período cerrado por fecha → "Cerrar Ejercicio" (resultado neto $5.000 a 3.3) → "Trasladar a Acumulados" → asiento generado correcto: Debe 3.3 $5.000 (a cero) / Haber 3.2 $5.000. Botón desaparece tras usarlo, badge "Trasladado" queda. Todo limpiado por completo después — verificado `count(*)=0`.

**Con esto, el circuito de Cierre de Ejercicio estilo SAP queda completo: cierre de fechas → asiento de cierre (Ingreso/Egreso → 3.3) → traslado (3.3 → 3.2).**

---


## ✅ Cierre de Ejercicio contable — estilo SAP (mig.283)

Siguiendo la navegación de Bancos/Conciliación/Cheques, Luciano preguntó puntualmente si existía el cierre mensual/anual con pase de Resultados a Patrimonio, apoyándose en el modelo SAP. Respuesta: el cierre de período (`TabPeriodos.jsx`, mig.027) solo bloqueaba fechas — el "Resultado del Ejercicio" del Balance General era (y para períodos sin cierre de ejercicio sigue siendo) un cálculo en pantalla, nunca un asiento real.

**Fix (mig.283):**
- `periodos_contables.asiento_cierre_id` (nueva columna) — vínculo 1:1 al asiento de cierre, si existe.
- RPC `cerrar_ejercicio_contable(p_periodo_id, p_user_id)` — requiere período YA cerrado (fechas bloqueadas) + rol admin + que no tenga ya un asiento de cierre. Por cada cuenta `tipo IN ('ingreso','egreso')` con movimientos confirmados en el rango, inserta la línea que la deja en cero (Debe si tenía saldo acreedor, Haber si tenía saldo deudor), con una única contrapartida contra `3.3 Resultado del Ejercicio` por el neto. Si no hay movimientos de resultado en el rango, no genera nada (evita asientos vacíos).
- Botón "Cerrar Ejercicio" en `TabPeriodos.jsx`, visible solo si `estado='cerrado' && !asiento_cierre_id`. Una vez generado, muestra badge "Ejercicio cerrado" y el botón "Reabrir" queda bloqueado (toast explicando que hay que anular el asiento desde Plan de Cuentas primero) — evita reabrir fechas que ya tienen resultado contabilizado.
- **Fuera de alcance, documentado:** el paso de `3.3 Resultado del Ejercicio` a `3.2 Resultados Acumulados` en el cambio de ejercicio (segundo paso del cierre SAP) no se automatizó — quedaría como asiento manual si se necesita.

**Probado en vivo contra producción (Nalux), con datos 100% sintéticos y aislados** (rango 2020-01, sin actividad real): 2 asientos de prueba (Venta $10.000 / Costo $4.000) → período test cerrado por fecha → botón "Cerrar Ejercicio" → asiento generado correcto: Debe Ventas $10.000 (a cero) + Haber Costo $4.000 (a cero) + Haber 3.3 $6.000 (resultado neto = 10.000−4.000, balanceado 10.000=10.000). Confirmado también que "Reabrir" queda bloqueado tras el cierre de ejercicio. Todo limpiado por completo después (asiento+ítems, los 2 asientos de prueba, el período test) — verificado con `count(*)=0`.

---


## 🟡→✅ Cheques: asiento contable fallido quedaba en silencio total (mig.282)

Después de cerrar Ventas/Compras, arrancamos la siguiente auditoría por Bancos/Cheques, navegando la UI en vivo antes de tocar código. Sorpresa: el módulo de Cheques está mucho más maduro de lo que decía la memoria de sesiones anteriores — 10 migraciones (028→211) ya resolvían los 3 gaps que se creían pendientes (asiento por cada transición de estado, vínculo a `movimientos_bancarios` al cobrar, reversión de deuda al rechazar, idempotencia y hardening multi-tenant ya aplicados en la sesión 72).

**El único gap real encontrado:** `fn_asiento_cheque_tercero`/`fn_asiento_cheque_propio` envuelven TODO el bloque contable en `EXCEPTION WHEN OTHERS THEN NULL` — si falta una cuenta del plan (1.1.6, 1.1.7, 2.1.6, etc.) o cualquier otro error inesperado, el cheque cambia de estado igual pero el asiento nunca se genera y no queda ningún rastro visible (a diferencia del patrón toast+"Regenerar asiento" que ya usan Ventas/Compras, mig.281).

**Fix (mig.282):**
- Tabla `cheques_asiento_errores` (cheque_id, estado, error_mensaje, resuelto) — los triggers ahora loguean ahí en vez de tragarse el error en silencio. Sigue siendo no bloqueante: el cambio de estado del cheque nunca falla por esto.
- RPC `regenerar_asiento_cheque(p_cheque_id, p_user_id)` — reconstruye el asiento del estado ACTUAL del cheque con la misma lógica que los triggers (recibido/endosado/cobrado/rechazado para terceros; entregado/cobrado/rechazado para propios), incluido el movimiento en `movimientos_bancarios` si corresponde. Solo actúa si hay un error pendiente logueado para ese cheque+estado (evita duplicar un asiento que sí se generó bien).
- Botón "Regenerar asiento" (ícono ámbar de alerta) en `AccionesCheque` (`shared.jsx`), visible solo si el cheque tiene un error pendiente en `cheques_asiento_errores` — mismo patrón visual que Ventas/Compras.
- **Gotcha de sesión, no de KAIROX:** después de aplicar la migración vía `apply_migration`, PostgREST tardó en refrescar su caché de schema (`PGRST205 — tabla no encontrada`) hasta correr `NOTIFY pgrst, 'reload schema'` manualmente + agregar el `GRANT SELECT` explícito a `authenticated` sobre la tabla nueva (la política RLS sola no alcanza, PostgREST exige el grant de tabla además). Confirmado resuelto vía curl directo al REST endpoint (pasó de `PGRST205` a `permission denied for function get_my_empresa_id`, que es el error esperado sin sesión autenticada). Si una migración futura crea una tabla nueva, recordar: RLS policy + GRANT + NOTIFY reload — los 3, no alcanza con 1 o 2.
- Verificado en vivo: la pantalla de Cheques renderiza sin regresiones tras el fix, `cheques_asiento_errores` existe con 0 filas (esperado, no hay errores reales hoy).

**Pendiente real, no tocado:** dominio propio en Resend (Nadia) y cuota de facturación de Supabase vencida (Luciano, dashboard). Bancos/Conciliación y Cheques Propios (UI) aún no se navegaron a fondo — próximo paso de esta auditoría si se retoma.

---


## ✅ Ventas — cerrado con la misma rigurosidad que Compras

Retomando lo pedido: "aplicar la revisión de Compras a Ventas y terminar el módulo". Después de los 2 fixes de la auditoría (NC/ND sin asiento, asiento no atómico en Venta/Compra), probé en vivo lo que más directamente los tocaba en Ventas:

- **Factura de Venta → Cancelar Factura** (RPC `cancelar_factura` + `crearAsientoReversaVenta`): creé una factura real ($2.000, IVA 10.5%), verifiqué que `asiento_id` se guardó solo, la cancelé, y confirmé que el asiento de reversa invierte las 3 líneas correctamente — **incluida la nueva línea de IVA Débito Fiscal** (Haber Caja $2.000 → Debe Caja $2.000 revertido; Debe Ventas $1.652,89 → Haber $1.652,89; Debe IVA Débito $347,11 → Haber $347,11). `crearAsientoReversaVenta` es genérico (invierte "lo que haya" en el asiento original), así que no necesitó ningún cambio de código para soportar el asiento de 3 líneas — quedó validado, no solo asumido.
- Dato de la sesión, no de la app: durante esta prueba los clicks sintéticos del navegador de testing no disparaban el `onClick` de `AlertDialogAction` (cerraba el diálogo pero nunca llegaba el request a Supabase) — se resolvió invocando el handler de React directamente. Anotado para la próxima sesión que use este mismo navegador de pruebas, no es un bug de KAIROX.

**Con esto, tanto Compras como Ventas quedan al mismo nivel: auditados con el agente contable, con IVA Débito/Crédito Fiscal discriminado en todos los asientos, NC/ND generando su asiento, y con forma de regenerar/revertir manualmente cuando algo falla.**

**Pendiente real, no tocado (fuera de esta auditoría):** dominio propio verificado en Resend (Nadia) y cuota de facturación de Supabase vencida (Luciano, dashboard).

---

## 🟡→✅ Ventas/Compras: asiento no atómico, sin forma de regenerarlo (mig.281)

Segundo hallazgo de la auditoría contable: a diferencia de Cuenta Corriente (mig.181/183, `cuenta_corriente_movimientos.asiento_id` + botón "Regenerar"), una Venta o Compra que confirmó su documento pero cuyo asiento falló (el asiento se dispara en una llamada aparte, no atómica con `crear_venta`/`registrar_factura_compra_oc` — si el segundo request nunca llega, queda contabilizada en CC pero sin nada en el Mayor) no tenía columna de vínculo ni forma de repararse manualmente.

**Fix (mig.281):**
- `comprobantes.asiento_id`/`compras.asiento_id` (nuevas columnas) — `crearAsientoVenta`/`crearAsientoCompra` (`planCuentasService.ts`) ahora las completan automáticamente después de confirmar el asiento normal.
- RPCs `regenerar_asiento_venta`/`regenerar_asiento_compra` — mismo patrón que `regenerar_asiento_cxc/cxp` (mig.181): guard de tenant/permiso/ya-tiene-asiento/período cerrado, reconstruye el asiento de 3 líneas con `neto_gravado`/`iva_discriminado` ya guardados en el documento.
- Botón "Regenerar asiento" (solo visible si `!asiento_id`) en `SaleDetailModal.jsx` y `CompraDetailModal.jsx`, mismo estilo/patrón que el de `CuentaCorrienteSection.jsx`/`ProveedoresSection.jsx`.

**Probado en vivo contra producción (Nalux), simulando la falla real** (crear la venta/compra normal → confirmar que `asiento_id` quedó solo → borrar el asiento y poner `asiento_id=NULL` a mano, simulando que la segunda llamada nunca llegó → abrir el detalle → click en "Regenerar asiento"):
- Venta POS ($30.000, Mate): asiento regenerado con las 3 líneas correctas (Cobro/Ventas neto/IVA Débito), botón desaparece después. ✓
- Compra Rápida ($5.000, Mouse Vertical): asiento regenerado con las 3 líneas correctas (Mercaderías neto/IVA Crédito/Pago). ✓
- Ambas limpiadas por completo.

**Con esto, los 2 hallazgos de la auditoría contable completa quedan cerrados.** Pendiente real, no tocado (fuera de alcance, no es de esta auditoría): dominio propio en Resend (Nadia) y cuota de facturación de Supabase vencida (Luciano).

---

## 🔴→✅ Crítico: NC/ND (cliente y proveedor) no generaban asiento contable

La auditoría contable completa de esta noche (agente `sap-motor-contable-auditor`) encontró que `crear_nota_credito`, `crear_nota_debito_cliente`, `crear_nota_credito_proveedor` y `crear_nota_debito_proveedor` (mig.265/275/276/277) tocan `comprobantes`/Cuenta Corriente pero **nunca insertan en `asientos_contables`** — ninguno de los 4 modales (`NuevaNCModal`, `NuevaNDModal`, `NuevaNCProveedorModal`, `NuevaNotaDebitoModal`) llamaba a `asientosAutoService`. Consecuencia real: el Estado de Resultados/Balance de Comprobación quedaba desincronizado de la Cuenta Corriente para cualquier empresa que usara NC/ND — sin ningún error visible.

**Fix:** dos métodos nuevos en `planCuentasService.ts` (mismo patrón no-bloqueante que `crearAsientoVenta`/`crearAsientoCompra`, con guard de período cerrado):
- `crearAsientoNotaCliente({tipo, comprobanteId, total, neto, iva, ...})` — NC: Debe Ventas (neto) + Debe IVA Débito Fiscal (iva) / Haber Cuentas a Cobrar (total). ND: inverso exacto. Siempre contra 1.1.2 (nunca Caja — el RPC solo toca `cuenta_corriente_movimientos`).
- `crearAsientoNotaProveedor({tipo, documentoId, total, neto, iva, ...})` — NC: Debe Cuentas a Pagar (total) / Haber Mercaderías (neto) + Haber IVA Crédito Fiscal (iva). ND: inverso exacto. Siempre contra 2.1.1 (el reembolso en efectivo de una NC es un movimiento de Caja aparte, no se tocó ese circuito — fuera de alcance de este fix).
- Los 4 modales ahora llaman al método correspondiente en el `.then` de éxito de su RPC, usando `subtotalNeto`/`totalIva` que ya calculaban localmente para mostrar en pantalla.

**Probado en vivo contra producción (Nalux):**
- NC de cliente sobre FAC-20260728-003 ($1.000 total): `neto_gravado=826.45`, `iva_discriminado=173.55` → asiento Debe Ventas $826,45 + Debe IVA Débito $173,55 / Haber CxC $1.000 ✓.
- NC de proveedor sobre factura de Amazon (ítem $1.210 bruto, 21%): `neto=1.000`, `iva=210` → asiento Debe CxP $1.210 / Haber Mercaderías $1.000 + Haber IVA Crédito $210 ✓.
- Las ramas ND (cliente y proveedor) no se testearon en vivo — mismo método, mismas cuentas, solo invierten debe/haber respecto a lo ya verificado. Riesgo bajo por simetría de código, pero queda anotado por si alguien quiere el test explícito.
- Ambas pruebas limpiadas por completo (asiento+ítems, comprobante/NC, movimientos de CC, imputaciones).

**Hallazgo secundario de la misma auditoría — ya RESUELTO (mig.281):** en Ventas/Compras el asiento se dispara en una llamada separada después de que el documento ya se confirmó (no atómico) y no había forma de regenerar manualmente uno que falló. **Verificado 2026-08-03 (Nadia/Claude):** existen en producción `regenerar_asiento_venta(p_comprobante_id, p_user_id)` y `regenerar_asiento_compra(p_compra_id, p_user_id)`, en paridad con `regenerar_asiento_cxc/cxp` y `regenerar_asiento_cheque`.

---

## ✅ Compras: recalcular neto/IVA al editar una compra existente

Pendiente técnico anotado ayer ("editar una compra existente no recalcula neto_gravado/iva_discriminado"). Confirmado en `CompraRapidaSection.jsx`:
- `handleSaveEdit` actualizaba `compras.total` pero nunca `neto_gravado`/`iva_discriminado` — quedaban en `NULL` para siempre tras la primera edición, aunque el total cambiara.
- Los ítems NUEVOS agregados durante una edición tampoco guardaban `alicuota_iva` en `detalle_compras` — quedaba sin setear.

**Fix:**
- `handleEditClick` ahora trae `alicuota_iva` de cada ítem existente.
- `addProductToEdit` toma `alicuota_iva` del producto (mismo dato que ya usa Compra Rápida al crear).
- El insert de ítems nuevos en `handleSaveEdit` ahora incluye `alicuota_iva`.
- Al guardar, se recalculan `neto_gravado`/`iva_discriminado` sobre el estado final de `editItems` con el mismo criterio bruto/factor que la creación (`FACTOR_IVA`), y se guardan junto al `total` en el mismo `UPDATE`.

**Probado en vivo contra producción** (compra real de Burbujitas, $10.000 → se agregó un ítem de $15.000 al 21%): `neto_gravado=20661.16`, `iva_discriminado=4338.84` — coincide exacto con el cálculo esperado ($25.000/1.21). Prueba revertida por completo por SQL (se removió el ítem, se restauró stock, total, neto/iva y hasta la hora original de `fecha` — ver hallazgo aparte abajo).

**Hallazgo colateral, no arreglado (fuera de alcance):** el modal de edición trunca la hora de `compras.fecha` a medianoche en CUALQUIER edición (`editForm.fecha = compra.fecha.split('T')[0]` descarta la hora, y el `UPDATE` la reescribe así). No es bloqueante — solo se ve en el orden fino de compras del mismo día — pero es un gap de precisión de datos real. Quedó registrado como tarea separada (chip de sesión) para no mezclarlo con este fix.

---

## ✅ NC/ND: AFIP exige CbteAsoc — encontrado y arreglado con prueba real en producción

Retomando el pendiente "Testear NC/ND con CbteTipo correcto en producción" (dejado el 2026-07-29): se creó una NC real contra Nalux desde la UI (Facturas → "..." → "Copiar a NC", $100 sobre la Factura C 0001-00000034) para verificar el fix de la tarea #36.

**Confirmó lo bueno:** el `cbte_tipo` ya se manda como NC (13), no como Factura — se sabe porque AFIP devolvió un error específico de NC/ND, que solo aparece si WSFE ya reconoce el comprobante como Nota de Crédito.

**Encontró un bug nuevo, más grave:** `[10197] Si el comprobante es Debito o Credito, enviar estructura CbteAsoc o PeriodoAsoc`. AFIP exige que toda NC/ND declare el comprobante que le dio origen (tipo, punto de venta y número de la factura asociada) — `arca-worker` no lo enviaba. **Con el código de ayer, ninguna NC/ND real podía obtener CAE** (quedaban todas en `error_datos`, sin reintentar).

**Fix (desplegado como `arca-worker` v19):**
- `_shared/wsfe.ts` — `CaeRequest` acepta `cbteAsoc?: {tipo, ptoVta, nro}`; `feCAESolicitar` arma el nodo `<CbtesAsoc><CbteAsoc>...` en la posición correcta del schema (después de `CondicionIVAReceptorId`, antes de `Iva` — mismo orden que usa `pyafipws`, la librería de referencia probada contra WSFEv1 real).
- `_shared/afip.ts` — `ArcaEmitParams`/`callArcaEmit` pasan `cbteAsoc` a `feCAESolicitar`.
- `arca-worker/index.ts` — para NC/ND, busca el `comprobante_origen_id`, lee su `numero_afip` (formato `PPPP-NNNNNNNN`) y arma `cbteAsoc = { tipo: voucherTypeAfip(origen), ptoVta, nro }`. Si no hay origen o el origen nunca tuvo `numero_afip`, lanza error con mensaje que contiene "Dato inválido" — cae en `classifyArcaError` → `'data'` → no reintenta (nunca va a poder emitirse sin origen válido).
- Se corrigió también la nota de la sección "Arquitectura de deploy": `arca-worker` en realidad **no** depende de `_shared/integraciones.ts` (nada en su cadena de imports lo usa) — dato heredado incorrecto de una sesión anterior.

**Probado en vivo:** la NC de prueba (NC-20260730-001, comprobante `4300c5bb-9f37-4bfc-b979-4f110f5efce7`) obtuvo CAE `86310698722818` tras el fix. `puntos_venta_numeracion` quedó con dos filas independientes — PV1/cbte_tipo=11 (Factura) en 34, PV1/cbte_tipo=13 (NC) en 1 — confirmando que las series no se pisan entre sí. Con esto la tarea #36 queda cerrada y verificada end-to-end, no solo revisada por código.

---

## ✅ IVA Débito/Crédito Fiscal discriminado en asientos (Ventas + Compras)

Último pedido de la noche: los asientos automáticos de venta/compra mandaban el total entero a una sola cuenta (Ventas o Mercaderías), sin separar el IVA en su propia cuenta — mismo problema en los dos módulos, no era nuevo de hoy.

**Fix (sin migración nueva de tablas — las cuentas `1.1.4 IVA Crédito Fiscal` y `2.1.3 IVA Débito Fiscal` YA estaban en el seed del plan de cuentas desde mig.004, nunca se usaban):**
- `planCuentasService.ts` — `crearAsientoVenta`/`crearAsientoCompra` ahora aceptan `neto`/`iva` opcionales. Si vienen y existe la cuenta de IVA correspondiente, arman un asiento de 3 líneas (Ventas: Debe Cobro total / Haber Ventas neto / Haber IVA Débito Fiscal; Compras: Debe Mercaderías neto / Debe IVA Crédito Fiscal / Haber Pago total). Si no vienen o falta la cuenta, cae al asiento viejo de 2 líneas — nunca bloquea la operación.
- **Migración 280**: `crear_venta` ya calculaba neto/IVA internamente pero nunca los devolvía en el `RETURN` — se agregaron `neto_gravado`/`iva_discriminado` al jsonb de retorno (cero cambios de lógica/side-effects, solo el RETURN).
- Los 6 puntos donde se llama a `crearAsientoVenta`/`crearAsientoCompra` (`NuevaFacturaModal`, `NuevaVentaModal`, `useConfirmarVenta`, `NuevaFacturaProveedorModal`, `CompraRapidaSection`, `OrdenesCompraSection`) ahora pasan `neto`/`iva` desde el valor que ya tenían disponible (local o del resultado de la RPC).
- **Probado en vivo, 3 veces, contra producción**: Factura de Venta manual (10.5% IVA) → asiento Debe Caja $1.000 / Haber Ventas $904,98 / Haber IVA Débito $95,02 ✓. Venta por POS (`crear_venta`) → mismo patrón, $30.000 total → $24.793,39 neto + $5.206,61 IVA ✓. Compra Rápida → Debe Mercaderías $4.132,23 + Debe IVA Crédito $867,77 = Haber Pago $5.000 ✓. Los tres balanceados, los tres limpiados después.

## ✅ Auditoría de Ventas (pedida por Luciano tras cerrar Compras)

Mismo enfoque que en Compras: revisé Cotización→Pedido→Entrega→Factura→NC/ND→Cancelación buscando el mismo tipo de gap (documento huérfano desconectado de CC/asiento/IVA). **Resultado: no hay nada roto.** `NuevaFacturaModal.jsx` ya hacía todo bien (CxC Open Item, Caja para no-CC, IVA real por ítem, asiento, AFIP), "Facturar Pedido" reutiliza el mismo `NuevaVentaModal` maduro (no hay tabla huérfana tipo `facturas_proveedor`), y `cancelar_nota_credito` ya tenía los mismos guards que hoy repliqué en Compras. Verificación de integridad en producción: 0 movimientos de Cuenta Corriente sin comprobante. Encontré 7 facturas sin asiento pero todas de junio/principios de julio — anteriores a que el control existiera, no es un bug activo, no se tocó (no se editan asientos retroactivos sin pedido explícito).

---

## ✅ Compras — CERRADO esta noche (todo aplicado, pusheado y probado en vivo)

Todo lo de la sección de abajo ("Trabajo de esta tarde") ya fue:
1. Revisado (self-review: se encontró y arregló un guard de tenant faltante en `caja_sesion_id`, commit `4ed8b7b`).
2. Aplicado a producción — migraciones 275, 276 y 277 aplicadas sin errores.
3. Pusheado a `origin/master` (commits hasta `fad73fc`).
4. `mp-sync` redesplegado (v14), verificado byte a byte.
5. **Probado en vivo, end-to-end, con datos reales creados y eliminados prolijamente:**
   - ND de Cliente: descripción de ítem ahora se guarda (fix mig.275) ✅
   - NC de Proveedor: numeración, neto/IVA, vínculo a Cuenta Corriente ✅
   - ND de Proveedor: ídem, numeración de la serie vieja (`notas_debito`, formato ND-YYYY-NNNN) ✅
   - **Reembolso en efectivo de NC Proveedor** (el camino que más dudas generaba): `reembolso_efectivo=true` + `caja_movimiento_id` poblado + guard de tenant de la caja, todo funcionando ✅
6. **Hallazgo y fix adicional (commit `fad73fc`):** el Mapa de Relaciones **ya existía** para Compras (no hacía falta construirlo) — pero la NC de Proveedor nueva (mig.277) rompía el vínculo: antes de mig.277, `cuenta_corriente_proveedores.referencia_id` apuntaba directo a la compra; ahora apunta al id de la NC (que ya tiene su propio `compra_id`). El Mapa buscaba por el patrón viejo y nunca encontraba la NC nueva. Se cambió el fetch para consultar `notas_credito_proveedor` directo por `compra_id` — verificado en vivo, la NC y la ND ahora aparecen correctamente en el árbol de documentos de su compra origen.
7. **Cancelación con reversa para NC/ND de Proveedor** (commit `eeee63f`, mig.278) — último pendiente, cerrado. Mismo patrón que `cancelar_nota_credito` (mig.267): documento de reversa, nunca se borra el original. Columna `estado` nueva en ambas tablas. Guard real: no se puede cancelar una NC ya cobrada en efectivo (el dinero ya cambió de manos). Botón "Cancelar" + confirmación en `DevolucionesProveedorSection.jsx`. **Probado en vivo end-to-end** (creación + cancelación + verificación del movimiento de reversa), datos de prueba limpiados.

**Migración 274 aplicada** (drop columnas deprecated `puntos_venta.ultimo_numero_a/b/c`) — era el pendiente que Nadia dejó a propósito para "dentro de ~1 semana" tras el deploy de `arca-worker` (mig.273). Se adelantó porque Luciano pidió explícitamente hacerlo ("hace lo que dejo Nadia pendiente"). Verificado antes de aplicar: `puntos_venta_numeracion` ya tenía filas vivas con `updated_at` de hoy (el worker ya escribe ahí en producción) y `grep` en `src/`+`supabase/functions/` no encontró ninguna lectura/escritura de las columnas viejas fuera de comentarios. DROP físico (no anulación lógica) porque son contadores técnicos internos, no un documento contable — el histórico real queda en `comprobantes.numero_afip`. Sin pendientes nuevos en advisors tras el DROP.

- `mp-sync` (el botón manual) ya redesplegado hoy — sin pendientes ahí.

## ✅ Fix contable: OC → Recepción → Factura (mig.279)

Stress-test de esta noche encontró que el flujo **OC → Recepción → Factura** ("3-way match", pantalla Órdenes de Compra) escribía en `facturas_proveedor` (mig.012) — una tabla que NUNCA se conectó al resto de la contabilidad: la deuda no aparecía en Cuenta Corriente Proveedores, `ReporteLibroIVACompras.jsx` no la veía, y "Marcar pagada" solo cambiaba un estado sin mover Caja/Bancos. Verificado antes de tocar nada: `facturas_proveedor` tenía 0 filas en producción — nadie lo usó, no había datos reales en riesgo.

**Fix aplicado (mig.279, acotado a propósito — no se tocó Compra Rápida ni Facturas de Compra manuales, quedan anotados abajo como backlog):**
- `compras.orden_compra_id` (nueva columna, único parcial) para vincular la factura a su OC.
- RPC atómica `registrar_factura_compra_oc`: crea `compras`+`detalle_compras` (ítems con IVA real por alícuota, no un monto suelto) + inserta la deuda en `cuenta_corriente_proveedores` (Open Item, patrón SAP — la Factura crea la deuda, el pago es un evento aparte vía `registrar_pago_proveedor`, que ya existe y ya mueve Caja/asiento). A propósito NO toca stock/costo — el stock físico ya se movió en la Recepción (Regla 8 SAP), volver a tocarlo duplicaría cantidades.
- `ModalRegistrarFactura.jsx` reescrito: ítems prellenados con lo recibido, alícuota IVA editable por ítem (default 21%), muestra Neto/IVA/Total.
- `ModalDetalleOC.jsx`: sacado el botón "Marcar pagada" (ya no aplica — Open Item se paga desde Proveedores → Cuenta Corriente), agregado el aviso correspondiente.
- **Autorevisión encontró un segundo gap en mi propio fix**: la RPC quedó atómica (compras+CC) pero el cliente no disparaba `asientosAutoService.crearAsientoCompra` — la Factura de OC creaba deuda real pero sin asiento contable. Corregido en el mismo commit: `OrdenesCompraSection.jsx` ahora llama al asiento (Debe 1.1.3 Mercaderías / Haber 2.1.1 Cuentas a Pagar, `esCredito:true` siempre porque esta Factura SIEMPRE es Open Item) en el `onSuccess` de la mutación, mismo patrón no-bloqueante que Compra Rápida.
- **Probado en vivo end-to-end DOS VECES** contra producción (Nalux, proveedor Mercado Libre, producto Mouse Vertical):
  - OC-00013 (2 u. × $5.000): factura FC-TEST-0001 → verifiqué `compras` (total $12.100, neto $10.000, IVA $2.100) + `detalle_compras` + `cuenta_corriente_proveedores` (tipo='compra', +$12.100, referencia_tipo='compra_oc').
  - OC-00014 (1 u. × $5.000, después de agregar el asiento): factura FC-TEST-0002 → verifiqué además `asientos_contables`+`asientos_items`: Debe $6.050 a "Mercaderías / Inventario" (1.1.3), Haber $6.050 a "Cuentas a Pagar" (2.1.1) — partida doble balanceada, `origen='compra'` y `origen_id` apuntando a la compra correcta.
  - Confirmé también que el botón "Registrar Factura" desaparece solo si la OC ya tiene una (guard de duplicado, reforzado también en la RPC).
  - Ambas pruebas limpiadas por completo (OC, ítems, recepción, compra, detalle, CC, asiento+ítems, stock revertido) y verificadas con conteo en cero.

## ✅ Cierre de los 3 hallazgos de backlog (mismo hilo, Luciano pidió terminarlos antes de Ventas)

1. **`NuevaFacturaProveedorModal.jsx` ahora genera asiento contable** — agregada la llamada a `asientosAutoService.crearAsientoCompra` (mismo patrón no-bloqueante que Compra Rápida y que la Factura de OC), con `esCredito` según la forma de pago elegida (CC Proveedor → Debe Inventario/Haber Cuentas a Pagar; Efectivo/Transferencia → Haber Caja). Banner corregido: decía "no modifica el inventario" pero el código SÍ suma stock (`aplicar_compra_producto`) — texto engañoso, reemplazado por una advertencia real sobre no duplicar stock si la mercadería ya entró por una OC.
   - **Probado en vivo**: factura FC-TEST-0003, ítem servicio (sin producto) $1.000 neto + IVA 10.5% = $1.105, forma de pago CC Proveedor → verifiqué `compras` (neto/IVA correctos), `cuenta_corriente_proveedores` (+$1.105) y el asiento (Debe 1.1.3 Mercaderías $1.105 / Haber 2.1.1 Cuentas a Pagar $1.105). Limpiado.
2. **Compra Rápida ahora discrimina IVA real por ítem** en vez de asumir 21% fijo — usa `productos.alicuota_iva` (ya existía en la tabla, no se usaba acá) con el mismo criterio bruto/factor que ND/NC de Proveedor. `compras.neto_gravado`/`iva_discriminado` y `detalle_compras.alicuota_iva` ahora se completan de verdad (antes quedaban NULL, y `ReporteLibroIVACompras.jsx` caía siempre en su fallback de 21%).
   - **Probado en vivo**: 1×Mouse Vertical a $5.000 (precio final, IVA incluido, alícuota 21% del producto) → `neto_gravado=4132.23`, `iva_discriminado=867.77` (4132.23×1.21=5000 ✓). Asiento y todo lo demás sin cambios (ya funcionaba). Limpiado.
   - **Nota histórica, ya CERRADA** (ver sección de arriba, tope del archivo): el flujo de EDICIÓN de una compra existente no recalculaba `neto_gravado`/`iva_discriminado` al agregar/quitar ítems — arreglado el 2026-07-30.
3. **`comprasService.ts` (código muerto, nadie lo llama todavía)**: `create()` insertaba `user_id: empresaId` — confundía usuario con empresa. Cambiada la firma para recibir `userId` explícito. Sin impacto real porque no hay callers, pero ya no queda ahí como trampa para quien lo conecte en el futuro.

**Con esto, el módulo Compras queda 100% al día — nada pendiente conocido.** Próximo paso pedido por Luciano: volver a Ventas.

---

## Trabajo de esta tarde (histórico — ya cerrado, ver arriba)

Se hizo un análisis + build completo (commits `b347398`, `45c3101`, `4ed8b7b`)
espejando en Compras las mejoras que Ventas ya tenía.

**Hallazgo que motivó esto (no solo simetría):** `ReporteLibroIVACompras.jsx`
solo leía `compras` — nunca veía una NC/ND de proveedor, así que el crédito
fiscal de IVA reportado nunca se ajustaba por esos documentos.

- **Migración 275** (fix, no build nuevo): `crear_nota_debito_cliente`
  (armada hoy mismo) nunca guardaba `descripcion` del ítem — comparado
  contra `crear_nota_credito` que sí lo hace. Verificado en la base: cero ND
  reales creadas todavía, sin historial afectado.
- **Migración 276**: `notas_debito_items` + `notas_debito.neto_gravado`/
  `iva_discriminado` + RPC nueva `crear_nota_debito_proveedor` (no se tocó
  la `crear_nota_debito` vieja, su rama 'emitida' ya está en desuso).
- **Migración 277**: `notas_credito_proveedor` + items — tabla de documento
  que ANTES NO EXISTÍA (la NC de proveedor era un insert suelto a
  `cuenta_corriente_proveedores`, sin numeración propia). RPC
  `crear_nota_credito_proveedor` con reembolso en efectivo atómico. Incluye
  un self-fix: la primera versión no validaba que `caja_sesion_id`
  perteneciera a la empresa (guard-tenant faltante, encontrado en
  autorevisión antes de que alguien más lo viera).
- `NuevaNotaDebitoModal.jsx` (shared/, proveedor) y `NuevaNCProveedorModal.jsx`
  reescritos con tabla de ítems + IVA, mismo patrón que sus pares de Ventas.
- Nuevo tab "Notas de Crédito Recibidas" en `DevolucionesProveedorSection.jsx`.
- `ReporteLibroIVACompras.jsx` ahora suma ND recibida (+) y resta NC de
  proveedor (-) al crédito fiscal, con columna Tipo.

**Ninguna de las 2 RPC nuevas toca `comprobantes` ni AFIP** — es el
proveedor quien declara estos documentos, no nosotros (mismo criterio que
ya regía para `devoluciones` tipo='proveedor').

El Mapa de Relaciones para Compras SÍ existía ya (no había que
construirlo) — solo necesitó un fix puntual, ver arriba. La cancelación
con reversa (mig.278) también se cerró la misma noche, ver punto 7 arriba.

**⚠️ Impacto operativo a revisar antes/al aplicar mig.277:** hay un usuario
`staff` en Nalux (no admin) sin el permiso granular `compras` otorgado
(`permissions->>'compras'` es NULL). Hoy puede crear NC de Proveedor porque
el flujo viejo (`NuevaNCProveedorModal.jsx`) hacía un INSERT directo sin
ningún chequeo de permiso granular. La RPC nueva `crear_nota_credito_proveedor`
sí exige `has_module_permission('compras')` — mismo gate que ya tiene
`crear_nota_debito` (precedente real, no invención) — así que ese usuario
va a quedar bloqueado para NC de Proveedor hasta que se le otorgue el
permiso `compras` desde Configuración → Usuarios. Es la decisión correcta
de seguridad (consistente con ND), pero Luciano debería saberlo antes de
que alguien reporte "no me deja hacer una NC".

Build y lint verificados limpios (0 errores). Probado en vivo esa misma
noche — ver sección de arriba.

---

## Estado actual de producción

Todo desplegado, aplicado y pusheado al cierre de la sesión del 2026-07-29.

| Servicio | Versión | Estado |
|---|---|---|
| `arca-worker` | v19 | ✅ ACTIVO (CbteAsoc para NC/ND) |
| `mp-sync-worker` | v1 | ✅ ACTIVO |
| `informar-caea` | v8 | ✅ ACTIVO |
| `mp-sync` | v14 | ✅ ACTIVO (redesplegado, verificado byte a byte) |
| Migración 271 | aplicada | ✅ |
| Migración 272 | aplicada | ✅ |
| Migración 273 | aplicada | ✅ |
| Migraciones 275/276/277 | aplicadas | ✅ |

---

## Qué se hizo en esta sesión

### Tarea #34 — Migración 271 (CAEA por CbteTipo)
Aplicada. Corrige `usar_caea_para_comprobante` RPC:
- Antes: mapeaba `v_tipo_cbte` solo por letra → siempre devolvía código de Factura
- Ahora: mapea por `(letra, clase)` → devuelve código correcto para Factura/NC/ND
- Quitó además el filtro `tipo_cbte` incorrecto del lookup de `caea_registros` (un CAEA es por CUIT+quincena, no por tipo)

### Fix colateral — Letra NC/ND hardcodeada a 'B'
`NuevaNCModal.jsx` y `NuevaNDModal.jsx` hardcodeaban `letraAfip = 'B'` para
NC/ND sin comprobante origen. Ahora derivan la letra con `determinarTipoComprobante()`
igual que ventas. Pusheado al repo.

### Fix colateral — `esClaseC` en `arca-worker`
`esFacturaC = voucherType === 11` dejaba afuera NC-C (13) y ND-C (12).
Corregido a `esClaseC = [11, 12, 13].includes(params.voucherType)` en `_shared/afip.ts`.
Incluido en el deploy v18.

### Tarea #35 — informar-caea: agrupamiento por (tipo_cbte, punto_venta)
`informar-caea` agrupaba todos los comprobantes usando `registro.tipo_cbte`
(el tipo del CAEA, siempre Factura), ignorando el tipo real de cada fila.
Ahora agrupa por `c.tipo_cbte` de cada comprobante en `caea_comprobantes`.
Desplegado como v8.

### Tarea #36 — puntos_venta_numeracion indexada por CbteTipo
**Problema:** `puntos_venta.ultimo_numero_a/b/c` indexa el contador por LETRA,
pero AFIP indexa sus series por `(PtoVta, CbteTipo)`. Factura/NC/ND son series
independientes — una sola columna por letra no puede seguirlas a las tres.
Con el fix de `voucherTypeAfip`, NC y ND empezaron a usar su propio CbteTipo,
pero ambas escribían en la misma columna de letra → falso positivo de "estado
ambiguo" que bloqueaba facturas válidas.

**Solución (Opción A):**
- Migración 273: nueva tabla `puntos_venta_numeracion(empresa_id, punto_venta_id, cbte_tipo, ultimo_numero)` con PK `(punto_venta_id, cbte_tipo)`. RLS: SELECT por tenant, sin políticas de escritura (solo `service_role`). Seed de ventas históricas (NC/ND históricas NO se siembran porque su CbteTipo declarado en AFIP era incorrecto).
- `arca-worker` v18: lee `puntos_venta_numeracion` en vez de `puntos_venta.ultimo_numero_[letra]`. Sin fila = primera emisión de esa serie → salta el chequeo de ambigüedad y auto-siembra en éxito. Upsert por `(punto_venta_id, cbte_tipo)` en cada emisión exitosa.
- Columnas viejas `ultimo_numero_a/b/c` quedan en `puntos_venta` marcadas `DEPRECATED` (no se dropean en 273 para permitir rollback fácil).

### Recuperación MP sync (incidente 15 días)
**Causa:** commit `7bccea5` (2026-07-14) agregó `verifyAdmin()` a `mp-sync`.
El cron usa la anon key → 401 en el 100% de corridas desde esa fecha.

**Solución:** separar en dos puntos de entrada (mismo patrón que `arca-worker`):
- `_shared/mpSync.ts` (nuevo): lógica de sync compartida
- `mp-sync`: mantiene `verifyAdmin` + filtro por `empresa_id` — es el botón del frontend
- `mp-sync-worker` (nuevo, `verify_jwt=false`): sin auth, todas las empresas activas — es lo que llama el cron
- Migración 272: re-registra `mp-sync-every-2-min` apuntando a `mp-sync-worker`

**Verificación post-deploy:** 71 movimientos en DB, backlog 14-29/07 recuperado completo (< 100 pagos en el período). Cron corriendo con 200 + `synced:0` (sin pagos nuevos desde el 28/07, es correcto).

---

## Pendientes técnicos

### CbteAsoc en informar-caea (circuito CAEA, sin urgencia)
El fix de CbteAsoc se aplicó al circuito CAE normal (`arca-worker`/`feCAESolicitar`).
El circuito CAEA (`informar-caea`/`feCAEAInformarComprobante`, contingencia por caída
de ARCA) probablemente tenga el mismo requisito de AFIP para NC/ND informadas por
CAEA, pero no se tocó — hoy nadie usa CAEA en producción (ver nota histórica de
la tarea #35), así que no hay forma de probarlo en vivo todavía. Si se activa CAEA
para una empresa que emite NC/ND, revisar si `FECAEAInformarComprobante` también
rechaza con `[10197]` y replicar el mismo `CbtesAsoc` ahí.

### 4 NC históricas mal declaradas ante ARCA
NC-20260706-003, NC-20260707-001, NC-20260707-002, NC-20260728-002 fueron
declaradas ante ARCA como Factura (código 6) en vez de NC (código 8) por el bug
de `voucherTypeAfip` anterior al fix. Ya autorizadas, no se pueden corregir por
código — tema para el contador de Nalux.

### Recupero de contraseña — resuelto con parche (Gmail SMTP), dominio propio pendiente
**Causa raíz encontrada (2026-07-30):** `Authentication → Emails → SMTP Settings` en Supabase tenía Resend configurado con el remitente sandbox `onboarding@resend.dev`. Confirmado en logs de Auth (`get_logs` service=auth): Resend rechazaba con `550 "You can only send testing emails to your own email address (naluxind@gmail.com). To send emails to other recipients, please verify a domain..."` — o sea, ese SMTP solo podía entregar a la propia cuenta de Resend, nunca a un cliente real. Por eso "nunca llegaba" sin ningún error visible en la app.

**Parche aplicado (por Nadia, vía Dashboard, sin tocar código):** se reemplazó el SMTP custom de Resend por **Gmail SMTP** (`smtp.gmail.com:587`, con una cuenta de Gmail dedicada + contraseña de aplicación). Verificado en logs: las solicitudes de recupero después del cambio devuelven `status:200, error:null` — el envío ya funciona.

**Limitación conocida, no arreglada:** el primer email a cada destinatario nuevo puede caer en Spam (Gmail es más estricto con remitentes personales usados para envíos automatizados, al no tener SPF/DKIM/DMARC propios como sí tendría un dominio verificado). Mitigación por ahora: pedirle a cada usuario que la primera vez marque el email como "No es spam" — a partir de ahí llega bien a esa combinación remitente/destinatario.

**Pendiente real, deferido a pedido de Nadia:** comprar un dominio propio (ej. `nalux.com.ar` vía nic.ar) y verificarlo en Resend (`resend.com/domains`) para tener entrega confiable desde el primer email, sin depender de que cada usuario "entrene" su filtro de spam. No es urgente — Gmail SMTP ya resuelve el bloqueo total que había antes.

**Nota aparte, no relacionada:** el dashboard de Supabase mostraba un banner "Organization exceeded its quota in the previous billing cycle — Projects will be restricted from 17 Aug 2026" — revisar `Billing` antes de esa fecha para no perder acceso al proyecto.

### MELI Factura A
Deferido hasta que se trabaje ARCA/AFIP específicamente para eso.
No construir sin pedido explícito.

---

## Arquitectura de deploy de Edge Functions

El deploy vía MCP (`deploy_edge_function`) reemplaza TODOS los archivos de la función.
Si la función importa archivos de `_shared/`, hay que incluirlos explícitamente en el
payload con `name: "../_shared/archivo.ts"`.

Funciones que usan `_shared/`:
- `arca-worker`: necesita `auth.ts`, `afip.ts`, `wsaa.ts`, `wsfe.ts` (NO `integraciones.ts` — nada en su cadena de imports lo usa, pese a lo que decía una versión anterior de esta nota)
- `informar-caea`: necesita `auth.ts`, `wsaa.ts`, `wsfe.ts`
- `mp-sync-worker`: necesita `auth.ts`, `mpSync.ts`
- `mp-sync`: necesita `auth.ts`, `mpSync.ts`

`config.toml` NO se aplica al desplegar vía MCP — hay que pasar `verify_jwt` explícitamente.

Workers sin auth (cron):
- `arca-worker`: `verify_jwt=false`
- `mp-sync-worker`: `verify_jwt=false`

Funciones de usuario (JWT requerido):
- `mp-sync`: `verify_jwt=true` (default) + `verifyAdmin()` interno
- `informar-caea`: `verify_jwt=true` (default) + `verifyAdmin()` interno

---

## CbteTipo AFIP — tabla de referencia

| Clase | Letra A | Letra B | Letra C |
|---|---|---|---|
| Factura (venta) | 1 | 6 | 11 |
| Nota de Débito | 2 | 7 | 12 |
| Nota de Crédito | 3 | 8 | 13 |

`esClaseC = [11, 12, 13].includes(voucherType)` — no discrimina IVA, `ImpNeto = ImpTotal`, `ImpIVA = 0`.

---

## Proyecto remoto Supabase
- **Project ID:** `wuznppxeonmhfcvnqfbf`
- **Empresa piloto:** Nalux (`condicion_iva = 'Exento'`, emite letra C)

---

## Sesión 2026-08-15 — Fase 2 del plan de comprobantes + bugs reales de Cotización/OC

Continuación del plan `PLAN_COMPROBANTES_ESTANDAR.md` (Fase 0 y Fase 1 ya cerradas
en sesiones previas). Nadia había dejado overnight `50277ed` (Facturar
Pedido/Entrega abre el ERP en vez del POS + 3 fixes más), verificado contra
el plan de pruebas antes de seguir.

### Bug real — autocomplete de productos roto al editar una Cotización (`6a28a7c`)
Reportado en vivo por Luciano: al editar una Cotización y agregar un producto,
el combo desplegaba pero clickear una sugerencia no hacía nada.

**Causa:** el listener `mousedown` de "cerrar dropdown al clickear afuera" en
`CotizacionesSection.jsx` solo reconocía `[data-prod-row]` como "adentro". El
refactor de `ProductoAutocomplete.jsx` de una sesión anterior movió el dropdown
a un `createPortal(..., document.body)`, fuera de ese ancestro — cada click en
una sugerencia se clasificaba como "afuera" y cerraba el dropdown en `mousedown`,
antes de que el `click`/`onSelect` pudiera dispararse.

**Fix:** se etiquetó el portal con `data-prod-dropdown` y se excluyó del check
de "afuera". Confirmado con clicks reales de mouse (no sintéticos) antes/después.

### Gap real — Mapa de Relaciones inaccesible desde Cotización y Orden de Compra
Ninguna de las dos tenía botón "Mapa de relaciones" en su detalle. En OC el gap
era más profundo: `MapaRelaciones.jsx` no tenía ninguna rama de resolución para
un id de OC (solo compra/comprobante/cotización/pedido/entrega/recepción/devolución).

**Fix (`6a28a7c`, con aprobación explícita de Luciano para tocar OC):**
- `ModalDetalleCotizacion.jsx` / `ModalDetalleOC.jsx`: botón "Mapa de relaciones".
- `MapaRelaciones.jsx`: nueva rama `ordenCompraId` — resuelve a compra si ya
  existe, si no a la cadena `sinFacturar` (OC → recepciones), más el caso
  `orden_compra` en `fetchPreviewItems`.
- Verificado en vivo: COT-00029 → PED-004(Facturado) → PED-005(Borrador) →
  ENT-2026-0137; OC-00010 → REC-2026-0005 → REC-2026-0006.

### Fix visual — tarjetas del Mapa de Relaciones sin tamaño homogéneo (`c9ed9e6`)
Cada `NodoMapa` mostraba un subconjunto distinto de campos opcionales
(fecha/total/estado), variando la altura. Fix: `h-[176px]` + `flex flex-col` +
`mt-auto` en el bloque "ver detalle" para anclarlo siempre al mismo Y.

### Fase 2 del plan — Factura de Venta (`04eb4bd`)
- Atajo Enter + fix de foco (mismo patrón `descRefs`/`cantRefs` que Cotizaciones/OC).
- `SaleDetailModal.jsx`: el `<tfoot>` ahora calcula Neto/IVA desde `items` en vez
  de confiar en `comprobantes.neto_gravado`/`iva_discriminado` (35/158 facturas
  reales de Nalux los tienen NULL). Verificado contra una Factura C real con CAE:
  Neto $2.479,34 + IVA $520,66 = Total $3.000,00 exacto.

### Fase 2 del plan — Factura de Compra (`bc98365`)
Era el único documento con precio real sin descuento (ni por línea ni global).
- Migración 326: `detalle_compras.descuento_item` + `compras.descuento_global_pct`
  (NUMERIC 0-100, sin trigger de auditoría — Factura de Compra sigue sin edición
  con historial en esta fase, decisión ya tomada).
- `NuevaFacturaProveedorModal.jsx`: descuento línea+global, atajo Enter, búsqueda
  de productos pasó de precargar 500 productos a `.ilike().limit(8)` server-side.
  Bug colateral encontrado y arreglado: 27% de IVA violaba el CHECK real de
  `detalle_compras.alicuota_iva` (mismo bug que ya se había arreglado del lado
  de Ventas en Fase 0) — sacado de `ALICUOTAS`.
- `ModalDetalleFacturaCompra.jsx` (nuevo): antes Factura de Compra era el único
  documento sin modal de detalle propio (fila expandible inline). Ahora tiene
  Neto/IVA siempre visible (criterio Compras: sin gating por letra, a diferencia
  de Ventas), botón Mapa de Relaciones, Copiar a NC/ND, Devolver a proveedor.
- Verificado en vivo con datos reales: búsqueda "Batidora" trajo `costo_compra`
  real; Enter selecciona y salta foco a Cantidad; 10% desc. línea + 5% global →
  $1.340,64 neto (matemática correcta). Se abortó el registro de una factura de
  prueba real al toparse con el gate de TC del día (moneda paralela) — no se
  inventó un tipo de cambio; se verificó el modal nuevo contra un registro
  real existente en su lugar (Kiosko Achaval, S/N, $4.068,00).

156/156 tests, build limpio en cada commit de esta sesión.

**Pendiente, no arreglado (fuera de alcance de esta fase):** `aplicar_compra_producto`
en `NuevaFacturaProveedorModal.jsx` sigue usando el `precio_unit` sin descontar
como base de costo para la valuación de stock — con líneas descontadas esto
puede sub/sobreestimar el COGS. Anotado, no filed como tarea aparte todavía.

**Siguen pendientes del plan:** Fase 3 (NC/ND emitidas y recibidas — autocomplete
+ IVA visible) y Fase 4 (Devoluciones — modal más grande + Neto/IVA). Se encaran
de a una, con push/deploy al cierre de cada una.

### Fase 3 del plan — NC/ND (emitidas y recibidas): autocomplete + IVA visible
Mismo día (15/08), inmediatamente después de Fase 2. Los 4 formularios standalone
de NC/ND (`NuevaNCModal.jsx`, `NuevaNDModal.jsx` en Ventas; `NuevaNCProveedorModal.jsx`,
`NuevaNotaDebitoModal.jsx` en Compras) tenían el campo `alicuota_iva` en el estado
pero sin ningún `<select>` en la UI para cambiarlo — siempre quedaba en 21% fijo — y
la búsqueda de producto (cuando no hay comprobante/compra origen) era texto libre
sin autocomplete.
- Los 4 modales: agregado `ProductoAutocomplete` (búsqueda server-side
  `.ilike().limit(8)`, mismo patrón que Factura de Compra en Fase 2) + columna IVA
  con `<select>` `[0, 10.5, 21]` en la tabla de ítems. En NC/ND emitidas (Ventas) el
  autocomplete solo se muestra cuando el documento es standalone (`!origenLocked`):
  con comprobante origen los ítems vienen precargados y no tiene sentido buscar otro
  producto. `NuevaNotaDebitoModal.jsx` (Compras) siempre lo muestra — a diferencia de
  NC/ND de Ventas, el origen ahí solo fija el proveedor/referencia, nunca precarga
  ítems.
- Neto/IVA en el detalle de NC/ND **emitidas**: ya venía resuelto gratis por el fix
  de Fase 2 en `SaleDetailModal.jsx` — es el mismo modal genérico para toda la tabla
  `comprobantes` (venta/nota_credito/nota_debito), así que el desglose calculado
  desde ítems ya cubre NC/ND sin tocar nada más.
- Neto/IVA en las tablas planas de NC/ND **recibidas** (`DevolucionesProveedorSection.jsx`):
  agregadas 2 columnas (Neto/IVA) a `NotasDebitoRecibidas` y `NotasCreditoRecibidas`.
  No hizo falta re-arquitecturar nada — `notas_debito.neto_gravado`/`iva_discriminado`
  y `notas_credito_proveedor.neto_gravado`/`iva_discriminado` ya existían como
  columnas de cabecera y ya las llenan las RPCs `crear_nota_debito_proveedor`
  (mig.276) / `crear_nota_credito_proveedor` (mig.277) desde 2026-08-05 — solo
  faltaba seleccionarlas y pintarlas. Fallback `—` para filas viejas con la columna
  en NULL.

Verificado en vivo: "Copiar a NC" sobre una Factura C real ($3.000,00) muestra la
columna IVA (21% pre-cargado) y el desglose Neto $2.479,34 / IVA $520,66 sin
romperse; las tablas de NC/ND recibidas en Compras → Devoluciones muestran las
columnas Neto/IVA correctamente (una ND real preexistente sin el dato guardado
muestra "—", sin crash).

156/156 tests, build limpio.

### Fase 4 del plan — Devoluciones (cliente y proveedor): modal más grande + Neto/IVA
Cierra el plan `PLAN_COMPROBANTES_ESTANDAR.md` completo (Fase 0 a Fase 4, todas
hechas el mismo día 15/08).
- `ModalDetalleDevolucion.jsx` (Ventas, compartido cliente/proveedor):
  `max-w-lg` → `max-w-2xl`; agregado desglose Neto/IVA en el `<tfoot>` (mismo
  criterio que `SaleDetailModal.jsx`: calculado desde los ítems, visible cuando
  hay IVA > 0, sin gating por letra ni por tipo cliente/proveedor).
- `DevolucionesProveedorSection.jsx` → `DevolucionesTab` (panel expandible de
  Devoluciones a Proveedor): agregado `alicuota_iva` a la query de
  `devolucion_items` (faltaba, aunque la columna existe desde mig.262) + Neto/IVA/
  Total en el panel expandido, subtotal por línea visible.
- **Bug real encontrado en vivo durante la verificación de este mismo cambio**:
  el `toLocaleString('es-AR', { minimumFractionDigits: 2 })` sin
  `maximumFractionDigits` mostraba hasta 3 decimales (`$1.295,868` en vez de
  `$1.295,87`) — `Intl.NumberFormat` por defecto permite hasta 3 si no se fija el
  máximo. Afectaba también las columnas Neto/IVA de NC/ND recibidas agregadas en
  Fase 3 (ya en producción). Corregido en los 14 usos nuevos de ambos archivos.

Verificado en vivo: expandiendo DEV-2026-0013 (Batidora Eléctrica 21%, $1.568,00)
se ve Neto $1.295,87 / IVA $272,13 / Total $1.568,00 — exacto, tras el fix del
redondeo.

156/156 tests, build limpio.

**Plan `PLAN_COMPROBANTES_ESTANDAR.md` — 5 fases (0 a 4), todas cerradas.**

---

## Duplicar documentos (estilo SAP) — 15/08

Último punto pendiente de la tanda de comprobantes acordada con Luciano el 14/08.
Definiciones: aplica a todos los documentos con precio propio, advertencia + pregunta
de vínculo en Mapa de Relaciones antes de duplicar, copia todo menos la fecha,
numeración nueva vía `obtener_proximo_numero`.

Decisiones cerradas en esta sesión:
- **NC/ND duplicada nace standalone** — nunca hereda `comprobante_origen_id`/`compra_id`.
- **Devoluciones quedan fuera de esta tanda** (siempre atadas 1:1 a un origen, mueven stock).
- **Factura duplicada nunca hereda campos de CAE** (corrección de Luciano sobre el diseño
  inicial): nace como comprobante nuevo normal, mismo tipo/PdV del original como default
  editable, y se encola a ARCA como cualquier factura nueva si el PdV lo requiere — sin
  bloqueo ni fallback forzado a Ticket.
- **Entregas y Recepciones excluidas** — sin precio propio, duplicar movería stock.

### Migración 327 — `duplicado_de_id`
Columna nullable self-FK (`ON DELETE SET NULL`, sin trigger de auditoría — mismo patrón
que `comprobantes.comprobante_origen_id`) en 7 tablas: `cotizaciones`, `pedidos`,
`ordenes_compra`, `comprobantes` (cubre Factura/NC/ND emitidas), `compras`, `notas_debito`,
`notas_credito_proveedor`. Índices parciales `WHERE duplicado_de_id IS NOT NULL` en las 7.
Aplicada y verificada con SQL en `BEGIN...ROLLBACK` contra datos reales de Nalux: insert
con `duplicado_de_id` + query inversa (`WHERE duplicado_de_id = origen_id`) en las 7 tablas.

### `MapaRelaciones.jsx` — nueva rama "Duplicado de X" / "N duplicados"
`fetchDuplicadoInfo(tipoVisual, id)` resuelve el vínculo para el documento concreto que
abrió el mapa (cotización/pedido/OC/venta/factura_compra — NC/ND recibidas no son entry
point propio del mapa hoy, limitación aceptada). Se muestra como strip debajo del header,
con links clickeables cuando el tipo tiene navegación soportada.

### `ConfirmDuplicarDialog.jsx` (nuevo, compartido)
`AlertDialog` genérico: confirma duplicar + checkbox "Vincular en el Mapa de Relaciones"
(default sí). Reutilizado por los 9 flujos de abajo.

### Los 9 flujos wireados
- **Cotización / Pedido / OC**: botón "Duplicar" en el detalle → confirma → INSERT directo
  (mismo cálculo que "Nueva", sin pasar por el form) → abre el detalle del nuevo documento.
  Cotización usa `createMutation` existente (react-query); Pedido y OC replican el insert
  manual con `duplicado_de_id`.
- **Factura de Venta**: el pre-fill de `comprobanteOrigen` en `NuevaFacturaModal.jsx` YA
  existía (comentario "flujo Copiar a Factura", nunca disparado) — solo faltaba el botón.
  Extendido para también copiar `tipo_comprobante_afip`/`punto_venta_id` como default
  editable (antes solo copiaba cliente/ítems). Botón en `HistorialVentas.jsx` (dropdown de
  fila, disponible para venta/NC/ND ya que la tabla lista los 3 tipos juntos).
- **Factura de Compra**: mismo patrón con `compraOrigen` en `NuevaFacturaProveedorModal.jsx`
  (tampoco tenía botón disparador hasta hoy). Botón en `ModalDetalleFacturaCompra.jsx`.
- **NC/ND emitidas y recibidas (4 modales)**: nuevo prop `duplicarOrigen` (distinto de
  `comprobanteOrigen`/`compraOrigen`/`origen`) — pre-carga ítems + cliente/proveedor editable,
  pero **nunca** setea `p_comprobante_origen_id`/`p_compra_id` (a diferencia de esos props,
  que sí lo hacen — por eso no se podían reusar para duplicar sin romper la decisión de
  standalone). `duplicadoDeId` nuevo prop: UPDATE post-RPC si el usuario eligió vincular.
  Botones en `HistorialVentas.jsx` (NC/ND emitidas) y `DevolucionesProveedorSection.jsx`
  (NC/ND recibidas, ambas tablas planas).

Verificado con SQL en `BEGIN...ROLLBACK` (las 7 tablas + query inversa). **No se pudo
verificar en vivo en el navegador esta sesión** — el panel del Browser no componía frames
(falla técnica de la herramienta, no del código). 156/156 tests, build limpio, 0 errores de
lint (solo warnings preexistentes del mismo patrón que el resto del código).

---

## Sesión 2026-08-15 (noche) — Duplicar documentos + fix crítico + Facturar Pedido (5 frentes, sin construir)

### Duplicar documentos — completo y corregido en dos pasadas
Primera pasada (commit `ac41123`): 9 flujos wireados (Cotización, Pedido, OC,
Factura de Venta, Factura de Compra, NC/ND emitidas y recibidas), migración
327 (`duplicado_de_id`, self-FK en 7 tablas), `ConfirmDuplicarDialog`
compartido, `MapaRelaciones.jsx` con la rama "Duplicado de X"/"N duplicados".

**Bug real encontrado por Luciano probándolo en vivo (commit `fca38e7`):**
Cotización/Pedido/OC duplicaban en silencio (INSERT directo al confirmar) sin
dejar editar nada antes de crear — quedaba el borrador ya creado. El
comportamiento esperado, estilo SAP "Copiar Desde", es abrir el mismo form de
"Nueva X" pre-cargado pero completamente editable (fecha, ítems, cliente),
y recién crear cuando el usuario confirma "Guardar". Factura de Venta/Compra
y los 4 modales de NC/ND ya lo hacían bien desde el principio (usan
`comprobanteOrigen`/`compraOrigen`/`duplicarOrigen` para pre-fill, nunca
insert directo) — no necesitaron cambios. Verificado en vivo (browser real)
en los 3 flujos corregidos.

### Facturar Pedido — 5 problemas reportados por Luciano, 0 construidos
Ver `PLAN_FACTURAR_PEDIDO_5_FRENTES.md` (raíz del repo) para el detalle
completo — quedó investigado y diseñado (sobre todo el Frente 2), pero
**nada se construyó todavía**, queda para que Nadia (u otra sesión) lo tome:

1. Visual/diseño del modal no respeta la línea del resto de la app.
2. **Facturar lo entregado, no lo pedido** — diseño cerrado al detalle: el
   backend (`crear_venta`, mig.156) YA calcula bien el tope
   entregado-vs-facturado: el bug es 100% de precarga en
   `NuevaFacturaModal.jsx` (usa `pedido_items[].cantidad` en vez de
   `cantidad_entregada - cantidad_facturada`).
3. Sin acceso a Mapa de Relaciones desde ese modal.
4. **Factura de Reserva** (nueva) — facturar el pedido completo sin entregar,
   entregar después. No existe hoy ningún concepto así; requiere RPC nueva y
   revisar si se puede generar una Entrega para un Pedido ya `facturado`.
5. **Desacoplar cobro de emisión** — el ERP no debe cobrar en el momento como
   el POS; la Factura debe emitirse (con CAE) y quedar siempre como Open Item
   en Cuenta Corriente, cobrándose después. Hallazgo importante: el sistema
   de Cobro con Open Item **ya existe y funciona**
   (`CuentaCorrienteSection.jsx` + `ModalCobro.jsx` + RPC
   `registrar_cobro_cliente`, imputación FIFO, mig.169) — este frente es
   sobre todo sacar el selector "Forma de pago" de `NuevaFacturaModal.jsx`,
   no construir el cobro de cero. Confirmado con Luciano: aplica igual a
   Facturar Pedido, Facturar Entrega y Nueva Factura standalone; el POS
   (Modo Caja) no se toca.

Todo pusheado y deployado (`fca38e7`, más `PLAN_FACTURAR_PEDIDO_5_FRENTES.md`
sin migraciones ni código nuevo asociado).

---

## Sesión 2026-08-15 (noche) — Facturar Pedido: Frente 3 y Frente 1 (de `PLAN_FACTURAR_PEDIDO_5_FRENTES.md`)

Nadia retomó `PLAN_FACTURAR_PEDIDO_5_FRENTES.md` que Luciano dejó armado. Orden sugerido:
Frente 3 → Frente 1 → Frente 5 → Frente 4. Se hicieron los dos primeros.

### Frente 3 — Mapa de Relaciones en el modal de Facturar Pedido
`NuevaFacturaModal.jsx` no tenía botón "Mapa de relaciones", a diferencia de casi todos los
demás documentos del sistema. Agregado el mismo patrón que `ModalDetallePedido.jsx`: botón
que abre `<MapaRelaciones pedidoId={pedido.id} .../>` (o `comprobanteId={comprobanteOrigen.id}`
en el flujo "Copiar/Duplicar a Factura") — solo se muestra cuando hay algo que mapear; una
factura nueva en blanco todavía no tiene cadena de documentos. Verificado en vivo: abre la
cadena Cotización → Pedido (ACTUAL) → Entrega sin cerrar el modal de facturación de fondo, y
al cerrar el mapa el modal sigue intacto con todos sus datos.

### Frente 1 — Visual/diseño: alinear con la línea densa estilo SAP
Comparado el código directo contra `FormNuevaCotizacion.jsx`/`FormNuevaOC.jsx` (ya rediseñados)
para diagnosticar qué puntualmente estaba desalineado, en vez de adivinar:

1. Modal angosto y centrado (`max-w-5xl`) → pantalla casi completa (`max-w-[96vw] w-[96vw] h-[92vh]`).
2. Cabecera aireada (inputs h-10, grid-4) → grilla densa de 12 columnas con inputs h-8, dentro
   de un `Card`, mismo criterio que Cotización/OC/Pedido.
3. **Hallazgo más importante**: el buscador de producto todavía usaba el patrón viejo
   (`position: absolute` sin portal, dentro de una `<table>`) — el mismo que tenía el bug del
   desplegable cortado arreglado el 14/08 en los otros 3 formularios, nunca migrado acá.
   Reemplazado por el componente compartido `ProductoAutocomplete.jsx`. La tabla de ítems pasó
   a la misma grilla de 12 columnas con filas `<div>` que usan Cotización/OC/Pedido.
4. Scroll: antes todo el modal scrolleaba junto (banner + cabecera + ítems + totales en un solo
   contenedor); ahora solo la lista de Ítems tiene su propio scroll interno, dejando cabecera y
   totales siempre a la vista — mismo criterio que Cotización/OC/Pedido.

**`ProductoAutocomplete.jsx` ganó un prop `onBlur`** (antes no lo tenía — ningún otro llamador
lo necesitaba, `NuevaFacturaModal` sí para cerrar el desplegable al perder foco, mismo
comportamiento que ya tenía).

**Dos bugs reales encontrados y corregidos verificando el rediseño en vivo, antes de darlo por
terminado:**

1. **El foco saltaba solo al último ítem y le abría el desplegable de autocompletar**, sin que
   el usuario tocara nada, cada vez que se abría "Facturar Pedido". Causa: el efecto que enfoca
   "el último ítem agregado" (pensado para cuando el usuario aprieta "Agregar ítem" de a uno)
   usaba `items.length > prevItemsLength.current` — eso también se disparaba al precargar de
   golpe los 3 ítems de un pedido (1 → 3). Fix: solo dispara cuando la lista creció de a UNO
   (`=== prevItemsLength.current + 1`), nunca en una carga masiva. (De paso se agregó también
   `onOpenAutoFocus={(e) => e.preventDefault()}` al `DialogContent`, mismo guard que ya usa
   Cotizaciones, como defensa adicional — no era la causa real, pero es el patrón correcto.)
2. **En pantallas bajas, la tarjeta de Ítems completa podía desaparecer** (con su botón
   "Agregar ítem" y todas las filas) hasta 0px de alto, sin scroll posible — pasaba incluso con
   un solo ítem vacío en el flujo standalone. Causa: `flex-1 min-h-0` permite que un hijo
   flexbox se encoja hasta cero cuando no alcanza el espacio, y el contenedor padre tenía
   `overflow-hidden` (nada se podía scrollear para compensar). El botón "Crear Factura" nunca
   corrió riesgo (vive en el `DialogFooter`, fuera de esta zona), pero los ítems sí quedaban
   inalcanzables. Fix: `min-h-[220px]` en la tarjeta de Ítems (nunca se encoge por debajo de
   eso) + el contenedor del cuerpo pasó de `overflow-hidden` a `overflow-y-auto` como red de
   seguridad — en el caso normal no se nota (los Ítems scrollean solos como siempre), en el caso
   extremo el modal entero scrollea en vez de perder contenido.

Verificado en vivo (browser real) en los dos flujos: "Facturar Pedido" (PED-20260814-002, 3
ítems reales) y "Nueva Factura" standalone — desplegable de producto completo y funcionando,
selección con foco saltando a Cantidad, sin el salto de foco fantasma, tarjeta de Ítems siempre
visible y alcanzable. `npx eslint` sin errores nuevos (solo warnings preexistentes del mismo
patrón que el resto del código), `npx vitest run` 156/156, `npx vite build` OK — verificado
después de cada fix.

**Siguen pendientes del plan**: Frente 5 (desacoplar el cobro de la emisión) y Frente 4
(Factura de Reserva) — ver detalle completo en `PLAN_FACTURAR_PEDIDO_5_FRENTES.md`.

---

## Sesión 2026-08-15 (noche) — Facturar Pedido: Frente 5, desacoplar el cobro de la emisión

Siguiendo el orden sugerido del plan (3 → 1 → 5 → 4), tercer frente de la noche.

### Qué cambia
Palabras textuales de Luciano en el plan: *"aquí no debe comportarse como venta POS, aquí se
debe comportar como un ERP y como lo hace SAP"*. Hasta ahora `NuevaFacturaModal.jsx` tenía un
selector "Forma de pago" (Efectivo/Transferencia/Tarjeta/etc.) y, si no era Cuenta Corriente,
cobraba en el momento (insertaba en `movimientos_caja`) — mezclando la emisión fiscal de la
factura con el cobro, cosa que un ERP con lógica de Open Item no hace: la factura se emite con
su CAE y queda como deuda; el cobro es un evento aparte, posterior, que puede llegar
parcial, en otra fecha, con otro medio de pago, etc.

**Hallazgo clave (ya estaba, no se construyó de cero):** el sistema de cobro Open Item —
`CuentaCorrienteSection.jsx` + `ModalCobro.jsx` + RPC `registrar_cobro_cliente` (imputación
FIFO automática, vista `facturas_saldo_pendiente`, mig.169) — ya funciona en producción. Este
frente fue sacar el cobro de `NuevaFacturaModal.jsx`, no construir el cobro.

### Cambios en `NuevaFacturaModal.jsx`
- Eliminado el selector "Forma de pago" (constante `FORMAS_PAGO`, estado `formaPago`, `isCC`) y
  todo el bloque de UI correspondiente (botones de medio de pago + aviso ámbar de CC).
- Eliminada la dependencia de `useCaja` (`currentSession`/`isSessionOpen`) — ya no aplica el
  requisito "caja abierta para cobrar en efectivo", porque acá ya no se cobra nunca.
- Reemplazado por una tarjeta informativa fija: *"Esta factura queda pendiente en la Cuenta
  Corriente del cliente. El cobro se registra después, desde Cuenta Corriente."*
- **Las dos rutas de creación** (RPC `crear_venta` cuando viene de un Pedido, e INSERT manual
  cuando es standalone/duplicado) ahora siempre fuerzan `forma_pago='Cuenta Corriente'`,
  `estado_pago='pendiente'`, `p_pagos: []`, `p_es_cc: true` — nunca insertan en
  `movimientos_caja`, siempre generan su movimiento en `cuenta_corriente_movimientos` (DEBE).
- **Cambio de comportamiento deliberado**: como toda factura ahora genera deuda en Cuenta
  Corriente, el cliente pasa a ser **obligatorio siempre** (antes solo era obligatorio si elegías
  Cuenta Corriente como forma de pago). No hay deuda sin dueño — se marcó con asterisco rojo en
  el label y un toast explícito si falta.
- Aplica a los 3 flujos que comparten este modal: Facturar Pedido, Facturar Entrega y Nueva
  Factura standalone. El POS (`NuevaVentaModal.jsx`, Modo Caja) **no se tocó** — sigue cobrando
  en el momento como corresponde a un punto de venta.

### Verificación
`npx eslint` sin errores nuevos, `npx vitest run` 156/156, `npx vite build` OK (4m 16s, exit 0).
Además, verificado en vivo contra la base real (no rollback, son comprobantes reales de prueba
en Nalux) en las dos rutas de código:

- Standalone: `FAC-20260815-002` — `forma_pago='Cuenta Corriente'`, `estado_pago='pendiente'`,
  1 movimiento DEBE en `cuenta_corriente_movimientos`, 0 filas en `movimientos_caja`.
- Desde Pedido (RPC `crear_venta`): `FAC-20260815-003`, generada facturando `PED-20260814-002`
  — mismo resultado: CC pendiente, sin caja.

### Notas sueltas, sin resolver
- **"Cheque" no existe como forma de pago** en `formas_pago` de Nalux (solo hay Efectivo, QR
  MercadoPago, Tarjeta Crédito, Tarjeta Débito, Transferencia) — no bloquea nada de este frente
  (ya no se usa el selector acá), pero es dato de catálogo que puede faltar en otro lado.
- ~~**Comprobante `FAC-20260815-001` sin explicación**~~ **RESUELTO** — investigado: es un flujo
  real y completo (Cotización `COT-00032` → Pedido `PED-20260815-001` → Entrega `ENT-2026-0140` →
  Factura, los 4 pasos a las 10:17-10:19 hs de hoy, con su movimiento de caja y asiento contable
  bien generados, sin datos huérfanos). El `user_id` en `movimientos_caja` es el de Nadia, pero
  el horario (mañana, mucho antes de esta sesión) coincide con el test en vivo que hizo Luciano
  probando "Facturar Pedido" — el mismo que originó los 5 problemas de
  `PLAN_FACTURAR_PEDIDO_5_FRENTES.md`. Se ve con el comportamiento viejo (cobra Efectivo en el
  momento) porque es de ANTES de que se desplegara el Frente 5 esa misma noche. Confirmado con
  Nadia: es válido, se deja como está, no se toca.
- `PED-20260814-002` y los dos comprobantes de prueba (`FAC-20260815-002`/`003`) son datos reales
  en el tenant de Nalux, no se revirtieron — mismo criterio que el resto de la sesión (se
  documentan en vez de tocarlos sin pedir confirmación).

**Sigue pendiente del plan**: Frente 4 (Factura de Reserva) — ver
`PLAN_FACTURAR_PEDIDO_5_FRENTES.md`. El punto 4 del propio Frente 5 (si el botón "Cobrar" debería
vivir en Bancos en vez de en Cuenta Corriente) quedó explícitamente "a definir con Luciano", sin
tocar.

---

## Sesión 2026-08-15 (noche) — Facturar Pedido: Frente 4, Factura de Reserva

Último frente del plan. Con Frente 3 → 1 → 5 cerrados, se retomó directo con Frente 4 (el más
grande: requería RPC nueva, no solo frontend). Antes de tocar código se investigaron a fondo los
3 puntos que el plan dejaba explícitamente abiertos ("hay que diseñar antes de construir"):

1. **Estado de Pedido**: `facturado` ya era terminal (`next: null` en `shared.jsx`) — no hacía
   falta un estado nuevo.
2. **¿Se podía generar una Entrega para un Pedido ya `facturado`?** Confirmado que **no**: el
   gate `puedeEntrega` en `TablaPedidos.jsx`/`ModalDetallePedido.jsx` excluía explícitamente el
   estado `facturado` (`['confirmado', 'en_preparacion'].includes(...)`), aunque la RPC
   `crear_entrega` en sí nunca tuvo ningún check de estado — el único bloqueo era ese gate de
   frontend.
3. **Mapa de Relaciones**: revisado `fetchMapaVenta` — busca la Entrega por `pedido_id` sin
   asumir ningún orden cronológico respecto a la Factura, así que no se rompía si la Entrega
   llegaba después. Confirmado también en vivo (ver Verificación).

Quedaba una decisión de producto real que el plan marcaba "a confirmar con Luciano" (no
investigable desde el código) — se le consultó a Nadia directamente: **checkbox en el mismo
modal de Facturar Pedido** (no un botón separado), y **alcance solo Facturar Pedido** (no
"Nueva Factura" standalone, que no tiene nada que "reservar" sin un pedido de por medio).

### Cambios

**`crear_venta`** (mig. `328`/`328b`) — parámetro nuevo `p_factura_reserva boolean DEFAULT false`
al final de la firma (ningún llamador existente cambia de comportamiento). Cuando es `true`:
guard (requiere `p_pedido_id`, y que el pedido NO tenga ya una Entrega manual — sería
contradictorio "reservar" algo ya entregado), fuerza a no mover stock sin importar el ítem, y no
genera ninguna Entrega (ni implícita, la que hoy se crea siempre que no hay una manual previa).
El resto del cuerpo es idéntico al de la mig. 325.

**Hallazgo real de seguridad, no relacionado con este frente** (verificado contra
`pg_proc.proacl` en producción): la migration 325 de esta misma noche había creado su sobrecarga
de `crear_venta` **sin repetir el bloque `REVOKE ALL FROM PUBLIC, anon` / `GRANT TO
authenticated`** que tienen todas las migraciones anteriores de esta función — quedó con EXECUTE
abierto a `anon` y `PUBLIC` por privilegio default de Postgres. Corregido en la mig. `328b`, que
de todos modos reemplazaba esa sobrecarga (mismo bug de "CREATE OR REPLACE con parámetro nuevo
crea sobrecarga, no reemplaza" ya documentado en la 325b — acá se repitió y se corrigió con el
mismo patrón).

**`TablaPedidos.jsx` / `ModalDetallePedido.jsx`**: `puedeEntrega` ahora incluye `facturado` en la
lista de estados válidos (además de `confirmado`/`en_preparacion`), sin tocar la condición de
`hayPendiente` — un pedido facturado normal (sin nada pendiente) sigue sin mostrar el botón, pero
uno facturado como Reserva (con todo pendiente de entregar) ahora sí.

**`NuevaFacturaModal.jsx`**: checkbox "Factura de Reserva — no entregar todavía", visible solo
cuando `pedido?.id` y el pedido todavía no tiene ninguna Entrega manual (mismo query exacto que
usa `crear_venta` para decidir si mueve stock). Tildado, pasa `p_factura_reserva: true` a la RPC
y cambia el texto del banner informativo para explicar que no se descuenta stock ni se genera
Entrega.

### Verificación

`npx eslint` sin errores nuevos, `npx vitest run` 156/156, `npx vite build` OK (4m 17s, exit 0).

Antes de tocar el frontend, la RPC se probó **dentro de transacciones con ROLLBACK** contra la
base real (mismo criterio que usó Luciano para probar la 325), simulando la sesión autenticada
con `SET LOCAL ROLE authenticated` + `request.jwt.claim.sub`: reserva sin mover stock/sin
Entrega/con el DEBE correcto en Cuenta Corriente, los dos guards (reserva sin pedido, reserva
sobre un pedido ya entregado) rechazando con el mensaje esperado, y el camino normal (sin pasar
el parámetro nuevo) sin ningún cambio de comportamiento.

Después, ciclo completo en vivo (browser real, datos reales de Nalux, no rollback) sobre
`PED-20260813-001` (3 ítems, sin Entrega previa):
1. "Facturar Pedido" con el checkbox tildado → `FAC-20260815-004` ($125.002) creada:
   `forma_pago='Cuenta Corriente'`, `estado_pago='pendiente'`, stock de los 3 productos sin
   tocar, 0 Entregas generadas, 0 `movimientos_caja`, 1 movimiento DEBE en Cuenta Corriente por
   el total, pedido pasado a `facturado`, `pedido_items.cantidad_facturada` = cantidad total en
   los 3 (0 `cantidad_entregada`).
2. El pedido ya `facturado` mostró el botón "Generar Entrega" (ya no "Facturar pedido", que
   desaparece solo porque `getEstado('facturado').next` es `null`) — confirma el fix del gate.
3. "Generar Entrega" → `ENT-2026-0141` creada (`origen='manual'`, `estado='entregado'`), stock
   ahora sí descontado en los 3 productos exactamente en las cantidades correctas,
   `pedido_items.cantidad_entregada` igualado a `cantidad_facturada`.
4. Mapa de Relaciones sobre esa cadena: `Pedido PED-20260813-001 → Entrega ENT-2026-0141 →
   Factura FAC-20260815-004`, total $125.002,00 correcto — confirma que no importa que la
   Entrega haya llegado cronológicamente después de la Factura.

### Hallazgo cosmético, sin resolver (no bloqueante)
El detalle de la Entrega (modal `ModalDetalleEntrega` o similar) muestra el campo "Factura: Sin
facturar" para una Entrega generada después de una Factura de Reserva — porque ese campo lee
`entregas.comprobante_id` directamente, que en este flujo queda `NULL` (el vínculo real es
`pedido_id` compartido, no un `comprobante_id` directo en la Entrega). El dato real es correcto
—el Mapa de Relaciones sí resuelve bien la cadena completa por `pedido_id`— es solo esa etiqueta
puntual la que no contempla este caso nuevo. No se tocó (fuera del alcance pedido).

### Datos de prueba reales, no revertidos
`FAC-20260815-004` ($125.002, Consumidor Final), `ENT-2026-0141` y `PED-20260813-001` (ahora
`facturado` y 100% entregado) son datos reales en el tenant de Nalux — mismo criterio que el
resto de la sesión: se documentan, no se revierten sin pedir confirmación.

**4 de los 5 frentes de `PLAN_FACTURAR_PEDIDO_5_FRENTES.md` quedan construidos** (3, 1, 5 y 4,
todos esta noche). Sigue pendiente el **Frente 2** ("Facturar lo entregado, no lo pedido") — quedó
diseñado en detalle en el plan (con línea exacta de `NuevaFacturaModal.jsx` a tocar) pero **no se
construyó** en esta sesión porque no fue pedido; el diseño sigue vigente en
`PLAN_FACTURAR_PEDIDO_5_FRENTES.md` para cuando se retome.

---

## Sesión 2026-08-15 (noche) — Facturar Pedido: Frente 2, facturar lo entregado (no lo pedido)

Último frente del plan, cerrando los 5. El diseño ya estaba resuelto al detalle en
`PLAN_FACTURAR_PEDIDO_5_FRENTES.md` desde la investigación previa — implementado tal cual estaba
documentado, sin sorpresas.

### Qué cambia
Bug real reportado por Luciano: si un Pedido tuvo una Entrega (total o parcial), "Facturar
Pedido" seguía ofreciendo facturar la cantidad PEDIDA de cada ítem, no la ENTREGADA — un pedido
con 2 de 4 ítems entregados mostraba los 4 con su cantidad completa, dejando que el usuario
facturara de más sin darse cuenta (la RPC lo hubiera rechazado recién al confirmar, con una
excepción poco clara ahí).

**El backend (`crear_venta`, mig. 156/325/328) ya estaba bien** — no se tocó. Ya calculaba el
tope correcto por ítem (`cantidad_entregada - cantidad_facturada` si hubo Entrega manual,
`cantidad - cantidad_facturada` si no) y ya rechazaba con excepción si se facturaba de más. El
bug era 100% de precarga en el frontend.

### Cambio en `NuevaFacturaModal.jsx`
El mismo query que ya se agregó para el Frente 4 (¿el pedido tiene una Entrega manual
`entregado`?) ahora también decide el tope de precarga por ítem — un solo fetch cubre los dos
frentes, mismo criterio exacto que usa la RPC para no poder divergir de ella:
- Con Entrega manual → `cantidad: cantidad_entregada - cantidad_facturada` por ítem.
- Sin Entrega manual → `cantidad: cantidad - cantidad_facturada` (comportamiento histórico, sin
  cambios — un pedido nunca entregado sigue ofreciendo facturar el total).
- Ítems con tope `<= 0` (nada pendiente para ese ítem puntual) se excluyen de la lista, no se
  precargan en cero.
- Si NINGÚN ítem queda facturable, toast claro ("Nada pendiente de facturar — este pedido ya está
  totalmente facturado según lo entregado") y la lista de ítems queda vacía, en vez de abrir un
  formulario con datos incorrectos o dejar que el usuario choque con la excepción del RPC recién
  al confirmar.
- Banner informativo actualizado: cuando el pedido ya tuvo una Entrega, ahora aclara "los ítems
  de abajo vienen ajustados a lo pendiente de facturar (no lo pedido)".
- El usuario sigue pudiendo editar la cantidad a mano si hace falta — el default ya viene
  correcto, no es un límite duro en el input (el límite duro sigue siendo la RPC).

### Verificación
`npx eslint` sin errores nuevos, `npx vitest run` 156/156, `npx vite build` OK.

Contra datos reales de Nalux, sin fabricar nada:
- `PED-20260725-002` (Luciano, 4 ítems: 2 entregados, 2 sin entregar) — réplica exacta del
  algoritmo de precarga contra sus datos reales confirmó que sólo quedan facturables "Camiseta
  Argentina" y "Aramis TESTE Azul marino" (cantidad 1 cada uno), excluyendo "Termo Stanley" y
  "Tartas" (0 entregado). No se probó con click real porque el pedido está en estado `confirmado`
  (el botón "Facturar pedido" sólo aparece en `en_preparacion`) y avanzarlo de estado sin motivo
  real hubiera sido tocar un pedido activo de Luciano sin necesidad.
- `PED-20260811-002` (en `en_preparacion`, 2 ítems, ambos 100% entregados) — probado con click
  real en el modal: banner cambia correctamente a "este pedido ya tuvo una Entrega...", ambos
  ítems precargan con cantidad `1` (coincide con lo entregado). Cerrado con "Cancelar" sin crear
  ningún comprobante — esta verificación era de precarga (sólo lectura), no hacía falta facturar
  de verdad para confirmarla.
- No se tocó ningún pedido nunca entregado para confirmar que sigue precargando la cantidad
  pedida completa (sin regresión) — la rama de código es la misma de siempre, sin cambios, y ya
  se había ejercitado sin querer en las pruebas del Frente 4 (`PED-20260813-001`, sin Entrega,
  precargó su cantidad pedida completa correctamente).

**Con este frente, los 5 de `PLAN_FACTURAR_PEDIDO_5_FRENTES.md` quedan construidos, probados y
desplegados.**

---

## Sesión 2026-08-16 (madrugada) — Migración a la cuenta nueva de Supabase (`PLAN_MIGRACION_SUPABASE.md`)

Con la organización NALUX restringida desde el 17/08 por cuota excedida (plan free), se migró
todo Kairox Gestión a una cuenta nueva (`kairoxiainfo@gmail.com`), proyecto **"Kairox-gestión
(nuevo)"** (`ref: isvkelrdxwvkfmrfqxxk`, región `sa-east-1`). Ver `PLAN_MIGRACION_SUPABASE.md`
para el plan original.

### Hallazgo de entrada: el MCP de Supabase no puede ver dos cuentas a la vez
El conector de Supabase queda autorizado a UNA cuenta. Cambiarlo a la cuenta nueva significa
perder el acceso a la vieja por ese camino. Solución: todo el trabajo contra ambas bases se hizo
por **conexión directa a Postgres** (librería `pg` de Node, sin necesitar `pg_dump`/`psql`, que no
están instalados en este entorno) — el pooler de sesión de Supabase (`aws-N-sa-east-1.pooler.
supabase.com:5432`, usuario `postgres.<ref>`) es alcanzable desde acá; el host directo
(`db.<ref>.supabase.co`) no resuelve (requiere IPv6 o el add-on de IPv4 pago). Cada proyecto tiene
su propio número de pooler (la vieja: `aws-1`; la nueva: `aws-0` — no asumir que es el mismo).

### Fase 1 — Schema (323 migraciones)
El historial de migraciones aplicadas en Supabase (`list_migrations`) no coincide 1:1 con los
323 archivos del repo:
- **17 migraciones fundacionales (000-017)** no aparecen en el historial rastreado — se aplicaron
  antes de que existiera el tracking, pero sus tablas obviamente existen y se usan (cotizaciones,
  órdenes de compra, cajas, etc.). Se incluyeron igual en el replay, ordenadas primero por número.
- **~35 nombres aplicados sin archivo correspondiente** (ej. `037_devoluciones_nd_rpcs`,
  `282b_grant_cheques_asiento_errores`, `test_probe`, `299_webhook_debug_temporal` +
  `300_drop_webhook_debug_temp`) — verificado caso por caso: son hotfixes que después se
  consolidaron en su migración numerada actual, o pares crear+revertir (debug temporal) que ya no
  están en el repo. Ninguno bloqueaba nada real.
- Orden final de ejecución: número de prefijo (con las variantes `b` justo después de su base),
  usando el `version` real de `list_migrations` como desempate para los pocos casos sin prefijo
  numérico. Las 323 corrieron **sin errores**, salvo una: `297_qr_mercadopago_pos.sql` mezclaba
  schema con una fila semilla hardcodeada para el `empresa_id` de Nalux (`INSERT INTO
  formas_pago`) — falla de FK en la base vacía (sin datos todavía). Se parcheó al vuelo (se
  saltea esa sentencia puntual, la trae el dump de datos de la Fase 2 igual).

**3 diferencias reales de schema encontradas comparando objeto por objeto contra la base vieja**
(no capturadas en ningún archivo — drift manual de producción, mismo patrón que ya se vio esta
noche con el `297`):
1. `pedidos` le faltaban los triggers `trg_audit_pedidos`/`trg_pedidos_updated_at` — ningún
   archivo del repo actual los crea con ese nombre exacto (`017` sólo crea los viejos
   `audit_pedidos`/`set_pedidos_updated_at`, que `056` elimina a propósito). Recreados a mano con
   la definición exacta traída de la base vieja (`pg_get_triggerdef`).
2. `periodos_contables` tenía 2 políticas RLS de más (`pc_select`/`pc_admin_write`, de la
   migración `016`) que en la vieja fueron reemplazadas por 3 más granulares (`periodos_select`/
   `insert`/`update`, de la `027`+`136`) sin que ninguna migración las borrara. Eliminadas a mano
   para que coincida.
3. 5 índices de performance faltantes (`idx_comprobantes_tipo`, `idx_comprobantes_origen`,
   `idx_configuracion_empresa`, `idx_comprobante_pagos_comprobante`, `idx_integraciones_empresa`)
   — recreados con la definición exacta de la vieja.
4. `cuenta_corriente_movimientos.cliente_id` es `NOT NULL` en el schema del repo pero la base
   vieja tiene 4 filas reales con `cliente_id NULL` (la restricción se sacó en algún momento sin
   migración) — se sacó la restricción en la nueva para que coincida. De paso se encontró que
   `created_at` de esa misma tabla era al revés (`NOT NULL` en la vieja, nullable en la nueva) —
   corregido también.

Verificación final: tablas, funciones, políticas, índices y triggers **coinciden exactamente**
entre las dos bases (la única función de más en la nueva, `rls_auto_enable()`, es de la propia
plataforma de Supabase por el toggle "RLS automático" activado al crear el proyecto, no es del
repo).

### Fase 2 — Datos (85 tablas, `public` + `auth.users`/`auth.identities`)
Extracción con un script Node (`SELECT jsonb_agg(t) FROM tabla t` por tabla, sin necesitar
`pg_dump`) y carga con `INSERT ... SELECT * FROM jsonb_populate_recordset(...)` (Postgres castea
cada campo al tipo real de la columna — evita armar INSERTs a mano). Carga hecha con
`SET session_replication_role = replica` para no depender de calcular el orden de dependencias
entre 85 tablas.

Dos problemas puntuales, ambos resueltos:
- `arca_worker_run` (tabla de lock del cron de ARCA, no dato de negocio): su propia migración ya
  sembró la fila inicial al crear la tabla — chocaba en PK con la misma fila del dump. Se excluyó
  del dump/carga, el estado "en reposo" que deja el schema es el correcto para un deploy nuevo.
- `auth.users.confirmed_at` y `auth.identities.email` son columnas `GENERATED ALWAYS` — un
  `INSERT ... SELECT *` las nombra igual (aunque el JSON no las traiga, salen NULL) y Postgres
  rechaza cualquier INSERT que las nombre. Se armó la lista explícita de columnas sin ellas para
  esas dos tablas específicamente.

`auth.users`/`auth.identities` migradas para que nadie tenga que resetear su contraseña.
Secuencias (`audit_log_id_seq`, `rate_limit_attempts_id_seq`) reseteadas a su `MAX(id)` real
después de cada carga.

**Re-sync final antes del corte**: como pasó tiempo real entre el primer volcado y el momento de
conectar la app de verdad, se repitió la extracción completa y se truncó+recargó la nueva (TRUNCATE
de las 83 tablas de `public` — `auth.*` se dejó afuera del truncate a propósito: `CASCADE` sobre
`auth.users` arrastraría tablas internas de Supabase como sesiones/refresh tokens que no están en
el dump, y nadie se logueó de nuevo en esa ventana). Verificación final: **las 85 tablas coinciden
exacto** entre vieja y nueva.

### Fase 3 — Storage (15 archivos, `logos-empresa` + `productos-imagenes`)
Ambos buckets son públicos para lectura — se descargaron por URL directa de la vieja y se subieron
a la nueva por la API de Storage (`POST .../storage/v1/object/<bucket>/<path>` con la
`service_role key` del proyecto nuevo, que bypasea las políticas RLS de storage). Los buckets ya
existían en la nueva (los crea la migración `223_bucket_storage_logos_empresa.sql`, ya corrida en
la Fase 1). 15/15 copiados, verificado byte a byte (mismo `content-length` en ambos lados).

### Fase 4a — Edge Functions (30 funciones)
El MCP de Supabase no puede desplegar funciones en un proyecto de otra cuenta (mismo problema de
"una cuenta a la vez"). Se instaló la CLI de Supabase por `npx` (no hace falta Docker para un
deploy simple, sólo tira un warning) y se desplegó cada función con `SUPABASE_ACCESS_TOKEN` (un
**Personal Access Token** de la cuenta, generado en supabase.com/dashboard/account/tokens —
distinto de la contraseña de base de datos y del `service_role key`, es el tercer tipo de
credencial de esta migración).

`supabase/config.toml` sólo tiene `verify_jwt` explícito para 2 de las 30 funciones — para el
resto, la fuente de verdad real es `list_edge_functions` contra la base vieja (mismo patrón de
"el archivo no refleja lo que hay en producción" de toda la noche). Desplegadas las 30 con el
`verify_jwt` exacto de la vieja. 2 funciones que existen en la vieja pero no en el repo
(`mp-debug-confirm`, `mp-debug-list-stores` — debug descartable) se dejaron afuera a propósito.

Un solo error real: la primera prueba manual de `mp-verify-token` se desplegó por accidente con
`--no-verify-jwt` (debía ser `true`). La CLI **no tiene un flag para forzar `verify_jwt=true`**
(sólo `--no-verify-jwt` para desactivarlo) y, una vez en `false` remoto, volver a desplegar sin
pasar ningún flag NO lo reactiva solo — hay que usar la API de administración de Supabase
(`PATCH https://api.supabase.com/v1/projects/{ref}/functions/{slug}` con `{"verify_jwt": true}`
y el Personal Access Token). Corregido y verificado.

### Fase 4b — Integraciones (MercadoPago, AFIP, Tiendanube, MercadoLibre)
**Pendiente a propósito** — Nadia pidió dejar todas las integraciones/secrets para el final. El
token de MercadoPago y el certificado de AFIP están en el Vault de Supabase (encriptados con la
clave del proyecto viejo) y **no viajan con ningún volcado** — hay que volver a cargarlos a mano
desde la pantalla de Configuración de KAIROX, apuntando ya al proyecto nuevo. Mismo criterio para
los secrets chicos de las Edge Functions (`AFIP_ENVIRONMENT`, `TIENDANUBE_APP_ID`/`CLIENT_SECRET`,
`MELI_APP_ID`/`CLIENT_SECRET`, etc.).

### Corte real — decisión de Nadia
Nadia confirmó explícitamente: "hoy no tenemos clientes reales trabajando, no hay problema en
conectar la app" — autorizó el corte real sin esperar a que las integraciones estén cargadas
(los pagos con MercadoPago y la facturación AFIP van a quedar rotos hasta que se complete la
Fase 4b, ella lo tiene claro).

**Conector de Claude Code**: reautorizado por Nadia a la cuenta nueva — confirmado viendo el
proyecto "Kairox-gestión(nuevo)" vía `list_projects` y una consulta real (`empresas`, 6 filas,
coincide). Ya no hace falta la conexión directa por `pg` para trabajar contra la base nueva
(aunque las credenciales siguen guardadas en los scripts de esta sesión por si hace falta
comparar algo más contra la vieja).

**Vercel**: Nadia decidió dejarlo como tarea para Luciano (tiene él la cuenta). Variables a
actualizar en Vercel → proyecto → Settings → Environment Variables (sólo estas 2, las de Ualá
son de otro proyecto y no se tocan):
```
VITE_SUPABASE_URL=https://isvkelrdxwvkfmrfqxxk.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key del proyecto nuevo, ver Settings → API>
```
Después de guardarlas, hace falta un **Redeploy** del último deploy de Production (Vercel no
recarga env vars solo, necesita un redeploy explícito).

### Pendiente para cerrar la migración
1. Luciano: actualizar las 2 variables en Vercel + Redeploy.
2. Fase 4b: recargar token de MercadoPago + certificado AFIP + secrets de integraciones, ya
   apuntando al proyecto nuevo (desde Configuración de KAIROX).
3. Confirmar proveedores de login / URLs de redirect en Auth del proyecto nuevo (Fase 5 del plan
   original, no verificada todavía).
4. Reconfigurar el webhook de MercadoPago a la nueva URL del proyecto.
5. Una vez confirmado que todo funciona end-to-end: dejar el proyecto viejo sin borrar unas
   semanas como respaldo (Fase 9 del plan original).

### Vault copiado (los 8 secrets de integraciones) — 16/08
Descubrimiento que cambia el plan de la Fase 4b: **los secrets del Vault SÍ se pueden copiar**.
La CLI de Supabase no los deja leer entre cuentas distintas (`secrets list` contra el proyecto
viejo devuelve 403, el Personal Access Token es de la cuenta nueva y no tiene ningún permiso
sobre la vieja), pero el Vault no es un secret de plataforma sino una tabla de la base:
`vault.decrypted_secrets` se lee por conexión directa de Postgres con el rol `postgres`, que es
justamente la vía que ya veníamos usando para todo lo demás.

Copiados los 8 con `vault.create_secret(valor, nombre, descripcion)` en la base nueva, **con el
mismo nombre exacto** para que el código de la app (`vault_secret_read('mp_access_token_' ||
empresa_id)`, `afip_cert_<empresa_id>`, etc.) los encuentre sin tocar una línea:

| Secret | Empresa |
|---|---|
| `afip_cert_*` + `afip_key_*` | las 2 empresas que tienen AFIP configurado |
| `mp_access_token_*` | Nalux |
| `mercadolibre_access_token_*` + `_refresh_token_*` | Nalux |
| `tiendanube_access_token_*` | Nalux |

Verificado comparando el **md5 del valor desencriptado** en las dos bases: los 8 idénticos (nunca
se imprimió ni se guardó en disco el contenido, viajaron sólo en memoria del script). Probado
además que `public.vault_secret_read()` los lee desde la base nueva, y que los permisos siguen
como los dejó la migration 113: `vault_secret_read`/`_upsert`/`_delete` sólo `service_role`,
`afip_cert_status` (el booleano sin fuga) para `authenticated`.

**Consecuencia práctica: no hace falta volver a cargar a mano el token de MercadoPago ni el
certificado de AFIP.** Ya están en el proyecto nuevo.

### BUG REAL encontrado después del corte: los cron jobs apuntaban al proyecto viejo
El más serio de toda la migración. Las 12 migraciones que crean cron jobs (102, 107, 109, 233,
235, 238, 239, 240, 261, 272, 307, 316) tienen **la URL del proyecto y la anon key hardcodeadas**.
Al replicar el schema, los 8 jobs que llaman Edge Functions quedaron apuntando a
`https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/...` — o sea, con la app ya cortada a la
base nueva, `arca-worker` (facturación AFIP automática), `mp-sync`, `mp-qr-poller` y los workers
de Tiendanube/MercadoLibre estaban corriendo contra la base **vieja**. Y desde el 17/08, con el
proyecto viejo restringido, iban a fallar del todo.

No alcanzó a romper nada: al detectarlo no había ningún registro en estado pendiente en las tres
colas (`facturas_pendientes_arca`, `integraciones_stock_pendiente`, `qr_pagos_mp`) — verificado
antes de tocar nada.

Corregido con la **migration 329**, generada transformando los comandos reales que había en la
base (reemplazo de ref y de anon key, sin retipear nada a mano) y verificando por decodificación
que los 8 tokens embebidos eran `role: anon` y no `service_role` — la anon key es publishable, no
es una filtración, mismo criterio que ya documentaba la migration 102. `cron.schedule()` con el
mismo `jobname` reemplaza el job, no duplica: siguen siendo 10 jobs, 8 al proyecto nuevo y 2 que
son SQL puro sin URL. Verificado además que las llamadas responden de verdad: 99 respuestas HTTP
en la última media hora, **todas 200**.

**Deuda técnica que queda anotada:** que la URL y la anon key salgan de un solo lugar en vez de
estar hardcodeadas en 12 migraciones, para que una próxima mudanza de proyecto no vuelva a dejar
los crons apuntando al lugar viejo en silencio.

### Lo que queda SÓLO en el proyecto viejo (sacarlo antes del 17/08)
Todo lo que es base de datos, storage, funciones y Vault ya está copiado y verificado. Lo único
que no se puede leer desde acá es la configuración de plataforma del proyecto viejo, porque el
conector y el Personal Access Token son de la cuenta nueva:
1. **Secrets de Edge Functions** (Dashboard viejo → Edge Functions → Secrets): `SITE_URL`,
   `AFIP_ENVIRONMENT`, `TIENDANUBE_APP_ID`, `TIENDANUBE_CLIENT_SECRET`, `MELI_APP_ID`,
   `MELI_CLIENT_SECRET`. Los `SUPABASE_*` no hace falta copiarlos, los inyecta Supabase solo.
   Los de Tiendanube/MercadoLibre también se pueden volver a sacar de los paneles de desarrollador
   de esos servicios, así que no son irrecuperables — pero es mucho más rápido copiarlos de ahí.
2. **Configuración de Auth** (Dashboard viejo → Authentication → Providers / URL Configuration):
   qué proveedores de login están habilitados y qué URLs de redirect están permitidas.

## Sesión 2026-08-16 — Verificación de la migración de Supabase + ajustes UX de Facturar/Cobrar

Retomando la migración de Nadia (16/08 madrugada, ver sección anterior): se verificó que el
conector MCP de esta sesión y `.env.local` (dev local) seguían apuntando al proyecto **viejo**
(`wuznppxeonmhfcvnqfbf`) — corregidos ambos hacia `isvkelrdxwvkfmrfqxxk`. Se detectó además que
**Vercel (producción) seguía escribiendo contra el proyecto viejo** (un cobro real de Luciano por
$38.800 no aparecía en la base nueva) — causa: Vercel no recarga env vars solo, hace falta
actualizarlas a mano en Settings → Environment Variables y disparar un **Redeploy** explícito.
Luciano lo hizo; verificado después con una factura+cobro reales de prueba
(`FAC-20260816-001`, $49.400, Luciano Rosa) que el circuito completo Facturar → Cobrar ya
escribe en la base nueva.

Probando ese circuito en vivo, Luciano encontró 7 ajustes de UX sobre `NuevaFacturaModal.jsx` y
el flujo de Cobro (`ModalCobro.jsx`/`CuentaCorrienteSection.jsx`) — resueltos en esta misma
sesión (sin migraciones, todo frontend):

1. **Combo de productos vacío al hacer foco**: `getProductosFiltrados()` exigía 2+ caracteres
   tipeados; ahora con foco vacío muestra los primeros 20 del catálogo (como un combo normal).
2. **Subtotal por línea "no hacía nada"**: investigado — no era un bug, `calcBruto(item)` ya se
   recalculaba en cada render; era un campo de solo lectura (no un input), confirmado en vivo
   editando cantidad/precio/descuento con Luciano mirando.
3. **Desc% (y Cant./Precio Unit.) arrancaban en "0"** obligando a borrar antes de tipear —
   `onFocus={e => e.target.select()}` en los tres inputs.
4. **La factura se cerraba sola al crearse**: ahora `handleConfirmar` deja el modal abierto en
   una vista de confirmación (`facturaCreada` state) con "Registrar Cobro" o "Cerrar (Esc)", en
   vez de `onOpenChange(false)` directo — mismo patrón que ya se había corregido para
   Cotización/Pedido/OC en la sesión de Duplicar (15/08).
5-6. **"Registrar Cobro" desde una factura abría siempre en $0, sin factura marcada, y con el
   estilo viejo de `ModalCobro.jsx`**: se hizo el wiring de un `facturaId` de punta a punta
   (`SaleDetailModal` → `VentasSection.handleRegistrarCobro` → `Dashboard.navigateTo` →
   `CuentaCorrienteSection.initialFacturaId` → `openPaymentDialog`/`fetchFacturasAbiertas`) que
   preselecciona esa factura puntual y precarga el Monto a Cobrar con su saldo. `ModalCobro.jsx`
   se rediseñó con el lenguaje visual denso (`kx-*`, `h-8`) que ya tiene el resto de la app.
7. **Rediseño de "Imputar a factura(s)" estilo SAP**: cada factura abierta ahora tiene un
   checkbox (tildarla precarga su saldo completo, editable para pago parcial) en vez de un input
   suelto sin contexto; debajo de una imputación parcial aparece "Queda pendiente: $X (Y%)". Sin
   cambios de RPC — `registrar_cobro_cliente` ya soportaba imputación parcial (mig.169), solo
   faltaba comunicarlo bien en la UI.

Verificado en vivo end-to-end contra Nalux real: se creó `FAC-20260816-002` ($19.000, Luciano
Rosa, con 5% de descuento cargado con un solo tipeo) y se cobró completa desde el flujo nuevo —
el checkbox se tildó solo, el monto se precargó en $19.000, "Imputado: $19.000,00 / $19.000,00",
y la deuda total de Nalux bajó de $703.982 a $684.982. Tests (156/156), lint (0 errores) y build
limpios antes del deploy.

### Verificación de integraciones post-migración + bug real de permisos (AFIP)

Repaso de las 4 integraciones del proyecto nuevo (`isvkelrdxwvkfmrfqxxk`): 30 Edge Functions
`ACTIVE`, 10 cron jobs `active` y corriendo `succeeded` en las últimas horas, los 8 secrets del
Vault presentes, `integraciones_canales` (MercadoLibre/Tiendanube) preservados y activos, Auth
sin proveedores OAuth que reconfigurar (el proyecto solo usa login por email). Sin gaps ahí.

AFIP/ARCA y MercadoPago QR no tenían ningún movimiento real desde el corte (última emisión CAE
14/08, último QR pagado 10/08) — se armó una Factura C real de prueba ($100, Luciano Rosa,
FAC-20260816-003) para confirmar el circuito completo.

**Bug real encontrado**: ARCA emitió el CAE de verdad, pero `arca-worker` no pudo persistirlo —
`permission denied for function fn_persistir_cae_emitido`. Causa raíz: la migración 315 crea esa
función (worker-only, guardada con `auth.role()='service_role'`) y hace `REVOKE EXECUTE ... FROM
PUBLIC, anon, authenticated`, pero nunca vuelve a otorgar el EXECUTE a `service_role` — en el
proyecto viejo funcionaba porque alguien lo había otorgado a mano en producción, sin migración
(mismo patrón de drift ya encontrado esa madrugada en triggers/RLS/índices, ahora en la categoría
GRANTs). Mismo gap preventivo corregido en `reintentar_caes_lote` (botón "Reintentar" de
Facturación AFIP, sin GRANT a `authenticated` en ningún migration del repo).

Corregido con **migración 330** (`GRANT EXECUTE ... TO service_role` / `TO authenticated`).
Verificado: el siguiente ciclo del worker (18:35 UTC) persistió el CAE real que ARCA ya había
emitido — `FAC-20260816-003` quedó `cae_estado='emitido'`, CAE `86330766483733`, comprobante AFIP
`0001-00000043`. **AFIP/ARCA queda verificado end-to-end contra el proyecto nuevo.**

**Pendiente para mañana**: MercadoPago QR — Luciano va a reapuntar el webhook de MP a la URL
nueva (`.../functions/v1/mp-webhook`) y probar un cobro QR real chico desde el POS. El poller
`mp-qr-poller` (cada 1 min) confirma el pago aunque el webhook falle, así que no debería depender
de que el webhook responda bien. Con eso se cierra el 100% de la migración de cuenta de Supabase.

---

## 🎉 Migración salió con Éxito!

Cierre confirmado por Nadia el 18/08/2026. Base, datos, storage, Edge Functions, Vault (AFIP/MP/
MercadoLibre/Tiendanube) y cron jobs, todo funcionando en el proyecto nuevo
(`isvkelrdxwvkfmrfqxxk`). Único pendiente: webhook de MercadoPago QR, a cargo de Luciano.

## Sesión 2026-08-18 — Pruebas en vivo de "Facturar Pedido" (5 frentes) + bug real de estado

Con la migración ya cerrada, Nadia pidió probar en vivo lo que quedó sin clickear con ojos
humanos: los 5 frentes de `PLAN_FACTURAR_PEDIDO_5_FRENTES.md` (15/08). Se armó
`PLAN_PRUEBAS_NADIA_2026-08-18.md` y se recorrió junto a ella contra Nalux real.

### Puntos 1 a 4 — todos ✅, sin hallazgos
Rediseño denso, botón Mapa de relaciones, cobro desacoplado (factura queda pendiente en Cuenta
Corriente, cliente obligatorio, cero movimientos de caja) y Factura de Reserva — los cuatro
verificados con clicks reales y comprobantes de prueba (`FAC-20260818-001` a `003`).

### 🐛 BUG REAL encontrado armando el caso del Punto 5.5
Probando el caso "nada pendiente de facturar" se armó un pedido de prueba con 2 ítems, se entregó
y facturó sólo uno (dejando el otro para más adelante — exactamente el caso de uso que el Frente 2
del 15/08 vino a habilitar). El pedido pasó a estado **"Facturado" de golpe**, aunque el segundo
ítem seguía sin entregar ni facturar — y el botón "Facturar Pedido" desapareció, sin dejar ningún
camino para facturar el resto más adelante.

**Causa:** `handleSaleSuccessForPedido` (`PedidosSection.jsx`) y `handleSaleSuccessDesdeEntrega`
(`EntregasSection.jsx`) marcaban `estado: 'facturado'` en el pedido **después de cualquier venta**
vinculada, sin chequear si esa venta cubrió todo el pedido o sólo una parte. Es una limitación
documentada desde julio (migración 156: "no se modela facturación parcial de un mismo pedido en
múltiples comprobantes") que el Frente 2 puso en evidencia al habilitar justo ese caso de uso.

**Fix:** ambas funciones ahora releen `pedido_items` después de la venta y sólo marcan
`'facturado'` si **todos** los ítems quedaron con `cantidad_facturada >= cantidad` — si queda algo
pendiente, el pedido se deja como estaba (`en_preparacion`), y como el botón "Facturar Pedido" ya
dependía de `estado === 'en_preparacion'` (vía `ESTADOS.next` en `shared.jsx`), sigue apareciendo
solo, sin tocar ningún componente de UI.

**Verificado en vivo, de punta a punta**, contra un servidor local con el fix aplicado: se entregó
y facturó el ítem que faltaba del mismo pedido de prueba — quedó correctamente en "En Preparación"
con "Facturar Pedido" disponible mientras faltaba algo, y recién pasó a "Facturado" cuando los 2
ítems quedaron 100% facturados. `npx eslint` sin errores nuevos, `npx vitest run` 156/156.

### Hallazgo aparte: `.env` local apuntaba al proyecto viejo de Supabase
Al armar el pedido de prueba para el punto anterior, la lista de Pedidos del servidor local no
coincidía con la de producción — `.env` (no `.env.local`, que no existe en este checkout) seguía
con la URL/anon key del proyecto viejo (`wuznppxeonmhfcvnqfbf`), pese a que la sesión de la
madrugada del 16/08 documentó haberlo corregido. Corregido apuntando a `isvkelrdxwvkfmrfqxxk` —
`.env` está en `.gitignore`, así que esto no afecta ningún commit ni a otras máquinas.

---

## Cierre de sesión 18/08 — para Luciano

Resumen de todo lo que se tocó hoy, en orden:

1. **Migración de Supabase — confirmada 100% cerrada** por Nadia (ver "🎉 Migración salió con
   Éxito!" más arriba). Único pendiente de esa etapa: el webhook de MercadoPago QR, que quedó
   como tarea tuya (reapuntarlo a la URL nueva + probar un cobro real desde el POS).
2. **5 frentes de Facturar Pedido, probados en vivo con Nadia** (ver sección arriba) — todos ✅.
   En el camino se armó un caso de prueba para el punto 5.5 y **apareció un bug real**: un pedido
   facturado en partes pasaba a "Facturado" antes de tiempo, perdiendo el botón para facturar el
   resto. Corregido (`PedidosSection.jsx`/`EntregasSection.jsx`) y verificado en vivo.
3. **Mapa de Relaciones — Fase 4** (`PLAN_MAPA_RELACIONES.md`): "Documentos derivados" ahora
   colapsa a 6 con un "Ver N más" cuando hay muchos (NC/ND/cobros/devoluciones sobre la misma
   factura). Lo de exportar/imprimir el mapa quedó afuera a propósito, sin pedido real todavía.
4. **Multi-caja — Fase 6** (`PLAN_MULTI_CAJA.md`): reporting por caja física en el módulo de Caja
   (Movimientos y Reporte Histórico), invisible con 1 sola caja. Las 6 fases del plan quedan
   completas.

**Pendiente, sin decidir todavía — MELI Factura A**: Nadia empezó a retomarlo hoy pero frenó antes
de definir el alcance (hay más de una interpretación posible: elegir Factura A al facturar un
pedido de MercadoLibre vs. ofrecerlo como atributo de la publicación). Sigue en el mismo estado de
antes — **no construir nada sin que Nadia confirme el alcance primero**.

Todo lo de hoy: `npx vitest run` en verde en cada paso (159/159 al final), `npx eslint` sin
errores nuevos, `npx vite build` limpio en cada commit.

## Auditoría contable del circuito de Ventas (18/08, noche) + fix NC↔Pedido

Con la migración de Supabase y los 5 frentes de Facturar Pedido ya cerrados, se corrió una
auditoría contable formal (skill `auditor-contable`) sobre todo el circuito de Ventas — 3 agentes
en paralelo leyeron a fondo `crear_venta` (328/328b, incluida Factura de Reserva),
`registrar_cobro_cliente`/`asientosAutoService`, y el fix de estado de Pedidos de hoy.

**Confirmado sólido, sin regresiones**: partida doble intacta en venta/COGS/cobro, Factura de
Reserva omite correctamente las líneas de COGS cuando no mueve stock, Cuenta Corriente sin ningún
camino que la salte, imputación parcial (Open Item) correctamente implementada. Dos riesgos de
diseño preexistentes confirmados (no introducidos por esta tanda, ya con mitigación parcial): el
asiento contable de venta/cobro es "best effort" (no bloqueante, con regeneración manual si
falla) y la diferencia de cambio se degrada a $0 en silencio si faltan las cuentas 4.4/5.9.

**Hallazgo real nuevo**: `crear_nota_credito` nunca revertía `pedido_items.cantidad_facturada` ni
reabría `pedidos.estado`. Si se facturaba un pedido completo (quedaba "Facturado") y después se
hacía una NC sobre esa factura, el pedido se quedaba "Facturado" para siempre — sin ningún camino
para volver a facturar el saldo real.

**Fix (decisión de Luciano — mismo criterio que el Close/Reopen manual de SAP B1: el sistema
nunca reabre un documento solo)**: migración `331_crear_nota_credito_revertir_pedido.sql` — la
NC revierte `cantidad_facturada` por producto (mismo patrón que ya usaba `cancelar_factura`,
migración 259, pero parcial en vez de total) y devuelve `pedido_reabrible: true` si el pedido
quedó con saldo sin facturar mientras seguía marcado "Facturado". `NuevaNCModal.jsx` muestra
entonces un diálogo — "Reabrir pedido" o "Dejar cerrado" — nunca reabre solo.

Verificado en vivo de punta a punta contra Nalux real: NC sobre `FAC-20260818-004` (ítem del
pedido `PED-20260818-001`, que estaba "Facturado" con 2 ítems) → apareció el diálogo → "Reabrir
pedido" → el pedido volvió a `en_preparacion`, el ítem de la NC volvió a `cantidad_facturada: 0`,
el otro ítem quedó intacto en `1.000`. Sin cambios de RPC fuera de `crear_nota_credito` (mismo
signature de 10 argumentos, sin riesgo de overload huérfano). 159/159 tests, lint y build limpios.

**Fuera de alcance a propósito**: el mismo gap existía en Compras — no se tocó en esa sesión, sin
pedido explícito de Luciano. Tampoco se construyó un botón para reabrir un pedido "a mano" después
de elegir "Dejar cerrado".

## Facturación parcial de OC + NC de Proveedor reabre (o no) la OC (18/08, noche)

Luciano pidió el mismo criterio para Compras. Investigado: **no era el mismo bug** — hasta hoy una
OC solo admitía **una única Factura de Proveedor para siempre**
(`idx_compras_orden_compra_id_unico`, índice único), no existía ningún estado `'facturada'` en
`ordenes_compra.estado`, y `ordenes_compra_items.cantidad_facturada` era una columna muerta desde
julio (nadie la escribía). Confirmado cómo lo hace SAP B1: trata la OC simétrica a la Orden de
Venta — admite facturación parcial en varias facturas, cierra el documento solo cuando se completa,
y una NC de proveedor que reduce lo facturado no lo reabre sola (Close/Reopen manual). Se construyó
completo, estilo SAP, no solo el fix puntual.

**Migración `332_ordenes_compra_facturacion_parcial.sql`**:
- Se elimina el índice único → una OC ahora admite varias Facturas de Proveedor parciales.
- Nuevo estado `'facturada'` en `ordenes_compra.estado` — solo cuando **todos** los
  `ordenes_compra_items` quedan con `cantidad_facturada >= cantidad_pedida` (mismo criterio binario
  que el fix de Pedidos de hoy más temprano).
- `registrar_factura_compra_oc` topea cada ítem contra `cantidad_recibida - cantidad_facturada` (ya
  no contra "esta OC no tiene factura todavía").
- `crear_nota_credito_proveedor` revierte `cantidad_facturada` por producto (mismo patrón que
  `crear_nota_credito` del lado Ventas) y devuelve `oc_reabrible` — nunca reabre sola.

**Frontend**: `abrirModalFactura` (OrdenesCompraSection.jsx) ahora precarga solo lo pendiente de
facturar, con toast si no queda nada; `ModalDetalleOC.jsx` lista todas las facturas parciales en
vez de una sola y el botón "Registrar Factura" queda disponible mientras falte algo;
`NuevaNCProveedorModal.jsx` gana el mismo diálogo "¿Reabrir la OC?" que `NuevaNCModal.jsx`.

**2 bugs reales encontrados y corregidos probando en vivo** (no en el diseño original):
1. El `onSuccess` de `registrarFacturaMutation` no invalidaba la query del detalle de la OC — la
   segunda factura parcial volvía a precargar ítems ya facturados (caché vieja de
   `cantidad_facturada`). Corregido invalidando `OC_KEYS.detail`/`['ordenes_compra', empresaId]`.
2. `NuevaNCProveedorModal.jsx` nunca precargaba ítems desde la factura de origen cuando
   `compraOrigen` estaba seteado (a diferencia del lado Ventas) — el campo quedaba en texto libre
   sin `producto_id`, así que la reversión de `cantidad_facturada` nunca se disparaba en el caso
   real. Corregido precargando desde `detalle_compras` (con la conversión neto→bruto correcta,
   `costo_unitario` ahí es neto pero la NC trabaja en precio con IVA incluido).

Verificado en vivo end-to-end contra Nalux real (OC-00003, Alibaba, 2 ítems): factura parcial de 1
ítem (OC sigue "Recibida", botón sigue disponible) → factura del 2do ítem (OC pasa a "Facturada",
badge violeta, botón desaparece) → NC sobre la 2da factura → diálogo "¿Reabrir la OC?" → "Reabrir
OC" → OC vuelve a "Recibida", `cantidad_facturada` del ítem acreditado vuelve a 0, el otro ítem
queda intacto. 159/159 tests, lint y build limpios.

## 4 ajustes chicos de UX en Órdenes de Compra (18/08, noche)

Luciano pidió parejar Compras con patrones ya establecidos en el resto de la app:

1. **Click en la fila de la tabla abre la OC** (`TablaOrdenesCompra.jsx`) — antes solo el ícono del
   ojo abría el detalle; ahora toda la fila es clickeable (`stopPropagation` en la celda de
   acciones para que los botones de estado/devolver no disparen también la apertura).
2. **Combo de Proveedor** (`FormNuevaOC.jsx`/`OrdenesCompraSection.jsx`) — `searchProveedor` exigía
   tipear para traer resultados; ahora el foco vacío trae el listado completo (máx. 20), igual que
   ya se corrigió para productos en Ventas (16/08).
3. **Combo de Producto** en los ítems de la OC — mismo fix, `searchProducto` ya no exige 2+
   caracteres para mostrar algo al hacer foco.
4. **Fecha de entrega esperada visible en modo oscuro** — el input nativo `type="date"` no tenía
   `dark:[color-scheme:dark]` (sí lo tenía `ModalRegistrarFactura.jsx`, misma carpeta), así que el
   ícono del calendario se pintaba negro sobre fondo oscuro — invisible, parecía que solo se podía
   tipear la fecha. Corregido, mismo patrón ya usado en el resto de la app.

Se revisó también si el modal "Nueva OC" necesitaba un rediseño de layout — no: ya usa el mismo
wrapper full-screen denso (`max-w-[96vw] w-[96vw] h-[92vh]`) que Cotización/Pedido desde la Fase 1
(13/08), así que no se tocó la estructura. 159/159 tests, lint y build limpios, verificado en vivo
contra Nalux real (click en fila, ambos combos, `color-scheme` confirmado por consola).

---

## Cierre de sesión 18/08 (noche) — para Nadia

Sesión larga, arrancó verificando la migración de cuenta de Supabase del 16/08 y terminó tocando
Ventas y Compras a fondo. Todo commiteado, pusheado a `master` y deployado. **Nada de esto lo
probó nadie con ojos humanos todavía** — quedó armado `PLAN_PRUEBAS_NADIA_2026-08-19.md` con el
detalle punto por punto para que lo recorras mañana.

Resumen de lo que se tocó, en orden:

1. **Migración de Supabase** — confirmado 100% funcionando, incluido un bug real de permisos en
   AFIP (`fn_persistir_cae_emitido` sin grant a `service_role`) encontrado y corregido con una
   Factura C real de prueba.
2. **7 ajustes UX en Nueva Factura de Venta + Registrar Cobro** (combo de productos, selects que
   no exigían tipear, la factura ya no se cierra sola al crearse, el cobro llega con la factura
   preseleccionada, checkbox + pago parcial estilo SAP en el diálogo de cobro).
3. **Auditoría contable del circuito de Ventas** (skill `auditor-contable`) sobre todo lo tocado
   estos días — confirmó que la partida doble, COGS y Cuenta Corriente siguen sólidos, y encontró
   un hallazgo real: la Nota de Crédito no revertía `pedido_items.cantidad_facturada` ni reabría
   el pedido.
4. **Fix del hallazgo #3** — la NC ahora revierte y pregunta si conviene reabrir el pedido (nunca
   lo hace sola, mismo criterio Close/Reopen manual de SAP B1).
5. **El mismo problema portado a Compras** — pero ahí no era el mismo bug: una OC solo admitía una
   factura de proveedor para siempre. Se construyó completo, estilo SAP: OC ahora admite
   facturación parcial en varias facturas, nuevo estado "Facturada", y NC de proveedor con el
   mismo diálogo de reapertura.
6. **4 ajustes chicos de UX en Órdenes de Compra** — click en la fila abre el detalle, combos de
   Proveedor/Producto sin exigir tipear, fecha de entrega visible en modo oscuro.

**Pendiente, sin decidir todavía — no construir nada ahí**:
- Webhook de MercadoPago QR — a cargo de Luciano.
- MELI Factura A — alcance sin definir, Nadia lo frenó el 18/08 antes de arrancar.

Todo el día: tests en verde en cada paso, lint sin errores nuevos, build limpio en cada commit,
verificado en vivo contra Nalux real donde se pudo entrar con browser real.

## Sesión 2026-08-19 — Pruebas del plan del 18/08 + bug real en letra AFIP de NC

Retomando `PLAN_PRUEBAS_NADIA_2026-08-19.md` con Nadia. Puntos 1-3 confirmados sin clic real
(ya se habían visto pasar el 18/08). Punto 4 (NC de Ventas reabre el pedido): rama "Reabrir
pedido" probada con `PED-20260608-003` → `FAC-20260818-001` → `NC-20260819-001`, confirmado en
la base que el pedido volvió a `en_preparacion` con `cantidad_facturada=0`.

### 🐛 Bug real encontrado: NC sobre un Ticket se encolaba igual a ARCA
`NuevaNCModal.jsx` decidía la letra AFIP de la NC con
`comprobanteOrigen?.tipo_comprobante_afip ?? devolucionOrigen?.tipo_comprobante_afip ??
determinarTipoComprobante(...)` — si el comprobante de origen era un **Ticket** (nunca se mandó
a AFIP, `tipo_comprobante_afip` es `NULL` en la base), el `??` lo trataba como "no hay origen" y
calculaba una letra **nueva** desde la condición fiscal del cliente, encolando a ARCA una NC que
"corrige" un comprobante que jamás existió ante AFIP. Rechazada siempre por el worker:
*"el comprobante de origen no tiene numero_afip"*. Reproducido 2 veces con datos reales
(`NC-20260818-001` la noche del 18/08, sin diagnosticar en su momento; `NC-20260819-001` hoy,
mismo patrón exacto) — no era una casualidad de datos, es sistemático.

**Fix:** con origen, la letra AFIP sólo se **hereda** — si el origen no tiene letra (Ticket), la
NC tampoco se manda a ARCA (queda como Ticket también, igual que el documento que corrige). Sin
origen (NC standalone), sigue calculándose como antes. Revisado que el mismo patrón no existe en
`NuevaNCProveedorModal.jsx` (Compras no toca AFIP) ni en `NuevaNotaDebitoModal.jsx` — el bug
estaba aislado a este único archivo.

Los 2 registros ya afectados (`NC-20260818-001`, `NC-20260819-001`) se corrigieron a mano en la
base: `tipo_comprobante_afip=NULL`, `cae_estado='no_aplica'`, sin fila en
`facturas_pendientes_arca` — mismo estado que cualquier Ticket normal.

`npx eslint` sin errores nuevos, `npx vitest run` 159/159, `npx vite build` OK.

### Cierre — Puntos 5 y 6 (Compras) confirmados

**Punto 5 (facturación parcial de OC + NC reabre)**: probado end-to-end sobre `OC-00003`
(ya tenía un ítem facturado de la sesión de Luciano, el otro — Mouse Vertical — pendiente).
Facturar el ítem que faltaba pasó la OC a **"Facturada"** (badge violeta). "Copiar a NC" sobre
esa factura disparó el diálogo de reapertura — probadas **las dos ramas**: "Reabrir OC" (volvió a
"Recibida", `cantidad_facturada` revertida) y, repitiendo el ciclo con una factura nueva,
"Dejar cerrada" (se quedó "Facturada"). El ítem de la NC vino precargado con el producto
correcto en los dos casos.

Hallazgo menor (no bloqueante): el panel "3-WAY MATCH" suma el total bruto de todas las facturas
de la OC sin restar las NC hechas sobre ellas — después de una NC muestra una diferencia grande
entre "Recibido" y "Factura" que puede confundir a simple vista. La cifra que manda de verdad
(`cantidad_facturada` por ítem) es correcta; esto es sólo de visualización. Queda anotado para
una futura pasada de pulido, no se tocó hoy.

**Resuelto 2026-08-21, a pedido de Nadia:** `ordenesCompraService.getFacturas()` ahora trae
`notas_credito_proveedor(monto, estado)` anidada por `compra_id` (única FK, sin ambigüedad para
PostgREST) y calcula `nc_total` por factura (sólo NC `estado='activa'`, una `anulada` no debe
descontar). En `ModalDetalleOC.jsx`, `totalFactura` del 3-Way Match ahora resta ese `nc_total` de
cada factura antes de sumar, y cada línea de factura en la lista muestra "NC -$X" en rojo cuando
corresponde, para que se vea de dónde sale el neto. Probado en vivo contra el caso real de
`OC-00003` (localhost, sesión de Nadia): panel mostraba antes ~$181.500 de "Factura" (bruto de 3
facturas de $60.500 cada una, todas neteadas 100% por su propia NC) más la factura real de
$18.972,80 sin NC — ahora muestra exactamente **$18.972,80**, y la diferencia contra "Recibido"
($46.707,20) ya es real (falta facturar el resto), no ruido de NC sin restar.

**Punto 6 (4 ajustes UX de OC)**: los 4 confirmados — click en cualquier parte de la fila abre el
detalle, Proveedor y Producto listan todo al hacer foco (sin tipear), y el campo "Entrega
esperada" tiene `color-scheme: dark` activo (confirmado por JS), calendario visible y usable en
modo oscuro.

**Con esto, todo `PLAN_PRUEBAS_NADIA_2026-08-19.md` (Puntos 1 a 6) queda probado y cerrado.**

### Verificación final post-pruebas — nada roto

Con todo lo tocado hoy (3 NC de Ventas, 2 facturas + 2 NC de Compras, reaperturas en ambos
sentidos), se hizo una pasada de auditoría antes de cerrar:
- **AFIP**: sin errores nuevos en la cola desde el fix.
- **Cuenta corriente** (Nadia Tecera, Carlos Perez, Consumidor Final, Alibaba): cada movimiento
  de hoy coincide exacto con lo esperado — las 2 facturas y las 2 NC de Alibaba se cancelan
  netamente entre sí ($0 de impacto real en su saldo).
- **Stock**: cero movimientos de inventario — facturar/hacer NC no mueve stock, correcto.
- **Asientos contables**: los 7 generados hoy, todos balanceados (débito = crédito).
- **El modal de "Nueva OC" cancelado** (prueba del Punto 6): no dejó ningún borrador en la base.

**Nota importante para no confundir a futuro**: `PED-20260814-004` y `OC-00003` (ítem Mouse
Vertical) quedaron con su documento en estado **"Facturado"/"Facturada"** pero con
`cantidad_facturada = 0` en ese ítem puntual. No es un dato inconsistente — es el comportamiento
correcto de "Dejar cerrada": la NC sí revierte el monto facturado (ajuste financiero real), pero
el estado del documento no cambia porque se decidió no reabrirlo. Si en algún reporte futuro
aparece un documento "Facturado" con $0 facturado en un ítem, este es el motivo — no investigar
como si fuera un bug nuevo.

## Cierre de sesión 19/08 — para Luciano

Sesión de hoy: recorrido completo de `PLAN_PRUEBAS_NADIA_2026-08-19.md` con Nadia, los 6 puntos
✅. En el camino se encontró y corrigió un bug real (NC sobre un Ticket se encolaba mal a AFIP,
commit `13110d1`) y se probó de punta a punta la facturación parcial de OC + reapertura en ambos
lados (Ventas y Compras), incluidas las dos ramas del diálogo en cada uno. Verificación final
post-pruebas sin hallazgos — ver sección de arriba.

**Pendiente, sin cambios**: MP QR webhook (a tu cargo) y MELI Factura A (sin alcance definido,
no tocar sin que Nadia lo confirme).

## 2026-08-19 — Plan propuesto para Luciano: catálogo maestro de productos

🟡 **Para revisar, no construir todavía.** Investigación de fuentes de códigos de barra en
Argentina (GS1, Open Food Facts, alternativas pagas) para bajar la fricción de carga de
catálogo en el onboarding. Hallazgo central: no existe una fuente única gratuita y completa
— la propuesta es un catálogo maestro compartido entre tenants que se autoalimenta con el
uso real, más Open Food Facts como fuente externa para el vertical almacén. Detalle
completo (arquitectura, SQL, RPCs, Edge Function) en `PLAN_CATALOGO_PRODUCTOS.md`.

**Toca un principio del proyecto:** la tabla nueva no lleva `empresa_id` a propósito
(catálogo público de referencia, sin dato de negocio del tenant) — ver sección 3 del plan
antes de que se construya nada.

## 2026-08-19 (noche) — Corrección del plan de catálogo + import puntual para el kiosco + fix de egress

**El plan de catálogo compartido de arriba quedó DESCARTADO por Luciano** — el pedido real
era mucho más chico: una carga masiva puntual para el primer cliente en producción (un
kiosco), no un catálogo cross-tenant. Rompía a propósito el principio de tenant duro/estricto
que se viene sosteniendo en todo el proyecto — correcto haberlo frenado antes de construir
nada. `PLAN_CATALOGO_PRODUCTOS.md` queda como referencia histórica, no como algo a construir.

### Import de catálogo kiosco/almacén (Open Food Facts Argentina)

- Se armó un script puntual (`transformar_catalogo.js`, vive solo en el scratchpad de la
  sesión, no en el repo — es de un solo uso) que baja el export completo de Open Food Facts
  filtrado por Argentina (gratis, `world.openfoodfacts.org/cgi/search.pl?...&download=on`,
  requiere un User-Agent identificable o bloquea como robot) y lo transforma al formato exacto
  del importador CSV de KAIROX.
- Clasificación automática en 9 grupos (Bebidas, Lácteos, Golosinas y Chocolates, Snacks y
  Galletitas, Infusiones, Panadería, Fiambres y Conservas, Congelados y Helados, Almacén) por
  palabras clave contra la columna `categories` de OFF. 3 bugs de clasificación encontrados y
  corregidos en el camino, dejar documentado por si se retoca el script más adelante:
  1. Matching por substring simple hacía que `'cola'` matcheara adentro de "cho**cola**te" y
     "agrí**cola**s" (huevos y avena con chocolate caían mal en Bebidas) — pasado a regex con
     límite de palabra al inicio (`\bcola`, sin `\b` de cierre para no perder plurales).
  2. Tags en español con tilde (`néctares`, `azúcar`) no calzaban contra keywords sin tilde —
     se normaliza con `.normalize('NFD')` antes de comparar.
  3. `'bebida'` como keyword genérico capturaba el tag ancestro de OFF "Alimentos y bebidas de
     origen vegetal", que cubre pastas/aceites/café/yogures — no solo bebidas reales. Sacado.
  4. Límite conocido, no corregido a propósito (bajo impacto, no vale la pena perseguirlo en
     un script de una sola vez): algún producto rebozado/empanado puede caer en Panadería
     porque el tag de OFF es literalmente "pan rallado".
- `codigo_sku` incremental por grupo (`BEB-00001`, `LAC-00001`, ...) — no existe un generador
  de códigos incrementales en el sistema hoy (a diferencia de la numeración de comprobantes),
  se resolvió puntualmente en el script para este import.
- Resultado entregado a Luciano: `catalogo_kiosco_kairox.csv`, **3.430 productos**, precio/costo/
  stock en 0 a propósito (se completa después con el ajuste masivo de precios ya existente).
- **Antigüedad real del dato, chequeada contra la web de OFF:** no es un feed en vivo — es
  crowd-sourced desde 2017 hasta hoy, sin fecha uniforme por producto (verificado con 4
  productos reales: creados entre 2017-2021, algunos re-editados hace apenas 6 meses, otros
  sin tocar desde 2021/2023). Nombre y código de barra son estables igual; lo que puede estar
  viejo es la existencia real del producto en el mercado — normal para un catálogo de
  referencia, no para un feed de precios/stock (que nunca trajo, por diseño).
- **Import NO ejecutado todavía** — el CSV está listo y entregado, pero Luciano todavía no lo
  subió por la UI de "Importar CSV" de Productos. Pendiente para la próxima sesión o cuando
  él decida.

### Importador CSV — 2 mejoras nuevas (`CSVImportModal.jsx`)

- Columna `codigo_barras` agregada al template de Productos — antes la tabla tenía la columna
  (mig. 105) pero el importador nunca la escribía.
- Columna `grupo` nueva: viaja como texto libre en el CSV, y `handleImport` la resuelve/crea
  contra `categorias` de la empresa ANTES de insertar (busca por nombre case-insensitive, crea
  las que falten, arma un mapa `nombre → id`, completa `productos.categoria_id`). Es la primera
  vez que el import masivo deja el "Grupo de Artículo" (concepto SAP, `categoria_id` ya existía
  como FK pero nadie lo completaba desde CSV) realmente utilizable para filtrar/reportar.

### Riesgo de egress encontrado ANTES de importar (mismo patrón que el incidente del logo)

Luciano preguntó explícitamente por el riesgo de Supabase antes de tocar nada — buena señal,
se encontró algo real. El tamaño de la tabla en sí es trivial (unos MB), pero 3 pantallas
traían **todos** los productos activos sin límite y filtraban/usaban del lado del cliente —
con ~300 productos era barato, con miles multiplica el egress por pantalla, y una de ellas
(Dashboard) se ve en cada login:

1. `dashboardService.getKPIs` + `productosService.getLowStock` — traían TODO el catálogo activo
   y filtraban "stock bajo" en JS. **Fix:** RPC nuevo `productos_stock_bajo(empresa_id)`
   (mig. `333_productos_stock_bajo_rpc.sql`, aplicada) que filtra `stock_actual <= stock_minimo`
   en SQL server-side. Verificado en vivo: el widget "Alertas de Stock" del Dashboard sigue
   mostrando bien (Batidora Eléctrica, Camiseta Argentina) tras el fix.
2. `EntregasSection.jsx` y `PedidosSection.jsx` (combo de productos) — mismo patrón, sin
   límite. **Fix:** `.limit(200)`, mismo criterio ya usado en `CotizacionesSection`. Trade-off
   conocido: con un catálogo de miles, estos dos pickers solo muestran los primeros 200
   alfabéticos — si en la práctica hace falta buscar más allá, el próximo paso sería un
   autocomplete server-side ahí también (mismo patrón que ya tiene Órdenes de Compra), no
   construido ahora por no ser lo que se pidió.

### Camino de rollback preparado para el import (a pedido explícito de Luciano)

`ROLLBACK_IMPORT_CATALOGO_KIOSCO.md` en la raíz del repo — SQL listo para copiar/pegar en el
SQL Editor de Supabase si el import sale mal. Huella para identificar las filas sin ambigüedad:
patrón `codigo_sku ~ '^(BEB|LAC|SNK|GOL|INF|PAN|FIA|CON|ALM)-\d{5}$'` (nadie más en el sistema
genera SKUs con ese patrón). Incluye: query de conteo por grupo antes de tocar nada, chequeo de
que ningún producto importado ya se usó en una venta/compra/movimiento real (si se usó, NO
borrar esa fila puntual), rollback suave recomendado (`activo=false`, reversible) y rollback
duro (`DELETE`, solo si el chequeo anterior dio 0 filas) + limpieza opcional de las categorías
que quedaron vacías.

Eslint sin errores nuevos, vitest 159/159, vite build OK. Todo commiteado y deployado a
producción — el RPC `productos_stock_bajo` ya está aplicado en la base real de Nalux.

### Fix real encontrado al probar el import (commit `46c8876`)

Luciano pidió particionar el CSV en un lote de prueba de 50 (repartidos entre los 9 grupos,
script `particionar_lote.js`, también solo en el scratchpad) + el resto sin esos 50, para no
tocar los límites del plan free de Supabase de una sola vez. Al probar el lote de 50 por la
UI real: **0 importados, 50 con error** — `Could not find the 'precio_costo' column of
'productos' in the schema cache`.

Bug preexistente, no algo roto en esta sesión: `productos` nunca tuvo columna `precio_costo`
(siempre fue `costo_compra`, `000_schema_base.sql:133`) — `CSVImportModal.jsx` arma el
`payload` del insert con la key `precio_costo` (el nombre del campo en el mapeo/preview, más
claro para quien importa) pero nunca la traducía al nombre real de columna. Como los 50
fallaron completos, no quedó nada en la base para limpiar. Fix: renombrar `precio_costo` →
`costo_compra` recién al armar el `payload` final (mismo punto donde ya se resolvía `grupo` →
`categoria_id`), sin tocar el campo visible del mapeo. Deployado, pendiente que Luciano
reintente el mismo lote de 50 y confirme.

**Límites reales del plan free de Supabase, chequeados (no de memoria) para tener presente
antes de seguir con el resto del import:** 500 MB de DB, 10 GB/mes de egress (5+5 sin/con
caché), 1 GB de storage, 50k MAU, 500k invocaciones de Edge Functions. El dato que más importa
acá no es tamaño (3.430 productos son unos pocos MB) sino que **el proyecto se pausa solo tras
7 días de inactividad** en el plan free — no apto para producción 24/7 tal cual está.

### Backlog nuevo (19/08, noche) — Recuento y Revalorización de Inventario estilo SAP

Pedido explícito de Luciano tras confirmar que el lote de 50 entró bien: desarrollar
**Recuento de Inventario** (conteo físico completo contra el sistema, ajuste de diferencias
de una sola vez -- no producto por producto) y **Revalorización de Inventario** (actualizar
costo unitario en stock + asiento contable por la diferencia de valor), sumado a entrada y
salida de mercaderías, inspirado en el módulo Inventario de SAP B1. Hoy `ajustar_stock_manual`
solo ajusta un producto a la vez y solo mueve cantidad, no revaloriza costo.

## 2026-08-20 (madrugada) — Recuento + Revalorización de Inventario CONSTRUIDO, pendiente aplicar

Se retomó el backlog de arriba en la misma sesión (Luciano pausó el import del resto del
catálogo para priorizar esto). Plan de arquitectura vía `EnterPlanMode` (3 decisiones
confirmadas: cuentas contables dedicadas, recuento acotable por categoría, carga manual
alcanza por ahora) — plan completo en `C:\Users\lbanegas\.claude\plans\humble-floating-wilkinson.md`.

**Construido, testeado por simulación SQL, NO aplicado a producción todavía** (ver
`PLAN_RECUENTO_REVALORIZACION_INVENTARIO_NADIA.md` para el handoff completo):

- Migraciones `334/335/336` — 4 cuentas contables nuevas (`4.5`/`4.6`/`5.10`/`5.11`, no
  `5.9`/`4.4` como decía el plan original -- esos códigos ya estaban tomados por Diferencia de
  Cambio, mig.170/209, detectado ANTES de aplicar nada releyendo `seed_plan_cuentas` vigente),
  2 tipos de documento nuevos en `series_numeracion` (con su propio `CHECK` a ampliar,
  encontrado simulando en vivo), tablas + RPCs de Recuento y Revalorización.
- Frontend completo: 2 tabs nuevas en Productos, 6 componentes nuevos, 2 services, 2 métodos
  nuevos en `asientosAutoService`. Eslint/vitest/build en verde.
- **Verificado con `BEGIN...ROLLBACK` contra Nalux real** (simulando `auth.uid()` con
  `SET LOCAL request.jwt.claim.sub`): Recuento con 1 faltante + 1 sobrante aplicó bien el stock
  y logueó `movimientos_inventario`; Revalorización actualizó `costo_compra` y **confirmó que
  NO toca `movimientos_inventario`** (0 filas). Gap real encontrado y corregido en el camino:
  faltaba la guarda contra `cantidad_contada`/`costo_nuevo` negativos (agregado `CHECK`).
- **No se aplicó nada a producción** -- queda para la próxima sesión, con Nadia o con Luciano,
  aplicar las 3 migraciones + `NOTIFY pgrst 'reload schema'` + probar en vivo por browser.

**Hallazgo de datos -- resuelto 2026-08-21, a pedido de Nadia**: un producto del lote de 50
(`"Danica, soft ligth"`, con una coma dentro del nombre) quedó corrupto en la base real --
`nombre='Danica'`, `codigo_sku='soft ligth'`, `codigo_barras='Unidad'`, `descripcion='5'`, y una
categoría huérfana literalmente llamada `'7791620009858'` (el código de barra real de ese
producto). El parser del importador se probó línea por línea contra el CSV real y es correcto
(los otros 49/50 productos entraron perfectos) -- la sospecha es que el archivo se reabrió/regrabó
en Excel entre que se generó y se subió, rompiendo el quoting de esa única celda con coma.

Antes de borrar se confirmó que no tenía ningún movimiento real (`comprobante_items`,
`movimientos_inventario`, `detalle_compras`: 0 filas cada uno -- stock y precio en 0, nunca se
vendió ni se compró). Sí apareció una referencia no obvia: un ítem sin contar
(`cantidad_contada` null) del recuento `RC-20260820-004`, que ya estaba `anulado` y sin asiento
contable (leftover de las pruebas en vivo del Bloque 4 de recuento/revalorización del 20/08). Se
borraron los 3 registros en orden (`recuento_inventario_items` → `productos` → `categorias`),
verificado en 0 en los tres después. Nadia va a recargar el producto bien desde la pantalla de
Productos cuando tenga los datos reales a mano (no era urgente reponerlo).

**Pendiente sin decidir, recordatorio explícito de Luciano**: revisar cómo se vende hoy un
fiambre u otro artículo SIN código de barras (se corta/pesa, no viene con EAN de fábrica) --
auditar `NuevaVentaModal.jsx` para confirmar que existe un camino de venta por
búsqueda/nombre cuando no hay barcode, y si hace falta soporte de venta por peso. Nada
investigado todavía, no tocar código sin juntar el caso de uso real con Luciano primero.

**Import del resto del catálogo (3.380 productos) sigue pausado** -- no retomar sin pedido
explícito.

## 2026-08-20 — Recuento/Revalorización aplicado a producción + bug real de "Confirmar" encontrado y corregido

Sesión con Nadia: se aplicaron las migraciones `334/335/336` a producción (Nalux,
`isvkelrdxwvkfmrfqxxk`) + `NOTIFY pgrst, 'reload schema'`, y se probó en vivo por browser real
contra `https://kairox-gestion-chi.vercel.app` (¡ojo! -- `https://kairox-gestion.vercel.app` es
un deploy VIEJO/distinto, no confundir, ver nota abajo).

### Bug real encontrado: "Confirmar Recuento"/"Confirmar Revalorización" fallaba siempre

Al probar en vivo, el botón "Confirmar Recuento" fallaba el 100% de las veces con
"Recuento no encontrado" -- reproducido 3 veces seguidas en 2 recuentos distintos recién
creados. La función SQL en sí estaba perfecta (confirmado llamándola directo por API REST con
el token real de la sesión: aplicó bien el stock, logueó el movimiento, saltó el asiento
correctamente cuando la diferencia de valor es $0).

**Causa raíz encontrada con los logs reales de Supabase** (`query_logs`, tabla `edge_logs`,
`log_attributes`): el request que fallaba tenía `content-length: 22`, exactamente
`{"p_recuento_id":null}` -- el id viajaba en `null`, no el id real. El JWT/rol/usuario del
request eran correctos (`role: authenticated`, `subject` = el user id real) -- el problema
nunca fue de autenticación ni de RLS, fue que el frontend mandaba `null` como id.

**Mecanismo**: `ModalDetalleRecuento.jsx`/`ModalDetalleRevalorizacion.jsx` usan el prop
`recuentoId`/`revalorizacionId` directo (en vivo, no congelado) tanto para controlar el
`<Dialog open={!!recuentoId}>` exterior como dentro de `handleConfirmar()`. El botón
"Confirmar" vive en un `<AlertDialog>` HERMANO (no anidado en el DOM del Dialog, por los
portals de Radix). Al tocar el `AlertDialogAction`, el `Dialog` exterior interpreta el
pointerdown como "click afuera" (su contenido y el del AlertDialog están en portals
distintos) y dispara `onOpenChange(false)` → `setDetalleId(null)` -- lo que ocurre ANTES de
que corra el `onClick` real del botón "Confirmar", que termina usando el prop ya en `null`.
El título del AlertDialog seguía mostrando bien el número (viene del cache de React Query,
que no se limpia solo) -- por eso visualmente todo se veía normal justo antes de fallar.

**Fix aplicado** (`ModalDetalleRecuento.jsx`, `ModalDetalleRevalorizacion.jsx`):
1. Se agrega un estado `confirmandoId` que congela el id real en el momento exacto de abrir
   el diálogo de confirmación (click en "Confirmar Recuento"/"Confirmar Revalorización"), y
   `handleConfirmar` usa ese valor congelado en vez del prop en vivo -- inmune a que el
   Dialog exterior se cierre de fondo.
2. Guarda adicional (defensa en profundidad): `onPointerDownOutside`/`onInteractOutside` en
   el `DialogContent` exterior ignoran el dismiss mientras `confirmando` (el AlertDialog) está
   abierto -- ataca la causa raíz, no solo el síntoma.
3. Guard extra en `handleConfirmar`: si por lo que sea `confirmandoId` es null, error claro al
   usuario en vez de mandar el RPC con `null`.

### Hallazgo de seguridad separado, encontrado en el camino: grants de más a `anon`

Investigando el bug de arriba se encontró que las 8 funciones nuevas de Recuento/Revalorización
(`crear_recuento_inventario`, `confirmar_recuento_inventario`, `anular_recuento_inventario`,
`set_asiento_recuento_inventario` y sus 4 equivalentes de Revalorización) tenían
`GRANT EXECUTE ... TO authenticated` pero nunca se les revocó el EXECUTE implícito que Postgres
da a PUBLIC al crearlas -- `anon` podía ejecutarlas (confirmado con `has_function_privilege`).
Comparado contra el resto del proyecto (`crear_nota_credito`, `crear_venta`,
`registrar_factura_compra_oc`, `ajustar_stock_manual`): esas ya tienen `anon` correctamente
bloqueado -- es un gap puntual de esta feature, no un patrón del proyecto. Impacto real
acotado (las funciones ya verifican `get_my_empresa_id() IS NULL → RAISE EXCEPTION`
internamente, así que un anónimo real solo chocaba con "No autorizado", no leía/escribía nada
ajeno) pero se corrige igual, mismo criterio que la mig.330. **Migración `337` aplicada** —
`REVOKE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO authenticated` en las 8.

### Estado final, verificado

- `RC-20260820-001` (Congelados y Helados): confirmado de verdad con datos reales (2 unidades
  de diferencia, $0 de impacto porque el costo de esos productos importados del catálogo
  kiosco es $0) -- queda así, es correcto, no tocar.
- `RC-20260820-002` (Belleza y Cuidado Personal): se usó para reproducir el bug con conteos
  de PRUEBA (ficticios) sobre productos con costo real -- nunca llegó a confirmarse (el bug lo
  bloqueaba), quedó **anulado a mano por SQL** antes del fix para no dejar un recuento de
  mentira colgado en la base real. No tocó stock ni contabilidad real en ningún momento.
- Fix commiteado, pusheado, deployado y **reverificado en vivo post-deploy contra
  `kairox-gestion-chi.vercel.app` real**: `RC-20260820-003` (Congelados y Helados) y
  `RV-20260820-001` (Infusiones) se confirmaron sin error, con efecto real correcto en la base
  (stock/costo actualizados, `asiento_id=null` en ambos por ser diferencia de $0 -- mismo
  criterio de no crear datos ficticios reales, ver detalle debajo).

### Botón "Anular" — construido (20/08, mismo día)

El RPC `anular_recuento_inventario`/`anular_revalorizacion_inventario` existía desde la
mig.335/336 pero nunca se había conectado a ningún botón visible -- el cleanup de `RC-002` de
más arriba se hizo por SQL directo porque no había otra forma. Agregado en
`ModalDetalleRecuento.jsx`/`ModalDetalleRevalorizacion.jsx`: botón "Anular" (outline, rojo)
junto a "Confirmar", visible mientras el documento está en borrador, con su propio
`AlertDialog` de confirmación ("no se puede deshacer"). Mismo patrón de freeze de id que el fix
de arriba (`anulandoId` congelado al abrir el diálogo, en vez del prop en vivo) y mismo guard
`onPointerDownOutside`/`onInteractOutside` extendido a cubrir también este segundo AlertDialog
-- comparten el mismo riesgo estructural, se corrigen juntos. Eslint 0 errores, vitest 159/159
(un fallo de `MapaRelaciones.test.jsx` por timeout en la corrida completa, no relacionado --
confirmado pasando 3/3 al correrlo solo, típico flake de máquina bajo carga), vite build OK.

### Nota importante: dos URLs de Vercel distintas -- la vieja queda PROHIBIDA

`https://kairox-gestion.vercel.app` (sin "-chi") es un deploy VIEJO -- durante esta sesión
mostró código de hace varios commits atrás (sin `stock_bajo`, sin Recuento) a pesar de que
`master` ya tenía todo pusheado. La URL de producción real y actualizada es
**`https://kairox-gestion-chi.vercel.app`**. Nadia pidió explícitamente que la URL vieja quede
descartada por completo -- no volver a abrirla, mencionarla ni considerarla parte del proyecto
(guardado también en memoria persistente de Claude, `feedback_url_produccion_correcta.md`).
Confirmar con Luciano si además hay que borrar/redirigir el dominio del lado de Vercel.

---

# 🗂️ Estado de pendientes al 2026-08-21

Reemplaza a la tabla del 03/08 de más arriba (marcada como desactualizada). Esta es la lista real
al cierre de la sesión del 20-21/08 con Nadia.

**Cerrado en esta tanda (20-21/08):**
- ✅ `v_saldo_proveedores` sin `security_invoker` — fuga cross-tenant real (mig.340)
- ✅ Grants de más en 3 funciones + `search_path` de `productos_stock_bajo` (mig.341)
- ✅ `pg_net` movido de `public` a `extensions` (mig.342), probado en vivo sin perder ningún cron
- ✅ Auditoría de código de las 79 funciones `SECURITY DEFINER` — sin hallazgos reales
- ✅ 2 buckets públicos de Storage — auditados, `anon` no puede listar, no-issue
- ✅ Recupero de contraseña — SMTP (Gmail) y URL Configuration reconstruidos tras perderse en la
  migración de cuenta del 16/08, probado de punta a punta
- ✅ Política de contraseña 8+mayús/minús/número (servidor + frontend) + ojito para verla
- ✅ Producto "Danica" corrupto — borrado (sin movimientos reales)
- ✅ 3-Way Match de Órdenes de Compra — ya neteaba mal las NC de proveedor, corregido

**Abiertos, con dueño:**

| Qué | De quién | Nota |
|---|---|---|
| Import del resto del catálogo de kiosco (3.380 productos) | — | Pausado. El CSV no se conserva (vivía en el scratchpad de una sesión vieja) — habría que regenerarlo si se retoma |
| Bloque 5 — lectura de balanza por código de barras | — | Deferido a futuro a pedido de Nadia (21/08). Necesita un ejemplo real de etiqueta de balanza antes de diseñar el parser — no hay un estándar único |
| Dominio propio en Resend | Nadia | Deferido a propósito — Gmail SMTP ya resuelve el bloqueo total |
| CbteAsoc en `informar-caea` (circuito CAEA) | Equipo | Sin urgencia — nadie usa CAEA en producción todavía |
| MELI Factura A | — | Deferido. **No construir sin pedido explícito** |
| MP QR — reapuntar webhook | Luciano | No es nuestro |
| `pg_net` schema en `public` | — | Ya no aplica, cerrado arriba |
| Leaked password protection | — | Bloqueado por plan free (`402`), requiere Pro |
| Plan free de Supabase | — | **No es un pendiente** — decisión consciente de Nadia, no re-marcar como urgente sin que ella lo pida |
| ~~`VerAsientoButton` en el resto de los documentos~~ | — | ✅ Ya estaba hecho (Luciano, 22/08, commit `7e06f4c`) — Facturas de Compra y Recuento/Revalorización ya lo tenían. Verificado en vivo 24/08. OC/Recepciones/Ajustes de stock **no generan asiento propio hoy** (por diseño o por código sin usar) — agregar el botón ahí no mostraría nada, ver nota del 24/08 más abajo |

## 2026-08-21 — Fallback de SITE_URL corregido + 4 NC históricas corregidas ante ARCA (homologación)

### Fallback de SITE_URL apuntaba al dominio Vercel viejo

Confirmado con Luciano (captura del dashboard de Supabase, sección Edge Functions →
Secrets): no existe un secreto `SITE_URL` configurado — nunca existió. Eso significaba que
4 lugares (`_shared/auth.ts`, `mp-qr-crear`, `integraciones-oauth-callback`, `invite-user`)
estaban usando en la práctica su fallback hardcodeado a `kairox-gestion.vercel.app` (el
dominio viejo, ver [[feedback_url_produccion_correcta]]) para invitaciones de usuarios,
redirect de OAuth de integraciones, y CORS. **Fix (commit `be5e7d7`):** los 4 fallbacks
ahora apuntan a `kairox-gestion-chi.vercel.app`. Deployado en producción.

### 4 NC históricas mal declaradas ante ARCA — CORREGIDO

Retomando el pendiente documentado más arriba (`NC-20260706-003`, `NC-20260707-001`,
`NC-20260707-002`, `NC-20260728-002`, declaradas como Factura código 6 en vez de NC código
8 por el bug de `voucherTypeAfip` ya corregido). Antes de tocar nada se confirmó con
Luciano que ARCA sigue en **homologación** (no producción real) — bajó la urgencia y el
riesgo a cero, permitiendo tratarlo como ejercicio de validación del sistema.

**Hallazgo clave antes de construir nada:** `arca-worker` deriva `CbteAsoc.tipo` a partir
del campo interno `comprobantes.tipo` (`origen.tipo`) — si se hubiera reusado tal cual para
emitir una NC correctiva referenciando a estos 4 como origen, habría mandado `CbteAsoc.tipo=8`
(NC) en vez de `6` (Factura), que es lo que ARCA realmente tiene registrado para esos CAE.
Habría repetido el mismo bug que se está corrigiendo. Por eso se construyó una herramienta
aparte, de un solo uso.

**Herramienta:** `arca-corregir-nc-historica` (edge function temporal, ya borrada del repo y
del proyecto tras usarla). Llama a `callArcaEmit` (mismo helper que usa `arca-worker` en
producción) con `CbteAsoc` armado a mano (`{tipo: 6, ptoVta, nro}` = el CAE real de la
"Factura" fantasma). **Deliberadamente no escribe nada en la base** — ni `comprobantes`, ni
`cuenta_corriente_movimientos`, ni asientos — porque esos efectos ya estaban bien reflejados
desde el comprobante original (que en KAIROX siempre fue `tipo='nota_credito'`, el bug era
solo en lo que se le mandaba a ARCA). Deployada y ejecutada por Luciano mismo desde su
propia terminal (`npx supabase functions deploy` + `Invoke-RestMethod`, con guía paso a
paso) — el deploy vía MCP y el commit vía Bash quedaron bloqueados por el clasificador de
seguridad de Claude Code al tratarse de una acción que toca AFIP con certificados reales,
incluso en homologación.

**Resultado — las 4 corregidas:**

| NC original | CAE correctivo (NC B) | Comprobante | Vencimiento |
|---|---|---|---|
| NC-20260706-003 (Luciano, $87.120) | `86340781062529` | PdV 0001 #2 | 2026-09-01 |
| NC-20260707-001 (Consumidor Final, $14,52) | `86340781076209` | PdV 0001 #3 | 2026-09-01 |
| NC-20260707-002 (Katy, $9.680) | `86340781080523` | PdV 0001 #4 | 2026-09-01 |
| NC-20260728-002 (Nadia Tecera, $1.000) | `86340781080549` | PdV 0002 #1 | 2026-09-01 |

Nota-20260728-002 confirmó numeración independiente por punto de venta (arrancó en #1 en
PdV 0002, no siguió la serie de PdV 0001) — señal más de que el sistema se comportó
correctamente. Se observó también el desincronismo conocido de `FECompUltimoAutorizado` en
homologación (documentado en `_shared/afip.ts`, error `[10016]`): la primera llamada
(Luciano) se ejecutó dos veces por reintento manual y ARCA devolvió el mismo CAE la segunda
vez en vez de duplicar — comportamiento idempotente esperado, no un bug.

**Estado:** cerrado. Edge function borrada (dashboard, a cargo de Luciano) y archivo
eliminado del repo (commit `7f23b1e`). Si algún día se repite un caso similar en
producción real, la vía correcta ya quedó validada — pero antes de aplicarla en producción
real habría que confirmar con el contador real de Nalux si además hace falta una
rectificativa de IVA/IIBB para el período histórico, ya que la corrección solo neteó el
efecto hacia adelante (período actual), no reescribe lo ya declarado en el período viejo.
| Auditoría de código de las 36 funciones restantes (no muestreadas) | — | Opcional, sólo si se quiere garantía del 100% — el patrón en la muestra de mayor riesgo da confianza razonable |

## 2026-08-22 — Luciano probando en producción: 3 hallazgos sobre Facturas, 1 corregido de fondo

Sesión de Luciano conectado a producción real, facturando desde una Entrega
(PED-20260822-001 → ENT-2026-0148 → FAC-20260822-001) y abriendo el resultado
desde la sección Facturas. Reportó 4 cosas — 1 resultó ser comportamiento
correcto, 3 eran reales y se corrigieron.

**1. "La factura no se cierra al crear desde la Entrega" — FALSO POSITIVO.**
Es a propósito: ajuste de UX del 16/08 (`NuevaFacturaModal.jsx`) — el modal
queda abierto mostrando una pantalla de éxito ("Factura X creada — Total $Y")
con botones **Cerrar (Esc)** y **Registrar Cobro**, mismo patrón que Duplicar.
No se tocó nada acá — solo se le explicó a Luciano por qué es así.

**2 y 3. Popup de Facturas (`SaleDetailModal.jsx`) con diseño anterior al
rediseño — corregido.** Era el único documento del ERP que no tenía el botón
**Mapa de Relaciones** (usaba su propio `DocumentFlowPanel` simplificado en
vez del componente compartido `MapaRelaciones`), y el modal era angosto
(`max-w-2xl`) en vez del shell ancho (`96vw`/`92vh`) que ya usan Entrega, OC,
Pedido, Cotización, Recepciones, Facturas de Compra. Se alineó a ese patrón.

De paso se encontró que `VentasSection.jsx` tenía un handler de navegación
(`handleDocFlowNavigate`) que solo entendía "sección" (cambiar de tab), no
"tipo+id" de documento — clickear "ver detalle" en un nodo de Mapa de
Relaciones desde Facturas no habría abierto el documento puntual, solo
cambiado de tab. Se unificó en `handleVentasNavigate`, que resuelve ambas
formas (compatibilidad con `DocumentFlowPanel` Y con `MapaRelaciones`).
Verificado en vivo: click en el chip "Pedido" del mapa de FAC-20260822-001
abrió `ModalDetallePedido` con `PED-20260822-001` real, no solo cambió de tab.

**4. Ningún documento del ERP linkeaba al asiento contable generado — gap
real y grande, corregido para Ventas (resto queda para después).** El dato
siempre existió (`asientos_contables.origen`/`origen_id`, y
`comprobantes.asiento_id` directo) — nadie había construido el link. Nuevo:

- `src/components/shared/ModalDetalleAsiento.jsx` — extraído del modal
  "Ver detalle" que ya tenía `TabAsientos.jsx` (Contabilidad → Plan de
  Cuentas → Asientos), ahora única fuente de verdad — `TabAsientos.jsx` lo
  reusa en vez de tener su propia copia duplicada.
- `src/components/shared/VerAsientoButton.jsx` — botón genérico, reusable en
  cualquier documento: acepta `asientoId` directo (Ventas, y en el futuro
  Recuento/Revalorización que también lo guardan) o `empresaId`+`origen`+
  `origenId` para los documentos que no lo guardan directo (OC, Recepciones,
  ajustes de stock, CC) — en ese caso resuelve con el método nuevo
  `asientosService.getAsientoPorOrigen`.
- Cableado en `SaleDetailModal.jsx` (Ventas) por ahora. **Pendiente
  replicarlo** en Órdenes de Compra, Recepciones, Facturas de Compra,
  Recuento/Revalorización de Inventario, ajustes de stock — mecánico, mismo
  componente, solo hay que agregar el botón en cada `ModalDetalle*`.

Verificado en vivo contra `FAC-20260822-001` real: "Ver asiento" muestra
`AS-000248` balanceado (Cuentas a Cobrar / Ventas de Productos / IVA Débito
Fiscal). Eslint 0 errores nuevos, vitest 159/159, vite build OK. Commit
`09876bf`.
