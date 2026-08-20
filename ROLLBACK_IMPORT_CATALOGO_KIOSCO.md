# Rollback del import masivo de catálogo (kiosco/almacén)

Guía lista para usar si el import de `catalogo_kiosco_kairox.csv` (~3.430 productos,
Open Food Facts Argentina) sale mal y hay que deshacerlo. Correr en el SQL Editor de
Supabase del proyecto `isvkelrdxwvkfmrfqxxk`.

**Cómo se identifican los productos importados, sin ambigüedad:** todos tienen
`codigo_sku` con el patrón `PREFIJO-00001` (prefijo de 3 letras del grupo: `BEB`,
`LAC`, `SNK`, `GOL`, `INF`, `PAN`, `FIA`, `CON`, `ALM`, seguido de 5 dígitos). Es un
patrón que el sistema no genera para nada más — cualquier producto cargado a mano o
por otra vía no lo tiene. Por eso alcanza con filtrar por ese patrón + `empresa_id`,
sin depender de fechas ni de acordarse de un rango horario.

```sql
-- Empresa: Nalux
-- (reemplazar si se corre para otro tenant)
-- empresa_id = 'cbc4db74-ec31-4324-bd36-207b7a7bd99a'
```

## 1. Antes de tocar nada: ver qué se importó

```sql
SELECT categorias.nombre AS grupo, COUNT(*) AS cantidad
FROM productos
LEFT JOIN categorias ON categorias.id = productos.categoria_id
WHERE productos.empresa_id = 'cbc4db74-ec31-4324-bd36-207b7a7bd99a'
  AND productos.codigo_sku ~ '^(BEB|LAC|SNK|GOL|INF|PAN|FIA|CON|ALM)-\d{5}$'
GROUP BY categorias.nombre
ORDER BY cantidad DESC;
```

## 2. Chequear que nadie ya vendió/movió estos productos

Si algún producto importado ya tiene una venta, compra o ajuste de stock encima, un
`DELETE` directo va a fallar por integridad referencial (o peor, si en algún punto se
relaja esa referencia, borrar la fila rompería el historial de esa operación real).
Correr esto primero:

```sql
SELECT p.codigo_sku, p.nombre, p.stock_actual
FROM productos p
WHERE p.empresa_id = 'cbc4db74-ec31-4324-bd36-207b7a7bd99a'
  AND p.codigo_sku ~ '^(BEB|LAC|SNK|GOL|INF|PAN|FIA|CON|ALM)-\d{5}$'
  AND (
    p.stock_actual <> 0
    OR EXISTS (SELECT 1 FROM movimientos_inventario m WHERE m.producto_id = p.id)
    OR EXISTS (SELECT 1 FROM comprobante_items ci WHERE ci.producto_id = p.id)
    OR EXISTS (SELECT 1 FROM pedido_items pi WHERE pi.producto_id = p.id)
    OR EXISTS (SELECT 1 FROM detalle_compras dc WHERE dc.producto_id = p.id)
  );
```

- **Si esto no devuelve filas:** son productos "vírgenes", nunca se tocaron desde que
  se importaron -- el rollback completo (sección 4) es seguro.
- **Si devuelve filas:** esos productos puntuales ya se usaron en algo real -- no los
  borres. Sacalos del rollback (dejalos activos) o, si igual no correspondían,
  desactivalos con la opción soft (sección 3) en vez de borrarlos.

## 3. Rollback SUAVE (recomendado) -- desactivar, no borrar

Deja todo el historial intacto y saca los productos de las búsquedas/POS. Se puede
revertir (`activo = true`) en cualquier momento.

```sql
UPDATE productos
SET activo = false
WHERE empresa_id = 'cbc4db74-ec31-4324-bd36-207b7a7bd99a'
  AND codigo_sku ~ '^(BEB|LAC|SNK|GOL|INF|PAN|FIA|CON|ALM)-\d{5}$';
```

## 4. Rollback DURO -- borrar filas (solo si el paso 2 dio 0 filas)

```sql
DELETE FROM productos
WHERE empresa_id = 'cbc4db74-ec31-4324-bd36-207b7a7bd99a'
  AND codigo_sku ~ '^(BEB|LAC|SNK|GOL|INF|PAN|FIA|CON|ALM)-\d{5}$';
```

## 5. (Opcional) Limpiar las categorías/grupos que quedaron vacías

El importador crea categorías nuevas si no existían (`Bebidas`, `Lácteos`, etc. --
ver `resolverGrupos` en `CSVImportModal.jsx`). Si después del rollback duro esas
categorías quedaron sin ningún producto, esto las saca:

```sql
DELETE FROM categorias
WHERE empresa_id = 'cbc4db74-ec31-4324-bd36-207b7a7bd99a'
  AND nombre IN ('Bebidas', 'Lácteos', 'Golosinas y Chocolates', 'Snacks y Galletitas',
                 'Infusiones', 'Panadería', 'Fiambres y Conservas', 'Congelados y Helados', 'Almacén')
  AND NOT EXISTS (SELECT 1 FROM productos WHERE productos.categoria_id = categorias.id);
```

No corre sola -- solo si de verdad se quiere sacar el grupo del sistema, no solo los
productos. Si vas a re-importar después, dejarlas no hace daño.
