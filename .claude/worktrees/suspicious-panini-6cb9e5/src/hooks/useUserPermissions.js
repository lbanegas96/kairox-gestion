import { useAuth } from '@/contexts/SupabaseAuthContext';

const ALL_SECTIONS = [
  'dashboard', 'productos', 'ventas', 'compras', 'caja',
  'clientes', 'cuentacorriente', 'reportes', 'usuarios', 'configuracion',
  'cotizaciones', 'pedidos', 'ordenes_compra', 'plan_cuentas', 'bancos',
];

const SOLO_CAJA_SECTIONS = ['ventas', 'caja'];

export const useUserPermissions = () => {
  const { user } = useAuth();

  const isAdmin = () => user?.role === 'admin';

  const isSoloCaja = () =>
    user?.role !== 'admin' && user?.permissions?.solo_caja === true;

  const hasPermission = (sectionId) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.permissions?.solo_caja) return SOLO_CAJA_SECTIONS.includes(sectionId);
    return user.permissions?.[sectionId] === true;
  };

  const canAccessSection = (sectionId) => hasPermission(sectionId);

  const getAccessibleSections = () => {
    if (!user) return [];
    if (user.role === 'admin') return ALL_SECTIONS;
    if (user.permissions?.solo_caja) return SOLO_CAJA_SECTIONS;
    return ALL_SECTIONS.filter(s => user.permissions?.[s] === true);
  };

  return {
    isAdmin,
    isSoloCaja,
    hasPermission,
    canAccessSection,
    userPermissions: getAccessibleSections(),
    userRole: user?.role || 'guest',
  };
};
