import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calculator, Loader2, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { indicesInflacionService } from '@/services/ajusteInflacionService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const formatPeriodo = (periodo) => {
  const [y, m] = periodo.split('-');
  return `${MESES[Number(m) - 1]} ${y}`;
};

// Carga manual del índice IPC mensual — Ajuste por Inflación (RT 6, mig.378).
// FACPCE no publica una API oficial (a diferencia del TC, que sí tiene sync
// automático vía tc-diario-sync) — mismo criterio de "coeficiente que varía
// por fecha" que Moneda Paralela, pero acá no hay forma de automatizarlo.
function IndicesInflacionCard() {
  const { user } = useAuth();
  const empresaId = user?.empresa_id;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mes, setMes] = useState('');
  const [indice, setIndice] = useState('');

  const { data: indices = [], isLoading } = useQuery({
    queryKey: ['indices_inflacion', empresaId],
    queryFn: () => indicesInflacionService.getIndices(empresaId),
    enabled: !!empresaId,
  });

  const upsertMutation = useMutation({
    mutationFn: () => indicesInflacionService.upsertIndice(empresaId, `${mes}-01`, Number(indice)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['indices_inflacion', empresaId] });
      setMes('');
      setIndice('');
      toast({ title: 'Índice guardado', className: 'bg-green-600 text-white border-none' });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const eliminarMutation = useMutation({
    mutationFn: (id) => indicesInflacionService.eliminarIndice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['indices_inflacion', empresaId] }),
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
          <Calculator className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Índices de Inflación (IPC)</h3>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
            Un valor por mes, publicado por FACPCE (sin API oficial — se carga a mano). Lo usa el
            <strong> Ajuste por Inflación</strong> para calcular el coeficiente de reexpresión de cada mes.
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (mes && indice) upsertMutation.mutate(); }}
        className="flex items-end gap-3 flex-wrap mb-5 p-4 bg-kx-surface-2 dark:bg-slate-900/50 rounded-lg border kairox-border"
      >
        <div>
          <Label className="text-xs text-kx-text-3">Mes</Label>
          <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)}
            className="h-9 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" required />
        </div>
        <div>
          <Label className="text-xs text-kx-text-3">Índice</Label>
          <Input type="number" step="0.0001" min="0" value={indice} onChange={(e) => setIndice(e.target.value)}
            placeholder="ej. 127.6" className="h-9 w-32 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" required />
        </div>
        <Button type="submit" size="sm" disabled={upsertMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white h-9">
          {upsertMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Cargar</>}
        </Button>
      </form>

      {isLoading ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      ) : indices.length === 0 ? (
        <p className="text-sm text-kx-text-3 py-4 text-center">Sin índices cargados todavía.</p>
      ) : (
        <div className="border border-kx-border rounded-xl overflow-hidden">
          {indices.map((i) => (
            <div key={i.id} className="flex items-center justify-between px-4 py-2.5 border-b border-kx-border last:border-0">
              <span className="text-sm font-medium text-kx-text capitalize">{formatPeriodo(i.periodo)}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm text-kx-text-2 font-mono tabular-nums">{Number(i.indice).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                <Button size="sm" variant="ghost" onClick={() => eliminarMutation.mutate(i.id)} className="text-kx-text-3 hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default IndicesInflacionCard;
