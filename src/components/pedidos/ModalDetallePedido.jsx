import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Check, Truck, ArrowRight, Receipt, Network, Pencil, History, ChevronDown, ChevronRight, Code2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import MenuAccionesDocumento from '@/components/shared/documento/MenuAccionesDocumento';
import { formatDateAR } from '@/lib/dateUtils';
import { formatCurrency } from '@/lib/currencyUtils';
import { supabase } from '@/lib/customSupabaseClient';
import DocumentFlow from '@/components/shared/DocumentFlow';
import MapaRelaciones from '@/components/shared/MapaRelaciones';
import { getEstado, EstadoBadge } from './shared';

// Mismo criterio que CotizacionesSection.jsx/CotizacionPDF.jsx: precio_unitario
// ya incluye IVA, se separa dividiendo por el factor de la alícuota.
const FACTOR_IVA = { '21': 1.21, '10.5': 1.105 };
const ALICUOTA_LABEL = { '21': '21%', '10.5': '10.5%', '0': '0%', exento: 'Exento', no_gravado: 'No gravado' };
const ESTADOS_EDITABLES = ['borrador'];

// Historial de cambios — reusa audit_log (fn_audit_trigger genérica, mig.320
// enganchó pedido_items; pedidos ya estaba enganchada desde mig.017), mismo
// patrón que cotizacionesService.getHistorial().
async function getHistorialPedido(pedidoId) {
  const [cabeceraRes, itemsRes] = await Promise.all([
    supabase.from('audit_log').select('id, tabla, operacion, old_data, new_data, user_id, created_at')
      .eq('tabla', 'pedidos').eq('registro_id', pedidoId),
    supabase.from('audit_log').select('id, tabla, operacion, old_data, new_data, user_id, created_at')
      .eq('tabla', 'pedido_items')
      .or(`old_data->>pedido_id.eq.${pedidoId},new_data->>pedido_id.eq.${pedidoId}`),
  ]);
  if (cabeceraRes.error) throw new Error(cabeceraRes.error.message);
  if (itemsRes.error) throw new Error(itemsRes.error.message);
  return [...(cabeceraRes.data ?? []), ...(itemsRes.data ?? [])]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

const CAMPOS_HISTORIAL = {
  estado: 'Estado', cliente_nombre: 'Cliente', fecha_entrega: 'Fecha de entrega',
  referencia_cliente: 'N° Referencia', moneda: 'Moneda', descuento_global_pct: 'Descuento global',
  total: 'Total', notas: 'Notas',
};

function ModalDetallePedido({
  isDetailOpen, setIsDetailOpen,
  detailPedido, setDetailPedido,
  entregasDetalle,
  loadingEntregas,
  onNavigate,
  handleAbrirGenerarEntrega,
  handleFacturarPedido,
  handleAvanzar,
  onEditar,
  onDuplicar,
  discrimina,
}) {
  const [mapaOpen, setMapaOpen] = useState(false);
  const [showHistorial, setShowHistorial] = useState(false);
  const [verCrudoId, setVerCrudoId] = useState(null);

  const { data: historial = [] } = useQuery({
    queryKey: ['pedido_historial', detailPedido?.id],
    queryFn: () => getHistorialPedido(detailPedido.id),
    enabled: !!detailPedido?.id && showHistorial,
  });

  return (
    <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
      {/* size="wide" — mismo shell que el resto de los documentos (hallazgo
          Luciano 22/08: antes cada uno traía su propio max-w). */}
      <DialogContent size="wide" className="dark:bg-kx-bg dark:border-kx-border">
        {detailPedido && (() => {
          const e          = getEstado(detailPedido.estado);
          const items      = detailPedido.pedido_items || [];
          const totalPed   = items.reduce((s, i) => s + Number(i.cantidad || 0), 0);
          const totalEnt   = items.reduce((s, i) => s + Number(i.cantidad_entregada || 0), 0);
          const estaCompleto = totalPed > 0 && totalEnt >= totalPed;
          const estaParcial  = totalEnt > 0 && totalEnt < totalPed;
          // 'facturado' incluido a propósito (Frente 4, Factura de Reserva) —
          // mismo criterio que TablaPedidos.jsx, ver comentario ahí.
          const puedeEntrega = ['confirmado', 'en_preparacion', 'facturado'].includes(detailPedido.estado) && totalEnt < totalPed;

          const entregaConFactura = entregasDetalle.find(ent => ent.comprobante_id);
          const flowChips = [
            ...(detailPedido.cotizacion_id ? [{
              tipo: 'cotizacion',
              id: detailPedido.cotizacion_id,
              numero: detailPedido.cotizaciones?.numero,
              active: false,
            }] : []),
            { tipo: 'pedido', id: detailPedido.id, numero: detailPedido.numero, active: true },
            ...entregasDetalle.map(ent => ({
              tipo: 'entrega',
              id: ent.id,
              numero: ent.numero_entrega,
              active: false,
            })),
            ...(entregaConFactura ? [{
              tipo: 'factura',
              id: entregaConFactura.comprobante_id,
              numero: entregaConFactura.comprobantes?.numero_venta,
              active: false,
            }] : []),
          ];

          return (
            <>
              <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-kx-border dark:border-kx-border">
                <DialogTitle className="flex items-center gap-2 dark:text-kx-text">
                  <FileText className="h-5 w-5 text-kx-blue" />
                  Pedido {detailPedido.numero}
                </DialogTitle>
                <DialogDescription className="dark:text-kx-text-2">
                  Detalle completo del pedido
                </DialogDescription>
              </DialogHeader>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-6 py-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-kx-text-2">Estado</span>
                  <div className="flex items-center gap-2">
                    <EstadoBadge estado={detailPedido.estado} />
                  </div>
                </div>

                {totalPed > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-kx-text-2">Entrega</span>
                    {estaCompleto ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-semibold">
                        <Check className="h-3 w-3" /> Completo ({totalEnt}/{totalPed} u.)
                      </span>
                    ) : estaParcial ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-semibold">
                        Parcial {totalEnt}/{totalPed} u.
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-kx-surface-2 dark:text-kx-text-2">
                        Sin entregar
                      </span>
                    )}
                  </div>
                )}

                <div className="flex justify-between items-center">
                  <span className="text-sm text-kx-text-2">Cliente</span>
                  <span className="font-medium dark:text-kx-text">{detailPedido.cliente_nombre}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-kx-text-2">Fecha</span>
                  <span className="text-sm dark:text-slate-300">{formatDateAR(detailPedido.fecha)}</span>
                </div>
                {detailPedido.fecha_entrega && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-kx-text-2">Fecha entrega</span>
                    <span className="text-sm dark:text-slate-300">{formatDateAR(detailPedido.fecha_entrega)}</span>
                  </div>
                )}
                {detailPedido.referencia_cliente && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-kx-text-2">N° Referencia del Cliente</span>
                    <span className="text-sm dark:text-slate-300">{detailPedido.referencia_cliente}</span>
                  </div>
                )}
                {detailPedido.notas && (
                  <div className="bg-kx-surface-2 dark:bg-kx-surface rounded-lg p-3 text-sm text-kx-text-2 dark:text-kx-text-2">
                    {detailPedido.notas}
                  </div>
                )}

                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <p className="text-2xs font-semibold text-kx-text-3 dark:text-kx-text-3 uppercase tracking-wider">
                      Flujo del documento
                    </p>
                    <button
                      type="button"
                      onClick={() => setMapaOpen(true)}
                      className="text-2xs text-kx-violet hover:opacity-80 font-medium flex items-center gap-1"
                      title="Ver mapa de relaciones completo"
                    >
                      <Network className="w-3 h-3" /> Mapa de relaciones
                    </button>
                  </div>
                  {loadingEntregas ? (
                    <div className="h-5 bg-slate-100 dark:bg-kx-surface-2 rounded-full animate-pulse w-40" />
                  ) : (
                    <DocumentFlow chips={flowChips} onNavigate={(tipo, id) => {
                      if (tipo === 'pedido') return;
                      setDetailPedido(null);
                      onNavigate?.(tipo, id);
                    }} />
                  )}
                </div>

                <MapaRelaciones
                  open={mapaOpen}
                  onOpenChange={setMapaOpen}
                  pedidoId={detailPedido.id}
                  onNavigate={(tipo, id) => { setMapaOpen(false); setDetailPedido(null); onNavigate?.(tipo, id); }}
                />

                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-kx-border dark:border-kx-border">
                      <th className="text-left pb-2 text-kx-text-2">Descripción</th>
                      <th className="text-center pb-2 text-kx-text-2 w-14">Pedido</th>
                      <th className="text-center pb-2 text-kx-text-2 w-14">Entregado</th>
                      <th className="text-right pb-2 text-kx-text-2 w-16">IVA</th>
                      <th className="text-right pb-2 text-kx-text-2">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => {
                      const ent = Number(it.cantidad_entregada || 0);
                      const ped = Number(it.cantidad || 0);
                      const completo = ent >= ped && ped > 0;
                      return (
                        <tr key={it.id} className="border-b border-slate-100 dark:border-slate-800/50">
                          <td className="py-2 dark:text-kx-text">{it.descripcion}</td>
                          <td className="py-2 text-center text-kx-text-2">{ped}</td>
                          <td className={`py-2 text-center font-medium ${completo ? 'text-green-600 dark:text-green-400' : ent > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-kx-text-3'}`}>
                            {ent}
                          </td>
                          <td className="py-2 text-right text-kx-text-3 text-xs">{ALICUOTA_LABEL[it.alicuota_iva] ?? '21%'}</td>
                          <td className="py-2 text-right font-mono dark:text-kx-text">
                            {/* Bug real encontrado 14/08 probando el Plan de Nadia: esta columna
                                usaba cantidad_entregada × precio (el monto YA entregado, que ya
                                tiene su propio renglón "Total entregado" más abajo) en vez del
                                subtotal real de la línea — un pedido recién creado, sin nada
                                entregado, mostraba $0,00 en TODAS las filas. Mismo criterio que
                                ModalDetalleOC.jsx (Compras), que sí usa item.subtotal directo. */}
                            {formatCurrency(Number(it.subtotal || 0), detailPedido.moneda ?? 'ARS')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {(() => {
                    const subtotalListaSinDescuentos = items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario), 0);
                    const subtotalBruto = items.reduce((s, i) => s + Number(i.subtotal), 0);
                    const descuentoTotal = subtotalListaSinDescuentos - Number(detailPedido.total);
                    const neto = items.reduce((s, i) => s + Number(i.subtotal) / (FACTOR_IVA[i.alicuota_iva] ?? 1), 0);
                    const iva = subtotalBruto - neto;
                    const factorDesc = subtotalBruto > 0 ? Number(detailPedido.total) / subtotalBruto : 1;
                    const simbolo = detailPedido.moneda && detailPedido.moneda !== 'ARS' ? `${detailPedido.moneda} ` : '$';
                    const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    return (
                      <tfoot>
                        {descuentoTotal > 0.005 && (
                          <>
                            <tr>
                              <td colSpan={4} className="pt-3 text-right text-xs text-kx-text-3">Subtotal</td>
                              <td className="pt-3 text-right text-xs text-kx-text-3">{simbolo}{fmt(subtotalListaSinDescuentos)}</td>
                            </tr>
                            <tr>
                              <td colSpan={4} className="text-right text-xs text-kx-red">Descuento{detailPedido.descuento_global_pct > 0 ? ` (incl. ${detailPedido.descuento_global_pct}% global)` : ''}</td>
                              <td className="text-right text-xs text-kx-red">-{simbolo}{fmt(descuentoTotal)}</td>
                            </tr>
                          </>
                        )}
                        {discrimina && (
                          <>
                            <tr>
                              <td colSpan={4} className="pt-1 text-right text-xs text-kx-text-3">Neto gravado</td>
                              <td className="pt-1 text-right text-xs text-kx-text-3">{simbolo}{fmt(neto * factorDesc)}</td>
                            </tr>
                            <tr>
                              <td colSpan={4} className="text-right text-xs text-kx-text-3">IVA</td>
                              <td className="text-right text-xs text-kx-text-3">{simbolo}{fmt(iva * factorDesc)}</td>
                            </tr>
                          </>
                        )}
                        <tr className="border-t-2 border-kx-border dark:border-kx-border">
                          <td colSpan={4} className="py-3 text-right font-bold dark:text-kx-text">TOTAL</td>
                          <td className="py-3 text-right font-bold text-lg dark:text-kx-text">{simbolo}{fmt(detailPedido.total)}</td>
                        </tr>
                      </tfoot>
                    );
                  })()}
                </table>
                <div className="text-right text-sm text-kx-text-2">
                  Total entregado: <span className="font-mono font-semibold dark:text-kx-text">{formatCurrency(items.reduce((s, it) => s + (Number(it.cantidad_entregada || 0) * Number(it.precio_unitario || 0)), 0), detailPedido.moneda ?? 'ARS')}</span>
                </div>

                {/* Historial de cambios — mismo patrón que ModalDetalleCotizacion.jsx,
                    colapsado por defecto. */}
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

              {/* Acciones fijas al pie — el documento recién creado queda abierto
                  y el paso siguiente de la cadena (confirmar → entregar → facturar)
                  tiene que estar siempre a la vista, sin scrollear por debajo del
                  historial. Cerrar es decisión del usuario. */}
              <DialogFooter className="shrink-0 flex-wrap gap-2 sm:justify-between border-t border-kx-border dark:border-kx-border px-6 py-4">
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => setIsDetailOpen(false)} className="dark:border-kx-border dark:text-slate-300">
                    Cerrar
                  </Button>
                  {/* Editar/Duplicar — pedido de Luciano (23/08): disponibles
                      pero no a mano del resto de las acciones. */}
                  <MenuAccionesDocumento
                    acciones={[
                      onEditar && ESTADOS_EDITABLES.includes(detailPedido.estado) && {
                        label: 'Editar Pedido', icon: Pencil, onClick: () => onEditar(detailPedido),
                      },
                      onDuplicar && {
                        label: 'Duplicar', icon: Copy, onClick: () => onDuplicar(detailPedido),
                      },
                    ]}
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {puedeEntrega && (
                    <Button
                      variant="outline"
                      className="border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300"
                      onClick={() => handleAbrirGenerarEntrega(detailPedido)}
                    >
                      <Truck className="h-4 w-4 mr-2" />
                      Generar Entrega
                    </Button>
                  )}

                  {e.next && (
                    e.next === 'facturado' ? (
                      <Button
                        className="bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => handleFacturarPedido(detailPedido)}
                      >
                        <Receipt className="h-4 w-4 mr-2" />
                        Facturar Pedido
                      </Button>
                    ) : (
                      <Button
                        className="bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => handleAvanzar(detailPedido)}
                      >
                        <ArrowRight className="h-4 w-4 mr-2" />
                        Avanzar a {getEstado(e.next).label}
                      </Button>
                    )
                  )}
                </div>
              </DialogFooter>
            </>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}

// Traduce una fila cruda de audit_log a algo legible — mismo patrón que
// HistorialItem en ModalDetalleCotizacion.jsx, adaptado a pedidos/pedido_items.
function HistorialItem({ entry, verCrudo, onToggleCrudo }) {
  const fecha = new Date(entry.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

  const resumen = (() => {
    if (entry.tabla === 'pedido_items') {
      const item = entry.new_data ?? entry.old_data;
      const nombre = item?.descripcion || 'ítem';
      if (entry.operacion === 'INSERT') return `Ítem agregado: ${nombre} (x${item?.cantidad ?? '?'})`;
      if (entry.operacion === 'DELETE') return `Ítem quitado: ${nombre}`;
      return `Ítem modificado: ${nombre}`;
    }
    if (entry.operacion === 'INSERT') return 'Pedido creado';
    if (entry.operacion === 'DELETE') return 'Pedido eliminado';
    const cambios = Object.entries(CAMPOS_HISTORIAL)
      .filter(([campo]) => JSON.stringify(entry.old_data?.[campo]) !== JSON.stringify(entry.new_data?.[campo]))
      .map(([campo, label]) => {
        const antes = entry.old_data?.[campo];
        const despues = entry.new_data?.[campo];
        const fmtVal = (v) => {
          if (v == null || v === '') return '—';
          if (campo === 'estado') return getEstado(v)?.label ?? v;
          if (campo === 'total') return `$${Number(v).toLocaleString('es-AR')}`;
          if (campo === 'descuento_global_pct') return `${v}%`;
          if (campo === 'fecha_entrega') return formatDateAR(v);
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

export default ModalDetallePedido;
