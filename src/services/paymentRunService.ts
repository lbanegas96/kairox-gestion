import { supabase } from '@/lib/customSupabaseClient';
import { addDaysAR } from '@/lib/dateUtils';
import { proveedoresService } from '@/services/proveedoresService';

export const PAYMENT_RUN_KEYS = {
  pendientes: (empresaId: string) => ['payment-run', 'pendientes', empresaId] as const,
};

export interface FacturaPendiente {
  compra_id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  numero_factura: string;
  fecha: string;
  moneda: string;
  tipo_cambio_tasa: number | null;
  total: number;
  saldo_pendiente: number;
  fecha_vencimiento_estimada: string | null;
}

export interface SeleccionPago {
  compra_id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  monto: number;
}

export interface ResultadoRun {
  proveedor_id: string;
  proveedor_nombre: string;
  ok: boolean;
  monto?: number;
  ccp_id?: string;
  asiento_generado?: boolean;
  error?: string;
}

/**
 * Trae TODAS las compras con saldo pendiente de la empresa (todos los proveedores),
 * a diferencia de fetchFacturasAbiertas en ProveedoresSection.jsx que filtra por un
 * proveedor puntual — es la misma vista (compras_saldo_pendiente, mig.169) sin el
 * filtro. Mismo patrón de 2 pasos (vista + join client-side a compras/proveedores,
 * porque la vista no trae numero_factura/fecha/nombre) que ya usa ese componente.
 */
export async function getFacturasPendientes(empresaId: string): Promise<FacturaPendiente[]> {
  const { data: saldos, error } = await supabase
    .from('compras_saldo_pendiente')
    .select('compra_id, proveedor_id, total, saldo_pendiente, moneda, tipo_cambio_tasa')
    .eq('empresa_id', empresaId)
    .gt('saldo_pendiente', 0);
  if (error) throw new Error(error.message);
  if (!saldos || saldos.length === 0) return [];

  const compraIds = saldos.map(s => s.compra_id);
  const proveedorIds = [...new Set(saldos.map(s => s.proveedor_id))];

  const [{ data: compras, error: errCompras }, { data: proveedores, error: errProv }] = await Promise.all([
    supabase.from('compras').select('id, numero_factura, fecha').in('id', compraIds),
    supabase.from('proveedores').select('id, nombre, plazo_pago_dias').in('id', proveedorIds),
  ]);
  if (errCompras) throw new Error(errCompras.message);
  if (errProv) throw new Error(errProv.message);

  const comprasPorId = Object.fromEntries((compras || []).map(c => [c.id, c]));
  const proveedoresPorId = Object.fromEntries((proveedores || []).map(p => [p.id, p]));

  return saldos.map(s => {
    const compra = comprasPorId[s.compra_id];
    const proveedor = proveedoresPorId[s.proveedor_id];
    const fechaVencimiento = compra?.fecha && proveedor?.plazo_pago_dias != null
      ? addDaysAR(compra.fecha, proveedor.plazo_pago_dias)
      : null;
    return {
      compra_id: s.compra_id,
      proveedor_id: s.proveedor_id,
      proveedor_nombre: proveedor?.nombre || 'Proveedor',
      numero_factura: compra?.numero_factura || 'S/N',
      fecha: compra?.fecha,
      moneda: s.moneda,
      tipo_cambio_tasa: s.tipo_cambio_tasa,
      total: Number(s.total),
      saldo_pendiente: Number(s.saldo_pendiente),
      fecha_vencimiento_estimada: fechaVencimiento,
    };
  }).sort((a, b) => {
    const fa = a.fecha_vencimiento_estimada || a.fecha || '';
    const fb = b.fecha_vencimiento_estimada || b.fecha || '';
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });
}

/**
 * Payment Run liviano: agrupa la selección (que puede abarcar varios proveedores)
 * y llama registrar_pago_proveedor UNA VEZ POR PROVEEDOR — reutiliza el mismo RPC
 * atómico que ya usa el pago individual (imputación por factura, asiento, forma de
 * pago), no se duplica su lógica. Cada llamada es independiente: si el pago a un
 * proveedor falla (ej. período contable cerrado), se sigue con los demás y se
 * reporta el resultado por proveedor — mismo criterio que un Payment Run de SAP,
 * donde cada documento de pago por proveedor es su propia unidad y una excepción
 * en uno no aborta el lote completo.
 */
export async function ejecutarPaymentRun({
  empresaId,
  userId,
  cajaSesionId,
  seleccion,
  metodo,
  formaPagoId,
  descripcion,
}: {
  empresaId: string;
  userId: string;
  cajaSesionId: string | null;
  seleccion: SeleccionPago[];
  metodo: string;
  formaPagoId: string | null;
  descripcion?: string;
}): Promise<ResultadoRun[]> {
  const porProveedor = new Map<string, SeleccionPago[]>();
  for (const item of seleccion) {
    const arr = porProveedor.get(item.proveedor_id) ?? [];
    arr.push(item);
    porProveedor.set(item.proveedor_id, arr);
  }

  const resultados: ResultadoRun[] = [];
  for (const [proveedorId, items] of porProveedor) {
    const proveedorNombre = items[0]?.proveedor_nombre || 'Proveedor';
    const monto = items.reduce((s, i) => s + i.monto, 0);
    try {
      const data = await proveedoresService.registrarPago(
        empresaId,
        proveedorId,
        proveedorNombre,
        monto,
        metodo,
        descripcion || `Pago en lote a ${proveedorNombre}`,
        userId,
        cajaSesionId,
        items.map(i => ({ compra_id: i.compra_id, monto: i.monto })),
        formaPagoId,
      );
      resultados.push({
        proveedor_id: proveedorId,
        proveedor_nombre: proveedorNombre,
        ok: true,
        monto,
        ccp_id: data.ccp_id,
        asiento_generado: data.asiento_generado,
      });
    } catch (e: any) {
      resultados.push({
        proveedor_id: proveedorId,
        proveedor_nombre: proveedorNombre,
        ok: false,
        monto,
        error: e.message,
      });
    }
  }
  return resultados;
}

export const paymentRunService = { getFacturasPendientes, ejecutarPaymentRun };
