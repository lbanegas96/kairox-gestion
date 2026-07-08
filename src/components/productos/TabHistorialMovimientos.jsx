import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDateTimeAR } from '@/lib/dateUtils';

function TabHistorialMovimientos({
  historyFilters, setHistoryFilters,
  products,
  movements,
}) {
  return (
    <div className="space-y-4">
      <div className="flex gap-4 mb-4">
        <Select
          value={historyFilters.productId}
          onValueChange={(val) => setHistoryFilters({...historyFilters, productId: val})}
        >
          <SelectTrigger className="w-[250px] bg-kx-surface dark:bg-kx-surface">
            <SelectValue placeholder="Filtrar por producto" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los productos</SelectItem>
            {products.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-kx-surface-2 dark:bg-slate-800/50 border-b border-kx-border dark:border-kx-border text-slate-500 dark:text-kx-text-2 font-medium">
            <tr>
              <th className="p-4 whitespace-nowrap">Fecha</th>
              <th className="p-4 whitespace-nowrap">Producto</th>
              <th className="p-4 whitespace-nowrap">Tipo</th>
              <th className="p-4 whitespace-nowrap">Motivo</th>
              <th className="p-4 text-right whitespace-nowrap">Cantidad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
             {movements.map(m => (
                <tr key={m.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/30">
                   <td className="p-4 text-slate-500">{formatDateTimeAR(m.fecha)}</td>
                   <td className="p-4 font-medium">{m.productos?.nombre}</td>
                   <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase
                        ${m.tipo === 'entrada' ? 'bg-emerald-100 text-emerald-700' :
                          m.tipo === 'salida' ? 'bg-red-100 text-red-700' :
                          'bg-blue-100 text-blue-700'}`
                      }>
                        {m.tipo}
                      </span>
                   </td>
                   <td className="p-4 text-slate-500 truncate max-w-[200px]">{m.motivo || '-'}</td>
                   <td className={`p-4 text-right font-mono font-bold ${m.tipo === 'salida' ? 'text-red-600' : 'text-emerald-600'}`}>
                      {m.tipo === 'salida' ? '-' : '+'}{m.cantidad}
                   </td>
                </tr>
             ))}
             {movements.length === 0 && (
               <tr><td colSpan="5" className="p-8 text-center text-slate-500">No hay movimientos registrados.</td></tr>
             )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

export default TabHistorialMovimientos;
