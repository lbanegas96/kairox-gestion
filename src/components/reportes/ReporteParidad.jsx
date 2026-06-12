import React, { useState, useCallback, useMemo } from 'react';
import {
  TrendingUp, Calendar, Download, RefreshCw, DollarSign,
  ArrowLeft, AlertCircle, CheckCircle2, Minus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { getTodayAR, formatDateAR } from '@/lib/dateUtils';

/**
 * Reporte de Paridad ARS / Moneda Paralela (estilo SAP "Currency Translation Report").
 * Muestra cada comprobante con su monto en ARS y su equivalente en la moneda paralela,
 * calculado al TC del día de cada operación.
 *
 * Props:
 *   onBack — fn(): vuelve al grid de reportes
 */
function ReporteParidad({ onBack }) {
  const { user } = useAuth();
  const { monedaParalela } = useTCParalelo();

  // Usar AR timezone para que la fecha inicial sea la correcta en Argentina
  const todayStr       = getTodayAR();                      // 'YYYY-MM-DD' en hora AR
  const firstOfMonthStr = todayStr.slice(0, 7) + '-01';    // 'YYYY-MM-01'

  const [dateFrom, setDateFrom] = useState(firstOfMonthStr);
  const [dateTo, setDateTo]     = useState(todayStr);
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(false);
  const [generated, setGenerated] = useState(false);

  /**
   * Calcula el monto en moneda paralela dado el monto ARS / moneda op / tasa op / TC paralelo.
   */
  const computeParalelo = (monto, _monedaOp, _tasaOp, tcParaleloFecha) => {
    // El `total` de los comprobantes SIEMPRE está en ARS (lógica nueva post-2026-06-08).
    // La conversión es directa: ARS / TC = equivalente en moneda paralela.
    if (!tcParaleloFecha || tcParaleloFecha <= 0) return null;
    return Number(monto) / Number(tcParaleloFecha);
  };

  const handleGenerate = useCallback(async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    try {
      // Construir ISO directo para no depender del timezone del browser.
      // El sistema almacena timestamps como "AR-local-as-UTC" (medianoche AR = T00:00:00Z).
      const startISO = `${dateFrom}T00:00:00.000Z`;
      const endISO   = `${dateTo}T23:59:59.999Z`;

      // 1. Traer comprobantes del período
      const { data: comps, error: compError } = await supabase
        .from('comprobantes')
        .select('id, numero_venta, fecha, cliente_nombre, forma_pago, estado_pago, total, moneda, tipo_cambio_tasa, monto_paralelo, tc_paralelo')
        .eq('empresa_id', user.empresa_id)
        .gte('fecha', startISO)
        .lte('fecha', endISO)
        .order('fecha', { ascending: false });
      if (compError) throw compError;

      // 2. Traer TCs del período para retroactivo
      const { data: tcData } = await supabase
        .from('tipos_cambio')
        .select('fecha, tasa')
        .eq('empresa_id', user.empresa_id)
        .eq('moneda', monedaParalela)
        .gte('fecha', dateFrom)
        .lte('fecha', dateTo);

      const tcMap = {};
      (tcData || []).forEach(tc => { tcMap[tc.fecha] = Number(tc.tasa); });

      // 3. Calcular monto paralelo para cada fila
      const enriched = (comps || []).map(row => {
        const dateKey = row.fecha?.split('T')[0]; // YYYY-MM-DD
        const tcParaleloFecha = row.tc_paralelo ?? tcMap[dateKey] ?? null;
        const montoParalelo = row.monto_paralelo
          ?? computeParalelo(row.total, row.moneda, row.tipo_cambio_tasa, tcParaleloFecha);
        return { ...row, _tcParalelo: tcParaleloFecha, _montoParalelo: montoParalelo };
      });

      setRows(enriched);
      setGenerated(true);
    } catch (err) {
      console.error('[ReporteParidad]', err);
    } finally {
      setLoading(false);
    }
  }, [user?.empresa_id, dateFrom, dateTo, monedaParalela]);

  // ── Totales ──────────────────────────────────────────────────────────────────
  const { totalARS, totalParalelo, rowsConTC, rowsSinTC, tcPromedio } = useMemo(() => {
    const tARS  = rows.reduce((s, r) => s + Number(r.total || 0), 0);
    const tPar  = rows.reduce((s, r) => r._montoParalelo ? s + r._montoParalelo : s, 0);
    const conTC = rows.filter(r => r._montoParalelo !== null).length;
    const sinTC = rows.length - conTC;
    // Weighted average TC
    const sumTasas = rows.filter(r => r._tcParalelo).reduce((s, r) => s + Number(r._tcParalelo), 0);
    const countTasas = rows.filter(r => r._tcParalelo).length;
    return {
      totalARS:      tARS,
      totalParalelo: tPar,
      rowsConTC:     conTC,
      rowsSinTC:     sinTC,
      tcPromedio:    countTasas ? sumTasas / countTasas : null,
    };
  }, [rows]);

  // ── CSV Export ───────────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    const header = `Número,Fecha,Cliente,Forma Pago,Estado,Total ARS,TC ${monedaParalela},Equiv. ${monedaParalela}`;
    const body = rows.map(r => [
      r.numero_venta,
      formatDateAR(r.fecha),
      r.cliente_nombre || 'Consumidor Final',
      r.forma_pago,
      r.estado_pago,
      Number(r.total).toFixed(2),
      r._tcParalelo ? Number(r._tcParalelo).toFixed(2) : '',
      r._montoParalelo ? r._montoParalelo.toFixed(2) : '',
    ].join(',')).join('\n');

    const csv = `${header}\n${body}`;
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `paridad-${monedaParalela}-${dateFrom}-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fmtARS = (n) => `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPar = (n) => n !== null && n !== undefined
    ? `${monedaParalela} ${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

  const estadoColors = {
    pagada:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    pendiente:'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    parcial:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    cancelada:'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="dark:text-slate-300">
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-blue-500" />
            Reporte de Paridad ARS / {monedaParalela}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Comprobantes con su equivalente en {monedaParalela} al TC del día de cada operación
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs text-slate-500 dark:text-slate-400 font-medium">Desde</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="h-9 w-40 dark:bg-slate-800 dark:border-slate-700 dark:text-white" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-500 dark:text-slate-400 font-medium">Hasta</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="h-9 w-40 dark:bg-slate-800 dark:border-slate-700 dark:text-white" />
          </div>
          <Button onClick={handleGenerate} disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white h-9">
            {loading ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : <Calendar className="h-4 w-4 mr-1.5" />}
            Generar
          </Button>
          {generated && rows.length > 0 && (
            <Button variant="outline" onClick={handleExportCSV} className="h-9 dark:border-slate-700 dark:text-slate-300">
              <Download className="h-4 w-4 mr-1.5" /> Exportar CSV
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      {generated && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 dark:bg-slate-900 dark:border-slate-800">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Total ARS</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white mt-1 font-mono">
              {fmtARS(totalARS)}
            </p>
            <p className="text-xs text-slate-400 mt-1">{rows.length} comprobantes</p>
          </Card>
          <Card className="p-4 dark:bg-slate-900 dark:border-slate-800">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Total {monedaParalela}</p>
            <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1 font-mono">
              {fmtPar(rowsConTC > 0 ? totalParalelo : null)}
            </p>
            <p className="text-xs text-slate-400 mt-1">{rowsConTC} con TC · {rowsSinTC} sin TC</p>
          </Card>
          <Card className="p-4 dark:bg-slate-900 dark:border-slate-800">
            <p className="text-xs text-slate-400 uppercase tracking-wide">TC Promedio</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
              {tcPromedio ? fmtARS(tcPromedio) : '—'}
            </p>
            <p className="text-xs text-slate-400 mt-1">1 {monedaParalela} promedio del período</p>
          </Card>
          <Card className="p-4 dark:bg-slate-900 dark:border-slate-800">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Cobertura TC</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">
              {rows.length > 0 ? Math.round((rowsConTC / rows.length) * 100) : 0}%
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {rowsSinTC > 0
                ? <span className="text-amber-500">{rowsSinTC} sin TC del día cargado</span>
                : <span className="text-emerald-500">Todos con TC ✓</span>}
            </p>
          </Card>
        </div>
      )}

      {/* Aviso de cobertura incompleta */}
      {generated && rowsSinTC > 0 && (
        <div className="flex items-start gap-2 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <strong>{rowsSinTC} comprobantes no tienen TC del día registrado</strong> — su equivalente en {monedaParalela} aparece como "—".
            Las filas previas a activar la moneda paralela o días sin TC cargado quedan sin convertir.
          </div>
        </div>
      )}

      {/* Tabla */}
      {(generated || loading) && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-xs uppercase font-semibold text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="p-4">Nro Venta</th>
                  <th className="p-4">Fecha</th>
                  <th className="p-4">Cliente</th>
                  <th className="p-4">Forma Pago</th>
                  <th className="p-4 text-center">Estado</th>
                  <th className="p-4 text-right">Total ARS</th>
                  <th className="p-4 text-right">TC {monedaParalela}</th>
                  <th className="p-4 text-right">Equiv. {monedaParalela}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="p-4"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-slate-500 dark:text-slate-400">
                      <DollarSign className="h-10 w-10 mx-auto mb-2 opacity-20" />
                      <p>No hay comprobantes en el período seleccionado</p>
                    </td>
                  </tr>
                ) : (
                  rows.map(row => (
                    <tr key={row.id} className="hover:bg-blue-50/40 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="p-4 font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {row.numero_venta}
                      </td>
                      <td className="p-4 text-slate-500 dark:text-slate-400 text-xs">
                        {formatDateAR(row.fecha)}
                      </td>
                      <td className="p-4 font-medium text-slate-800 dark:text-slate-200">
                        {row.cliente_nombre || <span className="text-slate-400 italic">Consumidor Final</span>}
                      </td>
                      <td className="p-4 text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wide">
                        {row.forma_pago}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${estadoColors[row.estado_pago] || ''}`}>
                          {row.estado_pago}
                        </span>
                      </td>
                      <td className="p-4 text-right font-bold text-slate-700 dark:text-slate-200 font-mono">
                        {fmtARS(row.total)}
                      </td>
                      <td className="p-4 text-right text-slate-500 dark:text-slate-400 font-mono text-xs">
                        {row._tcParalelo ? `$${Number(row._tcParalelo).toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="p-4 text-right font-bold font-mono">
                        {row._montoParalelo !== null && row._montoParalelo !== undefined ? (
                          <span className="text-blue-600 dark:text-blue-400">
                            {monedaParalela} {Number(row._montoParalelo).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="flex items-center justify-end gap-1 text-slate-300 dark:text-slate-600">
                            <Minus className="h-3 w-3" /> sin TC
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {/* Totales */}
              {generated && rows.length > 0 && !loading && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/80 font-bold">
                    <td colSpan={5} className="p-4 text-right text-sm text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      TOTALES
                    </td>
                    <td className="p-4 text-right font-black text-slate-800 dark:text-white font-mono">
                      {fmtARS(totalARS)}
                    </td>
                    <td className="p-4 text-right text-slate-400">
                      {tcPromedio ? `~$${Math.round(tcPromedio).toLocaleString('es-AR')}` : '—'}
                    </td>
                    <td className="p-4 text-right font-black text-blue-600 dark:text-blue-400 font-mono">
                      {rowsConTC > 0 ? fmtPar(totalParalelo) : '—'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReporteParidad;
