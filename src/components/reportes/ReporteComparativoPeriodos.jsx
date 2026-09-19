import { useState, useEffect, useCallback, useMemo } from 'react';
import { GitCompareArrows, RefreshCw, ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { formatCurrency } from '@/lib/currencyUtils';
import { formatDateAR } from '@/lib/dateUtils';
import { useToast } from '@/components/ui/use-toast';
import { asientosService } from '@/services/planCuentasService';

// Comparativo entre Períodos Cerrados — el plan original lo pedía como
// "Comparativo Interanual", pero periodos_contables (mig.283/284, Cierre de
// Ejercicio estilo SAP) guarda períodos MENSUALES, no ejercicios anuales —
// se generaliza a "entre 2 períodos cerrados cualesquiera" en vez de asumir
// una unidad de tiempo que el schema no tiene. resultado_neto ya viene
// calculado y fijado al momento del cierre (no se recalcula acá, es el
// número oficial que quedó certificado).
function ReporteComparativoPeriodos({ onBack }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [periodosCerrados, setPeriodosCerrados] = useState(null); // null = cargando
  const [periodoAId, setPeriodoAId] = useState('');
  const [periodoBId, setPeriodoBId] = useState('');
  const [detalle, setDetalle] = useState(null); // { a: {...}, b: {...} }
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);

  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase.from('periodos_contables')
      .select('id, nombre, fecha_inicio, fecha_cierre, resultado_neto')
      .eq('empresa_id', user.empresa_id)
      .eq('estado', 'cerrado')
      .order('fecha_inicio', { ascending: false })
      .then(({ data }) => {
        const cerrados = data || [];
        setPeriodosCerrados(cerrados);
        if (cerrados.length >= 2) {
          setPeriodoAId(cerrados[0].id);
          setPeriodoBId(cerrados[1].id);
        }
      });
  }, [user?.empresa_id]);

  const fetchComparativo = useCallback(async () => {
    if (!user?.empresa_id || !periodoAId || !periodoBId) return;
    setLoading(true);
    try {
      const periodoA = periodosCerrados.find(p => p.id === periodoAId);
      const periodoB = periodosCerrados.find(p => p.id === periodoBId);

      const [balanceA, balanceB] = await Promise.all([
        asientosService.getBalanceComprobacion(user.empresa_id, periodoA.fecha_inicio, periodoA.fecha_cierre),
        asientosService.getBalanceComprobacion(user.empresa_id, periodoB.fecha_inicio, periodoB.fecha_cierre),
      ]);

      const resumir = (rows) => {
        const ingresos = rows.filter(r => r.tipo === 'ingreso').reduce((s, r) => s + (r.total_haber - r.total_debe), 0);
        const egresos = rows.filter(r => r.tipo === 'egreso').reduce((s, r) => s + (r.total_debe - r.total_haber), 0);
        return { ingresos, egresos, resultadoRecalculado: ingresos - egresos };
      };

      setDetalle({
        a: { ...periodoA, ...resumir(balanceA) },
        b: { ...periodoB, ...resumir(balanceB) },
      });
      setGenerated(true);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user?.empresa_id, periodoAId, periodoBId, periodosCerrados, toast]);

  const variacion = useMemo(() => {
    if (!detalle) return null;
    const { a, b } = detalle;
    const base = Math.abs(b.resultado_neto ?? b.resultadoRecalculado);
    if (base === 0) return null;
    const actual = a.resultado_neto ?? a.resultadoRecalculado;
    const anterior = b.resultado_neto ?? b.resultadoRecalculado;
    const pct = ((actual - anterior) / base) * 100;
    return { pct, positivo: pct >= 0 };
  }, [detalle]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="dark:text-slate-300">
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <GitCompareArrows className="h-6 w-6 text-kx-blue" />
            Comparativo entre Períodos Cerrados
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
            Cómo te fue en un período cerrado comparado con otro
          </p>
        </div>
      </div>

      {periodosCerrados === null && (
        <div className="bg-kx-surface border border-kx-border rounded-xl p-6 space-y-3">
          <Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" />
        </div>
      )}

      {periodosCerrados !== null && periodosCerrados.length < 2 && (
        <div className="text-center py-16 text-kx-text-2 bg-kx-surface border border-kx-border rounded-xl">
          <GitCompareArrows className="h-10 w-10 mx-auto mb-2 opacity-20" />
          <p className="font-medium">
            Necesitás al menos 2 períodos cerrados para comparar — hoy tenés {periodosCerrados.length}.
          </p>
          <p className="text-xs mt-1">Cerrá más períodos desde Plan de Cuentas → Cierre de Período para habilitar este reporte.</p>
        </div>
      )}

      {periodosCerrados !== null && periodosCerrados.length >= 2 && (
        <>
          <div className="bg-kx-surface p-5 rounded-xl border border-kx-border shadow-sm">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500 dark:text-kx-text-2 font-medium">Período A</Label>
                <select value={periodoAId} onChange={e => setPeriodoAId(e.target.value)}
                  className="h-9 w-56 rounded-md bg-white dark:bg-kx-surface-2 border border-slate-200 dark:border-kx-border text-sm text-kx-text px-2">
                  {periodosCerrados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500 dark:text-kx-text-2 font-medium">Período B (comparación)</Label>
                <select value={periodoBId} onChange={e => setPeriodoBId(e.target.value)}
                  className="h-9 w-56 rounded-md bg-white dark:bg-kx-surface-2 border border-slate-200 dark:border-kx-border text-sm text-kx-text px-2">
                  {periodosCerrados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <Button onClick={fetchComparativo} disabled={loading || periodoAId === periodoBId}
                className="bg-kx-blue hover:bg-blue-700 text-white h-9">
                {loading ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : <GitCompareArrows className="h-4 w-4 mr-1.5" />}
                Comparar
              </Button>
            </div>
            {periodoAId === periodoBId && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">Elegí 2 períodos distintos para comparar.</p>
            )}
          </div>

          {generated && detalle && (
            <div className="bg-kx-surface border border-kx-border rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-sm text-left">
                <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b border-kx-border text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2">
                  <tr>
                    <th className="p-4"></th>
                    <th className="p-4 text-right">{detalle.a.nombre}</th>
                    <th className="p-4 text-right">{detalle.b.nombre}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  <tr>
                    <td className="p-3 px-4 text-kx-text-2">Cierre</td>
                    <td className="p-3 px-4 text-right font-mono text-xs text-kx-text-2">{formatDateAR(detalle.a.fecha_cierre)}</td>
                    <td className="p-3 px-4 text-right font-mono text-xs text-kx-text-2">{formatDateAR(detalle.b.fecha_cierre)}</td>
                  </tr>
                  <tr>
                    <td className="p-3 px-4 text-kx-text-2">Ingresos</td>
                    <td className="p-3 px-4 text-right font-mono text-kx-green">{formatCurrency(detalle.a.ingresos)}</td>
                    <td className="p-3 px-4 text-right font-mono text-kx-green">{formatCurrency(detalle.b.ingresos)}</td>
                  </tr>
                  <tr>
                    <td className="p-3 px-4 text-kx-text-2">Egresos</td>
                    <td className="p-3 px-4 text-right font-mono text-kx-amber">{formatCurrency(detalle.a.egresos)}</td>
                    <td className="p-3 px-4 text-right font-mono text-kx-amber">{formatCurrency(detalle.b.egresos)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 dark:border-kx-border bg-kx-surface-2 dark:bg-slate-900/80 font-black">
                    <td className="p-4">Resultado Certificado al Cierre</td>
                    <td className={`p-4 text-right font-mono ${(detalle.a.resultado_neto ?? 0) >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
                      {formatCurrency(detalle.a.resultado_neto ?? detalle.a.resultadoRecalculado)}
                    </td>
                    <td className={`p-4 text-right font-mono ${(detalle.b.resultado_neto ?? 0) >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
                      {formatCurrency(detalle.b.resultado_neto ?? detalle.b.resultadoRecalculado)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              {variacion && (
                <div className={`px-4 py-3 border-t border-kx-border flex items-center gap-2 text-sm font-semibold ${variacion.positivo ? 'text-kx-green' : 'text-kx-red'}`}>
                  {variacion.positivo ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {variacion.positivo ? '+' : ''}{variacion.pct.toFixed(1)}% vs. {detalle.b.nombre}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ReporteComparativoPeriodos;
