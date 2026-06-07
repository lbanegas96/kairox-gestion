import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Landmark, Wallet, BookOpen, ArrowLeft, DollarSign,
  TrendingUp, TrendingDown, CreditCard, ChevronRight,
  BarChart3, CheckCircle, XCircle
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { getFinanzasPortalKPIs, PORTAL_KEYS } from '@/services/portalService';

const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n || 0);

function KPICard({ label, value, icon: Icon, color, loading, sub, accent = '#10B981', badge }) {
  return (
    <Card className="dark:bg-slate-800 dark:border-slate-700 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
              {badge}
            </div>
            {loading ? <Skeleton className="h-7 w-24" /> : (
              <p className={`text-xl font-bold ${color || 'text-slate-900 dark:text-white'}`}>{value}</p>
            )}
            {sub && !loading && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg" style={{ background: accent + '20' }}>
            <Icon className="h-4 w-4" style={{ color: accent }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ModuleCard({ id, label, icon: Icon, description, onNavigate, accent }) {
  return (
    <motion.div whileHover={{ y: -2 }} onClick={() => onNavigate(id)} className="cursor-pointer">
      <Card className="dark:bg-slate-800 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-600 hover:shadow-md transition-all duration-200">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: accent + '20' }}>
            <Icon className="h-5 w-5" style={{ color: accent }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 dark:text-white text-sm">{label}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{description}</p>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function FinanzasPortal({ onNavigate }) {
  const { user } = useAuth();
  const { isSessionOpen } = useCaja();
  const accent = '#10B981';

  const { data: kpis, isLoading } = useQuery({
    queryKey: PORTAL_KEYS.finanzas(user?.empresa_id ?? ''),
    queryFn: () => getFinanzasPortalKPIs(user.empresa_id),
    enabled: !!user?.empresa_id,
    staleTime: 60_000,
  });

  const posicionNeta = kpis ? kpis.cxcTotal - kpis.cxpTotal : 0;

  const modules = [
    { id: 'caja', label: 'Caja', icon: Wallet, description: 'Apertura, cierre y movimientos de efectivo' },
    { id: 'bancos', label: 'Bancos', icon: Landmark, description: 'Cuentas bancarias y conciliación' },
    { id: 'cuentacorriente', label: 'Cuenta Corriente', icon: CreditCard, description: 'Saldos y cobros a clientes' },
    { id: 'plan_cuentas',     label: 'Contabilidad',     icon: BookOpen,     description: 'Plan de cuentas, asientos y balances' },
    { id: 'panel_ejecutivo',  label: 'Panel Ejecutivo',  icon: BarChart3,    description: 'KPIs, gráficos de ventas y flujo de caja' },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => onNavigate('dashboard')} className="gap-1 text-slate-500 hover:text-slate-900 dark:hover:text-white -ml-2">
          <ArrowLeft className="h-4 w-4" />
          Inicio
        </Button>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: accent + '20' }}>
            <Landmark className="h-3.5 w-3.5" style={{ color: accent }} />
          </div>
          <span className="font-semibold text-slate-900 dark:text-white">Finanzas</span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KPICard
          label="Caja"
          value={isSessionOpen ? 'Abierta' : 'Cerrada'}
          icon={Wallet}
          accent={accent}
          loading={isLoading}
          sub={isSessionOpen ? `Apertura: ${fmt(kpis?.saldoCajaApertura)}` : 'Sin sesión activa'}
          color={isSessionOpen ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}
          badge={
            <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${isSessionOpen ? 'text-emerald-600' : 'text-slate-400'}`}>
              {isSessionOpen ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            </span>
          }
        />
        <KPICard label="Saldo bancario" value={fmt(kpis?.saldoBancarioTotal)} icon={Landmark} accent={accent}
          color="text-emerald-600 dark:text-emerald-400" loading={isLoading}
          sub={kpis ? `${kpis.cuentasBancarias} cuenta${kpis.cuentasBancarias !== 1 ? 's' : ''}` : ''} />
        <KPICard label="Posición neta (CxC − CxP)" value={fmt(posicionNeta)} icon={BarChart3} accent={accent}
          color={posicionNeta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'} loading={isLoading}
          sub="Cuentas por cobrar menos cuentas por pagar" />
        <KPICard label="CxC — Clientes" value={fmt(kpis?.cxcTotal)} icon={TrendingUp} accent={accent}
          color={(kpis?.cxcTotal ?? 0) > 0 ? 'text-amber-500' : 'text-slate-900 dark:text-white'} loading={isLoading} />
        <KPICard label="CxP — Proveedores" value={fmt(kpis?.cxpTotal)} icon={TrendingDown} accent={accent}
          color={(kpis?.cxpTotal ?? 0) > 0 ? 'text-red-500' : 'text-slate-900 dark:text-white'} loading={isLoading} />
      </div>

      {/* Panel posición financiera (resumen visual) */}
      {!isLoading && kpis && (
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Posición Financiera</p>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-slate-500 mb-1">Cuentas por Cobrar</p>
                <p className="text-lg font-bold text-amber-500">{fmt(kpis.cxcTotal)}</p>
              </div>
              <div className="flex flex-col items-center justify-center">
                <span className="text-2xl text-slate-300">→</span>
                <p className={`text-sm font-bold mt-1 ${posicionNeta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  Neto: {fmt(posicionNeta)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Cuentas por Pagar</p>
                <p className="text-lg font-bold text-red-500">{fmt(kpis.cxpTotal)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Acciones */}
      <div className="flex gap-3 flex-wrap">
        <Button onClick={() => onNavigate('caja')} className="gap-2 text-white" style={{ background: accent }}>
          <Wallet className="h-4 w-4" />
          {isSessionOpen ? 'Ver Caja' : 'Abrir Caja'}
        </Button>
        <Button variant="outline" onClick={() => onNavigate('bancos')} className="gap-2 dark:border-slate-600">
          <Landmark className="h-4 w-4" />
          Bancos
        </Button>
        <Button variant="outline" onClick={() => onNavigate('plan_cuentas')} className="gap-2 dark:border-slate-600">
          <BookOpen className="h-4 w-4" />
          Contabilidad
        </Button>
      </div>

      {/* Módulos */}
      <div>
        <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">Módulos de Finanzas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {modules.map(m => <ModuleCard key={m.id} {...m} accent={accent} onNavigate={onNavigate} />)}
        </div>
      </div>
    </div>
  );
}
