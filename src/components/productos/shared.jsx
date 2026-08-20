import { FileEdit, CheckCircle2, XCircle } from 'lucide-react';

// Estados compartidos por Recuento y Revalorización de Inventario (mig.335/336) —
// mismo formato {label, color, icon} que ordenes-compra/shared.jsx.
export const ESTADOS_AJUSTE_INVENTARIO = {
  borrador:   { label: 'Borrador',   color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', icon: FileEdit },
  confirmado: { label: 'Confirmado', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle2 },
  anulado:    { label: 'Anulado',    color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
};
