import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';

function ConfigUalaModal({ open, onOpenChange, integracion, onSuccess }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [cuentaBancariaId, setCuentaBancariaId] = useState('');
  const [cuentas,          setCuentas]          = useState([]);
  const [guardando,        setGuardando]        = useState(false);

  useEffect(() => {
    if (!open || !user?.empresa_id) return;
    setCuentaBancariaId(integracion?.cuenta_bancaria_id ?? '');

    supabase
      .from('cuentas_bancarias')
      .select('id, nombre, banco')
      .eq('empresa_id', user.empresa_id)
      .eq('activo', true)
      .order('nombre')
      .then(({ data }) => setCuentas(data ?? []));
  }, [open, user?.empresa_id, integracion]);

  const handleGuardar = async () => {
    if (!cuentaBancariaId) {
      toast({ title: 'Seleccioná una cuenta bancaria', variant: 'destructive' });
      return;
    }
    setGuardando(true);
    try {
      const { error } = await supabase
        .from('integraciones_bancarias')
        .upsert(
          {
            empresa_id:         user.empresa_id,
            proveedor:          'uala',
            cuenta_bancaria_id: cuentaBancariaId,
            activo:             true,
          },
          { onConflict: 'empresa_id,proveedor' }
        );

      if (error) throw error;

      toast({ title: '✓ Ualá conectado correctamente', className: 'bg-green-600 text-white border-green-700' });
      onSuccess?.();
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-kx-surface border-kx-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-kx-text">
            <div className="w-7 h-7 rounded-lg bg-violet-500 flex items-center justify-center text-white text-sm shrink-0">
              💳
            </div>
            Conectar Ualá (conciliación)
          </DialogTitle>
          <DialogDescription>
            Las transferencias que el Apps Script sincroniza desde Gmail se van a registrar automáticamente en esta cuenta bancaria, no en la Caja.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-sm font-medium text-kx-text">
            ¿Qué cuenta bancaria representa tu Ualá?
          </p>
          {cuentas.length === 0 ? (
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-400">
              Primero creá una cuenta bancaria en el módulo Bancos (ej. "Ualá") y después volvé a configurar esto.
            </div>
          ) : (
            <Select value={cuentaBancariaId} onValueChange={setCuentaBancariaId}>
              <SelectTrigger className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text">
                <SelectValue placeholder="Seleccionar cuenta..." />
              </SelectTrigger>
              <SelectContent>
                {cuentas.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre}{c.banco ? ` — ${c.banco}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-kx-text-3">
            Hasta que no configures esto, las transferencias de Ualá se siguen sincronizando en "Movimientos Ualá" pero no impactan ninguna cuenta bancaria.
          </p>
        </div>

        <div className="flex gap-2 justify-end pt-2 border-t border-kx-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={handleGuardar}
            disabled={guardando || !cuentaBancariaId}
            className="bg-violet-500 hover:bg-violet-600 text-white"
          >
            {guardando
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</>
              : '✓ Guardar configuración'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ConfigUalaModal;
