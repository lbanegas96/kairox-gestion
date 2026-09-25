import { useState, useEffect, useMemo } from 'react';
import { Calculator, ArrowLeft, RefreshCw, FileSpreadsheet, Download, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useConfig } from '@/contexts/ConfigContext';
import { supabase } from '@/lib/customSupabaseClient';
import { formatDateAR } from '@/lib/dateUtils';
import { generatePDF } from '@/lib/pdfUtils';
import { exportReporte } from '@/lib/excelUtils';
import { useToast } from '@/components/ui/use-toast';
import ReportTable from '@/components/reportes/ReportTable';
import {
  armarMemoriaAjuste, indicadoresMemoria, totalesMemoria, MEMORIA_COLUMNS, mesAperturaLabel,
} from '@/lib/memoriaAjusteInflacion';

const TITULO = 'Memoria de Cálculo — Ajuste por Inflación';

// Papel de trabajo del Ajuste por Inflación contable (RT 6) de UN período: el
// detalle cuenta por cuenta y mes por mes que el asiento resume en una línea por
// cuenta — saldo, índice del mes, coeficiente aplicado, saldo reexpresado y
// ajuste — más el RECPAM. Sirve de respaldo ante una inspección o para que el
// contador revise el criterio. Lee de `memoria_calculo_ajuste_por_inflacion`
// (mig.401), que calcula lo mismo que va a postear generar_ajuste_por_inflacion
// y verifica que el detalle cierre contra esas líneas. No genera ningún asiento.
function ReporteMemoriaAjusteInflacion({ onBack }) {
  const { user } = useAuth();
  const { config } = useConfig();
  const { toast } = useToast();

  const [periodos, setPeriodos] = useState(null); // null = cargando
  const [periodoId, setPeriodoId] = useState('');
  const [loading, setLoading] = useState(false);
  const [memoria, setMemoria] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase.from('periodos_contables')
      .select('id, nombre, fecha_inicio, fecha_cierre, estado')
      .eq('empresa_id', user.empresa_id)
      .order('fecha_inicio', { ascending: false })
      .then(({ data }) => {
        const lista = data || [];
        setPeriodos(lista);
        if (lista.length > 0) setPeriodoId(lista[0].id);
      });
  }, [user?.empresa_id]);

  const generar = async () => {
    if (!periodoId) return;
    setLoading(true);
    setError(null);
    setMemoria(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('memoria_calculo_ajuste_por_inflacion', { p_periodo_id: periodoId });
      if (rpcError) throw rpcError;
      setMemoria(armarMemoriaAjuste(data));
    } catch (err) {
      // Los errores del cálculo (índice faltante, etc.) ya vienen escritos para el usuario.
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const totales = useMemo(() => (memoria ? totalesMemoria(memoria) : null), [memoria]);
  const indicadores = useMemo(() => (memoria ? indicadoresMemoria(memoria) : null), [memoria]);

  const descargarPDF = async () => {
    try {
      await generatePDF({
        title: `${TITULO} — ${memoria.periodo?.nombre ?? ''}`,
        startDate: memoria.periodo?.fecha_inicio,
        endDate: memoria.periodo?.fecha_cierre,
        columns: MEMORIA_COLUMNS,
        data: memoria.filasPlanas,
        totals: totales,
        filename: 'memoria_ajuste_inflacion',
        companyName: config?.nombre_empresa || 'KAIROX Gestión',
        logoUrl: config?.logo_base64 || null,
        summaryMetrics: indicadores,
      });
      toast({ title: 'Éxito', description: 'PDF generado correctamente.', className: 'bg-green-600 text-white' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Falló la generación del PDF.', variant: 'destructive' });
    }
  };

  const descargarExcel = async () => {
    try {
      await exportReporte({
        title: TITULO,
        columns: MEMORIA_COLUMNS,
        data: memoria.filasPlanas,
        totals: totales,
        filename: 'memoria_ajuste_inflacion',
      });
      toast({ title: 'Éxito', description: 'Excel generado correctamente.', className: 'bg-green-600 text-white' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Falló la generación del Excel.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="dark:text-slate-300">
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <Calculator className="h-6 w-6 text-kx-amber" />
            {TITULO}
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
            Papel de trabajo cuenta por cuenta: saldo, índice, coeficiente y ajuste — respaldo ante una inspección
          </p>
        </div>
      </div>

      {periodos === null && (
        <div className="bg-kx-surface border border-kx-border rounded-xl p-6 space-y-3">
          <Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" />
        </div>
      )}

      {periodos !== null && periodos.length === 0 && (
        <div className="text-center py-16 text-kx-text-2 bg-kx-surface border border-kx-border rounded-xl">
          <Calculator className="h-10 w-10 mx-auto mb-2 opacity-20" />
          <p className="font-medium">Todavía no tenés períodos contables.</p>
          <p className="text-xs mt-1">Se crean desde Plan de Cuentas → Cierre de Período.</p>
        </div>
      )}

      {periodos !== null && periodos.length > 0 && (
        <div className="bg-kx-surface p-5 rounded-xl border border-kx-border shadow-sm">
          <div className="flex flex-wrap gap-4 items-end justify-between">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500 dark:text-kx-text-2 font-medium">Período contable</Label>
                <select
                  value={periodoId}
                  onChange={e => { setPeriodoId(e.target.value); setMemoria(null); setError(null); }}
                  className="h-9 w-72 rounded-md bg-white dark:bg-kx-surface-2 border border-slate-200 dark:border-kx-border text-sm text-kx-text px-2"
                >
                  {periodos.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre} ({p.estado})</option>
                  ))}
                </select>
              </div>
              <Button onClick={generar} disabled={loading || !periodoId} className="bg-kx-amber hover:bg-amber-600 text-white h-9">
                {loading ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : <Calculator className="h-4 w-4 mr-1.5" />}
                Generar memoria
              </Button>
            </div>
            {memoria && (
              <div className="flex gap-2">
                <Button onClick={descargarExcel} className="bg-green-700 hover:bg-green-800 text-white h-9">
                  <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Descargar Excel
                </Button>
                <Button onClick={descargarPDF} className="bg-red-600 hover:bg-red-700 text-white h-9">
                  <Download className="h-4 w-4 mr-1.5" /> Descargar PDF
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {memoria && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {indicadores.map(m => (
              <Card key={m.label} className="p-4 dark:bg-kx-surface dark:border-kx-border">
                <p className="text-xs text-kx-text-3 uppercase tracking-wide">{m.label}</p>
                <p className="text-xl font-black text-kx-text mt-1 font-mono">{m.value}</p>
              </Card>
            ))}
          </div>

          <div className="bg-kx-surface border border-kx-border rounded-xl p-4 space-y-2 text-sm text-kx-text-2">
            <p>
              <strong className="text-kx-text">{memoria.periodo?.nombre}</strong>
              {' · '}del {formatDateAR(memoria.periodo?.fecha_inicio)} al {formatDateAR(memoria.periodo?.fecha_cierre)}
              {' · '}estado: {memoria.periodo?.estado}
            </p>
            {memoria.indiceCierre && (
              <p>
                Índice de cierre ({memoria.indiceCierre.mesLabel}):{' '}
                <span className="font-mono text-kx-text">{memoria.indiceCierre.indice.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </p>
            )}
            <p className="flex items-center gap-1.5">
              <Info className="h-4 w-4 shrink-0" />
              {memoria.asiento
                ? `El ajuste ya se generó: asiento N° ${memoria.asiento.numero} del ${formatDateAR(memoria.asiento.fecha)}.`
                : 'El ajuste todavía no se generó para este período — esto es una vista previa de lo que se va a postear.'}
            </p>
            <p className={`flex items-center gap-1.5 font-medium ${memoria.control.ok ? 'text-kx-green' : 'text-kx-red'}`}>
              {memoria.control.ok
                ? <><CheckCircle2 className="h-4 w-4 shrink-0" /> El detalle cierra contra el ajuste oficial (diferencia de {memoria.control.diferencia.toLocaleString('es-AR', { minimumFractionDigits: 2 })}).</>
                : <><AlertTriangle className="h-4 w-4 shrink-0" /> El detalle NO cierra contra el ajuste oficial: diferencia de {memoria.control.diferencia.toLocaleString('es-AR', { minimumFractionDigits: 2 })}. Avisá a soporte antes de usar este papel.</>}
            </p>
          </div>

          {memoria.sinAjuste && (
            <div className="flex items-start gap-2 text-sm px-4 py-3 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Este período no genera ajuste: los saldos considerados son del propio mes de cierre (coeficiente 1) o no
                hay saldo de apertura. Igual se muestra el detalle de lo que se evaluó.
              </span>
            </div>
          )}

          <ReportTable columns={MEMORIA_COLUMNS} data={memoria.filasPlanas} loading={false} totals={totales} />

          {memoria.indices.length > 0 && (
            <div className="bg-kx-surface border border-kx-border rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-2 bg-kx-surface-2 border-b border-kx-border text-sm font-semibold text-kx-text">
                Índices utilizados
              </div>
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2 border-b border-kx-border">
                  <tr>
                    <th className="p-3">Mes</th>
                    <th className="p-3 text-right">Índice</th>
                    <th className="p-3 text-right">Coeficiente (cierre ÷ índice del mes)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {memoria.indices.map(i => (
                    <tr key={i.mes}>
                      <td className="p-3">{i.mesLabel}</td>
                      <td className="p-3 text-right font-mono">{i.indice.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono">{i.coeficiente.toLocaleString('es-AR', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="text-xs text-kx-text-3 bg-kx-surface border border-kx-border rounded-xl p-4 space-y-1.5">
            <p className="font-semibold text-kx-text-2">Cómo se calcula</p>
            <p>
              Solo se ajustan las cuentas <strong>no monetarias</strong> (inventario, capital, resultados, etc.). Cada saldo se
              reexpresa a moneda del cierre con el coeficiente <em>índice del mes de cierre ÷ índice del mes en que se originó</em>,
              y el ajuste es el saldo × (coeficiente − 1).
            </p>
            <p>
              El <strong>saldo de apertura</strong> (cuentas de Patrimonio Neto con saldo antes del inicio del período) se toma al índice
              de {mesAperturaLabel(memoria.periodo?.fecha_inicio)};
              cada <strong>movimiento</strong> del período, al índice del mes en que ocurrió.
            </p>
            <p>El RECPAM se clasifica en ganancia o pérdida según la naturaleza de cada cuenta ajustada.</p>
          </div>
        </>
      )}
    </div>
  );
}

export default ReporteMemoriaAjusteInflacion;
