import { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Loader2, FileX2, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 100;

const ReportTable = ({ columns, data, loading, totals }) => {
  const [page, setPage] = useState(1);

  // Reset page when data changes (new report generated)
  useEffect(() => { setPage(1); }, [data]);

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center h-64 border rounded-md bg-kx-surface-2 dark:bg-slate-800/50 animate-pulse dark:border-kx-border">
        <Loader2 className="h-10 w-10 animate-spin text-kx-blue mb-3" />
        <p className="text-slate-500 dark:text-kx-text-2 text-sm font-medium">Procesando datos del reporte...</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col justify-center items-center h-64 border rounded-md bg-kx-surface-2 dark:bg-slate-800/50 text-slate-500 dark:text-kx-text-2 dark:border-kx-border">
        <FileX2 className="h-10 w-10 mb-2 opacity-30" />
        <p className="font-medium">Sin datos para el período seleccionado</p>
        <p className="text-xs opacity-70">Intente ajustar los filtros de fecha</p>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const paginated = data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, data.length);
  // Filas sintéticas de agrupamiento no cuentan como "registros" reales.
  const recordCount = data.filter(d => !d.__rowType).length;

  return (
    <div className="border rounded-md overflow-hidden bg-kx-surface dark:bg-kx-bg shadow-sm dark:border-kx-border">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-slate-100 dark:bg-kx-surface shadow-sm">
            <TableRow className="dark:border-kx-border">
              {columns.map((col, idx) => (
                <TableHead
                  key={idx}
                  className={`font-bold text-slate-700 dark:text-kx-text whitespace-nowrap ${col.className || ''}`}
                  style={{ textAlign: col.align || 'left' }}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.map((row, rowIdx) => {
              // Filas sintéticas de agrupamiento (reportDefinitions.applyGrouping)
              // — no son un registro real, se pintan distinto y sin usar `columns`.
              if (row.__rowType === 'group') {
                return (
                  <TableRow key={rowIdx} className="bg-slate-200 dark:bg-slate-800 dark:border-kx-border">
                    <TableCell colSpan={columns.length} className="font-bold text-slate-700 dark:text-kx-text">
                      {row.label}
                    </TableCell>
                  </TableRow>
                );
              }
              if (row.__rowType === 'subtotal') {
                return (
                  <TableRow key={rowIdx} className="bg-slate-50 dark:bg-slate-900/50 dark:border-kx-border">
                    <TableCell colSpan={columns.length - 1} className="text-right font-semibold text-kx-text-2">
                      {row.label}
                    </TableCell>
                    <TableCell className="text-right font-semibold dark:text-kx-text">
                      {row.valueText}
                    </TableCell>
                  </TableRow>
                );
              }
              return (
                <TableRow key={rowIdx} className="hover:bg-kx-surface-2 dark:hover:bg-slate-900/50 transition-colors dark:border-kx-border">
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
              );
            })}
          </TableBody>
          {/* Totals always reflect ALL data, not just the current page */}
          {totals && (
            <tfoot className="bg-slate-100 dark:bg-kx-surface font-bold border-t-2 border-kx-border dark:border-kx-border">
              <TableRow className="dark:border-kx-border">
                {totals.map((cell, idx) => (
                  <TableCell
                    key={idx}
                    className={`${cell.className || ''} dark:text-kx-text`}
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

      {/* Footer: record count + pagination */}
      <div className="bg-kx-surface-2 dark:bg-kx-surface px-4 py-2 border-t border-slate-100 dark:border-kx-border flex items-center justify-between gap-4">
        <p className="text-xs text-kx-text-3 dark:text-kx-text-3">
          {totalPages > 1
            ? `Mostrando ${from}–${to} de ${data.length} filas (${recordCount} registros)`
            : `${recordCount} registros`}
        </p>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="h-7 w-7 p-0"
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce((acc, p, idx, arr) => {
                if (idx > 0 && arr[idx - 1] !== p - 1) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((item, idx) =>
                item === '...'
                  ? <span key={`e-${idx}`} className="px-1 text-xs text-kx-text-3">…</span>
                  : <Button
                      key={item}
                      variant={page === item ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setPage(item)}
                      className="h-7 w-7 p-0 text-xs"
                    >{item}</Button>
              )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="h-7 w-7 p-0"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportTable;
