import React, { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, X } from 'lucide-react';
import { getNowAR, formatDateTimeAR } from '@/lib/dateUtils';

const ComprobantePrintModal = ({ open, onOpenChange, comprobante, items }) => {
  const printRef = useRef();

  const handlePrint = () => {
    const printContent = printRef.current;
    const windowPrint = window.open('', '', 'left=0,top=0,width=800,height=900,toolbar=0,scrollbars=0,status=0');
    
    if (windowPrint) {
      windowPrint.document.write(`
        <html>
          <head>
            <title>Imprimir Comprobante</title>
            <style>
              body { font-family: 'Courier New', Courier, monospace; padding: 20px; max-width: 400px; margin: 0 auto; }
              .header { text-align: center; margin-bottom: 20px; border-bottom: 1px dashed #000; padding-bottom: 10px; }
              .info { margin-bottom: 15px; font-size: 14px; }
              .table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
              .table th { text-align: left; border-bottom: 1px solid #000; }
              .table td { padding: 4px 0; }
              .total { text-align: right; font-size: 18px; font-weight: bold; border-top: 1px dashed #000; padding-top: 10px; }
              .footer { text-align: center; margin-top: 30px; font-size: 10px; color: #555; }
              @media print {
                body { padding: 0; margin: 0; }
                .no-print { display: none; }
              }
            </style>
          </head>
          <body>
            ${printContent.innerHTML}
          </body>
        </html>
      `);
      windowPrint.document.close();
      windowPrint.focus();
      setTimeout(() => {
        windowPrint.print();
        windowPrint.close();
      }, 250);
    }
  };

  if (!comprobante) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md kairox-bg-card kairox-text-primary">
        <DialogHeader>
          <DialogTitle>Comprobante de Venta</DialogTitle>
          <DialogDescription>Vista previa del recibo</DialogDescription>
        </DialogHeader>

        <div className="bg-white text-black p-6 rounded-md shadow-sm border border-slate-200" ref={printRef}>
          <div className="text-center mb-4 border-b border-dashed border-slate-300 pb-4">
            <h2 className="font-bold text-xl uppercase">Ticket de Venta</h2>
            <p className="text-sm text-slate-500">Comprobante No Valido como Factura</p>
          </div>
          
          <div className="space-y-1 text-sm mb-4 font-mono">
            <div className="flex justify-between">
              <span className="text-slate-500">Nro:</span>
              <span className="font-bold">{comprobante.numero_venta}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Fecha:</span>
              <span>{formatDateTimeAR(comprobante.fecha)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Cliente:</span>
              <span className="truncate max-w-[150px]">{comprobante.cliente_nombre || 'Consumidor Final'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Pago:</span>
              <span>{comprobante.forma_pago}</span>
            </div>
          </div>

          <table className="w-full text-xs font-mono mb-4">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="text-left py-1">Prod</th>
                <th className="text-center py-1">Cant</th>
                <th className="text-right py-1">Precio</th>
                <th className="text-right py-1">Subt</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  <td className="py-1 truncate max-w-[100px]">{item.producto_nombre}</td>
                  <td className="text-center py-1">{item.cantidad}</td>
                  <td className="text-right py-1">${Number(item.precio_unitario).toFixed(2)}</td>
                  <td className="text-right py-1 font-bold">${Number(item.subtotal).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t border-dashed border-slate-300 pt-2 text-right">
            <span className="text-sm mr-4">TOTAL:</span>
            <span className="text-2xl font-bold">${Number(comprobante.total).toFixed(2)}</span>
          </div>

          <div className="mt-6 text-center text-xs text-slate-400">
            Gracias por su compra
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="w-4 h-4 mr-2" /> Cerrar
          </Button>
          <Button onClick={handlePrint} className="bg-blue-600 hover:bg-blue-700 text-white">
            <Printer className="w-4 h-4 mr-2" /> Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ComprobantePrintModal;