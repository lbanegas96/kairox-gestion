export const DIAS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
];

export const MEDIOS_PAGO = [
  { value: '', label: 'Todos' },
  { value: 'Efectivo', label: 'Efectivo' },
  { value: 'Transferencia', label: 'Transferencia' },
  { value: 'Tarjeta', label: 'Tarjeta' },
  { value: 'Cuenta Corriente', label: 'Cuenta Corriente' },
];

export const EMPTY_OFERTA = {
  nombre: '',
  descripcion: '',
  tipo_descuento: 'porcentaje',
  valor_descuento: '',
  producto_id: null,
  categoria_nombre: '',
  medio_pago: '',
  dia_semana: [],
  monto_minimo_carrito: '',
  cantidad_minima: '',
  fecha_desde: '',
  fecha_hasta: '',
  prioridad: 0,
  acumulable: false,
  activo: true,
};

export const preparePayload = (form) => ({
  nombre: form.nombre,
  descripcion: form.descripcion?.trim() || null,
  tipo_descuento: form.tipo_descuento,
  valor_descuento: parseFloat(form.valor_descuento),
  producto_id: form.producto_id || null,
  categoria_nombre: form.categoria_nombre?.trim() || null,
  medio_pago: form.medio_pago || null,
  dia_semana: form.dia_semana.length > 0 ? form.dia_semana : null,
  monto_minimo_carrito: form.monto_minimo_carrito ? parseFloat(form.monto_minimo_carrito) : null,
  cantidad_minima: form.cantidad_minima ? parseFloat(form.cantidad_minima) : null,
  fecha_desde: form.fecha_desde || null,
  fecha_hasta: form.fecha_hasta || null,
  prioridad: parseInt(form.prioridad) || 0,
  acumulable: form.acumulable,
  activo: form.activo,
});

export const formatDate = (d) => {
  if (!d) return null;
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};
