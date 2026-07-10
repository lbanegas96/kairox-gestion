import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Package } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import AlertasStockBanner from './AlertasStockBanner';

const fmt = (n) =>
  Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Determina el nivel de stock de un producto
const getStockLevel = (p) => {
  if ((p.stock_actual ?? 0) <= 0) return 'sin_stock';
  if ((p.stock_actual ?? 0) <= (p.stock_minimo ?? 0)) return 'bajo';
  return 'ok';
};

const STOCK_CONFIG = {
  ok:        { color: 'text-kx-green', bg: 'bg-green-100 dark:bg-green-900/20' },
  bajo:      { color: 'text-kx-amber', bg: 'bg-amber-100 dark:bg-amber-900/20' },
  sin_stock: { color: 'text-kx-red',   bg: 'bg-red-100 dark:bg-red-900/20'     },
};

function ProductoCard({ producto, onAgregar }) {
  const level  = getStockLevel(producto);
  const config = STOCK_CONFIG[level];
  const disabled = level === 'sin_stock';

  const label =
    level === 'sin_stock' ? 'Sin stock'
    : level === 'bajo'    ? `${producto.stock_actual} u.`
    :                       `${producto.stock_actual} u.`;

  return (
    <div
      onClick={() => !disabled && onAgregar(producto)}
      className={[
        'bg-kx-surface border rounded-xl p-3 transition-all select-none',
        'flex flex-col gap-1',
        disabled
          ? 'opacity-50 cursor-not-allowed border-kx-border'
          : level === 'bajo'
            ? 'border-amber-300 dark:border-amber-700 cursor-pointer hover:shadow-md hover:-translate-y-0.5'
            : 'border-kx-border cursor-pointer hover:shadow-md hover:-translate-y-0.5',
      ].join(' ')}
    >
      <p className="font-medium text-kx-text text-sm line-clamp-2 leading-tight">
        {producto.nombre}
      </p>
      {producto.codigo_sku && (
        <p className="text-[10px] text-kx-text-3 font-mono">{producto.codigo_sku}</p>
      )}
      <p className="text-lg font-bold text-kx-text tabular-nums mt-auto">
        ${fmt(producto.precio_venta)}
      </p>
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full inline-block w-fit ${config.bg} ${config.color}`}>
        {level === 'bajo' ? `⚠ ${label}` : label}
      </span>
    </div>
  );
}

function PanelProductos({ onAgregarAlCarrito }) {
  const { user }         = useAuth();
  const { toast }        = useToast();
  const [productos, setProductos]  = useState([]);
  const [search, setSearch]        = useState('');
  const [loading, setLoading]      = useState(true);
  const debounceRef                = useRef(null);
  const inputRef                   = useRef(null);

  const fetchProductos = useCallback(async (q) => {
    if (!user?.empresa_id) return;
    setLoading(true);
    try {
      let query = supabase
        .from('productos')
        .select('id, nombre, codigo_sku, precio_venta, stock_actual, stock_minimo, alicuota_iva, unidad_venta_id, factor_conversion_venta, precio_venta_pack, descuento_pack_pct, unidad_venta:unidades_medida!unidad_venta_id(codigo, descripcion)')
        .eq('empresa_id', user.empresa_id)
        .eq('activo', true)
        .order('nombre')
        .limit(200);

      if (q.trim()) {
        query = query.or(`nombre.ilike.%${q}%,codigo_sku.ilike.%${q}%`);
      }

      const { data } = await query;
      setProductos(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [user?.empresa_id]);

  useEffect(() => {
    fetchProductos('');
  }, [fetchProductos]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchProductos(search), search ? 300 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [search, fetchProductos]);

  // Auto-focus al montar
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // SCANNER — refocus permanente del input de búsqueda mientras el POS esté abierto.
  // Si el cajero hace clic en cualquier parte (agregar al carrito, cambiar pago, etc.)
  // el foco vuelve al buscador después de 300ms para que el siguiente escaneo entre acá.
  // Excepciones: hay un modal Radix abierto, o el activeElement es un campo editable
  // distinto del propio (input cantidad/precio, dropdown cliente, etc.).
  useEffect(() => {
    const refocus = () => setTimeout(() => {
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      const active = document.activeElement;
      const editableTags = ['INPUT', 'TEXTAREA', 'SELECT'];
      if (active && editableTags.includes(active.tagName) && active !== inputRef.current) return;
      inputRef.current?.focus();
    }, 300);
    document.addEventListener('click', refocus);
    return () => document.removeEventListener('click', refocus);
  }, []);

  // SCANNER — Enter en el buscador intenta primero match exacto por codigo_barras.
  // Si hay match → agregar al carrito, toast breve, limpiar input y refocusear.
  // Si no hay match → no hacer nada (la búsqueda debounceada por nombre/SKU ya
  // está mostrando resultados en el grid de abajo; el cajero clickea uno).
  // El "mismo producto dos veces incrementa cantidad" ya lo maneja
  // ModoCajaLayout.handleAgregarAlCarrito — no hace falta lógica extra acá.
  const handleKeyDown = async (e) => {
    if (e.key !== 'Enter') return;
    const code = search.trim();
    if (!code) return;
    e.preventDefault();

    const { data: producto } = await supabase
      .from('productos')
      .select('*, unidad_venta:unidades_medida!unidad_venta_id(codigo, descripcion)')
      .eq('empresa_id', user.empresa_id)
      .eq('codigo_barras', code)
      .eq('activo', true)
      .maybeSingle();

    if (producto) {
      onAgregarAlCarrito(producto);
      toast({ title: `✓ ${producto.nombre} × 1`, duration: 1500 });
      setSearch('');
      inputRef.current?.focus();
    }
  };

  const productosConAlerta = productos.filter(p => getStockLevel(p) !== 'ok');

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Buscador */}
      <div className="p-3 border-b border-kx-border bg-kx-surface flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-kx-text-3 pointer-events-none" />
          <input
            ref={inputRef}
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar por nombre o código..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-kx-surface border border-kx-border
                       text-kx-text text-sm focus:outline-none focus:border-[rgb(var(--kx-violet))]
                       transition-colors"
          />
        </div>
      </div>

      {/* Banner de alertas de stock */}
      <AlertasStockBanner productos={productosConAlerta} />

      {/* Grid de productos */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="bg-kx-surface border border-kx-border rounded-xl p-3 h-24 animate-pulse" />
            ))}
          </div>
        ) : productos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-kx-text-3">
            <Package className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">
              {search ? 'Sin resultados para la búsqueda' : 'No hay productos activos'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {productos.map(p => (
              <ProductoCard key={p.id} producto={p} onAgregar={onAgregarAlCarrito} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PanelProductos;
