import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';

function ConectarTiendanubeModal({ open, onOpenChange }) {
  const { toast } = useToast();
  const [conectando, setConectando] = useState(false);

  const handleConectar = async () => {
    setConectando(true);
    try {
      const { data, error } = await supabase.functions.invoke('integraciones-oauth-iniciar', {
        body: { canal: 'tiendanube' },
      });
      if (error || !data?.authorize_url) {
        toast({ title: 'No se pudo iniciar la conexión', description: data?.error ?? error?.message, variant: 'destructive' });
        setConectando(false);
        return;
      }
      // Navegación completa (no fetch): Tiendanube necesita mostrarle al merchant
      // su propia pantalla de autorización antes de volver a integraciones-oauth-callback.
      window.location.href = data.authorize_url;
    } catch (e) {
      toast({ title: 'No se pudo iniciar la conexión', description: e.message, variant: 'destructive' });
      setConectando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-kx-surface border-kx-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-kx-text">
            <div className="w-7 h-7 rounded-lg bg-[#00C7B1] flex items-center justify-center text-white font-bold text-xs shrink-0">
              TN
            </div>
            Conectar Tiendanube
          </DialogTitle>
          <DialogDescription>
            Vas a ser redirigido a Tiendanube para autorizar la conexión. Al volver, vas a poder mapear tus productos y empezar a recibir pedidos automáticamente en KAIROX.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 justify-end pt-2 border-t border-kx-border">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={conectando}>Cancelar</Button>
          <Button onClick={handleConectar} disabled={conectando} className="bg-[#00C7B1] hover:bg-[#00a894] text-white">
            {conectando
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Redirigiendo...</>
              : <><ExternalLink className="w-4 h-4 mr-2" /> Ir a Tiendanube</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ConectarTiendanubeModal;
