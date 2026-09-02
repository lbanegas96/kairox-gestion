import { useState, useMemo } from 'react';
import { AlertTriangle, Loader2, CheckCircle2, RefreshCw, Scale, Download, Calculator } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { asientosService, PLAN_CUENTAS_KEYS } from '@/services/planCuentasService';
import { ajusteInflacionService } from '@/services/ajusteInflacionService';
import { useAjusteInflacionHabilitado } from '@/hooks/useAjusteInflacionHabilitado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { fmt, csvDownload } from './shared';

function TabBalanceGeneral({ empresaId }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [fechaCorte, setFechaCorte] = useState(todayStr);
  const [monedaHomogenea, setMonedaHomogenea] = useState(false);
  const { habilitado: ajusteInflacionHabilitado } = useAjusteInflacionHabilitado();

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.balanceGeneral(empresaId, fechaCorte),
    queryFn: () => asientosService.getBalanceComprobacion(empresaId, undefined, fechaCorte || undefined),
    enabled: !!empresaId,
  });

  // Fase 2 (Ajuste por Inflación) — reexpresión de solo lectura, no genera
  // asiento. Solo se pide cuando el toggle está activo, para no gastar la
  // llamada si nadie la usa.
  const { data: reexpresion, isFetching: cargandoReexpresion } = useQuery({
    queryKey: ['reexpresion_moneda_homogenea', empresaId, fechaCorte],
    queryFn: () => ajusteInflacionService.calcularReexpresion(empresaId, null, fechaCorte),
    enabled: !!empresaId && !!fechaCorte && monedaHomogenea && ajusteInflacionHabilitado,
  });

  const calc = useMemo(() => {
    // Mapa cuenta_id -> monto reexpresado (solo trae las no monetarias con
    // movimiento — las que no aparecen acá no cambian, ya están en pesos de hoy).
    const homogMap = new Map((reexpresion?.montos ?? []).map(m => [m.cuenta_id, m.monto_homogeneo]));
    const aplicarHomog = monedaHomogenea && reexpresion && !reexpresion.indice_hasta_faltante;
    const montoDe = (r, historico) => (aplicarHomog && homogMap.has(r.cuenta_id)) ? homogMap.get(r.cuenta_id) : historico;

    const activos = rows.filter(r => r.tipo === 'activo')
      .map(r => ({ ...r, monto: montoDe(r, r.total_debe - r.total_haber) }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));

    const pasivos = rows.filter(r => r.tipo === 'pasivo')
      .map(r => ({ ...r, monto: montoDe(r, r.total_haber - r.total_debe) }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));

    // "Resultado del Ejercicio" se excluye del listado genérico de patrimonio:
    // se recalcula como Ingresos - Egresos acumulados a la fecha de corte
    // (no hay asiento de cierre automático que lo cargue), y se suma cualquier
    // saldo manual que ya tuviera esa cuenta. La identidad contable cierra
    // igual sin importar si esa cuenta tiene movimientos o no (partida doble).
    const patrimonioRows = rows.filter(r => r.tipo === 'patrimonio');
    const resultadoCuenta = patrimonioRows.find(r => r.nombre.trim().toLowerCase() === 'resultado del ejercicio');
    const patrimonios = patrimonioRows
      .filter(r => r !== resultadoCuenta)
      .map(r => ({ ...r, monto: montoDe(r, r.total_haber - r.total_debe) }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));

    const totalIngresos = rows.filter(r => r.tipo === 'ingreso').reduce((s, r) => s + montoDe(r, r.total_haber - r.total_debe), 0);
    const totalEgresos = rows.filter(r => r.tipo === 'egreso').reduce((s, r) => s + montoDe(r, r.total_debe - r.total_haber), 0);
    const resultadoManual = resultadoCuenta ? montoDe(resultadoCuenta, resultadoCuenta.total_haber - resultadoCuenta.total_debe) : 0;
    const resultadoEjercicio = resultadoManual + (totalIngresos - totalEgresos);

    const totalActivo = activos.reduce((s, r) => s + r.monto, 0);
    const totalPasivo = pasivos.reduce((s, r) => s + r.monto, 0);
    const totalPatrimonioOtros = patrimonios.reduce((s, r) => s + r.monto, 0);

    // En moneda homogénea, reexpresar cada cuenta por separado (a su propio
    // coeficiente) deja un residuo — es exactamente el RECPAM que Fase 1
    // asentaría si se generara el ajuste real para este rango. Se muestra
    // como línea informativa para que el Balance siga cerrando a la vista,
    // dejando claro que es una vista previa, no un asiento contabilizado.
    const recpamImplicito = aplicarHomog
      ? totalActivo - totalPasivo - totalPatrimonioOtros - resultadoEjercicio
      : 0;
    const totalPatrimonio = totalPatrimonioOtros + resultadoEjercicio + recpamImplicito;

    const diferencia = totalActivo - (totalPasivo + totalPatrimonio);
    const cierra = Math.abs(diferencia) < 0.01;

    return { activos, pasivos, patrimonios, resultadoEjercicio, recpamImplicito, aplicarHomog, totalActivo, totalPasivo, totalPatrimonio, diferencia, cierra };
  }, [rows, reexpresion, monedaHomogenea]);

  const handleExportCSV = () => {
    const lineas = [
      ...calc.activos.map(r => `${r.codigo},"${r.nombre}",Activo,${r.monto.toFixed(2)}`),
      `,,Total Activo,${calc.totalActivo.toFixed(2)}`,
      ...calc.pasivos.map(r => `${r.codigo},"${r.nombre}",Pasivo,${r.monto.toFixed(2)}`),
      `,,Total Pasivo,${calc.totalPasivo.toFixed(2)}`,
      ...calc.patrimonios.map(r => `${r.codigo},"${r.nombre}",Patrimonio,${r.monto.toFixed(2)}`),
      `,,Resultado del Ejercicio (calculado),${calc.resultadoEjercicio.toFixed(2)}`,
      `,,Total Patrimonio,${calc.totalPatrimonio.toFixed(2)}`,
      `,,Pasivo + Patrimonio,${(calc.totalPasivo + calc.totalPatrimonio).toFixed(2)}`,
    ];
    csvDownload(`balance-general-${fechaCorte}.csv`, 'Código,Cuenta,Tipo,Monto', lineas);
  };

  const sinDatos = !isLoading && rows.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-kx-text-3 text-xs whitespace-nowrap">Fecha de corte</Label>
          <Input type="date" value={fechaCorte} onChange={(e) => setFechaCorte(e.target.value)}
            className="bg-kx-surface-2 border-kx-border h-9 text-sm w-36" />
        </div>
        <Button onClick={() => refetch()} size="sm" variant="outline"
          className="border-kx-border text-kx-text-3 hover:bg-kx-surface-2">
          <RefreshCw size={14} className="mr-1" /> Actualizar
        </Button>
        {!sinDatos && (
          <Button onClick={handleExportCSV} size="sm" variant="outline"
            className="border-kx-border text-kx-text-3 hover:bg-kx-surface-2">
            <Download size={14} className="mr-1" /> Exportar CSV
          </Button>
        )}

        {!sinDatos && ajusteInflacionHabilitado && (
          <label className="flex items-center gap-2 text-xs text-kx-text-3 cursor-pointer">
            <Switch checked={monedaHomogenea} onCheckedChange={setMonedaHomogenea} />
            <span className="flex items-center gap-1">
              <Calculator size={13} /> Ver en moneda homogénea
              {cargandoReexpresion && <Loader2 size={12} className="animate-spin" />}
            </span>
          </label>
        )}

        <div className="flex-1" />

        {!sinDatos && (
          <span className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium
            ${calc.cierra ? 'bg-kx-green/10 text-kx-green border-kx-green/30' : 'bg-kx-red/10 text-kx-red border-kx-red/30'}`}>
            {calc.cierra ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {calc.cierra ? 'Balanceado: Activo = Pasivo + Patrimonio' : `Descuadrado — diferencia: ${fmt(Math.abs(calc.diferencia))}`}
          </span>
        )}
      </div>

      {monedaHomogenea && reexpresion?.indice_hasta_faltante && (
        <div className="text-xs px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
          Falta cargar el índice de inflación del mes de {fechaCorte?.slice(0, 7)} en Configuración → Finanzas —
          se muestra el Balance histórico.
        </div>
      )}
      {monedaHomogenea && reexpresion?.meses_sin_indice?.length > 0 && !reexpresion.indice_hasta_faltante && (
        <div className="text-xs px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
          Faltan índices de {reexpresion.meses_sin_indice.join(', ')} — esas cuentas quedan sin reexpresar en esos meses (ajuste parcial).
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-kx-blue" />
        </div>
      )}

      {sinDatos && (
        <div className="text-center py-20 text-kx-text-2">
          <Scale size={36} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No hay movimientos hasta la fecha seleccionada</p>
          <p className="text-xs mt-1 text-kx-text-2">Solo se consideran asientos confirmados</p>
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Activo */}
          <div className="rounded-xl border border-kx-border overflow-hidden self-start">
            <div className="bg-kx-blue/10 px-4 py-2 border-b border-kx-border">
              <span className="text-sm font-semibold text-kx-blue">Activo</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {calc.activos.length === 0 && (
                  <tr><td className="px-4 py-4 text-center text-kx-text-2 text-xs">Sin cuentas de activo con movimientos</td></tr>
                )}
                {calc.activos.map((r) => (
                  <tr key={r.cuenta_id} className="border-t border-kx-border hover:bg-kx-surface-2/30">
                    <td className="px-4 py-2.5 font-mono text-xs text-kx-blue w-20">{r.codigo}</td>
                    <td className="px-4 py-2.5 text-kx-text-3">{r.nombre}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-kx-text-3 w-36">{fmt(r.monto)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-kx-surface-2/50">
                <tr>
                  <td colSpan={2} className="px-4 py-2.5 text-kx-text-3 font-semibold">Total Activo</td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-kx-blue">{fmt(calc.totalActivo)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Pasivo + Patrimonio */}
          <div className="space-y-4">
            <div className="rounded-xl border border-kx-border overflow-hidden">
              <div className="bg-kx-red/10 px-4 py-2 border-b border-kx-border">
                <span className="text-sm font-semibold text-kx-red">Pasivo</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {calc.pasivos.length === 0 && (
                    <tr><td className="px-4 py-4 text-center text-kx-text-2 text-xs">Sin cuentas de pasivo con movimientos</td></tr>
                  )}
                  {calc.pasivos.map((r) => (
                    <tr key={r.cuenta_id} className="border-t border-kx-border hover:bg-kx-surface-2/30">
                      <td className="px-4 py-2.5 font-mono text-xs text-kx-blue w-20">{r.codigo}</td>
                      <td className="px-4 py-2.5 text-kx-text-3">{r.nombre}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-kx-text-3 w-36">{fmt(r.monto)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-kx-surface-2/50">
                  <tr>
                    <td colSpan={2} className="px-4 py-2.5 text-kx-text-3 font-semibold">Total Pasivo</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-kx-red">{fmt(calc.totalPasivo)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="rounded-xl border border-kx-border overflow-hidden">
              <div className="bg-kx-violet/10 px-4 py-2 border-b border-kx-border">
                <span className="text-sm font-semibold text-kx-violet">Patrimonio Neto</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {calc.patrimonios.map((r) => (
                    <tr key={r.cuenta_id} className="border-t border-kx-border hover:bg-kx-surface-2/30">
                      <td className="px-4 py-2.5 font-mono text-xs text-kx-blue w-20">{r.codigo}</td>
                      <td className="px-4 py-2.5 text-kx-text-3">{r.nombre}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-kx-text-3 w-36">{fmt(r.monto)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-kx-border hover:bg-kx-surface-2/30">
                    <td className="px-4 py-2.5 font-mono text-xs text-kx-blue w-20">3.3</td>
                    <td className="px-4 py-2.5 text-kx-text-3 italic">
                      Resultado del Ejercicio
                      <span className="ml-2 text-2xs text-kx-text-3 not-italic">(calculado del P&amp;L)</span>
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono w-36 ${calc.resultadoEjercicio >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
                      {fmt(calc.resultadoEjercicio)}
                    </td>
                  </tr>
                  {calc.aplicarHomog && (
                    <tr className="border-t border-kx-border hover:bg-kx-surface-2/30">
                      <td className="px-4 py-2.5 font-mono text-xs text-cyan-500 w-20">—</td>
                      <td className="px-4 py-2.5 text-kx-text-3 italic">
                        RECPAM (implícito)
                        <span className="ml-2 text-2xs text-kx-text-3 not-italic">no contabilizado — vista previa</span>
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono w-36 ${calc.recpamImplicito >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
                        {fmt(calc.recpamImplicito)}
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-kx-surface-2/50">
                  <tr>
                    <td colSpan={2} className="px-4 py-2.5 text-kx-text-3 font-semibold">Total Patrimonio</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-kx-violet">{fmt(calc.totalPatrimonio)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className={`rounded-xl border p-3 flex items-center justify-between
              ${calc.cierra ? 'border-kx-green/30 bg-kx-green/10' : 'border-kx-red/30 bg-kx-red/10'}`}>
              <span className="text-sm font-semibold text-kx-text">Pasivo + Patrimonio</span>
              <span className={`font-mono font-bold ${calc.cierra ? 'text-kx-green' : 'text-kx-red'}`}>
                {fmt(calc.totalPasivo + calc.totalPatrimonio)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TabBalanceGeneral;
