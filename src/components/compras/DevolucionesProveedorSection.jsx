import React, { useState, useEffect } from 'react';
import { RotateCcw, FileWarning, ChevronDown, ChevronRight, Package } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatDateAR } from '@/lib/dateUtils';
import { useToast } from '@/components/ui/use-toast';

const COMPENSACION_LABELS = {
  nota_debito: { label: 'Nota de Débito', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  reemplazo:   { label: 'Reemplazo',      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  pendiente:   { label: 'Sin definir',    className: 'bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-kx-text-2' },
};

function CompensacionBadge({ comp }) {
  const cfg = COMPENSACION_LABELS[comp] || COMPENSACION_LABELS.pendiente;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>{cfg.label}</span>;
}

function DevolucionesTab({ onNavigate }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [devoluciones, setDevoluciones] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [expanded, setExpanded]         = useState({});

  useEffect(() => {
    if (!user?.empresa_id) return;
    setLoading(true);
    supabase
      .from('devoluciones')
      .select(`
        id, numero_devolucion, fecha, tipo, reingresa_stock, compensacion, motivo,
        compra_id,
        proveedores(nombre),
        factura_compra:compras!compra_id(numero_factura),
        devolucion_items(id, cantidad, precio_unitario, subtotal, productos(nombre))
      `)
      .eq('empresa_id', user.empresa_id)
      .eq('tipo', 'proveedor')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast({ title: 'Error al cargar devoluciones', description: error.message, variant: 'destructive' });
        setDevoluciones(data || []);
        setLoading(false);
      });
  }, [user?.empresa_id]);

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <Card className="overflow-hidden bg-kx-surface border-kx-border">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-kx-surface-2 border-b border-kx-border">
            <tr>
              <th className="text-left p-3 font-semibold text-kx-text-2 w-8"></th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Número</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Fecha</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Proveedor</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Factura origen</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Compensación</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Stock</th>
              <th className="text-center p-3 font-semibold text-kx-text-2">Ítems</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-kx-border">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="p-3">
                      <div className="h-4 bg-kx-surface-2 rounded animate-pulse w-16" />
                    </td>
                  ))}
                </tr>
              ))
            ) : devoluciones.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-12 text-center text-kx-text-3">
                  <RotateCcw className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="font-medium text-kx-text-2">No hay devoluciones a proveedores</p>
                </td>
              </tr>
            ) : (
              devoluciones.map(dev => {
                const items  = dev.devolucion_items || [];
                const isOpen = !!expanded[dev.id];
                return (
                  <React.Fragment key={dev.id}>
                    <tr
                      className="hover:bg-kx-surface-2 cursor-pointer transition-colors"
                      onClick={() => toggleExpand(dev.id)}
                    >
                      <td className="p-3 text-kx-text-3">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </td>
                      <td className="p-3 font-mono font-semibold text-[rgb(var(--kx-violet))]">
                        {dev.numero_devolucion}
                      </td>
                      <td className="p-3 text-kx-text-2 text-xs">{formatDateAR(dev.fecha)}</td>
                      <td className="p-3 text-kx-text">{dev.proveedores?.nombre || '—'}</td>
                      <td className="p-3 font-mono text-xs text-kx-text-2">
                        {dev.compra_id && onNavigate ? (
                          <button
                            className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            onClick={e => { e.stopPropagation(); onNavigate('factura_compra', dev.compra_id); }}
                          >
                            {dev.factura_compra?.numero_factura || 'Ver →'}
                          </button>
                        ) : (
                          dev.factura_compra?.numero_factura || '—'
                        )}
                      </td>
                      <td className="p-3"><CompensacionBadge comp={dev.compensacion} /></td>
                      <td className="p-3 text-xs text-kx-text-2">
                        {dev.reingresa_stock ? 'Egresó stock' : 'Sin movimiento'}
                      </td>
                      <td className="p-3 text-center text-kx-text-2">{items.length}</td>
                    </tr>

                    {isOpen && items.length > 0 && (
                      <tr>
                        <td />
                        <td colSpan={7} className="pb-3 pr-3">
                          <div className="bg-kx-surface-2 rounded-lg border border-kx-border p-3">
                            <p className="text-xs font-semibold text-kx-text-3 uppercase mb-2">Ítems devueltos</p>
                            <div className="space-y-1">
                              {items.map(item => (
                                <div key={item.id} className="flex items-center justify-between text-sm">
                                  <div className="flex items-center gap-2 text-kx-text">
                                    <Package className="h-3.5 w-3.5 text-kx-text-3 shrink-0" />
                                    {item.productos?.nombre || '—'}
                                  </div>
                                  <span className="font-mono text-kx-text-2 text-xs">
                                    × {Number(item.cantidad).toLocaleString('es-AR')}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {dev.motivo && (
                              <p className="text-xs text-kx-text-3 mt-2 pt-2 border-t border-kx-border">
                                Motivo: {dev.motivo}
                              </p>
                            )}
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
  );
}

function NotasDebitoRecibidas() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notas, setNotas]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.empresa_id) return;
    setLoading(true);
    supabase
      .from('notas_debito')
      .select('id, numero_nd, fecha, concepto, monto, tipo, proveedores(nombre)')
      .eq('empresa_id', user.empresa_id)
      .eq('tipo', 'recibida')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast({ title: 'Error al cargar notas de débito', description: error.message, variant: 'destructive' });
        setNotas(data || []);
        setLoading(false);
      });
  }, [user?.empresa_id]);

  return (
    <Card className="overflow-hidden bg-kx-surface border-kx-border">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-kx-surface-2 border-b border-kx-border">
            <tr>
              <th className="text-left p-3 font-semibold text-kx-text-2">Número</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Fecha</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Proveedor</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Concepto</th>
              <th className="text-right p-3 font-semibold text-kx-text-2">Monto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-kx-border">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="p-3">
                      <div className="h-4 bg-kx-surface-2 rounded animate-pulse w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : notas.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-12 text-center text-kx-text-3">
                  <FileWarning className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="font-medium text-kx-text-2">Sin notas de débito recibidas</p>
                </td>
              </tr>
            ) : (
              notas.map(nd => (
                <tr key={nd.id} className="hover:bg-kx-surface-2 transition-colors">
                  <td className="p-3 font-mono text-xs font-semibold text-[rgb(var(--kx-violet))]">{nd.numero_nd}</td>
                  <td className="p-3 text-kx-text-2 text-xs">{formatDateAR(nd.fecha)}</td>
                  <td className="p-3 text-kx-text">{nd.proveedores?.nombre || '—'}</td>
                  <td className="p-3 text-kx-text-2 max-w-xs truncate">{nd.concepto}</td>
                  <td className="p-3 text-right font-mono font-bold text-kx-text">
                    ${Number(nd.monto).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DevolucionesProveedorSection({ onNavigate }) {
  const [tab, setTab] = useState('devoluciones');

  const tabClass = [
    'rounded-none rounded-t-sm px-4 py-2 text-sm border-b-2 transition-colors',
    'data-[state=active]:border-[rgb(var(--kx-violet))] data-[state=active]:text-kx-text data-[state=active]:font-semibold',
    'data-[state=inactive]:border-transparent data-[state=inactive]:text-kx-text-2',
    'data-[state=inactive]:hover:text-kx-text',
  ].join(' ');

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="bg-transparent p-0 gap-1 flex justify-start border-b border-kx-border rounded-none h-auto pb-0">
          <TabsTrigger value="devoluciones" className={tabClass}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Devoluciones a Proveedor
          </TabsTrigger>
          <TabsTrigger value="notas_debito" className={tabClass}>
            <FileWarning className="h-3.5 w-3.5 mr-1.5" />
            Notas de Débito Recibidas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="devoluciones" className="mt-4">
          <DevolucionesTab onNavigate={onNavigate} />
        </TabsContent>

        <TabsContent value="notas_debito" className="mt-4">
          <NotasDebitoRecibidas />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default DevolucionesProveedorSection;
