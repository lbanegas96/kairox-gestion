import React, { useRef, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, X, FileText, Download, Loader2 } from 'lucide-react';
import { getNowAR, formatDateTimeAR } from '@/lib/dateUtils';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';

const ComprobantePrintModal = ({ open, onOpenChange, comprobante, items, pagos = [] }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const printRef = useRef();
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [empresaData, setEmpresaData] = useState(null);

  useEffect(() => {
    if (!open || !user?.empresa_id) return;
    supabase
      .from('empresas')
      .select('nombre, afip_cuit, condicion_iva, direccion')
      .eq('id', user.empresa_id)
      .single()
      .then(({ data }) => setEmpresaData(data));
  }, [open, user?.empresa_id]);

  const handleDownloadPDF = async () => {
    if (!comprobante) return;
    setGeneratingPDF(true);
    try {
      // Lazy-load las librerías pesadas solo cuando se necesitan
      const [{ pdf }, { ComprobantePDF }, { generateAfipQR }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./pdf/ComprobantePDF'),
        import('@/lib/afipQR'),
      ]);

      let qrDataUrl = null;
      if (comprobante.cae_estado === 'emitido' && comprobante.cae) {
        const pvNumero = comprobante.numero_afip
          ? parseInt(comprobante.numero_afip.split('-')[0])
          : 1;
        qrDataUrl = await generateAfipQR(comprobante, empresaData?.afip_cuit, pvNumero);
      }

      const blob = await pdf(
        <ComprobantePDF
          comprobante={comprobante}
          items={items}
          pagos={pagos}
          empresaData={empresaData}
          qrDataUrl={qrDataUrl}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${comprobante.numero_afip ?? comprobante.numero_venta}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[PDF] Error al generar:', err);
      toast({ title: 'Error al generar PDF', description: err.message, variant: 'destructive' });
    } finally {
      setGeneratingPDF(false);
    }
  };

  const handlePrint = (opts = {}) => {
    const { remito = false } = opts;
    const printContent = printRef.current;
    const windowPrint = window.open('', '', 'left=0,top=0,width=800,height=900,toolbar=0,scrollbars=0,status=0');

    if (windowPrint) {
      const clone = printContent.cloneNode(true);
      clone.querySelectorAll('script, style[data-unsafe]').forEach(el => el.remove());
      clone.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(attr => {
          if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
        });
      });
      const safeHTML = clone.innerHTML;

      windowPrint.document.write(`
        <html>
          <head>
            <title>${remito ? 'Remito' : 'Comprobante'}</title>
            <style>
              body { font-family: 'Courier New', Courier, monospace; padding: 20px; max-width: 400px; margin: 0 auto; }
              .header { text-align: center; margin-bottom: 20px; border-bottom: 1px dashed #000; padding-bottom: 10px; }
              .info { margin-bottom: 15px; font-size: 14px; }
              .table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
              .table th { text-align: left; border-bottom: 1px solid #000; }
              .table td { padding: 4px 0; }
              .total { text-align: right; font-size: 18px; font-weight: bold; border-top: 1px dashed #000; padding-top: 10px; }
              .footer { text-align: center; margin-top: 30px; font-size: 10px; color: #555; }
              ${remito ? '.price-col { display: none !important; } .total-row { display: none !important; }' : ''}
              @media print {
                body { padding: 0; margin: 0; }
                .no-print { display: none; }
              }
            </style>
          </head>
          <body>
            ${safeHTML}
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

  // Renderizar detalle de pagos
  const pagoLabel = pagos.length > 1
    ? pagos.map(p => `${p.metodo}: $${Number(p.monto).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(' | ')
    : comprobante?.forma_pago || '';

  if (!comprobante) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md kairox-bg-card kairox-text-primary">
        <DialogHeader>
          <DialogTitle>Comprobante de Venta</DialogTitle>
          <DialogDescription>Vista previa del recibo</DialogDescription>
        </DialogHeader>

        <div className="bg-kx-surface text-black p-6 rounded-md shadow-sm border border-kx-border" ref={printRef}>
          <div className="text-center mb-4 border-b border-dashed border-slate-300 pb-4">
            <h2 className="font-bold text-xl uppercase">Ticket de Venta</h2>
            <p className="text-sm text-slate-500">Comprobante No Válido como Factura</p>
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
            {pagos.length > 1 ? (
              <div className="pt-1 border-t border-dashed border-kx-border">
                {pagos.map((p, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-slate-500">{p.metodo}:</span>
                    <span className="font-semibold">${Number(p.monto).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex justify-between">
                <span className="text-slate-500">Pago:</span>
                <span>{comprobante.forma_pago}</span>
              </div>
            )}
          </div>

          {(() => {
            const totalARS = Number(comprobante.total);
            const tc = Number(comprobante.tipo_cambio_tasa);
            const esExtranjera = comprobante.moneda && comprobante.moneda !== 'ARS' && tc > 0;
            const monedaDisp = esExtranjera ? comprobante.moneda : 'ARS';
            const simbolo = esExtranjera ? `${comprobante.moneda} ` : '$';
            const conv = esExtranjera ? (n) => Number(n) / tc : (n) => Number(n);
            const fmt = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const totalDisp = conv(totalARS);
            return (
              <>
                <table className="w-full text-xs font-mono mb-4">
                  <thead>
                    <tr className="border-b border-slate-300">
                      <th className="text-left py-1">Producto</th>
                      <th className="text-center py-1">Cant</th>
                      <th className="text-right py-1 price-col">Precio ({monedaDisp})</th>
                      <th className="text-right py-1 price-col">Subt ({monedaDisp})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={i}>
                        <td className="py-1 truncate max-w-[120px]">{item.producto_nombre}</td>
                        <td className="text-center py-1">{item.cantidad}</td>
                        <td className="text-right py-1 price-col">{simbolo}{fmt(conv(item.precio_unitario))}</td>
                        <td className="text-right py-1 font-bold price-col">{simbolo}{fmt(conv(item.subtotal))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="border-t border-dashed border-slate-300 pt-2 total-row">
                  <div className="flex justify-between items-baseline">
                    <span className="text-sm">TOTAL:</span>
                    <span className="text-2xl font-bold">{simbolo}{fmt(totalDisp)}</span>
                  </div>
                  {esExtranjera && (
                    <div className="mt-2 pt-2 border-t border-dashed border-slate-300 text-[10px] font-mono text-slate-500 space-y-0.5">
                      <div className="flex justify-between">
                        <span>Tipo de cambio:</span>
                        <span>1 {comprobante.moneda} = ${fmt(tc)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Equivale a:</span>
                        <span>${fmt(totalARS)} ARS</span>
                      </div>
                    </div>
                  )}
                </div>
              </>
            );
          })()}

          <div className="mt-6 text-center text-xs text-kx-text-3">
            Gracias por su compra
          </div>
        </div>

        <DialogFooter className="flex gap-2 flex-wrap sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="w-4 h-4 mr-2" /> Cerrar
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handlePrint({ remito: true })} className="border-slate-300 text-slate-700 dark:text-slate-300 dark:border-slate-600">
              <FileText className="w-4 h-4 mr-2" /> Remito
            </Button>
            <Button variant="outline" onClick={handleDownloadPDF} disabled={generatingPDF} className="border-slate-300 text-slate-700 dark:text-slate-300 dark:border-slate-600">
              {generatingPDF
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generando...</>
                : <><Download className="w-4 h-4 mr-2" /> Descargar PDF</>
              }
            </Button>
            <Button onClick={() => handlePrint()} className="bg-blue-600 hover:bg-blue-700 text-white">
              <Printer className="w-4 h-4 mr-2" /> Imprimir
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ComprobantePrintModal;