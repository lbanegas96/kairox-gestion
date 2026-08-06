# Fidelización por Puntos — Plan de implementación por fases

**Estado:** plan recién armado, sin código ni migraciones todavía. Investigación de mercado y
hallazgos del código en `INVESTIGACION_FIDELIZACION_PUNTOS.md` — leer primero, ahí están las 3
decisiones de negocio ya tomadas por Nadia (07/08): canje = descuento directo en pesos, gratis
para todas las empresas, los puntos no vencen.

## Diseño

**Alcance confirmado:** cada empresa que usa KAIROX fideliza a SUS propios clientes — no hay
coalición entre empresas distintas. Sigue el mismo patrón multi-tenant configurable que ya usan
`usa_tc_paralelo`/`usa_centros_costo`/`usa_ecommerce` en `empresas`: cada tenant prende o no la
funcionalidad y define su propio ratio.

**Dos ratios, no uno** (patrón estándar de la industria, confirmado en la investigación —
protege el margen del comercio): cuánto se **gana** por peso gastado puede ser distinto de
cuánto **vale** cada punto al canjear. Ej.: gana 1 punto cada $100 gastados, cada punto vale $1
de descuento al canjear → ~1% de devolución efectiva. Ambos números los define cada empresa.

**Por qué NO reusar el motor de ofertas existente (`ofertas` + `calcular_ofertas_carrito`):**
ese motor aplica descuentos automáticos — el sistema decide, el cajero no elige nada. Canjear
puntos es una decisión explícita del cliente en el momento de cobrar (parecido a cómo el cajero
elige "Cuenta Corriente" como medio de pago). Mezclarlo con el motor de ofertas repetiría el
error que costó arreglar la migración 214 (medios de pago hardcodeados en 3 pantallas antes de
unificarlos) — un circuito nuevo, chico y explícito es más seguro que forzar dos conceptos
distintos en el mismo lugar.

**Registro auditable, no sólo un saldo** (mismo criterio que `movimientos_caja` sobre
`caja_sesiones`, y que el propio Modo Offline reforzó con `ventasPendientes`): nunca guardar
sólo el número final — se necesita el historial de cómo se llegó ahí, para poder explicarle a un
cliente por qué tiene el saldo que tiene, y para poder auditar/revertir si algo sale mal.

### Modelo de datos propuesto

- **`empresas`**: `usa_fidelizacion boolean DEFAULT false`, `puntos_pesos_por_punto numeric`
  (cuántos pesos gastados = 1 punto ganado), `puntos_valor_pesos numeric` (cuántos pesos de
  descuento vale 1 punto al canjear). Sin fila de config separada — son sólo 3 valores, no
  ameritan una tabla aparte todavía (a diferencia de multi-caja, que sí necesitaba un CRUD real).
- **`clientes.saldo_puntos numeric NOT NULL DEFAULT 0`** — mismo patrón visual/mental que
  `saldo_actual` (cuenta corriente), que Nadia y los cajeros ya conocen.
- **Tabla nueva `movimientos_puntos`**: `id, empresa_id, cliente_id, comprobante_id (nullable),
  tipo ('ganado'|'canjeado'|'ajuste_manual'), puntos numeric, saldo_posterior numeric,
  created_at, user_id`. RLS estándar por `empresa_id` (mismo patrón que toda tabla nueva del
  proyecto).

### RPC — `crear_venta` gana 2 parámetros opcionales

Mismo patrón ya usado 3 veces este mes (mig.309 con `p_client_uuid`, mig.310 con lo mismo para
`abrir_caja_sesion`): **`DROP FUNCTION` + `CREATE FUNCTION`** con los parámetros nuevos al final
con `DEFAULT`, nunca `CREATE OR REPLACE` (crea un overload huérfano en vez de reemplazar, ya
pasó 2 veces en este proyecto — mig.264/308).

- `p_puntos_canjeados numeric DEFAULT 0` — si es mayor a 0: valida que el cliente tenga saldo
  suficiente (`FOR UPDATE` sobre la fila de `clientes`, mismo patrón de lock que ya usa
  `crear_venta` para stock), descuenta del total el equivalente en pesos
  (`puntos_canjeados * puntos_valor_pesos`), resta el saldo del cliente, inserta el movimiento
  `'canjeado'` — todo en la misma transacción que ya mueve stock y genera el comprobante.
- Ganado automático: al final de la misma función, si `empresas.usa_fidelizacion`, calcula
  `floor(total / puntos_pesos_por_punto)`, suma al saldo del cliente, inserta el movimiento
  `'ganado'` con el `comprobante_id` recién creado. **Sin cliente asociado a la venta (Consumidor
  Final) no hay a quién sumarle puntos** — no aplica, no es un caso a resolver, es lo esperado.

### UI

- **`ConfiguracionSection.jsx`** (nueva sub-sección en Finanzas, mismo lugar que el CRUD de
  Cajas que se agregó para multi-caja) — toggle `usa_fidelizacion` + los 2 inputs de ratio.
- **`ClienteSelector`** (compartido entre `PanelCarrito.jsx` del POS y `NuevaVentaModal.jsx` del
  ERP — un solo lugar para tocar, sirve para los dos circuitos de venta) — muestra el saldo de
  puntos del cliente elegido, sólo si `usa_fidelizacion`.
- **Checkout**: un input chico "Canjear N puntos" cerca del total (mismo estilo que el descuento
  manual que ya existe por ítem) — recalcula el total en vivo, capado al saldo disponible y a no
  dejar el total en negativo.
- **Ticket/modal de venta exitosa**: si ganó puntos, mostrar "Ganaste X puntos" — mismo lugar
  donde `TicketPrint.jsx` ya muestra CAE/PROVISORIO, información post-venta relevante.

### Fases propuestas

1. **Fase 0 — Backend**: columnas nuevas en `empresas`/`clientes`, tabla `movimientos_puntos`,
   `crear_venta` con los 2 parámetros nuevos (ganado automático + canje). Sin UI todavía — se
   prueba por SQL directo, mismo criterio que las fases de backend anteriores (mig.309/310/311).
2. **Fase 1 — Configuración**: toggle + ratios en Finanzas. Sin esto activo, nada del resto
   aplica — es la que desbloquea probar las fases siguientes con datos reales de una empresa de
   prueba.
3. **Fase 2 — Ganar puntos**: `ClienteSelector` muestra el saldo; cada venta con cliente asociado
   suma puntos sola. Sin canje todavía — sólo acumular y ver el saldo crecer.
4. **Fase 3 — Canjear puntos**: el input en el checkout, descuento aplicado, saldo se descuenta.
   Cierra el círculo completo.

**Fuera de alcance por ahora** (documentado, no descartado): catálogo de premios, niveles
Bronce/Plata/Oro, vencimiento de puntos, multiplicadores por horario/día flojo — todo esto
apareció en la investigación de mercado pero Nadia decidió no arrancar por ahí. Quedan como
posibles fases futuras si algún cliente de KAIROX las pide.

## Nota sobre el orden de aprobación

Mismo criterio que el resto del proyecto: se arranca por la Fase 0 recién con el "dale" de Nadia,
se verifica y se documenta en `CONTEXT.md` antes de pasar a la Fase 1, y así sucesivamente — no
se arranca ninguna fase sin haber cerrado (código + tests + verificación) la anterior.

## ✅ Fase 0 — HECHA y probada en vivo (07/08, mig.312)

Aplicada `312_fidelizacion_puntos_fase0.sql`: columnas nuevas en `empresas`/`clientes`, tabla
`movimientos_puntos` con RLS, y `crear_venta` con `p_puntos_canjeados integer DEFAULT 0` (patrón
DROP+CREATE).

**Hallazgo de paso, corregido en la misma migración:** `crear_venta` todavía le daba EXECUTE
directo a `anon` (usuarios sin login) — mig.309 sólo había revocado de `PUBLIC`, un grant aparte
a `anon` de antes de esa migración nunca se había tocado. Verificado con
`has_function_privilege` antes (true) y después (false) del REVOKE explícito.

**Probado en vivo contra producción (Nalux), simulando una sesión real** (`set_config`
`request.jwt.claim.sub` con el user id real de Nadia, mismo mecanismo que usa Supabase para
`auth.uid()` — necesario porque `crear_venta` valida `get_my_empresa_id()` contra el JWT, no
alcanza con SQL directo sin JWT) **con un producto y un cliente 100% sintéticos** (nombre
`TEST-FIDELIZACION-DELETE-ME`, fáciles de identificar y borrar):

- Cliente arranca con 50 puntos. Venta de $1.000 con `puntos_pesos_por_punto=100`,
  `puntos_valor_pesos=1`, canjeando 20 puntos → devuelve `puntos_ganados: 10` ✅. Verificado
  contra la base: `saldo_puntos` termina en 40 (50 − 20 + 10), y `movimientos_puntos` tiene
  exactamente 2 filas (`canjeado` 20→saldo 30, `ganado` 10→saldo 40) con el `comprobante_id`
  correcto.
- Canjear más de lo disponible (999 puntos con sólo 40 en saldo) → rechaza limpio con
  `"Saldo de puntos insuficiente (disponible: 40, solicitado: 999)"`, transacción completa
  revertida (stock sin tocar, 0 comprobantes creados) ✅.
- Canjear con `usa_fidelizacion=false` → rechaza limpio con
  `"Fidelización por puntos no está activada para esta empresa"` ✅.
- **Una venta sin tocar puntos (`p_puntos_canjeados` en su default 0, exactamente como llama hoy
  cualquier caller existente) sigue funcionando idéntico a antes** — comprobante creado normal,
  `puntos_ganados: 0` sin fidelización activa, sin ningún error. Confirma cero regresión para
  el ERP y el POS online/offline tal como están hoy.

**Todo el dato de prueba revertido después:** 0 comprobantes/productos/clientes con el nombre de
test remanentes, 0 filas en `movimientos_puntos`, `empresas.usa_fidelizacion` vuelto a `false` y
los ratios a `NULL` — Nalux quedó exactamente como estaba antes de la prueba.

`get_advisors` (security): 0 alertas nuevas relacionadas a `movimientos_puntos` — RLS reconocida
correctamente.

**Sigue la Fase 1** (Configuración por empresa — toggle + ratios en Finanzas) recién con el
próximo "dale".

## ✅ Fase 1 — HECHA (07/08): Configuración por empresa (toggle + ratios en Finanzas)

Sin migración nueva — usa las columnas de `empresas` que ya agregó la Fase 0
(`usa_fidelizacion`, `puntos_pesos_por_punto`, `puntos_valor_pesos`).

**UI nueva**, siguiendo el mismo patrón visual/de guardado que ya usa "Moneda Paralela" en la
misma pantalla (toggle + campos condicionales + botón "Guardar" explícito, en vez de auto-guardar
como los toggles simples de un solo booleano):

- **`ConfiguracionSection.jsx`**: nuevo grupo de estado `fidelizacionConfig` (`usa_fidelizacion`,
  `puntos_pesos_por_punto`, `puntos_valor_pesos`) + `loadingFidelizacion`/`savingFidelizacion`.
  Se carga desde `empresas` al montar (mismo `useEffect` que el resto de los toggles de la
  pantalla) y se guarda con `handleSaveFidelizacion`, que valida en el cliente — antes de pegarle
  a la base — que si `usa_fidelizacion` está en `true` los dos ratios sean números mayores a 0
  (mismo criterio que los `CHECK (... IS NULL OR > 0)` de la migración 312, pero avisando antes
  con un toast en vez de esperar el error de Postgres).
- **`TabFinanzas.jsx`**: card nueva "Fidelización por Puntos" (ícono `Gift`), con el toggle, los
  2 inputs numéricos (sólo visibles si está activo), un resumen de 3 badges en vivo (cuánto vale
  cada punto, cuánto hace falta gastar para ganar uno, y el % de devolución efectiva que implica
  esa combinación) y el botón "Guardar configuración de fidelización".

**Verificación:** `npx eslint` sobre los 2 archivos → 0 errores (sólo warnings preexistentes de
`react/prop-types`, mismo patrón que el resto del archivo, que no usa PropTypes en ningún lado).
`npx vite build` → build limpio.

**Probado en vivo por Nadia en producción (07/08), Nalux:** activó el toggle, cargó
`puntos_pesos_por_punto=100` / `puntos_valor_pesos=1`, vio el resumen en vivo ("$100 gastados =
1 punto" / "1 punto = $1 de descuento" / "≈1.00% de devolución efectiva"), guardó (cartel verde
"Fidelización guardada"), recargó la página y los 3 valores quedaron exactamente igual —
confirma que persiste de verdad en `empresas`, no sólo en el estado de React.

**⚠️ Corrección importante sobre el alcance real de activar el toggle** (esto NO es lo que decía
la primera versión de esta sección — se corrige acá tras revisar `crear_venta` con más cuidado):
**ganar puntos ya funciona de verdad desde que el toggle queda activo**, no depende de que la
Fase 2 esté construida — la lógica de "sumar puntos al cliente" vive en `crear_venta` desde la
Fase 0 (mig.312) y corre en **toda venta real con cliente asociado**, en el POS y en el ERP, sin
que ninguna pantalla nueva tenga que llamarla. Lo único que de verdad depende de fases
siguientes:
- **Fase 2** sólo agrega la parte *visible*: que `ClienteSelector` muestre el saldo acumulado.
  Los puntos ya se están sumando aunque esta fase no esté — sólo que nadie los ve todavía.
- **Fase 3** sí es un gate real: canjear puntos requiere que la UI arme
  `p_puntos_canjeados > 0` al llamar `crear_venta`, y ningún caller de hoy (POS ni ERP) lo hace
  — así que **nadie puede canjear** hasta que esa fase exista, sin importar el toggle.

**Decisión de Nadia (07/08), avisada esta corrección:** deja la fidelización **activa** en Nalux
con los ratios 100/1 — los puntos de los clientes reales ya empiezan a acumularse desde ahora
(auditable en `movimientos_puntos`, reversible), listos para mostrarse en cuanto la Fase 2 esté
lista, sin perder nada del camino ya recorrido.

## ✅ Fase 2 — HECHA (07/08): Ganar puntos, visible

Sin migración nueva — ganar puntos ya corría desde la Fase 0; esta fase sólo lo hace *visible* y
le da feedback al cajero en el momento. Un solo lugar de datos (`ClienteDrillDown.jsx`) cubre los
dos circuitos de venta, tal como preveía el diseño original:

- **`ClienteDrillDown.jsx`** (el popover "ojo" que ya usa `ClienteSelector` — compartido por
  `PanelCarrito.jsx` del POS y `NuevaVentaModal.jsx` del ERP): nuevo bloque "Saldo de Puntos"
  junto al de "Saldo Cta. Corriente" que ya existía, con el mismo estilo visual. Sólo se muestra
  si `empresas.usa_fidelizacion` es `true` — se agregó una tercera consulta en el mismo
  `Promise.all` que ya traía saldo/límite y últimas compras.
- **`useConfirmarVenta.js`** (POS): `crear_venta` ya devolvía `puntos_ganados` desde la Fase 0 —
  ahora se propaga al objeto `comprobante` y al toast de éxito (`+N puntos para {cliente}`).
- **`TicketPrint.jsx`** (ticket térmico del POS): banner "¡Ganaste N puntos!" cuando
  `venta.puntos_ganados > 0` — mismo lugar donde ya avisa CAE/PROVISORIO.
- **`NuevaVentaModal.jsx` + `TicketPDF.jsx`** (ERP, factura en PDF): mismo tratamiento — toast
  con los puntos ganados y una línea en el PDF si corresponde.
- Sin cambios en `crear_venta` ni en ningún otro RPC — Fase 2 es 100% frontend, sólo lee un campo
  que el backend ya devolvía.

**Verificación:** 5 tests nuevos (`ClienteDrillDown.test.jsx`, nuevo — con y sin fidelización
activa, más una prueba de no-regresión del saldo de cta. cte.; 2 casos nuevos en
`useConfirmarVenta.test.js`; 3 casos nuevos en `TicketPrint.test.jsx`). Suite completa:
**140/140 en verde**. `npx eslint` sobre los 6 archivos tocados → 0 errores (sólo warnings
preexistentes, mismo patrón que el resto del proyecto). `npx vite build` → build limpio.

**Sigue la Fase 3** (Canjear puntos — input en el checkout, descuento aplicado, saldo se
descuenta) recién con el próximo "dale". Hasta entonces los puntos siguen acumulándose y ahora
además se ven, pero **nadie puede canjearlos todavía** — eso es exactamente lo que decide la
Fase 3.

### 🐛 3 fixes de UI encontrados por Nadia probando Fase 2 en vivo (07/08)

Probando en su notebook (ventana de navegador no maximizada, ~660px de alto visible) encontró:

1. **El popover del "ojo" (`ClienteDrillDown`) se cortaba contra el borde derecho de la
   pantalla** — usaba `absolute left-0` (abre hacia la derecha desde el botón), y el botón está
   pegado al borde derecho del panel angosto del carrito en el POS. Fix: `right-0` (abre hacia la
   izquierda, que siempre tiene más lugar). Verificado con la sesión real de Nadia contra
   producción: el popover completo (`left ≥ 0, right ≤ innerWidth`) y mostrando
   "Saldo de Puntos: 270 pts" para Carlos Perez.
2. **El botón "Confirmar Venta" quedaba tapado en ventanas de navegador bajas** — bug clásico de
   flexbox: al listado de items del carrito (`flex-1 overflow-y-auto`) le faltaba `min-h-0` en su
   contenedor, así que no se achicaba y el contenido de abajo (medio de pago/totales/botón) quedaba
   recortado por el `overflow-hidden` del layout padre (`ModoCajaLayout`, `h-screen`). Ya estaba
   resuelto así en el PanelCarrito hermano del ERP — se copió el mismo fix acá (`PanelCarrito.jsx`
   del POS + su wrapper en `ModoCajaLayout.jsx`). Verificado programáticamente contra un viewport
   de 660px de alto: el botón queda 100% dentro de pantalla.
3. **Los puntos ganados no se veían lo suficiente** — sólo estaban en el toast (efímero, fácil de
   no ver) y no en el modal "¡Venta confirmada!" que sí queda en pantalla. Se agregó un badge
   "¡Ganaste N puntos!" dentro de ese modal, junto al Total.

**Gap real encontrado de paso (documentado, no resuelto todavía):** las ventas cobradas con **QR
MercadoPago** no ganan puntos — ese flujo usa un RPC totalmente distinto
(`crear_venta_pendiente_qr` + `confirmar_pago_qr`), no `crear_venta`, así que la lógica de
ganar puntos (que vive dentro de `crear_venta`) nunca corre ahí. Cambiarlo requiere tocar esas
migraciones con cuidado — queda anotado para una fase futura, no es parte de esta.

Verificación: suite completa 140/140 en verde (sin tests nuevos — los 3 fixes son CSS/wiring
puro, mismo criterio que el resto del proyecto para este tipo de cambio), `eslint`/`vite build`
en 0 errores.

## ✅ Fase 3 — POS (PanelCarrito.jsx) HECHA (07/08): Canjear puntos

Sin migración nueva — `crear_venta` ya soportaba `p_puntos_canjeados` desde la Fase 0. Fase 3 es
el circuito completo del lado del cliente: el cajero elige cuántos puntos canjear, el total se
recalcula en vivo, y `crear_venta` valida el saldo real y mueve el ledger.

- **`PanelCarrito.jsx`**: fetch de `usa_fidelizacion`/`puntos_valor_pesos` (online-only, a
  propósito sin snapshot offline — canjear necesita el saldo real del servidor, no uno viejo) +
  `saldo_puntos` agregado al select de clientes. Card "Canjear puntos" cerca del total, visible
  sólo si hay conexión + fidelización activa + cliente elegido con saldo > 0 + ratio cargado.
  Clampea en vivo al mínimo entre el saldo del cliente y lo que el total permite (nunca deja el
  total negativo). El total que ve el cajero y el que arma `useMultipago` para dividir el pago
  ya es el neto (`totalFinal = total - descuentoPuntosPesos`) — no el bruto.
- **`useConfirmarVenta.js`**: recibe `puntosCanjeados`/`descuentoPuntosPesos`, resta el
  descuento del total antes de mandarlo a `crear_venta` junto con `p_puntos_canjeados`. Guard
  defensivo (mismo criterio "nunca confiar en el cliente" que ya usa esta función para
  offline/medios de pago): si `puntosCanjeados > 0` sin conexión o sin cliente, rechaza antes de
  llamar al servidor — la UI ya lo oculta, esto es el respaldo.
  Redención **no soportada offline** — a diferencia de Efectivo/Transferencia, canjear necesita
  el saldo real del servidor en el momento; el snapshot local podría estar viejo y dejar canjear
  de más.
- **`TicketPrint.jsx` / `TicketPDF.jsx` (ERP, para cuando exista) / modal "¡Venta confirmada!"
  (`ModoCajaLayout.jsx`)**: línea "Descuento por puntos (N)" cuando la venta canjeó puntos —
  mismo lugar/estilo que la línea de descuentos por ofertas.

**Verificación:** 20 tests nuevos (10 en `PanelCarrito.test.jsx` — visibilidad condicional,
clamping al saldo, cálculo del descuento, guard offline, llamada a `confirmar()` con los
parámetros correctos; 4 en `useConfirmarVenta.test.js`; 3 en `TicketPrint.test.jsx`). Suite
completa: **152/152 en verde**. `eslint`/`vite build` en 0 errores.

**Todavía no está en el ERP** (`NuevaVentaModal.jsx`, la pantalla "Nueva Venta" fuera del POS) —
mismo criterio de checkpoints del resto del proyecto: se cierra y se prueba el POS primero
(que es lo que usa Nadia todos los días) antes de replicar el mismo circuito ahí.
