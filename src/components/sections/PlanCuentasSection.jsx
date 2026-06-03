import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, BookMarked, Plus, ChevronRight, ChevronDown, Check, X, AlertTriangle,
  FileText, BarChart2, ListOrdered, Search, Loader2, CheckCircle2,
  Ban, RefreshCw, Eye, Pencil, ChevronLeft, List,
  Lock, Unlock, TrendingUp, TrendingDown, Scale, Calendar,
} from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { planCuentasService, asientosService, periodosService, PLAN_CUENTAS_KEYS } from '@/services/planCuentasService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIPO_COLOR = {
  activo:     'bg-blue-500/10 text-blue-400 border-blue-500/30',
  pasivo:     'bg-red-500/10 text-red-400 border-red-500/30',
  patrimonio: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  ingreso:    'bg-green-500/10 text-green-400 border-green-500/30',
  egreso:     'bg-orange-500/10 text-orange-400 border-orange-500/30',
};

const TIPO_LABEL = {
  activo: 'Activo', pasivo: 'Pasivo', patrimonio: 'Patrimonio',
  ingreso: 'Ingreso', egreso: 'Egreso',
};

const ESTADO_COLOR = {
  borrador:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  confirmado: 'bg-green-500/10 text-green-400 border-green-500/30',
  anulado:    'bg-red-500/10 text-red-400 border-red-500/30',
};

const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n ?? 0);

// ─── Helper: recolecta todos los IDs de una cuenta y sus descendientes ─────────

function collectIds(cuenta) {
  const ids = [cuenta.id];
  (cuenta.hijos ?? []).forEach((h) => ids.push(...collectIds(h)));
  return ids;
}

// ─── Árbol de cuentas (nodo recursivo) ───────────────────────────────────────

function CuentaNode({ cuenta, depth = 0, onEdit, onViewMovimientos, search }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = cuenta.hijos?.length > 0;
  const highlight = search && (
    cuenta.nombre.toLowerCase().includes(search.toLowerCase()) ||
    cuenta.codigo.includes(search)
  );

  if (search && !highlight && !cuenta.hijos?.some((h) => matchesSearch(h, search))) return null;

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors cursor-pointer group
          ${depth === 0 ? 'bg-slate-800/60 mb-1' : 'hover:bg-slate-800/40'}
          ${highlight ? 'ring-1 ring-[#00D4FF]/30' : ''}
        `}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        onClick={() => hasChildren && setOpen(!open)}
      >
        {hasChildren ? (
          open ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}

        <span className={`text-xs font-mono w-16 flex-shrink-0 ${depth === 0 ? 'text-slate-300' : 'text-slate-500'}`}>
          {cuenta.codigo}
        </span>

        <span className={`flex-1 text-sm ${depth === 0 ? 'font-semibold text-white' : 'text-slate-300'} ${!cuenta.activa ? 'line-through opacity-50' : ''}`}>
          {cuenta.nombre}
        </span>

        {depth === 0 && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${TIPO_COLOR[cuenta.tipo]}`}>
            {TIPO_LABEL[cuenta.tipo]}
          </span>
        )}

        {cuenta.permite_movimientos && cuenta.saldo_actual !== 0 && (
          <span className={`text-xs font-mono ${cuenta.saldo_actual >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {fmt(cuenta.saldo_actual)}
          </span>
        )}

        {/* Botón ver movimientos: aparece en hover para cualquier cuenta (grupo o hoja) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onViewMovimientos(cuenta, collectIds(cuenta));
          }}
          title="Ver movimientos"
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#00D4FF] hover:bg-[#00D4FF]/10 transition-all"
        >
          <List size={13} />
        </button>

        {cuenta.permite_movimientos && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(cuenta); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-white transition-all"
          >
            <Pencil size={12} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {open && hasChildren && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {cuenta.hijos.map((h) => (
              <CuentaNode key={h.id} cuenta={h} depth={depth + 1} onEdit={onEdit} onViewMovimientos={onViewMovimientos} search={search} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function matchesSearch(cuenta, search) {
  if (!search) return true;
  const q = search.toLowerCase();
  if (cuenta.nombre.toLowerCase().includes(q) || cuenta.codigo.includes(q)) return true;
  return cuenta.hijos?.some((h) => matchesSearch(h, search));
}

// ─── Modal: Nueva cuenta ──────────────────────────────────────────────────────

function ModalNuevaCuenta({ open, onClose, cuentasFlat, empresaId, onSuccess }) {
  const [form, setForm] = useState({
    codigo: '', nombre: '', tipo: 'activo',
    cuenta_padre_id: '', nivel: 1, permite_movimientos: true, activa: true,
  });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    if (!form.codigo || !form.nombre) {
      toast({ title: 'Completá código y nombre', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      const padre = cuentasFlat.find((c) => c.id === form.cuenta_padre_id);
      await planCuentasService.createCuenta(empresaId, {
        ...form,
        nivel: padre ? padre.nivel + 1 : 1,
        cuenta_padre_id: form.cuenta_padre_id || null,
        tipo: padre ? padre.tipo : form.tipo,
      });
      toast({ title: 'Cuenta creada', className: 'bg-green-900 border-green-700 text-white' });
      onSuccess();
      onClose();
      setForm({ codigo: '', nombre: '', tipo: 'activo', cuenta_padre_id: '', nivel: 1, permite_movimientos: true, activa: true });
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const padre = cuentasFlat.find((c) => c.id === form.cuenta_padre_id);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Plus size={18} className="text-[#00D4FF]" /> Nueva Cuenta
          </DialogTitle>
          <DialogDescription className="text-slate-400">Definí código, nombre y tipo de la nueva cuenta contable.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-slate-400 text-xs">Código *</Label>
              <Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                className="bg-slate-800 border-slate-700" placeholder="ej: 1.1.6" />
            </div>
            <div className="space-y-1">
              <Label className="text-slate-400 text-xs">Tipo *</Label>
              <Select value={padre ? padre.tipo : form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })} disabled={!!padre}>
                <SelectTrigger className="bg-slate-800 border-slate-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {Object.entries(TIPO_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-slate-400 text-xs">Nombre *</Label>
            <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              className="bg-slate-800 border-slate-700" placeholder="Nombre de la cuenta" />
          </div>

          <div className="space-y-1">
            <Label className="text-slate-400 text-xs">Cuenta padre (opcional)</Label>
            <Select value={form.cuenta_padre_id} onValueChange={(v) => setForm({ ...form, cuenta_padre_id: v })}>
              <SelectTrigger className="bg-slate-800 border-slate-700">
                <SelectValue placeholder="Sin padre (cuenta raíz)" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 max-h-48 overflow-y-auto">
                <SelectItem value="">Sin padre (raíz)</SelectItem>
                {cuentasFlat.filter((c) => !c.permite_movimientos || c.nivel < 3).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.codigo} — {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.permite_movimientos}
                onChange={(e) => setForm({ ...form, permite_movimientos: e.target.checked })}
                className="w-4 h-4 rounded" />
              <span className="text-sm text-slate-300">Permite movimientos</span>
            </label>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-slate-400">Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}
            className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
            {saving ? <Loader2 size={14} className="animate-spin mr-2" /> : <Check size={14} className="mr-2" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal: Nuevo asiento ────────────────────────────────────────────────────

function ModalNuevoAsiento({ open, onClose, cuentasFlat, empresaId, userId, onSuccess }) {
  const emptyLinea = () => ({ cuenta_id: '', descripcion: '', debe: '', haber: '' });
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0, 10), descripcion: '' });
  const [lineas, setLineas] = useState([emptyLinea(), emptyLinea()]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const totalDebe  = lineas.reduce((s, l) => s + (parseFloat(l.debe)  || 0), 0);
  const totalHaber = lineas.reduce((s, l) => s + (parseFloat(l.haber) || 0), 0);
  const cuadrado   = Math.abs(totalDebe - totalHaber) < 0.001 && totalDebe > 0;

  const updateLinea = (i, field, value) => {
    setLineas((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  };

  const handleSave = async () => {
    if (!form.fecha) { toast({ title: 'Fecha requerida', variant: 'destructive' }); return; }
    if (!cuadrado) { toast({ title: 'El asiento no cuadra (Debe ≠ Haber)', variant: 'destructive' }); return; }
    const items = lineas.filter((l) => l.cuenta_id).map((l) => ({
      cuenta_id: l.cuenta_id,
      descripcion: l.descripcion || null,
      debe: parseFloat(l.debe) || 0,
      haber: parseFloat(l.haber) || 0,
    }));
    if (items.length < 2) { toast({ title: 'Mínimo 2 líneas con cuenta', variant: 'destructive' }); return; }

    setSaving(true);
    try {
      await asientosService.createAsiento(empresaId, userId, form, items);
      toast({ title: 'Asiento creado', className: 'bg-green-900 border-green-700 text-white' });
      onSuccess();
      onClose();
      setForm({ fecha: new Date().toISOString().slice(0, 10), descripcion: '' });
      setLineas([emptyLinea(), emptyLinea()]);
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const movibles = cuentasFlat.filter((c) => c.permite_movimientos && c.activa);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <FileText size={18} className="text-[#00D4FF]" /> Nuevo Asiento Contable
          </DialogTitle>
          <DialogDescription className="text-slate-400">Ingresá fecha, descripción y las líneas de débito/crédito del asiento.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-slate-400 text-xs">Fecha *</Label>
              <Input type="date" value={form.fecha}
                onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                className="bg-slate-800 border-slate-700" />
            </div>
            <div className="space-y-1">
              <Label className="text-slate-400 text-xs">Descripción</Label>
              <Input value={form.descripcion}
                onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                className="bg-slate-800 border-slate-700" placeholder="Concepto del asiento" />
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800">
                <tr>
                  <th className="px-3 py-2 text-left text-slate-400 font-medium">Cuenta</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-medium">Detalle</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-medium w-28">Debe</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-medium w-28">Haber</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td className="px-2 py-1.5">
                      <select
                        value={l.cuenta_id}
                        onChange={(e) => updateLinea(i, 'cuenta_id', e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded text-white text-xs px-2 py-1.5 focus:outline-none focus:border-[#00D4FF]"
                      >
                        <option value="">— Seleccionar —</option>
                        {movibles.map((c) => (
                          <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input value={l.descripcion}
                        onChange={(e) => updateLinea(i, 'descripcion', e.target.value)}
                        className="bg-slate-800 border-slate-700 h-8 text-xs" placeholder="Detalle" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input type="number" value={l.debe}
                        onChange={(e) => updateLinea(i, 'debe', e.target.value)}
                        className="bg-slate-800 border-slate-700 h-8 text-xs text-right" placeholder="0.00" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input type="number" value={l.haber}
                        onChange={(e) => updateLinea(i, 'haber', e.target.value)}
                        className="bg-slate-800 border-slate-700 h-8 text-xs text-right" placeholder="0.00" />
                    </td>
                    <td className="px-1">
                      {lineas.length > 2 && (
                        <button onClick={() => setLineas((p) => p.filter((_, j) => j !== i))}
                          className="text-slate-500 hover:text-red-400 p-1">
                          <X size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-800/50">
                <tr>
                  <td colSpan={2} className="px-3 py-2">
                    <button onClick={() => setLineas((p) => [...p, emptyLinea()])}
                      className="text-[#00D4FF] text-xs hover:underline flex items-center gap-1">
                      <Plus size={12} /> Agregar línea
                    </button>
                  </td>
                  <td className={`px-3 py-2 text-right text-xs font-mono font-bold ${cuadrado ? 'text-green-400' : 'text-white'}`}>
                    {fmt(totalDebe)}
                  </td>
                  <td className={`px-3 py-2 text-right text-xs font-mono font-bold ${cuadrado ? 'text-green-400' : 'text-white'}`}>
                    {fmt(totalHaber)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {!cuadrado && totalDebe > 0 && (
            <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/30 rounded-lg px-3 py-2">
              <AlertTriangle size={14} /> El asiento no cuadra — diferencia: {fmt(Math.abs(totalDebe - totalHaber))}
            </div>
          )}
          {cuadrado && (
            <div className="flex items-center gap-2 text-xs text-green-400 bg-green-400/10 border border-green-400/30 rounded-lg px-3 py-2">
              <CheckCircle2 size={14} /> El asiento cuadra correctamente
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-slate-400">Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !cuadrado}
            className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
            {saving ? <Loader2 size={14} className="animate-spin mr-2" /> : <Check size={14} className="mr-2" />}
            Crear Asiento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Drill-down: movimientos de un grupo de cuentas ──────────────────────────

function DrillDownMovimientos({ cuenta, cuentaIds, empresaId, onVolver }) {
  const [fechaDesde, setDesde] = useState('');
  const [fechaHasta, setHasta] = useState('');

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.movimientosGrupo(empresaId, cuentaIds, fechaDesde, fechaHasta),
    queryFn: () => asientosService.getMovimientosPorGrupo(
      empresaId, cuentaIds,
      fechaDesde || undefined, fechaHasta || undefined
    ),
    enabled: !!empresaId && cuentaIds.length > 0,
  });

  const totalDebe  = rows.reduce((s, r) => s + Number(r.debe),  0);
  const totalHaber = rows.reduce((s, r) => s + Number(r.haber), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onVolver}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors"
        >
          <ChevronLeft size={16} /> Volver al árbol
        </button>
        <div className="h-4 w-px bg-slate-700" />
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${TIPO_COLOR[cuenta.tipo]}`}>
          {TIPO_LABEL[cuenta.tipo]}
        </span>
        <span className="text-white font-semibold">
          <span className="font-mono text-[#00D4FF] mr-2 text-xs">{cuenta.codigo}</span>
          {cuenta.nombre}
        </span>
        <span className="ml-auto text-xs text-slate-500">{rows.length} movimientos</span>
      </div>

      {/* Filtros de fecha */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-slate-400 text-xs whitespace-nowrap">Desde</Label>
          <Input type="date" value={fechaDesde} onChange={(e) => setDesde(e.target.value)}
            className="bg-slate-800 border-slate-700 h-9 text-sm w-36" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-slate-400 text-xs whitespace-nowrap">Hasta</Label>
          <Input type="date" value={fechaHasta} onChange={(e) => setHasta(e.target.value)}
            className="bg-slate-800 border-slate-700 h-9 text-sm w-36" />
        </div>
        <Button onClick={() => refetch()} size="sm" variant="outline"
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw size={14} className="mr-1" /> Actualizar
        </Button>
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800">
            <tr>
              <th className="px-3 py-2.5 text-left text-slate-400 font-medium w-24">Fecha</th>
              <th className="px-3 py-2.5 text-left text-slate-400 font-medium w-28">Asiento</th>
              <th className="px-3 py-2.5 text-left text-slate-400 font-medium">Cuenta</th>
              <th className="px-3 py-2.5 text-left text-slate-400 font-medium">Descripción</th>
              <th className="px-3 py-2.5 text-right text-slate-400 font-medium w-28">Debe</th>
              <th className="px-3 py-2.5 text-right text-slate-400 font-medium w-28">Haber</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="py-12 text-center text-slate-500">
                <Loader2 size={20} className="animate-spin mx-auto" />
              </td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="py-12 text-center text-slate-500">
                No hay movimientos confirmados en este grupo
              </td></tr>
            )}
            {rows.map((row, i) => {
              const asiento = row.asientos_contables;
              const pc      = row.plan_cuentas;
              const fecha   = asiento?.fecha ? asiento.fecha.slice(0, 10).split('-').reverse().join('/') : '—';
              return (
                <tr key={row.id ?? i} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{fecha}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[#00D4FF]">{asiento?.numero ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-[10px] text-slate-500 mr-1">{pc?.codigo}</span>
                    <span className="text-slate-300 text-xs">{pc?.nombre}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-400 text-xs max-w-[200px] truncate">
                    {row.descripcion || asiento?.descripcion || '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {Number(row.debe) > 0 ? <span className="text-slate-200">{fmt(row.debe)}</span> : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {Number(row.haber) > 0 ? <span className="text-slate-200">{fmt(row.haber)}</span> : <span className="text-slate-600">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-slate-800">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-slate-400 font-semibold text-xs">TOTALES</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-white text-xs">{fmt(totalDebe)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-white text-xs">{fmt(totalHaber)}</td>
              </tr>
              <tr>
                <td colSpan={5} className="px-3 py-1 text-slate-500 text-xs">Saldo neto (D-H)</td>
                <td className={`px-3 py-1 text-right font-mono font-bold text-xs ${totalDebe - totalHaber >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {fmt(Math.abs(totalDebe - totalHaber))} {totalDebe - totalHaber >= 0 ? '(D)' : '(H)'}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─── Tab: Plan de Cuentas ────────────────────────────────────────────────────

function TabPlanCuentas({ cuentasFlat, tree, empresaId, onRefresh }) {
  const [search, setSearch]         = useState('');
  const [showModal, setShowModal]   = useState(false);
  const [editCuenta, setEditCuenta] = useState(null);
  const [drillDown, setDrillDown]   = useState(null); // { cuenta, ids[] }
  const { toast } = useToast();

  const handleSeedCuentas = async () => {
    try {
      await planCuentasService.seedCuentas(empresaId);
      toast({ title: 'Plan de cuentas inicializado', className: 'bg-green-900 border-green-700 text-white' });
      onRefresh();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleToggleActiva = async (cuenta) => {
    try {
      await planCuentasService.updateCuenta(cuenta.id, { activa: !cuenta.activa });
      onRefresh();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  if (cuentasFlat.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <BookOpen size={48} className="text-slate-600" />
        <p className="text-slate-400 text-lg font-medium">Plan de cuentas vacío</p>
        <p className="text-slate-500 text-sm">Podés inicializarlo con las cuentas estándar para PyMEs argentinas</p>
        <Button onClick={handleSeedCuentas} className="bg-[#00D4FF] text-black hover:bg-[#00bfe8] mt-2">
          <RefreshCw size={16} className="mr-2" /> Inicializar Plan Estándar
        </Button>
      </div>
    );
  }

  // Drill-down activo → mostrar movimientos del grupo seleccionado
  if (drillDown) {
    return (
      <DrillDownMovimientos
        cuenta={drillDown.cuenta}
        cuentaIds={drillDown.ids}
        empresaId={empresaId}
        onVolver={() => setDrillDown(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-slate-800 border-slate-700 h-9 text-sm" placeholder="Buscar cuenta..." />
        </div>
        <Button onClick={() => setShowModal(true)} size="sm"
          className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
          <Plus size={14} className="mr-1" /> Nueva cuenta
        </Button>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900/50 overflow-hidden">
        <div className="p-3 space-y-1">
          {tree.map((raiz) => (
            <CuentaNode key={raiz.id} cuenta={raiz} depth={0}
              onEdit={setEditCuenta}
              onViewMovimientos={(cuenta, ids) => setDrillDown({ cuenta, ids })}
              search={search} />
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-600 text-right flex items-center justify-end gap-1">
        {cuentasFlat.length} cuentas en total — hover para ver movimientos <List size={11} />
      </p>

      <ModalNuevaCuenta
        open={showModal}
        onClose={() => setShowModal(false)}
        cuentasFlat={cuentasFlat}
        empresaId={empresaId}
        onSuccess={onRefresh}
      />

      {/* Modal editar cuenta */}
      <Dialog open={!!editCuenta} onOpenChange={() => setEditCuenta(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar Cuenta</DialogTitle>
            <DialogDescription>Modificá el nombre y estado de la cuenta contable.</DialogDescription>
          </DialogHeader>
          {editCuenta && (
            <div className="space-y-3 py-2">
              <div>
                <Label className="text-slate-400 text-xs">Nombre</Label>
                <Input value={editCuenta.nombre}
                  onChange={(e) => setEditCuenta({ ...editCuenta, nombre: e.target.value })}
                  className="bg-slate-800 border-slate-700" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editCuenta.activa}
                  onChange={(e) => setEditCuenta({ ...editCuenta, activa: e.target.checked })}
                  className="w-4 h-4 rounded" />
                <span className="text-sm text-slate-300">Cuenta activa</span>
              </label>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setEditCuenta(null)} className="text-slate-400">Cancelar</Button>
            <Button onClick={async () => {
              try {
                await planCuentasService.updateCuenta(editCuenta.id, {
                  nombre: editCuenta.nombre, activa: editCuenta.activa,
                });
                onRefresh();
                setEditCuenta(null);
              } catch (e) {
                toast({ title: 'Error', description: e.message, variant: 'destructive' });
              }
            }} className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab: Asientos Contables ──────────────────────────────────────────────────

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
              <th className="px-4 py-3 text-left text-slate-400 font-medium">Nº</th>
              <th className="px-4 py-3 text-left text-slate-400 font-medium">Fecha</th>
              <th className="px-4 py-3 text-left text-slate-400 font-medium">Descripción</th>
              <th className="px-4 py-3 text-right text-slate-400 font-medium">Debe</th>
              <th className="px-4 py-3 text-right text-slate-400 font-medium">Haber</th>
              <th className="px-4 py-3 text-center text-slate-400 font-medium">Estado</th>
              <th className="px-4 py-3 text-center text-slate-400 font-medium">Acciones</th>
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
                      className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors" title="Ver detalle">
                      <Eye size={14} />
                    </button>
                    {a.estado === 'borrador' && (
                      <>
                        <button onClick={() => handleConfirmar(a.id)}
                          className="p-1.5 rounded text-slate-400 hover:text-green-400 hover:bg-green-500/10 transition-colors" title="Confirmar">
                          <CheckCircle2 size={14} />
                        </button>
                        <button onClick={() => handleAnular(a.id)}
                          className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Anular">
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
        <div className="flex items-center justify-between text-sm text-slate-400">
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
                      <th className="px-3 py-2 text-left text-slate-400">Cuenta</th>
                      <th className="px-3 py-2 text-right text-slate-400">Debe</th>
                      <th className="px-3 py-2 text-right text-slate-400">Haber</th>
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
                      <td className="px-3 py-2 text-slate-400 font-medium">Total</td>
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

// ─── Tab: Balance de Comprobación ─────────────────────────────────────────────

function TabBalance({ empresaId }) {
  const [fechaDesde, setDesde] = useState('');
  const [fechaHasta, setHasta] = useState('');
  const { toast } = useToast();

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.balance(empresaId, fechaDesde, fechaHasta),
    queryFn: () => asientosService.getBalanceComprobacion(empresaId, fechaDesde || undefined, fechaHasta || undefined),
    enabled: !!empresaId,
  });

  const totalDebe  = rows.reduce((s, r) => s + r.total_debe,  0);
  const totalHaber = rows.reduce((s, r) => s + r.total_haber, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-slate-400 text-xs whitespace-nowrap">Desde</Label>
          <Input type="date" value={fechaDesde} onChange={(e) => setDesde(e.target.value)}
            className="bg-slate-800 border-slate-700 h-9 text-sm w-36" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-slate-400 text-xs whitespace-nowrap">Hasta</Label>
          <Input type="date" value={fechaHasta} onChange={(e) => setHasta(e.target.value)}
            className="bg-slate-800 border-slate-700 h-9 text-sm w-36" />
        </div>
        <Button onClick={() => refetch()} size="sm" variant="outline"
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw size={14} className="mr-1" /> Actualizar
        </Button>
      </div>

      <div className="rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-slate-400 font-medium">Código</th>
              <th className="px-4 py-3 text-left text-slate-400 font-medium">Cuenta</th>
              <th className="px-4 py-3 text-center text-slate-400 font-medium">Tipo</th>
              <th className="px-4 py-3 text-right text-slate-400 font-medium">Debe</th>
              <th className="px-4 py-3 text-right text-slate-400 font-medium">Haber</th>
              <th className="px-4 py-3 text-right text-slate-400 font-medium">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-12 text-slate-500">
                <Loader2 size={20} className="animate-spin mx-auto" />
              </td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-slate-500">
                No hay movimientos confirmados
              </td></tr>
            )}
            {rows.map((r) => {
              const saldo = r.total_debe - r.total_haber;
              return (
                <tr key={r.cuenta_id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="px-4 py-2.5 font-mono text-xs text-[#00D4FF]">{r.codigo}</td>
                  <td className="px-4 py-2.5 text-slate-300">{r.nombre}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${TIPO_COLOR[r.tipo]}`}>
                      {TIPO_LABEL[r.tipo]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-300">{fmt(r.total_debe)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-300">{fmt(r.total_haber)}</td>
                  <td className={`px-4 py-2.5 text-right font-mono font-bold ${saldo >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {fmt(Math.abs(saldo))} {saldo < 0 ? '(H)' : '(D)'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-slate-800">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-slate-400 font-semibold">TOTALES</td>
                <td className={`px-4 py-3 text-right font-mono font-bold ${Math.abs(totalDebe - totalHaber) < 0.01 ? 'text-green-400' : 'text-white'}`}>
                  {fmt(totalDebe)}
                </td>
                <td className={`px-4 py-3 text-right font-mono font-bold ${Math.abs(totalDebe - totalHaber) < 0.01 ? 'text-green-400' : 'text-white'}`}>
                  {fmt(totalHaber)}
                </td>
                <td className={`px-4 py-3 text-right text-xs font-medium ${Math.abs(totalDebe - totalHaber) < 0.01 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {Math.abs(totalDebe - totalHaber) < 0.01 ? '✓ Cuadra' : `Dif: ${fmt(Math.abs(totalDebe - totalHaber))}`}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─── Tab: Libro Mayor ─────────────────────────────────────────────────────────

function TabLibroMayor({ empresaId, cuentasFlat }) {
  const [cuentaId, setCuentaId] = useState('');
  const [fechaDesde, setDesde]  = useState('');
  const [fechaHasta, setHasta]  = useState('');

  const cuentasConMov = cuentasFlat.filter(c => c.permite_movimientos);
  const cuentaSeleccionada = cuentasFlat.find(c => c.id === cuentaId);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.libroMayor(empresaId, cuentaId, fechaDesde, fechaHasta),
    queryFn: () => asientosService.getLibroMayor(
      empresaId, cuentaId,
      fechaDesde || undefined, fechaHasta || undefined
    ),
    enabled: !!empresaId && !!cuentaId,
  });

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={cuentaId} onValueChange={setCuentaId}>
          <SelectTrigger className="w-72 bg-slate-800 border-slate-700 h-9 text-sm">
            <SelectValue placeholder="Seleccionar cuenta..." />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            {cuentasConMov.map(c => (
              <SelectItem key={c.id} value={c.id}>
                <span className="font-mono text-[#00D4FF] mr-2 text-xs">{c.codigo}</span>
                {c.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Label className="text-slate-400 text-xs whitespace-nowrap">Desde</Label>
          <Input type="date" value={fechaDesde} onChange={e => setDesde(e.target.value)}
            className="bg-slate-800 border-slate-700 h-9 text-sm w-36" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-slate-400 text-xs whitespace-nowrap">Hasta</Label>
          <Input type="date" value={fechaHasta} onChange={e => setHasta(e.target.value)}
            className="bg-slate-800 border-slate-700 h-9 text-sm w-36" />
        </div>
        <Button onClick={() => refetch()} size="sm" variant="outline" disabled={!cuentaId}
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw size={14} className="mr-1" /> Actualizar
        </Button>
      </div>

      {/* Placeholder cuando no hay cuenta seleccionada */}
      {!cuentaId && (
        <div className="text-center py-20 text-slate-500">
          <BookMarked size={36} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">Seleccioná una cuenta para ver sus movimientos</p>
          <p className="text-xs mt-1 text-slate-600">Solo se muestran asientos confirmados</p>
        </div>
      )}

      {/* Encabezado de cuenta seleccionada */}
      {cuentaId && cuentaSeleccionada && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${TIPO_COLOR[cuentaSeleccionada.tipo]}`}>
            {TIPO_LABEL[cuentaSeleccionada.tipo]}
          </span>
          <span className="font-mono text-[#00D4FF] text-sm">{cuentaSeleccionada.codigo}</span>
          <span className="font-semibold text-white">{cuentaSeleccionada.nombre}</span>
          {rows.length > 0 && (
            <span className="ml-auto text-slate-400 text-xs">{rows.length} movimiento{rows.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      )}

      {/* Tabla */}
      {cuentaId && (
        <div className="rounded-xl border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800">
              <tr>
                <th className="px-4 py-3 text-left text-slate-400 font-medium">Fecha</th>
                <th className="px-4 py-3 text-left text-slate-400 font-medium">Asiento</th>
                <th className="px-4 py-3 text-left text-slate-400 font-medium">Descripción</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium">Debe</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium">Haber</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="text-center py-12 text-slate-500">
                  <Loader2 size={20} className="animate-spin mx-auto" />
                </td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-slate-500">
                  Sin movimientos confirmados para esta cuenta
                </td></tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-800 hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-2.5 text-slate-300 whitespace-nowrap">
                    {new Date(row.asientos_contables.fecha + 'T12:00:00').toLocaleDateString('es-AR')}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[#00D4FF]">
                    {row.asientos_contables.numero}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 max-w-xs truncate">
                    {row.descripcion || row.asientos_contables.descripcion || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                    {Number(row.debe) > 0 ? fmt(row.debe) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                    {Number(row.haber) > 0 ? fmt(row.haber) : '—'}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono font-bold ${row.saldo_acumulado >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                    {fmt(Math.abs(row.saldo_acumulado))}
                    <span className="text-[10px] ml-1">{row.saldo_acumulado >= 0 ? 'D' : 'H'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (() => {
              const last = rows[rows.length - 1];
              const totalDebe  = rows.reduce((s, r) => s + Number(r.debe),  0);
              const totalHaber = rows.reduce((s, r) => s + Number(r.haber), 0);
              return (
                <tfoot className="bg-slate-800">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-slate-400 font-semibold">SALDO FINAL</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-300">{fmt(totalDebe)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-300">{fmt(totalHaber)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold text-lg ${last.saldo_acumulado >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                      {fmt(Math.abs(last.saldo_acumulado))} {last.saldo_acumulado >= 0 ? '(D)' : '(H)'}
                    </td>
                  </tr>
                </tfoot>
              );
            })()}
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Períodos Contables ──────────────────────────────────────────────────

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function TabPeriodos({ empresaId, userId, isAdmin }) {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const { toast } = useToast();

  const { data: periodos = [], isLoading, refetch } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.periodos(empresaId, anio),
    queryFn: () => periodosService.getPeriodosAnio(empresaId, anio),
    enabled: !!empresaId,
  });

  const handleToggle = async (mes, cerrado) => {
    try {
      await periodosService.togglePeriodo(empresaId, anio, mes, cerrado, userId);
      toast({
        title: cerrado ? `Período ${MESES[mes - 1]} ${anio} cerrado` : `Período ${MESES[mes - 1]} ${anio} reabierto`,
        className: 'bg-green-900 border-green-700 text-white',
      });
      refetch();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const hoy = new Date();

  return (
    <div className="space-y-6">
      {/* Selector de año */}
      <div className="flex items-center gap-3">
        <button onClick={() => setAnio(a => a - 1)}
          className="p-2 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
          <ChevronLeft size={16} />
        </button>
        <span className="text-white font-bold text-xl w-16 text-center">{anio}</span>
        <button onClick={() => setAnio(a => a + 1)}
          className="p-2 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
          <ChevronRight size={16} />
        </button>
        <span className="ml-4 text-xs text-slate-500">
          Los períodos cerrados bloquean la creación de nuevos asientos contables en ese mes.
        </span>
      </div>

      {isLoading ? (
        <div className="py-12 text-center"><Loader2 size={24} className="animate-spin mx-auto text-[#00D4FF]" /></div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {MESES.map((nombre, i) => {
            const mes = i + 1;
            const periodo = periodos.find(p => p.mes === mes);
            const isCerrado = periodo?.cerrado ?? false;
            const isFuturo = anio > hoy.getFullYear() ||
              (anio === hoy.getFullYear() && mes > hoy.getMonth() + 1);

            return (
              <div key={mes} className={`p-4 rounded-xl border transition-all ${
                isCerrado
                  ? 'bg-red-900/20 border-red-800/50'
                  : isFuturo
                  ? 'bg-slate-800/30 border-slate-800 opacity-50'
                  : 'bg-green-900/10 border-green-800/30'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-white text-sm">{nombre}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                    isCerrado
                      ? 'bg-red-500/10 text-red-400 border-red-500/30'
                      : isFuturo
                      ? 'bg-slate-500/10 text-slate-500 border-slate-500/30'
                      : 'bg-green-500/10 text-green-400 border-green-500/30'
                  }`}>
                    {isFuturo ? 'Futuro' : isCerrado ? 'Cerrado' : 'Abierto'}
                  </span>
                </div>

                {isCerrado && periodo?.fecha_cierre && (
                  <p className="text-[10px] text-slate-500 mb-2">
                    Cerrado: {new Date(periodo.fecha_cierre).toLocaleDateString('es-AR')}
                  </p>
                )}

                {isAdmin && !isFuturo && (
                  <button
                    onClick={() => handleToggle(mes, !isCerrado)}
                    className={`w-full text-xs py-1.5 px-3 rounded-lg border flex items-center justify-center gap-1.5 transition-colors ${
                      isCerrado
                        ? 'border-green-700 text-green-400 hover:bg-green-900/20'
                        : 'border-red-800 text-red-400 hover:bg-red-900/20'
                    }`}>
                    {isCerrado ? <><Unlock size={11} /> Reabrir</> : <><Lock size={11} /> Cerrar período</>}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!isAdmin && (
        <p className="text-slate-500 text-xs text-center">Solo el administrador puede cerrar o reabrir períodos.</p>
      )}
    </div>
  );
}

// ─── Tab: Estado de Resultados (P&L) ─────────────────────────────────────────

function TabEstadoResultados({ empresaId }) {
  const [fechaDesde, setDesde] = useState(`${new Date().getFullYear()}-01-01`);
  const [fechaHasta, setHasta] = useState(`${new Date().getFullYear()}-12-31`);

  const { data, isLoading, refetch } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.estadoResultados(empresaId, fechaDesde, fechaHasta),
    queryFn:  () => asientosService.getEstadoResultados(empresaId, fechaDesde || undefined, fechaHasta || undefined),
    enabled:  !!empresaId,
  });

  const { ingresos = [], egresos = [], totalIngresos = 0, totalEgresos = 0, resultado = 0 } = data ?? {};
  const esPositivo = resultado >= 0;

  const SeccionRows = ({ filas }) => filas.map(r => (
    <tr key={r.cuenta_id} className="border-t border-slate-800 hover:bg-slate-800/30">
      <td className="px-4 py-2.5 font-mono text-xs text-[#00D4FF]">{r.codigo}</td>
      <td className="px-4 py-2.5 text-slate-300">{r.nombre}</td>
      <td className="px-4 py-2.5 text-right font-mono text-slate-200">{fmt(r.saldo)}</td>
    </tr>
  ));

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-slate-400 text-xs whitespace-nowrap">Desde</Label>
          <Input type="date" value={fechaDesde} onChange={e => setDesde(e.target.value)}
            className="bg-slate-800 border-slate-700 h-9 text-sm w-36" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-slate-400 text-xs whitespace-nowrap">Hasta</Label>
          <Input type="date" value={fechaHasta} onChange={e => setHasta(e.target.value)}
            className="bg-slate-800 border-slate-700 h-9 text-sm w-36" />
        </div>
        <Button onClick={() => refetch()} size="sm" variant="outline"
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw size={14} className="mr-1" /> Actualizar
        </Button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center"><Loader2 size={24} className="animate-spin mx-auto text-[#00D4FF]" /></div>
      ) : (
        <>
          {/* KPIs resumen */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-green-900/20 border border-green-800/30">
              <p className="text-xs text-green-400 uppercase font-semibold mb-1 flex items-center gap-1"><TrendingUp size={12} /> Ingresos</p>
              <p className="text-2xl font-bold text-green-400 font-mono">{fmt(totalIngresos)}</p>
            </div>
            <div className="p-4 rounded-xl bg-red-900/20 border border-red-800/30">
              <p className="text-xs text-red-400 uppercase font-semibold mb-1 flex items-center gap-1"><TrendingDown size={12} /> Egresos</p>
              <p className="text-2xl font-bold text-red-400 font-mono">{fmt(totalEgresos)}</p>
            </div>
            <div className={`p-4 rounded-xl border ${esPositivo ? 'bg-blue-900/20 border-blue-800/30' : 'bg-orange-900/20 border-orange-800/30'}`}>
              <p className={`text-xs uppercase font-semibold mb-1 ${esPositivo ? 'text-blue-400' : 'text-orange-400'}`}>
                Resultado Neto
              </p>
              <p className={`text-2xl font-bold font-mono ${esPositivo ? 'text-blue-400' : 'text-orange-400'}`}>
                {fmt(Math.abs(resultado))} {esPositivo ? '(Ganancia)' : '(Pérdida)'}
              </p>
            </div>
          </div>

          {/* Tabla detalle */}
          <div className="rounded-xl border border-slate-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800">
                <tr>
                  <th className="px-4 py-3 text-left text-slate-400 font-medium w-24">Código</th>
                  <th className="px-4 py-3 text-left text-slate-400 font-medium">Cuenta</th>
                  <th className="px-4 py-3 text-right text-slate-400 font-medium w-36">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {ingresos.length > 0 && (
                  <tr className="bg-green-900/10">
                    <td colSpan={3} className="px-4 py-2 text-xs font-bold text-green-400 uppercase tracking-wider flex items-center gap-1">
                      <TrendingUp size={11} /> INGRESOS
                    </td>
                  </tr>
                )}
                <SeccionRows filas={ingresos} />
                {ingresos.length > 0 && (
                  <tr className="bg-green-900/20 border-t border-green-800/30">
                    <td colSpan={2} className="px-4 py-2.5 text-sm font-bold text-green-400">Total Ingresos</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-green-400">{fmt(totalIngresos)}</td>
                  </tr>
                )}
                {egresos.length > 0 && (
                  <tr className="bg-red-900/10">
                    <td colSpan={3} className="px-4 py-2 text-xs font-bold text-red-400 uppercase tracking-wider">
                      EGRESOS / GASTOS
                    </td>
                  </tr>
                )}
                <SeccionRows filas={egresos} />
                {egresos.length > 0 && (
                  <tr className="bg-red-900/20 border-t border-red-800/30">
                    <td colSpan={2} className="px-4 py-2.5 text-sm font-bold text-red-400">Total Egresos</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-red-400">{fmt(totalEgresos)}</td>
                  </tr>
                )}
                {ingresos.length === 0 && egresos.length === 0 && (
                  <tr><td colSpan={3} className="py-12 text-center text-slate-500">
                    No hay movimientos confirmados en el período seleccionado
                  </td></tr>
                )}
              </tbody>
              {(ingresos.length > 0 || egresos.length > 0) && (
                <tfoot className={`${esPositivo ? 'bg-blue-900/30' : 'bg-orange-900/30'}`}>
                  <tr>
                    <td colSpan={2} className={`px-4 py-3 font-bold text-base ${esPositivo ? 'text-blue-300' : 'text-orange-300'}`}>
                      RESULTADO DEL PERÍODO
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-bold text-xl ${esPositivo ? 'text-blue-300' : 'text-orange-300'}`}>
                      {esPositivo ? '+' : '-'}{fmt(Math.abs(resultado))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Balance General ─────────────────────────────────────────────────────

function TabBalanceGeneral({ empresaId }) {
  const [fechaHasta, setHasta] = useState(new Date().toISOString().slice(0, 10));

  const { data, isLoading, refetch } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.balanceGeneral(empresaId, undefined, fechaHasta),
    queryFn:  () => asientosService.getBalanceGeneral(empresaId, undefined, fechaHasta || undefined),
    enabled:  !!empresaId,
  });

  const { activos = [], pasivos = [], patrimonio = [], totalActivos = 0, totalPasivos = 0, totalPatrimonio = 0 } = data ?? {};
  const totalPasivosYPN = totalPasivos + totalPatrimonio;
  const cuadra = Math.abs(totalActivos - totalPasivosYPN) < 0.01;

  const GrupoRows = ({ filas }) => filas.map(r => (
    <tr key={r.cuenta_id} className="border-t border-slate-800 hover:bg-slate-800/30">
      <td className="px-4 py-2.5 font-mono text-xs text-[#00D4FF]">{r.codigo}</td>
      <td className="px-4 py-2.5 text-slate-300">{r.nombre}</td>
      <td className="px-4 py-2.5 text-right font-mono text-slate-200">{fmt(r.saldo)}</td>
    </tr>
  ));

  return (
    <div className="space-y-4">
      {/* Filtro fecha hasta */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-slate-400 text-xs whitespace-nowrap">Al día</Label>
          <Input type="date" value={fechaHasta} onChange={e => setHasta(e.target.value)}
            className="bg-slate-800 border-slate-700 h-9 text-sm w-36" />
        </div>
        <Button onClick={() => refetch()} size="sm" variant="outline"
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw size={14} className="mr-1" /> Actualizar
        </Button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center"><Loader2 size={24} className="animate-spin mx-auto text-[#00D4FF]" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Columna izquierda: ACTIVO */}
          <div className="rounded-xl border border-blue-800/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-blue-900/30">
                <tr>
                  <th colSpan={3} className="px-4 py-3 text-left text-blue-300 font-bold text-base">ACTIVO</th>
                </tr>
                <tr className="bg-slate-800/50">
                  <th className="px-4 py-2 text-left text-slate-400 font-medium text-xs w-20">Código</th>
                  <th className="px-4 py-2 text-left text-slate-400 font-medium text-xs">Cuenta</th>
                  <th className="px-4 py-2 text-right text-slate-400 font-medium text-xs w-32">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {activos.length === 0
                  ? <tr><td colSpan={3} className="py-8 text-center text-slate-600 text-xs">Sin movimientos</td></tr>
                  : <GrupoRows filas={activos} />
                }
              </tbody>
              <tfoot className="bg-blue-900/20 border-t border-blue-800/30">
                <tr>
                  <td colSpan={2} className="px-4 py-3 font-bold text-blue-300">TOTAL ACTIVO</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-blue-300 text-base">{fmt(totalActivos)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Columna derecha: PASIVO + PN */}
          <div className="space-y-4">
            <div className="rounded-xl border border-red-800/30 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-red-900/30">
                  <tr>
                    <th colSpan={3} className="px-4 py-3 text-left text-red-300 font-bold text-base">PASIVO</th>
                  </tr>
                  <tr className="bg-slate-800/50">
                    <th className="px-4 py-2 text-left text-slate-400 font-medium text-xs w-20">Código</th>
                    <th className="px-4 py-2 text-left text-slate-400 font-medium text-xs">Cuenta</th>
                    <th className="px-4 py-2 text-right text-slate-400 font-medium text-xs w-32">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {pasivos.length === 0
                    ? <tr><td colSpan={3} className="py-6 text-center text-slate-600 text-xs">Sin movimientos</td></tr>
                    : <GrupoRows filas={pasivos} />
                  }
                </tbody>
                <tfoot className="bg-red-900/20 border-t border-red-800/30">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 font-bold text-red-300">TOTAL PASIVO</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-red-300">{fmt(totalPasivos)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="rounded-xl border border-purple-800/30 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-purple-900/30">
                  <tr>
                    <th colSpan={3} className="px-4 py-3 text-left text-purple-300 font-bold text-base">PATRIMONIO NETO</th>
                  </tr>
                  <tr className="bg-slate-800/50">
                    <th className="px-4 py-2 text-left text-slate-400 font-medium text-xs w-20">Código</th>
                    <th className="px-4 py-2 text-left text-slate-400 font-medium text-xs">Cuenta</th>
                    <th className="px-4 py-2 text-right text-slate-400 font-medium text-xs w-32">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {patrimonio.length === 0
                    ? <tr><td colSpan={3} className="py-6 text-center text-slate-600 text-xs">Sin movimientos</td></tr>
                    : <GrupoRows filas={patrimonio} />
                  }
                </tbody>
                <tfoot className="bg-purple-900/20 border-t border-purple-800/30">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 font-bold text-purple-300">TOTAL PATRIMONIO NETO</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-purple-300">{fmt(totalPatrimonio)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Ecuación de cierre */}
            <div className={`p-4 rounded-xl border text-center ${cuadra ? 'bg-green-900/20 border-green-800/30' : 'bg-yellow-900/20 border-yellow-800/30'}`}>
              <div className="flex items-center justify-center gap-2 text-sm font-mono">
                <span className="text-blue-400">{fmt(totalActivos)}</span>
                <span className="text-slate-400">=</span>
                <span className="text-red-400">{fmt(totalPasivos)}</span>
                <span className="text-slate-400">+</span>
                <span className="text-purple-400">{fmt(totalPatrimonio)}</span>
              </div>
              {cuadra
                ? <p className="text-xs text-green-400 mt-2 flex items-center justify-center gap-1"><CheckCircle2 size={12} /> Balance cuadra correctamente</p>
                : <p className="text-xs text-yellow-400 mt-2 flex items-center justify-center gap-1">
                    <AlertTriangle size={12} /> Diferencia: {fmt(Math.abs(totalActivos - totalPasivosYPN))} — Verificar asientos manuales o agregar Resultado del Ejercicio al PN.
                  </p>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function PlanCuentasSection() {
  const { user } = useAuth();
  const empresaId = user?.empresa_id;
  const userId    = user?.id;
  const qc        = useQueryClient();

  const { data: cuentasFlat = [], isLoading } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.cuentas(empresaId),
    queryFn: () => planCuentasService.getCuentas(empresaId),
    enabled: !!empresaId,
    staleTime: 2 * 60 * 1000,
  });

  const tree = useMemo(() => planCuentasService.buildTree(cuentasFlat), [cuentasFlat]);

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ['plan_cuentas', empresaId] });
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <BookOpen size={18} className="text-white" />
            </div>
            Plan de Cuentas
          </h1>
          <p className="text-slate-400 text-sm mt-1">Contabilidad · Libro diario · Balance de comprobación</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-[#00D4FF]" />
        </div>
      ) : (
        <Tabs defaultValue="cuentas" className="space-y-4">
          <TabsList className="bg-slate-800 border border-slate-700 p-1 flex-wrap gap-1">
            <TabsTrigger value="cuentas"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-slate-400 gap-2">
              <ListOrdered size={14} /> Plan de Cuentas
            </TabsTrigger>
            <TabsTrigger value="asientos"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-slate-400 gap-2">
              <FileText size={14} /> Asientos
            </TabsTrigger>
            <TabsTrigger value="balance"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-slate-400 gap-2">
              <BarChart2 size={14} /> Balance
            </TabsTrigger>
            <TabsTrigger value="libro_mayor"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-slate-400 gap-2">
              <BookMarked size={14} /> Libro Mayor
            </TabsTrigger>
            <TabsTrigger value="estado_resultados"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-slate-400 gap-2">
              <TrendingUp size={14} /> P&amp;L
            </TabsTrigger>
            <TabsTrigger value="balance_general"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-slate-400 gap-2">
              <Scale size={14} /> Balance General
            </TabsTrigger>
            <TabsTrigger value="periodos"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-slate-400 gap-2">
              <Calendar size={14} /> Períodos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cuentas">
            <TabPlanCuentas
              cuentasFlat={cuentasFlat}
              tree={tree}
              empresaId={empresaId}
              onRefresh={handleRefresh}
            />
          </TabsContent>

          <TabsContent value="asientos">
            <TabAsientos
              empresaId={empresaId}
              userId={userId}
              cuentasFlat={cuentasFlat}
              onRefresh={handleRefresh}
            />
          </TabsContent>

          <TabsContent value="balance">
            <TabBalance empresaId={empresaId} />
          </TabsContent>

          <TabsContent value="libro_mayor">
            <TabLibroMayor empresaId={empresaId} cuentasFlat={cuentasFlat} />
          </TabsContent>

          <TabsContent value="estado_resultados">
            <TabEstadoResultados empresaId={empresaId} />
          </TabsContent>

          <TabsContent value="balance_general">
            <TabBalanceGeneral empresaId={empresaId} />
          </TabsContent>

          <TabsContent value="periodos">
            <TabPeriodos empresaId={empresaId} userId={userId} isAdmin={user?.role === 'admin'} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
