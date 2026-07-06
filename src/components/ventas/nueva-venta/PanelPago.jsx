import React from 'react';
import { Check, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MonedaSelector } from '@/components/ui/MonedaSelector';
import { formatCurrency } from '@/lib/currencyUtils';

function PanelPago({
  totalEnMonedaSeleccionada, moneda, tipoCambioTasa, calculateTotal,
  setMoneda, setTipoCambioTasa, setTcMissing,
  tcParalelo, setShowParaleloTCModal,
  selectedMethods, toggleMethod, isMultiPago, methodAmounts, setMethodAmounts, restante,
  listaNombre,
  selectedClient, clients, handleSelectClient,
  isCC,
  loading, cart, tcMissing,
  handleConfirmSale,
}) {
  return (
    <div className="w-full md:w-96 bg-slate-50 dark:bg-slate-900/30 p-6 flex flex-col gap-6 overflow-y-auto border-l border-slate-200 dark:border-slate-800">
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border kairox-border">
        <div className="flex justify-between items-center text-xl font-bold pt-2 dark:text-white"><span>Total</span><span className="text-blue-600 dark:text-[#00D4FF]">{formatCurrency(totalEnMonedaSeleccionada(), moneda)}</span></div>
        {moneda !== 'ARS' && tipoCambioTasa > 0 && (
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-right">
            Equivale a {formatCurrency(calculateTotal(), 'ARS')} (TC ${Number(tipoCambioTasa).toLocaleString('es-AR')})
          </div>
        )}
        <div className="mt-3">
          <MonedaSelector
            moneda={moneda}
            tasa={tipoCambioTasa}
            onMonedaChange={v => { setMoneda(v); if (v === 'ARS') setTipoCambioTasa(1); }}
            onTasaChange={setTipoCambioTasa}
            onTCMissingChange={setTcMissing}
          />
        </div>
        {/* Banner de paridad: visible cuando la empresa usa moneda paralela y la operación es en ARS */}
        {tcParalelo.enabled && moneda === 'ARS' && !tcParalelo.loading && (
          <div className="mt-2">
            {tcParalelo.tcMissing ? (
              <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                <span>Sin TC de paridad {tcParalelo.monedaParalela} del día</span>
                <Button type="button" size="sm" variant="outline"
                  className="ml-auto h-6 text-xs px-2 border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                  onClick={() => setShowParaleloTCModal(true)}>
                  Cargar TC
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2 border border-emerald-200 dark:border-emerald-800">
                <Check className="h-3.5 w-3.5 flex-shrink-0" />
                Paridad {tcParalelo.monedaParalela}: 1 {tcParalelo.monedaParalela} = ${Number(tcParalelo.tcHoy || 0).toLocaleString('es-AR')} ARS
              </div>
            )}
          </div>
        )}
      </div>
      <div className="space-y-3 dark:text-white">
        <div className="flex items-center justify-between">
          <Label>Método de Pago</Label>
          {isMultiPago && (
            <span className="text-xs text-slate-400 dark:text-slate-500">Seleccioná varios métodos</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {['Efectivo', 'Transferencia', 'Tarjeta', 'Cuenta Corriente'].map(method => (
            <div key={method}
              className={`cursor-pointer border rounded-lg p-3 text-center text-sm transition-colors select-none ${
                selectedMethods.has(method)
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
                  : 'hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-300'
              }`}
              onClick={() => toggleMethod(method)}
            >
              <div className="flex items-center justify-center gap-1">
                {selectedMethods.has(method) && <Check className="h-3.5 w-3.5 shrink-0" />}
                <span>{method}</span>
              </div>
              {/* Amount input for multi-pago (not CC) */}
              {isMultiPago && selectedMethods.has(method) && method !== 'Cuenta Corriente' && (
                <div className="mt-2" onClick={e => e.stopPropagation()}>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="$0,00"
                    value={methodAmounts[method] || ''}
                    onChange={e => setMethodAmounts(prev => ({ ...prev, [method]: e.target.value }))}
                    className="w-full h-7 text-center text-xs rounded border border-blue-300 dark:border-blue-700 dark:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 px-1"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Restante indicator */}
        {isMultiPago && (
          <div className={`text-sm font-semibold text-center py-2 px-3 rounded-lg ${
            Math.abs(restante) < 0.01
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
              : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
          }`}>
            {Math.abs(restante) < 0.01
              ? '✓ Pago completo'
              : `Restante a asignar: $${restante.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
        )}
      </div>
      <div className="space-y-2 dark:text-white">
        <Label>Cliente</Label>
        {listaNombre && (
          <div className="text-xs text-violet-600 dark:text-violet-400 flex items-center gap-1 mb-1">
            <span className="inline-block w-2 h-2 rounded-full bg-violet-500"></span>
            Lista activa: <strong>{listaNombre}</strong>
          </div>
        )}
        <select
          className="w-full h-10 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-white px-3 text-sm focus:border-blue-500 dark:focus:border-[#00D4FF]"
          value={selectedClient?.id || ''}
          onChange={e => handleSelectClient(clients.find(c => c.id === e.target.value) || null)}
        >
          <option value="">Consumidor Final</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        {/* Condiciones de pago + límite CC */}
        {isCC && selectedClient && (selectedClient.condiciones_pago || selectedClient.limite_credito > 0) && (
          <div className="text-xs rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-2 space-y-0.5">
            {selectedClient.condiciones_pago && (
              <p className="text-blue-700 dark:text-blue-300">📋 {selectedClient.condiciones_pago}</p>
            )}
            {selectedClient.limite_credito > 0 && (
              <p className="text-blue-600 dark:text-blue-400">
                Límite: ${Number(selectedClient.limite_credito).toLocaleString('es-AR')}
                {' · '}Saldo: ${Number(selectedClient.saldo_actual || 0).toLocaleString('es-AR')}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="mt-auto">
        <Button
          className="w-full h-12 text-lg font-bold bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50"
          disabled={
            loading ||
            cart.length === 0 ||
            (moneda !== 'ARS' && tcMissing) ||
            (tcParalelo.enabled && moneda === 'ARS' && tcParalelo.tcMissing)
          }
          onClick={handleConfirmSale}
        >
          {loading ? <Loader2 className="animate-spin mr-2" /> : <Check className="mr-2" />}
          Confirmar Venta
        </Button>
        {(moneda !== 'ARS' && tcMissing) || (tcParalelo.enabled && moneda === 'ARS' && tcParalelo.tcMissing) ? (
          <p className="text-xs text-center text-amber-600 dark:text-amber-400 mt-1.5">
            ⚠ Cargá el TC del día para habilitar la venta
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default PanelPago;
