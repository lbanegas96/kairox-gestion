import { useState, useCallback } from 'react';
import { Landmark, Calendar, RefreshCw, ArrowLeft, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { getTodayAR } from '@/lib/dateUtils';
import { formatCurrency } from '@/lib/currencyUtils';
import { useToast } from '@/components/ui/use-toast';
import { fetchPosicionIva } from '@/lib/posicionIva';

// Posición Fiscal Consolidada — cruza IVA, IIBB y Retenciones, que hoy son 3
// cálculos sueltos (uno por tab de Impuestos) que nunca se ven juntos.
//
// IVA: Débito menos Crédito, calculado por `fetchPosicionIva` (src/lib/
// posicionIva.js) — la MISMA función que usa Impuestos → IVA, con el mismo
// criterio que Libro IVA Ventas/Compras (NC/ND de cliente y de proveedor,
// sin canceladas/anuladas, solo CAE válido). Antes esta pantalla tenía su
// propia copia que solo sumaba ventas y compras "crudas" y no coincidía con
// ninguna de las otras.
//
// IIBB: el sistema NO tiene guardada la alícuota de Ingresos Brutos en
// ningún lado (iibb_coeficientes solo guarda el % de DISTRIBUCIÓN entre
// jurisdicciones para el CM05, no una tasa) — confirmado revisando el schema
// completo antes de escribir esto. Mostrar un "monto a pagar" inventado acá
// sería directamente incorrecto. Se muestra la Base Imponible + Coeficiente
// de Distribución (los 2 insumos que el contador necesita) con el gap
// explícito, en vez de fabricar un número.
//
// Retenciones: "sufridas" son un crédito real (ya te las retuvieron), se
// restan del total. "practicadas" son plata de terceros que hay que
// depositar — una obligación aparte, nunca se mezcla con lo anterior.
function ReportePosicionFiscal({ onBack }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const todayStr = getTodayAR();
  const firstOfMonthStr = todayStr.slice(0, 7) + '-01';

  const [fechaDesde, setFechaDesde] = useState(firstOfMonthStr);
  const [fechaHasta, setFechaHasta] = useState(todayStr);
  const [posicion, setPosicion] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);

  const fetchPosicion = useCallback(async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    try {
      const rangoDesde = `${fechaDesde}T00:00:00`;
      const rangoHasta = `${fechaHasta}T23:59:59`;

      const [
        iva,
        { data: ventas, error: e1 },
        { data: retenciones, error: e3 },
        { data: coeficientes, error: e4 },
      ] = await Promise.all([
        // IVA: misma función que Impuestos → IVA, mismo criterio que los Libros.
        fetchPosicionIva(supabase, user.empresa_id, fechaDesde, fechaHasta),
        // Solo para la Base Imponible de IIBB (más abajo) — el IVA ya no sale de acá.
        supabase.from('comprobantes').select('neto_gravado')
          .eq('empresa_id', user.empresa_id).eq('tipo', 'venta')
          .gte('fecha', rangoDesde).lte('fecha', rangoHasta),
        supabase.from('retenciones').select('tipo, impuesto, monto')
          .eq('empresa_id', user.empresa_id)
          .gte('fecha', fechaDesde).lte('fecha', fechaHasta),
        supabase.from('iibb_coeficientes').select('jurisdiccion, coeficiente')
          .eq('empresa_id', user.empresa_id).eq('activo', true),
      ]);
      if (e1) throw e1; if (e3) throw e3; if (e4) throw e4;

      const { debito: debitoFiscal, credito: creditoFiscal, saldo: saldoIVA } = iva;

      const baseImponibleIIBB = (ventas || []).reduce((s, v) => s + Number(v.neto_gravado || 0), 0);
      const coeficienteTotal = (coeficientes || []).reduce((s, c) => s + Number(c.coeficiente || 0), 0);

      const sufridasPorImpuesto = {};
      let totalSufridas = 0;
      let totalPracticadas = 0;
      (retenciones || []).forEach(r => {
        const monto = Number(r.monto || 0);
        if (r.tipo === 'sufrida') {
          sufridasPorImpuesto[r.impuesto] = (sufridasPorImpuesto[r.impuesto] || 0) + monto;
          totalSufridas += monto;
        } else if (r.tipo === 'practicada') {
          totalPracticadas += monto;
        }
      });

      const totalEstimado = Math.max(0, saldoIVA) - totalSufridas;

      setPosicion({
        debitoFiscal, creditoFiscal, saldoIVA,
        baseImponibleIIBB, coeficienteTotal, jurisdicciones: (coeficientes || []).length,
        sufridasPorImpuesto, totalSufridas, totalPracticadas,
        totalEstimado,
      });
      setGenerated(true);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user?.empresa_id, fechaDesde, fechaHasta, toast]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="dark:text-slate-300">
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <Landmark className="h-6 w-6 text-kx-red" />
            Posición Fiscal Consolidada
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
            IVA, IIBB y Retenciones del período, cruzados en un solo lugar
          </p>
        </div>
      </div>

      <div className="bg-kx-surface p-5 rounded-xl border border-kx-border shadow-sm">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs text-slate-500 dark:text-kx-text-2 font-medium">Desde</Label>
            <Input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
              className="h-9 w-40 dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-500 dark:text-kx-text-2 font-medium">Hasta</Label>
            <Input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
              className="h-9 w-40 dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text" />
          </div>
          <Button onClick={fetchPosicion} disabled={loading}
            className="bg-kx-red hover:bg-red-700 text-white h-9">
            {loading ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : <Calendar className="h-4 w-4 mr-1.5" />}
            Generar
          </Button>
        </div>
      </div>

      {generated && posicion && (
        <>
          <Card className="p-5 dark:bg-kx-surface dark:border-kx-border border-2 border-kx-red/30">
            <p className="text-xs text-kx-text-3 uppercase tracking-wide">Total Neto Estimado a Pagar</p>
            <p className={`text-3xl font-black mt-1 font-mono ${posicion.totalEstimado >= 0 ? 'text-kx-red' : 'text-kx-green'}`}>
              {formatCurrency(Math.abs(posicion.totalEstimado))}
            </p>
            <p className="text-xs text-kx-text-3 mt-1">
              Saldo IVA (si es a pagar) menos Retenciones Sufridas totales — <strong>no incluye IIBB</strong> (ver abajo por qué)
            </p>
          </Card>

          <div>
            <h3 className="text-sm font-bold text-kx-text mb-2 uppercase tracking-wide">IVA</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
                <p className="text-xs text-kx-text-3 uppercase tracking-wide">Débito Fiscal (Ventas)</p>
                <p className="text-xl font-black text-kx-text mt-1 font-mono">{formatCurrency(posicion.debitoFiscal)}</p>
              </Card>
              <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
                <p className="text-xs text-kx-text-3 uppercase tracking-wide">Crédito Fiscal (Compras)</p>
                <p className="text-xl font-black text-kx-text mt-1 font-mono">{formatCurrency(posicion.creditoFiscal)}</p>
              </Card>
              <Card className={`p-4 dark:bg-kx-surface border-2 ${posicion.saldoIVA >= 0 ? 'border-kx-red/30' : 'border-kx-green/30'}`}>
                <p className="text-xs text-kx-text-3 uppercase tracking-wide">{posicion.saldoIVA >= 0 ? 'Saldo a Pagar' : 'Saldo a Favor'}</p>
                <p className={`text-xl font-black mt-1 font-mono ${posicion.saldoIVA >= 0 ? 'text-kx-red' : 'text-kx-green'}`}>
                  {formatCurrency(Math.abs(posicion.saldoIVA))}
                </p>
              </Card>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-kx-text mb-2 uppercase tracking-wide">IIBB</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
                <p className="text-xs text-kx-text-3 uppercase tracking-wide">Base Imponible (Ingresos Gravados)</p>
                <p className="text-xl font-black text-kx-text mt-1 font-mono">{formatCurrency(posicion.baseImponibleIIBB)}</p>
              </Card>
              <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
                <p className="text-xs text-kx-text-3 uppercase tracking-wide">Coeficiente de Distribución ({posicion.jurisdicciones} jurisdicc.)</p>
                <p className="text-xl font-black text-kx-text mt-1 font-mono">{posicion.coeficienteTotal.toFixed(2)}%</p>
              </Card>
            </div>
            <div className="flex items-start gap-2 p-3 mt-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                El sistema no tiene cargada la alícuota de Ingresos Brutos de tu jurisdicción, así que no calcula un monto en pesos.
                Usá la Base Imponible de arriba (aplicale tu coeficiente y tu alícuota) o pasásela directo a tu contador.
              </span>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-kx-text mb-2 uppercase tracking-wide">Retenciones</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card className="p-4 dark:bg-kx-surface dark:border-kx-border border-2 border-kx-green/30">
                <p className="text-xs text-kx-text-3 uppercase tracking-wide">Sufridas (a tu favor)</p>
                <p className="text-xl font-black text-kx-green mt-1 font-mono">{formatCurrency(posicion.totalSufridas)}</p>
                {Object.entries(posicion.sufridasPorImpuesto).map(([imp, monto]) => (
                  <p key={imp} className="text-xs text-kx-text-3 mt-1">{imp}: {formatCurrency(monto)}</p>
                ))}
              </Card>
              <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
                <p className="text-xs text-kx-text-3 uppercase tracking-wide">Practicadas (depósito de terceros)</p>
                <p className="text-xl font-black text-kx-text mt-1 font-mono">{formatCurrency(posicion.totalPracticadas)}</p>
                <p className="text-xs text-kx-text-3 mt-1">Obligación aparte — no se resta de tu propio saldo</p>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ReportePosicionFiscal;
