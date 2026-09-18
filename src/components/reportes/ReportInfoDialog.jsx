import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Botón "i" que se puede pisar sobre cualquier tarjeta de reporte sin abrir
// el reporte en sí (para eso lleva su propio stopPropagation) — pedido de
// Luciano, 18/09: "quiero una I de información en cada reporte que se abra
// al hacer clic y despliegue un cuadro explicando la funcionalidad".
export function ReportInfoButton({ onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title="Qué muestra este reporte"
      className={`p-1.5 rounded-full text-kx-text-3 hover:text-kx-violet hover:bg-kx-violet/10 transition-colors ${className}`}
    >
      <Info className="w-4 h-4" />
    </button>
  );
}

// `ayuda` = { queEs: string, queMuestra: string[], filtros?: string[] }
function ReportInfoDialog({ open, onOpenChange, title, icon, ayuda }) {
  if (!ayuda) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark:bg-kx-bg dark:border-kx-border max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-kx-text">
            {icon}
            {title}
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 pt-1">
            {ayuda.queEs}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {ayuda.queMuestra?.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-kx-text-3 mb-2">Qué muestra</p>
              <ul className="space-y-1.5">
                {ayuda.queMuestra.map((item, i) => (
                  <li key={i} className="text-sm text-kx-text flex items-start gap-2">
                    <span className="text-kx-violet mt-1">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ayuda.filtros?.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-kx-text-3 mb-2">Filtros disponibles</p>
              <ul className="space-y-1.5">
                {ayuda.filtros.map((item, i) => (
                  <li key={i} className="text-sm text-kx-text-2 flex items-start gap-2">
                    <span className="text-kx-text-3 mt-1">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}
            className="border-kx-border text-kx-text-2 hover:bg-kx-surface-2">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReportInfoDialog;
