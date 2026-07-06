export const ESTADOS = {
  borrador:   { label: 'Borrador',   color: 'bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-slate-300' },
  enviada:    { label: 'Enviada',    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  aprobada:   { label: 'Aprobada',   color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  rechazada:  { label: 'Rechazada',  color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  vencida:    { label: 'Vencida',    color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  convertida: { label: 'Convertida', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
};

export const EMPTY_ITEM = { descripcion: '', cantidad: 1, precio_unitario: '', producto_id: null, unidad_medida: '' };
