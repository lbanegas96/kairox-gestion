import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useCaja } from '@/contexts/CajaContext';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { dashboardService, DASHBOARD_KEYS } from '@/services/dashboardService';
import { ChecklistOnboarding } from '@/components/ChecklistOnboarding';
import { saludoSegunHora, getDSOHealth } from '@/components/dashboard/shared';
import HeroRow from '@/components/dashboard/HeroRow';
import KpiGrids from '@/components/dashboard/KpiGrids';
import StockYCobranzas from '@/components/dashboard/StockYCobranzas';
import TopClientes from '@/components/dashboard/TopClientes';
import KpisCotizaciones from '@/components/dashboard/KpisCotizaciones';
import Graficos from '@/components/dashboard/Graficos';
import AccionesRapidas from '@/components/dashboard/AccionesRapidas';

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
  const dashboardOpts = {
    enabled:              !!empresaId,
    staleTime:            0,
    refetchOnMount:       'always',
    refetchOnWindowFocus: true,
    refetchInterval:      1000 * 30,
  };

  const { data: kpis, isLoading: kpisLoading, error: kpisError } = useQuery({
    queryKey: DASHBOARD_KEYS.kpis(empresaId),
    queryFn:  () => dashboardService.getKPIs(empresaId),
    ...dashboardOpts,
  });

  const { data: ventasDia = [], isLoading: ventasLoading } = useQuery({
    queryKey: DASHBOARD_KEYS.ventasPorDia(empresaId, 7),
    queryFn:  () => dashboardService.getVentasPorDia(empresaId, 7),
    ...dashboardOpts,
  });

  const { data: flujoCaja = [], isLoading: flujoLoading } = useQuery({
    queryKey: DASHBOARD_KEYS.flujoCaja(empresaId, 6),
    queryFn:  () => dashboardService.getFlujoCajaMensual(empresaId, 6),
    ...dashboardOpts,
  });

  const { data: cotStats, isLoading: cotLoading } = useQuery({
    queryKey: DASHBOARD_KEYS.cotizaciones(empresaId),
    queryFn:  () => dashboardService.getCotizacionesStats(empresaId),
    ...dashboardOpts,
  });

  const { data: alertasCC } = useQuery({
    queryKey: DASHBOARD_KEYS.alertasCC(empresaId),
    queryFn:  () => dashboardService.getAlertasCC(empresaId),
    ...dashboardOpts,
  });

  const { data: topClientes = [], isLoading: topLoading } = useQuery({
    queryKey: DASHBOARD_KEYS.topClientes(empresaId),
    queryFn:  () => dashboardService.getTopClientes(empresaId),
    ...dashboardOpts,
  });

  const loading = kpisLoading;

  const handleRefresh = () => qc.invalidateQueries({ queryKey: ['dashboard', empresaId] });

  const variacion      = kpis?.variacionVentas ?? 0;
  const variacionLabel = `${variacion >= 0 ? '+' : ''}${variacion.toFixed(1)}% vs ayer`;
  const variacionMes      = kpis?.variacionMes ?? 0;
  const variacionMesLabel = `${variacionMes >= 0 ? '+' : ''}${variacionMes.toFixed(1)}% vs mes anterior`;
  const balanceNeto    = (kpis?.ventasMes ?? 0) - (kpis?.gastosMes ?? 0);
  const dsoHealth      = getDSOHealth(kpis?.dso ?? null);

  // Aging buckets cobranzas
  const aging30 = (alertasCC?.vencidos30 ?? 0) - (alertasCC?.vencidos60 ?? 0);
  const aging60 = (alertasCC?.vencidos60 ?? 0) - (alertasCC?.vencidos90 ?? 0);
  const aging90 = alertasCC?.vencidos90 ?? 0;
  const maxTopTotal = topClientes[0]?.total ?? 1;

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

      <AccionesRapidas onNavigate={onNavigate} canAccessSection={canAccessSection} />

      <ChecklistOnboarding onNavigate={onNavigate} />

      <HeroRow
        loading={loading} kpis={kpis} variacion={variacionMes} variacionLabel={variacionMesLabel}
        cajaLoading={cajaLoading} isSessionOpen={isSessionOpen} currentSession={currentSession}
      />

      <KpiGrids
        loading={loading} kpis={kpis} variacion={variacion} variacionLabel={variacionLabel}
        balanceNeto={balanceNeto} dsoHealth={dsoHealth} onNavigate={onNavigate}
      />

      <StockYCobranzas
        loading={loading} kpis={kpis} onNavigate={onNavigate}
        alertasCC={alertasCC} aging30={aging30} aging60={aging60} aging90={aging90}
      />

      <TopClientes
        topLoading={topLoading} topClientes={topClientes} maxTopTotal={maxTopTotal} onNavigate={onNavigate}
      />

      <KpisCotizaciones cotLoading={cotLoading} cotStats={cotStats} onNavigate={onNavigate} />

      <Graficos
        ventasLoading={ventasLoading} ventasDia={ventasDia}
        flujoLoading={flujoLoading} flujoCaja={flujoCaja}
      />

    </div>
  );
}

export default DashboardSection;
