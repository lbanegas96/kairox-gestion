import { useState, useCallback, useMemo, useEffect } from 'react';
import { RefreshCw, Download, FileSpreadsheet, MessageCircle, AlertCircle, TrendingUp, TrendingDown, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { getTodayAR } from '@/lib/dateUtils';
import { formatCurrency } from '@/lib/currencyUtils';
import { generatePDF } from '@/lib/pdfUtils';
import { exportReporte } from '@/lib/excelUtils';
import { TipoCambioModal } from '@/components/ui/TipoCambioModal';

/**
 * Vista "Posición Actual" del Reporte de Paridad — snapshot de HOY (no un
 * rango de fechas): revalúa los saldos ABIERTOS (Caja, Bancos, Cuentas por
 * Cobrar, Cuentas por Pagar) al TC de hoy. Patrón estándar de ERP ("Foreign
 * Currency Revaluation" en SAP/NetSuite) + RT FACPCE (activos/pasivos en
 * moneda extranjera se valúan al cierre al TC vigente) — complementa a
 * TabHistorico, que NUNCA revalúa transacciones ya cerradas.
 */
function TabPosicionActual() {
  const { user } = useAuth();
  const { config } = useConfig();
  const { toast } = useToast();
  const { monedaParalela, tcHoy, tcMissing, loading: tcLoading, setTC } = useTCParalelo();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [tcModalOpen, setTcModalOpen] = useState(false);
  const [sinConvertir, setSinConvertir] = useState(0);

  // Convierte un saldo en su moneda nativa al monedaParalela usando el TC de
  // hoy. Si la cuenta ya está en monedaParalela, el valor es directo. Si es
  // otra moneda extranjera distinta a ARS/monedaParalela (caso raro), no hay
  // forma de convertir sin un cross-rate — se deja null y se avisa, nunca se
  // inventa un número.
  const toParalelo = useCallback((monto, moneda) => {
    if (moneda === monedaParalela) return Number(monto);
    if (moneda === 'ARS') return tcHoy ? Number(monto) / Number(tcHoy) : null;
    return null;
  }, [monedaParalela, tcHoy]);

  const handleGenerate = useCallback(async () => {
    if (!user?.empresa_id || tcMissing) return;
    setLoading(true);
    try {
      // 1. Caja — siempre ARS, saldo = todo el histórico de ingresos/egresos.
      const { data: caja, error: errCaja } = await supabase
        .from('movimientos_caja')
        .select('tipo, monto')
        .eq('empresa_id', user.empresa_id);
      if (errCaja) throw errCaja;
      const saldoCaja = (caja || []).reduce((s, m) => s + (m.tipo === 'ingreso' ? m.monto : -m.monto), 0);

      // 2. Bancos — por cuenta, respeta la moneda propia de cada una.
      const { data: cuentas, error: errCuentas } = await supabase
        .from('cuentas_bancarias')
        .select('id, nombre, moneda')
        .eq('empresa_id', user.empresa_id)
        .eq('activo', true);
      if (errCuentas) throw errCuentas;

      const { data: movsBanco, error: errMovs } = await supabase
        .from('movimientos_bancarios')
        .select('cuenta_bancaria_id, tipo, monto')
        .eq('empresa_id', user.empresa_id);
      if (errMovs) throw errMovs;

      const saldoPorCuenta = {};
      (movsBanco || []).forEach(m => {
        if (!m.cuenta_bancaria_id) return;
        saldoPorCuenta[m.cuenta_bancaria_id] = (saldoPorCuenta[m.cuenta_bancaria_id] || 0)
          + (m.tipo === 'ingreso' ? m.monto : -m.monto);
      });

      // 3. Cuentas por Cobrar — solo saldos positivos (nunca netear deudores/
      // acreedores, mismo criterio que Cartera de Clientes).
      const { data: clientes, error: errClientes } = await supabase
        .from('clientes')
        .select('saldo_actual')
        .eq('empresa_id', user.empresa_id);
      if (errClientes) throw errClientes;
      const totalCxC = (clientes || []).filter(c => (c.saldo_actual || 0) > 0)
        .reduce((s, c) => s + c.saldo_actual, 0);

      // 4. Cuentas por Pagar — solo saldos positivos (saldo_deuda negativo =
      // le pagamos de más a ese proveedor, no es una deuda real).
      const { data: proveedores, error: errProv } = await supabase
        .from('v_saldo_proveedores')
        .select('saldo_deuda')
        .eq('empresa_id', user.empresa_id);
      if (errProv) throw errProv;
      const totalCxP = (proveedores || []).filter(p => (p.saldo_deuda || 0) > 0)
        .reduce((s, p) => s + p.saldo_deuda, 0);

      // ── Armar filas ──────────────────────────────────────────────────
      const filas = [
        { id: 'caja', concepto: 'Caja', moneda: 'ARS', saldo: saldoCaja },
        ...(cuentas || []).map(c => ({
          id: `banco-${c.id}`, concepto: `Banco: ${c.nombre}`, moneda: c.moneda,
          saldo: saldoPorCuenta[c.id] || 0,
        })),
        { id: 'cxc', concepto: 'Cuentas por Cobrar', moneda: 'ARS', saldo: totalCxC },
        { id: 'cxp', concepto: 'Cuentas por Pagar', moneda: 'ARS', saldo: -totalCxP },
      ].map(f => ({ ...f, montoParalelo: toParalelo(f.saldo, f.moneda) }));

      setRows(filas);
      setSinConvertir(filas.filter(f => f.montoParalelo === null).length);
      setGenerated(true);
    } catch (err) {
      console.error('[TabPosicionActual]', err);
      toast({ title: 'Error', description: 'No se pudo calcular la posición actual.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user?.empresa_id, tcMissing, toParalelo, toast]);

  // Generar automáticamente al entrar (si ya hay TC) — es un snapshot de
  // "ahora", no tiene sentido pedirle al usuario que aprete "Generar".
  useEffect(() => {
    if (!tcLoading && !tcMissing && user?.empresa_id) handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tcLoading, tcMissing, user?.empresa_id]);

  const stats = useMemo(() => {
    const activos = rows.filter(r => r.id !== 'cxp');
    const pasivos = rows.filter(r => r.id === 'cxp');
    const sumPar = (arr) => arr.reduce((s, r) => s + (r.montoParalelo || 0), 0);
    return {
      activosParalelo: sumPar(activos),
      pasivosParalelo: Math.abs(sumPar(pasivos)),
      netaParalelo: rows.reduce((s, r) => s + (r.montoParalelo || 0), 0),
    };
  }, [rows]);

  const columns = useMemo(() => [
    { header: 'Concepto', key: 'concepto', align: 'left' },
    { header: 'Moneda', key: 'moneda', align: 'center' },
    {
      header: 'Saldo', key: 'saldo', align: 'right',
      render: (r) => formatCurrency(r.saldo, r.moneda),
      pdfRender: (r) => formatCurrency(r.saldo, r.moneda),
    },
    {
      header: `Equiv. ${monedaParalela}`, key: 'montoParalelo', align: 'right',
      render: (r) => r.montoParalelo !== null
        ? <span className={r.montoParalelo < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
            {formatCurrency(r.montoParalelo, monedaParalela)}
          </span>
        : <span className="text-kx-text-3 italic">sin convertir</span>,
      pdfRender: (r) => r.montoParalelo !== null ? formatCurrency(r.montoParalelo, monedaParalela) : 'sin convertir',
    },
  ], [monedaParalela]);

  const totals = useMemo(() => ([
    { content: 'POSICIÓN NETA', colSpan: 3, align: 'right' },
    { content: formatCurrency(stats.netaParalelo, monedaParalela), align: 'right', value: stats.netaParalelo },
  ]), [stats, monedaParalela]);

  const summaryMetrics = useMemo(() => ([
    { label: 'Activos Líquidos', value: formatCurrency(stats.activosParalelo, monedaParalela) },
    { label: 'Pasivos (CxP)',    value: formatCurrency(stats.pasivosParalelo, monedaParalela) },
    { label: 'Posición Neta',    value: formatCurrency(stats.netaParalelo, monedaParalela) },
    { label: `TC ${monedaParalela} de hoy`, value: tcHoy ? formatCurrency(tcHoy) : '—' },
  ]), [stats, monedaParalela, tcHoy]);

  const todayLabel = new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const handleDownloadPDF = async () => {
    try {
      await generatePDF({
        title: `Paridad ARS / ${monedaParalela} — Posición Actual`,
        startDate: todayStrLabel(), endDate: todayStrLabel(),
        columns, data: rows, totals, filename: 'paridad_posicion_actual',
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
      exportReporte({ title: 'Paridad Posición Actual', columns, data: rows, totals, filename: 'paridad_posicion_actual' });
      toast({ title: 'Éxito', description: 'Excel generado correctamente.', className: 'bg-green-600 text-white' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Falló la generación del Excel.', variant: 'destructive' });
    }
  };

  const handleShareWhatsApp = () => {
    const lineas = [
      `📊 *Paridad ARS / ${monedaParalela} — Posición Actual (${todayStrLabel()})*`,
      ...summaryMetrics.map(m => `${m.label}: ${m.value}`),
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lineas.join('\n'))}`, '_blank');
  };

  function todayStrLabel() { return getTodayAR(); }

  // ── TC de hoy no cargado: bloquear con el mismo flujo que usa el resto
  // de la app (TipoCambioModal), no inventar un número con TC viejo. ──
  if (!tcLoading && tcMissing) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <AlertCircle className="h-10 w-10 text-amber-500" />
        <div>
          <p className="font-semibold text-kx-text dark:text-kx-text">
            No hay tipo de cambio de {monedaParalela} cargado para hoy ({todayLabel})
          </p>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-1">
            La posición actual necesita el TC de hoy para revaluar los saldos abiertos.
          </p>
        </div>
        <Button onClick={() => setTcModalOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white">
          Cargar TC de hoy
        </Button>
        <TipoCambioModal
          open={tcModalOpen}
          onOpenChange={setTcModalOpen}
          moneda={monedaParalela}
          onConfirm={(tasa) => { setTC(tasa); setTcModalOpen(false); }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-kx-text-2">
          Snapshot al {todayLabel} — TC {monedaParalela}: {tcHoy ? formatCurrency(tcHoy) : '—'}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleGenerate} disabled={loading} className="dark:border-kx-border dark:text-slate-300">
            {loading ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
            Actualizar
          </Button>
          {generated && rows.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={handleDownloadExcel} className="dark:border-kx-border dark:text-slate-300">
                <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadPDF} className="dark:border-kx-border dark:text-slate-300">
                <Download className="h-4 w-4 mr-1.5" /> PDF
              </Button>
              <Button variant="outline" size="sm" onClick={handleShareWhatsApp} className="dark:border-kx-border dark:text-slate-300">
                <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp
              </Button>
            </>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      {generated && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <p className="text-xs text-kx-text-3 uppercase tracking-wide flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> Activos Líquidos</p>
            <p className="text-2xl font-black text-green-600 dark:text-green-400 mt-1 font-mono">{formatCurrency(stats.activosParalelo, monedaParalela)}</p>
          </Card>
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <p className="text-xs text-kx-text-3 uppercase tracking-wide flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5" /> Pasivos (CxP)</p>
            <p className="text-2xl font-black text-red-600 dark:text-red-400 mt-1 font-mono">{formatCurrency(stats.pasivosParalelo, monedaParalela)}</p>
          </Card>
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <p className="text-xs text-kx-text-3 uppercase tracking-wide flex items-center gap-1"><Scale className="h-3.5 w-3.5" /> Posición Neta</p>
            <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1 font-mono">{formatCurrency(stats.netaParalelo, monedaParalela)}</p>
          </Card>
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <p className="text-xs text-kx-text-3 uppercase tracking-wide">TC {monedaParalela} de hoy</p>
            <p className="text-2xl font-black text-kx-text dark:text-kx-text mt-1 font-mono">{tcHoy ? formatCurrency(tcHoy) : '—'}</p>
          </Card>
        </div>
      )}

      {sinConvertir > 0 && (
        <div className="flex items-start gap-2 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <strong>{sinConvertir} cuenta(s) en una moneda que no se puede convertir</strong> a {monedaParalela} sin un tipo de cambio cruzado — quedan fuera de la Posición Neta.
          </div>
        </div>
      )}

      {/* Tabla */}
      <div className="bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b border-kx-border dark:border-kx-border text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2">
              <tr>
                {columns.map(c => <th key={c.key} className="p-4" style={{ textAlign: c.align }}>{c.header}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {columns.map((_, j) => <td key={j} className="p-4"><Skeleton className="h-4 w-full" /></td>)}
                  </tr>
                ))
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
                    Posición Neta
                  </td>
                  <td className="p-4 text-right font-black text-blue-600 dark:text-blue-400 font-mono">
                    {formatCurrency(stats.netaParalelo, monedaParalela)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

export default TabPosicionActual;
