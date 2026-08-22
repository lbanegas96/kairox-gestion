import React from 'react';

const formatARS = (n) =>
  Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

// Comprobante interno de Cobro/Pago (no fiscal — no reemplaza al recibo AFIP)
// para Cuenta Corriente de clientes y proveedores. Mismo patrón de impresión
// que TicketPrint.jsx (caja/): vive siempre oculto en el DOM
// (position:absolute fuera de pantalla) y se hace visible solo cuando el
// caller inyecta @media print + window.print() — ver handlePrintRecibo en
// CuentaCorrienteSection.jsx / ProveedoresSection.jsx.
//
// Sin numeración fiscal propia — usa los primeros 8 caracteres del id del
// movimiento como referencia interna, igual criterio que un recibo interno
// de caja (no es un comprobante ARCA).
function ReciboPago({ recibo }) {
  if (!recibo) return null;

  const {
    tipo, // 'cobro' (cliente) | 'pago' (proveedor)
    movimientoId,
    fecha,
    contraparteNombre, // cliente o proveedor
    monto,
    metodo,
    referenciaPago,
    nota,
    imputaciones = [], // [{ numero, monto, saldoAnterior, saldoNuevo }]
    saldoAnteriorTotal,
    saldoNuevoTotal,
    empresa = {},
  } = recibo;

  const esCobro = tipo === 'cobro';
  const numeroInterno = movimientoId ? movimientoId.slice(0, 8).toUpperCase() : '—';

  return (
    <div
      id="kx-recibo-print"
      style={{ position: 'absolute', left: '-10000px', top: 0 }}
      className="kx-print-a4 font-sans text-sm text-black bg-white"
    >
      <div style={{ width: '180mm', margin: '0 auto', padding: '10mm' }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xl font-bold">{empresa.nombre || 'Empresa'}</div>
            {empresa.afip_cuit && <div>CUIT: {empresa.afip_cuit}</div>}
            {empresa.direccion && <div>{empresa.direccion}</div>}
          </div>
          <div className="text-right">
            <div className="text-lg font-bold">
              {esCobro ? 'RECIBO DE COBRO' : 'COMPROBANTE DE PAGO'}
            </div>
            <div>N° interno: {numeroInterno}</div>
            <div>{formatFechaHora(fecha)}</div>
          </div>
        </div>

        <hr className="border-black my-3" />

        <div>
          <span className="font-semibold">{esCobro ? 'Recibido de: ' : 'Pagado a: '}</span>
          {contraparteNombre}
        </div>

        <div className="mt-3 flex justify-between items-end">
          <div>
            <div><span className="font-semibold">Medio de pago:</span> {metodo || 'Efectivo'}</div>
            {referenciaPago && (
              <div><span className="font-semibold">Referencia:</span> {referenciaPago}</div>
            )}
            {nota && <div><span className="font-semibold">Nota:</span> {nota}</div>}
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-600">{esCobro ? 'Monto cobrado' : 'Monto pagado'}</div>
            <div className="text-2xl font-bold">${formatARS(monto)}</div>
          </div>
        </div>

        {imputaciones.length > 0 && (
          <>
            <hr className="border-gray-400 my-3" />
            <div className="font-semibold mb-1">Comprobantes imputados</div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-black">
                  <th className="py-1">Comprobante</th>
                  <th className="py-1 text-right">Aplicado</th>
                </tr>
              </thead>
              <tbody>
                {imputaciones.map((imp, idx) => (
                  <tr key={idx} className="border-b border-gray-300">
                    <td className="py-1">{imp.numero}</td>
                    <td className="py-1 text-right">${formatARS(imp.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {(saldoAnteriorTotal != null || saldoNuevoTotal != null) && (
          <>
            <hr className="border-gray-400 my-3" />
            <div className="flex justify-end">
              <div className="w-64">
                {saldoAnteriorTotal != null && (
                  <div className="flex justify-between">
                    <span>Saldo anterior:</span>
                    <span>${formatARS(saldoAnteriorTotal)}</span>
                  </div>
                )}
                {saldoNuevoTotal != null && (
                  <div className="flex justify-between font-bold border-t border-black mt-1 pt-1">
                    <span>Saldo actual:</span>
                    <span>${formatARS(saldoNuevoTotal)}</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <div className="mt-16 flex justify-between text-center text-xs">
          <div className="w-56">
            <div className="border-t border-black pt-1">Firma</div>
          </div>
          <div className="w-56">
            <div className="border-t border-black pt-1">Aclaración</div>
          </div>
        </div>

        <div className="mt-8 text-center text-[10px] text-gray-500">
          Comprobante interno — no reemplaza a la factura ni a un recibo fiscal. KAIROX Gestión
        </div>
      </div>
    </div>
  );
}

export default ReciboPago;
