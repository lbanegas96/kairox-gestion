# KAIROX Gestión — Hoja de Ruta de Pruebas para Colaborador

**Propósito:** Validar el sistema con casos de uso reales, detectar fallas y documentarlas para corrección.  
**Entorno:** `http://localhost:3001` (dev) — Supabase proyecto `wuznppxeonmhfcvnqfbf`  
**Credenciales de prueba:** usar cuenta propia registrada en el sistema.

---

## Cómo reportar un bug

Cuando encuentres una falla, anotá:
1. **Módulo** y acción que realizabas
2. **Pasos exactos** para reproducirlo
3. **Qué esperabas** que pasara
4. **Qué pasó** en realidad (captura de pantalla si aplica)
5. **Consola del navegador** (F12 → Console): copiar cualquier error rojo

---

## BLOQUE 1 — Onboarding y autenticación

### Caso 1.1 — Registro de nueva empresa (tenant)
1. Abrí el sistema sin estar logueado
2. Hacé click en "Registrarse"
3. Completá: nombre, apellido, email **nuevo** (nunca usado), contraseña
4. ✅ Esperado: te pide el nombre de tu empresa → completalo → entrás al Dashboard vacío
5. ✅ Verificar: en el header aparece el nombre de tu empresa

### Caso 1.2 — Login con cuenta existente
1. Cerrá sesión
2. Ingresá con email y contraseña correctos
3. ✅ Esperado: va directo al Dashboard (sin pasar por onboarding)

### Caso 1.3 — Reset de contraseña
1. En el login, hacé click en "¿Olvidaste tu contraseña?"
2. Ingresá un email válido registrado
3. ✅ Esperado: recibís un email con link de reset
4. Hacé click en el link → te lleva a una página para ingresar nueva contraseña
5. ✅ Esperado: después del reset, podés loguearte con la nueva contraseña (no te loguea automáticamente)

### Caso 1.4 — Invitar usuario staff
1. Ir a **Usuarios** → "Crear Usuario"
2. Completar datos con un email que no existe en el sistema
3. ✅ Esperado: usuario creado, aparece en la lista
4. Repetir con el mismo email
5. ✅ Esperado: mensaje de error "El email ya existe en el sistema"

---

## BLOQUE 2 — Productos e Inventario

### Caso 2.1 — Crear producto
1. Ir a **Inventario** → "Nuevo Producto"
2. Completar: nombre, precio de venta, costo de compra, stock inicial = 10, unidad = "un"
3. ✅ Esperado: aparece en la lista con stock = 10

### Caso 2.2 — Editar y soft-delete
1. Editar el producto creado: cambiar precio
2. ✅ Verificar: precio actualizado en lista
3. Eliminar el producto
4. ✅ Esperado: desaparece de la lista (soft delete — `activo=false`, no borrado físico)
5. ✅ Verificar: si vas a Ventas → nueva venta, ese producto NO aparece en la búsqueda

### Caso 2.3 — Stock negativo
1. Crear un producto con stock = 2
2. Ir a Ventas → vender 3 unidades de ese producto
3. ❓ Observar: ¿el sistema lo permite? ¿muestra advertencia? Documentar comportamiento.

---

## BLOQUE 3 — Clientes y Cuenta Corriente

### Caso 3.1 — Crear cliente
1. Ir a **Clientes** → "Nuevo Cliente"
2. Completar datos con email y teléfono
3. ✅ Esperado: aparece en la lista

### Caso 3.2 — Inactivar cliente con deuda
1. Crear un cliente nuevo
2. Ir a **Cuenta Corriente** → registrar un cargo de $5.000 a ese cliente
3. Volver a **Clientes** → intentar eliminar ese cliente
4. ✅ Esperado: sistema bloquea eliminación y sugiere inactivar
5. Inactivar el cliente
6. ✅ Verificar: aparece con badge "Inactivo" y no aparece en el selector de Cuenta Corriente ni en nueva venta

### Caso 3.3 — Cobrar saldo en Cuenta Corriente
1. Con un cliente con saldo deudor, ir a su ficha en Cuenta Corriente
2. Registrar un pago parcial
3. ✅ Esperado: el saldo se actualiza correctamente (deuda - pago)
4. Registrar un pago mayor al saldo
5. ❓ Observar: ¿el sistema lo permite? ¿el saldo queda negativo (a favor del cliente)? Documentar.

---

## BLOQUE 4 — Ventas (POS)

### Caso 4.1 — Venta completa
1. Ir a **Ventas** → "Nueva Venta"
2. Buscar y agregar 2 productos distintos
3. Seleccionar un cliente existente
4. Forma de pago: Efectivo
5. Confirmar venta
6. ✅ Esperado: comprobante creado, stock de ambos productos descontado
7. ✅ Verificar: en **Dashboard** → "Ventas del Día" muestra el monto

### Caso 4.2 — Venta con descuento
1. Nueva venta → agregar un producto
2. Aplicar 10% de descuento al ítem
3. ✅ Verificar: el subtotal refleja el descuento correctamente

### Caso 4.3 — Asiento contable automático
1. Realizar una venta
2. Ir a **Contabilidad** → tab "Asientos"
3. ✅ Esperado: existe un asiento con fecha de hoy por el monto de la venta
4. ✅ Verificar: las cuentas DEBE/HABER son correctas (ej. Caja DEBE / Ventas HABER)

---

## BLOQUE 5 — Cotizaciones

### Caso 5.1 — Crear y aprobar cotización
1. Ir a **Cotizaciones** → "Nueva Cotización"
2. Completar cliente, fecha vencimiento a 30 días, agregar 2 ítems
3. Guardar → estado = "Borrador"
4. Botón Enviar (avión) → estado = "Enviada"
5. Botón Aprobar (✓) → estado = "Aprobada"
6. ✅ Verificar: aparece en los KPIs del Dashboard "Aprobadas Pendientes"

### Caso 5.2 — Cotización en moneda extranjera *(FEATURE NUEVO)*
1. Nueva cotización → selector de moneda → elegir **USD**
2. ✅ Verificar: aparece campo "Tasa (1 USD = ? ARS)" → ingresar tasa (ej. 1250)
3. Agregar ítems con precios en dólares
4. ✅ Verificar: el total se muestra como "US$ X.XXX,XX"
5. Guardar y verificar que en la lista aparece "US$" en la columna Total

### Caso 5.3 — Convertir cotización en venta
1. Tomar una cotización aprobada
2. Click en el ícono 🛒
3. ✅ Esperado: se abre el modal de venta pre-completado con los ítems y cliente de la cotización
4. Confirmar la venta
5. ✅ Verificar: la cotización pasa a estado "Convertida" con banner de referencia al comprobante

### Caso 5.4 — Cotización vencida
1. Crear una cotización con fecha de vencimiento = ayer
2. ❓ Observar: ¿el estado cambia a "Vencida" automáticamente o solo al cargar? Documentar.

---

## BLOQUE 6 — Órdenes de Compra

### Caso 6.1 — Flujo completo de OC
1. Ir a **Órdenes de Compra** → "Nueva OC"
2. Completar: proveedor (texto libre por ahora), fecha entrega, agregar 3 ítems con cantidades y costos
3. Guardar → estado "Borrador"
4. Enviar → estado "Enviada"
5. Ir al detalle de la OC → "Recibir Mercadería"
6. Ingresar cantidad recibida parcial (ej. 2 de 3)
7. ✅ Esperado: estado = "Recibida Parcial", stock de los productos aumenta
8. Recibir el resto
9. ✅ Esperado: estado = "Recibida"

### Caso 6.2 — 3-way match (OC-Recepción-Factura)
1. Con una OC en estado "Recibida Parcial" o "Recibida"
2. En el panel de detalle → "Registrar Factura del Proveedor"
3. Completar número de factura, fecha, monto
4. ✅ Verificar: en la grilla aparece el match visual entre lo pedido, recibido y facturado
5. Marcar como pagada
6. ✅ Verificar: estado de pago cambia a "Pagada"

### Caso 6.3 — Workflow de aprobación
1. Ir a **Configuración** → activar "Requiere aprobación de OC" (toggle)
2. Con usuario **staff** (no admin): crear una OC
3. ✅ Esperado: OC creada en estado "Pendiente Aprobación"
4. Con usuario **admin**: ver la OC → botón "Aprobar"
5. ✅ Esperado: OC pasa a "Borrador" y puede continuar el flujo

---

## BLOQUE 7 — Caja

### Caso 7.1 — Apertura y cierre de turno
1. Ir a **Caja** → "Abrir Caja" con monto inicial = $10.000
2. ✅ Verificar: aparecen los indicadores de turno (Ingresos/Egresos/Saldo Líquido)
3. Registrar un ingreso manual de $500
4. Registrar un egreso de $200
5. ✅ Verificar: Saldo Líquido = $10.000 + $500 - $200 = $10.300
6. Cerrar caja con saldo final
7. ✅ Verificar: el turno aparece en el historial

### Caso 7.2 — Caja refleja ventas del turno
1. Con caja abierta, realizar una venta desde **Ventas**
2. ✅ Verificar: la venta aparece como movimiento de caja en el turno actual

---

## BLOQUE 8 — Compras

### Caso 8.1 — Registrar compra
1. Ir a **Compras** → "Nueva Compra"
2. Seleccionar proveedor, fecha, agregar 2 ítems
3. Guardar
4. ✅ Verificar: stock de los productos aumenta
5. ✅ Verificar: en **Contabilidad** → tab "Asientos" aparece el asiento automático (Mercaderías DEBE / Cuentas a Pagar HABER)

---

## BLOQUE 9 — Contabilidad

### Caso 9.1 — Estado de Resultados (P&L)
1. Asegurarse de tener al menos 1 venta y 1 compra del mes
2. Ir a **Contabilidad** → tab "P&L"
3. ✅ Verificar: Ingresos > 0, Egresos > 0, Resultado = Ingresos - Egresos
4. ✅ Verificar: el detalle por cuenta muestra las cuentas involucradas

### Caso 9.2 — Balance General
1. Ir a **Contabilidad** → tab "Balance General"
2. ✅ Verificar: Activo Total = Pasivo Total + Patrimonio Neto (ecuación contable)
3. ❓ Si no se cumple: documentar las cuentas que están desbalanceadas

### Caso 9.3 — Cierre de período
1. Ir a **Contabilidad** → tab "Períodos"
2. Cerrar el mes anterior (ej. mayo 2026)
3. Intentar crear un asiento manual con fecha en mayo
4. ✅ Esperado: error "El período 5/2026 está cerrado"
5. Reabrir el período → crear el asiento → ✅ funciona

### Caso 9.4 — Asiento manual
1. Ir a **Contabilidad** → tab "Asientos" → "Nuevo Asiento"
2. Agregar 2 líneas: DEBE y HABER por el mismo monto (balance = 0)
3. Confirmar el asiento
4. ✅ Verificar: aparece en el Libro Mayor de las cuentas afectadas
5. Intentar confirmar un asiento sin balance (DEBE ≠ HABER)
6. ✅ Esperado: error de validación

---

## BLOQUE 10 — Bancos

### Caso 10.1 — Crear cuenta bancaria
1. Ir a **Bancos** → "Nueva Cuenta"
2. Completar: nombre "Cuenta Corriente BBVA", banco, CBU, moneda ARS
3. ✅ Verificar: aparece en la lista

### Caso 10.2 — Registrar movimiento manual
1. En la cuenta creada → "Nuevo Movimiento"
2. Registrar un ingreso de $20.000 con descripción "Depósito inicial"
3. ✅ Verificar: aparece en el historial de movimientos de la cuenta

### Caso 10.3 — Importar CSV
1. Descargar un extracto bancario en formato CSV de tu banco (o crear uno de prueba)
2. Ir a **Bancos** → tab "Importar" → subir el CSV
3. ✅ Verificar: las líneas se importan correctamente con tipo ingreso/egreso
4. ❓ Si el formato no es reconocido: documentar qué columnas tiene tu CSV

---

## BLOQUE 11 — Dashboard y Reportes

### Caso 11.1 — KPIs en tiempo real
1. Realizar una venta
2. Volver al Dashboard
3. ✅ Verificar: "Ventas del Día" refleja la nueva venta inmediatamente (o refrescar)

### Caso 11.2 — Cotizaciones en Dashboard
1. Tener al menos 2 cotizaciones aprobadas sin convertir
2. Dashboard → fila de KPIs de cotizaciones
3. ✅ Verificar: "Aprobadas Pendientes" muestra el conteo correcto
4. ✅ Verificar: "Tasa de Conversión" es un % razonable
5. Click en una cotización pendiente desde el Dashboard
6. ✅ Esperado: navega a la sección Cotizaciones con esa cotización visible

### Caso 11.3 — Reportes
1. Ir a **Reportes**
2. Generar el reporte de "Ventas del Período" con rango del mes actual
3. ✅ Verificar: las ventas realizadas en los tests anteriores aparecen
4. Exportar a Excel
5. ✅ Verificar: el archivo se descarga y tiene los datos correctos

---

## BLOQUE 12 — Búsqueda global (Cmd+K)

### Caso 12.1 — Navegación rápida
1. Presionar `Ctrl+K` (o `Cmd+K` en Mac)
2. Escribir "ventas" → ✅ aparece el módulo Ventas
3. Escribir nombre de un producto → ✅ aparece el producto
4. Escribir nombre de un cliente → ✅ aparece el cliente
5. Escribir número de una cotización (ej. "COT-00001") → ✅ aparece la cotización
6. Presionar Enter en cualquier resultado → ✅ navega al destino correcto

---

## BLOQUE 13 — Modo claro / oscuro

### Caso 13.1 — Consistencia visual
1. Cambiar al **modo claro** desde el toggle del header
2. Revisar cada sección del sidebar (Dashboard, Ventas, Compras, Cotizaciones, OC, Caja, Clientes, Bancos, Contabilidad, Reportes, Configuración)
3. ✅ Verificar: texto legible, sin fondo oscuro superpuesto sobre fondo claro
4. ✅ Verificar: el Sidebar tiene colores claros (blanco/gris) en modo día
5. Cambiar de vuelta a **modo oscuro** → verificar que no quedaron elementos "quemados"

---

## BLOQUE 14 — Multi-tenant (aislamiento de datos)

### Caso 14.1 — Datos aislados entre empresas
> Este test requiere dos cuentas en tenants distintos.

1. Con **Empresa A**: crear 3 clientes, 5 productos, 2 ventas
2. Con **Empresa B** (cuenta distinta): verificar que NO ve los datos de Empresa A
3. ✅ Esperado: listas vacías en Empresa B
4. ❓ Si Empresa B VE datos de Empresa A: es un bug crítico de seguridad — reportar inmediatamente

---

## BLOQUE 15 — Configuración

### Caso 15.1 — Logo de empresa
1. Ir a **Configuración** → subir un logo (PNG o JPG, <2MB)
2. ✅ Verificar: el logo aparece en el header/sidebar después de guardar

### Caso 15.2 — Módulos activos
1. En Configuración → desactivar el módulo "Cotizaciones"
2. ✅ Esperado: desaparece del sidebar
3. Reactivarlo → ✅ vuelve a aparecer

---

## Resumen de qué buscar específicamente

| Categoría | Señales de alarma |
|---|---|
| **Datos incorrectos** | Totales que no cierran, stock que no se actualiza, saldo que no cambia |
| **Errores 403 / RLS** | Toast de error "403 Forbidden" o "Permission denied" |
| **Pantalla en blanco** | Módulo que carga pero no muestra nada (revisar consola) |
| **Fuga multi-tenant** | Ver datos de otra empresa |
| **Crash de UI** | Pantalla blanca total, error en consola tipo "Cannot read properties of undefined" |
| **Doble registro** | Acciones que se ejecutan dos veces (doble click en botón) |
| **Fecha incorrecta** | Movimientos con fecha de ayer o mañana cuando debería ser hoy |

---

*Documento generado: 2026-06-04 — KAIROX Gestión*
