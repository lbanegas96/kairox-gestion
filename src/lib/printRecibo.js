// Mismo patrón que TICKET-PRINT en ModoCajaLayout.jsx: inyecta @media print
// que oculta todo menos el elemento indicado, llama window.print(), limpia
// el <style> al terminar. Reutilizado por ReciboPago.jsx desde Cuenta
// Corriente (clientes) y Proveedores.
export function printElementById(elementId) {
  const style = document.createElement('style');
  style.id = 'kx-print-style';
  style.textContent = `
    @media print {
      /* A4 estándar, igual que FacturaPDF.jsx (react-pdf usa <Page
         size="A4">) — 01/09, hallazgo Luciano comparando el PDF real de una
         Factura contra el de un Comprobante de Pago: el tamaño custom
         "210mm 210mm" que se probó el 30/08 para evitar el espacio en
         blanco NO es un tamaño de papel estándar, y el driver de impresión
         (probado con "Microsoft Print to PDF") no lo reconoce — cae a su
         tamaño por defecto (Carta/Letter, 612x792pt) en vez de A4, dando un
         PDF con proporciones distintas a las de la Factura (595x842pt,
         confirmado leyendo el /MediaBox de ambos PDF). Volver a A4
         garantiza el mismo tamaño de página en cualquier impresora/driver,
         al costo de que un recibo corto vuelva a dejar espacio en blanco
         abajo — mismo trade-off que ya acepta la Factura real. Esta función
         solo la usa ReciboPago.jsx (ver grep de callers) — no comparte
         @page con Ticket/Factura, así que este cambio no los afecta. */
      @page { size: A4; margin: 15mm; }
      body * { visibility: hidden !important; }
      #${elementId}, #${elementId} * { visibility: visible !important; }
      #${elementId} {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
      }
    }
  `;
  document.head.appendChild(style);
  setTimeout(() => {
    window.print();
    document.getElementById('kx-print-style')?.remove();
  }, 100);
}
