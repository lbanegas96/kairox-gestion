import { Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/currencyUtils';

const ALICUOTAS = [0, 10.5, 21, 27];

function ModalRegistrarFactura({
  facturaModal, setFacturaModal,
  facturaForm, setFacturaForm,
  detalle,
  handleRegistrarFactura,
  registrarFacturaMutation,
}) {
  const items = facturaForm.items || [];

  const updateItem = (idx, field, value) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    setFacturaForm(p => ({ ...p, items: updated }));
  };

  const subtotalNeto = items.reduce((s, i) => s + (Number(i.cantidad) || 0) * (Number(i.costo_unitario_neto) || 0), 0);
  const totalIva = items.reduce((s, i) => s + (Number(i.cantidad) || 0) * (Number(i.costo_unitario_neto) || 0) * (Number(i.alicuota_iva) || 0) / 100, 0);
  const total = subtotalNeto + totalIva;

  return (
    <Dialog open={facturaModal} onOpenChange={setFacturaModal}>
      <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="dark:text-kx-text flex items-center gap-2">
            <Receipt className="w-5 h-5 text-indigo-600 dark:text-indigo-500" />
            Registrar Factura — OC {detalle?.numero}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            Completá lo que factura el proveedor. Los ítems vienen precargados con lo recibido —
            ajustá cantidad, precio neto o alícuota si la factura difiere. Esto crea la deuda en
            Cuenta Corriente del proveedor; el pago se registra después desde Proveedores → Cuenta Corriente.
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
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Fecha Factura *</label>
              <input type="date"
                className="mt-1 w-full rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-kx-text dark:[color-scheme:dark]"
                value={facturaForm.fecha_factura}
                onChange={e => setFacturaForm(p => ({ ...p, fecha_factura: e.target.value }))}
                required
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 block">Ítems facturados</label>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-kx-border">
                  <th className="text-left py-1.5 text-kx-text-3">Producto</th>
                  <th className="text-right py-1.5 text-kx-text-3">Cant.</th>
                  <th className="text-right py-1.5 text-kx-text-3">P. Unit. Neto</th>
                  <th className="text-right py-1.5 text-kx-text-3">IVA</th>
                  <th className="text-right py-1.5 text-kx-text-3">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-kx-border">
                {items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-1.5 dark:text-slate-300">{item.descripcion}</td>
                    <td className="py-1.5 text-right">
                      <input type="number" min="0" step="0.001"
                        className="w-16 text-right rounded border border-slate-300 dark:border-kx-border bg-kx-surface px-1 py-0.5 dark:text-kx-text"
                        value={item.cantidad}
                        onChange={e => updateItem(idx, 'cantidad', e.target.value)}
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <input type="number" min="0" step="0.01"
                        className="w-24 text-right rounded border border-slate-300 dark:border-kx-border bg-kx-surface px-1 py-0.5 dark:text-kx-text"
                        value={item.costo_unitario_neto}
                        onChange={e => updateItem(idx, 'costo_unitario_neto', e.target.value)}
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <select
                        className="rounded border border-slate-300 dark:border-kx-border bg-kx-surface px-1 py-0.5 dark:text-kx-text"
                        value={item.alicuota_iva}
                        onChange={e => updateItem(idx, 'alicuota_iva', e.target.value)}
                      >
                        {ALICUOTAS.map(a => <option key={a} value={a}>{a}%</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 text-right dark:text-kx-text">
                      {formatCurrency((Number(item.cantidad) || 0) * (Number(item.costo_unitario_neto) || 0), 'ARS')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <div className="text-sm space-y-1 text-right">
              <p className="text-kx-text-2">Neto: {formatCurrency(subtotalNeto, 'ARS')}</p>
              <p className="text-kx-text-2">IVA: {formatCurrency(totalIva, 'ARS')}</p>
              <p className="font-bold dark:text-kx-text">Total: {formatCurrency(total, 'ARS')}</p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFacturaModal(false)} className="dark:border-kx-border dark:text-slate-300">Cancelar</Button>
            <Button type="submit" disabled={registrarFacturaMutation.isPending || items.length === 0}>
              {registrarFacturaMutation.isPending ? 'Guardando...' : 'Registrar Factura'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ModalRegistrarFactura;
