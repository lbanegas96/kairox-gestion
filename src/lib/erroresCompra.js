// Mensajes de error de Compras que la base devuelve en crudo.
//
// mig.411 (auditoría 24/09, CON-6): un índice único impide cargar dos veces la misma factura de un proveedor
// (mismo proveedor y mismo número, dentro del Libro IVA y sin anular). Cuando salta, Postgres responde
// `duplicate key value violates unique constraint "uq_compras_factura_proveedor"`, que no le dice nada a quien
// está cargando la factura. Esto lo traduce, sin importar por qué camino llegó el error (insert directo, edición
// del número o la función que registra la factura de una OC: unas lo dejan en `error.message`, otras lo envuelven
// en un `Error` nuevo, así que se reconoce por el nombre del índice y no por el código).

export const INDICE_FACTURA_PROVEEDOR = 'uq_compras_factura_proveedor';

export const MSG_FACTURA_DUPLICADA =
  'Ya hay una factura cargada de este proveedor con ese mismo número. Revisá que no la hayas registrado antes; si es otra factura, corregí el número.';

/** true si el error es "esta factura de proveedor ya existe" (índice único de mig.411). */
export function esFacturaProveedorDuplicada(err) {
  const texto = [err?.message, err?.details, err?.hint].filter(Boolean).join(' ');
  return texto.includes(INDICE_FACTURA_PROVEEDOR);
}

/** Mensaje para mostrar en pantalla: el amigable si es una factura duplicada, si no el original. */
export function mensajeErrorCompra(err, porDefecto = 'Ocurrió un error inesperado') {
  if (esFacturaProveedorDuplicada(err)) return MSG_FACTURA_DUPLICADA;
  return err?.message || porDefecto;
}
