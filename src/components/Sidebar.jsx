import React from 'react';
import { LayoutDashboard, Package, ShoppingCart, ArrowLeftRight, Wallet, FileText, Users, Settings, X, LogOut, ChevronRight, Contact, CreditCard, ClipboardList, ShoppingBag, BookOpen, Landmark, Truck, PackageCheck, Tag } from 'lucide-react';

import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { Button } from '@/components/ui/button';

function Sidebar({ activeSection, setActiveSection, isOpen, setIsOpen, alerts }) {
  const { user, signOut } = useAuth();
  const { isSessionOpen } = useCaja();

  // All menu items are visible to everyone now
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'productos', label: 'Inventario', icon: Package, badge: alerts?.count > 0 ? alerts.count : null },
    { id: 'ventas', label: 'Ventas', icon: ShoppingCart },
    { id: 'cotizaciones', label: 'Cotizaciones', icon: ClipboardList },
    { id: 'pedidos', label: 'Pedidos', icon: PackageCheck },
    { id: 'listas_precio', label: 'Listas de Precios', icon: Tag },
    { id: 'compras', label: 'Compras', icon: ArrowLeftRight },
    { id: 'ordenes_compra', label: 'Órdenes de Compra', icon: ShoppingBag },
    { id: 'proveedores', label: 'Proveedores', icon: Truck },
    {
      id: 'caja',
      label: 'Caja',
      icon: Wallet,
      statusIndicator: true
    },
    { id: 'bancos', label: 'Bancos', icon: Landmark },
    { id: 'clientes', label: 'Clientes', icon: Contact },
    { id: 'cuentacorriente', label: 'Cta. Corriente', icon: CreditCard },
    { id: 'plan_cuentas', label: 'Contabilidad', icon: BookOpen },
    { id: 'reportes', label: 'Reportes', icon: FileText },
    { id: 'usuarios', label: 'Usuarios', icon: Users },
    { id: 'configuracion', label: 'Configuración', icon: Settings },
  ];

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <>
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="md:hidden fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-40 transition-opacity duration-200"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-white dark:bg-[#1E293B] border-r border-slate-200 dark:border-slate-700 shadow-2xl transition-all duration-300 ease-in-out
          ${isOpen ? 'w-64 translate-x-0' : '-translate-x-full md:translate-x-0 md:w-20'}
        `}
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-[#0F172A]/50">
          <div className={`flex items-center gap-3 overflow-hidden ${!isOpen && 'md:justify-center w-full px-0'}`}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00D4FF] to-[#0055FF] flex-shrink-0 flex items-center justify-center shadow-lg shadow-blue-500/20">
               <span className="text-white font-bold text-lg">K</span>
            </div>
            {isOpen && (
              <span className="font-bold text-xl text-slate-800 dark:text-white tracking-tight whitespace-nowrap animate-in fade-in slide-in-from-left-2 duration-200">
                KAIROX
              </span>
            )}
          </div>
          <button onClick={() => setIsOpen(false)} className="md:hidden text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
          {menuItems.map((item) => {
            const isActive = activeSection === item.id;

            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveSection(item.id);
                  if (window.innerWidth < 768) setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group relative
                  ${isActive
                    ? 'bg-blue-50 dark:bg-gradient-to-r dark:from-[#00D4FF]/20 dark:to-blue-600/10 text-blue-600 dark:text-[#00D4FF]'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-800 dark:hover:text-slate-100'
                  }
                  ${!isOpen && 'justify-center'}
                `}
              >
                <div className={`relative ${!isOpen && 'flex justify-center'}`}>
                  <item.icon 
                    size={20} 
                    className={`transition-colors duration-200 ${isActive ? 'text-blue-600 dark:text-[#00D4FF]' : 'group-hover:text-slate-800 dark:group-hover:text-white'}`}
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                  {item.badge && (
                    <span className={`absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white dark:ring-[#1E293B] animate-pulse`}>
                      {item.badge > 9 ? '9+' : item.badge}
                    </span>
                  )}
                  {item.statusIndicator && (
                    <span className={`absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full border border-white dark:border-[#1E293B] ${isSessionOpen ? 'bg-green-500' : 'bg-red-500'}`} />
                  )}
                </div>
                
                {isOpen && (
                  <div className="flex-1 text-left flex items-center justify-between">
                    <span className={`text-sm font-medium ${isActive ? 'font-bold' : ''}`}>{item.label}</span>
                    {isActive && <ChevronRight size={14} className="opacity-50" />}
                  </div>
                )}

                {!isOpen && (
                  <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-xl border border-slate-700 transition-all duration-200 translate-x-2 group-hover:translate-x-0">
                    {item.label}
                    {item.statusIndicator && (
                      <span className={`ml-2 inline-block w-2 h-2 rounded-full ${isSessionOpen ? 'bg-green-500' : 'bg-red-500'}`}></span>
                    )}
                    <div className="absolute top-1/2 -left-1 -translate-y-1/2 border-4 border-transparent border-r-slate-900"></div>
                  </div>
                )}
              </button>
            )
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-[#0F172A]/30">
           {isOpen ? (
             <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-200 dark:border-slate-700/50">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white ring-2 ring-white dark:ring-[#1E293B]">
                  {user?.email?.[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-white truncate">{user?.email?.split('@')[0]}</p>
                  <p className="text-[10px] text-[#00D4FF] capitalize truncate">{user?.role === 'admin' ? 'Administrador' : 'Staff'}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-400" onClick={handleSignOut}>
                  <LogOut size={16} />
                </Button>
             </div>
           ) : (
             <div className="flex justify-center group relative">
               <button onClick={handleSignOut} className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-red-500 dark:hover:text-white hover:bg-red-50 dark:hover:bg-red-500/20 transition-colors">
                 <LogOut size={18} />
               </button>
               <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-xl border border-slate-700">
                  Cerrar Sesión
               </div>
             </div>
           )}
        </div>
      </aside>
    </>
  );
}

export default Sidebar;