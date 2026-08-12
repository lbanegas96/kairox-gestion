import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Loader2, ChevronRight, Network, ExternalLink, Maximize2, Minimize2,
  FileText, ClipboardList, Truck, Receipt, RotateCcw, PlusCircle, Undo2,
  Wallet, ShoppingCart, PackageCheck, Layers, X,
} from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatDateAR } from '@/lib/dateUtils';

const fmt = (n) =>
  Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// mig.315 — Fase 1 del rediseño (PLAN_MAPA_RELACIONES.md): un ícono por tipo de
// documento, mismo espíritu que los íconos circulares por etapa del Relationship
// Map de SAP B1 — de un vistazo se distingue el tipo de paso, no solo el color.
const TIPO_CONFIG = {
  // ── Ventas ─────────────────────────────────────────────────────────────────
  cotizacion:      { label: 'Cotización',      color: 'border-t-kx-text-3', accent: 'text-kx-text-3', bg: 'bg-kx-text-3/10', icon: FileText },
  pedido:          { label: 'Pedido',          color: 'border-t-kx-blue',   accent: 'text-kx-blue',   bg: 'bg-kx-blue/10',   icon: ClipboardList },
  entrega:         { label: 'Entrega',         color: 'border-t-kx-violet', accent: 'text-kx-violet', bg: 'bg-kx-violet/10', icon: Truck },
  venta:           { label: 'Factura',         color: 'border-t-kx-green',  accent: 'text-kx-green',  bg: 'bg-kx-green/10',  icon: Receipt },
  nota_credito:    { label: 'Nota de Crédito', color: 'border-t-kx-amber',  accent: 'text-kx-amber',  bg: 'bg-kx-amber/10',  icon: RotateCcw },
  nota_debito:     { label: 'Nota de Débito',  color: 'border-t-kx-red',    accent: 'text-kx-red',    bg: 'bg-kx-red/10',    icon: PlusCircle },
  devolucion:      { label: 'Devolución',      color: 'border-t-kx-amber',  accent: 'text-kx-amber',  bg: 'bg-kx-amber/10',  icon: Undo2 },
  cobro_cc:        { label: 'Cobro CC',        color: 'border-t-kx-green',  accent: 'text-kx-green',  bg: 'bg-kx-green/10',  icon: Wallet },
  // ── Compras ────────────────────────────────────────────────────────────────
  orden_compra:    { label: 'Orden de Compra', color: 'border-t-kx-blue',   accent: 'text-kx-blue',   bg: 'bg-kx-blue/10',   icon: ShoppingCart },
  recepcion:       { label: 'Recepción',       color: 'border-t-kx-violet', accent: 'text-kx-violet', bg: 'bg-kx-violet/10', icon: PackageCheck },
  factura_compra:  { label: 'Factura Compra',  color: 'border-t-kx-blue',   accent: 'text-kx-blue',   bg: 'bg-kx-blue/10',   icon: Receipt },
  pago_proveedor:  { label: 'Pago CC',         color: 'border-t-kx-green',  accent: 'text-kx-green',  bg: 'bg-kx-green/10',  icon: Wallet },
  nc_proveedor:    { label: 'NC Proveedor',    color: 'border-t-kx-amber',  accent: 'text-kx-amber',  bg: 'bg-kx-amber/10',  icon: RotateCcw },
  nd_proveedor:    { label: 'ND Recibida',     color: 'border-t-kx-red',    accent: 'text-kx-red',    bg: 'bg-kx-red/10',    icon: PlusCircle },
  devolucion_prov: { label: 'Dev. Proveedor',  color: 'border-t-kx-amber',  accent: 'text-kx-amber',  bg: 'bg-kx-amber/10',  icon: Undo2 },
};

// Heurística de color de estado — unifica el vocabulario heterogéneo que trae
// cada tabla (pedido.estado, entrega.estado, nc.estado_pago, devolucion.compensacion...)
// en los mismos 3 colores que ya usa el resto de KAIROX, sin romper con un valor
// inesperado (cae a neutral en vez de tirar error).
function estadoColor(estado) {
  if (!estado) return null;
  const e = String(estado).toLowerCase();
  if (/(rechazad|cancelad|anulad|error)/.test(e)) return 'red';
  if (/(pendient|abiert|proceso)/.test(e)) return 'amber';
  if (/(cerrad|confirmad|complet|entregad|cobrad|pagad|recibid)/.test(e)) return 'green';
  return null;
}
const ESTADO_BADGE = {
  green: 'bg-kx-green/10 text-kx-green',
  amber: 'bg-kx-amber/10 text-kx-amber',
  red:   'bg-kx-red/10 text-kx-red',
};

function NodoMapa({ nodo, activo = false, onClick }) {
  const config    = TIPO_CONFIG[nodo.tipo] ?? TIPO_CONFIG.venta;
  const Icono     = config.icon;
  const clickable = !!onClick && !activo;
  const eColor    = estadoColor(nodo.estado);

  return (
    <div
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      className={[
        'bg-kx-surface border border-kx-border rounded-xl p-3',
        'w-[150px] flex-shrink-0 select-none',
        'border-t-2',
        activo
          ? 'border-t-[rgb(var(--kx-violet))] ring-2 ring-[rgb(var(--kx-violet)/0.18)]'
          : config.color,
        clickable
          ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-150'
          : 'cursor-default',
      ].join(' ')}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center ${
          activo ? 'bg-[rgb(var(--kx-violet)/0.14)]' : config.bg
        }`}>
          <Icono className={`w-3.5 h-3.5 ${activo ? 'text-[rgb(var(--kx-violet))]' : config.accent}`} />
        </span>
        {activo && (
          <span className="text-[8px] bg-[rgb(var(--kx-violet)/0.12)] text-[rgb(var(--kx-violet))] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide">
            actual
          </span>
        )}
      </div>

      <div className={`text-2xs font-bold uppercase tracking-wider mb-0.5 ${
        activo ? 'text-[rgb(var(--kx-violet))]' : config.accent
      }`}>
        {config.label}
      </div>

      <div className="text-xs font-bold text-kx-text truncate" title={nodo.numero || ''}>
        {nodo.numero || '—'}
      </div>

      {nodo.fecha && (
        <div className="text-2xs text-kx-text-2 mt-0.5">{formatDateAR(nodo.fecha)}</div>
      )}

      {(nodo.total != null || nodo.monto != null) && (
        <div className="text-xs font-semibold text-kx-text mt-1 tabular-nums">
          ${fmt(nodo.total ?? nodo.monto)}
        </div>
      )}

      {nodo.estado && (
        <div className={`text-[9px] mt-1.5 px-1.5 py-0.5 rounded-full inline-block capitalize ${
          eColor ? ESTADO_BADGE[eColor] : 'bg-kx-surface-2 text-kx-text-3'
        }`}>
          {nodo.estado}
        </div>
      )}

      {clickable && (
        <div className="mt-1.5 text-[9px] text-kx-text-3 flex items-center gap-0.5">
          <ExternalLink className="w-2.5 h-2.5" /> ver detalle
        </div>
      )}
    </div>
  );
}

// Conector estilo "stepper" — línea + punta, en vez del ícono de flecha suelto
// que se desalineaba al haber varias filas (hallazgo del barrido, PLAN_MAPA_RELACIONES.md).
function Conector() {
  return (
    <div className="flex items-center flex-shrink-0 self-center px-0.5 mt-[34px]">
      <div className="w-3 md:w-5 h-[2px] rounded-full bg-gradient-to-r from-kx-border to-kx-text-3/50" />
      <ChevronRight className="w-3.5 h-3.5 text-kx-text-3 -ml-1" />
    </div>
  );
}

// Barra de resumen del circuito — inspirada en la fila de estado de SAP B1
// (íconos por etapa + distribución de estados), simplificada a lo que ya
// tenemos: cantidad de pasos de la cadena principal, monto del documento
// activo, y cuántos documentos derivados cuelgan de él.
function ResumenCircuito({ pasos, total, derivados }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pb-3 mb-1 border-b border-kx-border">
      <span className="flex items-center gap-1.5 text-2xs font-medium text-kx-text-2 bg-kx-surface-2 px-2.5 py-1 rounded-full">
        <Layers className="w-3 h-3 text-kx-text-3" /> {pasos} {pasos === 1 ? 'paso' : 'pasos'} en la cadena
      </span>
      {total != null && (
        <span className="text-2xs font-medium text-kx-text-2 bg-kx-surface-2 px-2.5 py-1 rounded-full tabular-nums">
          Total: ${fmt(total)}
        </span>
      )}
      {derivados > 0 && (
        <span className="text-2xs font-medium text-kx-violet bg-kx-violet/10 px-2.5 py-1 rounded-full">
          {derivados} documento{derivados !== 1 ? 's' : ''} derivado{derivados !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

// Panel de preview inline — Fase 2 del rediseño (PLAN_MAPA_RELACIONES.md). La
// queja más repetida de los usuarios de SAP B1 con su Relationship Map es que
// solo da una vista de alto nivel: para ver qué hay adentro de cada documento
// hay que abrirlo aparte, perdiendo el contexto del circuito completo. Acá el
// clic en un nodo abre esto DENTRO del mismo modal — el header ya lo tenemos
// (viene del propio nodo, sin fetch extra), solo los ítems se piden aparte.
function PreviewPanel({ nodo, items, loading, onClose, onVerCompleto }) {
  const config = TIPO_CONFIG[nodo.tipo] ?? TIPO_CONFIG.venta;
  const Icono  = config.icon;
  const eColor = estadoColor(nodo.estado);

  return (
    <div className="w-[280px] flex-shrink-0 border-l border-kx-border pl-4 py-2 overflow-y-auto">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${config.bg}`}>
            <Icono className={`w-4 h-4 ${config.accent}`} />
          </span>
          <div className="min-w-0">
            <div className={`text-2xs font-bold uppercase tracking-wider ${config.accent}`}>{config.label}</div>
            <div className="text-sm font-bold text-kx-text truncate" title={nodo.numero || ''}>{nodo.numero || '—'}</div>
          </div>
        </div>
        <button onClick={onClose} className="text-kx-text-3 hover:text-kx-text flex-shrink-0 p-0.5" title="Cerrar preview">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {nodo.fecha && <span className="text-2xs text-kx-text-2">{formatDateAR(nodo.fecha)}</span>}
        {nodo.estado && (
          <span className={`text-2xs px-1.5 py-0.5 rounded-full capitalize ${eColor ? ESTADO_BADGE[eColor] : 'bg-kx-surface-2 text-kx-text-3'}`}>
            {nodo.estado}
          </span>
        )}
      </div>

      {(nodo.total != null || nodo.monto != null) && (
        <div className="text-lg font-bold text-kx-text tabular-nums mb-3">
          ${fmt(nodo.total ?? nodo.monto)}
        </div>
      )}

      <div className="border-t border-kx-border pt-3">
        <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider mb-2">Ítems</p>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-kx-text-3 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando...
          </div>
        ) : items && items.length > 0 ? (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex items-start justify-between gap-2 text-xs">
                <span className="text-kx-text-2">
                  <span className="text-kx-text font-medium tabular-nums">{it.cantidad}×</span> {it.nombre}
                </span>
                {it.subtotal != null && (
                  <span className="text-kx-text tabular-nums flex-shrink-0">${fmt(it.subtotal)}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-kx-text-3">Sin ítems para mostrar.</p>
        )}
      </div>

      {onVerCompleto && (
        <Button
          variant="outline" size="sm"
          className="w-full mt-4 text-xs border-kx-border text-kx-text-2"
          onClick={onVerCompleto}
        >
          Ver documento completo <ExternalLink className="w-3 h-3 ml-1.5" />
        </Button>
      )}
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

// mig.316 — Fase 3 del rediseño (PLAN_MAPA_RELACIONES.md): puntos de acceso desde
// cualquier eslabón de la cadena, no solo el documento final. Cada uno de estos
// tipos tiene un FK directo (nullable) al comprobante/compra que ancla el mapa
// existente — si todavía no existe (documento sin facturar), se muestra un
// estado "sin facturar" en vez de fallar.
function MapaRelaciones({
  open, onOpenChange, onNavigate,
  comprobanteId, compraId,
  cotizacionId, pedidoId, entregaId, recepcionId, devolucionId,
}) {
  const { user }  = useAuth();
  const [loading, setLoading] = useState(false);
  const [mapa, setMapa]       = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [previewNodo, setPreviewNodo]   = useState(null); // { tipo, id, numero, fecha, total|monto, estado }
  const [previewItems, setPreviewItems] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [activoId, setActivoId] = useState(null);        // id del nodo que se abrió — el que se marca "actual"
  const [sinFacturar, setSinFacturar] = useState(null);  // { label, nodo } cuando el entry point no tiene comprobante/compra todavía
  const isCompra = mapa?.modo === 'compra' || (!!compraId && !comprobanteId);

  useEffect(() => {
    if (!open || !user?.empresa_id) return;
    resolveAndFetch();
  }, [open, comprobanteId, compraId, cotizacionId, pedidoId, entregaId, recepcionId, devolucionId, user?.empresa_id]);

  useEffect(() => {
    if (!open) { setMapa(null); setFullscreen(false); setPreviewNodo(null); setPreviewItems(null); setActivoId(null); setSinFacturar(null); }
  }, [open]);

  // ── Resolución del punto de entrada ──────────────────────────────────────────
  const resolveAndFetch = async () => {
    setSinFacturar(null);
    if (comprobanteId) { setActivoId(comprobanteId); return fetchMapaVenta(comprobanteId); }
    if (compraId)       { setActivoId(compraId);      return fetchMapaCompra(compraId); }

    setLoading(true);
    try {
      if (cotizacionId) {
        const { data } = await supabase.from('cotizaciones')
          .select('id, numero, fecha, total, estado, comprobante_id')
          .eq('id', cotizacionId).eq('empresa_id', user.empresa_id).maybeSingle();
        if (!data) return setMapa(null);
        if (data.comprobante_id) { setActivoId(cotizacionId); return fetchMapaVenta(data.comprobante_id); }
        return setSinFacturar({ label: 'Cotización', nodo: { tipo: 'cotizacion', numero: data.numero, fecha: data.fecha, total: data.total, estado: data.estado } });
      }
      if (pedidoId) {
        const { data } = await supabase.from('pedidos')
          .select('id, numero, fecha, total, estado, comprobante_id')
          .eq('id', pedidoId).eq('empresa_id', user.empresa_id).maybeSingle();
        if (!data) return setMapa(null);
        if (data.comprobante_id) { setActivoId(pedidoId); return fetchMapaVenta(data.comprobante_id); }
        return setSinFacturar({ label: 'Pedido', nodo: { tipo: 'pedido', numero: data.numero, fecha: data.fecha, total: data.total, estado: data.estado } });
      }
      if (entregaId) {
        const { data } = await supabase.from('entregas')
          .select('id, numero_entrega, fecha, estado, comprobante_id, pedido_id')
          .eq('id', entregaId).eq('empresa_id', user.empresa_id).maybeSingle();
        if (!data) return setMapa(null);
        let compId = data.comprobante_id;
        if (!compId && data.pedido_id) {
          const { data: ped } = await supabase.from('pedidos').select('comprobante_id').eq('id', data.pedido_id).maybeSingle();
          compId = ped?.comprobante_id;
        }
        if (compId) { setActivoId(entregaId); return fetchMapaVenta(compId); }
        return setSinFacturar({ label: 'Entrega', nodo: { tipo: 'entrega', numero: data.numero_entrega, fecha: data.fecha, estado: data.estado } });
      }
      if (recepcionId) {
        const { data } = await supabase.from('recepciones')
          .select('id, numero_recepcion, fecha, estado, compra_id')
          .eq('id', recepcionId).eq('empresa_id', user.empresa_id).maybeSingle();
        if (!data) return setMapa(null);
        if (data.compra_id) { setActivoId(recepcionId); return fetchMapaCompra(data.compra_id); }
        return setSinFacturar({ label: 'Recepción', nodo: { tipo: 'recepcion', numero: data.numero_recepcion, fecha: data.fecha, estado: data.estado } });
      }
      if (devolucionId) {
        const { data } = await supabase.from('devoluciones')
          .select('id, numero_devolucion, fecha, tipo, compensacion, comprobante_id, compra_id')
          .eq('id', devolucionId).eq('empresa_id', user.empresa_id).maybeSingle();
        if (!data) return setMapa(null);
        if (data.tipo === 'cliente' && data.comprobante_id) { setActivoId(devolucionId); return fetchMapaVenta(data.comprobante_id); }
        if (data.tipo === 'proveedor' && data.compra_id)    { setActivoId(devolucionId); return fetchMapaCompra(data.compra_id); }
        return setSinFacturar({ label: 'Devolución', nodo: { tipo: data.tipo === 'cliente' ? 'devolucion' : 'devolucion_prov', numero: data.numero_devolucion, fecha: data.fecha, estado: data.compensacion } });
      }
      setMapa(null);
    } catch (err) {
      console.error('[MapaRelaciones/resolve]', err);
      setMapa(null);
    } finally {
      setLoading(false);
    }
  };

  // ── Fetch lado Ventas ────────────────────────────────────────────────────────
  // Recibe el id ya resuelto (puede ser el comprobanteId directo, o el que
  // resolveAndFetch encontró a partir de una cotización/pedido/entrega/devolución).
  const fetchMapaVenta = async (idComprobante) => {
    setLoading(true);
    try {
      const { data: comp } = await supabase.from('comprobantes')
        .select('id, numero_venta, numero_afip, tipo, total, fecha, cliente_nombre, comprobante_origen_id, pedido_id, cotizacion_id')
        .eq('id', idComprobante).single();

      if (!comp) { setMapa(null); return; }

      const [origenRes, cotizacionRes, pedidoRes, entregasRes, ncsRes, ndsRes, devRes, cobrosRes] = await Promise.allSettled([
        comp.comprobante_origen_id
          ? supabase.from('comprobantes')
              .select('id, numero_venta, numero_afip, tipo, total, fecha')
              .eq('id', comp.comprobante_origen_id).single()
          : Promise.resolve({ data: null }),

        // Bugfix 11/08 (badge "actual" no marcaba desde Cotizaciones): la cadena nunca
        // armaba un nodo de cotización. OJO — la relación real es cotizaciones.comprobante_id
        // (hacia adelante), NO comprobantes.cotizacion_id: esa columna existe en el schema
        // pero está siempre en NULL en los datos reales (verificado: 6/20 cotizaciones
        // convertidas tienen comprobante_id, 0/N comprobantes tienen cotizacion_id) — por
        // eso hay que buscar por comprobante_id, no confiar en el FK inverso.
        supabase.from('cotizaciones')
          .select('id, numero, fecha, total, estado')
          .eq('comprobante_id', idComprobante).eq('empresa_id', user.empresa_id).maybeSingle(),

        comp.pedido_id
          ? supabase.from('pedidos')
              .select('id, numero, fecha, total, estado')
              .eq('id', comp.pedido_id).eq('empresa_id', user.empresa_id).maybeSingle()
          : Promise.resolve({ data: null }),

        // Entregas: las que apuntan al comprobante (POS implícita) Y las que apuntan al pedido (manual)
        comp.pedido_id
          ? supabase.from('entregas')
              .select('id, numero_entrega, fecha, estado, origen, pedido_id')
              .or(`comprobante_id.eq.${idComprobante},pedido_id.eq.${comp.pedido_id}`)
              .eq('empresa_id', user.empresa_id)
          : supabase.from('entregas')
              .select('id, numero_entrega, fecha, estado, origen, pedido_id')
              .eq('comprobante_id', idComprobante)
              .eq('empresa_id', user.empresa_id),

        supabase.from('comprobantes')
          .select('id, numero_venta, numero_afip, tipo, total, fecha, estado_pago')
          .eq('comprobante_origen_id', idComprobante)
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'nota_credito'),

        supabase.from('notas_debito')
          .select('id, numero_nd, concepto, monto, fecha')
          .eq('comprobante_id', idComprobante)
          .eq('empresa_id', user.empresa_id),

        supabase.from('devoluciones')
          .select('id, numero_devolucion, fecha, compensacion')
          .eq('comprobante_id', idComprobante)
          .eq('empresa_id', user.empresa_id),

        supabase.from('cuenta_corriente_movimientos')
          .select('id, tipo, monto, fecha, descripcion')
          .eq('comprobante_id', idComprobante)
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'HABER'),
      ]);

      const safe    = (res) => res.status === 'fulfilled' ? (res.value.data ?? null) : null;
      const safeArr = (res) => res.status === 'fulfilled' ? (res.value.data ?? []) : [];

      // Dedupe + priorización
      const entregasRaw = safeArr(entregasRes);
      const seen = new Set();
      const entregasDedup = entregasRaw.filter(e => seen.has(e.id) ? false : (seen.add(e.id), true));

      // Si el comprobante viene de un pedido, priorizar la entrega manual vinculada a ese pedido
      // y descartar todas las implícitas (para evitar la duplicación POS).
      let entregas;
      if (comp.pedido_id) {
        const manualesDelPedido = entregasDedup.filter(e => e.pedido_id === comp.pedido_id && e.origen === 'manual');
        if (manualesDelPedido.length > 0) {
          entregas = manualesDelPedido;
        } else {
          // Sin manual del pedido: caer al criterio general (manual gana a implícita si coexisten)
          const hayManual = entregasDedup.some(e => e.origen === 'manual');
          entregas = hayManual ? entregasDedup.filter(e => e.origen !== 'implicita') : entregasDedup;
        }
      } else {
        const hayManual = entregasDedup.some(e => e.origen === 'manual');
        entregas = hayManual ? entregasDedup.filter(e => e.origen !== 'implicita') : entregasDedup;
      }

      // Fallback de pedido: si el comprobante no lo trae, tomar el de la primera entrega que tenga pedido_id
      let pedido = safe(pedidoRes);
      if (!pedido) {
        const pedIdDesdeEntrega = entregas.find(e => e.pedido_id)?.pedido_id;
        if (pedIdDesdeEntrega) {
          const { data: ped } = await supabase.from('pedidos')
            .select('id, numero, fecha, total, estado')
            .eq('id', pedIdDesdeEntrega).eq('empresa_id', user.empresa_id).maybeSingle();
          pedido = ped;
        }
      }

      setMapa({
        modo:         'venta',
        comp,
        origen:       safe(origenRes),
        cotizacion:   safe(cotizacionRes),
        pedido,
        entregas,
        ncs:          safeArr(ncsRes),
        nds:          safeArr(ndsRes),
        devoluciones: safeArr(devRes),
        cobros:       safeArr(cobrosRes),
      });
    } catch (err) {
      console.error('[MapaRelaciones/venta]', err);
      setMapa(null);
    } finally {
      setLoading(false);
    }
  };

  // ── Fetch lado Compras ───────────────────────────────────────────────────────
  // Recibe el id ya resuelto (el compraId directo, o el que resolveAndFetch
  // encontró a partir de una recepción/devolución de proveedor).
  const fetchMapaCompra = async (idCompra) => {
    setLoading(true);
    try {
      const { data: compra } = await supabase.from('compras')
        .select('id, numero_factura, total, fecha, proveedor_id, proveedores(nombre)')
        .eq('id', idCompra).single();

      if (!compra) { setMapa(null); return; }

      const [recepcionesRes, ncsRes, ndsRes, pagosRes, ncFinRes] = await Promise.allSettled([
        // Recepciones vinculadas a esta compra
        supabase.from('recepciones')
          .select('id, numero_recepcion, fecha, estado')
          .eq('compra_id', idCompra)
          .eq('empresa_id', user.empresa_id),

        // Devoluciones (NC físicas) al proveedor
        supabase.from('devoluciones')
          .select('id, numero_devolucion, fecha, compensacion')
          .eq('compra_id', idCompra)
          .eq('tipo', 'proveedor')
          .eq('empresa_id', user.empresa_id),

        // ND recibidas de este proveedor sobre esta compra
        supabase.from('notas_debito')
          .select('id, numero_nd, concepto, monto, fecha')
          .eq('compra_id', idCompra)
          .eq('empresa_id', user.empresa_id),

        // Pagos en CC proveedores (referencia_id = idCompra, patrón viejo — solo pagos)
        supabase.from('cuenta_corriente_proveedores')
          .select('id, tipo, monto, fecha, descripcion, referencia_tipo')
          .eq('referencia_id', idCompra)
          .eq('empresa_id', user.empresa_id),

        // NC financieras de proveedor (mig.277 — documento propio, ya no vive
        // como referencia_id=idCompra en cuenta_corriente_proveedores; el CC
        // ahora apunta a notas_credito_proveedor.id, no a la compra).
        supabase.from('notas_credito_proveedor')
          .select('id, numero_ncp, motivo, monto, fecha')
          .eq('compra_id', idCompra)
          .eq('empresa_id', user.empresa_id),
      ]);

      const safeArr = (res) => res.status === 'fulfilled' ? (res.value.data ?? []) : [];

      const ccMovs         = safeArr(pagosRes);
      const pagosCC        = ccMovs.filter(m => m.tipo === 'DEBE' && m.referencia_tipo !== 'nc_proveedor');
      const ncsFinancieras = safeArr(ncFinRes);

      setMapa({
        modo:         'compra',
        compra,
        recepciones:  safeArr(recepcionesRes),
        devoluciones: safeArr(ncsRes),
        nds:          safeArr(ndsRes),
        pagos:        pagosCC,
        ncsFinancieras,
      });
    } catch (err) {
      console.error('[MapaRelaciones/compra]', err);
      setMapa(null);
    } finally {
      setLoading(false);
    }
  };

  const navigate = (tipo, id) => {
    onNavigate?.(tipo, id);
    onOpenChange(false);
  };

  // "actual" ya no es siempre el comprobante/compra ancla — puede ser
  // cualquier eslabón desde el que se abrió el mapa (Fase 3).
  const isActivo = (id) => activoId != null && id === activoId;

  // El preview usa el tipo "visual" del nodo (distingue nota_credito de venta,
  // devolucion_prov de devolucion, para el ícono/label correcto) pero
  // `onNavigate` espera el tipo de RUTA — mismo mapeo que ya hacían los
  // `navigate(...)` originales antes de este cambio.
  const navTipoFor = (tipo) => {
    if (tipo === 'venta' || tipo === 'nota_credito') return 'comprobante';
    if (tipo === 'devolucion_prov') return 'devolucion';
    return tipo; // pedido, entrega, recepcion, devolucion
  };

  // ── Preview inline ───────────────────────────────────────────────────────────
  // El header del preview no pide nada nuevo — ya viaja en el `nodo` que arma
  // cada tarjeta del mapa. Solo los ítems se buscan aparte, por tipo de
  // documento (cada uno vive en su propia tabla de detalle).
  const openPreview = (nodo) => {
    setPreviewNodo(nodo);
    fetchPreviewItems(nodo.tipo, nodo.id);
  };

  const fetchPreviewItems = async (tipo, id) => {
    setPreviewLoading(true);
    setPreviewItems(null);
    try {
      let rows = [];
      if (tipo === 'comprobante') {
        const { data } = await supabase.from('comprobante_items')
          .select('cantidad, precio_unitario, subtotal, productos(nombre)')
          .eq('comprobante_id', id).eq('empresa_id', user.empresa_id);
        rows = (data ?? []).map(i => ({ nombre: i.productos?.nombre || '—', cantidad: i.cantidad, subtotal: i.subtotal }));
      } else if (tipo === 'cotizacion') {
        const { data } = await supabase.from('cotizacion_items')
          .select('descripcion, cantidad, subtotal')
          .eq('cotizacion_id', id).eq('empresa_id', user.empresa_id);
        rows = (data ?? []).map(i => ({ nombre: i.descripcion, cantidad: i.cantidad, subtotal: i.subtotal }));
      } else if (tipo === 'pedido') {
        const { data } = await supabase.from('pedido_items')
          .select('descripcion, cantidad, subtotal')
          .eq('pedido_id', id).eq('empresa_id', user.empresa_id);
        rows = (data ?? []).map(i => ({ nombre: i.descripcion, cantidad: i.cantidad, subtotal: i.subtotal }));
      } else if (tipo === 'entrega') {
        const { data } = await supabase.from('entrega_items')
          .select('cantidad, productos(nombre)')
          .eq('entrega_id', id).eq('empresa_id', user.empresa_id);
        rows = (data ?? []).map(i => ({ nombre: i.productos?.nombre || '—', cantidad: i.cantidad, subtotal: null }));
      } else if (tipo === 'recepcion') {
        const { data } = await supabase.from('recepcion_items')
          .select('cantidad, productos(nombre)')
          .eq('recepcion_id', id).eq('empresa_id', user.empresa_id);
        rows = (data ?? []).map(i => ({ nombre: i.productos?.nombre || '—', cantidad: i.cantidad, subtotal: null }));
      } else if (tipo === 'devolucion' || tipo === 'devolucion_prov') {
        const { data } = await supabase.from('devolucion_items')
          .select('cantidad, subtotal, productos(nombre)')
          .eq('devolucion_id', id).eq('empresa_id', user.empresa_id);
        rows = (data ?? []).map(i => ({ nombre: i.productos?.nombre || '—', cantidad: i.cantidad, subtotal: i.subtotal }));
      }
      setPreviewItems(rows);
    } catch (err) {
      console.error('[MapaRelaciones/preview]', err);
      setPreviewItems([]);
    } finally {
      setPreviewLoading(false);
    }
  };

  // ── Nodos para ventas ────────────────────────────────────────────────────────
  const compNodo = mapa?.modo === 'venta' ? {
    id:     mapa.comp.id,
    tipo:   mapa.comp.tipo === 'nota_credito' ? 'nota_credito' : 'venta',
    numero: mapa.comp.numero_afip ?? mapa.comp.numero_venta,
    fecha:  mapa.comp.fecha,
    total:  mapa.comp.total,
  } : null;

  // ── Nodo para compras ────────────────────────────────────────────────────────
  const compraNodo = mapa?.modo === 'compra' ? {
    id:     mapa.compra.id,
    tipo:   'factura_compra',
    numero: mapa.compra.numero_factura || 'S/N',
    fecha:  mapa.compra.fecha,
    total:  mapa.compra.total,
  } : null;

  // ── Sin relaciones ───────────────────────────────────────────────────────────
  const sinRelacionesVenta = mapa?.modo === 'venta' && !mapa.origen && !mapa.cotizacion && !mapa.pedido
    && mapa.entregas.length === 0 && mapa.ncs.length === 0
    && mapa.nds.length === 0 && mapa.devoluciones.length === 0
    && mapa.cobros.length === 0;

  const sinRelacionesCompra = mapa?.modo === 'compra'
    && mapa.recepciones.length === 0 && mapa.devoluciones.length === 0
    && mapa.nds.length === 0 && mapa.pagos.length === 0
    && mapa.ncsFinancieras.length === 0;

  const tieneDerivadosVenta = mapa?.modo === 'venta' && (
    mapa.ncs.length > 0 || mapa.nds.length > 0 ||
    mapa.cobros.length > 0 || mapa.devoluciones.length > 0
  );

  const tieneDerivadosCompra = mapa?.modo === 'compra' && (
    mapa.devoluciones.length > 0 || mapa.nds.length > 0 ||
    mapa.pagos.length > 0 || mapa.ncsFinancieras.length > 0
  );

  // ── Resumen del circuito ─────────────────────────────────────────────────────
  const pasosVenta = mapa?.modo === 'venta'
    ? 1 + (mapa.origen ? 1 : 0) + (mapa.cotizacion ? 1 : 0) + (mapa.pedido ? 1 : 0) + mapa.entregas.length
    : 0;
  const derivadosVenta = mapa?.modo === 'venta'
    ? mapa.ncs.length + mapa.nds.length + mapa.cobros.length + mapa.devoluciones.length
    : 0;

  const pasosCompra = mapa?.modo === 'compra'
    ? 1 + mapa.recepciones.length + mapa.pagos.length
    : 0;
  const derivadosCompra = mapa?.modo === 'compra'
    ? mapa.devoluciones.length + mapa.nds.length + mapa.ncsFinancieras.length
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={[
          'bg-kx-surface border-kx-border text-kx-text transition-all duration-200',
          fullscreen ? 'max-w-[96vw] w-[96vw] h-[92vh] flex flex-col' : 'max-w-5xl',
        ].join(' ')}
      >
        <DialogHeader className={fullscreen ? 'flex-shrink-0' : ''}>
          <div className="flex items-center justify-between pr-8">
            <DialogTitle className="flex items-center gap-2">
              <Network className="w-5 h-5 text-kx-violet" />
              Mapa de Relaciones
              {isCompra && (
                <span className="text-2xs font-normal text-kx-text-3 bg-kx-surface-2 px-2 py-0.5 rounded-full">
                  Compras
                </span>
              )}
            </DialogTitle>
            {mapa && (
              <Button
                variant="ghost" size="icon"
                className="h-7 w-7 text-kx-text-3 hover:text-kx-text"
                onClick={() => setFullscreen(f => !f)}
                title={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
              >
                {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
            )}
          </div>
          <DialogDescription className="text-kx-text-2 text-xs">
            Árbol de documentos vinculados
          </DialogDescription>
        </DialogHeader>

        <div className={`flex gap-0 ${fullscreen ? 'flex-1 overflow-hidden' : 'min-h-[180px]'}`}>
        <div className={`flex-1 min-w-0 overflow-x-auto py-2 ${fullscreen ? 'overflow-y-auto' : ''}`}>
          {loading && (
            <div className="flex items-center justify-center h-36">
              <Loader2 className="w-6 h-6 animate-spin text-kx-text-3" />
            </div>
          )}

          {!loading && !mapa && !sinFacturar && (
            <div className="text-center text-kx-text-3 text-sm py-12">
              No se pudo cargar el mapa de relaciones.
            </div>
          )}

          {/* ── Entry point sin facturar todavía (Fase 3): cotización/pedido/entrega/
              recepción/devolución que aún no tiene un comprobante o compra asociado
              — no hay cadena para armar, pero tampoco es un error. ── */}
          {!loading && sinFacturar && (
            <div className="flex flex-col items-center gap-3 py-8">
              <NodoMapa nodo={sinFacturar.nodo} activo />
              <p className="text-xs text-kx-text-3 text-center max-w-xs">
                {sinFacturar.label} todavía sin facturar — cuando se convierta en factura vas a
                poder ver la cadena completa acá.
              </p>
            </div>
          )}

          {/* ── VENTAS: sin relaciones ─────────────────────────────────────── */}
          {!loading && mapa?.modo === 'venta' && sinRelacionesVenta && (
            <div className="flex flex-col items-center gap-3 py-8">
              <NodoMapa nodo={compNodo} activo={isActivo(compNodo.id)} />
              <p className="text-xs text-kx-text-3">
                Sin documentos relacionados — comprobante independiente
              </p>
            </div>
          )}

          {/* ── VENTAS: con relaciones ─────────────────────────────────────── */}
          {!loading && mapa?.modo === 'venta' && !sinRelacionesVenta && (
            <div className="space-y-5">
              <ResumenCircuito pasos={pasosVenta} total={mapa.comp.total} derivados={derivadosVenta} />

              <div>
                <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider mb-3">
                  Cadena de documentos
                </p>
                <div className="flex items-start gap-0 overflow-x-auto pb-1">
                  {mapa.origen && (() => {
                    const n = {
                      id:     mapa.origen.id,
                      tipo:   mapa.origen.tipo === 'nota_credito' ? 'nota_credito' : 'venta',
                      numero: mapa.origen.numero_afip ?? mapa.origen.numero_venta,
                      fecha:  mapa.origen.fecha,
                      total:  mapa.origen.total,
                    };
                    return (
                      <React.Fragment key="origen">
                        <NodoMapa nodo={n} activo={isActivo(n.id)} onClick={() => openPreview(n)} />
                        <Conector />
                      </React.Fragment>
                    );
                  })()}
                  {mapa.cotizacion && (() => {
                    const n = {
                      id:     mapa.cotizacion.id,
                      tipo:   'cotizacion',
                      numero: mapa.cotizacion.numero,
                      fecha:  mapa.cotizacion.fecha,
                      total:  mapa.cotizacion.total,
                      estado: mapa.cotizacion.estado,
                    };
                    return (
                      <React.Fragment key="cotizacion">
                        <NodoMapa nodo={n} activo={isActivo(n.id)} onClick={() => openPreview(n)} />
                        <Conector />
                      </React.Fragment>
                    );
                  })()}
                  {mapa.pedido && (() => {
                    const n = {
                      id:     mapa.pedido.id,
                      tipo:   'pedido',
                      numero: mapa.pedido.numero,
                      fecha:  mapa.pedido.fecha,
                      total:  mapa.pedido.total,
                      estado: mapa.pedido.estado,
                    };
                    return (
                      <React.Fragment key="pedido">
                        <NodoMapa nodo={n} activo={isActivo(n.id)} onClick={() => openPreview(n)} />
                        <Conector />
                      </React.Fragment>
                    );
                  })()}
                  {mapa.entregas.map((e) => {
                    const n = { id: e.id, tipo: 'entrega', numero: e.numero_entrega, fecha: e.fecha, estado: e.estado };
                    return (
                      <React.Fragment key={e.id}>
                        <NodoMapa nodo={n} activo={isActivo(n.id)} onClick={() => openPreview(n)} />
                        <Conector />
                      </React.Fragment>
                    );
                  })}
                  <NodoMapa nodo={compNodo} activo={isActivo(compNodo.id)} onClick={() => openPreview(compNodo)} />
                </div>
              </div>

              {tieneDerivadosVenta && (
                <div className="rounded-xl bg-kx-surface-2/40 border border-kx-border p-4">
                  <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider mb-3">
                    Documentos derivados
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {mapa.ncs.map(nc => {
                      const n = { id: nc.id, tipo: 'nota_credito', numero: nc.numero_afip ?? nc.numero_venta, fecha: nc.fecha, total: nc.total, estado: nc.estado_pago };
                      return <NodoMapa key={nc.id} nodo={n} activo={isActivo(n.id)} onClick={() => openPreview(n)} />;
                    })}
                    {mapa.nds.map(nd => (
                      <NodoMapa
                        key={nd.id}
                        nodo={{ id: nd.id, tipo: 'nota_debito', numero: nd.numero_nd, fecha: nd.fecha, monto: nd.monto, estado: nd.concepto }}
                        activo={isActivo(nd.id)}
                      />
                    ))}
                    {mapa.cobros.map(c => (
                      <NodoMapa
                        key={c.id}
                        nodo={{ id: c.id, tipo: 'cobro_cc', numero: c.descripcion || 'Cobro CC', fecha: c.fecha, monto: c.monto }}
                        activo={isActivo(c.id)}
                      />
                    ))}
                    {mapa.devoluciones.map(d => {
                      const n = { id: d.id, tipo: 'devolucion', numero: d.numero_devolucion, fecha: d.fecha, estado: d.compensacion };
                      return <NodoMapa key={d.id} nodo={n} activo={isActivo(n.id)} onClick={() => openPreview(n)} />;
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-2 border-t border-kx-border">
                {['cotizacion', 'venta', 'pedido', 'entrega', 'nota_credito', 'nota_debito', 'cobro_cc', 'devolucion'].map(tipo => (
                  <div key={tipo} className="flex items-center gap-1.5 text-2xs text-kx-text-3">
                    <div className={`w-2 h-2 rounded-full ${TIPO_CONFIG[tipo].accent.replace('text-', 'bg-')}`} />
                    {TIPO_CONFIG[tipo].label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── COMPRAS: sin relaciones ────────────────────────────────────── */}
          {!loading && mapa?.modo === 'compra' && sinRelacionesCompra && (
            <div className="flex flex-col items-center gap-3 py-8">
              <NodoMapa nodo={compraNodo} activo={isActivo(compraNodo.id)} />
              <p className="text-xs text-kx-text-3">
                Sin documentos relacionados — factura independiente
              </p>
            </div>
          )}

          {/* ── COMPRAS: con relaciones ────────────────────────────────────── */}
          {!loading && mapa?.modo === 'compra' && !sinRelacionesCompra && (
            <div className="space-y-5">
              <ResumenCircuito pasos={pasosCompra} total={mapa.compra.total} derivados={derivadosCompra} />

              <div>
                <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider mb-3">
                  Cadena de documentos
                </p>
                <div className="flex items-start gap-0 overflow-x-auto pb-1">
                  {/* Recepciones previas */}
                  {mapa.recepciones.map((r) => {
                    const n = { id: r.id, tipo: 'recepcion', numero: r.numero_recepcion, fecha: r.fecha, estado: r.estado };
                    return (
                      <React.Fragment key={r.id}>
                        <NodoMapa nodo={n} activo={isActivo(n.id)} onClick={() => openPreview(n)} />
                        <Conector />
                      </React.Fragment>
                    );
                  })}
                  {/* Factura actual */}
                  <NodoMapa nodo={compraNodo} activo={isActivo(compraNodo.id)} onClick={() => openPreview(compraNodo)} />
                  {/* Pagos CC */}
                  {mapa.pagos.map(p => (
                    <React.Fragment key={p.id}>
                      <Conector />
                      <NodoMapa
                        nodo={{ id: p.id, tipo: 'pago_proveedor', numero: p.descripcion || 'Pago CC', fecha: p.fecha, monto: p.monto }}
                        activo={isActivo(p.id)}
                      />
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {tieneDerivadosCompra && (
                <div className="rounded-xl bg-kx-surface-2/40 border border-kx-border p-4">
                  <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider mb-3">
                    Documentos derivados
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {/* Devoluciones físicas */}
                    {mapa.devoluciones.map(d => {
                      const n = { id: d.id, tipo: 'devolucion_prov', numero: d.numero_devolucion, fecha: d.fecha, estado: d.compensacion };
                      return <NodoMapa key={d.id} nodo={n} activo={isActivo(n.id)} onClick={() => openPreview(n)} />;
                    })}
                    {/* NC financieras recibidas (mig.277 — notas_credito_proveedor) */}
                    {mapa.ncsFinancieras.map(nc => (
                      <NodoMapa
                        key={nc.id}
                        nodo={{ id: nc.id, tipo: 'nc_proveedor', numero: nc.numero_ncp, fecha: nc.fecha, monto: nc.monto, estado: nc.motivo }}
                        activo={isActivo(nc.id)}
                      />
                    ))}
                    {/* ND recibidas */}
                    {mapa.nds.map(nd => (
                      <NodoMapa
                        key={nd.id}
                        nodo={{ id: nd.id, tipo: 'nd_proveedor', numero: nd.numero_nd, fecha: nd.fecha, monto: nd.monto, estado: nd.concepto }}
                        activo={isActivo(nd.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-2 border-t border-kx-border">
                {['factura_compra', 'recepcion', 'pago_proveedor', 'nc_proveedor', 'nd_proveedor', 'devolucion_prov'].map(tipo => (
                  <div key={tipo} className="flex items-center gap-1.5 text-2xs text-kx-text-3">
                    <div className={`w-2 h-2 rounded-full ${TIPO_CONFIG[tipo].accent.replace('text-', 'bg-')}`} />
                    {TIPO_CONFIG[tipo].label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {previewNodo && (
          <PreviewPanel
            nodo={previewNodo}
            items={previewItems}
            loading={previewLoading}
            onClose={() => { setPreviewNodo(null); setPreviewItems(null); }}
            onVerCompleto={() => navigate(navTipoFor(previewNodo.tipo), previewNodo.id)}
          />
        )}
        </div>

        <div className={`flex justify-end pt-3 border-t border-kx-border ${fullscreen ? 'flex-shrink-0' : ''}`}>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}
            className="border-kx-border text-kx-text-2 text-xs">
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MapaRelaciones;
