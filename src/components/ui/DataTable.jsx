import { useState, useMemo, useCallback } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, Search, Download, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { exportToExcel } from '@/lib/excelUtils';

/**
 * DataTable — Tabla universal reutilizable
 *
 * Props:
 *   columns: { key, label, sortable?, render?(row), className? }[]
 *   data: object[]
 *   loading?: boolean
 *   emptyMessage?: string
 *   // Paginación externa (server-side)
 *   page?: number
 *   totalPages?: number
 *   totalCount?: number
 *   onPageChange?: (page: number) => void
 *   pageSize?: number
 *   // Búsqueda interna (client-side sobre los datos recibidos)
 *   searchable?: boolean
 *   searchKeys?: string[]        // qué columnas buscar
 *   searchPlaceholder?: string
 *   // Exportar Excel
 *   exportable?: boolean
 *   exportFilename?: string
 *   // Acciones extra en el toolbar
 *   actions?: React.ReactNode
 *   // Row click
 *   onRowClick?: (row) => void
 */
export function DataTable({
  columns,
  data = [],
  loading = false,
  emptyMessage = 'No hay datos',
  // Paginación
  page,
  totalPages,
  totalCount,
  onPageChange,
  pageSize = 30,
  // Búsqueda
  searchable = true,
  searchKeys,
  searchPlaceholder = 'Buscar...',
  // Exportar
  exportable = true,
  exportFilename = 'datos',
  // Extra
  actions,
  onRowClick,
}) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [localPage, setLocalPage] = useState(1);

  // ── Búsqueda client-side ───────────────────────────────────────────────────
  const keys = searchKeys ?? columns.map(c => c.key);

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter(row =>
      keys.some(k => String(row[k] ?? '').toLowerCase().includes(q))
    );
  }, [data, search, keys]);

  // ── Sort client-side ───────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      let av = a[sortKey] ?? '';
      let bv = b[sortKey] ?? '';
      if (!isNaN(Number(av)) && !isNaN(Number(bv))) { av = Number(av); bv = Number(bv); }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const handleSort = useCallback((key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }, [sortKey]);

  // ── Exportar ───────────────────────────────────────────────────────────────
  const handleExport = () => {
    exportToExcel({
      rows: sorted,
      headers: columns.filter(c => !c.noExport).map(c => c.key),
      labels: columns.filter(c => !c.noExport).map(c => c.label),
      filename: exportFilename,
    });
  };

  // ── Paginación (cuando es server-side) ────────────────────────────────────
  const isServerPaged = typeof page === 'number' && typeof onPageChange === 'function';

  // ── Paginación client-side (cuando no viene page/onPageChange desde afuera) ─
  const localTotalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const localPageClamped = Math.min(localPage, localTotalPages);
  const paginated = isServerPaged
    ? sorted
    : sorted.slice((localPageClamped - 1) * pageSize, localPageClamped * pageSize);

  const SortIcon = ({ col }) => {
    if (!col.sortable) return null;
    if (sortKey !== col.key) return <ArrowUpDown className="w-3.5 h-3.5 ml-1 text-kx-text-2" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5 ml-1 text-blue-500" />
      : <ArrowDown className="w-3.5 h-3.5 ml-1 text-blue-500" />;
  };

  return (
    <div className="space-y-3">
      {/* ── Toolbar ── */}
      {(searchable || exportable || actions) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchable && (
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-kx-text-2" />
              <Input
                value={search}
                onChange={e => { setSearch(e.target.value); setLocalPage(1); }}
                placeholder={searchPlaceholder}
                className="pl-9 h-9 dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm"
              />
            </div>
          )}
          <div className="flex items-center gap-2 ml-auto">
            {actions}
            {exportable && (
              <Button variant="outline" size="sm" onClick={handleExport} className="h-9 gap-1.5 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                <Download className="w-3.5 h-3.5" /> Excel
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Tabla ── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-slate-400 tracking-wider border-b border-slate-200 dark:border-slate-800">
              <tr>
                {columns.map(col => (
                  <th
                    key={col.key}
                    className={`px-4 py-3 text-left font-semibold select-none ${col.sortable ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400' : ''} ${col.className ?? ''}`}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  >
                    <div className="flex items-center">
                      {col.label}
                      <SortIcon col={col} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3 text-kx-text-2">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span className="text-sm">Cargando...</span>
                    </div>
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-kx-text-2 text-sm">
                    {search ? `Sin resultados para "${search}"` : emptyMessage}
                  </td>
                </tr>
              ) : (
                paginated.map((row, idx) => (
                  <tr
                    key={row.id ?? idx}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 ${onRowClick ? 'cursor-pointer' : ''}`}
                  >
                    {columns.map(col => (
                      <td key={col.key} className={`px-4 py-3 ${col.className ?? ''}`}>
                        {col.render ? col.render(row) : (row[col.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Footer: paginación + contador ── */}
      {(isServerPaged && totalPages > 1) && (
        <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>
            {totalCount != null && `${totalCount.toLocaleString()} registros`}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8 dark:border-slate-700"
              disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
              return (
                <Button key={p} variant={p === page ? 'default' : 'outline'} size="icon"
                  className={`h-8 w-8 text-xs dark:border-slate-700 ${p === page ? 'bg-blue-600 text-white border-blue-600' : ''}`}
                  onClick={() => onPageChange(p)}>
                  {p}
                </Button>
              );
            })}
            <Button variant="outline" size="icon" className="h-8 w-8 dark:border-slate-700"
              disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Paginación client-side (cuando no viene page/onPageChange desde afuera) */}
      {!isServerPaged && localTotalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>
            {search && sorted.length !== data.length
              ? `${sorted.length} de ${data.length} registros`
              : `${sorted.length} registros`}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8 dark:border-slate-700"
              disabled={localPageClamped <= 1} onClick={() => setLocalPage(p => Math.max(1, p - 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {Array.from({ length: Math.min(localTotalPages, 5) }, (_, i) => {
              const p = Math.max(1, Math.min(localPageClamped - 2, localTotalPages - 4)) + i;
              return (
                <Button key={p} variant={p === localPageClamped ? 'default' : 'outline'} size="icon"
                  className={`h-8 w-8 text-xs dark:border-slate-700 ${p === localPageClamped ? 'bg-blue-600 text-white border-blue-600' : ''}`}
                  onClick={() => setLocalPage(p)}>
                  {p}
                </Button>
              );
            })}
            <Button variant="outline" size="icon" className="h-8 w-8 dark:border-slate-700"
              disabled={localPageClamped >= localTotalPages} onClick={() => setLocalPage(p => Math.min(localTotalPages, p + 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ) : (
        !isServerPaged && sorted.length > 0 && (
          <p className="text-xs text-kx-text-2 text-right">
            {search && sorted.length !== data.length
              ? `${sorted.length} de ${data.length} registros`
              : `${sorted.length} registros`}
          </p>
        )
      )}
    </div>
  );
}

export default DataTable;
