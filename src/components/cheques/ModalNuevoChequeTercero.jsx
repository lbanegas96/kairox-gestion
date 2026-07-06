import React from 'react';
import { Plus, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BANCOS_AR, fmt } from './shared';

function ModalNuevoChequeTercero({
  open, onOpenChange,
  terceroForm, setTerceroForm,
  clientes,
  comprobantesCliente,
  savingTercero,
  onGuardar,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus size={16} className="text-emerald-400" /> Registrar cheque recibido
          </DialogTitle>
          <DialogDescription>Cheque de tercero recibido como medio de pago de un cliente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-kx-text-3 text-xs">Número *</Label>
              <Input value={terceroForm.numero}
                onChange={e => setTerceroForm(f => ({ ...f, numero: e.target.value }))}
                placeholder="00001234" className="mt-1 bg-slate-800 border-slate-700" />
            </div>
            <div>
              <Label className="text-kx-text-3 text-xs">Banco emisor *</Label>
              <Input value={terceroForm.banco}
                onChange={e => setTerceroForm(f => ({ ...f, banco: e.target.value }))}
                list="bancos-tercero" placeholder="Banco Galicia"
                className="mt-1 bg-slate-800 border-slate-700" />
              <datalist id="bancos-tercero">
                {BANCOS_AR.map(b => <option key={b} value={b} />)}
              </datalist>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-kx-text-3 text-xs">Monto *</Label>
              <Input value={terceroForm.monto}
                onChange={e => setTerceroForm(f => ({ ...f, monto: e.target.value }))}
                placeholder="0,00" inputMode="decimal"
                className="mt-1 bg-slate-800 border-slate-700" />
            </div>
            <div>
              <Label className="text-kx-text-3 text-xs">Fecha vencimiento *</Label>
              <Input type="date" value={terceroForm.fecha_vencimiento}
                onChange={e => setTerceroForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                className="mt-1 bg-slate-800 border-slate-700" />
            </div>
          </div>
          <div>
            <Label className="text-kx-text-3 text-xs">Fecha emisión</Label>
            <Input type="date" value={terceroForm.fecha_emision}
              onChange={e => setTerceroForm(f => ({ ...f, fecha_emision: e.target.value }))}
              className="mt-1 bg-slate-800 border-slate-700" />
          </div>
          <div>
            <Label className="text-kx-text-3 text-xs">Cliente (opcional)</Label>
            <Select
              value={terceroForm.cliente_id || '__none__'}
              onValueChange={v => setTerceroForm(f => ({ ...f, cliente_id: v === '__none__' ? '' : v, comprobante_id: '' }))}
            >
              <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
                <SelectValue placeholder="Sin cliente" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 max-h-56">
                <SelectItem value="__none__">Sin cliente</SelectItem>
                {clientes.map(c => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {terceroForm.cliente_id && comprobantesCliente.length > 0 && (
            <div>
              <Label className="text-kx-text-3 text-xs">Comprobante asociado (opcional)</Label>
              <Select
                value={terceroForm.comprobante_id || '__none__'}
                onValueChange={v => setTerceroForm(f => ({ ...f, comprobante_id: v === '__none__' ? '' : v }))}
              >
                <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
                  <SelectValue placeholder="Sin comprobante" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700 max-h-56">
                  <SelectItem value="__none__">Sin comprobante</SelectItem>
                  {comprobantesCliente.map(comp => (
                    <SelectItem key={comp.id} value={comp.id}>
                      {comp.numero_venta} — {fmt(comp.total)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-kx-text-3 text-xs">Observaciones</Label>
            <Input value={terceroForm.observaciones}
              onChange={e => setTerceroForm(f => ({ ...f, observaciones: e.target.value }))}
              placeholder="Opcional" className="mt-1 bg-slate-800 border-slate-700" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-kx-text-3">
            Cancelar
          </Button>
          <Button onClick={onGuardar} disabled={savingTercero}
            className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {savingTercero ? <Loader2 size={14} className="animate-spin mr-2" /> : <CheckCircle2 size={14} className="mr-2" />}
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalNuevoChequeTercero;
