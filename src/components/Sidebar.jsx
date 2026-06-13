import React, { useState } from 'react';
import {
  LayoutDashboard, Package, ShoppingCart, ArrowLeftRight, Wallet, FileText,
  Users, Settings, LogOut, Contact, CreditCard, ClipboardList, ShoppingBag,
  BookOpen, Landmark, Truck, PackageCheck, Tag, FileCheck, Receipt,
  Box, ScrollText, RotateCcw, ChevronDown, ChevronRight as ChevronRightIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';

const NAV_GROUPS = [
  {
    label: 'GENERAL',
    items: [
      { id: 'dashboard',    label: 'Dashboard',         icon: LayoutDashboard },
      { id: 'reportes',     label: 'Reportes',           icon: FileText },
    ],
  },
  {
    label: 'VENTAS',
    items: [
      { id: 'ventas',            label: 'Nueva Venta (POS)',  icon: ShoppingCart },
      { id: 'cotizaciones',      label: 'Cotizaciones',       icon: ClipboardList },
      { id: 'pedidos',           label: 'Pedidos',            icon: PackageCheck },
      { id: 'entregas',          label: 'Entregas',           icon: Box },
      { id: 'historial_ventas',  label: 'Historial',          icon: ScrollText },
      { id: 'clientes',          label: 'Clientes',           icon: Contact },
      { id: 'cuentacorriente',   label: 'Cta. Corriente',    icon: CreditCard },
      { id: 'listas_precio',     label: 'Listas de Precios', icon: Tag },
    ],
  },
  {
    label: 'COMPRAS',
    items: [
      { id: 'compra_rapida',          label: 'Compra Rápida',      icon: ShoppingCart },
      { id: 'ordenes_compra',         label: 'Órdenes de Compra',  icon: ShoppingBag },
      { id: 'recepciones_compra',     label: 'Recepciones',        icon: Package },
      { id: 'facturas_compra',        label: 'Facturas de Compra', icon: Receipt },
      { id: 'devoluciones_proveedor', label: 'Devoluciones',       icon: RotateCcw },
      { id: 'proveedores',            label: 'Proveedores',        icon: Truck },
    ],
  },
  {
    label: 'INVENTARIO',
    items: [
      { id: 'productos', label: 'Inventario', icon: Package },
    ],
  },
  {
    label: 'FINANZAS',
    items: [
      { id: 'caja',    label: 'Caja',   icon: Wallet, statusIndicator: true },
      { id: 'bancos',  label: 'Bancos', icon: Landmark },
      { id: 'cheques', label: 'Cheques', icon: FileCheck },
    ],
  },
  {
    label: 'CONTABILIDAD',
    items: [
      { id: 'plan_cuentas', label: 'Plan de Cuentas', icon: BookOpen },
      { id: 'impuestos',    label: 'Impuestos',        icon: Receipt },
    ],
  },
  {
    label: 'ADMINISTRACIÓN',
    items: [
      { id: 'usuarios',      label: 'Usuarios',      icon: Users },
      { id: 'configuracion', label: 'Configuración', icon: Settings },
    ],
  },
];

function Sidebar({ activeSection, setActiveSection, isOpen, setIsOpen }) {
  const { user, signOut } = useAuth();
  const { isSessionOpen } = useCaja();

  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kx-sidebar-collapsed') || '{}'); }
    catch { return {}; }
  });

  const toggleGroup = (label) => {
    setCollapsed(prev => {
      const next = { ...prev, [label]: !prev[label] };
      localStorage.setItem('kx-sidebar-collapsed', JSON.stringify(next));
      return next;
    });
  };

  const firstName = user?.user_metadata?.first_name || user?.email?.split('@')[0] || 'Usuario';
  const lastName  = user?.user_metadata?.last_name  || '';
  const initials  = `${firstName.charAt(0)}${lastName ? lastName.charAt(0) : ''}`.toUpperCase();
  const roleLabel = user?.role === 'admin' ? 'Administrador' : 'Staff';

  const handleNavigate = (id) => {
    setActiveSection(id);
    if (window.innerWidth < 768) setIsOpen(false);
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside
        className={[
          // Positioning: fixed overlay on mobile, inline on desktop
          'fixed md:relative inset-y-0 left-0 z-50 md:z-auto',
          // Size
          'w-[236px] flex-shrink-0 flex flex-col',
          // Visual
          'border-r border-kx-border bg-kx-surface/80 backdrop-blur-md',
          'transition-transform duration-300 ease-in-out',
          // Mobile show/hide
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        {/* Logo */}
        <div className="px-5 py-4 flex items-center gap-2.5 border-b border-kx-border flex-shrink-0">
          <img
            src="/kairox-logo.png"
            alt="Kairox"
            className="w-7 h-7 flex-shrink-0 object-contain"
          />
          <span className="text-sm font-semibold text-kx-text tracking-tight">KAIROX</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {NAV_GROUPS.map((group) => {
            const isCollapsed = !!collapsed[group.label];
            return (
              <div key={group.label}>
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-3 pt-4 pb-1.5 group"
                >
                  <span className="text-[10px] font-semibold text-kx-text-3 uppercase tracking-wider select-none">
                    {group.label}
                  </span>
                  {isCollapsed
                    ? <ChevronRightIcon className="h-3 w-3 text-kx-text-3 group-hover:text-kx-text-2 transition-colors" />
                    : <ChevronDown className="h-3 w-3 text-kx-text-3 group-hover:text-kx-text-2 transition-colors" />
                  }
                </button>
                {!isCollapsed && group.items.map((item) => {
                  const isActive = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleNavigate(item.id)}
                      className={[
                        'w-full flex items-center gap-2.5 h-8 px-2 mx-0 rounded-md text-[12.5px] cursor-pointer transition-colors mb-0.5',
                        isActive
                          ? 'bg-kx-surface-2 text-kx-text font-medium'
                          : 'text-kx-text-2 hover:bg-kx-surface-2 hover:text-kx-text',
                      ].join(' ')}
                    >
                      <div className="relative flex-shrink-0">
                        <item.icon className="w-4 h-4" strokeWidth={isActive ? 2.2 : 1.8} />
                        {item.statusIndicator && (
                          <span
                            className={[
                              'absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-kx-surface',
                              isSessionOpen ? 'bg-kx-green' : 'bg-kx-red',
                            ].join(' ')}
                          />
                        )}
                      </div>
                      <span className="flex-1 text-left leading-none">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-kx-border flex-shrink-0">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-kx-surface-2 transition-colors">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-kx-text leading-tight truncate">{firstName}</div>
              <div className="text-[10.5px] text-kx-text-3 truncate">{roleLabel}</div>
            </div>
            <button
              onClick={signOut}
              className="ml-auto text-kx-text-3 hover:text-kx-red transition-colors p-1 flex-shrink-0"
              title="Cerrar sesión"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
