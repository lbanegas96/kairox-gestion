import { Send, CheckCircle, Clock, AlertCircle, XCircle } from 'lucide-react';

export const ESTADOS = {
  borrador:         { label: 'Borrador',         color: 'bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-slate-300',     icon: Clock },
  enviada:          { label: 'Enviada',           color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',      icon: Send },
  recibida_parcial: { label: 'Recibida parcial',  color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300', icon: AlertCircle },
  recibida:         { label: 'Recibida',          color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',  icon: CheckCircle },
  cancelada:        { label: 'Cancelada',         color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',         icon: XCircle },
};

export const FACTURA_ESTADO_COLORS = {
  pendiente: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  pagada:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  vencida:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  anulada:   'bg-slate-100 text-slate-500 dark:bg-kx-surface-2 dark:text-kx-text-2',
};

export const FORMAS_PAGO = ['Efectivo', 'Transferencia', 'Cheque', 'Tarjeta Crédito', 'Cuenta Corriente'];
export const EMPTY_ITEM = { descripcion: '', cantidad_pedida: 1, costo_unitario: '', producto_id: null, unidad_medida: '', _prodSearch: '' };
