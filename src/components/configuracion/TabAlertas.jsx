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
        <Bell className="w-5 h-5 text-kx-amber" />
        Configuración de Alertas
      </h3>

      {loadingAlertas ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      ) : (
        <div className="space-y-4">
          {/* Alerta stock bajo — el umbral NO se configura acá: vive en Configuración →
              Inventario (stock_minimo_global), o por producto en Productos (stock_minimo).
              El input de "Umbral" que estaba acá era un campo duplicado (alerta_stock_umbral)
              que nunca leyó nadie — se sacó el 29/09 para no tener dos lugares prometiendo
              controlar lo mismo y que solo uno funcione. */}
          <div className="flex items-start justify-between gap-4 p-4 bg-kx-surface-2 rounded-lg border border-kx-border">
            <div className="flex-1">
              <p className="font-medium text-kx-text text-sm">Alerta de stock bajo</p>
              <p className="text-xs text-kx-text-2 mt-0.5">
                Notificar cuando el stock de un producto baje del mínimo. El mínimo se define en
                <strong> Configuración → Inventario</strong> (general) o por producto en <strong>Productos</strong>.
              </p>
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

          {/* Caja sin cerrar — la clave se llama alerta_caja_apertura por historia, pero lo que
              avisa hoy (y lo único que useNotifications.js implementa) es que una sesión de caja
              lleva más de 24h abierta sin cerrarse. Copy corregido 29/09 para que diga lo que
              realmente hace — antes prometía "no abriste la caja hoy", algo que nunca se llegó
              a construir. */}
          <div className="flex items-center justify-between p-4 bg-kx-surface-2 rounded-lg border border-kx-border">
            <div>
              <p className="font-medium text-kx-text text-sm">Caja abierta hace más de 24 horas</p>
              <p className="text-xs text-kx-text-2 mt-0.5">Avisar si una sesión de caja quedó abierta más de un día sin cerrarse.</p>
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
