import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Shield, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';

export default function StaffPermissionsModal({ isOpen, onClose, userData, onSave }) {
  const { toast } = useToast();
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(false);

  const modules = [
    { id: 'dashboard', label: 'Dashboard', desc: 'Ver métricas y resumen general' },
    { id: 'productos', label: 'Inventario (Productos)', desc: 'Gestionar catálogo y stock' },
    { id: 'ventas', label: 'Ventas', desc: 'Registrar ventas y ver historial' },
    { id: 'compras', label: 'Compras', desc: 'Registrar compras a proveedores' },
    { id: 'caja', label: 'Caja', desc: 'Apertura y cierre de caja, movimientos' },
    { id: 'clientes', label: 'Clientes', desc: 'Gestión de base de datos de clientes' },
    { id: 'cuentacorriente', label: 'Cuenta Corriente', desc: 'Gestionar deudas y saldos de clientes' },
    { id: 'reportes', label: 'Reportes', desc: 'Acceso a reportes detallados' },
    { id: 'usuarios', label: 'Usuarios', desc: 'Ver lista de usuarios (solo lectura)' },
    { id: 'configuracion', label: 'Configuración', desc: 'Ajustes del sistema' }
  ];

  useEffect(() => {
    if (userData) {
      setPermissions(userData.permissions || {});
    }
  }, [userData]);

  const handleToggle = (moduleId) => {
    setPermissions(prev => ({
      ...prev,
      [moduleId]: !prev[moduleId]
    }));
  };

  const handleSelectAll = () => {
    const allSelected = modules.every(m => permissions[m.id]);
    const newPermissions = {};
    modules.forEach(m => {
      newPermissions[m.id] = !allSelected;
    });
    setPermissions(newPermissions);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      if (Object.values(permissions).every(val => !val)) {
        toast({ 
          title: "Advertencia", 
          description: "El usuario debe tener al menos un permiso activo.", 
          variant: "destructive" 
        });
        setLoading(false);
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .update({ permissions })
        .eq('id', userData.id);

      if (error) throw error;

      toast({ 
        title: "Permisos actualizados", 
        description: `Los permisos para ${userData.first_name} han sido guardados.`,
        className: "bg-green-600 text-white"
      });
      
      onSave(); // Trigger refresh in parent
      
    } catch (error) {
      console.error("Error saving permissions:", error);
      toast({ 
        title: "Error", 
        description: "No se pudieron actualizar los permisos.", 
        variant: "destructive" 
      });
    } finally {
      setLoading(false);
    }
  };

  if (!userData) return null;

  const isAdmin = userData.role === 'admin';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !loading && onClose()}>
      <DialogContent className="max-w-md bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            Gestionar Permisos
          </DialogTitle>
          <DialogDescription>
            Configura el acceso para <span className="font-semibold text-slate-900 dark:text-white">{userData.first_name} {userData.last_name}</span> ({userData.role}).
          </DialogDescription>
        </DialogHeader>

        {isAdmin ? (
          <div className="p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-900/30 rounded-lg text-purple-700 dark:text-purple-300 flex items-start gap-3">
            <Shield className="h-6 w-6 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-bold mb-1">Acceso Total</p>
              <p>Este usuario es Administrador y tiene acceso completo a todos los módulos del sistema por defecto. Para restringir el acceso, cambia su rol a "Staff".</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Presets rápidos */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Presets:</span>
              <button
                type="button"
                onClick={() => setPermissions({ solo_caja: true })}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  permissions.solo_caja
                    ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-400'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-amber-300 hover:text-amber-600'
                }`}
              >
                🏪 Solo Caja
              </button>
              <button
                type="button"
                onClick={() => {
                  const all = {};
                  modules.forEach(m => { all[m.id] = true; });
                  setPermissions(all);
                }}
                className="px-2.5 py-1 rounded-full text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-500 hover:border-blue-300 hover:text-blue-600 transition-colors"
              >
                ✓ Todos
              </button>
              <button
                type="button"
                onClick={() => setPermissions({})}
                className="px-2.5 py-1 rounded-full text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-500 hover:border-red-300 hover:text-red-600 transition-colors"
              >
                ✗ Ninguno
              </button>
            </div>

            {permissions.solo_caja ? (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-700 dark:text-amber-300 text-sm flex items-start gap-2">
                <span className="text-lg">🏪</span>
                <div>
                  <p className="font-semibold">Perfil: Solo Caja</p>
                  <p className="text-xs mt-0.5">Este usuario solo verá las secciones <strong>Ventas</strong> y <strong>Caja</strong>. Sin acceso a reportes, configuración ni clientes.</p>
                </div>
              </div>
            ) : (
            <div className="flex justify-end">
              <Button variant="link" size="sm" onClick={handleSelectAll} className="h-auto p-0 text-blue-600">
                {modules.every(m => permissions[m.id]) ? 'Deseleccionar todo' : 'Seleccionar todo'}
              </Button>
            </div>
            
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {modules.map((module) => (
                <div 
                  key={module.id} 
                  className="flex items-start space-x-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border border-transparent hover:border-slate-100 dark:hover:border-slate-800 cursor-pointer"
                  onClick={() => handleToggle(module.id)}
                >
                  <Checkbox 
                    id={`perm-modal-${module.id}`} 
                    checked={permissions[module.id] || false}
                    onCheckedChange={() => handleToggle(module.id)}
                    className="mt-1"
                  />
                  <div className="grid gap-0.5 cursor-pointer pointer-events-none">
                    <Label 
                      htmlFor={`perm-modal-${module.id}`} 
                      className="font-medium text-slate-900 dark:text-slate-100 cursor-pointer"
                    >
                      {module.label}
                    </Label>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {module.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            )} {/* cierre del if !solo_caja */}

            <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/10 rounded-md text-xs text-blue-700 dark:text-blue-300">
               <AlertTriangle className="h-4 w-4 shrink-0" />
               <p>Los cambios en los permisos se aplicarán inmediatamente.</p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cerrar</Button>
          {!isAdmin && (
            <Button onClick={handleSave} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white">
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/> Guardando...</> : 'Guardar Permisos'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}