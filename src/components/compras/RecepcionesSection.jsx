import React, { useState, useEffect, useMemo } from 'react';
import { Package, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatDateAR } from '@/lib/dateUtils';
import { useToast } from '@/components/ui/use-toast';

const ORIGEN_LABELS = {
  implicita: { label: 'Compra Rápida', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  manual:    { label: 'Manual (OC)',   className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
};

const ESTADO_LABELS = {
  recibido: { label: 'Recibido', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  pendiente: { label: 'Pendiente', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  parcial:   { label: 'Parcial',   className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  anulado:   { label: 'Anulado',   className: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
};

function OrigenBadge({ origen }) {
  const cfg = ORIGEN_LABELS[origen] || ORIGEN_LABELS.manual;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>{cfg.label}</span>;
}

function EstadoBadge({ estado }) {
  const cfg = ESTADO_LABELS[estado] || ESTADO_LABELS.pendiente;
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>{cfg.label}</span>;
}

function RecepcionesSection() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [recepciones, setRecepciones] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [filtroOrigen, setFiltroOrigen] = useState('todos');
  const [expanded, setExpanded]       = useState({});

  const fetchRecepciones = async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('recepciones')
        .select(`
          *,
          proveedores(nombre),
          ordenes_compra(numero),
          compras(numero_factura),
          recepcion_items(id, cantidad, producto_id, productos(nombre))
        `)
        .eq('empresa_id', user.empresa_id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRecepciones(data || []);
    } catch (err) {
      toast({ title: 'Error al cargar recepciones', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRecepciones(); }, [user?.empresa_id]);

  const filtered = useMemo(() => {
    let r = recepciones;
    if (filtroOrigen !== 'todos') r = r.filter(e => e.origen === filtroOrigen);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(e =>
        (e.numero_recepcion || '').toLowerCase().includes(q) ||
        (e.proveedores?.nombre || '').toLowerCase().includes(q) ||
        (e.ordenes_compra?.numero || '').toLowerCase().includes(q)
      );
    }
    return r;
  }, [recepciones, filtroOrigen, search]);

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3" />
          <Input
            placeholder="Buscar por número, proveedor u OC..."
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
          <option value="todos">Todas las recepciones</option>
          <option value="manual">Solo manuales (OC)</option>
          <option value="implicita">Solo Compra Rápida</option>
        </select>
      </div>

      <Card className="overflow-hidden bg-kx-surface border-kx-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-kx-surface-2 border-b border-kx-border">
              <tr>
                <th className="text-left p-3 font-semibold text-kx-text-2 w-8"></th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Número</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Fecha</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Proveedor</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Origen</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">OC</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Compra</th>
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
                    <Package className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium text-kx-text-2">
                      {filtroOrigen !== 'todos' || search
                        ? 'Sin recepciones con ese filtro'
                        : 'No hay recepciones registradas'}
                    </p>
                    <p className="text-xs mt-1">Las recepciones aparecen al confirmar una OC o registrar una Compra Rápida.</p>
                  </td>
                </tr>
              ) : (
                filtered.map(rec => {
                  const items = rec.recepcion_items || [];
                  const isOpen = !!expanded[rec.id];
                  return (
                    <React.Fragment key={rec.id}>
                      <tr
                        className="hover:bg-kx-surface-2 cursor-pointer transition-colors"
                        onClick={() => toggleExpand(rec.id)}
                      >
                        <td className="p-3 text-kx-text-3">
                          {isOpen
                            ? <ChevronDown className="h-3.5 w-3.5" />
                            : <ChevronRight className="h-3.5 w-3.5" />
                          }
                        </td>
                        <td className="p-3 font-mono font-semibold text-[rgb(var(--kx-violet))]">
                          {rec.numero_recepcion}
                        </td>
                        <td className="p-3 text-kx-text-2 text-xs">
                          {formatDateAR(rec.fecha)}
                        </td>
                        <td className="p-3 text-kx-text">
                          {rec.proveedores?.nombre || '—'}
                        </td>
                        <td className="p-3">
                          <OrigenBadge origen={rec.origen} />
                        </td>
                        <td className="p-3 font-mono text-xs text-kx-text-2">
                          {rec.ordenes_compra?.numero || '—'}
                        </td>
                        <td className="p-3 font-mono text-xs text-kx-text-2">
                          {rec.compras?.numero_factura || '—'}
                        </td>
                        <td className="p-3 text-center text-kx-text-2">
                          {items.length}
                        </td>
                        <td className="p-3 text-center">
                          <EstadoBadge estado={rec.estado} />
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

export default RecepcionesSection;
