import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useToast } from '@/components/ui/use-toast';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { tipoCambioService } from '@/services/tipoCambioService';
import { asientosAutoService } from '@/services/planCuentasService';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { getNowAR } from '@/lib/dateUtils';

// Extraído de CuentaCorrienteSection (29/08) para que "Registrar Cobro" pueda
// abrirse también desde el detalle de una Factura (SaleDetailModal) sin saltar
// de módulo — antes eso navegaba a Cuenta Corriente vía Dashboard.navigateTo,
// cerrando la factura que el usuario estaba mirando (hallazgo Luciano 29/08:
// "debería mostrarme el pago realizado y salir con escape pero permanecer en
// la factura"). Toda la lógica de imputación por factura, moneda paralela y
// generación de asiento vive acá una sola vez; cada pantalla monta su propio
// <ModalCobro>/<ModalDetalleCobro>/<TipoCambioModal> con lo que este hook
// expone y define su propio `onSuccess` para refrescar lo que le corresponda.
//
// Segunda vuelta (29/08, mismo pedido): "quiero lo mismo con el pago" que
// con la Factura — al confirmar, ModalCobro se cierra y se abre
// ModalDetalleCobro (Comprobante de Pago) con el cobro recién creado, mismo
// criterio que NuevaFacturaModal (form → vista "creada" en el mismo lugar,
// no se pierde el contexto). Reabrir ese mismo cobro más tarde (Mapa de
// Relaciones, chip del Flujo del documento) llama a abrirDetalleCobro, que
// monta el MISMO modal en modo lectura/cancelación — nunca se edita en el
// lugar, "corregir un error" es cancelar_cobro_cliente (mig.367, documento
// de reversa) y volver a cargarlo bien, mismo criterio que Factura/NC/ND.
export function useRegistrarCobro(onSuccess) {
  const { user } = useAuth();
  const { isSessionOpen, currentSession } = useCaja();
  const { toast } = useToast();
  const qc = useQueryClient();
  const tcParalelo = useTCParalelo();

  const [selectedClient, setSelectedClient] = useState(null);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [paymentData, setPaymentData] = useState({
    monto: '', metodo: 'Efectivo', forma_pago_id: '', nota: '', referencia_pago: '',
  });
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [facturasAbiertas, setFacturasAbiertas] = useState([]);
  const [imputaciones, setImputaciones] = useState({});
  const [imputacionesFX, setImputacionesFX] = useState({});
  const [showParaleloTCModal, setShowParaleloTCModal] = useState(false);

  // "Comprobante de Pago" — el mismo ModalDetalleCobro sirve para la vista
  // recién-creada y para reabrir un cobro viejo (ver comentario de arriba).
  const [detalleCobroId, setDetalleCobroId] = useState(null);
  const [detalleCobroOpen, setDetalleCobroOpen] = useState(false);

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

  const invalidateNotifs = () => qc.invalidateQueries({ queryKey: ['notif'] });

  const fetchFacturasAbiertas = useCallback(async (clienteId, preseleccionarFacturaId = null) => {
    const { data, error } = await supabase
      .from('facturas_saldo_pendiente')
      .select('comprobante_id, numero_venta, fecha, saldo_pendiente, moneda, tipo_cambio_tasa')
      .eq('empresa_id', user.empresa_id)
      .eq('cliente_id', clienteId)
      .gt('saldo_pendiente', 0)
      .order('fecha', { ascending: true });
    if (error) {
      console.error('[facturas_saldo_pendiente]', error.message);
      return;
    }
    let facturas = data || [];

    // Para facturas en moneda extranjera, traer el TC de hoy (una consulta por
    // moneda distinta) para mostrar el equivalente ARS y validar el clearing.
    const monedasExtranjeras = [...new Set(facturas.filter(f => f.moneda && f.moneda !== 'ARS').map(f => f.moneda))];
    if (monedasExtranjeras.length > 0) {
      const tasas = {};
      await Promise.all(monedasExtranjeras.map(async (m) => {
        try {
          tasas[m] = await tipoCambioService.getToday(user.empresa_id, m);
        } catch {
          tasas[m] = null;
        }
      }));
      facturas = facturas.map(f => (f.moneda && f.moneda !== 'ARS') ? { ...f, tc_hoy: tasas[f.moneda] } : f);
    }

    setFacturasAbiertas(facturas);

    // Deep-link "Registrar Cobro" desde una factura puntual: la marca tildada
    // y precarga el Monto a Cobrar con su saldo completo.
    if (preseleccionarFacturaId) {
      const match = facturas.find(f => f.comprobante_id === preseleccionarFacturaId);
      if (match) {
        const saldoStr = String(match.saldo_pendiente);
        if (match.moneda && match.moneda !== 'ARS') {
          const tc = match.tc_hoy || match.tipo_cambio_tasa || 0;
          setImputacionesFX({ [match.comprobante_id]: saldoStr });
          setPaymentData(prev => ({ ...prev, monto: tc > 0 ? String(match.saldo_pendiente * tc) : '' }));
        } else {
          setImputaciones({ [match.comprobante_id]: saldoStr });
          setPaymentData(prev => ({ ...prev, monto: saldoStr }));
        }
      }
    }
  }, [user?.empresa_id]);

  const openPaymentDialog = useCallback((client, e, facturaId = null) => {
    e?.stopPropagation?.();
    setSelectedClient(client);
    const efectivo = formasPago.find(f => f.tipo_instrumento === 'efectivo');
    setPaymentData({ monto: '', metodo: efectivo?.nombre ?? 'Efectivo', forma_pago_id: efectivo?.id ?? '', nota: '', referencia_pago: '' });
    setImputaciones({});
    setImputacionesFX({});
    setFacturasAbiertas([]);
    setIsPaymentDialogOpen(true);
    fetchFacturasAbiertas(client.id, facturaId);
  }, [formasPago, fetchFacturasAbiertas]);

  // Igual que openPaymentDialog, pero para llamadores que solo tienen el id
  // del cliente (ej. el detalle de una Factura) — trae el saldo_actual fresco
  // en vez de confiar en un objeto client potencialmente desactualizado.
  const abrirCobroPorClienteId = useCallback(async (clienteId, facturaId = null) => {
    const { data: cliente, error } = await supabase.from('clientes').select('*').eq('id', clienteId).single();
    if (error || !cliente) {
      toast({ title: 'No se pudo abrir el cobro', description: error?.message, variant: 'destructive' });
      return;
    }
    openPaymentDialog(cliente, null, facturaId);
  }, [openPaymentDialog, toast]);

  // Reabre un cobro YA existente (Mapa de Relaciones / chip del Flujo del
  // documento) — el mismo ModalDetalleCobro que se usa recién-creado, ahora
  // en modo lectura/cancelación.
  const abrirDetalleCobro = useCallback((movimientoId) => {
    setDetalleCobroId(movimientoId);
    setDetalleCobroOpen(true);
  }, []);

  const autoDistribuirFIFO = useCallback((monto) => {
    let restante = monto;
    const nuevo = {};
    for (const f of facturasAbiertas) {
      if (f.moneda && f.moneda !== 'ARS') continue;
      if (restante <= 0) break;
      const aplicar = Math.min(restante, f.saldo_pendiente);
      if (aplicar > 0) {
        nuevo[f.comprobante_id] = String(aplicar);
        restante -= aplicar;
      }
    }
    setImputaciones(nuevo);
  }, [facturasAbiertas]);

  const handleRegenerarAsientoCxc = async (movimientoId) => {
    const { error } = await supabase.rpc('regenerar_asiento_cxc', {
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
    // Solo Efectivo requiere caja abierta — Transferencia/Tarjeta/Cheque no
    if (paymentData.metodo === 'Efectivo' && !isSessionOpen) {
      toast({
        variant: 'destructive',
        title: 'Caja cerrada',
        description: 'Abrí la caja antes de registrar cobros en efectivo.',
      });
      return;
    }

    if (!selectedClient) return;

    const amount = parseNumberLocale(paymentData.monto);
    if (!amount || isNaN(amount) || amount <= 0) {
      toast({ title: "Error", description: "Ingrese un monto válido mayor a 0", variant: "destructive" });
      return;
    }

    if (tcParalelo.enabled && tcParalelo.tcMissing) {
      toast({
        variant: 'destructive',
        title: `Falta el TC de paridad ${tcParalelo.monedaParalela}`,
        description: `La empresa usa moneda paralela. Cargá el TC de ${tcParalelo.monedaParalela} para poder registrar el cobro.`,
      });
      setShowParaleloTCModal(true);
      return;
    }

    setIsProcessingPayment(true);
    const date = getNowAR().toISOString();
    const pagoParalelo = tcParalelo.enabled && tcParalelo.tcHoy
      ? tcParalelo.calcParalelo(amount, 'ARS', 1)
      : null;

    const imputacionesArray = facturasAbiertas
      .map(f => {
        if (f.moneda && f.moneda !== 'ARS') {
          const fx = parseNumberLocale(imputacionesFX[f.comprobante_id] || '');
          return fx > 0 ? { comprobante_id: f.comprobante_id, monto_moneda_extranjera: fx } : null;
        }
        const monto = parseNumberLocale(imputaciones[f.comprobante_id] || '');
        return monto > 0 ? { comprobante_id: f.comprobante_id, monto } : null;
      })
      .filter(Boolean);

    try {
      const { data: cobroData, error: cobroError } = await supabase.rpc('registrar_cobro_cliente', {
        p_empresa_id:     user.empresa_id,
        p_user_id:        user.id,
        p_cliente_id:     selectedClient.id,
        p_cliente_nombre: selectedClient.nombre,
        p_monto:          amount,
        p_metodo:         paymentData.metodo,
        p_fecha:          date,
        p_descripcion:    paymentData.nota ? `Pago: ${paymentData.nota}` : 'Pago de deuda',
        p_caja_sesion_id: currentSession?.id ?? null,
        p_monto_paralelo: pagoParalelo,
        p_tc_paralelo:    pagoParalelo !== null ? tcParalelo.tcHoy : null,
        p_imputaciones:   imputacionesArray.length > 0 ? imputacionesArray : null,
        p_forma_pago_id:  paymentData.forma_pago_id || null,
        p_referencia_pago: paymentData.referencia_pago || null,
      });

      if (cobroError) throw cobroError;

      toast({
        title: "Pago Registrado",
        description: `Se registró el cobro de $${amount.toLocaleString('es-AR')}.`,
        className: "bg-emerald-600 text-white border-none",
      });

      if (cobroData?.asiento_generado === false) {
        toast({
          title: "Cobro registrado sin asiento contable",
          description: "El cobro se guardó correctamente, pero no se generó el asiento (período cerrado o cuenta contable faltante). Revisar Plan de Cuentas.",
          variant: "destructive",
          action: (
            <button
              type="button"
              onClick={() => handleRegenerarAsientoCxc(cobroData.cc_id)}
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium hover:bg-secondary"
            >
              Regenerar
            </button>
          ),
        });
      }

      // Cierra el form y abre el mismo comprobante recién creado — mismo
      // criterio que NuevaFacturaModal (form → vista "creada" en el mismo
      // lugar). Escape lo cierra; reabrirlo desde el Mapa de Relaciones
      // llama a abrirDetalleCobro con el mismo cc_id.
      setIsPaymentDialogOpen(false);
      invalidateNotifs();
      setSelectedClient(prev => prev ? { ...prev, saldo_actual: (prev.saldo_actual || 0) - amount } : prev);
      onSuccess?.(cobroData);
      if (cobroData?.cc_id) abrirDetalleCobro(cobroData.cc_id);

    } catch (error) {
      console.error("Error registering payment:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // Cancela un cobro existente (RPC cancelar_cobro_cliente, mig.367) — nunca
  // se edita en el lugar: si el usuario cometió un error al cargarlo, esto
  // es la vía para corregirlo (documento de reversa + volver a cargarlo
  // bien), mismo criterio que cancelar_factura/NC/ND.
  const handleCancelarCobro = useCallback(async (movimientoId, motivo) => {
    const { error } = await supabase.rpc('cancelar_cobro_cliente', {
      p_empresa_id: user.empresa_id,
      p_user_id: user.id,
      p_movimiento_id: movimientoId,
      p_motivo: motivo || null,
    });
    if (error) {
      toast({ title: 'No se pudo cancelar el cobro', description: error.message, variant: 'destructive' });
      throw error;
    }

    asientosAutoService.crearAsientoReversaCobro(user.empresa_id, user.id, {
      movimientoId,
      fecha: getNowAR().toISOString().slice(0, 10),
    }).catch(e => console.warn('[Contabilidad] reversa cobro:', e.message));

    toast({ title: 'Cobro cancelado', description: 'Se revirtió el ingreso en caja y la deuda vuelve a estar abierta.', className: 'bg-emerald-600 text-white border-none' });
    invalidateNotifs();
    onSuccess?.();
  }, [user, toast, onSuccess]);

  return {
    selectedClient, setSelectedClient,
    isPaymentDialogOpen, setIsPaymentDialogOpen,
    paymentData, setPaymentData,
    formasPago,
    tcParalelo,
    isProcessingPayment,
    facturasAbiertas,
    imputaciones, setImputaciones,
    imputacionesFX, setImputacionesFX,
    autoDistribuirFIFO,
    handleRegisterPayment,
    openPaymentDialog,
    abrirCobroPorClienteId,
    showParaleloTCModal, setShowParaleloTCModal,
    detalleCobroId, detalleCobroOpen, setDetalleCobroOpen,
    abrirDetalleCobro,
    handleCancelarCobro,
  };
}
