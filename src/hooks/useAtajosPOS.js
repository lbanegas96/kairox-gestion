import { useEffect } from 'react';

// Atajos de teclado del mostrador (Modo Caja) — F2 cobrar, F4 volver al
// buscador, F8 foco en cliente, Alt+1..4 medio de pago por posición.
// Se evitan F1/F3/F5/F6/F10/F11/F12 (reservados por el navegador: ayuda,
// buscar en página, recargar, barra de direcciones, fullscreen, devtools).
//
// `apiRef` es un ref mutable ({ confirmar, focusBuscador, focusCliente,
// seleccionarMedioPago }) que cada panel (PanelProductos/PanelCarrito) va
// completando en su propio efecto — así el listener global no depende de
// re-renders y siempre lee las últimas funciones registradas.
export function useAtajosPOS({ apiRef, enabled = true }) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e) => {
      // No interceptar mientras haya un modal Radix abierto (mismo guard que
      // el refocus del buscador en PanelProductos) — evita, por ejemplo, que
      // F2 vuelva a disparar la confirmación con el modal "Venta confirmada" abierto.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;

      const api = apiRef.current;
      if (!api) return;

      if (e.key === 'F2') {
        e.preventDefault();
        api.confirmar?.();
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        api.focusBuscador?.();
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        api.focusCliente?.();
        return;
      }
      if (e.altKey && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        api.seleccionarMedioPago?.(Number(e.key) - 1);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [apiRef, enabled]);
}
