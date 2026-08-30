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

// Paleta compartida — misma que RemitoPDF/FacturaPDF/CotizacionPDF/ReciboPago
// (29/08, hallazgo Luciano: "aplicar los estilos de los demás comprobantes").
// Solo aplica al formato A4 (!is80) — el térmico de 80mm sigue en
// monoespaciada blanco y negro, es lo único que una impresora de tickets
// puede imprimir bien.
const NAVY = '#0f172a';
const BLUE = '#1d4ed8';
const SLATE = '#475569';
const MUTED = '#64748b';
const BORDER = '#cbd5e1';
const BG_ROW = '#f8fafc';

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
  // 'no_aplica' = comprobante emitido por un PdV que no envía a ARCA (interno,
  // mig.293): nunca va a tener CAE, así que no corresponde decir "pendiente".
  // Si venta.cae_estado no viene informado (callers viejos), se conserva el
  // comportamiento anterior — asumir pendiente mientras la empresa facture
  // electrónicamente, para no perder el aviso en ningún flujo no actualizado.
  //
  // Hallazgo Luciano (29/08): "¿lleva CAE el Ticket a Consumidor Final?" — sí.
  // En este sistema no existe un "tique no fiscal": toda venta con la empresa
  // facturando electrónicamente se resuelve a una Factura A/B/C real
  // (determinarTipoComprobante en useAfipConfig.js) y pasa por el mismo
  // trámite de CAE vía ARCA — "Ticket"/"A4" acá son solo el FORMATO de
  // impresión, no cambian eso. Por eso "CAE pendiente" es correcto mientras
  // el arca-worker no haya vuelto (ver cron */1 min + disparo inmediato,
  // useFinalizarVentaPosterior.js) — y por eso, si la empresa NO factura
  // electrónicamente, no debe aparecer ninguna mención a CAE (ver
  // caePendiente abajo, ya lo hacía bien).
  const caeNoAplica = venta.cae_estado === 'no_aplica';
  const caePendiente = !showCAE && !caeNoAplica && empresa.usa_factura_electronica;

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
        : 'kx-print-a4 font-sans text-black bg-white'
      }
    >
      <div
        style={is80
          ? { width: '74mm', padding: '2mm' }
          : { width: '180mm', margin: '0 auto', padding: '10mm' }
        }
      >
        {is80 ? (
          <>
            {/* ── CABECERA (térmico) ─────────────────────────────────────── */}
            <div className="text-center">
              <div className="text-base font-bold">{empresa.nombre || 'Empresa'}</div>
              {empresa.afip_cuit && <div>CUIT: {empresa.afip_cuit}</div>}
              {empresa.direccion && <div>{empresa.direccion}</div>}
              {empresa.telefono && <div>Tel: {empresa.telefono}</div>}
            </div>

            <Divider is80 />

            <div>
              <div>Comprobante N°: {venta.numero_venta || venta.numero}</div>
              <div>Fecha: {formatFechaHora(venta.fecha)}</div>
              <div>Cliente: {venta.cliente_nombre || 'Consumidor Final'}</div>
            </div>

            {venta._offline && (
              <div className="text-center font-bold border border-dashed border-current py-1 my-1">
                PROVISORIO — pendiente de sincronizar
              </div>
            )}

            <Divider is80 />

            <table className="w-full border-collapse" cellPadding="0" cellSpacing="0">
              <thead>
                <tr className="font-bold">
                  <th className="text-left align-top pr-1">Cant</th>
                  <th className="text-left align-top">Descripción</th>
                  <th className="text-right align-top pl-1 whitespace-nowrap">P.Unit</th>
                  <th className="text-right align-top pl-1 whitespace-nowrap">Total</th>
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
                      <tr>
                        <td className="align-top pr-1">{displayCant}</td>
                        <td className="align-top break-words">{it.nombre || it.descripcion}</td>
                        <td className="text-right align-top pl-1 whitespace-nowrap">${formatARS(displayPunit)}</td>
                        <td className="text-right align-top pl-1 whitespace-nowrap">${formatARS(sub)}</td>
                      </tr>
                      {oferta && (
                        <tr>
                          <td colSpan={4} className="pl-2 text-[9px]">
                            &gt; {oferta.oferta_nombre}: -${formatARS(oferta.descuento_monto * cant)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            <Divider is80 />

            <div>
              {descuentoTotal > 0 ? (
                <>
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>${formatARS(subtotalBruto)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Descuentos:</span>
                    <span>-${formatARS(descuentoTotal)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>${formatARS(subtotalBruto)}</span>
                </div>
              )}
              {venta.descuento_puntos_pesos > 0 && (
                <div className="flex justify-between">
                  <span>Descuento por puntos ({venta.puntos_canjeados}):</span>
                  <span>-${formatARS(venta.descuento_puntos_pesos)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base border-t-2 border-black mt-1 pt-1">
                <span>TOTAL:</span>
                <span>${formatARS(venta.total)}</span>
              </div>
              <div className="mt-1">
                Medio de pago: {venta.forma_pago || 'Efectivo'}
              </div>
            </div>

            {venta.puntos_ganados > 0 && (
              <>
                <Divider is80 />
                <div className="text-center font-bold">
                  ¡Ganaste {venta.puntos_ganados} puntos!
                </div>
              </>
            )}

            {showCAE && (
              <>
                <Divider is80 />
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
                <Divider is80 />
                <div className="text-center italic">
                  Factura electrónica en proceso — CAE pendiente
                </div>
              </>
            )}

            <Divider is80 />
            <div className="text-center">
              <div>Gracias por su compra</div>
              <div className="text-[10px] opacity-70 mt-1">KAIROX Gestión</div>
            </div>
          </>
        ) : (
          <>
            {/* ── CABECERA (A4) — mismo lenguaje visual que Remito/Factura/
                Cotización/Recibo: header marino con datos de la empresa a la
                izquierda, datos del comprobante a la derecha. ───────────── */}
            <div className="flex items-stretch pb-3 mb-4" style={{ borderBottom: `1.5pt solid ${NAVY}` }}>
              <div className="flex-[3] pr-3" style={{ borderRight: `1pt solid ${BORDER}` }}>
                <div className="text-[15px] font-bold" style={{ color: NAVY }}>{empresa.nombre || 'Empresa'}</div>
                {empresa.afip_cuit && <div className="text-[9px] leading-relaxed" style={{ color: SLATE }}>CUIT: {empresa.afip_cuit}</div>}
                {empresa.direccion && <div className="text-[9px] leading-relaxed" style={{ color: SLATE }}>{empresa.direccion}</div>}
                {empresa.telefono && <div className="text-[9px] leading-relaxed" style={{ color: SLATE }}>Tel: {empresa.telefono}</div>}
              </div>
              <div className="flex-[3] pl-3">
                <div className="text-[8px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Comprobante</div>
                <div className="text-[13px] font-bold mb-1.5" style={{ color: BLUE }}>{venta.numero_venta || venta.numero}</div>
                <div className="text-[8px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Fecha</div>
                <div className="text-[10px] mb-1.5" style={{ color: NAVY }}>{formatFechaHora(venta.fecha)}</div>
                <div className="text-[8px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Cliente</div>
                <div className="text-[10px]" style={{ color: NAVY }}>{venta.cliente_nombre || 'Consumidor Final'}</div>
              </div>
            </div>

            {venta._offline && (
              <div
                className="text-center font-bold py-2 mb-3 rounded"
                style={{ border: `1pt dashed ${MUTED}`, color: SLATE }}
              >
                PROVISORIO — pendiente de sincronizar
              </div>
            )}

            {/* ── TABLA DE ÍTEMS ─────────────────────────────────────────── */}
            <div className="rounded overflow-hidden mb-3" style={{ border: `0.5pt solid ${BORDER}` }}>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr style={{ backgroundColor: NAVY }}>
                    <th className="py-1.5 px-2 w-16 text-[8.5px] font-bold uppercase tracking-wide text-white">Cant</th>
                    <th className="py-1.5 px-2 text-[8.5px] font-bold uppercase tracking-wide text-white">Descripción</th>
                    <th className="py-1.5 px-2 w-24 text-right text-[8.5px] font-bold uppercase tracking-wide text-white">P. Unit</th>
                    <th className="py-1.5 px-2 w-24 text-right text-[8.5px] font-bold uppercase tracking-wide text-white">Total</th>
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
                        <tr style={{ backgroundColor: idx % 2 === 1 ? BG_ROW : 'transparent', borderBottom: `0.5pt solid ${BORDER}` }}>
                          <td className="py-1.5 px-2 text-[9.5px]" style={{ color: NAVY }}>{displayCant}</td>
                          <td className="py-1.5 px-2 text-[9.5px]" style={{ color: NAVY }}>{it.nombre || it.descripcion}</td>
                          <td className="py-1.5 px-2 text-right text-[9.5px]" style={{ color: NAVY }}>${formatARS(displayPunit)}</td>
                          <td className="py-1.5 px-2 text-right text-[9.5px] font-medium" style={{ color: NAVY }}>${formatARS(sub)}</td>
                        </tr>
                        {oferta && (
                          <tr style={{ borderBottom: `0.5pt solid ${BORDER}` }}>
                            <td colSpan={3} className="py-0.5 px-2 text-[8px]" style={{ color: MUTED }}>
                              {oferta.oferta_nombre}
                            </td>
                            <td className="py-0.5 px-2 text-right text-[8px]" style={{ color: MUTED }}>
                              -${formatARS(oferta.descuento_monto * cant)}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── TOTALES ────────────────────────────────────────────────── */}
            <div className="flex justify-end mb-3">
              <div style={{ width: '70mm' }}>
                {descuentoTotal > 0 ? (
                  <>
                    <div className="flex justify-between text-[9.5px]" style={{ color: SLATE }}>
                      <span>Subtotal:</span>
                      <span>${formatARS(subtotalBruto)}</span>
                    </div>
                    <div className="flex justify-between text-[9.5px]" style={{ color: '#b91c1c' }}>
                      <span>Descuentos:</span>
                      <span>-${formatARS(descuentoTotal)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-[9.5px]" style={{ color: SLATE }}>
                    <span>Subtotal:</span>
                    <span>${formatARS(subtotalBruto)}</span>
                  </div>
                )}
                {venta.descuento_puntos_pesos > 0 && (
                  <div className="flex justify-between text-[9.5px]" style={{ color: '#b91c1c' }}>
                    <span>Descuento por puntos ({venta.puntos_canjeados}):</span>
                    <span>-${formatARS(venta.descuento_puntos_pesos)}</span>
                  </div>
                )}
                <div
                  className="flex justify-between font-bold text-[13px] mt-1.5 pt-1.5"
                  style={{ color: NAVY, borderTop: `1.5pt solid ${NAVY}` }}
                >
                  <span>TOTAL</span>
                  <span>${formatARS(venta.total)}</span>
                </div>
                <div className="text-[9px] mt-1 text-right" style={{ color: SLATE }}>
                  Medio de pago: {venta.forma_pago || 'Efectivo'}
                </div>
              </div>
            </div>

            {venta.puntos_ganados > 0 && (
              <div
                className="text-center font-bold text-[10px] py-1.5 mb-3 rounded"
                style={{ backgroundColor: '#ecfdf5', color: '#047857', border: '0.5pt solid #a7f3d0' }}
              >
                ¡Ganaste {venta.puntos_ganados} puntos!
              </div>
            )}

            {showCAE && (
              <div className="rounded p-2.5 mb-3" style={{ border: `0.5pt solid ${BORDER}`, backgroundColor: BG_ROW }}>
                <div className="text-[9.5px]" style={{ color: NAVY }}>CAE N°: {venta.cae}</div>
                {venta.cae_vencimiento && (
                  <div className="text-[9.5px]" style={{ color: NAVY }}>Vto. CAE: {new Date(venta.cae_vencimiento).toLocaleDateString('es-AR')}</div>
                )}
              </div>
            )}

            {caePendiente && (
              <div className="text-center italic text-[9px] mb-3" style={{ color: MUTED }}>
                Factura electrónica en proceso — CAE pendiente
              </div>
            )}

            {/* ── PIE ────────────────────────────────────────────────────── */}
            <div className="text-center pt-2" style={{ borderTop: `0.5pt solid ${BORDER}` }}>
              <div className="text-[9px]" style={{ color: SLATE }}>Gracias por su compra</div>
              <div className="text-[7.5px] mt-1" style={{ color: MUTED }}>KAIROX Gestión</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default TicketPrint;
