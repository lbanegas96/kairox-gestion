import { useState, useMemo } from 'react';
import { parseNumberLocale } from '@/lib/currencyUtils';

/**
 * Hook para gestionar la selección de métodos de pago de una venta (NuevaVentaModal).
 * Extraído 1:1 de la lógica que vivía inline en NuevaVentaModal — mismo modelo de
 * estado (Set de métodos activos + montos por método), misma exclusividad de
 * Cuenta Corriente, mismas validaciones y mensajes al confirmar.
 *
 * `total` es el total de la venta en ARS (cart), recalculado por el caller en cada
 * render — el hook no fetchea ni posee el carrito.
 */
export function useMultipago(total) {
  const [selectedMethods, setSelectedMethods] = useState(new Set(['Efectivo']));
  const [methodAmounts, setMethodAmounts] = useState({});

  const isCC = selectedMethods.has('Cuenta Corriente');
  const isMultiPago = !isCC && selectedMethods.size > 1;

  const totalPagado = useMemo(() => {
    if (!isMultiPago) return 0;
    return Array.from(selectedMethods).reduce(
      (sum, m) => sum + (parseFloat(methodAmounts[m]) || 0), 0
    );
  }, [isMultiPago, selectedMethods, methodAmounts]);

  const restante = total - totalPagado;

  const toggleMethod = (method) => {
    if (method === 'Cuenta Corriente') {
      setSelectedMethods(new Set(['Cuenta Corriente']));
      setMethodAmounts({});
      return;
    }
    // Salir de CC
    if (selectedMethods.has('Cuenta Corriente')) {
      setSelectedMethods(new Set([method]));
      setMethodAmounts({});
      return;
    }
    if (selectedMethods.has(method)) {
      if (selectedMethods.size === 1) return; // No deseleccionar el último
      const next = new Set(selectedMethods);
      next.delete(method);
      setSelectedMethods(next);
      setMethodAmounts(prev => {
        const copy = { ...prev };
        delete copy[method];
        return copy;
      });
    } else {
      setSelectedMethods(new Set([...selectedMethods, method]));
    }
  };

  const reset = () => {
    setSelectedMethods(new Set(['Efectivo']));
    setMethodAmounts({});
  };

  /**
   * Construye y valida los pagos finales para enviar a la RPC crear_venta.
   * Devuelve { pagos, error } — si error no es null, pagos es null y el caller
   * debe mostrar el toast con ese error (title/description) tal cual.
   * Misma lógica/mensajes exactos que vivían inline en handleConfirmSale.
   */
  const construirPagosFinales = () => {
    if (isCC) {
      return { pagos: [{ metodo: 'Cuenta Corriente', monto: total }], error: null };
    }
    if (isMultiPago) {
      const pagos = Array.from(selectedMethods).map(m => {
        const parsed = parseNumberLocale(methodAmounts[m]);
        return { metodo: m, monto: isNaN(parsed) ? 0 : parsed };
      });
      const invalido = Array.from(selectedMethods).some(m => {
        const v = methodAmounts[m];
        return v && v !== '' && isNaN(parseNumberLocale(v));
      });
      if (invalido) {
        return {
          pagos: null,
          error: {
            title: 'Monto inválido',
            description: 'Usá formato argentino: punto para miles y coma para decimales (ej: 50.000,00).',
          },
        };
      }
      const suma = pagos.reduce((s, p) => s + p.monto, 0);
      if (Math.abs(suma - total) > 0.01) {
        return {
          pagos: null,
          error: {
            title: 'Pago incompleto',
            description: `Asignado: $${suma.toFixed(2)} de $${total.toFixed(2)}. Completá todos los montos.`,
          },
        };
      }
      return { pagos, error: null };
    }
    const [singleMethod] = Array.from(selectedMethods);
    return { pagos: [{ metodo: singleMethod, monto: total }], error: null };
  };

  return {
    selectedMethods,
    methodAmounts,
    setMethodAmounts,
    isCC,
    isMultiPago,
    totalPagado,
    restante,
    toggleMethod,
    reset,
    construirPagosFinales,
  };
}
