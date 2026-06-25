import React, { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import DashboardSection from '@/components/sections/DashboardSection';
import ProductosSection from '@/components/sections/ProductosSection';
import VentasSection from '@/components/sections/VentasSection';
import ComprasSection from '@/components/sections/ComprasSection';
import CajaSection from '@/components/sections/CajaSection';
import ClientesSection from '@/components/sections/ClientesSection';
import CuentaCorrienteSection from '@/components/sections/CuentaCorrienteSection';
import ReportesSection from '@/components/sections/ReportesSection';
import UsuariosSection from '@/components/sections/UsuariosSection';
import ConfiguracionSection from '@/components/sections/ConfiguracionSection';
import ListasPrecioSection from '@/components/sections/ListasPrecioSection';
import PlanCuentasSection from '@/components/sections/PlanCuentasSection';
import CuentasBancariasSection from '@/components/sections/CuentasBancariasSection';
import ChequesSection from '@/components/sections/ChequesSection';
import ImpuestosSection from '@/components/ImpuestosSection';
import ProveedoresSection from '@/components/sections/ProveedoresSection';
import { CommandPalette, useCommandPalette } from '@/components/CommandPalette';
import { supabase } from '@/lib/customSupabaseClient';
import { OnboardingWizard } from '@/components/OnboardingWizard';

function Dashboard({ user, onLogout, onEnterPOS }) {
  const [activeSection, setActiveSection]     = useState('dashboard');
  const [sectionParams, setSectionParams]     = useState({});
  const [isSidebarOpen, setIsSidebarOpen]     = useState(false);
  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();
  const [showOnboarding, setShowOnboarding]   = useState(false);

  const navigateTo = (section, params = {}) => {
    setActiveSection(section);
    setSectionParams(params);
  };

  const handleSidebarSelect = (section) => {
    if (section === 'pos') { onEnterPOS?.(); return; }
    setActiveSection(section);
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

  const renderSection = () => {
    switch (activeSection) {
      case 'dashboard':     return <DashboardSection onNavigate={setActiveSection} />;
      case 'productos':     return <ProductosSection />;
      case 'ventas':           return <VentasSection initialTab="historial" />;
      case 'cotizaciones':     return <VentasSection initialTab="cotizaciones" />;
      case 'pedidos':          return <VentasSection initialTab="pedidos" />;
      case 'entregas':         return <VentasSection initialTab="entregas" />;
      case 'historial_ventas': return <VentasSection initialTab="historial" />;
      case 'listas_precio': return <ListasPrecioSection />;
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
      default:              return <DashboardSection onNavigate={setActiveSection} />;
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-kx-bg text-kx-text relative transition-colors duration-300">
      {/* Aurora fixed background — renderizado una sola vez */}
      <AuroraBackground />

      <div className="flex h-full relative z-10">
        <Sidebar
          activeSection={activeSection}
          setActiveSection={handleSidebarSelect}
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
              {renderSection()}
            </div>
          </main>
        </div>
      </div>

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={(section) => { setActiveSection(section); setCmdOpen(false); }}
      />

      <OnboardingWizard
        open={showOnboarding}
        onComplete={() => setShowOnboarding(false)}
      />
    </div>
  );
}

export default Dashboard;
