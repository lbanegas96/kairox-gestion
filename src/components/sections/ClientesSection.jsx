import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, Plus, Edit, Eye, Upload, X, AlertTriangle, Shield, CreditCard,
  FileText, Phone, Mail, MapPin, Hash, DollarSign, Clock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import ClientDetailModal from './ClientDetailModal';
import CSVImportModal from '@/components/ui/CSVImportModal';

const emptyForm = () => ({
  nombre: '', documento: '', telefono: '', email: '', direccion: '',
  limite_credito: '', condiciones_pago: '', dias_credito: '',
  bloquear_en_limite: false,
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
      condiciones_pago:   client.condiciones_pago || '',
      dias_credito:       client.dias_credito != null ? String(client.dias_credito) : '',
      bloquear_en_limite: client.bloquear_en_limite || false,
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
        condiciones_pago:   formData.condiciones_pago.trim(),
        dias_credito:       formData.dias_credito !== '' ? parseInt(formData.dias_credito) : 0,
        bloquear_en_limite: formData.bloquear_en_limite,
      };

      if (isEdit) {
        const { error } = await supabase.from('clientes').update(payload).eq('id', selectedClient.id);
        if (error) throw error;
        toast({ title: 'Cliente actualizado' });
        setIsEditDialogOpen(false);
      } else {
        const { error } = await supabase.from('clientes').insert([{
          ...payload, empresa_id: user.empresa_id, user_id: user.tenant_id, saldo_actual: 0, activo: true,
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

  const ClientForm = ({ onSubmit, isEdit }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
      {/* Nombre */}
      <div className="space-y-1.5 md:col-span-2">
        <Label className="dark:text-white">Nombre / Razón Social *</Label>
        <Input value={formData.nombre} onChange={e => setFormData(f => ({ ...f, nombre: e.target.value }))}
          className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" required />
      </div>
      {/* Documento */}
      <div className="space-y-1.5">
        <Label className="dark:text-white flex items-center gap-1"><Hash className="h-3.5 w-3.5" /> CUIT / DNI</Label>
        <Input value={formData.documento} onChange={e => setFormData(f => ({ ...f, documento: e.target.value }))}
          placeholder="20-12345678-9" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
      </div>
      {/* Teléfono */}
      <div className="space-y-1.5">
        <Label className="dark:text-white flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> Teléfono</Label>
        <Input value={formData.telefono} onChange={e => setFormData(f => ({ ...f, telefono: e.target.value }))}
          className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
      </div>
      {/* Email */}
      <div className="space-y-1.5">
        <Label className="dark:text-white flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> Email</Label>
        <Input type="email" value={formData.email} onChange={e => setFormData(f => ({ ...f, email: e.target.value }))}
          className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
      </div>
      {/* Dirección */}
      <div className="space-y-1.5">
        <Label className="dark:text-white flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> Dirección</Label>
        <Input value={formData.direccion} onChange={e => setFormData(f => ({ ...f, direccion: e.target.value }))}
          className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
      </div>

      {/* Separador Crédito */}
      <div className="md:col-span-2 border-t border-slate-200 dark:border-slate-800 pt-3">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
          <CreditCard className="h-3.5 w-3.5" /> Condiciones de Crédito
        </p>
      </div>
      {/* Límite de crédito */}
      <div className="space-y-1.5">
        <Label className="dark:text-white flex items-center gap-1"><DollarSign className="h-3.5 w-3.5" /> Límite de Crédito ($)</Label>
        <Input type="number" min="0" step="0.01"
          value={formData.limite_credito}
          onChange={e => setFormData(f => ({ ...f, limite_credito: e.target.value }))}
          placeholder="0 = sin límite"
          className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
        <p className="text-xs text-slate-400">0 = sin límite establecido</p>
      </div>
      {/* Días de crédito */}
      <div className="space-y-1.5">
        <Label className="dark:text-white flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Días de Crédito</Label>
        <Input type="number" min="0"
          value={formData.dias_credito}
          onChange={e => setFormData(f => ({ ...f, dias_credito: e.target.value }))}
          placeholder="Ej: 30"
          className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
        <p className="text-xs text-slate-400">Días hasta vencimiento de facturas CC</p>
      </div>
      {/* Condiciones */}
      <div className="space-y-1.5 md:col-span-2">
        <Label className="dark:text-white flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> Condiciones de Pago</Label>
        <Textarea
          value={formData.condiciones_pago}
          onChange={e => setFormData(f => ({ ...f, condiciones_pago: e.target.value }))}
          placeholder="Ej: Pago a 30 días. Descuento 5% por pago anticipado."
          className="resize-none h-16 dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm"
        />
      </div>
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
          <h2 className="text-3xl font-bold dark:text-white">Clientes</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">{clients.length} clientes activos</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsImportOpen(true)} className="dark:text-white dark:border-slate-700">
            <Upload className="h-4 w-4 mr-2" /> Importar CSV
          </Button>
          <Button onClick={openAdd} className="bg-blue-600 text-white hover:bg-blue-700">
            <Plus className="h-4 w-4 mr-2" /> Nuevo Cliente
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input placeholder="Buscar por nombre, CUIT o teléfono..."
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          className="pl-9 dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
      </div>

      {/* Table */}
      <Card className="dark:bg-slate-950 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50 dark:bg-slate-900/60">
              <TableRow className="dark:border-slate-800">
                <TableHead className="dark:text-slate-400 pl-6">Nombre</TableHead>
                <TableHead className="dark:text-slate-400">Documento</TableHead>
                <TableHead className="dark:text-slate-400">Teléfono</TableHead>
                <TableHead className="text-right dark:text-slate-400">Saldo CC</TableHead>
                <TableHead className="text-right dark:text-slate-400">Límite</TableHead>
                <TableHead className="dark:text-slate-400">Condiciones</TableHead>
                <TableHead className="text-center dark:text-slate-400">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="dark:border-slate-800">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredClients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-slate-400">
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
                      className="dark:border-slate-800 dark:hover:bg-slate-900/50 cursor-pointer"
                      onClick={() => { setClientForDetail(client); setDetailModalOpen(true); }}
                    >
                      <TableCell className="pl-6 font-medium dark:text-slate-200">
                        {client.nombre}
                        {excedido && <AlertTriangle className="inline h-3.5 w-3.5 ml-1 text-amber-500" title="Límite excedido" />}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                        {client.documento || '—'}
                      </TableCell>
                      <TableCell className="text-slate-500 dark:text-slate-400 text-sm">
                        {client.telefono || '—'}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${saldo > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
                        ${saldo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {limite > 0 ? (
                          <span className={`font-mono ${excedido ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-500 dark:text-slate-400'}`}>
                            ${limite.toLocaleString('es-AR', { minimumFractionDigits: 0 })}
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 max-w-[160px] truncate">
                        {client.condiciones_pago || (client.dias_credito ? `${client.dias_credito} días` : '—')}
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
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-2xl dark:bg-slate-950 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Nuevo Cliente</DialogTitle>
            <DialogDescription className="dark:text-slate-400">Completá los datos del nuevo cliente.</DialogDescription>
          </DialogHeader>
          <ClientForm isEdit={false} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} className="dark:text-white dark:border-slate-700">Cancelar</Button>
            <Button onClick={() => handleSave(false)} disabled={saving} className="bg-blue-600 text-white hover:bg-blue-700">
              {saving ? 'Guardando...' : 'Crear Cliente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl dark:bg-slate-950 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Editar: {selectedClient?.nombre}</DialogTitle>
            <DialogDescription className="dark:text-slate-400">Modificá los datos del cliente.</DialogDescription>
          </DialogHeader>
          <ClientForm isEdit={true} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} className="dark:text-white dark:border-slate-700">Cancelar</Button>
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
