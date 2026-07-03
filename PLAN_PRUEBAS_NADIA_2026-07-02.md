# Plan de Pruebas para Nadia — 2026-07-02

Este plan cubre **solo lo trabajado hoy** en la sesión de auditoría (áreas #3 a #7 del `PLAN_AUDITORIA.md`).
Ya está deployado en producción. Probar con tu usuario admin y, donde se indique, con un usuario staff de prueba.

---

## Bloque 1 — Permisos por usuario (staff) — el más importante de probar

**Qué cambió:** antes, los permisos que le das a un empleado (tildar/destildar módulos en "Gestionar Permisos") eran solo decorativos — un empleado avispado podía tocar módulos que vos le habías bloqueado. Ahora el bloqueo es real, a nivel de base de datos.

**Cómo probar:**
1. Andá a **Usuarios** → elegí un usuario Staff (o creá uno de prueba) → "Gestionar Permisos".
2. Vas a ver **2 permisos nuevos**: **Bancos** y **Cheques** (antes no existían como opción independiente).
3. Dejá tildado SOLO "Dashboard" y "Ventas". Destildá todo lo demás (Compras, Clientes, Caja, Bancos, Cheques, Configuración, etc.).
4. Iniciá sesión con ese usuario staff (o pedile a alguien que lo pruebe).
5. Verificá que:
   - Puede entrar a Ventas y cargar una venta normalmente.
   - **NO puede** ver ni operar en Proveedores, Clientes, Caja, Bancos, Cheques, Configuración (esos módulos no deberían aparecer, y si por algún motivo llega a la URL, no debería poder guardar nada).
6. Volvé a tildarle los permisos que corresponda para su trabajo normal.

⚠️ **Si notás que con permisos destildados el usuario staff PUEDE guardar algo igual, avisame de inmediato** — sería una regresión del fix de seguridad.

---

## Bloque 2 — Cheques (sección nueva, revisar comportamiento esperado)

**Qué es:** la sección Cheques es un **registro/seguimiento** de cheques propios y de terceros. Importante: **no mueve plata de Caja/Bancos automáticamente** — es solo para llevar el control de la cartera de cheques (cuándo vencen, en qué estado están).

**Cómo probar:**
1. Andá a **Cheques** → "Registrar cheque recibido" (cheque de un cliente).
2. Cargá número, banco, monto, fecha de vencimiento, cliente asociado.
3. Confirmá que aparece en la tabla como "En cartera".
4. Probá cambiar su estado (botón "Mover") a "Depositado" y después a "Cobrado" — verificá que el historial de cambios se registra.
5. Hacé lo mismo con "Registrar cheque emitido" (cheque propio a un proveedor).

📌 **Nota importante para vos y el contador:** como este módulo todavía no impacta Bancos automáticamente, cuando cobrás/depositás un cheque en la vida real, por ahora hay que registrar el ingreso/egreso de plata **por separado** en Bancos o Caja (con método "Cheque" o el que corresponda), además de mover el estado acá. Esto es un tema pendiente de definir con el contador (qué cuenta usar para "cheques en cartera").

---

## Bloque 3 — Nota de Débito a Proveedor (bug de plata corregido)

**Qué cambió:** antes, si registrabas una Nota de Débito de un proveedor (ej: te cobran flete adicional) y algo fallaba a mitad de camino (por ejemplo se cortaba internet), la ND quedaba guardada pero **la deuda al proveedor no subía** — quedaba desincronizado. Ahora es una sola operación atómica: o se hace todo, o no se hace nada.

**Cómo probar:**
1. Andá a **Proveedores** → elegí un proveedor → "Nueva ND de Proveedor" (o desde el flujo de Compras si tenés una factura de referencia).
2. Cargá concepto ("Flete adicional test") y un monto (ej: $500).
3. Confirmá.
4. Andá a la **Cuenta Corriente** de ese proveedor y verificá que la deuda **subió exactamente ese monto**.
5. (Opcional) Probá también una ND a un **cliente** (Ventas → Nueva ND) y verificá que le sube la deuda en su Cuenta Corriente — este camino ya funcionaba bien antes, es solo para confirmar que sigue OK.

---

## Bloque 4 — Libro IVA Ventas (reporte fiscal corregido)

**Qué cambió:** el reporte "Libro IVA Ventas" (Reportes → Libro IVA) calculaba el IVA de **todas** las facturas asumiendo 21% fijo. Si tenés productos con IVA al 10.5%, exentos, o no gravados, el cálculo iba a estar mal. Ahora usa el IVA real de cada factura.

**Cómo probar:**
1. Si tenés productos con distintas alícuotas de IVA (Configuración → Impuestos → tab IVA, o directamente en la ficha del producto), hacé una venta que incluya al menos un producto al 21% y otro con una alícuota distinta (10.5%, exento, etc.).
2. Andá a **Reportes → Libro IVA Ventas**, generá el reporte para el período de esa venta.
3. Verificá que el "IVA 21%" que muestra el resumen ahora refleja el IVA real de la mezcla de productos (no un 21% plano sobre el total de la factura).
4. Si **todos** tus productos están al 21%, no vas a notar ninguna diferencia — es esperable, el fix solo corrige el caso de alícuotas mixtas.

---

## Bloque 5 — Verificación general (regresión)

Como siempre, después de estos cambios probá el flujo normal de todos los días para confirmar que nada se rompió:

- [ ] Hacer una venta normal (efectivo y con cuenta corriente)
- [ ] Cobrar una cuenta corriente de cliente
- [ ] Pagar a un proveedor
- [ ] Abrir y cerrar caja
- [ ] Ver movimientos de Bancos (MP, transferencias)

---

## Qué NO hace falta que pruebes hoy
- AFIP/facturación electrónica (sigue en la etapa de siempre, sin cambios)
- Diseño/UI (sin cambios visuales hoy, salvo la sección Cheques que ya conocías)

---

## Si encontrás algo raro
Anotá: qué hiciste paso a paso, qué esperabas que pasara, qué pasó en realidad, y avisame para revisarlo antes de que impacte en datos reales.
