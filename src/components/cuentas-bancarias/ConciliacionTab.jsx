import React from 'react';
import { Upload, CheckCircle2, Link2, Unlink2, Zap } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { conciliacionService, CONC_KEYS } from '@/services/conciliacionService';
import { formatDateAR } from '@/lib/dateUtils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatMoney } from './shared';

function ConciliacionTab({ cuentas, empresaId, userId }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = React.useRef();

  const [cuentaId, setCuentaId]       = React.useState(cuentas[0]?.id ?? '');
  const [extractoId, setExtractoId]   = React.useState(null);
  const [lineaActiva, setLineaActiva] = React.useState(null);
  const [uploading, setUploading]     = React.useState(false);
  const [matching, setMatching]       = React.useState(false);

  const { data: extractos = [] } = useQuery({
    queryKey: CONC_KEYS.extractos(cuentaId),
    queryFn: () => conciliacionService.getExtractos(cuentaId, empresaId),
    enabled: !!cuentaId,
  });

  const { data: lineas = [] } = useQuery({
    queryKey: CONC_KEYS.lineas(extractoId),
    queryFn: () => conciliacionService.getLineas(extractoId, empresaId),
    enabled: !!extractoId,
  });

  const { data: movSinConc = [] } = useQuery({
    queryKey: CONC_KEYS.movimientos(cuentaId),
    queryFn: () => conciliacionService.getMovimientosSinConciliar(cuentaId, empresaId),
    enabled: !!cuentaId,
  });

  const pendientes   = lineas.filter(l => !l.conciliado);
  const conciliadas  = lineas.filter(l =>  l.conciliado);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !cuentaId) return;
    setUploading(true);
    try {
      const texto = await file.text();
      const parsed = conciliacionService.parsearCSV(texto);
      if (!parsed.length) throw new Error('No se encontraron movimientos válidos en el archivo.');
      const extracto = await conciliacionService.importarExtracto(empresaId, cuentaId, userId, file.name, parsed);
      setExtractoId(extracto.id);
      qc.invalidateQueries({ queryKey: CONC_KEYS.extractos(cuentaId) });
      toast({ title: `${parsed.length} movimientos importados ✓`, className: 'bg-green-600 text-white' });
    } catch (err) {
      toast({ title: 'Error al importar', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleAutoMatch = async () => {
    if (!extractoId) return;
    setMatching(true);
    try {
      const n = await conciliacionService.autoMatch(extractoId, empresaId, cuentaId);
      qc.invalidateQueries({ queryKey: CONC_KEYS.lineas(extractoId) });
      qc.invalidateQueries({ queryKey: CONC_KEYS.movimientos(cuentaId) });
      toast({ title: `${n} coincidencias automáticas encontradas ✓`, className: 'bg-green-600 text-white' });
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setMatching(false);
    }
  };

  const handleMatch = async (lineaId, movId) => {
    try {
      await conciliacionService.matchManual(lineaId, movId);
      qc.invalidateQueries({ queryKey: CONC_KEYS.lineas(extractoId) });
      qc.invalidateQueries({ queryKey: CONC_KEYS.movimientos(cuentaId) });
      setLineaActiva(null);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDesMatch = async (lineaId) => {
    try {
      await conciliacionService.desMatch(lineaId);
      qc.invalidateQueries({ queryKey: CONC_KEYS.lineas(extractoId) });
      qc.invalidateQueries({ queryKey: CONC_KEYS.movimientos(cuentaId) });
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-kx-text-2">Cuenta bancaria</Label>
          <select value={cuentaId} onChange={e => { setCuentaId(e.target.value); setExtractoId(null); }}
            className="h-9 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 text-sm">
            {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        {extractos.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs text-kx-text-2">Extracto importado</Label>
            <select value={extractoId ?? ''} onChange={e => setExtractoId(e.target.value || null)}
              className="h-9 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 text-sm">
              <option value="">Seleccionar...</option>
              {extractos.map(ex => <option key={ex.id} value={ex.id}>{ex.nombre_archivo} ({ex.movimientos_count} mov.)</option>)}
            </select>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleUpload} />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Upload className="w-4 h-4 mr-2" />{uploading ? 'Importando...' : 'Importar CSV'}
        </Button>
        {extractoId && (
          <Button size="sm" onClick={handleAutoMatch} disabled={matching}
            className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Zap className="w-4 h-4 mr-2" />{matching ? 'Procesando...' : 'Auto-Match'}
          </Button>
        )}
      </div>

      {/* Resumen */}
      {extractoId && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total líneas', value: lineas.length, color: 'text-slate-700 dark:text-kx-text' },
            { label: 'Conciliadas', value: conciliadas.length, color: 'text-green-600' },
            { label: 'Pendientes', value: pendientes.length, color: pendientes.length > 0 ? 'text-kx-amber' : 'text-kx-text-3' },
          ].map(({ label, value, color }) => (
            <div key={label} className="p-3 rounded-lg bg-kx-surface-2 dark:bg-kx-surface border border-kx-border dark:border-kx-border text-center">
              <p className="text-xs text-kx-text-3 uppercase">{label}</p>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Vista split */}
      {extractoId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Izquierda: líneas del extracto */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-kx-text-2 uppercase">Extracto bancario</p>
            <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden max-h-[500px] overflow-y-auto">
              {lineas.length === 0 ? (
                <div className="p-8 text-center text-kx-text-3">Sin líneas</div>
              ) : lineas.map(l => (
                <div key={l.id}
                  onClick={() => !l.conciliado && setLineaActiva(lineaActiva?.id === l.id ? null : l)}
                  className={`p-3 border-b border-slate-100 dark:border-kx-border cursor-pointer transition-colors
                    ${l.conciliado ? 'bg-green-50 dark:bg-green-900/10' : lineaActiva?.id === l.id ? 'bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-400' : 'hover:bg-kx-surface-2 dark:hover:bg-slate-800/40'}
                  `}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-kx-text-3">{formatDateAR(l.fecha)}</p>
                      <p className="text-sm truncate dark:text-kx-text">{l.descripcion}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-sm font-mono font-bold ${l.tipo === 'ingreso' ? 'text-kx-green' : 'text-kx-red'}`}>
                        {l.tipo === 'ingreso' ? '+' : '-'}{formatMoney(l.monto)}
                      </span>
                      {l.conciliado
                        ? <CheckCircle2 className="w-4 h-4 text-kx-green" />
                        : <button onClick={e => { e.stopPropagation(); setLineaActiva(lineaActiva?.id === l.id ? null : l); }}
                            className="w-4 h-4 rounded-full border-2 border-slate-300 hover:border-indigo-500" />
                      }
                    </div>
                  </div>
                  {l.conciliado && (
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-green-600 dark:text-green-400">Conciliada</span>
                      <button onClick={e => { e.stopPropagation(); handleDesMatch(l.id); }}
                        className="text-xs text-kx-text-3 hover:text-kx-red flex items-center gap-1">
                        <Unlink2 className="w-3 h-3" /> Deshacer
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Derecha: movimientos registrados */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-kx-text-2 uppercase">
              {lineaActiva ? `Seleccioná un movimiento para conciliar (${lineaActiva.tipo} ${formatMoney(lineaActiva.monto)})` : 'Movimientos sin conciliar'}
            </p>
            <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden max-h-[500px] overflow-y-auto">
              {movSinConc.length === 0 ? (
                <div className="p-8 text-center text-kx-text-3">Todos los movimientos están conciliados</div>
              ) : movSinConc.map(m => {
                const compatible = lineaActiva && m.tipo === lineaActiva.tipo && Math.abs(Number(m.monto) - lineaActiva.monto) < 1;
                return (
                  <div key={m.id}
                    onClick={() => lineaActiva && handleMatch(lineaActiva.id, m.id)}
                    className={`p-3 border-b border-slate-100 dark:border-kx-border transition-colors
                      ${lineaActiva ? (compatible ? 'bg-indigo-50 dark:bg-indigo-900/20 cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/40 ring-1 ring-inset ring-indigo-300' : 'opacity-40 cursor-default') : 'cursor-default'}
                    `}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-kx-text-3">{formatDateAR(m.fecha)}</p>
                        <p className="text-sm truncate dark:text-kx-text">{m.descripcion}</p>
                        <p className="text-xs text-kx-text-3">{m.origen}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-sm font-mono font-bold ${m.tipo === 'ingreso' ? 'text-kx-green' : 'text-kx-red'}`}>
                          {m.tipo === 'ingreso' ? '+' : '-'}{formatMoney(m.monto)}
                        </span>
                        {lineaActiva && compatible && <Link2 className="w-4 h-4 text-indigo-600 dark:text-indigo-500" />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {!extractoId && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-kx-text-3">
          <CheckCircle2 className="w-12 h-12 opacity-20" />
          <p className="font-medium">Sin extracto seleccionado</p>
          <p className="text-sm text-center max-w-xs">Importá un archivo CSV de tu banco para comenzar la conciliación.</p>
        </div>
      )}
    </div>
  );
}

export default ConciliacionTab;
