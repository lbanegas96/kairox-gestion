# Plan de Pruebas — Sesión Mercado Pago + Bancos + Contabilización
**Para:** Nadia · **Fecha sugerida:** 2026-07-02
**Antes de empezar:** entrá al sistema y hacé **Ctrl + Shift + R** (recarga forzada) para asegurarte de tener la última versión. Probá con usuario **Administrador**.

> Marcá cada caso: ✅ pasó · ❌ falló (anotá qué pasó) · ⬜ no probado

---

## BLOQUE 1 — Integración Mercado Pago (ingreso vs egreso)

### 1.1 — Cobro entrante (ingreso)
1. Hacé que alguien te transfiera / te pague un monto chico por MP (ej. $10) a la cuenta MP conectada.
2. Esperá ~1 min (o entrá a **Bancos → Movimientos** y tocá **Actualizar**).
- **Esperado:** aparece un movimiento **verde "ingreso"**, monto en positivo, origen **Mercado Pago**.
- Resultado: ⬜

### 1.2 — Envío de dinero (egreso)
1. Desde tu billetera MP, **enviá dinero** a otra persona (ej. $10).
2. **Bancos → Movimientos → Actualizar**.
- **Esperado:** movimiento **rojo "egreso"**, monto en negativo (`-$10`), origen Mercado Pago.
- ⚠️ Este es el bug que arreglamos: antes TODO salía como ingreso.
- Resultado: ⬜

### 1.3 — Saldo correcto
- **Esperado:** en el KPI "Saldo por cuenta", la cuenta Mercado Pago **suma los ingresos y resta los egresos** (no infla el saldo).
- Resultado: ⬜

---

## BLOQUE 2 — Configuración de Mercado Pago (guardar sin re-pegar token)

### 2.1 — Guardar sin re-tipear el token
1. **Configuración → Integraciones → Mercado Pago → Editar**.
2. El campo Access Token se ve **vacío** (es normal, por seguridad nunca se muestra el real).
3. **Sin** pegar nada en el token, cambiá solo la cuenta destino o el webhook secret y tocá **Guardar**.
- **Esperado:** guarda bien, NO te obliga a pegar el token de nuevo.
- Resultado: ⬜

### 2.2 — El token sigue guardado
1. Cerrá y reabrí el modal.
- **Esperado:** la integración sigue funcionando (el token no se borró aunque el campo se vea vacío).
- Resultado: ⬜

---

## BLOQUE 3 — Tabla de Movimientos de Bancos (UI nueva)

En **Bancos → Movimientos**, mirá cualquier fila:

### 3.1 — Origen con color de marca
- **Esperado:** el origen se ve como un chip **con color** (Mercado Pago celeste, Ualá violeta, Manual gris, Importado ámbar) con un puntito de color — no el gris plano de antes.
- Resultado: ⬜

### 3.2 — Referencia / ID copiable
- **Esperado:** debajo de la descripción hay un chip tipo `MP #166756842896` (o `#a1b2c3d4` para los manuales). Al pasar el mouse aparece un ícono de copiar; al hacer click **copia el ID** y muestra un tilde verde.
- Resultado: ⬜

### 3.3 — Quién ejecutó el movimiento
- **Esperado:** al lado de la referencia dice quién lo hizo: los de MP dicen **"Integración Mercado Pago"** (ícono robot 🤖); los manuales van a decir el **nombre del usuario** (ícono persona 👤) — ver bloque 4.
- Resultado: ⬜

---

## BLOQUE 4 — Movimiento manual + import CSV (trazabilidad)

### 4.1 — Movimiento manual registra tu nombre
1. **Bancos → Movimientos → + Movimiento**. Cargá un egreso manual (ej. cuenta BBVA, $500, "prueba manual").
2. Guardá y buscalo en la lista.
- **Esperado:** el movimiento muestra tu nombre (**Nadia ...**) como ejecutor, con ícono de persona.
- Resultado: ⬜

### 4.2 — Import CSV
1. **Importar CSV** con un extracto de prueba (2-3 filas).
- **Esperado:** los movimientos importados quedan con origen **Importado** y tu nombre como ejecutor.
- Resultado: ⬜

---

## BLOQUE 5 — Determinación de Cuentas de Mayor (NUEVO)

> Para probar usamos **cuentas didácticas** (las de ejemplo del plan). En un comercio real, cada uno carga las suyas con su contador.

### 5.1 — Crear una regla de ingreso
1. **Configuración → Determinación de Cuentas → Nueva regla**.
2. Cargá: Origen = **Mercado Pago**, Tipo = **Solo Ingreso**, Cuenta contable = **4.3 Otros Ingresos** (o la que quieras probar). Guardá.
- **Esperado:** la regla aparece en la tabla con sus badges y la cuenta a la que imputa.
- Resultado: ⬜

### 5.2 — Crear una regla de egreso
1. Nueva regla: Origen = **Mercado Pago**, Tipo = **Solo Egreso**, Cuenta = **2.1.1 Cuentas a Pagar** (didáctico). Guardá.
- Resultado: ⬜

### 5.3 — Regla comodín (red de seguridad)
1. Nueva regla: Origen = **Cualquier origen**, Tipo = **Ingreso y Egreso**, Cuenta = una "a clasificar" (ej. 1.1.5 Otros Activos Corrientes, didáctico), Prioridad = 999.
- **Esperado:** sirve de "cajón" para lo que no matchee una regla más específica.
- Resultado: ⬜

### 5.4 — Aviso de cuenta bancaria sin vincular
- **Esperado:** si alguna cuenta bancaria no tiene cuenta contable vinculada, arriba de la solapa aparece un aviso amarillo nombrándola.
- Resultado: ⬜

---

## BLOQUE 6 — Contabilizar movimientos (NUEVO)

### 6.1 — Contabilizar un ingreso
1. **Bancos → Movimientos**. Elegí un movimiento **ingreso** de MP no contabilizado.
2. Tocá **Contabilizar** (a la derecha de la fila).
- **Esperado:** toast verde "✓ Contabilizado — asiento AS-0000XX". La fila ahora dice **"✓ Contabilizado"**.
- Resultado: ⬜

### 6.2 — Verificar el asiento
1. **Contabilidad → Plan de Cuentas → (Asientos / Libro Mayor)**, buscá el asiento AS-0000XX.
- **Esperado:** Debe **1.1.1 Caja y Bancos** / Haber **4.3 Otros Ingresos** (o la cuenta de la regla), **cuadrado** (debe = haber).
- Resultado: ⬜

### 6.3 — Contabilizar un egreso
1. Contabilizá un **egreso** de MP.
- **Esperado:** asiento invertido — Debe **2.1.1** (o la de la regla) / Haber **1.1.1 Caja y Bancos**.
- Resultado: ⬜

### 6.4 — Revertir
1. En un movimiento ya contabilizado, hacé click en **"✓ Contabilizado"**.
- **Esperado:** toast "Contabilización revertida". La fila vuelve a mostrar el botón **Contabilizar**. El asiento queda **anulado** (no se borra) en la contabilidad.
- Resultado: ⬜

### 6.5 — Sin regla → error claro
1. Intentá contabilizar un movimiento cuyo origen/tipo **no** tenga regla (borrá temporalmente la regla comodín).
- **Esperado:** mensaje claro "Sin regla de determinación para (...). Configurá una en Configuración → Determinación de Cuentas." — NO rompe nada.
- Resultado: ⬜

---

## BLOQUE 7 — Seguridad (opcional, si hay un usuario no-admin)

### 7.1 — No-admin no ve "Contabilizar"
1. Entrá con un usuario **NO admin** (staff/cajero) a Bancos → Movimientos.
- **Esperado:** no aparece el botón Contabilizar (solo ve "Contabilizado" como texto si ya lo está). No puede editar la Determinación de Cuentas.
- Resultado: ⬜

---

## Notas para reportar
- Si algo falla, anotá: qué bloque, qué hiciste, qué esperabas y qué pasó (captura si podés).
- Los montos de prueba conviene que sean chicos ($1–$500).
- Las cuentas contables usadas son **didácticas** — no representan la contabilidad real.
