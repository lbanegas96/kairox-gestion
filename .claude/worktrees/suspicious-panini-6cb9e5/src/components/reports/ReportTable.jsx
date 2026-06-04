import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, AlertCircle, FileX2 } from 'lucide-react';

const ReportTable = ({ columns, data, loading, totals }) => {
  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center h-64 border rounded-md bg-slate-50 dark:bg-slate-800/50 animate-pulse dark:border-slate-700">
        <Loader2 className="h-10 w-10 animate-spin text-blue-500 mb-3" />
        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Procesando datos del reporte...</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col justify-center items-center h-64 border rounded-md bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 dark:border-slate-700">
        <FileX2 className="h-10 w-10 mb-2 opacity-30" />
        <p className="font-medium">Sin datos para el período seleccionado</p>
        <p className="text-xs opacity-70">Intente ajustar los filtros de fecha</p>
      </div>
    );
  }

  return (
    <div className="border rounded-md overflow-hidden bg-white dark:bg-slate-950 shadow-sm dark:border-slate-800">
      <div className="overflow-x-auto max-h-[500px]">
        <Table>
          <TableHeader className="sticky top-0 bg-slate-100 dark:bg-slate-900 shadow-sm z-10">
            <TableRow className="dark:border-slate-800">
              {columns.map((col, idx) => (
                <TableHead 
                  key={idx} 
                  className={`font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap ${col.className || ''}`}
                  style={{ textAlign: col.align || 'left' }}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, rowIdx) => (
              <TableRow key={rowIdx} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors dark:border-slate-800">
                {columns.map((col, colIdx) => (
                  <TableCell 
                    key={colIdx} 
                    className={`whitespace-nowrap dark:text-slate-300 ${col.className || ''}`}
                    style={{ textAlign: col.align || 'left' }}
                  >
                    {col.render ? col.render(row) : row[col.key]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          {totals && (
            <tfoot className="bg-slate-100 dark:bg-slate-900 font-bold sticky bottom-0 z-10 border-t-2 border-slate-200 dark:border-slate-700">
               <TableRow className="dark:border-slate-800">
                 {totals.map((cell, idx) => (
                   <TableCell 
                      key={idx} 
                      className={`${cell.className || ''} dark:text-white`}
                      colSpan={cell.colSpan || 1}
                      style={{ textAlign: cell.align || 'left' }}
                   >
                     {cell.content}
                   </TableCell>
                 ))}
               </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
      <div className="bg-slate-50 dark:bg-slate-900 p-2 text-xs text-center text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800">
        Mostrando {data.length} registros
      </div>
    </div>
  );
};
export default ReportTable;