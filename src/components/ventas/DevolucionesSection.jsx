import { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Undo2, FileWarning, RefreshCw,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { formatDateAR } from '@/lib/dateUtils';
import NuevaDevolucionModal from '@/components/shared/NuevaDevolucionModal';
import NuevaNDModal from '@/components/ventas/NuevaNDModal';
import NuevaNCModal from '@/components/ventas/NuevaNCModal';
import ModalDetalleDevolucion from '@/components/ventas/ModalDetalleDevolucion';

// ── Helpers ───────────────────────────────────────────────────────────────────

// numero (opcional): cuando ya hay una NC vinculada (ej. "NC-20260707-003"), se
// muestra ESE texto dentro de la pastilla en vez del genérico "NC" — antes se
// mostraban los dos pegados ("NC" + "NC-20260707-003"), redundante (hallazgo del
// barrido general 24/08). Sin `numero` (NC pendiente de vincular), cae al label
// genérico de siempre.
function CompensacionBadge({ value, numero }) {
  const cfg = {
    nota_credito: { cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',   label: numero || 'NC' },
    reemplazo:    { cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400', label: 'Reemplazo' },
    pendiente:    { cls: 'bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-kx-text-2',   label: 'Pendiente' },
  };
  const { cls, label } = cfg[value] ?? cfg.pendiente;
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${cls} ${value === 'nota_credito' && numero ? 'font-mono' : ''}`}>
      {label}
    </span>
  );
}

// ── Tab: Devoluciones de Clientes ─────────────────────────────────────────────

function DevolucionesTab({ onNavigate }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [devoluciones, setDevoluciones]     = useState([]);
  const [loading, setLoading]               = useState(true);
  const [isModalOpen, setIsModalOpen]       = useState(false);
  const [viewDevolucionId, setViewDevolucionId] = useState(null);
  const [ncOrigen, setNcOrigen]             = useState(null);
  const [isNcOpen, setIsNcOpen]             = useState(false);
  const [refreshKey, setRefreshKey]         = useState(0);

  useEffect(() => {
    if (!user?.empresa_id) return;
    setLoading(true);
    supabase
      .from('devoluciones')
      .select(`
        id, numero_devolucion, fecha, tipo, reingresa_stock, compensacion,
        reembolso_efectivo, motivo, nota_credito_id, comprobante_id, cliente_id,
        clientes(nombre),
        factura_origen:comprobantes!comprobante_id(numero_venta, tipo_comprobante_afip),
        nota_credito:comprobantes!nota_credito_id(numero_venta),
        devolucion_items(id, producto_id, cantidad, subtotal, precio_unitario, alicuota_iva, productos(nombre))
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

  const totalDev = dev =>
    (dev.devolucion_items || []).reduce((s, i) => s + Number(i.subtotal || 0), 0);

  const viewDevolucion = devoluciones.find(d => d.id === viewDevolucionId) ?? null;

  const handleGenerarNC = (dev) => {
    setNcOrigen({
      id:                    dev.id,
      numero_devolucion:     dev.numero_devolucion,
      cliente_id:            dev.cliente_id,
      cliente_nombre:        dev.clientes?.nombre,
      comprobante_id:        dev.comprobante_id,
      tipo_comprobante_afip: dev.factura_origen?.tipo_comprobante_afip,
      items: (dev.devolucion_items || []).map(i => ({
        producto_id:     i.producto_id,
        descripcion:     i.productos?.nombre || '',
        cantidad:        i.cantidad,
        precio_unitario: i.precio_unitario,
        alicuota_iva:    i.alicuota_iva,
      })),
    });
    setViewDevolucionId(null);
    setIsNcOpen(true);
  };

  const handleMarcarReemplazo = async (dev) => {
    const { error } = await supabase.from('devoluciones')
      .update({ compensacion: 'reemplazo' })
      .eq('id', dev.id).eq('empresa_id', user.empresa_id);
    if (error) {
      toast({ title: 'No se pudo marcar como reemplazo', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Devolución marcada como Reemplazo' });
    setViewDevolucionId(null);
    setRefreshKey(k => k + 1);
  };

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
            También podés iniciar una devolución desde el ícono <Undo2 className="inline h-3.5 w-3.5 mx-0.5" /> en Facturas.
          </p>
        </div>
      ) : (
        <div className="border border-kx-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-kx-surface-2 dark:bg-kx-surface text-xs uppercase text-slate-500 font-semibold">
              <tr>
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
                <tr
                  key={dev.id}
                  className="hover:bg-kx-surface-2 cursor-pointer transition-colors"
                  onClick={() => setViewDevolucionId(dev.id)}
                >
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
                    {dev.factura_origen?.numero_venta || '—'}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-kx-text-2">
                    {dev.reingresa_stock ? 'Sí' : 'No'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <CompensacionBadge value={dev.compensacion} numero={dev.nota_credito?.numero_venta} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-kx-text">
                    ${totalDev(dev).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NuevaDevolucionModal
        tipo="cliente"
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => setRefreshKey(k => k + 1)}
      />

      <ModalDetalleDevolucion
        devolucion={viewDevolucion}
        onClose={() => setViewDevolucionId(null)}
        onNavigate={onNavigate}
        onGenerarNC={handleGenerarNC}
        onMarcarReemplazo={handleMarcarReemplazo}
      />

      <NuevaNCModal
        open={isNcOpen}
        onOpenChange={v => { setIsNcOpen(v); if (!v) setNcOrigen(null); }}
        devolucionOrigen={ncOrigen}
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
    // ND emitida ahora vive en `comprobantes` (tipo='nota_debito', mig.268/269)
    // — ítems + IVA + Open Item real. `notas_debito` tipo='emitida' queda
    // como historial congelado (nunca más recibe filas nuevas de este lado),
    // se sigue mostrando para no perder el histórico real de la empresa.
    Promise.all([
      supabase
        .from('notas_debito')
        .select(`id, numero_nd, fecha, tipo, concepto, monto, moneda, clientes(nombre), comprobantes(numero_venta)`)
        .eq('empresa_id', user.empresa_id)
        .eq('tipo', 'emitida'),
      supabase
        .from('comprobantes')
        .select('id, numero_venta, fecha, cliente_nombre, total, moneda, motivo_nc, comprobante_origen_id')
        .eq('empresa_id', user.empresa_id)
        .eq('tipo', 'nota_debito'),
    ]).then(async ([{ data: legacy }, { data: nuevas }]) => {
      const origenIds = [...new Set((nuevas || []).map(n => n.comprobante_origen_id).filter(Boolean))];
      let origenMap = {};
      if (origenIds.length > 0) {
        const { data: origenes } = await supabase
          .from('comprobantes').select('id, numero_venta').in('id', origenIds);
        origenMap = Object.fromEntries((origenes || []).map(o => [o.id, o.numero_venta]));
      }
      const nuevasNormalizadas = (nuevas || []).map(n => ({
        id: n.id,
        numero_nd: n.numero_venta,
        // notas_debito.fecha es DATE puro ("2026-07-07"); comprobantes.fecha es
        // TIMESTAMPTZ — recortar a YYYY-MM-DD para que ambas formas calcen con
        // el formatDateAR(fecha + 'T00:00:00Z') que ya usa la tabla más abajo.
        fecha: n.fecha?.slice(0, 10),
        concepto: n.motivo_nc,
        monto: n.total,
        moneda: n.moneda,
        clientes: { nombre: n.cliente_nombre },
        comprobantes: n.comprobante_origen_id ? { numero_venta: origenMap[n.comprobante_origen_id] } : null,
      }));
      const merged = [...nuevasNormalizadas, ...(legacy || [])]
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      setNotas(merged);
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

      <NuevaNDModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
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
