import { useState, useEffect, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import SectionErrorBoundary from '@/components/SectionErrorBoundary';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
// DashboardSection queda con import estático: es la vista de aterrizaje al
// hacer login, lazy-cargarla agregaría un flash de spinner en el camino más
// común. Las demás 16 secciones se cargan bajo demanda (code-splitting).
// `lazyWithRetry` recarga la app si un chunk quedó viejo tras un deploy, en vez
// de tumbar la pantalla al import fallido.
import DashboardSection from '@/components/sections/DashboardSection';
const ProductosSection = lazyWithRetry(() => import('@/components/sections/ProductosSection'), 'productos');
const VentasSection = lazyWithRetry(() => import('@/components/sections/VentasSection'), 'ventas');
const ComprasSection = lazyWithRetry(() => import('@/components/sections/ComprasSection'), 'compras');
const CajaSection = lazyWithRetry(() => import('@/components/sections/CajaSection'), 'caja');
const ClientesSection = lazyWithRetry(() => import('@/components/sections/ClientesSection'), 'clientes');
const CuentaCorrienteSection = lazyWithRetry(() => import('@/components/sections/CuentaCorrienteSection'), 'cuentacorriente');
const ReportesSection = lazyWithRetry(() => import('@/components/sections/ReportesSection'), 'reportes');
const ConfiguracionSection = lazyWithRetry(() => import('@/components/sections/ConfiguracionSection'), 'configuracion');
const ListasPrecioSection = lazyWithRetry(() => import('@/components/sections/ListasPrecioSection'), 'listas_precio');
const OfertasSection = lazyWithRetry(() => import('@/components/sections/OfertasSection'), 'ofertas');
const PlanCuentasSection = lazyWithRetry(() => import('@/components/sections/PlanCuentasSection'), 'plan_cuentas');
const CuentasBancariasSection = lazyWithRetry(() => import('@/components/sections/CuentasBancariasSection'), 'bancos');
const ChequesSection = lazyWithRetry(() => import('@/components/sections/ChequesSection'), 'cheques');
const ImpuestosSection = lazyWithRetry(() => import('@/components/ImpuestosSection'), 'impuestos');
const ProveedoresSection = lazyWithRetry(() => import('@/components/sections/ProveedoresSection'), 'proveedores');
import { CommandPalette, useCommandPalette } from '@/components/CommandPalette';
import { supabase } from '@/lib/customSupabaseClient';
import { OnboardingWizard } from '@/components/OnboardingWizard';

const SectionFallback = () => (
  <div className="flex items-center justify-center py-24">
    <Loader2 className="w-8 h-8 text-kx-blue animate-spin" />
  </div>
);

function Dashboard({ user, onLogout, onEnterPOS }) {
  const [activeSection, setActiveSection]     = useState('dashboard');
  const [sectionParams, setSectionParams]     = useState({});
  const [isSidebarOpen, setIsSidebarOpen]     = useState(false);
  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();
  const [showOnboarding, setShowOnboarding]   = useState(false);

  const navigateTo = (section, params = {}) => {
    if (section === 'pos') { onEnterPOS?.(); return; }
    setActiveSection(section);
    setSectionParams(params);
  };

  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase
      .from('empresas')
      .select('onboarding_completado')
      .eq('id', user.empresa_id)
      .single()
      .then(({ data }) => {
        if (data && !data.onboarding_completado) setShowOnboarding(true);
      });
  }, [user?.empresa_id]);

  // Escape vuelve al Dashboard desde cualquier sección — generaliza el "Volver
  // al panel" que hoy solo tiene la POS (que es una pantalla aparte, fuera de
  // este switch). Se frena si: el CommandPalette está abierto (maneja su
  // propio Escape), hay un modal/dialog Radix abierto (que lo cierre él, no
  // saltar dos niveles a la vez), o el foco está en un campo de texto (no
  // interrumpir una carga de datos en curso).
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Escape' || activeSection === 'dashboard' || cmdOpen) return;
      const el = document.activeElement;
      const enCampoDeTexto = el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
      if (enCampoDeTexto) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      setActiveSection('dashboard');
      setSectionParams({});
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSection, cmdOpen]);

  const renderSection = () => {
    switch (activeSection) {
      case 'dashboard':     return <DashboardSection onNavigate={navigateTo} />;
      case 'productos':     return <ProductosSection />;
      case 'ventas':           return <VentasSection initialTab="historial" />;
      case 'cotizaciones':     return <VentasSection initialTab="cotizaciones" />;
      case 'pedidos':          return <VentasSection initialTab="pedidos" />;
      case 'entregas':         return <VentasSection initialTab="entregas" />;
      case 'historial_ventas': return <VentasSection initialTab="historial" />;
      case 'listas_precio': return <ListasPrecioSection />;
      case 'ofertas':       return <OfertasSection />;
      case 'compra_rapida':          return <ComprasSection initialTab="rapida" />;
      case 'ordenes_compra':         return <ComprasSection initialTab="ordenes" />;
      case 'recepciones_compra':     return <ComprasSection initialTab="recepciones" />;
      case 'facturas_compra':        return <ComprasSection initialTab="facturas" />;
      case 'devoluciones_proveedor': return <ComprasSection initialTab="devoluciones" />;
      case 'compras':                return <ComprasSection initialTab="rapida" />;
      case 'caja':          return <CajaSection />;
      case 'clientes':      return <ClientesSection />;
      case 'cuentacorriente':return <CuentaCorrienteSection />;
      case 'reportes':      return <ReportesSection initialView={sectionParams.initialView ?? null} onNavigate={navigateTo} />;
      case 'usuarios':      return <ConfiguracionSection initialTab="usuarios" />;
      case 'configuracion': return <ConfiguracionSection initialTab={sectionParams.initialTab} />;
      case 'plan_cuentas':  return <PlanCuentasSection />;
      case 'bancos':        return <CuentasBancariasSection />;
      case 'cheques':       return <ChequesSection />;
      case 'impuestos':     return <ImpuestosSection onNavigate={navigateTo} />;
      case 'proveedores':   return <ProveedoresSection />;
      default:              return <DashboardSection onNavigate={navigateTo} />;
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-kx-bg text-kx-text relative transition-colors duration-300">
      {/* Aurora fixed background — renderizado una sola vez */}
      <AuroraBackground />

      <div className="flex h-full relative z-10">
        <Sidebar
          activeSection={activeSection}
          setActiveSection={navigateTo}
          isOpen={isSidebarOpen}
          setIsOpen={setIsSidebarOpen}
        />

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <Header
            user={user}
            onLogout={onLogout}
            toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            onNavigate={navigateTo}
            onOpenSearch={() => setCmdOpen(true)}
            activeSection={activeSection}
          />

          <main className="flex-1 overflow-y-auto p-6">
            <div key={activeSection} className="animate-in fade-in slide-in-from-bottom-4 duration-300">
              <SectionErrorBoundary resetKey={activeSection}>
                <Suspense fallback={<SectionFallback />}>
                  {renderSection()}
                </Suspense>
              </SectionErrorBoundary>
            </div>
          </main>
        </div>
      </div>

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={(section) => { navigateTo(section); setCmdOpen(false); }}
      />

      <OnboardingWizard
        open={showOnboarding}
        onComplete={() => setShowOnboarding(false)}
      />
    </div>
  );
}

export default Dashboard;
