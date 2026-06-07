import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { Loader2, RotateCcw, AlertTriangle, CheckCircle } from 'lucide-react';
import { crearNotaCredito, getItemsComprobante, cancelarComprobante } from '@/services/notaCreditoService';

const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n || 0);

export default function NotaCreditoModal({ open, onClose, comprobante, onCreated }) {
  const { user } = useAuth();
  const { cajaSession } = useCaja();
  const { toast } = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (open && comprobante?.id) {
      loadItems();
    } else {
      setItems([]);
      setMotivo('');
    }
  }, [open, comprobante?.id]);

  const loadItems = async () => {
    setLoading(true);
    try {
      const data = await getItemsComprobante(comprobante.id);
      setItems(data);
    } catch {
      toast({ title: 'Error', description: 'No se pudieron cargar los items', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const updateCantidad = (idx, val) => {
    const parsed = Math.max(0, Math.min(items[idx].cantidadOriginal, parseInt(val) || 0));
    setItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, cantidadDevolver: parsed } : item
    ));
  };

  const totalNC = items.reduce((s, i) => s + i.cantidadDevolver * i.precio_unitario, 0);
  const esDevolucionTotal = items.length > 0 && items.every(i => i.cantidadDevolver === i.cantidadOriginal);
  const hayItemsSeleccionados = items.some(i => i.cantidadDevolver > 0);

  const handleSeleccionarTodo = () => {
    setItems(prev => prev.map(i => ({ ...i, cantidadDevolver: i.cantidadOriginal })));
  };

  const handleConfirmar = async () => {
    if (!hayItemsSeleccionados) {
      return toast({ title: 'Seleccioná al menos un ítem a devolver', variant: 'destructive' });
    }
    if (!motivo.trim()) {
      return toast({ title: 'El motivo es requerido', variant: 'destructive' });
    }

    setSaving(true);
    try {
      await crearNotaCredito({
        empresaId: user.empresa_id,
        userId: user.id,
        tenantId: user.tenant_id || user.id,
        comprobanteOrigenId: comprobante.id,
        comprobanteOrigenNumero: comprobante.numero_venta,
        clienteId: comprobante.cliente_id || null,
        clienteNombre: comprobante.cliente_nombre || 'Consumidor Final',
        formaPago: comprobante.forma_pago,
        items,
        motivoNC: motivo.trim(),
        totalNC,
      }, cajaSession?.id);

      // Si es devolución total, cancelar el comprobante original
      if (esDevolucionTotal) {
        await cancelarComprobante(comprobante.id);
      }

      toast({
        title: '✅ Nota de Crédito emitida',
        description: `${fmt(totalNC)} revertidos${esDevolucionTotal ? ' — venta cancelada' : ''}`,
        className: 'bg-green-600 text-white',
      });

      onCreated?.();
      onClose();
    } catch (err) {
      toast({ title: 'Error al emitir NC', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !o && onClose()}>
      <DialogContent className="max-w-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <RotateCcw className="h-5 w-5 text-orange-500" />
            Nota de Crédito — Devolución
          </DialogTitle>
          <DialogDescription>
            Comprobante #{comprobante?.numero_venta} · Cliente: {comprobante?.cliente_nombre || 'Consumidor Final'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Info de la venta original */}
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Pago original</p>
                <p className="font-semibold">{comprobante?.forma_pago}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Total original</p>
                <p className="font-semibold">{fmt(comprobante?.total)}</p>
              </div>
              <div className={`rounded-lg p-3 ${esDevolucionTotal ? 'bg-orange-50 dark:bg-orange-900/20' : 'bg-blue-50 dark:bg-blue-900/20'}`}>
                <p className="text-xs text-slate-500 mb-1">A devolver</p>
                <p className={`font-bold text-lg ${esDevolucionTotal ? 'text-orange-600' : 'text-blue-600'}`}>{fmt(totalNC)}</p>
              </div>
            </div>

            {/* Advertencia método de pago */}
            {comprobante?.forma_pago === 'Cuenta Corriente' ? (
              <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg text-sm text-blue-700 dark:text-blue-300">
                <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p>Venta en Cuenta Corriente — se creará un <strong>HABER</strong> que reduce la deuda del cliente.</p>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p>Venta en {comprobante?.forma_pago} — se registrará un <strong>egreso de caja</strong> por la devolución de dinero.</p>
              </div>
            )}

            {/* Tabla de items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold">Ítems a devolver</Label>
                <button
                  onClick={handleSeleccionarTodo}
                  className="text-xs text-blue-500 hover:text-blue-700 underline"
                >
                  Seleccionar todo
                </button>
              </div>

              <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-800">
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-center">Vendido</TableHead>
                      <TableHead className="text-center w-28">A devolver</TableHead>
                      <TableHead className="text-right">Subtotal NC</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{item.nombre}</TableCell>
                        <TableCell className="text-center text-slate-500">{item.cantidadOriginal}</TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min={0}
                            max={item.cantidadOriginal}
                            value={item.cantidadDevolver}
                            onChange={e => updateCantidad(idx, e.target.value)}
                            className="w-20 h-8 text-center mx-auto dark:bg-slate-800"
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {item.cantidadDevolver > 0 ? fmt(item.cantidadDevolver * item.precio_unitario) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Motivo */}
            <div>
              <Label className="text-sm font-semibold">Motivo de devolución *</Label>
              <Textarea
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                placeholder="Ej: Producto defectuoso, error en facturación, cambio de opinión..."
                rows={2}
                className="mt-1 dark:bg-slate-800"
              />
            </div>

            {/* Resumen */}
            {esDevolucionTotal && (
              <div className="flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-lg text-sm text-orange-700 dark:text-orange-300">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <p><strong>Devolución total:</strong> el comprobante original quedará marcado como "Cancelado".</p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirmar}
            disabled={saving || loading || !hayItemsSeleccionados || totalNC === 0}
            className="bg-orange-600 hover:bg-orange-700 text-white gap-2"
          >
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin" />Emitiendo NC...</>
              : <><RotateCcw className="h-4 w-4" />Emitir NC — {fmt(totalNC)}</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
