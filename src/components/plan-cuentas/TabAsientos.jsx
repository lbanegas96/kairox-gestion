import { useState } from 'react';
import { Plus, ChevronRight, Loader2, CheckCircle2, Ban, Eye, ChevronLeft, Undo2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { asientosService, PLAN_CUENTAS_KEYS } from '@/services/planCuentasService';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ESTADO_COLOR, fmt } from './shared';
import ModalNuevoAsiento from './ModalNuevoAsiento';
import ModalDetalleAsiento from '@/components/shared/ModalDetalleAsiento';

const MOTIVO_MIN = 5;

function TabAsientos({ empresaId, userId, cuentasFlat, userRole }) {
  const [page, setPage]             = useState(1);
  const [filtroEstado, setFiltro]   = useState('');
  const [showModal, setShowModal]   = useState(false);
  const [detalle, setDetalle]       = useState(null);
  // Reversa de un asiento confirmado (mig.410): solo administradores.
  const [reversar, setReversar]     = useState(null);
  const [motivo, setMotivo]         = useState('');
  const [reversando, setReversando] = useState(false);
  const esAdmin = userRole === 'admin';
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.asientos(empresaId, { page, estado: filtroEstado }),
    queryFn: () => asientosService.getAsientos(empresaId, { page, pageSize: 20, estado: filtroEstado || undefined }),
    enabled: !!empresaId,
  });

  const handleConfirmar = async (id) => {
    try {
      await asientosService.confirmarAsiento(id);
      qc.invalidateQueries({ queryKey: ['asientos', empresaId] });
      qc.invalidateQueries({ queryKey: ['plan_cuentas', empresaId] });
      toast({ title: 'Asiento confirmado', className: 'bg-green-900 border-green-700 text-white' });
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleAnular = async (id) => {
    try {
      await asientosService.anularAsiento(id);
      qc.invalidateQueries({ queryKey: ['asientos', empresaId] });
      qc.invalidateQueries({ queryKey: ['plan_cuentas', empresaId] });
      toast({ title: 'Asiento anulado' });
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const cerrarReversa = () => { setReversar(null); setMotivo(''); };

  const handleReversar = async () => {
    if (!reversar || motivo.trim().length < MOTIVO_MIN) return;
    setReversando(true);
    try {
      const r = await asientosService.reversarAsiento(reversar.id, motivo.trim());
      qc.invalidateQueries({ queryKey: ['asientos', empresaId] });
      qc.invalidateQueries({ queryKey: ['plan_cuentas', empresaId] });
      toast({
        title: `Asiento ${r.reversa_de} reversado`,
        description: `Se generó el contra-asiento ${r.numero}.`,
        className: 'bg-green-900 border-green-700 text-white',
      });
      cerrarReversa();
    } catch (e) {
      // Los errores de la base ya vienen escritos para el usuario (ya reversado, pertenece a un documento, período cerrado…).
      toast({ title: 'No se pudo reversar', description: e.message, variant: 'destructive' });
    } finally {
      setReversando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={filtroEstado} onValueChange={(v) => { setFiltro(v === 'todos' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-40 bg-kx-surface-2 border-kx-border h-9 text-sm">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent className="bg-kx-surface-2 border-kx-border">
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="borrador">Borrador</SelectItem>
            <SelectItem value="confirmado">Confirmados</SelectItem>
            <SelectItem value="anulado">Anulados</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <Button onClick={() => setShowModal(true)} size="sm"
          className="bg-kx-violet text-white hover:opacity-90">
          <Plus size={14} className="mr-1" /> Nuevo asiento
        </Button>
      </div>

      <div className="rounded-xl border border-kx-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-kx-surface-2">
            <tr>
              <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Nº</th>
              <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Fecha</th>
              <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Descripción</th>
              <th className="px-4 py-3 text-right text-kx-text-3 font-medium">Debe</th>
              <th className="px-4 py-3 text-right text-kx-text-3 font-medium">Haber</th>
              <th className="px-4 py-3 text-center text-kx-text-3 font-medium">Estado</th>
              <th className="px-4 py-3 text-center text-kx-text-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="text-center py-12 text-kx-text-2">
                <Loader2 size={20} className="animate-spin mx-auto" />
              </td></tr>
            )}
            {!isLoading && data?.data?.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-kx-text-2">
                No hay asientos
              </td></tr>
            )}
            {data?.data?.map((a) => (
              <tr key={a.id} className="border-t border-kx-border hover:bg-kx-surface-2/30 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-kx-blue">{a.numero}</td>
                <td className="px-4 py-3 text-kx-text-3">{new Date(a.fecha + 'T12:00:00').toLocaleDateString('es-AR')}</td>
                <td className="px-4 py-3 text-kx-text-3 max-w-xs truncate">{a.descripcion || '—'}</td>
                <td className="px-4 py-3 text-right font-mono text-kx-text-3">{fmt(a.total_debe)}</td>
                <td className="px-4 py-3 text-right font-mono text-kx-text-3">{fmt(a.total_haber)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-2xs px-2 py-0.5 rounded-full border font-medium ${ESTADO_COLOR[a.estado]}`}>
                    {a.estado}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => setDetalle(a)}
                      className="p-1.5 rounded text-kx-text-3 hover:text-kx-text hover:bg-kx-surface-2 transition-colors" title="Ver detalle">
                      <Eye size={14} />
                    </button>
                    {a.estado === 'borrador' && (
                      <>
                        <button onClick={() => handleConfirmar(a.id)}
                          className="p-1.5 rounded text-kx-text-3 hover:text-kx-green hover:bg-kx-green/10 transition-colors" title="Confirmar">
                          <CheckCircle2 size={14} />
                        </button>
                        <button onClick={() => handleAnular(a.id)}
                          className="p-1.5 rounded text-kx-text-3 hover:text-kx-red hover:bg-kx-red/10 transition-colors" title="Anular">
                          <Ban size={14} />
                        </button>
                      </>
                    )}
                    {esAdmin && a.estado === 'confirmado' && !String(a.origen ?? '').startsWith('reversa_asiento') && (
                      <button onClick={() => setReversar(a)}
                        className="p-1.5 rounded text-kx-text-3 hover:text-kx-amber hover:bg-kx-amber/10 transition-colors"
                        title="Reversar (crea un contra-asiento)" aria-label={`Reversar asiento ${a.numero}`}>
                        <Undo2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-kx-text-3">
          <span>{data.count} asientos</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={14} />
            </Button>
            <span>Pág {page} de {data.pages}</span>
            <Button variant="ghost" size="sm" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Modal detalle asiento — compartido con VerAsientoButton (resto del ERP) */}
      <ModalDetalleAsiento asiento={detalle} open={!!detalle} onOpenChange={() => setDetalle(null)} />

      {/* Reversar un asiento confirmado: contra-asiento con un motivo escrito (mig.410, solo administradores) */}
      <Dialog open={!!reversar} onOpenChange={(o) => { if (!o && !reversando) cerrarReversa(); }}>
        <DialogContent className="max-w-md bg-kx-surface border-kx-border text-kx-text">
          <DialogHeader>
            <DialogTitle>Reversar el asiento {reversar?.numero}</DialogTitle>
            <DialogDescription className="text-kx-text-2 text-sm">
              Se crea un contra-asiento con las mismas líneas y el debe y el haber invertidos, con fecha de hoy. El asiento original
              no se borra. Si el asiento pertenece a una venta, compra, cobro u otro documento, cancelá el documento: la reversa se genera sola.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="motivo-reversa" className="text-xs text-kx-text-2">Motivo (obligatorio)</Label>
            <Textarea
              id="motivo-reversa"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: asiento duplicado por error de carga"
              rows={3}
              className="bg-kx-surface-2 border-kx-border"
            />
            {motivo.trim().length > 0 && motivo.trim().length < MOTIVO_MIN && (
              <p className="text-xs text-kx-amber">Escribí al menos {MOTIVO_MIN} caracteres.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={cerrarReversa} disabled={reversando}>Cancelar</Button>
            <Button
              onClick={handleReversar}
              disabled={reversando || motivo.trim().length < MOTIVO_MIN}
              className="bg-kx-amber text-white hover:opacity-90"
            >
              {reversando ? <Loader2 size={14} className="animate-spin mr-1" /> : <Undo2 size={14} className="mr-1" />}
              Reversar asiento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ModalNuevoAsiento
        open={showModal}
        onClose={() => setShowModal(false)}
        cuentasFlat={cuentasFlat}
        empresaId={empresaId}
        userId={userId}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['asientos', empresaId] });
          qc.invalidateQueries({ queryKey: ['plan_cuentas', empresaId] });
        }}
      />
    </div>
  );
}

export default TabAsientos;
