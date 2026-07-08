import { useState, useEffect, useMemo } from 'react';
import { Filter, Plus, Wallet } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from '@/components/ui/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogTitle, DialogDescription, DialogContent } from '@/components/ui/dialog';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { getNowAR, getTodayAR, getStartOfDayAR, getEndOfDayAR, getDateFromInputAR } from '@/lib/dateUtils';
import { asientosAutoService } from '@/services/planCuentasService';
import CajaCierre from '@/components/caja/CajaCierre';
import EstadoCajaHeader from '@/components/caja/EstadoCajaHeader';
import TabMovimientos from '@/components/caja/TabMovimientos';
import TabNuevoMovimiento from '@/components/caja/TabNuevoMovimiento';
import TabResumenHistorico from '@/components/caja/TabResumenHistorico';
import ModalAbrirCaja from '@/components/caja/ModalAbrirCaja';

function CajaSection() {
  const { user } = useAuth();
  const { currentSession, isSessionOpen, loading: sessionLoading, openSession } = useCaja();
  const { toast } = useToast();
  const tcParalelo = useTCParalelo();
  
  // State
  const [activeTab, setActiveTab] = useState("movimientos");
  const [loading, setLoading] = useState(false);
  const [movimientos, setMovimientos] = useState([]);
  const [_userProfile, setUserProfile] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Modal States
  const [isAperturaModalOpen, setIsAperturaModalOpen] = useState(false);
  const [saldoInicialInput, setSaldoInicialInput] = useState('');
  const [isCierreSessionModalOpen, setIsCierreSessionModalOpen] = useState(false);
  const [isProcessingSession, setIsProcessingSession] = useState(false);

  // Delete Dialog State
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);

  // Sorting State
  const [sortConfig, setSortConfig] = useState({ key: 'fecha', direction: 'desc' });

  // Financial Summary State
  const [summaryData, setSummaryData] = useState({
    ingresosPeriodo: 0,
    egresosPeriodo: 0,
    balancePeriodo: 0,
    ventasDia: 0,
    detailedMovements: []
  });

  // Filters for Movements Tab
  const [filters, setFilters] = useState({
    dateStart: '',
    dateEnd: '',
    type: 'Todos',
    search: ''
  });

  // Report Period State
  const [reportPeriod, setReportPeriod] = useState('thisMonth');
  const [customDateRange, setCustomDateRange] = useState({
    start: getTodayAR(), 
    end: getTodayAR()    
  });

  // New Movement Form State
  const [formData, setFormData] = useState({
    tipo: 'ingreso',
    monto: '',
    categoria: 'Cobro',
    concepto: '',
    fecha: getTodayAR(),
    metodo_pago: 'Efectivo'
  });

  useEffect(() => {
    if (user) {
      fetchUserProfile();
    }
  }, [user]);

  useEffect(() => {
    if (!user || !user.empresa_id || sessionLoading) return;
    if (activeTab === 'movimientos') {
      loadMovimientos();
    }
    loadFinancialSummary();
  }, [user, filters, activeTab, reportPeriod, customDateRange, currentSession, isSessionOpen, sessionLoading]);

  // Auto-close modals when session state changes successfully
  useEffect(() => {
    if (isSessionOpen && isAperturaModalOpen) {
      setIsAperturaModalOpen(false);
      setSaldoInicialInput('');
    }
    if (!isSessionOpen && isCierreSessionModalOpen) {
      setIsCierreSessionModalOpen(false);
    }
  }, [isSessionOpen]);

  const fetchUserProfile = async () => {
    if (!user?.id) return;
    const { data } = await supabase.from('profiles').select('first_name, last_name').eq('id', user.id).single();
    setUserProfile(data);
  };

  // --- Handlers using Context ---

  const handleOpenSession = async () => {
    const saldoInicial = parseNumberLocale(saldoInicialInput);
    if (!saldoInicialInput || isNaN(saldoInicial) || saldoInicial < 0) {
      toast({ title: "Error", description: "Ingrese un saldo inicial válido.", variant: "destructive" });
      return;
    }

    setIsProcessingSession(true);
    // Use Context method which handles caja_sesiones insert
    const success = await openSession(saldoInicialInput);
    setIsProcessingSession(false);
    
    if (success) {
      // Modal closing handled by useEffect on isSessionOpen change
      if (activeTab === 'movimientos') loadMovimientos();
    }
  };

  // Note: Closing is handled by CajaCierre component inside the modal

  const loadMovimientos = async () => {
    if (!user || !user.empresa_id) return;

    setLoading(true);
    try {
      let query = supabase
        .from('movimientos_caja')
        .select('*')
        .eq('empresa_id', user.empresa_id);

      // If session is open, prioritize session filtering
      if (isSessionOpen && currentSession?.id) {
        query = query.eq('caja_sesion_id', currentSession.id);
      } else {
        // Fallback to date filters if no session or if specifically looking at history
        if (filters.dateStart) query = query.gte('fecha', `${filters.dateStart}T00:00:00`);
        if (filters.dateEnd) query = query.lte('fecha', `${filters.dateEnd}T23:59:59`);
      }

      if (filters.type !== 'Todos') query = query.eq('tipo', filters.type.toLowerCase());
      if (filters.search) query = query.ilike('concepto', `%${filters.search}%`);

      const { data, error } = await query;

      if (error) throw error;
      setMovimientos(data || []);
    } catch (error) {
      console.error('Error loading movements:', error);
      toast({ title: "Error", description: "No se pudieron cargar los movimientos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const loadFinancialSummary = async () => {
     if (!user || !user.empresa_id) return;

     setLoading(true);
     try {
        const dates = getPeriodDates();

        const { data: currentData, error: currentError } = await supabase
            .from('movimientos_caja')
            .select('*')
            .eq('empresa_id', user.empresa_id)
            .gte('fecha', dates.start)
            .lte('fecha', dates.end)
            .order('fecha', { ascending: false });

        if(currentError) throw currentError;

        const ingresosPeriodo = currentData.filter(m => m.tipo === 'ingreso').reduce((sum, m) => sum + Number(m.monto), 0);
        const egresosPeriodo = currentData.filter(m => m.tipo === 'egreso').reduce((sum, m) => sum + Number(m.monto), 0);
        const balancePeriodo = ingresosPeriodo - egresosPeriodo;

        const nowAR = getNowAR();
        const todayStartISO = getStartOfDayAR(nowAR);
        const todayEndISO = getEndOfDayAR(nowAR);

        const { data: todaySalesData } = await supabase
           .from('movimientos_caja')
           .select('monto')
           .eq('empresa_id', user.empresa_id)
           .eq('tipo', 'ingreso')
           .eq('categoria', 'Venta')
           .gte('fecha', todayStartISO)
           .lte('fecha', todayEndISO);
           
        const ventasDiaTotal = todaySalesData ? todaySalesData.reduce((sum, m) => sum + Number(m.monto), 0) : 0;

        setSummaryData({
            ingresosPeriodo,
            egresosPeriodo,
            balancePeriodo,
            ventasDia: ventasDiaTotal,
            detailedMovements: currentData
        });
        
        setLastUpdate(new Date());

    } catch (error) {
        console.error("Error loading summary", error);
        toast({ title: "Error", description: "Error al actualizar el resumen financiero", variant: "destructive" });
    } finally {
        setLoading(false);
    }
  };

  const getPeriodDates = () => {
    const now = getNowAR();
    let start, end;

    switch (reportPeriod) {
      case 'today':
        start = getStartOfDayAR(now);
        end = getEndOfDayAR(now);
        break;
      case 'thisWeek':
        const day = now.getUTCDay() || 7; 
        const diff = now.getUTCDate() - day + 1;
        const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
        start = monday.toISOString();
        end = getEndOfDayAR(now);
        break;
      case 'thisMonth':
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
        end = getEndOfDayAR(now);
        break;
      case 'last30':
        const thirtyAgo = new Date(now.getTime() - 30 * 86400000);
        start = getStartOfDayAR(thirtyAgo);
        end = getEndOfDayAR(now);
        break;
      case 'custom':
        if (!customDateRange.start) return { start: getStartOfDayAR(now), end: getEndOfDayAR(now) };
        const cs = customDateRange.start.split('-').map(Number);
        const ce = customDateRange.end.split('-').map(Number);
        const dStart = new Date(Date.UTC(cs[0], cs[1]-1, cs[2], 0,0,0));
        const dEnd = new Date(Date.UTC(ce[0], ce[1]-1, ce[2], 23,59,59));
        start = dStart.toISOString();
        end = dEnd.toISOString();
        break;
      default:
        start = getStartOfDayAR(now);
        end = getEndOfDayAR(now);
    }
    // We only strictly need start/end for summary now
    return { start, end, prevStart: start, prevEnd: end }; 
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!user || !user.empresa_id) {
      toast({ title: "Error", description: "Usuario no identificado. Recargue la página.", variant: "destructive" });
      return;
    }

    const montoParsed = parseNumberLocale(formData.monto);
    if (!formData.monto || isNaN(montoParsed) || montoParsed <= 0) {
      toast({
        title: 'Monto inválido',
        description: 'Usá formato argentino: punto para miles y coma para decimales (ej: 500.000,00 o 500000,00).',
        variant: 'destructive',
      });
      return;
    }
    if (!formData.concepto) {
      toast({ title: "Concepto requerido", variant: "destructive" });
      return;
    }

    // Regla: solo movimientos de efectivo requieren caja abierta.
    const esEfectivo = (formData.metodo_pago || 'Efectivo') === 'Efectivo';
    if (!isSessionOpen && esEfectivo) {
      toast({
        title: 'Caja cerrada',
        description: 'Abrí la caja para registrar movimientos en efectivo. Otros métodos de pago no requieren caja abierta.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const montoNum = parseNumberLocale(formData.monto);

      // Moneda paralela: calcular equivalente si está habilitado y hay TC del día
      const montoParaleloValue = tcParalelo.enabled && tcParalelo.tcHoy
        ? tcParalelo.calcParalelo(montoNum, 'ARS', 1)
        : null;

      const { data: movInsertado, error } = await supabase.from('movimientos_caja').insert([{
        user_id: user.id,
        empresa_id: user.empresa_id,
        caja_sesion_id: isSessionOpen ? currentSession?.id : null,
        tipo: formData.tipo,
        categoria: formData.categoria,
        concepto: formData.concepto,
        monto: montoNum,
        fecha: getDateFromInputAR(formData.fecha),
        metodo_pago: formData.metodo_pago || 'Efectivo',
        is_automatic: false,
        ...(montoParaleloValue !== null ? {
          monto_paralelo: montoParaleloValue,
          tc_paralelo: tcParalelo.tcHoy,
        } : {}),
      }]).select('id').single();

      if (error) throw error;

      // Asiento contable automático — fire & forget (no bloquea el movimiento)
      // Mismo patrón que crearAsientoVenta en NuevaVentaModal. Si el plan de
      // cuentas no está seedeado sale silenciosamente; si el período está
      // cerrado, avisa por toast (no bloquea, pero ya no es un warn mudo).
      asientosAutoService.crearAsientoMovimientoCaja(
        user.empresa_id,
        user.id,
        {
          movimientoId: movInsertado.id,
          tipo:         formData.tipo,
          categoria:    formData.categoria,
          monto:        montoNum,
          fecha:        formData.fecha,
          descripcion:  `${formData.tipo === 'egreso' ? 'Egreso' : 'Ingreso'} de caja — ${formData.concepto}`,
        }
      ).catch(e => {
        if (e.message?.startsWith('Período cerrado:')) {
          toast({ title: 'Asiento contable no generado', description: e.message, variant: 'destructive' });
        } else {
          console.warn('[Contabilidad] Asiento mov. caja (no crítico):', e.message);
        }
      });

      toast({
        title: "Movimiento registrado", 
        description: isSessionOpen ? "Operación guardada en el turno actual." : "Operación guardada (sin turno).",
        className: "bg-green-600 text-white border-green-500"
      });

      setFormData({
        tipo: 'ingreso',
        monto: '',
        categoria: 'Cobro',
        concepto: '',
        fecha: getTodayAR(),
        metodo_pago: 'Efectivo'
      });
      
      if (activeTab === 'movimientos') loadMovimientos();
      if (activeTab === 'resumen') loadFinancialSummary();
      setActiveTab('movimientos');

    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleRequestDelete = (id) => {
    setItemToDelete(id);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!itemToDelete) return;
    if (!user || !user.empresa_id) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('movimientos_caja')
        .delete()
        .eq('id', itemToDelete)
        .eq('empresa_id', user.empresa_id);

      if (error) throw error;

      toast({ title: "Eliminado", description: "Movimiento eliminado." });
      setMovimientos(prev => prev.filter(m => m.id !== itemToDelete));
      if (activeTab === 'resumen') loadFinancialSummary();

    } catch (error) {
      console.error('Error deleting movement:', error);
      toast({ title: "Error", description: "No se pudo eliminar", variant: "destructive" });
    } finally {
      setLoading(false);
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    }
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedMovimientos = useMemo(() => {
    let sortableItems = [...movimientos];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        if (sortConfig.key === 'monto') {
          aValue = Number(aValue);
          bValue = Number(bValue);
        }
        if (sortConfig.key === 'fecha') {
           aValue = new Date(aValue);
           bValue = new Date(bValue);
        }

        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [movimientos, sortConfig]);

  const calculateTotals = () => {
    const ingresos = movimientos
      .filter(m => m.tipo === 'ingreso')
      .reduce((acc, m) => acc + Number(m.monto), 0);
    const egresos = movimientos
      .filter(m => m.tipo === 'egreso')
      .reduce((acc, m) => acc + Number(m.monto), 0);
    return { ingresos, egresos, balance: ingresos - egresos };
  };

  const totals = calculateTotals();

  const currentThemeColor = formData.tipo === 'ingreso' ? 'text-green-500 dark:text-green-400' : 'text-red-500 dark:text-red-400';
  const currentBorderColor = formData.tipo === 'ingreso' ? 'focus:ring-green-500' : 'focus:ring-red-500';

  if (sessionLoading) {
    return <div className="flex items-center justify-center h-96">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-slate-500">Verificando caja...</p>
      </div>
    </div>;
  }

  return (
    <div className="space-y-6">
      {/* HEADER with Session Info & Actions */}
      <EstadoCajaHeader
        isSessionOpen={isSessionOpen}
        currentSession={currentSession}
        totals={totals}
        tcParalelo={tcParalelo}
        onAbrirCaja={() => setIsAperturaModalOpen(true)}
        onCerrarCaja={() => setIsCierreSessionModalOpen(true)}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-transparent p-0 gap-2 mb-6 w-full flex justify-start">
          <TabsTrigger value="movimientos" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white rounded-md px-4 py-2"><Filter className="w-4 h-4 mr-2"/> Movimientos</TabsTrigger>
          <TabsTrigger value="nuevo" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white rounded-md px-4 py-2"><Plus className="w-4 h-4 mr-2"/> Nuevo Movimiento</TabsTrigger>
          <TabsTrigger value="resumen" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white rounded-md px-4 py-2"><Wallet className="w-4 h-4 mr-2"/> Reporte Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="movimientos" className="space-y-4">
          <TabMovimientos
            filters={filters} setFilters={setFilters}
            sortedMovimientos={sortedMovimientos}
            loading={loading}
            tcParalelo={tcParalelo}
            sortConfig={sortConfig}
            handleSort={handleSort}
            handleRequestDelete={handleRequestDelete}
          />
        </TabsContent>

        {/* --- TAB: NUEVO MOVIMIENTO --- */}
        <TabsContent value="nuevo" className="max-w-2xl mx-auto">
          <TabNuevoMovimiento
            formData={formData}
            handleInputChange={handleInputChange}
            handleSubmit={handleSubmit}
            loading={loading}
            currentThemeColor={currentThemeColor}
            currentBorderColor={currentBorderColor}
          />
        </TabsContent>

        {/* --- TAB: RESUMEN (Preserved - Historical View) --- */}
        <TabsContent value="resumen" className="space-y-6">
          <TabResumenHistorico
            reportPeriod={reportPeriod} setReportPeriod={setReportPeriod}
            customDateRange={customDateRange} setCustomDateRange={setCustomDateRange}
            lastUpdate={lastUpdate}
            summaryData={summaryData}
          />
        </TabsContent>
      </Tabs>

      {/* MODAL: Abrir Caja */}
      <ModalAbrirCaja
        open={isAperturaModalOpen} onOpenChange={setIsAperturaModalOpen}
        saldoInicialInput={saldoInicialInput} setSaldoInicialInput={setSaldoInicialInput}
        isProcessingSession={isProcessingSession}
        onConfirmar={handleOpenSession}
      />

      {/* MODAL: Cerrar Caja */}
      <Dialog open={isCierreSessionModalOpen} onOpenChange={setIsCierreSessionModalOpen}>
        <DialogContent className="sm:max-w-md kairox-bg-card kairox-text-primary p-6 dark:bg-kx-bg dark:border-kx-border">
           <DialogTitle className="sr-only">Arqueo y Cierre de Caja</DialogTitle>
           <DialogDescription className="sr-only">Registrá el monto final contado y las observaciones para cerrar el turno de caja.</DialogDescription>
           <CajaCierre onCancel={() => setIsCierreSessionModalOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* DELETE DIALOG */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="kairox-bg-card border kairox-border kairox-text-primary dark:bg-kx-bg dark:border-kx-border">
          <AlertDialogHeader><AlertDialogTitle className="dark:text-kx-text">¿Estás seguro?</AlertDialogTitle><AlertDialogDescription className="dark:text-kx-text-2">Esta acción es permanente.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="dark:text-kx-text dark:border-kx-border dark:hover:bg-slate-800">Cancelar</AlertDialogCancel><AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={handleConfirmDelete}>Eliminar</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default CajaSection;