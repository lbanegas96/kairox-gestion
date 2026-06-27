import React from 'react';

// TICKET-PRINT — componente headless usado por ModoCajaLayout para imprimir
// el comprobante del POS. Vive permanentemente en el DOM (montado al lado del
// Layout) pero está posicionado fuera de pantalla. Solo se vuelve visible
// cuando ModoCajaLayout.handlePrint inyecta el <style> @media print y dispara
// window.print().
//
// Props:
//   - venta:    { id, numero_venta, fecha, total, descuento?, cliente_nombre,
//                 forma_pago, cae?, cae_vencimiento? }
//   - items:    [{ nombre, cantidad, precio_venta }]  (snapshot del carrito)
//   - empresa:  { nombre, afip_cuit?, direccion?, telefono?, usa_factura_electronica? }
//   - formato:  '80mm' | 'A4'

const formatARS = (n) =>
  Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatFechaHora = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const fecha = d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const hora = d.toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  return `${fecha} ${hora}`;
};

// TICKET-PRINT — separador horizontal con el ancho correcto según formato
function Divider({ is80 }) {
  return <div className="my-1">{is80 ? '─'.repeat(40) : <hr className="border-black" />}</div>;
}

function TicketPrint({ venta, items = [], empresa = {}, formato = '80mm' }) {
  if (!venta) return null;

  const is80 = formato === '80mm';
  const subtotal = items.reduce(
    (s, it) => s + Number(it.cantidad || 0) * Number(it.precio_venta ?? it.precio_unitario ?? 0),
    0,
  );
  const descuento = Number(venta.descuento || 0);
  const showCAE = Boolean(venta.cae);
  const caePendiente = !showCAE && empresa.usa_factura_electronica;

  return (
    <div
      id="kx-ticket-print"
      // TICKET-PRINT — siempre off-screen en pantalla; el @media print lo reposiciona
      style={{ position: 'absolute', left: '-10000px', top: 0 }}
      className={is80
        ? 'kx-print-80mm font-mono text-[11px] leading-tight text-black bg-white'
        : 'kx-print-a4 font-sans text-sm text-black bg-white'
      }
    >
      <div
        style={is80
          ? { width: '74mm', padding: '2mm' }
          : { width: '180mm', margin: '0 auto', padding: '6mm' }
        }
      >
        {/* CABECERA */}
        <div className="text-center">
          <div className={is80 ? 'text-base font-bold' : 'text-xl font-bold'}>
            {empresa.nombre || 'Empresa'}
          </div>
          {empresa.afip_cuit && <div>CUIT: {empresa.afip_cuit}</div>}
          {empresa.direccion && <div>{empresa.direccion}</div>}
          {empresa.telefono && <div>Tel: {empresa.telefono}</div>}
        </div>

        <Divider is80={is80} />

        {/* DATOS DEL COMPROBANTE */}
        <div>
          <div>Comprobante N°: {venta.numero_venta || venta.numero}</div>
          <div>Fecha: {formatFechaHora(venta.fecha)}</div>
          <div>Cliente: {venta.cliente_nombre || 'Consumidor Final'}</div>
        </div>

        <Divider is80={is80} />

        {/* DETALLE */}
        {is80 ? (
          // TICKET-PRINT — 80mm: grid monospace para alinear columnas
          <div>
            <div className="grid grid-cols-[3ch_1fr_9ch_9ch] gap-1 font-bold">
              <span>Cant</span>
              <span>Descripción</span>
              <span className="text-right">P.Unit</span>
              <span className="text-right">Total</span>
            </div>
            {items.map((it, idx) => {
              const cant = Number(it.cantidad || 0);
              const punit = Number(it.precio_venta ?? it.precio_unitario ?? 0);
              const sub = cant * punit;
              return (
                <div key={idx} className="grid grid-cols-[3ch_1fr_9ch_9ch] gap-1">
                  <span>{cant}</span>
                  <span className="break-words">{it.nombre || it.descripcion}</span>
                  <span className="text-right">${formatARS(punit)}</span>
                  <span className="text-right">${formatARS(sub)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          // TICKET-PRINT — A4: tabla
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="py-1 w-16">Cant</th>
                <th className="py-1">Descripción</th>
                <th className="py-1 w-28 text-right">P. Unit</th>
                <th className="py-1 w-28 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const cant = Number(it.cantidad || 0);
                const punit = Number(it.precio_venta ?? it.precio_unitario ?? 0);
                const sub = cant * punit;
                return (
                  <tr key={idx} className="border-b border-gray-300">
                    <td className="py-1">{cant}</td>
                    <td className="py-1">{it.nombre || it.descripcion}</td>
                    <td className="py-1 text-right">${formatARS(punit)}</td>
                    <td className="py-1 text-right">${formatARS(sub)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <Divider is80={is80} />

        {/* TOTALES */}
        <div className={is80 ? '' : 'flex flex-col items-end'}>
          <div className={is80 ? 'flex justify-between' : 'w-64 flex justify-between'}>
            <span>Subtotal:</span>
            <span>${formatARS(subtotal)}</span>
          </div>
          {descuento > 0 && (
            <div className={is80 ? 'flex justify-between' : 'w-64 flex justify-between'}>
              <span>Descuento:</span>
              <span>${formatARS(descuento)}</span>
            </div>
          )}
          <div className={is80
            ? 'flex justify-between font-bold text-base border-t-2 border-black mt-1 pt-1'
            : 'w-64 flex justify-between font-bold text-base border-t-2 border-black mt-1 pt-1'
          }>
            <span>TOTAL:</span>
            <span>${formatARS(venta.total)}</span>
          </div>
          <div className={is80 ? 'mt-1' : 'w-64 mt-2'}>
            Medio de pago: {venta.forma_pago || 'Efectivo'}
          </div>
        </div>

        {/* CAE — solo si está autorizado */}
        {showCAE && (
          <>
            <Divider is80={is80} />
            <div>
              <div>CAE N°: {venta.cae}</div>
              {venta.cae_vencimiento && (
                <div>Vto. CAE: {new Date(venta.cae_vencimiento).toLocaleDateString('es-AR')}</div>
              )}
            </div>
          </>
        )}

        {/* TICKET-PRINT — aviso si la factura electrónica está activa pero el
            CAE todavía no fue autorizado por el worker (es async). El cajero
            puede re-imprimir desde el Historial cuando el CAE esté listo. */}
        {caePendiente && (
          <>
            <Divider is80={is80} />
            <div className="text-center italic">
              Factura electrónica en proceso — CAE pendiente
            </div>
          </>
        )}

        {/* PIE */}
        <Divider is80={is80} />
        <div className="text-center">
          <div>Gracias por su compra</div>
          <div className="text-[10px] opacity-70 mt-1">KAIROX Gestión</div>
        </div>
      </div>
    </div>
  );
}

export default TicketPrint;
