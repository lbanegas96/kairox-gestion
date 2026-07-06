import React from 'react';
import { TrendingUp, TrendingDown, Scale, Clock, Lock, Unlock, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTimeAR } from '@/lib/dateUtils';

function EstadoCajaHeader({
  isSessionOpen,
  currentSession,
  totals,
  tcParalelo,
  onAbrirCaja,
  onCerrarCaja,
}) {
  return (
    <>
      <Card className={`border-kx-border dark:border-kx-border shadow-sm transition-all overflow-hidden ${isSessionOpen ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-orange-400'}`}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 py-4 px-6 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-4">
            <div className={`p-2 rounded-lg ${isSessionOpen ? 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400' : 'bg-orange-100 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400'}`}>
              <Archive className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
                {isSessionOpen ? "Caja Abierta" : "Caja Cerrada"}
                {isSessionOpen && (
                  <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" title="Estado: Activo" />
                )}
              </CardTitle>
              <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
                {isSessionOpen ? "Operaciones habilitadas" : "Inicia sesión para operar"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {isSessionOpen && currentSession && (
              <div className="hidden md:flex flex-col items-end mr-2">
                <span className="text-xs text-slate-500 dark:text-kx-text-2 uppercase font-semibold">Saldo Inicial</span>
                <span className="text-lg font-bold font-mono text-kx-text dark:text-kx-text">
                  ${currentSession.monto_inicial?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-kx-text-3 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {(() => {
                    const [fecha, hora] = formatDateTimeAR(currentSession.apertura_fecha).split(' ');
                    return `${fecha} · ${hora} hs`;
                  })()}
                </span>
              </div>
            )}

            {!isSessionOpen ? (
              <Button
                onClick={onAbrirCaja}
                className="bg-green-600 hover:bg-green-700 text-white shadow-md hover:shadow-lg transition-all dark:bg-green-700 dark:hover:bg-green-600"
              >
                <Unlock className="w-4 h-4 mr-2" /> Abrir Caja
              </Button>
            ) : (
              <Button
                onClick={onCerrarCaja}
                variant="outline"
                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/30 dark:hover:bg-red-900/20 dark:text-red-400 shadow-sm"
              >
                <Lock className="w-4 h-4 mr-2" /> Cerrar Caja
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {isSessionOpen && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden shadow-sm dark:shadow-none">
          <div className="bg-kx-surface p-5 flex items-center gap-4 border-t-2 border-t-kx-green">
            <div className="p-3 rounded-xl bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 shrink-0">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[11px] text-kx-text-2 uppercase font-medium tracking-wide">Ingresos del turno</div>
              <div className="text-2xl font-bold font-mono text-kx-green tabular-nums">
                ${totals.ingresos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </div>
              {tcParalelo.enabled && tcParalelo.tcHoy && (
                <div className="text-xs text-kx-text-3 mt-0.5">
                  ≈ {(totals.ingresos / tcParalelo.tcHoy).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}
                </div>
              )}
              <div className="text-xs text-kx-text-3 mt-0.5">Desde apertura de caja</div>
            </div>
          </div>

          <div className="bg-kx-surface p-5 flex items-center gap-4 border-t-2 border-t-kx-red">
            <div className="p-3 rounded-xl bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 shrink-0">
              <TrendingDown className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[11px] text-kx-text-2 uppercase font-medium tracking-wide">Egresos del turno</div>
              <div className="text-2xl font-bold font-mono text-kx-red tabular-nums">
                ${totals.egresos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </div>
              {tcParalelo.enabled && tcParalelo.tcHoy && (
                <div className="text-xs text-kx-text-3 mt-0.5">
                  ≈ {(totals.egresos / tcParalelo.tcHoy).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}
                </div>
              )}
              <div className="text-xs text-kx-text-3 mt-0.5">Desde apertura de caja</div>
            </div>
          </div>

          {(() => {
            const saldo = (currentSession?.monto_inicial || 0) + totals.ingresos - totals.egresos;
            return (
              <div className={`bg-kx-surface p-5 flex items-center gap-4 border-t-2 ${saldo >= 0 ? 'border-t-kx-blue' : 'border-t-kx-amber'}`}>
                <div className={`p-3 rounded-xl shrink-0 ${saldo >= 0 ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'bg-orange-100 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400'}`}>
                  <Scale className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-[11px] text-kx-text-2 uppercase font-medium tracking-wide">Saldo líquido de caja</div>
                  <div className={`text-2xl font-bold font-mono tabular-nums ${saldo >= 0 ? 'text-kx-blue' : 'text-kx-amber'}`}>
                    ${saldo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </div>
                  {tcParalelo.enabled && tcParalelo.tcHoy && (
                    <div className="text-xs text-kx-text-3 mt-0.5">
                      ≈ {(saldo / tcParalelo.tcHoy).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}
                    </div>
                  )}
                  <div className="text-xs text-kx-text-3 mt-0.5">SI + Ingresos − Egresos</div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
}

export default EstadoCajaHeader;
