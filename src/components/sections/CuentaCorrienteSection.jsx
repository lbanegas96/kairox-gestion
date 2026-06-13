import React, { useState, useEffect, useMemo } from 'react';
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
  Clock,
  TrendingDown
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { getNowAR, formatDateAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import ClientDetailModal from './ClientDetailModal';

function CuentaCorrienteSection() {
  const { user } = useAuth();
  const { isSessionOpen, currentSession } = useCaja();
  const { toast } = useToast();
  const qc = useQueryClient();
  const tcParalelo = useTCParalelo();
  // Las notifs de deuda_vencida dependen de cuenta_corriente_movimientos:
  // tras cada cobro hay que invalidarlas o quedan stale hasta 30s.
  const invalidateNotifs = () => qc.invalidateQueries({ queryKey: ['notif'] });
  
  // Data State
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filters
  const [statusFilter, setStatusFilter] = useState('Todos'); // 'Todos', 'Con Deuda', 'Al Día'

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

  // Aging Report
  const [activeTab, setActiveTab] = useState('clientes');
  const [agingData, setAgingData] = useState([]);
  const [agingLoading, setAgingLoading] = useState(false);

  useEffect(() => {
    if (user && user.empresa_id) {
      fetchData();
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === 'antigüedad' && user?.empresa_id) {
      fetchAgingData();
    }
  }, [activeTab, user]);

  const fetchAgingData = async () => {
    setAgingLoading(true);
    try {
      // Open Item Management: cada comprobante pendiente es un ítem abierto con su propia fecha.
      // Esto evita que deudas viejas ya pagadas afecten la banda de antigüedad actual.
      const { data: comprobantes, error } = await supabase
        .from('comprobantes')
        .select('id, numero_venta, fecha, total, cliente_id, cliente_nombre')
        .eq('empresa_id', user.empresa_id)
        .eq('estado_pago', 'pendiente')
        .eq('tipo', 'venta')
        .not('cliente_id', 'is', null)
        .order('fecha', { ascending: true });

      if (error) throw error;
      if (!comprobantes?.length) { setAgingData([]); return; }

      const now = getNowAR();
      const result = comprobantes.map(comp => {
        const dias = Math.floor((now - new Date(comp.fecha)) / 86400000);
        let banda, color;
        if (dias <= 30)      { banda = '0–30 días';  color = 'green'; }
        else if (dias <= 60) { banda = '31–60 días'; color = 'yellow'; }
        else if (dias <= 90) { banda = '61–90 días'; color = 'orange'; }
        else                 { banda = '+90 días';   color = 'red'; }
        return {
          comprobante_id: comp.id,
          numero_venta:   comp.numero_venta,
          fecha:          comp.fecha,
          total:          Number(comp.total),
          cliente_id:     comp.cliente_id,
          cliente_nombre: comp.cliente_nombre,
          dias,
          banda,
          color,
        };
      });

      setAgingData(result.sort((a, b) => b.dias - a.dias));
    } catch (err) {
      console.error('Error aging:', err);
      toast({ title: 'Error', description: 'No se pudo calcular la antigüedad.', variant: 'destructive' });
    } finally {
      setAgingLoading(false);
    }
  };

  const agingBandas = useMemo(() => {
    const bandas = {
      '0–30 días':  { monto: 0, count: 0, color: 'green' },
      '31–60 días': { monto: 0, count: 0, color: 'yellow' },
      '61–90 días': { monto: 0, count: 0, color: 'orange' },
      '+90 días':   { monto: 0, count: 0, color: 'red' },
    };
    for (const comp of agingData) {
      if (bandas[comp.banda]) {
        bandas[comp.banda].monto += comp.total;
        bandas[comp.banda].count += 1;
      }
    }
    return bandas;
  }, [agingData]);

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
    // Solo Efectivo requiere caja abierta — Transferencia/Tarjeta/Cheque no
    if (paymentData.metodo === 'Efectivo' && !isSessionOpen) {
      toast({
        variant: 'destructive',
        title: 'Caja cerrada',
        description: 'Abrí la caja antes de registrar cobros en efectivo.',
      });
      return;
    }

    if (!selectedClient) return;

    const amount = parseNumberLocale(paymentData.monto);
    if (!amount || isNaN(amount) || amount <= 0) {
      toast({ title: "Error", description: "Ingrese un monto válido mayor a 0", variant: "destructive" });
      return;
    }

    setIsProcessingPayment(true);
    const date = getNowAR().toISOString();

    // Calcular monto en moneda paralela si la empresa lo usa
    const pagoParalelo = tcParalelo.enabled && tcParalelo.tcHoy
      ? tcParalelo.calcParalelo(amount, 'ARS', 1)
      : null;

    try {
      // 1. Movimiento en Cuenta Corriente (HABER reduce la deuda)
      const { error: movError } = await supabase.from('cuenta_corriente_movimientos').insert([{
        user_id: user.id,
        empresa_id: user.empresa_id,
        cliente_id: selectedClient.id,
        tipo: 'HABER',
        monto: amount,
        descripcion: paymentData.nota ? `Pago: ${paymentData.nota}` : 'Pago de deuda',
        fecha: date,
        ...(pagoParalelo !== null ? { monto_paralelo: pagoParalelo, tc_paralelo: tcParalelo.tcHoy } : {}),
      }]);

      if (movError) throw movError;

      // 2. Movimiento en Caja
      const { error: cashError } = await supabase.from('movimientos_caja').insert([{
        user_id: user.id,
        empresa_id: user.empresa_id,
        caja_sesion_id: currentSession?.id,
        fecha: date,
        tipo: 'ingreso',
        categoria: 'Cobro Cliente',
        concepto: `Cobro a ${selectedClient.nombre} - ${paymentData.metodo}`,
        monto: amount,
        metodo_pago: paymentData.metodo,
        is_automatic: true,
        ...(pagoParalelo !== null ? { monto_paralelo: pagoParalelo, tc_paralelo: tcParalelo.tcHoy } : {}),
      }]);

      if (cashError) throw cashError;
      
      toast({
        title: "Pago Registrado",
        description: `Se registró el cobro de $${amount.toLocaleString('es-AR')}.`,
        className: "bg-emerald-600 text-white border-none"
      });

      setIsPaymentDialogOpen(false);
      fetchData(); // Refresh list
      invalidateNotifs();
      
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

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-kx-text">Cuenta Corriente</h2>
          <p className="text-slate-500 dark:text-kx-text-2">Control de saldos y movimientos de clientes</p>
        </div>
        {!isSessionOpen && (
           <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-4 py-2 rounded-lg flex items-center gap-2 border border-red-200 dark:border-red-800 text-sm font-bold shadow-sm">
              <AlertTriangle className="h-4 w-4" /> CAJA CERRADA
           </div>
        )}
      </div>

      {/* Metrics Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wider">Total Deuda (Filtrada)</CardTitle>
            <DollarSign className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-red-600 dark:text-red-400">
              ${metrics.totalAdeudado.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </div>
            {tcParalelo.enabled && tcParalelo.tcHoy && metrics.totalAdeudado > 0 && (
              <p className="text-xs text-kx-text-3 mt-0.5">
                ≈ {(metrics.totalAdeudado / tcParalelo.tcHoy).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-1">Suma de saldos pendientes en vista actual</p>
          </CardContent>
        </Card>
        
        <Card className="bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wider">Clientes con Deuda</CardTitle>
            <ArrowDownCircle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-kx-text">
              {metrics.countConDeuda}
            </div>
            <p className="text-xs text-slate-500 mt-1">Clientes que deben dinero</p>
          </CardContent>
        </Card>
        
        <Card className="bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wider">Clientes Al Día</CardTitle>
            <ArrowUpCircle className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-kx-text">
              {metrics.countAlDia}
            </div>
            <p className="text-xs text-slate-500 mt-1">Sin deuda o con saldo a favor</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Tabs: Clientes / Antigüedad ──────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-transparent p-0 gap-2 mb-4 flex justify-start">
          <TabsTrigger value="clientes" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md px-4 py-2">
            <Users className="w-4 h-4 mr-2" /> Clientes
          </TabsTrigger>
          <TabsTrigger value="antigüedad" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md px-4 py-2">
            <Clock className="w-4 h-4 mr-2" /> Antigüedad de Deuda
          </TabsTrigger>
        </TabsList>

        <TabsContent value="clientes">
      {/* Filter & Search Bar */}
      <Card className="bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border shadow-sm">
        <CardContent className="p-4">
           <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
              <div className="relative w-full md:max-w-md">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3" />
                 <Input 
                   placeholder="Buscar cliente por nombre..." 
                   value={searchTerm}
                   onChange={(e) => setSearchTerm(e.target.value)}
                   className="pl-9 bg-kx-surface-2 dark:bg-slate-800/50 border-kx-border dark:border-kx-border"
                 />
                 {searchTerm && (
                   <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-kx-text-3 hover:text-kx-text-2">
                     <X className="h-4 w-4" />
                   </button>
                 )}
              </div>
              
              <div className="flex items-center gap-2 bg-kx-surface-2 dark:bg-slate-800/50 p-1 rounded-lg border border-kx-border dark:border-kx-border w-full md:w-auto overflow-x-auto">
                 <Button 
                   variant="ghost" 
                   size="sm" 
                   onClick={() => setStatusFilter('Todos')}
                   className={`h-8 rounded-md px-3 text-xs font-medium ${statusFilter === 'Todos' ? 'bg-kx-surface dark:bg-slate-700 text-blue-600 shadow-sm border border-kx-border dark:border-slate-600' : 'text-slate-500 hover:text-slate-700'}`}
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
      <Card className="bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-kx-surface-2 dark:bg-slate-800/50 border-b border-kx-border dark:border-kx-border">
              <TableRow>
                <TableHead className="w-[300px] pl-6 font-semibold text-kx-text-2 dark:text-slate-300">Nombre Cliente</TableHead>
                <TableHead className="text-right font-semibold text-kx-text-2 dark:text-slate-300">Saldo Total</TableHead>
                <TableHead className="text-center font-semibold text-kx-text-2 dark:text-slate-300">Estado</TableHead>
                <TableHead className="text-center w-[150px] font-semibold text-kx-text-2 dark:text-slate-300">Acciones</TableHead>
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
                        ${hasDebt ? 'bg-red-50/30 hover:bg-red-50/60 dark:bg-red-900/5 dark:hover:bg-red-900/10' : 'hover:bg-kx-surface-2 dark:hover:bg-slate-800/50'}
                      `}
                      onClick={() => openDetailModal(client)}
                    >
                      <TableCell className="pl-6 font-medium text-kx-text dark:text-kx-text">
                        {client.nombre}
                        {client.telefono && <div className="text-xs text-kx-text-3 font-normal mt-0.5 flex items-center gap-1"><span className="text-slate-300">|</span> {client.telefono}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className={`font-mono font-bold text-lg ${hasDebt ? 'text-red-600 dark:text-red-400' : (client.saldo_actual || 0) < 0 ? 'text-blue-600 dark:text-blue-400' : 'text-kx-text-2 dark:text-kx-text-2'}`}>
                          {(client.saldo_actual || 0) < 0 ? '-' : ''}${Math.abs(client.saldo_actual || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </div>
                        {tcParalelo.enabled && tcParalelo.tcHoy && hasDebt && (
                          <div className="text-xs text-kx-text-3 mt-0.5">
                            ≈ {(Number(client.saldo_actual) / tcParalelo.tcHoy).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}
                          </div>
                        )}
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
                               className="h-8 w-8 p-0 rounded-full text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                               onClick={(e) => openPaymentDialog(client, e)}
                               title="Registrar Cobro"
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

      </TabsContent>

        {/* ── TAB: ANTIGÜEDAD ─────────────────────────────────────────────────── */}
        <TabsContent value="antigüedad" className="space-y-5">
          {/* Resumen por bandas */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(agingBandas).map(([banda, info]) => {
              const colorMap = {
                green:  'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/10 dark:border-emerald-800/30 text-emerald-700 dark:text-emerald-400',
                yellow: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/10 dark:border-yellow-800/30 text-yellow-700 dark:text-yellow-400',
                orange: 'bg-orange-50 border-orange-200 dark:bg-orange-900/10 dark:border-orange-800/30 text-orange-700 dark:text-orange-400',
                red:    'bg-red-50 border-red-200 dark:bg-red-900/10 dark:border-red-800/30 text-red-700 dark:text-red-400',
              };
              return (
                <Card key={banda} className={`border ${colorMap[info.color]}`}>
                  <CardContent className="p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider mb-2">{banda}</div>
                    <div className="text-xl font-bold font-mono">${info.monto.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</div>
                    <div className="text-xs mt-1">{info.count} comprobante{info.count !== 1 ? 's' : ''}</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Tabla detallada */}
          <Card className="bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-kx-surface-2 dark:bg-slate-800/50 border-b border-kx-border dark:border-kx-border">
                  <tr>
                    <th className="text-left p-4 font-semibold text-kx-text-2 dark:text-slate-300">Comprobante</th>
                    <th className="text-left p-4 font-semibold text-kx-text-2 dark:text-slate-300">Cliente</th>
                    <th className="text-right p-4 font-semibold text-kx-text-2 dark:text-slate-300">Monto</th>
                    <th className="text-center p-4 font-semibold text-kx-text-2 dark:text-slate-300">Fecha</th>
                    <th className="text-center p-4 font-semibold text-kx-text-2 dark:text-slate-300">Antigüedad</th>
                    <th className="text-center p-4 font-semibold text-kx-text-2 dark:text-slate-300">Banda</th>
                    <th className="text-center p-4 font-semibold text-kx-text-2 dark:text-slate-300">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {agingLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i}>
                        <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-24" /></td>
                        <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-36" /></td>
                        <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-20 ml-auto" /></td>
                        <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-20 mx-auto" /></td>
                        <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-16 mx-auto" /></td>
                        <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-20 mx-auto" /></td>
                        <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-8 mx-auto" /></td>
                      </tr>
                    ))
                  ) : agingData.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-kx-text-3 dark:text-kx-text-3">
                        <TrendingDown className="w-10 h-10 mx-auto mb-2 opacity-30" />
                        <p>No hay comprobantes pendientes ✓</p>
                      </td>
                    </tr>
                  ) : (
                    agingData.map(comp => {
                      const bandaColors = {
                        green:  { badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', row: '' },
                        yellow: { badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', row: 'bg-yellow-50/30 dark:bg-yellow-900/5' },
                        orange: { badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', row: 'bg-orange-50/40 dark:bg-orange-900/5' },
                        red:    { badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', row: 'bg-red-50/40 dark:bg-red-900/5' },
                      };
                      const bColors = bandaColors[comp.color] || bandaColors.green;
                      return (
                        <tr key={comp.comprobante_id} className={`hover:bg-kx-surface-2 dark:hover:bg-slate-800/50 transition-colors ${bColors.row}`}>
                          <td className="p-4 font-mono text-sm font-bold text-slate-700 dark:text-slate-300">
                            #{comp.numero_venta}
                          </td>
                          <td className="p-4 font-medium text-kx-text dark:text-kx-text">
                            {comp.cliente_nombre}
                          </td>
                          <td className="p-4 text-right font-mono font-bold text-red-600 dark:text-red-400">
                            ${comp.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-4 text-center text-slate-500 dark:text-kx-text-2 text-sm">
                            {formatDateAR(comp.fecha)}
                          </td>
                          <td className="p-4 text-center font-mono text-kx-text-2 dark:text-kx-text-2">
                            {comp.dias} días
                          </td>
                          <td className="p-4 text-center">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${bColors.badge}`}>
                              {comp.banda}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 rounded-full text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                              onClick={() => {
                                setSelectedClient({ id: comp.cliente_id, nombre: comp.cliente_nombre });
                                setDetailModalOpen(true);
                                setActiveTab('clientes');
                              }}
                              title="Ver detalle del cliente"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

      </Tabs>

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
        <DialogContent className="sm:max-w-[425px] bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
               <Banknote className="h-5 w-5" /> Registrar Cobro
            </DialogTitle>
            <DialogDescription>
              Registrar pago de <strong>{selectedClient?.nombre}</strong>.
            </DialogDescription>
          </DialogHeader>
          
          <div className="p-4 bg-kx-surface-2 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-kx-border mb-2">
            <div className="flex justify-between items-center text-sm mb-1">
              <span className="text-slate-500">Deuda Actual:</span>
              <span className="font-bold text-red-600">${selectedClient?.saldo_actual?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
            </div>
            {tcParalelo.enabled && tcParalelo.tcHoy && Number(selectedClient?.saldo_actual) > 0 && (
              <div className="flex justify-between items-center text-xs text-kx-text-3">
                <span>Equivalente:</span>
                <span>≈ {(Number(selectedClient.saldo_actual) / tcParalelo.tcHoy).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}</span>
              </div>
            )}
          </div>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="amount-list">Monto a Cobrar ($)</Label>
              <Input
                id="amount-list"
                type="text"
                inputMode="decimal"
                value={paymentData.monto}
                onChange={(e) => setPaymentData({...paymentData, monto: e.target.value})}
                placeholder="0,00"
                className="font-mono text-lg"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
               <Label htmlFor="method-list">Método de Pago</Label>
               <select 
                 id="method-list"
                 className="flex h-10 w-full rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-bg px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
               disabled={isProcessingPayment || !paymentData.monto || !(parseNumberLocale(paymentData.monto) > 0)}
            >
               {isProcessingPayment ? "Procesando..." : "Confirmar Cobro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CuentaCorrienteSection;