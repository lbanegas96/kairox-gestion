import { History } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

// Historial de cambios como Dialog apilado, disparado desde el menú "···"
// del documento — hallazgo Luciano (29/08): antes era una sección colapsable
// dentro del cuerpo del documento, ocupando lugar aunque estuviera cerrada.
// Cada documento sigue armando su propio listado (HistorialItem es
// específico de cada tabla/campos) y solo pasa el contenido como children;
// esto es apenas el shell del Dialog, mismo criterio de apilado que
// MapaRelaciones sobre el detalle del documento.
function HistorialCambiosDialog({ open, onOpenChange, children }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="medium" className="dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-kx-border dark:border-kx-border">
          <DialogTitle className="flex items-center gap-2 dark:text-kx-text">
            <History className="h-5 w-5 text-kx-blue" />
            Historial de cambios
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            Todos los cambios registrados sobre este documento.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-4 space-y-2 text-xs max-h-[60vh] overflow-y-auto">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default HistorialCambiosDialog;
