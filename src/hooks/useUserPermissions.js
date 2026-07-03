import { useAuth } from '@/contexts/SupabaseAuthContext';

export const useUserPermissions = () => {
  const { user } = useAuth();
  
  const isAdmin = () => {
    return user?.role === 'admin';
  };

  const hasPermission = (sectionId) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    
    // For staff, check the permissions object
    return user.permissions?.[sectionId] === true;
  };

  const canAccessSection = (sectionId) => {
    return hasPermission(sectionId);
  };

  // Helper to get array of accessible sections for filtering menus
  const getAccessibleSections = () => {
    if (!user) return [];
    
    const allSections = [
      'dashboard',
      'productos',
      'ventas',
      'pedidos',
      'compras',
      'caja',
      'clientes',
      'cuentacorriente',
      'bancos',
      'cheques',
      'reportes',
      'usuarios',
      'configuracion'
    ];

    if (user.role === 'admin') return allSections;

    return allSections.filter(section => user.permissions?.[section] === true);
  };

  return {
    isAdmin,
    hasPermission,
    canAccessSection,
    userPermissions: getAccessibleSections(),
    userRole: user?.role || 'guest'
  };
};