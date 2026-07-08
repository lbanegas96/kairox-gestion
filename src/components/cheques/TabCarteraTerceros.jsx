import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fmt, EstadoBadge, FechaVto, AccionesCheque } from './shared';

function TabCarteraTerceros({ cheques, onNuevo, onVerDetalle, onCambiarEstado }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={onNuevo} size="sm"
          className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
          <Plus size={14} className="mr-1" /> Registrar cheque recibido
        </Button>
      </div>
      <div className="rounded-2xl border border-kx-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-kx-surface-2 border-b border-kx-border">
            <tr>
              <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Nro.</th>
              <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Banco</th>
              <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Recibido de</th>
              <th className="px-4 py-3 text-right text-kx-text-3 font-medium">Monto</th>
              <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Vencimiento</th>
              <th className="px-4 py-3 text-center text-kx-text-3 font-medium">Estado</th>
              <th className="px-4 py-3 text-center text-kx-text-3 font-medium">Acción</th>
            </tr>
          </thead>
          <tbody>
            {cheques.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-kx-text-3">
                No hay cheques de terceros registrados
              </td></tr>
            )}
            {cheques.map(c => (
              <tr key={c.id} className={`border-t border-kx-border transition-colors
                ${c.estado === 'rechazado' ? 'bg-red-500/5' : 'hover:bg-kx-surface-2'}`}>
                <td className="px-4 py-3 font-mono text-xs text-kx-blue">{c.numero}</td>
                <td className="px-4 py-3 text-kx-text-2 text-xs">{c.banco}</td>
                <td className="px-4 py-3 text-kx-text">{c.clientes?.nombre ?? '—'}</td>
                <td className="px-4 py-3 text-right font-mono font-medium text-kx-text">{fmt(c.monto)}</td>
                <td className="px-4 py-3"><FechaVto fecha={c.fecha_vencimiento} estado={c.estado} /></td>
                <td className="px-4 py-3 text-center"><EstadoBadge estado={c.estado} /></td>
                <td className="px-4 py-3 text-center">
                  <AccionesCheque cheque={c} onVerDetalle={onVerDetalle} onCambiarEstado={onCambiarEstado} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TabCarteraTerceros;
