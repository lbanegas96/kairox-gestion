import { useState, useEffect } from 'react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, X, Save, Edit2, Loader2, RefreshCw, ShieldCheck, ShieldAlert, Clock, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import ComprobantePrintModal from './ComprobantePrintModal';
import { formatDateTimeAR, formatDateAR } from '@/lib/dateUtils';
import EstadoBadge from '@/components/ui/EstadoBadge';
import { DocumentFlowPanel } from '@/components/ui/DocumentFlowPanel';

const SaleDetailModal = ({ open, onOpenChange, saleId, onUpdateSale, onNavigate }) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [sale, setSale] = useState(null);
  const [items, setItems] = useState([]);
  const [showPrintModal, setShowPrintModal] = useState(false);
  
  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [reintentandoCae, setReintentandoCae] = useState(false);

  useEffect(() => {
    if (open && saleId) {
      fetchSaleDetails();
    } else {
      setSale(null);
      setItems([]);
      setIsEditing(false);
      setNewStatus('');
    }
  }, [open, saleId]);

  const fetchSaleDetails = async () => {
    setLoading(true);
    try {
      // Fetch Sale
      const { data: saleData, error: saleError } = await supabase
        .from('comprobantes')
        .select('*, clientes(nombre)')
        .eq('id', saleId)
        .single();
      
      if (saleError) throw saleError;

      // Ensure estado_pago exists (for legacy records)
      if (!saleData.estado_pago) saleData.estado_pago = 'pagada';
      setSale(saleData);
      setNewStatus(saleData.estado_pago);

      // Fetch Items
      const { data: itemsData, error: itemsError } = await supabase
        .from('comprobante_items')
        .select('*, productos(nombre), unidad_venta:unidades_medida!unidad_venta_id(codigo, descripcion)')
        .eq('comprobante_id', saleId);
      
      if (itemsError) throw itemsError;

      const formattedItems = itemsData.map(i => ({
        ...i,
        producto_nombre: i.productos?.nombre || 'Producto Eliminado'
      }));
      setItems(formattedItems);

    } catch (error) {
      console.error("Error loading sale details:", error);
      toast({ title: "Error", description: "No se pudo cargar el detalle de la venta.", variant: "destructive" });
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (newStatus === sale?.estado_pago) return;

    setSaving(true);
    try {
      // Update the record in 'comprobantes' table as that's what we are displaying
      const { error } = await supabase
        .from('comprobantes')
        .update({ estado_pago: newStatus })
        .eq('id', saleId);

      if (error) throw error;

      toast({ title: "Actualizado", description: "Estado de pago actualizado correctamente." });
      
      setSale(prev => ({ ...prev, estado_pago: newStatus }));
      setIsEditing(false);
      
      // Refresh parent table
      if (onUpdateSale) onUpdateSale();
      
    } catch (error) {
      console.error("Error updating status:", error);
      toast({ title: "Error", description: "No se pudo actualizar el estado.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Ver HistorialVentas.jsx: llama a reintentar_cae_comprobante (mig.180), que
  // reencola la fila más reciente por id (nunca un blanket update por
  // comprobante_id) para no chocar contra uq_fpa_comprobante_activo.
  const handleReintentarCae = async () => {
    setReintentandoCae(true);
    try {
      const { error } = await supabase.rpc('reintentar_cae_comprobante', {
        p_comprobante_id: sale.id,
      });
      if (error) throw error;

      toast({ title: 'CAE reencolado', description: 'El worker reintentará la emisión en los próximos minutos.' });
      fetchSaleDetails();
      onUpdateSale?.();
    } catch (e) {
      toast({ title: 'Error al reintentar', description: e.message, variant: 'destructive' });
    } finally {
      setReintentandoCae(false);
    }
  };

  const hasChanges = sale && newStatus !== sale.estado_pago;

  if (!open) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl kairox-bg-card kairox-text-primary overflow-hidden flex flex-col max-h-[90vh] dark:bg-kx-bg dark:border-kx-border">
          <DialogHeader className="border-b border-slate-100 dark:border-kx-border pb-4">
            <DialogTitle className="flex justify-between items-center pr-8 dark:text-kx-text">
              <span className="flex items-center gap-2">
                Venta #{sale?.numero_venta || '...'}
                {loading && <Loader2 className="h-4 w-4 animate-spin text-kx-text-3" />}
              </span>
            </DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              Detalle completo de la transacción {sale && `- ${formatDateTimeAR(sale.fecha)}`}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
             <div className="flex-1 flex items-center justify-center p-12">
               <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
             </div>
          ) : sale ? (
            <div className="flex-1 overflow-y-auto p-1">
              {/* STATUS & ACTIONS CARD */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 mt-2">
                <div className="bg-kx-surface-2 dark:bg-slate-900/50 p-4 rounded-lg border kairox-border space-y-2">
                  <div className="text-xs text-slate-500 font-bold uppercase tracking-wider dark:text-kx-text-2">Cliente</div>
                  <div className="font-medium text-lg text-kx-text dark:text-kx-text">
                    {sale.cliente_nombre || 'Consumidor Final'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-kx-text-2">
                    Pago: {sale.forma_pago}
                  </div>
                </div>

                <div className="bg-kx-surface-2 dark:bg-slate-900/50 p-4 rounded-lg border kairox-border space-y-3">
                  <div className="flex justify-between items-start">
                    <div className="text-xs text-slate-500 font-bold uppercase tracking-wider dark:text-kx-text-2">Estado de Pago</div>
                    {!isEditing && (
                      <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)} className="h-6 w-6 p-0 text-kx-text-3 hover:text-blue-500">
                        <Edit2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  
                  {isEditing ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                         <select 
                           className="flex-1 h-9 rounded border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-bg text-sm px-2 focus:ring-2 focus:ring-blue-500 outline-none dark:text-kx-text"
                           value={newStatus}
                           onChange={(e) => setNewStatus(e.target.value)}
                         >
                           <option value="pagada">Pagada</option>
                           <option value="pendiente">Pendiente</option>
                           <option value="parcial">Parcial</option>
                           <option value="cancelada">Cancelada</option>
                         </select>
                         <Button size="icon" variant="ghost" onClick={() => { setIsEditing(false); setNewStatus(sale.estado_pago); }} className="h-9 w-9 text-slate-500 hover:bg-slate-200 dark:text-kx-text-2 dark:hover:bg-slate-800">
                            <X className="h-4 w-4" />
                         </Button>
                      </div>
                      
                      {hasChanges && (
                        <Button 
                           size="sm" 
                           className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2" 
                           onClick={handleUpdateStatus} 
                           disabled={saving}
                        >
                           {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                           Guardar Cambios
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div><EstadoBadge estado={sale.estado_pago} /></div>
                  )}
                </div>
              </div>

              {/* CAE / AFIP PANEL — solo si la empresa usa facturación electrónica */}
              {sale.cae_estado && sale.cae_estado !== 'no_aplica' && (
                <div className="bg-kx-surface-2 dark:bg-slate-900/50 p-4 rounded-lg border kairox-border mb-6">
                  <div className="flex justify-between items-center mb-3">
                    <div className="text-xs text-slate-500 font-bold uppercase tracking-wider dark:text-kx-text-2">
                      Facturación Electrónica AFIP
                    </div>
                    {sale.cae_estado === 'emitido' && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        <ShieldCheck className="w-3 h-3" /> CAE emitido
                      </span>
                    )}
                    {sale.cae_estado === 'pendiente' && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        <Clock className="w-3 h-3" /> CAE pendiente
                      </span>
                    )}
                    {(sale.cae_estado === 'error' || sale.cae_estado === 'error_definitivo') && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        <ShieldAlert className="w-3 h-3" />
                        {sale.cae_estado === 'error_definitivo' ? 'Error definitivo' : 'Error CAE'}
                      </span>
                    )}
                  </div>

                  {sale.cae_estado === 'emitido' && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                      {sale.cae && (
                        <div>
                          <span className="text-xs text-slate-500 dark:text-kx-text-2 block mb-0.5">Número CAE</span>
                          <span className="font-mono font-semibold text-kx-text dark:text-kx-text">{sale.cae}</span>
                        </div>
                      )}
                      {sale.cae_vencimiento && (
                        <div>
                          <span className="text-xs text-slate-500 dark:text-kx-text-2 block mb-0.5">Vencimiento</span>
                          <span className="text-kx-text dark:text-kx-text">{formatDateAR(sale.cae_vencimiento)}</span>
                        </div>
                      )}
                      {sale.tipo_comprobante_afip && (
                        <div>
                          <span className="text-xs text-slate-500 dark:text-kx-text-2 block mb-0.5">Tipo comprobante</span>
                          <span className="text-kx-text dark:text-kx-text">Factura {sale.tipo_comprobante_afip} · Nro {sale.numero_afip ?? '—'}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {sale.cae_estado === 'pendiente' && (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      El CAE será procesado automáticamente en los próximos minutos. Podés recargar la página para ver el estado actualizado.
                    </p>
                  )}

                  {(sale.cae_estado === 'error' || sale.cae_estado === 'error_definitivo') && (
                    <div className="space-y-3">
                      {sale.error_afip && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3 text-xs text-red-700 dark:text-red-400 font-mono leading-relaxed">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>{sale.error_afip}</span>
                          </div>
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 text-blue-600 border-blue-300 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-700 dark:hover:bg-blue-900/20"
                        onClick={handleReintentarCae}
                        disabled={reintentandoCae}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${reintentandoCae ? 'animate-spin' : ''}`} />
                        {reintentandoCae ? 'Reencolando...' : 'Reintentar CAE'}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* PRODUCTS TABLE */}
              <div className="border kairox-border rounded-lg overflow-hidden mb-6">
                <table className="w-full text-sm">
                  <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b kairox-border text-xs uppercase text-slate-500 font-semibold">
                    <tr>
                      <th className="px-4 py-3 text-left">Producto</th>
                      <th className="px-4 py-3 text-center">Cant</th>
                      <th className="px-4 py-3 text-right">Precio Unit</th>
                      <th className="px-4 py-3 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {items.map((item, i) => {
                      // Venta por pack (mig.189/190): si el ítem se vendió por pack, mostrar
                      // la cantidad/precio en la unidad de venta en vez de la unidad base.
                      const isPack = !!item.unidad_venta_id;
                      const displayCant = isPack ? `${item.cantidad_venta} ${item.unidad_venta?.codigo || 'pack'}` : item.cantidad;
                      const displayPunit = isPack ? item.precio_unidad_venta : item.precio_unitario;
                      return (
                      <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                        <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">{item.producto_nombre}</td>
                        <td className="px-4 py-3 text-center text-kx-text-2 dark:text-kx-text-2">{displayCant}</td>
                        <td className="px-4 py-3 text-right text-kx-text-2 dark:text-kx-text-2">${Number(displayPunit).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 text-right font-bold text-kx-text dark:text-kx-text">${Number(item.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-kx-surface-2 dark:bg-slate-900/50 border-t kairox-border font-bold">
                    <tr>
                      <td colSpan="3" className="px-4 py-4 text-right text-kx-text-2 dark:text-kx-text-2 uppercase text-xs tracking-wider">Total Final</td>
                      <td className="px-4 py-4 text-right text-xl text-blue-600 dark:text-blue-400">${Number(sale.total).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Document Flow */}
              <div className="border border-slate-100 dark:border-kx-border rounded-lg p-4 mb-2">
                <DocumentFlowPanel comprobanteId={saleId} onNavigate={onNavigate} />
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-kx-text-2">No se encontraron datos.</div>
          )}

          <DialogFooter className="border-t border-slate-100 dark:border-kx-border pt-4 flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="dark:text-kx-text dark:border-kx-border dark:hover:bg-slate-800">
              Cerrar
            </Button>
            <Button 
              className="bg-blue-600 hover:bg-blue-700 text-white" 
              onClick={() => setShowPrintModal(true)}
              disabled={!sale}
            >
              <Printer className="w-4 h-4 mr-2" /> Imprimir Comprobante
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {sale && (
         <ComprobantePrintModal 
           open={showPrintModal} 
           onOpenChange={setShowPrintModal}
           comprobante={sale}
           items={items}
         />
      )}
    </>
  );
};

export default SaleDetailModal;