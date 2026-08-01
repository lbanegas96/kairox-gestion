import { useState, useEffect, useRef } from 'react';

import { Lock, AlertTriangle, CheckCircle2, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useCaja } from '@/contexts/CajaContext';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { useArqueoCaja } from '@/hooks/useArqueoCaja';

const CajaCierre = ({ onCancel }) => {
  const { closeSession } = useCaja();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { totals, loading } = useArqueoCaja();

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form
  const [saldoReal, setSaldoReal] = useState('');
  const [observaciones, setObservaciones] = useState('');

  // Pre-cargar el saldo real con el esperado, por comodidad. Sólo una vez:
  // si el usuario ya escribió algo, un refetch no debe pisárselo.
  const prefilled = useRef(false);
  useEffect(() => {
    if (loading || prefilled.current) return;
    prefilled.current = true;
    setSaldoReal(totals.esperado.toString());
  }, [loading, totals.esperado]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saldoReal === '') return;

    const real = parseNumberLocale(saldoReal);
    if (isNaN(real) || real < 0) {
      toast({
        title: 'Saldo inválido',
        description: 'Usá formato argentino: punto para miles y coma para decimales (ej: 500.000,00).',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    const diff = real - totals.esperado;
    
    const success = await closeSession(real, observaciones, totals.esperado, diff);
    if (success) {
      // La notif caja_sin_cerrar consulta cierre_fecha: invalidar para que desaparezca ya.
      qc.invalidateQueries({ queryKey: ['notif'] });
      if (onCancel) onCancel(); // Actually closes modal
    }
    setIsSubmitting(false);
  };

  const realParsed = parseNumberLocale(saldoReal);
  const diferencia = ((isNaN(realParsed) ? 0 : realParsed) - totals.esperado);
  const isPerfect = Math.abs(diferencia) < 0.01;
  const isSobrante = diferencia > 0.01;
  const isFaltante = diferencia < -0.01;

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-500"/></div>;
  }

  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="px-0 pt-0">
        <CardTitle className="flex items-center gap-2">
           <Lock className="w-5 h-5 text-red-600 dark:text-red-400" /> Arqueo y Cierre de Caja
        </CardTitle>
        <CardDescription>
           Verifica el efectivo físico y compáralo con el saldo esperado por el sistema.
        </CardDescription>
      </CardHeader>
      
      <form onSubmit={handleSubmit}>
        <CardContent className="px-0 space-y-6">
           {/* Resumen Calculado */}
           <div className="bg-kx-surface-2 dark:bg-kx-surface rounded-lg p-4 space-y-3 border border-kx-border dark:border-kx-border">
              <div className="flex justify-between text-sm">
                <span className="text-kx-text-2">Saldo Inicial</span>
                <span className="font-mono font-medium">${totals.inicial.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Ingresos Efectivo</span>
                <span className="font-mono font-medium text-emerald-600">+${totals.ingresosEfectivo.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-red-600 dark:text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> Egresos Efectivo</span>
                <span className="font-mono font-medium text-red-600 dark:text-red-400">-${totals.egresosEfectivo.toFixed(2)}</span>
              </div>
              <Separator className="bg-slate-300 dark:bg-slate-700"/>
              <div className="flex justify-between items-center pt-1">
                <span className="font-bold text-slate-700 dark:text-kx-text">Saldo Esperado en Caja</span>
                <span className="font-mono font-bold text-lg">${totals.esperado.toFixed(2)}</span>
              </div>
              
              {totals.otrosIngresos > 0 && (
                <div className="text-xs text-kx-text-3 pt-2 border-t border-dashed border-kx-border dark:border-kx-border mt-2">
                  * Otros medios de pago (Tarjetas/Transf): ${totals.otrosIngresos.toFixed(2)}
                </div>
              )}
           </div>

           {/* Input Real */}
           <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="saldoReal" className="text-base">Saldo Real (Efectivo)</Label>
                <div className="relative">
                   <span className="absolute left-3 top-1/2 -translate-y-1/2 text-kx-text-2 font-bold">$</span>
                   <Input
                      id="saldoReal"
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={saldoReal}
                      onChange={e => setSaldoReal(e.target.value)}
                      className="pl-8 h-12 text-lg font-bold font-mono"
                      required
                   />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="text-base">Diferencia (Arqueo)</Label>
                <div className={`h-12 flex items-center justify-between px-4 rounded-md border text-lg font-bold font-mono ${
                  isPerfect
                    ? 'bg-green-50 text-green-600 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
                    : isSobrante
                    ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800'
                    : 'bg-red-50 text-red-700 border-red-300 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
                }`}>
                  <span>{diferencia > 0 ? '+' : ''}{diferencia.toFixed(2)}</span>
                  <span className="text-xs font-normal">
                    {isPerfect ? '✓ Cuadra' : isSobrante ? '↑ Sobrante' : '↓ Faltante'}
                  </span>
                </div>
                {!isPerfect && (
                  <p className="text-xs text-slate-500 dark:text-kx-text-2">
                    {isFaltante
                      ? `Faltan $${Math.abs(diferencia).toFixed(2)} en caja. Registrá la observación.`
                      : `Hay $${diferencia.toFixed(2)} de más. Verificá los movimientos.`}
                  </p>
                )}
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