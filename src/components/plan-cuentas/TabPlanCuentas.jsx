import { useState } from 'react';
import { BookOpen, Plus, Search, RefreshCw } from 'lucide-react';
import { planCuentasService } from '@/services/planCuentasService';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { CuentaNode } from './shared';
import ModalNuevaCuenta from './ModalNuevaCuenta';

function TabPlanCuentas({ cuentasFlat, tree, empresaId, onRefresh }) {
  const [search, setSearch]         = useState('');
  const [showModal, setShowModal]   = useState(false);
  const [editCuenta, setEditCuenta] = useState(null);
  const { toast } = useToast();

  const handleSeedCuentas = async () => {
    try {
      await planCuentasService.seedCuentas(empresaId);
      toast({ title: 'Plan de cuentas inicializado', className: 'bg-green-900 border-green-700 text-white' });
      onRefresh();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleToggleActiva = async (cuenta) => {
    try {
      await planCuentasService.updateCuenta(cuenta.id, { activa: !cuenta.activa });
      onRefresh();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  if (cuentasFlat.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <BookOpen size={48} className="text-kx-text-2" />
        <p className="text-kx-text-3 text-lg font-medium">Plan de cuentas vacío</p>
        <p className="text-kx-text-2 text-sm">Podés inicializarlo con las cuentas estándar para PyMEs argentinas</p>
        <Button onClick={handleSeedCuentas} className="bg-[#00D4FF] text-black hover:bg-[#00bfe8] mt-2">
          <RefreshCw size={16} className="mr-2" /> Inicializar Plan Estándar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-kx-text-2" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-kx-surface-2 border-kx-border h-9 text-sm" placeholder="Buscar cuenta..." />
        </div>
        <Button onClick={() => setShowModal(true)} size="sm"
          className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
          <Plus size={14} className="mr-1" /> Nueva cuenta
        </Button>
      </div>

      <div className="rounded-xl border border-kx-border bg-kx-surface/50 overflow-hidden">
        <div className="p-3 space-y-1">
          {tree.map((raiz) => (
            <CuentaNode key={raiz.id} cuenta={raiz} depth={0}
              onEdit={setEditCuenta} search={search} />
          ))}
        </div>
      </div>

      <p className="text-xs text-kx-text-2 text-right">{cuentasFlat.length} cuentas en total</p>

      <ModalNuevaCuenta
        open={showModal}
        onClose={() => setShowModal(false)}
        cuentasFlat={cuentasFlat}
        empresaId={empresaId}
        onSuccess={onRefresh}
      />

      {/* Modal editar cuenta */}
      <Dialog open={!!editCuenta} onOpenChange={() => setEditCuenta(null)}>
        <DialogContent className="bg-kx-surface border-kx-border text-kx-text max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar Cuenta</DialogTitle>
            <DialogDescription>Modificá el nombre y estado de la cuenta contable.</DialogDescription>
          </DialogHeader>
          {editCuenta && (
            <div className="space-y-3 py-2">
              <div>
                <Label className="text-kx-text-3 text-xs">Nombre</Label>
                <Input value={editCuenta.nombre}
                  onChange={(e) => setEditCuenta({ ...editCuenta, nombre: e.target.value })}
                  className="bg-kx-surface-2 border-kx-border" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editCuenta.activa}
                  onChange={(e) => setEditCuenta({ ...editCuenta, activa: e.target.checked })}
                  className="w-4 h-4 rounded" />
                <span className="text-sm text-kx-text-3">Cuenta activa</span>
              </label>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setEditCuenta(null)} className="text-kx-text-3">Cancelar</Button>
            <Button onClick={async () => {
              try {
                await planCuentasService.updateCuenta(editCuenta.id, {
                  nombre: editCuenta.nombre, activa: editCuenta.activa,
                });
                onRefresh();
                setEditCuenta(null);
              } catch (e) {
                toast({ title: 'Error', description: e.message, variant: 'destructive' });
              }
            }} className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TabPlanCuentas;
