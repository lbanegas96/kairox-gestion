import { useEffect, useRef, useCallback } from 'react';

const INACTIVITY_MINUTES = 30; // Cerrar sesión luego de 30 min sin actividad
const WARNING_BEFORE_MS  = 60_000; // Avisar 1 minuto antes

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];

/**
 * Hook de cierre de sesión por inactividad.
 *
 * Uso:
 *   useInactivityTimeout(signOut, {
 *     minutes: 30,
 *     onWarning: () => toast({ title: "¿Seguís ahí?" })
 *   });
 *
 * @param {Function} signOut   — función de logout del AuthContext
 * @param {Object}   options
 *   @param {number}   minutes   — minutos de inactividad antes de cerrar sesión (default 30)
 *   @param {Function} onWarning — callback opcional llamado 1 min antes del logout
 *   @param {boolean}  enabled   — si false, el hook no hace nada (útil para deshabilitar en dev)
 */
export function useInactivityTimeout(signOut, { minutes = INACTIVITY_MINUTES, onWarning, enabled = true } = {}) {
  const logoutTimer  = useRef(null);
  const warningTimer = useRef(null);
  const warned       = useRef(false);

  const clearTimers = useCallback(() => {
    if (logoutTimer.current)  clearTimeout(logoutTimer.current);
    if (warningTimer.current) clearTimeout(warningTimer.current);
    warned.current = false;
  }, []);

  const resetTimers = useCallback(() => {
    if (!enabled) return;
    clearTimers();

    const totalMs   = minutes * 60_000;
    const warnAt    = totalMs - WARNING_BEFORE_MS;

    // Warning timer
    if (onWarning && warnAt > 0) {
      warningTimer.current = setTimeout(() => {
        if (!warned.current) {
          warned.current = true;
          onWarning();
        }
      }, warnAt);
    }

    // Logout timer
    logoutTimer.current = setTimeout(async () => {
      await signOut();
    }, totalMs);
  }, [enabled, minutes, onWarning, signOut, clearTimers]);

  useEffect(() => {
    if (!enabled) return;

    // Arrancar los timers
    resetTimers();

    // Resetear en cada evento de actividad
    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, resetTimers, { passive: true }));

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, resetTimers));
    };
  }, [enabled, resetTimers, clearTimers]);
}
