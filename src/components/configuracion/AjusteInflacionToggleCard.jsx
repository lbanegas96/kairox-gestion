import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { useAjusteInflacionHabilitado } from '@/hooks/useAjusteInflacionHabilitado';
import { supabase } from '@/lib/customSupabaseClient';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import IndicesInflacionCard from './IndicesInflacionCard';

// Fase 5 (interruptor comercial, mig.383) — modelo "mixto" elegido por
// Luciano: el toggle es visible para TODAS las empresas, pero activarlo
// muestra un aviso premium (sin cobro automático todavía -- sirve para
// medir interés real antes de montar uno). Gatea Plan de Cuentas (selector
// de naturaleza), esta misma card + índices, Cierre de Ejercicio (botón de
// ajuste), Balance/EERR (toggle moneda homogénea) e Impuestos (calculadora
// impositiva) -- ver useAjusteInflacionHabilitado.
function AjusteInflacionToggleCard() {
  const { user } = useAuth();
  const empresaId = user?.empresa_id;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { habilitado, isLoading } = useAjusteInflacionHabilitado();
  const [showConfirm, setShowConfirm] = useState(false);

  const toggleMutation = useMutation({
    mutationFn: (nuevoValor) =>
      supabase.from('empresas').update({ usa_ajuste_inflacion: nuevoValor }).eq('id', empresaId),
    onSuccess: (_data, nuevoValor) => {
      qc.invalidateQueries({ queryKey: ['usa_ajuste_inflacion', empresaId] });
      toast({
        title: nuevoValor ? 'Ajuste por Inflación activado' : 'Ajuste por Inflación desactivado',
        className: 'bg-green-600 text-white border-none',
      });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const handleToggle = (checked) => {
    if (checked) {
      setShowConfirm(true);
    } else {
      toggleMutation.mutate(false);
    }
  };

  return (
    <>
      <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-violet-50 dark:bg-violet-900/20 rounded-lg mt-0.5">
            <Sparkles className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Ajuste por Inflación</h3>
              <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                PREMIUM
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
              Balance y Estado de Resultados en moneda homogénea (RT 6), asiento de reexpresión al
              cierre de cada período, y calculadora del ajuste impositivo para Ganancias (Ley 27.468).
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-kx-text-3 py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
          </div>
        ) : (
          <div className="flex items-center justify-between p-4 bg-kx-surface-2 dark:bg-slate-900/50 rounded-lg border kairox-border">
            <div>
              <Label className="text-kx-text dark:text-kx-text font-medium">Activar Ajuste por Inflación</Label>
              <p className="text-xs text-slate-500 dark:text-kx-text-2 mt-0.5">
                {habilitado
                  ? 'Activo — el módulo completo está disponible en Plan de Cuentas, Cierre de Ejercicio, Reportes e Impuestos.'
                  : 'Desactivado — es una funcionalidad premium, no incluida por defecto.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {toggleMutation.isPending && <Loader2 className="h-4 w-4 animate-spin text-kx-text-3" />}
              <Switch checked={habilitado} disabled={toggleMutation.isPending} onCheckedChange={handleToggle} />
            </div>
          </div>
        )}
      </div>

      {habilitado && <IndicesInflacionCard />}

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="dark:bg-kx-bg dark:border-kx-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 dark:text-kx-text">
              <Sparkles className="w-4 h-4 text-violet-500" /> Activar funcionalidad Premium
            </AlertDialogTitle>
            <AlertDialogDescription className="dark:text-kx-text-2">
              El Ajuste por Inflación es un módulo premium de KAIROX Gestión — reexpresa tu Balance y
              Estado de Resultados en moneda homogénea, genera el asiento de ajuste automáticamente, y
              calcula el ajuste impositivo para tu Declaración Jurada de Ganancias. Todavía no tiene un
              cobro automático asociado — al activarlo, Kairox IA se va a contactar para coordinar el
              alta comercial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="dark:text-kx-text dark:border-kx-border">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { toggleMutation.mutate(true); setShowConfirm(false); }}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              <Sparkles className="w-4 h-4 mr-2" /> Activar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default AjusteInflacionToggleCard;
