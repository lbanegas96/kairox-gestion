// Número fiscal del documento — hallazgo de Luciano (22/08): el numero_afip
// (formato "0001-00000047", PdV+folio) ya vivía en la base desde que existe
// facturación electrónica, pero casi ninguna pantalla lo mostraba como
// identificador principal — se mostraba numero_venta (el correlativo interno,
// "FAC-20260822-001"), que el cliente/AFIP nunca ven. FacturaPDF.jsx y
// ReporteLibroIVA.jsx ya hacían este fallback correctamente; el resto no.
//
// "Letra + PdV + Folio" (estilo SAP) es exactamente `tipo_comprobante_afip +
// numero_afip`, porque numero_afip YA es "PdV-folio" combinado — no hace
// falta un campo nuevo, solo mostrar los dos juntos donde antes se mostraba
// numero_venta.
//
// Sin CAE todavía (pendiente, error, o PdV no fiscal) no hay folio real — cae
// a numero_venta, que sigue siendo el único identificador estable en esos casos.
export function formatNumeroComprobante(comprobante) {
  if (!comprobante) return '—';
  const letra = comprobante.tipo_comprobante_afip;
  const folio = comprobante.numero_afip;
  if (letra && folio) return `${letra} ${folio}`;
  if (folio) return folio;
  return comprobante.numero_venta ?? '—';
}
