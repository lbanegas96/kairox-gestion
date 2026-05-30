import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ShoppingCart, Package, AlertCircle, ArrowUpRight, ArrowDownRight,
  DollarSign, TrendingUp, Calendar, CreditCard, FileText, UserPlus,
  Wallet, BarChart3, RefreshCw, Archive, History, Percent, ClipboardList, ShoppingBag
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useToast } from '@/components/ui/use-toast';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { dashboardService, DASHBOARD_KEYS } from '@/services/dashboardService';
import { useQueryClient } from '@tanstack/react-query';

// ─── MetricCard ───────────────────────────────────────────────────────────────
const MetricCard = React.memo(({ title, value, icon: Icon, trend, trendValue, gradient, loading, onClick, customContent }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
    whileHover={{ scale: 1.02, y: -2 }} onClick={onClick}
    className={`cursor-pointer ${onClick ? 'hover:shadow-xl' : ''}`}
  >
    <Card className={`border-slate-200 dark:border-slate-800 bg-gradient-to-br ${gradient} shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden relative`}>
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-bl-full" />
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
        <CardTitle className="text-sm font-semibold text-white/90">{title}</CardTitle>
        <div className="p-2.5 rounded-lg bg-white/20 backdrop-blur-sm">
          <Icon className="h-5 w-5 text-white" />
        </div>
      </CardHeader>
      <CardContent className="relative z-10">
        {loading ? (
          <div className="h-8 w-32 bg-white/20 rounded animate-pulse" />
        ) : (
          <>
            {customContent ?? (
              <>
                <div className="text-3xl font-bold text-white mb-1">{value}</div>
                {trendValue && (
                  <p className="text-xs text-white/80 flex items-center gap-1">
                    {trend === 'up' ? <ArrowUpRight className="h-3.5 w-3.5" /> : trend === 'down' ? <ArrowDownRight className="h-3.5 w-3.5" /> : null}
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

// ─── QuickActionButton ────────────────────────────────────────────────────────
const QuickActionButton = ({ icon: Icon, label, onClick, gradient, disabled }) => (
  <motion.button
    whileHover={!disabled ? { scale: 1.05, y: -3 } : {}} whileTap={!disabled ? { scale: 0.95 } : {}}
    onClick={onClick} disabled={disabled}
    className={`flex flex-col items-center justify-center p-6 rounded-xl bg-gradient-to-br ${gradient} shadow-lg hover:shadow-2xl transition-all duration-300 group relative overflow-hidden ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
  >
    <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors duration-300" />
    <div className="p-3 rounded-full bg-white/20 backdrop-blur-sm mb-3 group-hover:bg-white/30 transition-all relative z-10">
      <Icon className="h-6 w-6 text-white" />
    </div>
    <span className="text-sm font-semibold text-white relative z-10">{label}</span>
  </motion.button>
);

// ─── Tooltip personalizado para charts ────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-slate-400 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">
          {p.name}: ${Number(p.value).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
        </p>
      ))}
    </div>
  );
};

// ─── DashboardSection ─────────────────────────────────────────────────────────
function DashboardSection({ onNavigate }) {
  const { user } = useAuth();
  const { currentSession, isSessionOpen, loading: cajaLoading } = useCaja();
  const { canAccessSection } = useUserPermissions();
  const qc = useQueryClient();
  const empresaId = user?.empresa_id;

  // ── Queries con React Query ────────────────────────────────────────────────
  const { data: kpis, isLoading: kpisLoading, error: kpisError, refetch: refetchKpis } = useQuery({
    queryKey: DASHBOARD_KEYS.kpis(empresaId),
    queryFn: () => dashboardService.getKPIs(empresaId),
    enabled: !!empresaId,
    staleTime: 1000 * 60,   // 1 min — datos de negocio, refrescar seguido
  });

  const { data: ventasDia = [], isLoading: ventasLoading } = useQuery({
    queryKey: DASHBOARD_KEYS.ventasPorDia(empresaId, 7),
    queryFn: () => dashboardService.getVentasPorDia(empresaId, 7),
    enabled: !!empresaId,
  });

  const { data: flujoCaja = [], isLoading: flujoLoading } = useQuery({
    queryKey: DASHBOARD_KEYS.flujoCaja(empresaId, 6),
    queryFn: () => dashboardService.getFlujoCajaMensual(empresaId, 6),
    enabled: !!empresaId,
  });

  const loading = kpisLoading;

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ['dashboard', empresaId] });
  };

  // ── Variación de ventas (hoy vs ayer) ─────────────────────────────────────
  const variacion = kpis?.variacionVentas ?? 0;
  const variacionLabel = `${variacion >= 0 ? '+' : ''}${variacion.toFixed(1)}% vs ayer`;

  // ── Error state ────────────────────────────────────────────────────────────
  if (kpisError && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-4">
        <AlertCircle className="h-16 w-16 text-red-500" />
        <h3 className="text-xl font-semibold dark:text-slate-200">Error al cargar el dashboard</h3>
        <p className="text-slate-500 text-sm">{kpisError.message}</p>
        <Button onClick={handleRefresh} variant="outline"><RefreshCw className="h-4 w-4 mr-2" /> Reintentar</Button>
      </div>
    );
  }

  const fmt = (n) => (n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-transparent p-6 -mx-6 -mt-6 mb-6 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-blue-600 dark:text-[#00D4FF]" /> Dashboard
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Resumen ejecutivo</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleRefresh} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </Button>
          {canAccessSection('ventas') && (
            <Button onClick={() => onNavigate?.('ventas')} className="bg-blue-600 text-white">
              <ShoppingCart className="h-4 w-4 mr-2" /> Nueva Venta
            </Button>
          )}
        </div>
      </div>

      {/* ── Fila 1: KPIs principales (8 cards) ─────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Caja */}
        <MetricCard title="Caja" icon={Archive}
          gradient={isSessionOpen ? 'from-green-600 to-green-500' : 'from-slate-600 to-slate-500'}
          loading={cajaLoading} onClick={() => onNavigate?.('caja')}
          customContent={
            <div>
              <div className="text-3xl font-bold text-white mb-1">{isSessionOpen ? 'Abierta' : 'Cerrada'}</div>
              <p className="text-xs text-white/80 mt-1">
                {isSessionOpen && currentSession
                  ? `Saldo inicial: $${fmt(currentSession.monto_inicial)}`
                  : 'Abrí la caja para operar'}
              </p>
            </div>
          }
        />

        {/* Ventas hoy */}
        <MetricCard title="Ventas del Día" value={`$${fmt(kpis?.ventasHoy)}`} icon={Calendar}
          gradient="from-emerald-600 to-emerald-500"
          trend={variacion >= 0 ? 'up' : 'down'}
          trendValue={variacionLabel} loading={loading}
        />

        {/* Ventas mes */}
        <MetricCard title="Ventas del Mes" value={`$${fmt(kpis?.ventasMes)}`} icon={TrendingUp}
          gradient="from-blue-600 to-blue-500"
          trendValue="Acumulado mensual" loading={loading}
        />

        {/* Gastos mes — NUEVO */}
        <MetricCard title="Gastos del Mes" value={`$${fmt(kpis?.gastosMes)}`} icon={CreditCard}
          gradient="from-orange-600 to-orange-500"
          trendValue="Egresos acumulados" loading={loading}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Margen Bruto — NUEVO */}
        <MetricCard title="Margen Bruto" icon={Percent}
          gradient={(kpis?.margenBruto ?? 0) >= 30 ? 'from-violet-600 to-purple-500' : 'from-yellow-600 to-yellow-500'}
          loading={loading}
          customContent={
            <div>
              <div className="text-3xl font-bold text-white mb-1">
                {(kpis?.margenBruto ?? 0).toFixed(1)}%
              </div>
              <div className="w-full bg-white/20 rounded-full h-1.5 mt-2">
                <div className="bg-white/80 rounded-full h-1.5 transition-all"
                  style={{ width: `${Math.min(kpis?.margenBruto ?? 0, 100)}%` }} />
              </div>
              <p className="text-xs text-white/70 mt-1">
                {(kpis?.margenBruto ?? 0) >= 30 ? 'Saludable ✓' : 'Por debajo del 30%'}
              </p>
            </div>
          }
        />

        {/* Balance neto */}
        <MetricCard title="Balance Neto" icon={DollarSign}
          value={`$${fmt((kpis?.ventasMes ?? 0) - (kpis?.gastosMes ?? 0))}`}
          gradient={((kpis?.ventasMes ?? 0) - (kpis?.gastosMes ?? 0)) >= 0 ? 'from-teal-600 to-teal-500' : 'from-red-600 to-red-500'}
          trendValue={((kpis?.ventasMes ?? 0) - (kpis?.gastosMes ?? 0)) >= 0 ? 'Superávit' : 'Déficit'}
          loading={loading}
        />

        {/* Deuda clientes */}
        <MetricCard title="Deuda Clientes" value={`$${fmt(kpis?.deudaClientes)}`} icon={History}
          gradient="from-rose-600 to-pink-500"
          trendValue="Cuentas corrientes" loading={loading}
          onClick={() => onNavigate?.('cuentacorriente')}
        />

        {/* Stock bajo */}
        <MetricCard title="Stock Bajo" icon={Package}
          gradient={(kpis?.productosStockBajo?.length ?? 0) > 0 ? 'from-amber-600 to-amber-500' : 'from-slate-600 to-slate-500'}
          loading={loading}
          customContent={
            <div>
              <div className="text-3xl font-bold text-white mb-1">
                {kpis?.productosStockBajo?.length ?? 0} <span className="text-lg font-normal">productos</span>
              </div>
              <p className="text-xs text-white/80">{(kpis?.productosStockBajo?.length ?? 0) > 0 ? '⚠ Requieren reposición' : '✓ Sin alertas'}</p>
            </div>
          }
          onClick={() => onNavigate?.('productos')}
        />
      </div>

      {/* ── Fila 2: Gráficos ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ventas últimos 7 días */}
        <Card className="shadow-lg dark:bg-slate-950 dark:border-slate-800">
          <CardHeader>
            <CardTitle className="text-base dark:text-white">Ventas — Últimos 7 días</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] w-full">
              {ventasLoading ? (
                <div className="h-full flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ventasDia} barSize={28}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="fecha" stroke="#64748b" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="total" name="Ventas" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Flujo de caja 6 meses — NUEVO */}
        <Card className="shadow-lg dark:bg-slate-950 dark:border-slate-800">
          <CardHeader>
            <CardTitle className="text-base dark:text-white">Flujo de Caja — Últimos 6 meses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] w-full">
              {flujoLoading ? (
                <div className="h-full flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={flujoCaja} barGap={2} barSize={16}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="ingresos" name="Ingresos" fill="#10B981" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="egresos" name="Egresos" fill="#EF4444" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Fila 3: Alertas + Top productos ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stock bajo — detalle */}
        <Card className="dark:bg-slate-950 dark:border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base dark:text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-500" /> Alertas de Stock
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onNavigate?.('productos')}
              className="text-xs text-blue-500 dark:text-blue-400 h-7">
              Ver todos <ArrowUpRight className="w-3 h-3 ml-1" />
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />)}</div>
            ) : (kpis?.productosStockBajo?.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center py-6 text-slate-400 dark:text-slate-500">
                <Package className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">Sin productos en stock bajo ✓</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {(kpis?.productosStockBajo ?? []).slice(0, 8).map(p => (
                  <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                      <span className="text-sm font-medium dark:text-white truncate">{p.nombre}</span>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{p.stock_actual}</span>
                      <span className="text-xs text-slate-400 ml-1">{p.unidad_medida}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Acciones rápidas */}
        <Card className="dark:bg-slate-950 dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base dark:text-white">Acciones Rápidas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <QuickActionButton icon={ShoppingCart} label="Nueva Venta"
                onClick={() => onNavigate?.('ventas')} gradient="from-blue-600 to-blue-500"
                disabled={!canAccessSection('ventas')} />
              <QuickActionButton icon={ClipboardList} label="Cotización"
                onClick={() => onNavigate?.('cotizaciones')} gradient="from-indigo-600 to-indigo-500"
                disabled={!canAccessSection('ventas')} />
              <QuickActionButton icon={ShoppingBag} label="Orden de Compra"
                onClick={() => onNavigate?.('ordenes_compra')} gradient="from-violet-600 to-purple-500"
                disabled={!canAccessSection('compras')} />
              <QuickActionButton icon={Wallet} label="Movimiento Caja"
                onClick={() => onNavigate?.('caja')} gradient="from-emerald-600 to-emerald-500"
                disabled={!canAccessSection('caja')} />
              <QuickActionButton icon={UserPlus} label="Nuevo Cliente"
                onClick={() => onNavigate?.('clientes')} gradient="from-teal-600 to-teal-500"
                disabled={!canAccessSection('clientes')} />
              <QuickActionButton icon={FileText} label="Reportes"
                onClick={() => onNavigate?.('reportes')} gradient="from-amber-600 to-amber-500"
                disabled={!canAccessSection('reportes')} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default DashboardSection;
