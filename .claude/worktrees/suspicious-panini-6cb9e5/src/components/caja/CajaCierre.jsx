import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Lock, Calculator, AlertTriangle, CheckCircle2, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useCaja } from '@/contexts/CajaContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';

const CajaCierre = ({ onCancel }) => {
  const { currentSession, closeSession } = useCaja();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Totals
  const [totals, setTotals] = useState({
    inicial: 0,
    ingresosEfectivo: 0,
    egresosEfectivo: 0,
    otrosIngresos: 0, // Cards, transfers, etc.
    esperado: 0
  });

  // Form
  const [saldoReal, setSaldoReal] = useState('');
  const [observaciones, setObservaciones] = useState('');

  useEffect(() => {
    const fetchSessionTotals = async () => {
      // CRITICAL FIX: Guard clause for tenant_id
      if (!currentSession || !user || !user.tenant_id) return;
      
      try {
        setLoading(true);
        // Fetch movements for this session
        const { data: movements, error } = await supabase
          .from('movimientos_caja')
          .select('monto, tipo, metodo_pago')
          .eq('caja_sesion_id', currentSession.id)
          .eq('user_id', user.tenant_id);

        if (error) throw error;

        let ingresosEf = 0;
        let egresosEf = 0;
        let otros = 0;

        movements.forEach(m => {
          const monto = Number(m.monto);
          // Normalize payment method check (case insensitive or defaulting)
          const isEfectivo = !m.metodo_pago || m.metodo_pago.toLowerCase() === 'efectivo';
          
          if (m.tipo === 'ingreso') {
            if (isEfectivo) ingresosEf += monto;
            else otros += monto;
          } else if (m.tipo === 'egreso') {
            // Expenses are usually cash, but could be bank
            if (isEfectivo) egresosEf += monto;
            // We usually don't subtract non-cash expenses from cash drawer balance
          }
        });

        const inicial = Number(currentSession.monto_inicial || 0);
        const esperado = inicial + ingresosEf - egresosEf;

        setTotals({
          inicial,
          ingresosEfectivo: ingresosEf,
          egresosEfectivo: egresosEf,
          otrosIngresos: otros,
          esperado
        });
        
        // Pre-fill real balance with expected for convenience
        setSaldoReal(esperado.toString());

      } catch (err) {
        console.error("Error fetching session details:", err);
        toast({ title: "Error", description: "No se pudieron calcular los totales.", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };

    fetchSessionTotals();
  }, [currentSession, user, toast]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saldoReal === '') return;
    
    setIsSubmitting(true);
    const real = parseFloat(saldoReal);
    const diff = real - totals.esperado;
    
    const success = await closeSession(real, observaciones, totals.esperado, diff);
    if (success && onCancel) onCancel(); // Actually closes modal
    setIsSubmitting(false);
  };

  const diferencia = (parseFloat(saldoReal || 0) - totals.esperado);
  const isPerfect = Math.abs(diferencia) < 0.01;

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-blue-500"/></div>;
  }

  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="px-0 pt-0">
        <CardTitle className="flex items-center gap-2">
           <Lock className="w-5 h-5 text-red-500" /> Arqueo y Cierre de Caja
        </CardTitle>
        <CardDescription>
           Verifica el efectivo físico y compáralo con el saldo esperado por el sistema.
        </CardDescription>
      </CardHeader>
      
      <form onSubmit={handleSubmit}>
        <CardContent className="px-0 space-y-6">
           {/* Resumen Calculado */}
           <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 space-y-3 border border-slate-200 dark:border-slate-800">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Saldo Inicial</span>
                <span className="font-mono font-medium">${totals.inicial.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Ingresos Efectivo</span>
                <span className="font-mono font-medium text-emerald-600">+${totals.ingresosEfectivo.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> Egresos Efectivo</span>
                <span className="font-mono font-medium text-red-500">-${totals.egresosEfectivo.toFixed(2)}</span>
              </div>
              <Separator className="bg-slate-300 dark:bg-slate-700"/>
              <div className="flex justify-between items-center pt-1">
                <span className="font-bold text-slate-700 dark:text-slate-200">Saldo Esperado en Caja</span>
                <span className="font-mono font-bold text-lg">${totals.esperado.toFixed(2)}</span>
              </div>
              
              {totals.otrosIngresos > 0 && (
                <div className="text-xs text-slate-400 pt-2 border-t border-dashed border-slate-200 dark:border-slate-800 mt-2">
                  * Otros medios de pago (Tarjetas/Transf): ${totals.otrosIngresos.toFixed(2)}
                </div>
              )}
           </div>

           {/* Input Real */}
           <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="saldoReal" className="text-base">Saldo Real (Efectivo)</Label>
                <div className="relative">
                   <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span>
                   <Input 
                      id="saldoReal"
                      type="number"
                      step="0.01"
                      min="0"
                      value={saldoReal}
                      onChange={e => setSaldoReal(e.target.value)}
                      className="pl-8 h-12 text-lg font-bold font-mono"
                      required
                   />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="text-base">Diferencia</Label>
                <div className={`h-12 flex items-center px-4 rounded-md border text-lg font-bold font-mono ${isPerfect ? 'bg-green-50 text-green-600 border-green-200' : diferencia > 0 ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                   {diferencia > 0 ? '+' : ''}{diferencia.toFixed(2)}
                </div>
              </div>
           </div>

           <div className="space-y-2">
              <Label>Observaciones</Label>
              <Textarea 
                placeholder="Anotaciones sobre diferencias o incidencias del turno..."
                value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                className="resize-none"
              />
           </div>
        </CardContent>

        <CardFooter className="px-0 flex justify-between gap-4">
           <Button type="button" variant="outline" onClick={onCancel} className="flex-1">Cancelar</Button>
           <Button type="submit" disabled={isSubmitting} className="flex-1 bg-red-600 hover:bg-red-700 text-white">
              {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Save className="w-4 h-4 mr-2"/>}
              Confirmar Cierre
           </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default CajaCierre;