import React from 'react';
import { ArrowRight, FileText, ClipboardList, Truck, Receipt, RotateCcw, ShoppingBag, Package, MinusCircle, FileWarning } from 'lucide-react';

const CHIP_CONFIG = {
  cotizacion:    { label: 'Cotización',      Icon: ClipboardList, color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  pedido:        { label: 'Pedido',          Icon: FileText,      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'   },
  entrega:       { label: 'Entrega',         Icon: Truck,         color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  factura:       { label: 'Factura',         Icon: Receipt,       color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  devolucion:    { label: 'Devolución',      Icon: RotateCcw,     color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'       },
  nota_credito:  { label: 'Nota de Crédito', Icon: MinusCircle,   color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'   },
  nota_debito:   { label: 'Nota de Débito',  Icon: FileWarning,   color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  orden_compra:  { label: 'OC',              Icon: ShoppingBag,   color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'   },
  recepcion:     { label: 'Recepción',       Icon: Package,       color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  factura_compra: { label: 'Fact. Compra',   Icon: Receipt,       color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
};

/**
 * DocumentFlow — cadena visual de chips con flechas.
 * props:
 *   chips:      [{ tipo, id, numero, active }]
 *   onNavigate: (tipo, id) => void — llamado al hacer click en un chip
 */
function DocumentFlow({ chips = [], onNavigate }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {chips.map((chip, idx) => {
        const cfg = CHIP_CONFIG[chip.tipo] || CHIP_CONFIG.cotizacion;
        const { Icon } = cfg;
        return (
          <React.Fragment key={`${chip.tipo}-${chip.id ?? idx}`}>
            {idx > 0 && (
              <ArrowRight className="h-3 w-3 text-kx-text-3 shrink-0" />
            )}
            <button
              onClick={() => chip.id && onNavigate?.(chip.tipo, chip.id)}
              disabled={!chip.id || !onNavigate}
              className={[
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                'transition-opacity',
                cfg.color,
                chip.active ? 'ring-2 ring-[rgb(var(--kx-violet))] ring-offset-1' : '',
                chip.id && onNavigate ? 'cursor-pointer hover:opacity-80' : 'cursor-default opacity-60',
              ].join(' ')}
            >
              <Icon className="h-3 w-3 shrink-0" />
              {chip.numero || cfg.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default DocumentFlow;
