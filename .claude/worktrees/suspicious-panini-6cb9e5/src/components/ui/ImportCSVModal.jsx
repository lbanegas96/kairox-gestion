import React, { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Upload, FileText, X, AlertCircle, CheckCircle2, Loader2, Download } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';

// ── Configuración por tipo ──────────────────────────────────────────────────
const CONFIG = {
  productos: {
    label: 'Productos',
    table: 'productos',
    requiredFields: ['nombre'],
    fields: [
      { key: 'nombre',        label: 'Nombre *',          type: 'text' },
      { key: 'codigo_sku',    label: 'Código / SKU',       type: 'text' },
      { key: 'precio_venta',  label: 'Precio Venta',       type: 'number' },
      { key: 'precio_costo',  label: 'Precio Costo',       type: 'number' },
      { key: 'stock_actual',  label: 'Stock Actual',       type: 'integer' },
      { key: 'stock_minimo',  label: 'Stock Mínimo',       type: 'integer' },
      { key: 'unidad_medida', label: 'Unidad de Medida',   type: 'text' },
      { key: 'categoria',     label: 'Categoría',          type: 'text' },
    ],
    defaults: { precio_venta: 0, precio_costo: 0, stock_actual: 0, stock_minimo: 0, activo: true },
    sampleCSV: 'nombre,codigo_sku,precio_venta,precio_costo,stock_actual\nMartillo,MART-001,2500,1200,10\nClavos 2",CLAV-002,150,80,500',
  },
  clientes: {
    label: 'Clientes',
    table: 'clientes',
    requiredFields: ['nombre'],
    fields: [
      { key: 'nombre',         label: 'Nombre *',            type: 'text' },
      { key: 'documento',      label: 'Documento (DNI/CUIT)', type: 'text' },
      { key: 'telefono',       label: 'Teléfono',            type: 'text' },
      { key: 'email',          label: 'Email',               type: 'text' },
      { key: 'direccion',      label: 'Dirección',           type: 'text' },
      { key: 'limite_credito', label: 'Límite de Crédito',   type: 'number' },
      { key: 'condicion_pago', label: 'Condición de Pago',   type: 'text' },
    ],
    defaults: { saldo_actual: 0, activo: true },
    sampleCSV: 'nombre,documento,telefono,email\nJuan Pérez,20-12345678-9,+54 9 11 1234-5678,juan@email.com\nMaria García,27-87654321-0,+54 9 351 9876-5432,',
  },
};

// ── CSV parser simple ───────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

// ── Componente ──────────────────────────────────────────────────────────────
const ImportCSVModal = ({ open, onOpenChange, tipo = 'productos', empresaId, tenantId, onSuccess }) => {
  const { toast } = useToast();
  const fileRef = useRef();
  const config = CONFIG[tipo];

  const [step, setStep] = useState('upload'); // 'upload' | 'map' | 'preview' | 'done'
  const [csvData, setCsvData] = useState({ headers: [], rows: [] });
  const [mapping, setMapping] = useState({});   // { fieldKey: csvHeader }
  const [errors, setErrors] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const resetState = () => {
    setStep('upload');
    setCsvData({ headers: [], rows: [] });
    setMapping({});
    setErrors([]);
    setImporting(false);
    setImportResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => { resetState(); onOpenChange(false); };

  const handleFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseCSV(e.target.result);
      if (parsed.headers.length === 0) {
        toast({ title: 'Archivo inválido', description: 'El CSV no tiene encabezados o está vacío.', variant: 'destructive' });
        return;
      }
      setCsvData(parsed);
      // Auto-map headers that match exactly (case-insensitive)
      const autoMap = {};
      config.fields.forEach(f => {
        const match = parsed.headers.find(h => h.toLowerCase() === f.key.toLowerCase() || h.toLowerCase() === f.label.toLowerCase());
        if (match) autoMap[f.key] = match;
      });
      setMapping(autoMap);
      setStep('map');
    };
    reader.readAsText(file, 'UTF-8');
  }, [config, toast]);

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.csv')) handleFile(file);
  };

  // Validar y transformar las filas según el mapping
  const buildRows = () => {
    const errs = [];
    const built = csvData.rows.map((row, idx) => {
      const obj = { empresa_id: empresaId, user_id: tenantId, ...config.defaults };
      config.fields.forEach(f => {
        const csvCol = mapping[f.key];
        const raw = csvCol ? (row[csvCol] ?? '') : '';
        if (!raw && config.requiredFields.includes(f.key)) {
          errs.push(`Fila ${idx + 2}: "${f.label}" es obligatorio`);
        }
        if (raw) {
          if (f.type === 'number') obj[f.key] = parseFloat(raw.replace(',', '.')) || 0;
          else if (f.type === 'integer') obj[f.key] = parseInt(raw) || 0;
          else obj[f.key] = raw;
        }
      });
      return obj;
    });
    return { built, errs };
  };

  const handlePreview = () => {
    const { errs } = buildRows();
    setErrors(errs.slice(0, 10));
    setStep('preview');
  };

  const handleImport = async () => {
    const { built, errs } = buildRows();
    if (errs.length > 0) {
      setErrors(errs.slice(0, 10));
      return;
    }
    setImporting(true);
    try {
      // Batch insert in chunks of 50
      const CHUNK = 50;
      let inserted = 0;
      for (let i = 0; i < built.length; i += CHUNK) {
        const { error } = await supabase.from(config.table).insert(built.slice(i, i + CHUNK));
        if (error) throw error;
        inserted += Math.min(CHUNK, built.length - i);
      }
      setImportResult({ count: inserted });
      setStep('done');
      onSuccess?.();
    } catch (err) {
      toast({ title: 'Error al importar', description: err.message, variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  const downloadSample = () => {
    const blob = new Blob([config.sampleCSV], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ejemplo_${tipo}.csv`;
    a.click();
  };

  const { built: previewRows } = step === 'preview' ? buildRows() : { built: [] };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl dark:bg-slate-950 dark:border-slate-800 max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="dark:text-white flex items-center gap-2">
            <Upload className="h-5 w-5 text-blue-500" /> Importar {config.label} desde CSV
          </DialogTitle>
          <DialogDescription className="dark:text-slate-400">
            {step === 'upload' && 'Subí un archivo CSV con los datos a importar.'}
            {step === 'map' && 'Mapeá las columnas del CSV con los campos del sistema.'}
            {step === 'preview' && `${csvData.rows.length} filas listas para importar. Revisá antes de confirmar.`}
            {step === 'done' && `Importación completada: ${importResult?.count} registros creados.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* ── Step 1: Upload ── */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 transition-colors"
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <FileText className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                <p className="font-medium text-slate-600 dark:text-slate-300">Arrastrá un archivo CSV o hacé click para seleccionar</p>
                <p className="text-sm text-slate-400 mt-1">Solo archivos .csv</p>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
              </div>
              <div className="flex items-center justify-between text-sm">
                <p className="text-slate-500 dark:text-slate-400">¿No tenés un CSV? Descargá un ejemplo con el formato correcto.</p>
                <Button variant="outline" size="sm" onClick={downloadSample} className="dark:border-slate-700 dark:text-white">
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Ejemplo CSV
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 2: Mapping ── */}
          {step === 'map' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Archivo: <strong>{csvData.rows.length} filas</strong> · {csvData.headers.length} columnas detectadas
              </p>
              <div className="space-y-2">
                {config.fields.map(f => (
                  <div key={f.key} className="flex items-center gap-3">
                    <div className="w-44 text-sm font-medium text-slate-700 dark:text-slate-300 flex-shrink-0">
                      {f.label}
                    </div>
                    <select
                      value={mapping[f.key] || ''}
                      onChange={e => setMapping(p => ({ ...p, [f.key]: e.target.value || undefined }))}
                      className="flex-1 h-9 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white text-sm px-2 focus:border-blue-500"
                    >
                      <option value="">(no mapear)</option>
                      {csvData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    {mapping[f.key] && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">✓</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 3: Preview ── */}
          {step === 'preview' && (
            <div className="space-y-3">
              {errors.length > 0 ? (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 space-y-1">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400 flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4" /> {errors.length} errores encontrados
                  </p>
                  {errors.map((e, i) => <p key={i} className="text-xs text-red-600 dark:text-red-400">{e}</p>)}
                </div>
              ) : (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-sm">
                  <CheckCircle2 className="h-4 w-4" /> {csvData.rows.length} filas validadas correctamente.
                </div>
              )}
              <div className="overflow-x-auto max-h-48 border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/50 sticky top-0">
                    <tr>
                      {config.fields.filter(f => mapping[f.key]).map(f => (
                        <th key={f.key} className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                        {config.fields.filter(f => mapping[f.key]).map(f => (
                          <td key={f.key} className="px-3 py-1.5 text-slate-700 dark:text-slate-300 truncate max-w-[120px]">
                            {String(row[f.key] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {csvData.rows.length > 5 && (
                  <p className="text-xs text-slate-400 px-3 py-2">... y {csvData.rows.length - 5} filas más</p>
                )}
              </div>
            </div>
          )}

          {/* ── Step 4: Done ── */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-slate-800 dark:text-white">{importResult?.count} {config.label.toLowerCase()} importados</p>
                <p className="text-sm text-slate-500 mt-1">Los registros ya están disponibles en el sistema.</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between gap-2">
          <Button variant="outline" onClick={step === 'upload' || step === 'done' ? handleClose : () => setStep(step === 'map' ? 'upload' : 'map')} className="dark:border-slate-700 dark:text-white">
            {step === 'upload' || step === 'done' ? <><X className="h-4 w-4 mr-1.5" /> Cerrar</> : '← Atrás'}
          </Button>
          <div className="flex gap-2">
            {step === 'map' && (
              <Button onClick={handlePreview} className="bg-blue-600 hover:bg-blue-700 text-white">
                Vista Previa →
              </Button>
            )}
            {step === 'preview' && errors.length === 0 && (
              <Button onClick={handleImport} disabled={importing} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {importing ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Importando...</> : `Importar ${csvData.rows.length} registros`}
              </Button>
            )}
            {step === 'preview' && errors.length > 0 && (
              <Button onClick={() => setStep('map')} className="bg-blue-600 hover:bg-blue-700 text-white">
                Corregir mapeo
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportCSVModal;
