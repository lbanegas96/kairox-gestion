import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Eye, Search, Filter, RefreshCw, AlertCircle, X, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import SaleDetailModal from './SaleDetailModal';
import EstadoBadge from '@/components/ui/EstadoBadge';

const HistorialVentas = () => {
  const { user } = useAuth();
  
  // Data State
  const [comprobantes, setComprobantes] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Filter State
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedPayment, setSelectedPayment] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');

  // UI State
  const [selectedSaleId, setSelectedSaleId] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch Comprobantes
      const { data: salesData, error: salesError } = await supabase
        .from('comprobantes')
        .select('*')
        .order('fecha', { ascending: false });

      if (salesError) throw salesError;

      // Ensure estado_pago exists
      const processedSales = (salesData || []).map(s => ({
         ...s,
         estado_pago: s.estado_pago || (s.forma_pago === 'Cuenta Corriente' ? 'pendiente' : 'pagada')
      }));

      setComprobantes(processedSales);

      // Fetch Clients for Dropdown
      const { data: clientsData } = await supabase
        .from('clientes')
        .select('id, nombre')
        .order('nombre');
      
      setClients(clientsData || []);

    } catch (error) {
      console.error("Error fetching history:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaleUpdate = () => {
    // Refresh list when a sale is updated in modal
    fetchData();
  };

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setSelectedClient('');
    setSelectedPayment('');
    setSelectedStatus('');
  };

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [dateFrom, dateTo, selectedClient, selectedPayment, selectedStatus]);

  // Memoized Filter Logic
  const filteredSales = useMemo(() => {
    return comprobantes.filter(sale => {
      // Date Range
      if (dateFrom && new Date(sale.fecha) < new Date(dateFrom)) return false;
      // Add one day to 'to' date to include the whole day
      if (dateTo) {
         const toDate = new Date(dateTo);
         toDate.setHours(23, 59, 59, 999);
         if (new Date(sale.fecha) > toDate) return false;
      }
      
      // Client
      if (selectedClient && sale.cliente_id !== selectedClient) return false;
      
      // Payment Method
      if (selectedPayment && sale.forma_pago !== selectedPayment) return false;

      // Status
      if (selectedStatus && (sale.estado_pago || 'pagada') !== selectedStatus) return false;

      return true;
    });
  }, [comprobantes, dateFrom, dateTo, selectedClient, selectedPayment, selectedStatus]);

  // Calculate Total
  const totalPeriodo = useMemo(() => {
    return filteredSales.reduce((acc, curr) => acc + (Number(curr.total) || 0), 0);
  }, [filteredSales]);

  const activeFiltersCount = [dateFrom, dateTo, selectedClient, selectedPayment, selectedStatus].filter(Boolean).length;

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / PAGE_SIZE));
  const paginatedSales = filteredSales.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      
      {/* ADVANCED FILTERS SECTION */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border kairox-border shadow-sm space-y-4">
        <div className="flex justify-between items-center mb-2">
           <h3 className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
             <Filter className="h-4 w-4" /> Filtros Avanzados
             {activeFiltersCount > 0 && <Badge variant="secondary" className="ml-1 px-1.5 h-5 min-w-[20px] dark:bg-slate-800 dark:text-slate-300">{activeFiltersCount}</Badge>}
           </h3>
           {activeFiltersCount > 0 && (
             <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400">
               <X className="h-3 w-3 mr-1" /> Limpiar filtros
             </Button>
           )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-slate-400">Desde</Label>
             <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 kairox-input text-sm" />
          </div>
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-slate-400">Hasta</Label>
             <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 kairox-input text-sm" />
          </div>
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-slate-400">Cliente</Label>
             <select 
               className="w-full h-9 rounded-md border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm dark:bg-slate-900 dark:text-slate-200"
               value={selectedClient}
               onChange={e => setSelectedClient(e.target.value)}
             >
               <option value="">Todos</option>
               {clients.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
             </select>
          </div>
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-slate-400">Medio de Pago</Label>
             <select 
               className="w-full h-9 rounded-md border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm dark:bg-slate-900 dark:text-slate-200"
               value={selectedPayment}
               onChange={e => setSelectedPayment(e.target.value)}
             >
               <option value="">Todos</option>
               <option value="Efectivo">Efectivo</option>
               <option value="Transferencia">Transferencia</option>
               <option value="Tarjeta">Tarjeta</option>
               <option value="Cuenta Corriente">Cuenta Corriente</option>
             </select>
          </div>
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-slate-400">Estado</Label>
             <select 
               className="w-full h-9 rounded-md border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm dark:bg-slate-900 dark:text-slate-200"
               value={selectedStatus}
               onChange={e => setSelectedStatus(e.target.value)}
             >
               <option value="">Todos</option>
               <option value="pagada">Pagada</option>
               <option value="pendiente">Pendiente</option>
               <option value="parcial">Parcial</option>
               <option value="cancelada">Cancelada</option>
             </select>
          </div>
        </div>
      </div>

      {/* SUMMARY CARD */}
      <Card className="p-4 bg-gradient-to-r from-blue-50 to-white dark:from-blue-900/10 dark:to-slate-900 border-blue-100 dark:border-blue-900/20">
         <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-full text-blue-600 dark:text-blue-400">
                <Check className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Ventas Filtradas</p>
                <p className="text-2xl font-bold text-slate-800 dark:text-white">{filteredSales.length}</p>
              </div>
            </div>
            <div className="text-center sm:text-right border-t sm:border-t-0 sm:border-l border-blue-200 dark:border-slate-700 pt-4 sm:pt-0 sm:pl-8 w-full sm:w-auto">
               <p className="text-sm text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider mb-1">Total Vendido</p>
               <p className="text-3xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
                 ${totalPeriodo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
               </p>
            </div>
         </div>
      </Card>

      {/* TABLE */}
      <div className="kairox-bg-card border kairox-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 dark:bg-slate-900/50 border-b kairox-border text-xs uppercase font-semibold text-slate-500">
              <tr>
                <th className="p-4 w-32">Nro Venta</th>
                <th className="p-4 w-40">Fecha</th>
                <th className="p-4">Cliente</th>
                <th className="p-4 w-32">Medio Pago</th>
                <th className="p-4 w-28 text-center">Estado</th>
                <th className="p-4 w-32 text-right">Total</th>
                <th className="p-4 w-16 text-center">Ver</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="p-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="p-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="p-4"><Skeleton className="h-4 w-32" /></td>
                    <td className="p-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="p-4 text-center"><Skeleton className="h-6 w-16 mx-auto rounded-full" /></td>
                    <td className="p-4 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="p-4 text-center"><Skeleton className="h-8 w-8 mx-auto rounded-md" /></td>
                  </tr>
                ))
              ) : filteredSales.length === 0 ? (
                <tr>
                  <td colSpan="7" className="p-12 text-center text-slate-500 bg-slate-50/50 dark:bg-slate-900/20">
                    <div className="flex flex-col items-center gap-2">
                       <AlertCircle className="h-10 w-10 text-slate-300" />
                       <p className="font-medium">
                         {comprobantes.length === 0 ? "Sin ventas registradas aún" : "No hay ventas que coincidan con los filtros"}
                       </p>
                       {activeFiltersCount > 0 && (
                         <Button variant="link" onClick={clearFilters} className="text-blue-500 h-auto p-0">Limpiar todos los filtros</Button>
                       )}
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedSales.map(sale => (
                  <tr 
                    key={sale.id} 
                    className="group hover:bg-blue-50/50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                    onClick={() => { setSelectedSaleId(sale.id); setShowDetailModal(true); }}
                  >
                    <td className="p-4 font-mono font-medium text-slate-700 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {sale.numero_venta}
                    </td>
                    <td className="p-4 text-slate-500 text-xs dark:text-slate-400">
                      {new Date(sale.fecha).toLocaleDateString()} <span className="text-slate-400 ml-1">{new Date(sale.fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </td>
                    <td className="p-4 font-medium text-slate-800 dark:text-slate-200">
                      {sale.cliente_nombre || <span className="text-slate-400 italic">Consumidor Final</span>}
                    </td>
                    <td className="p-4 text-slate-600 dark:text-slate-400 text-xs font-medium uppercase tracking-wide">
                      {sale.forma_pago}
                    </td>
                    <td className="p-4 text-center">
                      <EstadoBadge estado={sale.estado_pago} />
                    </td>
                    <td className="p-4 text-right font-bold text-slate-700 dark:text-slate-200 group-hover:text-emerald-600 transition-colors">
                      ${Number(sale.total).toFixed(2)}
                    </td>
                    <td className="p-4 text-center">
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PAGINATION */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredSales.length)} de {filteredSales.length} ventas
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce((acc, p, idx, arr) => {
                if (idx > 0 && arr[idx - 1] !== p - 1) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((item, idx) =>
                item === '...' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-slate-400">…</span>
                ) : (
                  <Button
                    key={item}
                    variant={page === item ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPage(item)}
                    className="h-8 w-8 p-0"
                  >
                    {item}
                  </Button>
                )
              )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <SaleDetailModal
        open={showDetailModal}
        onOpenChange={setShowDetailModal}
        saleId={selectedSaleId}
        onUpdateSale={handleSaleUpdate}
      />
    </div>
  );
};

export default HistorialVentas;