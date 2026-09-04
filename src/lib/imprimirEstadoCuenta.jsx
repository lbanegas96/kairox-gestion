import { supabase } from '@/lib/customSupabaseClient';
import { getEmpresaParaPDF } from '@/lib/empresaUtils';
import { formatNumeroComprobante } from '@/lib/numeroComprobante';

// Genera el Estado de Cuenta de un cliente como PDF real (@react-pdf/renderer)
// y lo descarga — mismo patrón que imprimirRecibo.jsx (import dinámico,
// <a download> en vez de window.open). Hace su PROPIA consulta a
// cuenta_corriente_movimientos (no reusa el state del modal, que puede estar
// acotado a los últimos 50) para que el PDF sea siempre completo dentro del
// rango pedido.
//
// Cálculo del saldo corrido: el saldo anterior al rango es la suma de todos
// los movimientos de ANTES de fechaDesde (DEBE suma, HABER resta). Sin
// fechaDesde, se toma como 0 (el PDF es "desde el origen" de la cuenta). A
// partir de ahí, cada fila del período va acumulando su propio efecto, en
// orden cronológico (más viejo primero) — así se lee un resumen de cuenta.
export async function imprimirEstadoCuenta({ clienteId, empresaId, fechaDesde, fechaHasta }) {
  const { data: cliente, error: clienteError } = await supabase
    .from('clientes')
    .select('id, nombre, documento')
    .eq('id', clienteId)
    .single();
  if (clienteError) throw clienteError;

  let saldoAnterior = 0;
  if (fechaDesde) {
    const { data: previos, error: previosError } = await supabase
      .from('cuenta_corriente_movimientos')
      .select('tipo, monto')
      .eq('cliente_id', clienteId)
      .lt('fecha', fechaDesde);
    if (previosError) throw previosError;
    saldoAnterior = (previos || []).reduce(
      (acc, m) => acc + (m.tipo === 'DEBE' ? Number(m.monto) : -Number(m.monto)),
      0
    );
  }

  let periodoQuery = supabase
    .from('cuenta_corriente_movimientos')
    .select('id, tipo, monto, descripcion, fecha, comprobante_id, metodo_cobro')
    .eq('cliente_id', clienteId)
    .order('fecha', { ascending: true });
  if (fechaDesde) periodoQuery = periodoQuery.gte('fecha', fechaDesde);
  if (fechaHasta) periodoQuery = periodoQuery.lte('fecha', `${fechaHasta}T23:59:59`);

  const { data: movsPeriodo, error: movsError } = await periodoQuery;
  if (movsError) throw movsError;

  // Trazabilidad (02/09, hallazgo Luciano: "poder ir rápidamente al sistema y
  // revisar esa venta" ante un reclamo) — el N° de comprobante real (mismo
  // formato "Letra PdV-Folio" que usa el resto del sistema, numeroComprobante.js)
  // para los cargos, y el medio de pago para los pagos.
  const comprobanteIds = [...new Set((movsPeriodo || []).map(m => m.comprobante_id).filter(Boolean))];
  let comprobantesMap = {};
  if (comprobanteIds.length > 0) {
    const { data: comps } = await supabase
      .from('comprobantes')
      .select('id, numero_venta, numero_afip, tipo_comprobante_afip')
      .in('id', comprobanteIds);
    comprobantesMap = Object.fromEntries((comps || []).map(c => [c.id, c]));
  }

  let saldoCorrido = saldoAnterior;
  let totalDebe = 0;
  let totalHaber = 0;
  const movimientos = (movsPeriodo || []).map((m) => {
    const monto = Number(m.monto);
    const isDebe = m.tipo === 'DEBE';
    if (isDebe) { saldoCorrido += monto; totalDebe += monto; }
    else { saldoCorrido -= monto; totalHaber += monto; }
    const referencia = isDebe
      ? (m.comprobante_id ? formatNumeroComprobante(comprobantesMap[m.comprobante_id]) : null)
      : (m.metodo_cobro || null);
    return { ...m, saldo: saldoCorrido, referencia };
  });

  const empresa = await getEmpresaParaPDF(empresaId);

  const { pdf } = await import('@react-pdf/renderer');
  const { EstadoCuentaPDF } = await import('@/components/shared/pdf/EstadoCuentaPDF');
  const blob = await pdf(
    <EstadoCuentaPDF
      estadoCuenta={{
        cliente,
        fechaDesde, fechaHasta,
        saldoAnterior,
        movimientos,
        totalDebe, totalHaber,
        saldoFinal: saldoCorrido,
        empresa,
      }}
    />
  ).toBlob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Estado_de_Cuenta_${(cliente.nombre || 'cliente').replace(/[^\w]+/g, '_')}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
