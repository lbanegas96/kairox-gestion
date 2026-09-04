import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Percent, Loader2, RefreshCw, Check, ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { listaPreciosService } from '@/services/listaPreciosService';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

// Fase B de Listas de Precio (02/09) — la lista "base" que alimenta
// productos.precio_venta automáticamente en cada compra (costo × factor de
// su categoría). Distinta de las listas secundarias (Mayorista, VIP): esta
// es LA que ve todo el sistema por defecto (Modo Caja incluido). Al elegirla
// por primera vez, Luciano pidió explícitamente recalcular todo el catálogo
// activo de una sola vez -- de ahí en más se mantiene sola con cada compra,
// sin que nadie tenga que tocar nada.
function ListaPrecioBaseCard() {
  const { user } = useAuth();
  const empresaId = user?.empresa_id;
  const { toast } = useToast();
  const qc = useQueryClient();

  const [pendingListaId, setPendingListaId] = useState(null); // confirmación pendiente
  const [recalcModal, setRecalcModal] = useState(false);
  const [preview, setPreview] = useState(null);

  const { data: listas = [], isLoading: loadingListas } = useQuery({
    queryKey: ['listas_precio_factor', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listas_precio')
        .select('id, nombre')
        .eq('empresa_id', empresaId)
        .eq('tipo', 'factor')
        .eq('activo', true)
        .order('nombre');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  const { data: listaBaseId, isLoading: loadingBase } = useQuery({
    queryKey: ['lista_precio_base', empresaId],
    queryFn: () => listaPreciosService.getListaBaseId(empresaId),
    enabled: !!empresaId,
  });

  const setBase = useMutation({
    mutationFn: (listaId) => listaPreciosService.setListaBase(empresaId, listaId),
    onSuccess: (_data, listaId) => {
      qc.invalidateQueries({ queryKey: ['lista_precio_base', empresaId] });
      toast({
        title: listaId ? 'Lista base activada ✓' : 'Lista base desactivada',
        className: 'bg-green-600 text-white border-none',
      });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const previewRecalculo = useMutation({
    mutationFn: () => listaPreciosService.recalcularCatalogoBase(pendingListaId, false),
    onSuccess: (items) => setPreview(items),
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const aplicarRecalculo = useMutation({
    mutationFn: () => listaPreciosService.recalcularCatalogoBase(pendingListaId, true),
    onSuccess: (items) => {
      toast({
        title: 'Catálogo recalculado ✓',
        description: `${items.length} producto${items.length !== 1 ? 's' : ''} actualizado${items.length !== 1 ? 's' : ''}`,
        className: 'bg-green-600 text-white border-none',
      });
      setRecalcModal(false);
      setPreview(null);
      setPendingListaId(null);
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const handleChange = (value) => {
    if (value === 'none') {
      setBase.mutate(null);
      return;
    }
    setPendingListaId(value);
  };

  const confirmarActivacion = async () => {
    await setBase.mutateAsync(pendingListaId);
    setPreview(null);
    setRecalcModal(true);
    previewRecalculo.mutate();
  };

  const listaBaseNombre = listas.find(l => l.id === listaBaseId)?.nombre;

  return (
    <>
      <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
            <Percent className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Lista de Precios Base (Modo Caja)</h3>
            <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
              Elegí una lista "Por Factor" (Listas de Precios → Nueva lista) para que el precio de venta
              del catálogo se recalcule solo (costo × factor) cada vez que comprás mercadería.
            </p>
          </div>
        </div>

        {loadingListas || loadingBase ? (
          <div className="flex items-center gap-2 text-kx-text-3 py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
          </div>
        ) : listas.length === 0 ? (
          <p className="text-sm text-kx-text-3 py-4 px-4 bg-kx-surface-2 dark:bg-slate-900/50 rounded-lg border kairox-border">
            Todavía no tenés ninguna lista "Por Factor" activa. Creá una primero en Listas de Precios.
          </p>
        ) : (
          <div className="space-y-2 max-w-sm">
            <Label className="text-slate-700 dark:text-slate-300">Lista base</Label>
            <Select value={listaBaseId ?? 'none'} onValueChange={handleChange} disabled={setBase.isPending}>
              <SelectTrigger className="h-9 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ninguna — precio de venta se sigue editando a mano</SelectItem>
                {listas.map(l => (
                  <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-kx-text-3">
              {listaBaseNombre
                ? `Activo: "${listaBaseNombre}" — el catálogo se actualiza solo en cada compra.`
                : 'Sin lista base — comportamiento de siempre.'}
            </p>
          </div>
        )}
      </div>

      {/* Confirmación al ACTIVAR (no al desactivar, eso no toca nada) */}
      <AlertDialog open={!!pendingListaId} onOpenChange={(open) => { if (!open) setPendingListaId(null); }}>
        <AlertDialogContent className="dark:bg-kx-bg dark:border-kx-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 dark:text-kx-text">
              <Percent className="w-4 h-4 text-blue-500" /> Activar lista base
            </AlertDialogTitle>
            <AlertDialogDescription className="dark:text-kx-text-2">
              De ahora en más, el precio de venta de cada producto se va a recalcular solo (costo ×
              factor) cada vez que registres una compra. Para que el catálogo actual quede al día,
              vamos a recalcular TODOS los productos activos ahora mismo — te muestro una vista previa
              antes de confirmar, no se guarda nada todavía.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="dark:text-kx-text dark:border-kx-border">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarActivacion} className="bg-blue-600 hover:bg-blue-700 text-white">
              <ArrowRight className="w-4 h-4 mr-2" /> Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Preview + aplicar del recálculo inicial de todo el catálogo */}
      <Dialog open={recalcModal} onOpenChange={(open) => { if (!aplicarRecalculo.isPending) { setRecalcModal(open); if (!open) { setPreview(null); setPendingListaId(null); } } }}>
        <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-blue-500" /> Recalcular catálogo completo
            </DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              Vista previa del precio de venta nuevo para cada producto activo. Nada se guarda hasta que confirmes.
            </DialogDescription>
          </DialogHeader>

          {previewRecalculo.isPending || !preview ? (
            <div className="flex-1 flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-kx-text-3" />
            </div>
          ) : preview.length === 0 ? (
            <p className="text-center text-kx-text-3 py-8 text-sm">
              Ningún producto tiene un factor aplicable — cargá al menos un factor por defecto en esta lista.
            </p>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto border border-kx-border dark:border-kx-border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2 sticky top-0">
                    <tr>
                      <th className="p-2.5 text-left">Producto</th>
                      <th className="p-2.5 text-right">Costo</th>
                      <th className="p-2.5 text-right">Actual</th>
                      <th className="p-2.5 text-center w-8"></th>
                      <th className="p-2.5 text-right">Nuevo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {preview.map(item => (
                      <tr key={item.producto_id}>
                        <td className="p-2.5 text-kx-text dark:text-kx-text truncate max-w-[180px]">{item.nombre}</td>
                        <td className="p-2.5 text-right text-kx-text-3 tabular-nums">${Number(item.costo_compra).toLocaleString('es-AR')}</td>
                        <td className="p-2.5 text-right text-kx-text-3 tabular-nums">${Number(item.precio_actual).toLocaleString('es-AR')}</td>
                        <td className="p-2.5 text-center"><ArrowRight className="w-3.5 h-3.5 text-kx-text-3 inline" /></td>
                        <td className="p-2.5 text-right font-semibold text-kx-green tabular-nums">${Number(item.precio_nuevo).toLocaleString('es-AR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <DialogFooter className="pt-2 border-t border-kx-border dark:border-kx-border">
                <span className="text-xs text-kx-text-3 mr-auto self-center">{preview.length} producto{preview.length !== 1 ? 's' : ''}</span>
                <Button
                  onClick={() => aplicarRecalculo.mutate()}
                  disabled={aplicarRecalculo.isPending}
                  className="bg-kx-green hover:bg-green-700 text-white gap-2"
                >
                  {aplicarRecalculo.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Aplicar a {preview.length} producto{preview.length !== 1 ? 's' : ''}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ListaPrecioBaseCard;
