import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Eye, Filter, AlertCircle, X, Check, ChevronLeft, ChevronRight, Clock, AlertTriangle, Undo2, MoreHorizontal, FileText, Network, Copy, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import SaleDetailModal from './SaleDetailModal';
import NuevaDevolucionModal from '@/components/shared/NuevaDevolucionModal';
import NuevaNCModal from './NuevaNCModal';
import NuevaNotaDebitoModal from '@/components/shared/NuevaNotaDebitoModal';
import MapaRelaciones from '@/components/shared/MapaRelaciones';
import EstadoBadge from '@/components/ui/EstadoBadge';
import { formatDateAR, formatTimeAR } from '@/lib/dateUtils';
import { useToast } from '@/components/ui/use-toast';

const HistorialVentas = ({ navigateSaleId, onNavigated, onNavigate }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  
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
  const [selectedSaleId, setSelectedSaleId]   = useState(null);
  const [showDetailModal, setShowDetailModal]  = useState(false);
  const [devolucionComp, setDevolucionComp]    = useState(null);
  const [isDevolucionOpen, setIsDevolucionOpen] = useState(false);
  const [ncOrigen, setNcOrigen]               = useState(null);
  const [isNcOpen, setIsNcOpen]               = useState(false);
  const [ndOrigen, setNdOrigen]               = useState(null);
  const [isNdOpen, setIsNdOpen]               = useState(false);
  const [mapaCompId, setMapaCompId]           = useState(null);
  const [isMapaOpen, setIsMapaOpen]           = useState(false);
  const [reintentandoCaeId, setReintentandoCaeId] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  useEffect(() => {
    if (navigateSaleId) {
      setSelectedSaleId(navigateSaleId);
      setShowDetailModal(true);
      onNavigated?.();
    }
  }, [navigateSaleId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch Comprobantes (ventas + NC) y Notas de Débito emitidas en paralelo.
      // Las ND se guardan en una tabla separada `notas_debito`, así que las
      // traemos y normalizamos al formato de comprobantes para mostrarlas en el listado.
      const [{ data: salesData, error: salesError }, { data: ndData, error: ndError }] = await Promise.all([
        supabase.from('comprobantes').select('*').order('fecha', { ascending: false }),
        supabase
          .from('notas_debito')
          .select('id, numero_nd, fecha, cliente_id, comprobante_id, monto, moneda, concepto, observaciones, tipo')
          .eq('tipo', 'emitida')
          .order('fecha', { ascending: false }),
      ]);

      if (salesError) throw salesError;
      if (ndError)    throw ndError;

      // Normalizar ND para que tengan la misma forma que un comprobante
      const ndAsComprobantes = (ndData || []).map(nd => ({
        id:             nd.id,
        numero_venta:   nd.numero_nd,
        fecha:          nd.fecha,
        cliente_id:     nd.cliente_id,
        cliente_nombre: null, // se rellena con la lookup más abajo si hace falta
        total:          Number(nd.monto || 0),
        forma_pago:     'Nota de Débito',
        estado_pago:    'pagada',
        moneda:         nd.moneda || 'ARS',
        tipo:           'nota_debito',
        motivo_nc:      nd.concepto || nd.observaciones || null,
        comprobante_origen_id: nd.comprobante_id,
      }));

      // Merge y ordenar por fecha desc
      const merged = [...(salesData || []), ...ndAsComprobantes]
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

      // Fetch Clients antes de procesar para poder resolver nombres de las ND
      const { data: clientsData } = await supabase
        .from('clientes')
        .select('id, nombre')
        .order('nombre');

      const clienteNombrePorId = Object.fromEntries((clientsData || []).map(c => [c.id, c.nombre]));

      const processedSales = merged.map(s => ({
         ...s,
         cliente_nombre: s.cliente_nombre || (s.cliente_id ? clienteNombrePorId[s.cliente_id] : null) || null,
         estado_pago:    s.estado_pago    || (s.forma_pago === 'Cuenta Corriente' ? 'pendiente' : 'pagada'),
      }));

      setComprobantes(processedSales);
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

  // Reintento de CAE por comprobante (estados 'error' / 'error_definitivo').
  // NO emite desde el frontend: llama a reintentar_cae_comprobante (mig.180), que
  // reencola SIEMPRE la fila más reciente de facturas_pendientes_arca para este
  // comprobante (por id, nunca un blanket update por comprobante_id) — evita el
  // choque contra uq_fpa_comprobante_activo cuando hay filas históricas
  // 'error_definitivo' de reintentos anteriores. El arca-worker (única fuente de
  // verdad) procesa la cola después.
  const handleReintentarCae = async (sale) => {
    setReintentandoCaeId(sale.id);
    try {
      const { error } = await supabase.rpc('reintentar_cae_comprobante', {
        p_comprobante_id: sale.id,
      });
      if (error) throw error;

      toast({ title: 'CAE reencolado', description: 'El worker reintentará la emisión en los próximos minutos.' });
      fetchData();
    } catch (e) {
      toast({ title: 'Error al reintentar', description: e.message, variant: 'destructive' });
    } finally {
      setReintentandoCaeId(null);
    }
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

      // Status (incluye filtros especiales de CAE)
      if (selectedStatus === 'cae_error') {
        if (!['error', 'error_definitivo'].includes(sale.cae_estado)) return false;
      } else if (selectedStatus === 'cae_pendiente') {
        if (sale.cae_estado !== 'pendiente') return false;
      } else if (selectedStatus && (sale.estado_pago || 'pagada') !== selectedStatus) {
        return false;
      }

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
      <div className="bg-kx-surface dark:bg-kx-surface p-5 rounded-xl border kairox-border shadow-sm space-y-4">
        <div className="flex justify-between items-center mb-2">
           <h3 className="font-semibold text-slate-700 dark:text-kx-text flex items-center gap-2">
             <Filter className="h-4 w-4" /> Filtros Avanzados
             {activeFiltersCount > 0 && <Badge variant="secondary" className="ml-1 px-1.5 h-5 min-w-[20px] dark:bg-kx-surface-2 dark:text-slate-300">{activeFiltersCount}</Badge>}
           </h3>
           {activeFiltersCount > 0 && (
             <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs text-slate-500 hover:text-red-500 dark:text-kx-text-2 dark:hover:text-red-400">
               <X className="h-3 w-3 mr-1" /> Limpiar filtros
             </Button>
           )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Desde</Label>
             <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 kairox-input text-sm" />
          </div>
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Hasta</Label>
             <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 kairox-input text-sm" />
          </div>
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Cliente</Label>
             <select 
               className="w-full h-9 rounded-md border border-slate-300 dark:border-kx-border bg-transparent px-3 text-sm dark:bg-kx-surface dark:text-kx-text"
               value={selectedClient}
               onChange={e => setSelectedClient(e.target.value)}
             >
               <option value="">Todos</option>
               {clients.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
             </select>
          </div>
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Medio de Pago</Label>
             <select 
               className="w-full h-9 rounded-md border border-slate-300 dark:border-kx-border bg-transparent px-3 text-sm dark:bg-kx-surface dark:text-kx-text"
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
             <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Estado</Label>
             <select 
               className="w-full h-9 rounded-md border border-slate-300 dark:border-kx-border bg-transparent px-3 text-sm dark:bg-kx-surface dark:text-kx-text"
               value={selectedStatus}
               onChange={e => setSelectedStatus(e.target.value)}
             >
               <option value="">Todos</option>
               <option value="pagada">Pagada</option>
               <option value="pendiente">Pendiente</option>
               <option value="parcial">Parcial</option>
               <option value="cancelada">Cancelada</option>
               <option disabled>──────────</option>
               <option value="cae_error">⚠ Error CAE</option>
               <option value="cae_pendiente">⏳ CAE pendiente</option>
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
                <p className="text-sm text-slate-500 dark:text-kx-text-2 font-medium">Ventas Filtradas</p>
                <p className="text-2xl font-bold text-kx-text dark:text-kx-text">{filteredSales.length}</p>
              </div>
            </div>
            <div className="text-center sm:text-right border-t sm:border-t-0 sm:border-l border-blue-200 dark:border-kx-border pt-4 sm:pt-0 sm:pl-8 w-full sm:w-auto">
               <p className="text-sm text-slate-500 dark:text-kx-text-2 font-medium uppercase tracking-wider mb-1">Total Vendido</p>
               <p className="text-3xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
                 ${totalPeriodo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
               </p>
            </div>
         </div>
      </Card>

      {/* TABLE */}
      <div className="kairox-bg-card border kairox-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          {/* RESPONSIVE-TABLE */}
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b kairox-border text-xs uppercase font-semibold text-slate-500">
              <tr>
                <th className="p-4 w-32">Nro Venta</th>
                <th className="p-4 w-40">Fecha</th>
                <th className="p-4">Cliente</th>
                <th className="p-4 w-32">Medio Pago</th>
                <th className="p-4 w-28 text-center">Estado</th>
                <th className="p-4 w-32 text-center">Factura</th>
                <th className="p-4 w-32 text-right">Total</th>
                <th className="p-4 w-36 text-center">Acciones</th>
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
                    <td className="p-4 text-center"><Skeleton className="h-5 w-20 mx-auto rounded-full" /></td>
                    <td className="p-4 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    <td className="p-4 text-center"><Skeleton className="h-8 w-8 mx-auto rounded-md" /></td>
                  </tr>
                ))
              ) : filteredSales.length === 0 ? (
                <tr>
                  <td colSpan="8" className="p-12 text-center text-kx-text-2 bg-slate-50/50 dark:bg-slate-900/20">
                    <div className="flex flex-col items-center gap-2">
                       <AlertCircle className="h-10 w-10 text-kx-text-3" />
                       <p className="font-medium">
                         {comprobantes.length === 0 ? "Sin ventas registradas aún" : "No hay ventas que coincidan con los filtros"}
                       </p>
                       {activeFiltersCount > 0 && (
                         <Button variant="link" onClick={clearFilters} className="text-kx-blue h-auto p-0">Limpiar todos los filtros</Button>
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
                    <td className="p-4 text-slate-500 text-xs dark:text-kx-text-2">
                      {formatDateAR(sale.fecha)} <span className="text-kx-text-3 ml-1">{formatTimeAR(sale.fecha)}</span>
                    </td>
                    <td className="p-4 font-medium text-kx-text dark:text-kx-text">
                      {sale.cliente_nombre || <span className="text-kx-text-3 italic">Consumidor Final</span>}
                    </td>
                    <td className="p-4 text-kx-text-2 dark:text-kx-text-2 text-xs font-medium uppercase tracking-wide">
                      {sale.forma_pago}
                    </td>
                    <td className="p-4 text-center">
                      <EstadoBadge estado={sale.estado_pago} />
                    </td>
                    <td className="p-4 text-center">
                      {sale.cae_estado && sale.cae_estado !== 'no_aplica' ? (
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                          sale.cae_estado === 'emitido'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : sale.cae_estado === 'pendiente'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}>
                          {sale.cae_estado === 'emitido' && <Check className="w-3 h-3" />}
                          {sale.cae_estado === 'pendiente' && <Clock className="w-3 h-3" />}
                          {sale.cae_estado === 'error' && <AlertTriangle className="w-3 h-3" />}
                          {sale.cae_estado === 'error_definitivo' && <AlertCircle className="w-3 h-3" />}
                          {sale.cae_estado === 'emitido'
                            ? `Factura ${sale.tipo_comprobante_afip ?? ''} ${sale.numero_afip ?? ''}`.trim()
                            : sale.cae_estado === 'pendiente'
                            ? `Factura ${sale.tipo_comprobante_afip ?? ''} (CAE pend.)`.trim()
                            : sale.cae_estado === 'error_definitivo'
                            ? 'Error definitivo'
                            : 'Error CAE'
                          }
                        </span>
                      ) : sale.tipo_comprobante_afip ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          Factura {sale.tipo_comprobante_afip}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          Ticket
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right font-bold text-slate-700 dark:text-kx-text group-hover:text-emerald-600 transition-colors">
                      ${Number(sale.total).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {sale.moneda && sale.moneda !== 'ARS' && Number(sale.tipo_cambio_tasa) > 0 && (
                        <div className="text-[10px] font-normal text-slate-500 dark:text-kx-text-2 mt-0.5">
                          <span className="inline-block bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded font-bold mr-1">{sale.moneda}</span>
                          {sale.moneda} {(Number(sale.total) / Number(sale.tipo_cambio_tasa)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · TC ${Number(sale.tipo_cambio_tasa).toLocaleString('es-AR')}
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-center" onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-kx-text-3 hover:text-kx-text hover:bg-kx-surface-2 rounded-full"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-kx-surface border-kx-border text-kx-text text-sm w-48">
                          {/*
                            Workaround Radix: usar onSelect + setTimeout para que el
                            DropdownMenu termine su cleanup de focus ANTES de abrir el
                            Dialog. Sin esto, aria-hidden y pointer-events: none quedan
                            stuck en el <div #root> y la página entera se congela.
                          */}
                          <DropdownMenuItem
                            onSelect={(e) => {
                              e.preventDefault();
                              setTimeout(() => { setSelectedSaleId(sale.id); setShowDetailModal(true); }, 0);
                            }}
                            className="gap-2 cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5 text-kx-blue" /> Ver detalle
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={(e) => {
                              e.preventDefault();
                              setTimeout(() => { setMapaCompId(sale.id); setIsMapaOpen(true); }, 0);
                            }}
                            className="gap-2 cursor-pointer"
                          >
                            <Network className="h-3.5 w-3.5 text-kx-violet" /> Mapa de relaciones
                          </DropdownMenuItem>
                          {(sale.cae_estado === 'error' || sale.cae_estado === 'error_definitivo') && (
                            <>
                              <DropdownMenuSeparator className="bg-kx-border" />
                              <DropdownMenuItem
                                disabled={reintentandoCaeId === sale.id}
                                onSelect={(e) => {
                                  e.preventDefault();
                                  setTimeout(() => handleReintentarCae(sale), 0);
                                }}
                                className="gap-2 cursor-pointer text-kx-blue focus:text-kx-blue"
                              >
                                <RefreshCw className={`h-3.5 w-3.5 ${reintentandoCaeId === sale.id ? 'animate-spin' : ''}`} /> Reintentar CAE
                              </DropdownMenuItem>
                            </>
                          )}
                          {sale.tipo === 'venta' && (
                            <>
                              <DropdownMenuSeparator className="bg-kx-border" />
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  setTimeout(() => {
                                    setNcOrigen({
                                      id:             sale.id,
                                      numero_venta:   sale.numero_venta,
                                      cliente_id:     sale.cliente_id,
                                      cliente_nombre: sale.cliente_nombre,
                                    });
                                    setIsNcOpen(true);
                                  }, 0);
                                }}
                                className="gap-2 cursor-pointer"
                              >
                                <Copy className="h-3.5 w-3.5 text-kx-amber" /> Copiar a NC
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  setTimeout(() => {
                                    setNdOrigen({
                                      entidadId: sale.cliente_id,
                                      docId:     sale.id,
                                    });
                                    setIsNdOpen(true);
                                  }, 0);
                                }}
                                className="gap-2 cursor-pointer"
                              >
                                <FileText className="h-3.5 w-3.5 text-kx-red" /> Copiar a ND
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="bg-kx-border" />
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  setTimeout(() => {
                                    setDevolucionComp({
                                      id:            sale.id,
                                      numero:        sale.numero_venta,
                                      entidadId:     sale.cliente_id,
                                      entidadNombre: sale.cliente_nombre,
                                    });
                                    setIsDevolucionOpen(true);
                                  }, 0);
                                }}
                                className="gap-2 cursor-pointer text-kx-amber focus:text-kx-amber"
                              >
                                <Undo2 className="h-3.5 w-3.5" /> Devolver mercadería
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
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
          <p className="text-sm text-slate-500 dark:text-kx-text-2">
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
                  <span key={`ellipsis-${idx}`} className="px-2 text-kx-text-3">…</span>
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

      <NuevaDevolucionModal
        tipo="cliente"
        isOpen={isDevolucionOpen}
        onClose={() => { setIsDevolucionOpen(false); setDevolucionComp(null); }}
        onSuccess={() => fetchData()}
        origen={devolucionComp}
      />

      <NuevaNCModal
        open={isNcOpen}
        onOpenChange={v => { setIsNcOpen(v); if (!v) setNcOrigen(null); }}
        comprobanteOrigen={ncOrigen}
        onSuccess={() => fetchData()}
      />

      <NuevaNotaDebitoModal
        tipo="cliente"
        open={isNdOpen}
        onOpenChange={v => { setIsNdOpen(v); if (!v) setNdOrigen(null); }}
        origen={ndOrigen}
        onSuccess={() => fetchData()}
      />

      <MapaRelaciones
        open={isMapaOpen}
        onOpenChange={v => { setIsMapaOpen(v); if (!v) setMapaCompId(null); }}
        comprobanteId={mapaCompId}
        onNavigate={(tipo, id) => {
          if (tipo === 'comprobante') { setSelectedSaleId(id); setShowDetailModal(true); }
          else onNavigate?.(tipo, id);
        }}
      />

      <SaleDetailModal
        open={showDetailModal}
        onOpenChange={setShowDetailModal}
        saleId={selectedSaleId}
        onUpdateSale={handleSaleUpdate}
        onNavigate={onNavigate}
      />
    </div>
  );
};

export default HistorialVentas;