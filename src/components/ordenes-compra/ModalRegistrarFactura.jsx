import { Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';

function ModalRegistrarFactura({
  facturaModal, setFacturaModal,
  facturaForm, setFacturaForm,
  detalle,
  handleRegistrarFactura,
  registrarFacturaMutation,
}) {
  return (
    <Dialog open={facturaModal} onOpenChange={setFacturaModal}>
      <DialogContent className="max-w-md dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader>
          <DialogTitle className="dark:text-kx-text flex items-center gap-2">
            <Receipt className="w-5 h-5 text-indigo-600 dark:text-indigo-500" />
            Registrar Factura — OC {detalle?.numero}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            Completá los datos de la factura recibida del proveedor.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleRegistrarFactura} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">N° de Factura *</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-kx-text"
                placeholder="ej: A-0001-00012345"
                value={facturaForm.numero_factura}
                onChange={e => setFacturaForm(p => ({ ...p, numero_factura: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Fecha Factura *</label>
              <input type="date"
                className="mt-1 w-full rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-kx-text dark:[color-scheme:dark]"
                value={facturaForm.fecha_factura}
                onChange={e => setFacturaForm(p => ({ ...p, fecha_factura: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Vencimiento</label>
              <input type="date"
                className="mt-1 w-full rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-kx-text dark:[color-scheme:dark]"
                value={facturaForm.fecha_vencimiento}
                onChange={e => setFacturaForm(p => ({ ...p, fecha_vencimiento: e.target.value }))}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Monto Total Facturado *</label>
              <input type="text" inputMode="decimal"
                className="mt-1 w-full rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-kx-text"
                placeholder="0,00"
                value={facturaForm.monto_total}
                onChange={e => setFacturaForm(p => ({ ...p, monto_total: e.target.value }))}
                required
              />
              <p className="text-xs text-kx-text-3 mt-1">Pre-cargado con el total de lo recibido. Ajustá si el proveedor facturó diferente.</p>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Notas</label>
              <textarea
                className="mt-1 w-full rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-kx-text resize-none"
                rows={2}
                placeholder="Observaciones opcionales..."
                value={facturaForm.notas}
                onChange={e => setFacturaForm(p => ({ ...p, notas: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFacturaModal(false)} className="dark:border-kx-border dark:text-slate-300">Cancelar</Button>
            <Button type="submit" disabled={registrarFacturaMutation.isPending}>
              {registrarFacturaMutation.isPending ? 'Guardando...' : 'Registrar Factura'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ModalRegistrarFactura;
