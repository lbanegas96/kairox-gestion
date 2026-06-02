import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import AuthPage from '@/components/AuthPage';
import Dashboard from '@/components/Dashboard';
import ResetPasswordPage from '@/components/ResetPasswordPage';
import OnboardingPage from '@/components/OnboardingPage';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { CajaProvider } from '@/contexts/CajaContext';

function App() {
  const { user, loading, signOut, needsPasswordReset, setNeedsPasswordReset } = useAuth();
  const { theme } = useTheme();
  const [longLoad, setLongLoad] = useState(false);
  const { toast } = useToast();

  // Detectar error en el hash (ej: link vencido)
  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = Object.fromEntries(new URLSearchParams(hash));
    if (params.error) {
      const desc = params.error_description?.replace(/\+/g, ' ') || 'El link es inválido o ha expirado.';
      toast({ title: 'Link inválido', description: desc, variant: 'destructive' });
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Debug visualizer for long loading times
  useEffect(() => {
    let timer;
    if (loading) {
      timer = setTimeout(() => setLongLoad(true), 2000);
    } else {
      setLongLoad(false);
    }
    return () => clearTimeout(timer);
  }, [loading]);

  if (loading) {
    return (
      <div className="min-h-screen kairox-bg-base flex flex-col items-center justify-center transition-colors duration-300 gap-6">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-[#00D4FF] border-t-transparent rounded-full animate-spin"></div>
          <div className="kairox-text-primary text-xl font-medium animate-pulse">Cargando KAIROX...</div>
        </div>
        
        {longLoad && (
          <div className="text-sm text-slate-500 dark:text-slate-400 max-w-xs text-center animate-in fade-in slide-in-from-bottom-2">
            Esto está tardando más de lo esperado. <br/>Verificando conexión...
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>KAIROX Gestión - Sistema de Gestión Empresarial</title>
        <meta name="description" content="Sistema completo de gestión empresarial para productos, ventas, compras y caja" />
      </Helmet>
      <div className="min-h-screen kairox-bg-base transition-colors duration-300 text-slate-900 dark:text-slate-100">
        {needsPasswordReset ? (
          <ResetPasswordPage onDone={() => setNeedsPasswordReset(false)} />
        ) : !user ? (
          <AuthPage />
        ) : !user.empresa_id ? (
          <OnboardingPage />
        ) : (
          <CajaProvider>
            <Dashboard user={user} onLogout={signOut} />
          </CajaProvider>
        )}
      </div>
    </>
  );
}

export default App;