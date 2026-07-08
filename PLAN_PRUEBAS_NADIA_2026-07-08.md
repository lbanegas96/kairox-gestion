# Plan de Pruebas para Nadia — 2026-07-08

Este plan cubre la contabilización de cheques propios (lo que faltaba) y 2 correcciones sobre
cheques de terceros. Ya está deployado en producción, probado con `BEGIN...ROLLBACK` contra datos
sintéticos antes de subir (10/10 casos OK), pero **hay un bloque que no pude probar de punta a punta
con datos reales** porque el botón no respondía en mi navegador automatizado — necesito que lo
hagas vos con tu usuario admin y me cuentes qué pasó.

---

## Bloque 1 — 🔴 EL QUE ME QUEDÓ PENDIENTE: Cheque propio completo (pendiente → entregado → cobrado)

**Qué se agregó:** hasta ahora, un cheque propio (el que ustedes entregan a un proveedor) no
generaba ningún asiento contable — era solo un tracker. Ahora sí: al entregarlo, cancela la deuda
con el proveedor y la pasa a una cuenta puente ("Documentos a Pagar"); al cobrarse (cuando el banco
lo debita), sale de esa cuenta puente y sale la plata de Caja y Bancos.

**Cómo probar:**
1. Cheques → pestaña "Cheques Propios" → "Registrar cheque emitido".
2. Completá: número (cualquiera, ej. "99001"), banco, monto chico (ej. $1.000), fecha de
   vencimiento, y **elegí un proveedor** (esto es importante — sin proveedor no se genera el
   asiento). Guardá.
3. **Resultado esperado:** el cheque aparece en la lista con estado "Pendiente". Andá a Plan de
   Cuentas → buscá "2.1.6 Documentos a Pagar" → **no debería haber ningún asiento nuevo todavía**
   (recién se generó el cheque, no se entregó).
4. Volvé a Cheques → "Mover" el cheque a estado "Entregado".
5. **Resultado esperado:** en Plan de Cuentas → Asientos, debería aparecer un asiento nuevo
   "Cheque propio entregado — [número]" con DEBE en "2.1.1 Cuentas a Pagar" y HABER en "2.1.6
   Documentos a Pagar", por el monto del cheque.
6. "Mover" el cheque de nuevo, esta vez a "Cobrado" (simula que el banco lo debitó).
7. **Resultado esperado:** otro asiento nuevo "Cheque propio cobrado/debitado — [número]" con DEBE
   en "2.1.6 Documentos a Pagar" y HABER en "1.1.1 Caja y Bancos". La cuenta "2.1.6" debería quedar
   en $0 después de este paso (el DEBE del entregado se cancela con el HABER del cobrado).

**Avisame:**
- Si el botón "Registrar" funcionó normal para vos (a mí no me respondía en el navegador
  automatizado — puede ser solo un problema de mi herramienta de testing, no del código real).
- Si los 2 asientos se generaron con las cuentas y montos que digo arriba.
- Si algo no coincide con lo esperado, decime exactamente qué viste (o mandame captura) para saber
  si hay que **corregir** algo puntual, **retroceder** el cambio, o si está todo bien y podemos
  **avanzar** tranquilos.

---

## Bloque 2 — Cheque de tercero endosado a un proveedor (bug real corregido)

**Qué pasaba antes (bug):** si ustedes reciben un cheque de un cliente y se lo endosan a un
proveedor para pagarle (en vez de depositarlo), y después alguien lo marcaba "Cobrado", el sistema
generaba un asiento como si hubiese entrado plata a Caja y Bancos — cuando en realidad esa plata
nunca entró, se usó para pagarle a un proveedor. Ahora el asiento se genera en el momento del
**endoso**, no del cobrado.

**Cómo probar:**
1. Cheques → "Cartera de Terceros" → registrá un cheque de tercero nuevo (con un cliente).
2. "Mover" a estado "Endosado" — al hacerlo, el sistema te va a pedir elegir a qué **proveedor** lo
   endosás.
3. **Resultado esperado:** un asiento "Cheque de tercero endosado a proveedor" con DEBE en "2.1.1
   Cuentas a Pagar" (del proveedor elegido) y HABER en "1.1.6 Cheques de Terceros en Cartera".
4. Ahora "Mové" ese mismo cheque a "Cobrado" (simulando que el proveedor lo depositó bien).
5. **Resultado esperado:** **no debería generarse ningún asiento nuevo** — ya se resolvió todo en
   el paso del endoso. Fijate en Plan de Cuentas → Asientos que solo haya 2 asientos para ese
   cheque (el de "recibido" inicial + el de "endosado"), no un 3ro de "cobrado".

---

## Bloque 3 — Cheque de tercero rechazado (nueva cuenta dedicada)

**Qué cambió:** antes, un cheque rechazado revertía directo contra Cuentas a Cobrar (mezclando esa
cobranza dudosa con la cobranza normal). Ahora va a una cuenta nueva y separada.

**Cómo probar:**
1. Registrá un cheque de tercero nuevo (o usá uno "en cartera" que ya tengas).
2. "Mové" a estado "Rechazado" directamente (sin pasar por endosado).
3. **Resultado esperado:** el asiento generado tiene DEBE en la cuenta nueva "1.1.7 Deudores por
   Cheques Rechazados" (no en "1.1.2 Cuentas a Cobrar") y HABER en "1.1.6 Cheques de Terceros en
   Cartera".

---

## Bloque 4 — Regresión general (como siempre)

- [ ] Venta normal (Efectivo y Cuenta Corriente)
- [ ] Cobrar una Cuenta Corriente de cliente
- [ ] Pagar a un proveedor
- [ ] Abrir y cerrar caja
- [ ] Un cheque de tercero "normal" (recibido → depositado → cobrado, sin endoso) — confirmar que
      sigue generando los mismos 2 asientos de siempre (recibido + cobrado)
- [ ] Dashboard y Reportes sin nada raro

---

## Qué contarme al terminar

Para cada bloque: ✅ salió como se esperaba, o ⚠️ algo no coincidió (contame qué, con captura si
podés). Con eso decido si hay que corregir algo puntual, retroceder el cambio completo, o si queda
todo cerrado y avanzamos con el resto.
