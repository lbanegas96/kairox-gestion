import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Printer, X, Save, Edit2, Loader2, Banknote, Ban, Network, FileText, Zap, Calculator, MapPin, Receipt } from 'lucide-react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import ComprobantePrintModal from './ComprobantePrintModal';
import { formatDateTimeAR, formatDateAR, getTodayAR } from '@/lib/dateUtils';
import EstadoBadge from '@/components/ui/EstadoBadge';
import DocumentFlow from '@/components/shared/DocumentFlow';
import MapaRelaciones from '@/components/shared/MapaRelaciones';
import { DocumentoTabsList, DocumentoTab } from '@/components/shared/documento/DocumentoTabs';
import TabComunicacionElectronica from '@/components/shared/documento/TabComunicacionElectronica';
import TabContabilidad from '@/components/shared/documento/TabContabilidad';
import TabLogistica from '@/components/shared/documento/TabLogistica';
import { asientosAutoService } from '@/services/planCuentasService';
import { documentFlowService } from '@/services/documentFlowService';
import { formatNumeroComprobante } from '@/lib/numeroComprobante';
import { useRegistrarCobro } from '@/hooks/useRegistrarCobro';
import ModalCobro from '@/components/cuenta-corriente/ModalCobro';
import ModalDetalleCobro from '@/components/cuenta-corriente/ModalDetalleCobro';
import { TipoCambioModal } from '@/components/ui/TipoCambioModal';

// CAE emitido o en trámite ante AFIP/ARCA — el documento ya es (o puede
// llegar a ser) fiscalmente válido, no se puede "deshacer": solo Nota de
// Crédito. Ver RPC cancelar_factura (mig.259).
const CAE_BLOQUEA_CANCELACION = ['emitido', 'pendiente', 'pendiente_caea'];

// Campo etiquetado de la cabecera — mismo componente/estilo que usan
// Entrega y OC (hallazgo Luciano 23/08: esta cabecera seguía usando el
// GrillaCampos/CampoDato genérico, sentence-case, mientras el resto de los
// documentos ya había convergido en mayúsculas+tracking-wide. Se deja
// local en vez de tocar CampoDato porque ese sigue siendo el correcto para
// las solapas secundarias — Contabilidad, Comunicación Electrónica, Remito).
function Campo({ label, children }) {
  return (
    <div>
      <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase tracking-wide">{label}</span>
      {/* div, no <p> — a diferencia del Campo de Entrega, acá "Estado de pago"
          mete un <EstadoBadge> (Badge de shadcn, que renderiza un <div>)
          adentro, y <div> dentro de <p> es HTML inválido (bug real 23/08). */}
      <div className="mt-0.5 truncate" title={typeof children === 'string' ? children : undefined}>{children}</div>
    </div>
  );
}

const SaleDetailModal = ({ open, onOpenChange, saleId, onUpdateSale, onNavigate }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [sale, setSale] = useState(null);
  const [items, setItems] = useState([]);
  const [flow, setFlow] = useState(null);
  const [showPrintModal, setShowPrintModal] = useState(false);

  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [reintentandoCae, setReintentandoCae] = useState(false);
  // (verTecnicoAfip vive ahora dentro de TabComunicacionElectronica — item 7)

  // Cancelación (RPC cancelar_factura — reversión total, solo sin CAE)
  const [showCancelarConfirm, setShowCancelarConfirm] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState('');
  const [cancelando, setCancelando] = useState(false);

  // Punto 2/3 del hallazgo de Luciano (22/08): este modal era anterior al
  // rediseño — usaba su propio DocumentFlowPanel sin link a Mapa de
  // Relaciones (el resto de los documentos ya lo tiene, ej. ModalDetalleEntrega).
  const [mapaOpen, setMapaOpen] = useState(false);

  // "Registrar Cobro" desde acá mismo (29/08, hallazgo Luciano) — antes salía
  // del módulo Ventas hacia Cuenta Corriente y esta ventana se cerraba sola.
  // Ahora abre el mismo <ModalCobro> apilado arriba de este detalle: al
  // cobrar con éxito, se refresca este documento (nuevo estado_pago + el
  // cobro aparece en "Flujo del documento") sin perder el contexto de la
  // factura; Escape solo cierra el diálogo de cobro, no la factura.
  const cobro = useRegistrarCobro(() => { fetchSaleDetails(); onUpdateSale?.(); });

  useEffect(() => {
    if (open && saleId) {
      fetchSaleDetails();
    } else {
      setSale(null);
      setItems([]);
      setFlow(null);
      setIsEditing(false);
      setNewStatus('');
      // Bug real (23/08, Luciano): este componente no se desmonta al cerrar
      // (el Dialog padre sigue vivo, solo `open` cambia — ver `if (!open)
      // return null` más abajo), así que sin este reset el AlertDialog de
      // cancelación quedaba con `showCancelarConfirm=true` pegado entre
      // aperturas. Resultado: se cerraba el detalle sin haber tocado nada
      // (el RPC nunca llegó a dispararse, `sale` ya era null en ese momento)
      // y al reabrir la MISMA factura, el cartel de "¿Cancelar Factura?"
      // reaparecía solo, sin que el usuario lo pidiera.
      setShowCancelarConfirm(false);
      setMotivoCancelacion('');
      setCancelando(false);
    }
  }, [open, saleId]);

  const fetchSaleDetails = async () => {
    setLoading(true);
    try {
      // Fetch Sale — el embed de cliente trae el documento (CUIT/DNI) y el
      // domicilio completo (mig.345) para el header y la solapa Logística;
      // punto_venta/centro_costo alimentan Comunicación Electrónica y
      // Contabilidad (item 7).
      const { data: saleData, error: saleError } = await supabase
        .from('comprobantes')
        .select(`
          *,
          clientes(nombre, documento, direccion, localidad, provincia, codigo_postal),
          punto_venta:puntos_venta(numero, nombre),
          centro_costo:centros_costo(nombre)
        `)
        .eq('id', saleId)
        .single();

      if (saleError) throw saleError;

      // Ensure estado_pago exists (for legacy records)
      if (!saleData.estado_pago) saleData.estado_pago = 'pagada';
      setSale(saleData);
      setNewStatus(saleData.estado_pago);

      // Flujo del documento — mismo shape de chips que Entrega (item 7,
      // hallazgo Luciano 22/08: antes era un componente visualmente distinto).
      documentFlowService.getFlowForComprobante(saleId).then(setFlow);

      // Fetch Items
      const { data: itemsData, error: itemsError } = await supabase
        .from('comprobante_items')
        .select('*, productos(nombre), unidad_venta:unidades_medida!unidad_venta_id(codigo, descripcion)')
        .eq('comprobante_id', saleId);
      
      if (itemsError) throw itemsError;

      const formattedItems = itemsData.map(i => ({
        ...i,
        producto_nombre: i.descripcion || i.productos?.nombre || 'Producto Eliminado'
      }));
      setItems(formattedItems);

    } catch (error) {
      console.error("Error loading sale details:", error);
      toast({ title: "Error", description: "No se pudo cargar el detalle de la venta.", variant: "destructive" });
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (newStatus === sale?.estado_pago) return;

    setSaving(true);
    try {
      // Update the record in 'comprobantes' table as that's what we are displaying
      const { error } = await supabase
        .from('comprobantes')
        .update({ estado_pago: newStatus })
        .eq('id', saleId);

      if (error) throw error;

      toast({ title: "Actualizado", description: "Estado de pago actualizado correctamente." });
      
      setSale(prev => ({ ...prev, estado_pago: newStatus }));
      setIsEditing(false);
      
      // Refresh parent table
      if (onUpdateSale) onUpdateSale();
      
    } catch (error) {
      console.error("Error updating status:", error);
      toast({ title: "Error", description: "No se pudo actualizar el estado.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Ver HistorialVentas.jsx: llama a reintentar_cae_comprobante (mig.180), que
  // reencola la fila más reciente por id (nunca un blanket update por
  // comprobante_id) para no chocar contra uq_fpa_comprobante_activo.
  const handleReintentarCae = async () => {
    setReintentandoCae(true);
    try {
      const { error } = await supabase.rpc('reintentar_cae_comprobante', {
        p_comprobante_id: sale.id,
      });
      if (error) throw error;

      toast({ title: 'CAE reencolado', description: 'El worker reintentará la emisión en los próximos minutos.' });
      fetchSaleDetails();
      onUpdateSale?.();
    } catch (e) {
      toast({ title: 'Error al reintentar', description: e.message, variant: 'destructive' });
    } finally {
      setReintentandoCae(false);
    }
  };

  // Cancelación real — Factura: RPC cancelar_factura (mig.259), reversa stock,
  // caja, cuenta corriente y el asiento contable. NC: RPC cancelar_nota_credito
  // (mig.267), reversa solo cuenta corriente (una NC nunca tocó stock/caja/
  // asiento). ND: RPC cancelar_nota_debito (mig.321) — mismo criterio que NC,
  // antes ni siquiera tenía RPC de cancelación (bug real, 13/08). Documento de
  // reversa en los tres casos — nunca se borra el rastro original. Bloqueada
  // por el propio RPC si el comprobante tiene CAE o ya fue imputado/cobrado.
  const esNC = sale?.tipo === 'nota_credito';
  const esND = sale?.tipo === 'nota_debito';
  const nombreTipo = esNC ? 'Nota de Crédito' : esND ? 'Nota de Débito' : 'Factura';
  const rpcCancelar = esNC ? 'cancelar_nota_credito' : esND ? 'cancelar_nota_debito' : 'cancelar_factura';
  const handleCancelarFactura = async () => {
    if (!sale) return;
    setCancelando(true);
    try {
      const { data, error } = await supabase.rpc(rpcCancelar, {
        p_empresa_id: user.empresa_id,
        p_user_id: user.id,
        p_comprobante_id: sale.id,
        p_motivo: motivoCancelacion.trim() || null,
      });
      if (error) throw error;

      if (!esNC && !esND) {
        asientosAutoService.crearAsientoReversaVenta(user.empresa_id, user.id, {
          ventaId: sale.id,
          numeroVenta: data?.numero_venta ?? sale.numero_venta,
          fecha: getTodayAR(),
        }).catch(e => console.warn('[Contabilidad] reversa venta:', e.message));
      }

      toast({
        title: `${nombreTipo} ${sale.numero_venta} cancelada`,
        description: (esNC || esND) ? 'Se revirtió el efecto en cuenta corriente.' : 'Se revirtió stock, caja y cuenta corriente.',
      });
      setShowCancelarConfirm(false);
      setMotivoCancelacion('');
      await fetchSaleDetails();
      onUpdateSale?.();
    } catch (err) {
      toast({ title: `No se pudo cancelar la ${nombreTipo}`, description: err.message, variant: 'destructive' });
    } finally {
      setCancelando(false);
    }
  };

  const hasChanges = sale && newStatus !== sale.estado_pago;
  const caeBloqueaCancelacion = sale && CAE_BLOQUEA_CANCELACION.includes(sale.cae_estado);
  // Marca el punto ámbar en la solapa Comunicación Electrónica (item 7): el
  // usuario ve que el CAE falló sin tener que entrar a la solapa.
  const caeConError = !!sale && ['error', 'error_definitivo'].includes(sale.cae_estado);
  const puedeCancelar = sale && ['venta', 'nota_credito', 'nota_debito'].includes(sale.tipo) && sale.estado_pago !== 'cancelada';
  const puedeRegenerarAsiento = sale && sale.tipo === 'venta' && !sale.asiento_id && sale.estado_pago !== 'cancelada';

  const handleRegenerarAsiento = async () => {
    const { error } = await supabase.rpc('regenerar_asiento_venta', {
      p_comprobante_id: sale.id,
      p_user_id: user.id,
    });
    if (error) {
      toast({ title: 'No se pudo regenerar el asiento', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Asiento regenerado', className: 'bg-emerald-600 text-white border-none' });
    fetchSaleDetails();
  };

  // Chips del flujo del documento — mismo componente y forma (tipo, id,
  // numero, active) que usa Entrega (item 7, hallazgo Luciano 22/08: antes
  // Factura tenía su propio DocumentFlowPanel con tarjetas, visualmente
  // distinto). El orden sigue la cadena física: origen → entrega(s) → actual
  // → NC / cobros / devoluciones emitidos contra este comprobante.
  const flowChips = flow ? [
    ...(flow.origen ? [{ tipo: flow.origen.tipo, id: flow.origen.id, numero: flow.origen.numero }] : []),
    ...(flow.fuente_nc ? [{ tipo: flow.fuente_nc.tipo, id: flow.fuente_nc.id, numero: flow.fuente_nc.numero }] : []),
    ...flow.entregas.map(e => ({ tipo: e.tipo, id: e.id, numero: e.numero })),
    { tipo: flow.actual.tipo, id: flow.actual.id, numero: flow.actual.numero, active: true },
    ...flow.notas_credito.map(nc => ({ tipo: nc.tipo, id: nc.id, numero: nc.numero })),
    ...flow.cobros_cc.map(c => ({ tipo: c.tipo, id: c.id, numero: c.numero })),
    ...flow.devoluciones.map(d => ({ tipo: d.tipo, id: d.id, numero: d.numero })),
  ] : [];

  if (!open) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* size="wide" — mismo shell que el resto de los documentos (hallazgo
            Luciano 22/08: antes cada uno traía su propio max-w). */}
        <DialogContent size="wide" className="kairox-bg-card kairox-text-primary dark:bg-kx-bg dark:border-kx-border">
          <DialogHeader className="border-b border-slate-100 dark:border-kx-border px-6 pt-6 pb-4 shrink-0">
            <DialogTitle className="flex justify-between items-center pr-8 dark:text-kx-text">
              <span className="flex items-center gap-2">
                {/* Ícono antes del título — mismo criterio que Entrega/OC
                    (hallazgo Luciano 23/08: a la Factura le faltaba). */}
                <Receipt className="h-5 w-5 text-green-600 dark:text-green-500" />
                {/* Número fiscal (letra + folio) cuando ya tiene CAE — antes
                    siempre mostraba el correlativo interno, que ni el cliente
                    ni ARCA reconocen (hallazgo Luciano 22/08, item 7). */}
                {sale ? formatNumeroComprobante(sale) : 'Venta #...'}
                {loading && <Loader2 className="h-4 w-4 animate-spin text-kx-text-3" />}
              </span>
            </DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              Detalle completo de la transacción {sale && `- ${formatDateTimeAR(sale.fecha)}`}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
             <div className="flex-1 flex items-center justify-center p-12">
               <Loader2 className="h-8 w-8 animate-spin text-kx-blue" />
             </div>
          ) : sale ? (
            /* Shell tabulado (item 7, 22/08) — mismo esquema de solapas que SAP
               usa en sus documentos de marketing, adaptado a lo que realmente
               necesitamos. La barra de solapas queda fija; scrollea solo el
               contenido. */
            <Tabs defaultValue="contenido" className="flex flex-1 flex-col overflow-hidden">
              <div className="shrink-0 px-6">
                <DocumentoTabsList>
                  <DocumentoTab value="contenido" icon={FileText}>Contenido</DocumentoTab>
                  <DocumentoTab value="electronica" icon={Zap} alerta={caeConError}>
                    Comunicación Electrónica
                  </DocumentoTab>
                  <DocumentoTab value="contabilidad" icon={Calculator} alerta={puedeRegenerarAsiento}>
                    Contabilidad
                  </DocumentoTab>
                  <DocumentoTab value="logistica" icon={MapPin}>Logística</DocumentoTab>
                </DocumentoTabsList>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* Contenido centrado con ancho máximo — el modal ocupa toda la
                  pantalla (mismo shell que Entrega/OC/Pedido) pero esta grilla de
                  2 columnas se ve estirada de más a lo ancho completo. */}
              <div className="max-w-5xl mx-auto">

              <TabsContent value="contenido" className="mt-0 focus-visible:outline-none">
              {/* Header en grilla — mismo patrón que Entrega/OC/Pedido (item 7,
                  hallazgo Luciano 22/08: antes eran dos tarjetas sueltas con un
                  diseño propio). Las acciones (Registrar Cobro, Cancelar,
                  editar estado) se mudaron al footer, como en Entrega. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-6 mt-2">
                <Campo label="Estado de pago">
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 -mt-0.5">
                      <select
                        className="h-7 rounded border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-bg text-xs px-1.5 focus:ring-2 focus:ring-blue-500 outline-none dark:text-kx-text"
                        value={newStatus}
                        onChange={(e) => setNewStatus(e.target.value)}
                      >
                        <option value="pagada">Pagada</option>
                        <option value="pendiente">Pendiente</option>
                        <option value="parcial">Parcial</option>
                      </select>
                      {hasChanges ? (
                        <Button size="icon" variant="ghost" onClick={handleUpdateStatus} disabled={saving} className="h-7 w-7 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        </Button>
                      ) : null}
                      <Button size="icon" variant="ghost" onClick={() => { setIsEditing(false); setNewStatus(sale.estado_pago); }} className="h-7 w-7 text-slate-500 hover:bg-slate-200 dark:text-kx-text-2 dark:hover:bg-slate-800">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <EstadoBadge estado={sale.estado_pago} />
                      {/* Una factura cancelada es un estado terminal — no se
                          reedita a mano (eso reabriría el estado sin restaurar
                          lo que cancelar_factura revirtió). */}
                      {sale.estado_pago !== 'cancelada' && (
                        <button type="button" onClick={() => setIsEditing(true)} className="text-kx-text-3 hover:text-kx-blue">
                          <Edit2 className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  )}
                </Campo>
                <Campo label="Forma de pago">{sale.forma_pago}</Campo>
                <Campo label="Fecha"><span className="dark:text-slate-300">{formatDateAR(sale.fecha)}</span></Campo>
                <Campo label="Cliente">
                  <span className="font-medium dark:text-kx-text">{sale.cliente_nombre || 'Consumidor Final'}</span>
                </Campo>
                <Campo label="CUIT / DNI">
                  <span className="font-mono dark:text-slate-300">{sale.clientes?.documento || '—'}</span>
                </Campo>
                {flow?.origen && (
                  <Campo label={flow.origen.tipo === 'cotizacion' ? 'Cotización de origen' : 'Pedido de origen'}>
                    <span className="font-mono dark:text-slate-300">{flow.origen.numero}</span>
                  </Campo>
                )}
                {flow?.entregas?.[0] && (
                  <Campo label="Entrega"><span className="font-mono dark:text-slate-300">{flow.entregas[0].numero}</span></Campo>
                )}
              </div>

              {/* Tabla de productos — mismo estilo plano que Entrega/Pedido/OC
                  (hallazgo Luciano 23/08: esta era la única con caja, header
                  con fondo y hover por fila; se saca esa envoltura pero se
                  mantiene toda la información, incluido el desglose Neto/IVA). */}
              <table className="w-full text-sm mb-6">
                <thead>
                  <tr className="border-b border-kx-border dark:border-kx-border">
                    <th className="text-left pb-2 text-kx-text-2">Producto</th>
                    <th className="text-center pb-2 text-kx-text-2 w-20">Cant</th>
                    <th className="text-right pb-2 text-kx-text-2 w-28">Precio Unit</th>
                    <th className="text-right pb-2 text-kx-text-2 w-28">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    // Venta por pack (mig.189/190): si el ítem se vendió por pack, mostrar
                    // la cantidad/precio en la unidad de venta en vez de la unidad base.
                    const isPack = !!item.unidad_venta_id;
                    const displayCant = isPack ? `${item.cantidad_venta} ${item.unidad_venta?.codigo || 'pack'}` : item.cantidad;
                    const displayPunit = isPack ? item.precio_unidad_venta : item.precio_unitario;
                    return (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800/50">
                      <td className="py-2 dark:text-kx-text">{item.producto_nombre}</td>
                      <td className="py-2 text-center text-kx-text-2">{displayCant}</td>
                      <td className="py-2 text-right text-kx-text-2">${Number(displayPunit).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="py-2 text-right font-mono dark:text-kx-text">${Number(item.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    );
                  })}
                </tbody>
                {(() => {
                  // Fase 2 (15/08): antes el desglose Neto/IVA solo existía en el
                  // PDF — hoy no hacía falta descargarlo para ver el total, pero
                  // sí para ver cuánto era IVA Débito Fiscal. Se calcula desde los
                  // ítems (mismo criterio que Cotización/Pedido/OC) en vez de
                  // confiar en comprobantes.neto_gravado/iva_discriminado: esas
                  // columnas están en NULL en 35 de 158 facturas reales de Nalux
                  // (comprobantes viejos o creados antes de que se empezaran a
                  // completar), así que el dato siempre correcto es recalcularlo.
                  const factorIva = { '21': 1.21, '10.5': 1.105 };
                  const neto = items.reduce((s, i) => s + Number(i.subtotal) / (factorIva[String(i.alicuota_iva)] ?? 1), 0);
                  const iva = Number(sale.total) - neto;
                  const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  return (
                    <tfoot>
                      {iva > 0.005 && (
                        <>
                          <tr>
                            <td colSpan={3} className="pt-3 text-right text-xs text-kx-text-3">Neto gravado</td>
                            <td className="pt-3 text-right text-xs text-kx-text-3">${fmt(neto)}</td>
                          </tr>
                          <tr>
                            <td colSpan={3} className="text-right text-xs text-kx-text-3">IVA</td>
                            <td className="text-right text-xs text-kx-text-3">${fmt(iva)}</td>
                          </tr>
                        </>
                      )}
                      <tr className="border-t-2 border-kx-border dark:border-kx-border">
                        <td colSpan={3} className="py-3 text-right font-bold dark:text-kx-text">TOTAL</td>
                        <td className="py-3 text-right font-bold text-lg dark:text-kx-text">${fmt(sale.total)}</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>

              {/* Flujo del documento — mismo bloque que Entrega/OC/Pedido
                  (item 7): título + link a Mapa de Relaciones arriba,
                  pastillas con flechas abajo. El asiento se fue a la solapa
                  Contabilidad. */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <p className="text-2xs font-semibold text-kx-text-3 dark:text-kx-text-3 uppercase tracking-wider">
                    Flujo del documento
                  </p>
                  <button
                    type="button"
                    onClick={() => setMapaOpen(true)}
                    className="text-2xs text-kx-violet hover:opacity-80 font-medium flex items-center gap-1"
                    title="Ver mapa de relaciones completo"
                  >
                    <Network className="w-3 h-3" /> Mapa de relaciones
                  </button>
                </div>
                <DocumentFlow
                  chips={flowChips}
                  onNavigate={(tipo, id) => {
                    // Un cobro no navega a otro módulo — abre el mismo
                    // Comprobante de Pago, apilado arriba de esta factura,
                    // sin perder el contexto (29/08, hallazgo Luciano).
                    if (tipo === 'cobro_cc') { cobro.abrirDetalleCobro(id); return; }
                    onNavigate?.(tipo, id);
                  }}
                />
              </div>
              </TabsContent>

              <TabsContent value="electronica" className="mt-0 focus-visible:outline-none">
                <TabComunicacionElectronica
                  comprobante={sale}
                  puntoVenta={sale.punto_venta}
                  onReintentarCae={handleReintentarCae}
                  reintentando={reintentandoCae}
                />
              </TabsContent>

              <TabsContent value="contabilidad" className="mt-0 focus-visible:outline-none">
                <TabContabilidad
                  documento={sale}
                  asientoId={sale.asiento_id}
                  empresaId={user?.empresa_id}
                  origen="venta"
                  origenId={sale.id}
                  onRegenerarAsiento={handleRegenerarAsiento}
                  puedeRegenerarAsiento={puedeRegenerarAsiento}
                />
              </TabsContent>

              <TabsContent value="logistica" className="mt-0 focus-visible:outline-none">
                {/* Una Factura no congela domicilio (eso lo hace la Entrega,
                    que es el evento físico — Regla 8). Acá se muestra el
                    domicilio ACTUAL del cliente, y el componente lo aclara. */}
                <TabLogistica
                  fallback={sale.clientes}
                  nombreDestinatario={sale.cliente_nombre || sale.clientes?.nombre || 'Consumidor Final'}
                />
              </TabsContent>

              <MapaRelaciones
                open={mapaOpen}
                onOpenChange={setMapaOpen}
                comprobanteId={saleId}
                onNavigate={(tipo, id) => {
                  setMapaOpen(false);
                  // Un cobro se queda "en contexto" — cierra solo el Mapa y
                  // abre el Comprobante de Pago apilado, la factura sigue
                  // abierta atrás (29/08, hallazgo Luciano).
                  if (tipo === 'cobro_cc') { cobro.abrirDetalleCobro(id); return; }
                  onOpenChange(false);
                  onNavigate?.(tipo, id);
                }}
              />
              </div>
              </div>
            </Tabs>
          ) : (
            <div className="p-8 text-center text-kx-text-2">No se encontraron datos.</div>
          )}

          {/* Footer — mismo layout que Entrega (item 7): Cerrar + acción
              destructiva a la izquierda, acciones positivas a la derecha.
              Antes Registrar Cobro / Cancelar Factura vivían en la tarjeta de
              header; ahora son acciones de documento, no datos. */}
          <DialogFooter className="border-t border-slate-100 dark:border-kx-border px-6 py-4 flex-wrap gap-2 sm:justify-between shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="dark:text-kx-text dark:border-kx-border dark:hover:bg-slate-800">
                Cerrar
              </Button>
              {puedeCancelar && !caeBloqueaCancelacion && (
                <Button
                  variant="outline"
                  onClick={() => setShowCancelarConfirm(true)}
                  className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <Ban className="w-4 h-4 mr-2" /> {`Cancelar ${nombreTipo}`}
                </Button>
              )}
              {puedeCancelar && caeBloqueaCancelacion && (
                <span className="text-xs text-kx-text-3 italic">
                  {esNC || esND ? 'Tiene CAE — no se puede anular directamente' : 'Tiene CAE — para anularla generá una Nota de Crédito'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {['pendiente', 'parcial'].includes(sale?.estado_pago) && sale?.cliente_id && (
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => cobro.abrirCobroPorClienteId(sale.cliente_id, sale.id)}
                >
                  <Banknote className="w-4 h-4 mr-2" /> Registrar Cobro
                </Button>
              )}
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => setShowPrintModal(true)}
                disabled={!sale}
              >
                <Printer className="w-4 h-4 mr-2" /> Imprimir Comprobante
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {sale && (
         <ComprobantePrintModal
           open={showPrintModal}
           onOpenChange={setShowPrintModal}
           comprobante={sale}
           items={items}
         />
      )}

      <AlertDialog open={showCancelarConfirm} onOpenChange={v => { if (!cancelando) { setShowCancelarConfirm(v); if (!v) setMotivoCancelacion(''); } }}>
        <AlertDialogContent className="dark:bg-kx-bg dark:border-kx-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="dark:text-kx-text">
              ¿Cancelar {nombreTipo} {sale?.numero_venta}?
            </AlertDialogTitle>
            <AlertDialogDescription className="dark:text-kx-text-2">
              {esNC
                ? 'Se revierte el crédito otorgado en cuenta corriente (la deuda del cliente vuelve a subir). Queda un registro completo de la reversión — nada se borra. Esta acción no se puede deshacer.'
                : esND
                ? 'Se revierte el cargo en cuenta corriente (la deuda del cliente vuelve a bajar). Queda un registro completo de la reversión — nada se borra. Esta acción no se puede deshacer.'
                : 'Se repone el stock entregado, se revierte el cobro en caja (si lo hubo) y la deuda en cuenta corriente (si la hay). Queda un registro completo de la reversión — nada se borra. Esta acción no se puede deshacer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={motivoCancelacion}
            onChange={e => setMotivoCancelacion(e.target.value)}
            placeholder="Motivo (opcional) — ej. error de carga, cliente equivocado..."
            className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            rows={2}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelando} className="dark:text-kx-text dark:border-kx-border">Volver</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelarFactura} disabled={cancelando} className="bg-red-600 hover:bg-red-700 text-white">
              {cancelando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Ban className="h-4 w-4 mr-2" />}
              {`Sí, cancelar ${esNC ? 'NC' : esND ? 'ND' : 'factura'}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* "Registrar Cobro" apilado arriba de este detalle — ver cobro más
          arriba. Radix apila los Dialog por orden de montaje (mismo patrón
          que MapaRelaciones/AlertDialog acá mismo), así que queda por encima
          sin tocar el z-index a mano. */}
      <ModalCobro
        isPaymentDialogOpen={cobro.isPaymentDialogOpen} setIsPaymentDialogOpen={cobro.setIsPaymentDialogOpen}
        selectedClient={cobro.selectedClient}
        paymentData={cobro.paymentData} setPaymentData={cobro.setPaymentData}
        formasPago={cobro.formasPago}
        tcParalelo={cobro.tcParalelo}
        isProcessingPayment={cobro.isProcessingPayment}
        handleRegisterPayment={cobro.handleRegisterPayment}
        facturasAbiertas={cobro.facturasAbiertas}
        imputaciones={cobro.imputaciones} setImputaciones={cobro.setImputaciones}
        imputacionesFX={cobro.imputacionesFX} setImputacionesFX={cobro.setImputacionesFX}
        autoDistribuirFIFO={cobro.autoDistribuirFIFO}
      />
      {/* "Comprobante de Pago" — se abre solo al confirmar un cobro nuevo
          (useRegistrarCobro) o al hacer clic en un chip/nodo de cobro
          existente (arriba). Misma instancia para ambos casos. */}
      <ModalDetalleCobro
        movimientoId={cobro.detalleCobroId}
        open={cobro.detalleCobroOpen}
        onOpenChange={cobro.setDetalleCobroOpen}
        onUpdate={() => { fetchSaleDetails(); onUpdateSale?.(); }}
        onCancelar={cobro.handleCancelarCobro}
        onNavigate={(clienteId) => { cobro.setDetalleCobroOpen(false); onOpenChange(false); onNavigate?.('cliente_cc', clienteId); }}
      />
      <TipoCambioModal
        open={cobro.showParaleloTCModal}
        onOpenChange={cobro.setShowParaleloTCModal}
        moneda={cobro.tcParalelo.monedaParalela}
        onConfirm={(t) => { cobro.tcParalelo.setTC(t); cobro.setShowParaleloTCModal(false); }}
      />
    </>
  );
};

export default SaleDetailModal;