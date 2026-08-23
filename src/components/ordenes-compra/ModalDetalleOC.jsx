import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShoppingBag, Truck, Receipt, AlertTriangle, BadgeCheck, Banknote, RotateCcw, Pencil, History, ChevronDown, ChevronRight, Code2, Network, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import MenuAccionesDocumento from '@/components/shared/documento/MenuAccionesDocumento';
import { formatCurrency } from '@/lib/currencyUtils';
import { formatDateAR } from '@/lib/dateUtils';
import { ordenesCompraService } from '@/services/ordenesCompraService';
import { ESTADOS, FACTURA_ESTADO_COLORS } from './shared';

// Mismo criterio que Cotizaciones/Pedidos: precio_unitario/costo_unitario ya
// incluye IVA, se separa dividiendo por el factor de la alícuota.
const FACTOR_IVA = { '21': 1.21, '10.5': 1.105 };
const ALICUOTA_LABEL = { '21': '21%', '10.5': '10.5%', '0': '0%', exento: 'Exento', no_gravado: 'No gravado' };
// Editable mientras no haya Recepción generada — mismo criterio que la RPC
// actualizar_orden_compra (mig.322).
const ESTADOS_EDITABLES = ['borrador', 'enviada'];

const CAMPOS_HISTORIAL = {
  proveedor_nombre: 'Proveedor', forma_pago: 'Forma de pago', fecha_entrega_esperada: 'Entrega esperada',
  moneda: 'Moneda', descuento_global_pct: 'Descuento global', total: 'Total', notas: 'Notas', estado: 'Estado',
};

function ModalDetalleOC({
  detalleId, setDetalleId,
  detalle, facturas = [],
  setDevolverOC, setGenRecepId,
  abrirModalFactura,
  onEditar,
  onDuplicar,
  onOpenMapa,
}) {
  const [showHistorial, setShowHistorial] = useState(false);
  const [verCrudoId, setVerCrudoId] = useState(null);

  const { data: historial = [] } = useQuery({
    queryKey: ['orden_compra_historial', detalleId],
    queryFn: () => ordenesCompraService.getHistorial(detalleId),
    enabled: !!detalleId && showHistorial,
  });

  return (
    <Dialog open={!!detalleId} onOpenChange={() => setDetalleId(null)}>
      {/* size="wide" — mismo shell que el resto de los documentos con grilla de
          ítems (hallazgo Luciano 22/08, antes max-w-4xl propio). */}
      <DialogContent size="wide" className="dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-kx-border dark:border-kx-border">
          <DialogTitle className="dark:text-kx-text flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-indigo-600 dark:text-indigo-500" />
            Orden de Compra {detalle?.numero}
          </DialogTitle>
        </DialogHeader>
        {detalle && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs text-kx-text-3 uppercase mb-1">Proveedor</p>
                <p className="font-medium dark:text-kx-text">{detalle.proveedor_nombre ?? detalle.proveedores?.nombre ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-kx-text-3 uppercase mb-1">Estado</p>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${ESTADOS[detalle.estado]?.color}`}>
                  {ESTADOS[detalle.estado]?.label}
                </span>
              </div>
              <div>
                <p className="text-xs text-kx-text-3 uppercase mb-1">Forma de pago</p>
                <p className="dark:text-slate-300">{detalle.forma_pago}</p>
              </div>
              <div>
                <p className="text-xs text-kx-text-3 uppercase mb-1">Entrega esperada</p>
                <p className="dark:text-slate-300">{detalle.fecha_entrega_esperada ? formatDateAR(detalle.fecha_entrega_esperada) : '—'}</p>
              </div>
            </div>

            {/* Bug real (14/08, reportado por Luciano): igual que Cotización, este
                detalle no tenía acceso al Mapa de Relaciones. Ni siquiera había un
                MapaRelaciones montado en OrdenesCompraSection — se agrega acá.
                Reusa el mismo componente que ya usan Recepciones/Facturas de Compra. */}
            {onOpenMapa && (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => onOpenMapa(detalle.id)}
                  className="text-2xs text-kx-violet hover:opacity-80 font-medium flex items-center gap-1"
                  title="Ver mapa de relaciones completo"
                >
                  <Network className="w-3 h-3" /> Mapa de relaciones
                </button>
              </div>
            )}

            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-kx-border dark:border-kx-border">
                  <th className="text-left py-2 text-xs text-kx-text-3">Producto</th>
                  <th className="text-right py-2 text-xs text-kx-text-3">Pedido</th>
                  <th className="text-right py-2 text-xs text-kx-text-3">Recibido</th>
                  <th className="text-right py-2 text-xs text-kx-text-3">IVA</th>
                  <th className="text-right py-2 text-xs text-kx-text-3">Costo unit.</th>
                  <th className="text-right py-2 text-xs text-kx-text-3">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(detalle.ordenes_compra_items ?? []).map(item => {
                  const progreso = item.cantidad_pedida > 0 ? (item.cantidad_recibida / item.cantidad_pedida) * 100 : 0;
                  return (
                    <tr key={item.id}>
                      <td className="py-2 dark:text-slate-300">{item.descripcion}</td>
                      <td className="py-2 text-right dark:text-slate-300">{item.cantidad_pedida} {item.unidad_medida}</td>
                      <td className="py-2 text-right">
                        <span className={`font-medium ${item.cantidad_recibida >= item.cantidad_pedida ? 'text-green-600 dark:text-green-400' : item.cantidad_recibida > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-kx-text-3'}`}>
                          {item.cantidad_recibida}
                        </span>
                        <div className="w-16 h-1 bg-slate-200 dark:bg-slate-700 rounded-full mt-1 ml-auto">
                          <div className={`h-1 rounded-full ${progreso >= 100 ? 'bg-green-500' : 'bg-yellow-500'}`} style={{ width: `${Math.min(progreso, 100)}%` }} />
                        </div>
                      </td>
                      <td className="py-2 text-right text-kx-text-3 text-xs">{ALICUOTA_LABEL[item.alicuota_iva] ?? '21%'}</td>
                      <td className="py-2 text-right dark:text-slate-300">{formatCurrency(item.costo_unitario, detalle.moneda ?? 'ARS')}</td>
                      <td className="py-2 text-right font-medium dark:text-kx-text">{formatCurrency(item.subtotal, detalle.moneda ?? 'ARS')}</td>
                    </tr>
                  );
                })}
              </tbody>
              {(() => {
                const items = detalle.ordenes_compra_items ?? [];
                const subtotalListaSinDescuentos = items.reduce((s, i) => s + Number(i.cantidad_pedida) * Number(i.costo_unitario), 0);
                const subtotalBruto = items.reduce((s, i) => s + Number(i.subtotal), 0);
                const descuentoTotal = subtotalListaSinDescuentos - Number(detalle.total);
                const neto = items.reduce((s, i) => s + Number(i.subtotal) / (FACTOR_IVA[i.alicuota_iva] ?? 1), 0);
                const iva = subtotalBruto - neto;
                const factorDesc = subtotalBruto > 0 ? Number(detalle.total) / subtotalBruto : 1;
                const simbolo = detalle.moneda && detalle.moneda !== 'ARS' ? `${detalle.moneda} ` : '$';
                const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return (
                  <tfoot>
                    {descuentoTotal > 0.005 && (
                      <>
                        <tr>
                          <td colSpan={5} className="pt-3 text-right text-xs text-kx-text-3">Subtotal</td>
                          <td className="pt-3 text-right text-xs text-kx-text-3">{simbolo}{fmt(subtotalListaSinDescuentos)}</td>
                        </tr>
                        <tr>
                          <td colSpan={5} className="text-right text-xs text-kx-red">Descuento{detalle.descuento_global_pct > 0 ? ` (incl. ${detalle.descuento_global_pct}% global)` : ''}</td>
                          <td className="text-right text-xs text-kx-red">-{simbolo}{fmt(descuentoTotal)}</td>
                        </tr>
                      </>
                    )}
                    {/* Neto/IVA siempre visible en Compras — como comprador RI siempre
                        importa el IVA Crédito Fiscal, sin condicionarlo a ninguna letra
                        (mismo criterio que ya usa NuevaFacturaProveedorModal.jsx). */}
                    <tr>
                      <td colSpan={5} className="pt-1 text-right text-xs text-kx-text-3">Neto gravado</td>
                      <td className="pt-1 text-right text-xs text-kx-text-3">{simbolo}{fmt(neto * factorDesc)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="text-right text-xs text-kx-text-3">IVA</td>
                      <td className="text-right text-xs text-kx-text-3">{simbolo}{fmt(iva * factorDesc)}</td>
                    </tr>
                    <tr className="border-t-2 border-kx-border dark:border-kx-border">
                      <td colSpan={5} className="py-3 text-right font-bold dark:text-kx-text">TOTAL {detalle.moneda && detalle.moneda !== 'ARS' && <span className="text-xs font-normal text-kx-text-3 ml-1">({detalle.moneda} — tasa {detalle.tipo_cambio_tasa})</span>}</td>
                      <td className="py-3 text-right font-bold text-lg dark:text-kx-text">{formatCurrency(detalle.total, detalle.moneda ?? 'ARS')}</td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>

            {detalle.notas && (
              <div className="p-3 bg-kx-surface-2 dark:bg-kx-surface rounded-lg text-sm text-kx-text-2 dark:text-kx-text-2">
                <span className="font-medium">Notas: </span>{detalle.notas}
              </div>
            )}

            {/* ── 3-Way Match ── */}
            {(() => {
              const totalOC = Number(detalle.total);
              const totalRecibido = (detalle.ordenes_compra_items ?? [])
                .reduce((s, i) => s + Number(i.cantidad_recibida) * Number(i.costo_unitario), 0);
              // mig.332 — puede haber varias facturas parciales: el total a
              // comparar es la suma de todas, no una sola.
              // Bug real (21/08): no neteaba las Notas de Crédito de Proveedor
              // emitidas contra esas facturas — ver getFacturas() en
              // ordenesCompraService.ts, que ahora trae nc_total por factura.
              const totalFactura = facturas.length > 0
                ? facturas.reduce((s, f) => s + Number(f.monto_total) - Number(f.nc_total || 0), 0)
                : null;
              const diff = totalFactura !== null ? Math.abs(totalFactura - totalRecibido) : null;
              const matchOk = diff !== null && diff < 0.01;
              const matchWarn = diff !== null && !matchOk && diff / (totalRecibido || 1) < 0.05;

              return (
                <div className="border border-kx-border dark:border-kx-border rounded-lg p-4 space-y-3">
                  <p className="text-xs font-semibold text-kx-text-2 uppercase flex items-center gap-2">
                    <Receipt className="w-3.5 h-3.5" /> 3-Way Match
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 rounded bg-kx-surface-2 dark:bg-kx-surface">
                      <p className="text-xs text-kx-text-3 mb-1">Total OC</p>
                      <p className="font-bold text-sm dark:text-kx-text">{formatCurrency(totalOC, detalle.moneda ?? 'ARS')}</p>
                    </div>
                    <div className="p-2 rounded bg-kx-surface-2 dark:bg-kx-surface">
                      <p className="text-xs text-kx-text-3 mb-1">Recibido</p>
                      <p className={`font-bold text-sm ${totalRecibido >= totalOC ? 'text-green-600 dark:text-green-400' : totalRecibido > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-kx-text-3'}`}>
                        {formatCurrency(totalRecibido, detalle.moneda ?? 'ARS')}
                      </p>
                    </div>
                    <div className="p-2 rounded bg-kx-surface-2 dark:bg-kx-surface">
                      <p className="text-xs text-kx-text-3 mb-1">Factura</p>
                      {totalFactura !== null ? (
                        <p className={`font-bold text-sm ${matchOk ? 'text-green-600 dark:text-green-400' : matchWarn ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500'}`}>
                          {formatCurrency(totalFactura, detalle.moneda ?? 'ARS')}
                        </p>
                      ) : (
                        <p className="text-xs text-kx-text-3 italic">Sin factura</p>
                      )}
                    </div>
                  </div>

                  {totalFactura !== null && (
                    <div className={`p-2 rounded text-xs flex items-center gap-2 ${matchOk ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : matchWarn ? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                      {matchOk ? <BadgeCheck className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
                      {matchOk
                        ? 'Match perfecto — OC, recepción y factura coinciden.'
                        : `Diferencia de $${diff.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} entre recibido y factura.`}
                    </div>
                  )}

                  {/* mig.332 — lista todas las facturas parciales registradas (antes, una
                      sola factura ocultaba el botón para siempre; ahora sigue disponible
                      mientras quede algo pendiente de facturar). */}
                  {facturas.length > 0 && (
                    <div className="space-y-1.5">
                      {facturas.map(f => (
                        <div key={f.id} className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-kx-text-2">
                            <span className={`px-2 py-0.5 rounded font-medium ${FACTURA_ESTADO_COLORS[f.estado]}`}>
                              {f.estado.charAt(0).toUpperCase() + f.estado.slice(1)}
                            </span>
                            <span>N° {f.numero_factura}</span>
                            <span className="tabular-nums">{formatCurrency(Number(f.monto_total), detalle.moneda ?? 'ARS')}</span>
                            {Number(f.nc_total) > 0 && (
                              <span className="tabular-nums text-kx-red" title="Notas de crédito de proveedor activas contra esta factura">
                                NC -{formatCurrency(Number(f.nc_total), detalle.moneda ?? 'ARS')}
                              </span>
                            )}
                          </div>
                          {f.estado === 'pendiente' && (
                            <span className="flex items-center gap-1 text-xs text-kx-text-3">
                              <Banknote className="w-3.5 h-3.5" /> Pagala desde Proveedores → Cuenta Corriente
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {['recibida_parcial', 'recibida'].includes(detalle.estado) && (
                    <Button size="sm" variant="outline" className="w-full gap-2 text-xs"
                      onClick={abrirModalFactura}>
                      <Receipt className="w-3.5 h-3.5" /> Registrar Factura del Proveedor
                    </Button>
                  )}
                </div>
              );
            })()}

            {/* Historial de cambios — mismo patrón que Cotizaciones/Pedidos, colapsado
                por defecto. */}
            <div className="border border-kx-border dark:border-kx-border rounded-lg">
              <button
                type="button"
                onClick={() => setShowHistorial(v => !v)}
                className="w-full flex items-center justify-between p-3 text-sm font-medium text-kx-text-2 dark:text-kx-text-2 hover:bg-kx-surface-2 dark:hover:bg-slate-800/50 rounded-lg"
              >
                <span className="flex items-center gap-2"><History className="w-4 h-4" /> Historial de cambios</span>
                {showHistorial ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              {showHistorial && (
                <div className="p-3 pt-0 space-y-2 text-xs">
                  {historial.length === 0 && (
                    <p className="text-kx-text-3 py-2">Sin cambios registrados todavía.</p>
                  )}
                  {historial.map(entry => (
                    <HistorialItem key={`${entry.tabla}-${entry.id}`} entry={entry}
                      verCrudo={verCrudoId === `${entry.tabla}-${entry.id}`}
                      onToggleCrudo={() => setVerCrudoId(v => v === `${entry.tabla}-${entry.id}` ? null : `${entry.tabla}-${entry.id}`)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 flex-wrap px-6 py-4 shrink-0 border-t border-kx-border dark:border-kx-border">
          {/* Editar/Duplicar — pedido de Luciano (23/08): disponibles pero
              no a mano del resto de las acciones. */}
          <MenuAccionesDocumento
            acciones={[
              onEditar && detalle && ESTADOS_EDITABLES.includes(detalle.estado) && {
                label: 'Editar', icon: Pencil, onClick: () => onEditar(detalle),
              },
              onDuplicar && detalle && {
                label: 'Duplicar', icon: Copy, onClick: () => onDuplicar(detalle),
              },
            ]}
          />
          {/* mig.332 — 'facturada' incluido a propósito: devolver mercadería
              sigue siendo válido aunque ya esté 100% facturada. */}
          {detalle && ['recibida', 'recibida_parcial', 'facturada'].includes(detalle.estado) && (
            <Button variant="outline" className="gap-2 text-orange-600 border-orange-200 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-900/20"
              onClick={() => { setDetalleId(null); setDevolverOC(detalle); }}>
              <RotateCcw className="w-4 h-4" /> Devolver
            </Button>
          )}
          {detalle && ['enviada', 'recibida_parcial'].includes(detalle.estado) && (
            <Button className="bg-green-600 hover:bg-green-700 text-white gap-2"
              onClick={() => { setDetalleId(null); setGenRecepId(detalle.id); }}>
              <Truck className="w-4 h-4" /> Registrar Recepción
            </Button>
          )}
          <Button variant="outline" onClick={() => setDetalleId(null)} className="dark:border-kx-border dark:text-slate-300">Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Traduce una fila cruda de audit_log a algo legible — mismo patrón que
// HistorialItem en ModalDetalleCotizacion.jsx/ModalDetallePedido.jsx.
function HistorialItem({ entry, verCrudo, onToggleCrudo }) {
  const fecha = new Date(entry.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

  const resumen = (() => {
    if (entry.tabla === 'ordenes_compra_items') {
      const item = entry.new_data ?? entry.old_data;
      const nombre = item?.descripcion || 'ítem';
      if (entry.operacion === 'INSERT') return `Ítem agregado: ${nombre} (x${item?.cantidad_pedida ?? '?'})`;
      if (entry.operacion === 'DELETE') return `Ítem quitado: ${nombre}`;
      return `Ítem modificado: ${nombre}`;
    }
    if (entry.operacion === 'INSERT') return 'Orden de compra creada';
    if (entry.operacion === 'DELETE') return 'Orden de compra eliminada';
    const cambios = Object.entries(CAMPOS_HISTORIAL)
      .filter(([campo]) => JSON.stringify(entry.old_data?.[campo]) !== JSON.stringify(entry.new_data?.[campo]))
      .map(([campo, label]) => {
        const antes = entry.old_data?.[campo];
        const despues = entry.new_data?.[campo];
        const fmtVal = (v) => {
          if (v == null || v === '') return '—';
          if (campo === 'estado') return ESTADOS[v]?.label ?? v;
          if (campo === 'total') return `$${Number(v).toLocaleString('es-AR')}`;
          if (campo === 'descuento_global_pct') return `${v}%`;
          if (campo === 'fecha_entrega_esperada') return formatDateAR(v);
          return String(v);
        };
        return `${label}: ${fmtVal(antes)} → ${fmtVal(despues)}`;
      });
    return cambios.length > 0 ? cambios.join(' · ') : 'Cambio sin campos relevantes visibles';
  })();

  return (
    <div className="border-b border-kx-border dark:border-kx-border last:border-0 pb-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-kx-text-2 dark:text-kx-text-2">{resumen}</span>
        <span className="text-kx-text-3 whitespace-nowrap">{fecha}</span>
      </div>
      <button type="button" onClick={onToggleCrudo} className="text-kx-text-3 hover:text-kx-text flex items-center gap-1 mt-0.5">
        <Code2 className="w-3 h-3" /> {verCrudo ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}
      </button>
      {verCrudo && (
        <pre className="mt-1 p-2 bg-kx-surface-2 dark:bg-slate-900 rounded text-[10px] overflow-x-auto text-kx-text-2">
          {JSON.stringify({ old: entry.old_data, new: entry.new_data }, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default ModalDetalleOC;
