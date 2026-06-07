import React from 'react';
import { Menu, LogOut, User as UserIcon, Bell, CheckCircle, Moon, Sun, Search, Settings, Building, Upload, Package, CreditCard, ShoppingBag, AlertCircle, Wallet } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useTheme } from '@/contexts/ThemeContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useAuth } from '@/contexts/SupabaseAuthContext';

function Header({ user, onLogout, toggleSidebar, onNavigate, onOpenSearch }) {
  const { theme, toggleTheme } = useTheme();
  const { config } = useConfig();
  const { userRole } = useAuth();
  const notifications = useNotifications();

  const firstName = user?.user_metadata?.first_name || user?.first_name || 'Usuario';
  const lastName = user?.user_metadata?.last_name || user?.last_name || '';
  const initials = `${firstName.charAt(0)}${lastName ? lastName.charAt(0) : ''}`.toUpperCase() || 'U';

  const empresaName = config?.nombre_empresa || user?.empresa_nombre || 'KAIROX Gestión';
  const logoUrl = config?.company_logo || config?.logo_base64;

  const hasNotifications = notifications.hasNotifications;
  const roleLabel = userRole === 'admin' ? 'Administrador' : 'Staff';

  const TIPO_CONFIG = {
    stock_bajo:      { icon: Package,     color: 'text-amber-500',  bg: 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30' },
    deuda_vencida:   { icon: CreditCard,  color: 'text-rose-500',   bg: 'bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800/30' },
    oc_pendiente:    { icon: ShoppingBag, color: 'text-blue-500',   bg: 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/30' },
    caja_sin_cerrar: { icon: Wallet,      color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800/30' },
  };

  // "Subir Logo" button and other actions are still permission-gated for consistency, 
  // but header info is visible to all as requested.

  return (
    <header className="sticky top-0 z-30 w-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800 transition-all duration-300">
      <div className="flex items-center justify-between h-16 px-4 md:px-6">
        
        {/* Left Section */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg md:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
          
          <div className="flex items-center gap-3 opacity-90 hover:opacity-100 transition-opacity cursor-default">
            {/* Replaced logo image with company name text */}
            <div className="flex flex-col">
              <h1 className="text-lg font-bold bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent leading-none">
                {empresaName}
              </h1>
              <span className="text-[10px] text-slate-500 font-medium flex items-center gap-1">
                 <Building className="h-3 w-3" /> Panel de Gestión
              </span>
            </div>

            {/* "Subir Logo" button now conditionally displayed if no logoUrl is present AND user is admin */}
            {userRole === 'admin' && !logoUrl && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="hidden md:flex h-6 text-[10px] px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-[#00D4FF] dark:hover:bg-[#00D4FF]/10 ml-2"
                onClick={() => onNavigate && onNavigate('configuracion')}
              >
                <Upload className="h-3 w-3 mr-1" /> Subir Logo
              </Button>
            )}
          </div>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-2 sm:gap-3">

          {/* Buscador global Cmd+K */}
          <button
            onClick={onOpenSearch}
            className="hidden md:flex items-center gap-2 px-3 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm transition-colors border border-slate-200 dark:border-slate-700"
            title="Búsqueda global (Ctrl+K)"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="text-xs">Buscar...</span>
            <kbd className="hidden lg:inline-flex h-5 select-none items-center gap-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-1.5 font-mono text-[10px] font-medium text-slate-400">
              ⌘K
            </kbd>
          </button>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full w-9 h-9 transition-all"
            title={theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
          >
            {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4 text-amber-500" />}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full w-9 h-9">
                <Bell className="h-4 w-4" />
                {hasNotifications && (
                  <span className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900 text-[9px] font-bold text-white flex items-center justify-center">
                    {notifications.count > 9 ? '9+' : notifications.count}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-84 p-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl rounded-xl z-50" style={{ width: '340px' }}>
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-950/50">
                <h4 className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                  <Bell className="w-4 h-4" /> Notificaciones
                </h4>
                {hasNotifications && (
                  <span className="text-[10px] font-bold bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full">
                    {notifications.count} alertas
                  </span>
                )}
              </div>

              <div className="max-h-[360px] overflow-y-auto p-2 space-y-1">
                {!hasNotifications ? (
                  <div className="py-8 px-4 text-center flex flex-col items-center gap-2">
                    <CheckCircle className="h-10 w-10 text-emerald-500/30" />
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">¡Todo al día!</p>
                    <p className="text-xs text-slate-400">Sin alertas pendientes</p>
                  </div>
                ) : (
                  notifications.items.slice(0, 8).map((item) => {
                    const cfg = TIPO_CONFIG[item.tipo] ?? TIPO_CONFIG.stock_bajo;
                    const Icon = cfg.icon;
                    return (
                      <button key={item.id}
                        className={`w-full text-left p-3 rounded-lg border transition-colors hover:opacity-90 ${cfg.bg}`}
                        onClick={() => onNavigate?.(item.seccion)}>
                        <div className="flex items-start gap-2.5">
                          <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.color}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{item.titulo}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{item.detalle}</p>
                          </div>
                          {item.nivel === 'critico' && (
                            <span className="text-[9px] font-bold text-red-600 bg-red-100 dark:bg-red-500/20 px-1.5 py-0.5 rounded shrink-0">CRÍTICO</span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
                {notifications.count > 8 && (
                  <p className="text-center text-xs text-slate-400 py-2">+ {notifications.count - 8} más alertas</p>
                )}
              </div>

              {hasNotifications && (
                <div className="p-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-3 gap-1 text-[10px] text-slate-400 bg-slate-50/50 dark:bg-slate-950/50 rounded-b-xl">
                  <span className="text-center">📦 {notifications.stockBajo.length} stock</span>
                  <span className="text-center">💳 {notifications.deudaVencida.length} deudas</span>
                  <span className="text-center">🛒 {notifications.ocPendientes.length} OC</span>
                  {(notifications.cajaSinCerrar?.length ?? 0) > 0 && (
                    <span className="text-center col-span-3">🏦 {notifications.cajaSinCerrar.length} caja sin cerrar</span>
                  )}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="pl-2 pr-1 md:pr-3 py-1 h-auto hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full gap-2 md:gap-3 transition-colors">
                <Avatar className="h-8 w-8 border border-slate-200 dark:border-slate-700">
                  <AvatarFallback className="bg-gradient-to-br from-blue-500 to-violet-600 text-white font-semibold text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden md:flex flex-col items-start">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-none">
                      {firstName}
                    </span>
                    <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${
                      userRole === 'admin' 
                        ? 'border-purple-200 text-purple-600 bg-purple-50 dark:border-purple-800 dark:text-purple-300 dark:bg-purple-900/20' 
                        : 'border-blue-200 text-blue-600 bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:bg-blue-900/20'
                    }`}>
                      {roleLabel}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-none mt-1">
                    {user?.email}
                  </span>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl rounded-xl z-50">
              <DropdownMenuLabel className="font-normal p-3 bg-slate-50 dark:bg-slate-950/50 rounded-t-xl border-b border-slate-100 dark:border-slate-800">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none text-slate-900 dark:text-white">{firstName} {lastName}</p>
                  <p className="text-xs leading-none text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
                </div>
              </DropdownMenuLabel>
              <div className="p-1">
                {/* Configuration access is available to all users now */}
                <DropdownMenuItem className="cursor-pointer text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-xs font-medium" onClick={() => onNavigate && onNavigate('configuracion')}>
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  Configuración
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-slate-100 dark:bg-slate-800 my-1" />
                <DropdownMenuItem 
                  onClick={onLogout}
                  className="cursor-pointer text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md text-xs font-medium"
                >
                  <LogOut className="mr-2 h-3.5 w-3.5" />
                  Cerrar Sesión
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

export default Header;