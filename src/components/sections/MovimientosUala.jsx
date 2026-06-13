import React, { useEffect, useState, useMemo } from 'react';
import { RefreshCw, Wallet, AlertCircle, TrendingDown, Inbox } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/lib/customSupabaseClient';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatARS(amount) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

// BUG 3 FIX: timestamps stored as "Argentina-local-as-UTC" — always read UTC parts directly
// so the displayed time matches Argentina local time regardless of browser timezone.
function formatFecha(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// ── Componente principal ──────────────────────────────────────────────────────

function MovimientosUala() {
  const [movimientos, setMovimientos] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [lastUpdate, setLastUpdate]   = useState(null);

  const cargarMovimientos = async () => {
    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from('movimientos_uala')
      .select('id, fecha, monto, destinatario, created_at')
      .order('fecha', { ascending: false });

    if (err) {
      setError('No se pudieron cargar los movimientos: ' + err.message);
    } else {
      setMovimientos(data || []);
      setLastUpdate(new Date());
    }

    setLoading(false);
  };

  useEffect(() => {
    cargarMovimientos();
  }, []);

  const totalEgresado = useMemo(
    () => movimientos.reduce((sum, m) => sum + Number(m.monto), 0),
    [movimientos]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <Wallet className="h-6 w-6 text-violet-500" />
            Movimientos Ualá
          </h1>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-1">
            Transferencias sincronizadas automáticamente desde Gmail
            {lastUpdate && (
              <span className="ml-2 text-xs text-kx-text-3">
                · Act. {lastUpdate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={cargarMovimientos}
          disabled={loading}
          className="self-start sm:self-auto"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-l-4 border-l-violet-500 bg-violet-50/30 dark:bg-violet-900/10 dark:border-kx-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 dark:text-kx-text-2 uppercase font-semibold tracking-wider">
                  Total egresado
                </p>
                <p className="text-3xl font-bold text-violet-600 dark:text-violet-400 font-mono mt-1">
                  {formatARS(totalEgresado)}
                </p>
                <p className="text-xs text-kx-text-3 mt-1">
                  {movimientos.length} transferencia{movimientos.length !== 1 ? 's' : ''} registrada{movimientos.length !== 1 ? 's' : ''}
                </p>
              </div>
              <TrendingDown className="h-10 w-10 text-violet-200 dark:text-violet-900" />
            </div>
          </CardContent>
        </Card>

        <Card className="dark:border-kx-border bg-slate-50/50 dark:bg-slate-900/50">
          <CardContent className="p-5 flex flex-col justify-center h-full">
            <p className="text-xs text-slate-500 dark:text-kx-text-2 uppercase font-semibold tracking-wider">
              Última transferencia
            </p>
            {movimientos.length > 0 ? (
              <>
                <p className="text-lg font-bold text-kx-text dark:text-kx-text mt-1">
                  {formatARS(movimientos[0].monto)}
                </p>
                <p className="text-sm text-slate-500 dark:text-kx-text-2">
                  {movimientos[0].destinatario} · {formatFecha(movimientos[0].fecha)}
                </p>
              </>
            ) : (
              <p className="text-sm text-kx-text-3 mt-1">Sin datos</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="dark:border-kx-border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-kx-text dark:text-kx-text">
            Historial de transferencias
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <div className="flex items-start gap-3 m-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {loading && !error && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-kx-text-3">
              <RefreshCw className="h-8 w-8 animate-spin" />
              <p className="text-sm">Cargando movimientos...</p>
            </div>
          )}

          {!loading && !error && movimientos.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-kx-text-3">
              <Inbox className="h-10 w-10 opacity-40" />
              <p className="text-sm font-medium">Sin movimientos registrados</p>
              <p className="text-xs text-center max-w-xs">
                Los emails de Ualá se sincronizarán automáticamente cuando el Apps Script detecte nuevas transferencias.
              </p>
            </div>
          )}

          {!loading && !error && movimientos.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b dark:border-kx-border">
                    <TableHead className="text-xs uppercase text-slate-500 dark:text-kx-text-2 font-semibold w-44">Fecha</TableHead>
                    <TableHead className="text-xs uppercase text-slate-500 dark:text-kx-text-2 font-semibold">Destinatario</TableHead>
                    <TableHead className="text-xs uppercase text-slate-500 dark:text-kx-text-2 font-semibold text-right w-36">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movimientos.map((m) => (
                    <TableRow key={m.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/50 border-b dark:border-kx-border last:border-0">
                      <TableCell className="font-mono text-sm text-kx-text-2 dark:text-kx-text-2 whitespace-nowrap py-3">
                        {formatFecha(m.fecha)}
                      </TableCell>
                      <TableCell className="text-sm text-kx-text dark:text-kx-text py-3">
                        {m.destinatario || <span className="text-kx-text-3 italic">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold text-red-500 dark:text-red-400 py-3">
                        -{formatARS(m.monto)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex justify-end items-center gap-3 px-4 py-3 border-t dark:border-kx-border bg-slate-50/50 dark:bg-slate-900/50">
                <span className="text-sm text-slate-500 dark:text-kx-text-2 font-medium">Total egresado:</span>
                <span className="text-lg font-bold font-mono text-red-500 dark:text-red-400">
                  -{formatARS(totalEgresado)}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default MovimientosUala;
