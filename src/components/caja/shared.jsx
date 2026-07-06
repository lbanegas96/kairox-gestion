export const categoriasIngreso = [
  { value: 'Venta', label: 'Venta (Automático)', disabled: true },
  { value: 'Cobro', label: 'Cobro' },
  { value: 'Inversión', label: 'Inversión' },
  { value: 'Otro Ingreso', label: 'Otro Ingreso' }
];

export const categoriasEgreso = [
  { value: 'Compra', label: 'Compra (Automático)', disabled: true },
  { value: 'Servicios', label: 'Servicios' },
  { value: 'Sueldos', label: 'Sueldos' },
  { value: 'Alquiler', label: 'Alquiler' },
  { value: 'Impuestos', label: 'Impuestos' },
  { value: 'Mantenimiento', label: 'Mantenimiento' },
  { value: 'Otro Egreso', label: 'Otro Egreso' }
];

export const formatAmount = (amount, type) => {
  const num = Number(amount);
  const formatted = num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === 'egreso') return `-$${formatted}`;
  return `$${formatted}`;
};

export const getPeriodLabel = (p) => {
  switch (p) {
    case 'today': return 'Hoy';
    case 'thisWeek': return 'Esta Semana';
    case 'thisMonth': return 'Este Mes';
    case 'last30': return 'Últimos 30 Días';
    case 'custom': return 'Personalizado';
    default: return p;
  }
};
