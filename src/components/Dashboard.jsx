import React, { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
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
import CotizacionesSection from '@/components/sections/CotizacionesSection';
import OrdenesCompraSection from '@/components/sections/OrdenesCompraSection';
import PedidosSection from '@/components/sections/PedidosSection';
import ListasPrecioSection from '@/components/sections/ListasPrecioSection';
import PlanCuentasSection from '@/components/sections/PlanCuentasSection';
import CuentasBancariasSection from '@/components/sections/CuentasBancariasSection';
import ChequesSection from '@/components/sections/ChequesSection';
import ProveedoresSection from '@/components/sections/ProveedoresSection';
import { CommandPalette, useCommandPalette } from '@/components/CommandPalette';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { OnboardingWizard } from '@/components/OnboardingWizard';

function Dashboard({ user, onLogout }) {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();
  const [showOnboarding, setShowOnboarding] = useState(false);

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

  // Removed permission checks for rendering sections.
  // All sections are now accessible for viewing.
  // Specific actions within sections will be gated by permissions if needed.

  const renderSection = () => {
    switch (activeSection) {
      case 'dashboard':
        return <DashboardSection onNavigate={setActiveSection} />;
      case 'productos':
        return <ProductosSection />;
      case 'ventas':
        return <VentasSection />;
      case 'cotizaciones':
        return <CotizacionesSection />;
      case 'pedidos':
        return <PedidosSection />;
      case 'listas_precio':
        return <ListasPrecioSection />;
      case 'ordenes_compra':
        return <OrdenesCompraSection />;
      case 'compras':
        return <ComprasSection />;
      case 'caja':
        return <CajaSection />;
      case 'clientes':
        return <ClientesSection />;
      case 'cuentacorriente':
        return <CuentaCorrienteSection />;
      case 'reportes':
        return <ReportesSection />;
      case 'usuarios':
        return <UsuariosSection />;
      case 'configuracion':
        return <ConfiguracionSection />;
      case 'plan_cuentas':
        return <PlanCuentasSection />;
      case 'bancos':
        return <CuentasBancariasSection />;
      case 'cheques':
        return <ChequesSection />;
      case 'proveedores':
        return <ProveedoresSection />;
      default:
        return <DashboardSection onNavigate={setActiveSection} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex transition-colors duration-300">
      <Sidebar 
        activeSection={activeSection} 
        setActiveSection={setActiveSection}
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
      />
      
      <div className={`flex-1 transition-all duration-300 ${isSidebarOpen ? 'ml-64' : 'ml-0'}`}>
        <Header
          user={user}
          onLogout={onLogout}
          toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onNavigate={setActiveSection}
          onOpenSearch={() => setCmdOpen(true)}
        />

        <main className="p-6">
          <div key={activeSection} className="animate-in fade-in slide-in-from-bottom-4 duration-300">
            {renderSection()}
          </div>
        </main>
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