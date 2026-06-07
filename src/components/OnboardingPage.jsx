import React, { useState } from 'react';

import { Building2, User, UserCircle, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';

function OnboardingPage() {
  const { user, refreshUser, signOut } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    nombre_empresa: user?.user_metadata?.nombre_empresa || '',
    first_name: user?.user_metadata?.first_name || user?.first_name || '',
    last_name: user?.user_metadata?.last_name || user?.last_name || '',
  });

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.nombre_empresa.trim()) {
      toast({ title: 'Nombre requerido', description: 'Por favor ingresá el nombre de tu empresa.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('create_tenant', {
        p_nombre_empresa: formData.nombre_empresa.trim(),
        p_first_name: formData.first_name.trim(),
        p_last_name: formData.last_name.trim(),
      });

      if (error) throw error;

      toast({
        title: '¡Empresa creada!',
        description: `Bienvenido a ${formData.nombre_empresa}. Preparando tu panel...`,
        className: 'bg-green-600 text-white border-green-700',
      });

      await refreshUser();
    } catch (err) {
      console.error('Error creando tenant:', err);
      toast({
        title: 'Error al crear la empresa',
        description: err.message || 'Ocurrió un problema. Intentá de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-[#0F172A]">
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-[#00D4FF]/10 rounded-full blur-[100px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-[#A855F7]/10 rounded-full blur-[100px]" />

      <div className="w-full max-w-md relative z-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-800 shadow-2xl p-8">
          <div className="text-center mb-8">
            <div className="inline-flex p-3 rounded-2xl bg-gradient-to-br from-[#00D4FF]/20 to-[#A855F7]/20 border border-slate-700 mb-4">
              <Sparkles className="w-10 h-10 text-[#00D4FF]" />
            </div>

            <h1 className="text-3xl font-bold text-white mb-2">Configurá tu empresa</h1>
            <p className="text-slate-400 text-sm">
              Un último paso antes de entrar a tu panel.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="nombre_empresa" className="text-slate-300 text-xs uppercase font-bold tracking-wider">
                Nombre de la Empresa *
              </Label>
              <div className="relative group">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-[#00D4FF] transition-colors" />
                <Input
                  id="nombre_empresa"
                  name="nombre_empresa"
                  value={formData.nombre_empresa}
                  onChange={handleChange}
                  className="pl-10 bg-slate-950/50 border-slate-800 text-white focus:border-[#00D4FF] transition-all"
                  placeholder="Mi Empresa S.A."
                  disabled={loading}
                  autoFocus
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="first_name" className="text-slate-300 text-xs uppercase font-bold tracking-wider">
                  Tu Nombre
                </Label>
                <div className="relative group">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-[#00D4FF] transition-colors" />
                  <Input
                    id="first_name"
                    name="first_name"
                    value={formData.first_name}
                    onChange={handleChange}
                    className="pl-10 bg-slate-950/50 border-slate-800 text-white focus:border-[#00D4FF] transition-all"
                    placeholder="Juan"
                    disabled={loading}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name" className="text-slate-300 text-xs uppercase font-bold tracking-wider">
                  Tu Apellido
                </Label>
                <div className="relative group">
                  <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-[#00D4FF] transition-colors" />
                  <Input
                    id="last_name"
                    name="last_name"
                    value={formData.last_name}
                    onChange={handleChange}
                    className="pl-10 bg-slate-950/50 border-slate-800 text-white focus:border-[#00D4FF] transition-all"
                    placeholder="Pérez"
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-[#00D4FF] to-[#A855F7] hover:opacity-90 text-white font-bold py-6 rounded-xl transition-all duration-300 shadow-lg hover:shadow-[#00D4FF]/25 mt-2"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <span className="flex items-center gap-2 justify-center">
                  Crear mi empresa <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={signOut}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              disabled={loading}
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OnboardingPage;
