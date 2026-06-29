import { useState, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useToast } from '@/components/ui/use-toast';
import { getNowAR, getTodayAR } from '@/lib/dateUtils';
import { asientosAutoService } from '@/services/planCuentasService';
import { useAfipConfig } from '@/hooks/useAfipConfig';

// Hook compartido entre el POS (PanelCarrito) y cualquier flujo de venta ARS rápido.
// Encapsula crear_venta RPC + asiento contable + encolado de CAE (facturación
// electrónica). Soporta modo ARS únicamente (el POS del Modo Caja).
//
// Facturación electrónica (AFIP): si la empresa tiene usa_factura_electronica=true
// y un PdV activo, tras crear_venta se hace el UPDATE a cae_estado='pendiente' que
// dispara fn_queue_factura_arca (migration 087) → encola en facturas_pendientes_arca.
// El arca-worker (cron */5) es la ÚNICA fuente de verdad que llama a ARCA — nunca
// desde el frontend. La config se obtiene de useAfipConfig (compartido con
// NuevaVentaModal). El tipo de comprobante sale de determinarTipoComprobante
// (emisor=empresa.condicion_iva, receptor=cliente.condicion_iva ?? 'CF').
//
// La numeración usa obtener_proximo_numero('venta') (RPC atómica con lock) — nunca
// MAX+1 en el frontend (patrón inseguro que migration 083 erradicó del resto).
export function useConfirmarVenta() {
  const { user }                       = useAuth();
  const { isSessionOpen, currentSession } = useCaja();
  const { toast }                      = useToast();
  const { afipConfig, afipActivo, determinarTipoComprobante } = useAfipConfig();
  const [loading, setLoading]          = useState(false);
  const [lastComprobante, setLastComprobante] = useState(null);

  const generateVentaNumber = async () => {
    const { data, error } = await supabase.rpc('obtener_proximo_numero', {
      p_empresa_id: user.empresa_id,
      p_tipo_documento: 'venta',
    });
    if (error) throw error;
    return data;
  };

  // pagos: Array<{ metodo: string, monto: number }>
  // selectedClient: null | { id, nombre, condicion_iva? }  ← condicion_iva define A/B/C
  const confirmar = useCallback(async ({ cart, selectedClient, pagos, ofertasCarrito = {}, descuentosManuales = {} }) => {
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

    // OFERTAS — calcular total con descuentos aplicados
    const total = cart.reduce((sum, item) => {
      const oferta = ofertasCarrito[item.id];
      const descManual = descuentosManuales[item.id] || 0;
      let precio = item.precio_venta;
      if (oferta) {
        precio = oferta.precio_final;
        if (oferta.acumulable && descManual > 0) precio = precio * (1 - descManual / 100);
      } else if (descManual > 0) {
        precio = precio * (1 - descManual / 100);
      }
      return sum + Math.round(precio * 100) / 100 * item.cantidad;
    }, 0);

    setLoading(true);
    try {
      const saleNumber  = await generateVentaNumber();
      const now         = getNowAR().toISOString();
      const formaPago   = pagos.length > 1
        ? pagos.map(p => p.metodo).join(' + ')
        : pagos[0].metodo;

      // OFERTAS — itemsPayload con campos de descuento para crear_venta v2
      const itemsPayload = cart.map(item => {
        const oferta = ofertasCarrito[item.id];
        const descManualPct = descuentosManuales[item.id] || 0;
        const precioOriginal = item.precio_venta;
        let precioFinal = precioOriginal;
        let descuentoPct = 0;
        let descuentoMonto = 0;
        let ofertaId = null;

        if (oferta) {
          precioFinal = oferta.precio_final;
          descuentoPct = oferta.valor_descuento;
          descuentoMonto = oferta.descuento_monto;
          ofertaId = oferta.oferta_id;
          if (oferta.acumulable && descManualPct > 0) {
            precioFinal = precioFinal * (1 - descManualPct / 100);
          }
        } else if (descManualPct > 0) {
          precioFinal = precioOriginal * (1 - descManualPct / 100);
        }

        precioFinal = Math.round(precioFinal * 100) / 100;

        return {
          producto_id:          item.id,
          cantidad:             item.cantidad,
          precio_unitario:      precioFinal,
          subtotal:             precioFinal * item.cantidad,
          alicuota_iva:         item.alicuota_iva ?? '21',
          precio_original:      precioOriginal,
          descuento_pct:        descuentoPct,
          descuento_monto:      Math.round(descuentoMonto * 100) / 100,
          oferta_id:            ofertaId,
          descuento_manual_pct: descManualPct,
        };
      });

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

      // ── Encolar CAE vía trigger (SAP async posting — no bloquea la venta) ──────
      // El UPDATE a cae_estado='pendiente' dispara fn_queue_factura_arca, que inserta
      // en facturas_pendientes_arca. El arca-worker (cron */5 * * * *) es la única
      // fuente de verdad para llamar a ARCA — nunca desde el frontend.
      if (afipActivo && comprobante?.id) {
        const tipoComp = determinarTipoComprobante(
          afipConfig.condicion_iva,
          selectedClient?.condicion_iva ?? 'CF'
        );
        supabase.from('comprobantes').update({
          tipo_comprobante_afip: tipoComp,
          punto_venta_id: afipConfig.punto_venta.id,
          cae_estado: 'pendiente',
        }).eq('id', comprobante.id).then(({ error }) => {
          if (error) console.warn('[AFIP queue]', error.message);
        });
      }

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
  }, [user, isSessionOpen, currentSession, toast, afipActivo, afipConfig, determinarTipoComprobante]);

  return { confirmar, loading, lastComprobante };
}
