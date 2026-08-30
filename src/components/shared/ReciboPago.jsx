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

// Comprobante interno de Cobro/Pago (no fiscal — no reemplaza al Recibo X
// de ARCA, que tiene su propio trámite de CAE) para Cuenta Corriente de
// clientes y proveedores. Mismo patrón de impresión que TicketPrint.jsx:
// vive siempre oculto en el DOM (position:absolute fuera de pantalla) y se
// hace visible solo cuando el caller inyecta @media print + window.print()
// — ver handlePrintRecibo en CuentaCorrienteSection.jsx / ProveedoresSection.jsx.
//
// Rediseño 29/08 (hallazgo Luciano: "todos los comprobantes del sistema
// deben seguir el mismo estilo, este lo veo muy diferente al de la
// Entrega") — mismo lenguaje visual que RemitoPDF/FacturaPDF/CotizacionPDF
// (header con regla inferior marino, tabla con cabecera marina, bloque de
// firma con línea + imagen de firma opcional encima), pero en HTML/Tailwind
// en vez de @react-pdf/renderer porque este comprobante se imprime tal cual
// vive en el DOM (window.print), no se genera como archivo PDF descargable.
//
// Sin numeración fiscal propia — usa los primeros 8 caracteres del id del
// movimiento como referencia interna, igual criterio que un recibo interno
// de caja (no es un comprobante ARCA).
const NAVY = '#0f172a';
const BLUE = '#1d4ed8';
const SLATE = '#475569';
const MUTED = '#64748b';
const BORDER = '#cbd5e1';
const BG_ROW = '#f8fafc';

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
      className="kx-print-a4 font-sans text-black bg-white"
    >
      <div style={{ width: '180mm', margin: '0 auto', padding: '10mm' }}>

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <div className="flex items-stretch pb-3 mb-3.5" style={{ borderBottom: `1.5pt solid ${NAVY}` }}>
          <div className="flex-[3] pr-3" style={{ borderRight: `1pt solid ${BORDER}` }}>
            {empresa.logo && (
              <img src={empresa.logo} alt="" style={{ height: '9mm', maxWidth: '32mm', objectFit: 'contain', marginBottom: '2mm' }} />
            )}
            <div className="text-[13px] font-bold" style={{ color: NAVY }}>{empresa.nombre || 'Mi Empresa'}</div>
            {(empresa.afip_cuit || empresa.cuit) && (
              <div className="text-[8px] leading-relaxed" style={{ color: SLATE }}>CUIT: {empresa.afip_cuit || empresa.cuit}</div>
            )}
            {empresa.condicion_iva && (
              <div className="text-[8px] leading-relaxed" style={{ color: SLATE }}>Cond. IVA: {empresa.condicion_iva}</div>
            )}
            {empresa.direccion && (
              <div className="text-[8px] leading-relaxed" style={{ color: SLATE }}>{empresa.direccion}</div>
            )}
          </div>
          <div className="flex-[3] pl-3">
            <div className="text-[7px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Comprobante</div>
            <div className="text-[15px] font-bold mb-1.5" style={{ color: BLUE }}>
              {esCobro ? 'Recibo de Cobro' : 'Comprobante de Pago'}
            </div>
            <div className="text-[7px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>N° interno</div>
            <div className="text-[9px] mb-1.5" style={{ color: NAVY }}>{numeroInterno}</div>
            <div className="text-[7px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Fecha</div>
            <div className="text-[9px]" style={{ color: NAVY }}>{formatFechaHora(fecha)}</div>
          </div>
        </div>

        {/* ── RECIBIDO DE / PAGADO A + MONTO ────────────────────────────── */}
        <div className="rounded p-2.5 mb-3" style={{ border: `0.5pt solid ${BORDER}` }}>
          <div className="text-[7px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
            {esCobro ? 'Recibido de' : 'Pagado a'}
          </div>
          <div className="text-[11px] font-bold" style={{ color: NAVY }}>{contraparteNombre}</div>
        </div>

        <div className="flex justify-between items-end mb-3">
          <div className="text-[9px]" style={{ color: NAVY }}>
            <div><span className="font-bold">Medio de pago:</span> {metodo || 'Efectivo'}</div>
            {referenciaPago && <div><span className="font-bold">Referencia:</span> {referenciaPago}</div>}
            {nota && <div><span className="font-bold">Nota:</span> {nota}</div>}
          </div>
          <div className="text-right">
            <div className="text-[7px] uppercase tracking-wide" style={{ color: MUTED }}>{esCobro ? 'Monto cobrado' : 'Monto pagado'}</div>
            <div className="text-[19px] font-bold" style={{ color: BLUE }}>${formatARS(monto)}</div>
          </div>
        </div>

        {/* ── COMPROBANTES IMPUTADOS ───────────────────────────────────── */}
        {imputaciones.length > 0 && (
          <div className="mb-3 rounded overflow-hidden" style={{ border: `0.5pt solid ${BORDER}` }}>
            <div className="flex px-2 py-1.5" style={{ backgroundColor: NAVY }}>
              <div className="flex-[6] text-[7.5px] font-bold uppercase tracking-wide text-white">Comprobante</div>
              <div className="flex-[2] text-[7.5px] font-bold uppercase tracking-wide text-white text-right">Aplicado</div>
            </div>
            {imputaciones.map((imp, idx) => (
              <div
                key={idx}
                className="flex px-2 py-1"
                style={{
                  borderBottom: idx < imputaciones.length - 1 ? `0.5pt solid ${BORDER}` : 'none',
                  backgroundColor: idx % 2 === 1 ? BG_ROW : 'transparent',
                }}
              >
                <div className="flex-[6] text-[8.5px]" style={{ color: NAVY }}>{imp.numero}</div>
                <div className="flex-[2] text-[8.5px] text-right" style={{ color: NAVY }}>${formatARS(imp.monto)}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── SALDOS ─────────────────────────────────────────────────────── */}
        {(saldoAnteriorTotal != null || saldoNuevoTotal != null) && (
          <div className="flex justify-end mb-3">
            <div style={{ width: '64mm' }}>
              {saldoAnteriorTotal != null && (
                <div className="flex justify-between text-[8.5px]" style={{ color: SLATE }}>
                  <span>Saldo anterior:</span>
                  <span>${formatARS(saldoAnteriorTotal)}</span>
                </div>
              )}
              {saldoNuevoTotal != null && (
                <div
                  className="flex justify-between font-bold text-[9px] mt-1 pt-1"
                  style={{ color: NAVY, borderTop: `1pt solid ${NAVY}` }}
                >
                  <span>Saldo actual:</span>
                  <span>${formatARS(saldoNuevoTotal)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── FIRMA — la imagen (si está cargada en Configuración → Empresa)
             se dibuja arriba de la línea, ambas centradas en la misma caja. ── */}
        <div className="flex mt-10" style={{ gap: '20mm' }}>
          <div className="flex-1 text-center">
            {empresa.firma && (
              <img src={empresa.firma} alt="" style={{ height: '14mm', objectFit: 'contain', margin: '0 auto 2mm' }} />
            )}
            <div className="pt-1 text-[7.5px]" style={{ borderTop: `0.75pt solid ${NAVY}`, color: MUTED }}>Firma</div>
          </div>
          <div className="flex-1 text-center">
            <div style={{ height: '14mm', marginBottom: '2mm' }} />
            <div className="pt-1 text-[7.5px]" style={{ borderTop: `0.75pt solid ${NAVY}`, color: MUTED }}>Aclaración</div>
          </div>
        </div>

        {/* ── PIE ────────────────────────────────────────────────────────── */}
        <div className="flex justify-between mt-6 pt-1.5" style={{ borderTop: `0.5pt solid ${BORDER}` }}>
          <div className="text-[6.5px]" style={{ color: MUTED }}>
            Comprobante interno — no reemplaza a la factura ni a un recibo fiscal.
          </div>
          <div className="text-[6.5px]" style={{ color: MUTED }}>
            Generado por KAIROX Gestión · {formatFechaHora(new Date().toISOString())}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReciboPago;
