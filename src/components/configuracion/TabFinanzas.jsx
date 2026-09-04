import { TrendingUp, Loader2, CheckCircle2, Save, CreditCard, Pencil, Building2, Receipt, Landmark, Gift } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AjusteInflacionToggleCard from './AjusteInflacionToggleCard';
import ListaPrecioBaseCard from './ListaPrecioBaseCard';

/**
 * Tab "Finanzas" de ConfiguracionSection — moneda paralela (tipo de cambio) +
 * maestro de condiciones de pago. Extraído de ConfiguracionSection.jsx (Fase C
 * auditoría de código). Componente presentacional: estado y handlers vienen por
 * props; el modal de alta/edición de condición vive en el padre.
 */
export const TIPO_INSTRUMENTO_LABEL = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta_debito: 'Tarjeta de Débito',
  tarjeta_credito: 'Tarjeta de Crédito',
  cheque: 'Cheque',
  billetera: 'Billetera virtual',
  otro: 'Otro',
};

const TabFinanzas = ({
  tcConfig, setTcConfig, loadingTC, savingTC, onSaveTC,
  condicionesPago, loadingCondiciones,
  onNuevaCondicion, onEditarCondicion, onToggleCondicion,
  formasPago, loadingFormasPago, cuentasBancariasLista,
  onNuevaFormaPago, onEditarFormaPago, onToggleFormaPago,
  cajas, loadingCajas, onNuevaCaja, onEditarCaja, onToggleCaja,
  centrosCosto, loadingCentrosCosto,
  onNuevoCentroCosto, onEditarCentroCosto, onToggleCentroCosto,
  impuestosAvanzados, loadingImpuestosAv, savingImpuestosAv, onToggleImpuestosAv,
  usaCentrosCosto, loadingUsaCentrosCosto, savingUsaCentrosCosto, onToggleUsaCentrosCosto,
  fidelizacionConfig, setFidelizacionConfig, loadingFidelizacion, savingFidelizacion, onSaveFidelizacion,
}) => (
  <div className="space-y-6 max-w-2xl">
    {/* Impuestos Avanzados (IIBB / Retenciones / Convenio) */}
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
          <Receipt className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Impuestos Avanzados</h3>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
            Activá esto solo si la empresa liquida <strong>IIBB (Ingresos Brutos)</strong>, aplica
            <strong> Retenciones/Percepciones</strong> o trabaja bajo <strong>Convenio Multilateral</strong>.
            El módulo de <strong>IVA</strong> está siempre disponible, no depende de este interruptor.
          </p>
        </div>
      </div>

      {loadingImpuestosAv ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
        </div>
      ) : (
        <div className="flex items-center justify-between p-4 bg-kx-surface-2 dark:bg-slate-900/50 rounded-lg border kairox-border">
          <div>
            <Label className="text-kx-text dark:text-kx-text font-medium">Activar impuestos avanzados</Label>
            <p className="text-xs text-slate-500 dark:text-kx-text-2 mt-0.5">
              {impuestosAvanzados
                ? 'Las solapas IIBB, Retenciones/Percepciones y Alícuotas están visibles en Impuestos.'
                : 'Ocultas. El módulo Impuestos solo muestra IVA.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {savingImpuestosAv && <Loader2 className="h-4 w-4 animate-spin text-kx-text-3" />}
            <Switch checked={impuestosAvanzados} disabled={savingImpuestosAv} onCheckedChange={onToggleImpuestosAv} />
          </div>
        </div>
      )}
    </div>

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

          {/* Carga automática del TC — solo USD: la Edge Function tc-diario-sync
              lee dolarapi.com, que no cubre EUR/BRL con la misma calidad. */}
          {tcConfig.usa_tc_paralelo && (
            <div className={`flex items-start justify-between gap-4 p-4 rounded-lg border ${
              tcConfig.moneda_paralela === 'USD'
                ? 'bg-kx-surface-2 dark:bg-slate-900/50 kairox-border'
                : 'bg-slate-50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-800 opacity-70'
            }`}>
              <div>
                <Label className="text-kx-text dark:text-kx-text font-medium">
                  Actualizar el TC automáticamente todos los días
                </Label>
                {tcConfig.moneda_paralela === 'USD' ? (
                  <p className="text-xs text-slate-500 dark:text-kx-text-2 mt-0.5">
                    {tcConfig.tc_automatico
                      ? 'Cada mañana a las 08:00 se carga solo el dólar oficial vendedor (fuente: dolarapi.com). Si un día lo cargás a mano, tu valor tiene prioridad y no se pisa.'
                      : 'Apagado: seguís cargando el TC vos, como hasta ahora.'}
                  </p>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                    Solo disponible con moneda paralela <strong>USD</strong>. Para {tcConfig.moneda_paralela} el
                    TC se sigue cargando a mano.
                  </p>
                )}
              </div>
              <Switch
                checked={tcConfig.moneda_paralela === 'USD' && tcConfig.tc_automatico}
                disabled={tcConfig.moneda_paralela !== 'USD'}
                onCheckedChange={v => setTcConfig(prev => ({ ...prev, tc_automatico: v }))}
              />
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

    {/* Ajuste por Inflación — interruptor premium (mig.383, Fase 5) + índices (Fase 1) */}
    <AjusteInflacionToggleCard />

    {/* Lista de Precios Base para Modo Caja (Fase B, mig.388) */}
    <ListaPrecioBaseCard />

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
                {!c.activo && <Badge variant="outline" className="text-xs text-kx-text-2">Inactiva</Badge>}
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

    {/* Formas de Pago */}
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-kx-text-3" />
          <h3 className="font-semibold text-kx-text">Formas de Pago</h3>
        </div>
        <Button size="sm" onClick={onNuevaFormaPago}>+ Nueva</Button>
      </div>
      <p className="text-sm text-kx-text-2 mb-4">
        Los medios que aparecen al cobrar o pagar (Caja, Ventas, Proveedores). Cada uno se puede
        vincular a una cuenta bancaria para que se acredite ahí automáticamente.
      </p>

      {loadingFormasPago ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      ) : formasPago.length === 0 ? (
        <p className="text-sm text-kx-text-3 py-4 text-center">No hay formas de pago cargadas.</p>
      ) : (
        <div className="border border-kx-border rounded-xl overflow-hidden">
          {formasPago.map(f => {
            const cuenta = cuentasBancariasLista.find(cb => cb.id === f.cuenta_bancaria_id);
            return (
              <div key={f.id} className="flex items-center justify-between px-4 py-2.5 border-b border-kx-border last:border-0">
                <div className={`flex items-center gap-2 flex-wrap ${!f.activo ? 'opacity-40' : ''}`}>
                  <span className="text-sm font-medium text-kx-text">{f.nombre}</span>
                  <span className="text-xs text-kx-text-2">{TIPO_INSTRUMENTO_LABEL[f.tipo_instrumento] ?? f.tipo_instrumento}</span>
                  {cuenta && (
                    <span className="text-xs text-kx-text-3">→ {cuenta.nombre}</span>
                  )}
                  {f.comision_porcentaje > 0 && (
                    <span className="text-xs text-kx-text-3">{f.comision_porcentaje}% com.</span>
                  )}
                  {f.dias_acreditacion > 0 && (
                    <span className="text-xs text-kx-text-3">{f.dias_acreditacion}d acred.</span>
                  )}
                  {!f.activo && <Badge variant="outline" className="text-xs text-kx-text-2">Inactiva</Badge>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={f.activo} onCheckedChange={(v) => onToggleFormaPago(f.id, v)} />
                  <Button size="sm" variant="ghost" onClick={() => onEditarFormaPago(f)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>

    {/* Cajas (puntos de cobro físicos) */}
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Landmark className="w-5 h-5 text-kx-text-3" />
          <h3 className="font-semibold text-kx-text">Cajas</h3>
        </div>
        <Button size="sm" onClick={onNuevaCaja}>+ Nueva</Button>
      </div>
      <p className="text-sm text-kx-text-2 mb-4">
        Puntos de cobro físicos del local (mostrador 1, mostrador 2, etc.). Cada cajero elige con
        cuál trabaja al entrar al Modo Caja — pueden estar todas abiertas al mismo tiempo.
      </p>

      {loadingCajas ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      ) : cajas.length === 0 ? (
        <p className="text-sm text-kx-text-3 py-4 text-center">No hay cajas cargadas.</p>
      ) : (
        <div className="border border-kx-border rounded-xl overflow-hidden">
          {cajas.map(c => (
            <div key={c.id} className="flex items-center justify-between px-4 py-2.5 border-b border-kx-border last:border-0">
              <div className={`flex items-center gap-2 ${!c.activo ? 'opacity-40' : ''}`}>
                <span className="text-sm font-medium text-kx-text">{c.nombre}</span>
                {!c.activo && <Badge variant="outline" className="text-xs text-kx-text-2">Inactiva</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={c.activo} onCheckedChange={(v) => onToggleCaja(c.id, v)} />
                <Button size="sm" variant="ghost" onClick={() => onEditarCaja(c)}>
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
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
          <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Centros de Costo</h3>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
            Activá esto solo si la empresa necesita reportar por sucursal o línea de negocio.
            El sistema sigue funcionando exactamente igual sin esto activado.
          </p>
        </div>
      </div>

      {loadingUsaCentrosCosto ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
        </div>
      ) : (
        <div className="flex items-center justify-between p-4 bg-kx-surface-2 dark:bg-slate-900/50 rounded-lg border kairox-border">
          <div>
            <Label className="text-kx-text dark:text-kx-text font-medium">Activar centros de costo</Label>
            <p className="text-xs text-slate-500 dark:text-kx-text-2 mt-0.5">
              {usaCentrosCosto
                ? 'Los selectores de centro de costo están visibles en Ventas, Compras y Estado de Resultados.'
                : 'Ocultos. Ningún formulario ni reporte muestra el selector de centro de costo.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {savingUsaCentrosCosto && <Loader2 className="h-4 w-4 animate-spin text-kx-text-3" />}
            <Switch checked={usaCentrosCosto} disabled={savingUsaCentrosCosto} onCheckedChange={onToggleUsaCentrosCosto} />
          </div>
        </div>
      )}

      {usaCentrosCosto && (
        <div className="mt-5">
          <div className="flex items-center justify-end mb-3">
            <Button size="sm" onClick={onNuevoCentroCosto}>+ Nuevo</Button>
          </div>
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
                    {!c.activo && <Badge variant="outline" className="text-xs text-kx-text-2">Inactivo</Badge>}
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
      )}
    </div>

    {/* Fidelización por Puntos (mig.312) */}
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
          <Gift className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Fidelización por Puntos</h3>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
            Cada venta con cliente asociado suma puntos solos; el cajero puede canjearlos como
            descuento directo en pesos al cobrar. Gratis, sin vencimiento.
          </p>
        </div>
      </div>

      {loadingFidelizacion ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between p-4 bg-kx-surface-2 dark:bg-slate-900/50 rounded-lg border kairox-border">
            <div>
              <Label className="text-kx-text dark:text-kx-text font-medium">Activar fidelización por puntos</Label>
              <p className="text-xs text-slate-500 dark:text-kx-text-2 mt-0.5">
                {fidelizacionConfig.usa_fidelizacion
                  ? 'Los clientes acumulan puntos en cada venta y se pueden canjear como descuento al cobrar.'
                  : 'Ninguna venta suma puntos ni pide canje.'}
              </p>
            </div>
            <Switch
              checked={fidelizacionConfig.usa_fidelizacion}
              onCheckedChange={v => setFidelizacionConfig(prev => ({ ...prev, usa_fidelizacion: v }))}
            />
          </div>

          {fidelizacionConfig.usa_fidelizacion && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
              <div className="space-y-2">
                <Label className="text-slate-700 dark:text-slate-300">Pesos gastados por cada punto ganado</Label>
                <Input
                  type="number" min="0.01" step="0.01" placeholder="Ej.: 100"
                  value={fidelizacionConfig.puntos_pesos_por_punto}
                  onChange={e => setFidelizacionConfig(prev => ({ ...prev, puntos_pesos_por_punto: e.target.value }))}
                  className="h-9 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                />
                <p className="text-xs text-kx-text-3">Ej.: 100 → cada $100 de venta suma 1 punto.</p>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700 dark:text-slate-300">Valor en pesos de cada punto al canjear</Label>
                <Input
                  type="number" min="0.01" step="0.01" placeholder="Ej.: 1"
                  value={fidelizacionConfig.puntos_valor_pesos}
                  onChange={e => setFidelizacionConfig(prev => ({ ...prev, puntos_valor_pesos: e.target.value }))}
                  className="h-9 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                />
                <p className="text-xs text-kx-text-3">Ej.: 1 → cada punto canjeado descuenta $1 del total.</p>
              </div>
            </div>
          )}

          {fidelizacionConfig.usa_fidelizacion && Number(fidelizacionConfig.puntos_pesos_por_punto) > 0 && Number(fidelizacionConfig.puntos_valor_pesos) > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              {[
                `$${fidelizacionConfig.puntos_pesos_por_punto} gastados = 1 punto`,
                `1 punto = $${fidelizacionConfig.puntos_valor_pesos} de descuento`,
                `≈${((Number(fidelizacionConfig.puntos_valor_pesos) / Number(fidelizacionConfig.puntos_pesos_por_punto)) * 100).toFixed(2)}% de devolución efectiva`,
              ].map((text, i) => (
                <div key={i} className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2 border border-emerald-200 dark:border-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {text}
                </div>
              ))}
            </div>
          )}

          <Button onClick={onSaveFidelizacion} disabled={savingFidelizacion} className="bg-blue-600 hover:bg-blue-700 text-white">
            {savingFidelizacion ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar configuración de fidelización</>}
          </Button>
        </div>
      )}
    </div>
  </div>
);

export default TabFinanzas;
