import React, { useState, useEffect } from 'react';
import { UserPlus, Trash2, Shield, Mail, Edit, Loader2, Search, RefreshCw, AlertCircle, CheckCircle2, XCircle, Clock, Send, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import StaffPermissionsModal from '@/components/sections/StaffPermissionsModal';
import { validateEmail, validatePassword, checkEmailExists } from '@/lib/validationUtils';
import { formatDateTimeAR } from '@/lib/dateUtils';

function UsuariosSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { isAdmin } = useUserPermissions();
  
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  
  // Create User Dialog State
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  
  // Permissions Modal State
  const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false);
  const [selectedUserForPermissions, setSelectedUserForPermissions] = useState(null);

  const [showPassword, setShowPassword] = useState(false);

  // New User Form State
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    role: 'staff',
    active: true,
    permissions: {
      dashboard: true,
      productos: true,
      ventas: true,
      compras: false,
      caja: false,
      clientes: false,
      cuentacorriente: false,
      reportes: false,
      usuarios: false,
      configuracion: false
    }
  });

  const modules = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'productos', label: 'Inventario' },
    { id: 'ventas', label: 'Ventas' },
    { id: 'compras', label: 'Compras' },
    { id: 'caja', label: 'Caja' },
    { id: 'clientes', label: 'Clientes' },
    { id: 'cuentacorriente', label: 'Cta. Corriente' },
    { id: 'reportes', label: 'Reportes' },
    { id: 'usuarios', label: 'Usuarios' },
    { id: 'configuracion', label: 'Configuración' }
  ];

  useEffect(() => {
    if (user?.empresa_id) {
      loadUsers();
    }
  }, [user]);

  useEffect(() => {
    if (!users.length) {
      setFilteredUsers([]);
      return;
    }
    
    const term = searchTerm.toLowerCase();
    const filtered = users.filter(u => 
      (u.first_name?.toLowerCase() || '').includes(term) ||
      (u.last_name?.toLowerCase() || '').includes(term) ||
      (u.email?.toLowerCase() || '').includes(term)
    );
    setFilteredUsers(filtered);
  }, [searchTerm, users]);

  const loadUsers = async () => {
    setLoading(true);
    try {
        if (!user.empresa_id) throw new Error("No se identificó la empresa del usuario.");

        const { data, error } = await supabase
            .from('profiles')
            .select('id, first_name, last_name, email, role, permissions, active, created_at, last_login_at')
            .eq('empresa_id', user.empresa_id)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        setUsers(data || []);
    } catch (error) {
        console.error("Error loading users:", error);
        toast({ title: "Error", description: "No se pudieron cargar los usuarios.", variant: "destructive" });
    } finally {
        setLoading(false);
    }
  };

  const handleCreateUser = () => {
    setFormData({
      email: '',
      password: '',
      first_name: '',
      last_name: '',
      role: 'staff',
      active: true,
      permissions: {
        dashboard: true, productos: true, ventas: true, compras: false,
        caja: false, clientes: false, cuentacorriente: false, reportes: false,
        usuarios: false, configuracion: false
      }
    });
    setShowPassword(false);
    setIsCreateDialogOpen(true);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handlePermissionChange = (moduleId) => {
    setFormData(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [moduleId]: !prev.permissions[moduleId]
      }
    }));
  };

  const validateCreateForm = async () => {
    if (!validateEmail(formData.email)) {
      toast({ title: "Email inválido", description: "Por favor ingresá un correo electrónico válido.", variant: "destructive" });
      return false;
    }

    if (!formData.password || formData.password.length < 6) {
      toast({ title: "Contraseña inválida", description: "La contraseña debe tener al menos 6 caracteres.", variant: "destructive" });
      return false;
    }

    const exists = await checkEmailExists(formData.email);
    if (exists) {
      toast({ title: "Email duplicado", description: "El email ya está registrado en el sistema.", variant: "destructive" });
      return false;
    }

    if (formData.role === 'staff') {
       const hasPermission = Object.values(formData.permissions).some(val => val === true);
       if (!hasPermission) {
         toast({ title: "Permisos insuficientes", description: "Un usuario Staff debe tener al menos un permiso asignado.", variant: "destructive" });
         return false;
       }
    }

    return true;
  };

  const submitCreateUser = async () => {
    const isValid = await validateCreateForm();
    if (!isValid) return;

    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: formData.email,
          password: formData.password,
          firstName: formData.first_name,
          lastName: formData.last_name,
          role: formData.role,
          permissions: formData.permissions,
          empresa_id: user.empresa_id,
          tenantId: user.tenant_id,
        }
      });

      if (error) throw new Error(error.message || "Error de conexión con el servidor.");
      if (data && data.error) throw new Error(data.error);

      toast({
          title: "✅ Usuario creado",
          description: `${formData.email} puede iniciar sesión con la contraseña definida.`,
          className: "bg-green-600 text-white border-green-700"
      });

      setIsCreateDialogOpen(false);
      setTimeout(() => loadUsers(), 500);

    } catch (error) {
      console.error("Submit Error:", error);
      toast({
          title: "Error al enviar invitación",
          description: error.message || "Ocurrió un error inesperado.",
          variant: "destructive"
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = async (userId) => {
    if (!window.confirm("¿Estás seguro de eliminar este usuario? Esta acción es permanente.")) return;
    
    if (userId === user.id) {
       toast({ title: "Error", description: "No puedes eliminar tu propia cuenta.", variant: "destructive" });
       return;
    }

    const admins = users.filter(u => u.role === 'admin');
    const targetUser = users.find(u => u.id === userId);
    if (targetUser.role === 'admin' && admins.length <= 1) {
       toast({ title: "Error", description: "No puedes eliminar al único administrador.", variant: "destructive" });
       return;
    }

    setProcessing(true);
    try {
        const { data, error } = await supabase.functions.invoke('delete-user', {
            body: { userId: userId }
        });

        if (error) throw new Error(error.message);
        if (data && data.error) throw new Error(data.error);

        toast({ title: "Usuario eliminado", description: "El usuario ha sido eliminado correctamente." });
        loadUsers();

    } catch (error) {
        console.error("Delete Error:", error);
        toast({ title: "Error", description: error.message || "No se pudo eliminar el usuario.", variant: "destructive" });
    } finally {
        setProcessing(false);
    }
  };

  const handleToggleStatus = async (userId, currentStatus) => {
    if (userId === user.id) {
      toast({ title: "Acción bloqueada", description: "No puedes desactivar tu propia cuenta.", variant: "destructive" });
      return;
    }

    try {
      // Optimistic update
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, active: !currentStatus } : u));

      const { error } = await supabase
        .from('profiles')
        .update({ active: !currentStatus })
        .eq('id', userId);

      if (error) throw error;

      toast({ 
        title: !currentStatus ? "Usuario activado" : "Usuario desactivado",
        className: !currentStatus ? "bg-green-600 text-white" : "bg-slate-800 text-white"
      });
    } catch (error) {
      // Revert optimistic update
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, active: currentStatus } : u));
      toast({ title: "Error", description: "No se pudo actualizar el estado.", variant: "destructive" });
    }
  };

  const openPermissionsModal = (userToEdit) => {
    setSelectedUserForPermissions(userToEdit);
    setIsPermissionsModalOpen(true);
  };

  if (!isAdmin()) {
      return (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500 dark:text-slate-400 animate-in fade-in">
              <Shield className="h-12 w-12 mb-4 text-slate-300 dark:text-slate-600" />
              <h3 className="text-lg font-semibold dark:text-slate-200">Acceso Restringido</h3>
              <p>No tienes permisos para gestionar usuarios.</p>
          </div>
      );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Equipo y Usuarios</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Gestiona los miembros de tu organización y sus permisos.</p>
        </div>
        <div className="flex gap-2">
            <Button variant="outline" onClick={loadUsers} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Actualizar
            </Button>
            <Button onClick={handleCreateUser} className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-md">
                <UserPlus className="h-4 w-4 mr-2" /> Nuevo Usuario
            </Button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm space-y-4">
        <div className="flex items-center gap-2 max-w-md">
            <Search className="h-4 w-4 text-slate-400" />
            <Input 
                placeholder="Buscar por nombre o email..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-transparent border-none shadow-none focus-visible:ring-0 px-0 h-auto"
            />
        </div>

        <div className="rounded-md border border-slate-200 dark:border-slate-800 overflow-hidden">
            <Table>
                <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-950">
                        <TableHead>Usuario</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Rol</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Permisos</TableHead>
                        <TableHead><span className="flex items-center gap-1"><Clock className="h-3 w-3" />Último acceso</span></TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loading ? (
                       [...Array(3)].map((_, i) => (
                           <TableRow key={i}>
                               <TableCell><div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                               <TableCell><div className="h-4 w-40 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                               <TableCell><div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                               <TableCell><div className="h-4 w-16 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                               <TableCell><div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                               <TableCell><div className="h-8 w-8 ml-auto bg-slate-200 dark:bg-slate-800 rounded animate-pulse" /></TableCell>
                           </TableRow>
                       ))
                    ) : filteredUsers.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                                {searchTerm ? 'No se encontraron resultados.' : 'No hay usuarios registrados.'}
                            </TableCell>
                        </TableRow>
                    ) : (
                        filteredUsers.map((u) => {
                            const permissionCount = u.permissions ? Object.values(u.permissions).filter(Boolean).length : 0;
                            const totalPermissions = 10; // Total module count
                            
                            return (
                                <TableRow key={u.id} className="group">
                                    <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-300">
                                                {(u.first_name?.[0] || 'U').toUpperCase()}
                                            </div>
                                            <span>{u.first_name} {u.last_name}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-slate-500">{u.email}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={`uppercase text-[10px] font-bold ${
                                            u.role === 'admin' 
                                            ? 'border-purple-200 text-purple-700 bg-purple-50 dark:border-purple-900 dark:text-purple-400 dark:bg-purple-900/20' 
                                            : 'border-slate-200 text-slate-600 bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:bg-slate-800'
                                        }`}>
                                            {u.role === 'admin' ? 'Admin' : 'Staff'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <Switch 
                                                checked={u.active} 
                                                onCheckedChange={() => handleToggleStatus(u.id, u.active)}
                                                disabled={u.id === user.id}
                                            />
                                            <span className={`text-xs font-medium ${u.active ? 'text-green-600' : 'text-slate-400'}`}>
                                                {u.active ? 'Activo' : 'Inactivo'}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {u.role === 'admin' ? (
                                            <Badge variant="secondary" className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 hover:bg-purple-200">
                                                Acceso Total
                                            </Badge>
                                        ) : (
                                            <Badge 
                                                variant="outline" 
                                                className="cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                                onClick={() => openPermissionsModal(u)}
                                            >
                                                {permissionCount}/{totalPermissions} Permisos
                                            </Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-xs text-slate-400">
                                        {u.last_login_at
                                          ? formatDateTimeAR(u.last_login_at)
                                          : <span className="italic text-slate-500">Nunca</span>
                                        }
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => openPermissionsModal(u)}
                                                title="Gestionar Permisos"
                                            >
                                                <Edit className="h-4 w-4 text-slate-500 hover:text-blue-600" />
                                            </Button>
                                            {u.id !== user.id && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDelete(u.id)}
                                                    className="hover:text-red-600 text-slate-400"
                                                    title="Eliminar Usuario"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    )}
                </TableBody>
            </Table>
        </div>
      </div>

      {/* Permissions Modal Component */}
      <StaffPermissionsModal 
        isOpen={isPermissionsModalOpen}
        onClose={() => setIsPermissionsModalOpen(false)}
        userData={selectedUserForPermissions}
        onSave={() => {
            loadUsers();
            setIsPermissionsModalOpen(false);
        }}
      />

      {/* Create User Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-blue-500" /> Nuevo Usuario
            </DialogTitle>
            <DialogDescription className="dark:text-slate-400">
              Creá el usuario directamente con email y contraseña. Podrá iniciar sesión de inmediato.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                <div className="space-y-4">
                    <h4 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wide border-b border-slate-100 dark:border-slate-800 pb-2">Datos del Usuario</h4>

                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <Label htmlFor="first_name">Nombre</Label>
                                <Input id="first_name" name="first_name" value={formData.first_name} onChange={handleInputChange} placeholder="Ej. Juan" />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="last_name">Apellido</Label>
                                <Input id="last_name" name="last_name" value={formData.last_name} onChange={handleInputChange} placeholder="Ej. Pérez" />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <Label htmlFor="email">Email <span className="text-red-500">*</span></Label>
                            <Input id="email" name="email" type="email" value={formData.email} onChange={handleInputChange} placeholder="usuario@ejemplo.com" />
                        </div>

                        <div className="space-y-1">
                            <Label htmlFor="password">Contraseña <span className="text-red-500">*</span></Label>
                            <div className="relative">
                                <Input
                                    id="password" name="password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={formData.password}
                                    onChange={handleInputChange}
                                    placeholder="Mínimo 6 caracteres"
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(v => !v)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                >
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <h4 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wide border-b border-slate-100 dark:border-slate-800 pb-2">Rol y Permisos</h4>
                    
                    <div className="space-y-4">
                        <RadioGroup value={formData.role} onValueChange={(val) => setFormData({...formData, role: val})} className="flex gap-4">
                            <div className={`flex items-center space-x-2 border p-3 rounded-lg cursor-pointer transition-all ${formData.role === 'admin' ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' : 'border-slate-200 dark:border-slate-800'}`}>
                                <RadioGroupItem value="admin" id="r-admin" />
                                <Label htmlFor="r-admin" className="cursor-pointer font-semibold">Admin</Label>
                            </div>
                            <div className={`flex items-center space-x-2 border p-3 rounded-lg cursor-pointer transition-all ${formData.role === 'staff' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-800'}`}>
                                <RadioGroupItem value="staff" id="r-staff" />
                                <Label htmlFor="r-staff" className="cursor-pointer font-semibold">Staff</Label>
                            </div>
                        </RadioGroup>

                        {formData.role === 'staff' ? (
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-800">
                                <Label className="text-xs uppercase text-slate-500 dark:text-slate-400 font-bold mb-3 block">Módulos Permitidos</Label>
                                <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1 custom-scrollbar">
                                    {modules.map(module => (
                                    <div key={module.id} className="flex items-center space-x-2 hover:bg-white dark:hover:bg-slate-800 p-1.5 rounded transition-colors cursor-pointer" onClick={() => handlePermissionChange(module.id)}>
                                        <Checkbox 
                                            checked={formData.permissions[module.id]} 
                                            onCheckedChange={() => handlePermissionChange(module.id)}
                                        />
                                        <label className="text-sm font-medium leading-none cursor-pointer w-full text-slate-700 dark:text-slate-300 pointer-events-none">
                                            {module.label}
                                        </label>
                                    </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="p-4 bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-900/30 rounded-lg text-sm text-purple-700 dark:text-purple-300 flex gap-2 items-start">
                                <Shield className="h-5 w-5 shrink-0" />
                                <p>El Administrador tiene acceso completo a todos los módulos.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-100 dark:border-slate-800 pt-4 mt-2">
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)} disabled={processing}>Cancelar</Button>
            <Button onClick={submitCreateUser} disabled={processing} className="bg-blue-600 hover:bg-blue-700 text-white">
              {processing
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/> Creando...</>
                : <><UserPlus className="mr-2 h-4 w-4" /> Crear Usuario</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default UsuariosSection;