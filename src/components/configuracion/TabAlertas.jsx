import React from 'react';
import { Bell, Loader2, Save } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';

/**
 * Tab "Alertas" de ConfiguracionSection — toggles de notificaciones (stock bajo,
 * vencimiento CC, apertura de caja, cheques). Extraído de ConfiguracionSection.jsx
 * (Fase C auditoría de código). Componente presentacional: toda la lógica de fetch
 * y guardado vive en el padre, que pasa estado + handlers por props.
 */
const TabAlertas = ({ alertas, setAlertas, loadingAlertas, savingAlertas, onSave }) => (
  <div className="space-y-4 max-w-2xl">
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <h3 className="text-lg font-bold text-kx-text mb-5 flex items-center gap-2">
        <Bell className="w-5 h-5 text-amber-500" />
        Configuración de Alertas
      </h3>

      {loadingAlertas ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      ) : (
        <div className="space-y-4">
          {/* Alerta stock bajo */}
          <div className="flex items-start justify-between gap-4 p-4 bg-kx-surface-2 rounded-lg border border-kx-border">
            <div className="flex-1">
              <p className="font-medium text-kx-text text-sm">Alerta de stock bajo</p>
              <p className="text-xs text-kx-text-2 mt-0.5">Notificar cuando el stock de un producto baje del umbral definido.</p>
              {alertas.alerta_stock_bajo && (
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-xs text-kx-text-2">Umbral:</span>
                  <Input
                    type="number" min="0"
                    value={alertas.alerta_stock_umbral}
                    onChange={e => setAlertas(prev => ({ ...prev, alerta_stock_umbral: e.target.value }))}
                    className="h-7 w-20 text-xs kairox-input"
                  />
                  <span className="text-xs text-kx-text-3">unidades</span>
                </div>
              )}
            </div>
            <Switch checked={alertas.alerta_stock_bajo} onCheckedChange={v => setAlertas(prev => ({ ...prev, alerta_stock_bajo: v }))} />
          </div>

          {/* Vencimiento CC */}
          <div className="flex items-start justify-between gap-4 p-4 bg-kx-surface-2 rounded-lg border border-kx-border">
            <div className="flex-1">
              <p className="font-medium text-kx-text text-sm">Vencimiento de cuenta corriente</p>
              <p className="text-xs text-kx-text-2 mt-0.5">Alertar cuando un saldo de CC supere los días de plazo configurados.</p>
              {alertas.alerta_vencimiento_cc && (
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-xs text-kx-text-2">Días de plazo:</span>
                  <Input
                    type="number" min="1"
                    value={alertas.alerta_vencimiento_dias}
                    onChange={e => setAlertas(prev => ({ ...prev, alerta_vencimiento_dias: e.target.value }))}
                    className="h-7 w-20 text-xs kairox-input"
                  />
                  <span className="text-xs text-kx-text-3">días</span>
                </div>
              )}
            </div>
            <Switch checked={alertas.alerta_vencimiento_cc} onCheckedChange={v => setAlertas(prev => ({ ...prev, alerta_vencimiento_cc: v }))} />
          </div>

          {/* Apertura de caja */}
          <div className="flex items-center justify-between p-4 bg-kx-surface-2 rounded-lg border border-kx-border">
            <div>
              <p className="font-medium text-kx-text text-sm">Recordatorio apertura de caja</p>
              <p className="text-xs text-kx-text-2 mt-0.5">Mostrar aviso si la caja no fue abierta en el primer acceso del día.</p>
            </div>
            <Switch checked={alertas.alerta_caja_apertura} onCheckedChange={v => setAlertas(prev => ({ ...prev, alerta_caja_apertura: v }))} />
          </div>

          {/* Cheques */}
          <div className="flex items-start justify-between gap-4 p-4 bg-kx-surface-2 rounded-lg border border-kx-border">
            <div className="flex-1">
              <p className="font-medium text-kx-text text-sm">Cheques próximos a vencer</p>
              <p className="text-xs text-kx-text-2 mt-0.5">Alertar sobre cheques propios o de terceros que vencen pronto.</p>
              {alertas.alerta_cheque_vencimiento && (
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-xs text-kx-text-2">Avisar con:</span>
                  <Input
                    type="number" min="1"
                    value={alertas.alerta_cheque_dias}
                    onChange={e => setAlertas(prev => ({ ...prev, alerta_cheque_dias: e.target.value }))}
                    className="h-7 w-20 text-xs kairox-input"
                  />
                  <span className="text-xs text-kx-text-3">días de antelación</span>
                </div>
              )}
            </div>
            <Switch checked={alertas.alerta_cheque_vencimiento} onCheckedChange={v => setAlertas(prev => ({ ...prev, alerta_cheque_vencimiento: v }))} />
          </div>

          <Button onClick={onSave} disabled={savingAlertas} className="bg-blue-600 hover:bg-blue-700 text-white">
            {savingAlertas ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar Alertas</>}
          </Button>
        </div>
      )}
    </div>
  </div>
);

export default TabAlertas;
