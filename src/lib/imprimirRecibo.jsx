// Genera el Comprobante de Pago/Cobro como PDF real (@react-pdf/renderer) y
// lo descarga directamente — mismo patrón exacto que handleDownloadPDF de
// ComprobantePrintModal.jsx (Factura: <a download> + .click(), no
// window.open). Reemplaza el viejo flujo de printElementById() (window.print()
// de un <div> oculto con @page CSS) — ese CSS nunca llegó a respetarse
// contra "Microsoft Print to PDF" como destino (confirmado leyendo el
// /MediaBox de 3 PDF reales: siempre Carta/Letter pase lo que pase en el
// @page). Un PDF generado ya trae su propio tamaño A4 fijo en el archivo,
// así que no depende de ningún driver de impresora. Se usa <a download> en
// vez de window.open porque un popup puede quedar bloqueado por el
// navegador (probado: window.open sigue bloqueado incluso disparado desde
// un click real) — una descarga programática no pasa por ese bloqueo.
//
// Import dinámico: @react-pdf/renderer pesa ~1.4MB minificado (ver build),
// no se quiere en el bundle inicial — mismo criterio que ComprobantePrintModal.
export async function imprimirReciboPago(recibo) {
  const { pdf } = await import('@react-pdf/renderer');
  const { ReciboPagoPDF } = await import('@/components/shared/pdf/ReciboPagoPDF');
  const blob = await pdf(<ReciboPagoPDF recibo={recibo} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Comprobante_${recibo?.movimientoId?.slice(0, 8) ?? 'pago'}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
