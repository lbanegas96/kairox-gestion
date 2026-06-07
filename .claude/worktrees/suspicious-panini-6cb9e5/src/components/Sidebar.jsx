import React, { useState } from 'react';
import {
  LayoutDashboard, Package, ShoppingCart, ArrowLeftRight, Wallet,
  FileText, Users, Settings, X, LogOut, ChevronRight, Contact,
  CreditCard, ClipboardList, ShoppingBag, BookOpen, Landmark,
  ShoppingBasket, Truck, TrendingUp, ChevronDown, ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { Button } from '@/components/ui/button';

// ─── Definición de grupos y sus módulos ────────────────────────────────────────
const AREA_GROUPS = [
  {
    id: 'portal_ventas',
    label: 'Ventas',
    accent: '#3B82F6',
    icon: TrendingUp,
    items: [
      { id: 'ventas',          label: 'POS / Ventas',       icon: ShoppingCart },
      { id: 'cotizaciones',    label: 'Cotizaciones',        icon: ClipboardList },
      { id: 'pedidos',         label: 'Pedidos',             icon: ShoppingBasket },
      { id: 'clientes',        label: 'Clientes',            icon: Contact },
      { id: 'cuentacorriente', label: 'Cta. Corriente',      icon: CreditCard },
    ],
  },
  {
    id: 'portal_compras',
    label: 'Compras',
    accent: '#8B5CF6',
    icon: ShoppingBag,
    items: [
      { id: 'compras',        label: 'Compras',             icon: ArrowLeftRight },
      { id: 'ordenes_compra', label: 'Órdenes de Compra',   icon: ShoppingBag },
      { id: 'proveedores',    label: 'Proveedores',          icon: Truck },
    ],
  },
  {
    id: 'portal_finanzas',
    label: 'Finanzas',
    accent: '#10B981',
    icon: Landmark,
    items: [
      { id: 'caja',        label: 'Caja',          icon: Wallet,   statusIndicator: true },
      { id: 'bancos',      label: 'Bancos',         icon: Landmark },
      { id: 'plan_cuentas',label: 'Contabilidad',   icon: BookOpen },
    ],
  },
  {
    id: 'portal_inventario',
    label: 'Inventario',
    accent: '#F59E0B',
    icon: Package,
    items: [
      { id: 'productos', label: 'Inventario', icon: Package },
    ],
  },
  {
    id: null, // sin portal — links directos
    label: 'Administración',
    accent: '#64748B',
    icon: Settings,
    items: [
      { id: 'reportes',      label: 'Reportes',       icon: FileText },
      { id: 'usuarios',      label: 'Usuarios',        icon: Users },
      { id: 'configuracion', label: 'Configuración',   icon: Settings },
    ],
  },
];

function Sidebar({ activeSection, setActiveSection, isOpen, setIsOpen, alerts }) {
  const { user, signOut } = useAuth();
  const { isSessionOpen } = useCaja();
  const { isAdmin, userPermissions } = useUserPermissions();

  // Grupos colapsados (en expanded mode). Por defecto todos abiertos.
  const [collapsed, setCollapsed] = useState({});
  const toggleGroup = (groupId) =>
    setCollapsed(prev => ({ ...prev, [groupId]: !prev[groupId] }));

  const handleSignOut = async () => { await signOut(); };

  // Filtrar items del grupo por permisos
  const visibleItems = (items) =>
    isAdmin() ? items : items.filter(item => userPermissions.includes(item.id));

  // Un grupo es visible si al menos un item pasa el filtro (o es admin)
  const groupVisible = (group) =>
    isAdmin() || visibleItems(group.items).length > 0;

  const navigate = (id) => {
    setActiveSection(id);
    if (window.innerWidth < 768) setIsOpen(false);
  };

  return (
    <>
      {/* Overlay móvil */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="md:hidden fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-40"
          />
        )}
      </AnimatePresence>

      <motion.aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-[#1E293B] border-r border-slate-700 shadow-2xl transition-all duration-300 ease-in-out
          ${isOpen ? 'w-64 translate-x-0' : '-translate-x-full md:translate-x-0 md:w-20'}`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-700/50 bg-[#0F172A]/50 flex-shrink-0">
          <div className={`flex items-center gap-3 overflow-hidden ${!isOpen && 'md:justify-center w-full px-0'}`}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00D4FF] to-[#0055FF] flex-shrink-0 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <span className="text-white font-bold text-lg">K</span>
            </div>
            {isOpen && (
              <motion.span
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                className="font-bold text-xl text-white tracking-tight whitespace-nowrap"
              >
                KAIROX
              </motion.span>
            )}
          </div>
          <button onClick={() => setIsOpen(false)} className="md:hidden text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1 scrollbar-thin scrollbar-thumb-slate-700">

          {/* Dashboard / Home */}
          <button
            onClick={() => navigate('dashboard')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative mb-2
              ${activeSection === 'dashboard'
                ? 'bg-gradient-to-r from-[#00D4FF]/20 to-blue-600/10 text-[#00D4FF]'
                : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-100'}
              ${!isOpen && 'justify-center'}`}
          >
            <LayoutDashboard size={20} strokeWidth={activeSection === 'dashboard' ? 2.5 : 2}
              className={activeSection === 'dashboard' ? 'text-[#00D4FF]' : 'group-hover:text-white'} />
            {isOpen && <span className={`text-sm font-medium flex-1 text-left ${activeSection === 'dashboard' ? 'font-bold' : ''}`}>Inicio</span>}
            {!isOpen && (
              <Tooltip label="Inicio" />
            )}
          </button>

          {/* Grupos de área */}
          {AREA_GROUPS.map((group) => {
            if (!groupVisible(group)) return null;
            const items = visibleItems(group.items);
            const isGroupCollapsed = collapsed[group.label];
            const isGroupActive = items.some(i => i.id === activeSection) || activeSection === group.id;

            return (
              <div key={group.label} className="mb-1">
                {/* ── Header de grupo (solo en expanded) ── */}
                {isOpen && (
                  <div
                    className={`flex items-center justify-between px-3 py-1.5 rounded-lg cursor-pointer transition-colors group/gh
                      ${isGroupActive ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'}`}
                    onClick={() => {
                      if (group.id) {
                        // Si tiene portal, navegar al portal (sin colapsar)
                        navigate(group.id);
                      } else {
                        toggleGroup(group.label);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-4 rounded-full" style={{ background: group.accent }} />
                      <group.icon size={13} style={{ color: group.accent }} />
                      <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: group.accent }}>
                        {group.label}
                      </span>
                    </div>
                    {group.id ? (
                      <ChevronRight size={13} className="text-slate-500 group-hover/gh:text-slate-300 transition-colors" />
                    ) : (
                      isGroupCollapsed
                        ? <ChevronDown size={13} className="text-slate-600" />
                        : <ChevronUp size={13} className="text-slate-600" />
                    )}
                  </div>
                )}

                {/* Separador de grupo (solo en collapsed) */}
                {!isOpen && (
                  <div className="my-1 mx-3 h-px bg-slate-700/60" />
                )}

                {/* Items del grupo */}
                <AnimatePresence initial={false}>
                  {(!isGroupCollapsed || !isOpen) && (
                    <motion.div
                      initial={isOpen ? { height: 0, opacity: 0 } : false}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <div className={`space-y-0.5 ${isOpen ? 'pl-3 pt-0.5' : ''}`}>
                        {items.map((item) => {
                          const isActive = activeSection === item.id;
                          return (
                            <button
                              key={item.id}
                              onClick={() => navigate(item.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative
                                ${isActive
                                  ? 'bg-gradient-to-r from-[#00D4FF]/20 to-blue-600/10 text-[#00D4FF]'
                                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-100'}
                                ${!isOpen && 'justify-center'}`}
                            >
                              {/* Indicador activo izquierdo (solo expanded) */}
                              {isOpen && isActive && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-[#00D4FF]" />
                              )}

                              <div className="relative">
                                <item.icon
                                  size={18}
                                  strokeWidth={isActive ? 2.5 : 2}
                                  className={isActive ? 'text-[#00D4FF]' : 'group-hover:text-white'}
                                />
                                {/* Badge stock bajo */}
                                {item.id === 'productos' && alerts?.count > 0 && (
                                  <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white ring-1 ring-[#1E293B]">
                                    {alerts.count > 9 ? '9+' : alerts.count}
                                  </span>
                                )}
                                {/* Indicador caja */}
                                {item.statusIndicator && (
                                  <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[#1E293B] ${isSessionOpen ? 'bg-green-500' : 'bg-red-500'}`} />
                                )}
                              </div>

                              {isOpen && (
                                <span className={`flex-1 text-left text-sm ${isActive ? 'font-semibold' : 'font-medium'}`}>
                                  {item.label}
                                </span>
                              )}

                              {/* Tooltip collapsed */}
                              {!isOpen && (
                                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-xl border border-slate-700 translate-x-2 group-hover:translate-x-0 transition-all duration-200">
                                  {item.label}
                                  {item.statusIndicator && (
                                    <span className={`ml-2 inline-block w-2 h-2 rounded-full ${isSessionOpen ? 'bg-green-500' : 'bg-red-500'}`} />
                                  )}
                                  <div className="absolute top-1/2 -left-1 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>

        {/* Footer usuario */}
        <div className="p-4 border-t border-slate-700/50 bg-[#0F172A]/30 flex-shrink-0">
          {isOpen ? (
            <div className="flex items-center gap-3 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white ring-2 ring-[#1E293B] flex-shrink-0">
                {user?.email?.[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user?.email?.split('@')[0]}</p>
                <p className="text-[10px] text-[#00D4FF] capitalize">{user?.role === 'admin' ? 'Administrador' : 'Staff'}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-400 flex-shrink-0" onClick={handleSignOut}>
                <LogOut size={16} />
              </Button>
            </div>
          ) : (
            <div className="flex justify-center group relative">
              <button onClick={handleSignOut} className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white hover:bg-red-500/20 transition-colors">
                <LogOut size={18} />
              </button>
              <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-xl border border-slate-700">
                Cerrar Sesión
              </div>
            </div>
          )}
        </div>
      </motion.aside>
    </>
  );
}

// Mini tooltip helper para collapsed mode (dashboard item)
function Tooltip({ label }) {
  return (
    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-xl border border-slate-700 translate-x-2 group-hover:translate-x-0 transition-all duration-200">
      {label}
      <div className="absolute top-1/2 -left-1 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
    </div>
  );
}

export default Sidebar;
