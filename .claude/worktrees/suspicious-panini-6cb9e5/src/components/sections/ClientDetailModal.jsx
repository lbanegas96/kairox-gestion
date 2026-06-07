import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  User, Loader2, DollarSign, Clock, Banknote, AlertCircle,
  FileText, CheckCircle2, CreditCard, ArrowDownCircle
} from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { getNowAR } from '@/lib/dateUtils';

const PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cheque', 'Otro'];

const ClientDetailModal = ({ open, onOpenChange, clientId, clientData, onUpdate }) => {
  const { user } = useAuth();
  const { isSessionOpen, currentSession } = useCaja();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [localClientData, setLocalClientData] = useState(clientData);
  const [openItems, setOpenItems] = useState([]);       // comprobantes pendientes
  const [movements, setMovements] = useState([]);        // historial movimientos
  const [selectedIds, setSelectedIds] = useState([]);    // ítems seleccionados
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Efectivo');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('items');  // 'items' | 'historial'

  useEffect(() => {
    if (open && clientId) {
      if (clientData) setLocalClientData(clientData);
      fetchAll();
    } else {
      setOpenItems([]);
      setMovements([]);
      setSelectedIds([]);
      setPaymentAmount('');
      setPaymentMethod('Efectivo');
      setActiveTab('items');
    }
  }, [open, clientId]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [clientRes, itemsRes, movsRes] = await Promise.all([
        supabase.from('clientes').select('*').eq('id', clientId).single(),
        supabase.from('comprobantes')
          .select('*')
          .eq('cliente_id', clientId)
          .eq('forma_pago', 'Cuenta Corriente')
          .in('estado_pago', ['pendiente', 'parcial'])
          .order('fecha', { ascending: true }),
        supabase.from('cuenta_corriente_movimientos')
          .select('*')
          .eq('cliente_id', clientId)
          .order('fecha', { ascending: false })
          .limit(50)
      ]);

      if (clientRes.data) setLocalClientData(clientRes.data);
      setOpenItems(itemsRes.data || []);
      setMovements(movsRes.data || []);
    } catch (err) {
      console.error('Error loading details:', err);
      toast({ title: 'Error', description: 'No se pudieron cargar los datos.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Auto-completar monto al seleccionar ítems
  const selectedTotal = useMemo(() => {
    return openItems
      .filter(i => selectedIds.includes(i.id))
      .reduce((sum, i) => sum + Number(i.total), 0);
  }, [selectedIds, openItems]);

  useEffect(() => {
    if (selectedIds.length > 0) {
      setPaymentAmount(selectedTotal.toFixed(2));
    }
  }, [selectedTotal, selectedIds]);

  const toggleItem = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedIds.length === openItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(openItems.map(i => i.id));
    }
  };

  const needsCaja = paymentMethod === 'Efectivo';
  const canPay = !isSubmitting && parseFloat(paymentAmount) > 0 && (!needsCaja || isSessionOpen);

  const handleRegisterPayment = async () => {
    const amount = parseFloat(paymentAmount);
    if (!amount || isNaN(amount) || amount <= 0) {
      toast({ title: 'Monto inválido', description: 'Ingrese un monto mayor a 0', variant: 'destructive' });
      return;
    }
    if (needsCaja && !isSessionOpen) {
      toast({ variant: 'destructive', title: 'Caja cerrada', description: 'Abra la caja para registrar cobros en efectivo' });
      return;
    }

    setIsSubmitting(true);
    const date = getNowAR().toISOString();

    try {
      // Aplicar pago FIFO sobre los ítems seleccionados (o libre si no hay selección)
      const itemsToProcess = selectedIds.length > 0
        ? openItems.filter(i => selectedIds.includes(i.id))
        : [];

      let remaining = amount;

      for (const item of itemsToProcess) {
        if (remaining <= 0) break;
        const itemAmount = Math.min(remaining, Number(item.total));
        remaining -= itemAmount;

        // Insertar movimiento HABER referenciando el comprobante
        await supabase.from('cuenta_corriente_movimientos').insert([{
          user_id: user.id,
          empresa_id: user.empresa_id,
          cliente_id: clientId,
          comprobante_id: item.id,
          tipo: 'HABER',
          monto: itemAmount,
          metodo_cobro: paymentMethod,
          descripcion: `Cobro ${paymentMethod} - Fact. ${item.numero_venta}`,
          fecha: date
        }]);

        // Actualizar estado del comprobante
        const newEstado = itemAmount >= Number(item.total) ? 'pagada' : 'parcial';
        await supabase.from('comprobantes').update({ estado_pago: newEstado }).eq('id', item.id);
      }

      // Si quedó saldo restante o no había ítems seleccionados → pago genérico
      if (remaining > 0 || itemsToProcess.length === 0) {
        await supabase.from('cuenta_corriente_movimientos').insert([{
          user_id: user.id,
          empresa_id: user.empresa_id,
          cliente_id: clientId,
          tipo: 'HABER',
          monto: remaining > 0 ? remaining : amount,
          metodo_cobro: paymentMethod,
          descripcion: `Cobro ${paymentMethod} - Pago a cuenta`,
          fecha: date
        }]);
      }

      // Registrar en caja solo si es efectivo
      if (needsCaja && currentSession) {
        await supabase.from('movimientos_caja').insert([{
          user_id: user.id,
          empresa_id: user.empresa_id,
          caja_sesion_id: currentSession.id,
          fecha: date,
          tipo: 'ingreso',
          categoria: 'Cobro Cliente',
          concepto: `Cobro ${localClientData?.nombre} - Cta. Cte.`,
          monto: amount,
          metodo_pago: 'Efectivo',
          is_automatic: true
        }]);
      }

      toast({
        title: '¡Cobro registrado!',
        description: `$${amount.toLocaleString('es-AR')} aplicado correctamente.`,
        className: 'bg-emerald-600 text-white border-none'
      });

      setPaymentAmount('');
      setSelectedIds([]);
      await fetchAll();
      if (onUpdate) onUpdate();

    } catch (err) {
      console.error('Error registering payment:', err);
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const saldo = localClientData?.saldo_actual || 0;
  const limite = localClientData?.limite_credito || 0;
  const disponible = saldo > 0 ? Math.max(0, limite - saldo) : limite;
  const hasDebt = saldo > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl kairox-bg-card kairox-text-primary overflow-hidden flex flex-col max-h-[90vh] dark:bg-slate-950 dark:border-slate-800">
        <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
          <DialogTitle className="flex items-center gap-2 text-xl dark:text-white">
            <User className="h-6 w-6 text-blue-600 dark:text-[#00D4FF]" />
            {localClientData?.nombre || 'Detalle Cuenta Corriente'}
          </DialogTitle>
          <DialogDescription className="dark:text-slate-400">
            Gestión de ítems abiertos y compensación de pagos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">

          {/* RESUMEN */}
          <div className="grid grid-cols-3 gap-3 mt-2">
            <div className={`p-4 rounded-xl border flex flex-col relative overflow-hidden ${hasDebt ? 'bg-red-50 border-red-100 dark:bg-red-900/20 dark:border-red-900/30' : 'bg-emerald-50 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-900/30'}`}>
              <p className={`text-xs font-semibold uppercase tracking-wider ${hasDebt ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>Saldo Actual</p>
              <p className={`text-2xl font-black mt-1 ${hasDebt ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                ${Math.abs(saldo).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </p>
              <Badge className={`mt-1 w-fit text-[10px] shadow-none border-transparent ${hasDebt ? 'bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-200' : 'bg-emerald-200 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'}`}>
                {hasDebt ? 'Con Deuda' : 'Al Día'}
              </Badge>
              <DollarSign className={`absolute right-[-10px] top-[-10px] h-20 w-20 opacity-10 ${hasDebt ? 'text-red-600' : 'text-emerald-600'}`} />
            </div>
            <div className="p-4 rounded-xl border bg-white dark:bg-slate-900/50 dark:border-slate-800 flex flex-col justify-center">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1 dark:text-slate-400">Límite de Crédito</p>
              <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">${limite.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="p-4 rounded-xl border bg-white dark:bg-slate-900/50 dark:border-slate-800 flex flex-col justify-center">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1 dark:text-slate-400">Disponible</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">${disponible.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>

          {/* TABS */}
          <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setActiveTab('items')}
              className={`pb-2 px-1 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'items' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
            >
              <FileText className="inline h-4 w-4 mr-1" />
              Ítems Abiertos ({openItems.length})
            </button>
            <button
              onClick={() => setActiveTab('historial')}
              className={`pb-2 px-1 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'historial' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
            >
              <Clock className="inline h-4 w-4 mr-1" />
              Historial
            </button>
          </div>

          {/* TAB: ÍTEMS ABIERTOS */}
          {activeTab === 'items' && (
            <div className="space-y-4">
              {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
              ) : openItems.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-slate-400 gap-2">
                  <CheckCircle2 className="h-12 w-12 text-emerald-300" />
                  <p className="font-medium">Sin facturas pendientes</p>
                </div>
              ) : (
                <>
                  {/* Lista de ítems */}
                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs uppercase text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="px-4 py-3 w-10">
                            <Checkbox
                              checked={selectedIds.length === openItems.length && openItems.length > 0}
                              onCheckedChange={toggleAll}
                            />
                          </th>
                          <th className="px-4 py-3 text-left">Comprobante</th>
                          <th className="px-4 py-3 text-left">Fecha</th>
                          <th className="px-4 py-3 text-center">Estado</th>
                          <th className="px-4 py-3 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {openItems.map(item => (
                          <tr
                            key={item.id}
                            className="hover:bg-blue-50/40 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                            onClick={() => toggleItem(item.id)}
                          >
                            <td className="px-4 py-3">
                              <Checkbox
                                checked={selectedIds.includes(item.id)}
                                onCheckedChange={() => toggleItem(item.id)}
                                onClick={e => e.stopPropagation()}
                              />
                            </td>
                            <td className="px-4 py-3 font-mono font-medium text-slate-700 dark:text-slate-300">
                              {item.numero_venta}
                            </td>
                            <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                              {new Date(item.fecha).toLocaleDateString('es-AR')}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <Badge className={`text-[10px] shadow-none border-transparent ${item.estado_pago === 'parcial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                                {item.estado_pago === 'parcial' ? 'Parcial' : 'Pendiente'}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-slate-200">
                              ${Number(item.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Selección resumen */}
                  {selectedIds.length > 0 && (
                    <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/30 rounded-lg px-4 py-2 text-sm">
                      <span className="text-blue-700 dark:text-blue-300 font-medium">
                        {selectedIds.length} ítem(s) seleccionado(s)
                      </span>
                      <span className="font-bold text-blue-800 dark:text-blue-200">
                        Total: ${selectedTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                </>
              )}

              {/* FORMULARIO DE COBRO */}
              <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-4">
                <h4 className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2 text-sm uppercase tracking-wider">
                  <Banknote className="h-4 w-4" /> Registrar Cobro
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500 dark:text-slate-400">Monto a Cobrar ($)</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={paymentAmount}
                      onChange={e => setPaymentAmount(e.target.value)}
                      className="font-mono text-lg h-11 dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500 dark:text-slate-400">Método de Cobro</Label>
                    <div className="grid grid-cols-3 gap-1">
                      {PAYMENT_METHODS.map(m => (
                        <button
                          key={m}
                          onClick={() => setPaymentMethod(m)}
                          className={`text-xs py-2 px-1 rounded-md border font-medium transition-colors ${paymentMethod === m ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-400'}`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {needsCaja && !isSessionOpen && (
                  <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/30 rounded-lg px-3 py-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    Caja cerrada — para cobros en efectivo debe abrir caja primero. Puede elegir otro método de cobro.
                  </div>
                )}

                <Button
                  onClick={handleRegisterPayment}
                  disabled={!canPay}
                  className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold dark:bg-emerald-700 dark:hover:bg-emerald-600"
                >
                  {isSubmitting
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Procesando...</>
                    : <><CreditCard className="h-4 w-4 mr-2" /> Confirmar Cobro</>
                  }
                </Button>
              </div>
            </div>
          )}

          {/* TAB: HISTORIAL */}
          {activeTab === 'historial' && (
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left w-32">Fecha</th>
                    <th className="px-4 py-3 text-center w-24">Tipo</th>
                    <th className="px-4 py-3 text-left">Descripción</th>
                    <th className="px-4 py-3 text-right w-32">Monto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loading ? (
                    <tr><td colSpan="4" className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-500" /></td></tr>
                  ) : movements.length === 0 ? (
                    <tr><td colSpan="4" className="p-8 text-center text-slate-400 italic">Sin movimientos registrados</td></tr>
                  ) : movements.map(mov => {
                    const isDebe = mov.tipo === 'DEBE';
                    return (
                      <tr key={mov.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 font-mono">
                          {new Date(mov.fecha || mov.created_at).toLocaleDateString('es-AR')}
                          <div className="text-[10px] text-slate-400">{new Date(mov.fecha || mov.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge className={`text-[10px] h-5 shadow-none border-transparent ${isDebe ? 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'}`}>
                            {isDebe ? 'CARGO' : 'ABONO'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">{mov.descripcion}</td>
                        <td className={`px-4 py-3 text-right font-mono font-bold ${isDebe ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {isDebe ? '+' : '-'}${Number(mov.monto).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-slate-100 dark:border-slate-800 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="dark:text-white dark:border-slate-700 dark:hover:bg-slate-800">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ClientDetailModal;
