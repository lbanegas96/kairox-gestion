import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import {
  listarAperturasPendientes, marcarAperturaSincronizada, marcarAperturaConflicto,
  listarVentasPendientes, marcarVentaSincronizada, marcarVentaConflicto,
  reconciliarAperturasViejas,
} from '@/lib/offlineDb';

// Modo Offline del POS — Fase 3. Motor de sincronización: cuando vuelve la
// conexión, procesa primero las aperturas de caja encoladas y después las
// ventas encoladas, siempre en orden cronológico (importa para la numeración
// fiscal correlativa, que sólo puede asignarse acá — obtener_proximo_numero
// necesita red). Un conflicto en un ítem puntual (ej. stock insuficiente
// re-validado por el servidor, o una caja que ya abrió otro dispositivo) NO
// frena la cola entera: se marca para resolución manual (SyncConflictModal) y
// sigue con los siguientes — "reintentar solo" no tiene sentido ahí.
//
// `puntoVentaId`/`onVentaSincronizada` los inyecta el caller (PanelCarrito,
// desde lo que ya expone useConfirmarVenta) — el motor en sí no sabe nada de
// AFIP ni de asientos contables, sólo llama ese callback después de un
// crear_venta exitoso. Es la MISMA función (`finalizarVentaPosterior`) que
// corre el camino online, para no duplicar esa lógica en dos lugares.
export function useSyncEngine({ empresaId, isOnline, puntoVentaId, onVentaSincronizada }) {
  const isSyncing = useRef(false);

  const sincronizarAperturas = async () => {
    const todas = await listarAperturasPendientes(empresaId);
    const idsReales = new Map(); // client_uuid -> sesion_id real

    // Aperturas ya sincronizadas en corridas anteriores (reconexión
    // intermitente: la apertura sincronizó, pero la conexión se cortó de
    // nuevo antes de sincronizar sus ventas dependientes) — sus ventas
    // todavía pueden estar esperando el id real.
    for (const a of todas) {
      if (a.estado === 'sincronizada' && a.resultado?.sesion_id) {
        idsReales.set(a.client_uuid, a.resultado.sesion_id);
      }
    }

    for (const apertura of todas.filter(a => a.estado === 'pendiente')) {
      const { data, error } = await supabase.rpc('abrir_caja_sesion', {
        ...apertura.payload,
        p_client_uuid: apertura.client_uuid,
      });
      if (error) {
        await marcarAperturaConflicto(apertura.localId, error.message);
        continue;
      }
      if (data?.conflict) {
        // Otra sesión (online u offline) ganó la apertura de esa caja física
        // — típicamente esta MISMA apertura, abandonada (el cajero la
        // encoló offline pero no llegó a usarla, y después terminó abriendo
        // la caja de nuevo ya con internet). No es un callejón sin salida:
        // al cajero le da lo mismo bajo qué sesión haya quedado la caja
        // realmente abierta, así que se reconcilia contra la que ganó — ella
        // y cualquier venta que dependiera de su client_uuid quedan
        // resueltas solas, en vez de varadas para siempre (bug real
        // encontrado en pruebas de producción, 07/08).
        await reconciliarAperturasViejas(empresaId, apertura.payload.p_caja_id, data.sesion_id);
        idsReales.set(apertura.client_uuid, data.sesion_id);
        continue;
      }
      await marcarAperturaSincronizada(apertura.localId, data);
      idsReales.set(apertura.client_uuid, data.sesion_id);
    }
    return idsReales;
  };

  const sincronizarVentas = async (idsRealesDeSesion) => {
    const pendientes = await listarVentasPendientes(empresaId);

    for (const venta of pendientes.filter(v => v.estado === 'pendiente')) {
      let cajaSesionId = venta.caja_sesion_id;
      if (!cajaSesionId && venta.caja_sesion_client_uuid) {
        cajaSesionId = idsRealesDeSesion.get(venta.caja_sesion_client_uuid) ?? null;
        if (!cajaSesionId) {
          // La apertura de la que depende esta venta todavía no tiene id real
          // (sigue pendiente, o quedó en conflicto) — no se puede vender
          // contra una caja que el servidor no reconoce. Se reintenta solo en
          // la próxima corrida (o cuando el cajero resuelva el conflicto de
          // la apertura), no en ésta.
          continue;
        }
      }

      try {
        const { data: numeroReal, error: numeroError } = await supabase.rpc('obtener_proximo_numero', {
          p_empresa_id: empresaId,
          p_tipo_documento: 'venta',
          p_punto_venta_id: puntoVentaId ?? null,
        });
        if (numeroError) throw numeroError;

        const { data: rpcResult, error: rpcError } = await supabase.rpc('crear_venta', {
          ...venta.payload,
          p_numero_venta: numeroReal,
          p_caja_sesion_id: cajaSesionId,
          p_client_uuid: venta.client_uuid,
        });
        if (rpcError) throw rpcError;

        await marcarVentaSincronizada(venta.localId, {
          comprobante_id: rpcResult.comprobante_id,
          numero_venta: rpcResult.numero_venta,
        });

        // `duplicate:true` = esta venta YA se había sincronizado en un
        // intento anterior (el servidor la reconoce por client_uuid) y sólo
        // no habíamos llegado a marcarla localmente — no volver a correr el
        // post-proceso acá adentro, o el asiento contable quedaría
        // duplicado. Sólo se llama una vez, en el intento que de verdad la
        // creó por primera vez.
        if (!rpcResult.duplicate) {
          onVentaSincronizada?.({
            comprobante: { id: rpcResult.comprobante_id },
            rpcResult,
            total: venta.payload.p_total,
            saleNumber: rpcResult.numero_venta,
            clienteCondicionIva: venta.cliente_condicion_iva,
            centroCostoId: venta.payload.p_centro_costo_id,
            isCC: false,
          });
        }
      } catch (err) {
        await marcarVentaConflicto(venta.localId, err.message ?? 'Error desconocido al sincronizar');
      }
    }
  };

  const sincronizarTodo = useCallback(async () => {
    if (!empresaId || isSyncing.current) return;
    isSyncing.current = true;
    try {
      const idsReales = await sincronizarAperturas();
      await sincronizarVentas(idsReales);
    } finally {
      isSyncing.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, puntoVentaId, onVentaSincronizada]);

  // Corre apenas hay conexión — tanto en la transición offline→online como al
  // montar si ya había red (cubre el caso "se cerró la app con cola pendiente
  // y se reabrió más tarde ya conectada"). Si no hay nada pendiente, las dos
  // consultas a Dexie no encuentran nada y no se llama a ninguna RPC.
  useEffect(() => {
    if (isOnline) sincronizarTodo();
  }, [isOnline, sincronizarTodo]);

  return { sincronizarAhora: sincronizarTodo };
}
