-- 411 — Una factura de proveedor no se puede cargar dos veces
--
-- Auditoría 24/09/2026, hallazgo CON-6. `compras` solo tenía la clave primaria: nada impedía registrar dos veces la
-- misma factura del mismo proveedor (un doble tipeo, o cargarla desde Compra Rápida y de nuevo desde la OC). Cada
-- copia suma su propio crédito fiscal en el Libro IVA, su propia deuda en la cuenta corriente y su propio asiento.
-- (El informe original decía que ya había un caso en los datos; era un falso positivo por el valor «S/N» que se
-- usa cuando no hay número: hoy no hay ninguna factura duplicada, 0 casos con el mismo criterio de este índice.)
--
-- Regla: dentro de una empresa, un proveedor no puede tener dos compras con el mismo `numero_factura` cuando:
--   - la compra va al Libro IVA (`en_libro_iva`): los tickets y referencias libres de «No libro» (que dos veces
--     pueden llamarse igual, p. ej. «ticket») quedan afuera a propósito;
--   - no está anulada: anular una compra libera su número (se puede volver a cargar bien);
--   - tiene un número real: se ignoran el vacío y «S/N».
-- Se compara sin distinguir mayúsculas ni espacios de los costados. Para las compras estructuradas (mig. 398) el
-- número ya incluye la letra y sale con ceros a la izquierda («A-0001-00012345»), así que una factura A y una B del
-- mismo proveedor y punto de venta con el mismo número (numeraciones separadas) NO chocan.
--
-- Todos los caminos que crean o editan una compra quedan cubiertos (insert directo, edición del número y
-- `registrar_factura_compra_oc`). El error que sale es el de siempre de Postgres, con el nombre del índice, y el
-- frontend lo traduce a un aviso claro (`src/lib/erroresCompra.js`).

CREATE UNIQUE INDEX IF NOT EXISTS uq_compras_factura_proveedor
  ON public.compras (empresa_id, proveedor_id, upper(btrim(numero_factura)))
  WHERE en_libro_iva
    AND estado_pago <> 'anulada'
    AND proveedor_id IS NOT NULL
    AND btrim(coalesce(numero_factura, '')) <> ''
    AND upper(btrim(numero_factura)) <> 'S/N';
