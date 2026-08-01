# KAIROX Gestión — Contexto de Sesión
**Última actualización:** 2026-08 (Luciano/Claude — ajuste masivo de precios en Listas de Precios, mig.290, probado en vivo end-to-end)

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

**Hallazgo secundario de la misma auditoría, PENDIENTE (no se tocó todavía):** en Ventas/Compras el asiento se dispara en una llamada separada después de que el documento ya se confirmó (no atómico) — a diferencia de CxC/CxP (que sí tienen `asiento_id` en la fila + `regenerar_asiento_cxc/cxp`), no hay forma de regenerar manualmente un asiento de venta/compra que falló. Es la próxima tarea.

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
