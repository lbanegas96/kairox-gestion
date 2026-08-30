import { useState, useMemo } from 'react';
import { parseNumberLocale } from '@/lib/currencyUtils';

/**
 * Hook para gestionar la selección de métodos de pago de una venta (NuevaVentaModal).
 * Extraído 1:1 de la lógica que vivía inline en NuevaVentaModal — mismo modelo de
 * estado (Set de métodos activos + montos por método), mismas validaciones y
 * mensajes al confirmar.
 *
 * Cuenta Corriente — hallazgo Luciano (29/08, probando el POS): "quise probar
 * pagar con diferentes medios de pago y al restante dejarlo en cuenta y no me
 * deja, es toda la deuda o nada". Antes CC era mutuamente excluyente con
 * cualquier otro método (elegirla vaciaba la selección, y viceversa). Ahora es
 * un método más dentro del pago mixto — se puede combinar Efectivo/Tarjeta/etc.
 * y dejar el resto como deuda en Cuenta Corriente, con su propio monto en
 * `methodAmounts`. Solo se mantiene un atajo: si CC queda como el ÚNICO método
 * seleccionado, `construirPagosFinales` sigue completando el monto solo (no
 * hace falta tipearlo) — mismo comportamiento de siempre para el caso 100% CC.
 *
 * `total` es el total de la venta en ARS (cart), recalculado por el caller en cada
 * render — el hook no fetchea ni posee el carrito.
 *
 * `formasPago` (maestro de ConfiguracionSection → Finanzas, mig.214): lista de
 * formas de pago activas de la empresa. Se usa solo para resolver forma_pago_id
 * por nombre al construir los pagos finales.
 */
export function useMultipago(total, formasPago = []) {
  const [selectedMethods, setSelectedMethods] = useState(new Set(['Efectivo']));
  const [methodAmounts, setMethodAmounts] = useState({});

  // isCC = "la venta incluye Cuenta Corriente" (sola o combinada) — se usa para
  // gatear "cliente requerido" y el aviso de deuda, no implica exclusividad.
  const isCC = selectedMethods.has('Cuenta Corriente');
  const isMultiPago = selectedMethods.size > 1;

  const totalPagado = useMemo(() => {
    if (!isMultiPago) return 0;
    return Array.from(selectedMethods).reduce(
      (sum, m) => sum + (parseFloat(methodAmounts[m]) || 0), 0
    );
  }, [isMultiPago, selectedMethods, methodAmounts]);

  const restante = total - totalPagado;

  const toggleMethod = (method) => {
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
  const formaPagoIdPorNombre = (nombre) => formasPago.find(f => f.nombre === nombre)?.id ?? null;

  const construirPagosFinales = () => {
    // 100% Cuenta Corriente (único método seleccionado) — atajo de siempre,
    // no hace falta tipear el monto.
    if (isCC && selectedMethods.size === 1) {
      return { pagos: [{ metodo: 'Cuenta Corriente', monto: total, forma_pago_id: null }], error: null };
    }
    if (isMultiPago) {
      const pagos = Array.from(selectedMethods).map(m => {
        const parsed = parseNumberLocale(methodAmounts[m]);
        return { metodo: m, monto: isNaN(parsed) ? 0 : parsed, forma_pago_id: formaPagoIdPorNombre(m) };
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
    return { pagos: [{ metodo: singleMethod, monto: total, forma_pago_id: formaPagoIdPorNombre(singleMethod) }], error: null };
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
