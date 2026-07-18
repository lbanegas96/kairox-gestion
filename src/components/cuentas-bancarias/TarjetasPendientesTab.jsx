import { CreditCard, Check, RefreshCw, Clock, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { liquidacionTarjetasService, LIQUIDACION_KEYS } from '@/services/liquidacionTarjetasService';
import { CB_KEYS } from '@/services/cuentasBancariasService';
import { formatDateAR } from '@/lib/dateUtils';
import { formatMoney } from './shared';

function diasHasta(fechaISO) {
  if (!fechaISO) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const fecha = new Date(`${fechaISO}T00:00:00`);
  return Math.round((fecha - hoy) / 86400000);
}

function TarjetasPendientesTab({ empresaId }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: pendientes = [], isLoading } = useQuery({
    queryKey: LIQUIDACION_KEYS.pendientes(empresaId),
    queryFn: () => liquidacionTarjetasService.getPendientes(empresaId),
    enabled: !!empresaId,
  });

  const acreditarMut = useMutation({
    mutationFn: (id) => liquidacionTarjetasService.acreditar(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: LIQUIDACION_KEYS.pendientes(empresaId) });
      qc.invalidateQueries({ queryKey: ['movimientos_bancarios', empresaId] });
      qc.invalidateQueries({ queryKey: CB_KEYS.movimientosSaldo(empresaId) });
      toast({ title: `✓ Acreditado — neto ${formatMoney(res?.monto_neto)}`, className: 'bg-green-600 text-white' });
    },
    onError: (e) => toast({ title: 'No se pudo acreditar', description: e.message, variant: 'destructive' }),
  });

  const totalBruto = pendientes.reduce((a, m) => a + Number(m.monto), 0);
  const totalNeto = pendientes.reduce((a, m) => a + Number(m.monto_neto ?? 0), 0);

  if (isLoading) {
    return <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-kx-text-3" /></div>;
  }

  if (pendientes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-kx-text-3">
        <CreditCard className="w-12 h-12 opacity-30" />
        <p className="font-medium">Sin tarjetas pendientes de acreditación</p>
        <p className="text-sm text-center max-w-sm">
          Cuando cobrás con una forma de pago con días de acreditación configurados, el cobro
          queda acá hasta que confirmes que el banco lo depositó.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div className="p-3 rounded-lg bg-kx-surface-2 dark:bg-kx-surface border border-kx-border dark:border-kx-border">
          <p className="text-2xs text-kx-text-3 uppercase">Bruto pendiente</p>
          <p className="text-lg font-bold font-mono text-kx-text">{formatMoney(totalBruto)}</p>
        </div>
        <div className="p-3 rounded-lg bg-kx-surface-2 dark:bg-kx-surface border border-kx-border dark:border-kx-border">
          <p className="text-2xs text-kx-text-3 uppercase">Neto a acreditar</p>
          <p className="text-lg font-bold font-mono text-kx-green">{formatMoney(totalNeto)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b dark:border-kx-border bg-slate-50/70 dark:bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-kx-text-2 uppercase">Fecha cobro</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-kx-text-2 uppercase">Forma de pago</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-kx-text-2 uppercase">Bruto</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-kx-text-2 uppercase">Comisión</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-kx-text-2 uppercase">Neto</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-kx-text-2 uppercase">Acreditación estimada</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-kx-text-2 uppercase"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-800">
              {pendientes.map(m => {
                const dias = diasHasta(m.fecha_acreditacion_estimada);
                const vencida = dias !== null && dias <= 0;
                return (
                  <tr key={m.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-kx-text-2 whitespace-nowrap">{formatDateAR(m.fecha)}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">{m.metodo_pago}</td>
                    <td className="px-4 py-3 text-right font-mono text-kx-text">{formatMoney(m.monto)}</td>
                    <td className="px-4 py-3 text-right font-mono text-kx-red">-{formatMoney(m.monto_comision)}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-kx-green">{formatMoney(m.monto_neto)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-2xs font-medium whitespace-nowrap ${
                        vencida
                          ? 'text-amber-600 dark:text-amber-400 border-amber-400/30 bg-amber-500/10'
                          : 'text-kx-text-3 border-kx-border bg-kx-surface-2'
                      }`}>
                        {vencida ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {formatDateAR(m.fecha_acreditacion_estimada)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        size="sm" variant="outline"
                        className="h-7 px-2 text-2xs"
                        onClick={() => acreditarMut.mutate(m.id)}
                        disabled={acreditarMut.isPending}
                      >
                        <Check className="w-3.5 h-3.5 mr-1" /> Marcar acreditada
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default TarjetasPendientesTab;
