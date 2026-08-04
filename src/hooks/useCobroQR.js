import { useState, useRef, useCallback, useEffect } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';

// Cobro por QR Dinámico de MercadoPago en el POS — Fase 2 (mig.297/298 + 306/307).
//
// Flujo, distinto al del resto de los medios de pago: la venta NO se crea al
// confirmar, se crea ANTES (en estado `pendiente`) para poder darle a MP un
// external_reference con el cual notificar. Recién cuando el pago se confirma la
// venta pasa a `pagada` y se genera el asiento. Mismo patrón "crear ya en
// pendiente, confirmar después" que ya usa AFIP con facturas_pendientes_arca.
//
//   iniciar()  → edge fn mp-qr-crear → venta pendiente + qr_data (string EMVCo)
//   (espera)   → polling sobre qr_pagos_mp.estado
//   confirmado → lo marca `confirmar_pago_qr`, disparada por el webhook O por el
//                cron mp-qr-poller (mig.307)
//   cancelar() → cancelar_venta_pendiente_qr (devuelve el stock)
//
// POR QUÉ SE POLLEA LA TABLA Y NO A MERCADOPAGO: el frontend no puede (ni debe)
// hablar con la API de MP — el Access Token vive en Vault y sólo lo tocan las
// edge functions con service_role. Acá se mira `qr_pagos_mp.estado`, que es la
// fuente de verdad local y está protegida por RLS.
//
// LATENCIA ESPERADA: si el webhook de MP funciona, la confirmación es casi
// instantánea. Mientras siga rechazando las notificaciones con 401 (pendiente de
// que Luciano rote el `webhook_secret`), la confirmación la trae el cron
// `mp-qr-poller`, que corre cada minuto — o sea hasta ~60s de espera. Por eso el
// modal muestra el estado explícitamente en vez de quedarse mudo.

const POLL_MS = 3000;

export function useCobroQR() {
  const { user } = useAuth();

  const [estado, setEstado]       = useState('idle'); // idle|creando|esperando|pagado|expirado|cancelado|error
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [datos, setDatos]         = useState(null);   // { comprobante_id, numero_venta, total, external_reference, expiracion }
  const [error, setError]         = useState(null);
  const [segundosRestantes, setSegundosRestantes] = useState(null);

  const pollRef  = useRef(null);
  const tickRef  = useRef(null);
  const datosRef = useRef(null);

  const limpiarTimers = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  // Al desmontar (cajero cierra el POS, navega, se recarga) hay que soltar los
  // timers sí o sí — si no, quedan corriendo contra una tabla que ya nadie mira.
  useEffect(() => () => limpiarTimers(), [limpiarTimers]);

  const reset = useCallback(() => {
    limpiarTimers();
    setEstado('idle');
    setQrDataUrl(null);
    setDatos(null);
    setError(null);
    setSegundosRestantes(null);
    datosRef.current = null;
  }, [limpiarTimers]);

  /** Arranca el cobro: crea la venta pendiente y genera el QR. */
  const iniciar = useCallback(async ({ carrito, selectedClient, centroCostoId, cajaSesionId, getPrecio }) => {
    if (!carrito?.length) return { error: 'El carrito está vacío' };

    setEstado('creando');
    setError(null);

    // Mismo contrato de ítems que espera crear_venta_pendiente_qr: lee
    // producto_id, cantidad, precio_unitario, subtotal y alicuota_iva.
    const items = carrito.map((item) => {
      const precio = getPrecio(item);
      return {
        producto_id:     item.id,
        nombre:          item.nombre,
        cantidad:        item.cantidad,
        precio_unitario: precio,
        subtotal:        Math.round(precio * item.cantidad * 100) / 100,
        alicuota_iva:    item.alicuota_iva ?? '21',
      };
    });

    try {
      const { data, error: fnError } = await supabase.functions.invoke('mp-qr-crear', {
        body: {
          items,
          cliente_id:      selectedClient?.id ?? null,
          cliente_nombre:  selectedClient?.nombre ?? null,
          caja_sesion_id:  cajaSesionId ?? null,
          centro_costo_id: centroCostoId || null,
        },
      });

      if (fnError || data?.error) {
        const msg = data?.error || fnError?.message || 'No se pudo generar el QR';
        setEstado('error');
        setError(msg);
        return { error: msg };
      }

      // qr_data es el string EMVCo que devuelve MP — se renderiza tal cual.
      const url = await QRCode.toDataURL(data.qr_data, {
        width: 320,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' },
      });

      datosRef.current = data;
      setDatos(data);
      setQrDataUrl(url);
      setEstado('esperando');
      return { ok: true, data };
    } catch (e) {
      setEstado('error');
      setError(e.message ?? 'Error inesperado generando el QR');
      return { error: e.message };
    }
  }, []);

  // Polling del estado + cuenta regresiva. Sólo mientras se espera el pago.
  useEffect(() => {
    if (estado !== 'esperando' || !datos?.external_reference) return;

    const consultar = async () => {
      const { data, error: qErr } = await supabase
        .from('qr_pagos_mp')
        .select('estado')
        .eq('external_reference', datos.external_reference)
        .eq('empresa_id', user.empresa_id)
        .maybeSingle();

      if (qErr || !data) return; // error transitorio: se reintenta en el próximo tick
      if (data.estado !== 'pendiente') {
        limpiarTimers();
        setEstado(data.estado === 'pagado' ? 'pagado' : data.estado);
      }
    };

    pollRef.current = setInterval(consultar, POLL_MS);
    consultar();

    // Cuenta regresiva hasta la expiración que devolvió MP.
    const venceEn = new Date(datos.expiracion).getTime();
    const tick = () => {
      const restan = Math.max(0, Math.round((venceEn - Date.now()) / 1000));
      setSegundosRestantes(restan);
      // No se marca 'expirado' desde acá: el estado real lo escribe
      // expirar_qrs_vencidos() (que además devuelve el stock). Acá sólo se deja
      // de contar; el polling va a levantar el cambio cuando el cron lo procese.
      if (restan === 0 && tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
    tickRef.current = setInterval(tick, 1000);
    tick();

    return () => limpiarTimers();
  }, [estado, datos, user?.empresa_id, limpiarTimers]);

  /** Cancela la venta pendiente y devuelve el stock. */
  const cancelar = useCallback(async () => {
    const d = datosRef.current;
    if (!d?.comprobante_id) { reset(); return { ok: true }; }

    limpiarTimers();
    const { data, error: rpcError } = await supabase.rpc('cancelar_venta_pendiente_qr', {
      p_empresa_id:     user.empresa_id,
      p_comprobante_id: d.comprobante_id,
    });

    if (rpcError) {
      // El caso real que importa: el cliente pagó justo mientras el cajero
      // apretaba Cancelar. El RPC lo rechaza a propósito (lockea y re-chequea),
      // así que se refleja como pagado en vez de tragarse el error.
      if (/ya fue confirmado/i.test(rpcError.message)) {
        setEstado('pagado');
        return { ok: false, yaPagado: true, error: rpcError.message };
      }
      setError(rpcError.message);
      return { ok: false, error: rpcError.message };
    }

    setEstado('cancelado');
    return { ok: true, data };
  }, [user?.empresa_id, limpiarTimers, reset]);

  return { estado, qrDataUrl, datos, error, segundosRestantes, iniciar, cancelar, reset };
}
