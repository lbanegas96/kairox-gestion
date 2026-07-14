import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { formatDateAR } from '@/lib/dateUtils';
import {
  Search, Package, Users, ShoppingCart, Receipt,
  DollarSign, LayoutDashboard, Settings, FileText,
  TrendingUp, ArrowRight, Loader2, X, BookOpen, Landmark, ClipboardList
} from 'lucide-react';

const SECCIONES = [
  { id: 'dashboard',       label: 'Dashboard',         icon: LayoutDashboard, keywords: ['inicio', 'home'],                                   permission: 'dashboard' },
  { id: 'pos',             label: 'Punto de Venta',     icon: ShoppingCart,    keywords: ['pos', 'caja', 'cobrar', 'vender', 'venta nueva'],   permission: 'ventas' },
  { id: 'ventas',          label: 'Ventas (Historial)', icon: Receipt,         keywords: ['factura', 'historial', 'comprobante'],              permission: 'ventas' },
  { id: 'productos',       label: 'Inventario',         icon: Package,         keywords: ['stock', 'producto', 'almacen'],                     permission: 'productos' },
  { id: 'compras',         label: 'Compras',            icon: ShoppingCart,    keywords: ['proveedor', 'comprar'],                             permission: 'compras' },
  { id: 'caja',            label: 'Caja',               icon: DollarSign,      keywords: ['efectivo', 'dinero', 'sesion'],                     permission: 'caja' },
  { id: 'clientes',        label: 'Clientes',           icon: Users,           keywords: ['cliente', 'contacto'],                              permission: 'clientes' },
  { id: 'cotizaciones',    label: 'Cotizaciones',       icon: FileText,        keywords: ['presupuesto', 'cotizar'],                           permission: 'ventas' },
  { id: 'ordenes_compra',  label: 'Órdenes de Compra',  icon: ShoppingCart,    keywords: ['oc', 'orden', 'pedido'],                            permission: 'compras' },
  { id: 'cuentacorriente', label: 'Cuenta Corriente',   icon: TrendingUp,      keywords: ['deuda', 'credito', 'saldo'],                        permission: 'cuentacorriente' },
  { id: 'plan_cuentas',    label: 'Contabilidad',       icon: BookOpen,        keywords: ['contabilidad', 'cuentas', 'asiento', 'balance', 'diario'], permission: 'configuracion' },
  { id: 'reportes',        label: 'Reportes',           icon: FileText,        keywords: ['reporte', 'informe', 'pdf'],                        permission: 'reportes' },
  { id: 'configuracion',   label: 'Configuración',      icon: Settings,        keywords: ['config', 'empresa', 'logo'],                        permission: 'configuracion' },
];

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function CommandPalette({ open, onClose, onNavigate }) {
  const { user } = useAuth();
  const { hasPermission } = useUserPermissions();
  const seccionesAccesibles = SECCIONES.filter(s => hasPermission(s.permission));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ secciones: [], productos: [], clientes: [], ventas: [], cotizaciones: [], bancos: [] });
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);
  const debouncedQuery = useDebounce(query, 200);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!debouncedQuery.trim() || !user?.empresa_id) {
      setResults({ secciones: seccionesAccesibles.slice(0, 5), productos: [], clientes: [], ventas: [], cotizaciones: [], bancos: [] });
      return;
    }
    buscar(debouncedQuery.trim());
  }, [debouncedQuery, user?.empresa_id]);

  const buscar = useCallback(async (q) => {
    setLoading(true);
    const qLower = q.toLowerCase();

    const seccionesMatch = seccionesAccesibles.filter(s =>
      s.label.toLowerCase().includes(qLower) ||
      s.keywords.some(k => k.includes(qLower))
    );

    const [{ data: prods }, { data: clientes }, { data: ventas }, { data: cotizacionesAll }, { data: bancos }] = await Promise.all([
      supabase.from('productos').select('id, nombre, stock_actual, codigo_sku').eq('empresa_id', user.empresa_id).eq('activo', true).ilike('nombre', `%${q}%`).limit(5),
      supabase.from('clientes').select('id, nombre, documento, saldo_actual').eq('empresa_id', user.empresa_id).neq('activo', false).ilike('nombre', `%${q}%`).limit(5),
      supabase.from('comprobantes').select('id, numero_venta, total, fecha').eq('empresa_id', user.empresa_id).ilike('numero_venta', `%${q}%`).limit(3),
      // `cotizaciones` está gateada a has_module_permission('ventas') (mig.134), pero el
      // buscador ⌘K es global (visible a cualquier rol) — RPC SECURITY DEFINER (mig.185)
      // para que un staff sin permiso 'ventas' también encuentre resultados de cotizaciones.
      supabase.rpc('listar_cotizaciones_min'),
      supabase.from('cuentas_bancarias').select('id, nombre, banco').eq('empresa_id', user.empresa_id).eq('activo', true).ilike('nombre', `%${q}%`).limit(3),
    ]);

    const qLowerCot = q.toLowerCase();
    const cotizaciones = (cotizacionesAll ?? [])
      .filter(c => c.numero?.toLowerCase().includes(qLowerCot) || c.cliente_nombre?.toLowerCase().includes(qLowerCot))
      .slice(0, 4);

    setResults({
      secciones: seccionesMatch.slice(0, 4),
      productos: prods ?? [],
      clientes: clientes ?? [],
      ventas: ventas ?? [],
      cotizaciones,
      bancos: bancos ?? [],
    });
    setLoading(false);
  }, [user?.empresa_id]);

  const allItems = [
    ...results.secciones.map(s => ({ type: 'seccion', ...s })),
    ...results.productos.map(p => ({ type: 'producto', id: p.id, label: p.nombre, sub: `SKU: ${p.codigo_sku || '-'} | Stock: ${p.stock_actual}`, section: 'productos' })),
    ...results.clientes.map(c => ({ type: 'cliente', id: c.id, label: c.nombre, sub: `Doc: ${c.documento || '-'} | Saldo: $${Number(c.saldo_actual).toFixed(2)}`, section: 'clientes' })),
    ...results.ventas.map(v => ({ type: 'venta', id: v.id, label: `Venta #${v.numero_venta}`, sub: `$${Number(v.total).toFixed(2)} — ${formatDateAR(v.fecha)}`, section: 'ventas' })),
    ...results.cotizaciones.map(c => ({ type: 'cotizacion', id: c.id, label: `Cotización ${c.numero}`, sub: `${c.cliente_nombre ?? 'Sin cliente'} — $${Number(c.total).toFixed(2)} · ${c.estado}`, section: 'cotizaciones' })),
    ...results.bancos.map(b => ({ type: 'banco', id: b.id, label: b.nombre, sub: `Banco: ${b.banco}`, section: 'bancos' })),
  ];

  useEffect(() => { setSelectedIdx(0); }, [allItems.length]);

  const handleSelect = useCallback((item) => {
    if (item.type === 'seccion') {
      onNavigate(item.id);
    } else {
      onNavigate(item.section);
    }
    onClose();
  }, [onNavigate, onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, allItems.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && allItems[selectedIdx]) { handleSelect(allItems[selectedIdx]); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, allItems, selectedIdx, handleSelect, onClose]);

  if (!open) return null;

  const getIcon = (item) => {
    if (item.type === 'seccion') { const Icon = item.icon; return <Icon className="w-4 h-4" />; }
    if (item.type === 'producto')    return <Package className="w-4 h-4 text-kx-blue" />;
    if (item.type === 'cliente')     return <Users className="w-4 h-4 text-kx-violet" />;
    if (item.type === 'venta')       return <Receipt className="w-4 h-4 text-kx-green" />;
    if (item.type === 'cotizacion')  return <ClipboardList className="w-4 h-4 text-indigo-600 dark:text-indigo-500" />;
    if (item.type === 'banco')       return <Landmark className="w-4 h-4 text-teal-600 dark:text-teal-500" />;
    return null;
  };

  const getGroupLabel = (type) => {
    const map = { seccion: 'Módulos', producto: 'Productos', cliente: 'Clientes', venta: 'Ventas', cotizacion: 'Cotizaciones', banco: 'Cuentas Bancarias' };
    return map[type] || type;
  };

  let lastType = null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-kx-surface dark:bg-kx-surface rounded-2xl shadow-2xl border border-kx-border dark:border-kx-border overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-kx-border dark:border-kx-border">
          <Search className="w-5 h-5 text-kx-text-3 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar productos, clientes, cotizaciones, bancos, módulos..."
            className="flex-1 bg-transparent text-slate-900 dark:text-kx-text placeholder-slate-400 outline-none text-sm"
          />
          {loading && <Loader2 className="w-4 h-4 text-kx-text-3 animate-spin shrink-0" />}
          <button onClick={onClose} className="text-kx-text-3 hover:text-kx-text-2 dark:hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {allItems.length === 0 && !loading && (
            <div className="px-4 py-8 text-center text-kx-text-3 text-sm">Sin resultados para "{query}"</div>
          )}
          {allItems.map((item, idx) => {
            const showGroup = item.type !== lastType;
            lastType = item.type;
            return (
              <React.Fragment key={`${item.type}-${item.id || item.label}`}>
                {showGroup && (
                  <div className="px-4 py-1.5 text-xs font-semibold text-kx-text-3 uppercase tracking-wider">
                    {getGroupLabel(item.type)}
                  </div>
                )}
                <button
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    idx === selectedIdx
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-kx-surface-2 dark:hover:bg-slate-800/50'
                  }`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIdx(idx)}
                >
                  <span className="shrink-0 text-slate-500 dark:text-kx-text-2">{getIcon(item)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{item.label}</span>
                    {item.sub && <span className="block text-xs text-kx-text-3 truncate">{item.sub}</span>}
                  </span>
                  {idx === selectedIdx && <ArrowRight className="w-4 h-4 shrink-0 opacity-60" />}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-kx-border dark:border-kx-border flex items-center gap-4 text-xs text-kx-text-3">
          <span><kbd className="bg-slate-100 dark:bg-kx-surface-2 px-1.5 py-0.5 rounded text-xs">↑↓</kbd> navegar</span>
          <span><kbd className="bg-slate-100 dark:bg-kx-surface-2 px-1.5 py-0.5 rounded text-xs">Enter</kbd> abrir</span>
          <span><kbd className="bg-slate-100 dark:bg-kx-surface-2 px-1.5 py-0.5 rounded text-xs">Esc</kbd> cerrar</span>
        </div>
      </div>
    </div>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return { open, setOpen };
}
