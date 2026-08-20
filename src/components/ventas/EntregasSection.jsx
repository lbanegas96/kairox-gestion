import { useState, useEffect, useMemo } from 'react';
import { Truck, Search, Loader2, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatDateAR } from '@/lib/dateUtils';
import { useToast } from '@/components/ui/use-toast';
import { getEmpresaParaPDF } from '@/lib/empresaUtils';
import ModalDetalleEntrega from '@/components/ventas/ModalDetalleEntrega';
import ModalNuevaEntrega from '@/components/ventas/ModalNuevaEntrega';
import NuevaFacturaModal from '@/components/ventas/NuevaFacturaModal';

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

function EntregasSection({ navigateEntregaId, onNavigated, onNavigate } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [entregas, setEntregas] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [filtroOrigen, setFiltroOrigen] = useState('todos');
  const [emitiendoId, setEmitiendoId] = useState(null);
  const [generandoPdfId, setGenerandoPdfId] = useState(null);
  const [anularTarget, setAnularTarget] = useState(null);
  const [anulando, setAnulando] = useState(false);
  const [viewEntregaId, setViewEntregaId] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [productos, setProductos] = useState([]);
  const [isNuevaOpen, setIsNuevaOpen] = useState(false);
  const [nuevaForm, setNuevaForm] = useState({ cliente_id: '', observaciones: '', items: [{ producto_id: '', cantidad: 1 }] });
  const [savingNueva, setSavingNueva] = useState(false);
  // Facturar desde la entrega: se factura el pedido de origen (es el que tiene
  // los precios), en el formulario de Factura de Venta del ERP (no el POS —
  // PENDIENTE #1, 14/08). crear_venta detecta que el pedido tuvo una entrega
  // confirmada y no vuelve a descontar stock.
  const [pedidoAFacturar, setPedidoAFacturar] = useState(null);
  const [entregaFacturando, setEntregaFacturando] = useState(null);

  const viewEntrega = entregas.find(e => e.id === viewEntregaId) ?? null;

  const fetchEntregas = async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('entregas')
        .select(`
          *,
          clientes(nombre, documento, direccion),
          pedidos(numero),
          comprobantes(numero_venta),
          entrega_items(id, cantidad, producto_id, productos(nombre, unidad_medida))
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
    if (!user?.empresa_id) return;
    supabase.from('clientes').select('id, nombre').eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre')
      .then(({ data }) => setClientes(data || []));
    // .limit(200) -- mismo criterio que CotizacionesSection: sin esto, un catálogo
    // grande (import masivo) trae TODOS los productos activos cada vez que se abre
    // Entregas, aunque el <select> de abajo ya es difícil de usar con miles de opciones.
    supabase.from('productos').select('id, nombre, stock_actual').eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre').limit(200)
      .then(({ data }) => setProductos(data || []));
  }, [user?.empresa_id]);

  // Navegación desde el Flujo del Documento de otra sección (ej. Pedido → Entrega generada)
  useEffect(() => {
    if (!navigateEntregaId) return;
    setViewEntregaId(navigateEntregaId);
    onNavigated?.();
  }, [navigateEntregaId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleDownloadRemito = async (entrega) => {
    setGenerandoPdfId(entrega.id);
    try {
      const [{ pdf }, { RemitoPDF }, empresa] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/ventas/pdf/RemitoPDF'),
        getEmpresaParaPDF(user.empresa_id),
      ]);
      const blob = await pdf(<RemitoPDF entrega={entrega} empresa={empresa} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Remito_${entrega.numero_remito}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[RemitoPDF] Error al generar:', err);
      toast({ title: 'Error al generar el remito', description: err.message, variant: 'destructive' });
    } finally {
      setGenerandoPdfId(null);
    }
  };

  const handleShareWhatsApp = (entrega) => {
    const lineas = [
      `Remito ${entrega.numero_remito}`,
      `Cliente: ${entrega.clientes?.nombre ?? 'Consumidor Final'}`,
      entrega.pedidos?.numero ? `Pedido: ${entrega.pedidos.numero}` : null,
      '',
      'Adjunto el PDF con el detalle de la entrega.',
    ].filter(Boolean);
    window.open(`https://wa.me/?text=${encodeURIComponent(lineas.join('\n'))}`, '_blank');
  };

  const handleEmitirRemito = async (entregaId) => {
    setEmitiendoId(entregaId);
    try {
      const { data, error } = await supabase.rpc('emitir_remito', {
        p_empresa_id: user.empresa_id,
        p_entrega_id: entregaId,
      });
      if (error) throw error;
      toast({
        title: `Remito Nº ${data.numero_remito} emitido`,
        description: `CAI ${data.cai} — ${data.punto_venta_nombre}`,
        className: 'bg-green-600 text-white border-green-700',
      });
      await fetchEntregas();
    } catch (err) {
      toast({ title: 'No se pudo emitir el remito', description: err.message, variant: 'destructive' });
    } finally {
      setEmitiendoId(null);
    }
  };

  const handleFacturarEntrega = async (entrega) => {
    if (!entrega?.pedido_id) return;
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, pedido_items(*)')
      .eq('id', entrega.pedido_id)
      .eq('empresa_id', user.empresa_id)
      .maybeSingle();
    if (error || !data) {
      toast({ title: 'No se pudo abrir la facturación', description: error?.message ?? 'No se encontró el pedido de origen.', variant: 'destructive' });
      return;
    }
    setEntregaFacturando(entrega);
    setViewEntregaId(null);
    setPedidoAFacturar(data);
  };

  // El pedido sólo pasa a 'facturado' cuando TODOS sus ítems quedan 100%
  // facturados (mismo criterio que PedidosSection.handleSaleSuccessForPedido
  // — BUG REAL encontrado probando en vivo el 18/08: con el criterio viejo,
  // facturar sólo lo entregado de un pedido con ítems todavía sin entregar
  // cerraba el pedido igual, sacando el botón "Facturar Pedido" y sin dejar
  // forma de facturar el resto más adelante). La entrega queda vinculada al
  // comprobante para que el Flujo del Documento y el Mapa la muestren como
  // facturada, se haya cerrado el pedido entero o no.
  const handleSaleSuccessDesdeEntrega = async (venta) => {
    const pedidoId = pedidoAFacturar?.id;
    const entregaId = entregaFacturando?.id;
    const comprobanteId = venta?.id ?? venta?.comprobante_id ?? null;
    setPedidoAFacturar(null);
    setEntregaFacturando(null);

    if (pedidoId) {
      const { data: itemsPedido } = await supabase
        .from('pedido_items')
        .select('cantidad, cantidad_facturada')
        .eq('pedido_id', pedidoId);
      const totalmenteFacturado = itemsPedido?.length > 0 &&
        itemsPedido.every(i => (Number(i.cantidad_facturada) || 0) >= Number(i.cantidad));
      if (totalmenteFacturado) {
        await supabase.from('pedidos').update({ estado: 'facturado' }).eq('id', pedidoId).eq('empresa_id', user.empresa_id);
      }
    }
    if (entregaId && comprobanteId) {
      await supabase.from('entregas').update({ comprobante_id: comprobanteId }).eq('id', entregaId).eq('empresa_id', user.empresa_id);
    }
    toast({ title: 'Entrega facturada' });
    await fetchEntregas();
  };

  const handleAnularEntrega = async () => {
    if (!anularTarget) return;
    setAnulando(true);
    try {
      const { error } = await supabase.rpc('anular_entrega', {
        p_empresa_id: user.empresa_id,
        p_user_id: user.id,
        p_entrega_id: anularTarget.id,
      });
      if (error) throw error;
      toast({ title: `Entrega ${anularTarget.numero_entrega} anulada`, description: 'El stock fue repuesto.' });
      setAnularTarget(null);
      setViewEntregaId(null);
      await fetchEntregas();
    } catch (err) {
      toast({ title: 'No se pudo anular la entrega', description: err.message, variant: 'destructive' });
    } finally {
      setAnulando(false);
    }
  };

  const emptyNuevaForm = () => ({ cliente_id: '', observaciones: '', items: [{ producto_id: '', cantidad: 1 }] });

  const abrirNuevaEntrega = () => { setNuevaForm(emptyNuevaForm()); setIsNuevaOpen(true); };

  const addItemNueva = () =>
    setNuevaForm(f => ({ ...f, items: [...f.items, { producto_id: '', cantidad: 1 }] }));

  const removeItemNueva = (i) =>
    setNuevaForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const updateItemNueva = (i, field, value) =>
    setNuevaForm(f => {
      const items = [...f.items];
      items[i] = { ...items[i], [field]: value };
      return { ...f, items };
    });

  const handleGuardarNuevaEntrega = async () => {
    const validItems = nuevaForm.items
      .filter(it => it.producto_id && Number(it.cantidad) > 0)
      .map(it => ({ producto_id: it.producto_id, cantidad: Number(it.cantidad) }));
    if (validItems.length === 0) {
      toast({ title: 'Agregá al menos un ítem con producto y cantidad', variant: 'destructive' });
      return;
    }
    setSavingNueva(true);
    try {
      const { data, error } = await supabase.rpc('crear_entrega_manual', {
        p_empresa_id: user.empresa_id,
        p_user_id: user.id,
        p_cliente_id: nuevaForm.cliente_id || null,
        p_items: validItems,
        p_observaciones: nuevaForm.observaciones || null,
      });
      if (error) throw error;
      toast({ title: `Entrega ${data.numero_entrega} creada`, className: 'bg-green-600 text-white border-green-700' });
      setIsNuevaOpen(false);
      await fetchEntregas();
    } catch (err) {
      toast({ title: 'No se pudo crear la entrega', description: err.message, variant: 'destructive' });
    } finally {
      setSavingNueva(false);
    }
  };

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
        <Button onClick={abrirNuevaEntrega} className="bg-[rgb(var(--kx-violet))] hover:opacity-90 text-white shrink-0">
          <Plus className="h-4 w-4 mr-2" /> Nueva Entrega
        </Button>
      </div>

      {/* Tabla */}
      <Card className="overflow-hidden bg-kx-surface border-kx-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-kx-surface-2 border-b border-kx-border">
              <tr>
                <th className="text-left p-3 font-semibold text-kx-text-2">Número</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Fecha</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Cliente</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Origen</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Pedido</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Factura</th>
                <th className="text-center p-3 font-semibold text-kx-text-2">Ítems</th>
                <th className="text-center p-3 font-semibold text-kx-text-2">Estado</th>
                <th className="text-left p-3 font-semibold text-kx-text-2">Remito</th>
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
                  return (
                    <tr
                      key={entrega.id}
                      className="hover:bg-kx-surface-2 cursor-pointer transition-colors"
                      onClick={() => setViewEntregaId(entrega.id)}
                    >
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
                      <td className="p-3 font-mono text-xs text-kx-text-2">
                        {entrega.numero_remito || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Modal Nueva Entrega (standalone, sin pedido) ────────────────────── */}
      <ModalNuevaEntrega
        isOpen={isNuevaOpen}
        onClose={() => setIsNuevaOpen(false)}
        clientes={clientes}
        productos={productos}
        form={nuevaForm}
        setForm={setNuevaForm}
        addItem={addItemNueva}
        removeItem={removeItemNueva}
        updateItem={updateItemNueva}
        handleSave={handleGuardarNuevaEntrega}
        saving={savingNueva}
      />

      {/* ── Modal Detalle ─────────────────────────────────────────────────── */}
      <ModalDetalleEntrega
        entrega={viewEntrega}
        onClose={() => setViewEntregaId(null)}
        onNavigate={onNavigate}
        onEmitirRemito={handleEmitirRemito}
        emitiendo={emitiendoId === viewEntregaId}
        onDescargarRemito={handleDownloadRemito}
        generandoPdf={generandoPdfId === viewEntregaId}
        onCompartirWhatsApp={handleShareWhatsApp}
        onAnular={setAnularTarget}
        onFacturar={handleFacturarEntrega}
      />

      {/* ── Facturar la entrega (Factura de Venta del ERP, con el pedido de origen cargado) ── */}
      <NuevaFacturaModal
        open={!!pedidoAFacturar}
        onOpenChange={v => !v && setPedidoAFacturar(null)}
        pedido={pedidoAFacturar}
        onSuccess={handleSaleSuccessDesdeEntrega}
      />

      {/* ── Confirm anular ───────────────────────────────────────────────── */}
      <AlertDialog open={!!anularTarget} onOpenChange={v => !v && setAnularTarget(null)}>
        <AlertDialogContent className="dark:bg-kx-bg dark:border-kx-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="dark:text-kx-text">¿Anular entrega?</AlertDialogTitle>
            <AlertDialogDescription className="dark:text-kx-text-2">
              La entrega <strong>{anularTarget?.numero_entrega}</strong> se marcará como anulada y el stock de sus ítems
              se repondrá automáticamente. Esta acción no puede deshacerse.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="dark:text-kx-text dark:border-kx-border">Volver</AlertDialogCancel>
            <AlertDialogAction onClick={handleAnularEntrega} disabled={anulando} className="bg-red-600 hover:bg-red-700 text-white">
              {anulando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Sí, anular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default EntregasSection;
