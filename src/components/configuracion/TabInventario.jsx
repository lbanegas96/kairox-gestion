import { Warehouse, Loader2, CheckCircle2, Save, Package2, BarChart3, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { MAGNITUDES, getMagnitudLabel } from '@/lib/unidadesMedida';

const fmtFactor = (n) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 6 });

/**
 * Tab "Inventario" de ConfiguracionSection — método de valoración de stock +
 * maestro de unidades de medida + stock mínimo global. Extraído de
 * ConfiguracionSection.jsx (Fase C auditoría de código). Componente presentacional:
 * estado y handlers vienen por props; el modal de alta/edición de UM vive en el padre.
 */
const TabInventario = ({
  valoracionStock, setValoracionStock, loadingValoracion, savingValoracion, onSaveValoracion,
  unidadesMedida, loadingUM, onNuevaUM, onEditarUM, onToggleUM,
  stockMinimoGlobal, setStockMinimoGlobal, savingStockMin, onSaveStockMin,
}) => (
  <div className="space-y-6 max-w-2xl">
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
          <Warehouse className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Método de Valoración de Stock</h3>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
            Define cómo se actualiza el costo de tus productos en cada compra. No cambia cómo se calculan tus ventas
            ni tus márgenes — eso siempre lee el costo ya actualizado, sin importar qué método lo generó.
          </p>
        </div>
      </div>

      {loadingValoracion ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
        </div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setValoracionStock('ultimo_costo')}
            className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
              valoracionStock === 'ultimo_costo'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-kx-border hover:bg-kx-surface-2'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-kx-text">Último Costo</span>
              {valoracionStock === 'ultimo_costo' && <CheckCircle2 className="w-4 h-4 text-kx-blue shrink-0" />}
            </div>
            <p className="text-xs text-kx-text-2 mt-1">
              El costo de tus productos se actualiza con cada compra al precio más reciente. Simple y rápido.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setValoracionStock('promedio_ponderado')}
            className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
              valoracionStock === 'promedio_ponderado'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-kx-border hover:bg-kx-surface-2'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-kx-text">Promedio Ponderado</span>
              {valoracionStock === 'promedio_ponderado' && <CheckCircle2 className="w-4 h-4 text-kx-blue shrink-0" />}
            </div>
            <p className="text-xs text-kx-text-2 mt-1">
              El costo se calcula como un promedio entre lo que tenías y lo que compraste. Más preciso si tus
              precios de compra varían seguido.
            </p>
          </button>

          <div className="w-full text-left p-4 rounded-lg border-2 border-kx-border opacity-50 cursor-not-allowed">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-kx-text flex items-center gap-2">
                FIFO
                <span className="text-2xs bg-kx-surface-2 text-kx-text-3 px-2 py-0.5 rounded-full border border-kx-border">
                  Próximamente
                </span>
              </span>
            </div>
            <p className="text-xs text-kx-text-2 mt-1">
              Próximamente — calcula el costo según el orden real de entrada de mercadería. Ideal para mayor
              precisión contable.
            </p>
          </div>

          <Button onClick={onSaveValoracion} disabled={savingValoracion} className="bg-blue-600 hover:bg-blue-700 text-white mt-2">
            {savingValoracion
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</>
              : <><Save className="mr-2 h-4 w-4" /> Guardar método de valoración</>}
          </Button>
        </div>
      )}
    </div>

    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Package2 className="w-5 h-5 text-kx-text-3" />
          <h3 className="font-semibold text-kx-text">Unidades de Medida</h3>
        </div>
        <Button size="sm" onClick={onNuevaUM}>+ Nueva</Button>
      </div>
      <p className="text-sm text-kx-text-2 mb-4">
        Unidades disponibles para productos, compras, OC y cotizaciones. Agrupá cada unidad por su
        <span className="font-medium"> magnitud</span> (masa, volumen, longitud, cantidad) y definí su
        factor para poder convertir entre unidades de la misma magnitud — ej: 1 TN = 1.000 KG.
      </p>

      {loadingUM ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      ) : unidadesMedida.length === 0 ? (
        <p className="text-sm text-kx-text-3 py-4 text-center">No hay unidades de medida cargadas.</p>
      ) : (
        <div className="border border-kx-border rounded-xl overflow-hidden">
          {unidadesMedida.map(u => {
            const baseCode = MAGNITUDES.find(m => m.value === u.magnitud)?.base;
            const esBase = u.magnitud && Number(u.factor_base) === 1;
            return (
              <div key={u.id} className="flex items-center justify-between px-4 py-2.5 border-b border-kx-border last:border-0">
                <div className={`min-w-0 ${!u.activo ? 'opacity-40' : ''}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono bg-kx-surface-2 px-2 py-0.5 rounded shrink-0">{u.codigo}</span>
                    <span className="text-sm text-kx-text truncate">{u.descripcion}</span>
                    {!u.activo && <Badge variant="outline" className="text-xs text-kx-text-2 shrink-0">Inactiva</Badge>}
                  </div>
                  <div className="flex items-center gap-2 mt-1 pl-0.5 text-2xs text-kx-text-3">
                    {u.magnitud ? (
                      <>
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                          {getMagnitudLabel(u.magnitud)}
                        </span>
                        <span>{esBase ? 'unidad base' : `1 ${u.codigo} = ${fmtFactor(u.factor_base)} ${baseCode}`}</span>
                      </>
                    ) : (
                      <span className="italic">Sin magnitud (empaque suelto)</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={u.activo}
                    onCheckedChange={(v) => onToggleUM(u.id, v)}
                  />
                  <Button size="sm" variant="ghost" onClick={() => onEditarUM(u)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>

    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-5 h-5 text-kx-text-3" />
        <h3 className="font-semibold text-kx-text">Stock Mínimo Global</h3>
      </div>
      <p className="text-sm text-kx-text-2 mb-4">Umbral de stock para alertas. Se aplica a productos sin mínimo individual — si el producto tiene su propio valor configurado, ese tiene prioridad.</p>
      <div className="flex items-center gap-3">
        <input
          type="number"
          min={0}
          max={9999}
          value={stockMinimoGlobal}
          onChange={e => setStockMinimoGlobal(Math.max(0, parseInt(e.target.value) || 0))}
          className="w-24 px-3 py-2 rounded-lg border border-kx-border bg-kx-surface text-kx-text text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        <span className="text-sm text-kx-text-2">unidades</span>
        <Button onClick={onSaveStockMin} disabled={savingStockMin} size="sm" className="ml-auto bg-blue-600 hover:bg-blue-700 text-white">
          {savingStockMin ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar'}
        </Button>
      </div>
    </div>
  </div>
);

export default TabInventario;
