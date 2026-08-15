import { useEffect, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2, Copy } from 'lucide-react';

// Diálogo de confirmación compartido para "Duplicar documento" (definiciones de
// Luciano, 14/08): se crea un documento nuevo con fecha de hoy y numeración
// propia, copiando todos los datos del original. El usuario elige si además
// quiere que el duplicado quede vinculado al original en el Mapa de Relaciones
// (columna duplicado_de_id, mig.327) — por defecto sí, porque es el caso más
// común (repetir un pedido reciente, corregir un error de tipeo, etc.).
//
// Reutilizado por Cotización/Pedido/OC/Factura de Venta/Factura de Compra/NC/ND
// — cada sección arma su propio handler de creación, este componente solo junta
// la confirmación + el toggle de vínculo.
function ConfirmDuplicarDialog({ open, onOpenChange, tipoLabel, numero, onConfirm, loading = false }) {
  const [vincular, setVincular] = useState(true);

  useEffect(() => {
    if (open) setVincular(true);
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={v => { if (!loading) onOpenChange(v); }}>
      <AlertDialogContent className="dark:bg-kx-bg dark:border-kx-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="dark:text-kx-text flex items-center gap-2">
            <Copy className="w-4 h-4 text-kx-violet" /> ¿Duplicar {tipoLabel} {numero}?
          </AlertDialogTitle>
          <AlertDialogDescription className="dark:text-kx-text-2">
            Se crea un documento nuevo con la fecha de hoy y numeración propia — mismos ítems,
            precios, descuentos e IVA que el original.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-start gap-3 p-3 bg-kx-surface-2 dark:bg-kx-surface rounded-lg border border-kx-border">
          <Checkbox
            id="duplicar-vincular"
            checked={vincular}
            onCheckedChange={setVincular}
            className="mt-0.5"
            disabled={loading}
          />
          <Label htmlFor="duplicar-vincular" className="cursor-pointer text-sm dark:text-kx-text">
            Vincular el duplicado con el original en el Mapa de Relaciones
          </Label>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading} className="dark:text-kx-text dark:border-kx-border">
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm(vincular)}
            disabled={loading}
            className="bg-kx-violet hover:opacity-90 text-white gap-2"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Duplicando...</>
              : <><Copy className="w-4 h-4" /> Duplicar</>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ConfirmDuplicarDialog;
