import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  DollarSign,
  AlertTriangle,
  Users,
  CreditCard,
  ArrowLeft,
  History,
  Wallet,
  Filter,
  CheckCircle,
  X,
  Banknote,
  Eye,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock
} from 'lucide-react';
import { dashboardAgingService, DASHBOARD_KEYS } from '@/services/dashboardService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { getNowAR } from '@/lib/dateUtils';
import ClientDetailModal from './ClientDetailModal';

function CuentaCorrienteSection() {
  const { user } = useAuth();
  const { isSessionOpen, currentSession } = useCaja();
  const { toast } = useToast();
  
  // Data State
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filters
  const [statusFilter, setStatusFilter] = useState('Todos'); // 'Todos', 'Con Deuda', 'Al Día'

  // Tabs
  const [activeTab, setActiveTab] = useState('saldos'); // 'saldos' | 'antigüedad'

  // Modals
  const [selectedClient, setSelectedClient] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  
  // Payment Form
  const [paymentData, setPaymentData] = useState({
    monto: '',
    metodo: 'Efectivo',
    nota: ''
  });
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  const { data: aging, isLoading: agingLoading } = useQuery({
    queryKey: DASHBOARD_KEYS.aging(user?.empresa_id),
    queryFn: () => dashboardAgingService.getAgingResumen(user.empresa_id),
    enabled: !!user?.empresa_id && activeTab === 'antigüedad',
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (user && user.empresa_id) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      setLoading(true);
      // Fixed: fetching clients by empresa_id instead of user_id/tenant_id
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .order('nombre');

      if (error) throw error;
      setClients(data || []);
    } catch (error) {
      console.error('Error fetching CC data:', error);
      toast({
        title: "Error",
        description: "No se pudieron cargar los datos de cuenta corriente",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // --- Filtering & Sorting ---
  const filteredClients = useMemo(() => {
    let result = clients;

    // 1. Text Search
    if (searchTerm) {
      const lowerQuery = searchTerm.toLowerCase();
      result = result.filter(c => 
        c.nombre.toLowerCase().includes(lowerQuery)
      );
    }

    // 2. Status Filter
    if (statusFilter === 'Con Deuda') {
      result = result.filter(c => (c.saldo_actual || 0) > 0);
    } else if (statusFilter === 'Al Día') {
      result = result.filter(c => (c.saldo_actual || 0) <= 0);
    }

    // 3. Sort: Debtors first, then Alphabetical
    return result.sort((a, b) => {
      const debtA = (a.saldo_actual || 0) > 0 ? 1 : 0;
      const debtB = (b.saldo_actual || 0) > 0 ? 1 : 0;
      
      if (debtA !== debtB) return debtB - debtA; // Debtors first
      return a.nombre.localeCompare(b.nombre); // Then alphabetical
    });
  }, [clients, searchTerm, statusFilter]);

  // --- Metrics Calculation ---
  const metrics = useMemo(() => {
    const totalAdeudado = filteredClients.reduce((sum, c) => sum + Math.max(0, c.saldo_actual || 0), 0);
    const countConDeuda = filteredClients.filter(c => (c.saldo_actual || 0) > 0).length;
    const countAlDia = filteredClients.filter(c => (c.saldo_actual || 0) <= 0).length;

    return { totalAdeudado, countConDeuda, countAlDia };
  }, [filteredClients]);

  // --- Actions ---
  const openDetailModal = (client) => {
    setSelectedClient(client);
    setDetailModalOpen(true);
  };

  const openPaymentDialog = (client, e) => {
    e?.stopPropagation();
    setSelectedClient(client);
    setPaymentData({ monto: '', metodo: 'Efectivo', nota: '' });
    setIsPaymentDialogOpen(true);
  };

  const handleRegisterPayment = async () => {
    if (!isSessionOpen) {
      toast({ variant: 'destructive', title: 'Caja cerrada', description: 'Debe abrir caja antes de registrar cobros' });
      return; 
    }

    if (!selectedClient) return;
    
    const amount = parseFloat(paymentData.monto);
    if (!amount || isNaN(amount) || amount <= 0) {
      toast({ title: "Error", description: "Ingrese un monto válido mayor a 0", variant: "destructive" });
      return;
    }

    setIsProcessingPayment(true);
    const date = getNowAR().toISOString();

    try {
      // 1. Insert Movement in Current Account (HABER reduces debt)
      const { error: movError } = await supabase.from('cuenta_corriente_movimientos').insert([{
        user_id: user.tenant_id,
        empresa_id: user.empresa_id, // Ensure empresa_id is included
        cliente_id: selectedClient.id,
        tipo: 'HABER',
        monto: amount,
        descripcion: paymentData.nota ? `Pago: ${paymentData.nota}` : 'Pago de deuda',
        fecha: date
      }]);
      
      if (movError) throw movError;

      // 2. Insert Movement in Cash Box
      const { error: cashError } = await supabase.from('movimientos_caja').insert([{
        user_id: user.tenant_id,
        empresa_id: user.empresa_id, // Ensure empresa_id is included
        caja_sesion_id: currentSession?.id,
        fecha: date,
        tipo: 'ingreso',
        categoria: 'Cobro Cliente',
        concepto: `Cobro a ${selectedClient.nombre} - ${paymentData.metodo}`,
        monto: amount,
        metodo_pago: paymentData.metodo,
        is_automatic: true
      }]);

      if (cashError) throw cashError;
      
      toast({
        title: "Pago Registrado",
        description: `Se registró el cobro de $${amount.toLocaleString('es-AR')}.`,
        className: "bg-emerald-600 text-white border-none"
      });

      setIsPaymentDialogOpen(false);
      fetchData(); // Refresh list
      
      // Update selected client in modal if open
      if (selectedClient) {
        const updatedClient = { ...selectedClient, saldo_actual: (selectedClient.saldo_actual || 0) - amount };
        setSelectedClient(updatedClient);
      }

    } catch (error) {
      console.error("Error registering payment:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const getStatusBadge = (saldo) => {
    const hasDebt = (saldo || 0) > 0;
    const isFavor = (saldo || 0) < 0;
    
    if (hasDebt) {
      return (
        <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-200 shadow-none font-medium">
          Con Deuda
        </Badge>
      );
    } else if (isFavor) {
       return (
        <Badge className="bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200 shadow-none font-medium">
          Saldo a Favor
        </Badge>
      );
    }
    return (
      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200 shadow-none font-medium">
        Al Día
      </Badge>
    );
  };

  const fmtCurrency = (n) => `$${Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })}`;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Cuenta Corriente</h2>
          <p className="text-slate-500 dark:text-slate-400">Control de saldos y movimientos de clientes</p>
        </div>
        {!isSessionOpen && (
           <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-4 py-2 rounded-lg flex items-center gap-2 border border-red-200 dark:border-red-800 text-sm font-bold shadow-sm">
              <AlertTriangle className="h-4 w-4" /> CAJA CERRADA
           </div>
        )}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-1">
        <button
          onClick={() => setActiveTab('saldos')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'saldos'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          Saldos
        </button>
        <button
          onClick={() => setActiveTab('antigüedad')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
            activeTab === 'antigüedad'
              ? 'border-amber-600 text-amber-600 dark:text-amber-400 dark:border-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Clock className="h-3.5 w-3.5" /> Antigüedad de Deuda
        </button>
      </div>

      {/* ══ Vista Antigüedad ════════════════════════════════════════════════════ */}
      {activeTab === 'antigüedad' && (
        <div className="space-y-4">
          {agingLoading ? (
            <div className="flex items-center justify-center h-40 text-slate-400">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mr-3" />
              Calculando antigüedad...
            </div>
          ) : !aging || aging.clientes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-400">
              <CheckCircle className="h-12 w-12 mb-3 text-emerald-400" />
              <p className="font-medium">Sin deudas pendientes</p>
            </div>
          ) : (
            <>
              {/* Resumen por bucket */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: '0–30 días', value: aging.totals.d30, color: 'from-emerald-600 to-emerald-500', textColor: 'text-emerald-600' },
                  { label: '31–60 días', value: aging.totals.d60, color: 'from-amber-600 to-amber-500', textColor: 'text-amber-600' },
                  { label: '61–90 días', value: aging.totals.d90, color: 'from-orange-600 to-orange-500', textColor: 'text-orange-600' },
                  { label: '+90 días', value: aging.totals.d90plus, color: 'from-red-700 to-red-600', textColor: 'text-red-600' },
                ].map(({ label, value, color, textColor }) => (
                  <Card key={label} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
                    <CardContent className="p-4">
                      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">{label}</p>
                      <p className={`text-xl font-black ${value > 0 ? textColor : 'text-slate-400'}`}>
                        {fmtCurrency(value)}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Tabla por cliente */}
              <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                      <TableRow>
                        <TableHead className="pl-6 font-semibold text-slate-600 dark:text-slate-300 w-[220px]">Cliente</TableHead>
                        <TableHead className="text-right font-semibold text-emerald-700 dark:text-emerald-400">0–30 días</TableHead>
                        <TableHead className="text-right font-semibold text-amber-700 dark:text-amber-400">31–60 días</TableHead>
                        <TableHead className="text-right font-semibold text-orange-700 dark:text-orange-400">61–90 días</TableHead>
                        <TableHead className="text-right font-semibold text-red-700 dark:text-red-400">+90 días</TableHead>
                        <TableHead className="text-right font-semibold text-slate-600 dark:text-slate-300 pr-6">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aging.clientes.map((row) => (
                        <TableRow
                          key={row.clienteId}
                          className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/30"
                          onClick={() => {
                            const c = clients.find(cl => cl.id === row.clienteId);
                            if (c) openDetailModal(c);
                          }}
                        >
                          <TableCell className="pl-6 font-medium text-slate-800 dark:text-slate-200">{row.nombre}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-emerald-700 dark:text-emerald-400">
                            {row.d30 > 0 ? fmtCurrency(row.d30) : <span className="text-slate-300 dark:text-slate-700">—</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-amber-700 dark:text-amber-400">
                            {row.d60 > 0 ? fmtCurrency(row.d60) : <span className="text-slate-300 dark:text-slate-700">—</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-orange-700 dark:text-orange-400">
                            {row.d90 > 0 ? fmtCurrency(row.d90) : <span className="text-slate-300 dark:text-slate-700">—</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-red-700 dark:text-red-400">
                            {row.d90plus > 0 ? fmtCurrency(row.d90plus) : <span className="text-slate-300 dark:text-slate-700">—</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold text-slate-800 dark:text-slate-200 pr-6">
                            {fmtCurrency(row.total)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Fila de totales */}
                      <TableRow className="bg-slate-50 dark:bg-slate-800/50 border-t-2 border-slate-200 dark:border-slate-700 font-bold">
                        <TableCell className="pl-6 text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider">Totales</TableCell>
                        <TableCell className="text-right font-mono text-emerald-700 dark:text-emerald-400">{fmtCurrency(aging.totals.d30)}</TableCell>
                        <TableCell className="text-right font-mono text-amber-700 dark:text-amber-400">{fmtCurrency(aging.totals.d60)}</TableCell>
                        <TableCell className="text-right font-mono text-orange-700 dark:text-orange-400">{fmtCurrency(aging.totals.d90)}</TableCell>
                        <TableCell className="text-right font-mono text-red-700 dark:text-red-400">{fmtCurrency(aging.totals.d90plus)}</TableCell>
                        <TableCell className="text-right font-mono text-slate-800 dark:text-slate-200 pr-6">
                          {fmtCurrency(aging.totals.d30 + aging.totals.d60 + aging.totals.d90 + aging.totals.d90plus)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ══ Vista Saldos (existente) ════════════════════════════════════════════ */}
      {activeTab === 'saldos' && <>

      {/* Metrics Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wider">Total Deuda (Filtrada)</CardTitle>
            <DollarSign className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-red-600 dark:text-red-400">
              ${metrics.totalAdeudado.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-slate-500 mt-1">Suma de saldos pendientes en vista actual</p>
          </CardContent>
        </Card>
        
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wider">Clientes con Deuda</CardTitle>
            <ArrowDownCircle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">
              {metrics.countConDeuda}
            </div>
            <p className="text-xs text-slate-500 mt-1">Clientes que deben dinero</p>
          </CardContent>
        </Card>
        
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wider">Clientes Al Día</CardTitle>
            <ArrowUpCircle className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">
              {metrics.countAlDia}
            </div>
            <p className="text-xs text-slate-500 mt-1">Sin deuda o con saldo a favor</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter & Search Bar */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
        <CardContent className="p-4">
           <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
              <div className="relative w-full md:max-w-md">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                 <Input 
                   placeholder="Buscar cliente por nombre..." 
                   value={searchTerm}
                   onChange={(e) => setSearchTerm(e.target.value)}
                   className="pl-9 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700"
                 />
                 {searchTerm && (
                   <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                     <X className="h-4 w-4" />
                   </button>
                 )}
              </div>
              
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/50 p-1 rounded-lg border border-slate-200 dark:border-slate-700 w-full md:w-auto overflow-x-auto">
                 <Button 
                   variant="ghost" 
                   size="sm" 
                   onClick={() => setStatusFilter('Todos')}
                   className={`h-8 rounded-md px-3 text-xs font-medium ${statusFilter === 'Todos' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm border border-slate-200 dark:border-slate-600' : 'text-slate-500 hover:text-slate-700'}`}
                 >
                   Todos
                 </Button>
                 <Button 
                   variant="ghost" 
                   size="sm" 
                   onClick={() => setStatusFilter('Con Deuda')}
                   className={`h-8 rounded-md px-3 text-xs font-medium ${statusFilter === 'Con Deuda' ? 'bg-red-50 dark:bg-red-900/20 text-red-600 shadow-sm border border-red-100 dark:border-red-900/30' : 'text-slate-500 hover:text-red-500'}`}
                 >
                   Con Deuda
                 </Button>
                 <Button 
                   variant="ghost" 
                   size="sm" 
                   onClick={() => setStatusFilter('Al Día')}
                   className={`h-8 rounded-md px-3 text-xs font-medium ${statusFilter === 'Al Día' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 shadow-sm border border-emerald-100 dark:border-emerald-900/30' : 'text-slate-500 hover:text-emerald-500'}`}
                 >
                   Al Día
                 </Button>
              </div>
           </div>
        </CardContent>
      </Card>

      {/* Main Table */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
              <TableRow>
                <TableHead className="w-[300px] pl-6 font-semibold text-slate-600 dark:text-slate-300">Nombre Cliente</TableHead>
                <TableHead className="text-right font-semibold text-slate-600 dark:text-slate-300">Saldo Total</TableHead>
                <TableHead className="text-center font-semibold text-slate-600 dark:text-slate-300">Estado</TableHead>
                <TableHead className="text-center w-[150px] font-semibold text-slate-600 dark:text-slate-300">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6"><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-8 w-20 mx-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredClients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-40 text-center text-slate-500 bg-slate-50/30 dark:bg-slate-900/10">
                    <div className="flex flex-col items-center gap-2">
                       <Filter className="h-10 w-10 text-slate-300" />
                       <p className="font-medium">
                         {clients.length === 0 ? "Sin clientes registrados aún" : "No hay clientes que coincidan con los filtros"}
                       </p>
                       {(searchTerm || statusFilter !== 'Todos') && (
                         <Button variant="link" onClick={() => { setSearchTerm(''); setStatusFilter('Todos'); }} className="text-blue-500 h-auto p-0">
                           Limpiar filtros
                         </Button>
                       )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredClients.map((client) => {
                   const hasDebt = (client.saldo_actual || 0) > 0;
                   return (
                    <TableRow 
                      key={client.id}
                      className={`
                        group cursor-pointer transition-colors
                        ${hasDebt ? 'bg-red-50/30 hover:bg-red-50/60 dark:bg-red-900/5 dark:hover:bg-red-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}
                      `}
                      onClick={() => openDetailModal(client)}
                    >
                      <TableCell className="pl-6 font-medium text-slate-800 dark:text-slate-200">
                        {client.nombre}
                        {client.telefono && <div className="text-xs text-slate-400 font-normal mt-0.5 flex items-center gap-1"><span className="text-slate-300">|</span> {client.telefono}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-mono font-bold text-lg ${hasDebt ? 'text-red-600 dark:text-red-400' : (client.saldo_actual || 0) < 0 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400'}`}>
                           {(client.saldo_actual || 0) < 0 ? '-' : ''}${Math.abs(client.saldo_actual || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {getStatusBadge(client.saldo_actual)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                           <Button 
                             variant="ghost" 
                             size="sm" 
                             className="h-8 w-8 p-0 rounded-full text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                             onClick={() => openDetailModal(client)}
                             title="Ver Detalle"
                           >
                             <Eye className="h-4 w-4" />
                           </Button>
                           {hasDebt && (
                             <Button 
                               variant="ghost" 
                               size="sm" 
                               className={`h-8 w-8 p-0 rounded-full ${!isSessionOpen ? 'opacity-50 cursor-not-allowed text-slate-400' : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'}`}
                               onClick={(e) => isSessionOpen && openPaymentDialog(client, e)}
                               title={isSessionOpen ? "Registrar Cobro" : "Caja Cerrada"}
                               disabled={!isSessionOpen}
                             >
                               <Banknote className="h-4 w-4" />
                             </Button>
                           )}
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

      {/* DETAIL MODAL */}
      <ClientDetailModal 
         open={detailModalOpen}
         onOpenChange={setDetailModalOpen}
         clientId={selectedClient?.id}
         clientData={selectedClient}
         // When modal closes or updates happen inside it, we might want to refresh parent
         // The modal itself handles history fetching, but if payment happens inside modal, parent needs refresh.
         // We can pass a callback if needed, but for now modal is mostly read-only except strict tasks.
         // Task 4 asks to add payment inside modal. We'll handle that inside modal component.
         onUpdate={() => fetchData()} 
      />

      {/* QUICK PAYMENT DIALOG (From list view) */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
               <Banknote className="h-5 w-5" /> Registrar Cobro
            </DialogTitle>
            <DialogDescription>
              Registrar pago de <strong>{selectedClient?.nombre}</strong>.
            </DialogDescription>
          </DialogHeader>
          
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 mb-2">
             <div className="flex justify-between items-center text-sm mb-1">
                <span className="text-slate-500">Deuda Actual:</span>
                <span className="font-bold text-red-600">${selectedClient?.saldo_actual?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
             </div>
          </div>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="amount-list">Monto a Cobrar ($)</Label>
              <Input
                id="amount-list"
                type="number"
                min="0.01"
                step="0.01"
                value={paymentData.monto}
                onChange={(e) => setPaymentData({...paymentData, monto: e.target.value})}
                placeholder="0.00"
                className="font-mono text-lg"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
               <Label htmlFor="method-list">Método de Pago</Label>
               <select 
                 id="method-list"
                 className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                 value={paymentData.metodo}
                 onChange={(e) => setPaymentData({...paymentData, metodo: e.target.value})}
               >
                 <option value="Efectivo">Efectivo</option>
                 <option value="Transferencia">Transferencia</option>
                 <option value="Tarjeta">Tarjeta Débito/Crédito</option>
                 <option value="Cheque">Cheque</option>
                 <option value="Otro">Otro</option>
               </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="desc-list">Nota (Opcional)</Label>
              <Input
                id="desc-list"
                value={paymentData.nota}
                onChange={(e) => setPaymentData({...paymentData, nota: e.target.value})}
                placeholder="Ej: Pago parcial factura #123"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPaymentDialogOpen(false)} disabled={isProcessingPayment}>Cancelar</Button>
            <Button 
               onClick={handleRegisterPayment} 
               className="bg-emerald-600 hover:bg-emerald-700 text-white"
               disabled={isProcessingPayment || !paymentData.monto || parseFloat(paymentData.monto) <= 0}
            >
               {isProcessingPayment ? "Procesando..." : "Confirmar Cobro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </> /* fin activeTab === 'saldos' */}
    </div>
  );
}

export default CuentaCorrienteSection;