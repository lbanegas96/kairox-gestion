import React, { useState, useEffect, useMemo } from 'react';
import { Search, Plus, Edit, User, AlertCircle, Banknote, X, Eye, Phone, Mail, CheckCircle, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import ClientDetailModal from './ClientDetailModal';

function ClientesSection() {
  const { user } = useAuth();
  const { isSessionOpen, currentSession } = useCaja();
  const { toast } = useToast();
  
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [clientForDetail, setClientForDetail] = useState(null);

  const [formData, setFormData] = useState({ nombre: '', documento: '', telefono: '', email: '', direccion: '', limite_credito: 0 });
  const [paymentData, setPaymentData] = useState({ monto: '', metodo: 'Efectivo', nota: '' });

  useEffect(() => {
    if (user && user.empresa_id) {
      fetchClients();
    }
  }, [user]);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .order('nombre', { ascending: true });

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
      const newClient = {
        user_id: user.tenant_id,
        empresa_id: user.empresa_id,
        nombre: formData.nombre,
        documento: formData.documento,
        telefono: formData.telefono,
        email: formData.email,
        direccion: formData.direccion,
        limite_credito: formData.limite_credito,
        saldo_actual: 0,
        activo: true
      };
      const { error } = await supabase.from('clientes').insert([newClient]);
      if (error) throw error;
      toast({ title: "Cliente creado" });
      setIsAddDialogOpen(false);
      setFormData({ nombre: '', documento: '', telefono: '', email: '', direccion: '', limite_credito: 0 });
      fetchClients();
    } catch (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const filteredClients = useMemo(() => {
    if (!searchQuery) return clients;
    const lowerQuery = searchQuery.toLowerCase();
    return clients.filter(client => client.nombre?.toLowerCase().includes(lowerQuery));
  }, [clients, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold dark:text-white">Clientes</h2>
        <Button onClick={() => setIsAddDialogOpen(true)} className="bg-blue-600 text-white hover:bg-blue-700"><Plus className="mr-2 h-4 w-4" /> Nuevo Cliente</Button>
      </div>

      <Card className="dark:bg-slate-950 dark:border-slate-800">
        <CardHeader className="pb-3">
          <Input placeholder="Buscar..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
        </CardHeader>
        <CardContent>
           <Table>
              <TableHeader>
                <TableRow className="dark:border-slate-800">
                   <TableHead className="dark:text-slate-400">Nombre</TableHead><TableHead className="dark:text-slate-400">Teléfono</TableHead><TableHead className="text-right dark:text-slate-400">Saldo</TableHead><TableHead className="text-center dark:text-slate-400">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map(client => (
                  <TableRow key={client.id} className="dark:border-slate-800 dark:hover:bg-slate-900/50">
                    <TableCell className="dark:text-slate-200">{client.nombre}</TableCell>
                    <TableCell className="dark:text-slate-400">{client.telefono}</TableCell>
                    <TableCell className="text-right dark:text-slate-200">${client.saldo_actual}</TableCell>
                    <TableCell className="text-center">
                       <Button variant="ghost" size="sm" onClick={() => { setClientForDetail(client); setDetailModalOpen(true); }} className="dark:text-slate-400 dark:hover:text-white"><Eye className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
           </Table>
        </CardContent>
      </Card>
      
      {/* Detail Modal */}
      <ClientDetailModal open={detailModalOpen} onOpenChange={setDetailModalOpen} clientId={clientForDetail?.id} clientData={clientForDetail} />

      {/* Add Modal */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="dark:bg-slate-950 dark:border-slate-800">
           <DialogHeader>
             <DialogTitle className="dark:text-white">Nuevo Cliente</DialogTitle>
             <DialogDescription className="dark:text-slate-400">Completá los datos del nuevo cliente.</DialogDescription>
           </DialogHeader>
           <div className="grid gap-4 py-4">
              <Input placeholder="Nombre" value={formData.nombre} onChange={e => setFormData({...formData, nombre: e.target.value})} className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
              <Input placeholder="Teléfono" value={formData.telefono} onChange={e => setFormData({...formData, telefono: e.target.value})} className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
              <Button onClick={handleSaveClient} className="dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">Guardar</Button>
           </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ClientesSection;