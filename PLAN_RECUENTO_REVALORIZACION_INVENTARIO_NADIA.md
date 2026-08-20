# Recuento + Revalorización de Inventario — para que Nadia lo termine y pruebe

**Estado: construido y verificado por simulación SQL (`BEGIN...ROLLBACK`), pero
NADA está aplicado a producción todavía.** Las migraciones 334/335/336 están en
el repo, commiteadas, pero no corrieron contra la base real. El frontend está
deployado, así que las 2 pestañas nuevas de Productos van a tirar error 404 de
RPC hasta que se apliquen las migraciones — es el primer paso de mañana.

---

## 1. Qué se construyó

Pedido de Luciano (19-20/08): Recuento de Inventario y Revalorización de
Inventario, estilo SAP B1. Diseño completo en
`C:\Users\lbanegas\.claude\plans\humble-floating-wilkinson.md` (plan aprobado,
no está en git — si hace falta consultarlo pedirle a Luciano que lo copie).

- **`supabase/migrations/334_inventario_recuento_revalorizacion_cuentas.sql`** —
  4 cuentas contables nuevas (`4.5`/`4.6`/`5.10`/`5.11` — los códigos `5.9`/`4.4`
  originales del plan chocaban con las cuentas de Diferencia de Cambio ya
  existentes, se detectó y corrigió ANTES de aplicar nada) + 2 tipos de
  documento nuevos en `series_numeracion` (`recuento_inventario` RC-,
  `revalorizacion_inventario` RV-). **Ojo:** esta migración también amplía el
  `CHECK` `chk_series_tipo_documento` — sin eso el INSERT de las series nuevas
  falla (encontrado simulando en vivo).
- **`335_recuento_inventario.sql`** — tablas `recuentos_inventario` +
  `recuento_inventario_items`, RPCs `crear_recuento_inventario`,
  `confirmar_recuento_inventario`, `anular_recuento_inventario`,
  `set_asiento_recuento_inventario`. Reusa `movimientos_inventario` (mismo
  ledger que el ajuste manual existente), aplica TODAS las diferencias de un
  recuento con UN solo asiento (no uno por producto).
- **`336_revalorizacion_inventario.sql`** — mismo esqueleto pero sobre
  `costo_compra`, NO toca stock ni `movimientos_inventario` (no es un evento
  físico).
- **Frontend**: 2 tabs nuevas en Productos (`Recuento` / `Revalorización`),
  `src/components/productos/{Tab,Modal}*.jsx`, 2 services nuevos, y 2 métodos
  nuevos en `asientosAutoService` (`planCuentasService.ts`) que arman el
  asiento único después de confirmar.
- Eslint sin errores nuevos, vitest 159/159, vite build OK.

## 2. Verificación ya hecha (simulada, no en prod)

Corrido contra Nalux real con `BEGIN...ROLLBACK` (nada quedó aplicado):
- Recuento sobre categoría "Congelados y Helados" (2 productos): 1 faltante +
  1 sobrante simulados → `stock_actual` se actualizó bien, `movimientos_inventario`
  se insertó con `motivo='Recuento RC-...'`, estado pasó a `confirmado`.
- Revalorización sobre "Fiambres y Conservas": `costo_compra` se actualizó bien,
  **confirmado que NO tocó `movimientos_inventario`** (0 filas con motivo
  "revaloriza").
- **Gap real encontrado y corregido en el camino**: ni `confirmar_recuento_inventario`
  ni la tabla tenían guarda contra `cantidad_contada` negativa (a diferencia de
  `ajustar_stock_manual`, que sí la tiene). Agregado `CHECK (cantidad_contada
  IS NULL OR cantidad_contada >= 0)` en `recuento_inventario_items` y el mismo
  criterio para `costo_nuevo` en revalorización, más `min="0"` en los inputs.

## 3. Para mañana — pasos en orden

1. **Aplicar las 3 migraciones** (334, 335, 336, en ese orden) contra
   `isvkelrdxwvkfmrfqxxk` — pedirle confirmación a Luciano antes, como siempre.
   Después de aplicar, correr `NOTIFY pgrst, 'reload schema';` (el schema cache
   de PostgREST no se refresca solo al instante, ya pasó esta sesión con
   `productos_stock_bajo`).
2. **Probar en vivo (browser real)**: Productos → tab Recuento → "Nuevo
   Recuento" con una categoría chica → cargar 2-3 cantidades → Confirmar →
   verificar que el asiento aparece en Contabilidad → Asientos (cuentas 5.10/4.5).
   Repetir para Revalorización (5.11/4.6). Confirmar también las ramas de
   "Anular" (solo debe permitirse en borrador).
3. Si algo falla, el rollback de cada migración está documentado en el header
   de cada archivo SQL (comentario `-- ROLLBACK:`).

## 4. Hallazgo de datos — revisar antes de seguir importando

Probando la query de verificación apareció un producto corrupto en Nalux real:
`nombre='Danica'`, `codigo_sku='soft ligth'`, `codigo_barras='Unidad'`,
`descripcion='5'`, con una categoría huérfana literalmente llamada
`'7791620009858'` (es el código de barra real de ese producto). Es 1 de los 50
productos del lote de prueba del catálogo de kiosco — el original en el CSV
era `"Danica, soft ligth"` (nombre con una coma adentro, entre comillas). Todo
el resto del parsing (49/50 productos) salió perfecto — el parser del
importador se probó línea por línea y es correcto — así que lo más probable es
que el archivo se haya reabierto/regrabado en Excel u otro programa entre que
se generó y se subió, rompiendo el quoting de esa única celda con coma. **No
se tocó la fila** (no se borra nada sin confirmar con Luciano primero) — queda
para decidir mañana: borrar el producto + la categoría huérfana, o corregirlo
a mano.

## 5. Pendiente — import del resto del catálogo

Quedan **3.380 productos** del catálogo de kiosco (Open Food Facts Argentina)
sin importar — Luciano pausó el import después del lote de prueba de 50 para
frenar y pedir esta feature de Recuento/Revalorización primero. El archivo
`catalogo_kiosco_kairox_resto.csv` sigue disponible si se retoma. **No seguir
importando sin que Luciano lo pida explícitamente.**

## 6. Recordatorio de Luciano — venta de artículos SIN código de barra

Pedido explícito para revisar (no resuelto, no investigado todavía): cómo se
vende hoy un fiambre u otro artículo que **no tiene código de barras** (fiambre
se corta y pesa, no viene con EAN de fábrica salvo que la balanza lo genere).
Hay que auditar el flujo de venta del POS (`NuevaVentaModal.jsx` y el lector de
código de barra) para confirmar que existe un camino de venta por búsqueda de
nombre/SKU cuando no hay barcode para escanear, y si haría falta soporte para
productos vendidos por peso (kg) en vez de por unidad. Antes de tocar código,
juntar con Luciano el caso de uso real (¿balanza con impresora de etiqueta
propia? ¿venta 100% manual?).
