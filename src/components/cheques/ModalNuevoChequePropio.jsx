import { Plus, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BANCOS_AR, fmt, fmtDate } from './shared';

function ModalNuevoChequePropio({
  open, onOpenChange,
  propioForm, setPropioForm,
  proveedores,
  cuentasBancarias,
  comprasProveedor,
  savingPropio,
  onGuardar,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus size={16} className="text-blue-400" /> Registrar cheque propio emitido
          </DialogTitle>
          <DialogDescription>Cheque emitido por la empresa para pagar a un proveedor.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-kx-text-3 text-xs">Número *</Label>
              <Input value={propioForm.numero}
                onChange={e => setPropioForm(f => ({ ...f, numero: e.target.value }))}
                placeholder="00001234" className="mt-1 bg-slate-800 border-slate-700" />
            </div>
            <div>
              <Label className="text-kx-text-3 text-xs">Banco *</Label>
              <Input value={propioForm.banco}
                onChange={e => setPropioForm(f => ({ ...f, banco: e.target.value }))}
                list="bancos-propio" placeholder="Banco Nación"
                className="mt-1 bg-slate-800 border-slate-700" />
              <datalist id="bancos-propio">
                {BANCOS_AR.map(b => <option key={b} value={b} />)}
              </datalist>
            </div>
          </div>
          <div>
            <Label className="text-kx-text-3 text-xs">Cuenta bancaria propia (opcional)</Label>
            <Select
              value={propioForm.cuenta_bancaria_id || '__none__'}
              onValueChange={v => setPropioForm(f => ({ ...f, cuenta_bancaria_id: v === '__none__' ? '' : v }))}
            >
              <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
                <SelectValue placeholder="Sin cuenta asociada" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 max-h-56">
                <SelectItem value="__none__">Sin cuenta asociada</SelectItem>
                {cuentasBancarias.map(cb => (
                  <SelectItem key={cb.id} value={cb.id}>{cb.nombre} — {cb.banco}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-kx-text-3 text-xs">Monto *</Label>
              <Input value={propioForm.monto}
                onChange={e => setPropioForm(f => ({ ...f, monto: e.target.value }))}
                placeholder="0,00" inputMode="decimal"
                className="mt-1 bg-slate-800 border-slate-700" />
            </div>
            <div>
              <Label className="text-kx-text-3 text-xs">Fecha vencimiento *</Label>
              <Input type="date" value={propioForm.fecha_vencimiento}
                onChange={e => setPropioForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                className="mt-1 bg-slate-800 border-slate-700" />
            </div>
          </div>
          <div>
            <Label className="text-kx-text-3 text-xs">Fecha emisión</Label>
            <Input type="date" value={propioForm.fecha_emision}
              onChange={e => setPropioForm(f => ({ ...f, fecha_emision: e.target.value }))}
              className="mt-1 bg-slate-800 border-slate-700" />
          </div>
          <div>
            <Label className="text-kx-text-3 text-xs">Proveedor (opcional)</Label>
            <Select
              value={propioForm.proveedor_id || '__none__'}
              onValueChange={v => setPropioForm(f => ({ ...f, proveedor_id: v === '__none__' ? '' : v, compra_id: '' }))}
            >
              <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
                <SelectValue placeholder="Sin proveedor" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 max-h-56">
                <SelectItem value="__none__">Sin proveedor</SelectItem>
                {proveedores.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {propioForm.proveedor_id && comprasProveedor.length > 0 && (
            <div>
              <Label className="text-kx-text-3 text-xs">Compra asociada (opcional)</Label>
              <Select
                value={propioForm.compra_id || '__none__'}
                onValueChange={v => setPropioForm(f => ({ ...f, compra_id: v === '__none__' ? '' : v }))}
              >
                <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
                  <SelectValue placeholder="Sin compra" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700 max-h-56">
                  <SelectItem value="__none__">Sin compra</SelectItem>
                  {comprasProveedor.map(comp => (
                    <SelectItem key={comp.id} value={comp.id}>
                      {comp.numero_factura ?? 'S/N'} — {fmt(comp.total)} ({fmtDate(comp.fecha)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-kx-text-3 text-xs">Observaciones</Label>
            <Input value={propioForm.observaciones}
              onChange={e => setPropioForm(f => ({ ...f, observaciones: e.target.value }))}
              placeholder="Opcional" className="mt-1 bg-slate-800 border-slate-700" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-kx-text-3">
            Cancelar
          </Button>
          <Button onClick={onGuardar} disabled={savingPropio}
            className="bg-blue-600 hover:bg-blue-700 text-white">
            {savingPropio ? <Loader2 size={14} className="animate-spin mr-2" /> : <CheckCircle2 size={14} className="mr-2" />}
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalNuevoChequePropio;
