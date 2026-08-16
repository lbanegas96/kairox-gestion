import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';

// Buscador de producto con desplegable, compartido por los formularios de
// Cotización, Pedido y Orden de Compra.
//
// Bug real que resuelve (14/08, encontrado por Nadia probando Pedidos): el
// desplegable era un `absolute` dentro de la fila, y la lista de ítems tiene su
// propio `overflow-y-auto` (para que el resto del formulario no se mueva al
// cargar muchas líneas). Ese contenedor RECORTABA el desplegable: en pantallas
// bajas se veía apenas la primera sugerencia cortada al medio y no se podía
// elegir el producto. Los tres formularios compartían el mismo patrón, así que
// tenían el mismo problema.
//
// Fix: el desplegable se renderiza en un portal a <body> con `position: fixed`,
// así ningún contenedor con scroll lo puede recortar. Detalles:
//   · `pointer-events: auto` explícito — Radix Dialog apaga los eventos del
//     body mientras hay un modal abierto, y el portal queda fuera del diálogo.
//   · Se reposiciona ante scroll (en captura, para enterarse también de los
//     scrolls internos) y resize.
//   · Si no entra abajo, abre hacia arriba.
//   · `onMouseDown` con preventDefault para que el input no pierda el foco
//     antes de que el click llegue.
//
// El input sigue aceptando texto libre: si el ítem no está en el catálogo, se
// escribe la descripción a mano y el pedido se guarda igual (producto_id queda
// nulo, que es válido — un ítem de servicio no tiene producto de catálogo).

const ALTO_MAX = 224;   // igual que el max-h-56 que tenía el desplegable
const ALTO_FILA = 37;   // alto aproximado de cada sugerencia, para estimar
const MARGEN = 8;

function ProductoAutocomplete({
  inputRef,
  value,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  placeholder = 'Buscar producto o escribir descripción',
  className = 'h-8 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm',
  open,
  results = [],
  onSelect,
}) {
  const anclaRef = useRef(null);
  const [pos, setPos] = useState(null);

  const visible = open && results.length > 0;

  const recalcular = useCallback(() => {
    const el = anclaRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const espacioAbajo = window.innerHeight - r.bottom - MARGEN;
    const espacioArriba = r.top - MARGEN;
    const altoDeseado = Math.min(ALTO_MAX, results.length * ALTO_FILA + 2);
    // Sólo abre hacia arriba si abajo no entra y arriba hay más lugar.
    const haciaArriba = espacioAbajo < altoDeseado && espacioArriba > espacioAbajo;
    setPos({
      left: r.left,
      width: r.width,
      top: haciaArriba ? undefined : r.bottom + 4,
      bottom: haciaArriba ? window.innerHeight - r.top + 4 : undefined,
      maxHeight: Math.max(120, Math.min(ALTO_MAX, haciaArriba ? espacioArriba : espacioAbajo)),
    });
  }, [results.length]);

  useLayoutEffect(() => {
    if (!visible) { setPos(null); return; }
    recalcular();
  }, [visible, recalcular]);

  useEffect(() => {
    if (!visible) return;
    const alMoverse = () => recalcular();
    window.addEventListener('scroll', alMoverse, true);
    window.addEventListener('resize', alMoverse);
    return () => {
      window.removeEventListener('scroll', alMoverse, true);
      window.removeEventListener('resize', alMoverse);
    };
  }, [visible, recalcular]);

  return (
    <div ref={anclaRef} className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {visible && pos && createPortal(
        <div
          data-prod-dropdown
          style={{
            position: 'fixed',
            left: pos.left,
            width: pos.width,
            top: pos.top,
            bottom: pos.bottom,
            maxHeight: pos.maxHeight,
            pointerEvents: 'auto',
            zIndex: 100,
          }}
          className="overflow-y-auto bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-lg shadow-xl"
        >
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => onSelect(p)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-kx-surface-2 dark:hover:bg-slate-800 dark:text-kx-text flex justify-between items-center"
            >
              <span className="truncate">{p.nombre}</span>
              <span className="text-kx-text-3 text-xs ml-2 flex-shrink-0">
                ${Number(p.precio_venta ?? p.costo_compra ?? 0).toLocaleString('es-AR')}
              </span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export default ProductoAutocomplete;
