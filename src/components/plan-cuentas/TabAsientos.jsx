import { useState } from 'react';
import { Plus, ChevronRight, FileText, Loader2, CheckCircle2, Ban, Eye, ChevronLeft } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { asientosService, PLAN_CUENTAS_KEYS } from '@/services/planCuentasService';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ESTADO_COLOR, fmt } from './shared';
import ModalNuevoAsiento from './ModalNuevoAsiento';

function TabAsientos({ empresaId, userId, cuentasFlat }) {
  const [page, setPage]             = useState(1);
  const [filtroEstado, setFiltro]   = useState('');
  const [showModal, setShowModal]   = useState(false);
  const [detalle, setDetalle]       = useState(null);
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
          className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
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

      {/* Modal detalle asiento */}
      <Dialog open={!!detalle} onOpenChange={() => setDetalle(null)}>
        <DialogContent className="bg-kx-surface border-kx-border text-kx-text max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText size={16} className="text-kx-blue" />
              Asiento {detalle?.numero}
              <span className={`ml-2 text-2xs px-2 py-0.5 rounded-full border font-medium ${ESTADO_COLOR[detalle?.estado]}`}>
                {detalle?.estado}
              </span>
            </DialogTitle>
            <DialogDescription>Líneas y detalle del asiento contable.</DialogDescription>
          </DialogHeader>
          {detalle && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-kx-text-2">Fecha:</span> <span className="text-kx-text">{new Date(detalle.fecha + 'T12:00:00').toLocaleDateString('es-AR')}</span></div>
                <div><span className="text-kx-text-2">Origen:</span> <span className="text-kx-text">{detalle.origen || 'manual'}</span></div>
                {detalle.descripcion && <div className="col-span-2"><span className="text-kx-text-2">Descripción:</span> <span className="text-kx-text">{detalle.descripcion}</span></div>}
              </div>
              <div className="rounded-lg border border-kx-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-kx-surface-2">
                    <tr>
                      <th className="px-3 py-2 text-left text-kx-text-3">Cuenta</th>
                      <th className="px-3 py-2 text-right text-kx-text-3">Debe</th>
                      <th className="px-3 py-2 text-right text-kx-text-3">Haber</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.asientos_items?.map((item) => (
                      <tr key={item.id} className="border-t border-kx-border">
                        <td className="px-3 py-1.5 text-kx-text-3">
                          <span className="font-mono text-kx-blue mr-2">{item.plan_cuentas?.codigo}</span>
                          {item.plan_cuentas?.nombre}
                          {item.descripcion && <span className="text-kx-text-2 ml-2">({item.descripcion})</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-kx-text-3">{item.debe > 0 ? fmt(item.debe) : '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-kx-text-3">{item.haber > 0 ? fmt(item.haber) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-kx-surface-2/50">
                    <tr>
                      <td className="px-3 py-2 text-kx-text-3 font-medium">Total</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-kx-text">{fmt(detalle.total_debe)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-kx-text">{fmt(detalle.total_haber)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
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
