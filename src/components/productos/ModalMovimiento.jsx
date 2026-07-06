import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function ModalMovimiento({
  isMovimientoOpen, setIsMovimientoOpen,
  selectedProductForMov,
  movimientoForm, setMovimientoForm,
  handleSubmitMovimiento,
  isSubmitting,
}) {
  return (
    <Dialog open={isMovimientoOpen} onOpenChange={setIsMovimientoOpen}>
      <DialogContent className="sm:max-w-[425px] bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border">
         <DialogHeader>
           <DialogTitle>Registrar Movimiento</DialogTitle>
           <DialogDescription>Ajuste de stock para: <strong>{selectedProductForMov?.nombre}</strong></DialogDescription>
         </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}

export default ModalMovimiento;
