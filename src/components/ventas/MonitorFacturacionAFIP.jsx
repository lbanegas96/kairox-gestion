import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, RefreshCw, Loader2, Search, CheckCircle, Clock, AlertTriangle,
  AlertCircle, Minus, FileText, X,
} from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatDateAR } from '@/lib/dateUtils';

// ── Metadatos de cada estado fiscal (canónico = comprobantes.cae_estado) ──────
// Equivalente a los estados del "Manage Electronic Documents" de SAP:
// no_aplica≈Not Relevant, pendiente≈New/Processing, error≈Error,
// error_definitivo≈Manual review, emitido≈Confirmed.
const ESTADOS = {
  emitido:          { label: 'Emitido',         icon: CheckCircle,   badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', dot: 'bg-emerald-500' },
  pendiente:        { label: 'En cola',         icon: Clock,         badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',       dot: 'bg-amber-500' },
  error:            { label: 'Error de datos',  icon: AlertTriangle, badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',                dot: 'bg-red-500' },
  error_definitivo: { label: 'Revisión manual', icon: AlertCircle,   badge: 'bg-rose-200 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',            dot: 'bg-rose-600' },
  no_aplica:        { label: 'No relevante',    icon: Minus,         badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',           dot: 'bg-slate-400' },
};

// Estados sobre los que tiene sentido reintentar (nunca 'emitido' ni 'no_aplica').
const REINTENTABLES = ['error', 'error_definitivo', 'pendiente'];
// Estados por defecto en el filtro: todo lo fiscal, ocultando 'no_aplica'.
const ESTADOS_DEFAULT = ['emitido', 'pendiente', 'error', 'error_definitivo'];

const money = (n) => (n == null ? '—' : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n));
const tipoLabel = (row) => {
  const base = row.tipo === 'nota_credito' ? 'NC' : 'FC';
  return row.tipo_comprobante_afip ? `${base} ${row.tipo_comprobante_afip}` : base;
};

const EstadoBadge = ({ estado }) => {
  const meta = ESTADOS[estado] ?? ESTADOS.no_aplica;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>
      <Icon className="w-3 h-3" /> {meta.label}
    </span>
  );
};

/**
 * Monitor de Facturación AFIP — vista única de TODOS los comprobantes con su
 * estado fiscal (emitido / en cola / error / revisión manual / no relevante),
 * con filtros y acciones masivas. Reemplaza la vieja lista "Facturas con Error
 * CAE" (que solo mostraba lo roto). Inspirado en el eDocument Cockpit de SAP.
 *
 * Fetching vía useQuery sobre la vista `v_facturas_arca_monitor` (security_invoker,
 * scoped a la empresa por RLS). Las acciones (reintentar / marcar resuelta) van por
 * RPC atómica — nunca .update() suelto desde el front.
 */
const MonitorFacturacionAFIP = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const empresaId = user?.empresa_id;

  // Filtros
  const hoy = new Date();
  const desde30 = new Date(hoy.getTime() - 30 * 86400000);
  const [fechaDesde, setFechaDesde] = useState(desde30.toISOString().slice(0, 10));
  const [fechaHasta, setFechaHasta] = useState(hoy.toISOString().slice(0, 10));
  const [estadosActivos, setEstadosActivos] = useState(new Set(ESTADOS_DEFAULT));
  const [tipoComp, setTipoComp] = useState('all'); // all | A | B | C
  const [search, setSearch] = useState('');

  // Selección múltiple + estado de acciones
  const [seleccion, setSeleccion] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [confirmResuelta, setConfirmResuelta] = useState(null);

  const queryKey = ['monitor_afip', empresaId, fechaDesde, fechaHasta];
  const { data: rows = [], isLoading, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      let q = supabase
        .from('v_facturas_arca_monitor')
        .select('*')
        .eq('empresa_id', empresaId)
        .order('fecha', { ascending: false })
        .limit(1000);
      if (fechaDesde) q = q.gte('fecha', fechaDesde);
      if (fechaHasta) q = q.lte('fecha', `${fechaHasta}T23:59:59.999`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  // KPIs sobre TODO lo traído (por estado fiscal)
  const kpis = useMemo(() => {
    const c = { total: rows.length, emitido: 0, pendiente: 0, error: 0, error_definitivo: 0, no_aplica: 0 };
    for (const r of rows) if (c[r.cae_estado] != null) c[r.cae_estado] += 1;
    return c;
  }, [rows]);

  // Filtrado client-side (estado + tipo + búsqueda)
  const filtradas = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!estadosActivos.has(r.cae_estado)) return false;
      if (tipoComp !== 'all' && r.tipo_comprobante_afip !== tipoComp) return false;
      if (term) {
        const hay = `${r.numero_venta ?? ''} ${r.cliente_nombre ?? ''} ${r.numero_afip ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, estadosActivos, tipoComp, search]);

  const elegibles = useMemo(
    () => filtradas.filter((r) => REINTENTABLES.includes(r.cae_estado)),
    [filtradas],
  );
  const seleccionadasElegibles = elegibles.filter((r) => seleccion.has(r.comprobante_id));
  const allElegiblesSeleccionadas = elegibles.length > 0 && seleccionadasElegibles.length === elegibles.length;

  // ── Acciones ────────────────────────────────────────────────────────────────
  const toggleEstado = (e) => {
    setEstadosActivos((prev) => {
      const next = new Set(prev);
      next.has(e) ? next.delete(e) : next.add(e);
      return next;
    });
  };

  const toggleFila = (id) => {
    setSeleccion((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleTodas = () => {
    setSeleccion((prev) => {
      if (allElegiblesSeleccionadas) return new Set();
      const next = new Set(prev);
      elegibles.forEach((r) => next.add(r.comprobante_id));
      return next;
    });
  };

  const invalidar = () => qc.invalidateQueries({ queryKey: ['monitor_afip', empresaId] });

  const reintentarLote = async (ids) => {
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const { data, error } = await supabase.rpc('reintentar_caes_lote', { p_comprobante_ids: ids });
      if (error) throw error;
      const n = data ?? 0;
      toast({
        title: n > 0 ? `${n} comprobante${n === 1 ? '' : 's'} reencolado${n === 1 ? '' : 's'}` : 'Nada para reencolar',
        description: n > 0 ? 'El worker los procesará en los próximos minutos.' : 'Los seleccionados ya estaban emitidos o no aplican.',
        className: 'bg-green-600 text-white border-green-500',
      });
      setSeleccion(new Set());
      invalidar();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setBulkBusy(false);
    }
  };

  const reintentarFila = async (row) => {
    setRowBusy(row.comprobante_id);
    try {
      const { error } = await supabase.rpc('reintentar_caes_lote', { p_comprobante_ids: [row.comprobante_id] });
      if (error) throw error;
      toast({ title: 'Comprobante reencolado', description: 'El worker lo procesará en los próximos minutos.', className: 'bg-green-600 text-white border-green-500' });
      invalidar();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setRowBusy(null);
    }
  };

  const marcarResuelta = async (row) => {
    setRowBusy(row.comprobante_id);
    try {
      const { error } = await supabase.rpc('marcar_cae_resuelto_manual', { p_comprobante_id: row.comprobante_id });
      if (error) throw error;
      toast({ title: 'Marcada como resuelta', description: 'La factura quedó registrada como emitida.', className: 'bg-green-600 text-white border-green-500' });
      invalidar();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setRowBusy(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
            <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Monitor de Facturación AFIP</h3>
            <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
              Estado electrónico de todos los comprobantes. El worker reintenta los pendientes cada 5 minutos.
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-lg border kairox-border hover:bg-slate-100 dark:hover:bg-kx-surface-2 transition-colors shrink-0"
          title="Recargar"
        >
          <RefreshCw className={`w-4 h-4 text-kx-text-2 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg border kairox-border bg-kx-surface-2 dark:bg-slate-900/50 px-3 py-2">
          <p className="text-xs text-kx-text-3">Total período</p>
          <p className="text-xl font-bold text-kx-text tabular-nums">{kpis.total}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2">
          <p className="text-xs text-emerald-700 dark:text-emerald-400">Emitidas</p>
          <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{kpis.emitido}</p>
        </div>
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
          <p className="text-xs text-amber-700 dark:text-amber-400">En cola</p>
          <p className="text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">{kpis.pendiente}</p>
        </div>
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2">
          <p className="text-xs text-red-700 dark:text-red-400">Con error</p>
          <p className="text-xl font-bold text-red-700 dark:text-red-400 tabular-nums">{kpis.error + kpis.error_definitivo}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="block text-xs text-kx-text-3 mb-1">Desde</label>
          <Input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)}
            className="h-8 w-40 text-xs dark:bg-kx-surface dark:border-kx-border" />
        </div>
        <div>
          <label className="block text-xs text-kx-text-3 mb-1">Hasta</label>
          <Input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)}
            className="h-8 w-40 text-xs dark:bg-kx-surface dark:border-kx-border" />
        </div>
        <div>
          <label className="block text-xs text-kx-text-3 mb-1">Tipo AFIP</label>
          <Select value={tipoComp} onValueChange={setTipoComp}>
            <SelectTrigger className="h-8 w-32 text-xs dark:bg-kx-surface dark:border-kx-border dark:text-kx-text">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="A">Factura A</SelectItem>
              <SelectItem value="B">Factura B</SelectItem>
              <SelectItem value="C">Factura C</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-kx-text-3 mb-1">Buscar</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-kx-text-3" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nº, cliente o Nº AFIP"
              className="h-8 pl-8 text-xs dark:bg-kx-surface dark:border-kx-border" />
          </div>
        </div>
      </div>

      {/* Chips de estado (toggle) */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {Object.entries(ESTADOS).map(([key, meta]) => {
          const activo = estadosActivos.has(key);
          const count = kpis[key] ?? 0;
          return (
            <button
              key={key}
              onClick={() => toggleEstado(key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                activo
                  ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                  : 'border-kx-border text-kx-text-3 hover:bg-slate-50 dark:hover:bg-kx-surface-2'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
              {meta.label}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Barra de acción masiva */}
      {seleccion.size > 0 && (
        <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">
            {seleccion.size} seleccionada{seleccion.size === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => reintentarLote([...seleccion])} disabled={bulkBusy}
              className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white">
              {bulkBusy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              Reintentar seleccionadas
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSeleccion(new Set())} className="h-7 text-xs">
              <X className="w-3 h-3 mr-1" /> Limpiar
            </Button>
          </div>
        </div>
      )}

      {/* Tabla */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-6"><Loader2 className="w-4 h-4 animate-spin" /> Cargando comprobantes...</div>
      ) : filtradas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 text-kx-text-3 py-8 text-sm">
          <FileText className="w-8 h-8 opacity-40" />
          <span>No hay comprobantes que coincidan con los filtros.</span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-kx-border">
          <table className="w-full text-sm">
            <thead className="bg-kx-surface-2 dark:bg-slate-900/50">
              <tr className="text-left text-xs text-kx-text-3 uppercase tracking-wide">
                <th className="px-3 py-2 w-10">
                  <Checkbox
                    checked={allElegiblesSeleccionadas}
                    onCheckedChange={toggleTodas}
                    disabled={elegibles.length === 0}
                    aria-label="Seleccionar todas las reintentables"
                  />
                </th>
                <th className="px-3 py-2">Comprobante</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Nº AFIP</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-center">Intentos</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((row) => {
                const elegible = REINTENTABLES.includes(row.cae_estado);
                const esError = ['error', 'error_definitivo'].includes(row.cae_estado);
                const busy = rowBusy === row.comprobante_id;
                return (
                  <tr key={row.comprobante_id} className="border-t border-kx-border hover:bg-kx-surface-2/50">
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={seleccion.has(row.comprobante_id)}
                        onCheckedChange={() => toggleFila(row.comprobante_id)}
                        disabled={!elegible}
                        aria-label={`Seleccionar ${row.numero_venta}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-kx-text font-medium whitespace-nowrap">{row.numero_venta ?? '—'}</td>
                    <td className="px-3 py-2 text-kx-text-2 text-xs whitespace-nowrap">{tipoLabel(row)}</td>
                    <td className="px-3 py-2 text-kx-text-2 whitespace-nowrap">{row.fecha ? formatDateAR(row.fecha) : '—'}</td>
                    <td className="px-3 py-2 text-kx-text-2 max-w-[160px] truncate">{row.cliente_nombre ?? 'Consumidor Final'}</td>
                    <td className="px-3 py-2 text-kx-text text-right font-medium tabular-nums whitespace-nowrap">{money(row.total)}</td>
                    <td className="px-3 py-2 text-kx-text-2 font-mono text-xs whitespace-nowrap">{row.numero_afip ?? '—'}</td>
                    <td className="px-3 py-2"><EstadoBadge estado={row.cae_estado} /></td>
                    <td className="px-3 py-2 text-center text-kx-text-2 text-xs tabular-nums">
                      {row.intentos != null ? `${row.intentos}/${row.max_intentos ?? 5}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {elegible && (
                          <button
                            onClick={() => reintentarFila(row)}
                            disabled={busy}
                            className="text-xs px-2 py-1 rounded border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 transition-colors"
                          >
                            {busy ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Reintentar'}
                          </button>
                        )}
                        <button
                          onClick={() => setDetalle(row)}
                          className="text-xs px-2 py-1 rounded border border-kx-border text-kx-text-2 hover:bg-slate-100 dark:hover:bg-kx-surface-2 transition-colors"
                        >
                          Detalle
                        </button>
                        {esError && (
                          <button
                            onClick={() => setConfirmResuelta(row)}
                            disabled={busy}
                            className="text-xs px-2 py-1 rounded border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 transition-colors"
                          >
                            {busy ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Resuelta'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Drill-down: detalle del comprobante */}
      <Dialog open={!!detalle} onOpenChange={(o) => !o && setDetalle(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              {detalle?.numero_venta ?? 'Comprobante'}
            </DialogTitle>
            <DialogDescription>Detalle del estado electrónico ante AFIP/ARCA.</DialogDescription>
          </DialogHeader>
          {detalle && (
            <div className="space-y-3 mt-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Estado"><EstadoBadge estado={detalle.cae_estado} /></Campo>
                <Campo label="Tipo">{tipoLabel(detalle)}</Campo>
                <Campo label="Fecha">{detalle.fecha ? formatDateAR(detalle.fecha) : '—'}</Campo>
                <Campo label="Total"><span className="tabular-nums">{money(detalle.total)}</span></Campo>
                <Campo label="Cliente">{detalle.cliente_nombre ?? 'Consumidor Final'}</Campo>
                <Campo label="Intentos">{detalle.intentos != null ? `${detalle.intentos}/${detalle.max_intentos ?? 5}` : '—'}</Campo>
                <Campo label="Nº AFIP"><span className="font-mono">{detalle.numero_afip ?? '—'}</span></Campo>
                <Campo label="CAE"><span className="font-mono">{detalle.cae ?? '—'}</span></Campo>
                <Campo label="Venc. CAE">{detalle.cae_vencimiento ? formatDateAR(detalle.cae_vencimiento) : '—'}</Campo>
                <Campo label="Estado cola">{detalle.estado_cola ?? '—'}</Campo>
              </div>
              {(detalle.error_afip || detalle.error_cola) && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">Último error</p>
                  <pre className="text-xs text-red-800 dark:text-red-300 whitespace-pre-wrap break-words font-mono">
                    {detalle.error_afip ?? detalle.error_cola}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmación antes de marcar "Resuelta" — acción irreversible: el */}
      {/* comprobante queda 'emitido' sin CAE/Nº AFIP; sólo tiene sentido si */}
      {/* el usuario ya lo emitió por fuera (portal ARCA directo). */}
      <AlertDialog open={!!confirmResuelta} onOpenChange={(o) => !o && setConfirmResuelta(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Marcar como resuelta {confirmResuelta?.numero_venta}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción marca el comprobante como <strong>Emitido</strong> ante AFIP <strong>sin CAE ni Nº AFIP</strong>. Sólo tiene sentido si ya emitiste este comprobante <strong>por fuera del sistema</strong> (por ejemplo, desde el portal AFIP/ARCA directo).
              <br /><br />
              Si en cambio querés reintentar la emisión automática, cancelá y usá "Reintentar".
              <br /><br />
              La acción es <strong>irreversible</strong> desde esta pantalla.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const row = confirmResuelta;
                setConfirmResuelta(null);
                if (row) marcarResuelta(row);
              }}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              Sí, marcar como resuelta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const Campo = ({ label, children }) => (
  <div>
    <p className="text-xs text-kx-text-3 mb-0.5">{label}</p>
    <div className="text-kx-text">{children}</div>
  </div>
);

export default MonitorFacturacionAFIP;
