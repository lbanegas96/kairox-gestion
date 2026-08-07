import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ClienteDrillDown from '@/components/shared/ClienteDrillDown';
import ClienteAltaRapidaModal from '@/components/shared/ClienteAltaRapidaModal';

/**
 * ClienteSelector — select de clientes + DrillDown + Alta Rápida.
 * props:
 *   clientes:        Cliente[]
 *   value:           string (cliente_id)
 *   onChange:        (clienteId: string) => void
 *   onClienteCreado: (cliente) => void  — opcional, para re-fetchear/seleccionar
 *   className:       string
 */
function ClienteSelector({ clientes = [], value, onChange, onClienteCreado, className = '' }) {
  const [isAltaOpen, setIsAltaOpen] = useState(false);

  const clienteSeleccionado = clientes.find(c => c.id === value) || null;

  // Bug real encontrado por Luciano probando el POS en vivo (07/08): cuando
  // el caller pasa `onClienteCreado` (como PanelCarrito.jsx, que ahí adentro
  // selecciona el cliente con el objeto completo), llamar ACÁ ADEMÁS a
  // `onChange(nuevoCliente.id)` disparaba una segunda actualización de estado
  // en la misma pasada — y esa segunda búsqueda (`clientes.find` en el caller)
  // corría contra el array `clientes` todavía viejo (el `setClientes` del
  // `onClienteCreado` es async, no se aplicó todavía), fallaba, y pisaba la
  // selección correcta con `null`. El `<select>` seguía mostrando el nombre
  // bien (porque el id sí quedaba guardado), pero el objeto de cliente
  // seleccionado quedaba en null — con Cuenta Corriente bloqueaba con un
  // warning; con cualquier otro medio de pago, la venta se confirmaba SIN
  // error pero atribuida a "Consumidor Final" en vez del cliente real.
  // Fix: si el caller pasa `onClienteCreado`, confiar en que ES quien
  // selecciona (así lo documenta el comentario de props de arriba) y no
  // duplicar la selección acá. `onChange` sólo se usa como fallback para
  // callers más simples que no necesiten re-fetchear la lista.
  const handleCreado = (nuevoCliente) => {
    if (onClienteCreado) {
      onClienteCreado(nuevoCliente);
    } else {
      onChange(nuevoCliente.id);
    }
  };

  return (
    <>
      <div className={`flex items-center gap-1 ${className}`}>
        <select
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          className="flex-1 h-10 rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface dark:text-kx-text px-3 text-sm"
        >
          <option value="">Sin cliente</option>
          {clientes.map(c => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>

        {/* DrillDown — solo si hay cliente seleccionado */}
        {clienteSeleccionado && (
          <ClienteDrillDown cliente={clienteSeleccionado} />
        )}

        {/* Alta Rápida */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-kx-text-2 hover:text-[rgb(var(--kx-violet))] shrink-0"
          onClick={() => setIsAltaOpen(true)}
          title="Alta rápida de cliente"
        >
          <UserPlus className="h-4 w-4" />
        </Button>
      </div>

      <ClienteAltaRapidaModal
        isOpen={isAltaOpen}
        onClose={() => setIsAltaOpen(false)}
        onCreated={handleCreado}
      />
    </>
  );
}

export default ClienteSelector;
