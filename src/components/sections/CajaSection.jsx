import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, TrendingDown, DollarSign, Calendar, 
  Search, Filter, Plus, ArrowUpRight, ArrowDownRight, 
  Wallet, AlertCircle, CheckCircle2, User, X, Bot,
  Coins, Receipt, Scale, ShoppingCart, ArrowUp, ArrowDown, Percent,
  PieChart, BarChart3, Download, RefreshCw, Clock, Trash2, ArrowUpDown, Lock,
  Unlock, Archive
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { getNowAR, getTodayAR, getStartOfDayAR, getEndOfDayAR, getDateFromInputAR, formatDateTimeAR, formatDateAR } from '@/lib/dateUtils';
import CajaCierre from '@/components/caja/CajaCierre';

function CajaSection() {
  const { user } = useAuth();
  const { currentSession, isSessionOpen, loading: sessionLoading, openSession, refreshSession } = useCaja();
  const { toast } = useToast();
  const tcParalelo = useTCParalelo();
  
  // State
  const [activeTab, setActiveTab] = useState("movimientos");
  const [loading, setLoading] = useState(false);
  const [movimientos, setMovimientos] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
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

  const categoriasIngreso = [
    { value: 'Venta', label: 'Venta (Automático)', disabled: true },
    { value: 'Cobro', label: 'Cobro' },
    { value: 'Inversión', label: 'Inversión' },
    { value: 'Otro Ingreso', label: 'Otro Ingreso' }
  ];

  const categoriasEgreso = [
    { value: 'Compra', label: 'Compra (Automático)', disabled: true },
    { value: 'Servicios', label: 'Servicios' },
    { value: 'Sueldos', label: 'Sueldos' },
    { value: 'Alquiler', label: 'Alquiler' },
    { value: 'Impuestos', label: 'Impuestos' },
    { value: 'Mantenimiento', label: 'Mantenimiento' },
    { value: 'Otro Egreso', label: 'Otro Egreso' }
  ];

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
    if (!saldoInicialInput || parseFloat(saldoInicialInput) < 0) {
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

  const getPeriodLabel = (p) => {
      switch(p) {
          case 'today': return 'Hoy';
          case 'thisWeek': return 'Esta Semana';
          case 'thisMonth': return 'Este Mes';
          case 'last30': return 'Últimos 30 Días';
          case 'custom': return 'Personalizado';
          default: return p;
      }
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

      const { error } = await supabase.from('movimientos_caja').insert([{
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
      }]);

      if (error) throw error;

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

  const formatAmount = (amount, type) => {
    const num = Number(amount);
    const formatted = num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (type === 'egreso') return `-$${formatted}`;
    return `$${formatted}`;
  };

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column) return <ArrowUpDown className="ml-2 h-4 w-4 text-kx-text-3" />;
    return sortConfig.direction === 'asc' 
      ? <ArrowUp className="ml-2 h-4 w-4 text-blue-600 dark:text-[#00D4FF]" /> 
      : <ArrowDown className="ml-2 h-4 w-4 text-blue-600 dark:text-[#00D4FF]" />;
  };

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
      <Card className={`border-kx-border dark:border-kx-border shadow-sm transition-all overflow-hidden ${isSessionOpen ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-orange-400'}`}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 py-4 px-6 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-4">
            <div className={`p-2 rounded-lg ${isSessionOpen ? 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400' : 'bg-orange-100 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400'}`}>
              <Archive className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
                {isSessionOpen ? "Caja Abierta" : "Caja Cerrada"}
                {isSessionOpen && (
                  <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" title="Estado: Activo" />
                )}
              </CardTitle>
              <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
                {isSessionOpen ? "Operaciones habilitadas" : "Inicia sesión para operar"}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {isSessionOpen && currentSession && (
              <div className="hidden md:flex flex-col items-end mr-2">
                <span className="text-xs text-slate-500 dark:text-kx-text-2 uppercase font-semibold">Saldo Inicial</span>
                <span className="text-lg font-bold font-mono text-kx-text dark:text-kx-text">
                  ${currentSession.monto_inicial?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-kx-text-3 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDateTimeAR(currentSession.apertura_fecha).split(' ')[1]} hs
                </span>
              </div>
            )}
            
            {!isSessionOpen ? (
              <Button 
                onClick={() => setIsAperturaModalOpen(true)} 
                className="bg-green-600 hover:bg-green-700 text-white shadow-md hover:shadow-lg transition-all dark:bg-green-700 dark:hover:bg-green-600"
              >
                <Unlock className="w-4 h-4 mr-2" /> Abrir Caja
              </Button>
            ) : (
              <Button 
                onClick={() => setIsCierreSessionModalOpen(true)} 
                variant="outline" 
                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/30 dark:hover:bg-red-900/20 dark:text-red-400 shadow-sm"
              >
                <Lock className="w-4 h-4 mr-2" /> Cerrar Caja
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* ── Indicadores de turno (BUG 2 FIX) ─────────────────────────────── */}
      {isSessionOpen && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Ingresos del turno */}
          <div className="kairox-bg-card border kairox-border rounded-xl p-5 dark:bg-kx-bg dark:border-kx-border flex items-center gap-4">
            <div className="p-3 rounded-lg bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 shrink-0">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-kx-text-2 uppercase font-semibold tracking-wider">INGRESOS DEL TURNO</div>
              <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                ${totals.ingresos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </div>
              {tcParalelo.enabled && tcParalelo.tcHoy && (
                <div className="text-xs text-kx-text-3 dark:text-kx-text-3 mt-0.5">
                  ≈ {(totals.ingresos / tcParalelo.tcHoy).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}
                </div>
              )}
              <div className="text-xs text-kx-text-3 mt-0.5">Desde apertura de caja</div>
            </div>
          </div>

          {/* Egresos del turno */}
          <div className="kairox-bg-card border kairox-border rounded-xl p-5 dark:bg-kx-bg dark:border-kx-border flex items-center gap-4">
            <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 shrink-0">
              <TrendingDown className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-kx-text-2 uppercase font-semibold tracking-wider">EGRESOS DEL TURNO</div>
              <div className="text-2xl font-bold font-mono text-red-600 dark:text-red-400">
                ${totals.egresos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-kx-text-3 mt-0.5">Desde apertura de caja</div>
            </div>
          </div>

          {/* Saldo líquido */}
          {(() => {
            const saldo = (currentSession?.monto_inicial || 0) + totals.ingresos - totals.egresos;
            return (
              <div className="kairox-bg-card border kairox-border rounded-xl p-5 dark:bg-kx-bg dark:border-kx-border flex items-center gap-4">
                <div className={`p-3 rounded-lg shrink-0 ${saldo >= 0 ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'bg-orange-100 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400'}`}>
                  <Scale className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-kx-text-2 uppercase font-semibold tracking-wider">SALDO LÍQUIDO DE CAJA</div>
                  <div className={`text-2xl font-bold font-mono ${saldo >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400'}`}>
                    ${saldo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-kx-text-3 mt-0.5">SI + Ingresos − Egresos</div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-transparent p-0 gap-2 mb-6 w-full flex justify-start">
          <TabsTrigger value="movimientos" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white rounded-md px-4 py-2"><Filter className="w-4 h-4 mr-2"/> Movimientos</TabsTrigger>
          <TabsTrigger value="nuevo" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white rounded-md px-4 py-2"><Plus className="w-4 h-4 mr-2"/> Nuevo Movimiento</TabsTrigger>
          <TabsTrigger value="resumen" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white rounded-md px-4 py-2"><Wallet className="w-4 h-4 mr-2"/> Reporte Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="movimientos" className="space-y-4">
          <div className="kairox-bg-card border kairox-border p-4 rounded-xl grid grid-cols-1 md:grid-cols-4 gap-4 items-end shadow-sm">
             <div className="space-y-2">
               <Label className="dark:text-kx-text">Desde</Label>
               <Input type="date" value={filters.dateStart} onChange={e => setFilters({...filters, dateStart: e.target.value})} className="kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/>
             </div>
             <div className="space-y-2">
               <Label className="dark:text-kx-text">Hasta</Label>
               <Input type="date" value={filters.dateEnd} onChange={e => setFilters({...filters, dateEnd: e.target.value})} className="kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/>
             </div>
             <div className="space-y-2">
               <Label className="dark:text-kx-text">Tipo</Label>
               <select className="w-full h-10 rounded-md kairox-input pl-3 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-[#00D4FF] dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" value={filters.type} onChange={e => setFilters({...filters, type: e.target.value})}>
                 <option value="Todos">Todos</option>
                 <option value="Ingreso">Ingresos</option>
                 <option value="Egreso">Egresos</option>
               </select>
             </div>
             <div className="space-y-2">
               <Label className="dark:text-kx-text">Buscar Concepto</Label>
               <div className="relative">
                 <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500"/>
                 <Input placeholder="Buscar..." value={filters.search} onChange={e => setFilters({...filters, search: e.target.value})} className="pl-9 kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/>
               </div>
             </div>
          </div>

          <div className="kairox-bg-card border kairox-border rounded-xl overflow-hidden shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="kairox-table-header text-xs uppercase tracking-wider border-b kairox-border dark:bg-slate-900/50 dark:text-slate-300">
                  <tr>
                    <th className="p-4 w-[15%] cursor-pointer hover:text-blue-600 transition-colors" onClick={() => handleSort('fecha')}>
                      <div className="flex items-center">Hora <SortIcon column="fecha" /></div>
                    </th>
                    <th className="p-4 w-[10%]">Tipo</th>
                    <th className="p-4 w-[15%]">Categoría</th>
                    <th className="p-4 w-[25%]">Concepto</th>
                    <th className="p-4 w-[10%]">Pago</th>
                    <th className="p-4 w-[15%] text-right cursor-pointer hover:text-blue-600 transition-colors" onClick={() => handleSort('monto')}>
                       <div className="flex items-center justify-end">Monto <SortIcon column="monto" /></div>
                    </th>
                    <th className="p-4 w-[5%] text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {loading ? (
                    <tr><td colSpan="7" className="p-8 text-center text-slate-500">Cargando movimientos...</td></tr>
                  ) : sortedMovimientos.length === 0 ? (
                    <tr><td colSpan="7" className="p-8 text-center text-slate-500">No se encontraron movimientos</td></tr>
                  ) : (
                    sortedMovimientos.map((m) => (
                      <tr key={m.id} className="kairox-table-row group h-[60px] hover:bg-kx-surface-2 dark:hover:bg-slate-800/50">
                        <td className="p-4 align-middle font-mono whitespace-nowrap">
                            <span className="font-bold kairox-text-primary dark:text-kx-text">
                              {formatDateTimeAR(m.fecha)}
                            </span>
                        </td>
                        <td className="p-4 align-middle">
                          {m.tipo === 'ingreso' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-green-500/10 text-green-600 border border-green-500/20 dark:bg-green-500/20 dark:text-green-400">INGRESO</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-red-500/10 text-red-600 border border-red-500/20 dark:bg-red-500/20 dark:text-red-400">EGRESO</span>
                          )}
                        </td>
                        <td className="p-4 align-middle font-medium kairox-text-primary text-xs dark:text-slate-300">{m.categoria}</td>
                        <td className="p-4 align-middle kairox-text-primary dark:text-kx-text">
                          <div className="flex items-center gap-2">
                            {m.is_automatic && (
                              <div title="Automático" className="p-0.5 bg-blue-500/10 rounded text-blue-500 shrink-0 dark:bg-blue-500/20 dark:text-blue-400"><Bot className="w-3 h-3" /></div>
                            )}
                            <span className="truncate max-w-[200px]" title={m.concepto}>{m.concepto}</span>
                          </div>
                        </td>
                        <td className="p-4 align-middle text-xs text-slate-500 dark:text-kx-text-2">{m.metodo_pago || '-'}</td>
                        <td className={`p-4 align-middle text-right font-bold font-mono ${m.tipo === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          <div>{formatAmount(m.monto, m.tipo)}</div>
                          {tcParalelo.enabled && m.monto_paralelo && (
                            <div className="text-xs font-normal text-kx-text-3 dark:text-kx-text-3">
                              ≈ {Number(m.monto_paralelo).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}
                            </div>
                          )}
                        </td>
                        <td className="p-4 align-middle text-center">
                           {!m.is_automatic && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-red-500 dark:hover:text-red-400 dark:hover:bg-red-900/20" onClick={() => handleRequestDelete(m.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                           )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* --- TAB: NUEVO MOVIMIENTO --- */}
        <TabsContent value="nuevo" className="max-w-2xl mx-auto">
          <div className={`kairox-bg-card border kairox-border rounded-xl p-6 shadow-xl transition-all duration-300 dark:bg-kx-bg dark:border-kx-border ${formData.tipo === 'ingreso' ? 'shadow-green-500/10' : 'shadow-red-500/10'}`}>
            <div className="flex items-center justify-between mb-6">
              <h3 className={`text-xl font-bold flex items-center gap-2 ${currentThemeColor}`}><Plus className="w-5 h-5" />Registrar {formData.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</h3>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="bg-slate-100 dark:bg-kx-surface p-1 rounded-lg border kairox-border flex gap-2">
                <label className={`flex-1 cursor-pointer rounded-md px-4 py-3 flex items-center justify-center gap-2 transition-all duration-200 ${formData.tipo === 'ingreso' ? 'bg-green-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-200 dark:text-kx-text-2 dark:hover:bg-slate-800'}`}>
                  <input type="radio" name="tipo" value="ingreso" checked={formData.tipo === 'ingreso'} onChange={handleInputChange} className="hidden"/>
                  <ArrowUpRight className="w-5 h-5" /><span className="font-bold">INGRESO</span>
                </label>
                <label className={`flex-1 cursor-pointer rounded-md px-4 py-3 flex items-center justify-center gap-2 transition-all duration-200 ${formData.tipo === 'egreso' ? 'bg-red-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-200 dark:text-kx-text-2 dark:hover:bg-slate-800'}`}>
                  <input type="radio" name="tipo" value="egreso" checked={formData.tipo === 'egreso'} onChange={handleInputChange} className="hidden"/>
                  <ArrowDownRight className="w-5 h-5" /><span className="font-bold">EGRESO</span>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className={currentThemeColor}>Monto ($)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-2.5 h-5 w-5 text-slate-500"/>
                    <Input type="text" inputMode="decimal" name="monto" value={formData.monto} onChange={handleInputChange} className={`pl-10 h-12 text-xl font-mono font-bold kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text ${currentBorderColor}`} placeholder="0,00" required/>
                  </div>
                </div>
                
                <div className="space-y-2">
                   <Label className="dark:text-kx-text">Método de Pago</Label>
                   <select name="metodo_pago" value={formData.metodo_pago} onChange={handleInputChange} className={`w-full h-12 rounded-md kairox-input px-3 text-sm focus:outline-none focus:ring-2 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text ${currentBorderColor}`}>
                      <option value="Efectivo">Efectivo</option>
                      <option value="Tarjeta Débito">Tarjeta Débito</option>
                      <option value="Tarjeta Crédito">Tarjeta Crédito</option>
                      <option value="Transferencia">Transferencia</option>
                      <option value="Cheque">Cheque</option>
                   </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="dark:text-kx-text">Categoría</Label>
                <select name="categoria" value={formData.categoria} onChange={handleInputChange} className={`w-full h-12 rounded-md kairox-input px-3 text-sm text-slate-700 dark:text-kx-text focus:outline-none focus:ring-2 dark:bg-kx-surface dark:border-kx-border ${currentBorderColor}`}>
                  {formData.tipo === 'ingreso' 
                    ? categoriasIngreso.map(cat => (<option key={cat.value} value={cat.value} disabled={cat.disabled} className={cat.disabled ? 'text-kx-text-3 italic' : ''}>{cat.label}</option>))
                    : categoriasEgreso.map(cat => (<option key={cat.value} value={cat.value} disabled={cat.disabled} className={cat.disabled ? 'text-kx-text-3 italic' : ''}>{cat.label}</option>))
                  }
                </select>
              </div>

              <div className="space-y-2">
                <Label className="dark:text-kx-text">Concepto / Descripción</Label>
                <Input name="concepto" value={formData.concepto} onChange={handleInputChange} className={`h-12 kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text ${currentBorderColor}`} required/>
              </div>

              <div className="pt-4">
                <Button type="submit" disabled={loading} className={`w-full h-14 text-lg font-bold shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] ${formData.tipo === 'ingreso' ? 'bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600' : 'bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600'}`}>
                  {loading ? 'Guardando...' : `REGISTRAR ${formData.tipo === 'ingreso' ? 'INGRESO' : 'EGRESO'}`}
                </Button>
              </div>
            </form>
          </div>
        </TabsContent>

        {/* --- TAB: RESUMEN (Preserved - Historical View) --- */}
        <TabsContent value="resumen" className="space-y-6">
           <div className="kairox-bg-card p-4 rounded-xl border kairox-border text-center mb-4 dark:bg-kx-bg dark:border-kx-border">
              <p className="text-sm text-slate-500 dark:text-kx-text-2">Este resumen muestra datos históricos globales.</p>
           </div>
           
           <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 kairox-bg-card p-4 rounded-xl border kairox-border dark:bg-kx-bg dark:border-kx-border">
             <div className="flex flex-col gap-2 w-full md:w-auto">
                <div className="flex flex-wrap gap-2">
                  {['today', 'thisWeek', 'thisMonth', 'last30', 'custom'].map((period) => (
                    <Button key={period} variant={reportPeriod === period ? "default" : "outline"} size="sm" onClick={() => setReportPeriod(period)} className={reportPeriod === period ? 'bg-blue-600 text-white' : 'dark:text-slate-300 dark:border-kx-border dark:hover:bg-slate-800'}>
                      {getPeriodLabel(period)}
                    </Button>
                  ))}
                </div>
                {reportPeriod === 'custom' && (
                  <div className="flex items-center gap-2 pt-2">
                     <div className="grid grid-cols-2 gap-2">
                       <Input type="date" value={customDateRange.start} onChange={e => setCustomDateRange(prev => ({...prev, start: e.target.value}))} className="h-8 kairox-input w-36 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/>
                       <Input type="date" value={customDateRange.end} onChange={e => setCustomDateRange(prev => ({...prev, end: e.target.value}))} className="h-8 kairox-input w-36 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/>
                     </div>
                  </div>
                )}
             </div>
             
             {lastUpdate && (<div className="text-xs text-slate-500 dark:text-kx-text-2 flex items-center gap-1"><Clock className="w-3 h-3"/> Act: {lastUpdate.toLocaleTimeString()}</div>)}
           </div>
 
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="kairox-bg-card border kairox-border p-5 rounded-xl dark:bg-kx-bg dark:border-kx-border">
                 <div className="text-sm text-slate-500 dark:text-kx-text-2 mb-1">Ingresos</div>
                 <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">${summaryData.ingresosPeriodo.toFixed(2)}</div>
              </div>
              <div className="kairox-bg-card border kairox-border p-5 rounded-xl dark:bg-kx-bg dark:border-kx-border">
                 <div className="text-sm text-slate-500 dark:text-kx-text-2 mb-1">Egresos</div>
                 <div className="text-2xl font-bold text-red-600 dark:text-red-400">${summaryData.egresosPeriodo.toFixed(2)}</div>
              </div>
              <div className="kairox-bg-card border kairox-border p-5 rounded-xl dark:bg-kx-bg dark:border-kx-border">
                 <div className="text-sm text-slate-500 dark:text-kx-text-2 mb-1">Balance</div>
                 <div className={`text-2xl font-bold ${summaryData.balancePeriodo >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>${summaryData.balancePeriodo.toFixed(2)}</div>
              </div>
            </div>

            {summaryData.detailedMovements.length === 0 ? (
               <div className="text-center p-10 text-slate-500 dark:text-kx-text-2">No hay datos históricos para el periodo seleccionado.</div>
            ) : (
               <div className="kairox-bg-card border kairox-border rounded-xl p-6 dark:bg-kx-bg dark:border-kx-border">
                 <h3 className="font-bold mb-4 dark:text-kx-text">Detalle Histórico</h3>
                 <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                       <thead><tr><th className="text-left p-2 dark:text-kx-text-2">Fecha</th><th className="text-left p-2 dark:text-kx-text-2">Concepto</th><th className="text-right p-2 dark:text-kx-text-2">Monto</th></tr></thead>
                       <tbody>
                          {summaryData.detailedMovements.map(m => (
                             <tr key={m.id} className="border-t border-slate-100 dark:border-kx-border">
                                <td className="p-2 dark:text-slate-300">{formatDateAR(m.fecha)}</td>
                                <td className="p-2 dark:text-slate-300">{m.concepto}</td>
                                <td className={`p-2 text-right ${m.tipo === 'ingreso' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatAmount(m.monto, m.tipo)}</td>
                             </tr>
                          ))}
                       </tbody>
                    </table>
                 </div>
               </div>
            )}
        </TabsContent>
      </Tabs>

      {/* MODAL: Abrir Caja */}
      <Dialog open={isAperturaModalOpen} onOpenChange={setIsAperturaModalOpen}>
        <DialogContent className="sm:max-w-md kairox-bg-card kairox-text-primary p-6 dark:bg-kx-bg dark:border-kx-border">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text">Abrir Caja</DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              Inicia una nueva sesión de caja. Ingresa el monto inicial en efectivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Saldo Inicial ($)</Label>
              <Input 
                type="number" 
                step="0.01" 
                min="0"
                placeholder="0.00" 
                value={saldoInicialInput}
                onChange={(e) => setSaldoInicialInput(e.target.value)}
                className="text-lg font-bold dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAperturaModalOpen(false)} className="dark:text-kx-text dark:border-kx-border dark:hover:bg-slate-800">Cancelar</Button>
            <Button onClick={handleOpenSession} disabled={isProcessingSession} className="bg-green-600 hover:bg-green-700 text-white">
              {isProcessingSession ? "Abriendo..." : "Confirmar Apertura"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: Cerrar Caja */}
      <Dialog open={isCierreSessionModalOpen} onOpenChange={setIsCierreSessionModalOpen}>
        <DialogContent className="sm:max-w-md kairox-bg-card kairox-text-primary p-6 dark:bg-kx-bg dark:border-kx-border">
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