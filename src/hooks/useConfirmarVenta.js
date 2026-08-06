import { useState, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useToast } from '@/components/ui/use-toast';
import { getNowAR } from '@/lib/dateUtils';
import { useAfipConfig } from '@/hooks/useAfipConfig';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useFinalizarVentaPosterior } from '@/hooks/useFinalizarVentaPosterior';
import { encolarVenta, decrementarStockLocal, medioPagoDisponibleOffline } from '@/lib/offlineDb';

// Hook compartido entre el POS (PanelCarrito) y cualquier flujo de venta ARS rápido.
// Encapsula crear_venta RPC + asiento contable + encolado de CAE (facturación
// electrónica). Soporta modo ARS únicamente (el POS del Modo Caja).
//
// Moneda paralela (2026-07-28): recibe `tcParalelo` (retorno de useTCParalelo())
// y calcula el equivalente igual que NuevaVentaModal — la venta siempre es en
// ARS acá (Modo Caja no tiene selector de moneda), así que solo se usa la rama
// `calcParalelo(total, 'ARS', 1)`. El gate (bloquear si falta el TC del día) vive
// en el caller (PanelCarrito.jsx), mismo patrón que Caja/CtaCte/Compras.
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
//
// Modo Offline del POS — Fase 3 (`formasPago`, mig.214, para decidir por
// tipo_instrumento qué medios de pago no necesitan red — ver
// `medioPagoDisponibleOffline` en offlineDb.js): si no hay conexión y todos
// los pagos son Efectivo/Transferencia, la venta se ENCOLA en vez de llamar a
// `obtener_proximo_numero`/`crear_venta` (esa numeración es 100% autoritativa
// del servidor, no se puede reservar offline). El post-proceso de una venta
// exitosa (asiento contable + encolado a ARCA) se extrajo a
// `finalizarVentaPosterior` para que lo llame tanto este hook (camino online,
// sin cambios de comportamiento) como `useSyncEngine` (después de sincronizar
// una venta que se encoló offline) — evita duplicar esa lógica en dos lugares.
export function useConfirmarVenta(tcParalelo, formasPago = []) {
  const { user }                       = useAuth();
  const { isSessionOpen, currentSession } = useCaja();
  const { toast }                      = useToast();
  const isOnline                       = useOnlineStatus();
  // contexto 'pos': la empresa puede haberle dado al Modo Caja su propio punto
  // de venta (mig.293) — fiscal independiente, o interno para el local que no
  // factura. Si ese PdV tiene envia_arca=false, afipActivo queda en false y la
  // venta nunca se encola a ARCA.
  const { afipConfig, afipActivo } = useAfipConfig('pos');
  // Extraído a su propio hook — lo comparte con useSyncEngine (Fase 3), ver
  // comentario de useFinalizarVentaPosterior.js.
  const { finalizarVentaPosterior } = useFinalizarVentaPosterior();
  const [loading, setLoading]          = useState(false);
  const [lastComprobante, setLastComprobante] = useState(null);

  const generateVentaNumber = async () => {
    // mig.295: numeración por PdV (sólo si el PdV del POS no es el default de
    // la empresa — si lo es, sigue usando la serie única de siempre).
    const { data, error } = await supabase.rpc('obtener_proximo_numero', {
      p_empresa_id: user.empresa_id,
      p_tipo_documento: 'venta',
      p_punto_venta_id: afipConfig?.punto_venta?.id ?? null,
    });
    if (error) throw error;
    return data;
  };

  // pagos: Array<{ metodo: string, monto: number }>
  // selectedClient: null | { id, nombre, condicion_iva? }  ← condicion_iva define A/B/C
  // puntosCanjeados/descuentoPuntosPesos (Fase 3): PanelCarrito.jsx ya calculó
  // el descuento en pesos (puntos * puntos_valor_pesos, capado al saldo del
  // cliente) — acá sólo se resta del total y se manda el conteo de puntos a
  // crear_venta, que valida el saldo real y mueve el ledger.
  const confirmar = useCallback(async ({
    cart, selectedClient, pagos, ofertasCarrito = {}, descuentosManuales = {}, centroCostoId = null,
    puntosCanjeados = 0, descuentoPuntosPesos = 0,
  }) => {
    if (!cart?.length) {
      toast({ title: 'Carrito vacío', variant: 'destructive' });
      return null;
    }

    // Fidelización — Fase 3: canjear puntos necesita el saldo real del
    // servidor, no se soporta offline (a diferencia de Efectivo/Transferencia).
    // La UI ya oculta el input sin conexión — guard defensivo, "nunca confiar
    // en el cliente" aplica también acá.
    if (puntosCanjeados > 0 && (!isOnline || !selectedClient)) {
      toast({
        title: 'No se puede canjear puntos',
        description: !isOnline ? 'Canjear puntos necesita conexión a internet.' : 'Canjear puntos necesita un cliente asociado a la venta.',
        variant: 'destructive',
      });
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

    // Modo Offline — Fase 3: sin conexión, sólo Efectivo/Transferencia pueden
    // cobrarse (Tarjeta/QR/CC necesitan hablar con un tercero en el momento).
    // La UI ya debería haber bloqueado el resto (ver PanelCarrito.jsx) — este
    // guard es defensivo, "nunca confiar en el cliente" aplica también acá.
    if (!isOnline && !pagos.every(p => medioPagoDisponibleOffline(p.metodo, formasPago))) {
      toast({
        title: 'Ese medio de pago necesita conexión',
        description: 'Sin internet sólo se puede cobrar en Efectivo o Transferencia.',
        variant: 'destructive',
      });
      return null;
    }

    // OFERTAS — calcular total con descuentos aplicados
    const totalBruto = cart.reduce((sum, item) => {
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
    // Fidelización — Fase 3: neto del canje de puntos (0 si no se canjeó nada).
    const total = Math.round((totalBruto - descuentoPuntosPesos) * 100) / 100;

    // Fidelización — Fase 3, corrección de un bug real encontrado en vivo
    // (07/08): crear_venta calcula neto_gravado/iva_discriminado sumando los
    // p_items, sin enterarse de p_total — si sólo se restaba el canje del
    // total, el asiento contable automático (y una eventual factura AFIP)
    // seguían calculando IVA sobre el precio SIN el descuento de puntos,
    // quedando desbalanceados. Fix (decisión de Nadia, 07/08): repartir el
    // descuento de puntos proporcionalmente entre los ítems — mismo criterio
    // fiscal que ya usan las ofertas (el descuento va DENTRO del precio de
    // cada ítem, nunca aparte) — así el IVA queda sobre lo que el cliente
    // realmente pagó. No cambia el ticket (que ya muestra el descuento como
    // una línea aparte, leyendo el carrito local, no lo que se manda acá).
    const puntosFactor = puntosCanjeados > 0 && totalBruto > 0 ? total / totalBruto : 1;

    setLoading(true);
    try {
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
        // Fidelización — Fase 3: reparto proporcional del canje (ver comentario arriba).
        const precioFinalConPuntos = Math.round(precioFinal * puntosFactor * 100) / 100;

        return {
          producto_id:          item.id,
          cantidad:             item.cantidad,
          precio_unitario:      precioFinalConPuntos,
          subtotal:             precioFinalConPuntos * item.cantidad,
          alicuota_iva:         item.alicuota_iva ?? '21',
          precio_original:      precioOriginal,
          descuento_pct:        descuentoPct,
          descuento_monto:      Math.round(descuentoMonto * 100) / 100,
          oferta_id:            ofertaId,
          descuento_manual_pct: descManualPct,
          // Venta por pack (mig.190) — solo si la línea está en modo pack.
          unidad_venta_id:      item._packMode ? item.unidad_venta_id : '',
          cantidad_venta:       item._packMode ? item._packs : '',
          precio_unidad_venta:  item._packMode ? item._precioUnidadVenta : '',
        };
      });

      // Moneda paralela: la venta de Modo Caja siempre es en ARS, así que el
      // equivalente de cada pago sale directo de calcParalelo(monto, 'ARS', 1)
      // (mismo cálculo por pago que NuevaVentaModal, para cuando haya más de un
      // método). '' en vez de null porque el SQL usa NULLIF(...,'') para
      // resolver a NULL (mismo convenio que NuevaVentaModal).
      const montoParaleloTotal = tcParalelo?.enabled && tcParalelo.tcHoy
        ? tcParalelo.calcParalelo(total, 'ARS', 1)
        : null;

      const pagosPayload = pagos.map(p => {
        const pagoParalelo = tcParalelo?.enabled && tcParalelo.tcHoy
          ? tcParalelo.calcParalelo(p.monto, 'ARS', 1)
          : null;
        return {
          metodo:         p.metodo,
          monto:          p.monto,
          monto_paralelo: pagoParalelo ?? '',
          tc_paralelo:    pagoParalelo !== null ? tcParalelo.tcHoy : '',
          forma_pago_id:  p.forma_pago_id ?? null,
        };
      });

      // ── Sin conexión: encolar en vez de llamar al servidor ──────────────────
      if (!isOnline) {
        const cajaSesionId = currentSession?.id ?? null;
        const cajaSesionClientUuid = !cajaSesionId ? (currentSession?.client_uuid ?? null) : null;

        const filaEncolada = await encolarVenta(user.empresa_id, {
          payload: {
            p_empresa_id:       user.empresa_id,
            p_user_id:          user.id,
            p_fecha:            now,
            p_cliente_id:       selectedClient?.id   ?? null,
            p_cliente_nombre:   selectedClient?.nombre ?? 'Consumidor Final',
            p_total:            total,
            p_forma_pago:       formaPago,
            p_estado_pago:      'pagada', // CC nunca llega acá (bloqueada offline)
            p_moneda:           'ARS',
            p_tipo_cambio_tasa: 1,
            p_monto_paralelo:   montoParaleloTotal ?? null,
            p_tc_paralelo:      montoParaleloTotal !== null ? tcParalelo.tcHoy : null,
            p_items:            itemsPayload,
            p_pagos:            pagosPayload,
            p_es_cc:            false,
            p_caja_sesion_id:   cajaSesionId,
            p_pedido_id:        null,
            p_centro_costo_id:  centroCostoId || null,
          },
          itemsSnapshot: cart,
          clienteCondicionIva: selectedClient?.condicion_iva ?? 'CF',
          cajaSesionId,
          cajaSesionClientUuid,
        });

        // Optimista, sólo para que este mismo dispositivo no se sobre-venda a
        // sí mismo entre dos ventas encoladas — el servidor vuelve a validar
        // todo al sincronizar.
        await decrementarStockLocal(user.empresa_id, cart.map(item => ({
          producto_id: item.id, cantidad: item.cantidad,
        })));

        const comprobante = {
          id:              null,
          numero_venta:    filaEncolada.numero_provisorio,
          fecha:           now,
          total,
          moneda:          'ARS',
          tipo_cambio_tasa: 1,
          forma_pago:      formaPago,
          cliente_nombre:  selectedClient?.nombre ?? 'Consumidor Final',
          // Todavía no existe del lado del servidor — no corresponde afirmar
          // nada sobre CAE hasta que se sincronice de verdad.
          cae_estado:      'no_aplica',
          _offline:        true,
          _localId:        filaEncolada.localId,
        };

        toast({
          title: 'Venta guardada — sin conexión',
          description: `Comprobante provisorio ${filaEncolada.numero_provisorio}. Se sincroniza solo al reconectar.`,
        });
        setLastComprobante(comprobante);
        return comprobante;
      }

      // ── Con conexión: camino de siempre ──────────────────────────────────────
      const saleNumber = await generateVentaNumber();

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
        p_monto_paralelo:   montoParaleloTotal ?? null,
        p_tc_paralelo:      montoParaleloTotal !== null ? tcParalelo.tcHoy : null,
        p_items:            itemsPayload,
        p_pagos:            pagosPayload,
        p_es_cc:            isCC,
        p_caja_sesion_id:   currentSession?.id ?? null,
        p_pedido_id:        null, // FIX-CREAR-VENTA-V3
        p_centro_costo_id:  centroCostoId || null,
        p_puntos_canjeados: puntosCanjeados, // Fase 3 — 0 si no se canjeó nada
      });

      if (rpcError) throw rpcError;

      // Fidelización por puntos (Fase 2) — crear_venta ya devuelve puntos_ganados
      // desde la Fase 0 (mig.312); acá sólo se propaga para que TicketPrint y el
      // toast lo puedan mostrar. Sigue en 0 si la empresa no usa fidelización o
      // la venta no tiene cliente asociado — mismo criterio que ya aplica el RPC.
      const puntosGanados = rpcResult.puntos_ganados ?? 0;

      const comprobante = {
        id:              rpcResult.comprobante_id,
        numero_venta:    rpcResult.numero_venta,
        fecha:           now,
        total,
        moneda:          'ARS',
        tipo_cambio_tasa: 1,
        forma_pago:      formaPago,
        cliente_nombre:  selectedClient?.nombre ?? 'Consumidor Final',
        // Mismo criterio que decide si se encola a ARCA (afipActivo), para que
        // TicketPrint sepa distinguir "CAE pendiente" (PdV fiscal) de "no aplica"
        // (PdV interno) — antes el ticket asumía "pendiente" siempre que la
        // empresa facturara electrónicamente, aunque este PdV puntual no envíe.
        cae_estado:      afipActivo ? 'pendiente' : 'no_aplica',
        puntos_ganados:  puntosGanados,
        // Fase 3 — para que TicketPrint muestre "Descuento por puntos".
        puntos_canjeados: puntosCanjeados,
        descuento_puntos_pesos: descuentoPuntosPesos,
      };

      finalizarVentaPosterior({
        comprobante, rpcResult, total, saleNumber,
        clienteCondicionIva: selectedClient?.condicion_iva ?? 'CF',
        centroCostoId, isCC,
      });

      toast({
        title: '¡Venta Exitosa!',
        description: puntosGanados > 0
          ? `Comprobante ${saleNumber} generado. +${puntosGanados} puntos para ${selectedClient?.nombre}.`
          : `Comprobante ${saleNumber} generado.`,
      });
      setLastComprobante(comprobante);
      return comprobante;
    } catch (err) {
      console.error('[useConfirmarVenta]', err);
      toast({ title: 'Error al procesar la venta', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [user, isSessionOpen, currentSession, toast, afipActivo, afipConfig, tcParalelo, isOnline, formasPago, finalizarVentaPosterior]);

  return { confirmar, loading, lastComprobante, finalizarVentaPosterior };
}
