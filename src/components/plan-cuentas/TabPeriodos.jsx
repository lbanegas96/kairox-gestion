import { useState, useEffect } from 'react';
import { Plus, Check, AlertTriangle, Loader2, Lock, Unlock, BookLock, ArrowRightLeft, Calculator } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { ajusteInflacionService } from '@/services/ajusteInflacionService';
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
  const [showCierreEjercicio, setShowCierreEjercicio] = useState(false);
  const [periodoACerrarEjercicio, setPeriodoACerrarEjercicio] = useState(null);
  const [procesandoCierreEjercicio, setProcesandoCE] = useState(false);
  const [showTraslado, setShowTraslado]       = useState(false);
  const [periodoATrasladar, setPeriodoATrasladar] = useState(null);
  const [procesandoTraslado, setProcesandoT]  = useState(false);
  const [showAjusteInflacion, setShowAjusteInflacion] = useState(false);
  const [periodoAjustar, setPeriodoAjustar]   = useState(null);
  const [previewAjuste, setPreviewAjuste]     = useState(null);
  const [cargandoPreview, setCargandoPreview] = useState(false);
  const [procesandoAjuste, setProcesandoAjuste] = useState(false);
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
    if (periodoAReabrir.asiento_cierre_id) {
      toast({
        title: 'No se puede reabrir',
        description: 'Este período ya tiene un asiento de cierre de ejercicio generado. Anulá ese asiento desde Plan de Cuentas antes de reabrir el período.',
        variant: 'destructive',
      });
      setShowReabrir(false);
      setPeriodoAReabrir(null);
      return;
    }
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

  const handleCerrarEjercicio = async () => {
    if (!periodoACerrarEjercicio) return;
    setProcesandoCE(true);
    try {
      const { data, error } = await supabase.rpc('cerrar_ejercicio_contable', {
        p_periodo_id: periodoACerrarEjercicio.id,
        p_user_id: userId,
      });
      if (error) throw error;
      toast({
        title: data?.asiento_id ? 'Asiento de cierre de ejercicio generado' : 'Sin movimientos para cerrar',
        description: data?.asiento_id
          ? `Resultado del ejercicio: ${fmt(data.resultado_neto)}`
          : data?.mensaje,
        className: 'bg-green-900 border-green-700 text-white',
      });
      setShowCierreEjercicio(false);
      setPeriodoACerrarEjercicio(null);
      fetchPeriodos();
    } catch (e) {
      toast({ title: 'Error al cerrar ejercicio', description: e.message, variant: 'destructive' });
    } finally {
      setProcesandoCE(false);
    }
  };

  const handleTrasladar = async () => {
    if (!periodoATrasladar) return;
    setProcesandoT(true);
    try {
      const { data, error } = await supabase.rpc('trasladar_resultado_acumulados', {
        p_periodo_id: periodoATrasladar.id,
        p_user_id: userId,
      });
      if (error) throw error;
      toast({
        title: 'Trasladado a Resultados Acumulados',
        description: `Monto: ${fmt(data.resultado_neto)}`,
        className: 'bg-green-900 border-green-700 text-white',
      });
      setShowTraslado(false);
      setPeriodoATrasladar(null);
      fetchPeriodos();
    } catch (e) {
      toast({ title: 'Error al trasladar', description: e.message, variant: 'destructive' });
    } finally {
      setProcesandoT(false);
    }
  };

  const handleAbrirAjusteInflacion = async (p) => {
    setPeriodoAjustar(p);
    setShowAjusteInflacion(true);
    setPreviewAjuste(null);
    setCargandoPreview(true);
    try {
      const data = await ajusteInflacionService.calcularPreview(p.id);
      setPreviewAjuste(data);
    } catch (e) {
      toast({ title: 'No se pudo calcular el ajuste', description: e.message, variant: 'destructive' });
      setShowAjusteInflacion(false);
    } finally {
      setCargandoPreview(false);
    }
  };

  const handleConfirmarAjusteInflacion = async () => {
    if (!periodoAjustar) return;
    setProcesandoAjuste(true);
    try {
      const data = await ajusteInflacionService.generar(periodoAjustar.id, userId);
      toast({
        title: data.asiento_id ? 'Ajuste por inflación generado' : 'Sin partidas para ajustar',
        description: data.asiento_id
          ? `RECPAM neto: ${fmt(previewAjuste?.recpam_neto)}`
          : data.mensaje,
        className: 'bg-green-900 border-green-700 text-white',
      });
      setShowAjusteInflacion(false);
      setPeriodoAjustar(null);
      setPreviewAjuste(null);
      fetchPeriodos();
    } catch (e) {
      toast({ title: 'Error al generar el ajuste', description: e.message, variant: 'destructive' });
    } finally {
      setProcesandoAjuste(false);
    }
  };

  const fmt = (n) => `$ ${Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fmtFecha = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-AR');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-kx-text-3">
          Los períodos cerrados bloquean nuevos asientos en ese rango de fechas. Los asientos existentes no se modifican.
        </p>
        {isAdmin && (
          <Button onClick={() => setShowNuevoModal(true)} size="sm"
            className="bg-kx-violet text-white hover:opacity-90 flex-shrink-0 ml-4">
            <Plus size={14} className="mr-1" /> Nuevo período
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-kx-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-kx-surface-2">
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
              <tr><td colSpan={isAdmin ? 6 : 5} className="text-center py-12 text-kx-text-2">
                <Loader2 size={20} className="animate-spin mx-auto" />
              </td></tr>
            )}
            {!loadingPeriodos && periodos.length === 0 && (
              <tr><td colSpan={isAdmin ? 6 : 5} className="text-center py-12 text-kx-text-2">
                No hay períodos contables creados
              </td></tr>
            )}
            {periodos.map(p => (
              <tr key={p.id} className="border-t border-kx-border hover:bg-kx-surface-2/30 transition-colors">
                <td className="px-4 py-3 text-kx-text font-medium">{p.nombre}</td>
                <td className="px-4 py-3 font-mono text-xs text-kx-text-3">{fmtFecha(p.fecha_inicio)}</td>
                <td className="px-4 py-3 font-mono text-xs text-kx-text-3">{fmtFecha(p.fecha_cierre)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-2xs px-2 py-0.5 rounded-full border font-medium
                    ${p.estado === 'cerrado'
                      ? 'bg-kx-red/10 text-kx-red border-kx-red/30'
                      : 'bg-kx-green/10 text-kx-green border-kx-green/30'}`}>
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
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      {p.estado === 'abierto' ? (
                        <button
                          onClick={() => { setPeriodoACerrar(p); setShowCierre(true); }}
                          className="flex items-center gap-1 px-3 py-1.5 rounded text-xs text-kx-amber hover:opacity-80 hover:bg-kx-amber/10 border border-kx-amber/30 transition-colors"
                        >
                          <Lock size={12} /> Cerrar
                        </button>
                      ) : (
                        <button
                          onClick={() => { setPeriodoAReabrir(p); setShowReabrir(true); }}
                          className="flex items-center gap-1 px-3 py-1.5 rounded text-xs text-kx-green hover:opacity-80 hover:bg-kx-green/10 border border-kx-green/30 transition-colors"
                        >
                          <Unlock size={12} /> Reabrir
                        </button>
                      )}
                      {p.estado === 'cerrado' && !p.asiento_ajuste_inflacion_id && !p.asiento_cierre_id && (
                        <button
                          onClick={() => handleAbrirAjusteInflacion(p)}
                          title="RT 6 — reexpresa rubros no monetarios y genera el RECPAM (opcional, antes de cerrar el ejercicio)"
                          className="flex items-center gap-1 px-3 py-1.5 rounded text-xs text-cyan-600 dark:text-cyan-400 hover:opacity-80 hover:bg-cyan-500/10 border border-cyan-500/30 transition-colors"
                        >
                          <Calculator size={12} /> Ajuste por Inflación
                        </button>
                      )}
                      {p.asiento_ajuste_inflacion_id && (
                        <span className="text-2xs px-2 py-1 rounded-full border border-cyan-500/30 text-cyan-600 dark:text-cyan-400 bg-cyan-500/10">
                          Ajustado por inflación
                        </span>
                      )}
                      {p.estado === 'cerrado' && !p.asiento_cierre_id && (
                        <button
                          onClick={() => { setPeriodoACerrarEjercicio(p); setShowCierreEjercicio(true); }}
                          title="Genera el asiento que zapatea Ingresos/Egresos contra Resultado del Ejercicio"
                          className="flex items-center gap-1 px-3 py-1.5 rounded text-xs text-indigo-600 dark:text-indigo-400 hover:opacity-80 hover:bg-indigo-500/10 border border-indigo-500/30 transition-colors"
                        >
                          <BookLock size={12} /> Cerrar Ejercicio
                        </button>
                      )}
                      {p.asiento_cierre_id && !p.asiento_traslado_id && p.resultado_neto != null && p.resultado_neto !== 0 && (
                        <button
                          onClick={() => { setPeriodoATrasladar(p); setShowTraslado(true); }}
                          title="Traslada el saldo de 3.3 Resultado del Ejercicio a 3.2 Resultados Acumulados"
                          className="flex items-center gap-1 px-3 py-1.5 rounded text-xs text-purple-600 dark:text-purple-400 hover:opacity-80 hover:bg-purple-500/10 border border-purple-500/30 transition-colors"
                        >
                          <ArrowRightLeft size={12} /> Trasladar a Acumulados
                        </button>
                      )}
                      {p.asiento_cierre_id && (
                        <span className="text-2xs px-2 py-1 rounded-full border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 bg-indigo-500/10">
                          Ejercicio cerrado
                        </span>
                      )}
                      {p.asiento_traslado_id && (
                        <span className="text-2xs px-2 py-1 rounded-full border border-purple-500/30 text-purple-600 dark:text-purple-400 bg-purple-500/10">
                          Trasladado
                        </span>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal: Nuevo período */}
      <Dialog open={showNuevoModal} onOpenChange={setShowNuevoModal}>
        <DialogContent className="bg-kx-surface border-kx-border text-kx-text max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus size={16} className="text-kx-violet" /> Nuevo Período Contable
            </DialogTitle>
            <DialogDescription>Definí el rango de fechas del período. Una vez cerrado bloqueará nuevos asientos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-kx-text-3 text-xs">Nombre *</Label>
              <Input value={nuevoForm.nombre}
                onChange={e => setNuevoForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Ejercicio 2025 — Enero"
                className="mt-1 bg-kx-surface-2 border-kx-border" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-kx-text-3 text-xs">Fecha inicio *</Label>
                <Input type="date" value={nuevoForm.fecha_inicio}
                  onChange={e => setNuevoForm(f => ({ ...f, fecha_inicio: e.target.value }))}
                  className="mt-1 bg-kx-surface-2 border-kx-border" />
              </div>
              <div>
                <Label className="text-kx-text-3 text-xs">Fecha cierre *</Label>
                <Input type="date" value={nuevoForm.fecha_cierre}
                  onChange={e => setNuevoForm(f => ({ ...f, fecha_cierre: e.target.value }))}
                  className="mt-1 bg-kx-surface-2 border-kx-border" />
              </div>
            </div>
            <div>
              <Label className="text-kx-text-3 text-xs">Observaciones</Label>
              <Input value={nuevoForm.observaciones}
                onChange={e => setNuevoForm(f => ({ ...f, observaciones: e.target.value }))}
                placeholder="Opcional"
                className="mt-1 bg-kx-surface-2 border-kx-border" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setShowNuevoModal(false)} className="text-kx-text-3">Cancelar</Button>
            <Button onClick={handleCrearPeriodo} className="bg-kx-violet text-white hover:opacity-90">
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
        <DialogContent className="bg-kx-surface border-kx-border text-kx-text max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-kx-amber">
              <AlertTriangle size={18} /> Cerrar período contable
            </DialogTitle>
            <DialogDescription>Esta acción no se puede deshacer fácilmente.</DialogDescription>
          </DialogHeader>
          {periodoACerrar && (
            <div className="space-y-3 py-2">
              <div className="bg-kx-amber/10 border border-kx-amber/30 rounded-lg p-3">
                <p className="text-sm font-semibold text-kx-amber mb-1">{periodoACerrar.nombre}</p>
                <p className="text-xs text-kx-amber">
                  {fmtFecha(periodoACerrar.fecha_inicio)} — {fmtFecha(periodoACerrar.fecha_cierre)}
                </p>
              </div>
              <p className="text-sm text-kx-text-3">
                No se podrán crear nuevos asientos en ese rango de fechas. Los asientos existentes{' '}
                <span className="text-kx-text font-medium">no se modifican ni eliminan</span>.
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
        <DialogContent className="bg-kx-surface border-kx-border text-kx-text max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-kx-green">
              <Unlock size={18} /> Reabrir período contable
            </DialogTitle>
            <DialogDescription>Se podrán generar nuevos asientos en este rango de fechas.</DialogDescription>
          </DialogHeader>
          {periodoAReabrir && (
            <div className="space-y-3 py-2">
              <div className="bg-kx-green/10 border border-kx-green/30 rounded-lg p-3">
                <p className="text-sm font-semibold text-kx-green mb-1">{periodoAReabrir.nombre}</p>
                <p className="text-xs text-kx-green">
                  {fmtFecha(periodoAReabrir.fecha_inicio)} — {fmtFecha(periodoAReabrir.fecha_cierre)}
                </p>
              </div>
              <p className="text-sm text-kx-text-3">
                Los asientos existentes <span className="text-kx-text font-medium">no se modifican</span>.
                Se limpia la fecha de cierre real y vuelve a estado <span className="text-kx-text font-medium">abierto</span>.
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

      {/* Dialog: Confirmar cierre de ejercicio */}
      <Dialog
        open={showCierreEjercicio}
        onOpenChange={v => { if (!procesandoCierreEjercicio) { setShowCierreEjercicio(v); if (!v) setPeriodoACerrarEjercicio(null); } }}
      >
        <DialogContent className="bg-kx-surface border-kx-border text-kx-text max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-indigo-500">
              <BookLock size={18} /> Cerrar Ejercicio (asiento contable)
            </DialogTitle>
            <DialogDescription>
              Genera un asiento real que deja en cero las cuentas de Ingreso y Egreso del período, contra Resultado del Ejercicio.
            </DialogDescription>
          </DialogHeader>
          {periodoACerrarEjercicio && (
            <div className="space-y-3 py-2">
              <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-3">
                <p className="text-sm font-semibold text-indigo-500 mb-1">{periodoACerrarEjercicio.nombre}</p>
                <p className="text-xs text-indigo-500">
                  {fmtFecha(periodoACerrarEjercicio.fecha_inicio)} — {fmtFecha(periodoACerrarEjercicio.fecha_cierre)}
                </p>
              </div>
              <p className="text-sm text-kx-text-3">
                Esta operación no se puede repetir sobre el mismo período. Si necesitás corregir algo después,
                vas a tener que anular el asiento generado desde Plan de Cuentas.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" disabled={procesandoCierreEjercicio}
              onClick={() => { setShowCierreEjercicio(false); setPeriodoACerrarEjercicio(null); }}
              className="text-kx-text-3">
              Cancelar
            </Button>
            <Button onClick={handleCerrarEjercicio} disabled={procesandoCierreEjercicio}
              className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {procesandoCierreEjercicio
                ? <Loader2 size={14} className="animate-spin mr-2" />
                : <BookLock size={14} className="mr-2" />}
              Confirmar cierre de ejercicio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Confirmar traslado a Resultados Acumulados */}
      <Dialog
        open={showTraslado}
        onOpenChange={v => { if (!procesandoTraslado) { setShowTraslado(v); if (!v) setPeriodoATrasladar(null); } }}
      >
        <DialogContent className="bg-kx-surface border-kx-border text-kx-text max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-purple-500">
              <ArrowRightLeft size={18} /> Trasladar a Resultados Acumulados
            </DialogTitle>
            <DialogDescription>
              Mueve el resultado de este ejercicio de 3.3 (Resultado del Ejercicio) a 3.2 (Resultados Acumulados), dejando 3.3 en cero.
            </DialogDescription>
          </DialogHeader>
          {periodoATrasladar && (
            <div className="space-y-3 py-2">
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                <p className="text-sm font-semibold text-purple-500 mb-1">{periodoATrasladar.nombre}</p>
                <p className="text-xs text-purple-500">
                  Resultado neto: {fmt(periodoATrasladar.resultado_neto)}
                </p>
              </div>
              <p className="text-sm text-kx-text-3">
                Esta operación no se puede repetir sobre el mismo período.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" disabled={procesandoTraslado}
              onClick={() => { setShowTraslado(false); setPeriodoATrasladar(null); }}
              className="text-kx-text-3">
              Cancelar
            </Button>
            <Button onClick={handleTrasladar} disabled={procesandoTraslado}
              className="bg-purple-600 hover:bg-purple-700 text-white">
              {procesandoTraslado
                ? <Loader2 size={14} className="animate-spin mr-2" />
                : <ArrowRightLeft size={14} className="mr-2" />}
              Confirmar traslado
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Preview + confirmar Ajuste por Inflación */}
      <Dialog
        open={showAjusteInflacion}
        onOpenChange={v => { if (!procesandoAjuste) { setShowAjusteInflacion(v); if (!v) { setPeriodoAjustar(null); setPreviewAjuste(null); } } }}
      >
        <DialogContent className="bg-kx-surface border-kx-border text-kx-text max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-cyan-500">
              <Calculator size={18} /> Ajuste por Inflación (RT 6)
            </DialogTitle>
            <DialogDescription>
              Reexpresa Bienes de Uso, Inventario, Patrimonio, Ingresos y Egresos por el índice IPC del período
              y genera el asiento único con el RECPAM.
            </DialogDescription>
          </DialogHeader>

          {periodoAjustar && (
            <div className="space-y-3 py-2">
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
                <p className="text-sm font-semibold text-cyan-500 mb-1">{periodoAjustar.nombre}</p>
                <p className="text-xs text-cyan-500">
                  {fmtFecha(periodoAjustar.fecha_inicio)} — {fmtFecha(periodoAjustar.fecha_cierre)}
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Circuito construido con evidencia pública (RT 6, FACPCE), sin validación de un contador
                  matriculado — ver PLAN_AJUSTE_POR_INFLACION.md. No se puede repetir sobre el mismo período.
                </p>
              </div>

              {cargandoPreview ? (
                <div className="flex items-center gap-2 text-kx-text-3 py-6 justify-center">
                  <Loader2 size={16} className="animate-spin" /> Calculando...
                </div>
              ) : previewAjuste && previewAjuste.lineas.length === 0 ? (
                <p className="text-sm text-kx-text-3 py-4 text-center">
                  Sin partidas no monetarias con saldo en este período — no hay nada para ajustar.
                </p>
              ) : previewAjuste ? (
                <>
                  <div className="border border-kx-border rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                    {previewAjuste.lineas.map(l => (
                      <div key={l.cuenta_id} className="flex items-center justify-between px-3 py-2 border-b border-kx-border last:border-0 text-sm">
                        <span className="text-kx-text-2">{l.codigo} — {l.nombre}</span>
                        <span className="font-mono tabular-nums text-kx-text">{fmt(l.monto_ajuste)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2 text-center">
                      <p className="text-emerald-600 dark:text-emerald-400">RECPAM Ganancia</p>
                      <p className="font-mono tabular-nums text-kx-text font-semibold">{fmt(previewAjuste.recpam_ganancia)}</p>
                    </div>
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 text-center">
                      <p className="text-kx-red">RECPAM Pérdida</p>
                      <p className="font-mono tabular-nums text-kx-text font-semibold">{fmt(previewAjuste.recpam_perdida)}</p>
                    </div>
                  </div>
                  <div className="text-center text-sm">
                    <span className="text-kx-text-3">RECPAM neto: </span>
                    <span className="font-mono tabular-nums font-bold text-kx-text">{fmt(previewAjuste.recpam_neto)}</span>
                  </div>
                </>
              ) : null}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="ghost" disabled={procesandoAjuste}
              onClick={() => { setShowAjusteInflacion(false); setPeriodoAjustar(null); setPreviewAjuste(null); }}
              className="text-kx-text-3">
              Cancelar
            </Button>
            <Button onClick={handleConfirmarAjusteInflacion}
              disabled={procesandoAjuste || cargandoPreview || !previewAjuste?.lineas?.length}
              className="bg-cyan-600 hover:bg-cyan-700 text-white">
              {procesandoAjuste
                ? <Loader2 size={14} className="animate-spin mr-2" />
                : <Calculator size={14} className="mr-2" />}
              Confirmar y generar asiento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TabPeriodos;
