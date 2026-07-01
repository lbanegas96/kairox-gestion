import React, { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Landmark, Plus, Upload, Pencil, Trash2, ArrowUpCircle, ArrowDownCircle,
  RefreshCw, FileText, ChevronRight, X, Building2, Wallet, CheckCircle2, Link2, Unlink2, Zap,
  Eye, EyeOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import {
  cuentasService, movimientosService,
  CB_KEYS,
} from '@/services/cuentasBancariasService';
import { getTodayAR, formatDateAR } from '@/lib/dateUtils';
import { conciliacionService, CONC_KEYS } from '@/services/conciliacionService';
import { parseNumberLocale } from '@/lib/currencyUtils';

const BANCOS_COMUNES = ['Ualá', 'Mercado Pago', 'Banco Galicia', 'Banco Santander', 'BBVA', 'HSBC', 'Banco Nación', 'Banco Provincia', 'Brubank', 'Naranja X', 'Otro'];

function formatMoney(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n ?? 0);
}

// ─── Modal Nueva/Editar Cuenta ─────────────────────────────────────────────

function CuentaModal({ open, onClose, cuenta, empresaId }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [cuentasContables, setCuentasContables] = useState([]);
  const [form, setForm] = useState({
    nombre: '',
    banco: '',
    cbu_alias: '',
    moneda: 'ARS',
    plan_cuenta_id: '',
  });

  React.useEffect(() => {
    if (!open) return;
    setForm({
      nombre: cuenta?.nombre ?? '',
      banco: cuenta?.banco ?? '',
      cbu_alias: cuenta?.cbu_alias ?? '',
      moneda: cuenta?.moneda ?? 'ARS',
      plan_cuenta_id: cuenta?.plan_cuenta_id ?? '',
    });
    // Cargar cuentas contables de tipo activo para el selector
    supabase
      .from('plan_cuentas')
      .select('id, codigo, nombre, tipo')
      .eq('empresa_id', empresaId)
      .in('tipo', ['activo', 'patrimonioNeto'])
      .order('codigo')
      .then(({ data }) => setCuentasContables(data ?? []));
  }, [open, cuenta, empresaId]);

  const mutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        empresa_id: empresaId,
        nombre: data.nombre,
        banco: data.banco,
        cbu_alias: data.cbu_alias || null,
        moneda: data.moneda,
        plan_cuenta_id: data.plan_cuenta_id || null,
        activo: true,
      };
      if (cuenta) {
        await cuentasService.update(cuenta.id, payload);
      } else {
        await cuentasService.create(payload);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CB_KEYS.cuentas(empresaId) });
      toast({ title: cuenta ? 'Cuenta actualizada' : 'Cuenta creada', className: 'bg-green-600 text-white' });
      onClose();
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.nombre || !form.banco) return;
    mutation.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{cuenta ? 'Editar cuenta' : 'Nueva cuenta bancaria'}</DialogTitle>
          <DialogDescription>Completá los datos de la cuenta. El vínculo con el Plan de Cuentas permite generar asientos automáticos.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nombre de la cuenta *</Label>
              <Input value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="ej: Ualá Personal, Galicia Cta. Cte." required />
            </div>
            <div className="col-span-2">
              <Label>Banco *</Label>
              <Select value={form.banco} onValueChange={v => setForm(p => ({ ...p, banco: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccionar banco" /></SelectTrigger>
                <SelectContent>
                  {BANCOS_COMUNES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
              {form.banco === 'Otro' && (
                <Input className="mt-2" placeholder="Nombre del banco" onChange={e => setForm(p => ({ ...p, banco: e.target.value }))} />
              )}
            </div>
            <div>
              <Label>CBU / Alias</Label>
              <Input value={form.cbu_alias} onChange={e => setForm(p => ({ ...p, cbu_alias: e.target.value }))} placeholder="opcional" />
            </div>
            <div>
              <Label>Moneda</Label>
              <Select value={form.moneda} onValueChange={v => setForm(p => ({ ...p, moneda: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARS">ARS (Pesos)</SelectItem>
                  <SelectItem value="USD">USD (Dólares)</SelectItem>
                  <SelectItem value="EUR">EUR (Euros)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Cuenta contable (Plan de Cuentas)</Label>
            <Select value={form.plan_cuenta_id || 'none'} onValueChange={v => setForm(p => ({ ...p, plan_cuenta_id: v === 'none' ? '' : v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Sin vincular" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin vincular</SelectItem>
                {cuentasContables.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.codigo} — {c.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-kx-text-3 mt-1">Vinculá esta cuenta bancaria a su cuenta contable para asientos automáticos (próximamente).</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Guardando...' : cuenta ? 'Guardar cambios' : 'Crear cuenta'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal Nuevo Movimiento ────────────────────────────────────────────────

function MovimientoModal({ open, onClose, cuentas, empresaId, defaultCuentaId }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState({
    cuenta_bancaria_id: '',
    fecha: getTodayAR(),
    descripcion: '',
    monto: '',
    tipo: 'egreso',
  });

  React.useEffect(() => {
    if (open) {
      setForm(p => ({
        ...p,
        cuenta_bancaria_id: defaultCuentaId || (cuentas[0]?.id ?? ''),
        fecha: getTodayAR(),
        descripcion: '',
        monto: '',
        tipo: 'egreso',
      }));
    }
  }, [open, defaultCuentaId, cuentas]);

  const mutation = useMutation({
    mutationFn: (data) => movimientosService.create({
      empresa_id: empresaId,
      cuenta_bancaria_id: data.cuenta_bancaria_id,
      fecha: `${data.fecha}T12:00:00`,
      descripcion: data.descripcion,
      monto: parseNumberLocale(data.monto),
      tipo: data.tipo,
      origen: 'manual',
    }),
    onSuccess: () => {
      // Invalidar usando solo el prefijo para que matchee con cualquier queryKey
      // que tenga filters aplicados (CB_KEYS.movimientos arma [..., empresaId, filters]).
      qc.invalidateQueries({ queryKey: ['movimientos_bancarios', empresaId] });
      qc.invalidateQueries({ queryKey: CB_KEYS.movimientosSaldo(empresaId) }); // FIX-SALDO-REAL
      toast({ title: 'Movimiento registrado', className: 'bg-green-600 text-white' });
      onClose();
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    // Validar con mensajes claros en vez de fallar silencioso
    if (!form.cuenta_bancaria_id) {
      toast({ title: 'Seleccioná una cuenta bancaria', variant: 'destructive' });
      return;
    }
    if (!form.descripcion?.trim()) {
      toast({ title: 'Ingresá una descripción', variant: 'destructive' });
      return;
    }
    const monto = parseNumberLocale(form.monto);
    if (!monto || monto <= 0) {
      toast({ title: 'Ingresá un monto mayor a cero', variant: 'destructive' });
      return;
    }
    mutation.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nuevo movimiento</DialogTitle>
          <DialogDescription>Registrá manualmente un ingreso o egreso bancario.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <Label>Cuenta bancaria *</Label>
            <Select value={form.cuenta_bancaria_id} onValueChange={v => setForm(p => ({ ...p, cuenta_bancaria_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Seleccionar cuenta" /></SelectTrigger>
              <SelectContent>
                {cuentas.map(c => <SelectItem key={c.id} value={c.id}>{c.nombre} — {c.banco}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Fecha *</Label>
              <Input type="date" value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} required />
            </div>
            <div>
              <Label>Tipo *</Label>
              <Select value={form.tipo} onValueChange={v => setForm(p => ({ ...p, tipo: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ingreso">Ingreso</SelectItem>
                  <SelectItem value="egreso">Egreso</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Descripción *</Label>
            <Input value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="ej: Transferencia a proveedor" required />
          </div>
          <div>
            <Label>Monto *</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={form.monto}
              onChange={e => {
                // Solo dígitos, coma y punto
                const v = e.target.value.replace(/[^\d.,]/g, '');
                setForm(p => ({ ...p, monto: v }));
              }}
              placeholder="ej. 500.000 ó 500.000,50"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Guardando...' : 'Registrar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal Importar CSV ────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const delim = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delim).map(h => h.replace(/"/g, '').trim());
  const rows = lines.slice(1).map(l =>
    l.split(delim).map(c => c.replace(/"/g, '').trim())
  ).filter(r => r.some(c => c));
  return { headers, rows };
}

function ImportCSVModal({ open, onClose, cuentas, empresaId }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef();
  const [step, setStep] = useState(1); // 1=config, 2=preview
  const [cuentaId, setCuentaId] = useState('');
  const [parsed, setParsed] = useState(null); // { headers, rows }
  const [mapping, setMapping] = useState({ fecha: '', descripcion: '', monto: '', tipo: 'auto' });
  const [tipoOverride, setTipoOverride] = useState('auto'); // auto | ingreso | egreso
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (open) {
      setStep(1);
      setParsed(null);
      setCuentaId(cuentas[0]?.id ?? '');
      setMapping({ fecha: '', descripcion: '', monto: '', tipo: 'auto' });
      setTipoOverride('auto');
    }
  }, [open, cuentas]);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = parseCSV(ev.target.result);
      setParsed(result);
      // Auto-map columns by common names
      const h = result.headers.map(x => x.toLowerCase());
      setMapping({
        fecha: result.headers[h.findIndex(x => x.includes('fec') || x.includes('date'))] || result.headers[0] || '',
        descripcion: result.headers[h.findIndex(x => x.includes('desc') || x.includes('det') || x.includes('concepto') || x.includes('motivo'))] || result.headers[1] || '',
        monto: result.headers[h.findIndex(x => x.includes('monto') || x.includes('importe') || x.includes('amount') || x.includes('debe') || x.includes('cred'))] || result.headers[2] || '',
        tipo: 'auto',
      });
    };
    reader.readAsText(file, 'UTF-8');
  };

  const preview = useMemo(() => {
    if (!parsed || !mapping.fecha || !mapping.monto) return [];
    const fi = parsed.headers.indexOf(mapping.fecha);
    const di = parsed.headers.indexOf(mapping.descripcion);
    const mi = parsed.headers.indexOf(mapping.monto);
    return parsed.rows.slice(0, 10).map(row => {
      const rawMonto = parseFloat((row[mi] || '0').replace(/[^0-9.,-]/g, '').replace(',', '.'));
      const monto = Math.abs(rawMonto);
      let tipo;
      if (tipoOverride !== 'auto') {
        tipo = tipoOverride;
      } else {
        tipo = rawMonto >= 0 ? 'ingreso' : 'egreso';
      }
      return {
        fecha: row[fi] || '',
        descripcion: di >= 0 ? row[di] : '',
        monto,
        tipo,
        valid: !isNaN(monto) && monto > 0,
      };
    });
  }, [parsed, mapping, tipoOverride]);

  const allRows = useMemo(() => {
    if (!parsed || !mapping.fecha || !mapping.monto) return [];
    const fi = parsed.headers.indexOf(mapping.fecha);
    const di = parsed.headers.indexOf(mapping.descripcion);
    const mi = parsed.headers.indexOf(mapping.monto);
    return parsed.rows.map(row => {
      const rawMonto = parseFloat((row[mi] || '0').replace(/[^0-9.,-]/g, '').replace(',', '.'));
      const monto = Math.abs(rawMonto);
      let tipo;
      if (tipoOverride !== 'auto') {
        tipo = tipoOverride;
      } else {
        tipo = rawMonto >= 0 ? 'ingreso' : 'egreso';
      }
      // Parse date: try dd/mm/yyyy and yyyy-mm-dd
      let fecha = row[fi] || '';
      const parts = fecha.split(/[\/\-]/);
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          fecha = `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}T12:00:00`;
        } else {
          fecha = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}T12:00:00`;
        }
      }
      return { empresa_id: empresaId, cuenta_bancaria_id: cuentaId, fecha, descripcion: di >= 0 ? row[di] : '', monto, tipo, origen: 'csv' };
    }).filter(r => !isNaN(r.monto) && r.monto > 0);
  }, [parsed, mapping, tipoOverride, empresaId, cuentaId]);

  const handleImport = async () => {
    if (!allRows.length) return;
    setLoading(true);
    try {
      const count = await movimientosService.bulkCreate(allRows);
      // Invalidar usando solo el prefijo para que matchee con cualquier queryKey
      // que tenga filters aplicados (CB_KEYS.movimientos arma [..., empresaId, filters]).
      qc.invalidateQueries({ queryKey: ['movimientos_bancarios', empresaId] });
      qc.invalidateQueries({ queryKey: CB_KEYS.movimientosSaldo(empresaId) }); // FIX-SALDO-REAL
      toast({ title: `${count} movimientos importados`, className: 'bg-green-600 text-white' });
      onClose();
    } catch (e) {
      toast({ title: 'Error al importar', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar extracto bancario (CSV)</DialogTitle>
          <DialogDescription>Subí el archivo CSV de tu banco y mapeá las columnas.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {/* Cuenta + archivo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Cuenta bancaria destino</Label>
              <Select value={cuentaId} onValueChange={setCuentaId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {cuentas.map(c => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Archivo CSV</Label>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
              <Button type="button" variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" /> {parsed ? `${parsed.rows.length} filas detectadas` : 'Seleccionar archivo'}
              </Button>
            </div>
          </div>

          {parsed && (
            <>
              {/* Mapper de columnas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { key: 'fecha', label: 'Columna Fecha' },
                  { key: 'descripcion', label: 'Columna Descripción' },
                  { key: 'monto', label: 'Columna Monto' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <Label className="text-xs">{label}</Label>
                    {/* Sentinel "__none__" porque Radix no permite value="" en SelectItem */}
                    <Select
                      value={mapping[key] || '__none__'}
                      onValueChange={v => setMapping(p => ({ ...p, [key]: v === '__none__' ? '' : v }))}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">—</SelectItem>
                        {parsed.headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <div>
                  <Label className="text-xs">Tipo de movimiento</Label>
                  <Select value={tipoOverride} onValueChange={setTipoOverride}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (por signo)</SelectItem>
                      <SelectItem value="ingreso">Todos ingresos</SelectItem>
                      <SelectItem value="egreso">Todos egresos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Preview */}
              {preview.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Vista previa — primeras {preview.length} filas ({allRows.length} total a importar)</p>
                  <div className="border rounded-lg overflow-hidden text-xs">
                    <table className="w-full">
                      <thead className="bg-kx-surface-2 dark:bg-kx-surface-2">
                        <tr>
                          <th className="px-3 py-2 text-left">Fecha</th>
                          <th className="px-3 py-2 text-left">Descripción</th>
                          <th className="px-3 py-2 text-right">Monto</th>
                          <th className="px-3 py-2 text-center">Tipo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y dark:divide-slate-700">
                        {preview.map((r, i) => (
                          <tr key={i} className={!r.valid ? 'bg-red-50 dark:bg-red-900/20' : ''}>
                            <td className="px-3 py-1.5">{r.fecha}</td>
                            <td className="px-3 py-1.5 max-w-xs truncate">{r.descripcion || '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{formatMoney(r.monto)}</td>
                            <td className="px-3 py-1.5 text-center">
                              <Badge variant={r.tipo === 'ingreso' ? 'default' : 'destructive'} className="text-xs">
                                {r.tipo}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={handleImport}
            disabled={!parsed || !allRows.length || !cuentaId || loading}
          >
            {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Importar {allRows.length || ''} movimientos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sección principal ─────────────────────────────────────────────────────

function CuentasBancariasSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const empresaId = user?.empresa_id;

  const [activeTab, setActiveTab] = useState('cuentas');
  const [filterCuentaId, setFilterCuentaId] = useState('todas');
  const [filterDesde, setFilterDesde] = useState('');
  const [filterHasta, setFilterHasta] = useState('');
  const [filterTipo, setFilterTipo] = useState('todos');

  const [cuentaModal, setCuentaModal] = useState({ open: false, cuenta: null });
  const [movModal, setMovModal] = useState({ open: false, cuentaId: '' });
  const [csvModal, setCsvModal] = useState(false);
  const [syncing, setSyncing] = useState(false); // FIX-MP-SYNC
  const [showCbu, setShowCbu] = useState({}); // SECURITY-SENSITIVE-DATA

  const movFilters = useMemo(() => ({
    cuentaId: filterCuentaId !== 'todas' ? filterCuentaId : undefined,
    desde: filterDesde || undefined,
    hasta: filterHasta || undefined,
    tipo: filterTipo !== 'todos' ? filterTipo : undefined,
  }), [filterCuentaId, filterDesde, filterHasta, filterTipo]);

  const { data: cuentas = [], isLoading: loadingCuentas } = useQuery({
    queryKey: CB_KEYS.cuentas(empresaId),
    queryFn: () => cuentasService.getAll(empresaId),
    enabled: !!empresaId,
  });

  // FIX-SALDO-REAL — query con filtros SOLO para la tabla de movimientos
  const { data: movimientosTabla = [], isLoading: loadingMovs } = useQuery({
    queryKey: CB_KEYS.movimientos(empresaId, movFilters),
    queryFn: () => movimientosService.getAll(empresaId, movFilters),
    enabled: !!empresaId,
  });

  // FIX-SALDO-REAL — saldo agregado por cuenta calculado en SQL (RPC saldos_bancarios).
  // Antes se traían TODOS los movimientos al cliente y se sumaba en JS; ahora la base
  // devuelve un saldo por cuenta. Es la fuente de verdad de los saldos (sin filtros de tabla).
  const { data: saldos = new Map() } = useQuery({
    queryKey: CB_KEYS.movimientosSaldo(empresaId),
    queryFn: () => movimientosService.getSaldos(),
    enabled: !!empresaId,
  });

  const totalGeneral = useMemo(
    () => [...saldos.values()].reduce((a, b) => a + b, 0),
    [saldos]
  );

  const deleteMov = useMutation({
    mutationFn: (id) => movimientosService.delete(id, empresaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movimientos_bancarios', empresaId] });
      qc.invalidateQueries({ queryKey: CB_KEYS.movimientosSaldo(empresaId) }); // FIX-SALDO-REAL
      toast({ title: 'Movimiento eliminado', className: 'bg-green-600 text-white' });
    },
    onError: (e) => toast({ title: 'Error al eliminar', description: e.message, variant: 'destructive' }),
  });

  const deactivateCuenta = useMutation({
    mutationFn: (id) => cuentasService.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CB_KEYS.cuentas(empresaId) });
      toast({ title: 'Cuenta desactivada' });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  // FIX-MP-SYNC — sincronización manual de pagos MercadoPago
  // NOTA: mp-sync ignora el body y sincroniza TODAS las integraciones activas.
  // Se pasa empresa_id igual para forward-compat si la función filtra por empresa
  // a futuro (refactor pendiente con Luciano).
  const handleSyncMP = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('mp-sync', {
        body: { empresa_id: empresaId },
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['movimientos_bancarios', empresaId] });
      qc.invalidateQueries({ queryKey: CB_KEYS.movimientosSaldo(empresaId) });
      qc.invalidateQueries({ queryKey: CB_KEYS.cuentas(empresaId) });
      toast({ title: 'Movimientos actualizados', className: 'bg-green-600 text-white' });
    } catch (e) {
      toast({ title: 'Error al actualizar', description: e.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  if (!empresaId) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <Landmark className="h-6 w-6 text-indigo-500" />
            Cuentas Bancarias
          </h1>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-1">
            Administrá tus cuentas y movimientos bancarios
          </p>
        </div>
        <div className="flex gap-2">
          {/* FIX-MP-SYNC */}
          <Button variant="outline" size="sm" onClick={handleSyncMP} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Actualizando...' : 'Actualizar'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCsvModal(true)}>
            <Upload className="w-4 h-4 mr-2" /> Importar CSV
          </Button>
          <Button size="sm" onClick={() => setCuentaModal({ open: true, cuenta: null })}>
            <Plus className="w-4 h-4 mr-2" /> Nueva cuenta
          </Button>
        </div>
      </div>

      {/* KPI global */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden shadow-sm dark:shadow-none">
        <div className="bg-kx-surface p-5 border-t-2 border-t-kx-blue hover:bg-kx-surface-2 transition-colors duration-200">
          <p className="text-[11px] text-kx-text-2 uppercase font-medium tracking-wide">Saldo total</p>
          <p className={`text-3xl font-bold font-mono mt-2 tabular-nums ${totalGeneral >= 0 ? 'text-kx-blue' : 'text-kx-red'}`}>
            {formatMoney(totalGeneral)}
          </p>
          <p className="text-xs text-kx-text-3 mt-1">{cuentas.length} cuenta{cuentas.length !== 1 ? 's' : ''} activa{cuentas.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="bg-kx-surface p-5 sm:col-span-2 border-t-2 border-t-kx-text-3">
          <p className="text-[11px] text-kx-text-2 uppercase font-medium tracking-wide mb-3">Saldo por cuenta</p>
          <div className="space-y-2">
            {cuentas.length === 0 && <p className="text-sm text-kx-text-3">Sin cuentas configuradas</p>}
            {cuentas.map(c => (
              <div key={c.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 text-kx-text-3 flex-shrink-0" />
                  <span className="text-sm text-kx-text truncate">{c.nombre}</span>
                  <Badge variant="outline" className="text-xs shrink-0">{c.banco}</Badge>
                </div>
                <span className={`text-sm font-mono font-semibold shrink-0 ml-2 ${(saldos.get(c.id) ?? 0) >= 0 ? 'text-kx-text' : 'text-kx-red'}`}>
                  {formatMoney(saldos.get(c.id) ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="cuentas">Cuentas ({cuentas.length})</TabsTrigger>
          <TabsTrigger value="movimientos">Movimientos ({movimientosTabla.length})</TabsTrigger>
          <TabsTrigger value="conciliacion">Conciliación</TabsTrigger>
        </TabsList>

        {/* Tab: Cuentas */}
        <TabsContent value="cuentas" className="mt-4">
          {loadingCuentas ? (
            <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-kx-text-3" /></div>
          ) : cuentas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-kx-text-3">
              <Landmark className="w-12 h-12 opacity-30" />
              <p className="font-medium">Sin cuentas bancarias</p>
              <p className="text-sm text-center max-w-xs">Agregá tu primera cuenta para empezar a registrar movimientos.</p>
              <Button onClick={() => setCuentaModal({ open: true, cuenta: null })}>
                <Plus className="w-4 h-4 mr-2" /> Agregar cuenta
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {cuentas.map(c => (
                <Card key={c.id} className="dark:border-kx-border hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate">{c.nombre}</CardTitle>
                        <p className="text-sm text-slate-500 dark:text-kx-text-2">{c.banco}</p>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-xs">{c.moneda}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className={`text-2xl font-bold font-mono ${(saldos.get(c.id) ?? 0) >= 0 ? 'text-kx-text dark:text-kx-text' : 'text-red-500'}`}>
                      {formatMoney(saldos.get(c.id) ?? 0)}
                    </p>
                    {/* SECURITY-SENSITIVE-DATA */}
                    {c.cbu_alias && (
                      <div className="flex items-center gap-1">
                        <p className="text-xs text-kx-text-3 font-mono truncate">
                          {showCbu[c.id] ? c.cbu_alias : '•••• •••• •••• ••••'}
                        </p>
                        <button
                          onClick={() => setShowCbu(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                          className="text-kx-text-3 hover:text-kx-text shrink-0"
                          title={showCbu[c.id] ? 'Ocultar CBU' : 'Mostrar CBU'}
                        >
                          {showCbu[c.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                      </div>
                    )}
                    {c.plan_cuentas ? (
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3 h-3 text-indigo-400" />
                        <span className="text-xs text-indigo-600 dark:text-indigo-400">
                          {c.plan_cuentas.codigo} — {c.plan_cuentas.nombre}
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-kx-text-3 italic">Sin cuenta contable vinculada</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm" variant="outline" className="flex-1 text-xs"
                        onClick={() => { setFilterCuentaId(c.id); setActiveTab('movimientos'); }}
                      >
                        <ChevronRight className="w-3 h-3 mr-1" /> Ver movimientos
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCuentaModal({ open: true, cuenta: c })}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="text-red-500 hover:text-red-600"
                        onClick={() => deactivateCuenta.mutate(c.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tab: Movimientos */}
        <TabsContent value="movimientos" className="mt-4 space-y-4">
          {/* Filtros */}
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs">Cuenta</Label>
              <Select value={filterCuentaId} onValueChange={setFilterCuentaId}>
                <SelectTrigger className="w-44 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas las cuentas</SelectItem>
                  {cuentas.map(c => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={filterDesde} onChange={e => setFilterDesde(e.target.value)} className="h-8 text-sm w-36" />
            </div>
            <div>
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={filterHasta} onChange={e => setFilterHasta(e.target.value)} className="h-8 text-sm w-36" />
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={filterTipo} onValueChange={setFilterTipo}>
                <SelectTrigger className="w-32 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="ingreso">Ingresos</SelectItem>
                  <SelectItem value="egreso">Egresos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={() => setMovModal({ open: true, cuentaId: filterCuentaId !== 'todas' ? filterCuentaId : '' })}>
              <Plus className="w-4 h-4 mr-1" /> Movimiento
            </Button>
          </div>

          {/* Tabla */}
          {loadingMovs ? (
            <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-kx-text-3" /></div>
          ) : movimientosTabla.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-kx-text-3">
              <Wallet className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">Sin movimientos</p>
              <p className="text-xs text-center">Registrá un movimiento manual o importá un extracto CSV.</p>
            </div>
          ) : (
            <Card className="dark:border-kx-border">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b dark:border-kx-border bg-slate-50/70 dark:bg-slate-800/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Fecha</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Cuenta</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Descripción</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Tipo</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Monto</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Origen</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-800">
                    {movimientosTabla.map(m => (
                      <tr key={m.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">
                          {formatDateAR(m.fecha)}
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {m.cuentas_bancarias?.nombre ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-kx-text-2 dark:text-kx-text-2 max-w-xs truncate">
                          {m.descripcion || <span className="italic text-kx-text-3">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {m.tipo === 'ingreso' ? (
                            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 gap-1">
                              <ArrowUpCircle className="w-3 h-3" /> ingreso
                            </Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 gap-1">
                              <ArrowDownCircle className="w-3 h-3" /> egreso
                            </Badge>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-semibold ${m.tipo === 'ingreso' ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                          {m.tipo === 'egreso' ? '-' : ''}{formatMoney(m.monto)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="outline" className="text-xs capitalize">{m.origen}</Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Button
                            size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                            onClick={() => deleteMov.mutate(m.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* Tab: Conciliación */}
        <TabsContent value="conciliacion" className="mt-4">
          <ConciliacionTab cuentas={cuentas} empresaId={empresaId} userId={user?.id} />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <CuentaModal
        open={cuentaModal.open}
        onClose={() => setCuentaModal({ open: false, cuenta: null })}
        cuenta={cuentaModal.cuenta}
        empresaId={empresaId}
      />
      <MovimientoModal
        open={movModal.open}
        onClose={() => setMovModal({ open: false, cuentaId: '' })}
        cuentas={cuentas}
        empresaId={empresaId}
        defaultCuentaId={movModal.cuentaId}
      />
      <ImportCSVModal
        open={csvModal}
        onClose={() => setCsvModal(false)}
        cuentas={cuentas}
        empresaId={empresaId}
      />
    </div>
  );
}

// ─── Tab Conciliación ─────────────────────────────────────────────────────────
function ConciliacionTab({ cuentas, empresaId, userId }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = React.useRef();

  const [cuentaId, setCuentaId]       = React.useState(cuentas[0]?.id ?? '');
  const [extractoId, setExtractoId]   = React.useState(null);
  const [lineaActiva, setLineaActiva] = React.useState(null);
  const [uploading, setUploading]     = React.useState(false);
  const [matching, setMatching]       = React.useState(false);

  const { data: extractos = [] } = useQuery({
    queryKey: CONC_KEYS.extractos(cuentaId),
    queryFn: () => conciliacionService.getExtractos(cuentaId, empresaId),
    enabled: !!cuentaId,
  });

  const { data: lineas = [], refetch: refetchLineas } = useQuery({
    queryKey: CONC_KEYS.lineas(extractoId),
    queryFn: () => conciliacionService.getLineas(extractoId, empresaId),
    enabled: !!extractoId,
  });

  const { data: movSinConc = [] } = useQuery({
    queryKey: CONC_KEYS.movimientos(cuentaId),
    queryFn: () => conciliacionService.getMovimientosSinConciliar(cuentaId, empresaId),
    enabled: !!cuentaId,
  });

  const pendientes   = lineas.filter(l => !l.conciliado);
  const conciliadas  = lineas.filter(l =>  l.conciliado);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !cuentaId) return;
    setUploading(true);
    try {
      const texto = await file.text();
      const parsed = conciliacionService.parsearCSV(texto);
      if (!parsed.length) throw new Error('No se encontraron movimientos válidos en el archivo.');
      const extracto = await conciliacionService.importarExtracto(empresaId, cuentaId, userId, file.name, parsed);
      setExtractoId(extracto.id);
      qc.invalidateQueries({ queryKey: CONC_KEYS.extractos(cuentaId) });
      toast({ title: `${parsed.length} movimientos importados ✓`, className: 'bg-green-600 text-white' });
    } catch (err) {
      toast({ title: 'Error al importar', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleAutoMatch = async () => {
    if (!extractoId) return;
    setMatching(true);
    try {
      const n = await conciliacionService.autoMatch(extractoId, empresaId, cuentaId);
      qc.invalidateQueries({ queryKey: CONC_KEYS.lineas(extractoId) });
      qc.invalidateQueries({ queryKey: CONC_KEYS.movimientos(cuentaId) });
      toast({ title: `${n} coincidencias automáticas encontradas ✓`, className: 'bg-green-600 text-white' });
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setMatching(false);
    }
  };

  const handleMatch = async (lineaId, movId) => {
    try {
      await conciliacionService.matchManual(lineaId, movId);
      qc.invalidateQueries({ queryKey: CONC_KEYS.lineas(extractoId) });
      qc.invalidateQueries({ queryKey: CONC_KEYS.movimientos(cuentaId) });
      setLineaActiva(null);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDesMatch = async (lineaId) => {
    try {
      await conciliacionService.desMatch(lineaId);
      qc.invalidateQueries({ queryKey: CONC_KEYS.lineas(extractoId) });
      qc.invalidateQueries({ queryKey: CONC_KEYS.movimientos(cuentaId) });
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Cuenta bancaria</Label>
          <select value={cuentaId} onChange={e => { setCuentaId(e.target.value); setExtractoId(null); }}
            className="h-9 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 text-sm">
            {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        {extractos.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">Extracto importado</Label>
            <select value={extractoId ?? ''} onChange={e => setExtractoId(e.target.value || null)}
              className="h-9 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 text-sm">
              <option value="">Seleccionar...</option>
              {extractos.map(ex => <option key={ex.id} value={ex.id}>{ex.nombre_archivo} ({ex.movimientos_count} mov.)</option>)}
            </select>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleUpload} />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Upload className="w-4 h-4 mr-2" />{uploading ? 'Importando...' : 'Importar CSV'}
        </Button>
        {extractoId && (
          <Button size="sm" onClick={handleAutoMatch} disabled={matching}
            className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Zap className="w-4 h-4 mr-2" />{matching ? 'Procesando...' : 'Auto-Match'}
          </Button>
        )}
      </div>

      {/* Resumen */}
      {extractoId && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total líneas', value: lineas.length, color: 'text-slate-700 dark:text-kx-text' },
            { label: 'Conciliadas', value: conciliadas.length, color: 'text-green-600' },
            { label: 'Pendientes', value: pendientes.length, color: pendientes.length > 0 ? 'text-orange-500' : 'text-kx-text-3' },
          ].map(({ label, value, color }) => (
            <div key={label} className="p-3 rounded-lg bg-kx-surface-2 dark:bg-kx-surface border border-kx-border dark:border-kx-border text-center">
              <p className="text-xs text-kx-text-3 uppercase">{label}</p>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Vista split */}
      {extractoId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Izquierda: líneas del extracto */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase">Extracto bancario</p>
            <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden max-h-[500px] overflow-y-auto">
              {lineas.length === 0 ? (
                <div className="p-8 text-center text-kx-text-3">Sin líneas</div>
              ) : lineas.map(l => (
                <div key={l.id}
                  onClick={() => !l.conciliado && setLineaActiva(lineaActiva?.id === l.id ? null : l)}
                  className={`p-3 border-b border-slate-100 dark:border-kx-border cursor-pointer transition-colors
                    ${l.conciliado ? 'bg-green-50 dark:bg-green-900/10' : lineaActiva?.id === l.id ? 'bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-400' : 'hover:bg-kx-surface-2 dark:hover:bg-slate-800/40'}
                  `}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-kx-text-3">{formatDateAR(l.fecha)}</p>
                      <p className="text-sm truncate dark:text-kx-text">{l.descripcion}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-sm font-mono font-bold ${l.tipo === 'ingreso' ? 'text-green-600' : 'text-red-500'}`}>
                        {l.tipo === 'ingreso' ? '+' : '-'}{formatMoney(l.monto)}
                      </span>
                      {l.conciliado
                        ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                        : <button onClick={e => { e.stopPropagation(); setLineaActiva(lineaActiva?.id === l.id ? null : l); }}
                            className="w-4 h-4 rounded-full border-2 border-slate-300 hover:border-indigo-500" />
                      }
                    </div>
                  </div>
                  {l.conciliado && (
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-green-600 dark:text-green-400">Conciliada</span>
                      <button onClick={e => { e.stopPropagation(); handleDesMatch(l.id); }}
                        className="text-xs text-kx-text-3 hover:text-red-500 flex items-center gap-1">
                        <Unlink2 className="w-3 h-3" /> Deshacer
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Derecha: movimientos registrados */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase">
              {lineaActiva ? `Seleccioná un movimiento para conciliar (${lineaActiva.tipo} ${formatMoney(lineaActiva.monto)})` : 'Movimientos sin conciliar'}
            </p>
            <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden max-h-[500px] overflow-y-auto">
              {movSinConc.length === 0 ? (
                <div className="p-8 text-center text-kx-text-3">Todos los movimientos están conciliados</div>
              ) : movSinConc.map(m => {
                const compatible = lineaActiva && m.tipo === lineaActiva.tipo && Math.abs(Number(m.monto) - lineaActiva.monto) < 1;
                return (
                  <div key={m.id}
                    onClick={() => lineaActiva && handleMatch(lineaActiva.id, m.id)}
                    className={`p-3 border-b border-slate-100 dark:border-kx-border transition-colors
                      ${lineaActiva ? (compatible ? 'bg-indigo-50 dark:bg-indigo-900/20 cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/40 ring-1 ring-inset ring-indigo-300' : 'opacity-40 cursor-default') : 'cursor-default'}
                    `}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-kx-text-3">{formatDateAR(m.fecha)}</p>
                        <p className="text-sm truncate dark:text-kx-text">{m.descripcion}</p>
                        <p className="text-xs text-kx-text-3">{m.origen}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-sm font-mono font-bold ${m.tipo === 'ingreso' ? 'text-green-600' : 'text-red-500'}`}>
                          {m.tipo === 'ingreso' ? '+' : '-'}{formatMoney(m.monto)}
                        </span>
                        {lineaActiva && compatible && <Link2 className="w-4 h-4 text-indigo-500" />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {!extractoId && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-kx-text-3">
          <CheckCircle2 className="w-12 h-12 opacity-20" />
          <p className="font-medium">Sin extracto seleccionado</p>
          <p className="text-sm text-center max-w-xs">Importá un archivo CSV de tu banco para comenzar la conciliación.</p>
        </div>
      )}
    </div>
  );
}

export default CuentasBancariasSection;
