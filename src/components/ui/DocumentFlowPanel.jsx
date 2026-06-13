import React, { useEffect, useState } from 'react';
import { FileText, ShoppingCart, ClipboardList, PackageCheck, MinusCircle, CreditCard, ArrowRight, Loader2, GitBranch, RotateCcw } from 'lucide-react';
import { documentFlowService } from '@/services/documentFlowService';
import { formatDateAR } from '@/lib/dateUtils';

const TIPO_CONFIG = {
  cotizacion:   { label: 'Cotización',      icon: ClipboardList, color: 'text-violet-500', bg: 'bg-violet-50 border-violet-200 dark:bg-violet-900/20 dark:border-violet-800' },
  pedido:       { label: 'Pedido',          icon: PackageCheck,  color: 'text-blue-500',   bg: 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800' },
  venta:        { label: 'Venta',           icon: ShoppingCart,  color: 'text-emerald-500',bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800' },
  nota_credito: { label: 'Nota de Crédito', icon: MinusCircle,   color: 'text-rose-500',   bg: 'bg-rose-50 border-rose-200 dark:bg-rose-900/20 dark:border-rose-800' },
  cobro_cc:     { label: 'Cobro CC',        icon: CreditCard,    color: 'text-amber-500',  bg: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800' },
  devolucion:   { label: 'Devolución',      icon: RotateCcw,     color: 'text-orange-500', bg: 'bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800' },
};

function DocNode({ node, isActual = false, onNavigate }) {
  const cfg = TIPO_CONFIG[node.tipo] ?? TIPO_CONFIG.venta;
  const Icon = cfg.icon;
  return (
    <button
      onClick={() => !isActual && onNavigate?.(node.seccion)}
      className={`flex flex-col gap-1 p-2.5 rounded-lg border text-left transition-all min-w-[110px] ${cfg.bg} ${
        isActual
          ? 'ring-2 ring-offset-1 ring-blue-400 dark:ring-blue-500 cursor-default'
          : 'hover:opacity-80 cursor-pointer'
      }`}
      disabled={isActual}
      title={isActual ? 'Documento actual' : `Ir a ${cfg.label}`}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${cfg.color}`} />
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${cfg.color}`}>{cfg.label}</span>
      </div>
      <span className="text-xs font-bold text-slate-700 dark:text-white truncate">{node.numero}</span>
      <span className="text-[10px] text-slate-400">{formatDateAR(node.fecha)}</span>
      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
        ${Number(node.monto).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
      </span>
      {node.estado && (
        <span className="text-[9px] text-slate-400 uppercase">{node.estado.replace('_', ' ')}</span>
      )}
    </button>
  );
}

function Arrow() {
  return <ArrowRight className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 mt-4" />;
}

/**
 * DocumentFlowPanel — muestra la cadena de documentos relacionados a un comprobante.
 * Inspirado en SAP SD Document Flow.
 *
 * Props:
 *  - comprobanteId: string
 *  - onNavigate: (seccion: string) => void
 */
export function DocumentFlowPanel({ comprobanteId, onNavigate }) {
  const [flow, setFlow] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!comprobanteId) return;
    setLoading(true);
    documentFlowService
      .getFlowForComprobante(comprobanteId)
      .then(setFlow)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [comprobanteId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-slate-400 text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Cargando flujo...
      </div>
    );
  }

  const hasFlow =
    flow &&
    (flow.origen || flow.fuente_nc || flow.notas_credito.length > 0 || flow.cobros_cc.length > 0 || (flow.devoluciones?.length ?? 0) > 0);

  if (!hasFlow && flow) {
    return (
      <div className="text-xs text-slate-400 py-2 flex items-center gap-1.5">
        <GitBranch className="w-3.5 h-3.5" />
        Sin documentos relacionados
      </div>
    );
  }

  if (!flow) return null;

  // Construir la cadena lineal: origen → actual → NC → cobros
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1.5 mb-3">
        <GitBranch className="w-3.5 h-3.5" /> Document Flow
      </p>
      <div className="flex items-start gap-2 flex-wrap">
        {/* Origen: cotización o pedido */}
        {flow.origen && (
          <>
            <DocNode node={flow.origen} onNavigate={onNavigate} />
            <Arrow />
          </>
        )}
        {/* Fuente NC: la venta original (cuando el actual es una NC) */}
        {flow.fuente_nc && (
          <>
            <DocNode node={flow.fuente_nc} onNavigate={onNavigate} />
            <Arrow />
          </>
        )}
        {/* El comprobante actual */}
        <DocNode node={flow.actual} isActual onNavigate={onNavigate} />
        {/* NC emitidas contra este comprobante */}
        {flow.notas_credito.map(nc => (
          <React.Fragment key={nc.id}>
            <Arrow />
            <DocNode node={nc} onNavigate={onNavigate} />
          </React.Fragment>
        ))}
        {/* Cobros CC */}
        {flow.cobros_cc.map(cobro => (
          <React.Fragment key={cobro.id}>
            <Arrow />
            <DocNode node={cobro} onNavigate={onNavigate} />
          </React.Fragment>
        ))}
        {/* Devoluciones de cliente */}
        {(flow.devoluciones ?? []).map(dev => (
          <React.Fragment key={dev.id}>
            <Arrow />
            <DocNode node={dev} onNavigate={onNavigate} />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default DocumentFlowPanel;
