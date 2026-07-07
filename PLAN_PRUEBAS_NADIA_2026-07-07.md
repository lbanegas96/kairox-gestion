# Plan de Pruebas para Nadia — 2026-07-07

Este plan cubre lo corregido y auditado hoy (sesión 49): el fix crítico de facturación de pedidos
que vos misma reportaste, un segundo bug relacionado que apareció durante la prueba, el cierre
completo de la auditoría de código (Fase C), y una corrección contable sobre cheques. Ya está
deployado en producción. Probá con tu usuario admin.

---

## Bloque 1 — Facturación de pedidos (el bug que reportaste)

**Qué cambió:** ya no se puede facturar más cantidad de la que un pedido tiene entregada, y la
Entrega ya no vuelve a descontar stock cuando el pedido se factura después.

**Cómo probar:**
1. Creá un Pedido con 1 ítem de cantidad 5.
2. Generá una Entrega de 5 unidades → pedido "Entregado" completo.
3. Desde el pedido, tocá "Facturar Pedido" → se abre el modal de venta con el cliente y el carrito
   precargados (cantidad 5, sin poder editarla hacia arriba).
4. Confirmá la venta → tiene que funcionar normal, generar el comprobante, y el stock **no** debe
   volver a bajar (ya bajó cuando hiciste la Entrega).
5. Repetí el mismo pedido con **menos stock general en el depósito** que la cantidad entregada
   (por ejemplo, si "Mouse plano" tiene 0 unidades en stock general porque ya se entregaron todas)
   → antes esto bloqueaba la facturación por error; ahora tiene que dejarte facturar igual, porque
   el sistema sabe que ese stock específico ya salió con la Entrega.

---

## Bloque 2 — Comprobantes / Notas de Crédito (regresión, sin cambios funcionales)

**Qué revisar:** que el flujo de siempre siga andando igual después de la modularización de
`NuevaVentaModal.jsx` (se reorganizó el código pero no debería cambiar nada para vos).

**Cómo probar:**
1. Hacé una venta normal desde Punto de Venta (Efectivo y con Cuenta Corriente).
2. Desde el Historial, probá "Copiar a NC" sobre una venta y confirmá que la NC se genera bien y
   la deuda del cliente baja en Cuenta Corriente.
3. Fijate que el ticket/PDF se vea igual que siempre.

---

## Bloque 3 — Conciliación bancaria (regresión del fix de la semana pasada)

**Cómo probar:**
1. Bancos → Conciliación → importá un CSV con algún monto con separador de miles (ej. "$1.234,56")
   y confirmá que se lee bien, tanto en la pestaña de Conciliación como en la de Movimientos.

---

## Bloque 4 — Cheques de terceros: corrección de saldo contable (para tu ojo de contador)

**Qué pasó:** la cuenta "1.1.6 Cheques de Terceros en Cartera" venía con un saldo negativo
($-150.000) porque unos cheques viejos (de antes de que existiera el asiento automático de
cheques) nunca tuvieron su asiento de recepción. Se armó un asiento de apertura para corregirlo.

**Cómo probar:**
1. Plan de Cuentas → buscá la cuenta "1.1.6 Cheques de Terceros en Cartera" → el saldo ahora
   debería ser **$80.000** (el valor del único cheque que sigue genuinamente "depositado" hoy,
   el 00005678 de Carlos Perez).
2. Plan de Cuentas → Asientos → buscá el asiento **AS-000138** ("Ajuste de apertura — Cheques de
   terceros...") → vas a ver que no es un asiento de una venta o cobro común, es un ajuste directo
   contra "3.2 Resultados Acumulados". **Esto es justo lo que te pido que revises con más
   atención**: decidí usar esa cuenta (en vez de tocar Cuentas a Cobrar o Ingresos) porque no es un
   hecho económico de hoy, es la corrección de un dato que nunca se cargó bien — pero si vos como
   contadora preferís otro tratamiento (por ejemplo, contra una cuenta específica de "Ajuste de
   Ejercicios Anteriores" en vez de Resultados Acumulados directo), avisame y lo cambio.
3. Registrá un cheque de tercero nuevo y marcalo "Cobrado" o "Rechazado" → confirmá que el asiento
   automático sigue funcionando normal (esto no cambió, solo se corrigió el arrastre viejo).

---

## Bloque 5 — Regresión general (como siempre)

- [ ] Venta normal (Efectivo y Cuenta Corriente)
- [ ] Cobrar una Cuenta Corriente de cliente
- [ ] Pagar a un proveedor
- [ ] Abrir y cerrar caja
- [ ] Pedido → Entrega → Factura (el flujo completo del Bloque 1)
- [ ] Dashboard y Reportes sin nada raro

**Nota:** este bloque ya lo probé yo (Claude) en profundidad hoy directamente en Nalux — todo
funcionó bien. Lo dejo en la lista igual por si vos ves algo distinto con tu propio criterio.

---

## Qué NO hace falta probar hoy
- Períodos contables / cierre (ya lo probé a fondo hoy, incluido el caso de período cerrado)
- Multi-moneda / import CSV con montos raros (ya lo probé a fondo hoy)
- AFIP/facturación electrónica (sin cambios)
- Diseño/UI (sin cambios visuales)

---

## Si encontrás algo raro
Anotá: qué hiciste paso a paso, qué esperabas que pasara, qué pasó en realidad, y avisame antes de
que impacte en datos reales. Para el Bloque 4 en particular, si el tratamiento contable del asiento
de apertura no te cierra, decímelo — ahí es justo donde más necesito el ojo de la contadora.
