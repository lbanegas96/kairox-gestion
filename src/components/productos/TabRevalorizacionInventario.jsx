import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateAR } from '@/lib/dateUtils';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { revalorizacionInventarioService, REVALORIZACION_INVENTARIO_KEYS } from '@/services/revalorizacionInventarioService';
import { ESTADOS_AJUSTE_INVENTARIO } from './shared';
import ModalNuevaRevalorizacion from './ModalNuevaRevalorizacion';
import ModalDetalleRevalorizacion from './ModalDetalleRevalorizacion';

function TabRevalorizacionInventario({ categories = [] }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [isNuevoOpen, setIsNuevoOpen] = useState(false);
  const [detalleId, setDetalleId] = useState(null);

  const { data: revalorizaciones = [], isLoading } = useQuery({
    queryKey: REVALORIZACION_INVENTARIO_KEYS.list(user?.empresa_id),
    queryFn: () => revalorizacionInventarioService.getAll(user.empresa_id),
    enabled: !!user?.empresa_id,
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: REVALORIZACION_INVENTARIO_KEYS.list(user?.empresa_id) });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500 dark:text-kx-text-2">
          Actualiza el costo unitario de productos en stock — no mueve cantidad, solo valor.
        </p>
        <Button onClick={() => setIsNuevoOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" /> Nueva Revalorización
        </Button>
      </div>

      <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2">
            <tr>
              <th className="p-4 text-left">N° Revalorización</th>
              <th className="p-4 text-left">Fecha</th>
              <th className="p-4 text-left">Alcance</th>
              <th className="p-4 text-left">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? (
              <tr><td colSpan={4} className="p-10 text-center text-kx-text-3">Cargando...</td></tr>
            ) : revalorizaciones.length === 0 ? (
              <tr><td colSpan={4} className="p-10 text-center text-kx-text-3">
                <div className="flex flex-col items-center gap-2">
                  <TrendingUp className="w-8 h-8 opacity-30" />
                  <span>No hay revalorizaciones de inventario</span>
                </div>
              </td></tr>
            ) : revalorizaciones.map(r => {
              const cfg = ESTADOS_AJUSTE_INVENTARIO[r.estado] ?? ESTADOS_AJUSTE_INVENTARIO.borrador;
              const Icon = cfg.icon;
              return (
                <tr key={r.id} onClick={() => setDetalleId(r.id)}
                  className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40 transition-colors cursor-pointer">
                  <td className="p-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">{r.numero}</td>
                  <td className="p-4 text-slate-500 dark:text-kx-text-2">{formatDateAR(r.fecha)}</td>
                  <td className="p-4 text-slate-700 dark:text-kx-text">{r.categorias?.nombre ?? 'Todo el catálogo'}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
                      <Icon className="w-3 h-3" /> {cfg.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ModalNuevaRevalorizacion
        open={isNuevoOpen} onOpenChange={setIsNuevoOpen}
        categories={categories}
        onCreated={(id) => { invalidar(); setIsNuevoOpen(false); setDetalleId(id); }}
      />

      <ModalDetalleRevalorizacion
        revalorizacionId={detalleId}
        onOpenChange={(open) => { if (!open) setDetalleId(null); }}
        onConfirmado={() => { invalidar(); }}
      />
    </div>
  );
}

export default TabRevalorizacionInventario;
