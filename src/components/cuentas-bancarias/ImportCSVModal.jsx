import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Upload, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { movimientosService, CB_KEYS } from '@/services/cuentasBancariasService';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { formatMoney, parseCSV } from './shared';
import { parseMontoCSV } from '@/lib/csvUtils';

function ImportCSVModal({ open, onClose, cuentas, empresaId }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const nombreUsuario = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || null;
  const fileRef = useRef();
  const [step, setStep] = useState(1); // 1=config, 2=preview
  const [cuentaId, setCuentaId] = useState('');
  const [parsed, setParsed] = useState(null); // { headers, rows }
  const [mapping, setMapping] = useState({ fecha: '', descripcion: '', monto: '', tipo: 'auto' });
  const [tipoOverride, setTipoOverride] = useState('auto'); // auto | ingreso | egreso
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (open) {
      setStep(1);
      setParsed(null);
      setCuentaId(cuentas[0]?.id ?? '');
      setMapping({ fecha: '', descripcion: '', monto: '', tipo: 'auto' });
      setTipoOverride('auto');
    }
  }, [open, cuentas]);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = parseCSV(ev.target.result);
      setParsed(result);
      // Auto-map columns by common names
      const h = result.headers.map(x => x.toLowerCase());
      setMapping({
        fecha: result.headers[h.findIndex(x => x.includes('fec') || x.includes('date'))] || result.headers[0] || '',
        descripcion: result.headers[h.findIndex(x => x.includes('desc') || x.includes('det') || x.includes('concepto') || x.includes('motivo'))] || result.headers[1] || '',
        monto: result.headers[h.findIndex(x => x.includes('monto') || x.includes('importe') || x.includes('amount') || x.includes('debe') || x.includes('cred'))] || result.headers[2] || '',
        tipo: 'auto',
      });
    };
    reader.readAsText(file, 'UTF-8');
  };

  const preview = useMemo(() => {
    if (!parsed || !mapping.fecha || !mapping.monto) return [];
    const fi = parsed.headers.indexOf(mapping.fecha);
    const di = parsed.headers.indexOf(mapping.descripcion);
    const mi = parsed.headers.indexOf(mapping.monto);
    return parsed.rows.slice(0, 10).map(row => {
      const rawMonto = parseMontoCSV(row[mi] || '0');
      const monto = Math.abs(rawMonto);
      let tipo;
      if (tipoOverride !== 'auto') {
        tipo = tipoOverride;
      } else {
        tipo = rawMonto >= 0 ? 'ingreso' : 'egreso';
      }
      return {
        fecha: row[fi] || '',
        descripcion: di >= 0 ? row[di] : '',
        monto,
        tipo,
        valid: !isNaN(monto) && monto > 0,
      };
    });
  }, [parsed, mapping, tipoOverride]);

  const allRows = useMemo(() => {
    if (!parsed || !mapping.fecha || !mapping.monto) return [];
    const fi = parsed.headers.indexOf(mapping.fecha);
    const di = parsed.headers.indexOf(mapping.descripcion);
    const mi = parsed.headers.indexOf(mapping.monto);
    return parsed.rows.map(row => {
      const rawMonto = parseMontoCSV(row[mi] || '0');
      const monto = Math.abs(rawMonto);
      let tipo;
      if (tipoOverride !== 'auto') {
        tipo = tipoOverride;
      } else {
        tipo = rawMonto >= 0 ? 'ingreso' : 'egreso';
      }
      // Parse date: try dd/mm/yyyy and yyyy-mm-dd
      let fecha = row[fi] || '';
      const parts = fecha.split(/[\/\-]/);
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          fecha = `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}T12:00:00`;
        } else {
          fecha = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}T12:00:00`;
        }
      }
      return { empresa_id: empresaId, cuenta_bancaria_id: cuentaId, fecha, descripcion: di >= 0 ? row[di] : '', monto, tipo, origen: 'csv', created_by: user?.id ?? null, created_by_nombre: nombreUsuario };
    }).filter(r => !isNaN(r.monto) && r.monto > 0);
  }, [parsed, mapping, tipoOverride, empresaId, cuentaId, user?.id, nombreUsuario]);

  const handleImport = async () => {
    if (!allRows.length) return;
    setLoading(true);
    try {
      const count = await movimientosService.bulkCreate(allRows);
      // Invalidar usando solo el prefijo para que matchee con cualquier queryKey
      // que tenga filters aplicados (CB_KEYS.movimientos arma [..., empresaId, filters]).
      qc.invalidateQueries({ queryKey: ['movimientos_bancarios', empresaId] });
      qc.invalidateQueries({ queryKey: CB_KEYS.movimientosSaldo(empresaId) }); // FIX-SALDO-REAL
      toast({ title: `${count} movimientos importados`, className: 'bg-green-600 text-white' });
      onClose();
    } catch (e) {
      toast({ title: 'Error al importar', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar extracto bancario (CSV)</DialogTitle>
          <DialogDescription>Subí el archivo CSV de tu banco y mapeá las columnas.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {/* Cuenta + archivo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Cuenta bancaria destino</Label>
              <Select value={cuentaId} onValueChange={setCuentaId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {cuentas.map(c => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Archivo CSV</Label>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
              <Button type="button" variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" /> {parsed ? `${parsed.rows.length} filas detectadas` : 'Seleccionar archivo'}
              </Button>
            </div>
          </div>

          {parsed && (
            <>
              {/* Mapper de columnas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { key: 'fecha', label: 'Columna Fecha' },
                  { key: 'descripcion', label: 'Columna Descripción' },
                  { key: 'monto', label: 'Columna Monto' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <Label className="text-xs">{label}</Label>
                    {/* Sentinel "__none__" porque Radix no permite value="" en SelectItem */}
                    <Select
                      value={mapping[key] || '__none__'}
                      onValueChange={v => setMapping(p => ({ ...p, [key]: v === '__none__' ? '' : v }))}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">—</SelectItem>
                        {parsed.headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <div>
                  <Label className="text-xs">Tipo de movimiento</Label>
                  <Select value={tipoOverride} onValueChange={setTipoOverride}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (por signo)</SelectItem>
                      <SelectItem value="ingreso">Todos ingresos</SelectItem>
                      <SelectItem value="egreso">Todos egresos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Preview */}
              {preview.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Vista previa — primeras {preview.length} filas ({allRows.length} total a importar)</p>
                  <div className="border rounded-lg overflow-hidden text-xs">
                    <table className="w-full">
                      <thead className="bg-kx-surface-2 dark:bg-kx-surface-2">
                        <tr>
                          <th className="px-3 py-2 text-left">Fecha</th>
                          <th className="px-3 py-2 text-left">Descripción</th>
                          <th className="px-3 py-2 text-right">Monto</th>
                          <th className="px-3 py-2 text-center">Tipo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y dark:divide-slate-700">
                        {preview.map((r, i) => (
                          <tr key={i} className={!r.valid ? 'bg-red-50 dark:bg-red-900/20' : ''}>
                            <td className="px-3 py-1.5">{r.fecha}</td>
                            <td className="px-3 py-1.5 max-w-xs truncate">{r.descripcion || '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{formatMoney(r.monto)}</td>
                            <td className="px-3 py-1.5 text-center">
                              <Badge variant={r.tipo === 'ingreso' ? 'default' : 'destructive'} className="text-xs">
                                {r.tipo}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={handleImport}
            disabled={!parsed || !allRows.length || !cuentaId || loading}
          >
            {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Importar {allRows.length || ''} movimientos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImportCSVModal;
