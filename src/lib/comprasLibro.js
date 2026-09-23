// Compras "Libro" / "No libro" (Compra Rápida — pedido de Luciano, 23/09).
//
// - "Libro": la compra va al Libro IVA Compras, suma crédito fiscal y por eso
//   exige los 3 datos del comprobante del proveedor (letra, punto de venta,
//   número) — sin ellos no se puede declarar ante ARCA.
// - "No libro": ticket, compra sin factura, uso interno. No va al Libro ni a la
//   Posición IVA y no suma crédito fiscal: el IVA queda dentro del costo
//   (neto_gravado = total, iva_discriminado = 0, asiento sin IVA Crédito Fiscal).
//
// Vive acá (y no dentro del componente) para que la creación y la edición de
// una compra calculen neto/IVA con exactamente la misma regla.

export const TIPOS_COMPROBANTE = ['A', 'B', 'C', 'M', 'E'];

// Factor bruto → neto por alícuota: `costo_unitario` se carga con IVA incluido.
// 0 / exento / no_gravado no discriminan IVA (factor 1). Antes de esto, un
// producto exento se calculaba al 21% porque la tabla inline no tenía esas claves.
const FACTOR_IVA = { '21': 1.21, '10.5': 1.105, '27': 1.27 };

/** Factor bruto → neto de una alícuota ('21', '10.5', '0', 'exento', 'no_gravado'). Sin dato = 21%. */
export function factorIva(alicuota) {
  return FACTOR_IVA[String(alicuota ?? 21)] ?? 1;
}

/**
 * Neto e IVA de una compra a partir de sus ítems (precio FINAL, IVA incluido).
 * items: [{ cantidad, costo_unitario (número), alicuota_iva }].
 * "No libro" no suma crédito fiscal: todo el importe es neto y el IVA es 0.
 */
export function netoIvaCompra(items, enLibro = true) {
  let bruto = 0;
  let neto = 0;
  (items ?? []).forEach(it => {
    const b = (Number(it.cantidad) || 0) * (Number(it.costo_unitario) || 0);
    bruto += b;
    neto += b / factorIva(it.alicuota_iva);
  });
  return enLibro ? { neto, iva: bruto - neto } : { neto: bruto, iva: 0 };
}

/** numero_factura derivado del comprobante estructurado: "A-0001-00012345" ('' si falta el PV o el número). */
export function numeroFacturaDerivado(letra, puntoVenta, numero) {
  const pv = String(puntoVenta ?? '').trim();
  const nro = String(numero ?? '').trim();
  if (!pv || !nro) return '';
  return `${letra}-${pv.padStart(4, '0')}-${nro.padStart(8, '0')}`;
}

/**
 * Todo lo que una Compra Rápida guarda según sea "Libro" o "No libro" — la misma
 * cuenta para el alta y para poder probarla sin montar el formulario.
 *   form:  { en_libro_iva, numero_factura, tipo_comprobante_letra,
 *            punto_venta_proveedor, numero_comprobante_proveedor }
 *   items: [{ cantidad, costo_unitario, alicuota_iva }] — ya numéricos
 *   total: total de la compra en pesos
 * Devuelve { enLibro, numeroFactura, neto, iva, comprobante }, donde `comprobante`
 * son las 3 columnas estructuradas (vacío en "No libro": quedan en NULL).
 */
export function resolverCompraLibro(form, items, total) {
  const enLibro = form.en_libro_iva !== false;
  const numeroFactura = enLibro
    ? (numeroFacturaDerivado(
        form.tipo_comprobante_letra, form.punto_venta_proveedor, form.numero_comprobante_proveedor
      ) || 'S/N')
    : (form.numero_factura || 'S/N');
  const { neto, iva } = netoIvaCompra(items, enLibro);
  return {
    enLibro,
    numeroFactura,
    // En "No libro" todo el importe es neto: se usa el total tal cual, no la suma de
    // ítems (que en Compra Rápida trunca la cantidad a entero).
    neto: enLibro ? neto : total,
    iva,
    comprobante: enLibro ? {
      tipo_comprobante_letra: form.tipo_comprobante_letra,
      punto_venta_proveedor: String(form.punto_venta_proveedor ?? '').trim(),
      numero_comprobante_proveedor: String(form.numero_comprobante_proveedor ?? '').trim(),
    } : {},
  };
}

/** true si los 3 datos del comprobante del proveedor están completos. */
export function comprobanteProveedorCompleto({ letra, puntoVenta, numero }) {
  return TIPOS_COMPROBANTE.includes(letra)
    && String(puntoVenta ?? '').trim() !== ''
    && String(numero ?? '').trim() !== '';
}

/** true si el proveedor tiene un CUIT de 11 dígitos — sin él ARCA no acepta la compra en el Libro. */
export function tieneCuitValido(cuit) {
  return String(cuit ?? '').replace(/\D/g, '').length === 11;
}
