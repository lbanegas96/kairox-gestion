import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ShoppingBag, ArrowLeftRight, Truck, ArrowLeft,
  DollarSign, AlertTriangle, ChevronRight, Clock, Package
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getComprasPortalKPIs, PORTAL_KEYS } from '@/services/portalService';

const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n || 0);

function KPICard({ label, value, icon: Icon, color, loading, sub, accent = '#8B5CF6' }) {
  return (
    <Card className="dark:bg-slate-800 dark:border-slate-700 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{label}</p>
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
      <Card className="dark:bg-slate-800 dark:border-slate-700 hover:border-purple-300 dark:hover:border-purple-600 hover:shadow-md transition-all duration-200">
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

export default function ComprasPortal({ onNavigate }) {
  const { user } = useAuth();
  const accent = '#8B5CF6';

  const { data: kpis, isLoading } = useQuery({
    queryKey: PORTAL_KEYS.compras(user?.empresa_id ?? ''),
    queryFn: () => getComprasPortalKPIs(user.empresa_id),
    enabled: !!user?.empresa_id,
    staleTime: 60_000,
  });

  const modules = [
    { id: 'compras', label: 'Compras Directas', icon: ArrowLeftRight, description: 'Registrar compras sin orden formal' },
    { id: 'ordenes_compra', label: 'Órdenes de Compra', icon: ShoppingBag, description: 'Workflow: borrador → aprobación → recepción' },
    { id: 'proveedores', label: 'Proveedores', icon: Truck, description: 'Ficha completa y cuenta corriente con proveedores' },
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
            <ShoppingBag className="h-3.5 w-3.5" style={{ color: accent }} />
          </div>
          <span className="font-semibold text-slate-900 dark:text-white">Compras</span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KPICard label="OC pendientes" value={String(kpis?.ocPendientes ?? 0)} icon={Clock} accent={accent}
          color={(kpis?.ocPendientes ?? 0) > 0 ? 'text-amber-500' : 'text-slate-900 dark:text-white'} loading={isLoading} />
        <KPICard label="Monto OC pendientes" value={fmt(kpis?.ocPendientesMonto)} icon={DollarSign} accent={accent} loading={isLoading} />
        <KPICard label="Compras este mes" value={fmt(kpis?.comprasMes)} icon={Package} accent={accent} loading={isLoading} />
        <KPICard label="Deuda a proveedores" value={fmt(kpis?.deudaProveedores)} icon={AlertTriangle} accent={accent}
          color={(kpis?.deudaProveedores ?? 0) > 0 ? 'text-red-500' : 'text-slate-900 dark:text-white'} loading={isLoading} />
        <KPICard label="Proveedores activos" value={String(kpis?.proveedoresActivos ?? 0)} icon={Truck} accent={accent} loading={isLoading} />
      </div>

      {/* Alerta OC pendientes */}
      {(kpis?.ocPendientes ?? 0) > 0 && !isLoading && (
        <div
          className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg cursor-pointer hover:bg-amber-100 transition-colors"
          onClick={() => onNavigate('ordenes_compra')}
        >
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Hay <strong>{kpis?.ocPendientes}</strong> órdenes de compra pendientes de procesar
          </p>
        </div>
      )}

      {/* Acciones */}
      <div className="flex gap-3 flex-wrap">
        <Button onClick={() => onNavigate('ordenes_compra')} className="gap-2" style={{ background: accent }}>
          <ShoppingBag className="h-4 w-4" />
          Nueva Orden de Compra
        </Button>
        <Button variant="outline" onClick={() => onNavigate('compras')} className="gap-2 dark:border-slate-600">
          <ArrowLeftRight className="h-4 w-4" />
          Compra directa
        </Button>
        <Button variant="outline" onClick={() => onNavigate('proveedores')} className="gap-2 dark:border-slate-600">
          <Truck className="h-4 w-4" />
          Ver Proveedores
        </Button>
      </div>

      {/* Módulos */}
      <div>
        <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">Módulos de Compras</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {modules.map(m => <ModuleCard key={m.id} {...m} accent={accent} onNavigate={onNavigate} />)}
        </div>
      </div>
    </div>
  );
}
