import { supabase } from '@/lib/customSupabaseClient';
import { getEmpresaParaPDF } from '@/lib/empresaUtils';

// Genera el Estado de Cuenta de un PROVEEDOR como PDF real — mismo patrón que
// imprimirEstadoCuenta.jsx (Fase 3 de PLAN_PARIDAD_COMPRAS.md, 04/09), pero
// contra `cuenta_corriente_proveedores` en vez de `cuenta_corriente_movimientos`.
//
// Polaridad: 'compra'/'nota_debito' aumentan lo que la empresa le debe al
// proveedor (esDebito=true, mismo rol que 'DEBE' del lado clientes); 'pago'/
// 'nota_credito' lo reducen (esDebito=false) -- mismo criterio ya usado en
// ProveedoresSection.jsx/proveedoresService.ts para el saldo. 'ajuste' no se
// usa hoy en ninguna RPC real; se trata como no-débito por consistencia con
// el check de pantalla existente.
//
// Referencia por fila: para 'compra' con referencia_id, el N° de factura de
// `compras` (mismo espíritu que el N° de comprobante en Clientes); para pagos,
// `referencia_pago` (N° de operación/cupón) si se cargó.
export async function imprimirEstadoCuentaProveedor({ proveedorId, empresaId, fechaDesde, fechaHasta }) {
  const { data: proveedor, error: provError } = await supabase
    .from('proveedores')
    .select('id, nombre, cuit')
    .eq('id', proveedorId)
    .single();
  if (provError) throw provError;

  let saldoAnterior = 0;
  if (fechaDesde) {
    const { data: previos, error: previosError } = await supabase
      .from('cuenta_corriente_proveedores')
      .select('tipo, monto')
      .eq('proveedor_id', proveedorId)
      .lt('fecha', fechaDesde);
    if (previosError) throw previosError;
    saldoAnterior = (previos || []).reduce((acc, m) => {
      const esDebito = m.tipo === 'compra' || m.tipo === 'nota_debito';
      return acc + (esDebito ? Number(m.monto) : -Number(m.monto));
    }, 0);
  }

  let periodoQuery = supabase
    .from('cuenta_corriente_proveedores')
    .select('id, tipo, monto, descripcion, fecha, referencia_id, referencia_tipo, referencia_pago')
    .eq('proveedor_id', proveedorId)
    .order('fecha', { ascending: true });
  if (fechaDesde) periodoQuery = periodoQuery.gte('fecha', fechaDesde);
  if (fechaHasta) periodoQuery = periodoQuery.lte('fecha', `${fechaHasta}T23:59:59`);

  const { data: movsPeriodo, error: movsError } = await periodoQuery;
  if (movsError) throw movsError;

  // Trazabilidad: las filas 'compra' apuntan a `compras.id` vía referencia_id
  // (registrar_factura_compra_oc/NuevaFacturaProveedorModal.jsx/cancelar_compra
  // lo usan igual) -- traemos el N° de factura real para mostrarlo.
  const compraIds = [...new Set(
    (movsPeriodo || []).filter(m => m.tipo === 'compra' && m.referencia_id).map(m => m.referencia_id)
  )];
  let comprasMap = {};
  if (compraIds.length > 0) {
    const { data: compras } = await supabase.from('compras').select('id, numero_factura').in('id', compraIds);
    comprasMap = Object.fromEntries((compras || []).map(c => [c.id, c]));
  }

  let saldoCorrido = saldoAnterior;
  let totalDebe = 0;
  let totalHaber = 0;
  const movimientos = (movsPeriodo || []).map((m) => {
    const monto = Number(m.monto);
    const esDebito = m.tipo === 'compra' || m.tipo === 'nota_debito';
    if (esDebito) { saldoCorrido += monto; totalDebe += monto; }
    else { saldoCorrido -= monto; totalHaber += monto; }
    const referencia = esDebito
      ? (m.referencia_id ? (comprasMap[m.referencia_id]?.numero_factura || null) : null)
      : (m.referencia_pago || null);
    return { ...m, saldo: saldoCorrido, esDebito, referencia };
  });

  const empresa = await getEmpresaParaPDF(empresaId);

  const { pdf } = await import('@react-pdf/renderer');
  const { EstadoCuentaPDF } = await import('@/components/shared/pdf/EstadoCuentaPDF');
  const blob = await pdf(
    <EstadoCuentaPDF
      estadoCuenta={{
        cliente: { nombre: proveedor.nombre, documento: proveedor.cuit },
        entidadLabel: 'Proveedor',
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
  a.download = `Estado_de_Cuenta_${(proveedor.nombre || 'proveedor').replace(/[^\w]+/g, '_')}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
