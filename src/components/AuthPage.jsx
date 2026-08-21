import { useState } from 'react';

import { Lock, Mail, User, UserCircle, ArrowRight, Loader2, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useConfig } from '@/contexts/ConfigContext';
import { supabase } from '@/lib/customSupabaseClient';
import { validatePasswordBasic } from '@/lib/securityUtils';
import PasswordRecoveryModal from '@/components/PasswordRecoveryModal';

function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    lastName: '',
    email: '',
    password: '',
    companyName: '' // New field
  });

  const { toast } = useToast();
  const { signIn, signUp } = useAuth();
  const { config } = useConfig();

  const validateForm = () => {
    if (!formData.email || !formData.email.includes('@')) {
      toast({ title: "Email inválido", description: "Por favor ingresa un correo electrónico válido.", variant: "destructive" });
      return false;
    }
    if (!formData.password) {
      toast({ title: "Contraseña requerida", description: "Ingresá tu contraseña.", variant: "destructive" });
      return false;
    }
    // La política de 8 caracteres + mayúscula/minúscula/número sólo aplica al crear
    // cuenta: exigírsela también en el login rompería a usuarios con contraseñas
    // viejas que no cumplen la regla nueva (Supabase ya la valida server-side igual).
    if (!isLogin) {
      const { valid, message } = validatePasswordBasic(formData.password);
      if (!valid) {
        toast({ title: "Contraseña débil", description: message, variant: "destructive" });
        return false;
      }
      if (!formData.name.trim()) {
        toast({ title: "Nombre requerido", description: "Por favor ingresa tu nombre.", variant: "destructive" });
        return false;
      }
      if (!formData.lastName.trim()) {
        toast({ title: "Apellido requerido", description: "Por favor ingresa tu apellido.", variant: "destructive" });
        return false;
      }
      if (!formData.companyName.trim()) {
        toast({ title: "Empresa requerida", description: "Por favor ingresa el nombre de tu empresa.", variant: "destructive" });
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsLoading(true);

    try {
      if (!isLogin) {
        // Registration Logic with Company Name
        const { error } = await signUp(formData.email, formData.password, {
          data: {
            first_name: formData.name,
            last_name: formData.lastName,
            nombre_empresa: formData.companyName
          }
        });

        if (error) throw error;

        toast({
          title: "¡Cuenta creada exitosamente!",
          description: "Bienvenido a KAIROX. Tu empresa ha sido registrada.",
          className: "bg-green-500 border-none text-white"
        });

      } else {
        // Login Logic
        const { error } = await signIn(formData.email, formData.password);
        if (error) throw error;

        toast({
          title: "¡Bienvenido de vuelta!",
          description: "Iniciando sesión en KAIROX...",
        });
      }
    } catch (error) {
      // Toast is handled by signIn/signUp in the context
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordRecovery = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) {
      toast({ title: "Error", description: error.message || "No se pudo enviar el email.", variant: "destructive" });
    } else {
      toast({ title: "Solicitud enviada", description: "Si tu email está registrado, recibirás un enlace de recuperación.", className: "bg-green-500 border-none text-white" });
    }
    setTimeout(() => { setShowRecoveryModal(false); }, 2000);
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setFormData({ name: '', lastName: '', email: '', password: '', companyName: '' });
  };

  return (
    <>
      <PasswordRecoveryModal
        isOpen={showRecoveryModal}
        onClose={() => setShowRecoveryModal(false)}
        onRecover={handlePasswordRecovery}
      />
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-kx-bg">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-kx-violet/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-kx-blue/10 rounded-full blur-[100px]" />

        <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in-95 duration-500">
          <div className="bg-kx-surface backdrop-blur-xl rounded-2xl border border-kx-border shadow-2xl p-8">
            <div className="text-center mb-8">
              <div className="inline-block mb-4">
                {config?.logo_base64 ? (
                  <div className="h-24 w-full flex items-center justify-center mb-2 overflow-hidden">
                    <img src={config.logo_base64} alt="Logo" className="max-h-full max-w-[200px] object-contain drop-shadow-lg" />
                  </div>
                ) : (
                  <div className="h-24 w-full flex items-center justify-center mb-2 rounded-2xl bg-[#0A0A0D] border border-kx-border shadow-lg shadow-kx-violet/20 px-6">
                    <img src="/kairox-logo.png" alt="KAIROX" className="max-h-full max-w-[220px] object-contain" />
                  </div>
                )}
              </div>

              <h1 className="text-3xl font-bold mb-2 text-kx-text">
                {config?.nombre_empresa || (isLogin ? 'Bienvenido' : 'Crear Cuenta')}
              </h1>
              <p className="text-kx-text-3">
                {isLogin ? 'Ingresa a tu panel de control' : 'Registra tu empresa y comienza a gestionar'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                  <div className="space-y-4 overflow-hidden">
                    <div className="space-y-2">
                        <Label htmlFor="companyName" className="text-kx-text-2 text-xs uppercase font-bold tracking-wider">Nombre de tu Empresa</Label>
                        <div className="relative group">
                          <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3 group-focus-within:text-kx-violet transition-colors" />
                          <Input
                            id="companyName"
                            name="companyName"
                            value={formData.companyName}
                            onChange={handleChange}
                            className="pl-10 bg-kx-surface-2 border-kx-border text-kx-text focus:border-kx-violet transition-all"
                            placeholder="Mi Negocio S.A."
                            disabled={isLoading}
                          />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="name" className="text-kx-text-2 text-xs uppercase font-bold tracking-wider">Nombre</Label>
                        <div className="relative group">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3 group-focus-within:text-kx-violet transition-colors" />
                          <Input
                            id="name"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            className="pl-10 bg-kx-surface-2 border-kx-border text-kx-text focus:border-kx-violet transition-all"
                            placeholder="Juan"
                            disabled={isLoading}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName" className="text-kx-text-2 text-xs uppercase font-bold tracking-wider">Apellido</Label>
                        <div className="relative group">
                          <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3 group-focus-within:text-kx-violet transition-colors" />
                          <Input
                            id="lastName"
                            name="lastName"
                            value={formData.lastName}
                            onChange={handleChange}
                            className="pl-10 bg-kx-surface-2 border-kx-border text-kx-text focus:border-kx-violet transition-all"
                            placeholder="Pérez"
                            disabled={isLoading}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-kx-text-2 text-xs uppercase font-bold tracking-wider">Email</Label>
                <div className="relative group">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3 group-focus-within:text-kx-violet transition-colors" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleChange}
                    className="pl-10 bg-kx-surface-2 border-kx-border text-kx-text focus:border-kx-violet transition-all"
                    placeholder="usuario@empresa.com"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-kx-text-2 text-xs uppercase font-bold tracking-wider">Contraseña</Label>
                <div className="relative group">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3 group-focus-within:text-kx-violet transition-colors" />
                  <PasswordInput
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    className="pl-10 bg-kx-surface-2 border-kx-border text-kx-text focus:border-kx-violet transition-all"
                    placeholder="••••••••"
                    disabled={isLoading}
                  />
                </div>
              </div>

              {isLogin && (
                <div className="text-right">
                  <button type="button" onClick={() => setShowRecoveryModal(true)} className="text-sm text-kx-text-3 hover:text-kx-violet transition-colors" disabled={isLoading}>
                    Olvidé mi contraseña
                  </button>
                </div>
              )}

              <Button type="submit" disabled={isLoading} className="w-full bg-gradient-to-r from-kx-violet to-kx-blue hover:opacity-90 text-white font-bold py-6 rounded-xl transition-all duration-300 shadow-lg hover:shadow-kx-violet/25 mt-2">
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="flex items-center gap-2 justify-center">{isLogin ? 'Iniciar Sesión' : 'Crear Cuenta'} <ArrowRight className="h-4 w-4" /></span>}
              </Button>
            </form>

            <div className="mt-8 pt-6 border-t border-kx-border text-center">
              <p className="text-kx-text-3 text-sm mb-3">
                {isLogin ? '¿Aún no tienes una cuenta?' : '¿Ya tienes una cuenta registrada?'}
              </p>
              <Button variant="outline" onClick={toggleMode} disabled={isLoading} className="border-kx-border text-kx-text-2 hover:text-kx-text hover:bg-kx-surface-2 w-full">
                {isLogin ? 'Registrarse ahora' : 'Volver al inicio de sesión'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default AuthPage;
