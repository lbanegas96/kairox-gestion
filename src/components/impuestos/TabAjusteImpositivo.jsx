import { useState } from 'react';
import { Calculator, AlertTriangle, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { ajusteInflacionService } from '@/services/ajusteInflacionService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const fmtARS = (n) =>
  `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Ajuste por Inflación IMPOSITIVO (Ganancias, Ley 27.468 arts. 95/96,
// mig.381) -- circuito DISTINTO al contable de Plan de Cuentas → Balance
// General/Estado de Resultados (RT 6): usa la lista de exclusión legal del
// art. 95 (columna plan_cuentas.excluido_ajuste_impositivo), no
// naturaleza_monetaria -- Inventario acá SÍ es computable. No genera
// ningún asiento: es una calculadora de apoyo, la cifra final va en la
// Declaración Jurada de Ganancias, no en el Libro Mayor.
function TabAjusteImpositivo() {
  const { user } = useAuth();
  const empresaId = user?.empresa_id;

  const anioActual = new Date().getFullYear();
  const [fechaInicio, setFechaInicio] = useState(`${anioActual}-01-01`);
  const [fechaCierre, setFechaCierre] = useState(`${anioActual}-12-31`);
  const [resultado, setResultado] = useState(null);
  const [calculando, setCalculando] = useState(false);
  const [error, setError] = useState(null);

  const handleCalcular = async () => {
    setCalculando(true);
    setError(null);
    setResultado(null);
    try {
      const data = await ajusteInflacionService.calcularAjusteImpositivo(empresaId, fechaInicio, fechaCierre);
      setResultado(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setCalculando(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start gap-3 p-4 rounded-xl border border-cyan-500/30 bg-cyan-500/10">
        <Calculator className="w-5 h-5 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
        <div className="text-sm text-slate-700 dark:text-kx-text-2">
          <p className="font-semibold text-cyan-700 dark:text-cyan-400 mb-1">
            Ajuste por Inflación Impositivo (Ganancias)
          </p>
          <p>
            Estimación del ajuste por inflación de la Ley 27.468 (arts. 95/96 LIG) para el ejercicio
            fiscal elegido. <strong>No genera ningún asiento contable</strong> — es una herramienta de
            apoyo para armar la Declaración Jurada de Ganancias, no reemplaza el cálculo de tu asesor
            impositivo. Simplificaciones: solo excluye Bienes de Uso e Intangibles del activo
            computable (el resto de la lista del art. 95 — inversiones en el exterior, acciones
            societarias, existencias forestales, anticipos que congelan precio — no tiene cuenta
            propia en el plan de cuentas hoy), y no descuenta pasivos no computables (aportes
            irrevocables sin interés).
          </p>
        </div>
      </div>

      <div className="flex items-end gap-3 flex-wrap p-4 bg-kx-surface-2 dark:bg-slate-900/50 rounded-lg border kairox-border">
        <div>
          <Label className="text-xs text-kx-text-3">Inicio del ejercicio fiscal</Label>
          <Input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)}
            className="h-9 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
        </div>
        <div>
          <Label className="text-xs text-kx-text-3">Cierre del ejercicio fiscal</Label>
          <Input type="date" value={fechaCierre} onChange={(e) => setFechaCierre(e.target.value)}
            className="h-9 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
        </div>
        <Button onClick={handleCalcular} disabled={calculando || !empresaId} className="bg-cyan-600 hover:bg-cyan-700 text-white h-9">
          {calculando ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Calculando...</> : <><Calculator className="h-4 w-4 mr-2" /> Calcular</>}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm px-4 py-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {resultado && !resultado.ok && (
        <div className="flex items-center gap-2 text-sm px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {resultado.mensaje}
        </div>
      )}

      {resultado?.ok && (
        <div className="space-y-4">
          <div className="rounded-xl border border-kx-border overflow-hidden">
            <div className="bg-kx-surface-2 px-4 py-2 border-b border-kx-border">
              <span className="text-sm font-semibold text-kx-text">Ajuste estático (patrimonio de apertura)</span>
            </div>
            <div className="divide-y divide-kx-border text-sm">
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-kx-text-3">Activo computable al inicio</span>
                <span className="font-mono tabular-nums text-kx-text">{fmtARS(resultado.activo_computable_inicio)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-kx-text-3">Pasivo computable al inicio</span>
                <span className="font-mono tabular-nums text-kx-text">{fmtARS(resultado.pasivo_computable_inicio)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-kx-text-3">Patrimonio Neto computable al inicio</span>
                <span className="font-mono tabular-nums text-kx-text font-medium">{fmtARS(resultado.pn_computable_inicio)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-kx-text-3">Coeficiente anual (IPC cierre / IPC cierre anterior)</span>
                <span className="font-mono tabular-nums text-kx-text">{Number(resultado.coeficiente_anual).toLocaleString('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5 bg-kx-surface-2/50">
                <span className="text-kx-text font-semibold">Ajuste estático</span>
                <span className="font-mono tabular-nums font-bold text-kx-text">{fmtARS(resultado.ajuste_estatico)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-kx-border overflow-hidden">
            <div className="bg-kx-surface-2 px-4 py-2 border-b border-kx-border">
              <span className="text-sm font-semibold text-kx-text">Ajuste dinámico (movimientos del ejercicio)</span>
            </div>
            <div className="px-4 py-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-kx-text-3">Aportes/retiros de Capital Social + compra/venta de Bienes de Uso e Intangibles</span>
                <span className="font-mono tabular-nums font-bold text-kx-text">{fmtARS(resultado.ajuste_dinamico)}</span>
              </div>
            </div>
          </div>

          {resultado.meses_sin_indice?.length > 0 && (
            <div className="text-xs px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              Faltan índices de {resultado.meses_sin_indice.join(', ')} — esos movimientos quedan sin reexpresar (ajuste dinámico parcial).
            </div>
          )}

          <div className={`rounded-xl border p-4 flex items-center justify-between
            ${resultado.ajuste_total >= 0 ? 'border-kx-green/30 bg-kx-green/10' : 'border-kx-red/30 bg-kx-red/10'}`}>
            <div className="flex items-center gap-2">
              {resultado.ajuste_total >= 0 ? <TrendingUp size={18} className="text-kx-green" /> : <TrendingDown size={18} className="text-kx-red" />}
              <span className="font-semibold text-kx-text">Ajuste por Inflación Impositivo Total</span>
              <span className={`text-2xs px-2 py-0.5 rounded-full border font-medium
                ${resultado.ajuste_total >= 0 ? 'bg-kx-green/10 text-kx-green border-kx-green/30' : 'bg-kx-red/10 text-kx-red border-kx-red/30'}`}>
                {resultado.ajuste_total >= 0 ? 'Deducible (reduce Ganancias)' : 'Gravado (aumenta Ganancias)'}
              </span>
            </div>
            <span className={`text-xl font-mono font-bold ${resultado.ajuste_total >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
              {fmtARS(Math.abs(resultado.ajuste_total))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default TabAjusteImpositivo;
