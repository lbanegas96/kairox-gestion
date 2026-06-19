import React, { useState, useEffect, useMemo } from 'react';
import {
  Receipt, Search, ChevronDown, ChevronRight,
  Undo2, MoreHorizontal, Eye, Network, FileMinus, FilePlus, Plus,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatDateAR } from '@/lib/dateUtils';
import { useToast } from '@/components/ui/use-toast';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import NuevaDevolucionProveedorModal from './NuevaDevolucionProveedorModal';
import NuevaNCProveedorModal from './NuevaNCProveedorModal';
import NuevaNDProveedorModal from './NuevaNDProveedorModal';
import NuevaFacturaProveedorModal from './NuevaFacturaProveedorModal';
import MapaRelaciones from '@/components/shared/MapaRelaciones';

const ESTADO_LABELS = {
  pagada:    { label: 'Pagada',    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  pendiente: { label: 'Pendiente', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  anulada:   { label: 'Anulada',   className: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
};

function EstadoBadge({ estado }) {
  const cfg = ESTADO_LABELS[estado] || ESTADO_LABELS.pendiente;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function FacturasCompraSection() {
  const { user }  = useAuth();
  const { toast } = useToast();
  const tcParalelo = useTCParalelo();

  const [compras, setCompras]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [expanded, setExpanded]   = useState({});

  // ── Estados de modales ──────────────────────────────────────────────────────
  const [showNuevaFactura, setShowNuevaFactura]   = useState(false);
  const [devolverCompra, setDevolverCompra]       = useState(null);
  const [ncOrigen, setNcOrigen]                   = useState(null);
  const [isNcOpen, setIsNcOpen]                   = useState(false);
  const [ndOrigen, setNdOrigen]                   = useState(null);
  const [isNdOpen, setIsNdOpen]                   = useState(false);
  const [mapaCompraId, setMapaCompraId]           = useState(null);
  const [isMapaOpen, setIsMapaOpen]               = useState(false);

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchCompras = async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('compras')
        .select(`
          id, fecha, numero_factura, total, forma_pago, estado_pago, moneda, tipo_cambio_tasa,
          monto_paralelo, tc_paralelo, created_at, proveedor_id,
          proveedores(nombre),
          detalle_compras(id, cantidad, costo_unitario, subtotal, productos(nombre))
        `)
        .eq('empresa_id', user.empresa_id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setCompras(data || []);
    } catch (err) {
      toast({ title: 'Error al cargar facturas de compra', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCompras(); }, [user?.empresa_id]);

  const filtered = useMemo(() => {
    let r = compras;
    if (filtroEstado !== 'todos') r = r.filter(c => c.estado_pago === filtroEstado);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(c =>
        (c.numero_factura || '').toLowerCase().includes(q) ||
        (c.proveedores?.nombre || '').toLowerCase().includes(q)
      );
    }
    return r;
  }, [compras, filtroEstado, search]);

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const abrirNc = (compra) => {
    setNcOrigen({
      id:              compra.id,
      numero_factura:  compra.numero_factura,
      proveedor_id:    compra.proveedor_id,
      proveedor_nombre: compra.proveedores?.nombre,
      proveedores:     compra.proveedores,
      total:           compra.total,
    });
    setIsNcOpen(true);
  };

  const abrirNd = (compra) => {
    setNdOrigen({
      id:              compra.id,
      numero_factura:  compra.numero_factura,
      proveedor_id:    compra.proveedor_id,
      proveedor_nombre: compra.proveedores?.nombre,
      proveedores:     compra.proveedores,
      total:           compra.total,
    });
    setIsNdOpen(true);
  };

  const abrirDevolucion = (compra) => {
    setDevolverCompra({
      id:              compra.id,
      numero_factura:  compra.numero_factura,
      proveedor_id:    compra.proveedor_id,
      proveedor_nombre: compra.proveedores?.nombre,
    });
  };

  const abrirMapa = (compra) => {
    setMapaCompraId(compra.id);
    setIsMapaOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Header con botón Nueva Factura */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-kx-text">Facturas de Proveedores</h2>
          <p className="text-xs text-kx-text-2">Cuentas por pagar · NC y ND recibidas</p>
        </div>
        <Button
          onClick={() => setShowNuevaFactura(true)}
          className="gap-2 h-9 text-sm font-medium shrink-0"
          style={{ background: 'rgb(var(--kx-blue))', color: '#fff' }}
        >
          <Plus className="w-4 h-4" /> Nueva Factura de Proveedor
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3" />
          <Input
            placeholder="Buscar por N° factura o proveedor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}
          className="h-10 rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface dark:text-kx-text px-3 text-sm"
        >
          <option value="todos">Todos los estados</option>
          <option value="pagada">Solo pagadas</option>
          <option value="pendiente">Solo pendientes</option>
        </select>
      </div>

      {/* Tabla */}
      <Card className="overflow-hidden bg-kx-surface border-kx-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-kx-surface-2 border-b border-kx-border">
              <tr>
                <th className="text-left p-3 font-semibold text-kx-text-2 w-8"></th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Fecha</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Proveedor</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">N° Factura</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Forma Pago</th>
                <th className="text-right p-3 font-semibold text-kx-text-2">Total</th>
                {tcParalelo.enabled && (
                  <th className="text-right p-3 font-semibold text-kx-text-2">{tcParalelo.monedaParalela}</th>
                )}
                <th className="text-center p-3 font-semibold text-kx-text-2">Estado</th>
                <th className="text-center p-3 font-semibold text-kx-text-2 w-14">Acc.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-kx-border">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: tcParalelo.enabled ? 9 : 8 }).map((_, j) => (
                      <td key={j} className="p-3">
                        <div className="h-4 bg-kx-surface-2 rounded animate-pulse w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={tcParalelo.enabled ? 9 : 8} className="p-12 text-center text-kx-text-3">
                    <Receipt className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium text-kx-text-2">
                      {filtroEstado !== 'todos' || search
                        ? 'Sin facturas con ese filtro'
                        : 'No hay facturas de compra registradas'}
                    </p>
                    <p className="text-xs mt-1">
                      Usá el botón "Nueva Factura de Proveedor" para comenzar.
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map(compra => {
                  const items  = compra.detalle_compras || [];
                  const isOpen = !!expanded[compra.id];
                  return (
                    <React.Fragment key={compra.id}>
                      <tr
                        className="hover:bg-kx-surface-2 cursor-pointer transition-colors"
                        onClick={() => toggleExpand(compra.id)}
                      >
                        <td className="p-3 text-kx-text-3">
                          {isOpen
                            ? <ChevronDown className="h-3.5 w-3.5" />
                            : <ChevronRight className="h-3.5 w-3.5" />}
                        </td>
                        <td className="p-3 text-kx-text-2 text-xs">{formatDateAR(compra.fecha)}</td>
                        <td className="p-3 text-kx-text">{compra.proveedores?.nombre || '—'}</td>
                        <td className="p-3 font-mono text-xs text-[rgb(var(--kx-blue))]">
                          {compra.numero_factura || 'S/N'}
                        </td>
                        <td className="p-3 text-kx-text-2 text-xs">{compra.forma_pago || '—'}</td>
                        <td className="p-3 text-right font-mono font-bold text-kx-text">
                          {compra.moneda !== 'ARS' ? `${compra.moneda} ` : ''}
                          ${Number(compra.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </td>
                        {tcParalelo.enabled && (
                          <td className="p-3 text-right text-xs text-kx-text-2 font-mono">
                            {(() => {
                              if (compra.monto_paralelo) {
                                return `≈ ${Number(compra.monto_paralelo).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
                              }
                              const calc = tcParalelo.calcParalelo(Number(compra.total), compra.moneda ?? 'ARS', Number(compra.tipo_cambio_tasa) || 1);
                              return calc !== null ? `≈ ${calc.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : '—';
                            })()}
                          </td>
                        )}
                        <td className="p-3 text-center">
                          <EstadoBadge estado={compra.estado_pago} />
                        </td>
                        <td className="p-3 text-center" onClick={e => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-kx-text-3 hover:text-kx-text hover:bg-kx-surface-2 rounded-full"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="bg-kx-surface border-kx-border text-kx-text min-w-[210px]"
                            >
                              <DropdownMenuItem
                                onClick={() => toggleExpand(compra.id)}
                                className="gap-2 cursor-pointer"
                              >
                                <Eye className="w-4 h-4" />
                                {isOpen ? 'Ocultar detalle' : 'Ver detalle'}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="bg-kx-border" />
                              <DropdownMenuItem
                                onClick={() => abrirNc(compra)}
                                className="gap-2 cursor-pointer"
                              >
                                <FileMinus className="w-4 h-4 text-kx-amber" />
                                Copiar a NC de Proveedor
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => abrirNd(compra)}
                                className="gap-2 cursor-pointer"
                              >
                                <FilePlus className="w-4 h-4 text-kx-red" />
                                Copiar a ND de Proveedor
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="bg-kx-border" />
                              {compra.estado_pago !== 'anulada' && (
                                <DropdownMenuItem
                                  onClick={() => abrirDevolucion(compra)}
                                  className="gap-2 cursor-pointer text-amber-600 dark:text-amber-400 focus:text-amber-600"
                                >
                                  <Undo2 className="w-4 h-4" />
                                  Devolver a proveedor
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => abrirMapa(compra)}
                                className="gap-2 cursor-pointer"
                              >
                                <Network className="w-4 h-4 text-kx-violet" />
                                Mapa de relaciones
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>

                      {isOpen && items.length > 0 && (
                        <tr>
                          <td />
                          <td colSpan={tcParalelo.enabled ? 8 : 7} className="pb-3 pr-3">
                            <div className="bg-kx-surface-2 rounded-lg border border-kx-border p-3">
                              <p className="text-xs font-semibold text-kx-text-3 uppercase mb-2">
                                Detalle de ítems
                              </p>
                              <div className="space-y-1">
                                {items.map(item => (
                                  <div key={item.id} className="flex items-center justify-between text-sm">
                                    <span className="text-kx-text">{item.productos?.nombre || '—'}</span>
                                    <span className="text-kx-text-2 text-xs font-mono">
                                      {Number(item.cantidad).toLocaleString('es-AR')} u.
                                      × ${Number(item.costo_unitario).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Modales ─────────────────────────────────────────────────────────── */}
      <NuevaFacturaProveedorModal
        open={showNuevaFactura}
        onOpenChange={setShowNuevaFactura}
        onSuccess={() => { setShowNuevaFactura(false); fetchCompras(); }}
      />

      <NuevaDevolucionProveedorModal
        isOpen={!!devolverCompra}
        onClose={() => setDevolverCompra(null)}
        onSuccess={() => fetchCompras()}
        compra={devolverCompra}
      />

      <NuevaNCProveedorModal
        open={isNcOpen}
        onOpenChange={setIsNcOpen}
        compraOrigen={ncOrigen}
        onSuccess={() => { setIsNcOpen(false); setNcOrigen(null); fetchCompras(); }}
      />

      <NuevaNDProveedorModal
        open={isNdOpen}
        onOpenChange={setIsNdOpen}
        compraOrigen={ndOrigen}
        onSuccess={() => { setIsNdOpen(false); setNdOrigen(null); fetchCompras(); }}
      />

      <MapaRelaciones
        open={isMapaOpen}
        onOpenChange={setIsMapaOpen}
        compraId={mapaCompraId}
        onNavigate={() => {}}
      />
    </div>
  );
}

export default FacturasCompraSection;
