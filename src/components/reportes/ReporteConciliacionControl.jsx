import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Scale, ArrowLeft, RefreshCw, FileSpreadsheet, Download, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useConfig } from '@/contexts/ConfigContext';
import { supabase } from '@/lib/customSupabaseClient';
import { generatePDF } from '@/lib/pdfUtils';
import { exportReporte } from '@/lib/excelUtils';
import { formatCurrency } from '@/lib/currencyUtils';
import { useToast } from '@/components/ui/use-toast';
import {
  armarConciliacion, indicadoresConciliacion, formatearCelda, CONCILIACION_COLUMNS,
} from '@/lib/conciliacionControl';

const TITULO = 'Conciliación de Cuentas de Control';

// Foto a HOY de si el mayor coincide con los subdiarios (auditoría 24/09, CON-5). Lee de
// `conciliacion_cuentas_control` (mig.414), que solo lee: no genera ni corrige ningún asiento. Sirve para
// revisarlo en cada cierre — qué cuentas de control no concilian y por qué (documentos sin asiento,
// duplicados, clientes cuyo saldo no coincide con sus movimientos…), con los casos concretos.
function ReporteConciliacionControl({ onBack }) {
  const { user } = useAuth();
  const { config } = useConfig();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [datos, setDatos] = useState(null);
  const [abiertos, setAbiertos] = useState({});

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('conciliacion_cuentas_control');
      if (rpcError) throw rpcError;
      setDatos(armarConciliacion(data));
    } catch (err) {
      setDatos(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.empresa_id) cargar();
  }, [user?.empresa_id, cargar]);

  const indicadores = useMemo(() => (datos ? indicadoresConciliacion(datos) : []), [datos]);
  const alternar = (clave) => setAbiertos((prev) => ({ ...prev, [clave]: !prev[clave] }));

  const descargarPDF = async () => {
    try {
      await generatePDF({
        title: TITULO,
        esSnapshot: true,
        columns: CONCILIACION_COLUMNS,
        data: datos.filasPlanas,
        filename: 'conciliacion_cuentas_control',
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

  const descargarExcel = () => {
    try {
      exportReporte({
        title: TITULO,
        columns: CONCILIACION_COLUMNS,
        data: datos.filasPlanas,
        filename: 'conciliacion_cuentas_control',
      });
      toast({ title: 'Éxito', description: 'Excel generado correctamente.', className: 'bg-green-600 text-white' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Falló la generación del Excel.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="dark:text-slate-300">
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
              <Scale className="h-6 w-6 text-kx-red" />
              {TITULO}
            </h2>
            <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
              Si el mayor coincide con los libros auxiliares — para revisar en cada cierre
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={cargar} disabled={loading} className="h-9">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </Button>
          {datos && (
            <>
              <Button onClick={descargarExcel} className="bg-green-700 hover:bg-green-800 text-white h-9">
                <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Descargar Excel
              </Button>
              <Button onClick={descargarPDF} className="bg-red-600 hover:bg-red-700 text-white h-9">
                <Download className="h-4 w-4 mr-1.5" /> Descargar PDF
              </Button>
            </>
          )}
        </div>
      </div>

      {loading && !datos && (
        <div className="bg-kx-surface border border-kx-border rounded-xl p-6 space-y-3">
          <Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" />
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 text-sm px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {datos && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {indicadores.map((m) => (
              <Card key={m.label} className="p-4 dark:bg-kx-surface dark:border-kx-border">
                <p className="text-xs text-kx-text-3 uppercase tracking-wide">{m.label}</p>
                <p className="text-xl font-black text-kx-text mt-1 font-mono">{m.value}</p>
              </Card>
            ))}
          </div>

          <p className={`flex items-center gap-1.5 text-sm font-medium ${datos.resumen.todoOk ? 'text-kx-green' : 'text-kx-amber'}`}>
            {datos.resumen.todoOk
              ? <><CheckCircle2 className="h-4 w-4 shrink-0" /> Todo concilia y no hay controles para revisar.</>
              : <><AlertTriangle className="h-4 w-4 shrink-0" /> Hay diferencias para revisar. Un control sin casos no significa que el mayor esté bien: mirá también la tabla de cuentas.</>}
          </p>

          {/* ── Cuentas de control ─────────────────────────────────────────── */}
          <section className="bg-kx-surface border border-kx-border rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2 bg-kx-surface-2 border-b border-kx-border text-sm font-semibold text-kx-text">
              Cuentas de control: mayor contra subdiario
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2 border-b border-kx-border">
                  <tr>
                    <th className="p-3">Cuenta</th>
                    <th className="p-3 text-right">Mayor</th>
                    <th className="p-3 text-right">Subdiario</th>
                    <th className="p-3 text-right">Diferencia</th>
                    <th className="p-3 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {datos.cuentas.map((c) => (
                    <tr key={c.clave} data-testid={`cuenta-${c.clave}`}>
                      <td className="p-3 align-top">
                        <p className="font-medium text-kx-text">{c.titulo} <span className="text-xs text-kx-text-3 font-mono">({c.cuentaCodigo})</span></p>
                        <p className="text-xs text-kx-text-3 mt-0.5 max-w-xl">{c.subdiarioDesc}</p>
                        {!c.cuentaExiste && (
                          <p className="text-xs text-kx-amber mt-0.5">La cuenta {c.cuentaCodigo} no existe en el plan de cuentas de esta empresa.</p>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono align-top">{formatCurrency(c.mayor)}</td>
                      <td className="p-3 text-right font-mono align-top">{formatCurrency(c.subdiario)}</td>
                      <td className={`p-3 text-right font-mono align-top font-semibold ${c.conciliado ? 'text-kx-text-2' : 'text-kx-red'}`}>
                        {formatCurrency(c.diferencia)}
                      </td>
                      <td className="p-3 text-center align-top">
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${c.conciliado
                          ? 'bg-kx-green/10 text-kx-green border-kx-green/30'
                          : 'bg-kx-red/10 text-kx-red border-kx-red/30'}`}>
                          {c.conciliado ? 'Concilia' : 'Con diferencia'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Controles de integridad ────────────────────────────────────── */}
          <section className="bg-kx-surface border border-kx-border rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2 bg-kx-surface-2 border-b border-kx-border text-sm font-semibold text-kx-text">
              Controles de integridad
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {datos.controles.map((k) => {
                const abierto = !!abiertos[k.clave];
                const puedeAbrir = !k.ok && k.detalle.length > 0;
                return (
                  <li key={k.clave} data-testid={`control-${k.clave}`}>
                    <button
                      type="button"
                      onClick={() => puedeAbrir && alternar(k.clave)}
                      aria-expanded={puedeAbrir ? abierto : undefined}
                      disabled={!puedeAbrir}
                      className="w-full flex items-start gap-3 px-4 py-3 text-left disabled:cursor-default hover:bg-kx-surface-2/40 transition-colors"
                    >
                      <span className="mt-0.5 text-kx-text-3">
                        {puedeAbrir ? (abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="inline-block w-4" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium text-kx-text">{k.titulo}</span>
                        <span className="block text-xs text-kx-text-3 mt-0.5">{k.ayuda}</span>
                      </span>
                      <span className="text-right shrink-0">
                        {k.monto !== null && !k.ok && (
                          <span className="block font-mono text-sm text-kx-text-2">{formatCurrency(k.monto)}</span>
                        )}
                        <span className={`inline-block mt-0.5 text-xs px-2 py-0.5 rounded-full border font-medium ${k.ok
                          ? 'bg-kx-green/10 text-kx-green border-kx-green/30'
                          : 'bg-kx-amber/10 text-kx-amber border-kx-amber/30'}`}>
                          {k.ok ? 'Sin casos' : `${k.casos} ${k.casos === 1 ? 'caso' : 'casos'}`}
                        </span>
                      </span>
                    </button>
                    {abierto && (
                      <div className="px-4 pb-4 overflow-x-auto">
                        <table className="w-full text-xs text-left border border-kx-border rounded-lg">
                          <thead className="bg-kx-surface-2 text-kx-text-2">
                            <tr>
                              {k.columnas.map((col) => (
                                <th key={col.key} className={`p-2 font-semibold ${col.tipo === 'moneda' || col.tipo === 'numero' ? 'text-right' : ''}`}>{col.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {k.detalle.map((fila, i) => (
                              <tr key={i}>
                                {k.columnas.map((col) => (
                                  <td key={col.key} className={`p-2 ${col.tipo === 'moneda' || col.tipo === 'numero' ? 'text-right font-mono' : ''}`}>
                                    {formatearCelda(fila[col.key], col.tipo)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {k.casos > k.detalle.length && (
                          <p className="text-xs text-kx-text-3 mt-2">Se muestran los {k.detalle.length} casos más recientes o de mayor diferencia, de {k.casos}.</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="text-xs text-kx-text-3 bg-kx-surface border border-kx-border rounded-xl p-4 space-y-1.5">
            <p className="font-semibold text-kx-text-2 flex items-center gap-1.5"><Info className="h-4 w-4" /> Cómo se lee</p>
            <p>
              El <strong>mayor</strong> es la suma de los asientos confirmados de la cuenta; el <strong>subdiario</strong> es el libro auxiliar
              que la respalda (cuenta corriente de clientes y de proveedores, stock valorizado, caja y bancos, IVA de los comprobantes).
              Los pasivos se muestran en positivo (lo que se debe). Se considera que concilia una diferencia menor a $ 1.
            </p>
            <p>
              Una diferencia no siempre es un error: puede venir de documentos sin asiento, asientos duplicados, movimientos sin cliente,
              costos sin cargar o datos anteriores a que el sistema generara los asientos con el IVA discriminado. Los controles de abajo
              muestran los casos concretos. Es una foto a hoy: no cambia nada y se puede actualizar las veces que haga falta.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default ReporteConciliacionControl;
