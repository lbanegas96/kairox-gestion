import { Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Hallazgo Luciano 11/09 (mismo patrón repetitivo, ver CONTEXT.md — este es
// el 3/10, genera asiento vía crearAsientoAjusteStock): el modal se cerraba
// solo apenas el movimiento se registraba, sin mostrar nada. `resultado`
// (controlado por ProductosSection) reemplaza el formulario por un resumen
// hasta que el usuario cierra a propósito.
function ModalMovimiento({
  isMovimientoOpen, setIsMovimientoOpen,
  selectedProductForMov,
  movimientoForm, setMovimientoForm,
  handleSubmitMovimiento,
  isSubmitting,
  resultado,
  onCerrarResultado,
}) {
  return (
    <Dialog open={isMovimientoOpen} onOpenChange={setIsMovimientoOpen}>
      <DialogContent className="sm:max-w-[425px] bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border">
         <DialogHeader>
           <DialogTitle>Registrar Movimiento</DialogTitle>
           <DialogDescription>
             {resultado
               ? 'Movimiento confirmado.'
               : <>Ajuste de stock para: <strong>{selectedProductForMov?.nombre}</strong></>}
           </DialogDescription>
         </DialogHeader>

         {resultado ? (
           <div className="py-2 space-y-4">
             <div className="flex items-center gap-3">
               <Check className="h-8 w-8 shrink-0 text-[rgb(var(--kx-green))]" />
               <div>
                 <p className="font-semibold text-kx-text">Movimiento registrado</p>
                 <p className="text-sm text-kx-text-2">{resultado.productoNombre}</p>
               </div>
             </div>
             <div className="border border-kx-border rounded-lg divide-y divide-kx-border text-sm">
               <div className="flex items-center justify-between px-3 py-2">
                 <span className="text-kx-text-2">Variación de stock</span>
                 <span className={`font-mono font-semibold ${resultado.delta >= 0 ? 'text-[rgb(var(--kx-green))]' : 'text-kx-red'}`}>
                   {resultado.delta > 0 ? '+' : ''}{resultado.delta} u.
                 </span>
               </div>
               <div className="flex items-center justify-between px-3 py-2">
                 <span className="text-kx-text-2">Costo unitario</span>
                 <span className="font-mono text-kx-text">${Number(resultado.costoUnitario).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
               </div>
             </div>
             <DialogFooter>
               <Button onClick={onCerrarResultado}>Cerrar</Button>
             </DialogFooter>
           </div>
         ) : (
         <form onSubmit={handleSubmitMovimiento} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Tipo de Movimiento</Label>
              <Select
                value={movimientoForm.tipo}
                onValueChange={val=>setMovimientoForm({...movimientoForm, tipo:val})}
              >
                <SelectTrigger className="bg-kx-surface dark:bg-kx-bg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada (Compra/Devolución)</SelectItem>
                  <SelectItem value="salida">Salida (Venta/Pérdida)</SelectItem>
                  <SelectItem value="ajuste">Ajuste (Inventario Físico)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Cantidad</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={movimientoForm.cantidad}
                onChange={e=>setMovimientoForm({...movimientoForm, cantidad:e.target.value.replace(/[^\d]/g, '')})}
                placeholder="0"
                required
                className="bg-kx-surface dark:bg-kx-bg font-mono text-lg"
              />
            </div>

            <div className="space-y-2">
              <Label>Motivo / Observación</Label>
              <Input
                value={movimientoForm.motivo}
                onChange={e=>setMovimientoForm({...movimientoForm, motivo:e.target.value})}
                placeholder="Ej: Compra mensual, Rotura, etc."
                className="bg-kx-surface dark:bg-kx-bg"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsMovimientoOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar
              </Button>
            </DialogFooter>
         </form>
         )}
      </DialogContent>
    </Dialog>
  );
}

export default ModalMovimiento;
