import React, { useState, useEffect, useMemo } from 'react';
import { Search, Plus, User, Eye, UserX, UserCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import ClientDetailModal from './ClientDetailModal';

const FILTROS_ACTIVO = [
  { value: 'activos',   label: 'Activos' },
  { value: 'inactivos', label: 'Inactivos' },
  { value: 'todos',     label: 'Todos' },
];

function ClientesSection() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filtroActivo, setFiltroActivo] = useState('activos');

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [clientForDetail, setClientForDetail] = useState(null);

  // confirmación eliminar
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [formData, setFormData] = useState({ nombre: '', documento: '', telefono: '', email: '', direccion: '', limite_credito: 0 });

  useEffect(() => {
    if (user?.empresa_id) fetchClients(filtroActivo);
  }, [user, filtroActivo]);

  const fetchClients = async (filtro = filtroActivo) => {
    try {
      setLoading(true);
      let query = supabase
        .from('clientes')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .order('nombre', { ascending: true });

      if (filtro === 'activos')   query = query.neq('activo', false);
      if (filtro === 'inactivos') query = query.eq('activo', false);

      const { data, error } = await query;
      if (error) throw error;
      setClients(data || []);
    } catch (error) {
      toast({ title: "Error", description: "No se pudieron cargar los clientes", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveClient = async () => {
    if (!formData.nombre.trim()) return toast({ title: "Nombre requerido", variant: "destructive" });
    try {
      const { error } = await supabase.from('clientes').insert([{
        user_id: user.tenant_id,
        empresa_id: user.empresa_id,
        nombre: formData.nombre,
        documento: formData.documento,
        telefono: formData.telefono,
        email: formData.email,
        direccion: formData.direccion,
        limite_credito: formData.limite_credito,
        saldo_actual: 0,
        activo: true,
      }]);
      if (error) throw error;
      toast({ title: "Cliente creado" });
      setIsAddDialogOpen(false);
      setFormData({ nombre: '', documento: '', telefono: '', email: '', direccion: '', limite_credito: 0 });
      fetchClients();
    } catch (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleToggleActivo = async (client) => {
    const nuevoEstado = client.activo === false ? true : false;
    const { error } = await supabase.from('clientes').update({ activo: nuevoEstado }).eq('id', client.id);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    toast({
      title: nuevoEstado ? "Cliente reactivado" : "Cliente inactivado",
      className: nuevoEstado ? "bg-green-600 text-white" : undefined,
    });
    fetchClients();
  };

  const handleDelete = async (client) => {
    // Verificar si tiene transacciones
    const { count } = await supabase
      .from('cuenta_corriente_movimientos')
      .select('id', { count: 'exact', head: true })
      .eq('cliente_id', client.id);

    if (count > 0) {
      toast({
        title: "No se puede eliminar",
        description: `${client.nombre} tiene ${count} movimiento(s). Usá "Inactivar" para ocultarlo.`,
        variant: "destructive",
      });
      setDeleteTarget(null);
      return;
    }

    const { error } = await supabase.from('clientes').delete().eq('id', client.id);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    toast({ title: "Cliente eliminado" });
    setDeleteTarget(null);
    fetchClients();
  };

  const filteredClients = useMemo(() => {
    if (!searchQuery) return clients;
    const q = searchQuery.toLowerCase();
    return clients.filter(c => c.nombre?.toLowerCase().includes(q) || c.telefono?.includes(q));
  }, [clients, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold dark:text-white">Clientes</h2>
        <Button onClick={() => setIsAddDialogOpen(true)} className="bg-blue-600 text-white hover:bg-blue-700">
          <Plus className="mr-2 h-4 w-4" /> Nuevo Cliente
        </Button>
      </div>

      <Card className="dark:bg-slate-950 dark:border-slate-800">
        <CardHeader className="pb-3 space-y-3">
          <div className="flex gap-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <Input placeholder="Buscar nombre o teléfono..." value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
            </div>
            <div className="flex rounded-md overflow-hidden border border-slate-200 dark:border-slate-700">
              {FILTROS_ACTIVO.map(f => (
                <button key={f.value} onClick={() => setFiltroActivo(f.value)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    filtroActivo === f.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="dark:border-slate-800">
                <TableHead className="dark:text-slate-400">Nombre</TableHead>
                <TableHead className="dark:text-slate-400">Teléfono</TableHead>
                <TableHead className="text-right dark:text-slate-400">Saldo</TableHead>
                <TableHead className="text-center dark:text-slate-400">Estado</TableHead>
                <TableHead className="text-center dark:text-slate-400">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-slate-400">Cargando...</TableCell></TableRow>
              ) : filteredClients.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-slate-400">
                  <User className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No hay clientes {filtroActivo !== 'todos' ? filtroActivo : ''}
                </TableCell></TableRow>
              ) : filteredClients.map(client => (
                <TableRow key={client.id} className={`dark:border-slate-800 dark:hover:bg-slate-900/50 ${client.activo === false ? 'opacity-60' : ''}`}>
                  <TableCell className="dark:text-slate-200 font-medium">{client.nombre}</TableCell>
                  <TableCell className="dark:text-slate-400">{client.telefono || '—'}</TableCell>
                  <TableCell className="text-right dark:text-slate-200 font-mono">
                    ${Number(client.saldo_actual).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-center">
                    {client.activo === false
                      ? <Badge variant="outline" className="text-xs text-slate-500 border-slate-400 dark:text-slate-400 dark:border-slate-600">Inactivo</Badge>
                      : <Badge variant="outline" className="text-xs text-green-700 border-green-300 dark:text-green-400 dark:border-green-800">Activo</Badge>
                    }
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-blue-500"
                        onClick={() => { setClientForDetail(client); setDetailModalOpen(true); }} title="Ver detalle">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className={`h-7 w-7 ${client.activo === false ? 'text-slate-400 hover:text-green-600' : 'text-slate-400 hover:text-amber-600'}`}
                        onClick={() => handleToggleActivo(client)}
                        title={client.activo === false ? 'Reactivar cliente' : 'Inactivar cliente'}>
                        {client.activo === false ? <UserCheck className="h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500"
                        onClick={() => setDeleteTarget(client)} title="Eliminar cliente">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <ClientDetailModal
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        clientId={clientForDetail?.id}
        clientData={clientForDetail}
        onUpdate={fetchClients}
        onToggleActivo={handleToggleActivo}
      />

      {/* Add Modal */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="dark:bg-slate-950 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Nuevo Cliente</DialogTitle>
            <DialogDescription className="dark:text-slate-400">Completá los datos del nuevo cliente.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <Input placeholder="Nombre *" value={formData.nombre} onChange={e => setFormData({ ...formData, nombre: e.target.value })} className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
            <Input placeholder="Documento" value={formData.documento} onChange={e => setFormData({ ...formData, documento: e.target.value })} className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
            <Input placeholder="Teléfono" value={formData.telefono} onChange={e => setFormData({ ...formData, telefono: e.target.value })} className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
            <Input placeholder="Email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
            <Input placeholder="Dirección" value={formData.direccion} onChange={e => setFormData({ ...formData, direccion: e.target.value })} className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
            <Input type="number" min="0" placeholder="Límite de crédito" value={formData.limite_credito} onChange={e => setFormData({ ...formData, limite_credito: e.target.value })} className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} className="dark:border-slate-700 dark:text-slate-300">Cancelar</Button>
            <Button onClick={handleSaveClient} className="bg-blue-600 hover:bg-blue-700 text-white">Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar eliminación */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="dark:bg-slate-950 dark:border-slate-800 max-w-sm">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Eliminar cliente</DialogTitle>
            <DialogDescription className="dark:text-slate-400">
              ¿Confirmás la eliminación permanente de <strong>{deleteTarget?.nombre}</strong>?
              Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="dark:border-slate-700 dark:text-slate-300">Cancelar</Button>
            <Button variant="destructive" onClick={() => handleDelete(deleteTarget)}>Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ClientesSection;
