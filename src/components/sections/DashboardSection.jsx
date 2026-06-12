import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, TrendingDown, ShoppingCart, Package, AlertCircle, ArrowUpRight,
  DollarSign, Calendar, CreditCard, FileText, UserPlus,
  Wallet, BarChart3, RefreshCw, Archive, History, Percent,
  ClipboardList, ShoppingBag, CheckCircle2, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useCaja } from '@/contexts/CajaContext';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { dashboardService, DASHBOARD_KEYS } from '@/services/dashboardService';
import { useQueryClient } from '@tanstack/react-query';
import { ChecklistOnboarding } from '@/components/ChecklistOnboarding';

// ── Helpers ───────────────────────────────────────────────────────────────────
function saludoSegunHora() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

const fmt = (n) => (n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });

// ── Tooltip chart ─────────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-kx-surface border border-kx-border rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-kx-text-2 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">
          {p.name}: ${Number(p.value).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
        </p>
      ))}
    </div>
  );
};

// ── Skeleton de card ──────────────────────────────────────────────────────────
const Skeleton = ({ className = '' }) => (
  <div className={`bg-kx-surface-2 rounded animate-pulse ${className}`} />
);

// ── QuickActionButton ─────────────────────────────────────────────────────────
const QuickActionButton = ({ icon: Icon, label, onClick, gradient, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex flex-col items-center justify-center p-5 rounded-xl bg-gradient-to-br ${gradient} shadow-lg hover:shadow-xl transition-all duration-200 group relative overflow-hidden hover:-translate-y-0.5 active:scale-95 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
  >
    <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors duration-200" />
    <div className="p-2.5 rounded-full bg-white/20 mb-2.5 group-hover:bg-white/30 transition-all relative z-10">
      <Icon className="h-5 w-5 text-white" />
    </div>
    <span className="text-xs font-semibold text-white relative z-10">{label}</span>
  </button>
);

// ── DashboardSection ──────────────────────────────────────────────────────────
function DashboardSection({ onNavigate }) {
  const { user }    = useAuth();
  const { config }  = useConfig();
  const { currentSession, isSessionOpen, loading: cajaLoading } = useCaja();
  const { canAccessSection } = useUserPermissions();
  const qc          = useQueryClient();
  const empresaId   = user?.empresa_id;

  const firstName   = user?.user_metadata?.first_name || user?.email?.split('@')[0] || 'ahí';
  const empresaName = config?.nombre_empresa || user?.empresa_nombre || 'tu empresa';
  const fechaFormateada = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: kpis, isLoading: kpisLoading, error: kpisError, refetch: refetchKpis } = useQuery({
    queryKey: DASHBOARD_KEYS.kpis(empresaId),
    queryFn:  () => dashboardService.getKPIs(empresaId),
    enabled:  !!empresaId,
    staleTime: 1000 * 60,
  });

  const { data: ventasDia = [], isLoading: ventasLoading } = useQuery({
    queryKey: DASHBOARD_KEYS.ventasPorDia(empresaId, 7),
    queryFn:  () => dashboardService.getVentasPorDia(empresaId, 7),
    enabled:  !!empresaId,
  });

  const { data: flujoCaja = [], isLoading: flujoLoading } = useQuery({
    queryKey: DASHBOARD_KEYS.flujoCaja(empresaId, 6),
    queryFn:  () => dashboardService.getFlujoCajaMensual(empresaId, 6),
    enabled:  !!empresaId,
  });

  const { data: cotStats, isLoading: cotLoading } = useQuery({
    queryKey: DASHBOARD_KEYS.cotizaciones(empresaId),
    queryFn:  () => dashboardService.getCotizacionesStats(empresaId),
    enabled:  !!empresaId,
    staleTime: 1000 * 60,
  });

  const { data: alertasCC } = useQuery({
    queryKey: DASHBOARD_KEYS.alertasCC(empresaId),
    queryFn:  () => dashboardService.getAlertasCC(empresaId),
    enabled:  !!empresaId,
    staleTime: 1000 * 60 * 5,
  });

  const loading = kpisLoading;

  const handleRefresh = () => qc.invalidateQueries({ queryKey: ['dashboard', empresaId] });

  const variacion      = kpis?.variacionVentas ?? 0;
  const variacionLabel = `${variacion >= 0 ? '+' : ''}${variacion.toFixed(1)}% vs ayer`;
  const balanceNeto    = (kpis?.ventasMes ?? 0) - (kpis?.gastosMes ?? 0);

  if (kpisError && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-4">
        <AlertCircle className="h-16 w-16 text-kx-red" />
        <h3 className="text-xl font-semibold text-kx-text">Error al cargar el dashboard</h3>
        <p className="text-kx-text-2 text-sm">{kpisError.message}</p>
        <Button onClick={handleRefresh} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" /> Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">

      {/* ── Saludo ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold text-kx-text tracking-tight">
            {saludoSegunHora()}, {firstName}
          </div>
          <div className="text-[12.5px] text-kx-text-2 mt-1">
            Esto es lo que está pasando en <span className="text-kx-text font-medium">{empresaName}</span> hoy,&nbsp;{fechaFormateada}
          </div>
        </div>
        <Button
          onClick={handleRefresh}
          variant="outline"
          size="sm"
          disabled={loading}
          className="flex-shrink-0 border-kx-border text-kx-text-2 hover:bg-kx-surface-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      <ChecklistOnboarding onNavigate={onNavigate} />

      {/* ── Hero row — 3 cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden">
        {/* Ventas del mes */}
        <div className="bg-kx-surface p-5 min-h-[140px] flex flex-col">
          <div className="text-[11.5px] text-kx-text-2 mb-2.5 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> Ventas del mes
          </div>
          {loading ? (
            <><Skeleton className="h-9 w-40 mb-2" /><Skeleton className="h-4 w-28" /></>
          ) : (
            <>
              <div className="text-[34px] font-semibold text-kx-text tracking-tight leading-none mb-2 tabular-nums">
                ${fmt(kpis?.ventasMes)}
              </div>
              <div className={`text-xs flex items-center gap-1.5 ${variacion >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
                {variacion >= 0
                  ? <TrendingUp  className="w-3.5 h-3.5" />
                  : <TrendingDown className="w-3.5 h-3.5" />}
                {variacionLabel}
              </div>
            </>
          )}
        </div>

        {/* Caja */}
        <div className="bg-kx-surface p-5 min-h-[140px] flex flex-col">
          <div className="text-[11.5px] text-kx-text-2 mb-2.5 flex items-center gap-1.5">
            <Archive className="w-3.5 h-3.5" /> Caja
          </div>
          {cajaLoading ? (
            <><Skeleton className="h-7 w-24 mb-2" /><Skeleton className="h-4 w-36" /></>
          ) : (
            <>
              <div className={`text-[26px] font-semibold tracking-tight leading-none mb-2 ${isSessionOpen ? 'text-kx-green' : 'text-kx-text'}`}>
                {isSessionOpen ? 'Abierta' : 'Cerrada'}
              </div>
              <div className="text-xs text-kx-text-2">
                {isSessionOpen && currentSession
                  ? `Saldo inicial $${fmt(currentSession.monto_inicial)}`
                  : 'Abrí la caja para operar'}
              </div>
            </>
          )}
        </div>

        {/* Margen bruto */}
        <div className="bg-kx-surface p-5 min-h-[140px] flex flex-col">
          <div className="text-[11.5px] text-kx-text-2 mb-2.5 flex items-center gap-1.5">
            <Percent className="w-3.5 h-3.5" /> Margen bruto
          </div>
          {loading ? (
            <><Skeleton className="h-7 w-20 mb-2" /><Skeleton className="h-4 w-24" /></>
          ) : (
            <>
              <div className="text-[26px] font-semibold text-kx-text tracking-tight leading-none mb-2 tabular-nums">
                {(kpis?.margenBruto ?? 0).toFixed(1)}%
              </div>
              <div className={`text-xs flex items-center gap-1.5 ${(kpis?.margenBruto ?? 0) >= 30 ? 'text-kx-green' : 'text-kx-amber'}`}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                {(kpis?.margenBruto ?? 0) >= 30 ? 'Saludable' : 'Por debajo del 30%'}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── KPI row — 4 cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden">
        {/* Ventas del día */}
        <div className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between">
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Ventas del día</div>
          <div>
            {loading
              ? <Skeleton className="h-6 w-28 mb-1" />
              : <div className="text-xl font-semibold text-kx-text tracking-tight tabular-nums mb-1">${fmt(kpis?.ventasHoy)}</div>}
            <div className={`text-[11.5px] flex items-center gap-1 ${variacion >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
              {variacion >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {variacionLabel}
            </div>
          </div>
        </div>

        {/* Gastos del mes */}
        <div className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between">
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Gastos del mes</div>
          <div>
            {loading
              ? <Skeleton className="h-6 w-28 mb-1" />
              : <div className="text-xl font-semibold text-kx-text tracking-tight tabular-nums mb-1">${fmt(kpis?.gastosMes)}</div>}
            <div className="text-[11.5px] text-kx-text-3">Egresos acumulados</div>
          </div>
        </div>

        {/* Balance neto */}
        <div className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between">
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Balance neto</div>
          <div>
            {loading
              ? <Skeleton className="h-6 w-28 mb-1" />
              : <div className={`text-xl font-semibold tracking-tight tabular-nums mb-1 ${balanceNeto >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
                  ${fmt(balanceNeto)}
                </div>}
            <div className={`text-[11.5px] flex items-center gap-1 ${balanceNeto >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
              {balanceNeto >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {balanceNeto >= 0 ? 'Superávit' : 'Déficit'}
            </div>
          </div>
        </div>

        {/* Deuda clientes */}
        <div
          className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between cursor-pointer hover:bg-kx-surface-2 transition-colors"
          onClick={() => onNavigate?.('cuentacorriente')}
        >
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Deuda clientes</div>
          <div>
            {loading
              ? <Skeleton className="h-6 w-28 mb-1" />
              : <div className="text-xl font-semibold text-kx-text tracking-tight tabular-nums mb-1">${fmt(kpis?.deudaClientes)}</div>}
            <div className="text-[11.5px] text-kx-text-3 flex items-center gap-1">
              Cuentas corrientes <ArrowUpRight className="w-3 h-3" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
        {/* Panel izquierdo: Alertas de Stock */}
        <div className="bg-kx-surface border border-kx-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[13px] font-semibold text-kx-text flex items-center gap-2">
              <Package className="w-4 h-4 text-kx-amber" /> Alertas de Stock
            </span>
            <button
              onClick={() => onNavigate?.('productos')}
              className="text-xs text-kx-text-2 hover:text-kx-text transition-colors flex items-center gap-1"
            >
              Ver todos <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          {loading ? (
            <div className="space-y-2">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (kpis?.productosStockBajo?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center py-8 text-kx-text-3">
              <CheckCircle2 className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">Sin productos en stock bajo ✓</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {(kpis?.productosStockBajo ?? []).slice(0, 8).map(p => (
                <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg bg-kx-surface-2 hover:bg-kx-border transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-3.5 h-3.5 text-kx-amber flex-shrink-0" />
                    <span className="text-[12.5px] font-medium text-kx-text truncate">{p.nombre}</span>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <span className="text-sm font-bold text-kx-amber tabular-nums">{p.stock_actual}</span>
                    <span className="text-xs text-kx-text-3 ml-1">{p.unidad_medida}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Panel derecho: Actividad reciente */}
        <div className="bg-kx-surface border border-kx-border rounded-2xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[13px] font-semibold text-kx-text flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-kx-blue" /> Cotizaciones Aprobadas
            </span>
            <button
              onClick={() => onNavigate?.('cotizaciones')}
              className="text-xs text-kx-text-2 hover:text-kx-text transition-colors flex items-center gap-1"
            >
              Ver todas <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>

          <div className="flex-1">
            {cotLoading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (cotStats?.pendientes?.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center py-6 text-kx-text-3">
                <CheckCircle2 className="w-7 h-7 mb-2 opacity-40" />
                <p className="text-sm">Sin cotizaciones pendientes ✓</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {(cotStats?.pendientes ?? []).map(c => (
                  <div
                    key={c.id}
                    onClick={() => onNavigate?.('cotizaciones')}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-kx-surface-2 hover:bg-kx-border cursor-pointer transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-kx-text truncate">{c.numero}</p>
                      <p className="text-xs text-kx-text-3 truncate">{c.cliente ?? 'Sin cliente'}</p>
                    </div>
                    <span className="text-sm font-bold text-kx-blue flex-shrink-0 ml-2 tabular-nums">
                      ${Number(c.total).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Alerta CC vencida al pie */}
          {(alertasCC?.total ?? 0) > 0 && (
            <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl mt-4 bg-kx-amber/[0.06] border border-kx-amber/20">
              <AlertCircle className="w-4 h-4 text-kx-amber flex-shrink-0" />
              <div className="flex-1 text-[12.5px] text-kx-text min-w-0">
                {alertasCC.total} cliente{alertasCC.total !== 1 ? 's' : ''} con deuda vencida{' '}
                <span className="text-kx-text-2">(${alertasCC.montoTotal?.toLocaleString('es-AR', { minimumFractionDigits: 0 })})</span>
              </div>
              <button
                onClick={() => onNavigate?.('cuentacorriente')}
                className="text-xs text-kx-amber font-medium flex-shrink-0 hover:underline"
              >
                Revisar →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── KPIs Cotizaciones (preservado) ─────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden">
        <div
          className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between cursor-pointer hover:bg-kx-surface-2 transition-colors"
          onClick={() => onNavigate?.('cotizaciones')}
        >
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Cotizaciones / mes</div>
          <div>
            {cotLoading ? <Skeleton className="h-6 w-12 mb-1" /> : (
              <div className="text-xl font-semibold text-kx-text tracking-tight tabular-nums mb-1">{cotStats?.totalMes ?? 0}</div>
            )}
            <div className="text-[11.5px] text-kx-text-3">${(cotStats?.montoMes ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })} cotizado</div>
          </div>
        </div>
        <div className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between">
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Tasa de conversión</div>
          <div>
            {cotLoading ? <Skeleton className="h-6 w-16 mb-1" /> : (
              <div className={`text-xl font-semibold tracking-tight tabular-nums mb-1 ${(cotStats?.tasaConversion ?? 0) >= 50 ? 'text-kx-green' : 'text-kx-amber'}`}>
                {(cotStats?.tasaConversion ?? 0).toFixed(0)}%
              </div>
            )}
            <div className="text-[11.5px] text-kx-text-3">{cotStats?.convertidas ?? 0} convertidas</div>
          </div>
        </div>
        <div
          className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between cursor-pointer hover:bg-kx-surface-2 transition-colors"
          onClick={() => onNavigate?.('cotizaciones')}
        >
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Aprobadas pendientes</div>
          <div>
            {cotLoading ? <Skeleton className="h-6 w-10 mb-1" /> : (
              <div className={`text-xl font-semibold tracking-tight tabular-nums mb-1 ${(cotStats?.aprobadas ?? 0) > 0 ? 'text-kx-violet' : 'text-kx-text'}`}>
                {cotStats?.aprobadas ?? 0}
              </div>
            )}
            <div className="text-[11.5px] text-kx-text-3 flex items-center gap-1">
              {(cotStats?.aprobadas ?? 0) > 0 ? 'Listas para convertir' : 'Sin pendientes ✓'}
            </div>
          </div>
        </div>
        <div className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between">
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Monto convertido</div>
          <div>
            {cotLoading ? <Skeleton className="h-6 w-28 mb-1" /> : (
              <div className="text-xl font-semibold text-kx-text tracking-tight tabular-nums mb-1">
                ${(cotStats?.montoConvertido ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
              </div>
            )}
            <div className="text-[11.5px] text-kx-text-3">
              de ${(cotStats?.montoMes ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })} cotizado
            </div>
          </div>
        </div>
      </div>

      {/* ── Gráficos (preservados) ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-kx-surface border border-kx-border rounded-2xl p-5">
          <div className="text-[13px] font-semibold text-kx-text mb-4">Ventas — Últimos 7 días</div>
          <div className="h-[240px]">
            {ventasLoading ? (
              <div className="h-full flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-kx-blue border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ventasDia} barSize={24}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--kx-border)" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 11, fill: 'rgb(var(--kx-text-2))' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'rgb(var(--kx-text-2))' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="total" name="Ventas" fill="rgb(var(--kx-blue))" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-kx-surface border border-kx-border rounded-2xl p-5">
          <div className="text-[13px] font-semibold text-kx-text mb-4">Flujo de Caja — 6 meses</div>
          <div className="h-[240px]">
            {flujoLoading ? (
              <div className="h-full flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-kx-green border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={flujoCaja} barGap={2} barSize={14}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--kx-border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'rgb(var(--kx-text-2))' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'rgb(var(--kx-text-2))' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'rgb(var(--kx-text-2))' }} />
                  <Bar dataKey="ingresos" name="Ingresos" fill="rgb(var(--kx-green))" radius={[3,3,0,0]} />
                  <Bar dataKey="egresos"  name="Egresos"  fill="rgb(var(--kx-red))"   radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ── Acciones rápidas (preservadas) ─────────────────────────────────── */}
      <div className="bg-kx-surface border border-kx-border rounded-2xl p-5">
        <div className="text-[13px] font-semibold text-kx-text mb-4">Acciones Rápidas</div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <QuickActionButton icon={ShoppingCart} label="Nueva Venta"
            onClick={() => onNavigate?.('ventas')} gradient="from-blue-600 to-blue-500"
            disabled={!canAccessSection('ventas')} />
          <QuickActionButton icon={ClipboardList} label="Cotización"
            onClick={() => onNavigate?.('cotizaciones')} gradient="from-indigo-600 to-indigo-500"
            disabled={!canAccessSection('ventas')} />
          <QuickActionButton icon={ShoppingBag} label="Orden Compra"
            onClick={() => onNavigate?.('ordenes_compra')} gradient="from-violet-600 to-purple-500"
            disabled={!canAccessSection('compras')} />
          <QuickActionButton icon={Wallet} label="Caja"
            onClick={() => onNavigate?.('caja')} gradient="from-emerald-600 to-emerald-500"
            disabled={!canAccessSection('caja')} />
          <QuickActionButton icon={UserPlus} label="Cliente"
            onClick={() => onNavigate?.('clientes')} gradient="from-teal-600 to-teal-500"
            disabled={!canAccessSection('clientes')} />
          <QuickActionButton icon={FileText} label="Reportes"
            onClick={() => onNavigate?.('reportes')} gradient="from-amber-600 to-amber-500"
            disabled={!canAccessSection('reportes')} />
        </div>
      </div>

    </div>
  );
}

export default DashboardSection;
