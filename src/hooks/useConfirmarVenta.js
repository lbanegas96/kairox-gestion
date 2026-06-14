import { useState, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useToast } from '@/components/ui/use-toast';
import { getNowAR, getTodayAR } from '@/lib/dateUtils';
import { asientosAutoService } from '@/services/planCuentasService';

// Hook compartido entre NuevaVentaModal (en el futuro) y PanelCarrito.
// Encapsula la llamada a crear_venta RPC + asientos contables.
// Soporta modo ARS únicamente (para PanelCarrito del Modo Caja).
export function useConfirmarVenta() {
  const { user }                       = useAuth();
  const { isSessionOpen, currentSession } = useCaja();
  const { toast }                      = useToast();
  const [loading, setLoading]          = useState(false);
  const [lastComprobante, setLastComprobante] = useState(null);

  const generateVentaNumber = async () => {
    const todayStr = getTodayAR().replace(/-/g, '');
    const { data } = await supabase
      .from('comprobantes')
      .select('numero_venta')
      .eq('empresa_id', user.empresa_id)
      .ilike('numero_venta', `${todayStr}-%`)
      .order('numero_venta', { ascending: false })
      .limit(1);
    let seq = 1;
    if (data?.length > 0) seq = parseInt(data[0].numero_venta.split('-')[1]) + 1;
    return `${todayStr}-${String(seq).padStart(3, '0')}`;
  };

  // pagos: Array<{ metodo: string, monto: number }>
  // selectedClient: null | { id, nombre }
  const confirmar = useCallback(async ({ cart, selectedClient, pagos }) => {
    if (!cart?.length) {
      toast({ title: 'Carrito vacío', variant: 'destructive' });
      return null;
    }

    const isCC = pagos.length === 1 && pagos[0].metodo === 'Cuenta Corriente';
    if (isCC && !selectedClient) {
      toast({ title: 'Cliente requerido para Cuenta Corriente', variant: 'destructive' });
      return null;
    }

    const incluyeEfectivo = pagos.some(p => p.metodo === 'Efectivo' && p.monto > 0);
    if (!isSessionOpen && incluyeEfectivo) {
      toast({
        title: 'Caja cerrada',
        description: 'Abrí la caja para cobrar en efectivo. Podés usar Transferencia, Tarjeta o CC sin abrir caja.',
        variant: 'destructive',
      });
      return null;
    }

    const total = cart.reduce((sum, item) => sum + item.precio_venta * item.cantidad, 0);

    setLoading(true);
    try {
      const saleNumber  = await generateVentaNumber();
      const now         = getNowAR().toISOString();
      const formaPago   = pagos.length > 1
        ? pagos.map(p => p.metodo).join(' + ')
        : pagos[0].metodo;

      const itemsPayload = cart.map(item => ({
        producto_id:     item.id,
        cantidad:        item.cantidad,
        precio_unitario: item.precio_venta,
        subtotal:        item.precio_venta * item.cantidad,
        alicuota_iva:    item.alicuota_iva ?? '21',
      }));

      const pagosPayload = pagos.map(p => ({
        metodo:         p.metodo,
        monto:          p.monto,
        monto_paralelo: '',
        tc_paralelo:    '',
      }));

      const { data: rpcResult, error: rpcError } = await supabase.rpc('crear_venta', {
        p_empresa_id:       user.empresa_id,
        p_user_id:          user.id,
        p_numero_venta:     saleNumber,
        p_fecha:            now,
        p_cliente_id:       selectedClient?.id   ?? null,
        p_cliente_nombre:   selectedClient?.nombre ?? 'Consumidor Final',
        p_total:            total,
        p_forma_pago:       formaPago,
        p_estado_pago:      isCC ? 'pendiente' : 'pagada',
        p_moneda:           'ARS',
        p_tipo_cambio_tasa: 1,
        p_monto_paralelo:   null,
        p_tc_paralelo:      null,
        p_items:            itemsPayload,
        p_pagos:            pagosPayload,
        p_es_cc:            isCC,
        p_caja_sesion_id:   currentSession?.id ?? null,
      });

      if (rpcError) throw rpcError;

      const comprobante = {
        id:              rpcResult.comprobante_id,
        numero_venta:    rpcResult.numero_venta,
        fecha:           now,
        total,
        moneda:          'ARS',
        tipo_cambio_tasa: 1,
        forma_pago:      formaPago,
        cliente_nombre:  selectedClient?.nombre ?? 'Consumidor Final',
      };

      asientosAutoService.crearAsientoVenta(user.empresa_id, user.id, {
        ventaId:     comprobante.id,
        total,
        fecha:       getTodayAR(),
        descripcion: `Venta #${saleNumber}`,
        esCredito:   isCC,
      }).catch(e => console.warn('[Contabilidad] asiento venta:', e.message));

      toast({ title: '¡Venta Exitosa!', description: `Comprobante ${saleNumber} generado.` });
      setLastComprobante(comprobante);
      return comprobante;
    } catch (err) {
      console.error('[useConfirmarVenta]', err);
      toast({ title: 'Error al procesar la venta', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [user, isSessionOpen, currentSession, toast]);

  return { confirmar, loading, lastComprobante };
}
