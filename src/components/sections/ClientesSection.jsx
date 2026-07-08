import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Plus, Edit, Eye, Upload, AlertTriangle, Shield, CreditCard,
  Phone, Mail, MapPin, Hash, DollarSign, Clock, Tag
} from 'lucide-react';
import { listaPreciosService } from '@/services/listaPreciosService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import ClientDetailModal from './ClientDetailModal';
import CSVImportModal from '@/components/ui/CSVImportModal';

const emptyForm = () => ({
  nombre: '', documento: '', telefono: '', email: '', direccion: '',
  limite_credito: '', dias_credito: '',
  bloquear_en_limite: false, lista_precio_id: '', condicion_pago_id: '',
});

function ClientesSection() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [clientForDetail, setClientForDetail] = useState(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState(emptyForm());

  const { data: listasPrecios = [] } = useQuery({
    queryKey: ['listas_precio', user?.empresa_id],
    queryFn: () => listaPreciosService.getAll(user.empresa_id),
    enabled: !!user?.empresa_id,
  });

  const { data: condicionesPago = [] } = useQuery({
    queryKey: ['condiciones_pago', user?.empresa_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('condiciones_pago')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .order('dias_credito');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.empresa_id,
  });

  useEffect(() => {
    if (user?.empresa_id) fetchClients();
  }, [user]);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .neq('activo', false)
        .order('nombre');
      if (error) throw error;
      setClients(data || []);
    } catch (error) {
      toast({ title: 'Error', description: 'No se pudieron cargar los clientes', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => { setFormData(emptyForm()); setIsAddDialogOpen(true); };
  const openEdit = (client) => {
    setSelectedClient(client);
    setFormData({
      nombre:             client.nombre || '',
      documento:          client.documento || '',
      telefono:           client.telefono || '',
      email:              client.email || '',
      direccion:          client.direccion || '',
      limite_credito:     client.limite_credito != null ? String(client.limite_credito) : '',
      dias_credito:       client.dias_credito != null ? String(client.dias_credito) : '',
      bloquear_en_limite: client.bloquear_en_limite || false,
      lista_precio_id:    client.lista_precio_id || '',
      condicion_pago_id:  client.condicion_pago_id || '',
    });
    setIsEditDialogOpen(true);
  };

  const handleSave = async (isEdit = false) => {
    if (!formData.nombre.trim()) return toast({ title: 'Nombre requerido', variant: 'destructive' });
    setSaving(true);
    try {
      const payload = {
        nombre:             formData.nombre.trim(),
        documento:          formData.documento.trim(),
        telefono:           formData.telefono.trim(),
        email:              formData.email.trim(),
        direccion:          formData.direccion.trim(),
        limite_credito:     formData.limite_credito !== '' ? parseFloat(formData.limite_credito) : 0,
        dias_credito:       formData.dias_credito !== '' ? parseInt(formData.dias_credito) : 0,
        bloquear_en_limite: formData.bloquear_en_limite,
        lista_precio_id:    formData.lista_precio_id || null,
        condicion_pago_id:  formData.condicion_pago_id || null,
      };

      if (isEdit) {
        const { error } = await supabase.from('clientes').update(payload).eq('id', selectedClient.id);
        if (error) throw error;
        toast({ title: 'Cliente actualizado' });
        setIsEditDialogOpen(false);
      } else {
        const { error } = await supabase.from('clientes').insert([{
          ...payload, empresa_id: user.empresa_id, user_id: user.id, saldo_actual: 0, activo: true,
        }]);
        if (error) throw error;
        toast({ title: 'Cliente creado' });
        setIsAddDialogOpen(false);
      }
      fetchClients();
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const filteredClients = useMemo(() => {
    if (!searchQuery) return clients;
    const q = searchQuery.toLowerCase();
    return clients.filter(c =>
      c.nombre?.toLowerCase().includes(q) ||
      c.documento?.toLowerCase().includes(q) ||
      c.telefono?.toLowerCase().includes(q)
    );
  }, [clients, searchQuery]);

  // OJO: NO usar como <ClientForm /> (eso lo trata como componente y React lo
  // remonta en cada render del padre, perdiendo focus de los inputs en cada
  // tecla). Llamar siempre como función: {renderClientForm({ isEdit: false })}
  const renderClientForm = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
      {/* Nombre */}
      <div className="space-y-1.5 md:col-span-2">
        <Label className="dark:text-kx-text">Nombre / Razón Social *</Label>
        <Input value={formData.nombre} onChange={e => setFormData(f => ({ ...f, nombre: e.target.value }))}
          className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" required />
      </div>
      {/* Documento */}
      <div className="space-y-1.5">
        <Label className="dark:text-kx-text flex items-center gap-1"><Hash className="h-3.5 w-3.5" /> CUIT / DNI</Label>
        <Input value={formData.documento} onChange={e => setFormData(f => ({ ...f, documento: e.target.value }))}
          placeholder="20-12345678-9" className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
      </div>
      {/* Teléfono */}
      <div className="space-y-1.5">
        <Label className="dark:text-kx-text flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> Teléfono</Label>
        <Input value={formData.telefono} onChange={e => setFormData(f => ({ ...f, telefono: e.target.value }))}
          className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
      </div>
      {/* Email */}
      <div className="space-y-1.5">
        <Label className="dark:text-kx-text flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> Email</Label>
        <Input type="email" value={formData.email} onChange={e => setFormData(f => ({ ...f, email: e.target.value }))}
          className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
      </div>
      {/* Dirección */}
      <div className="space-y-1.5">
        <Label className="dark:text-kx-text flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> Dirección</Label>
        <Input value={formData.direccion} onChange={e => setFormData(f => ({ ...f, direccion: e.target.value }))}
          className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
      </div>

      {/* Separador Crédito */}
      <div className="md:col-span-2 border-t border-kx-border dark:border-kx-border pt-3">
        <p className="text-xs font-semibold text-slate-500 dark:text-kx-text-2 uppercase tracking-wider flex items-center gap-1">
          <CreditCard className="h-3.5 w-3.5" /> Condiciones de Crédito
        </p>
      </div>
      {/* Límite de crédito */}
      <div className="space-y-1.5">
        <Label className="dark:text-kx-text flex items-center gap-1"><DollarSign className="h-3.5 w-3.5" /> Límite de Crédito ($)</Label>
        <Input type="number" min="0" step="0.01"
          value={formData.limite_credito}
          onChange={e => setFormData(f => ({ ...f, limite_credito: e.target.value }))}
          placeholder="0 = sin límite"
          className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
        <p className="text-xs text-kx-text-3">0 = sin límite establecido</p>
      </div>
      {/* Condición de pago (maestro) */}
      {condicionesPago.filter(c => c.activo).length === 0 ? (
        <div className="space-y-1.5">
          <Label className="dark:text-kx-text flex items-center gap-1"><CreditCard className="h-3.5 w-3.5" /> Condición de Pago</Label>
          <div className="w-full h-10 rounded-md border border-dashed border-kx-border px-3 flex items-center text-xs text-kx-text-3">
            Sin condiciones activas —
            <a className="ml-1 text-violet-400 underline cursor-pointer">configurar en Finanzas</a>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label className="dark:text-kx-text flex items-center gap-1"><CreditCard className="h-3.5 w-3.5" /> Condición de Pago</Label>
          <select
            value={formData.condicion_pago_id}
            onChange={e => {
              const id = e.target.value;
              const condicion = condicionesPago.find(c => c.id === id);
              setFormData(f => ({
                ...f,
                condicion_pago_id: id,
                dias_credito: condicion ? String(condicion.dias_credito) : f.dias_credito,
              }));
            }}
            className="w-full h-10 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">Sin asignar (días manuales)</option>
            {condicionesPago.filter(c => c.activo).map(c => (
              <option key={c.id} value={c.id}>{c.nombre} ({c.dias_credito} días)</option>
            ))}
          </select>
          <p className="text-xs text-kx-text-3">Al seleccionar, completa automáticamente los días de crédito.</p>
        </div>
      )}
      {/* Días de crédito */}
      <div className="space-y-1.5">
        <Label className="dark:text-kx-text flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Días de Crédito</Label>
        <Input type="number" min="0"
          value={formData.dias_credito}
          onChange={e => setFormData(f => ({ ...f, dias_credito: e.target.value }))}
          placeholder="Ej: 30"
          className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
        <p className="text-xs text-kx-text-3">Días hasta vencimiento de facturas CC</p>
      </div>
      {/* Lista de precios */}
      {listasPrecios.filter(l => l.activo).length > 0 && (
        <div className="md:col-span-2 space-y-1.5">
          <Label className="dark:text-kx-text flex items-center gap-1"><Tag className="h-3.5 w-3.5 text-violet-500" /> Lista de Precios</Label>
          <select
            value={formData.lista_precio_id}
            onChange={e => setFormData(f => ({ ...f, lista_precio_id: e.target.value }))}
            className="w-full h-10 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">Sin lista especial (precio estándar)</option>
            {listasPrecios.filter(l => l.activo).map(l => (
              <option key={l.id} value={l.id}>{l.nombre}{l.descripcion ? ` — ${l.descripcion}` : ''}</option>
            ))}
          </select>
          <p className="text-xs text-kx-text-3">Al seleccionar un cliente en Ventas, se aplicarán automáticamente sus precios de lista.</p>
        </div>
      )}

      {/* Bloquear */}
      {(parseFloat(formData.limite_credito) || 0) > 0 && (
        <div className="md:col-span-2 flex items-center gap-3 bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
          <Shield className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Bloquear ventas al superar el límite</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">Si está activo, no se podrá vender a este cliente en CC cuando supere el límite.</p>
          </div>
          <Switch
            checked={formData.bloquear_en_limite}
            onCheckedChange={v => setFormData(f => ({ ...f, bloquear_en_limite: v }))}
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-3xl font-bold dark:text-kx-text">Clientes</h2>
          <p className="text-slate-500 dark:text-kx-text-2 text-sm mt-0.5">{clients.length} clientes activos</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsImportOpen(true)} className="dark:text-kx-text dark:border-kx-border">
            <Upload className="h-4 w-4 mr-2" /> Importar CSV
          </Button>
          <Button onClick={openAdd} className="bg-blue-600 text-white hover:bg-blue-700">
            <Plus className="h-4 w-4 mr-2" /> Nuevo Cliente
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3" />
        <Input placeholder="Buscar por nombre, CUIT o teléfono..."
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          className="pl-9 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
      </div>

      {/* Table */}
      <Card className="dark:bg-kx-bg dark:border-kx-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          {/* RESPONSIVE-TABLE */}
          <Table className="whitespace-nowrap">
            <TableHeader className="bg-kx-surface-2 dark:bg-slate-900/60">
              <TableRow className="dark:border-kx-border">
                <TableHead className="dark:text-kx-text-2 pl-6">Nombre</TableHead>
                <TableHead className="dark:text-kx-text-2">Documento</TableHead>
                <TableHead className="dark:text-kx-text-2">Teléfono</TableHead>
                <TableHead className="text-right dark:text-kx-text-2">Saldo CC</TableHead>
                <TableHead className="text-right dark:text-kx-text-2">Límite</TableHead>
                <TableHead className="dark:text-kx-text-2">Condiciones</TableHead>
                <TableHead className="text-center dark:text-kx-text-2">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="dark:border-kx-border">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredClients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-kx-text-3">
                    {searchQuery ? 'No hay resultados para la búsqueda' : 'No hay clientes aún'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredClients.map(client => {
                  const saldo = Number(client.saldo_actual || 0);
                  const limite = Number(client.limite_credito || 0);
                  const excedido = limite > 0 && saldo > limite;
                  return (
                    <TableRow key={client.id}
                      className="dark:border-kx-border dark:hover:bg-slate-900/50 cursor-pointer"
                      onClick={() => { setClientForDetail(client); setDetailModalOpen(true); }}
                    >
                      <TableCell className="pl-6 font-medium dark:text-kx-text">
                        {client.nombre}
                        {excedido && <AlertTriangle className="inline h-3.5 w-3.5 ml-1 text-amber-500" title="Límite excedido" />}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 dark:text-kx-text-2 font-mono">
                        {client.documento || '—'}
                      </TableCell>
                      <TableCell className="text-slate-500 dark:text-kx-text-2 text-sm">
                        {client.telefono || '—'}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${saldo > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-kx-text-2'}`}>
                        ${saldo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {limite > 0 ? (
                          <span className={`font-mono ${excedido ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-500 dark:text-kx-text-2'}`}>
                            ${limite.toLocaleString('es-AR', { minimumFractionDigits: 0 })}
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-kx-text-2 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-kx-text-3 max-w-[160px] truncate">
                        {(() => {
                          if (client.condicion_pago_id) {
                            const cp = condicionesPago.find(c => c.id === client.condicion_pago_id);
                            if (cp) return cp.nombre;
                          }
                          return client.condiciones_pago || (client.dias_credito ? `${client.dias_credito} días` : '—');
                        })()}
                      </TableCell>
                      <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                            onClick={() => { setClientForDetail(client); setDetailModalOpen(true); }}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            onClick={() => openEdit(client)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Detail Modal */}
      <ClientDetailModal open={detailModalOpen} onOpenChange={setDetailModalOpen}
        clientId={clientForDetail?.id} clientData={clientForDetail} onUpdate={fetchClients} />

      {/* Add Modal */}
      <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
        setIsAddDialogOpen(open);
        if (!open) document.activeElement?.blur();
      }}>
        <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text">Nuevo Cliente</DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">Completá los datos del nuevo cliente.</DialogDescription>
          </DialogHeader>
          {renderClientForm({ isEdit: false })}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} className="dark:text-kx-text dark:border-kx-border">Cancelar</Button>
            <Button onClick={() => handleSave(false)} disabled={saving} className="bg-blue-600 text-white hover:bg-blue-700">
              {saving ? 'Guardando...' : 'Crear Cliente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
        setIsEditDialogOpen(open);
        if (!open) document.activeElement?.blur();
      }}>
        <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text">Editar: {selectedClient?.nombre}</DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">Modificá los datos del cliente.</DialogDescription>
          </DialogHeader>
          {renderClientForm({ isEdit: true })}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} className="dark:text-kx-text dark:border-kx-border">Cancelar</Button>
            <Button onClick={() => handleSave(true)} disabled={saving} className="bg-blue-600 text-white hover:bg-blue-700">
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import CSV Modal */}
      <CSVImportModal
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        tipo="clientes"
        onSuccess={fetchClients}
      />
    </div>
  );
}

export default ClientesSection;
