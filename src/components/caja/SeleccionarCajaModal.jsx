import { Landmark } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCaja } from '@/contexts/CajaContext';

// Multi-caja simultánea. Sólo aparece cuando la empresa tiene 2+ cajas
// activas y este dispositivo/navegador todavía no tiene ninguna elegida (o
// la que tenía guardada fue desactivada) — con 1 sola caja (caso de la
// inmensa mayoría de empresas) needsCajaSelection nunca pasa a true. No es
// cerrable haciendo click afuera: el cajero tiene que elegir para operar.
function SeleccionarCajaModal() {
  const { needsCajaSelection, availableCajas, selectCaja } = useCaja();

  return (
    <Dialog open={needsCajaSelection}>
      <DialogContent
        className="max-w-sm bg-kx-surface border-kx-border text-kx-text"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="w-5 h-5 text-kx-violet" /> Elegí tu caja
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            Este local tiene más de una caja activa. Elegí con cuál vas a trabajar en este
            dispositivo — se recuerda para la próxima vez.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {availableCajas.map((c) => (
            <Button
              key={c.id}
              variant="outline"
              className="w-full justify-start h-11 text-sm"
              onClick={() => selectCaja(c.id)}
            >
              <Landmark className="w-4 h-4 mr-2 text-kx-text-3" /> {c.nombre}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SeleccionarCajaModal;
