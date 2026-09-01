import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Loader2, ChevronRight, ChevronDown, Network, ExternalLink,
  FileText, ClipboardList, Truck, Receipt, RotateCcw, PlusCircle, Undo2,
  Wallet, ShoppingCart, PackageCheck, Layers, X, Ban, Banknote,
} from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatDateAR } from '@/lib/dateUtils';

const fmt = (n) =>
  Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// mig.327 — Duplicar documentos: qué tabla/columna de número consultar por tipo
// visual para resolver duplicado_de_id (self-FK, opcional). Solo cubre los tipos
// que de verdad ganaron la columna — NC/ND recibidas (notas_debito,
// notas_credito_proveedor) también la tienen, pero hoy no son un entry point
// propio de este mapa (solo aparecen como nodos derivados de una compra), así
// que sus duplicados no se resuelven acá — limitación aceptada, no un bug.
const DUPLICADO_TABLAS = {
  cotizacion:     { tabla: 'cotizaciones',   numeroCol: 'numero' },
  pedido:         { tabla: 'pedidos',        numeroCol: 'numero' },
  orden_compra:   { tabla: 'ordenes_compra', numeroCol: 'numero' },
  venta:          { tabla: 'comprobantes',   numeroCol: 'numero_venta' },
  factura_compra: { tabla: 'compras',        numeroCol: 'numero_factura' },
};

// mig.315 — Fase 1 del rediseño (PLAN_MAPA_RELACIONES.md): un ícono por tipo de
// documento, mismo espíritu que los íconos circulares por etapa del Relationship
// Map de SAP B1 — de un vistazo se distingue el tipo de paso, no solo el color.
// `dot` es a propósito una clase Tailwind LITERAL completa (no derivada con
// `.replace('text-', 'bg-')` como hacía la leyenda antes) — Tailwind arma su
// CSS escaneando el texto fuente en busca de nombres de clase completos; una
// clase construida en tiempo de ejecución que nunca aparece armada como texto
// en ningún archivo simplemente no se genera. Bug real (Luciano, 29/08): la
// leyenda de "Pedido"/"Orden de Compra"/"Factura Compra" salía sin color
// porque `bg-kx-blue` (sin el sufijo /10 de opacidad) no existía como
// substring literal en ningún archivo — solo `bg-kx-blue/10`, que Tailwind
// trata como una clase distinta. Cada color findal usado como fondo sólido
// tiene que aparecer acá tal cual para que el build lo genere.
const TIPO_CONFIG = {
  // ── Ventas ─────────────────────────────────────────────────────────────────
  cotizacion:      { label: 'Cotización',      color: 'border-t-kx-text-3', accent: 'text-kx-text-3', bg: 'bg-kx-text-3/10', dot: 'bg-kx-text-3', icon: FileText },
  pedido:          { label: 'Pedido',          color: 'border-t-kx-blue',   accent: 'text-kx-blue',   bg: 'bg-kx-blue/10',   dot: 'bg-kx-blue',   icon: ClipboardList },
  entrega:         { label: 'Entrega',         color: 'border-t-kx-violet', accent: 'text-kx-violet', bg: 'bg-kx-violet/10', dot: 'bg-kx-violet', icon: Truck },
  venta:           { label: 'Factura',         color: 'border-t-kx-green',  accent: 'text-kx-green',  bg: 'bg-kx-green/10',  dot: 'bg-kx-green',  icon: Receipt },
  nota_credito:    { label: 'Nota de Crédito', color: 'border-t-kx-amber',  accent: 'text-kx-amber',  bg: 'bg-kx-amber/10',  dot: 'bg-kx-amber',  icon: RotateCcw },
  nota_debito:     { label: 'Nota de Débito',  color: 'border-t-kx-red',    accent: 'text-kx-red',    bg: 'bg-kx-red/10',    dot: 'bg-kx-red',    icon: PlusCircle },
  devolucion:      { label: 'Devolución',      color: 'border-t-kx-amber',  accent: 'text-kx-amber',  bg: 'bg-kx-amber/10',  dot: 'bg-kx-amber',  icon: Undo2 },
  cobro_cc:        { label: 'Cobro CC',        color: 'border-t-kx-green',  accent: 'text-kx-green',  bg: 'bg-kx-green/10',  dot: 'bg-kx-green',  icon: Wallet },
  // Reversa de CC generada por cancelar_factura/NC/ND (mig.259/267/321) — un
  // HABER en cuenta_corriente_movimientos igual que un cobro real, pero NO es
  // plata que entró: es el efecto contrario a una cancelación. Antes se
  // mostraba con el mismo chip "Cobro CC" que un cobro de verdad — confuso
  // (Luciano, 23/08: "¿qué es esto?"), se distingue por prefijo de descripción.
  reversa_cc:      { label: 'Reversa CC',       color: 'border-t-kx-text-3', accent: 'text-kx-text-3', bg: 'bg-kx-text-3/10', dot: 'bg-kx-text-3', icon: Ban },
  // Pago al contado (27/08) — distinto de "Cobro CC": no cancela una deuda
  // previa, es el cobro que ya viajó adentro de la propia venta (Efectivo/
  // Transferencia/Tarjeta al momento de facturar). Fuente: movimientos_caja,
  // no cuenta_corriente_movimientos — una venta contado nunca generó deuda,
  // así que ahí no hay nada que mostrar.
  cobro_caja:      { label: 'Pago al Contado',  color: 'border-t-kx-green',  accent: 'text-kx-green',  bg: 'bg-kx-green/10',  dot: 'bg-kx-green',  icon: Banknote },
  // ── Compras ────────────────────────────────────────────────────────────────
  orden_compra:    { label: 'Orden de Compra', color: 'border-t-kx-blue',   accent: 'text-kx-blue',   bg: 'bg-kx-blue/10',   dot: 'bg-kx-blue',   icon: ShoppingCart },
  recepcion:       { label: 'Recepción',       color: 'border-t-kx-violet', accent: 'text-kx-violet', bg: 'bg-kx-violet/10', dot: 'bg-kx-violet', icon: PackageCheck },
  factura_compra:  { label: 'Factura Compra',  color: 'border-t-kx-blue',   accent: 'text-kx-blue',   bg: 'bg-kx-blue/10',   dot: 'bg-kx-blue',   icon: Receipt },
  pago_proveedor:  { label: 'Pago CC',         color: 'border-t-kx-green',  accent: 'text-kx-green',  bg: 'bg-kx-green/10',  dot: 'bg-kx-green',  icon: Wallet },
  nc_proveedor:    { label: 'NC Proveedor',    color: 'border-t-kx-amber',  accent: 'text-kx-amber',  bg: 'bg-kx-amber/10',  dot: 'bg-kx-amber',  icon: RotateCcw },
  nd_proveedor:    { label: 'ND Recibida',     color: 'border-t-kx-red',    accent: 'text-kx-red',    bg: 'bg-kx-red/10',    dot: 'bg-kx-red',    icon: PlusCircle },
  devolucion_prov: { label: 'Dev. Proveedor',  color: 'border-t-kx-amber',  accent: 'text-kx-amber',  bg: 'bg-kx-amber/10',  dot: 'bg-kx-amber',  icon: Undo2 },
};

// Movimientos financieros puros (cobros/pagos/reversas) — no tienen ítems ni
// "documento completo" al que navegar (no viven como página propia, son una
// fila dentro de Cuenta Corriente). El preview para estos tipos muestra la
// descripción en vez de una grilla de ítems, y no ofrece "Ver documento
// completo" (antes SÍ lo ofrecía y el click no llevaba a ningún lado).
const TIPOS_SIN_ITEMS = new Set(['cobro_cc', 'reversa_cc', 'cobro_caja']);

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
  // Antes excluía al nodo "actual" (`&& !activo`) — pensado para no ofrecer un preview
  // redundante del documento que ya se está viendo en otro lado (ej. la Factura activa,
  // visible en SaleDetailModal). Pero el nodo "sin facturar" (Fase 3) también se marca
  // `activo` y ES la única vista de sus ítems dentro de este modal — sin este cambio,
  // nunca se podía abrir su preview (bug real, hallado 11/08). Un nodo con onClick
  // siempre es clickable ahora; el caller decide si tiene sentido pasarlo o no.
  const clickable = !!onClick;
  const eColor    = estadoColor(nodo.estado);

  return (
    <div
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      className={[
        // Bug real (14/08, reportado por Luciano): el ancho ya era fijo, pero
        // la altura no — cada tarjeta muestra un subconjunto distinto de campos
        // opcionales (fecha/total/estado/"ver detalle"), así que una Recepción
        // sin total quedaba visiblemente más baja que una Cotización con total.
        // h-[176px] fija el tamaño de la tarjeta entera; flex-col + mt-auto en
        // "ver detalle" ancla ese link siempre al mismo lugar abajo, sea cual
        // sea el contenido de arriba.
        'bg-kx-surface border border-kx-border rounded-xl p-3',
        'w-[150px] h-[176px] flex-shrink-0 flex flex-col select-none',
        'border-t-2',
        // Animación de entrada (30/08, pedido de Luciano: "le demos algo de
        // animación al mapa de relaciones") — cada tarjeta aparece con un
        // fade + leve subida en vez de aparecer de golpe.
        'animate-in fade-in slide-in-from-bottom-1 duration-300',
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
        <div className="mt-auto pt-1.5 text-[9px] text-kx-text-3 flex items-center gap-0.5">
          <ExternalLink className="w-2.5 h-2.5" /> ver detalle
        </div>
      )}
    </div>
  );
}

// Nido de tarjetas (30/08, pedido de Luciano: "en SAP los mismos comprobantes
// se anidan... que sean interactivos, al hacer clic que se desplieguen").
// Colapsa una corrida de N nodos del MISMO tipo (hoy solo "Pago al Contado" —
// una venta con Efectivo+Tarjeta+Transferencia+Débito ya no ocupa 4 tarjetas
// sueltas en la cadena) en UNA tarjeta con efecto "mazo apilado". Al hacer
// clic se despliega inline, en el mismo lugar de la cadena — no es un panel
// aparte, para no perder el contexto del resto del circuito.
function NidoMapa({ grupo, isActivo, onNodoClick }) {
  const [abierto, setAbierto] = useState(false);
  const config = TIPO_CONFIG[grupo[0].tipo] ?? TIPO_CONFIG.venta;
  const Icono  = config.icon;
  const total  = grupo.reduce((s, n) => s + Number(n.total ?? n.monto ?? 0), 0);

  if (abierto) {
    return (
      <div className="flex items-start gap-0 animate-in fade-in slide-in-from-left-2 duration-200">
        {grupo.map((n, i) => (
          <React.Fragment key={n.id}>
            <NodoMapa nodo={n} activo={isActivo(n.id)} onClick={() => onNodoClick(n)} />
            {i < grupo.length - 1 && <Conector />}
          </React.Fragment>
        ))}
        <button
          type="button"
          onClick={() => setAbierto(false)}
          title="Volver a agrupar"
          className="self-center ml-1.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-kx-text-3 hover:text-kx-text hover:bg-kx-surface-2 transition-colors mt-[70px]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      role="button"
      onClick={() => setAbierto(true)}
      className="relative w-[150px] h-[176px] flex-shrink-0 cursor-pointer group animate-in fade-in zoom-in-95 duration-300 select-none"
      title={`Ver los ${grupo.length} pagos`}
    >
      {/* Capas apiladas detrás — efecto "mazo de cartas", da la pista visual
          de que hay más de una tarjeta ahí adentro antes de leer el número. */}
      <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-xl border border-kx-border bg-kx-surface opacity-40" />
      <div className="absolute inset-0 translate-x-1 translate-y-1 rounded-xl border border-kx-border bg-kx-surface opacity-70" />
      <div className={`relative bg-kx-surface border border-kx-border rounded-xl p-3 w-full h-full flex flex-col border-t-2 ${config.color} group-hover:shadow-lg group-hover:-translate-y-0.5 transition-all duration-150`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`w-7 h-7 rounded-full flex items-center justify-center ${config.bg}`}>
            <Icono className={`w-3.5 h-3.5 ${config.accent}`} />
          </span>
          <span className="text-[9px] font-bold bg-kx-surface-2 text-kx-text-2 px-1.5 py-0.5 rounded-full">
            ×{grupo.length}
          </span>
        </div>
        <div className={`text-2xs font-bold uppercase tracking-wider mb-0.5 ${config.accent}`}>
          {config.label}
        </div>
        <div className="text-xs font-bold text-kx-text">{grupo.length} pagos</div>
        <div className="text-xs font-semibold text-kx-text mt-1 tabular-nums">${fmt(total)}</div>
        <div className="mt-auto pt-1.5 text-[9px] text-kx-text-3 flex items-center gap-0.5">
          <ChevronDown className="w-2.5 h-2.5" /> desplegar
        </div>
      </div>
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
function PreviewPanel({ nodo, items, loading, onClose, onVerCompleto, verCompletoLabel = 'Ver documento completo' }) {
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

      {TIPOS_SIN_ITEMS.has(nodo.tipo) ? (
        nodo.descripcion && (
          <div className="border-t border-kx-border pt-3">
            <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider mb-2">Detalle</p>
            <p className="text-xs text-kx-text-2">{nodo.descripcion}</p>
          </div>
        )
      ) : (
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
      )}

      {onVerCompleto && (
        <Button
          variant="outline" size="sm"
          className="w-full mt-4 text-xs border-kx-border text-kx-text-2"
          onClick={onVerCompleto}
        >
          {verCompletoLabel} <ExternalLink className="w-3 h-3 ml-1.5" />
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
  ordenCompraId,
}) {
  const { user }  = useAuth();
  const [loading, setLoading] = useState(false);
  const [mapa, setMapa]       = useState(null);
  const [previewNodo, setPreviewNodo]   = useState(null); // { tipo, id, numero, fecha, total|monto, estado }
  const [previewItems, setPreviewItems] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [activoId, setActivoId] = useState(null);        // id del nodo que se abrió — el que se marca "actual"
  const [sinFacturar, setSinFacturar] = useState(null);  // { label, nodo } cuando el entry point no tiene comprobante/compra todavía
  const [duplicadoInfo, setDuplicadoInfo] = useState(null); // { origen: {tipo,id,numero}|null, duplicados: [{tipo,id,numero}] }
  // Fase 4 (PLAN_MAPA_RELACIONES.md): "Documentos derivados" no tiene tope hoy —
  // un cliente con 10 NC sobre la misma factura se ve entera, ocupando varias
  // filas de una. Se muestran las primeras LIMITE_DERIVADOS_VISIBLES y el resto
  // queda atrás de un "Ver N más". Se resetea cada vez que se resuelve un mapa
  // nuevo (abrir otro documento no debería heredar el expandido del anterior).
  const [derivadosExpandido, setDerivadosExpandido] = useState(false);
  const isCompra = mapa?.modo === 'compra' || (!!compraId && !comprobanteId);

  useEffect(() => {
    if (!open || !user?.empresa_id) return;
    resolveAndFetch();
  }, [open, comprobanteId, compraId, cotizacionId, pedidoId, entregaId, recepcionId, devolucionId, ordenCompraId, user?.empresa_id]);

  useEffect(() => {
    if (!open) {
      setMapa(null); setPreviewNodo(null); setPreviewItems(null);
      setActivoId(null); setSinFacturar(null); setDuplicadoInfo(null); setDerivadosExpandido(false);
    }
  }, [open]);

  // mig.327 — Duplicar documentos: resuelve "duplicado de X" / "N duplicados de
  // este" para el documento concreto (no bloquea el resto del mapa — fire and
  // forget, mismo criterio que el resto de fetches secundarios de este archivo).
  const fetchDuplicadoInfo = async (tipoVisual, id) => {
    const cfg = DUPLICADO_TABLAS[tipoVisual];
    if (!cfg || !id) { setDuplicadoInfo(null); return; }
    try {
      const { data: self } = await supabase.from(cfg.tabla)
        .select(`id, duplicado_de_id, ${cfg.numeroCol}`)
        .eq('id', id).eq('empresa_id', user.empresa_id).maybeSingle();
      if (!self) { setDuplicadoInfo(null); return; }

      let origen = null;
      if (self.duplicado_de_id) {
        const { data: o } = await supabase.from(cfg.tabla)
          .select(`id, ${cfg.numeroCol}`)
          .eq('id', self.duplicado_de_id).eq('empresa_id', user.empresa_id).maybeSingle();
        if (o) origen = { tipo: tipoVisual, id: o.id, numero: o[cfg.numeroCol] };
      }

      const { data: dups } = await supabase.from(cfg.tabla)
        .select(`id, ${cfg.numeroCol}`)
        .eq('duplicado_de_id', id).eq('empresa_id', user.empresa_id);

      setDuplicadoInfo({
        origen,
        duplicados: (dups ?? []).map(d => ({ tipo: tipoVisual, id: d.id, numero: d[cfg.numeroCol] })),
      });
    } catch (err) {
      console.error('[MapaRelaciones/duplicado]', err);
      setDuplicadoInfo(null);
    }
  };

  // ── Cadena pre-facturación (Ventas) ─────────────────────────────────────────
  // Bug real (14/08, Luciano): todo el mapa se armaba anclado en la factura, así
  // que una Cotización → Pedido → Entrega que todavía no se facturó mostraba un
  // único nodo suelto, justo el tramo del circuito que más se mira mientras el
  // negocio está en curso. Acá se arma esa cadena caminando los FK que ya existen
  // (pedidos.cotizacion_id, entregas.pedido_id) sin depender de comprobante_id.
  const fetchCadenaPreFactura = async ({ cotizacion = null, pedido = null, entrega = null }) => {
    const emp = user.empresa_id;
    let cot = cotizacion;
    let ped = pedido;
    let entregas = entrega ? [entrega] : [];

    // Entrega → Pedido
    if (!ped && entrega?.pedido_id) {
      const { data } = await supabase.from('pedidos')
        .select('id, numero, fecha, total, estado, cotizacion_id')
        .eq('id', entrega.pedido_id).eq('empresa_id', emp).maybeSingle();
      ped = data;
    }
    // Pedido → Cotización
    if (!cot && ped?.cotizacion_id) {
      const { data } = await supabase.from('cotizaciones')
        .select('id, numero, fecha, total, estado')
        .eq('id', ped.cotizacion_id).eq('empresa_id', emp).maybeSingle();
      cot = data;
    }
    // Cotización → Pedido(s). Una cotización puede haberse copiado a varios
    // pedidos (SAP permite entregar en tandas), así que se listan todos.
    let pedidosExtra = [];
    if (cot) {
      const { data } = await supabase.from('pedidos')
        .select('id, numero, fecha, total, estado')
        .eq('cotizacion_id', cot.id).eq('empresa_id', emp)
        .order('created_at', { ascending: true });
      pedidosExtra = (data ?? []).filter(p => p.id !== ped?.id);
      if (!ped && pedidosExtra.length > 0) { ped = pedidosExtra.shift(); }
    }
    // Pedido → Entregas
    if (ped && entregas.length === 0) {
      const { data } = await supabase.from('entregas')
        .select('id, numero_entrega, fecha, estado, origen')
        .eq('pedido_id', ped.id).eq('empresa_id', emp)
        .order('created_at', { ascending: true });
      entregas = data ?? [];
    }

    const nodos = [
      ...(cot ? [{ id: cot.id, tipo: 'cotizacion', numero: cot.numero, fecha: cot.fecha, total: cot.total, estado: cot.estado }] : []),
      ...(ped ? [{ id: ped.id, tipo: 'pedido', numero: ped.numero, fecha: ped.fecha, total: ped.total, estado: ped.estado }] : []),
      ...pedidosExtra.map(p => ({ id: p.id, tipo: 'pedido', numero: p.numero, fecha: p.fecha, total: p.total, estado: p.estado })),
      ...entregas.map(e => ({ id: e.id, tipo: 'entrega', numero: e.numero_entrega, fecha: e.fecha, estado: e.estado })),
    ];
    return nodos;
  };

  // ── Cotización → pedidos → estado real de cada uno ──────────────────────────
  // Bug real (27/08, Luciano): `cotizaciones.comprobante_id` solo lo escribe la
  // conversión DIRECTA "Cotización → Factura" (cotizacionesService.convertir).
  // Cuando el camino real es Cotización → "Copiar a" Pedido → Entrega → Factura
  // (el más común, Document Flow estilo SAP), ese campo nunca se toca — el mapa
  // se quedaba mirando solo el campo roto y caía siempre a "sin facturar",
  // cortando la cadena en Entrega aunque la factura existiera un salto más abajo
  // (confirmado contra datos reales: COT-00032.comprobante_id=null pero su
  // pedido PED-20260815-001.comprobante_id sí apunta a una factura viva).
  //
  // Una cotización puede tener MÁS de un pedido (SAP permite entregar/facturar
  // en tandas) y cada uno facturarse por separado — caso real encontrado en la
  // misma cotización de Luciano (2 pedidos, 2 facturas distintas). Se resuelve
  // acá "una rama por pedido": la cadena completa (pedido→entregas→factura, o
  // "sin facturar" si ese pedido puntual todavía no se facturó) para cada uno.
  const fetchRamasCotizacion = async (cotizacion) => {
    const emp = user.empresa_id;
    const { data: pedidos } = await supabase.from('pedidos')
      .select('id, numero, fecha, total, estado, comprobante_id')
      .eq('cotizacion_id', cotizacion.id).eq('empresa_id', emp)
      .order('created_at', { ascending: true });

    const ramas = await Promise.all((pedidos ?? []).map(async (ped) => {
      const [entregasRes, facturaRes] = await Promise.all([
        supabase.from('entregas')
          .select('id, numero_entrega, fecha, estado')
          .eq('pedido_id', ped.id).eq('empresa_id', emp)
          .order('created_at', { ascending: true }),
        ped.comprobante_id
          ? supabase.from('comprobantes')
              .select('id, numero_venta, numero_afip, tipo, total, fecha, estado_pago')
              .eq('id', ped.comprobante_id).eq('empresa_id', emp).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return { pedido: ped, entregas: entregasRes.data ?? [], factura: facturaRes.data ?? null };
    }));
    return ramas;
  };

  // ── Resolución del punto de entrada ──────────────────────────────────────────
  const resolveAndFetch = async () => {
    setSinFacturar(null);
    setDuplicadoInfo(null);
    setDerivadosExpandido(false);
    if (comprobanteId) { setActivoId(comprobanteId); return fetchMapaVenta(comprobanteId); }
    if (compraId)       { setActivoId(compraId);      return fetchMapaCompra(compraId); }

    setLoading(true);
    try {
      if (cotizacionId) {
        const { data } = await supabase.from('cotizaciones')
          .select('id, numero, fecha, total, estado, comprobante_id')
          .eq('id', cotizacionId).eq('empresa_id', user.empresa_id).maybeSingle();
        if (!data) return setMapa(null);
        fetchDuplicadoInfo('cotizacion', cotizacionId);
        if (data.comprobante_id) { setActivoId(cotizacionId); return fetchMapaVenta(data.comprobante_id); }

        setActivoId(cotizacionId);
        const ramas = await fetchRamasCotizacion(data);
        if (ramas.some(r => r.factura)) {
          return setMapa({ modo: 'cotizacion_ramas', cotizacion: data, ramas });
        }
        // Ningún pedido facturado todavía — mismo "sin facturar" de siempre,
        // pero con las entregas de TODOS los pedidos (antes sólo las del
        // primero, aunque hubiera más de uno).
        const nodos = [
          { id: data.id, tipo: 'cotizacion', numero: data.numero, fecha: data.fecha, total: data.total, estado: data.estado },
          ...ramas.flatMap(r => [
            { id: r.pedido.id, tipo: 'pedido', numero: r.pedido.numero, fecha: r.pedido.fecha, total: r.pedido.total, estado: r.pedido.estado },
            ...r.entregas.map(e => ({ id: e.id, tipo: 'entrega', numero: e.numero_entrega, fecha: e.fecha, estado: e.estado })),
          ]),
        ];
        return setSinFacturar({ label: 'Cotización', nodos });
      }
      if (pedidoId) {
        const { data } = await supabase.from('pedidos')
          .select('id, numero, fecha, total, estado, comprobante_id, cotizacion_id')
          .eq('id', pedidoId).eq('empresa_id', user.empresa_id).maybeSingle();
        if (!data) return setMapa(null);
        fetchDuplicadoInfo('pedido', pedidoId);
        if (data.comprobante_id) { setActivoId(pedidoId); return fetchMapaVenta(data.comprobante_id); }
        setActivoId(pedidoId);
        return setSinFacturar({ label: 'Pedido', nodos: await fetchCadenaPreFactura({ pedido: data }) });
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
        setActivoId(entregaId);
        return setSinFacturar({ label: 'Entrega', nodos: await fetchCadenaPreFactura({ entrega: data }) });
      }
      if (recepcionId) {
        const { data } = await supabase.from('recepciones')
          .select('id, numero_recepcion, fecha, estado, compra_id')
          .eq('id', recepcionId).eq('empresa_id', user.empresa_id).maybeSingle();
        if (!data) return setMapa(null);
        if (data.compra_id) { setActivoId(recepcionId); return fetchMapaCompra(data.compra_id); }
        setActivoId(recepcionId);
        return setSinFacturar({ label: 'Recepción', nodos: [{ id: data.id, tipo: 'recepcion', numero: data.numero_recepcion, fecha: data.fecha, estado: data.estado }] });
      }
      if (ordenCompraId) {
        const { data } = await supabase.from('ordenes_compra')
          .select('id, numero, fecha, total, estado')
          .eq('id', ordenCompraId).eq('empresa_id', user.empresa_id).maybeSingle();
        if (!data) return setMapa(null);
        fetchDuplicadoInfo('orden_compra', ordenCompraId);
        const { data: compra } = await supabase.from('compras')
          .select('id').eq('orden_compra_id', ordenCompraId).eq('empresa_id', user.empresa_id).maybeSingle();
        if (compra) { setActivoId(ordenCompraId); return fetchMapaCompra(compra.id); }
        // Sin factura todavía: la cadena es Orden de Compra → Recepciones (puede
        // haber más de una si se recibió en tandas), mismo espíritu que la
        // cadena Cotización → Pedido → Entrega del lado Ventas.
        const { data: recepciones } = await supabase.from('recepciones')
          .select('id, numero_recepcion, fecha, estado')
          .eq('orden_compra_id', ordenCompraId).eq('empresa_id', user.empresa_id)
          .order('created_at', { ascending: true });
        setActivoId(ordenCompraId);
        return setSinFacturar({
          label: 'Orden de Compra',
          nodos: [
            { id: data.id, tipo: 'orden_compra', numero: data.numero, fecha: data.fecha, total: data.total, estado: data.estado },
            ...(recepciones ?? []).map(r => ({ id: r.id, tipo: 'recepcion', numero: r.numero_recepcion, fecha: r.fecha, estado: r.estado })),
          ],
        });
      }
      if (devolucionId) {
        const { data } = await supabase.from('devoluciones')
          .select('id, numero_devolucion, fecha, tipo, compensacion, comprobante_id, compra_id')
          .eq('id', devolucionId).eq('empresa_id', user.empresa_id).maybeSingle();
        if (!data) return setMapa(null);
        if (data.tipo === 'cliente' && data.comprobante_id) { setActivoId(devolucionId); return fetchMapaVenta(data.comprobante_id); }
        if (data.tipo === 'proveedor' && data.compra_id)    { setActivoId(devolucionId); return fetchMapaCompra(data.compra_id); }
        setActivoId(devolucionId);
        return setSinFacturar({ label: 'Devolución', nodos: [{ id: data.id, tipo: data.tipo === 'cliente' ? 'devolucion' : 'devolucion_prov', numero: data.numero_devolucion, fecha: data.fecha, estado: data.compensacion }] });
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
    fetchDuplicadoInfo('venta', idComprobante);
    try {
      const { data: comp } = await supabase.from('comprobantes')
        .select('id, numero_venta, numero_afip, tipo, total, fecha, cliente_id, cliente_nombre, comprobante_origen_id, pedido_id, cotizacion_id, estado_pago')
        .eq('id', idComprobante).single();

      if (!comp) { setMapa(null); return; }

      const [origenRes, cotizacionRes, pedidoRes, entregasRes, ncsRes, ndsRes, devRes, cobrosRes, imputadosRes, pagosContadoRes, hermanasRes] = await Promise.allSettled([
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
              .select('id, numero_entrega, fecha, estado, origen, pedido_id, comprobante_id')
              .or(`comprobante_id.eq.${idComprobante},pedido_id.eq.${comp.pedido_id}`)
              .eq('empresa_id', user.empresa_id)
          : supabase.from('entregas')
              .select('id, numero_entrega, fecha, estado, origen, pedido_id, comprobante_id')
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

        // Reversas de cancelar_factura/NC/ND — esas SÍ escriben comprobante_id
        // directo en la fila HABER.
        supabase.from('cuenta_corriente_movimientos')
          .select('id, tipo, monto, fecha, descripcion')
          .eq('comprobante_id', idComprobante)
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'HABER'),

        // Cobros REALES via registrar_cobro_cliente (mig.169 en adelante): esa
        // fila HABER nunca lleva comprobante_id (un cobro puede repartirse
        // entre varias facturas) — el vínculo vive en
        // cuenta_corriente_imputaciones. Bug real (Luciano, 29/08: "no tengo
        // nada desde la factura que me linkee al pago"): sin esto, ninguna
        // factura pagada por Cuenta Corriente mostraba su cobro en el mapa.
        supabase.from('cuenta_corriente_imputaciones')
          .select('monto, cuenta_corriente_movimientos(id, monto, fecha, descripcion)')
          .eq('factura_comprobante_id', idComprobante)
          .eq('empresa_id', user.empresa_id),

        // Bug real (Luciano, 27/08): una factura pagada AL CONTADO (no vía
        // Cuenta Corriente) mostraba estado_pago='pagada' pero el pago no
        // aparecía en ningún lado del mapa — `cuenta_corriente_movimientos`
        // solo registra cancelación de deuda (Open Item), y una venta cobrada
        // en el momento nunca tuvo deuda que cancelar, así que ahí no queda
        // ninguna fila (confirmado contra datos reales: 0 filas para una
        // factura Pagada). El pago sí existe, en `movimientos_caja` (Regla 5
        // sap-reference: Caja se toca en Factura con pago inmediato). Se trae
        // acá aparte — es una fuente de datos distinta, no un reemplazo de
        // "Cobro CC".
        supabase.from('movimientos_caja')
          .select('id, monto, metodo_pago, fecha')
          .eq('comprobante_id', idComprobante)
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'ingreso'),

        // Hallazgo real (Luciano, 23/08): un Pedido puede facturarse en más de
        // un comprobante — parcial a lo largo del tiempo, o por cancelar uno y
        // volver a facturar (ver mig.348). El mapa mostraba una sola "Cadena de
        // documentos" colgada del comprobante que abriste, sin ninguna
        // referencia a las demás facturas del mismo pedido: si abrías la
        // factura cancelada no veías la nueva, y viceversa. Se resuelven acá
        // TODAS las facturas del pedido salvo la actual, para mostrarlas en
        // una sección propia ("Otras facturas de este pedido").
        comp.pedido_id
          ? supabase.from('comprobantes')
              .select('id, numero_venta, numero_afip, tipo, total, fecha, estado_pago')
              .eq('pedido_id', comp.pedido_id).eq('empresa_id', user.empresa_id)
              .eq('tipo', 'venta').neq('id', idComprobante)
          : Promise.resolve({ data: [] }),
      ]);

      const safe    = (res) => res.status === 'fulfilled' ? (res.value.data ?? null) : null;
      const safeArr = (res) => res.status === 'fulfilled' ? (res.value.data ?? []) : [];

      // Dedupe + priorización
      // Bug real (Luciano, 23/08): al traer por pedido_id (para el caso de
      // entrega manual sin comprobante_id todavía), esto también arrastraba
      // entregas que YA están vinculadas a OTRA factura del mismo pedido (ej.
      // se canceló una factura, la entrega quedó libre, se facturó de nuevo —
      // esa entrega ahora es de la factura NUEVA). Sin este filtro, el mapa de
      // la factura VIEJA mostraba esa entrega como propia — información falsa,
      // no solo incompleta. Se descartan acá las que ya pertenecen a otro
      // comprobante distinto del que se está mirando.
      const entregasRaw = safeArr(entregasRes)
        .filter(e => e.comprobante_id === idComprobante || e.comprobante_id == null);
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

      // El monto de cada imputación es la PORCIÓN de ese cobro aplicada a
      // ESTA factura — no el total del cobro (que puede repartirse entre
      // varias). Se muestra ese monto acotado, no el de la fila HABER.
      const cobrosImputados = safeArr(imputadosRes)
        .filter(i => i.cuenta_corriente_movimientos)
        .map(i => ({
          id:          i.cuenta_corriente_movimientos.id,
          monto:       i.monto,
          fecha:       i.cuenta_corriente_movimientos.fecha,
          descripcion: i.cuenta_corriente_movimientos.descripcion,
        }));

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
        cobros:       [...safeArr(cobrosRes), ...cobrosImputados],
        pagosContado: safeArr(pagosContadoRes),
        hermanas:     safeArr(hermanasRes),
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
    fetchDuplicadoInfo('factura_compra', idCompra);
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
    if (TIPOS_SIN_ITEMS.has(nodo.tipo)) { setPreviewItems(null); setPreviewLoading(false); return; }
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
      } else if (tipo === 'orden_compra') {
        const { data } = await supabase.from('ordenes_compra_items')
          .select('descripcion, cantidad_pedida, subtotal')
          .eq('orden_id', id).eq('empresa_id', user.empresa_id);
        rows = (data ?? []).map(i => ({ nombre: i.descripcion, cantidad: i.cantidad_pedida, subtotal: i.subtotal }));
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
    // Bug real (Luciano, 23/08): mapa.comp ya trae estado_pago (el SELECT lo
    // pide) pero nunca se lo pasaba al nodo — una factura cancelada se veía
    // idéntica a una vigente en el Mapa. estadoColor() ya sabe pintar
    // "cancelad..." en rojo, solo faltaba este campo.
    estado: mapa.comp.estado_pago,
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
    && mapa.cobros.length === 0 && mapa.pagosContado.length === 0;

  const sinRelacionesCompra = mapa?.modo === 'compra'
    && mapa.recepciones.length === 0 && mapa.devoluciones.length === 0
    && mapa.nds.length === 0 && mapa.pagos.length === 0
    && mapa.ncsFinancieras.length === 0;

  // Cobros y pago al contado NO cuentan como "derivados" — se muestran como
  // continuación de la Cadena de documentos (29/08, hallazgo Luciano: "no
  // hace falta separarlo, podemos ponerlo junto con la factura"). Un
  // "derivado" real es una rama propia (NC, ND, devolución), no el siguiente
  // paso lineal del mismo circuito.
  const tieneDerivadosVenta = mapa?.modo === 'venta' && (
    mapa.ncs.length > 0 || mapa.nds.length > 0 || mapa.devoluciones.length > 0
  );

  const tieneDerivadosCompra = mapa?.modo === 'compra' && (
    mapa.devoluciones.length > 0 || mapa.nds.length > 0 ||
    mapa.pagos.length > 0 || mapa.ncsFinancieras.length > 0
  );

  // Cobros/reversas/pago al contado como nodos planos (no JSX todavía) — se
  // usan para extender la Cadena de documentos principal, no como
  // "derivados" (29/08: "podemos ponerlo junto con la factura"). Se arman
  // acá, antes de derivadosVentaItems, para reusar el mismo objeto en los
  // dos lugares que lo necesitan sin duplicar la lógica de esReversa.
  const cobrosNodos = mapa?.modo === 'venta' ? [
    ...mapa.cobros.map(c => {
      // cancelar_factura/NC/ND (mig.259/267/321/348) insertan un HABER acá
      // mismo para revertir la deuda — mismo tipo de fila que un cobro real,
      // pero no es plata cobrada. Se distingue por el prefijo fijo que usan
      // todas esas RPCs ('Cancelación Factura/NC/ND ...').
      const esReversa = c.descripcion?.startsWith('Cancelación');
      return {
        id: c.id,
        tipo: esReversa ? 'reversa_cc' : 'cobro_cc',
        numero: c.descripcion || (esReversa ? 'Reversa CC' : 'Cobro CC'),
        fecha: c.fecha,
        monto: c.monto,
        descripcion: c.descripcion,
      };
    }),
    ...mapa.pagosContado.map(p => ({
      id: p.id, tipo: 'cobro_caja', numero: p.metodo_pago || 'Pago al Contado', fecha: p.fecha, monto: p.monto,
    })),
  ] : [];

  // Agrupa corridas consecutivas de "Pago al Contado" en un nido plegable
  // (30/08, pedido de Luciano: "en SAP los mismos comprobantes se anidan") —
  // una venta con 4-5 medios de pago combinados ya no ocupa 4-5 tarjetas
  // sueltas en la cadena. Solo agrupa 'cobro_caja' (el caso real que se
  // repite); un Cobro CC real o una Reversa siguen mostrándose sueltos,
  // cada uno es su propio hecho, no una corrida de líneas del mismo pago.
  const cobrosAgrupados = [];
  for (let i = 0; i < cobrosNodos.length; i++) {
    const n = cobrosNodos[i];
    if (n.tipo === 'cobro_caja') {
      const grupo = [n];
      while (i + 1 < cobrosNodos.length && cobrosNodos[i + 1].tipo === 'cobro_caja') {
        grupo.push(cobrosNodos[++i]);
      }
      cobrosAgrupados.push(grupo.length > 1 ? { esNido: true, id: `nido-${grupo[0].id}`, grupo } : grupo[0]);
    } else {
      cobrosAgrupados.push(n);
    }
  }

  // Un cobro real abre su propio "Comprobante de Pago" (29/08, hallazgo
  // Luciano: "que vuelva a llamar al modal del pago creado") — no tiene
  // página propia, así que en vez de navegar a una sección se lo pide al
  // caller (onNavigate) para que decida cómo mostrarlo. Reversas y pago al
  // contado (sin ese circuito de revisión/cancelación) se quedan con el
  // preview liviano de siempre. Compartida entre nodos sueltos y los que
  // salen de adentro de un nido desplegado (NidoMapa).
  const onNodoClickCobro = (n) => {
    if (n.tipo === 'cobro_cc' && onNavigate) onNavigate('cobro_cc', n.id);
    else openPreview(n);
  };

  // Fase 4 — colapsar ramas largas: mismo orden en el que ya se renderizaban
  // (NC, ND, devoluciones), ahora como array plano para poder recortarlo con
  // .slice() en vez de varios .map() sueltos que no sabían nada del total
  // combinado.
  const LIMITE_DERIVADOS_VISIBLES = 6;
  const derivadosVentaItems = mapa?.modo === 'venta' ? [
    ...mapa.ncs.map(nc => {
      const n = { id: nc.id, tipo: 'nota_credito', numero: nc.numero_afip ?? nc.numero_venta, fecha: nc.fecha, total: nc.total, estado: nc.estado_pago };
      return <NodoMapa key={nc.id} nodo={n} activo={isActivo(n.id)} onClick={() => openPreview(n)} />;
    }),
    ...mapa.nds.map(nd => (
      <NodoMapa
        key={nd.id}
        nodo={{ id: nd.id, tipo: 'nota_debito', numero: nd.numero_nd, fecha: nd.fecha, monto: nd.monto, estado: nd.concepto }}
        activo={isActivo(nd.id)}
      />
    )),
    ...mapa.devoluciones.map(d => {
      const n = { id: d.id, tipo: 'devolucion', numero: d.numero_devolucion, fecha: d.fecha, estado: d.compensacion };
      return <NodoMapa key={d.id} nodo={n} activo={isActivo(n.id)} onClick={() => openPreview(n)} />;
    }),
  ] : [];
  const derivadosCompraItems = mapa?.modo === 'compra' ? [
    ...mapa.devoluciones.map(d => {
      const n = { id: d.id, tipo: 'devolucion_prov', numero: d.numero_devolucion, fecha: d.fecha, estado: d.compensacion };
      return <NodoMapa key={d.id} nodo={n} activo={isActivo(n.id)} onClick={() => openPreview(n)} />;
    }),
    ...mapa.ncsFinancieras.map(nc => (
      <NodoMapa
        key={nc.id}
        nodo={{ id: nc.id, tipo: 'nc_proveedor', numero: nc.numero_ncp, fecha: nc.fecha, monto: nc.monto, estado: nc.motivo }}
        activo={isActivo(nc.id)}
      />
    )),
    ...mapa.nds.map(nd => (
      <NodoMapa
        key={nd.id}
        nodo={{ id: nd.id, tipo: 'nd_proveedor', numero: nd.numero_nd, fecha: nd.fecha, monto: nd.monto, estado: nd.concepto }}
        activo={isActivo(nd.id)}
      />
    )),
  ] : [];

  // ── Resumen del circuito ─────────────────────────────────────────────────────
  const pasosVenta = mapa?.modo === 'venta'
    ? 1 + (mapa.origen ? 1 : 0) + (mapa.cotizacion ? 1 : 0) + (mapa.pedido ? 1 : 0) + mapa.entregas.length + cobrosNodos.length
    : 0;
  const derivadosVenta = mapa?.modo === 'venta'
    ? mapa.ncs.length + mapa.nds.length + mapa.devoluciones.length
    : 0;

  const pasosCompra = mapa?.modo === 'compra'
    ? 1 + mapa.recepciones.length + mapa.pagos.length
    : 0;
  const derivadosCompra = mapa?.modo === 'compra'
    ? mapa.devoluciones.length + mapa.nds.length + mapa.ncsFinancieras.length
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Un solo tamaño, siempre grande — 30/08, hallazgo Luciano: "dejemos
          un solo tamaño para el popup que levanta, usemos todo el tamaño
          para que los comprobantes se vean". Antes alternaba entre
          size="default" (max-w-lg, donde una venta con varios medios de
          pago no entraba) y size="wide" a pedido del usuario — ahora es
          siempre size="wide", el mismo shell que ya usan Factura/Pedido/OC. */}
      <DialogContent size="wide" className="bg-kx-surface border-kx-border text-kx-text">
        <DialogHeader className="flex-shrink-0">
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
          </div>
          <DialogDescription className="text-kx-text-2 text-xs">
            Árbol de documentos vinculados
          </DialogDescription>
          {/* mig.327 — Duplicar documentos: trazabilidad opcional entre un documento
              y el que lo originó/los que se duplicaron a partir de él. */}
          {(duplicadoInfo?.origen || duplicadoInfo?.duplicados?.length > 0) && (
            <div className="flex flex-col gap-1 pt-1">
              {duplicadoInfo.origen && (
                <div className="flex items-center gap-1.5 text-2xs text-kx-text-3">
                  <Layers className="w-3 h-3 shrink-0" />
                  Duplicado de{' '}
                  <button
                    type="button"
                    onClick={() => navigate(navTipoFor(duplicadoInfo.origen.tipo), duplicadoInfo.origen.id)}
                    className="text-kx-violet hover:underline font-medium"
                  >
                    {duplicadoInfo.origen.numero}
                  </button>
                </div>
              )}
              {duplicadoInfo.duplicados.length > 0 && (
                <div className="flex items-center gap-1.5 text-2xs text-kx-text-3 flex-wrap">
                  <Layers className="w-3 h-3 shrink-0" />
                  {duplicadoInfo.duplicados.length === 1 ? 'Duplicado en' : `${duplicadoInfo.duplicados.length} duplicados:`}
                  {duplicadoInfo.duplicados.map((d, i) => (
                    <span key={d.id}>
                      <button
                        type="button"
                        onClick={() => navigate(navTipoFor(d.tipo), d.id)}
                        className="text-kx-violet hover:underline font-medium"
                      >
                        {d.numero}
                      </button>
                      {i < duplicadoInfo.duplicados.length - 1 ? ',' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogHeader>

        {/* Bug real (30/08, Luciano): esta fila no tenía tope de ancho propio
            — un flex container sin `min-w-0`/`w-full` se infla al ancho
            intrínseco de sus hijos (acá, la fila de cards de "Cadena de
            documentos") en vez de respetar el ancho del propio Dialog. */}
        <div className="flex gap-0 w-full min-w-0 flex-1 overflow-hidden">
        {/* Bug real (30/08, Luciano: "se rompe cuando tiene varios pagos"):
            este wrapper tenía SU PROPIO overflow-x-auto, redundante con el de
            la fila "Cadena de documentos" de más abajo — con 5-6 tarjetas de
            pago (una venta mixta real), la fila no entraba y este contenedor
            entero se desplazaba horizontalmente, arrastrando consigo el
            resumen del circuito, "Documentos derivados" y la leyenda (que no
            necesitan scroll propio). El scroll horizontal queda acotado solo
            a la fila que de verdad lo necesita. */}
        <div className="flex-1 min-w-0 py-2 overflow-y-auto">
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
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {sinFacturar.nodos.map((n, i) => (
                  <React.Fragment key={`${n.tipo}-${n.id}`}>
                    {i > 0 && <ChevronRight className="w-4 h-4 text-kx-text-3 shrink-0" />}
                    <NodoMapa nodo={n} activo={n.id === activoId} onClick={() => openPreview(n)} />
                  </React.Fragment>
                ))}
              </div>
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
                  {/* Cobros/reversas/pago al contado como continuación de la
                      cadena, no como "documentos derivados" (29/08, hallazgo
                      Luciano: "podemos ponerlo junto con la factura") — son
                      el siguiente paso lineal del mismo circuito, no una
                      rama propia como una NC o una devolución. */}
                  {cobrosAgrupados.map(item => (
                    <React.Fragment key={item.id}>
                      <Conector />
                      {item.esNido ? (
                        <NidoMapa grupo={item.grupo} isActivo={isActivo} onNodoClick={onNodoClickCobro} />
                      ) : (
                        <NodoMapa
                          nodo={item}
                          activo={isActivo(item.id)}
                          onClick={() => onNodoClickCobro(item)}
                        />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Un Pedido puede tener más de una Factura — parcial a lo largo
                  del tiempo, o porque se canceló una y se volvió a facturar
                  (hallazgo real, 23/08: PED-20260823-001 terminó con
                  FAC-20260823-001 cancelada y FAC-20260823-002 vigente, y
                  el mapa de cada una no sabía nada de la otra). Sección
                  aparte de "Documentos derivados" porque no son derivados
                  DE esta factura — son hermanas, cuelgan del mismo pedido. */}
              {mapa.hermanas?.length > 0 && (
                <div className="rounded-xl bg-kx-surface-2/40 border border-kx-border p-4">
                  <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider mb-3">
                    Otras facturas de este pedido
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {mapa.hermanas.map(f => {
                      const n = {
                        id: f.id, tipo: 'venta', numero: f.numero_afip ?? f.numero_venta,
                        fecha: f.fecha, total: f.total, estado: f.estado_pago,
                      };
                      return <NodoMapa key={f.id} nodo={n} activo={isActivo(n.id)} onClick={() => openPreview(n)} />;
                    })}
                  </div>
                </div>
              )}

              {tieneDerivadosVenta && (
                <div className="rounded-xl bg-kx-surface-2/40 border border-kx-border p-4">
                  <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider mb-3">
                    Documentos derivados
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {derivadosExpandido ? derivadosVentaItems : derivadosVentaItems.slice(0, LIMITE_DERIVADOS_VISIBLES)}
                  </div>
                  {derivadosVentaItems.length > LIMITE_DERIVADOS_VISIBLES && (
                    <button
                      type="button"
                      onClick={() => setDerivadosExpandido(e => !e)}
                      className="mt-3 text-2xs font-medium text-kx-violet hover:underline"
                    >
                      {derivadosExpandido
                        ? 'Ver menos'
                        : `Ver ${derivadosVentaItems.length - LIMITE_DERIVADOS_VISIBLES} más`}
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-2 border-t border-kx-border">
                {['cotizacion', 'venta', 'pedido', 'entrega', 'nota_credito', 'nota_debito', 'cobro_cc', 'cobro_caja', 'devolucion'].map(tipo => (
                  <div key={tipo} className="flex items-center gap-1.5 text-2xs text-kx-text-3">
                    <div className={`w-2 h-2 rounded-full ${TIPO_CONFIG[tipo].dot}`} />
                    {TIPO_CONFIG[tipo].label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── VENTAS: cotización con uno o más pedidos facturados (27/08) ──
              Reemplaza el viejo "sin facturar" cuando algún pedido derivado de
              esta cotización ya tiene factura — una fila por pedido, cada una
              con su propia cadena hasta la factura (o "sin facturar" si ese
              pedido puntual todavía no se facturó). Clic en la factura abre su
              preview igual que cualquier otro nodo; para ver NC/ND/cobros de
              esa factura específica hay que entrar a su propio Mapa (botón
              "ver documento completo" del preview). */}
          {!loading && mapa?.modo === 'cotizacion_ramas' && (
            <div className="space-y-5">
              <ResumenCircuito
                pasos={1 + mapa.ramas.length}
                total={mapa.cotizacion.total}
                derivados={0}
              />

              <NodoMapa
                nodo={{
                  id: mapa.cotizacion.id, tipo: 'cotizacion', numero: mapa.cotizacion.numero,
                  fecha: mapa.cotizacion.fecha, total: mapa.cotizacion.total, estado: mapa.cotizacion.estado,
                }}
                activo={isActivo(mapa.cotizacion.id)}
                onClick={() => openPreview({ id: mapa.cotizacion.id, tipo: 'cotizacion', numero: mapa.cotizacion.numero, fecha: mapa.cotizacion.fecha, total: mapa.cotizacion.total, estado: mapa.cotizacion.estado })}
              />

              <div>
                <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider mb-3">
                  {mapa.ramas.length} pedido{mapa.ramas.length !== 1 ? 's' : ''} derivado{mapa.ramas.length !== 1 ? 's' : ''} de esta cotización
                </p>
                <div className="space-y-3">
                  {mapa.ramas.map(rama => {
                    const pedNodo = {
                      id: rama.pedido.id, tipo: 'pedido', numero: rama.pedido.numero,
                      fecha: rama.pedido.fecha, total: rama.pedido.total, estado: rama.pedido.estado,
                    };
                    const facNodo = rama.factura ? {
                      id: rama.factura.id,
                      tipo: rama.factura.tipo === 'nota_credito' ? 'nota_credito' : 'venta',
                      numero: rama.factura.numero_afip ?? rama.factura.numero_venta,
                      fecha: rama.factura.fecha, total: rama.factura.total, estado: rama.factura.estado_pago,
                    } : null;
                    return (
                      <div key={rama.pedido.id} className="rounded-xl bg-kx-surface-2/40 border border-kx-border p-3">
                        <div className="flex items-start gap-0 overflow-x-auto pb-1">
                          <NodoMapa nodo={pedNodo} activo={isActivo(pedNodo.id)} onClick={() => openPreview(pedNodo)} />
                          <Conector />
                          {rama.entregas.map(e => {
                            const n = { id: e.id, tipo: 'entrega', numero: e.numero_entrega, fecha: e.fecha, estado: e.estado };
                            return (
                              <React.Fragment key={e.id}>
                                <NodoMapa nodo={n} activo={isActivo(n.id)} onClick={() => openPreview(n)} />
                                <Conector />
                              </React.Fragment>
                            );
                          })}
                          {facNodo ? (
                            <NodoMapa nodo={facNodo} activo={isActivo(facNodo.id)} onClick={() => openPreview(facNodo)} />
                          ) : (
                            <div className="bg-kx-surface border border-dashed border-kx-border rounded-xl p-3 w-[150px] h-[176px] flex-shrink-0 flex flex-col items-center justify-center text-center">
                              <span className="text-2xs text-kx-text-3">Sin facturar todavía</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
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
                    {derivadosExpandido ? derivadosCompraItems : derivadosCompraItems.slice(0, LIMITE_DERIVADOS_VISIBLES)}
                  </div>
                  {derivadosCompraItems.length > LIMITE_DERIVADOS_VISIBLES && (
                    <button
                      type="button"
                      onClick={() => setDerivadosExpandido(e => !e)}
                      className="mt-3 text-2xs font-medium text-kx-violet hover:underline"
                    >
                      {derivadosExpandido
                        ? 'Ver menos'
                        : `Ver ${derivadosCompraItems.length - LIMITE_DERIVADOS_VISIBLES} más`}
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-2 border-t border-kx-border">
                {['factura_compra', 'recepcion', 'pago_proveedor', 'nc_proveedor', 'nd_proveedor', 'devolucion_prov'].map(tipo => (
                  <div key={tipo} className="flex items-center gap-1.5 text-2xs text-kx-text-3">
                    <div className={`w-2 h-2 rounded-full ${TIPO_CONFIG[tipo].dot}`} />
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
            onVerCompleto={
              TIPOS_SIN_ITEMS.has(previewNodo.tipo)
                // Un cobro no tiene página propia — "revisarlo" (29/08,
                // hallazgo Luciano) es ver los movimientos del cliente en
                // Cuenta Corriente. El id es el cliente_id de la factura
                // (mapa.comp), no el id del movimiento en sí.
                ? (mapa?.comp?.cliente_id ? () => navigate('cliente_cc', mapa.comp.cliente_id) : undefined)
                : () => navigate(navTipoFor(previewNodo.tipo), previewNodo.id)
            }
            verCompletoLabel={TIPOS_SIN_ITEMS.has(previewNodo.tipo) ? 'Ver en Cuenta Corriente' : 'Ver documento completo'}
          />
        )}
        </div>

        <div className="flex justify-end pt-3 border-t border-kx-border flex-shrink-0">
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
