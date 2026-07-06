import React from 'react';
import { Search, Filter, Eye, Banknote, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

export function getStatusBadge(saldo) {
  const hasDebt = (saldo || 0) > 0;
  const isFavor = (saldo || 0) < 0;

  if (hasDebt) {
    return (
      <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-200 shadow-none font-medium">
        Con Deuda
      </Badge>
    );
  } else if (isFavor) {
    return (
      <Badge className="bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200 shadow-none font-medium">
        Saldo a Favor
      </Badge>
    );
  }
  return (
    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200 shadow-none font-medium">
      Al Día
    </Badge>
  );
}

function TablaClientes({
  searchTerm, setSearchTerm,
  statusFilter, setStatusFilter,
  loading, clients, filteredClients,
  tcParalelo,
  openDetailModal, openPaymentDialog,
}) {
  return (
    <>
      {/* Filter & Search Bar */}
      <Card className="bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
            <div className="relative w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3" />
              <Input
                placeholder="Buscar cliente por nombre..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 bg-kx-surface-2 dark:bg-slate-800/50 border-kx-border dark:border-kx-border"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-kx-text-3 hover:text-kx-text-2">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 bg-kx-surface-2 dark:bg-slate-800/50 p-1 rounded-lg border border-kx-border dark:border-kx-border w-full md:w-auto overflow-x-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStatusFilter('Todos')}
                className={`h-8 rounded-md px-3 text-xs font-medium ${statusFilter === 'Todos' ? 'bg-kx-surface dark:bg-slate-700 text-blue-600 shadow-sm border border-kx-border dark:border-slate-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Todos
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStatusFilter('Con Deuda')}
                className={`h-8 rounded-md px-3 text-xs font-medium ${statusFilter === 'Con Deuda' ? 'bg-red-50 dark:bg-red-900/20 text-red-600 shadow-sm border border-red-100 dark:border-red-900/30' : 'text-slate-500 hover:text-red-500'}`}
              >
                Con Deuda
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStatusFilter('Al Día')}
                className={`h-8 rounded-md px-3 text-xs font-medium ${statusFilter === 'Al Día' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 shadow-sm border border-emerald-100 dark:border-emerald-900/30' : 'text-slate-500 hover:text-emerald-500'}`}
              >
                Al Día
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Table */}
      <Card className="bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-kx-surface-2 dark:bg-slate-800/50 border-b border-kx-border dark:border-kx-border">
              <TableRow>
                <TableHead className="w-[300px] pl-6 font-semibold text-kx-text-2 dark:text-slate-300">Nombre Cliente</TableHead>
                <TableHead className="text-right font-semibold text-kx-text-2 dark:text-slate-300">Saldo Total</TableHead>
                <TableHead className="text-center font-semibold text-kx-text-2 dark:text-slate-300">Estado</TableHead>
                <TableHead className="text-center w-[150px] font-semibold text-kx-text-2 dark:text-slate-300">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6"><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-8 w-20 mx-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredClients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-40 text-center text-slate-500 bg-slate-50/30 dark:bg-slate-900/10">
                    <div className="flex flex-col items-center gap-2">
                      <Filter className="h-10 w-10 text-slate-300" />
                      <p className="font-medium">
                        {clients.length === 0 ? "Sin clientes registrados aún" : "No hay clientes que coincidan con los filtros"}
                      </p>
                      {(searchTerm || statusFilter !== 'Todos') && (
                        <Button variant="link" onClick={() => { setSearchTerm(''); setStatusFilter('Todos'); }} className="text-blue-500 h-auto p-0">
                          Limpiar filtros
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredClients.map((client) => {
                  const hasDebt = (client.saldo_actual || 0) > 0;
                  return (
                    <TableRow
                      key={client.id}
                      className={`
                        group cursor-pointer transition-colors
                        ${hasDebt ? 'bg-red-50/30 hover:bg-red-50/60 dark:bg-red-900/5 dark:hover:bg-red-900/10' : 'hover:bg-kx-surface-2 dark:hover:bg-slate-800/50'}
                      `}
                      onClick={() => openDetailModal(client)}
                    >
                      <TableCell className="pl-6 font-medium text-kx-text dark:text-kx-text">
                        {client.nombre}
                        {client.telefono && <div className="text-xs text-kx-text-3 font-normal mt-0.5 flex items-center gap-1"><span className="text-slate-300">|</span> {client.telefono}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className={`font-mono font-bold text-lg ${hasDebt ? 'text-red-600 dark:text-red-400' : (client.saldo_actual || 0) < 0 ? 'text-blue-600 dark:text-blue-400' : 'text-kx-text-2 dark:text-kx-text-2'}`}>
                          {(client.saldo_actual || 0) < 0 ? '-' : ''}${Math.abs(client.saldo_actual || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </div>
                        {tcParalelo.enabled && tcParalelo.tcHoy && hasDebt && (
                          <div className="text-xs text-kx-text-3 mt-0.5">
                            ≈ {(Number(client.saldo_actual) / tcParalelo.tcHoy).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {getStatusBadge(client.saldo_actual)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 rounded-full text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                            onClick={() => openDetailModal(client)}
                            title="Ver Detalle"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {hasDebt && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 rounded-full text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                              onClick={(e) => openPaymentDialog(client, e)}
                              title="Registrar Cobro"
                            >
                              <Banknote className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </>
  );
}

export default TablaClientes;
