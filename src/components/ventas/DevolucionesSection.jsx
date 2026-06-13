import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Undo2, FileWarning, ChevronDown, ChevronRight,
  Check, RefreshCw, Package,
} from 'lucide-react';
import { formatDateAR } from '@/lib/dateUtils';
import NuevaDevolucionModal from './NuevaDevolucionModal';
import NuevaNotaDebitoModal from './NuevaNotaDebitoModal';

// ── Helpers ───────────────────────────────────────────────────────────────────

function CompensacionBadge({ value }) {
  const cfg = {
    nota_credito: { cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',   label: 'NC' },
    reemplazo:    { cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400', label: 'Reemplazo' },
    pendiente:    { cls: 'bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-kx-text-2',   label: 'Pendiente' },
  };
  const { cls, label } = cfg[value] ?? cfg.pendiente;
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
}

// ── Tab: Devoluciones de Clientes ─────────────────────────────────────────────

function DevolucionesTab({ onNavigate }) {
  const { user } = useAuth();
  const [devoluciones, setDevoluciones] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [expanded, setExpanded]         = useState({});
  const [isModalOpen, setIsModalOpen]   = useState(false);
  const [refreshKey, setRefreshKey]     = useState(0);

  useEffect(() => {
    if (!user?.empresa_id) return;
    setLoading(true);
    supabase
      .from('devoluciones')
      .select(`
        id, numero_devolucion, fecha, tipo, reingresa_stock, compensacion,
        reembolso_efectivo, motivo, nota_credito_id, comprobante_id,
        clientes(nombre),
        factura_origen:comprobantes!comprobante_id(numero_venta),
        nota_credito:comprobantes!nota_credito_id(numero_venta),
        devolucion_items(id, cantidad, subtotal, precio_unitario, productos(nombre))
      `)
      .eq('empresa_id', user.empresa_id)
      .eq('tipo', 'cliente')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setDevoluciones(data || []);
        setLoading(false);
      });
  }, [user?.empresa_id, refreshKey]);

  const toggleExpand = id => setExpanded(p => ({ ...p, [id]: !p[id] }));

  const totalDev = dev =>
    (dev.devolucion_items || []).reduce((s, i) => s + Number(i.subtotal || 0), 0);

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-kx-text-2">
          {devoluciones.length} devolución(es) registrada(s)
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm"
            onClick={() => setRefreshKey(k => k + 1)}
            className="h-8 text-kx-text-3 hover:text-kx-text">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            onClick={() => setIsModalOpen(true)}
            className="h-8 bg-orange-500 hover:bg-orange-600 text-white gap-1.5 text-xs px-3"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Nueva Devolución
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : devoluciones.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-dashed border-kx-border">
          <Undo2 className="h-8 w-8 text-kx-text-3 mb-2" />
          <p className="font-medium text-kx-text-2">Sin devoluciones registradas</p>
          <p className="text-sm text-kx-text-3 mt-1">
            También podés iniciar una devolución desde el ícono <Undo2 className="inline h-3.5 w-3.5 mx-0.5" /> en el Historial de Facturas.
          </p>
        </div>
      ) : (
        <div className="border border-kx-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-kx-surface-2 dark:bg-kx-surface text-xs uppercase text-slate-500 font-semibold">
              <tr>
                <th className="px-4 py-2.5 text-left w-8" />
                <th className="px-4 py-2.5 text-left">Número</th>
                <th className="px-4 py-2.5 text-left">Fecha</th>
                <th className="px-4 py-2.5 text-left">Cliente</th>
                <th className="px-4 py-2.5 text-left">Factura origen</th>
                <th className="px-4 py-2.5 text-center">Stock</th>
                <th className="px-4 py-2.5 text-center">Compensación</th>
                <th className="px-4 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-kx-border">
              {devoluciones.map(dev => (
                <React.Fragment key={dev.id}>
                  <tr
                    className="hover:bg-kx-surface-2 cursor-pointer transition-colors"
                    onClick={() => toggleExpand(dev.id)}
                  >
                    <td className="px-4 py-3 text-kx-text-3">
                      {expanded[dev.id]
                        ? <ChevronDown className="h-3.5 w-3.5" />
                        : <ChevronRight className="h-3.5 w-3.5" />}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-kx-text">
                      {dev.numero_devolucion}
                    </td>
                    <td className="px-4 py-3 text-kx-text-2 text-xs">
                      {formatDateAR(dev.fecha + 'T00:00:00Z')}
                    </td>
                    <td className="px-4 py-3 text-kx-text">
                      {dev.clientes?.nombre || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-kx-text-2">
                      {dev.comprobante_id && onNavigate ? (
                        <button
                          className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          onClick={e => { e.stopPropagation(); onNavigate('comprobante', dev.comprobante_id); }}
                        >
                          {dev.factura_origen?.numero_venta || 'Ver →'}
                        </button>
                      ) : (
                        dev.factura_origen?.numero_venta || '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {dev.reingresa_stock
                        ? <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                            <Check className="h-3 w-3" /> Sí
                          </span>
                        : <span className="text-xs text-kx-text-3">No</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-center">
                      <CompensacionBadge value={dev.compensacion} />
                      {dev.compensacion === 'nota_credito' && dev.nota_credito?.numero_venta && (
                        <span className="ml-1 font-mono text-xs text-kx-text-3">
                          {dev.nota_credito.numero_venta}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-kx-text">
                      ${totalDev(dev).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>

                  {expanded[dev.id] && (
                    <tr className="bg-kx-surface-2 dark:bg-slate-900/50">
                      <td colSpan={8} className="px-8 py-3">
                        {dev.motivo && (
                          <p className="text-xs text-kx-text-2 italic mb-2">Motivo: {dev.motivo}</p>
                        )}
                        <div className="grid grid-cols-[1fr_72px_88px_100px] gap-x-4 text-xs font-semibold text-kx-text-3 uppercase mb-1.5">
                          <span>Producto</span>
                          <span className="text-center">Cant.</span>
                          <span className="text-center">P. Unit.</span>
                          <span className="text-right">Subtotal</span>
                        </div>
                        {(dev.devolucion_items || []).map(item => (
                          <div
                            key={item.id}
                            className="grid grid-cols-[1fr_72px_88px_100px] gap-x-4 text-xs text-kx-text items-center py-0.5"
                          >
                            <span className="flex items-center gap-1.5">
                              <Package className="h-3 w-3 text-kx-text-3 shrink-0" />
                              {item.productos?.nombre || '—'}
                            </span>
                            <span className="text-center">{item.cantidad}</span>
                            <span className="text-center font-mono">
                              ${Number(item.precio_unitario).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                            </span>
                            <span className="text-right font-mono">
                              ${Number(item.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NuevaDevolucionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => setRefreshKey(k => k + 1)}
      />
    </>
  );
}

// ── Tab: Notas de Débito ──────────────────────────────────────────────────────

function NotasDebitoTab() {
  const { user } = useAuth();
  const [notas, setNotas]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [refreshKey, setRefreshKey]   = useState(0);

  useEffect(() => {
    if (!user?.empresa_id) return;
    setLoading(true);
    supabase
      .from('notas_debito')
      .select(`
        id, numero_nd, fecha, tipo, concepto, monto, moneda,
        clientes(nombre),
        comprobantes(numero_venta)
      `)
      .eq('empresa_id', user.empresa_id)
      .eq('tipo', 'emitida')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setNotas(data || []);
        setLoading(false);
      });
  }, [user?.empresa_id, refreshKey]);

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-kx-text-2">
          {notas.length} nota(s) de débito emitida(s)
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm"
            onClick={() => setRefreshKey(k => k + 1)}
            className="h-8 text-kx-text-3 hover:text-kx-text">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            onClick={() => setIsModalOpen(true)}
            className="h-8 bg-amber-500 hover:bg-amber-600 text-white gap-1.5 text-xs px-3"
          >
            <FileWarning className="h-3.5 w-3.5" />
            Nueva Nota de Débito
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : notas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-dashed border-kx-border">
          <FileWarning className="h-8 w-8 text-kx-text-3 mb-2" />
          <p className="font-medium text-kx-text-2">Sin notas de débito emitidas</p>
        </div>
      ) : (
        <div className="border border-kx-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-kx-surface-2 dark:bg-kx-surface text-xs uppercase text-slate-500 font-semibold">
              <tr>
                <th className="px-4 py-2.5 text-left">Número</th>
                <th className="px-4 py-2.5 text-left">Fecha</th>
                <th className="px-4 py-2.5 text-left">Cliente</th>
                <th className="px-4 py-2.5 text-left">Concepto</th>
                <th className="px-4 py-2.5 text-left">Factura</th>
                <th className="px-4 py-2.5 text-right">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-kx-border">
              {notas.map(nd => (
                <tr key={nd.id} className="hover:bg-kx-surface-2 transition-colors">
                  <td className="px-4 py-3 font-mono font-medium text-kx-text">{nd.numero_nd}</td>
                  <td className="px-4 py-3 text-kx-text-2 text-xs">
                    {formatDateAR(nd.fecha + 'T00:00:00Z')}
                  </td>
                  <td className="px-4 py-3 text-kx-text">{nd.clientes?.nombre || '—'}</td>
                  <td className="px-4 py-3 text-kx-text-2 text-xs max-w-[200px] truncate">
                    {nd.concepto}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-kx-text-2">
                    {nd.comprobantes?.numero_venta || '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-amber-600 dark:text-amber-400">
                    +${Number(nd.monto).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NuevaNotaDebitoModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => setRefreshKey(k => k + 1)}
      />
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function DevolucionesSection({ onNavigate }) {
  const [activeTab, setActiveTab] = useState('devoluciones');

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-transparent p-0 gap-1 flex justify-start border-b border-kx-border rounded-none h-auto pb-0">
          {[
            { value: 'devoluciones', label: 'Devoluciones de Clientes' },
            { value: 'notas_debito', label: 'Notas de Débito'          },
          ].map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className={[
                'rounded-none rounded-t-sm px-4 py-2 text-sm border-b-2 transition-colors',
                'data-[state=active]:border-[rgb(var(--kx-violet))] data-[state=active]:text-kx-text data-[state=active]:font-semibold',
                'data-[state=inactive]:border-transparent data-[state=inactive]:text-kx-text-2',
                'data-[state=inactive]:hover:text-kx-text',
              ].join(' ')}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="devoluciones" className="mt-4">
          <DevolucionesTab onNavigate={onNavigate} />
        </TabsContent>

        <TabsContent value="notas_debito" className="mt-4">
          <NotasDebitoTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default DevolucionesSection;
