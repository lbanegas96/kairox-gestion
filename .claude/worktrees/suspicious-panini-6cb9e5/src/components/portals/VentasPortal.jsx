import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  TrendingUp, ShoppingCart, ClipboardList, ShoppingBasket,
  Contact, CreditCard, ArrowLeft, DollarSign, Receipt,
  ChevronRight, Users, Clock
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getVentasPortalKPIs, PORTAL_KEYS } from '@/services/portalService';

const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n || 0);

function KPICard({ label, value, icon: Icon, color, loading, sub }) {
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
          <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20">
            <Icon className="h-4 w-4 text-blue-500" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ModuleCard({ id, label, icon: Icon, description, onNavigate, accent }) {
  return (
    <motion.div whileHover={{ y: -2 }} onClick={() => onNavigate(id)} className="cursor-pointer">
      <Card className="dark:bg-slate-800 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all duration-200">
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

export default function VentasPortal({ onNavigate }) {
  const { user } = useAuth();
  const accent = '#3B82F6';

  const { data: kpis, isLoading } = useQuery({
    queryKey: PORTAL_KEYS.ventas(user?.empresa_id ?? ''),
    queryFn: () => getVentasPortalKPIs(user.empresa_id),
    enabled: !!user?.empresa_id,
    staleTime: 60_000,
  });

  const modules = [
    { id: 'ventas', label: 'POS — Nueva Venta', icon: ShoppingCart, description: 'Registrar ventas en el punto de venta' },
    { id: 'cotizaciones', label: 'Cotizaciones', icon: ClipboardList, description: 'Presupuestos y propuestas comerciales' },
    { id: 'pedidos', label: 'Pedidos de Clientes', icon: ShoppingBasket, description: 'Órdenes de compra recibidas de clientes' },
    { id: 'clientes', label: 'Clientes', icon: Contact, description: 'Base de datos y ficha de clientes' },
    { id: 'cuentacorriente', label: 'Cuenta Corriente', icon: CreditCard, description: 'Saldos, cobros y antigüedad de deuda' },
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
            <TrendingUp className="h-3.5 w-3.5" style={{ color: accent }} />
          </div>
          <span className="font-semibold text-slate-900 dark:text-white">Ventas</span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KPICard label="Ventas hoy" value={fmt(kpis?.ventasHoy)} icon={DollarSign} color="text-blue-600 dark:text-blue-400" loading={isLoading} />
        <KPICard label="Ventas este mes" value={fmt(kpis?.ventasMes)} icon={TrendingUp} loading={isLoading} />
        <KPICard label="Ticket promedio" value={fmt(kpis?.ticketPromedio)} icon={Receipt} loading={isLoading} sub="por transacción hoy" />
        <KPICard label="CxC pendiente" value={fmt(kpis?.cxcPendiente)} icon={CreditCard}
          color={(kpis?.cxcPendiente ?? 0) > 0 ? 'text-amber-500' : 'text-slate-900 dark:text-white'} loading={isLoading} />
        <KPICard label="Cotizaciones activas" value={String(kpis?.cotizacionesActivas ?? 0)} icon={ClipboardList} loading={isLoading} />
        <KPICard label="Pedidos pendientes" value={String(kpis?.pedidosPendientes ?? 0)} icon={Clock}
          color={(kpis?.pedidosPendientes ?? 0) > 0 ? 'text-amber-500' : 'text-slate-900 dark:text-white'} loading={isLoading} />
      </div>

      {/* Acción principal */}
      <div className="flex gap-3">
        <Button onClick={() => onNavigate('ventas')} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
          <ShoppingCart className="h-4 w-4" />
          Nueva Venta
        </Button>
        <Button variant="outline" onClick={() => onNavigate('cotizaciones')} className="gap-2 dark:border-slate-600">
          <ClipboardList className="h-4 w-4" />
          Nueva Cotización
        </Button>
        <Button variant="outline" onClick={() => onNavigate('pedidos')} className="gap-2 dark:border-slate-600">
          <ShoppingBasket className="h-4 w-4" />
          Nuevo Pedido
        </Button>
      </div>

      {/* Módulos */}
      <div>
        <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">Módulos de Ventas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {modules.map(m => <ModuleCard key={m.id} {...m} accent={accent} onNavigate={onNavigate} />)}
        </div>
      </div>
    </div>
  );
}
