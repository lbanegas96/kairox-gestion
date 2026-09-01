import { useState } from 'react';

import { Lock, Mail, User, UserCircle, ArrowRight, Loader2, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { validatePasswordBasic } from '@/lib/securityUtils';
import PasswordRecoveryModal from '@/components/PasswordRecoveryModal';

// ── Login con Google ─────────────────────────────────────────────────────────
// El código del botón está completo y probado, pero el proveedor Google
// TODAVÍA NO está habilitado en el proyecto de Supabase — verificado en vivo
// (01/09): /auth/v1/authorize?provider=google responde 400 en vez de redirigir
// a Google. Con el botón visible, cualquiera que lo tocara vería un error.
//
// PARA ACTIVARLO (decisión de Nadia, 01/09 — dejarlo listo pero oculto):
//   1. Google Cloud Console → crear credenciales OAuth 2.0 (tipo "Aplicación
//      web"), con este URI de redirección autorizado:
//      https://isvkelrdxwvkfmrfqxxk.supabase.co/auth/v1/callback
//   2. Supabase → Authentication → Providers → Google: pegar Client ID y
//      Client Secret, y habilitarlo.
//   3. Cambiar esta constante a `true` y desplegar.
//
// OJO — alcance a propósito: el botón se muestra SOLO en modo login, nunca en
// el registro. `handle_new_user` (mig.000) crea el profile con empresa_id=NULL
// y el self-heal que llama a create_tenant (SupabaseAuthContext) necesita
// `nombre_empresa` en user_metadata, dato que un alta por Google no aporta —
// un usuario nuevo por esa vía quedaría logueado pero sin empresa, sin poder
// hacer nada. Para entrar a una cuenta que YA existe funciona perfecto.
const GOOGLE_LOGIN_HABILITADO = false;

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

  // Login con Google (OAuth) — ver GOOGLE_LOGIN_HABILITADO arriba.
  const handleGoogleLogin = async () => {
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setIsLoading(false);
      toast({
        title: 'No se pudo iniciar sesión con Google',
        description: error.message,
        variant: 'destructive',
      });
    }
    // Si sale bien, el navegador redirige a Google — no hace falta apagar el
    // loading (la página se va a desmontar).
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
        {/* Textura de grilla fina — mismo recurso que usan los dashboards SaaS
            premium (Linear, Vercel, Stripe) para dar profundidad sin ruido
            visual. Opacidad muy baja a propósito, es textura, no un patrón
            que compita con el contenido. */}
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgb(var(--kx-text)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--kx-text)) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />
        <div className="absolute top-[-12%] left-[-8%] w-[520px] h-[520px] bg-kx-violet/10 rounded-full blur-[110px]" />
        <div className="absolute bottom-[-12%] right-[-8%] w-[520px] h-[520px] bg-kx-blue/10 rounded-full blur-[110px]" />
        <div className="absolute top-[45%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[380px] h-[380px] bg-kx-violet/5 rounded-full blur-[130px]" />

        {/* flex-col agrupa tarjeta + crédito como una sola columna centrada —
            el crédito vive en el flujo normal (no `fixed`) a propósito:
            hallazgo real probándolo (01/09) — `fixed bottom-4` quedaba pisado
            por el propio formulario en pantallas bajas (el modo "Crear
            Cuenta" es más alto que el viewport) y por el widget flotante de
            chat que ya vive fijo en esa misma esquina. En flujo normal nunca
            compite con nada: si la tarjeta no entra, se scrollea junto con
            todo lo demás. */}
        <div className="w-full max-w-lg relative z-10 flex flex-col items-center gap-5">
        <div className="w-full animate-in fade-in zoom-in-95 duration-500">
          {/* Borde con gradiente sutil (truco de 1px de padding) — el detalle
              que separa una tarjeta "de plantilla" de una que se ve diseñada
              a propósito. */}
          <div className="rounded-[28px] p-px bg-gradient-to-br from-kx-violet/40 via-kx-border to-kx-blue/40 shadow-2xl shadow-black/20">
            <div className="bg-kx-surface/95 backdrop-blur-xl rounded-[27px] p-8 sm:p-10">
              <div className="text-center mb-8">
                {/* Lockup de marca — pedido de Nadia (01/09): en el login va
                    SIEMPRE el wordmark de KAIROX, nunca el logo del inquilino.
                    Antes esto era `config?.logo_base64 ? <img/> : <wordmark/>`
                    y, como Nalux (y cualquier empresa que ya cargó su logo)
                    tiene ese campo seteado, seguía viendo su propia imagen —
                    por eso Nadia no veía ningún cambio en producción. El login
                    es la cara del PRODUCTO, no la del inquilino: el logo de la
                    empresa sigue apareciendo dentro de la app (sidebar, ticket,
                    PDFs). Jerarquía interna: "Kairox IA" (marca) + "Gestión"
                    (línea de producto), separados por una regla fina — mismo
                    recurso que los lockups de Linear/Vercel. `group` + hover:
                    el gradiente se desplaza y el glow de atrás se intensifica,
                    haciendo eco del blur del fondo. */}
                  <div className="mb-7 select-none flex justify-center">
                    <div className="group relative inline-flex flex-col items-center cursor-default">
                      {/* Glow detrás del wordmark — invisible en reposo,
                          aparece y se expande al hover. Opacidad alta a
                          propósito: pasa por un blur-3xl, así que lo que se
                          ve es un halo difuso, no un bloque de color. */}
                      <div
                        aria-hidden="true"
                        className="absolute -inset-x-10 -inset-y-6 rounded-full bg-gradient-to-r from-kx-violet/60 via-kx-blue/50 to-kx-violet/60 blur-3xl opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-500 pointer-events-none"
                      />
                      <span
                        className="relative text-4xl sm:text-[2.75rem] font-extrabold tracking-tight leading-none bg-gradient-to-r from-kx-violet via-kx-blue to-kx-violet bg-clip-text text-transparent transition-all duration-500"
                        style={{ backgroundSize: '200% auto', backgroundPosition: '0% center' }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundPosition = '100% center'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundPosition = '0% center'; }}
                      >
                        Kairox IA
                      </span>
                      <div className="relative mt-2.5 flex items-center gap-2.5">
                        <span className="h-px w-6 bg-gradient-to-r from-transparent to-kx-border group-hover:to-kx-violet/60 transition-colors duration-500" />
                        <span className="text-[11px] font-semibold uppercase tracking-[0.4em] text-kx-text-3 group-hover:text-kx-text-2 transition-colors duration-500">
                          Gestión
                        </span>
                        <span className="h-px w-6 bg-gradient-to-l from-transparent to-kx-border group-hover:to-kx-blue/60 transition-colors duration-500" />
                      </div>
                    </div>
                  </div>

                <p className="text-kx-text-2 text-[15px]">
                  {isLogin ? 'Ingresá a tu panel de control' : 'Registrá tu empresa y comenzá a gestionar'}
                </p>
              </div>

            {/* Login con Google — arriba del formulario, patrón estándar en
                SaaS (Linear, Notion, Vercel): la vía más rápida primero, el
                formulario de email como alternativa. Sólo en modo login (ver
                el comentario de GOOGLE_LOGIN_HABILITADO arriba, que explica
                también por qué está apagado por ahora). */}
            {GOOGLE_LOGIN_HABILITADO && isLogin && (
              <div className="mb-6">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isLoading}
                  className="w-full h-12 rounded-xl border border-kx-border bg-kx-surface-2 hover:bg-kx-border/40 text-kx-text font-medium flex items-center justify-center gap-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {/* Logo oficial de Google (4 colores) */}
                  <svg className="h-[18px] w-[18px] flex-shrink-0" viewBox="0 0 18 18" aria-hidden="true">
                    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
                    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
                    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
                    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
                  </svg>
                  Continuar con Google
                </button>

                <div className="flex items-center gap-3 mt-6">
                  <span className="h-px flex-1 bg-kx-border" />
                  <span className="text-[11px] uppercase tracking-widest text-kx-text-3">o con tu email</span>
                  <span className="h-px flex-1 bg-kx-border" />
                </div>
              </div>
            )}

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

        {/* Crédito de marca — pedido de Nadia (01/09): chico, debajo de la
            tarjeta, en flujo normal (ver comentario más arriba de por qué no
            es `fixed`). */}
        <div className="flex items-center justify-center gap-2">
          <div className="h-5 w-5 rounded-md overflow-hidden ring-1 ring-kx-border/60 flex-shrink-0">
            <img src="/kairox-logo.png" alt="" className="h-full w-full object-cover" />
          </div>
          <span className="text-[11px] text-kx-text-3 tracking-wide">
            Hecho por <span className="font-semibold text-kx-text-2">Kairox IA</span>
          </span>
        </div>
        </div>
      </div>
    </>
  );
}

export default AuthPage;
