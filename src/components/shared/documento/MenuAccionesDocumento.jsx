import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Menú "···" para acciones de bajo riesgo/baja frecuencia (Editar, Duplicar) en
// el footer del detalle de un documento — pedido de Luciano (23/08): esos
// botones quieren estar disponibles pero no tan a mano como para tocarlos por
// error entre las acciones de todos los días (Cerrar, Cancelar, Generar X).
//
// `acciones`: [{ label, icon: Component, onClick, destructivo?: bool }]
//
// El onSelect con preventDefault + setTimeout(…, 0) es obligatorio, no
// decorativo: cuando el ítem del menú abre OTRO modal (Editar/Duplicar abren
// el form de alta encima de este mismo detalle), Radix necesita terminar su
// propio cleanup de foco antes de que el nuevo Dialog tome el control — sin
// el setTimeout, aria-hidden/pointer-events:none quedan pegados en el <div
// #root> y la página entera se congela (mismo bug ya resuelto en
// HistorialVentas.jsx, documentado ahí).
function MenuAccionesDocumento({ acciones = [] }) {
  const visibles = acciones.filter(Boolean);
  if (visibles.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 dark:border-kx-border dark:text-slate-300"
          title="Más acciones"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-kx-surface border-kx-border text-kx-text text-sm w-48">
        {visibles.map((accion, i) => (
          <DropdownMenuItem
            key={i}
            onSelect={(e) => {
              e.preventDefault();
              setTimeout(() => accion.onClick(), 0);
            }}
            className={`gap-2 cursor-pointer ${accion.destructivo ? 'text-red-600 dark:text-red-400' : ''}`}
          >
            {accion.icon && <accion.icon className="h-3.5 w-3.5" />} {accion.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default MenuAccionesDocumento;
