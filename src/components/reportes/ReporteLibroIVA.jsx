import { useState, useCallback, useMemo } from 'react';
import {
  BookOpen, Calendar, Download, RefreshCw, Check, Clock,
  AlertTriangle, ArrowLeft, AlertCircle, FileSpreadsheet, MessageCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useConfig } from '@/contexts/ConfigContext';
import { supabase } from '@/lib/customSupabaseClient';
import { getTodayAR, formatDateAR } from '@/lib/dateUtils';
import { useToast } from '@/components/ui/use-toast';
import { generatePDF } from '@/lib/pdfUtils';
import { exportReporte } from '@/lib/excelUtils';

const PAGE_SIZE = 100;

const ALICUOTA_LABELS = {
  '21':         '21%',
  '10.5':       '10,5%',
  '0':          '0%',
  'exento':     'Exento',
  'no_gravado': 'No Gravado',
};

// Usa iva_discriminado real (calculado por crear_venta según la alícuota de cada
// ítem — 21/10.5/0/exento). Fallback a estimación /1.21 solo para comprobantes
// viejos sin el campo poblado (previo a migration 033).
// Las Notas de Crédito emitidas se guardan con montos POSITIVOS en `comprobantes`,
// pero en el Libro IVA Ventas RESTAN del IVA débito / neto / bruto (revierten una
// venta). Sin este signo, los totales sumaban las NC y sobreestimaban el IVA débito
// (hallazgo auditoría sesión 60). Se aplica a IVA, neto y bruto por igual.
function signoComprobante(c) {
  return c.tipo === 'nota_credito' ? -1 : 1;
}
function ivaDeComprobante(c) {
  const base = c.iva_discriminado != null
    ? Number(c.iva_discriminado)
    : Number(c.total) - Number(c.total) / 1.21;
  return signoComprobante(c) * base;
}
function netoDeComprobante(c) {
  const base = c.neto_gravado != null
    ? Number(c.neto_gravado)
    : Number(c.total) / 1.21;
  return signoComprobante(c) * base;
}
function brutoDeComprobante(c) {
  return signoComprobante(c) * Number(c.total);
}

function ReporteLibroIVA({ onBack }) {
  const { user } = useAuth();
  const { config } = useConfig();
  const { toast } = useToast();

  const todayStr = getTodayAR();
  const firstOfMonthStr = todayStr.slice(0, 7) + '-01';

  const [fechaDesde, setFechaDesde] = useState(firstOfMonthStr);
  const [fechaHasta, setFechaHasta] = useState(todayStr);
  const [comprobantes, setComprobantes] = useState([]);
  const [itemsPorComprobante, setItemsPorComprobante] = useState({});
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [page, setPage] = useState(1);

  const fetchLibroIVA = useCallback(async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('comprobantes')
        .select(`
          id, tipo, numero_venta, numero_afip, fecha,
          cliente_nombre, cliente_id,
          tipo_comprobante_afip, cae, cae_estado, cae_vencimiento,
          total, moneda, tipo_cambio_tasa,
          estado_pago, forma_pago, iva_discriminado, neto_gravado
        `)
        .eq('empresa_id', user.empresa_id)
        .in('cae_estado', ['emitido', 'pendiente', 'error'])
        .gte('fecha', `${fechaDesde}T00:00:00`)
        .lte('fecha', `${fechaHasta}T23:59:59`)
        .order('fecha', { ascending: true })
        .order('numero_afip', { ascending: true });

      if (error) throw error;

      // CUIT/DNI del receptor — dato real que ya existe en clientes.documento
      // pero el reporte no lo traía (Libro IVA Compras sí muestra el CUIT del
      // proveedor; Ventas no mostraba el del cliente, inconsistencia real).
      // Traído en 2 pasos (sin embedded select) — mismo patrón que
      // ReporteLibroIVACompras, no depende de la FK estar bien configurada.
      const clienteIds = [...new Set((data ?? []).map(c => c.cliente_id).filter(Boolean))];
      let clienteMap = {};
      if (clienteIds.length > 0) {
        const { data: clientesData } = await supabase
          .from('clientes').select('id, documento')
          .in('id', clienteIds);
        clienteMap = Object.fromEntries((clientesData ?? []).map(cl => [cl.id, cl.documento]));
      }
      const merged = (data ?? []).map(c => ({ ...c, cliente_documento: clienteMap[c.cliente_id] || '' }));

      // Items por comprobante — para el resumen por alícuota (Neto/IVA
      // discriminados por 21%/10.5%/exento, lo que un contador necesita para
      // la declaración de IVA real, no un único "IVA 21%" que mezcla todo).
      const compIds = merged.map(c => c.id);
      let itemsMap = {};
      if (compIds.length > 0) {
        const { data: itemsData } = await supabase
          .from('comprobante_items')
          .select('comprobante_id, subtotal, alicuota_iva')
          .in('comprobante_id', compIds);
        itemsMap = {};
        (itemsData ?? []).forEach(it => {
          if (!itemsMap[it.comprobante_id]) itemsMap[it.comprobante_id] = [];
          itemsMap[it.comprobante_id].push(it);
        });
      }

      setItemsPorComprobante(itemsMap);
      setComprobantes(merged);
      setGenerated(true);
      setPage(1);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user?.empresa_id, fechaDesde, fechaHasta, toast]);

  const kpis = useMemo(() => {
    const emitidos  = comprobantes.filter(c => c.cae_estado === 'emitido');
    const pendientes = comprobantes.filter(c => c.cae_estado === 'pendiente' || c.cae_estado === 'error');
    const totalNeto   = emitidos.reduce((sum, c) => sum + netoDeComprobante(c), 0);
    const totalIVA    = emitidos.reduce((sum, c) => sum + ivaDeComprobante(c), 0);
    const totalBruto  = emitidos.reduce((sum, c) => sum + brutoDeComprobante(c), 0);
    return { emitidos: emitidos.length, pendientes: pendientes.length, totalNeto, totalIVA, totalBruto };
  }, [comprobantes]);

  const comprobantesFiltrados = useMemo(() => {
    return comprobantes.filter(c => {
      if (filtroTipo !== 'todos' && c.tipo_comprobante_afip !== filtroTipo) return false;
      if (filtroEstado !== 'todos' && c.cae_estado !== filtroEstado) return false;
      return true;
    });
  }, [comprobantes, filtroTipo, filtroEstado]);

  // Resumen por alícuota — lo que un contador realmente necesita para la
  // declaración de IVA (totales por 21%/10.5%/exento del período), no un
  // único "IVA 21%" que mezcla todas las tasas. Reparte el neto/IVA REAL de
  // cada comprobante (netoDeComprobante/ivaDeComprobante, siempre correcto)
  // proporcionalmente al peso de cada alícuota entre sus items — funciona
  // aunque dos modales de venta distintos usen convenciones distintas para
  // `comprobante_items.subtotal` (neto vs. bruto), porque el reparto es una
  // proporción DENTRO de un mismo comprobante, donde todos los items
  // comparten siempre la misma convención (se cargan juntos, en la misma
  // operación). Solo comprobantes con CAE emitido, igual criterio que kpis.
  const alicuotaResumen = useMemo(() => {
    const buckets = {};
    const addTo = (key, neto, iva) => {
      buckets[key] = buckets[key] || { neto: 0, iva: 0 };
      buckets[key].neto += neto;
      buckets[key].iva += iva;
    };
    comprobantesFiltrados
      .filter(c => c.cae_estado === 'emitido')
      .forEach(c => {
        const items = itemsPorComprobante[c.id] || [];
        const netoTotal = netoDeComprobante(c);
        const ivaTotal = ivaDeComprobante(c);
        const totalSubtotal = items.reduce((s, it) => s + Number(it.subtotal || 0), 0);
        if (items.length === 0 || totalSubtotal === 0) {
          // Sin detalle de items (comprobantes viejos) — mismo fallback 21%
          // que ya usa netoDeComprobante/ivaDeComprobante.
          addTo('21', netoTotal, ivaTotal);
          return;
        }
        const porAlicuota = {};
        items.forEach(it => {
          const key = it.alicuota_iva || '21';
          porAlicuota[key] = (porAlicuota[key] || 0) + Number(it.subtotal || 0);
        });
        Object.entries(porAlicuota).forEach(([key, subtotalAlicuota]) => {
          const share = subtotalAlicuota / totalSubtotal;
          addTo(key, netoTotal * share, ivaTotal * share);
        });
      });
    return buckets;
  }, [comprobantesFiltrados, itemsPorComprobante]);

  const totalPages = Math.max(1, Math.ceil(comprobantesFiltrados.length / PAGE_SIZE));
  const paginatedData = comprobantesFiltrados.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const fmtARS = (n) =>
    `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Columnas compartidas por PDF/Excel — reemplaza el CSV artesanal de antes,
  // mismo pipeline que ya usa el resto del módulo de Reportería.
  const columns = useMemo(() => [
    { header: 'Nro. Comprobante', key: 'numero', align: 'left', pdfRender: (c) => String(c.numero_afip ?? c.numero_venta ?? '-') },
    { header: 'Tipo', key: 'tipo_comprobante_afip', align: 'center', pdfRender: (c) => (c.tipo === 'nota_credito' ? 'NC-' : 'F-') + (c.tipo_comprobante_afip ?? '') },
    { header: 'Fecha', key: 'fecha', align: 'left', pdfRender: (c) => formatDateAR(c.fecha) },
    { header: 'Cliente', key: 'cliente_nombre', align: 'left', pdfRender: (c) => c.cliente_nombre || 'Consumidor Final' },
    { header: 'CUIT/DNI', key: 'cliente_documento', align: 'left', pdfRender: (c) => c.cliente_documento || '-' },
    { header: 'Total Bruto', key: 'bruto', align: 'right', pdfRender: (c) => fmtARS(brutoDeComprobante(c)) },
    { header: 'Neto Gravado', key: 'neto', align: 'right', pdfRender: (c) => fmtARS(netoDeComprobante(c)) },
    { header: 'IVA', key: 'iva', align: 'right', pdfRender: (c) => fmtARS(ivaDeComprobante(c)) },
    { header: 'Estado CAE', key: 'cae_estado', align: 'center', pdfRender: (c) => c.cae_estado ?? '-' },
  ], []);

  const totalsRow = useMemo(() => ([
    { content: `TOTALES (${comprobantesFiltrados.length} comp.)`, colSpan: 5, align: 'right' },
    { content: fmtARS(comprobantesFiltrados.reduce((s, c) => s + brutoDeComprobante(c), 0)), align: 'right' },
    { content: fmtARS(comprobantesFiltrados.reduce((s, c) => s + netoDeComprobante(c), 0)), align: 'right', value: comprobantesFiltrados.reduce((s, c) => s + netoDeComprobante(c), 0) },
    { content: fmtARS(comprobantesFiltrados.reduce((s, c) => s + ivaDeComprobante(c), 0)), align: 'right', value: comprobantesFiltrados.reduce((s, c) => s + ivaDeComprobante(c), 0) },
    { content: '', align: 'center' },
  ]), [comprobantesFiltrados]);

  const resumenAlicuotaMetrics = useMemo(() => Object.entries(alicuotaResumen).map(([key, v]) => ({
    label: `${ALICUOTA_LABELS[key] || key} · Neto / IVA`,
    value: `${fmtARS(v.neto)} / ${fmtARS(v.iva)}`,
  })), [alicuotaResumen]);

  const handleDownloadPDF = async () => {
    try {
      await generatePDF({
        title: 'Libro IVA Ventas',
        startDate: fechaDesde, endDate: fechaHasta,
        columns, data: comprobantesFiltrados, totals: totalsRow,
        filename: 'libro_iva_ventas',
        companyName: config?.nombre_empresa || 'KAIROX Gestión',
        logoUrl: config?.logo_base64 || null,
        summaryMetrics: resumenAlicuotaMetrics.length ? resumenAlicuotaMetrics : undefined,
      });
      toast({ title: 'Éxito', description: 'PDF generado correctamente.', className: 'bg-green-600 text-white' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Falló la generación del PDF.', variant: 'destructive' });
    }
  };

  const handleDownloadExcel = () => {
    try {
      exportReporte({ title: 'Libro IVA Ventas', columns, data: comprobantesFiltrados, totals: totalsRow, filename: 'libro_iva_ventas' });
      toast({ title: 'Éxito', description: 'Excel generado correctamente.', className: 'bg-green-600 text-white' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Falló la generación del Excel.', variant: 'destructive' });
    }
  };

  const handleShareWhatsApp = () => {
    const lineas = [
      `📊 *Libro IVA Ventas*`,
      `Período: ${fechaDesde} al ${fechaHasta}`,
      `Comprobantes: ${kpis.emitidos} emitidos`,
      `Total Bruto: ${fmtARS(kpis.totalBruto)}`,
      `Neto Gravado: ${fmtARS(kpis.totalNeto)}`,
      `IVA: ${fmtARS(kpis.totalIVA)}`,
      ...resumenAlicuotaMetrics.map(m => `${m.label}: ${m.value}`),
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lineas.join('\n'))}`, '_blank');
  };

  const caeEstadoBadge = (estado) => {
    if (estado === 'emitido')
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"><Check className="w-3 h-3" />Emitido</span>;
    if (estado === 'pendiente')
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"><Clock className="w-3 h-3" />Pendiente</span>;
    if (estado === 'error')
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"><AlertTriangle className="w-3 h-3" />Error</span>;
    return <span className="text-xs text-kx-text-3">{estado}</span>;
  };

  const tipoBadge = (letra, tipoDoc) => {
    if (!letra) return <span className="text-xs text-kx-text-3">—</span>;
    const esNC = tipoDoc === 'nota_credito';
    const colors = {
      A: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      B: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
      C: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    };
    const ncColor = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${esNC ? ncColor : (colors[letra] ?? '')}`}>{esNC ? 'NC' : 'F'}-{letra}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="dark:text-slate-300">
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-blue-600 dark:text-blue-500" />
            Libro IVA Ventas
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
            Comprobantes con CAE por período · IVA discriminado por alícuota real de cada ítem
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
          <div className="space-y-1">
            <Label className="text-xs text-slate-500 dark:text-kx-text-2 font-medium">Tipo</Label>
            <Select value={filtroTipo} onValueChange={v => { setFiltroTipo(v); setPage(1); }}>
              <SelectTrigger className="h-9 w-40 dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los tipos</SelectItem>
                <SelectItem value="A">Solo Factura A</SelectItem>
                <SelectItem value="B">Solo Factura B</SelectItem>
                <SelectItem value="C">Solo Factura C</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-500 dark:text-kx-text-2 font-medium">Estado CAE</Label>
            <Select value={filtroEstado} onValueChange={v => { setFiltroEstado(v); setPage(1); }}>
              <SelectTrigger className="h-9 w-44 dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los estados</SelectItem>
                <SelectItem value="emitido">Con CAE emitido</SelectItem>
                <SelectItem value="pendiente">CAE pendiente</SelectItem>
                <SelectItem value="error">Con error</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={fetchLibroIVA} disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white h-9">
            {loading
              ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" />
              : <Calendar className="h-4 w-4 mr-1.5" />}
            Generar
          </Button>
          {generated && comprobantesFiltrados.length > 0 && (
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

      {/* Aviso simplificación IVA */}
      {generated && (
        <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-400">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            IVA calculado por la <strong>alícuota real de cada ítem</strong> (21%, 10.5%, 0%, exentos).
            Comprobantes previos a la mig.033 usan estimación /1.21 como fallback.
          </span>
        </div>
      )}

      {/* KPI Cards */}
      {generated && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <p className="text-xs text-kx-text-3 uppercase tracking-wide">Emitidos</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
              {kpis.emitidos}
            </p>
            <p className="text-xs text-kx-text-3 mt-1">comprobantes con CAE</p>
          </Card>
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <p className="text-xs text-kx-text-3 uppercase tracking-wide">Total Bruto</p>
            <p className="text-2xl font-black text-kx-text dark:text-kx-text mt-1 font-mono">
              {fmtARS(kpis.totalBruto)}
            </p>
            <p className="text-xs text-kx-text-3 mt-1">comprobantes emitidos</p>
          </Card>
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <p className="text-xs text-kx-text-3 uppercase tracking-wide">Neto Gravado</p>
            <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1 font-mono">
              {fmtARS(kpis.totalNeto)}
            </p>
            <p className="text-xs text-kx-text-3 mt-1">base imponible estimada</p>
          </Card>
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <p className="text-xs text-kx-text-3 uppercase tracking-wide">IVA</p>
            <p className="text-2xl font-black text-violet-600 dark:text-violet-400 mt-1 font-mono">
              {fmtARS(kpis.totalIVA)}
            </p>
            {kpis.pendientes > 0 && (
              <p className="text-xs text-kx-amber mt-1">{kpis.pendientes} sin CAE aún</p>
            )}
          </Card>
        </div>
      )}

      {/* Resumen por alícuota — lo que se necesita para la declaración de IVA real */}
      {generated && resumenAlicuotaMetrics.length > 0 && (
        <div className="bg-kx-surface dark:bg-kx-surface p-4 rounded-xl border border-kx-border dark:border-kx-border shadow-sm">
          <p className="text-xs font-semibold text-kx-text-2 uppercase tracking-wide mb-3">
            Resumen por alícuota (Neto / IVA)
          </p>
          <div className="flex flex-wrap gap-x-8 gap-y-2">
            {Object.entries(alicuotaResumen).map(([key, v]) => (
              <div key={key}>
                <p className="text-xs text-kx-text-3">{ALICUOTA_LABELS[key] || key}</p>
                <p className="text-sm font-bold font-mono text-kx-text dark:text-kx-text">
                  {fmtARS(v.neto)} <span className="text-kx-text-3 font-normal">/</span> {fmtARS(v.iva)}
                </p>
              </div>
            ))}
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
                  <th className="p-4 w-40">Nro. Comprobante</th>
                  <th className="p-4 w-20 text-center">Tipo</th>
                  <th className="p-4 w-28">Fecha</th>
                  <th className="p-4">Cliente</th>
                  <th className="p-4 w-32">CUIT/DNI</th>
                  <th className="p-4 text-right w-32">Total Bruto</th>
                  <th className="p-4 text-right w-32">Neto Gravado</th>
                  <th className="p-4 text-right w-28">IVA</th>
                  <th className="p-4 w-32">CAE</th>
                  <th className="p-4 w-28">Vto. CAE</th>
                  <th className="p-4 w-28 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 11 }).map((_, j) => (
                        <td key={j} className="p-4"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : comprobantesFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-12 text-center text-slate-500 dark:text-kx-text-2">
                      <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-20" />
                      <p>No hay comprobantes con CAE en el período seleccionado</p>
                    </td>
                  </tr>
                ) : (
                  paginatedData.map(c => {
                    const neto = netoDeComprobante(c);
                    const iva  = ivaDeComprobante(c);
                    const todayDate = getTodayAR();
                    const caeVencido = c.cae_vencimiento && c.cae_vencimiento.slice(0, 10) < todayDate;
                    return (
                      <tr key={c.id} className="hover:bg-blue-50/40 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="p-4 font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
                          {c.numero_afip ?? c.numero_venta}
                        </td>
                        <td className="p-4 text-center">{tipoBadge(c.tipo_comprobante_afip, c.tipo)}</td>
                        <td className="p-4 text-xs text-slate-500 dark:text-kx-text-2">
                          {formatDateAR(c.fecha)}
                        </td>
                        <td className="p-4 font-medium text-kx-text dark:text-kx-text">
                          {c.cliente_nombre || <span className="text-kx-text-3 italic">Consumidor Final</span>}
                        </td>
                        <td className="p-4 font-mono text-xs text-slate-500 dark:text-kx-text-2">
                          {c.cliente_documento || <span className="text-slate-300 dark:text-kx-text-2">—</span>}
                        </td>
                        <td className="p-4 text-right font-bold font-mono text-slate-700 dark:text-kx-text">
                          {fmtARS(brutoDeComprobante(c))}
                        </td>
                        <td className="p-4 text-right font-mono text-kx-text-2 dark:text-slate-300">
                          {fmtARS(neto)}
                        </td>
                        <td className="p-4 text-right font-mono text-violet-600 dark:text-violet-400">
                          {fmtARS(iva)}
                        </td>
                        <td className="p-4 font-mono text-xs text-kx-text-2 dark:text-kx-text-2">
                          {c.cae
                            ? <span title={c.cae}>{c.cae.slice(0, 8)}…</span>
                            : <span className="text-slate-300 dark:text-kx-text-2">—</span>
                          }
                        </td>
                        <td className="p-4 text-xs">
                          {c.cae_vencimiento ? (
                            <span className={caeVencido
                              ? 'text-red-600 font-semibold dark:text-red-400'
                              : 'text-slate-500 dark:text-kx-text-2'}>
                              {formatDateAR(c.cae_vencimiento)}
                              {caeVencido && ' ⚠'}
                            </span>
                          ) : <span className="text-slate-300 dark:text-kx-text-2">—</span>}
                        </td>
                        <td className="p-4 text-center">{caeEstadoBadge(c.cae_estado)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {/* Fila de totales */}
              {generated && comprobantesFiltrados.length > 0 && !loading && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 dark:border-kx-border bg-kx-surface-2 dark:bg-slate-900/80 font-bold">
                    <td colSpan={5} className="p-4 text-right text-sm text-slate-500 dark:text-kx-text-2 uppercase tracking-wide">
                      TOTALES ({comprobantesFiltrados.length} comp.)
                    </td>
                    <td className="p-4 text-right font-black text-kx-text dark:text-kx-text font-mono">
                      {fmtARS(comprobantesFiltrados.reduce((s, c) => s + brutoDeComprobante(c), 0))}
                    </td>
                    <td className="p-4 text-right font-black text-blue-600 dark:text-blue-400 font-mono">
                      {fmtARS(comprobantesFiltrados.reduce((s, c) => s + netoDeComprobante(c), 0))}
                    </td>
                    <td className="p-4 text-right font-black text-violet-600 dark:text-violet-400 font-mono">
                      {fmtARS(comprobantesFiltrados.reduce((s, c) => s + ivaDeComprobante(c), 0))}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-kx-border">
              <p className="text-xs text-slate-500 dark:text-kx-text-2">
                Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, comprobantesFiltrados.length)} de {comprobantesFiltrados.length}
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

export default ReporteLibroIVA;
