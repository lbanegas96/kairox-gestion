import { useState, useEffect } from 'react';

// Modo Offline del POS — Fase 1. Detección de conectividad vía navigator.onLine
// + los eventos 'online'/'offline' del browser (se disparan cuando el SO
// reporta que cambió el estado de la interfaz de red).
//
// Límite conocido, aceptado a propósito para esta fase: navigator.onLine sólo
// refleja si hay una interfaz de red activa, no si hay salida real a internet
// ni si Supabase específicamente es alcanzable (wifi conectado a un router sin
// internet reporta `true`). Un chequeo real (ping a la API) es trabajo de una
// fase posterior — acá el alcance es sólo "mostrarle al cajero un aviso", sin
// tocar todavía el flujo de `crear_venta` ni ninguna cola de sincronización.
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
