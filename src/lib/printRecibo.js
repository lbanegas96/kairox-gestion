// Mismo patrón que TICKET-PRINT en ModoCajaLayout.jsx: inyecta @media print
// que oculta todo menos el elemento indicado, llama window.print(), limpia
// el <style> al terminar. Reutilizado por ReciboPago.jsx desde Cuenta
// Corriente (clientes) y Proveedores.
export function printElementById(elementId) {
  const style = document.createElement('style');
  style.id = 'kx-print-style';
  style.textContent = `
    @media print {
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
