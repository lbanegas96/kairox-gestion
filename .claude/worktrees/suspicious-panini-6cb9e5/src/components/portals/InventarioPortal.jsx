import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Package, ArrowLeft, AlertTriangle, ChevronRight,
  BarChart3, DollarSign, Tag, Archive
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getInventarioPortalKPIs, PORTAL_KEYS } from '@/services/portalService';

const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n || 0);

function KPICard({ label, value, icon: Icon, color, loading, sub, accent = '#F59E0B' }) {
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

export default function InventarioPortal({ onNavigate }) {
  const { user } = useAuth();
  const accent = '#F59E0B';

  const { data: kpis, isLoading } = useQuery({
    queryKey: PORTAL_KEYS.inventario(user?.empresa_id ?? ''),
    queryFn: () => getInventarioPortalKPIs(user.empresa_id),
    enabled: !!user?.empresa_id,
    staleTime: 60_000,
  });

  const hayAlertas = (kpis?.bajominimo ?? 0) > 0 || (kpis?.sinStock ?? 0) > 0;

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
            <Package className="h-3.5 w-3.5" style={{ color: accent }} />
          </div>
          <span className="font-semibold text-slate-900 dark:text-white">Inventario</span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KPICard label="Productos activos" value={String(kpis?.totalProductos ?? 0)} icon={Package} accent={accent} loading={isLoading} />
        <KPICard label="Bajo mínimo de stock" value={String(kpis?.bajominimo ?? 0)} icon={AlertTriangle} accent={accent}
          color={(kpis?.bajominimo ?? 0) > 0 ? 'text-amber-500' : 'text-slate-900 dark:text-white'} loading={isLoading} />
        <KPICard label="Sin stock" value={String(kpis?.sinStock ?? 0)} icon={Archive} accent={accent}
          color={(kpis?.sinStock ?? 0) > 0 ? 'text-red-500' : 'text-slate-900 dark:text-white'} loading={isLoading} />
        <KPICard label="Valor total (a costo)" value={fmt(kpis?.valorStockTotal)} icon={DollarSign} accent={accent}
          color="text-amber-600 dark:text-amber-400" loading={isLoading} />
        <KPICard label="Categorías" value={String(kpis?.categorias ?? 0)} icon={Tag} accent={accent} loading={isLoading} />
      </div>

      {/* Alertas */}
      {hayAlertas && !isLoading && (
        <div
          className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg cursor-pointer hover:bg-amber-100 transition-colors"
          onClick={() => onNavigate('productos')}
        >
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {(kpis?.bajominimo ?? 0) > 0 && <><strong>{kpis?.bajominimo}</strong> productos bajo el mínimo de stock</>}
            {(kpis?.bajominimo ?? 0) > 0 && (kpis?.sinStock ?? 0) > 0 && ' · '}
            {(kpis?.sinStock ?? 0) > 0 && <><strong>{kpis?.sinStock}</strong> productos sin stock</>}
          </p>
        </div>
      )}

      {/* Acciones */}
      <div className="flex gap-3 flex-wrap">
        <Button onClick={() => onNavigate('productos')} className="gap-2 text-white" style={{ background: accent }}>
          <Package className="h-4 w-4" />
          Ver Inventario
        </Button>
      </div>

      {/* Módulo */}
      <div>
        <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">Módulos de Inventario</h2>
        <motion.div whileHover={{ y: -2 }} onClick={() => onNavigate('productos')} className="cursor-pointer max-w-sm">
          <Card className="dark:bg-slate-800 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-600 hover:shadow-md transition-all duration-200">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: accent + '20' }}>
                <Package className="h-5 w-5" style={{ color: accent }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 dark:text-white text-sm">Inventario de Productos</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">CRUD, historial de movimientos, import CSV</p>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Info visual valor stock */}
      {!isLoading && kpis && kpis.totalProductos > 0 && (
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Salud del Stock</p>
            <div className="space-y-2">
              {/* Barra de estado */}
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>Distribución de estado de stock</span>
                <span>{kpis.totalProductos} productos totales</span>
              </div>
              <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden flex">
                {kpis.totalProductos > 0 && (() => {
                  const normal = kpis.totalProductos - kpis.bajominimo - kpis.sinStock;
                  const pNormal = (normal / kpis.totalProductos) * 100;
                  const pBajo = (kpis.bajominimo / kpis.totalProductos) * 100;
                  const pSin = (kpis.sinStock / kpis.totalProductos) * 100;
                  return (
                    <>
                      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pNormal}%` }} />
                      <div className="h-full bg-amber-400 transition-all" style={{ width: `${pBajo}%` }} />
                      <div className="h-full bg-red-500 transition-all" style={{ width: `${pSin}%` }} />
                    </>
                  );
                })()}
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Normal</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Bajo mínimo</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Sin stock</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
