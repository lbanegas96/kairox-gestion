import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, Loader2, CheckCircle2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';

function ResetPasswordPage({ onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      toast({ title: 'Contraseña muy corta', description: 'Debe tener al menos 6 caracteres.', variant: 'destructive' });
      return;
    }
    if (password !== confirm) {
      toast({ title: 'Las contraseñas no coinciden', variant: 'destructive' });
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast({ title: 'Error al actualizar', description: error.message, variant: 'destructive' });
    } else {
      setDone(true);
      // Cerrar sesión para que el usuario haga login con la nueva contraseña
      await supabase.auth.signOut();
      setTimeout(() => {
        window.history.replaceState(null, '', window.location.pathname);
        onDone();
      }, 2500);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-[#0F172A]">
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-[#00D4FF]/10 rounded-full blur-[100px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-[#A855F7]/10 rounded-full blur-[100px]" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-800 shadow-2xl p-8">
          {done ? (
            <div className="text-center py-6 space-y-4">
              <CheckCircle2 className="h-16 w-16 text-green-400 mx-auto" />
              <h2 className="text-2xl font-bold text-white">¡Contraseña actualizada!</h2>
              <p className="text-slate-400">Redirigiendo al sistema...</p>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <div className="p-3 rounded-2xl bg-gradient-to-br from-[#00D4FF]/20 to-[#A855F7]/20 border border-slate-700 mx-auto w-fit mb-4">
                  <div className="w-10 h-10 bg-gradient-to-br from-[#00D4FF] to-[#A855F7] rounded-xl flex items-center justify-center shadow-lg">
                    <Lock className="text-white h-6 w-6" />
                  </div>
                </div>
                <h1 className="text-3xl font-bold text-white mb-2">Nueva Contraseña</h1>
                <p className="text-slate-400">Ingresá tu nueva contraseña para acceder al sistema</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="new-password" className="text-slate-300 text-xs uppercase font-bold tracking-wider">
                    Nueva contraseña
                  </Label>
                  <div className="relative group">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-[#00D4FF] transition-colors" />
                    <Input
                      id="new-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 bg-slate-950/50 border-slate-800 text-white focus:border-[#00D4FF] transition-all"
                      placeholder="Mínimo 6 caracteres"
                      disabled={loading}
                      autoFocus
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-slate-300 text-xs uppercase font-bold tracking-wider">
                    Confirmar contraseña
                  </Label>
                  <div className="relative group">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-[#00D4FF] transition-colors" />
                    <Input
                      id="confirm-password"
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className="pl-10 bg-slate-950/50 border-slate-800 text-white focus:border-[#00D4FF] transition-all"
                      placeholder="Repetir contraseña"
                      disabled={loading}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-[#00D4FF] to-[#A855F7] hover:opacity-90 text-white font-bold py-6 rounded-xl transition-all duration-300 shadow-lg mt-2"
                >
                  {loading
                    ? <Loader2 className="h-5 w-5 animate-spin" />
                    : <span className="flex items-center gap-2 justify-center">Guardar contraseña <ArrowRight className="h-4 w-4" /></span>
                  }
                </Button>
              </form>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default ResetPasswordPage;
