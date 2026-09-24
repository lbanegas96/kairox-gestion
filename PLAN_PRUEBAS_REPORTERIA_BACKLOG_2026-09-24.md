# Plan de revisión — Reportería, Backlog (6 reportes nuevos + 1 corrección)

Continuación de [PLAN_PRUEBAS_REPORTERIA_2026-09-19.md](PLAN_PRUEBAS_REPORTERIA_2026-09-19.md) (los 15
reportes de las Fases 1 a 4). Igual que aquel, **no busca bugs técnicos** — eso ya lo verifiqué: cada
reporte tiene pruebas automáticas (agregaciones, columnas vs. totales, agrupar, pantalla y descargas), el
lint y el build de producción pasan, y lo que se puede contrastar contra datos reales de Nalux se
contrastó por SQL. Es para que Luciano/Nadia digan si el *criterio* de cada reporte es el que el negocio
necesita. Todo vive en Reportes → Centro de Reportes (salvo el Export del Ajuste Impositivo).

---

## Corrección que cambia números que ya conocías

**Ventas, Rentabilidad por Producto/Cliente, Historial de Compras y Detalle de Compras por Producto**
sumaban las ventas *canceladas* y las facturas de compra *anuladas* como si fueran reales. Ya no.
**Qué mirar:** el total de Ventas de un período con ventas canceladas va a dar menos que antes (en Nalux:
11 ventas canceladas por $117.902 en total, 2 compras anuladas por $1.331). También cambia el "% vs.
período anterior" porque compara con el mismo criterio.

---

## Tanda 1 — Reportes operativos

### Rendimiento por Lista de Precios
Compara la lista que se *usó* en cada venta contra la que el cliente tiene *asignada*: cuánto se vendió y
qué margen quedó con cada combinación, con los desvíos arriba. **Hoy te va a dar una sola fila**: Nalux
tiene 2 listas creadas pero ninguna venta ni ningún cliente las usa (178 ventas, todas a precio estándar).
Es el estado real, no un bug. **Para verlo funcionar:** asignale una lista a un cliente de prueba y
facturale una vez con esa lista y otra a precio estándar.

### Ranking de Proveedores
A quién le comprás más: facturas, total, ticket promedio, % del total y % acumulado. **Qué mirar:** que
el orden y los porcentajes tengan sentido contra lo que vos sabés. En Nalux dos proveedores (Kiosko
Achaval y Amazon) concentran el 92% — casi seguro datos de prueba, pero es justo el tipo de dependencia
que este reporte está pensado para mostrar. No descuenta notas de crédito de proveedor.

### Historial de Ajustes de Inventario
Todo lo que corrigió el stock en el período: diferencias de **Recuentos confirmados** (con el costo que
tenía cada producto al contar) y **ajustes manuales** hechos desde Productos. Columna "Veces" = cuántas
veces ajustó ese producto; se puede agrupar por producto, mes u origen. **Qué mirar:** los productos que
aparecen con "Veces" alto — señal de merma sistemática. Ojo con dos límites: los ajustes manuales solo
muestran $ (no unidades) porque se leen de su asiento, y uno hecho sobre un producto sin costo cargado no
aparece. Faltantes y sobrantes se muestran siempre por separado.

### Devoluciones a Proveedores
Qué le devolviste a cada proveedor, con motivo y compensación (nota de crédito / reemplazo); agrupable por
proveedor, motivo o mes. **Qué mirar:** la columna "Sin motivo" — en Nalux 4 de las 7 devoluciones no
tienen motivo cargado, así que hoy el reporte no puede decir *por qué* devuelve cada proveedor. Si el
motivo te importa, conviene volverlo obligatorio al cargar la devolución (decime y lo hago).

---

## Tanda 2 — Ajuste por Inflación

### Memoria de Cálculo — Ajuste por Inflación
El papel de trabajo del ajuste contable de un período: cuenta por cuenta y mes por mes, con el saldo, el
índice, el coeficiente aplicado, el saldo reexpresado y el ajuste, más el RECPAM y los índices usados. Sirve
de respaldo ante una inspección. Tiene un **control** que verifica que el detalle cierre contra el ajuste
que se va a postear. Solo aparece habilitado con el Ajuste por Inflación activado (Nalux lo tiene).
**Qué mirar:** con los períodos de Nalux (Junio y Julio 2026, de un solo mes) **no genera ajuste**: todos
los saldos son del propio mes de cierre (coeficiente 1) y no hay saldo de apertura de patrimonio. Para ver
un ajuste con números hace falta un período de varios meses con saldo de apertura. Necesita la migración 401.

> **Bug real que apareció al armar este reporte (corregido en la migración 401):** la función que calcula
> el ajuste tomaba como "saldo de apertura" de las cuentas de Patrimonio el saldo de TODA la historia, no
> el de antes del período. En Nalux eso hacía proponer $4.340 (Junio) y $4.862 (Julio) de ajuste sobre un
> asiento de $230.000 del 07/07, cuando lo correcto era $0. Ningún período de ninguna empresa tiene un ajuste
> generado todavía, así que no hay asientos que corregir.

### Export del Ajuste Impositivo (Ganancias)
Botones nuevos de **PDF y Excel** en Impuestos → Ajuste por Inflación (el cálculo ya existía, pero solo se
veía en pantalla). El papel muestra cada paso con su fórmula (activo/pasivo/PN computable, coeficiente,
ajuste estático y dinámico) y las salvedades del cálculo. **Qué mirar:** que las cifras coincidan con las de
la pantalla y que el texto de "Salvedades" sea lo que tu contador querría ver al pie. No depende de la
migración.

---

## Lo que necesito de vos (además de lo del plan anterior)

1. **Aprobar la migración 401** — corrige el cálculo del saldo de apertura y agrega la función de la
   Memoria. Toca una función que genera asientos, por eso te la consulto aparte.
2. **Motivo de devolución obligatorio (sí/no)** — hoy es opcional y la mayoría queda vacío.
3. Lo pendiente del plan anterior: la **alícuota de Ingresos Brutos** de tu jurisdicción y revisar las **OC
   viejas sin facturar**.
