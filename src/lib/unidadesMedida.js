// Unidades de medida comunes para inventario, OC, cotizaciones, pedidos, compras.
// Mantener sincronizada con getShortUnit() en ComprasSection.
export const UNIDADES_COMUNES = [
  { value: 'Unidad',      label: 'Unidad (un)' },
  { value: 'Kilogramos',  label: 'Kilogramos (kg)' },
  { value: 'Gramos',      label: 'Gramos (gr)' },
  { value: 'Litros',      label: 'Litros (lt)' },
  { value: 'Mililitros',  label: 'Mililitros (ml)' },
  { value: 'Metros',      label: 'Metros (m)' },
  { value: 'Centimetros', label: 'Centímetros (cm)' },
  { value: 'Caja',        label: 'Caja' },
  { value: 'Pack',        label: 'Pack' },
  { value: 'Docena',      label: 'Docena' },
  { value: 'Bolsa',       label: 'Bolsa' },
];

export const getShortUnit = (unit) => {
  switch (unit) {
    case 'Unidad':      return 'un';
    case 'Kilogramos':  return 'kg';
    case 'Gramos':      return 'gr';
    case 'Litros':      return 'lt';
    case 'Mililitros':  return 'ml';
    case 'Metros':      return 'm';
    case 'Centimetros': return 'cm';
    case 'Caja':        return 'caja';
    case 'Pack':        return 'pack';
    case 'Docena':      return 'doc';
    case 'Bolsa':       return 'bolsa';
    default:            return unit || 'un';
  }
};
