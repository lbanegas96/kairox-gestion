import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ShoppingCart, Package, AlertCircle, ArrowUpRight, ArrowDownRight, DollarSign, TrendingUp, Calendar, CreditCard, FileText, UserPlus, Wallet, BarChart3, RefreshCw, Archive, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { getNowAR, getTodayAR, getStartOfDayAR, getEndOfDayAR } from '@/lib/dateUtils';
import { useUserPermissions } from '@/hooks/useUserPermissions';

// Enhanced Metric Card with animations
const MetricCard = React.memo(({ title, value, icon: Icon, trend, trendValue, gradient, loading, onClick, customContent }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3 }}
    whileHover={{ scale: 1.02, y: -2 }}
    onClick={onClick}
    className={`cursor-pointer ${onClick ? 'hover:shadow-xl' : ''}`}
  >
    <Card className={`border-slate-200 dark:border-slate-800 bg-gradient-to-br ${gradient} shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden relative`}>
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-bl-full" />
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
        <CardTitle className="text-sm font-semibold text-white/90">
          {title}
        </CardTitle>
        <div className="p-2.5 rounded-lg bg-white/20 backdrop-blur-sm">
          <Icon className="h-5 w-5 text-white" />
        </div>
      </CardHeader>
      <CardContent className="relative z-10">
        {loading ? (
          <div className="h-8 w-32 bg-white/20 rounded animate-pulse" />
        ) : (
          <>
            {customContent ? (
              customContent
            ) : (
              <>
                <div className="text-3xl font-bold text-white mb-1">{value}</div>
                {trendValue && (
                  <p className="text-xs text-white/80 flex items-center gap-1">
                    {trend === 'up' ? (
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    ) : trend === 'down' ? (
                      <ArrowDownRight className="h-3.5 w-3.5" />
                    ) : null}
                    <span className="font-medium">{trendValue}</span>
                  </p>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  </motion.div>
));

const QuickActionButton = ({ icon: Icon, label, onClick, gradient, disabled }) => (
  <motion.button
    whileHover={!disabled ? { scale: 1.05, y: -3 } : {}}
    whileTap={!disabled ? { scale: 0.95 } : {}}
    onClick={onClick}
    disabled={disabled}
    className={`flex flex-col items-center justify-center p-6 rounded-xl bg-gradient-to-br ${gradient} shadow-lg hover:shadow-2xl transition-all duration-300 group relative overflow-hidden ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
  >
    <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors duration-300" />
    <div className="p-3 rounded-full bg-white/20 backdrop-blur-sm mb-3 group-hover:bg-white/30 transition-all relative z-10">
      <Icon className="h-6 w-6 text-white" />
    </div>
    <span className="text-sm font-semibold text-white relative z-10">{label}</span>
  </motion.button>
);

function DashboardSection({ onNavigate }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { currentSession, isSessionOpen, loading: cajaLoading } = useCaja();
  const { canAccessSection } = useUserPermissions(); // Used to enable/disable quick actions
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [metrics, setMetrics] = useState({
    ventasHoy: 0,
    ventasAyer: 0,
    ventasMes: 0,
    egresosMes: 0,
    balanceNeto: 0,
    clientesDeuda: 0,
    productosStockBajo: 0
  });

  const [salesByDayData, setSalesByDayData] = useState([]);
  const [incomeVsExpensesData, setIncomeVsExpensesData] = useState([]);
  const [topProductsData, setTopProductsData] = useState([]);

  const fetchDashboardData = useCallback(async () => {
    // CRITICAL FIX: Guard clause for empresa_id
    if (!user || !user.empresa_id) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const now = getNowAR();
      const today = getTodayAR();
      const startOfToday = getStartOfDayAR(now);
      const endOfToday = getEndOfDayAR(now);
      
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const startOfYesterday = getStartOfDayAR(yesterday);
      const endOfYesterday = getEndOfDayAR(yesterday);

      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)).toISOString();
      const last7Days = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).toISOString();

      const [
        ventasHoyRes,
        ventasAyerRes,
        ventasMesRes,
        egresosMesRes,
        clientesRes,
        productosRes,
        salesLast7DaysRes,
        topProductsRes
      ] = await Promise.all([
        supabase
          .from('ventas')
          .select('total')
          .eq('empresa_id', user.empresa_id)
          .gte('fecha', startOfToday)
          .lte('fecha', endOfToday),

        supabase
          .from('movimientos_caja')
          .select('monto')
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'ingreso')
          .eq('categoria', 'Venta')
          .gte('fecha', startOfYesterday)
          .lte('fecha', endOfYesterday),
        
        supabase
          .from('ventas')
          .select('total')
          .eq('empresa_id', user.empresa_id)
          .gte('fecha', startOfMonth)
          .lte('fecha', endOfMonth),
        
        supabase
          .from('movimientos_caja')
          .select('monto')
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'egreso')
          .gte('fecha', startOfMonth)
          .lte('fecha', endOfMonth),
        
        supabase
          .from('clientes')
          .select('saldo_actual', { count: 'exact', head: true })
          .eq('empresa_id', user.empresa_id)
          .gt('saldo_actual', 0),
        
        supabase
          .from('productos')
          .select('stock_actual', { count: 'exact', head: true })
          .eq('empresa_id', user.empresa_id)
          .eq('activo', true)
          .lt('stock_actual', 10),
        
        supabase
          .from('ventas')
          .select('total, fecha')
          .eq('empresa_id', user.empresa_id)
          .gte('fecha', last7Days)
          .order('fecha', { ascending: true }),
        
        supabase
          .from('detalle_ventas')
          .select(`
            cantidad,
            productos!inner (id, nombre),
            ventas!inner (empresa_id)
          `)
          .eq('ventas.empresa_id', user.empresa_id)
          .gte('created_at', startOfMonth)
          .lte('created_at', endOfMonth)
      ]);

      const ventasHoy = ventasHoyRes.data?.reduce((sum, v) => sum + (v.total || 0), 0) || 0;
      const ventasAyer = ventasAyerRes.data?.reduce((sum, m) => sum + (Number(m.monto) || 0), 0) || 0;
      const ventasMes = ventasMesRes.data?.reduce((sum, v) => sum + (v.total || 0), 0) || 0;
      const egresosMes = egresosMesRes.data?.reduce((sum, e) => sum + (e.monto || 0), 0) || 0;
      const balanceNeto = ventasMes - egresosMes;
      const clientesDeuda = clientesRes.count || 0;
      const productosStockBajo = productosRes.count || 0;

      setMetrics({
        ventasHoy,
        ventasAyer,
        ventasMes,
        egresosMes,
        balanceNeto,
        clientesDeuda,
        productosStockBajo
      });

      const salesByDay = {};
      salesLast7DaysRes.data?.forEach(sale => {
        const dateObj = new Date(sale.fecha);
        const dateKey = `${String(dateObj.getUTCDate()).padStart(2, '0')}/${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}`;
        salesByDay[dateKey] = (salesByDay[dateKey] || 0) + sale.total;
      });
      
      const salesChartData = Object.keys(salesByDay).map(key => ({
        fecha: key,
        ventas: salesByDay[key]
      }));
      setSalesByDayData(salesChartData);

      setIncomeVsExpensesData([
        { name: 'Mes Actual', Ingresos: ventasMes, Egresos: egresosMes }
      ]);

      const productSales = {};
      topProductsRes.data?.forEach(item => {
        const productName = item.productos?.nombre || 'Desconocido';
        productSales[productName] = (productSales[productName] || 0) + item.cantidad;
      });
      
      const topProducts = Object.entries(productSales)
        .map(([name, cantidad]) => ({ name: name.substring(0, 20), cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad)
        .slice(0, 5);
      
      setTopProductsData(topProducts);

    } catch (err) {
      console.error('Dashboard fetch error:', err);
      setError(err.message);
      toast({ title: "Error", description: "Fallo al cargar dashboard", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const handleRetry = () => {
    fetchDashboardData();
  };

  if (error && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-4">
        <AlertCircle className="h-16 w-16 text-red-500" />
        <h3 className="text-xl font-semibold dark:text-slate-200">Error al cargar el dashboard</h3>
        <Button onClick={handleRetry} variant="outline"><RefreshCw className="h-4 w-4 mr-2" /> Reintentar</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-transparent p-6 -mx-6 -mt-6 mb-6 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-blue-600 dark:text-[#00D4FF]" /> Dashboard
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Resumen ejecutivo</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleRetry} variant="outline" size="sm" disabled={loading}><RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Actualizar</Button>
          
          {/* Create Sale button is protected by permission */}
          {canAccessSection('ventas') && (
            <Button onClick={() => onNavigate && onNavigate('ventas')} className="bg-blue-600 text-white"><ShoppingCart className="h-4 w-4 mr-2" /> Nueva Venta</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Caja" icon={Archive} gradient={isSessionOpen ? "from-green-600 to-green-500" : "from-slate-600 to-slate-500"} loading={cajaLoading} onClick={() => onNavigate && onNavigate('caja')} customContent={
            <div>
              <div className="text-3xl font-bold text-white mb-1">{isSessionOpen ? "Abierta" : "Cerrada"}</div>
              <p className="text-xs text-white/80 mt-1">{isSessionOpen && currentSession ? <span>Saldo inicial: ${currentSession.monto_inicial}</span> : <span>Abrí la caja para operar</span>}</p>
            </div>
          } />
        <MetricCard title="Ventas del Día" value={`$${metrics.ventasHoy.toLocaleString('es-AR')}`} icon={Calendar} gradient="from-emerald-600 to-emerald-500" trend="up" trendValue="Hoy" loading={loading} />
        <MetricCard title="Ventas de Ayer" value={`$${metrics.ventasAyer.toLocaleString('es-AR')}`} icon={History} gradient="from-indigo-600 to-indigo-500" trendValue="Día anterior" loading={loading} />
        <MetricCard title="Balance Neto" value={`$${metrics.balanceNeto.toLocaleString('es-AR')}`} icon={DollarSign} gradient={metrics.balanceNeto >= 0 ? "from-violet-600 to-purple-500" : "from-orange-600 to-orange-500"} trendValue={metrics.balanceNeto >= 0 ? "Positivo" : "Negativo"} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-lg dark:bg-slate-950 dark:border-slate-800"><CardHeader><CardTitle>Ventas por Día</CardTitle></CardHeader><CardContent><div className="h-[280px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={salesByDayData}><CartesianGrid strokeDasharray="3 3" stroke="#475569" /><XAxis dataKey="fecha" stroke="#94a3b8" /><YAxis stroke="#94a3b8" /><Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }} /><Line type="monotone" dataKey="ventas" stroke="#3B82F6" strokeWidth={3} /></LineChart></ResponsiveContainer></div></CardContent></Card>
        <Card className="shadow-lg dark:bg-slate-950 dark:border-slate-800"><CardHeader><CardTitle>Ingresos vs Egresos</CardTitle></CardHeader><CardContent><div className="h-[280px] w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={incomeVsExpensesData}><CartesianGrid strokeDasharray="3 3" stroke="#475569" /><XAxis dataKey="name" stroke="#94a3b8" /><YAxis stroke="#94a3b8" /><Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }} /><Legend /><Bar dataKey="Ingresos" fill="#10B981" /><Bar dataKey="Egresos" fill="#EF4444" /></BarChart></ResponsiveContainer></div></CardContent></Card>
      </div>

       <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickActionButton icon={ShoppingCart} label="Nueva Venta" onClick={() => onNavigate && onNavigate('ventas')} gradient="from-blue-600 to-blue-500" disabled={!canAccessSection('ventas')} />
          <QuickActionButton icon={UserPlus} label="Nuevo Cliente" onClick={() => onNavigate && onNavigate('clientes')} gradient="from-emerald-600 to-emerald-500" disabled={!canAccessSection('clientes')} />
          <QuickActionButton icon={Wallet} label="Movimiento Caja" onClick={() => onNavigate && onNavigate('caja')} gradient="from-violet-600 to-purple-500" disabled={!canAccessSection('caja')} />
          <QuickActionButton icon={FileText} label="Reportes" onClick={() => onNavigate && onNavigate('reportes')} gradient="from-amber-600 to-amber-500" disabled={!canAccessSection('reportes')} />
       </div>
    </div>
  );
}

export default DashboardSection;