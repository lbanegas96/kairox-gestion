import {
  Menu, Bell, CheckCircle, Moon, Sun, Search, Settings,
  Package, CreditCard, ShoppingBag, AlertCircle, Wallet,
  FileText, Plus,
} from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
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

const SECTION_LABELS = {
  dashboard:       'Dashboard',
  productos:       'Inventario',
  ventas:          'Ventas',
  cotizaciones:    'Cotizaciones',
  pedidos:         'Pedidos',
  listas_precio:   'Listas de Precios',
  compras:         'Compras',
  ordenes_compra:  'Órdenes de Compra',
  proveedores:     'Proveedores',
  caja:            'Caja',
  bancos:          'Bancos',
  cheques:         'Cheques',
  clientes:        'Clientes',
  cuentacorriente: 'Cuenta Corriente',
  plan_cuentas:    'Plan de Cuentas',
  impuestos:       'Impuestos',
  reportes:        'Reportes',
  usuarios:        'Usuarios',
  configuracion:   'Configuración',
};

const NOTIF_CONFIG = {
  facturas_error_cae: { icon: AlertCircle, color: 'text-red-500',    bg: 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30' },
  stock_bajo:         { icon: Package,     color: 'text-amber-500',  bg: 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30' },
  deuda_vencida:      { icon: CreditCard,  color: 'text-rose-500',   bg: 'bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800/30' },
  oc_pendiente:       { icon: ShoppingBag, color: 'text-blue-500',   bg: 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/30' },
  caja_sin_cerrar:    { icon: Wallet,      color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800/30' },
  caes_pendientes:    { icon: FileText,    color: 'text-violet-500', bg: 'bg-violet-50 dark:bg-violet-900/10 border-violet-200 dark:border-violet-800/30' },
};

function Header({ user, onLogout, toggleSidebar, onNavigate, onOpenSearch, activeSection }) {
  const { theme, toggleTheme } = useTheme();
  const { config }             = useConfig();
  const { userRole }           = useAuth();
  const notifications          = useNotifications();
  const queryClient            = useQueryClient();
  const { toast }              = useToast();

  const isDark      = theme === 'dark';
  const firstName   = user?.user_metadata?.first_name || user?.first_name || 'Usuario';
  const lastName    = user?.user_metadata?.last_name  || user?.last_name  || '';
  const initials    = `${firstName.charAt(0)}${lastName ? lastName.charAt(0) : ''}`.toUpperCase() || 'U';
  const empresaName = config?.nombre_empresa || user?.empresa_nombre || 'KAIROX';
  const seccion     = SECTION_LABELS[activeSection] ?? activeSection ?? 'Dashboard';
  const roleLabel   = userRole === 'admin' ? 'Administrador' : 'Staff';

  return (
    <header className="h-14 flex-shrink-0 flex items-center px-5 gap-2.5 border-b border-kx-border bg-kx-surface/80 backdrop-blur-md z-30 shadow-sm dark:shadow-none">
      {/* Mobile burger */}
      <button
        onClick={toggleSidebar}
        className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center text-kx-text-2 hover:bg-kx-surface-2 transition-colors"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Breadcrumb */}
      <div className="text-[12.5px] text-kx-text-2 flex items-center gap-1.5 min-w-0">
        <b className="text-kx-text font-medium truncate">{empresaName}</b>
        <span className="text-kx-text-3">·</span>
        <span className="truncate">{seccion}</span>
      </div>

      {/* Right group */}
      <div className="ml-auto flex items-center gap-1.5">
        {/* Search */}
        <button
          onClick={onOpenSearch}
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-kx-border text-kx-text-3 text-xs hover:bg-kx-surface-2 transition-colors w-40"
          title="Búsqueda global (Ctrl+K)"
        >
          <Search className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1">Buscar...</span>
          <kbd className="hidden lg:block text-[10px] border border-kx-border rounded px-1 bg-kx-surface-2">⌘K</kbd>
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center gap-1 h-8 px-2.5 rounded-lg border border-kx-border text-[11.5px] text-kx-text-2 hover:bg-kx-surface-2 transition-colors"
          title={isDark ? 'Modo Claro' : 'Modo Oscuro'}
        >
          {isDark
            ? <Sun  className="w-3.5 h-3.5" />
            : <Moon className="w-3.5 h-3.5" />}
          <span className="hidden sm:block">{isDark ? 'Claro' : 'Oscuro'}</span>
        </button>

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="relative w-8 h-8 rounded-lg flex items-center justify-center text-kx-text-2 hover:bg-kx-surface-2 transition-colors">
              <Bell className="w-4 h-4" />
              {notifications.hasNotifications && (
                <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-red-500 ring-2 ring-kx-surface text-[9px] font-bold text-white flex items-center justify-center">
                  {notifications.count > 9 ? '9+' : notifications.count}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[340px] p-0 bg-kx-surface border border-kx-border shadow-xl rounded-xl z-50">
            <div className="p-4 border-b border-kx-border flex justify-between items-center">
              <h4 className="font-semibold text-sm text-kx-text flex items-center gap-2">
                <Bell className="w-4 h-4" /> Notificaciones
              </h4>
              {notifications.hasNotifications && (
                <span className="text-[10px] font-bold bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full">
                  {notifications.count} alertas
                </span>
              )}
            </div>
            <div className="max-h-[360px] overflow-y-auto p-2 space-y-1">
              {!notifications.hasNotifications ? (
                <div className="py-8 px-4 text-center flex flex-col items-center gap-2">
                  <CheckCircle className="h-10 w-10 text-emerald-500/30" />
                  <p className="text-sm font-medium text-kx-text-2">¡Todo al día!</p>
                  <p className="text-xs text-kx-text-3">Sin alertas pendientes</p>
                </div>
              ) : (
                notifications.items.slice(0, 8).map((item) => {
                  const cfg  = NOTIF_CONFIG[item.tipo] ?? NOTIF_CONFIG.stock_bajo;
                  const Icon = cfg.icon;
                  return (
                    <button
                      key={item.id}
                      className={`w-full text-left p-3 rounded-lg border transition-colors hover:opacity-90 ${cfg.bg}`}
                      onClick={() => {
                        if (item.action === 'reintentar-cae') {
                          import('@/services/afipService').then(({ reintentarCAEsPendientes }) => {
                            reintentarCAEsPendientes(user.empresa_id).then((n) => {
                              toast({
                                title: `${n} factura${n === 1 ? '' : 's'} re-encolada${n === 1 ? '' : 's'}`,
                                description: 'El worker emitirá los CAE en los próximos minutos.',
                              });
                              queryClient.invalidateQueries({ queryKey: ['ventas'] });
                              queryClient.invalidateQueries({ queryKey: ['notif'] });
                            }).catch(err => {
                              toast({ title: 'No se pudo re-encolar', description: err.message, variant: 'destructive' });
                            });
                          });
                        } else if (item.action === 'tab-facturacion') {
                          onNavigate?.(item.seccion, { initialTab: 'facturacion' });
                        } else {
                          onNavigate?.(item.seccion);
                        }
                      }}
                    >
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
                <p className="text-center text-xs text-kx-text-3 py-2">+ {notifications.count - 8} más alertas</p>
              )}
            </div>
            {notifications.hasNotifications && (
              <div className="p-2 border-t border-kx-border grid grid-cols-3 gap-1 text-[10px] text-kx-text-3 rounded-b-xl">
                <span className="text-center">📦 {notifications.stockBajo?.length ?? 0} stock</span>
                <span className="text-center">💳 {notifications.deudaVencida?.length ?? 0} deudas</span>
                <span className="text-center">🛒 {notifications.ocPendientes?.length ?? 0} OC</span>
                {(notifications.cajaSinCerrar?.length ?? 0) > 0 && (
                  <span className="text-center col-span-3">🏦 {notifications.cajaSinCerrar.length} caja sin cerrar</span>
                )}
                {(notifications.caesPendientes?.length ?? 0) > 0 && (
                  <span className="text-center col-span-3">🧾 {notifications.caesPendientes.length} CAE{notifications.caesPendientes.length > 1 ? 's' : ''} pendiente{notifications.caesPendientes.length > 1 ? 's' : ''}</span>
                )}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Nueva Venta CTA */}
        <button
          onClick={() => onNavigate?.('pos')}
          className="hidden sm:flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[12.5px] font-semibold bg-kx-text text-kx-bg hover:opacity-85 transition-opacity"
        >
          <Plus className="w-3.5 h-3.5" /> Nueva Venta
        </button>

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="pl-1.5 pr-1 py-1 h-auto hover:bg-kx-surface-2 rounded-lg gap-2 transition-colors">
              <Avatar className="h-7 w-7 border border-kx-border">
                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-violet-600 text-white font-semibold text-[10px]">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:flex flex-col items-start">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-kx-text leading-none">{firstName}</span>
                  <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${
                    userRole === 'admin'
                      ? 'border-purple-200 text-purple-600 bg-purple-50 dark:border-purple-800 dark:text-purple-300 dark:bg-purple-900/20'
                      : 'border-blue-200 text-blue-600 bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:bg-blue-900/20'
                  }`}>
                    {roleLabel}
                  </Badge>
                </div>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 bg-kx-surface border border-kx-border shadow-xl rounded-xl z-50">
            <DropdownMenuLabel className="font-normal p-3 border-b border-kx-border rounded-t-xl">
              <p className="text-sm font-medium text-kx-text">{firstName} {lastName}</p>
              <p className="text-xs text-kx-text-3 truncate mt-0.5">{user?.email}</p>
            </DropdownMenuLabel>
            <div className="p-1">
              <DropdownMenuItem
                className="cursor-pointer text-kx-text-2 hover:bg-kx-surface-2 rounded-md text-xs font-medium"
                onClick={() => onNavigate?.('configuracion')}
              >
                <Settings className="mr-2 h-3.5 w-3.5" /> Configuración
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-kx-border my-1" />
              <DropdownMenuItem
                onClick={onLogout}
                className="cursor-pointer text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md text-xs font-medium"
              >
                Cerrar Sesión
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export default Header;
