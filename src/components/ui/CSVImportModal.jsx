import React, { useState, useRef } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  Upload, FileText, CheckCircle2, AlertTriangle, Loader2,
  X, ChevronRight, ArrowLeft, Download
} from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';

// ── Configuración por tipo ────────────────────────────────────────────────────
const CONFIG = {
  productos: {
    title: 'Importar Productos',
    tableName: 'productos',
    fields: [
      { key: 'nombre',         label: 'Nombre *',          required: true  },
      { key: 'codigo_sku',     label: 'Código SKU *',       required: true  },
      { key: 'precio_venta',   label: 'Precio Venta *',     required: true  },
      { key: 'precio_costo',   label: 'Precio Costo',       required: false },
      { key: 'stock_actual',   label: 'Stock Actual',       required: false },
      { key: 'stock_minimo',   label: 'Stock Mínimo',       required: false },
      { key: 'descripcion',    label: 'Descripción',        required: false },
      { key: 'unidad_medida',  label: 'Unidad de Medida',   required: false },
    ],
    buildRow: (mapped, user) => ({
      empresa_id:    user.empresa_id,
      user_id:       user.id,
      nombre:        String(mapped.nombre || '').trim(),
      codigo_sku:    String(mapped.codigo_sku || '').trim(),
      precio_venta:  parseFloat(mapped.precio_venta) || 0,
      precio_costo:  parseFloat(mapped.precio_costo) || 0,
      stock_actual:  parseFloat(mapped.stock_actual) || 0,
      stock_minimo:  parseFloat(mapped.stock_minimo) || 5,
      descripcion:   String(mapped.descripcion || '').trim(),
      unidad_medida: String(mapped.unidad_medida || 'unidad').trim(),
      activo:        true,
    }),
    validate: (row) => {
      const errors = [];
      if (!row.nombre) errors.push('Nombre vacío');
      if (!row.codigo_sku) errors.push('SKU vacío');
      if (isNaN(row.precio_venta) || row.precio_venta < 0) errors.push('Precio inválido');
      return errors;
    },
    sampleCSV: 'nombre,codigo_sku,precio_venta,precio_costo,stock_actual,stock_minimo,unidad_medida\nMartillo 500g,MART-500,3500,1800,20,5,unidad\nClavo 3 pulgadas,CL-3P,850,400,100,20,caja',
  },
  clientes: {
    title: 'Importar Clientes',
    tableName: 'clientes',
    fields: [
      { key: 'nombre',           label: 'Nombre *',          required: true  },
      { key: 'documento',        label: 'CUIT/DNI',          required: false },
      { key: 'telefono',         label: 'Teléfono',          required: false },
      { key: 'email',            label: 'Email',             required: false },
      { key: 'direccion',        label: 'Dirección',         required: false },
      { key: 'condiciones_pago', label: 'Condiciones Pago',  required: false },
      { key: 'limite_credito',   label: 'Límite Crédito',    required: false },
    ],
    buildRow: (mapped, user) => ({
      empresa_id:       user.empresa_id,
      user_id:          user.id,
      nombre:           String(mapped.nombre || '').trim(),
      documento:        String(mapped.documento || '').trim(),
      telefono:         String(mapped.telefono || '').trim(),
      email:            String(mapped.email || '').trim(),
      direccion:        String(mapped.direccion || '').trim(),
      condiciones_pago: String(mapped.condiciones_pago || '').trim(),
      limite_credito:   parseFloat(mapped.limite_credito) || 0,
      saldo_actual:     0,
      activo:           true,
    }),
    validate: (row) => {
      const errors = [];
      if (!row.nombre) errors.push('Nombre vacío');
      return errors;
    },
    sampleCSV: 'nombre,documento,telefono,email,direccion\nFerretería López,20-12345678-9,11-4567-8901,lopez@mail.com,Av. San Martín 1234\nDistribuidora Sur,30-98765432-1,11-2345-6789,,Ruta 3 km 25',
  },
};

// ── Parsear CSV ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseRow = (line) => {
    const result = [];
    let inQuote = false;
    let current = '';
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]).map(h => h.replace(/['"]/g, '').trim());
  const rows = lines.slice(1).map(line => {
    const values = parseRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function CSVImportModal({ open, onOpenChange, tipo, onSuccess }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const cfg = CONFIG[tipo];
  const fileInputRef = useRef(null);

  const [step, setStep] = useState(1); // 1=upload, 2=mapear, 3=preview, 4=done
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [mapping, setMapping] = useState({}); // { fieldKey: csvHeader }
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [fileName, setFileName] = useState('');

  const reset = () => {
    setStep(1); setCsvHeaders([]); setCsvRows([]);
    setMapping({}); setImporting(false); setImportResult(null); setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => { reset(); onOpenChange(false); };

  // ── Paso 1: cargar archivo ────────────────────────────────────────────────
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      toast({ title: 'Solo archivos .csv', variant: 'destructive' }); return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { headers, rows } = parseCSV(ev.target.result);
      if (!headers.length) {
        toast({ title: 'Archivo vacío o inválido', variant: 'destructive' }); return;
      }
      setCsvHeaders(headers);
      setCsvRows(rows);
      // Auto-mapping: si el header coincide con algún field key o label
      const autoMap = {};
      cfg.fields.forEach(f => {
        const match = headers.find(h =>
          h.toLowerCase() === f.key.toLowerCase() ||
          h.toLowerCase() === f.label.toLowerCase().replace(' *', '')
        );
        if (match) autoMap[f.key] = match;
      });
      setMapping(autoMap);
      setStep(2);
    };
    reader.readAsText(file, 'UTF-8');
  };

  // ── Paso 2: mapear columnas ───────────────────────────────────────────────
  const mappingComplete = cfg.fields
    .filter(f => f.required)
    .every(f => mapping[f.key]);

  // ── Paso 3: preview ───────────────────────────────────────────────────────
  const previewRows = csvRows.slice(0, 5).map(row => {
    const mapped = {};
    Object.entries(mapping).forEach(([fieldKey, csvHeader]) => {
      mapped[fieldKey] = row[csvHeader] ?? '';
    });
    return cfg.buildRow(mapped, user);
  });

  // ── Paso 4: importar ──────────────────────────────────────────────────────
  const handleImport = async () => {
    setImporting(true);
    let ok = 0, errores = 0;
    const errorList = [];

    const batches = [];
    const BATCH = 50;
    for (let i = 0; i < csvRows.length; i += BATCH) {
      batches.push(csvRows.slice(i, i + BATCH));
    }

    for (const batch of batches) {
      const payload = batch.map(row => {
        const mapped = {};
        Object.entries(mapping).forEach(([fieldKey, csvHeader]) => {
          mapped[fieldKey] = row[csvHeader] ?? '';
        });
        return cfg.buildRow(mapped, user);
      }).filter(row => {
        const errs = cfg.validate(row);
        if (errs.length) { errores++; errorList.push(`"${row.nombre || '?'}": ${errs.join(', ')}`); return false; }
        return true;
      });

      if (!payload.length) continue;

      const { error } = await supabase.from(cfg.tableName).insert(payload);
      if (error) {
        // Try one by one to find duplicates
        for (const row of payload) {
          const { error: e2 } = await supabase.from(cfg.tableName).insert([row]);
          if (e2) { errores++; errorList.push(`"${row.nombre}": ${e2.message}`); }
          else ok++;
        }
      } else {
        ok += payload.length;
      }
    }

    setImportResult({ ok, errores, errorList: errorList.slice(0, 10) });
    setImporting(false);
    setStep(4);
    if (ok > 0) onSuccess?.();
  };

  const downloadSample = () => {
    const blob = new Blob([cfg.sampleCSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ejemplo_${tipo}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl dark:bg-slate-950 dark:border-slate-800">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-white">
            <Upload className="h-5 w-5 text-blue-500" /> {cfg.title}
          </DialogTitle>
          <DialogDescription className="dark:text-slate-400">
            {step === 1 && 'Subí un archivo CSV para importar en masa.'}
            {step === 2 && 'Mapeá las columnas del CSV a los campos del sistema.'}
            {step === 3 && `Vista previa de los primeros ${Math.min(5, csvRows.length)} registros de ${csvRows.length} total.`}
            {step === 4 && 'Importación completada.'}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-1 text-xs mb-4">
          {['Archivo', 'Mapear', 'Preview', 'Resultado'].map((s, i) => (
            <React.Fragment key={s}>
              <span className={`px-2 py-0.5 rounded-full font-medium ${step === i + 1 ? 'bg-blue-600 text-white' : step > i + 1 ? 'bg-green-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-kx-text-2'}`}>
                {s}
              </span>
              {i < 3 && <ChevronRight className="h-3 w-3 text-kx-text-2" />}
            </React.Fragment>
          ))}
        </div>

        {/* ── Step 1: Upload ──────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileText className="h-12 w-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="font-medium text-slate-600 dark:text-slate-300">Clic para seleccionar archivo CSV</p>
              <p className="text-sm text-kx-text-2 mt-1">Máx. 5000 filas · UTF-8 · separado por comas</p>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
            </div>
            <Button variant="outline" size="sm" onClick={downloadSample} className="w-full dark:text-slate-300 dark:border-slate-700">
              <Download className="h-4 w-4 mr-2" /> Descargar CSV de ejemplo
            </Button>
          </div>
        )}

        {/* ── Step 2: Mapear ─────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Archivo: <strong className="text-slate-700 dark:text-slate-300">{fileName}</strong> — {csvRows.length} filas detectadas
            </p>
            {cfg.fields.map(field => (
              <div key={field.key} className="grid grid-cols-2 gap-3 items-center">
                <Label className={`text-sm ${field.required ? 'text-slate-800 dark:text-white font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>
                  {field.label}
                </Label>
                <select
                  value={mapping[field.key] || ''}
                  onChange={e => setMapping(prev => ({ ...prev, [field.key]: e.target.value || undefined }))}
                  className="h-9 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white px-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— sin mapear —</option>
                  {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
            {!mappingComplete && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> Debés mapear los campos obligatorios (*) para continuar.
              </p>
            )}
          </div>
        )}

        {/* ── Step 3: Preview ────────────────────────────────────────────── */}
        {step === 3 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900">
                  {cfg.fields.filter(f => mapping[f.key]).map(f => (
                    <th key={f.key} className="text-left p-2 font-semibold text-slate-600 dark:text-slate-400 border-b dark:border-slate-800">
                      {f.label.replace(' *', '')}
                    </th>
                  ))}
                  <th className="text-left p-2 font-semibold text-slate-600 dark:text-slate-400 border-b dark:border-slate-800">Estado</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => {
                  const errs = cfg.validate(row);
                  return (
                    <tr key={i} className={`border-b dark:border-slate-800 ${errs.length ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                      {cfg.fields.filter(f => mapping[f.key]).map(f => (
                        <td key={f.key} className="p-2 dark:text-slate-300 truncate max-w-[120px]">
                          {String(row[f.key] ?? '')}
                        </td>
                      ))}
                      <td className="p-2">
                        {errs.length
                          ? <span className="text-red-500 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{errs[0]}</span>
                          : <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />OK</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-kx-text-2 mt-2 text-right">
              {csvRows.length > 5 && `y ${csvRows.length - 5} filas más...`} Total: {csvRows.length} registros
            </p>
          </div>
        )}

        {/* ── Step 4: Resultado ──────────────────────────────────────────── */}
        {step === 4 && importResult && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-center">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-1 text-green-600" />
                <div className="text-2xl font-bold text-green-700 dark:text-green-400">{importResult.ok}</div>
                <div className="text-sm text-green-600 dark:text-green-500">importados correctamente</div>
              </div>
              <div className={`p-4 rounded-xl border text-center ${importResult.errores > 0 ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800'}`}>
                <AlertTriangle className={`h-8 w-8 mx-auto mb-1 ${importResult.errores > 0 ? 'text-red-500' : 'text-kx-text-3'}`} />
                <div className={`text-2xl font-bold ${importResult.errores > 0 ? 'text-red-600 dark:text-red-400' : 'text-kx-text-2'}`}>{importResult.errores}</div>
                <div className={`text-sm ${importResult.errores > 0 ? 'text-red-500' : 'text-kx-text-2'}`}>con errores</div>
              </div>
            </div>
            {importResult.errorList.length > 0 && (
              <div className="bg-red-50 dark:bg-red-900/10 rounded-lg p-3 text-xs space-y-1 max-h-32 overflow-y-auto">
                {importResult.errorList.map((e, i) => (
                  <p key={i} className="text-red-600 dark:text-red-400">{e}</p>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex gap-2 sm:justify-between mt-2">
          <Button variant="outline" onClick={step > 1 && step < 4 ? () => setStep(s => s - 1) : handleClose}
            className="dark:text-white dark:border-slate-700">
            {step > 1 && step < 4 ? <><ArrowLeft className="h-4 w-4 mr-1" /> Atrás</> : <><X className="h-4 w-4 mr-1" /> Cerrar</>}
          </Button>
          <div className="flex gap-2">
            {step === 2 && (
              <Button onClick={() => setStep(3)} disabled={!mappingComplete} className="bg-blue-600 text-white hover:bg-blue-700">
                Vista Previa <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step === 3 && (
              <Button onClick={handleImport} disabled={importing} className="bg-green-600 text-white hover:bg-green-700">
                {importing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importando…</> : `Importar ${csvRows.length} registros`}
              </Button>
            )}
            {step === 4 && (
              <Button onClick={() => { reset(); onSuccess?.(); onOpenChange(false); }} className="bg-blue-600 text-white">
                Listo
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
