import { useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { getTodayAR } from '@/lib/dateUtils';
import { asientosAutoService } from '@/services/planCuentasService';
import { useAfipConfig } from '@/hooks/useAfipConfig';

// Post-proceso de una venta ya confirmada en el servidor: asiento contable +
// encolado a ARCA (si aplica). Extraído a un hook propio (antes vivía inline
// en useConfirmarVenta.js) para que lo use tanto el camino online de
// useConfirmarVenta (en el momento, sin cambios de comportamiento) como
// useSyncEngine — Modo Offline del POS, Fase 3 — después de sincronizar con
// éxito una venta que se había encolado sin conexión. Evita duplicar esta
// lógica en dos lugares.
export function useFinalizarVentaPosterior() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { afipConfig, afipActivo, determinarTipoComprobante } = useAfipConfig('pos');

  const finalizarVentaPosterior = useCallback(({
    comprobante, rpcResult, total, saleNumber, clienteCondicionIva, centroCostoId, isCC, formaPagoId,
  }) => {
    asientosAutoService.crearAsientoVenta(user.empresa_id, user.id, {
      ventaId:     comprobante.id,
      total,
      neto:        rpcResult.neto_gravado,
      iva:         rpcResult.iva_discriminado,
      fecha:       getTodayAR(),
      descripcion: `Venta #${saleNumber}`,
      esCredito:   isCC,
      centroCostoId: centroCostoId || null,
      // mig.286: cuánto de esta venta se pagó con una forma de pago que tarda
      // en acreditarse (tarjeta) — crear_venta ya lo resolvió por pago.
      montoPendienteLiquidacion: rpcResult.monto_pendiente_liquidacion,
      costoMercaderiaVendida: rpcResult.costo_mercaderia_vendida,
      // mig.363: cuenta contable determinada por forma de pago (solo pago único).
      formaPagoId: formaPagoId || null,
    }).catch(e => {
      if (e.message?.startsWith('Período cerrado:')) {
        toast({ title: 'Asiento contable no generado', description: e.message, variant: 'destructive' });
      } else {
        console.warn('[Contabilidad] asiento venta:', e.message);
      }
    });

    // ── Encolar CAE vía trigger (SAP async posting — no bloquea la venta) ──────
    // El UPDATE a cae_estado='pendiente' dispara fn_queue_factura_arca, que inserta
    // en facturas_pendientes_arca. El arca-worker (cron */5 * * * *) es la única
    // fuente de verdad para llamar a ARCA — nunca desde el frontend.
    if (afipActivo && comprobante?.id) {
      const tipoComp = determinarTipoComprobante(
        afipConfig.condicion_iva,
        clienteCondicionIva ?? 'CF'
      );
      supabase.from('comprobantes').update({
        tipo_comprobante_afip: tipoComp,
        punto_venta_id: afipConfig.punto_venta.id,
        cae_estado: 'pendiente',
      }).eq('id', comprobante.id).then(({ error }) => {
        if (error) console.warn('[AFIP queue]', error.message);
      });
    }
  }, [user, afipActivo, afipConfig, determinarTipoComprobante, toast]);

  return { finalizarVentaPosterior, puntoVentaId: afipConfig?.punto_venta?.id ?? null };
}
