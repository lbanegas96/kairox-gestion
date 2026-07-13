# Plan de Pruebas para Nadia — 2026-07-12

Ya está todo deployado en producción (probado con `BEGIN...ROLLBACK` contra datos reales antes de
subir, y verificado en el navegador antes de avisarte). Este plan cubre 3 cosas: un fix de Cheques,
la resolución de las facturas AFIP que estaban atascadas sin CAE, y una pantalla nueva que reemplaza
la vieja lista de "Facturas con Error".

---

## Bloque 1 — Cheques: rechazar/entregar ya resincroniza el estado de la factura

**Qué se corrigió:** si un cheque de un cliente que ya estaba imputado contra una factura específica
rebotaba, la factura quedaba marcada "Pagada" para siempre aunque la deuda se hubiera reabierto en la
cuenta corriente. Mismo problema del lado de cheques propios (los que ustedes entregan a un
proveedor) — entregar uno ahora sí marca la compra como pagada, y si después se rechaza, la vuelve a
abrir.

**Cómo probar:**
1. Cuenta Corriente → elegí un cliente con saldo, cobrale una factura completa con un cheque de
   tercero (o usá uno que ya tengas "en cartera" imputado a una factura puntual).
2. Fijate que esa factura pasó a "Pagada".
3. Cheques → "Mové" ese cheque a "Rechazado".
4. **Resultado esperado:** la factura vuelve a "Pendiente" (o "Parcial" si tenía otros pagos
   parciales) automáticamente — no hace falta tocar nada más.
5. Repetí el mismo chequeo con un cheque propio: entregalo contra una compra a un proveedor → la
   compra pasa a "Pagada"; rechazalo → vuelve a "Pendiente".

**Avisame:** si el estado de la factura/compra cambió solo, sin que tengas que hacer nada manual.

---

## Bloque 2 — Facturas AFIP atascadas: ya deberían tener CAE

**Qué pasaba:** un grupo de facturas de principios de julio (del 3 al 7) habían quedado sin CAE
por un problema de numeración ante AFIP — quedaron "huérfanas" de su lugar en la secuencia porque el
negocio siguió facturando con normalidad mientras ellas estaban paradas por otro tema (ya resuelto
antes). Encontré la causa raíz, corregí el problema real (no era solo reintentar) y las reencolé.

**Cómo probar:**
1. Ventas → pestaña nueva **"Facturación AFIP"** (ver Bloque 3 más abajo para más detalle de esta
   pantalla).
2. Filtrá por fecha: Desde 2026-07-03, Hasta 2026-07-08.
3. **Resultado esperado:** todas las facturas de ese rango deberían figurar en verde ("Emitido") con
   un Número AFIP real (formato `0001-000000XX`). Si ves alguna todavía en amarillo ("En cola") o roja
   ("Error"), avisame el número de venta exacto — puede necesitar un empujón más.

**Avisame:** si ves alguna factura de ese rango que NO quedó en verde con su número AFIP.

---

## Bloque 3 — Pantalla nueva: Monitor de Facturación AFIP (y por qué cambió de lugar)

**Qué es:** reemplaza la vieja lista que solo mostraba facturas con error. Ahora es una vista
completa de TODAS tus facturas y su estado ante AFIP, con filtros — parecido a lo que tienen los
sistemas grandes tipo SAP para esto.

**Por qué se movió:** antes vivía dentro de Configuración, pero eso significaba que un empleado con
permiso solo de Ventas no la podía ver — y darle permiso de Configuración le abriría también
Integraciones, Usuarios y otras cosas que no debería tocar. Ahora vive en **Ventas → pestaña
"Facturación AFIP"**, visible para cualquiera que ya pueda facturar.

**Cómo probar:**
1. Ventas → "Facturación AFIP". Deberías ver un resumen arriba (Total, Emitidas, En cola, Con error)
   y una tabla abajo.
2. Probá los filtros: cambiá el rango de fechas, tocá los chips de estado (por defecto está oculto
   "No relevante" — tocalo y deberían aparecer más filas).
3. Buscá algo por número de cliente o de comprobante en el buscador.
4. Si ves alguna factura en error, tildá el checkbox de una o varias y probá "Reintentar
   seleccionadas".
5. Hacé clic en "Detalle" de cualquier factura — debería abrirse con el CAE, vencimiento, y el error
   si tuvo alguno.
6. Confirmá que en Configuración → Facturación esta lista ya NO está — ahí solo debería quedar la
   configuración (credenciales, puntos de venta, tipos de comprobante, series, pie de página).

**Avisame:** si la pantalla nueva te resulta clara, si los filtros funcionan como esperás, y si notás
algo raro en los números o estados mostrados.

---

## Bloque 4 — Regresión general (como siempre)

- [ ] Venta normal (Efectivo y Cuenta Corriente), con y sin AFIP
- [ ] Cobrar una Cuenta Corriente de cliente
- [ ] Pagar a un proveedor
- [ ] Abrir y cerrar caja
- [ ] Un cheque de tercero "normal" (recibido → depositado → cobrado, sin rechazo)
- [ ] Dashboard y Reportes sin nada raro

---

## Qué contarme al terminar

Para cada bloque: ✅ salió como se esperaba, o ⚠️ algo no coincidió (contame qué, con captura si
podés).

## Cómo seguimos

Con esto, el recorrido punto por punto de todos los módulos (Ventas, Compras, Inventario, Bancos/Caja,
Cuenta Corriente, Impuestos, Configuración, Cheques) queda cerrado. Lo único que sigue realmente
pendiente del plan original:

1. **Auditoría visual** (espaciado, colores, layout) con capturas reales — quedó pausada por un
   problema de la herramienta de screenshots de mi lado, no de KAIROX. La retomamos la próxima sesión.
2. **"Leaked Password Protection"** en Supabase Auth — sigue siendo tu decisión (requiere plan pago de
   Supabase), no hay nada más que evaluar de mi lado.

Te recomiendo: probá este plan primero (son los cambios más recientes y los que más te pueden afectar
el día a día), y si todo sale ✅, arrancamos la próxima sesión directo por la auditoría visual para
cerrar el plan completo cuanto antes.
