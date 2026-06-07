import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';

// Secciones principales
import LaunchpadSection from '@/components/sections/LaunchpadSection';
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
import PedidosSection from '@/components/sections/PedidosSection';
import OrdenesCompraSection from '@/components/sections/OrdenesCompraSection';
import PlanCuentasSection from '@/components/sections/PlanCuentasSection';
import CuentasBancariasSection from '@/components/sections/CuentasBancariasSection';
import ProveedoresSection from '@/components/sections/ProveedoresSection';

// Portales de área
import VentasPortal from '@/components/portals/VentasPortal';
import ComprasPortal from '@/components/portals/ComprasPortal';
import FinanzasPortal from '@/components/portals/FinanzasPortal';
import InventarioPortal from '@/components/portals/InventarioPortal';

import { CommandPalette, useCommandPalette } from '@/components/CommandPalette';

function Dashboard({ user, onLogout }) {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();

  const renderSection = () => {
    switch (activeSection) {
      // ── Home / Launchpad ──────────────────────────────────────
      case 'dashboard':
        return <LaunchpadSection onNavigate={setActiveSection} />;

      // ── Portales de área ──────────────────────────────────────
      case 'portal_ventas':
        return <VentasPortal onNavigate={setActiveSection} />;
      case 'portal_compras':
        return <ComprasPortal onNavigate={setActiveSection} />;
      case 'portal_finanzas':
        return <FinanzasPortal onNavigate={setActiveSection} />;
      case 'portal_inventario':
        return <InventarioPortal onNavigate={setActiveSection} />;

      // ── Módulos individuales ──────────────────────────────────
      case 'productos':
        return <ProductosSection />;
      case 'ventas':
        return <VentasSection />;
      case 'cotizaciones':
        return <CotizacionesSection />;
      case 'pedidos':
        return <PedidosSection />;
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
      case 'proveedores':
        return <ProveedoresSection />;

      // ── Panel ejecutivo legacy (accesible desde Finanzas portal) ──
      case 'panel_ejecutivo':
        return <DashboardSection onNavigate={setActiveSection} />;

      default:
        return <LaunchpadSection onNavigate={setActiveSection} />;
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

      <div className={`flex-1 transition-all duration-300 ${isSidebarOpen ? 'ml-64' : 'ml-0 md:ml-20'}`}>
        <Header
          user={user}
          onLogout={onLogout}
          toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onOpenSearch={() => setCmdOpen(true)}
        />

        <main className="p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
            >
              {renderSection()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={(section) => { setActiveSection(section); setCmdOpen(false); }}
      />
    </div>
  );
}

export default Dashboard;
