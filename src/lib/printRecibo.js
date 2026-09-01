// Mismo patrón que TICKET-PRINT en ModoCajaLayout.jsx: inyecta @media print
// que oculta todo menos el elemento indicado, llama window.print(), limpia
// el <style> al terminar. Reutilizado por ReciboPago.jsx desde Cuenta
// Corriente (clientes) y Proveedores.
export function printElementById(elementId) {
  const style = document.createElement('style');
  style.id = 'kx-print-style';
  style.textContent = `
    @media print {
      /* 210mm x 210mm en vez de A4 completo (297mm) — 30/08, hallazgo
         Luciano: "que se ajuste más a la hoja". El Recibo de Pago es un
         comprobante corto (cabecera + un monto + tabla chica + firma); a
         página A4 completa le sobraba casi un tercio en blanco abajo. Se
         recorta con margen (si algún recibo con muchas imputaciones no
         entra, el navegador lo pagina a una segunda hoja en vez de cortar
         contenido — nunca hay pérdida de datos). Esta función solo la usa
         ReciboPago.jsx (ver grep de callers) — no comparte @page con
         Ticket/Factura, así que este cambio no los afecta. */
      @page { size: 210mm 210mm; margin: 15mm; }
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
