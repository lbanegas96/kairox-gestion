import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { revalorizacionInventarioService } from '@/services/revalorizacionInventarioService';

function ModalNuevaRevalorizacion({ open, onOpenChange, categories, onCreated }) {
  const { toast } = useToast();
  const [categoriaId, setCategoriaId] = useState('todas');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCrear = async () => {
    setIsSubmitting(true);
    try {
      const id = await revalorizacionInventarioService.crear(categoriaId === 'todas' ? null : categoriaId);
      toast({ title: 'Revalorización creada', description: 'Se generó la hoja con el costo actual del sistema.' });
      onCreated(id);
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border">
        <DialogHeader>
          <DialogTitle>Nueva Revalorización de Inventario</DialogTitle>
          <DialogDescription>
            Congela el costo actual de los productos elegidos — el costo nuevo se carga después,
            en el detalle de la revalorización. No mueve stock, solo valor.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label>Alcance</Label>
          <Select value={categoriaId} onValueChange={setCategoriaId}>
            <SelectTrigger className="bg-kx-surface dark:bg-kx-bg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todo el catálogo activo</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCrear} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generar hoja de revalorización
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalNuevaRevalorizacion;
