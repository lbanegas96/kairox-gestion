import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, CheckCircle, Download, Loader2, Send, PackageCheck, Ban, AlertTriangle, XCircle, Pencil, History, ChevronDown, ChevronRight, Code2, Network, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { getEmpresaParaPDF } from '@/lib/empresaUtils';
import { formatDateAR } from '@/lib/dateUtils';
import { cotizacionesService } from '@/services/cotizacionesService';
import { ESTADOS } from './shared';
import MenuAccionesDocumento from '@/components/shared/documento/MenuAccionesDocumento';

// Mismos estados desde los que hoy se permite "Convertir en Venta" (TablaCotizaciones.jsx) —
// solo aprobada: una cotización enviada todavía puede rechazarse, copiarla antes generaría
// un Pedido de algo que el cliente ni confirmó.
const ESTADOS_COPIABLES = ['aprobada'];
// Mismos estados desde los que se puede Cancelar (TablaCotizaciones.jsx)
const ESTADOS_CANCELABLES = ['aprobada', 'enviada'];
// Editable mientras no esté convertida (patrón confirmado 12/08 — SAP B1 +
// mercado: editable en estados "abiertos", bloqueada una vez generó una venta
// real). El guard de verdad vive en la RPC actualizar_cotizacion; esto es solo
// para no ofrecer el botón cuando ya se sabe que va a fallar.
const ESTADOS_EDITABLES = ['borrador', 'enviada', 'aprobada', 'rechazada'];

// Campos de cabecera que vale la pena mostrar en el historial si cambiaron —
// los demás (subtotal recalculado, updated_at, etc.) son ruido derivado.
const CAMPOS_HISTORIAL = {
  estado: 'Estado', cliente_nombre: 'Cliente', condiciones_pago: 'Condiciones de pago',
  fecha_vencimiento: 'Vencimiento', moneda: 'Moneda', descuento: 'Descuento global',
  total: 'Total', notas: 'Notas',
};

function ModalDetalleCotizacion({ viewId, setViewId, detalle, onCopiarAPedido, onCancelar, onVerPedido, onCambiarEstado, onEditar, onDuplicar, discrimina, onOpenMapa }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [showHistorial, setShowHistorial] = useState(false);
  const [verCrudoId, setVerCrudoId] = useState(null);

  const { data: historial = [] } = useQuery({
    queryKey: ['cotizacion_historial', viewId],
    queryFn: () => cotizacionesService.getHistorial(viewId),
    enabled: !!viewId && showHistorial,
  });

  const handleDownloadPDF = async () => {
    if (!detalle) return;
    setGeneratingPDF(true);
    try {
      const [{ pdf }, { CotizacionPDF }, empresa] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./CotizacionPDF'),
        getEmpresaParaPDF(user.empresa_id),
      ]);
      const blob = await pdf(<CotizacionPDF cotizacion={detalle} empresa={empresa} discrimina={discrimina} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Cotizacion_${detalle.numero}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[CotizacionPDF] Error al generar:', err);
      toast({ title: 'Error al generar PDF', description: err.message, variant: 'destructive' });
    } finally {
      setGeneratingPDF(false);
    }
  };

  const handleShareWhatsApp = () => {
    if (!detalle) return;
    const clienteNombre = detalle.cliente_nombre ?? detalle.clientes?.nombre ?? 'cliente';
    const simbolo = detalle.moneda && detalle.moneda !== 'ARS' ? `${detalle.moneda} ` : '$';
    const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const lineas = [
      `Cotización ${detalle.numero}`,
      `Para: ${clienteNombre}`,
      `Total: ${simbolo}${fmt(detalle.total)}`,
      detalle.fecha_vencimiento ? `Válida hasta: ${formatDateAR(detalle.fecha_vencimiento)}` : null,
      '',
      'Adjunto el PDF con el detalle completo.',
    ].filter(Boolean);
    window.open(`https://wa.me/?text=${encodeURIComponent(lineas.join('\n'))}`, '_blank');
  };

  return (
    <Dialog open={!!viewId} onOpenChange={() => setViewId(null)}>
      {/* size="wide" — mismo shell que el resto de los documentos (hallazgo
          Luciano 22/08: antes cada uno traía su propio max-w). */}
      <DialogContent size="wide" className="dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-kx-border dark:border-kx-border">
          <DialogTitle className="dark:text-kx-text flex items-center gap-2">
            <FileText className="w-5 h-5 text-kx-blue" />
            Cotización {detalle?.numero}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">Detalle y líneas de la cotización.</DialogDescription>
        </DialogHeader>
        {detalle && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-6 py-4">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase">Cliente</span>
                <p className="font-medium dark:text-kx-text">{detalle.cliente_nombre ?? detalle.clientes?.nombre ?? '—'}</p>
              </div>
              <div>
                <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase">Estado</span>
                <p><span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${ESTADOS[detalle.estado]?.color}`}>{ESTADOS[detalle.estado]?.label}</span></p>
              </div>
              <div>
                <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase">Condiciones</span>
                <p className="dark:text-slate-300">{detalle.condiciones_pago ?? '—'}</p>
              </div>
              <div>
                <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase">Vence</span>
                <p className="dark:text-slate-300">{detalle.fecha_vencimiento ? formatDateAR(detalle.fecha_vencimiento) : '—'}</p>
              </div>
            </div>

            {/* Bug real (14/08, reportado por Luciano): este modal era el único de
                los 4 (Cotización/Pedido/OC/Entrega) sin acceso al Mapa de
                Relaciones — solo se podía abrir desde el ícono de la fila en la
                tabla, no desde el propio detalle. Reusa el mismo <MapaRelaciones>
                que ya monta CotizacionesSection para la tabla (vía onOpenMapa),
                no una instancia nueva. */}
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

            {(() => {
              const esExtranjera = detalle.moneda && detalle.moneda !== 'ARS';
              const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const monedaDisp = esExtranjera ? detalle.moneda : 'ARS';
              const simbolo = esExtranjera ? `${detalle.moneda} ` : '$';
              const items = detalle.cotizacion_items ?? [];
              // Precio de lista SIN ningún descuento (ni línea ni global) — mismo
              // criterio que ya usa CotizacionPDF.jsx. Antes acá se sumaba
              // directo item.subtotal (que ya venía con el descuento por línea
              // aplicado), así una línea con % Desc. propio y 0% global no dejaba
              // ningún rastro visible en el detalle (bug real, 13/08).
              const subtotalListaSinDescuentos = items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario), 0);
              const subtotalBruto = items.reduce((s, i) => s + Number(i.subtotal), 0);
              const descuentoTotal = subtotalListaSinDescuentos - Number(detalle.total);
              // Mismo criterio que FormNuevaCotizacion/FacturaPDF: precio_unitario ya
              // incluye IVA, se separa dividiendo por el factor de la alícuota.
              const FACTOR_IVA = { '21': 1.21, '10.5': 1.105 };
              const neto = items.reduce((s, i) => s + Number(i.subtotal) / (FACTOR_IVA[i.alicuota_iva] ?? 1), 0);
              const iva = subtotalBruto - neto;
              const factorDesc = subtotalBruto > 0 ? Number(detalle.total) / subtotalBruto : 1;
              const ALICUOTA_LABEL = { '21': '21%', '10.5': '10.5%', '0': '0%', exento: 'Exento', no_gravado: 'No gravado' };
              return (
                <table className="w-full text-sm border-collapse">
                  <thead><tr className="border-b border-kx-border dark:border-kx-border">
                    <th className="text-left py-2 text-xs text-kx-text-3">Descripción</th>
                    <th className="text-right py-2 text-xs text-kx-text-3">Cant.</th>
                    <th className="text-right py-2 text-xs text-kx-text-3">Precio ({monedaDisp})</th>
                    <th className="text-right py-2 text-xs text-kx-text-3">IVA</th>
                    <th className="text-right py-2 text-xs text-kx-text-3">Subtotal ({monedaDisp})</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {items.map(item => (
                      <tr key={item.id}>
                        <td className="py-2 dark:text-slate-300">{item.descripcion}</td>
                        <td className="py-2 text-right dark:text-slate-300">{item.cantidad} {item.unidad_medida}</td>
                        <td className="py-2 text-right dark:text-slate-300">{simbolo}{fmt(item.precio_unitario)}</td>
                        <td className="py-2 text-right text-kx-text-3 text-xs">{ALICUOTA_LABEL[item.alicuota_iva] ?? '21%'}</td>
                        <td className="py-2 text-right font-medium dark:text-kx-text">{simbolo}{fmt(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {descuentoTotal > 0.005 && (
                      <>
                        <tr>
                          <td colSpan={4} className="pt-3 text-right text-xs text-kx-text-3">Subtotal</td>
                          <td className="pt-3 text-right text-xs text-kx-text-3">{simbolo}{fmt(subtotalListaSinDescuentos)}</td>
                        </tr>
                        <tr>
                          <td colSpan={4} className="text-right text-xs text-kx-red">Descuento{detalle.descuento > 0 ? ` (incl. ${detalle.descuento}% global)` : ''}</td>
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
                      <td className="py-3 text-right font-bold text-lg dark:text-kx-text">{simbolo}{fmt(detalle.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              );
            })()}

            {detalle.notas && (
              <div className="p-3 bg-kx-surface-2 dark:bg-kx-surface rounded-lg text-sm text-kx-text-2 dark:text-kx-text-2">
                <span className="font-medium">Notas: </span>{detalle.notas}
              </div>
            )}
            {detalle.estado === 'convertida' && detalle.comprobante_id && (
              <div className="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800 text-sm text-purple-700 dark:text-purple-300">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>Esta cotización fue convertida en venta. Comprobante ID: <span className="font-mono text-xs">{detalle.comprobante_id}</span></span>
              </div>
            )}
            {(detalle.pedidos ?? []).length > 0 && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  Ya se copió a {detalle.pedidos.length === 1 ? 'pedido' : `${detalle.pedidos.length} pedidos`}:{' '}
                  {detalle.pedidos.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ', '}
                      {onVerPedido ? (
                        <button type="button" className="font-mono font-medium underline hover:opacity-80" onClick={() => onVerPedido(p.id)}>
                          {p.numero}
                        </button>
                      ) : (
                        <span className="font-mono font-medium">{p.numero}</span>
                      )}
                    </span>
                  ))}
                  . Volver a copiar generará un pedido adicional.
                </span>
              </div>
            )}

            {/* Historial de cambios — reusa audit_log (fn_audit_trigger genérica, ya
                enganchada a cotizaciones/cotizacion_items) en vez de un sistema de
                auditoría propio. Colapsado por defecto: la mayoría de las cotizaciones
                no tienen ediciones, y no vale la pena consultarlo si nadie lo abre. */}
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
        <DialogFooter className="flex-wrap gap-2 sm:justify-between shrink-0 px-6 py-4 border-t border-kx-border dark:border-kx-border">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setViewId(null)} className="dark:border-kx-border dark:text-slate-300">Cerrar</Button>
            {/* Editar/Duplicar — pedido de Luciano (23/08): disponibles pero
                no a mano del resto de las acciones, para no tocarlas por
                error. Mismo criterio en OC/Pedido/Factura de Compra. */}
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
          </div>
          <div className="flex gap-2 flex-wrap">
            {onCancelar && detalle && ESTADOS_CANCELABLES.includes(detalle.estado) && (
              <Button
                variant="outline"
                onClick={() => onCancelar(detalle.id)}
                className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Ban className="w-4 h-4 mr-2" /> Cancelar
              </Button>
            )}
            {onCambiarEstado && detalle?.estado === 'borrador' && (
              <Button
                variant="outline"
                onClick={() => onCambiarEstado(detalle.id, 'enviada')}
                className="dark:border-kx-border dark:text-slate-300"
                title="Un borrador tiene que enviarse y aprobarse antes de poder copiarse a Pedido"
              >
                <Send className="w-4 h-4 mr-2" /> Marcar como enviada
              </Button>
            )}
            {onCambiarEstado && detalle?.estado === 'enviada' && (
              <>
                <Button
                  variant="outline"
                  onClick={() => onCambiarEstado(detalle.id, 'rechazada')}
                  className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <XCircle className="w-4 h-4 mr-2" /> Rechazar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onCambiarEstado(detalle.id, 'aprobada')}
                  className="border-green-200 text-green-600 hover:bg-green-50 dark:border-green-900 dark:text-green-400 dark:hover:bg-green-900/20"
                >
                  <CheckCircle className="w-4 h-4 mr-2" /> Aprobar
                </Button>
              </>
            )}
            {onCopiarAPedido && detalle && ESTADOS_COPIABLES.includes(detalle.estado) && (
              <Button variant="outline" onClick={() => onCopiarAPedido(detalle)} className="dark:border-kx-border dark:text-slate-300">
                <PackageCheck className="w-4 h-4 mr-2" /> Copiar a Pedido
              </Button>
            )}
            <Button variant="outline" onClick={handleShareWhatsApp} className="dark:border-kx-border dark:text-slate-300">
              <Send className="w-4 h-4 mr-2" /> WhatsApp
            </Button>
            <Button onClick={handleDownloadPDF} disabled={generatingPDF} className="bg-blue-600 hover:bg-blue-700 text-white">
              {generatingPDF
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generando...</>
                : <><Download className="w-4 h-4 mr-2" /> Descargar PDF</>
              }
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Traduce una fila cruda de audit_log a algo legible — nunca pierde información
// (el toggle "ver crudo" siempre muestra old_data/new_data completos), solo
// traduce lo obvio: qué tabla, qué operación, qué campos de cabecera cambiaron.
function HistorialItem({ entry, verCrudo, onToggleCrudo }) {
  const fecha = new Date(entry.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

  const resumen = (() => {
    if (entry.tabla === 'cotizacion_items') {
      const item = entry.new_data ?? entry.old_data;
      const nombre = item?.descripcion || 'ítem';
      if (entry.operacion === 'INSERT') return `Ítem agregado: ${nombre} (x${item?.cantidad ?? '?'})`;
      if (entry.operacion === 'DELETE') return `Ítem quitado: ${nombre}`;
      return `Ítem modificado: ${nombre}`;
    }
    // Cabecera
    if (entry.operacion === 'INSERT') return 'Cotización creada';
    if (entry.operacion === 'DELETE') return 'Cotización eliminada';
    // UPDATE — listar qué campos de CAMPOS_HISTORIAL cambiaron
    const cambios = Object.entries(CAMPOS_HISTORIAL)
      .filter(([campo]) => JSON.stringify(entry.old_data?.[campo]) !== JSON.stringify(entry.new_data?.[campo]))
      .map(([campo, label]) => {
        const antes = entry.old_data?.[campo];
        const despues = entry.new_data?.[campo];
        const fmtVal = (v) => {
          if (v == null || v === '') return '—';
          if (campo === 'estado') return ESTADOS[v]?.label ?? v;
          if (campo === 'total' || campo === 'descuento') return campo === 'descuento' ? `${v}%` : `$${Number(v).toLocaleString('es-AR')}`;
          if (campo === 'fecha_vencimiento') return formatDateAR(v);
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

export default ModalDetalleCotizacion;
