import { useState, useEffect } from 'react';
import { Plus, Check, AlertTriangle, Loader2, Lock, Unlock } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

function TabPeriodos({ empresaId, userId, userRole }) {
  const [periodos, setPeriodos]               = useState([]);
  const [loadingPeriodos, setLoading]         = useState(true);
  const [showNuevoModal, setShowNuevoModal]   = useState(false);
  const [showCierreConfirm, setShowCierre]    = useState(false);
  const [periodoACerrar, setPeriodoACerrar]   = useState(null);
  const [procesandoCierre, setProcesando]     = useState(false);
  const [showReabrirConfirm, setShowReabrir]  = useState(false);
  const [periodoAReabrir, setPeriodoAReabrir] = useState(null);
  const [nuevoForm, setNuevoForm]             = useState({ nombre: '', fecha_inicio: '', fecha_cierre: '', observaciones: '' });
  const { toast } = useToast();
  const isAdmin = userRole === 'admin';

  const fetchPeriodos = async () => {
    if (!empresaId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('periodos_contables')
        .select('*')
        .eq('empresa_id', empresaId)
        .order('fecha_inicio', { ascending: false });
      if (error) throw error;
      setPeriodos(data ?? []);
    } catch (e) {
      toast({ title: 'Error al cargar períodos', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPeriodos(); }, [empresaId]);

  const handleCrearPeriodo = async () => {
    if (!nuevoForm.nombre || !nuevoForm.fecha_inicio || !nuevoForm.fecha_cierre) {
      toast({ title: 'Completá nombre y fechas', variant: 'destructive' }); return;
    }
    if (nuevoForm.fecha_cierre < nuevoForm.fecha_inicio) {
      toast({ title: 'La fecha de cierre debe ser posterior a la de inicio', variant: 'destructive' }); return;
    }
    // Validar solape con períodos existentes (overlap = inicio_a <= cierre_b AND cierre_a >= inicio_b)
    const solape = periodos.find(p => nuevoForm.fecha_inicio <= p.fecha_cierre && nuevoForm.fecha_cierre >= p.fecha_inicio);
    if (solape) {
      toast({ title: 'Solape detectado', description: `El rango se superpone con "${solape.nombre}" (${solape.fecha_inicio} → ${solape.fecha_cierre}).`, variant: 'destructive' });
      return;
    }
    try {
      const { error } = await supabase.from('periodos_contables').insert([{
        empresa_id:   empresaId,
        nombre:       nuevoForm.nombre,
        fecha_inicio: nuevoForm.fecha_inicio,
        fecha_cierre: nuevoForm.fecha_cierre,
        observaciones: nuevoForm.observaciones || null,
        estado:       'abierto',
      }]);
      if (error) throw error;
      toast({ title: 'Período creado', className: 'bg-green-900 border-green-700 text-white' });
      setShowNuevoModal(false);
      setNuevoForm({ nombre: '', fecha_inicio: '', fecha_cierre: '', observaciones: '' });
      fetchPeriodos();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleCerrarPeriodo = async () => {
    if (!periodoACerrar) return;
    setProcesando(true);
    try {
      const { count } = await supabase
        .from('asientos_contables')
        .select('id', { count: 'exact', head: true })
        .eq('empresa_id', empresaId)
        .gte('fecha', periodoACerrar.fecha_inicio)
        .lte('fecha', periodoACerrar.fecha_cierre);

      const { error } = await supabase
        .from('periodos_contables')
        .update({ estado: 'cerrado', cerrado_por: userId, fecha_cierre_real: new Date().toISOString() })
        .eq('id', periodoACerrar.id);
      if (error) throw error;
      toast({
        title: 'Período cerrado',
        description: `${count ?? 0} asiento${count !== 1 ? 's' : ''} quedan bloqueados en este período.`,
        className: 'bg-green-900 border-green-700 text-white',
      });
      setShowCierre(false);
      setPeriodoACerrar(null);
      fetchPeriodos();
    } catch (e) {
      toast({ title: 'Error al cerrar período', description: e.message, variant: 'destructive' });
    } finally {
      setProcesando(false);
    }
  };

  const handleReabrirPeriodo = async () => {
    if (!periodoAReabrir) return;
    setProcesando(true);
    try {
      const { error } = await supabase
        .from('periodos_contables')
        .update({ estado: 'abierto', cerrado_por: null, fecha_cierre_real: null })
        .eq('id', periodoAReabrir.id);
      if (error) throw error;
      toast({
        title: 'Período reabierto',
        description: `"${periodoAReabrir.nombre}" vuelve a aceptar nuevos asientos.`,
        className: 'bg-green-900 border-green-700 text-white',
      });
      setShowReabrir(false);
      setPeriodoAReabrir(null);
      fetchPeriodos();
    } catch (e) {
      toast({ title: 'Error al reabrir período', description: e.message, variant: 'destructive' });
    } finally {
      setProcesando(false);
    }
  };

  const fmtFecha = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-AR');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-kx-text-3">
          Los períodos cerrados bloquean nuevos asientos en ese rango de fechas. Los asientos existentes no se modifican.
        </p>
        {isAdmin && (
          <Button onClick={() => setShowNuevoModal(true)} size="sm"
            className="bg-[#00D4FF] text-black hover:bg-[#00bfe8] flex-shrink-0 ml-4">
            <Plus size={14} className="mr-1" /> Nuevo período
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Nombre</th>
              <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Inicio</th>
              <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Cierre</th>
              <th className="px-4 py-3 text-center text-kx-text-3 font-medium">Estado</th>
              <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Fecha cierre real</th>
              {isAdmin && <th className="px-4 py-3 text-center text-kx-text-3 font-medium">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {loadingPeriodos && (
              <tr><td colSpan={isAdmin ? 6 : 5} className="text-center py-12 text-slate-500">
                <Loader2 size={20} className="animate-spin mx-auto" />
              </td></tr>
            )}
            {!loadingPeriodos && periodos.length === 0 && (
              <tr><td colSpan={isAdmin ? 6 : 5} className="text-center py-12 text-slate-500">
                No hay períodos contables creados
              </td></tr>
            )}
            {periodos.map(p => (
              <tr key={p.id} className="border-t border-slate-800 hover:bg-slate-800/30 transition-colors">
                <td className="px-4 py-3 text-white font-medium">{p.nombre}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-300">{fmtFecha(p.fecha_inicio)}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-300">{fmtFecha(p.fecha_cierre)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium
                    ${p.estado === 'cerrado'
                      ? 'bg-red-500/10 text-red-400 border-red-500/30'
                      : 'bg-green-500/10 text-green-400 border-green-500/30'}`}>
                    {p.estado}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-kx-text-3">
                  {p.fecha_cierre_real
                    ? new Date(p.fecha_cierre_real).toLocaleDateString('es-AR')
                    : '—'}
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 text-center">
                    {p.estado === 'abierto' ? (
                      <button
                        onClick={() => { setPeriodoACerrar(p); setShowCierre(true); }}
                        className="flex items-center gap-1 mx-auto px-3 py-1.5 rounded text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/30 transition-colors"
                      >
                        <Lock size={12} /> Cerrar
                      </button>
                    ) : (
                      <button
                        onClick={() => { setPeriodoAReabrir(p); setShowReabrir(true); }}
                        className="flex items-center gap-1 mx-auto px-3 py-1.5 rounded text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/30 transition-colors"
                      >
                        <Unlock size={12} /> Reabrir
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal: Nuevo período */}
      <Dialog open={showNuevoModal} onOpenChange={setShowNuevoModal}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus size={16} className="text-[#00D4FF]" /> Nuevo Período Contable
            </DialogTitle>
            <DialogDescription>Definí el rango de fechas del período. Una vez cerrado bloqueará nuevos asientos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-kx-text-3 text-xs">Nombre *</Label>
              <Input value={nuevoForm.nombre}
                onChange={e => setNuevoForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Ejercicio 2025 — Enero"
                className="mt-1 bg-slate-800 border-slate-700" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-kx-text-3 text-xs">Fecha inicio *</Label>
                <Input type="date" value={nuevoForm.fecha_inicio}
                  onChange={e => setNuevoForm(f => ({ ...f, fecha_inicio: e.target.value }))}
                  className="mt-1 bg-slate-800 border-slate-700" />
              </div>
              <div>
                <Label className="text-kx-text-3 text-xs">Fecha cierre *</Label>
                <Input type="date" value={nuevoForm.fecha_cierre}
                  onChange={e => setNuevoForm(f => ({ ...f, fecha_cierre: e.target.value }))}
                  className="mt-1 bg-slate-800 border-slate-700" />
              </div>
            </div>
            <div>
              <Label className="text-kx-text-3 text-xs">Observaciones</Label>
              <Input value={nuevoForm.observaciones}
                onChange={e => setNuevoForm(f => ({ ...f, observaciones: e.target.value }))}
                placeholder="Opcional"
                className="mt-1 bg-slate-800 border-slate-700" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setShowNuevoModal(false)} className="text-kx-text-3">Cancelar</Button>
            <Button onClick={handleCrearPeriodo} className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
              <Check size={14} className="mr-2" /> Crear período
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Confirmar cierre */}
      <Dialog
        open={showCierreConfirm}
        onOpenChange={v => { if (!procesandoCierre) { setShowCierre(v); if (!v) setPeriodoACerrar(null); } }}
      >
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <AlertTriangle size={18} /> Cerrar período contable
            </DialogTitle>
            <DialogDescription>Esta acción no se puede deshacer fácilmente.</DialogDescription>
          </DialogHeader>
          {periodoACerrar && (
            <div className="space-y-3 py-2">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                <p className="text-sm font-semibold text-amber-300 mb-1">{periodoACerrar.nombre}</p>
                <p className="text-xs text-amber-400">
                  {fmtFecha(periodoACerrar.fecha_inicio)} — {fmtFecha(periodoACerrar.fecha_cierre)}
                </p>
              </div>
              <p className="text-sm text-kx-text-3">
                No se podrán crear nuevos asientos en ese rango de fechas. Los asientos existentes{' '}
                <span className="text-white font-medium">no se modifican ni eliminan</span>.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" disabled={procesandoCierre}
              onClick={() => { setShowCierre(false); setPeriodoACerrar(null); }}
              className="text-kx-text-3">
              Cancelar
            </Button>
            <Button onClick={handleCerrarPeriodo} disabled={procesandoCierre}
              className="bg-amber-600 hover:bg-amber-700 text-white">
              {procesandoCierre
                ? <Loader2 size={14} className="animate-spin mr-2" />
                : <Lock size={14} className="mr-2" />}
              Confirmar cierre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Confirmar reabrir */}
      <Dialog
        open={showReabrirConfirm}
        onOpenChange={v => { if (!procesandoCierre) { setShowReabrir(v); if (!v) setPeriodoAReabrir(null); } }}
      >
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-400">
              <Unlock size={18} /> Reabrir período contable
            </DialogTitle>
            <DialogDescription>Se podrán generar nuevos asientos en este rango de fechas.</DialogDescription>
          </DialogHeader>
          {periodoAReabrir && (
            <div className="space-y-3 py-2">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                <p className="text-sm font-semibold text-emerald-300 mb-1">{periodoAReabrir.nombre}</p>
                <p className="text-xs text-emerald-400">
                  {fmtFecha(periodoAReabrir.fecha_inicio)} — {fmtFecha(periodoAReabrir.fecha_cierre)}
                </p>
              </div>
              <p className="text-sm text-kx-text-3">
                Los asientos existentes <span className="text-white font-medium">no se modifican</span>.
                Se limpia la fecha de cierre real y vuelve a estado <span className="text-white font-medium">abierto</span>.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" disabled={procesandoCierre}
              onClick={() => { setShowReabrir(false); setPeriodoAReabrir(null); }}
              className="text-kx-text-3">
              Cancelar
            </Button>
            <Button onClick={handleReabrirPeriodo} disabled={procesandoCierre}
              className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {procesandoCierre
                ? <Loader2 size={14} className="animate-spin mr-2" />
                : <Unlock size={14} className="mr-2" />}
              Confirmar reapertura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TabPeriodos;
