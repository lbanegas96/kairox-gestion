import { useState, useCallback, useMemo, useEffect } from 'react';
import { Columns, Calendar, RefreshCw, ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { getTodayAR } from '@/lib/dateUtils';
import { formatCurrency } from '@/lib/currencyUtils';
import { useToast } from '@/components/ui/use-toast';
import { asientosService } from '@/services/planCuentasService';

// Estado de Resultados de TODOS los Centros de Costo lado a lado — reusa
// asientosService.getBalanceComprobacion (misma fuente que TabEstadoResultados.jsx
// en Plan de Cuentas) una vez por CC, no reinventa el cálculo de Ingresos/Egresos.
// Columnas dinámicas (una por CC + una "Sin CC" si aplica) -- por eso vive como
// reporte standalone y no dentro del array genérico de reportDefinitions.jsx,
// que asume un set de columnas fijo por reportId.
function ReporteEstadoResultadosCC({ onBack }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const todayStr = getTodayAR();
  const firstOfMonthStr = todayStr.slice(0, 7) + '-01';

  const [fechaDesde, setFechaDesde] = useState(firstOfMonthStr);
  const [fechaHasta, setFechaHasta] = useState(todayStr);
  const [centros, setCentros] = useState([]);
  const [centrosCostoHabilitado, setCentrosCostoHabilitado] = useState(null); // null = cargando
  const [columnas, setColumnas] = useState([]); // [{ id, nombre, ingresos: [...], egresos: [...], totalIngresos, totalEgresos, resultado }]
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);

  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase.from('empresas').select('usa_centros_costo').eq('id', user.empresa_id).single()
      .then(({ data: emp }) => {
        setCentrosCostoHabilitado(!!emp?.usa_centros_costo);
        if (!emp?.usa_centros_costo) return;
        supabase.from('centros_costo').select('id, nombre')
          .eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre')
          .then(({ data }) => setCentros(data || []));
      });
  }, [user?.empresa_id]);

  const fetchComparativo = useCallback(async () => {
    if (!user?.empresa_id || centros.length === 0) return;
    setLoading(true);
    try {
      const balances = await Promise.all(
        centros.map(c => asientosService.getBalanceComprobacion(user.empresa_id, fechaDesde, fechaHasta, c.id))
      );

      const cols = centros.map((c, idx) => {
        const rows = balances[idx];
        const ingresos = rows.filter(r => r.tipo === 'ingreso').map(r => ({ ...r, monto: r.total_haber - r.total_debe }));
        const egresos = rows.filter(r => r.tipo === 'egreso').map(r => ({ ...r, monto: r.total_debe - r.total_haber }));
        const totalIngresos = ingresos.reduce((s, r) => s + r.monto, 0);
        const totalEgresos = egresos.reduce((s, r) => s + r.monto, 0);
        return { id: c.id, nombre: c.nombre, ingresos, egresos, totalIngresos, totalEgresos, resultado: totalIngresos - totalEgresos };
      });

      setColumnas(cols);
      setGenerated(true);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user?.empresa_id, centros, fechaDesde, fechaHasta, toast]);

  // Unión de todas las cuentas que aparecen en CUALQUIER columna, separadas
  // por Ingresos/Egresos — cada fila es una cuenta, cada columna un CC (0 si
  // esa cuenta no tuvo movimiento en ese CC).
  const cuentasIngreso = useMemo(() => {
    const map = new Map();
    columnas.forEach(col => col.ingresos.forEach(r => { if (!map.has(r.cuenta_id)) map.set(r.cuenta_id, { cuenta_id: r.cuenta_id, codigo: r.codigo, nombre: r.nombre }); }));
    return [...map.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [columnas]);
  const cuentasEgreso = useMemo(() => {
    const map = new Map();
    columnas.forEach(col => col.egresos.forEach(r => { if (!map.has(r.cuenta_id)) map.set(r.cuenta_id, { cuenta_id: r.cuenta_id, codigo: r.codigo, nombre: r.nombre }); }));
    return [...map.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [columnas]);

  const montoDeCC = (col, cuentaId, lista) => (col[lista].find(r => r.cuenta_id === cuentaId)?.monto) || 0;

  const totalGeneral = useMemo(() => ({
    ingresos: columnas.reduce((s, c) => s + c.totalIngresos, 0),
    egresos: columnas.reduce((s, c) => s + c.totalEgresos, 0),
    resultado: columnas.reduce((s, c) => s + c.resultado, 0),
  }), [columnas]);

  const sinDatos = generated && columnas.every(c => c.ingresos.length === 0 && c.egresos.length === 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="dark:text-slate-300">
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <Columns className="h-6 w-6 text-kx-violet" />
            Estado de Resultados por Centro de Costo
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
            Ingresos, Egresos y Resultado de cada Centro de Costo, lado a lado
          </p>
        </div>
      </div>

      {centrosCostoHabilitado === false && (
        <div className="text-center py-16 text-kx-text-2 bg-kx-surface border border-kx-border rounded-xl">
          <Columns className="h-10 w-10 mx-auto mb-2 opacity-20" />
          <p className="font-medium">Esta empresa no tiene Centros de Costo activados</p>
          <p className="text-xs mt-1">Activalos en Configuración → Finanzas para usar este reporte</p>
        </div>
      )}

      {centrosCostoHabilitado && (
        <>
          <div className="bg-kx-surface p-5 rounded-xl border border-kx-border shadow-sm">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500 dark:text-kx-text-2 font-medium">Desde</Label>
                <Input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                  className="h-9 w-40 dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500 dark:text-kx-text-2 font-medium">Hasta</Label>
                <Input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                  className="h-9 w-40 dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text" />
              </div>
              <Button onClick={fetchComparativo} disabled={loading || centros.length === 0}
                className="bg-kx-violet hover:bg-violet-700 text-white h-9">
                {loading ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : <Calendar className="h-4 w-4 mr-1.5" />}
                Generar
              </Button>
            </div>
          </div>

          {sinDatos && (
            <div className="text-center py-16 text-kx-text-2 bg-kx-surface border border-kx-border rounded-xl">
              <Columns className="h-10 w-10 mx-auto mb-2 opacity-20" />
              <p className="font-medium">No hay movimientos en el período seleccionado</p>
            </div>
          )}

          {generated && !sinDatos && (
            <div className="bg-kx-surface border border-kx-border rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b border-kx-border text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2">
                    <tr>
                      <th className="p-4">Cuenta</th>
                      {columnas.map(c => <th key={c.id} className="p-4 text-right whitespace-nowrap">{c.nombre}</th>)}
                      <th className="p-4 text-right whitespace-nowrap bg-kx-surface-2/70">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    <tr className="bg-kx-green/10">
                      <td colSpan={columnas.length + 2} className="p-2 px-4 text-xs font-bold uppercase text-kx-green">Ingresos</td>
                    </tr>
                    {cuentasIngreso.map(cta => (
                      <tr key={cta.cuenta_id}>
                        <td className="p-3 px-4 text-kx-text-2"><span className="font-mono text-xs text-kx-blue mr-2">{cta.codigo}</span>{cta.nombre}</td>
                        {columnas.map(c => <td key={c.id} className="p-3 px-4 text-right font-mono text-kx-text-2">{formatCurrency(montoDeCC(c, cta.cuenta_id, 'ingresos'))}</td>)}
                        <td className="p-3 px-4 text-right font-mono font-semibold bg-kx-surface-2/40">
                          {formatCurrency(columnas.reduce((s, c) => s + montoDeCC(c, cta.cuenta_id, 'ingresos'), 0))}
                        </td>
                      </tr>
                    ))}
                    <tr className="font-bold border-t border-kx-border">
                      <td className="p-3 px-4 text-kx-green">Total Ingresos</td>
                      {columnas.map(c => <td key={c.id} className="p-3 px-4 text-right font-mono text-kx-green">{formatCurrency(c.totalIngresos)}</td>)}
                      <td className="p-3 px-4 text-right font-mono text-kx-green bg-kx-surface-2/40">{formatCurrency(totalGeneral.ingresos)}</td>
                    </tr>

                    <tr className="bg-kx-amber/10">
                      <td colSpan={columnas.length + 2} className="p-2 px-4 text-xs font-bold uppercase text-kx-amber">Egresos</td>
                    </tr>
                    {cuentasEgreso.map(cta => (
                      <tr key={cta.cuenta_id}>
                        <td className="p-3 px-4 text-kx-text-2"><span className="font-mono text-xs text-kx-blue mr-2">{cta.codigo}</span>{cta.nombre}</td>
                        {columnas.map(c => <td key={c.id} className="p-3 px-4 text-right font-mono text-kx-text-2">{formatCurrency(montoDeCC(c, cta.cuenta_id, 'egresos'))}</td>)}
                        <td className="p-3 px-4 text-right font-mono font-semibold bg-kx-surface-2/40">
                          {formatCurrency(columnas.reduce((s, c) => s + montoDeCC(c, cta.cuenta_id, 'egresos'), 0))}
                        </td>
                      </tr>
                    ))}
                    <tr className="font-bold border-t border-kx-border">
                      <td className="p-3 px-4 text-kx-amber">Total Egresos</td>
                      {columnas.map(c => <td key={c.id} className="p-3 px-4 text-right font-mono text-kx-amber">{formatCurrency(c.totalEgresos)}</td>)}
                      <td className="p-3 px-4 text-right font-mono text-kx-amber bg-kx-surface-2/40">{formatCurrency(totalGeneral.egresos)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 dark:border-kx-border bg-kx-surface-2 dark:bg-slate-900/80 font-black">
                      <td className="p-4">Resultado del Período</td>
                      {columnas.map(c => (
                        <td key={c.id} className={`p-4 text-right font-mono flex items-center justify-end gap-1 ${c.resultado >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
                          {c.resultado >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                          {formatCurrency(Math.abs(c.resultado))}
                        </td>
                      ))}
                      <td className={`p-4 text-right font-mono bg-kx-surface-2/70 ${totalGeneral.resultado >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
                        {formatCurrency(Math.abs(totalGeneral.resultado))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {loading && (
            <div className="bg-kx-surface border border-kx-border rounded-xl p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ReporteEstadoResultadosCC;
