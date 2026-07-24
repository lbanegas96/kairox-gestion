import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Download, FileSpreadsheet, FilterX, RefreshCw } from 'lucide-react';

const ReportHeader = ({
  title,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  onGenerate,
  onClear,
  loading,
  hasData,
  onDownloadPDF,
  onDownloadExcel,
  showCentroCosto,
  centrosCosto,
  centroCostoId,
  setCentroCostoId,
}) => {
  return (
    <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          {title}
        </h3>
        <div className="flex items-center gap-2">
           {hasData && (
             <>
               <Button
                 onClick={onDownloadExcel}
                 disabled={loading}
                 className="bg-green-700 hover:bg-green-800 text-white shadow-sm"
               >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <FileSpreadsheet className="h-4 w-4 mr-2"/>}
                  Descargar Excel
               </Button>
               <Button
                 onClick={onDownloadPDF}
                 disabled={loading}
                 className="bg-red-600 hover:bg-red-700 text-white shadow-sm"
               >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Download className="h-4 w-4 mr-2"/>}
                  Descargar PDF
               </Button>
             </>
           )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end bg-slate-50 dark:bg-slate-950/50 p-3 rounded-md border border-slate-100 dark:border-slate-800">
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-kx-text-2 uppercase">Desde</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-white dark:bg-slate-900" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-kx-text-2 uppercase">Hasta</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-white dark:bg-slate-900" />
        </div>
        {showCentroCosto && centrosCosto?.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-kx-text-2 uppercase">Centro de costo</Label>
            <select
              value={centroCostoId}
              onChange={(e) => setCentroCostoId(e.target.value)}
              className="h-9 w-full rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-kx-text px-2"
            >
              <option value="">Todos</option>
              {centrosCosto.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2 md:col-span-2">
           <Button onClick={onGenerate} disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
             {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <RefreshCw className="h-4 w-4 mr-2"/>}
             Generar Reporte
           </Button>
           <Button onClick={onClear} variant="outline" title="Limpiar Filtros" className="px-3">
             <FilterX className="h-4 w-4 text-kx-text-2" />
           </Button>
        </div>
      </div>
    </div>
  );
};
export default ReportHeader;