import { useState, useMemo, useEffect } from 'react';
import { Loader2, RefreshCw, TrendingUp, TrendingDown, Download } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { asientosService, PLAN_CUENTAS_KEYS } from '@/services/planCuentasService';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmt, csvDownload } from './shared';

function TabEstadoResultados({ empresaId }) {
  const [fechaDesde, setDesde] = useState('');
  const [fechaHasta, setHasta] = useState('');
  // Centro de costo (Fase 1 del plan de 4 frentes contables) — opcional.
  const [centrosCosto, setCentrosCosto] = useState([]);
  const [centroCostoId, setCentroCostoId] = useState('');

  useEffect(() => {
    if (!empresaId) return;
    supabase.from('centros_costo').select('id, nombre')
      .eq('empresa_id', empresaId).eq('activo', true).order('nombre')
      .then(({ data }) => setCentrosCosto(data || []));
  }, [empresaId]);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.estadoResultados(empresaId, fechaDesde, fechaHasta, centroCostoId),
    queryFn: () => asientosService.getBalanceComprobacion(empresaId, fechaDesde || undefined, fechaHasta || undefined, centroCostoId || undefined),
    enabled: !!empresaId,
  });

  const ingresos = useMemo(() =>
    rows.filter(r => r.tipo === 'ingreso')
      .map(r => ({ ...r, monto: r.total_haber - r.total_debe }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo)),
    [rows]);

  const egresos = useMemo(() =>
    rows.filter(r => r.tipo === 'egreso')
      .map(r => ({ ...r, monto: r.total_debe - r.total_haber }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo)),
    [rows]);

  const totalIngresos = ingresos.reduce((s, r) => s + r.monto, 0);
  const totalEgresos = egresos.reduce((s, r) => s + r.monto, 0);
  const resultado = totalIngresos - totalEgresos;
  const ganancia = resultado >= 0;

  const handleExportCSV = () => {
    const lineas = [
      ...ingresos.map(r => `${r.codigo},"${r.nombre}",Ingreso,${r.monto.toFixed(2)}`),
      ...egresos.map(r => `${r.codigo},"${r.nombre}",Egreso,${r.monto.toFixed(2)}`),
      `,,Total Ingresos,${totalIngresos.toFixed(2)}`,
      `,,Total Egresos,${totalEgresos.toFixed(2)}`,
      `,,Resultado del Período,${resultado.toFixed(2)}`,
    ];
    csvDownload(
      `estado-resultados-${fechaDesde || 'inicio'}-${fechaHasta || 'hoy'}.csv`,
      'Código,Cuenta,Tipo,Monto',
      lineas
    );
  };

  const sinDatos = !isLoading && rows.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-kx-text-3 text-xs whitespace-nowrap">Desde</Label>
          <Input type="date" value={fechaDesde} onChange={(e) => setDesde(e.target.value)}
            className="bg-slate-800 border-slate-700 h-9 text-sm w-36" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-kx-text-3 text-xs whitespace-nowrap">Hasta</Label>
          <Input type="date" value={fechaHasta} onChange={(e) => setHasta(e.target.value)}
            className="bg-slate-800 border-slate-700 h-9 text-sm w-36" />
        </div>
        {centrosCosto.length > 0 && (
          <div className="flex items-center gap-2">
            <Label className="text-kx-text-3 text-xs whitespace-nowrap">Centro de costo</Label>
            <select
              value={centroCostoId}
              onChange={(e) => setCentroCostoId(e.target.value)}
              className="h-9 rounded-md bg-slate-800 border border-slate-700 text-sm text-slate-200 px-2"
            >
              <option value="">Todos</option>
              {centrosCosto.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
        )}
        <Button onClick={() => refetch()} size="sm" variant="outline"
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw size={14} className="mr-1" /> Actualizar
        </Button>
        {!sinDatos && (
          <Button onClick={handleExportCSV} size="sm" variant="outline"
            className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <Download size={14} className="mr-1" /> Exportar CSV
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-[#00D4FF]" />
        </div>
      )}

      {sinDatos && (
        <div className="text-center py-20 text-slate-500">
          <TrendingUp size={36} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No hay movimientos en el período seleccionado</p>
          <p className="text-xs mt-1 text-kx-text-2">Solo se consideran asientos confirmados</p>
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <>
          {/* Ingresos */}
          <div className="rounded-xl border border-slate-700 overflow-hidden">
            <div className="bg-green-500/10 px-4 py-2 border-b border-slate-700">
              <span className="text-sm font-semibold text-green-400">Ingresos</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {ingresos.length === 0 && (
                  <tr><td className="px-4 py-4 text-center text-slate-500 text-xs">Sin ingresos en el período</td></tr>
                )}
                {ingresos.map((r) => (
                  <tr key={r.cuenta_id} className="border-t border-slate-800 hover:bg-slate-800/30">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#00D4FF] w-20">{r.codigo}</td>
                    <td className="px-4 py-2.5 text-slate-300">{r.nombre}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-300 w-40">{fmt(r.monto)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-800/50">
                <tr>
                  <td colSpan={2} className="px-4 py-2.5 text-kx-text-3 font-semibold">Total Ingresos</td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-green-400">{fmt(totalIngresos)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Egresos */}
          <div className="rounded-xl border border-slate-700 overflow-hidden">
            <div className="bg-orange-500/10 px-4 py-2 border-b border-slate-700">
              <span className="text-sm font-semibold text-orange-400">Egresos / Gastos</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {egresos.length === 0 && (
                  <tr><td className="px-4 py-4 text-center text-slate-500 text-xs">Sin egresos en el período</td></tr>
                )}
                {egresos.map((r) => (
                  <tr key={r.cuenta_id} className="border-t border-slate-800 hover:bg-slate-800/30">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#00D4FF] w-20">{r.codigo}</td>
                    <td className="px-4 py-2.5 text-slate-300">{r.nombre}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-300 w-40">{fmt(r.monto)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-800/50">
                <tr>
                  <td colSpan={2} className="px-4 py-2.5 text-kx-text-3 font-semibold">Total Egresos</td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-orange-400">{fmt(totalEgresos)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Resultado del período */}
          <div className={`rounded-xl border p-4 flex items-center justify-between
            ${ganancia ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
            <div className="flex items-center gap-2">
              {ganancia ? <TrendingUp size={18} className="text-green-400" /> : <TrendingDown size={18} className="text-red-400" />}
              <span className="font-semibold text-white">Resultado del Período</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium
                ${ganancia ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}>
                {ganancia ? 'Ganancia' : 'Pérdida'}
              </span>
            </div>
            <span className={`text-xl font-mono font-bold ${ganancia ? 'text-green-400' : 'text-red-400'}`}>
              {fmt(Math.abs(resultado))}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default TabEstadoResultados;
