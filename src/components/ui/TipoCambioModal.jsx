import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { tipoCambioService } from '@/services/tipoCambioService';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { useToast } from '@/components/ui/use-toast';
import { TrendingUp, Loader2 } from 'lucide-react';

/**
 * Modal obligatorio para cargar el tipo de cambio del día.
 * Se abre automáticamente cuando se selecciona una moneda extranjera
 * y no hay TC registrado para hoy.
 *
 * Props:
 *   open         — bool
 *   onOpenChange — fn(bool)
 *   moneda       — string ('USD', 'EUR', ...)
 *   onConfirm    — fn(tasa: number) — llamado DESPUÉS de guardar en DB
 */
export function TipoCambioModal({ open, onOpenChange, moneda, onConfirm }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tasa, setTasa] = useState('');
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    // Acepta cualquier formato: 1668.21 / 1668,21 / 1.668,21 / 1,668.21
    const t = parseNumberLocale(tasa);
    if (!t || t <= 0) {
      toast({ title: 'Ingresá una tasa válida mayor a cero', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await tipoCambioService.upsert(user.empresa_id, user.id, moneda, t);
      toast({
        title: `Tipo de cambio guardado`,
        description: `1 ${moneda} = $${t.toLocaleString('es-AR')} ARS — válido para todo el día.`,
        className: 'bg-green-600 text-white border-green-700',
      });
      onConfirm(t);
      setTasa('');
    } catch (e) {
      toast({ title: 'Error guardando tipo de cambio', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const todayLabel = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setTasa('');
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-sm dark:bg-slate-950 dark:border-slate-800">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-white">
            <TrendingUp className="h-5 w-5 text-blue-500" />
            Tipo de Cambio del Día
          </DialogTitle>
          <DialogDescription className="dark:text-slate-400">
            No hay tipo de cambio registrado para <strong>{moneda}</strong> hoy
            ({todayLabel}). Ingresalo una sola vez y se usará automáticamente en todas
            las operaciones del día.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Label className="dark:text-slate-300">
            1 {moneda} = ? ARS
          </Label>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="ej. 1.446,50 ó 1446"
            value={tasa}
            onChange={e => {
              // Permitir solo dígitos, coma y punto
              const v = e.target.value.replace(/[^\d.,]/g, '');
              setTasa(v);
            }}
            onKeyDown={e => e.key === 'Enter' && !saving && handleConfirm()}
            autoFocus
            className="dark:bg-slate-900 dark:border-slate-700 dark:text-white text-lg h-12"
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Tip: usá el tipo de cambio vendedor del día (ej. dólar blue vendedor).
            <br />
            Formato argentino: <strong>punto</strong> = miles, <strong>coma</strong> = decimal.
            Ej: <code>1.446,50</code> ó <code>1446</code>.
          </p>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1 dark:border-slate-700 dark:text-slate-300"
            onClick={() => {
              setTasa('');
              onOpenChange(false);
            }}
          >
            Cancelar
          </Button>
          <Button
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            onClick={handleConfirm}
            disabled={saving || !tasa}
          >
            {saving && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
            Confirmar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
