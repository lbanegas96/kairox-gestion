import { useState, useCallback, useMemo } from 'react';
import { Calendar, Download, RefreshCw, DollarSign, AlertCircle, Minus, FileSpreadsheet, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { getTodayAR, formatDateAR } from '@/lib/dateUtils';
import { formatCurrency } from '@/lib/currencyUtils';
import { generatePDF } from '@/lib/pdfUtils';
import { exportReporte } from '@/lib/excelUtils';

const ORIGEN_COLORS = {
  ingreso: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  egreso:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

/**
 * Vista "Histórico" del Reporte de Paridad — cada operación (Venta, Compra,
 * movimiento de Caja) del período con su equivalente en moneda paralela al
 * TC del día en que ocurrió. Nunca se revalúa retroactivamente: es el
 * registro de "a cuánto equivalía esto cuando pasó" (transaction rate, no
 * closing rate) — ver TabPosicionActual para la revaluación al TC de hoy.
 */
function TabHistorico() {
  const { user } = useAuth();
  const { config } = useConfig();
  const { toast } = useToast();
  const { monedaParalela } = useTCParalelo();

  const todayStr        = getTodayAR();
  const firstOfMonthStr = todayStr.slice(0, 7) + '-01';

  const [dateFrom, setDateFrom] = useState(firstOfMonthStr);
  const [dateTo, setDateTo]     = useState(todayStr);
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(false);
  const [generated, setGenerated] = useState(false);

  const computeParalelo = (monto, tcParaleloFecha) => {
    if (!tcParaleloFecha || tcParaleloFecha <= 0) return null;
    return Number(monto) / Number(tcParaleloFecha);
  };

  const handleGenerate = useCallback(async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    try {
      const startISO = `${dateFrom}T00:00:00.000Z`;
      const endISO   = `${dateTo}T23:59:59.999Z`;

      // 1. Ventas — tipo='venta' explícito, NC quedan afuera.
      const { data: ventas, error: errVentas } = await supabase
        .from('comprobantes')
        .select('id, numero_venta, fecha, moneda, tipo_cambio_tasa, monto_paralelo, tc_paralelo, total')
        .eq('empresa_id', user.empresa_id)
        .eq('tipo', 'venta')
        .gte('fecha', startISO)
        .lte('fecha', endISO);
      if (errVentas) throw errVentas;

      // 2. Compras
      const { data: compras, error: errCompras } = await supabase
        .from('compras')
        .select('id, numero_factura, fecha, moneda, tipo_cambio_tasa, monto_paralelo, tc_paralelo, total')
        .eq('empresa_id', user.empresa_id)
        .gte('fecha', startISO)
        .lte('fecha', endISO);
      if (errCompras) throw errCompras;

      // 3. Movimientos de Caja — siempre ARS (sin columna `moneda`). Excluye
      // categoria IN ('Venta','Compra'): son el eco automático que crear_venta/
      // CompraRapidaSection ya escriben en movimientos_caja para CADA venta/
      // compra — sin este filtro, cada una se contaba 2 veces (una acá y otra
      // en el fetch de Ventas/Compras de arriba). El resto de categorías
      // (Cobro Cliente, Pago Proveedor, Alquiler, Devoluciones, etc.) son
      // eventos de caja genuinamente distintos, no se tocan.
      const { data: caja, error: errCaja } = await supabase
        .from('movimientos_caja')
        .select('id, categoria, concepto, fecha, tipo, monto, monto_paralelo, tc_paralelo')
        .eq('empresa_id', user.empresa_id)
        .not('categoria', 'in', '("Venta","Compra")')
        .gte('fecha', startISO)
        .lte('fecha', endISO);
      if (errCaja) throw errCaja;

      // 4. TC del período (fallback para filas sin monto_paralelo/tc_paralelo
      // guardado — ej. operaciones previas a activar la moneda paralela).
      const { data: tcData } = await supabase
        .from('tipos_cambio')
        .select('fecha, tasa')
        .eq('empresa_id', user.empresa_id)
        .eq('moneda', monedaParalela)
        .gte('fecha', dateFrom)
        .lte('fecha', dateTo);
      const tcMap = {};
      (tcData || []).forEach(tc => { tcMap[tc.fecha] = Number(tc.tasa); });

      const enrich = (row, tcFecha, monto) => {
        const tcParalelo = tcFecha ?? tcMap[row.fecha?.split('T')[0]] ?? null;
        const montoParalelo = row.monto_paralelo ?? computeParalelo(monto, tcParalelo);
        return { tcParalelo, montoParalelo };
      };

      const filasVentas = (ventas || []).map(v => {
        const { tcParalelo, montoParalelo } = enrich(v, v.tc_paralelo, v.total);
        return {
          id: `venta-${v.id}`, fecha: v.fecha, origen: 'Venta', tipo: 'ingreso',
          referencia: `Venta #${v.numero_venta || '-'}`,
          totalARS: v.total, tcParalelo, montoParalelo,
        };
      });

      const filasCompras = (compras || []).map(c => {
        const { tcParalelo, montoParalelo } = enrich(c, c.tc_paralelo, c.total);
        return {
          id: `compra-${c.id}`, fecha: c.fecha, origen: 'Compra', tipo: 'egreso',
          referencia: `Factura ${c.numero_factura || '-'}`,
          totalARS: c.total, tcParalelo, montoParalelo,
        };
      });

      const filasCaja = (caja || []).map(m => {
        const { tcParalelo, montoParalelo } = enrich(m, m.tc_paralelo, m.monto);
        return {
          id: `caja-${m.id}`, fecha: m.fecha, origen: 'Caja', tipo: m.tipo,
          referencia: `${m.categoria}${m.concepto ? ' — ' + m.concepto : ''}`,
          totalARS: m.monto, tcParalelo, montoParalelo,
        };
      });

      const todas = [...filasVentas, ...filasCompras, ...filasCaja]
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

      setRows(todas);
      setGenerated(true);
    } catch (err) {
      console.error('[TabHistorico]', err);
      toast({ title: 'Error', description: 'No se pudo generar el histórico.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user?.empresa_id, dateFrom, dateTo, monedaParalela, toast]);

  // ── Totales / KPIs — nunca netear ingreso/egreso (mismo criterio que el
  // resto de Reportería esta sesión: son cosas económicamente distintas). ──
  const stats = useMemo(() => {
    const ingresos = rows.filter(r => r.tipo === 'ingreso');
    const egresos  = rows.filter(r => r.tipo === 'egreso');
    const sum = (arr, key) => arr.reduce((s, r) => s + Number(r[key] || 0), 0);
    const sumPar = (arr) => arr.reduce((s, r) => r.montoParalelo ? s + r.montoParalelo : s, 0);
    const conTC = rows.filter(r => r.montoParalelo !== null).length;
    const tasas = rows.filter(r => r.tcParalelo).map(r => Number(r.tcParalelo));
    return {
      ingresosARS: sum(ingresos, 'totalARS'),
      egresosARS:  sum(egresos, 'totalARS'),
      ingresosPar: sumPar(ingresos),
      egresosPar:  sumPar(egresos),
      conTC,
      sinTC: rows.length - conTC,
      tcPromedio: tasas.length ? tasas.reduce((s, t) => s + t, 0) / tasas.length : null,
    };
  }, [rows]);

  // ── Columnas compartidas por pantalla / PDF / Excel ─────────────────────
  const columns = useMemo(() => [
    { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
    {
      header: 'Origen', key: 'origen', align: 'center',
      render: (r) => <span className={`px-2 py-0.5 rounded text-xs font-semibold ${ORIGEN_COLORS[r.tipo]}`}>{r.origen}</span>,
      pdfRender: (r) => r.origen,
    },
    { header: 'Referencia', key: 'referencia', align: 'left' },
    { header: 'Total ARS', key: 'totalARS', align: 'right', render: (r) => formatCurrency(r.totalARS), pdfRender: (r) => formatCurrency(r.totalARS) },
    {
      header: `TC ${monedaParalela}`, key: 'tcParalelo', align: 'right',
      render: (r) => r.tcParalelo ? formatCurrency(r.tcParalelo).replace('$', '') : '—',
      pdfRender: (r) => r.tcParalelo ? Number(r.tcParalelo).toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '—',
    },
    {
      header: `Equiv. ${monedaParalela}`, key: 'montoParalelo', align: 'right',
      render: (r) => r.montoParalelo !== null && r.montoParalelo !== undefined
        ? formatCurrency(r.montoParalelo, monedaParalela)
        : <span className="text-kx-text-3 italic">sin TC</span>,
      pdfRender: (r) => r.montoParalelo !== null && r.montoParalelo !== undefined ? formatCurrency(r.montoParalelo, monedaParalela) : 'sin TC',
    },
  ], [monedaParalela]);

  const totals = useMemo(() => ([
    { content: 'TOTALES', colSpan: 3, align: 'right' },
    { content: `${formatCurrency(stats.ingresosARS)} / -${formatCurrency(stats.egresosARS)}`, align: 'right' },
    { content: '', align: 'right' },
    { content: `${formatCurrency(stats.ingresosPar, monedaParalela)} / -${formatCurrency(stats.egresosPar, monedaParalela)}`, align: 'right' },
  ]), [stats, monedaParalela]);

  const summaryMetrics = useMemo(() => ([
    { label: 'Ingresos', value: formatCurrency(stats.ingresosPar, monedaParalela) },
    { label: 'Egresos',  value: formatCurrency(stats.egresosPar, monedaParalela) },
    { label: 'TC Promedio', value: stats.tcPromedio ? formatCurrency(stats.tcPromedio) : '—' },
    { label: 'Cobertura TC', value: rows.length ? `${Math.round((stats.conTC / rows.length) * 100)}%` : '—' },
  ]), [stats, monedaParalela, rows.length]);

  const handleDownloadPDF = async () => {
    try {
      await generatePDF({
        title: `Paridad ARS / ${monedaParalela} — Histórico`,
        startDate: dateFrom,
        endDate: dateTo,
        columns, data: rows, totals,
        filename: 'paridad_historico',
        companyName: config?.nombre_empresa || 'KAIROX Gestión',
        logoUrl: config?.logo_base64 || null,
        summaryMetrics,
      });
      toast({ title: 'Éxito', description: 'PDF generado correctamente.', className: 'bg-green-600 text-white' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Falló la generación del PDF.', variant: 'destructive' });
    }
  };

  const handleDownloadExcel = () => {
    try {
      exportReporte({ title: 'Paridad Histórico', columns, data: rows, totals, filename: 'paridad_historico' });
      toast({ title: 'Éxito', description: 'Excel generado correctamente.', className: 'bg-green-600 text-white' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Falló la generación del Excel.', variant: 'destructive' });
    }
  };

  const handleShareWhatsApp = () => {
    const lineas = [
      `📊 *Paridad ARS / ${monedaParalela} — Histórico*`,
      `Período: ${dateFrom} al ${dateTo}`,
      ...summaryMetrics.map(m => `${m.label}: ${m.value}`),
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lineas.join('\n'))}`, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="bg-kx-surface dark:bg-kx-surface p-5 rounded-xl border border-kx-border dark:border-kx-border shadow-sm">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs text-slate-500 dark:text-kx-text-2 font-medium">Desde</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="h-9 w-40 dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-500 dark:text-kx-text-2 font-medium">Hasta</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="h-9 w-40 dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text" />
          </div>
          <Button onClick={handleGenerate} disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white h-9">
            {loading ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : <Calendar className="h-4 w-4 mr-1.5" />}
            Generar
          </Button>
          {generated && rows.length > 0 && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleDownloadExcel} className="h-9 dark:border-kx-border dark:text-slate-300">
                <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
              </Button>
              <Button variant="outline" onClick={handleDownloadPDF} className="h-9 dark:border-kx-border dark:text-slate-300">
                <Download className="h-4 w-4 mr-1.5" /> PDF
              </Button>
              <Button variant="outline" onClick={handleShareWhatsApp} className="h-9 dark:border-kx-border dark:text-slate-300">
                <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      {generated && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {summaryMetrics.map(m => (
            <Card key={m.label} className="p-4 dark:bg-kx-surface dark:border-kx-border">
              <p className="text-xs text-kx-text-3 uppercase tracking-wide">{m.label}</p>
              <p className="text-2xl font-black text-kx-text dark:text-kx-text mt-1 font-mono">{m.value}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Aviso de cobertura incompleta */}
      {generated && stats.sinTC > 0 && (
        <div className="flex items-start gap-2 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <strong>{stats.sinTC} operaciones no tienen TC del día registrado</strong> — su equivalente en {monedaParalela} aparece como "sin TC".
            Operaciones previas a activar la moneda paralela o días sin TC cargado quedan sin convertir.
          </div>
        </div>
      )}

      {/* Tabla */}
      {(generated || loading) && (
        <div className="bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b border-kx-border dark:border-kx-border text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2">
                <tr>
                  {columns.map(c => (
                    <th key={c.key} className="p-4" style={{ textAlign: c.align }}>{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {columns.map((_, j) => (
                        <td key={j} className="p-4"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="p-12 text-center text-slate-500 dark:text-kx-text-2">
                      <DollarSign className="h-10 w-10 mx-auto mb-2 opacity-20" />
                      <p>No hay operaciones en el período seleccionado</p>
                    </td>
                  </tr>
                ) : (
                  rows.map(row => (
                    <tr key={row.id} className="hover:bg-blue-50/40 dark:hover:bg-slate-800/40 transition-colors">
                      {columns.map(c => (
                        <td key={c.key} className="p-4 font-mono" style={{ textAlign: c.align }}>
                          {c.render ? c.render(row) : row[c.key]}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
              {generated && rows.length > 0 && !loading && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 dark:border-kx-border bg-kx-surface-2 dark:bg-slate-900/80 font-bold">
                    <td colSpan={3} className="p-4 text-right text-sm text-slate-500 dark:text-kx-text-2 uppercase tracking-wide">
                      Ingresos / Egresos
                    </td>
                    <td className="p-4 text-right font-mono text-kx-text dark:text-kx-text">
                      <span className="text-green-600 dark:text-green-400">{formatCurrency(stats.ingresosARS)}</span>
                      {' / '}
                      <span className="text-red-600 dark:text-red-400">-{formatCurrency(stats.egresosARS)}</span>
                    </td>
                    <td />
                    <td className="p-4 text-right font-mono">
                      <span className="text-green-600 dark:text-green-400">{formatCurrency(stats.ingresosPar, monedaParalela)}</span>
                      {' / '}
                      <span className="text-red-600 dark:text-red-400">-{formatCurrency(stats.egresosPar, monedaParalela)}</span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {!generated && !loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400 dark:text-kx-text-3">
          <Minus className="h-3 w-3" /> Elegí un período y generá el reporte.
        </div>
      )}
    </div>
  );
}

export default TabHistorico;
