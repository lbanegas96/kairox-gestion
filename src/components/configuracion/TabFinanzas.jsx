import { TrendingUp, Loader2, CheckCircle2, Save, CreditCard, Pencil, Building2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * Tab "Finanzas" de ConfiguracionSection — moneda paralela (tipo de cambio) +
 * maestro de condiciones de pago. Extraído de ConfiguracionSection.jsx (Fase C
 * auditoría de código). Componente presentacional: estado y handlers vienen por
 * props; el modal de alta/edición de condición vive en el padre.
 */
const TabFinanzas = ({
  tcConfig, setTcConfig, loadingTC, savingTC, onSaveTC,
  condicionesPago, loadingCondiciones,
  onNuevaCondicion, onEditarCondicion, onToggleCondicion,
  centrosCosto, loadingCentrosCosto,
  onNuevoCentroCosto, onEditarCentroCosto, onToggleCentroCosto,
}) => (
  <div className="space-y-6 max-w-2xl">
    {/* Moneda Paralela */}
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
          <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Moneda Paralela (Tipo de Cambio)</h3>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
            Cuando está activo, el sistema exige el TC del día antes de cualquier movimiento contable y
            habilita el <strong>Reporte de Paridad ARS / {tcConfig.moneda_paralela}</strong>.
          </p>
        </div>
      </div>

      {loadingTC ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between p-4 bg-kx-surface-2 dark:bg-slate-900/50 rounded-lg border kairox-border">
            <div>
              <Label className="text-kx-text dark:text-kx-text font-medium">Activar moneda paralela</Label>
              <p className="text-xs text-slate-500 dark:text-kx-text-2 mt-0.5">
                {tcConfig.usa_tc_paralelo
                  ? 'El TC del día es obligatorio antes de vender, cotizar o registrar pagos.'
                  : 'El TC del día es opcional (solo para operaciones en moneda extranjera).'}
              </p>
            </div>
            <Switch checked={tcConfig.usa_tc_paralelo} onCheckedChange={v => setTcConfig(prev => ({ ...prev, usa_tc_paralelo: v }))} />
          </div>

          {tcConfig.usa_tc_paralelo && (
            <div className="space-y-2 max-w-xs">
              <Label className="text-slate-700 dark:text-slate-300">Moneda paralela</Label>
              <Select value={tcConfig.moneda_paralela} onValueChange={v => setTcConfig(prev => ({ ...prev, moneda_paralela: v }))}>
                <SelectTrigger className="h-9 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD — Dólar estadounidense</SelectItem>
                  <SelectItem value="EUR">EUR — Euro</SelectItem>
                  <SelectItem value="BRL">BRL — Real brasileño</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-kx-text-3">
                Todos los comprobantes y movimientos se guardarán también en {tcConfig.moneda_paralela} usando el TC del día.
              </p>
            </div>
          )}

          {tcConfig.usa_tc_paralelo && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              {[
                'TC obligatorio antes de operar',
                `Comprobantes con equiv. ${tcConfig.moneda_paralela}`,
                'Reporte de Paridad habilitado',
              ].map((text, i) => (
                <div key={i} className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2 border border-emerald-200 dark:border-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {text}
                </div>
              ))}
            </div>
          )}

          <Button onClick={onSaveTC} disabled={savingTC} className="bg-blue-600 hover:bg-blue-700 text-white">
            {savingTC ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar configuración de moneda</>}
          </Button>
        </div>
      )}
    </div>

    {/* Condiciones de pago */}
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-kx-text-3" />
          <h3 className="font-semibold text-kx-text">Condiciones de Pago</h3>
        </div>
        <Button size="sm" onClick={onNuevaCondicion}>+ Nueva</Button>
      </div>
      <p className="text-sm text-kx-text-2 mb-4">Plazos disponibles para clientes y proveedores. Se usan al asignar la condición de pago de un cliente.</p>

      {loadingCondiciones ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      ) : condicionesPago.length === 0 ? (
        <p className="text-sm text-kx-text-3 py-4 text-center">No hay condiciones de pago cargadas.</p>
      ) : (
        <div className="border border-kx-border rounded-xl overflow-hidden">
          {condicionesPago.map(c => (
            <div key={c.id} className="flex items-center justify-between px-4 py-2.5 border-b border-kx-border last:border-0">
              <div className={`flex items-center gap-2 ${!c.activo ? 'opacity-40' : ''}`}>
                <span className="text-sm font-medium text-kx-text">{c.nombre}</span>
                <span className="text-xs text-kx-text-2">
                  {c.dias_credito} días{c.descuento_pct > 0 ? ` · ${c.descuento_pct}% desc.` : ''}
                </span>
                {!c.activo && <Badge variant="outline" className="text-xs text-slate-400">Inactiva</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={c.activo} onCheckedChange={(v) => onToggleCondicion(c.id, v)} />
                <Button size="sm" variant="ghost" onClick={() => onEditarCondicion(c)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Centros de Costo */}
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-kx-text-3" />
          <h3 className="font-semibold text-kx-text">Centros de Costo</h3>
        </div>
        <Button size="sm" onClick={onNuevoCentroCosto}>+ Nuevo</Button>
      </div>
      <p className="text-sm text-kx-text-2 mb-4">
        Dimensión opcional para reportar por sucursal o línea de negocio. Si no se asigna ninguno,
        el sistema sigue funcionando exactamente igual que hoy.
      </p>

      {loadingCentrosCosto ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      ) : centrosCosto.length === 0 ? (
        <p className="text-sm text-kx-text-3 py-4 text-center">No hay centros de costo cargados.</p>
      ) : (
        <div className="border border-kx-border rounded-xl overflow-hidden">
          {centrosCosto.map(c => (
            <div key={c.id} className="flex items-center justify-between px-4 py-2.5 border-b border-kx-border last:border-0">
              <div className={`flex items-center gap-2 ${!c.activo ? 'opacity-40' : ''}`}>
                <span className="text-sm font-medium text-kx-text">{c.nombre}</span>
                {!c.activo && <Badge variant="outline" className="text-xs text-slate-400">Inactivo</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={c.activo} onCheckedChange={(v) => onToggleCentroCosto(c.id, v)} />
                <Button size="sm" variant="ghost" onClick={() => onEditarCentroCosto(c)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);

export default TabFinanzas;
