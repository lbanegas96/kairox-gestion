import { supabase } from '@/lib/customSupabaseClient';
import { formatNumeroComprobante } from '@/lib/numeroComprobante';

export type DocFlowTipo =
  | 'cotizacion'
  | 'pedido'
  | 'entrega'
  | 'venta'
  | 'nota_credito'
  | 'cobro_cc'
  | 'devolucion';

export interface DocFlowNode {
  id: string;
  tipo: DocFlowTipo;
  numero: string;
  fecha: string;
  monto: number;
  estado?: string;
  descripcion?: string;
  // Para navegación
  seccion: string;
}

export interface DocumentFlow {
  origen: DocFlowNode | null;     // cotizacion o pedido que dio origen a la venta
  entregas: DocFlowNode[];        // entregas vinculadas a este comprobante (evento físico, Regla 8)
  actual: DocFlowNode;             // el comprobante actual
  notas_credito: DocFlowNode[];    // NC emitidas contra este comprobante
  cobros_cc: DocFlowNode[];        // cobros CC que refieren este comprobante
  fuente_nc: DocFlowNode | null;   // si el actual es una NC, muestra la venta original
  devoluciones: DocFlowNode[];     // devoluciones de cliente contra este comprobante
}

export const documentFlowService = {
  async getFlowForComprobante(comprobanteId: string): Promise<DocumentFlow | null> {
    // 1. Obtener el comprobante actual con sus links
    const { data: comp, error } = await supabase
      .from('comprobantes')
      .select('id, numero_venta, numero_afip, tipo_comprobante_afip, fecha, total, forma_pago, tipo, estado_pago, cotizacion_id, pedido_id, comprobante_origen_id')
      .eq('id', comprobanteId)
      .single();
    if (error || !comp) return null;

    const actual: DocFlowNode = {
      id: comp.id,
      tipo: comp.tipo === 'nota_credito' ? 'nota_credito' : 'venta',
      // Número fiscal (letra + folio) cuando ya tiene CAE — mismo criterio
      // que FacturaPDF/ReporteLibroIVA (item 7, hallazgo Luciano 22/08).
      numero: formatNumeroComprobante(comp),
      fecha: comp.fecha,
      monto: Number(comp.total),
      estado: comp.estado_pago,
      seccion: 'ventas',
    };

    // 2. Origen: cotización
    let origen: DocFlowNode | null = null;
    if (comp.cotizacion_id) {
      const { data: cot } = await supabase
        .from('cotizaciones')
        .select('id, numero, fecha, total, estado')
        .eq('id', comp.cotizacion_id)
        .single();
      if (cot) {
        origen = {
          id: cot.id,
          tipo: 'cotizacion',
          numero: cot.numero,
          fecha: cot.fecha,
          monto: Number(cot.total),
          estado: cot.estado,
          seccion: 'cotizaciones',
        };
      }
    }
    // Origen: pedido
    if (!origen && comp.pedido_id) {
      const { data: ped } = await supabase
        .from('pedidos')
        .select('id, numero, fecha, total, estado')
        .eq('id', comp.pedido_id)
        .single();
      if (ped) {
        origen = {
          id: ped.id,
          tipo: 'pedido',
          numero: ped.numero,
          fecha: ped.fecha,
          monto: Number(ped.total),
          estado: ped.estado,
          seccion: 'pedidos',
        };
      }
    }

    // 3. Si es NC, buscar la venta original
    let fuente_nc: DocFlowNode | null = null;
    if (comp.tipo === 'nota_credito' && comp.comprobante_origen_id) {
      const { data: orig } = await supabase
        .from('comprobantes')
        .select('id, numero_venta, numero_afip, tipo_comprobante_afip, fecha, total, estado_pago')
        .eq('id', comp.comprobante_origen_id)
        .single();
      if (orig) {
        fuente_nc = {
          id: orig.id,
          tipo: 'venta',
          numero: formatNumeroComprobante(orig),
          fecha: orig.fecha,
          monto: Number(orig.total),
          estado: orig.estado_pago,
          seccion: 'ventas',
        };
      }
    }

    // 4. NC emitidas contra este comprobante
    const { data: ncs } = await supabase
      .from('comprobantes')
      .select('id, numero_venta, numero_afip, tipo_comprobante_afip, fecha, total, estado_pago')
      .eq('comprobante_origen_id', comprobanteId)
      .eq('tipo', 'nota_credito');
    const notas_credito: DocFlowNode[] = (ncs ?? []).map((nc: any) => ({
      id: nc.id,
      tipo: 'nota_credito' as DocFlowTipo,
      numero: formatNumeroComprobante(nc),
      fecha: nc.fecha,
      monto: Number(nc.total),
      estado: nc.estado_pago,
      seccion: 'ventas',
    }));

    // 5. Cobros CC que referencian este comprobante
    const { data: cobros } = await supabase
      .from('cuenta_corriente_movimientos')
      .select('id, descripcion, fecha, monto, metodo_cobro')
      .eq('comprobante_id', comprobanteId)
      .eq('tipo', 'HABER');
    const cobros_cc: DocFlowNode[] = (cobros ?? []).map((c: any) => ({
      id: c.id,
      tipo: 'cobro_cc' as DocFlowTipo,
      numero: c.metodo_cobro ?? 'Cobro CC',
      fecha: c.fecha,
      monto: Number(c.monto),
      descripcion: c.descripcion,
      seccion: 'cuentacorriente',
    }));

    // 6. Entrega(s) vinculada(s) a este comprobante (item 7, hallazgo Luciano
    // 22/08: la cadena de Factura no mostraba el eslabón físico intermedio,
    // que sí aparece del lado de la Entrega — mismo dato, `entregas.comprobante_id`).
    const { data: ents } = await supabase
      .from('entregas')
      .select('id, numero_entrega, fecha')
      .eq('comprobante_id', comprobanteId);
    const entregas: DocFlowNode[] = (ents ?? []).map((e: any) => ({
      id: e.id,
      tipo: 'entrega' as DocFlowTipo,
      numero: e.numero_entrega,
      fecha: e.fecha,
      monto: 0,
      seccion: 'entregas',
    }));

    // 7. Devoluciones de cliente emitidas contra este comprobante
    const { data: devs } = await supabase
      .from('devoluciones')
      .select('id, numero_devolucion, fecha, compensacion, devolucion_items(subtotal)')
      .eq('comprobante_id', comprobanteId)
      .eq('tipo', 'cliente');
    const devoluciones: DocFlowNode[] = (devs ?? []).map((dev: any) => ({
      id: dev.id,
      tipo: 'devolucion' as DocFlowTipo,
      numero: dev.numero_devolucion,
      fecha: dev.fecha,
      monto: (dev.devolucion_items || []).reduce((s: number, i: any) => s + Number(i.subtotal || 0), 0),
      estado: dev.compensacion,
      seccion: 'devoluciones',
    }));

    return { origen, entregas, actual, notas_credito, cobros_cc, fuente_nc, devoluciones };
  },
};
