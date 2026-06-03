import React, { useState, useEffect } from 'react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { User, Loader2, TrendingUp, TrendingDown, DollarSign, Calendar, Clock, Banknote, AlertCircle, CheckCircle, UserX, UserCheck } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { getNowAR, formatDateAR, formatDateTimeAR } from '@/lib/dateUtils';
import EstadoBadge from '@/components/ui/EstadoBadge';

const ClientDetailModal = ({ open, onOpenChange, clientId, clientData, onUpdate, onToggleActivo }) => {
  const { user } = useAuth();
  const { isSessionOpen, currentSession } = useCaja();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  
  // Data State
  const [localClientData, setLocalClientData] = useState(clientData);
  const [movements, setMovements] = useState([]);
  
  // Payment Form State
  const [paymentAmount, setPaymentAmount] = useState('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  useEffect(() => {
    if (open && clientId) {
      // If we have passed clientData, use it initially, but refresh to be safe
      if (clientData) setLocalClientData(clientData);
      fetchDetails();
    } else {
      setMovements([]);
      setPaymentAmount('');
    }
  }, [open, clientId, clientData]);

  const fetchDetails = async () => {
    setLoading(true);
    try {
      // 1. Refresh Client Data (Current Balance)
      const { data: cData, error: cError } = await supabase
        .from('clientes')
        .select('*')
        .eq('id', clientId)
        .single();
      
      if (!cError && cData) setLocalClientData(cData);

      // 2. Fetch Movements History
      // We want to show sales, payments, adjustments. 
      // Current table 'cuenta_corriente_movimientos' tracks debits/credits.
      // We'll use this.
      const { data: movs, error: movsError } = await supabase
        .from('cuenta_corriente_movimientos')
        .select('*')
        .eq('cliente_id', clientId)
        .order('created_at', { ascending: false })
        .limit(50); // Reasonable limit for modal

      if (movsError) throw movsError;
      setMovements(movs || []);

    } catch (error) {
      console.error("Error loading details:", error);
      toast({ title: "Error", description: "No se pudieron cargar los detalles.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterPayment = async () => {
    if (!isSessionOpen) {
      toast({ variant: 'destructive', title: 'Caja cerrada', description: 'Debe abrir caja antes de registrar cobros' });
      return; 
    }

    const amount = parseFloat(paymentAmount);
    if (!amount || isNaN(amount) || amount <= 0) {
      toast({ title: "Monto inválido", description: "Ingrese un monto mayor a 0", variant: "destructive" });
      return;
    }

    setIsSubmittingPayment(true);
    const date = getNowAR().toISOString();

    try {
      // 1. Insert Movement in Current Account (HABER reduces debt)
      const { error: movError } = await supabase.from('cuenta_corriente_movimientos').insert([{
        user_id: user.tenant_id,
        empresa_id: user.empresa_id,
        cliente_id: clientId,
        tipo: 'HABER',
        monto: amount,
        descripcion: 'Pago registrado desde detalle',
        fecha: date
      }]);

      if (movError) throw movError;

      // 2. Insert Movement in Cash Box
      const { error: cashError } = await supabase.from('movimientos_caja').insert([{
        user_id: user.tenant_id,
        empresa_id: user.empresa_id,
        caja_sesion_id: currentSession?.id,
        fecha: date,
        tipo: 'ingreso',
        categoria: 'Cobro Cliente',
        concepto: `Cobro a ${localClientData.nombre} (Detalle)`,
        monto: amount,
        metodo_pago: 'Efectivo',
        is_automatic: true
      }]);

      if (cashError) throw cashError;

      toast({ title: "Pago registrado", description: "El saldo ha sido actualizado.", className: "bg-green-600 text-white border-none" });
      setPaymentAmount('');
      
      // Refresh Data
      await fetchDetails();
      if (onUpdate) onUpdate(); // Notify parent to refresh list

    } catch (error) {
      console.error("Error saving payment:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const hasDebt = (localClientData?.saldo_actual || 0) > 0;
  const saldo = localClientData?.saldo_actual || 0;
  const limite = localClientData?.limite_credito || 0;
  // Disponible: Logic requested -> if saldo > 0 then (limite - saldo). If saldo <= 0 (favor), disponible = limite + favor? 
  // Standard logic: Credit Limit - Used Credit (Debt). If debt is positive, subtract. If negative (favor), technically more available? 
  // Let's stick to requested logic: "Calculated as limite_crédito - saldo_actual when saldo_actual > 0"
  const disponible = saldo > 0 ? Math.max(0, limite - saldo) : limite;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl kairox-bg-card kairox-text-primary overflow-hidden flex flex-col max-h-[90vh] dark:bg-slate-950 dark:border-slate-800">
        <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
          <DialogTitle className="flex items-center gap-2 text-xl dark:text-white">
             <User className="h-6 w-6 text-blue-600 dark:text-[#00D4FF]" />
             <span>{localClientData?.nombre || 'Detalle Cuenta Corriente'}</span>
          </DialogTitle>
          <DialogDescription className="dark:text-slate-400">
            Estado de cuenta y movimientos históricos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-1 space-y-6">
           
           {/* SUMMARY CARDS */}
           <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
              {/* SALDO ACTUAL (Prominent) */}
              <div className={`p-5 rounded-xl border shadow-sm flex flex-col justify-between relative overflow-hidden ${hasDebt ? 'bg-red-50 border-red-100 dark:bg-red-900/20 dark:border-red-900/30' : 'bg-emerald-50 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-900/30'}`}>
                 <div className="relative z-10">
                    <p className={`text-sm font-semibold uppercase tracking-wider ${hasDebt ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>Saldo Actual</p>
                    <h3 className={`text-3xl font-black mt-2 ${hasDebt ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                       {saldo < 0 ? '-' : ''}${Math.abs(saldo).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </h3>
                    <div className="mt-2">
                       {hasDebt ? (
                          <Badge className="bg-red-200 text-red-800 hover:bg-red-300 border-transparent shadow-none dark:bg-red-900/50 dark:text-red-200">Con Deuda</Badge>
                       ) : (
                          <Badge className="bg-emerald-200 text-emerald-800 hover:bg-emerald-300 border-transparent shadow-none dark:bg-emerald-900/50 dark:text-emerald-200">Al Día / A Favor</Badge>
                       )}
                    </div>
                 </div>
                 <div className="absolute right-[-20px] top-[-20px] opacity-10">
                    <DollarSign className={`h-32 w-32 ${hasDebt ? 'text-red-600' : 'text-emerald-600'}`} />
                 </div>
              </div>

              {/* LÍMITE Y DISPONIBLE */}
              <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <div className="bg-white dark:bg-slate-900/50 p-5 rounded-xl border kairox-border flex flex-col justify-center dark:border-slate-800">
                    <p className="text-sm text-slate-500 font-medium uppercase tracking-wider mb-1 dark:text-slate-400">Límite de Crédito</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">
                       ${limite.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </p>
                 </div>
                 <div className="bg-white dark:bg-slate-900/50 p-5 rounded-xl border kairox-border flex flex-col justify-center dark:border-slate-800">
                    <p className="text-sm text-slate-500 font-medium uppercase tracking-wider mb-1 dark:text-slate-400">Disponible para Compras</p>
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                       ${disponible.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </p>
                 </div>
                 
                 {/* QUICK PAY FORM INLINE */}
                 <div className="col-span-1 sm:col-span-2 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border kairox-border flex items-center gap-4 dark:border-slate-800">
                    <div className="flex-1">
                       <Label htmlFor="quick-pay" className="text-xs font-bold text-slate-500 uppercase mb-1 block dark:text-slate-400">Registrar Pago Rápido</Label>
                       <div className="flex gap-2">
                          <Input 
                             id="quick-pay"
                             type="number" 
                             min="0"
                             placeholder="Monto ($)" 
                             className="h-10 bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 dark:text-white"
                             value={paymentAmount}
                             onChange={(e) => setPaymentAmount(e.target.value)}
                          />
                          <Button 
                             onClick={handleRegisterPayment}
                             disabled={isSubmittingPayment || !paymentAmount || parseFloat(paymentAmount) <= 0 || !isSessionOpen}
                             className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                          >
                             {isSubmittingPayment ? <Loader2 className="h-4 w-4 animate-spin"/> : <Banknote className="h-4 w-4 mr-2"/>}
                             Cobrar
                          </Button>
                       </div>
                       {!isSessionOpen && <p className="text-xs text-red-500 mt-1 font-medium flex items-center gap-1 dark:text-red-400"><AlertCircle className="h-3 w-3"/> Caja cerrada: no se pueden registrar cobros</p>}
                    </div>
                 </div>
              </div>
           </div>

           {/* MOVEMENTS HISTORY */}
           <div>
              <h4 className="font-semibold text-slate-700 dark:text-slate-200 text-sm mb-3 flex items-center gap-2 uppercase tracking-wider">
                 <Clock className="h-4 w-4 text-slate-400" /> Historial de Movimientos
              </h4>
              <div className="border kairox-border rounded-lg overflow-hidden bg-white dark:bg-transparent shadow-sm dark:border-slate-800">
                 <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs uppercase text-slate-500 font-semibold border-b kairox-border dark:border-slate-800 dark:text-slate-400">
                       <tr>
                          <th className="px-4 py-3 w-32">Fecha</th>
                          <th className="px-4 py-3 w-24 text-center">Tipo</th>
                          <th className="px-4 py-3">Descripción</th>
                          <th className="px-4 py-3 text-right w-32">Monto</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                       {loading ? (
                          <tr><td colSpan="4" className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-500"/></td></tr>
                       ) : movements.length === 0 ? (
                          <tr><td colSpan="4" className="p-8 text-center text-slate-500 italic flex flex-col items-center gap-2"><AlertCircle className="h-8 w-8 text-slate-200 dark:text-slate-700"/>Sin movimientos registrados</td></tr>
                       ) : (
                          movements.map((mov) => {
                             const isDebe = mov.tipo === 'DEBE'; // Sale = Debt Increase
                             return (
                                <tr key={mov.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                                   <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-xs">
                                      {formatDateTimeAR(mov.created_at || mov.fecha)}
                                   </td>
                                   <td className="px-4 py-3 text-center">
                                      <Badge variant={isDebe ? "outline" : "default"} className={`text-[10px] h-5 ${isDebe ? 'text-red-600 border-red-200 bg-red-50 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30'}`}>
                                         {isDebe ? 'VENTA / CARGO' : 'PAGO / ABONO'}
                                      </Badge>
                                   </td>
                                   <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">
                                      {mov.descripcion}
                                   </td>
                                   <td className={`px-4 py-3 text-right font-mono font-bold ${isDebe ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                      {isDebe ? '+' : '-'}${Number(mov.monto).toFixed(2)}
                                   </td>
                                </tr>
                             );
                          })
                       )}
                    </tbody>
                 </table>
              </div>
           </div>

        </div>

        <DialogFooter className="border-t border-slate-100 dark:border-slate-800 pt-4 flex-wrap gap-2">
          {onToggleActivo && localClientData && (
            <Button
              variant="outline"
              onClick={() => { onToggleActivo(localClientData); onOpenChange(false); }}
              className={localClientData.activo === false
                ? 'border-green-400 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/20'
                : 'border-amber-400 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20'
              }>
              {localClientData.activo === false
                ? <><UserCheck className="h-4 w-4 mr-2" />Reactivar cliente</>
                : <><UserX className="h-4 w-4 mr-2" />Inactivar cliente</>
              }
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} className="dark:text-white dark:border-slate-700 dark:hover:bg-slate-800">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ClientDetailModal;