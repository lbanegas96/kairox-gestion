import { useState, useEffect } from 'react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, X, Save, Edit2, Loader2, FileText, User, Clock } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import EstadoBadge from '@/components/ui/EstadoBadge';
import { formatDateAR } from '@/lib/dateUtils';

const CompraDetailModal = ({ open, onOpenChange, compraId, onUpdateCompra }) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [compra, setCompra] = useState(null);
  const [items, setItems] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && compraId) {
      fetchCompraDetails();
    } else {
      setCompra(null);
      setItems([]);
      setIsEditing(false);
      setNewStatus('');
    }
  }, [open, compraId]);

  const fetchCompraDetails = async () => {
    setLoading(true);
    try {
      // Fetch Header
      const { data: compraData, error: compraError } = await supabase
        .from('compras')
        .select('*, proveedores(nombre)')
        .eq('id', compraId)
        .single();
      
      if (compraError) throw compraError;

      // Ensure defaults
      if (!compraData.estado_pago) compraData.estado_pago = 'pendiente';
      setCompra(compraData);
      setNewStatus(compraData.estado_pago);

      // Fetch Items
      const { data: itemsData, error: itemsError } = await supabase
        .from('detalle_compras')
        .select('*, productos(nombre, codigo_sku, unidad_medida)')
        .eq('compra_id', compraId);
      
      if (itemsError) throw itemsError;

      setItems(itemsData || []);

    } catch (error) {
      console.error("Error loading purchase details:", error);
      toast({ title: "Error", description: "No se pudo cargar el detalle de la compra.", variant: "destructive" });
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (newStatus === compra?.estado_pago) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('compras')
        .update({ estado_pago: newStatus })
        .eq('id', compraId);

      if (error) throw error;

      toast({ title: "Actualizado", description: "Estado de pago actualizado correctamente." });
      setCompra(prev => ({ ...prev, estado_pago: newStatus }));
      setIsEditing(false);
      if (onUpdateCompra) onUpdateCompra();
      
    } catch (error) {
      console.error("Error updating status:", error);
      toast({ title: "Error", description: "No se pudo actualizar el estado.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = compra && newStatus !== compra.estado_pago;

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl kairox-bg-card kairox-text-primary overflow-hidden flex flex-col max-h-[90vh] dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader className="border-b border-slate-100 dark:border-kx-border pb-4">
          <DialogTitle className="flex justify-between items-center pr-8 dark:text-kx-text">
            <span className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600 dark:text-[#00D4FF]" />
              Compra #{compra?.numero_factura || 'S/N'}
              {loading && <Loader2 className="h-4 w-4 animate-spin text-kx-text-3" />}
            </span>
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            Detalle de la compra al proveedor {compra?.proveedores?.nombre}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
           <div className="flex-1 flex items-center justify-center p-12">
             <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
           </div>
        ) : compra ? (
          <div className="flex-1 overflow-y-auto p-1">
            {/* INFO CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 mt-2">
              <div className="bg-kx-surface-2 dark:bg-slate-900/50 p-4 rounded-lg border kairox-border space-y-3 dark:border-kx-border">
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-kx-text-2">
                  <User className="h-4 w-4" /> Proveedor
                </div>
                <div className="font-medium text-lg text-kx-text dark:text-kx-text">
                  {compra.proveedores?.nombre || 'Desconocido'}
                </div>
                <div className="flex gap-4 text-xs text-slate-500 border-t border-kx-border dark:border-kx-border pt-2 dark:text-kx-text-2">
                   <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDateAR(compra.fecha)}</div>
                   <div className="font-mono">Ref: {compra.numero_factura}</div>
                </div>
              </div>

              <div className="bg-kx-surface-2 dark:bg-slate-900/50 p-4 rounded-lg border kairox-border space-y-3 dark:border-kx-border">
                <div className="flex justify-between items-start">
                   <div className="text-sm text-slate-500 flex items-center gap-2 dark:text-kx-text-2">Estado de Pago</div>
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
                         <Button size="icon" variant="ghost" onClick={() => { setIsEditing(false); setNewStatus(compra.estado_pago); }} className="h-9 w-9 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800">
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
                    <div><EstadoBadge estado={compra.estado_pago} /></div>
                )}
              </div>
            </div>

            {/* PRODUCTS TABLE */}
            <div className="border kairox-border rounded-lg overflow-hidden mb-6 dark:border-kx-border">
              <table className="w-full text-sm">
                <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b kairox-border text-xs uppercase text-slate-500 font-semibold dark:border-kx-border dark:text-kx-text-2">
                  <tr>
                    <th className="px-4 py-3 text-left">Producto</th>
                    <th className="px-4 py-3 text-center">Cant</th>
                    <th className="px-4 py-3 text-right">Costo Unit.</th>
                    <th className="px-4 py-3 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((item, i) => (
                    <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-700 dark:text-slate-300">{item.productos?.nombre || 'Producto Eliminado'}</div>
                        <div className="text-xs text-kx-text-3 font-mono">{item.productos?.codigo_sku}</div>
                      </td>
                      <td className="px-4 py-3 text-center text-kx-text-2 dark:text-kx-text-2">{item.cantidad}</td>
                      <td className="px-4 py-3 text-right text-kx-text-2 dark:text-kx-text-2">${Number(item.costo_unitario).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-bold text-kx-text dark:text-kx-text">${Number(item.subtotal).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-kx-surface-2 dark:bg-slate-900/50 border-t kairox-border font-bold dark:border-kx-border">
                  <tr>
                    <td colSpan="3" className="px-4 py-4 text-right text-kx-text-2 dark:text-kx-text-2 uppercase text-xs tracking-wider">Total Final</td>
                    <td className="px-4 py-4 text-right text-xl text-blue-600 dark:text-blue-400">${Number(compra.total).toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-500">No se encontraron datos.</div>
        )}

        <DialogFooter className="border-t border-slate-100 dark:border-kx-border pt-4 flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="dark:text-kx-text dark:border-kx-border dark:hover:bg-slate-800">
            Cerrar
          </Button>
          <Button 
            className="bg-blue-600 hover:bg-blue-700 text-white" 
            onClick={() => window.print()} // Simple print for now
            disabled={!compra}
          >
            <Printer className="w-4 h-4 mr-2" /> Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CompraDetailModal;