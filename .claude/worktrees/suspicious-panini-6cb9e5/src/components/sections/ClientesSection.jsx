import React, { useState, useEffect, useMemo } from 'react';
import { Search, Plus, Edit, User, X, Eye, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import ClientDetailModal from './ClientDetailModal';
import ImportCSVModal from '@/components/ui/ImportCSVModal';

const EMPTY_FORM = { nombre: '', documento: '', telefono: '', email: '', direccion: '', limite_credito: '', condicion_pago: '', dias_credito: '' };

function ClientesSection() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [clientForDetail, setClientForDetail] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

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
        .order('nombre');
      if (error) throw error;
      setClients(data || []);
    } catch {
      toast({ title: 'Error', description: 'No se pudieron cargar los clientes', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => { setFormData(EMPTY_FORM); setIsAddDialogOpen(true); };
  const openEdit = (client, e) => {
    e?.stopPropagation();
    setSelectedClient(client);
    setFormData({
      nombre: client.nombre || '',
      documento: client.documento || '',
      telefono: client.telefono || '',
      email: client.email || '',
      direccion: client.direccion || '',
      limite_credito: client.limite_credito != null ? String(client.limite_credito) : '',
      condicion_pago: client.condicion_pago || '',
      dias_credito: client.dias_credito != null ? String(client.dias_credito) : '',
    });
    setIsEditDialogOpen(true);
  };

  const handleSave = async (isEdit) => {
    if (!formData.nombre.trim()) return toast({ title: 'Nombre requerido', variant: 'destructive' });
    setSaving(true);
    try {
      const payload = {
        nombre: formData.nombre.trim(),
        documento: formData.documento.trim() || null,
        telefono: formData.telefono.trim() || null,
        email: formData.email.trim() || null,
        direccion: formData.direccion.trim() || null,
        limite_credito: formData.limite_credito !== '' ? parseFloat(formData.limite_credito) : 0,
        condicion_pago: formData.condicion_pago.trim() || null,
        dias_credito: formData.dias_credito !== '' ? parseInt(formData.dias_credito) : null,
      };

      if (isEdit) {
        const { error } = await supabase.from('clientes').update(payload).eq('id', selectedClient.id);
        if (error) throw error;
        toast({ title: 'Cliente actualizado' });
        setIsEditDialogOpen(false);
      } else {
        const { error } = await supabase.from('clientes').insert([{
          ...payload,
          user_id: user.tenant_id,
          empresa_id: user.empresa_id,
          saldo_actual: 0,
          activo: true,
        }]);
        if (error) throw error;
        toast({ title: 'Cliente creado' });
        setIsAddDialogOpen(false);
      }
      fetchClients();
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const filteredClients = useMemo(() => {
    if (!searchQuery) return clients;
    const q = searchQuery.toLowerCase();
    return clients.filter(c =>
      c.nombre?.toLowerCase().includes(q) ||
      c.telefono?.toLowerCase().includes(q) ||
      c.documento?.toLowerCase().includes(q)
    );
  }, [clients, searchQuery]);

  const ClientForm = () => (
    <div className="grid gap-3 py-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Nombre *</Label>
          <Input value={formData.nombre} onChange={e => setFormData(p => ({...p, nombre: e.target.value}))} placeholder="Nombre completo" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white mt-1" />
        </div>
        <div>
          <Label>Documento (DNI/CUIT)</Label>
          <Input value={formData.documento} onChange={e => setFormData(p => ({...p, documento: e.target.value}))} placeholder="20-12345678-9" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white mt-1" />
        </div>
        <div>
          <Label>Teléfono</Label>
          <Input value={formData.telefono} onChange={e => setFormData(p => ({...p, telefono: e.target.value}))} placeholder="+54 9 11 1234-5678" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white mt-1" />
        </div>
        <div>
          <Label>Email</Label>
          <Input type="email" value={formData.email} onChange={e => setFormData(p => ({...p, email: e.target.value}))} placeholder="cliente@email.com" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white mt-1" />
        </div>
        <div>
          <Label>Límite de Crédito ($)</Label>
          <Input type="number" min="0" value={formData.limite_credito} onChange={e => setFormData(p => ({...p, limite_credito: e.target.value}))} placeholder="0 = sin límite" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white mt-1" />
        </div>
        <div className="col-span-2">
          <Label>Dirección</Label>
          <Input value={formData.direccion} onChange={e => setFormData(p => ({...p, direccion: e.target.value}))} placeholder="Calle 123, Ciudad" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white mt-1" />
        </div>
        <div>
          <Label>Condición de Venta</Label>
          <Input value={formData.condicion_pago} onChange={e => setFormData(p => ({...p, condicion_pago: e.target.value}))} placeholder="Ej: Contado, 30 días..." className="dark:bg-slate-900 dark:border-slate-700 dark:text-white mt-1" />
        </div>
        <div>
          <Label>Días de Crédito</Label>
          <Input type="number" min="0" value={formData.dias_credito} onChange={e => setFormData(p => ({...p, dias_credito: e.target.value}))} placeholder="Ej: 30" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white mt-1" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold dark:text-white">Clientes</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)} className="dark:border-slate-700 dark:text-white">
            <Upload className="mr-2 h-4 w-4" /> Importar CSV
          </Button>
          <Button onClick={openAdd} className="bg-blue-600 text-white hover:bg-blue-700">
            <Plus className="mr-2 h-4 w-4" /> Nuevo Cliente
          </Button>
        </div>
      </div>

      <Card className="dark:bg-slate-950 dark:border-slate-800">
        <CardHeader className="pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Buscar por nombre, teléfono o documento..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 dark:bg-slate-900 dark:border-slate-700 dark:text-white"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="dark:border-slate-800">
                <TableHead className="dark:text-slate-400 pl-6">Nombre</TableHead>
                <TableHead className="dark:text-slate-400">Teléfono</TableHead>
                <TableHead className="dark:text-slate-400">Condición</TableHead>
                <TableHead className="text-right dark:text-slate-400">Saldo</TableHead>
                <TableHead className="text-right dark:text-slate-400">Límite</TableHead>
                <TableHead className="text-center dark:text-slate-400 pr-4">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="dark:border-slate-800">
                    <TableCell className="pl-6"><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-16 mx-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredClients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-slate-400 dark:text-slate-500">
                    {clients.length === 0 ? 'No hay clientes registrados aún' : 'Sin resultados para la búsqueda'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredClients.map(client => {
                  const saldo = Number(client.saldo_actual || 0);
                  const limite = Number(client.limite_credito || 0);
                  const limiteAlcanzado = limite > 0 && saldo >= limite;
                  return (
                    <TableRow
                      key={client.id}
                      className="dark:border-slate-800 dark:hover:bg-slate-900/50 cursor-pointer"
                      onClick={() => { setClientForDetail(client); setDetailModalOpen(true); }}
                    >
                      <TableCell className="pl-6 font-medium dark:text-slate-200">
                        {client.nombre}
                        {!client.activo && <Badge className="ml-2 text-xs bg-slate-200 text-slate-500">Inactivo</Badge>}
                      </TableCell>
                      <TableCell className="dark:text-slate-400 text-sm">{client.telefono || '—'}</TableCell>
                      <TableCell className="dark:text-slate-400 text-sm">
                        {client.condicion_pago
                          ? <span>{client.condicion_pago}{client.dias_credito ? ` (${client.dias_credito}d)` : ''}</span>
                          : <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm font-bold ${saldo > 0 ? 'text-red-600 dark:text-red-400' : 'dark:text-slate-200'}`}>
                        ${saldo.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {limite > 0 ? (
                          <span className={limiteAlcanzado ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-500 dark:text-slate-400'}>
                            ${limite.toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center pr-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 dark:text-slate-400 dark:hover:text-white" onClick={() => { setClientForDetail(client); setDetailModalOpen(true); }}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 dark:text-slate-400 dark:hover:text-white" onClick={(e) => openEdit(client, e)}>
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
        </CardContent>
      </Card>

      <ClientDetailModal
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        clientId={clientForDetail?.id}
        clientData={clientForDetail}
        onUpdate={fetchClients}
      />

      {/* Add Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-lg dark:bg-slate-950 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Nuevo Cliente</DialogTitle>
            <DialogDescription className="dark:text-slate-400">Completá los datos del nuevo cliente.</DialogDescription>
          </DialogHeader>
          <ClientForm />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} disabled={saving} className="dark:border-slate-700 dark:text-white">Cancelar</Button>
            <Button onClick={() => handleSave(false)} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
              {saving ? 'Guardando...' : 'Crear Cliente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-lg dark:bg-slate-950 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Editar Cliente</DialogTitle>
            <DialogDescription className="dark:text-slate-400">Modificá los datos de {selectedClient?.nombre}.</DialogDescription>
          </DialogHeader>
          <ClientForm />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={saving} className="dark:border-slate-700 dark:text-white">Cancelar</Button>
            <Button onClick={() => handleSave(true)} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportCSVModal open={importOpen} onOpenChange={setImportOpen} tipo="clientes" empresaId={user?.empresa_id} tenantId={user?.tenant_id} onSuccess={fetchClients} />
    </div>
  );
}

export default ClientesSection;
