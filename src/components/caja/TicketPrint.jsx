import React from 'react';

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

function Divider({ is80 }) {
  return <div className="my-1">{is80 ? '─'.repeat(40) : <hr className="border-black" />}</div>;
}

function TicketPrint({ venta, items = [], empresa = {}, formato = '80mm', ofertasCarrito = {} }) {
  if (!venta) return null;

  const is80 = formato === '80mm';

  // OFERTAS — calcular subtotal bruto y descuento total desde ofertasCarrito
  const subtotalBruto = items.reduce(
    (s, it) => s + Number(it.cantidad || 0) * Number(it.precio_venta ?? it.precio_unitario ?? 0),
    0,
  );
  const descuentoTotal = items.reduce((sum, it) => {
    const oferta = ofertasCarrito[it.id];
    if (!oferta) return sum;
    return sum + (oferta.descuento_monto * Number(it.cantidad || 0));
  }, 0);

  const showCAE = Boolean(venta.cae);
  const caePendiente = !showCAE && empresa.usa_factura_electronica;

  // OFERTAS — helper para obtener precio unitario (con descuento si aplica)
  const getPunit = (it) => {
    const oferta = ofertasCarrito[it.id];
    return oferta ? oferta.precio_final : Number(it.precio_venta ?? it.precio_unitario ?? 0);
  };

  return (
    <div
      id="kx-ticket-print"
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
          <div>
            <div className="grid grid-cols-[3ch_1fr_9ch_9ch] gap-1 font-bold">
              <span>Cant</span>
              <span>Descripción</span>
              <span className="text-right">P.Unit</span>
              <span className="text-right">Total</span>
            </div>
            {items.map((it, idx) => {
              const cant = Number(it.cantidad || 0);
              const punit = getPunit(it);
              const sub = cant * punit;
              const oferta = ofertasCarrito[it.id];
              const isPack = !!it._packMode;
              const displayCant = isPack ? `${it._packs} ${it.unidad_venta?.codigo || 'pack'}` : cant;
              const displayPunit = isPack && it._packs ? sub / it._packs : punit;
              return (
                <React.Fragment key={idx}>
                  <div className="grid grid-cols-[5ch_1fr_9ch_9ch] gap-1">
                    <span>{displayCant}</span>
                    <span className="break-words">{it.nombre || it.descripcion}</span>
                    <span className="text-right">${formatARS(displayPunit)}</span>
                    <span className="text-right">${formatARS(sub)}</span>
                  </div>
                  {oferta && (
                    <div className="pl-2 text-[9px]">
                      &gt; {oferta.oferta_nombre}: -${formatARS(oferta.descuento_monto * cant)}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        ) : (
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
                const punit = getPunit(it);
                const sub = cant * punit;
                const oferta = ofertasCarrito[it.id];
                const isPack = !!it._packMode;
                const displayCant = isPack ? `${it._packs} ${it.unidad_venta?.codigo || 'pack'}` : cant;
                const displayPunit = isPack && it._packs ? sub / it._packs : punit;
                return (
                  <React.Fragment key={idx}>
                    <tr className="border-b border-gray-300">
                      <td className="py-1">{displayCant}</td>
                      <td className="py-1">{it.nombre || it.descripcion}</td>
                      <td className="py-1 text-right">${formatARS(displayPunit)}</td>
                      <td className="py-1 text-right">${formatARS(sub)}</td>
                    </tr>
                    {oferta && (
                      <tr>
                        <td colSpan={3} className="py-0 text-xs text-gray-500 pl-6">
                          {oferta.oferta_nombre}
                        </td>
                        <td className="py-0 text-xs text-right text-gray-500">
                          -${formatARS(oferta.descuento_monto * cant)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}

        <Divider is80={is80} />

        {/* TOTALES */}
        <div className={is80 ? '' : 'flex flex-col items-end'}>
          {descuentoTotal > 0 ? (
            <>
              <div className={is80 ? 'flex justify-between' : 'w-64 flex justify-between'}>
                <span>Subtotal:</span>
                <span>${formatARS(subtotalBruto)}</span>
              </div>
              <div className={is80 ? 'flex justify-between' : 'w-64 flex justify-between'}>
                <span>Descuentos:</span>
                <span>-${formatARS(descuentoTotal)}</span>
              </div>
            </>
          ) : (
            <div className={is80 ? 'flex justify-between' : 'w-64 flex justify-between'}>
              <span>Subtotal:</span>
              <span>${formatARS(subtotalBruto)}</span>
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

        {/* CAE */}
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
