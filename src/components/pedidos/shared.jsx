import { Check } from 'lucide-react';

export const ESTADOS = [
  { id: 'borrador',        label: 'Borrador',        color: 'bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-slate-300',           next: 'confirmado'       },
  { id: 'confirmado',      label: 'Confirmado',      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',            next: 'en_preparacion'   },
  { id: 'en_preparacion',  label: 'En Preparación',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',        next: 'facturado'        },
  { id: 'facturado',       label: 'Facturado',       color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',        next: null               },
  { id: 'cancelado',       label: 'Cancelado',       color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',               next: null               },
];

export const getEstado = (id) => ESTADOS.find(e => e.id === id) || ESTADOS[0];

export function EstadoBadge({ estado }) {
  const e = getEstado(estado);
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${e.color}`}>{e.label}</span>;
}

export function ProgressoBadge({ items = [] }) {
  if (!items.length) return null;
  const totalPedido    = items.reduce((s, i) => s + Number(i.cantidad || 0), 0);
  const totalEntregado = items.reduce((s, i) => s + Number(i.cantidad_entregada || 0), 0);
  if (totalEntregado <= 0) return null;
  if (totalEntregado >= totalPedido) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
        <Check className="h-3 w-3" /> Entregado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
      {totalEntregado}/{totalPedido} ents.
    </span>
  );
}
