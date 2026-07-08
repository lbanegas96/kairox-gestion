import { useState } from 'react';
import { BookMarked, Loader2, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { asientosService, PLAN_CUENTAS_KEYS } from '@/services/planCuentasService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TIPO_COLOR, TIPO_LABEL, fmt } from './shared';

function TabLibroMayor({ empresaId, cuentasFlat }) {
  const [cuentaId, setCuentaId] = useState('');
  const [fechaDesde, setDesde]  = useState('');
  const [fechaHasta, setHasta]  = useState('');

  const cuentasConMov = cuentasFlat.filter(c => c.permite_movimientos);
  const cuentaSeleccionada = cuentasFlat.find(c => c.id === cuentaId);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.libroMayor(empresaId, cuentaId, fechaDesde, fechaHasta),
    queryFn: () => asientosService.getLibroMayor(
      empresaId, cuentaId,
      fechaDesde || undefined, fechaHasta || undefined
    ),
    enabled: !!empresaId && !!cuentaId,
  });

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={cuentaId} onValueChange={setCuentaId}>
          <SelectTrigger className="w-72 bg-slate-800 border-slate-700 h-9 text-sm">
            <SelectValue placeholder="Seleccionar cuenta..." />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            {cuentasConMov.map(c => (
              <SelectItem key={c.id} value={c.id}>
                <span className="font-mono text-[#00D4FF] mr-2 text-xs">{c.codigo}</span>
                {c.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Label className="text-kx-text-3 text-xs whitespace-nowrap">Desde</Label>
          <Input type="date" value={fechaDesde} onChange={e => setDesde(e.target.value)}
            className="bg-slate-800 border-slate-700 h-9 text-sm w-36" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-kx-text-3 text-xs whitespace-nowrap">Hasta</Label>
          <Input type="date" value={fechaHasta} onChange={e => setHasta(e.target.value)}
            className="bg-slate-800 border-slate-700 h-9 text-sm w-36" />
        </div>
        <Button onClick={() => refetch()} size="sm" variant="outline" disabled={!cuentaId}
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw size={14} className="mr-1" /> Actualizar
        </Button>
      </div>

      {/* Placeholder cuando no hay cuenta seleccionada */}
      {!cuentaId && (
        <div className="text-center py-20 text-slate-500">
          <BookMarked size={36} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">Seleccioná una cuenta para ver sus movimientos</p>
          <p className="text-xs mt-1 text-kx-text-2">Solo se muestran asientos confirmados</p>
        </div>
      )}

      {/* Encabezado de cuenta seleccionada */}
      {cuentaId && cuentaSeleccionada && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${TIPO_COLOR[cuentaSeleccionada.tipo]}`}>
            {TIPO_LABEL[cuentaSeleccionada.tipo]}
          </span>
          <span className="font-mono text-[#00D4FF] text-sm">{cuentaSeleccionada.codigo}</span>
          <span className="font-semibold text-white">{cuentaSeleccionada.nombre}</span>
          {rows.length > 0 && (
            <span className="ml-auto text-kx-text-3 text-xs">{rows.length} movimiento{rows.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      )}

      {/* Tabla */}
      {cuentaId && (
        <div className="rounded-xl border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800">
              <tr>
                <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Fecha</th>
                <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Asiento</th>
                <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Descripción</th>
                <th className="px-4 py-3 text-right text-kx-text-3 font-medium">Debe</th>
                <th className="px-4 py-3 text-right text-kx-text-3 font-medium">Haber</th>
                <th className="px-4 py-3 text-right text-kx-text-3 font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="text-center py-12 text-slate-500">
                  <Loader2 size={20} className="animate-spin mx-auto" />
                </td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-slate-500">
                  Sin movimientos confirmados para esta cuenta
                </td></tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-800 hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-2.5 text-slate-300 whitespace-nowrap">
                    {new Date(row.asientos_contables.fecha + 'T12:00:00').toLocaleDateString('es-AR')}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[#00D4FF]">
                    {row.asientos_contables.numero}
                  </td>
                  <td className="px-4 py-2.5 text-kx-text-3 max-w-xs truncate">
                    {row.descripcion || row.asientos_contables.descripcion || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                    {Number(row.debe) > 0 ? fmt(row.debe) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-300">
                    {Number(row.haber) > 0 ? fmt(row.haber) : '—'}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono font-bold ${row.saldo_acumulado >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                    {fmt(Math.abs(row.saldo_acumulado))}
                    <span className="text-[10px] ml-1">{row.saldo_acumulado >= 0 ? 'D' : 'H'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (() => {
              const last = rows[rows.length - 1];
              const totalDebe  = rows.reduce((s, r) => s + Number(r.debe),  0);
              const totalHaber = rows.reduce((s, r) => s + Number(r.haber), 0);
              return (
                <tfoot className="bg-slate-800">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-kx-text-3 font-semibold">SALDO FINAL</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-300">{fmt(totalDebe)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-300">{fmt(totalHaber)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold text-lg ${last.saldo_acumulado >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                      {fmt(Math.abs(last.saldo_acumulado))} {last.saldo_acumulado >= 0 ? '(D)' : '(H)'}
                    </td>
                  </tr>
                </tfoot>
              );
            })()}
          </table>
        </div>
      )}
    </div>
  );
}

export default TabLibroMayor;
