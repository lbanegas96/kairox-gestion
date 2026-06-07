import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  TrendingUp, ShoppingCart, Landmark, Package, Settings,
  ShoppingBasket, ClipboardList, Contact, CreditCard,
  ArrowLeftRight, ShoppingBag, Truck, Wallet, BookOpen,
  FileText, Users, ArrowRight, AlertTriangle, ChevronRight,
  DollarSign, RefreshCw
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { getLaunchpadKPIs, PORTAL_KEYS } from '@/services/portalService';
import { dashboardAgingService, DASHBOARD_KEYS } from '@/services/dashboardService';
import OnboardingBanner from '@/components/sections/OnboardingBanner';

const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
const fmtShort = (n) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return fmt(n);
};

// ─── Tile de área ─────────────────────────────────────────────────────────────
function AreaTile({ area, kpi1, kpi2, modules, portalId, onNavigate, loading, accent, alert }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      whileHover={{ y: -3 }}
      onClick={() => onNavigate(portalId)}
      className="cursor-pointer group"
    >
      <Card className="h-full border-slate-200 dark:border-slate-700 dark:bg-slate-800 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
        {/* Barra de color superior */}
        <div className="h-1" style={{ background: accent }} />
        <CardContent className="p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: accent + '20' }}>
                <area.icon className="h-5 w-5" style={{ color: accent }} />
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white text-sm">{area.label}</p>
                {alert && <p className="text-[10px] text-amber-500 font-medium">⚠ {alert}</p>}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-colors" />
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {kpi1 && (
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-2.5">
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">{kpi1.label}</p>
                {loading ? (
                  <Skeleton className="h-5 w-16" />
                ) : (
                  <p className={`text-sm font-bold ${kpi1.color || 'text-slate-900 dark:text-white'}`}>{kpi1.value}</p>
                )}
              </div>
            )}
            {kpi2 && (
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-2.5">
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">{kpi2.label}</p>
                {loading ? (
                  <Skeleton className="h-5 w-16" />
                ) : (
                  <p className={`text-sm font-bold ${kpi2.color || 'text-slate-900 dark:text-white'}`}>{kpi2.value}</p>
                )}
              </div>
            )}
          </div>

          {/* Módulos (chips navegables) */}
          <div className="flex flex-wrap gap-1.5">
            {modules.map(mod => (
              <button
                key={mod.id}
                onClick={e => { e.stopPropagation(); onNavigate(mod.id); }}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-400 hover:text-slate-900 dark:hover:text-white transition-all"
              >
                <mod.icon className="h-3 w-3" />
                {mod.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── AdminTile (sin KPIs, solo módulos) ───────────────────────────────────────
function AdminTile({ onNavigate }) {
  const modules = [
    { id: 'reportes', label: 'Reportes', icon: FileText },
    { id: 'usuarios', label: 'Usuarios', icon: Users },
    { id: 'configuracion', label: 'Configuración', icon: Settings },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="border-slate-200 dark:border-slate-700 dark:bg-slate-800 shadow-sm overflow-hidden">
        <div className="h-1 bg-slate-400" />
        <CardContent className="p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
              <Settings className="h-5 w-5 text-slate-500" />
            </div>
            <p className="font-bold text-slate-900 dark:text-white text-sm">Administración</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {modules.map(mod => (
              <button
                key={mod.id}
                onClick={() => onNavigate(mod.id)}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-400 hover:text-slate-900 dark:hover:text-white transition-all"
              >
                <mod.icon className="h-3 w-3" />
                {mod.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Sección principal ─────────────────────────────────────────────────────────
export default function LaunchpadSection({ onNavigate }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: kpis, isLoading } = useQuery({
    queryKey: PORTAL_KEYS.launchpad(user?.empresa_id ?? ''),
    queryFn: () => getLaunchpadKPIs(user.empresa_id),
    enabled: !!user?.empresa_id,
    staleTime: 60_000,
  });

  const { data: aging } = useQuery({
    queryKey: DASHBOARD_KEYS.aging(user?.empresa_id ?? ''),
    queryFn: () => dashboardAgingService.getAgingResumen(user.empresa_id),
    enabled: !!user?.empresa_id,
    staleTime: 120_000,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['portal'] });
  };

  const deudaVencida = aging?.totals
    ? aging.totals.d60 + aging.totals.d90 + aging.totals.d90plus
    : 0;

  const tilesData = [
    {
      area: { label: 'Ventas', icon: TrendingUp },
      accent: '#3B82F6',
      portalId: 'portal_ventas',
      kpi1: { label: 'Ventas hoy', value: fmtShort(kpis?.ventas?.hoy), color: 'text-blue-600 dark:text-blue-400' },
      kpi2: { label: 'Pedidos pend.', value: String(kpis?.ventas?.pedidosPendientes ?? 0) },
      modules: [
        { id: 'ventas', label: 'POS', icon: ShoppingCart },
        { id: 'cotizaciones', label: 'Cotizaciones', icon: ClipboardList },
        { id: 'pedidos', label: 'Pedidos', icon: ShoppingBasket },
        { id: 'clientes', label: 'Clientes', icon: Contact },
        { id: 'cuentacorriente', label: 'Cta. Cte.', icon: CreditCard },
      ],
      alert: deudaVencida > 0 ? `${fmt(deudaVencida)} vencidos` : null,
    },
    {
      area: { label: 'Compras', icon: ShoppingBag },
      accent: '#8B5CF6',
      portalId: 'portal_compras',
      kpi1: { label: 'OC pendientes', value: String(kpis?.compras?.ocPendientes ?? 0), color: (kpis?.compras?.ocPendientes ?? 0) > 0 ? 'text-amber-500' : 'text-slate-900 dark:text-white' },
      kpi2: { label: 'Deuda prov.', value: fmtShort(kpis?.compras?.deudaProveedores), color: (kpis?.compras?.deudaProveedores ?? 0) > 0 ? 'text-red-500' : 'text-slate-900 dark:text-white' },
      modules: [
        { id: 'compras', label: 'Compras', icon: ArrowLeftRight },
        { id: 'ordenes_compra', label: 'Órdenes', icon: ShoppingBag },
        { id: 'proveedores', label: 'Proveedores', icon: Truck },
      ],
    },
    {
      area: { label: 'Finanzas', icon: Landmark },
      accent: '#10B981',
      portalId: 'portal_finanzas',
      kpi1: { label: 'Saldo bancario', value: fmtShort(kpis?.finanzas?.saldoBancario), color: 'text-emerald-600 dark:text-emerald-400' },
      kpi2: { label: 'CxC pendiente', value: fmtShort(kpis?.finanzas?.cxcTotal), color: (kpis?.finanzas?.cxcTotal ?? 0) > 0 ? 'text-amber-500' : 'text-slate-900 dark:text-white' },
      modules: [
        { id: 'caja', label: 'Caja', icon: Wallet },
        { id: 'bancos', label: 'Bancos', icon: Landmark },
        { id: 'plan_cuentas', label: 'Contabilidad', icon: BookOpen },
      ],
    },
    {
      area: { label: 'Inventario', icon: Package },
      accent: '#F59E0B',
      portalId: 'portal_inventario',
      kpi1: { label: 'Productos activos', value: String(kpis?.inventario?.totalProductos ?? 0) },
      kpi2: { label: 'Bajo mínimo', value: String(kpis?.inventario?.bajominimo ?? 0), color: (kpis?.inventario?.bajominimo ?? 0) > 0 ? 'text-red-500 font-bold' : 'text-slate-900 dark:text-white' },
      modules: [
        { id: 'productos', label: 'Inventario', icon: Package },
      ],
      alert: (kpis?.inventario?.bajominimo ?? 0) > 0 ? `${kpis?.inventario?.bajominimo} bajo mínimo` : null,
    },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Onboarding */}
      <OnboardingBanner onNavigate={onNavigate} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Bienvenido, <span className="text-[#00D4FF]">{user?.email?.split('@')[0]}</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Panel de control · {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2 dark:border-slate-600 dark:text-slate-300">
          <RefreshCw className="h-3.5 w-3.5" />
          Actualizar
        </Button>
      </div>

      {/* Alerta aging CC */}
      {deudaVencida > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
          onClick={() => onNavigate('cuentacorriente')}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Deuda vencida: {fmt(deudaVencida)}
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Hay clientes con facturas de más de 60 días sin cobrar — ir a Cuenta Corriente
              </p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        </motion.div>
      )}

      {/* Área tiles — grid 2-2-1 */}
      <div>
        <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
          Áreas de trabajo
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tilesData.map((tile) => (
            <AreaTile
              key={tile.portalId}
              {...tile}
              loading={isLoading}
              onNavigate={onNavigate}
            />
          ))}
          <AdminTile onNavigate={onNavigate} />
        </div>
      </div>

      {/* Accesos rápidos */}
      <div>
        <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
          Acceso rápido
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'ventas', label: 'Nueva Venta', icon: ShoppingCart, color: 'bg-blue-600 hover:bg-blue-700 text-white' },
            { id: 'cotizaciones', label: 'Nueva Cotización', icon: ClipboardList, color: 'bg-purple-600 hover:bg-purple-700 text-white' },
            { id: 'pedidos', label: 'Nuevo Pedido', icon: ShoppingBasket, color: 'bg-indigo-600 hover:bg-indigo-700 text-white' },
            { id: 'ordenes_compra', label: 'Nueva OC', icon: ShoppingBag, color: 'bg-violet-600 hover:bg-violet-700 text-white' },
            { id: 'caja', label: 'Abrir Caja', icon: Wallet, color: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
            { id: 'clientes', label: 'Nuevo Cliente', icon: Contact, color: 'bg-slate-700 hover:bg-slate-600 text-white' },
          ].map(btn => (
            <button
              key={btn.id}
              onClick={() => onNavigate(btn.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${btn.color}`}
            >
              <btn.icon className="h-4 w-4" />
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
