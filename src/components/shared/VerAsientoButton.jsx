import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookMarked, Loader2 } from 'lucide-react';
import ModalDetalleAsiento from './ModalDetalleAsiento';
import { asientosService, PLAN_CUENTAS_KEYS } from '@/services/planCuentasService';

/**
 * VerAsientoButton — el link "Ver asiento" que faltaba en TODO el ERP
 * (encontrado por Luciano, 22/08): ningún documento tenía forma de llegar
 * al asiento contable que generó, aunque el dato (`asiento_id` o
 * `origen`+`origen_id`) siempre estuvo en la base. Este botón resuelve las
 * dos formas que existen hoy:
 *
 *  - `asientoId`: el documento guarda el id directo (comprobantes.asiento_id,
 *    recuentos_inventario.asiento_id, revalorizaciones_inventario.asiento_id).
 *  - `origen`+`origenId`: el documento NO guarda el id (OC, Recepciones,
 *    ajustes de stock, CC) — se busca por asientosService.getAsientoPorOrigen.
 *
 * Si no hay asiento (nunca se generó, o falló silenciosamente — ver período
 * cerrado / cuenta faltante) no se muestra nada, no un botón roto.
 */
function VerAsientoButton({ asientoId = null, empresaId = null, origen = null, origenId = null, className = '' }) {
  const [open, setOpen] = useState(false);

  const porOrigen = !asientoId && !!origen && !!origenId && !!empresaId;
  const { data: resuelto, isLoading } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.asientoPorOrigen(origen ?? '', origenId ?? ''),
    queryFn: () => asientosService.getAsientoPorOrigen(empresaId, origen, origenId),
    enabled: porOrigen,
  });

  const idResuelto = asientoId ?? resuelto?.id ?? null;

  if (porOrigen && isLoading) {
    return <Loader2 className={`w-3 h-3 animate-spin text-kx-text-3 ${className}`} />;
  }
  if (!idResuelto) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-2xs text-kx-violet hover:opacity-80 font-medium inline-flex items-center gap-1 ${className}`}
        title="Ver el asiento contable generado por este documento"
      >
        <BookMarked className="w-3 h-3" /> Ver asiento
      </button>
      <ModalDetalleAsiento asientoId={idResuelto} open={open} onOpenChange={setOpen} />
    </>
  );
}

export default VerAsientoButton;
