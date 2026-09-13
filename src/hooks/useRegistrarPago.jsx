import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useToast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { proveedoresService } from '@/services/proveedoresService';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { getEmpresaParaPDF } from '@/lib/empresaUtils';
import { imprimirReciboPago } from '@/lib/imprimirRecibo';

// Espejo de useRegistrarCobro.jsx (lado Ventas) para que "Registrar Pago"
// pueda abrirse también desde el detalle de una Factura de Proveedor
// (ModalDetalleFacturaCompra) sin saltar a Proveedores → Cuenta Corriente
// (hallazgo Luciano 12/09: "tampoco veo lo importante, como registrar el
// pago al proveedor de esa factura"). Extraído de ProveedoresSection.jsx,
// que hasta ahora tenía esta misma lógica (facturasAbiertas/imputaciones/
// pagoMutation) inline y sin forma de abrirse desde otro lado. Cada pantalla
// monta su propio <ModalRegistrarPago> con lo que este hook expone, mismo
// criterio que el lado Ventas.
export function useRegistrarPago(onSuccess) {
  const { user } = useAuth();
  const { isSessionOpen, currentSession } = useCaja();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedProveedor, setSelectedProveedor] = useState(null);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [paymentData, setPaymentData] = useState({
    monto: '', metodo: 'Efectivo', forma_pago_id: '', descripcion: '', referencia_pago: '',
  });
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [facturasAbiertas, setFacturasAbiertas] = useState([]);
  const [imputaciones, setImputaciones] = useState({});     // { compra_id: "monto string" }
  const [imputacionesFX, setImputacionesFX] = useState({}); // { compra_id: "monto FX string" }

  const { data: formasPago = [] } = useQuery({
    queryKey: ['formas_pago', user?.empresa_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('formas_pago')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.empresa_id,
  });

  const { data: empresaData = {} } = useQuery({
    queryKey: ['empresa_datos_recibo', user?.empresa_id],
    queryFn: () => getEmpresaParaPDF(user.empresa_id),
    enabled: !!user?.empresa_id,
  });

  const invalidateNotifs = () => qc.invalidateQueries({ queryKey: ['notif'] });

  // Mismo query que el fetchFacturasAbiertas que tenía ProveedoresSection,
  // con el agregado de "preseleccionarFacturaId" para el deep-link desde una
  // Factura puntual — mismo criterio que fetchFacturasAbiertas del lado Ventas.
  const fetchFacturasAbiertas = useCallback(async (proveedorId, preseleccionarFacturaId = null) => {
    const { data, error } = await supabase
      .from('compras_saldo_pendiente')
      .select('compra_id, total, saldo_pendiente, moneda, tipo_cambio_tasa')
      .eq('proveedor_id', proveedorId)
      .gt('saldo_pendiente', 0)
      .order('compra_id');
    if (error) {
      console.error('[compras_saldo_pendiente]', error.message);
      return;
    }
    const ids = (data || []).map(f => f.compra_id);
    let numerosPorId = {};
    if (ids.length > 0) {
      const { data: compras } = await supabase.from('compras').select('id, numero_factura, fecha').in('id', ids);
      numerosPorId = Object.fromEntries((compras || []).map(c => [c.id, c]));
    }
    const facturas = (data || []).map(f => ({
      ...f,
      numero_factura: numerosPorId[f.compra_id]?.numero_factura || 'S/N',
      fecha: numerosPorId[f.compra_id]?.fecha,
    }));
    setFacturasAbiertas(facturas);

    // Deep-link "Registrar Pago" desde una factura puntual: tilda esa
    // factura y precarga el Monto a Pagar con su saldo completo.
    if (preseleccionarFacturaId) {
      const match = facturas.find(f => f.compra_id === preseleccionarFacturaId);
      if (match) {
        const saldoStr = String(match.saldo_pendiente);
        if (match.moneda && match.moneda !== 'ARS') {
          setImputacionesFX({ [match.compra_id]: saldoStr });
        } else {
          setImputaciones({ [match.compra_id]: saldoStr });
          setPaymentData(prev => ({ ...prev, monto: saldoStr }));
        }
      }
    }
  }, []);

  const openPaymentDialog = useCallback((proveedor, facturaId = null) => {
    const efectivo = formasPago.find(f => f.tipo_instrumento === 'efectivo');
    setPaymentData({ monto: '', metodo: efectivo?.nombre ?? 'Efectivo', forma_pago_id: efectivo?.id ?? '', descripcion: '', referencia_pago: '' });
    setImputaciones({});
    setImputacionesFX({});
    setFacturasAbiertas([]);
    setSelectedProveedor(proveedor);
    setIsPaymentDialogOpen(true);
    fetchFacturasAbiertas(proveedor.id, facturaId);
  }, [formasPago, fetchFacturasAbiertas]);

  // Llamador que solo tiene el id del proveedor (ej. el detalle de una
  // Factura de Compra) — trae nombre + saldo real fresco. proveedores no
  // tiene columna saldo_actual (a diferencia de clientes): se deriva con
  // getSaldoProveedor, mismo criterio que ya usa ProveedoresSection.
  const abrirPagoPorProveedorId = useCallback(async (proveedorId, facturaId = null) => {
    const [{ data: proveedor, error }, saldo] = await Promise.all([
      supabase.from('proveedores').select('id, nombre').eq('id', proveedorId).single(),
      proveedoresService.getSaldoProveedor(proveedorId, user.empresa_id),
    ]);
    if (error || !proveedor) {
      toast({ title: 'No se pudo abrir el pago', description: error?.message, variant: 'destructive' });
      return;
    }
    openPaymentDialog({ ...proveedor, saldo_actual: saldo }, facturaId);
  }, [openPaymentDialog, toast, user?.empresa_id]);

  const autoDistribuirFIFO = useCallback((monto) => {
    let restante = monto;
    const nuevo = {};
    for (const f of facturasAbiertas) {
      if (f.moneda && f.moneda !== 'ARS') continue;
      if (restante <= 0) break;
      const aplicar = Math.min(restante, f.saldo_pendiente);
      if (aplicar > 0) {
        nuevo[f.compra_id] = String(aplicar);
        restante -= aplicar;
      }
    }
    setImputaciones(nuevo);
  }, [facturasAbiertas]);

  const handleRegenerarAsientoCxp = async (movimientoId) => {
    const { error } = await supabase.rpc('regenerar_asiento_cxp', {
      p_movimiento_id: movimientoId,
      p_user_id: user.id,
    });
    if (error) {
      toast({ title: 'No se pudo regenerar el asiento', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Asiento regenerado', className: 'bg-emerald-600 text-white border-none' });
    qc.invalidateQueries();
  };

  const handleRegisterPayment = async () => {
    // Solo Efectivo requiere caja abierta — mismo criterio que Cobro/Compra Rápida.
    if (paymentData.metodo === 'Efectivo' && !isSessionOpen) {
      toast({
        variant: 'destructive',
        title: 'Caja cerrada',
        description: 'Abrí la caja antes de registrar pagos en efectivo.',
      });
      return;
    }

    if (!selectedProveedor) return;

    const amount = parseNumberLocale(paymentData.monto);
    if (!amount || isNaN(amount) || amount <= 0) {
      toast({ title: 'Error', description: 'Ingresá un monto válido mayor a 0', variant: 'destructive' });
      return;
    }

    setIsProcessingPayment(true);

    const imputacionesArray = facturasAbiertas
      .map(f => {
        if (f.moneda && f.moneda !== 'ARS') {
          const fx = parseNumberLocale(imputacionesFX[f.compra_id] || '');
          return fx > 0 ? { compra_id: f.compra_id, monto_moneda_extranjera: fx } : null;
        }
        const monto = parseNumberLocale(imputaciones[f.compra_id] || '');
        return monto > 0 ? { compra_id: f.compra_id, monto } : null;
      })
      .filter(Boolean);

    const imputacionesDetalle = imputacionesArray.map(imp => {
      const f = facturasAbiertas.find(x => x.compra_id === imp.compra_id);
      const montoImp = imp.monto ?? (imp.monto_moneda_extranjera != null ? imp.monto_moneda_extranjera * (f?.tipo_cambio_tasa || 1) : 0);
      return { numero: f?.numero_factura || '—', monto: montoImp };
    });

    try {
      const data = await proveedoresService.registrarPago(
        user.empresa_id,
        selectedProveedor.id,
        selectedProveedor.nombre,
        amount,
        paymentData.metodo,
        paymentData.descripcion || `Pago a ${selectedProveedor.nombre}`,
        user.id,
        currentSession?.id ?? null,
        imputacionesArray.length > 0 ? imputacionesArray : null,
        paymentData.forma_pago_id || null,
        paymentData.referencia_pago || null,
      );

      const saldoAnterior = selectedProveedor.saldo_actual || 0;
      const reciboData = {
        tipo: 'pago',
        movimientoId: data?.ccp_id,
        fecha: new Date().toISOString(),
        contraparteNombre: selectedProveedor.nombre,
        monto: amount,
        metodo: paymentData.metodo,
        referenciaPago: paymentData.referencia_pago || null,
        nota: paymentData.descripcion || null,
        imputaciones: imputacionesDetalle,
        saldoAnteriorTotal: saldoAnterior,
        saldoNuevoTotal: saldoAnterior - amount,
        empresa: empresaData,
      };

      toast({
        title: 'Pago Registrado',
        description: `Se registró el pago de $${amount.toLocaleString('es-AR')}.`,
        className: 'bg-emerald-600 text-white border-none',
        action: (
          <ToastAction
            altText="Descargar comprobante en PDF"
            onClick={() => imprimirReciboPago(reciboData).catch(error => {
              console.error('[useRegistrarPago] Error al generar PDF:', error);
              toast({ title: 'Error al generar el comprobante', description: error.message, variant: 'destructive' });
            })}
          >
            Descargar PDF
          </ToastAction>
        ),
      });

      // El RPC genera el asiento en la misma transacción, no bloqueante: si
      // falla (período cerrado o cuenta faltante), el pago igual se registra.
      if (data?.asiento_generado === false) {
        toast({
          title: 'Pago registrado sin asiento contable',
          description: 'El pago se guardó correctamente, pero no se generó el asiento (período cerrado o cuenta contable faltante). Revisar Plan de Cuentas.',
          variant: 'destructive',
          action: (
            <ToastAction altText="Regenerar asiento" onClick={() => handleRegenerarAsientoCxp(data.ccp_id)}>
              Regenerar
            </ToastAction>
          ),
        });
      }

      setIsPaymentDialogOpen(false);
      invalidateNotifs();
      setSelectedProveedor(prev => prev ? { ...prev, saldo_actual: (prev.saldo_actual || 0) - amount } : prev);
      onSuccess?.(data);
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessingPayment(false);
    }
  };

  return {
    selectedProveedor, setSelectedProveedor,
    isPaymentDialogOpen, setIsPaymentDialogOpen,
    paymentData, setPaymentData,
    formasPago,
    isProcessingPayment,
    facturasAbiertas,
    imputaciones, setImputaciones,
    imputacionesFX, setImputacionesFX,
    autoDistribuirFIFO,
    handleRegisterPayment,
    openPaymentDialog,
    abrirPagoPorProveedorId,
  };
}
