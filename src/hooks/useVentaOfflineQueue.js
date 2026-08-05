import { useLiveQuery } from 'dexie-react-hooks';
import {
  listarVentasPendientes, listarAperturasPendientes,
  eliminarVentaPendiente, decrementarStockLocal,
} from '@/lib/offlineDb';

// Modo Offline del POS — Fase 3. Envoltorio reactivo (useLiveQuery: se
// re-renderiza solo cuando Dexie cambia, sin polling manual) sobre la cola de
// ventas/aperturas de caja pendientes de sincronizar. Lo usan
// `SyncStatusPanel` (mostrar el conteo), `SyncConflictModal` (listar y
// resolver conflictos) y `CajaContext.closeSession` (bloquear el cierre).
export function useVentaOfflineQueue(empresaId) {
  const ventasPendientes = useLiveQuery(
    () => (empresaId ? listarVentasPendientes(empresaId) : []),
    [empresaId],
    [],
  ) ?? [];
  const aperturasPendientes = useLiveQuery(
    () => (empresaId ? listarAperturasPendientes(empresaId) : []),
    [empresaId],
    [],
  ) ?? [];

  const conflictosVenta = ventasPendientes.filter(v => v.estado === 'conflicto');
  const conflictosApertura = aperturasPendientes.filter(a => a.estado === 'conflicto');

  // Cuenta lo que todavía necesita atención — 'pendiente' (esperando red) y
  // 'conflicto' (esperando que el cajero lo resuelva) bloquean el cierre por
  // igual: ninguno de los dos está confirmado en el servidor todavía.
  const cantidadPendiente =
    ventasPendientes.filter(v => v.estado !== 'sincronizada').length +
    aperturasPendientes.filter(a => a.estado !== 'sincronizada').length;

  // Anular una venta en conflicto (ej. el servidor rechazó por stock
  // insuficiente al sincronizar): la venta NUNCA llegó a tocar stock real
  // (crear_venta nunca se ejecutó del lado del servidor para ella) — sólo
  // hay que revertir el descuento optimista que se le había aplicado al
  // snapshot local de este dispositivo, y sacarla de la cola.
  const anularVentaConflicto = async (venta) => {
    if (venta.itemsSnapshot?.length) {
      await decrementarStockLocal(empresaId, venta.itemsSnapshot.map(it => ({
        producto_id: it.id,
        cantidad: -(Number(it.cantidad) || 0),
      })));
    }
    await eliminarVentaPendiente(venta.localId);
  };

  return {
    ventasPendientes,
    aperturasPendientes,
    conflictosVenta,
    conflictosApertura,
    cantidadPendiente,
    anularVentaConflicto,
  };
}
