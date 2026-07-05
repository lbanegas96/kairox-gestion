/**
 * Formatea un CUIT/CUIL de 11 dígitos como XX-XXXXXXXX-X.
 * Si no tiene exactamente 11 dígitos, devuelve el valor original sin tocar.
 */
export const formatCuit = (raw) => {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length !== 11) return raw ?? '';
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
};
