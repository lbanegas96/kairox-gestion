import React, { useState } from 'react';
import { Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProveedorDrillDown from '@/components/shared/ProveedorDrillDown';
import ProveedorAltaRapidaModal from '@/components/shared/ProveedorAltaRapidaModal';

function ProveedorSelector({ proveedores = [], value, onChange, onProveedorCreado, className = '' }) {
  const [isAltaOpen, setIsAltaOpen] = useState(false);

  const proveedorSeleccionado = proveedores.find(p => p.id === value) || null;

  const handleCreado = (nuevoProveedor) => {
    onProveedorCreado?.(nuevoProveedor);
    onChange(nuevoProveedor.id);
  };

  return (
    <>
      <div className={`flex items-center gap-1 ${className}`}>
        <select
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          className="flex-1 h-10 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white px-3 text-sm"
        >
          <option value="">Sin proveedor</option>
          {proveedores.map(p => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>

        {proveedorSeleccionado && (
          <ProveedorDrillDown proveedor={proveedorSeleccionado} />
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-kx-text-2 hover:text-[rgb(var(--kx-violet))] shrink-0"
          onClick={() => setIsAltaOpen(true)}
          title="Alta rápida de proveedor"
        >
          <Truck className="h-4 w-4" />
        </Button>
      </div>

      <ProveedorAltaRapidaModal
        isOpen={isAltaOpen}
        onClose={() => setIsAltaOpen(false)}
        onCreated={handleCreado}
      />
    </>
  );
}

export default ProveedorSelector;
