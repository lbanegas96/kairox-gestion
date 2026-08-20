import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getTodayAR } from '@/lib/dateUtils';
import { formatCurrency } from '@/lib/currencyUtils';
import { revalorizacionInventarioService, REVALORIZACION_INVENTARIO_KEYS } from '@/services/revalorizacionInventarioService';
import { asientosAutoService } from '@/services/planCuentasService';
import { ESTADOS_AJUSTE_INVENTARIO } from './shared';

function ModalDetalleRevalorizacion({ revalorizacionId, onOpenChange, onConfirmado }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [valores, setValores] = useState({}); // itemId -> string en edición
  const [confirmando, setConfirmando] = useState(false);
  // Congela el id al abrir el diálogo de confirmación — mismo bug real que en
  // ModalDetalleRecuento.jsx (ver comentario ahí): el Dialog exterior puede
  // cerrarse y nulear revalorizacionId por un pointerdown que Radix interpreta
  // como "afuera" al tocar el AlertDialog superpuesto (portals separados).
  const [confirmandoId, setConfirmandoId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: REVALORIZACION_INVENTARIO_KEYS.detail(revalorizacionId),
    queryFn: () => revalorizacionInventarioService.getById(revalorizacionId),
    enabled: !!revalorizacionId,
  });

  useEffect(() => { setValores({}); setSearch(''); }, [revalorizacionId]);

  const header = data?.header;
  const items = data?.items ?? [];
  const esBorrador = header?.estado === 'borrador';
  const cfg = header ? (ESTADOS_AJUSTE_INVENTARIO[header.estado] ?? ESTADOS_AJUSTE_INVENTARIO.borrador) : null;

  const itemsFiltrados = items.filter(i =>
    (i.productos?.nombre ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (i.productos?.codigo_sku ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const invalidarDetalle = () => qc.invalidateQueries({ queryKey: REVALORIZACION_INVENTARIO_KEYS.detail(revalorizacionId) });

  const handleGuardarFila = async (item) => {
    const raw = valores[item.id];
    if (raw === undefined) return;
    const nuevo = raw === '' ? null : parseFloat(raw);
    if (nuevo === item.costo_nuevo) return;
    try {
      await revalorizacionInventarioService.guardarCosto(item.id, Number.isNaN(nuevo) ? null : nuevo);
      invalidarDetalle();
    } catch (error) {
      toast({ title: 'Error al guardar el costo', description: error.message, variant: 'destructive' });
    }
  };

  const totalDiferencias = items.filter(i => i.costo_nuevo != null && Number(i.costo_nuevo) !== Number(i.costo_anterior)).length;

  const handleConfirmar = async () => {
    if (!confirmandoId) {
      toast({ title: 'Error al confirmar', description: 'No se encontró la revalorización a confirmar — cerrá y volvé a abrirla.', variant: 'destructive' });
      setConfirmando(false);
      return;
    }
    setIsSubmitting(true);
    try {
      const { total_perdida, total_ganancia } = await revalorizacionInventarioService.confirmar(confirmandoId);
      toast({ title: 'Revalorización confirmada', description: 'El costo del sistema ya refleja los nuevos valores.' });

      asientosAutoService.crearAsientoRevalorizacionInventario(user.empresa_id, user.id, {
        revalorizacionId: confirmandoId, numero: header.numero, totalPerdida: total_perdida, totalGanancia: total_ganancia,
        fecha: getTodayAR(),
      }).catch(e => {
        if (e.message?.startsWith('Período cerrado:')) {
          toast({ title: 'Asiento contable no generado', description: e.message, variant: 'destructive' });
        } else {
          console.warn('[Contabilidad] Asiento revalorización de inventario:', e.message);
        }
      });

      invalidarDetalle();
      onConfirmado?.();
    } catch (error) {
      toast({ title: 'Error al confirmar', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
      setConfirmando(false);
    }
  };

  return (
    <>
      <Dialog open={!!revalorizacionId} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border"
          onPointerDownOutside={(e) => { if (confirmando) e.preventDefault(); }}
          onInteractOutside={(e) => { if (confirmando) e.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Revalorización {header?.numero}
              {cfg && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
                  {cfg.label}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {header?.categorias?.nombre ?? 'Todo el catálogo activo'} — cargá el costo nuevo en cada
              línea, no toca stock, solo el costo unitario.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="p-10 text-center text-kx-text-3">Cargando...</div>
          ) : (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-kx-text-3" />
                <Input placeholder="Buscar producto..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>

              <div className="rounded-lg border border-kx-border dark:border-kx-border overflow-x-auto max-h-[400px]">
                <table className="w-full text-sm">
                  <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2 sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Producto</th>
                      <th className="p-2 text-right">Stock</th>
                      <th className="p-2 text-right">Costo Anterior</th>
                      <th className="p-2 text-right">Costo Nuevo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {itemsFiltrados.map(item => {
                      const valorActual = valores[item.id] ?? (item.costo_nuevo ?? '');
                      return (
                        <tr key={item.id}>
                          <td className="p-2 text-slate-700 dark:text-kx-text">{item.productos?.nombre}</td>
                          <td className="p-2 text-right font-mono">{item.stock_al_momento}</td>
                          <td className="p-2 text-right font-mono text-kx-text-2">{formatCurrency(item.costo_anterior)}</td>
                          <td className="p-2 text-right">
                            <Input
                              type="number" step="0.01" min="0" disabled={!esBorrador}
                              value={valorActual}
                              onChange={e => setValores(v => ({ ...v, [item.id]: e.target.value }))}
                              onBlur={() => handleGuardarFila(item)}
                              className="h-8 w-28 text-right font-mono ml-auto"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {esBorrador && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-kx-text-2">{totalDiferencias} línea(s) con cambio de costo</span>
                  <Button onClick={() => { setConfirmandoId(revalorizacionId); setConfirmando(true); }} disabled={totalDiferencias === 0} className="bg-blue-600 hover:bg-blue-700 text-white">
                    Confirmar Revalorización
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar la revalorización {header?.numero}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se va a actualizar el costo de {totalDiferencias} producto(s) y se va a generar un único
              asiento contable por la diferencia de valor. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmar} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ModalDetalleRevalorizacion;
