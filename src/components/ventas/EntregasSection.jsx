import React, { useState, useEffect, useMemo } from 'react';
import { Truck, Search, ChevronDown, ChevronRight, Package } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatDateAR } from '@/lib/dateUtils';
import { useToast } from '@/components/ui/use-toast';

const ORIGEN_LABELS = {
  implicita: { label: 'POS',    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  manual:    { label: 'Manual', className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
};

const ESTADO_LABELS = {
  entregado: { label: 'Entregado', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  pendiente:  { label: 'Pendiente', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  parcial:    { label: 'Parcial',   className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  anulado:    { label: 'Anulado',   className: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
};

function OrigenBadge({ origen }) {
  const cfg = ORIGEN_LABELS[origen] || ORIGEN_LABELS.manual;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>{cfg.label}</span>;
}

function EstadoBadge({ estado }) {
  const cfg = ESTADO_LABELS[estado] || ESTADO_LABELS.pendiente;
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>{cfg.label}</span>;
}

function EntregasSection({ navigateEntregaId, onNavigated } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [entregas, setEntregas] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [filtroOrigen, setFiltroOrigen] = useState('todos');
  const [expanded, setExpanded] = useState({});

  const fetchEntregas = async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('entregas')
        .select(`
          *,
          clientes(nombre),
          pedidos(numero),
          comprobantes(numero_venta),
          entrega_items(id, cantidad, producto_id, productos(nombre))
        `)
        .eq('empresa_id', user.empresa_id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setEntregas(data || []);
    } catch (err) {
      toast({ title: 'Error al cargar entregas', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEntregas(); }, [user?.empresa_id]);

  useEffect(() => {
    if (!navigateEntregaId || entregas.length === 0) return;
    const ent = entregas.find(e => e.id === navigateEntregaId);
    if (ent) {
      setSearch(ent.numero_entrega || '');
      setExpanded(prev => ({ ...prev, [ent.id]: true }));
      setTimeout(() => {
        document.getElementById(`entrega-row-${ent.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
    onNavigated?.();
  }, [navigateEntregaId, entregas]);

  const filtered = useMemo(() => {
    let r = entregas;
    if (filtroOrigen !== 'todos') r = r.filter(e => e.origen === filtroOrigen);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(e =>
        e.numero_entrega.toLowerCase().includes(q) ||
        (e.clientes?.nombre || '').toLowerCase().includes(q) ||
        (e.pedidos?.numero || '').toLowerCase().includes(q)
      );
    }
    return r;
  }, [entregas, filtroOrigen, search]);

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3" />
          <Input
            placeholder="Buscar por número, cliente o pedido..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={filtroOrigen}
          onChange={e => setFiltroOrigen(e.target.value)}
          className="h-10 rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface dark:text-kx-text px-3 text-sm"
        >
          <option value="todos">Todas las entregas</option>
          <option value="manual">Solo manuales</option>
          <option value="implicita">Solo POS</option>
        </select>
      </div>

      {/* Tabla */}
      <Card className="overflow-hidden bg-kx-surface border-kx-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-kx-surface-2 border-b border-kx-border">
              <tr>
                <th className="text-left p-3 font-semibold text-kx-text-2 w-8"></th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Número</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Fecha</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Cliente</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Origen</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Pedido</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Factura</th>
                <th className="text-center p-3 font-semibold text-kx-text-2">Ítems</th>
                <th className="text-center p-3 font-semibold text-kx-text-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-kx-border">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="p-3">
                        <div className="h-4 bg-kx-surface-2 rounded animate-pulse w-16" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-12 text-center text-kx-text-3">
                    <Truck className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium text-kx-text-2">
                      {filtroOrigen !== 'todos' || search
                        ? 'Sin entregas con ese filtro'
                        : 'No hay entregas registradas'}
                    </p>
                    <p className="text-xs mt-1">Las entregas aparecen al confirmar ventas POS o generarlas desde Pedidos.</p>
                  </td>
                </tr>
              ) : (
                filtered.map(entrega => {
                  const items = entrega.entrega_items || [];
                  const isOpen = !!expanded[entrega.id];
                  return (
                    <React.Fragment key={entrega.id}>
                      <tr
                        id={`entrega-row-${entrega.id}`}
                        className="hover:bg-kx-surface-2 cursor-pointer transition-colors"
                        onClick={() => toggleExpand(entrega.id)}
                      >
                        <td className="p-3 text-kx-text-3">
                          {isOpen
                            ? <ChevronDown className="h-3.5 w-3.5" />
                            : <ChevronRight className="h-3.5 w-3.5" />
                          }
                        </td>
                        <td className="p-3 font-mono font-semibold text-[rgb(var(--kx-violet))]">
                          {entrega.numero_entrega}
                        </td>
                        <td className="p-3 text-kx-text-2 text-xs">
                          {formatDateAR(entrega.fecha)}
                        </td>
                        <td className="p-3 text-kx-text">
                          {entrega.clientes?.nombre || '—'}
                        </td>
                        <td className="p-3">
                          <OrigenBadge origen={entrega.origen} />
                        </td>
                        <td className="p-3 font-mono text-xs text-kx-text-2">
                          {entrega.pedidos?.numero || '—'}
                        </td>
                        <td className="p-3 font-mono text-xs text-kx-text-2">
                          {entrega.comprobantes?.numero_venta || '—'}
                        </td>
                        <td className="p-3 text-center text-kx-text-2">
                          {items.length}
                        </td>
                        <td className="p-3 text-center">
                          <EstadoBadge estado={entrega.estado} />
                        </td>
                      </tr>

                      {isOpen && items.length > 0 && (
                        <tr>
                          <td />
                          <td colSpan={8} className="pb-3 pr-3">
                            <div className="bg-kx-surface-2 rounded-lg border border-kx-border p-3">
                              <p className="text-xs font-semibold text-kx-text-3 uppercase mb-2">
                                Detalle de ítems
                              </p>
                              <div className="space-y-1">
                                {items.map(item => (
                                  <div key={item.id} className="flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-2 text-kx-text">
                                      <Package className="h-3.5 w-3.5 text-kx-text-3 shrink-0" />
                                      {item.productos?.nombre || item.producto_id}
                                    </div>
                                    <span className="font-mono text-kx-text-2 text-xs">
                                      × {Number(item.cantidad).toLocaleString('es-AR')}
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
    </div>
  );
}

export default EntregasSection;
