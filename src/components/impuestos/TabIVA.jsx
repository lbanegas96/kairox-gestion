import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search, RefreshCw, TrendingUp, TrendingDown, Scale, BookOpen, ArrowRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { getTodayAR } from '@/lib/dateUtils';
import { useToast } from '@/components/ui/use-toast';
import ReporteLibroIVACompras from '@/components/reportes/ReporteLibroIVACompras';

export const ALICUOTAS_OPCIONES = [
  { value: '21',         label: '21% — General' },
  { value: '10.5',       label: '10.5% — Reducida' },
  { value: '0',          label: '0% — Gravado al 0%' },
  { value: 'exento',     label: 'Exento' },
  { value: 'no_gravado', label: 'No Gravado' },
];

const fmtARS = (n) =>
  `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function TabIVA({ onNavigate }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const todayStr = getTodayAR();
  const firstOfMonthStr = todayStr.slice(0, 7) + '-01';

  const [showLibroCompras, setShowLibroCompras] = useState(false);

  // ── Posición IVA ───────────────────────────────────────────────────────────
  const [fechaDesde, setFechaDesde] = useState(firstOfMonthStr);
  const [fechaHasta, setFechaHasta] = useState(todayStr);
  const [posicion, setPosicion] = useState({ debito: 0, credito: 0 });
  const [loadingPos, setLoadingPos] = useState(false);

  const fetchPosicion = useCallback(async () => {
    if (!user?.empresa_id) return;
    setLoadingPos(true);
    try {
      const { data: ventas } = await supabase
        .from('comprobantes')
        .select('total, iva_discriminado, tipo')
        .eq('empresa_id', user.empresa_id)
        .eq('tipo', 'venta')
        .gte('fecha', `${fechaDesde}T00:00:00`)
        .lte('fecha', `${fechaHasta}T23:59:59`);
      const { data: compras } = await supabase
        .from('compras')
        .select('total, iva_discriminado')
        .eq('empresa_id', user.empresa_id)
        .gte('fecha', `${fechaDesde}T00:00:00`)
        .lte('fecha', `${fechaHasta}T23:59:59`);

      const ivaDe = (r) => r.iva_discriminado != null
        ? Number(r.iva_discriminado)
        : (Number(r.total) - Number(r.total) / 1.21);

      const debito  = (ventas ?? []).reduce((s, v) => s + ivaDe(v), 0);
      const credito = (compras ?? []).reduce((s, c) => s + ivaDe(c), 0);
      setPosicion({ debito, credito });
    } finally {
      setLoadingPos(false);
    }
  }, [user?.empresa_id, fechaDesde, fechaHasta]);

  useEffect(() => { fetchPosicion(); }, [fetchPosicion]);

  const posicionNeta = posicion.debito - posicion.credito; // + = a pagar, - = a favor

  // ── Alícuotas por producto ──────────────────────────────────────────────────
  const [productos, setProductos] = useState([]);
  const [loadingProd, setLoadingProd] = useState(true);
  const [search, setSearch] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);

  const fetchProductos = useCallback(async () => {
    if (!user?.empresa_id) return;
    setLoadingProd(true);
    const { data } = await supabase
      .from('productos')
      .select('id, nombre, codigo_sku, precio_venta, alicuota_iva')
      .eq('empresa_id', user.empresa_id)
      .eq('activo', true)
      .order('nombre');
    setProductos(data ?? []);
    setLoadingProd(false);
  }, [user?.empresa_id]);

  useEffect(() => { fetchProductos(); }, [fetchProductos]);

  const productosFiltrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter(p =>
      p.nombre?.toLowerCase().includes(q) || p.codigo_sku?.toLowerCase().includes(q));
  }, [productos, search]);

  const cambiarAlicuota = async (producto, nuevaAlicuota) => {
    // Optimista
    setProductos(prev => prev.map(p => p.id === producto.id ? { ...p, alicuota_iva: nuevaAlicuota } : p));
    const { error } = await supabase
      .from('productos')
      .update({ alicuota_iva: nuevaAlicuota })
      .eq('id', producto.id)
      .eq('empresa_id', user.empresa_id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      fetchProductos();
    }
  };

  const aplicar21ATodos = async () => {
    setConfirmAll(false);
    const { error } = await supabase
      .from('productos')
      .update({ alicuota_iva: '21' })
      .eq('empresa_id', user.empresa_id)
      .eq('activo', true);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Listo', description: 'Todos los productos quedaron con IVA 21%.' });
    fetchProductos();
  };

  if (showLibroCompras) {
    return <ReporteLibroIVACompras onBack={() => setShowLibroCompras(false)} />;
  }

  return (
    <div className="space-y-6">
      {/* ── Posición IVA mensual ── */}
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Posición IVA del período</h3>
            <p className="text-sm text-slate-500 dark:text-kx-text-2">Débito (ventas) menos crédito (compras).</p>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">Desde</Label>
              <Input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} className="h-9 w-36" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">Hasta</Label>
              <Input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} className="h-9 w-36" />
            </div>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={fetchPosicion} disabled={loadingPos}>
              <RefreshCw className={`h-4 w-4 ${loadingPos ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <div className="flex items-center gap-2 text-xs text-kx-text-3 uppercase tracking-wide">
              <TrendingUp className="h-4 w-4 text-rose-500" /> Débito Fiscal
            </div>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1 font-mono">{fmtARS(posicion.debito)}</p>
            <p className="text-xs text-kx-text-3 mt-1">IVA de ventas</p>
          </Card>
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <div className="flex items-center gap-2 text-xs text-kx-text-3 uppercase tracking-wide">
              <TrendingDown className="h-4 w-4 text-emerald-500" /> Crédito Fiscal
            </div>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 font-mono">{fmtARS(posicion.credito)}</p>
            <p className="text-xs text-kx-text-3 mt-1">IVA de compras</p>
          </Card>
          <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
            <div className="flex items-center gap-2 text-xs text-kx-text-3 uppercase tracking-wide">
              <Scale className="h-4 w-4 text-blue-500" /> Posición del mes
            </div>
            <p className={`text-2xl font-black mt-1 font-mono ${posicionNeta > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {fmtARS(Math.abs(posicionNeta))}
            </p>
            <p className="text-xs text-kx-text-3 mt-1">
              {posicionNeta > 0 ? 'Saldo a pagar' : posicionNeta < 0 ? 'Saldo a favor' : 'Equilibrado'}
            </p>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          <Button variant="outline" size="sm" onClick={() => onNavigate?.('reportes', { initialView: 'libro_iva' })}>
            <BookOpen className="h-4 w-4 mr-1.5" /> Ver Libro IVA Ventas <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowLibroCompras(true)}>
            <BookOpen className="h-4 w-4 mr-1.5" /> Ver Libro IVA Compras <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </div>

      {/* ── Alícuotas por producto ── */}
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Alícuota de IVA por producto</h3>
            <p className="text-sm text-slate-500 dark:text-kx-text-2">Se aplica automáticamente en cada venta.</p>
          </div>
          <div className="flex items-end gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-kx-text-3" />
              <Input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nombre o SKU…" className="h-9 w-56 pl-8" />
            </div>
            <Button variant="outline" size="sm" className="h-9" onClick={() => setConfirmAll(true)}>
              Aplicar 21% a todos
            </Button>
          </div>
        </div>

        <div className="bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b border-kx-border dark:border-kx-border text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2 sticky top-0">
                <tr>
                  <th className="p-3">Producto</th>
                  <th className="p-3 w-32">SKU</th>
                  <th className="p-3 text-right w-32">Precio</th>
                  <th className="p-3 w-48">Alícuota IVA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loadingProd ? (
                  <tr><td colSpan={4} className="p-8 text-center text-kx-text-3"><RefreshCw className="h-5 w-5 animate-spin mx-auto" /></td></tr>
                ) : productosFiltrados.length === 0 ? (
                  <tr><td colSpan={4} className="p-10 text-center text-slate-500 dark:text-kx-text-2">Sin productos</td></tr>
                ) : (
                  productosFiltrados.map(p => (
                    <tr key={p.id} className="hover:bg-blue-50/40 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="p-3 font-medium text-kx-text dark:text-kx-text">{p.nombre}</td>
                      <td className="p-3 font-mono text-xs text-slate-500 dark:text-kx-text-2">{p.codigo_sku || '—'}</td>
                      <td className="p-3 text-right font-mono text-kx-text-2 dark:text-slate-300">{fmtARS(p.precio_venta)}</td>
                      <td className="p-3">
                        <Select value={p.alicuota_iva ?? '21'} onValueChange={v => cambiarAlicuota(p, v)}>
                          <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ALICUOTAS_OPCIONES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Aplicar IVA 21% a todos los productos?</AlertDialogTitle>
            <AlertDialogDescription>
              Esto sobrescribe la alícuota de IVA de <strong>todos</strong> los productos activos a 21%.
              No afecta ventas ya emitidas. Esta acción no se puede deshacer en lote.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={aplicar21ATodos} className="bg-blue-600 hover:bg-blue-700">Aplicar a todos</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default TabIVA;
