import React, { useState } from 'react';
import { Plus, ChevronRight, FileText, Loader2, CheckCircle2, Ban, Eye, ChevronLeft } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { asientosService, PLAN_CUENTAS_KEYS } from '@/services/planCuentasService';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ESTADO_COLOR, fmt } from './shared';
import ModalNuevoAsiento from './ModalNuevoAsiento';

function TabAsientos({ empresaId, userId, cuentasFlat, onRefresh }) {
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
          <SelectTrigger className="w-40 bg-slate-800 border-slate-700 h-9 text-sm">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
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

      <div className="rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800">
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
              <tr><td colSpan={7} className="text-center py-12 text-slate-500">
                <Loader2 size={20} className="animate-spin mx-auto" />
              </td></tr>
            )}
            {!isLoading && data?.data?.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-slate-500">
                No hay asientos
              </td></tr>
            )}
            {data?.data?.map((a) => (
              <tr key={a.id} className="border-t border-slate-800 hover:bg-slate-800/30 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-[#00D4FF]">{a.numero}</td>
                <td className="px-4 py-3 text-slate-300">{new Date(a.fecha + 'T12:00:00').toLocaleDateString('es-AR')}</td>
                <td className="px-4 py-3 text-slate-300 max-w-xs truncate">{a.descripcion || '—'}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-300">{fmt(a.total_debe)}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-300">{fmt(a.total_haber)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${ESTADO_COLOR[a.estado]}`}>
                    {a.estado}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => setDetalle(a)}
                      className="p-1.5 rounded text-kx-text-3 hover:text-white hover:bg-slate-700 transition-colors" title="Ver detalle">
                      <Eye size={14} />
                    </button>
                    {a.estado === 'borrador' && (
                      <>
                        <button onClick={() => handleConfirmar(a.id)}
                          className="p-1.5 rounded text-kx-text-3 hover:text-green-400 hover:bg-green-500/10 transition-colors" title="Confirmar">
                          <CheckCircle2 size={14} />
                        </button>
                        <button onClick={() => handleAnular(a.id)}
                          className="p-1.5 rounded text-kx-text-3 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Anular">
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
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText size={16} className="text-[#00D4FF]" />
              Asiento {detalle?.numero}
              <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-full border font-medium ${ESTADO_COLOR[detalle?.estado]}`}>
                {detalle?.estado}
              </span>
            </DialogTitle>
            <DialogDescription>Líneas y detalle del asiento contable.</DialogDescription>
          </DialogHeader>
          {detalle && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-slate-500">Fecha:</span> <span className="text-white">{new Date(detalle.fecha + 'T12:00:00').toLocaleDateString('es-AR')}</span></div>
                <div><span className="text-slate-500">Origen:</span> <span className="text-white">{detalle.origen || 'manual'}</span></div>
                {detalle.descripcion && <div className="col-span-2"><span className="text-slate-500">Descripción:</span> <span className="text-white">{detalle.descripcion}</span></div>}
              </div>
              <div className="rounded-lg border border-slate-700 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-kx-text-3">Cuenta</th>
                      <th className="px-3 py-2 text-right text-kx-text-3">Debe</th>
                      <th className="px-3 py-2 text-right text-kx-text-3">Haber</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.asientos_items?.map((item) => (
                      <tr key={item.id} className="border-t border-slate-800">
                        <td className="px-3 py-1.5 text-slate-300">
                          <span className="font-mono text-[#00D4FF] mr-2">{item.plan_cuentas?.codigo}</span>
                          {item.plan_cuentas?.nombre}
                          {item.descripcion && <span className="text-slate-500 ml-2">({item.descripcion})</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-300">{item.debe > 0 ? fmt(item.debe) : '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-300">{item.haber > 0 ? fmt(item.haber) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-800/50">
                    <tr>
                      <td className="px-3 py-2 text-kx-text-3 font-medium">Total</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-white">{fmt(detalle.total_debe)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-white">{fmt(detalle.total_haber)}</td>
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
