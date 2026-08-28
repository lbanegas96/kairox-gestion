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
import { recuentoInventarioService, RECUENTO_INVENTARIO_KEYS } from '@/services/recuentoInventarioService';
import { asientosAutoService } from '@/services/planCuentasService';
import VerAsientoButton from '@/components/shared/VerAsientoButton';
import { ESTADOS_AJUSTE_INVENTARIO } from './shared';

function ModalDetalleRecuento({ recuentoId, onOpenChange, onConfirmado }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [valores, setValores] = useState({}); // itemId -> string en edición
  const [confirmando, setConfirmando] = useState(false);
  // Congela el id al abrir el diálogo de confirmación — el Dialog exterior puede
  // cerrarse (y nulear recuentoId vía onOpenChange) por un pointerdown que Radix
  // interpreta como "afuera" al interactuar con el AlertDialog superpuesto (portals
  // separados). Bug real encontrado en producción 20/08: sin este freeze, el RPC
  // se llamaba con p_recuento_id=null y fallaba con "Recuento no encontrado" —
  // confirmado viendo el body real del request en los logs de Supabase (22 bytes,
  // exactamente {"p_recuento_id":null}) mientras la misma llamada con el id real
  // funcionaba perfecto. Ver también el guard onPointerDownOutside más abajo.
  const [confirmandoId, setConfirmandoId] = useState(null);
  // Mismo patrón de freeze para "Anular" — comparte el AlertDialog exterior
  // (portal separado del Dialog principal), mismo riesgo de perder el id.
  const [anulando, setAnulando] = useState(false);
  const [anulandoId, setAnulandoId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: RECUENTO_INVENTARIO_KEYS.detail(recuentoId),
    queryFn: () => recuentoInventarioService.getById(recuentoId),
    enabled: !!recuentoId,
  });

  useEffect(() => { setValores({}); setSearch(''); }, [recuentoId]);

  const header = data?.header;
  const items = data?.items ?? [];
  const esBorrador = header?.estado === 'borrador';
  const cfg = header ? (ESTADOS_AJUSTE_INVENTARIO[header.estado] ?? ESTADOS_AJUSTE_INVENTARIO.borrador) : null;

  const itemsFiltrados = items.filter(i =>
    (i.productos?.nombre ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (i.productos?.codigo_sku ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const invalidarDetalle = () => qc.invalidateQueries({ queryKey: RECUENTO_INVENTARIO_KEYS.detail(recuentoId) });

  const handleGuardarFila = async (item) => {
    const raw = valores[item.id];
    if (raw === undefined) return; // no se tocó
    const nuevo = raw === '' ? null : parseInt(raw, 10);
    if (nuevo === item.cantidad_contada) return;
    try {
      await recuentoInventarioService.guardarConteo(item.id, Number.isNaN(nuevo) ? null : nuevo);
      invalidarDetalle();
    } catch (error) {
      toast({ title: 'Error al guardar el conteo', description: error.message, variant: 'destructive' });
    }
  };

  // Cuenta sobre lo que el usuario está tipeando (valores), no solo sobre lo
  // ya guardado (items) — antes el contador se quedaba atrás hasta el blur
  // del campo, aunque la columna "Diferencia" de cada fila sí se actualizaba
  // al tipear (hallazgo auditoría Ferretería NADIA, 28/08). No es un bug de
  // datos: confirmar_recuento_inventario lee los valores reales guardados,
  // no este contador — esto solo corrige lo que se muestra en pantalla.
  const cantidadEfectiva = (i) => {
    const raw = valores[i.id];
    if (raw === undefined) return i.cantidad_contada;
    if (raw === '') return null;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
  };
  const totalDiferencias = items.filter(i => {
    const c = cantidadEfectiva(i);
    return c != null && c !== i.stock_sistema;
  }).length;

  const handleConfirmar = async () => {
    if (!confirmandoId) {
      toast({ title: 'Error al confirmar', description: 'No se encontró el recuento a confirmar — cerrá y volvé a abrirlo.', variant: 'destructive' });
      setConfirmando(false);
      return;
    }
    setIsSubmitting(true);
    try {
      const { total_faltante, total_sobrante } = await recuentoInventarioService.confirmar(confirmandoId);
      toast({ title: 'Recuento confirmado', description: 'El stock del sistema ya refleja el conteo físico.' });

      asientosAutoService.crearAsientoRecuentoInventario(user.empresa_id, user.id, {
        recuentoId: confirmandoId, numero: header.numero, totalFaltante: total_faltante, totalSobrante: total_sobrante,
        fecha: getTodayAR(),
      }).catch(e => {
        if (e.message?.startsWith('Período cerrado:')) {
          toast({ title: 'Asiento contable no generado', description: e.message, variant: 'destructive' });
        } else {
          console.warn('[Contabilidad] Asiento recuento de inventario:', e.message);
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

  const handleAnular = async () => {
    if (!anulandoId) {
      toast({ title: 'Error al anular', description: 'No se encontró el recuento a anular — cerrá y volvé a abrirlo.', variant: 'destructive' });
      setAnulando(false);
      return;
    }
    setIsSubmitting(true);
    try {
      await recuentoInventarioService.anular(anulandoId);
      toast({ title: 'Recuento anulado', description: 'No se aplicó ningún cambio de stock — el recuento queda descartado.' });
      invalidarDetalle();
      onConfirmado?.(); // callback genérico del padre: refresca el listado (no es exclusivo de "confirmar")
    } catch (error) {
      toast({ title: 'Error al anular', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
      setAnulando(false);
    }
  };

  return (
    <>
      <Dialog open={!!recuentoId} onOpenChange={onOpenChange}>
        {/* size="wide" — mismo shell que el resto (hallazgo Luciano 22/08, antes 800px propio). */}
        <DialogContent
          size="wide"
          className="bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border"
          onPointerDownOutside={(e) => { if (confirmando || anulando) e.preventDefault(); }}
          onInteractOutside={(e) => { if (confirmando || anulando) e.preventDefault(); }}
        >
          <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-kx-border dark:border-kx-border">
            <DialogTitle className="flex items-center gap-2">
              Recuento {header?.numero}
              {cfg && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
                  {cfg.label}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {header?.categorias?.nombre ?? 'Todo el catálogo activo'} — cargá lo contado físicamente
              en cada línea, la columna Diferencia se calcula sola.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="p-10 text-center text-kx-text-3">Cargando...</div>
          ) : (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-kx-text-3" />
                  <Input placeholder="Buscar producto..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                </div>
                <VerAsientoButton asientoId={header?.asiento_id} />
              </div>

              <div className="rounded-lg border border-kx-border dark:border-kx-border overflow-x-auto max-h-[400px]">
                <table className="w-full text-sm">
                  <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2 sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Producto</th>
                      <th className="p-2 text-right">Sistema</th>
                      <th className="p-2 text-right">Contado</th>
                      <th className="p-2 text-right">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {itemsFiltrados.map(item => {
                      const valorActual = valores[item.id] ?? (item.cantidad_contada ?? '');
                      const contado = valorActual === '' ? null : parseInt(valorActual, 10);
                      const diferencia = contado != null && !Number.isNaN(contado) ? contado - item.stock_sistema : null;
                      return (
                        <tr key={item.id}>
                          <td className="p-2 text-slate-700 dark:text-kx-text">{item.productos?.nombre}</td>
                          <td className="p-2 text-right font-mono">{item.stock_sistema}</td>
                          <td className="p-2 text-right">
                            <Input
                              type="number" step="1" min="0" disabled={!esBorrador}
                              value={valorActual}
                              onChange={e => setValores(v => ({ ...v, [item.id]: e.target.value }))}
                              onBlur={() => handleGuardarFila(item)}
                              className="h-8 w-24 text-right font-mono ml-auto"
                            />
                          </td>
                          <td className={`p-2 text-right font-mono font-bold ${diferencia == null ? 'text-kx-text-3' : diferencia < 0 ? 'text-red-600' : diferencia > 0 ? 'text-green-600' : 'text-kx-text-3'}`}>
                            {diferencia == null ? '—' : diferencia > 0 ? `+${diferencia}` : diferencia}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {esBorrador && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-kx-text-2">{totalDiferencias} línea(s) con diferencia</span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => { setAnulandoId(recuentoId); setAnulando(true); }}
                      className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      Anular
                    </Button>
                    <Button onClick={() => { setConfirmandoId(recuentoId); setConfirmando(true); }} disabled={totalDiferencias === 0} className="bg-blue-600 hover:bg-blue-700 text-white">
                      Confirmar Recuento
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar el recuento {header?.numero}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se van a aplicar las {totalDiferencias} diferencia(s) al stock del sistema y se va a generar
              un único asiento contable por el total. Esta acción no se puede deshacer.
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

      <AlertDialog open={anulando} onOpenChange={setAnulando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular el recuento {header?.numero}?</AlertDialogTitle>
            <AlertDialogDescription>
              El recuento queda descartado y no se aplica ningún cambio de stock — como si nunca
              se hubiera hecho. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAnular}
              disabled={isSubmitting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Anular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ModalDetalleRecuento;
