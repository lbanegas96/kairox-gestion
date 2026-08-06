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
`npx vite build` → build limpio. Verificación visual en el preview limitada a "la app carga sin
errores de consola" — no se pudo ver la pantalla de Configuración en sí porque queda detrás del
login y, como en las fases anteriores del proyecto, no se inicia sesión desde el entorno de
verificación automática. Falta la prueba visual real: que Nadia entre a Configuración → Finanzas,
active el toggle, cargue los 2 ratios y guarde — pendiente para cuando ella lo prueba en vivo.

**Sin esto todavía no pasa nada solo** — activar el toggle y guardar los ratios no hace que las
ventas sumen o descuenten puntos; eso es la Fase 2 (ganar) y la Fase 3 (canjear), que siguen sin
arrancar hasta el próximo "dale".
