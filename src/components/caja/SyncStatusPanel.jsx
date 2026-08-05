import { useState } from 'react';
import { CloudOff, AlertTriangle } from 'lucide-react';
import { useVentaOfflineQueue } from '@/hooks/useVentaOfflineQueue';
import SyncConflictModal from './SyncConflictModal';

// Modo Offline del POS — Fase 3. Badge en la topbar del POS: cuántas ventas
// o aperturas de caja siguen esperando conexión o en conflicto. Oculto
// cuando no hay nada pendiente, para no sumar ruido (mismo criterio que el
// badge "Sin conexión" de la Fase 1). Click abre el detalle
// (SyncConflictModal) con la lista y un botón de reintento manual.
function SyncStatusPanel({ empresaId, onSincronizarAhora }) {
  const {
    ventasPendientes, aperturasPendientes, conflictosVenta, conflictosApertura,
    cantidadPendiente, anularVentaConflicto,
  } = useVentaOfflineQueue(empresaId);
  const [showModal, setShowModal] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  if (cantidadPendiente === 0) return null;

  const hayConflictos = conflictosVenta.length + conflictosApertura.length > 0;

  const handleReintentar = async () => {
    setSincronizando(true);
    try {
      await onSincronizarAhora?.();
    } finally {
      setSincronizando(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        title="Ver ventas/aperturas pendientes de sincronizar"
        className={`text-2xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 flex items-center gap-1 transition-colors ${
          hayConflictos
            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
            : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
        }`}
      >
        {hayConflictos ? <AlertTriangle className="w-3 h-3" /> : <CloudOff className="w-3 h-3" />}
        {cantidadPendiente} sin sincronizar
      </button>

      <SyncConflictModal
        open={showModal}
        onOpenChange={setShowModal}
        ventasPendientes={ventasPendientes}
        aperturasPendientes={aperturasPendientes}
        sincronizando={sincronizando}
        onReintentar={handleReintentar}
        onAnularVenta={anularVentaConflicto}
      />
    </>
  );
}

export default SyncStatusPanel;
