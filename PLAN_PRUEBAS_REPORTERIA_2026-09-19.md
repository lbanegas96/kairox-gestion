# Plan de pruebas — Reportería (Fases 1 a 4)

Los 15 reportes nuevos de este plan ya están **técnicamente verificados por mí** en esta sesión:
lint limpio, build con `vite.config.prod.js` (el config real de Vercel), y cada uno probado en
vivo contra los datos reales de Nalux vía Supabase (no solo "no tira error" — crucé a mano varios
totales contra otras pantallas para confirmar que el número es el correcto).

Este documento **no es para buscar bugs técnicos** — es para que Luciano/Nadia revisen si el
*criterio* de cada reporte es el que el negocio necesita, y para señalar puntualmente los 4 gaps
reales que encontré haciendo las pruebas (no son errores míos, son cosas que el sistema no tenía
resueltas de antes). Todo vive en Reportes → Centro de Reportes.

---

## Antes de nada — 4 cosas que encontré y que valen tu atención

### 1. Drift de stock en 20 de 75 productos (Nalux) — YA HAY UNA SESIÓN APARTE INVESTIGANDO ESTO
Construyendo el Kardex de Inventario encontré que el stock actual de 20 productos no coincide con
lo que el historial de movimientos puede reconstruir (de 1 a 7.595 unidades de diferencia).
Mayoría parecen datos de prueba de sesiones anteriores, pero no se confirmó al 100%. Ya arrancó
una sesión (`task_7402fb62`) a investigar la causa raíz — no hace falta que hagas nada acá, es
solo para que sepas por qué el Kardex de algunos productos puede no cerrar contra el stock real.

### 2. Ingresos Brutos sin alícuota configurada — Posición Fiscal Consolidada
El sistema nunca tuvo guardada la tasa (%) de Ingresos Brutos de tu jurisdicción — solo el
*coeficiente de distribución* (para la DDJJ CM05, si aplica convenio multilateral). El reporte
muestra la Base Imponible y te avisa que falta la alícuota en vez de inventar un monto en pesos
que podría estar mal. **Esto no es algo que yo pueda resolver solo** — necesito que me digas la
alícuota de tu jurisdicción (o jurisdicciones) para poder cargarla.

### 3. Ventas viejas sin costo cargado — Rentabilidad por Producto/Cliente
Ventas de antes de que el sistema empezara a guardar el costo en cada línea aparecen con 100% de
margen (no es que no tuvieron costo real, es que el dato no está). El reporte lo aclara con una
nota, pero si ves un 100% raro en algo viejo, es por esto.

### 4. Cero períodos cerrados — Comparativo entre Períodos
Hoy Nalux no tiene ningún período contable cerrado (los 2 que existen, Junio y Julio 2026, siguen
"abiertos"). El reporte pide un mínimo de 2 cerrados para poder comparar algo — hasta que cierres
al menos 2 períodos desde Plan de Cuentas, este reporte va a mostrar el aviso de "necesitás más
períodos cerrados", no un bug.

---

## Fase 1 — Quick wins

### Cartera de Proveedores
Card nueva en Reportes, aging 0-30/31-60/61-90/90+, mismo criterio que ya usa la pantalla de
Proveedores. **Qué mirar:** que el "Total a Pagar" del reporte coincida con lo que ves en
Proveedores → pestaña Cuenta Corriente para 2-3 proveedores puntuales.

### Libro IVA Compras (ahora también en Reportes)
Ya existía dentro de Compras — ahora tiene su propia card en el Centro de Reportes para no tener
que ir a buscarlo ahí. Mismo cálculo de siempre, solo cambió dónde se accede.

### Histórico de Arqueos de Caja
Card nueva, lista cada cierre de caja con diferencia (faltante/sobrante), agrupable por cajero o
por caja. **Qué mirar:** si algún cajero tiene faltantes que se repiten seguido — es justo el tipo
de patrón que este reporte está pensado para sacar a la luz.

### $ Impacto en Recuento / Revalorización de Inventario
No es una card nueva — es una columna nueva en las tablas de Productos → Recuento de Inventario y
Revalorización de Inventario, mostrando cuánto valió en pesos cada uno. Se lee directo del asiento
que ya se generó al confirmar, no se recalcula.

---

## Fase 2 — Rentabilidad real

### Rentabilidad por Producto / Rentabilidad por Cliente
Margen bruto real (venta menos costo de mercadería vendida) — el ranking de "qué me conviene
vender" que pediste. **Qué mirar:** elegí 2-3 productos que vos sepas de memoria que dejan buen
margen y confirmá que aparecen arriba de la lista. Ver también el punto 3 de arriba (ventas viejas
sin costo).

### Valorización de Inventario
Cuánta plata hay parada en stock hoy, agrupable por categoría, con aviso de "sin costo cargado"
por fila. **Qué mirar:** el Total general — es un número grande y útil para tener en la cabeza
("tengo $X millones parados en mercadería").

### Kardex de Inventario
Ficha de UN producto con cada movimiento y el stock acumulado. Elegí un producto puntual (no
importa cuál) y mirá si la historia de movimientos tiene sentido con lo que vos sabés que pasó con
ese producto. Ver el punto 1 de arriba si el stock final no cierra contra el real.

---

## Fase 3 — Información operativa

### Liquidación de Tarjetas
Cobros con tarjeta todavía no acreditados en el banco. **Hoy te va a dar vacío** — todo lo de
tarjeta en Nalux ya está acreditado. Es el estado real, no un bug. Vas a ver algo acá recién
cuando haya una venta con tarjeta reciente todavía sin acreditar.

### Pasivo de Fidelización
Cuánto tenés comprometido en descuentos por puntos de fidelización, cliente por cliente.
**Qué mirar:** el Total ($7.802 al momento de mis pruebas) — es plata que en algún momento un
cliente va a venir a canjear.

### Flujo de Cheques Proyectado
Cheques a cobrar (de clientes, en cartera) y a pagar (propios, entregados) por fecha de
vencimiento — el único reporte que mira para ADELANTE (próximos 30 días por default, cambiable).
**Qué mirar:** si coincide con lo que vos tenés anotado a mano sobre cheques pendientes.

### Órdenes de Compra Abiertas
Todo lo que le pediste a un proveedor y todavía no llegó, o llegó pero no se facturó — línea por
línea. **Encontré casos reales que valen tu atención**: varias OC recibidas hace más de 100 días
que nunca se marcaron como facturadas (ej. OC-00001, Mercado Libre, 02/06). Puede ser que
simplemente nunca se cargó la factura en el sistema — revisalo cuando tengas un rato.

### Detalle de Compras por Producto
Qué compraste, cuánto, y a qué costo promedio (ponderado por cantidad, no un promedio ingenuo).
**Qué mirar:** cruzalo con Valorización de Inventario — el costo promedio de acá debería ser
parecido al costo actual de ahí (excepto donde subió el costo del proveedor recientemente).

---

## Fase 4 — Comparativos

### Estado de Resultados por Centro de Costo
El mismo Estado de Resultados de Plan de Cuentas, pero con todos los Centros de Costo activos
lado a lado. Hoy Nalux tiene 1 solo CC activo ("Sucursal Centro"), así que la columna "Total" va a
coincidir exactamente con la única columna de CC — vas a ver la diferencia real cuando actives un
segundo CC.

### Comparativo entre Períodos Cerrados
Ver el punto 4 de arriba — necesita 2+ períodos cerrados, hoy no los tenés.

### Posición Fiscal Consolidada
Ver el punto 2 de arriba — te falta cargar la alícuota de IIBB para que el número final incluya
esa parte. El resto (IVA, Retenciones) ya está completo y verificado.

---

## Resumen de lo que necesito de vos

1. **Alícuota(s) de Ingresos Brutos** de tu jurisdicción — para poder completar Posición Fiscal
   Consolidada con un monto real en vez de solo la base imponible.
2. **Revisar las OC viejas sin facturar** que aparecen en Órdenes de Compra Abiertas — puede ser
   que falte cargar esas facturas, o que ya estén facturadas por fuera del sistema.
3. Nada más es bloqueante — el resto de los reportes están funcionando y listos para usar tal
   cual están.
