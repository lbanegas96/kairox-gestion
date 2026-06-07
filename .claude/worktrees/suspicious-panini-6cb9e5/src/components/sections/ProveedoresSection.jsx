import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, Plus, Edit, Trash2, Eye, DollarSign, Loader2,
  Building2, Phone, Mail, MapPin, FileText, CreditCard, ShoppingBag
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatDateAR } from '@/lib/dateUtils';
import {
  getProveedores, createProveedor, updateProveedor, softDeleteProveedor,
  getMovimientosProveedor, registrarPagoProveedor, getOrdenesCompraProveedor,
  getProveedorById
} from '@/services/proveedoresService';

const EMPTY_FORM = {
  nombre: '', razon_social: '', cuit: '',
  condicion_iva: 'RI', telefono: '', email: '',
  direccion: '', localidad: '', provincia: 'Buenos Aires',
  condicion_pago: 'contado', plazo_pago_dias: '0', notas: '',
};

const CONDICION_IVA_OPTIONS = ['RI', 'Monotributo', 'Exento', 'CF', 'No Categorizado'];
const CONDICION_PAGO_OPTIONS = ['contado', '30 días', '60 días', '90 días', 'personalizado'];

function formatMoney(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n || 0);
}

function TIPO_BADGE({ tipo }) {
  const map = {
    compra:       { label: 'Compra',        cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    pago:         { label: 'Pago',           cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    nota_credito: { label: 'Nota Crédito',   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    nota_debito:  { label: 'Nota Débito',    cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
    ajuste:       { label: 'Ajuste',         cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  };
  const { label, cls } = map[tipo] || { label: tipo, cls: '' };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{label}</span>;
}

function OC_ESTADO_BADGE({ estado }) {
  const map = {
    borrador:  'bg-slate-100 text-slate-600',
    pendiente: 'bg-yellow-100 text-yellow-700',
    aprobada:  'bg-green-100 text-green-700',
    recibida:  'bg-blue-100 text-blue-700',
    cancelada: 'bg-red-100 text-red-700',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[estado] || ''}`}>{estado}</span>;
}

// ──────────────────────────────────────────
// Modal detalle proveedor (Cta Cte + OC)
// ──────────────────────────────────────────
function ProveedorDetailModal({ proveedor, open, onClose, onPagoRegistrado }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [movimientos, setMovimientos] = useState([]);
  const [ordenes, setOrdenes] = useState([]);
  const [loadingMov, setLoadingMov] = useState(false);
  const [loadingOC, setLoadingOC] = useState(false);
  const [pagoMonto, setPagoMonto] = useState('');
  const [pagoDesc, setPagoDesc] = useState('');
  const [savingPago, setSavingPago] = useState(false);

  useEffect(() => {
    if (!proveedor?.id) return;
    loadMovimientos();
    loadOrdenes();
  }, [proveedor?.id]);

  const loadMovimientos = async () => {
    setLoadingMov(true);
    try {
      const data = await getMovimientosProveedor(proveedor.id);
      setMovimientos(data);
    } catch {
      toast({ title: 'Error', description: 'No se pudo cargar el historial', variant: 'destructive' });
    } finally {
      setLoadingMov(false);
    }
  };

  const loadOrdenes = async () => {
    setLoadingOC(true);
    try {
      const data = await getOrdenesCompraProveedor(proveedor.id);
      setOrdenes(data);
    } catch {
      // silencioso: puede que no haya OC
    } finally {
      setLoadingOC(false);
    }
  };

  const handlePago = async () => {
    const monto = parseFloat(pagoMonto);
    if (!monto || monto <= 0) return toast({ title: 'Monto inválido', variant: 'destructive' });
    setSavingPago(true);
    try {
      await registrarPagoProveedor(user.empresa_id, proveedor.id, monto, pagoDesc, user.id);
      toast({ title: 'Pago registrado', className: 'bg-green-600 text-white' });
      setPagoMonto('');
      setPagoDesc('');
      loadMovimientos();
      onPagoRegistrado?.();
    } catch {
      toast({ title: 'Error', description: 'No se pudo registrar el pago', variant: 'destructive' });
    } finally {
      setSavingPago(false);
    }
  };

  const saldo = proveedor?.saldo_deuda ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-500" />
            {proveedor?.nombre}
          </DialogTitle>
          <DialogDescription>
            CUIT: {proveedor?.cuit || '—'} · {proveedor?.condicion_iva}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg mb-2">
          <span className="text-sm text-slate-500">Saldo deuda actual</span>
          <span className={`text-lg font-bold ${saldo > 0 ? 'text-red-500' : 'text-green-600'}`}>
            {formatMoney(saldo)}
          </span>
        </div>

        <Tabs defaultValue="ctacte">
          <TabsList className="mb-4">
            <TabsTrigger value="ctacte"><CreditCard className="h-4 w-4 mr-1" />Cuenta Corriente</TabsTrigger>
            <TabsTrigger value="oc"><ShoppingBag className="h-4 w-4 mr-1" />Órdenes de Compra</TabsTrigger>
          </TabsList>

          <TabsContent value="ctacte">
            {/* Registrar pago */}
            <div className="flex gap-2 mb-4">
              <Input
                type="number"
                placeholder="Monto a pagar"
                value={pagoMonto}
                onChange={e => setPagoMonto(e.target.value)}
                className="w-40 dark:bg-slate-800"
              />
              <Input
                placeholder="Descripción (opcional)"
                value={pagoDesc}
                onChange={e => setPagoDesc(e.target.value)}
                className="flex-1 dark:bg-slate-800"
              />
              <Button onClick={handlePago} disabled={savingPago} className="bg-green-600 hover:bg-green-700 text-white">
                {savingPago ? <Loader2 className="h-4 w-4 animate-spin" /> : <><DollarSign className="h-4 w-4 mr-1" />Pagar</>}
              </Button>
            </div>

            {loadingMov ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : movimientos.length === 0 ? (
              <p className="text-center text-slate-400 py-8 text-sm">Sin movimientos registrados</p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movimientos.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs">{formatDateAR(m.fecha)}</TableCell>
                        <TableCell><TIPO_BADGE tipo={m.tipo} /></TableCell>
                        <TableCell className="text-sm text-slate-500">{m.descripcion || '—'}</TableCell>
                        <TableCell className={`text-right font-medium ${['compra','nota_debito'].includes(m.tipo) ? 'text-red-500' : 'text-green-600'}`}>
                          {formatMoney(m.monto)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="oc">
            {loadingOC ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : ordenes.length === 0 ? (
              <p className="text-center text-slate-400 py-8 text-sm">Sin órdenes de compra registradas</p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>N° OC</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ordenes.map(oc => (
                      <TableRow key={oc.id}>
                        <TableCell className="font-mono text-xs">{oc.numero_oc}</TableCell>
                        <TableCell className="text-xs">{formatDateAR(oc.fecha)}</TableCell>
                        <TableCell><OC_ESTADO_BADGE estado={oc.estado} /></TableCell>
                        <TableCell className="text-right font-medium">{formatMoney(oc.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────
// Formulario proveedor (add/edit)
// ──────────────────────────────────────────
function ProveedorFormModal({ open, onClose, initial, onSaved }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial;

  useEffect(() => {
    if (open) {
      setForm(initial ? {
        nombre: initial.nombre || '',
        razon_social: initial.razon_social || '',
        cuit: initial.cuit || '',
        condicion_iva: initial.condicion_iva || 'RI',
        telefono: initial.telefono || '',
        email: initial.email || '',
        direccion: initial.direccion || '',
        localidad: initial.localidad || '',
        provincia: initial.provincia || 'Buenos Aires',
        condicion_pago: initial.condicion_pago || 'contado',
        plazo_pago_dias: String(initial.plazo_pago_dias ?? 0),
        notas: initial.notas || '',
      } : EMPTY_FORM);
    }
  }, [open, initial]);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    if (!form.nombre.trim()) return toast({ title: 'El nombre es requerido', variant: 'destructive' });
    setSaving(true);
    try {
      const payload = {
        nombre: form.nombre.trim(),
        razon_social: form.razon_social.trim() || null,
        cuit: form.cuit.trim() || null,
        condicion_iva: form.condicion_iva,
        telefono: form.telefono.trim() || null,
        email: form.email.trim() || null,
        direccion: form.direccion.trim() || null,
        localidad: form.localidad.trim() || null,
        provincia: form.provincia || 'Buenos Aires',
        condicion_pago: form.condicion_pago,
        plazo_pago_dias: parseInt(form.plazo_pago_dias) || 0,
        notas: form.notas.trim() || null,
      };

      if (isEdit) {
        await updateProveedor(initial.id, payload);
        toast({ title: 'Proveedor actualizado', className: 'bg-green-600 text-white' });
      } else {
        await createProveedor({ ...payload, empresa_id: user.empresa_id, activo: true });
        toast({ title: 'Proveedor creado', className: 'bg-green-600 text-white' });
      }
      onSaved();
      onClose();
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !o && onClose()}>
      <DialogContent className="max-w-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {isEdit ? 'Editar Proveedor' : 'Nuevo Proveedor'}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? 'Modificá los datos del proveedor' : 'Completá los datos del nuevo proveedor'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Datos básicos */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Nombre comercial *</Label>
              <Input value={form.nombre} onChange={e => set('nombre', e.target.value)}
                placeholder="Ej: Ferretería López" className="mt-1 dark:bg-slate-800" />
            </div>
            <div>
              <Label>Razón social</Label>
              <Input value={form.razon_social} onChange={e => set('razon_social', e.target.value)}
                placeholder="Ej: López SA" className="mt-1 dark:bg-slate-800" />
            </div>
            <div>
              <Label>CUIT</Label>
              <Input value={form.cuit} onChange={e => set('cuit', e.target.value)}
                placeholder="20-12345678-9" className="mt-1 dark:bg-slate-800" />
            </div>
          </div>

          {/* IVA */}
          <div>
            <Label>Condición IVA</Label>
            <Select value={form.condicion_iva} onValueChange={v => set('condicion_iva', v)}>
              <SelectTrigger className="mt-1 dark:bg-slate-800">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDICION_IVA_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Contacto */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Teléfono</Label>
              <Input value={form.telefono} onChange={e => set('telefono', e.target.value)}
                placeholder="+54 11 1234-5678" className="mt-1 dark:bg-slate-800" />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="proveedor@ejemplo.com" className="mt-1 dark:bg-slate-800" />
            </div>
          </div>

          {/* Dirección */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-3">
              <Label>Dirección</Label>
              <Input value={form.direccion} onChange={e => set('direccion', e.target.value)}
                placeholder="Calle 123, Piso 2" className="mt-1 dark:bg-slate-800" />
            </div>
            <div>
              <Label>Localidad</Label>
              <Input value={form.localidad} onChange={e => set('localidad', e.target.value)}
                placeholder="CABA" className="mt-1 dark:bg-slate-800" />
            </div>
            <div className="col-span-2">
              <Label>Provincia</Label>
              <Input value={form.provincia} onChange={e => set('provincia', e.target.value)}
                placeholder="Buenos Aires" className="mt-1 dark:bg-slate-800" />
            </div>
          </div>

          {/* Condiciones de pago */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Condición de pago</Label>
              <Select value={form.condicion_pago} onValueChange={v => set('condicion_pago', v)}>
                <SelectTrigger className="mt-1 dark:bg-slate-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDICION_PAGO_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Plazo (días)</Label>
              <Input type="number" min="0" value={form.plazo_pago_dias}
                onChange={e => set('plazo_pago_dias', e.target.value)}
                className="mt-1 dark:bg-slate-800" />
            </div>
          </div>

          {/* Notas */}
          <div>
            <Label>Notas internas</Label>
            <Textarea value={form.notas} onChange={e => set('notas', e.target.value)}
              placeholder="Observaciones, referencias de contacto, etc." rows={2}
              className="mt-1 dark:bg-slate-800" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Guardando...</> : isEdit ? 'Guardar cambios' : 'Crear proveedor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────
// Sección principal
// ──────────────────────────────────────────
export default function ProveedoresSection() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [proveedores, setProveedores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [detailTarget, setDetailTarget] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (user?.empresa_id) fetchProveedores();
  }, [user]);

  const fetchProveedores = async () => {
    try {
      setLoading(true);
      const data = await getProveedores(user.empresa_id);
      setProveedores(data);
    } catch {
      toast({ title: 'Error', description: 'No se pudieron cargar los proveedores', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return proveedores.filter(p =>
      p.nombre?.toLowerCase().includes(q) ||
      p.cuit?.includes(q) ||
      p.email?.toLowerCase().includes(q)
    );
  }, [proveedores, search]);

  const openDetail = (prov) => { setDetailTarget(prov); setDetailOpen(true); };
  const openEdit = (prov, e) => { e?.stopPropagation(); setEditTarget(prov); setFormOpen(true); };
  const openAdd = () => { setEditTarget(null); setFormOpen(true); };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await softDeleteProveedor(deleteTarget.id);
      toast({ title: 'Proveedor desactivado', className: 'bg-green-600 text-white' });
      setDeleteTarget(null);
      fetchProveedores();
    } catch {
      toast({ title: 'Error al desactivar proveedor', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const totalDeuda = useMemo(() => proveedores.reduce((s, p) => s + (p.saldo_deuda || 0), 0), [proveedores]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Proveedores</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {proveedores.length} proveedor{proveedores.length !== 1 ? 'es' : ''} activo{proveedores.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={openAdd} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" />Nuevo Proveedor
        </Button>
      </div>

      {/* KPI resumen */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 mb-1">Total proveedores</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{proveedores.length}</p>
          </CardContent>
        </Card>
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 mb-1">Deuda total</p>
            <p className={`text-2xl font-bold ${totalDeuda > 0 ? 'text-red-500' : 'text-green-600'}`}>
              {formatMoney(totalDeuda)}
            </p>
          </CardContent>
        </Card>
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 mb-1">Con deuda pendiente</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">
              {proveedores.filter(p => (p.saldo_deuda || 0) > 0).length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Buscador */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          className="pl-9 dark:bg-slate-800"
          placeholder="Buscar por nombre, CUIT o email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Tabla */}
      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">{search ? 'Sin resultados' : 'No hay proveedores todavía'}</p>
              {!search && (
                <Button variant="link" onClick={openAdd} className="mt-1 text-blue-500">
                  Agregar el primer proveedor
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>CUIT</TableHead>
                  <TableHead>Cond. IVA</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Cond. Pago</TableHead>
                  <TableHead className="text-right">Deuda</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(prov => (
                  <TableRow
                    key={prov.proveedor_id || prov.id}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50"
                    onClick={() => openDetail(prov)}
                  >
                    <TableCell>
                      <div className="font-medium text-slate-900 dark:text-white">{prov.nombre}</div>
                      {prov.email && <div className="text-xs text-slate-400">{prov.email}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{prov.cuit || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{prov.condicion_iva}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{prov.telefono || '—'}</TableCell>
                    <TableCell className="text-sm capitalize">{prov.condicion_pago}</TableCell>
                    <TableCell className={`text-right font-semibold ${(prov.saldo_deuda || 0) > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                      {(prov.saldo_deuda || 0) > 0 ? formatMoney(prov.saldo_deuda) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDetail(prov)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => openEdit(prov, e)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                          onClick={e => { e.stopPropagation(); setDeleteTarget(prov); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Modales */}
      <ProveedorFormModal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null); }}
        initial={editTarget}
        onSaved={fetchProveedores}
      />

      <ProveedorDetailModal
        proveedor={detailTarget}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onPagoRegistrado={fetchProveedores}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="dark:bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar proveedor?</AlertDialogTitle>
            <AlertDialogDescription>
              Se desactivará <strong>{deleteTarget?.nombre}</strong>. No se elimina historial ni OC. Puede reactivarse después.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Desactivar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
