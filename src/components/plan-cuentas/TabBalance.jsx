import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { asientosService, PLAN_CUENTAS_KEYS } from '@/services/planCuentasService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TIPO_COLOR, TIPO_LABEL, fmt } from './shared';

function TabBalance({ empresaId }) {
  const [fechaDesde, setDesde] = useState('');
  const [fechaHasta, setHasta] = useState('');

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.balance(empresaId, fechaDesde, fechaHasta),
    queryFn: () => asientosService.getBalanceComprobacion(empresaId, fechaDesde || undefined, fechaHasta || undefined),
    enabled: !!empresaId,
  });

  const totalDebe  = rows.reduce((s, r) => s + r.total_debe,  0);
  const totalHaber = rows.reduce((s, r) => s + r.total_haber, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-kx-text-3 text-xs whitespace-nowrap">Desde</Label>
          <Input type="date" value={fechaDesde} onChange={(e) => setDesde(e.target.value)}
            className="bg-kx-surface-2 border-kx-border h-9 text-sm w-36" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-kx-text-3 text-xs whitespace-nowrap">Hasta</Label>
          <Input type="date" value={fechaHasta} onChange={(e) => setHasta(e.target.value)}
            className="bg-kx-surface-2 border-kx-border h-9 text-sm w-36" />
        </div>
        <Button onClick={() => refetch()} size="sm" variant="outline"
          className="border-kx-border text-kx-text-3 hover:bg-kx-surface-2">
          <RefreshCw size={14} className="mr-1" /> Actualizar
        </Button>
      </div>

      <div className="rounded-xl border border-kx-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-kx-surface-2">
            <tr>
              <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Código</th>
              <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Cuenta</th>
              <th className="px-4 py-3 text-center text-kx-text-3 font-medium">Tipo</th>
              <th className="px-4 py-3 text-right text-kx-text-3 font-medium">Debe</th>
              <th className="px-4 py-3 text-right text-kx-text-3 font-medium">Haber</th>
              <th className="px-4 py-3 text-right text-kx-text-3 font-medium">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-12 text-kx-text-2">
                <Loader2 size={20} className="animate-spin mx-auto" />
              </td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-kx-text-2">
                No hay movimientos confirmados
              </td></tr>
            )}
            {rows.map((r) => {
              const saldo = r.total_debe - r.total_haber;
              return (
                <tr key={r.cuenta_id} className="border-t border-kx-border hover:bg-kx-surface-2/30">
                  <td className="px-4 py-2.5 font-mono text-xs text-[#00D4FF]">{r.codigo}</td>
                  <td className="px-4 py-2.5 text-kx-text-3">{r.nombre}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${TIPO_COLOR[r.tipo]}`}>
                      {TIPO_LABEL[r.tipo]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-kx-text-3">{fmt(r.total_debe)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-kx-text-3">{fmt(r.total_haber)}</td>
                  <td className={`px-4 py-2.5 text-right font-mono font-bold ${saldo >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {fmt(Math.abs(saldo))} {saldo < 0 ? '(H)' : '(D)'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-kx-surface-2">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-kx-text-3 font-semibold">TOTALES</td>
                <td className={`px-4 py-3 text-right font-mono font-bold ${Math.abs(totalDebe - totalHaber) < 0.01 ? 'text-green-400' : 'text-kx-text'}`}>
                  {fmt(totalDebe)}
                </td>
                <td className={`px-4 py-3 text-right font-mono font-bold ${Math.abs(totalDebe - totalHaber) < 0.01 ? 'text-green-400' : 'text-kx-text'}`}>
                  {fmt(totalHaber)}
                </td>
                <td className={`px-4 py-3 text-right text-xs font-medium ${Math.abs(totalDebe - totalHaber) < 0.01 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {Math.abs(totalDebe - totalHaber) < 0.01 ? '✓ Cuadra' : `Dif: ${fmt(Math.abs(totalDebe - totalHaber))}`}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

export default TabBalance;
