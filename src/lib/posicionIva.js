// Fuente ÚNICA de la "Posición IVA" del período (Débito Fiscal − Crédito Fiscal).
//
// Hasta el 23/09 había DOS cálculos sueltos que daban números distintos para el
// mismo período — `TabIVA.jsx` (Impuestos → IVA) y `ReportePosicionFiscal.jsx`
// (Reportes → Posición Fiscal Consolidada) — y ninguno coincidía del todo con lo
// que muestran y exportan Libro IVA Ventas y Libro IVA Compras (que es lo que
// efectivamente se declara a ARCA). Ahora los dos usan esta función, con el
// MISMO criterio de qué comprobante cuenta que los 2 Libros:
//
// DÉBITO (Ventas) — comprobantes.tipo venta / nota_debito suman, nota_credito
//   resta. Cuenta solo con CAE emitido o sin AFIP (`no_aplica`, definitivo);
//   `pendiente`/`error` son transitorios y `error_definitivo` es un comprobante
//   que ARCA rechazó — ninguno es un documento válido todavía. Canceladas afuera.
//   (Las ND de cliente viven en `comprobantes`, no en `notas_debito` — esa rama
//   quedó deprecada, ver mig.268/269/278.)
// CRÉDITO (Compras) — compras suman (menos las `anulada`, cancelar_compra, y
//   las "No libro" de Compra Rápida, que no suman crédito fiscal), ND recibida
//   de proveedor suma (nos cobran algo con IVA), NC de proveedor resta.
//   ND/NC canceladas afuera.

const CAE_VALIDOS = ['emitido', 'no_aplica'];

/** IVA de una fila; fallback /1.21 solo para filas viejas sin `iva_discriminado` (igual que los Libros). */
function ivaDe(total, ivaDiscriminado) {
  return ivaDiscriminado != null
    ? Number(ivaDiscriminado)
    : Number(total) - Number(total) / 1.21;
}

/**
 * Cálculo puro (sin red) — recibe las filas ya filtradas por `fetchPosicionIva`.
 * `comprobantes`: { tipo, total, iva_discriminado }; `compras`: { total, iva_discriminado };
 * `ndProveedor` / `ncProveedor`: { monto, iva_discriminado }.
 */
export function calcularPosicionIva({ comprobantes = [], compras = [], ndProveedor = [], ncProveedor = [] }) {
  const debito = comprobantes.reduce((s, c) => {
    const iva = ivaDe(c.total, c.iva_discriminado);
    return s + (c.tipo === 'nota_credito' ? -iva : iva);
  }, 0);
  const credito =
    compras.reduce((s, c) => s + ivaDe(c.total, c.iva_discriminado), 0)
    + ndProveedor.reduce((s, n) => s + ivaDe(n.monto, n.iva_discriminado), 0)
    - ncProveedor.reduce((s, n) => s + ivaDe(n.monto, n.iva_discriminado), 0);
  return { debito, credito, saldo: debito - credito };
}

/** Trae los 4 grupos de comprobantes del período y devuelve { debito, credito, saldo }. Lanza si alguna consulta falla. */
export async function fetchPosicionIva(supabase, empresaId, fechaDesde, fechaHasta) {
  const desde = `${fechaDesde}T00:00:00`;
  const hasta = `${fechaHasta}T23:59:59`;

  const [ventas, compras, nd, nc] = await Promise.all([
    supabase.from('comprobantes')
      .select('tipo, total, iva_discriminado')
      .eq('empresa_id', empresaId)
      .in('tipo', ['venta', 'nota_credito', 'nota_debito'])
      .in('cae_estado', CAE_VALIDOS)
      .neq('estado_pago', 'cancelada')
      .gte('fecha', desde).lte('fecha', hasta),
    supabase.from('compras')
      .select('total, iva_discriminado')
      .eq('empresa_id', empresaId)
      .neq('estado_pago', 'anulada')
      .eq('en_libro_iva', true) // "No libro" no suma crédito fiscal (mig.400)
      .gte('fecha', desde).lte('fecha', hasta),
    supabase.from('notas_debito')
      .select('monto, iva_discriminado')
      .eq('empresa_id', empresaId).eq('tipo', 'recibida')
      .neq('estado', 'cancelada')
      .gte('fecha', desde).lte('fecha', hasta),
    supabase.from('notas_credito_proveedor')
      .select('monto, iva_discriminado')
      .eq('empresa_id', empresaId)
      .neq('estado', 'cancelada')
      .gte('fecha', desde).lte('fecha', hasta),
  ]);

  const error = ventas.error || compras.error || nd.error || nc.error;
  if (error) throw error;

  return calcularPosicionIva({
    comprobantes: ventas.data ?? [],
    compras: compras.data ?? [],
    ndProveedor: nd.data ?? [],
    ncProveedor: nc.data ?? [],
  });
}
