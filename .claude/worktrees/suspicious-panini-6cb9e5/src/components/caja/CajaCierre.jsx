import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Lock, AlertTriangle, CheckCircle2, Loader2, Save, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus } from 'lucide-react';
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

const DENOMINACIONES = [1000, 500, 200, 100, 50, 20, 10];

const CajaCierre = ({ onCancel }) => {
  const { currentSession, closeSession } = useCaja();
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [totals, setTotals] = useState({
    inicial: 0,
    ingresosEfectivo: 0,
    egresosEfectivo: 0,
    otrosIngresos: 0,
    esperado: 0
  });

  const [saldoReal, setSaldoReal] = useState('');
  const [observaciones, setObservaciones] = useState('');

  // Arqueo por denominaciones
  const [mostrarArqueo, setMostrarArqueo] = useState(false);
  const [conteo, setConteo] = useState({});

  useEffect(() => {
    const fetchSessionTotals = async () => {
      if (!currentSession || !user || !user.tenant_id) return;
      try {
        setLoading(true);
        const { data: movements, error } = await supabase
          .from('movimientos_caja')
          .select('monto, tipo, metodo_pago')
          .eq('caja_sesion_id', currentSession.id)
          .eq('user_id', user.tenant_id);

        if (error) throw error;

        let ingresosEf = 0, egresosEf = 0, otros = 0;
        movements.forEach(m => {
          const monto = Number(m.monto);
          const isEfectivo = !m.metodo_pago || m.metodo_pago.toLowerCase() === 'efectivo';
          if (m.tipo === 'ingreso') {
            if (isEfectivo) ingresosEf += monto;
            else otros += monto;
          } else if (m.tipo === 'egreso') {
            if (isEfectivo) egresosEf += monto;
          }
        });

        const inicial = Number(currentSession.monto_inicial || 0);
        const esperado = inicial + ingresosEf - egresosEf;

        setTotals({ inicial, ingresosEfectivo: ingresosEf, egresosEfectivo: egresosEf, otrosIngresos: otros, esperado });
        setSaldoReal(esperado.toString());
      } catch (err) {
        console.error('Error fetching session details:', err);
        toast({ title: 'Error', description: 'No se pudieron calcular los totales.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    fetchSessionTotals();
  }, [currentSession, user, toast]);

  // Sincroniza saldo real con el total del arqueo
  const totalArqueo = DENOMINACIONES.reduce((sum, d) => sum + d * (parseInt(conteo[d] || 0)), 0);

  useEffect(() => {
    if (mostrarArqueo) setSaldoReal(totalArqueo.toFixed(2));
  }, [totalArqueo, mostrarArqueo]);

  const updateConteo = (denominacion, valor) => {
    const qty = Math.max(0, parseInt(valor) || 0);
    setConteo(prev => ({ ...prev, [denominacion]: qty || '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saldoReal === '') return;
    setIsSubmitting(true);
    const real = parseFloat(saldoReal);
    const diff = real - totals.esperado;

    // Incluir resumen de arqueo en observaciones si se usó
    let obs = observaciones;
    if (mostrarArqueo) {
      const resumenArqueo = DENOMINACIONES
        .filter(d => parseInt(conteo[d] || 0) > 0)
        .map(d => `$${d}×${conteo[d]}=$${d * parseInt(conteo[d])}`)
        .join(' | ');
      if (resumenArqueo) obs = `[Arqueo: ${resumenArqueo}]\n${obs}`.trim();
    }

    const success = await closeSession(real, obs, totals.esperado, diff);
    if (success && onCancel) onCancel();
    setIsSubmitting(false);
  };

  const diferencia = parseFloat(saldoReal || 0) - totals.esperado;
  const isPerfect = Math.abs(diferencia) < 0.01;
  const esSobrante = diferencia > 0.01;
  const esFaltante = diferencia < -0.01;

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>;
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
        <CardContent className="px-0 space-y-5">
          {/* Resumen calculado */}
          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 space-y-3 border border-slate-200 dark:border-slate-800">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Saldo Inicial</span>
              <span className="font-mono font-medium">${totals.inicial.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Ingresos Efectivo</span>
              <span className="font-mono font-medium text-emerald-600">+${totals.ingresosEfectivo.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Egresos Efectivo</span>
              <span className="font-mono font-medium text-red-500">-${totals.egresosEfectivo.toFixed(2)}</span>
            </div>
            <Separator className="bg-slate-300 dark:bg-slate-700" />
            <div className="flex justify-between items-center pt-1">
              <span className="font-bold text-slate-700 dark:text-slate-200">Saldo Esperado</span>
              <span className="font-mono font-bold text-lg">${totals.esperado.toFixed(2)}</span>
            </div>
            {totals.otrosIngresos > 0 && (
              <div className="text-xs text-slate-400 pt-1 border-t border-dashed border-slate-200 dark:border-slate-800">
                * Otros medios (Tarjeta/Transf): ${totals.otrosIngresos.toFixed(2)}
              </div>
            )}
          </div>

          {/* Arqueo por denominaciones (colapsable) */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setMostrarArqueo(!mostrarArqueo)}
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <span className="flex items-center gap-2">
                🪙 Contar efectivo por denominación
                {mostrarArqueo && totalArqueo > 0 && (
                  <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full font-mono">
                    ${totalArqueo.toLocaleString('es-AR')}
                  </span>
                )}
              </span>
              {mostrarArqueo ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {mostrarArqueo && (
              <div className="p-4 space-y-2 dark:bg-slate-900/30">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  Ingresá la cantidad de billetes/monedas de cada denominación. El total se calcula automáticamente.
                </p>
                {DENOMINACIONES.map(d => {
                  const subtotal = d * (parseInt(conteo[d] || 0));
                  return (
                    <div key={d} className="grid grid-cols-12 gap-2 items-center">
                      <span className="col-span-3 text-sm font-mono text-right text-slate-600 dark:text-slate-400">
                        ${d.toLocaleString('es-AR')}
                      </span>
                      <span className="col-span-1 text-center text-slate-400">×</span>
                      <Input
                        type="number"
                        min="0"
                        value={conteo[d] || ''}
                        onChange={e => updateConteo(d, e.target.value)}
                        className="col-span-3 h-8 text-center font-mono text-sm dark:bg-slate-800 dark:border-slate-700"
                        placeholder="0"
                      />
                      <span className="col-span-1 text-center text-slate-400">=</span>
                      <span className={`col-span-4 text-sm font-mono text-right ${subtotal > 0 ? 'text-slate-800 dark:text-slate-200 font-medium' : 'text-slate-300 dark:text-slate-600'}`}>
                        ${subtotal.toLocaleString('es-AR')}
                      </span>
                    </div>
                  );
                })}
                <Separator className="my-2" />
                <div className="flex justify-between font-bold text-base">
                  <span className="text-slate-700 dark:text-slate-200">Total contado:</span>
                  <span className="font-mono text-blue-600 dark:text-blue-400">${totalArqueo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            )}
          </div>

          {/* Saldo real + diferencia */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="saldoReal" className="text-base">
                Saldo Real (Efectivo)
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span>
                <Input
                  id="saldoReal"
                  type="number"
                  step="0.01"
                  min="0"
                  value={saldoReal}
                  onChange={e => { setSaldoReal(e.target.value); if (mostrarArqueo) setMostrarArqueo(false); }}
                  className="pl-8 h-12 text-lg font-bold font-mono"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-base">Diferencia</Label>
              <div className={`h-12 flex items-center justify-between px-3 rounded-md border text-base font-bold font-mono ${
                isPerfect
                  ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
                  : esSobrante
                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800'
                  : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
              }`}>
                <span className="flex items-center gap-1 text-xs font-normal">
                  {isPerfect
                    ? <><CheckCircle2 className="h-3.5 w-3.5" /> Cuadre exacto</>
                    : esSobrante
                    ? <><TrendingUp className="h-3.5 w-3.5" /> Sobrante</>
                    : <><TrendingDown className="h-3.5 w-3.5" /> Faltante</>
                  }
                </span>
                <span className="text-lg">
                  {isPerfect ? '—' : `${esSobrante ? '+' : ''}${diferencia.toFixed(2)}`}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Observaciones</Label>
            <Textarea
              placeholder="Anotaciones sobre diferencias o incidencias del turno..."
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              className="resize-none dark:bg-slate-900 dark:border-slate-700"
            />
          </div>
        </CardContent>

        <CardFooter className="px-0 flex justify-between gap-4">
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1">Cancelar</Button>
          <Button type="submit" disabled={isSubmitting} className="flex-1 bg-red-600 hover:bg-red-700 text-white">
            {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Confirmar Cierre
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default CajaCierre;
