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

// ─── Conversión general entre unidades de medida (migration 188) ────────────
// Cada unidad del maestro `unidades_medida` tiene `magnitud` (masa/volumen/
// longitud/cantidad, o NULL para empaques sin conversión física fija como Caja)
// y `factor_base` = cuántas unidades BASE de esa magnitud representa. La unidad
// base es la que tiene factor_base = 1 (GR, ML, CM, UN respectivamente).
//
// OJO: esto es distinto de `productos.factor_conversion_compra` (mig.186), que
// es el factor de EMPAQUE por producto ("1 Caja de ESTE producto = 12 unidades")
// — arbitrario por producto y sin relación física fija.

export const MAGNITUDES = [
  { value: 'masa',     label: 'Masa',     base: 'GR' },
  { value: 'volumen',  label: 'Volumen',  base: 'ML' },
  { value: 'longitud', label: 'Longitud', base: 'CM' },
  { value: 'cantidad', label: 'Cantidad', base: 'UN' },
];

export const getMagnitudLabel = (value) =>
  MAGNITUDES.find(m => m.value === value)?.label ?? null;

// ¿Se pueden convertir estas 2 unidades entre sí? (misma magnitud, ambas con factor)
export const sonConvertibles = (unidadA, unidadB) => {
  if (!unidadA || !unidadB) return false;
  return (
    unidadA.magnitud != null &&
    unidadA.magnitud === unidadB.magnitud &&
    Number(unidadA.factor_base) > 0 &&
    Number(unidadB.factor_base) > 0
  );
};

// Factor para convertir 1 unidad de `desde` a la unidad `hacia` (misma magnitud).
// Ej: desde=TN (factor_base 1.000.000), hacia=KG (factor_base 1.000) → 1000.
// Devuelve null si no son convertibles.
export const factorEntreUnidades = (desde, hacia) => {
  if (!sonConvertibles(desde, hacia)) return null;
  return Number(desde.factor_base) / Number(hacia.factor_base);
};

// Convierte una cantidad de la unidad `desde` a la unidad `hacia`.
// Devuelve null si no son convertibles.
export const convertirCantidad = (cantidad, desde, hacia) => {
  const factor = factorEntreUnidades(desde, hacia);
  if (factor == null) return null;
  return Number(cantidad) * factor;
};
