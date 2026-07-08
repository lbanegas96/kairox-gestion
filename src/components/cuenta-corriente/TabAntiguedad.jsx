import { Eye, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateAR } from '@/lib/dateUtils';

const COLOR_MAP = {
  green:  'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/10 dark:border-emerald-800/30 text-emerald-700 dark:text-emerald-400',
  yellow: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/10 dark:border-yellow-800/30 text-yellow-700 dark:text-yellow-400',
  orange: 'bg-orange-50 border-orange-200 dark:bg-orange-900/10 dark:border-orange-800/30 text-orange-700 dark:text-orange-400',
  red:    'bg-red-50 border-red-200 dark:bg-red-900/10 dark:border-red-800/30 text-red-700 dark:text-red-400',
};

const BANDA_COLORS = {
  green:  { badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', row: '' },
  yellow: { badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', row: 'bg-yellow-50/30 dark:bg-yellow-900/5' },
  orange: { badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', row: 'bg-orange-50/40 dark:bg-orange-900/5' },
  red:    { badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', row: 'bg-red-50/40 dark:bg-red-900/5' },
};

function TabAntiguedad({
  agingBandas, agingLoading, agingData,
  tcParalelo,
  setSelectedClient, setDetailModalOpen, setActiveTab,
}) {
  return (
    <div className="space-y-5">
      {/* Resumen por bandas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(agingBandas).map(([banda, info]) => (
          <Card key={banda} className={`border ${COLOR_MAP[info.color]}`}>
            <CardContent className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wider mb-2">{banda}</div>
              <div className="text-xl font-bold font-mono">${info.monto.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</div>
              {tcParalelo.enabled && tcParalelo.tcHoy && info.monto > 0 && (
                <div className="text-xs mt-0.5 opacity-70">
                  ≈ {(info.monto / tcParalelo.tcHoy).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}
                </div>
              )}
              <div className="text-xs mt-1">{info.count} comprobante{info.count !== 1 ? 's' : ''}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabla detallada */}
      <Card className="bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-kx-surface-2 dark:bg-slate-800/50 border-b border-kx-border dark:border-kx-border">
              <tr>
                <th className="text-left p-4 font-semibold text-kx-text-2 dark:text-slate-300">Comprobante</th>
                <th className="text-left p-4 font-semibold text-kx-text-2 dark:text-slate-300">Cliente</th>
                <th className="text-right p-4 font-semibold text-kx-text-2 dark:text-slate-300">Monto</th>
                <th className="text-center p-4 font-semibold text-kx-text-2 dark:text-slate-300">Fecha</th>
                <th className="text-center p-4 font-semibold text-kx-text-2 dark:text-slate-300">Antigüedad</th>
                <th className="text-center p-4 font-semibold text-kx-text-2 dark:text-slate-300">Banda</th>
                <th className="text-center p-4 font-semibold text-kx-text-2 dark:text-slate-300">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {agingLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-24" /></td>
                    <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-36" /></td>
                    <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-20 ml-auto" /></td>
                    <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-20 mx-auto" /></td>
                    <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-16 mx-auto" /></td>
                    <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-20 mx-auto" /></td>
                    <td className="p-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-8 mx-auto" /></td>
                  </tr>
                ))
              ) : agingData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-kx-text-3 dark:text-kx-text-3">
                    <TrendingDown className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p>No hay comprobantes pendientes ✓</p>
                  </td>
                </tr>
              ) : (
                agingData.map(comp => {
                  const bColors = BANDA_COLORS[comp.color] || BANDA_COLORS.green;
                  return (
                    <tr key={comp.comprobante_id} className={`hover:bg-kx-surface-2 dark:hover:bg-slate-800/50 transition-colors ${bColors.row}`}>
                      <td className="p-4 font-mono text-sm font-bold text-slate-700 dark:text-slate-300">
                        #{comp.numero_venta}
                      </td>
                      <td className="p-4 font-medium text-kx-text dark:text-kx-text">
                        {comp.cliente_nombre}
                      </td>
                      <td className="p-4 text-right font-mono font-bold text-red-600 dark:text-red-400">
                        ${comp.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-4 text-center text-slate-500 dark:text-kx-text-2 text-sm">
                        {formatDateAR(comp.fecha)}
                      </td>
                      <td className="p-4 text-center font-mono text-kx-text-2 dark:text-kx-text-2">
                        {comp.dias} días
                      </td>
                      <td className="p-4 text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${bColors.badge}`}>
                          {comp.banda}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 rounded-full text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          onClick={() => {
                            setSelectedClient({ id: comp.cliente_id, nombre: comp.cliente_nombre });
                            setDetailModalOpen(true);
                            setActiveTab('clientes');
                          }}
                          title="Ver detalle del cliente"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default TabAntiguedad;
