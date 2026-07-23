import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Conectar MercadoLibre (OAuth). Mismo flujo que Tiendanube — dispara
 * integraciones-oauth-iniciar con canal='mercadolibre' y redirige a la pantalla
 * de autorización de MELI. La diferencia (token de 6h + refresh) es toda de
 * backend; para el usuario el flujo es idéntico.
 */
function ConectarMercadoLibreModal({ open, onOpenChange }) {
  const { toast } = useToast();
  const [conectando, setConectando] = useState(false);

  const handleConectar = async () => {
    setConectando(true);
    try {
      const { data, error } = await supabase.functions.invoke('integraciones-oauth-iniciar', {
        body: { canal: 'mercadolibre' },
      });
      if (error || !data?.authorize_url) {
        toast({ title: 'No se pudo iniciar la conexión', description: data?.error ?? error?.message, variant: 'destructive' });
        setConectando(false);
        return;
      }
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
            <div className="w-7 h-7 rounded-lg bg-[#FFE600] flex items-center justify-center text-[#2D3277] font-bold text-xs shrink-0">
              ML
            </div>
            Conectar MercadoLibre
          </DialogTitle>
          <DialogDescription>
            Vas a ser redirigido a MercadoLibre para autorizar la conexión. Al volver, vas a poder mapear tus publicaciones a tus productos de KAIROX.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 justify-end pt-2 border-t border-kx-border">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={conectando}>Cancelar</Button>
          <Button onClick={handleConectar} disabled={conectando} className="bg-[#FFE600] hover:bg-[#f5dd00] text-[#2D3277]">
            {conectando
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Redirigiendo...</>
              : <><ExternalLink className="w-4 h-4 mr-2" /> Ir a MercadoLibre</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ConectarMercadoLibreModal;
