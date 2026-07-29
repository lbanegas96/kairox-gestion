import { useState, useCallback, useMemo } from 'react';
import {
  BookOpen, Calendar, Download, RefreshCw, ArrowLeft, AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { getTodayAR, formatDateAR } from '@/lib/dateUtils';
import { useToast } from '@/components/ui/use-toast';

const PAGE_SIZE = 100;

// Libro IVA Compras — espejo de ReporteLibroIVA (ventas) pero sobre la tabla `compras`
// + proveedores. Consulta en dos pasos (sin embedded select) para no depender de FK.
function ReporteLibroIVACompras({ onBack }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const todayStr = getTodayAR();
  const firstOfMonthStr = todayStr.slice(0, 7) + '-01';

  const [fechaDesde, setFechaDesde] = useState(firstOfMonthStr);
  const [fechaHasta, setFechaHasta] = useState(todayStr);
  const [compras, setCompras] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [page, setPage] = useState(1);

  const fetchLibroIVACompras = useCallback(async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    try {
      const rangoDesde = `${fechaDesde}T00:00:00`;
      const rangoHasta = `${fechaHasta}T23:59:59`;

      // Espejo Ventas↔Compras: el crédito fiscal de IVA no es solo `compras` —
      // una ND recibida de proveedor lo aumenta (nos cobran algo con IVA a
      // favor) y una NC de proveedor lo reduce (nos acreditan). Ambas ya
      // tienen neto/IVA propio desde mig.276/277 — antes de eso solo existían
      // como monto plano, así que no se pueden reflejar correctamente acá.
      const [{ data: comprasData, error: errCompras },
             { data: ndData, error: errNd },
             { data: ncpData, error: errNcp }] = await Promise.all([
        supabase.from('compras')
          .select('id, numero_factura, fecha, proveedor_id, total, neto_gravado, iva_discriminado')
          .eq('empresa_id', user.empresa_id)
          .gte('fecha', rangoDesde).lte('fecha', rangoHasta),
        supabase.from('notas_debito')
          .select('id, numero_nd, fecha, proveedor_id, monto, neto_gravado, iva_discriminado')
          .eq('empresa_id', user.empresa_id).eq('tipo', 'recibida')
          .gte('fecha', rangoDesde).lte('fecha', rangoHasta),
        supabase.from('notas_credito_proveedor')
          .select('id, numero_ncp, fecha, proveedor_id, monto, neto_gravado, iva_discriminado')
          .eq('empresa_id', user.empresa_id)
          .gte('fecha', rangoDesde).lte('fecha', rangoHasta),
      ]);
      if (errCompras) throw errCompras;
      if (errNd) throw errNd;
      if (errNcp) throw errNcp;

      // Segundo paso: traer proveedores y mergear en JS (sin embedded select).
      const provIds = [...new Set([
        ...(comprasData ?? []).map(c => c.proveedor_id),
        ...(ndData ?? []).map(n => n.proveedor_id),
        ...(ncpData ?? []).map(n => n.proveedor_id),
      ].filter(Boolean))];
      let provMap = {};
      if (provIds.length > 0) {
        const { data: provs } = await supabase
          .from('proveedores')
          .select('id, nombre, razon_social, cuit')
          .in('id', provIds);
        provMap = Object.fromEntries((provs ?? []).map(p => [p.id, p]));
      }

      const nombreProv = (id) => {
        const p = provMap[id];
        return p?.razon_social || p?.nombre || 'Proveedor';
      };
      const cuitProv = (id) => provMap[id]?.cuit ?? '';

      const merged = [
        ...(comprasData ?? []).map(c => ({
          id: c.id, tipo: 'compra', numero: c.numero_factura, fecha: c.fecha,
          proveedor_nombre: nombreProv(c.proveedor_id), proveedor_cuit: cuitProv(c.proveedor_id),
          total: Number(c.total), neto_gravado: c.neto_gravado, iva_discriminado: c.iva_discriminado,
        })),
        ...(ndData ?? []).map(n => ({
          id: n.id, tipo: 'nota_debito', numero: n.numero_nd, fecha: n.fecha,
          proveedor_nombre: nombreProv(n.proveedor_id), proveedor_cuit: cuitProv(n.proveedor_id),
          total: Number(n.monto), neto_gravado: n.neto_gravado, iva_discriminado: n.iva_discriminado,
        })),
        ...(ncpData ?? []).map(n => ({
          id: n.id, tipo: 'nota_credito', numero: n.numero_ncp, fecha: n.fecha,
          proveedor_nombre: nombreProv(n.proveedor_id), proveedor_cuit: cuitProv(n.proveedor_id),
          // NC reduce el crédito fiscal — signo negativo, ya en el monto guardado en pesos.
          total: -Number(n.monto), neto_gravado: n.neto_gravado != null ? -Number(n.neto_gravado) : null,
          iva_discriminado: n.iva_discriminado != null ? -Number(n.iva_discriminado) : null,
        })),
      ].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

      setCompras(merged);
      setGenerated(true);
      setPage(1);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user?.empresa_id, fechaDesde, fechaHasta, toast]);

  // Fallback 21% para filas viejas sin neto_gravado/iva_discriminado (compras
  // pre-módulo IVA, o ND recibidas creadas antes de mig.276).
  const netoDe = (c) => c.neto_gravado != null ? Number(c.neto_gravado) : Number(c.total) / 1.21;
  const ivaDe  = (c) => c.iva_discriminado != null ? Number(c.iva_discriminado) : Number(c.total) - netoDe(c);

  const TIPO_LABEL = {
    compra: 'Compra', nota_debito: 'ND recibida', nota_credito: 'NC proveedor',
  };

  const kpis = useMemo(() => {
    const totalBruto = compras.reduce((s, c) => s + Number(c.total), 0);
    const totalNeto  = compras.reduce((s, c) => s + netoDe(c), 0);
    const totalIVA   = compras.reduce((s, c) => s + ivaDe(c), 0);
    return { cantidad: compras.length, totalBruto, totalNeto, totalIVA };
  }, [compras]);

  const totalPages = Math.max(1, Math.ceil(compras.length / PAGE_SIZE));
  const paginatedData = compras.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const exportarCSV = () => {
    const rows = compras.map(c => [
      TIPO_LABEL[c.tipo] ?? c.tipo,
      c.numero ?? '',
      `"${(c.proveedor_nombre ?? 'Proveedor').replace(/"/g, '""')}"`,
      c.proveedor_cuit ?? '',
      c.fecha?.slice(0, 10) ?? '',
      Number(c.total).toFixed(2),
      netoDe(c).toFixed(2),
      ivaDe(c).toFixed(2),
    ].join(','));
    const headers = [
      'Tipo', 'Nro_Documento', 'Proveedor', 'CUIT', 'Fecha',
      'Total_Bruto', 'Neto_Gravado', 'IVA',
    ].join(',');
    const csv = '﻿' + headers + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `libro_iva_compras_${fechaDesde}_${fechaHasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fmtARS = (n) =>
    `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="dark:text-slate-300">
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-kx-green" />
            Libro IVA Compras
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
            Compras a proveedores por período · crédito fiscal IVA
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-kx-surface dark:bg-kx-surface p-5 rounded-xl border border-kx-border dark:border-kx-border shadow-sm">
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
          <Button onClick={fetchLibroIVACompras} disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white h-9">
            {loading
              ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" />
              : <Calendar className="h-4 w-4 mr-1.5" />}
            Generar
          </Button>
          {generated && compras.length > 0 && (
            <Button variant="outline" onClick={exportarCSV} className="h-9 dark:border-kx-border dark:text-slate-300">
              <Download className="h-4 w-4 mr-1.5" /> Exportar CSV
            </Button>
          )}
        </div>
      </div>

      {/* Aviso simplificación IVA */}
      {generated && (
        <div className="flex items-start gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-400">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Neto e IVA discriminados por compra cuando están disponibles.</strong> Compras
            cargadas antes del módulo de IVA usan estimación al 21%. Verificar con contador.
          </span>
        </div>
      )}

      {/* KPI Cards */}
      {generated && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <p className="text-xs text-kx-text-3 uppercase tracking-wide">Compras</p>
            <p className="text-2xl font-black text-kx-text dark:text-kx-text mt-1">{kpis.cantidad}</p>
            <p className="text-xs text-kx-text-3 mt-1">comprobantes en el período</p>
          </Card>
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <p className="text-xs text-kx-text-3 uppercase tracking-wide">Total Bruto</p>
            <p className="text-2xl font-black text-kx-text dark:text-kx-text mt-1 font-mono">{fmtARS(kpis.totalBruto)}</p>
          </Card>
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <p className="text-xs text-kx-text-3 uppercase tracking-wide">Neto Gravado</p>
            <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1 font-mono">{fmtARS(kpis.totalNeto)}</p>
          </Card>
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <p className="text-xs text-kx-text-3 uppercase tracking-wide">Crédito Fiscal (IVA)</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 font-mono">{fmtARS(kpis.totalIVA)}</p>
          </Card>
        </div>
      )}

      {/* Tabla */}
      {(generated || loading) && (
        <div className="bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b border-kx-border dark:border-kx-border text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2">
                <tr>
                  <th className="p-4 w-28">Tipo</th>
                  <th className="p-4 w-40">Nro. Documento</th>
                  <th className="p-4">Proveedor</th>
                  <th className="p-4 w-28">Fecha</th>
                  <th className="p-4 text-right w-32">Total Bruto</th>
                  <th className="p-4 text-right w-32">Neto Gravado</th>
                  <th className="p-4 text-right w-28">IVA</th>
                  <th className="p-4 w-36">CUIT</th>
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
                ) : compras.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-slate-500 dark:text-kx-text-2">
                      <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-20" />
                      <p>No hay compras en el período seleccionado</p>
                    </td>
                  </tr>
                ) : (
                  paginatedData.map(c => (
                    <tr key={`${c.tipo}-${c.id}`} className="hover:bg-emerald-50/40 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="p-4 text-xs text-slate-500 dark:text-kx-text-2">
                        {TIPO_LABEL[c.tipo] ?? c.tipo}
                      </td>
                      <td className="p-4 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        {c.numero || '—'}
                      </td>
                      <td className="p-4 font-medium text-kx-text dark:text-kx-text">
                        {c.proveedor_nombre}
                      </td>
                      <td className="p-4 text-xs text-slate-500 dark:text-kx-text-2">{formatDateAR(c.fecha)}</td>
                      <td className="p-4 text-right font-bold font-mono text-slate-700 dark:text-kx-text">{fmtARS(c.total)}</td>
                      <td className="p-4 text-right font-mono text-kx-text-2 dark:text-slate-300">{fmtARS(netoDe(c))}</td>
                      <td className="p-4 text-right font-mono text-emerald-600 dark:text-emerald-400">{fmtARS(ivaDe(c))}</td>
                      <td className="p-4 font-mono text-xs text-slate-500 dark:text-kx-text-2">{c.proveedor_cuit || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>

              {generated && compras.length > 0 && !loading && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 dark:border-kx-border bg-kx-surface-2 dark:bg-slate-900/80 font-bold">
                    <td colSpan={4} className="p-4 text-right text-sm text-slate-500 dark:text-kx-text-2 uppercase tracking-wide">
                      TOTALES ({compras.length} comp.)
                    </td>
                    <td className="p-4 text-right font-black text-kx-text dark:text-kx-text font-mono">{fmtARS(kpis.totalBruto)}</td>
                    <td className="p-4 text-right font-black text-blue-600 dark:text-blue-400 font-mono">{fmtARS(kpis.totalNeto)}</td>
                    <td className="p-4 text-right font-black text-emerald-600 dark:text-emerald-400 font-mono">{fmtARS(kpis.totalIVA)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-kx-border">
              <p className="text-xs text-slate-500 dark:text-kx-text-2">
                Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, compras.length)} de {compras.length}
              </p>
              <div className="flex gap-1 items-center">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1} className="h-7 px-2 text-xs">Ant.</Button>
                <span className="h-7 px-3 flex items-center text-xs text-kx-text-2 dark:text-kx-text-2">
                  {page} / {totalPages}
                </span>
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages} className="h-7 px-2 text-xs">Sig.</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ReporteLibroIVACompras;
