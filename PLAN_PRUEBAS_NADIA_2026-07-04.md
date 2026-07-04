# Plan de Pruebas para Nadia — 2026-07-04

Este plan cubre **todo lo auditado y corregido hoy** (sesión 46): áreas #8 a #15 del
`PLAN_AUDITORIA.md` (cerrando la Fase 1 completa, 15/15 áreas) + los 3 pendientes que quedaron
documentados y que también se cerraron hoy. Ya está deployado en producción. Probá con tu usuario
admin y, donde se indique, con un usuario staff de prueba.

---

## Bloque 1 — Multi-moneda / Tipos de cambio

**Qué cambió:** si tenés Compras registradas con pago en Efectivo, ahora si algo falla al grabar el
movimiento de Caja vas a ver un error claro (antes podía quedar la compra registrada sin el egreso de
caja, sin avisarte).

**Cómo probar:**
1. Registrá una Compra Rápida pagada en Efectivo con la caja abierta.
2. Confirmá que aparece el egreso correspondiente en Caja.
3. Si tenés activada la Moneda Paralela (Configuración → Finanzas), probá importar/cargar un
   extracto o compra con un monto que tenga separador de miles (ej. "1.234,56") y verificá que el
   monto quede bien (antes un monto así podía leerse mal por errores de formato).

---

## Bloque 2 — Períodos contables / Cierre

**Qué cambió:** cerrar o reabrir un período contable ahora es **solo para administradores** — antes
cualquier usuario podía hacerlo aunque el botón no apareciera en su pantalla.

**Cómo probar:**
1. Con tu usuario admin, andá a Plan de Cuentas → tab Períodos y confirmá que podés crear/cerrar/
   reabrir un período normalmente (nada cambió para vos).
2. Si un período está cerrado y intentás cargar una venta/compra/movimiento de caja con esa fecha,
   ahora vas a ver un aviso ("Asiento contable no generado") si el asiento no se pudo generar por
   eso — la operación se sigue registrando igual, solo te avisa que el asiento contable no se creó.

---

## Bloque 3 — Conciliación bancaria

**Qué cambió:** se corrigió un bug de seguridad (match cross-tenant, no afecta tu uso normal) y el
parser de CSV ahora entiende montos con formato argentino.

**Cómo probar:**
1. Andá a Bancos → Conciliación, importá un extracto CSV con algún monto que tenga miles (ej.
   "$ 1.234,56") y confirmá que el monto importado es el correcto (antes podía leerse como "1.234").
2. Hacé un match manual entre una línea del extracto y un movimiento bancario real — debería
   funcionar exactamente igual que antes.

---

## Bloque 4 — Ofertas / Descuentos

**Qué cambió:** si configurás una oferta para **un producto específico** Y además completás el campo
Categoría, ahora el descuento se aplica **solo a ese producto** (antes se filtraba a toda la
categoría, aplicando el descuento a productos que no correspondía).

**Cómo probar:**
1. Configuración → Ofertas → creá una oferta con un producto específico elegido Y con el campo
   Categoría también completado.
2. Vendé ese producto puntual → debería tomar el descuento.
3. Vendé otro producto de la misma categoría (sin ser el elegido) → **no debería tomar el
   descuento** de esa oferta.

---

## Bloque 5 — Pedidos / Entregas (sobre-entrega)

**Qué cambió:** ya no se puede entregar más cantidad de la que un pedido tiene cargada.

**Cómo probar:**
1. Creá un Pedido con 1 ítem de cantidad 5.
2. Generá una Entrega de 5 unidades → debería funcionar y quedar "Entregado" completo.
3. Intentá generar otra Entrega más sobre el mismo pedido/ítem → debería **rechazarla** con un
   mensaje de "sobre-entrega".
4. Probá también el caso normal: un pedido de 5, entregar 3 y después 2 más (entrega parcial en 2
   pasos) → debería funcionar sin problema.

---

## Bloque 6 — Comprobantes / Notas de Crédito (el más importante de hoy)

**Qué cambió:** se cerró un agujero de seguridad grave — antes cualquier usuario (no solo admin)
podía borrar una factura ya emitida directamente. Ahora **no se puede borrar ningún comprobante,
nota de crédito, nota de débito, ni movimiento de cuenta corriente** — solo se pueden anular con los
mecanismos normales del sistema (Nota de Crédito, Devolución).

**Cómo probar:**
1. Generá una venta normal y confirmá que aparece en el Historial de Ventas como siempre.
2. Desde el Historial, probá "Copiar a NC" sobre esa venta — creá una Nota de Crédito y confirmá que
   la deuda del cliente baja correctamente en su Cuenta Corriente.
3. No hace falta que pruebes activamente "tratar de borrar" nada — es un cambio de seguridad interno,
   simplemente confirmá que tu flujo normal de facturación/NC/ND sigue funcionando igual que siempre.

---

## Bloque 7 — Cierre del gap contable (Cobro, Pago y Cheques)

**Qué cambió — el más grande de hoy:** los cobros a clientes, los pagos a proveedores y los cheques
de terceros ahora generan automáticamente su asiento contable. Antes esto NO pasaba — el Balance
General y el Estado de Resultados podían no reflejar bien estos movimientos.

⚠️ **Importante:** el esquema de cuentas que se usó lo definí yo (Claude) siguiendo la misma lógica
que ya usaba el sistema para Ventas/Compras — pero **no soy contador**. Te recomiendo mostrarle a tu
contador el Balance General y el Estado de Resultados después de hacer estas pruebas, para que
confirme que los asientos nuevos están bien imputados antes de usarlos para algo oficial (DDJJ,
balance real, etc.).

**Cómo probar:**
1. Cobrá una cuenta corriente de un cliente (Cuenta Corriente → Cobrar).
2. Andá a Plan de Cuentas → Asientos y confirmá que aparece un asiento nuevo: Debe "Caja y Bancos",
   Haber "Cuentas a Cobrar", por el monto cobrado.
3. Pagá a un proveedor (Proveedores → Cuenta Corriente → Pagar).
4. Confirmá el asiento: Debe "Cuentas a Pagar", Haber "Caja y Bancos".
5. Registrá un cheque de tercero (Cheques → Registrar cheque recibido), vinculado a un cliente.
6. Confirmá que se generó un asiento: Debe "Cheques de Terceros en Cartera", Haber "Cuentas a
   Cobrar" (la deuda del cliente bajó, igual que si hubiera pagado en efectivo).
7. Cambiá el estado de ese cheque a "Cobrado" → debería generar OTRO asiento: Debe "Caja y Bancos",
   Haber "Cheques de Terceros en Cartera".
8. Como prueba alternativa, registrá otro cheque y marcalo "Rechazado" en vez de cobrado → debería
   generar un asiento que **restaura la deuda del cliente** (vuelve a "Cuentas a Cobrar").

**Nota:** los cheques *propios* (los que ustedes emiten a un proveedor) todavía NO generan asiento —
eso quedó pendiente, requeriría agregar una cuenta contable nueva que hoy no existe.

---

## Bloque 8 — Regresión general (como siempre)

- [ ] Hacer una venta normal (efectivo y con cuenta corriente)
- [ ] Cobrar una cuenta corriente de cliente
- [ ] Pagar a un proveedor
- [ ] Abrir y cerrar caja
- [ ] Generar un pedido → entrega → factura (document flow completo)
- [ ] Ver que el Dashboard y los Reportes muestran los datos de siempre, sin nada raro

---

## Qué NO hace falta probar hoy
- AFIP/facturación electrónica (sigue en la etapa de siempre, sin cambios)
- Cheques propios (quedó explícitamente fuera de alcance, documentado)
- Diseño/UI (sin cambios visuales hoy)

---

## Si encontrás algo raro
Anotá: qué hiciste paso a paso, qué esperabas que pasara, qué pasó en realidad, y avisame para
revisarlo antes de que impacte en datos reales. Para el Bloque 7 en particular, si algo del asiento
generado te parece raro contablemente, decímelo — ahí es justo donde más necesito el ojo de un
contador.
