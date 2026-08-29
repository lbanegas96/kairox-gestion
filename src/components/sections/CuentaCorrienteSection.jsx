import { useState, useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, DollarSign, ArrowDownCircle, ArrowUpCircle, Users, Clock } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useToast } from '@/components/ui/use-toast';
import { getNowAR } from '@/lib/dateUtils';
import { TipoCambioModal } from '@/components/ui/TipoCambioModal';
import ClientDetailModal from './ClientDetailModal';
import TablaClientes from '@/components/cuenta-corriente/TablaClientes';
import TabAntiguedad from '@/components/cuenta-corriente/TabAntiguedad';
import ModalCobro from '@/components/cuenta-corriente/ModalCobro';
import ReciboPago from '@/components/shared/ReciboPago';
import { useRegistrarCobro } from '@/hooks/useRegistrarCobro';

function CuentaCorrienteSection({ initialClienteId } = {}) {
  const { user } = useAuth();
  const { isSessionOpen } = useCaja();
  const { toast } = useToast();

  // Data State
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState('Todos'); // 'Todos', 'Con Deuda', 'Al Día'

  // Modals (detalle de cliente — independiente del diálogo de cobro)
  const [selectedClient, setSelectedClient] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // "Registrar Cobro" — lógica compartida con el detalle de Factura (ver
  // useRegistrarCobro.jsx, 29/08: antes esto vivía acá solo, y esa era la
  // única forma de cobrar una factura sin saltar de módulo). Acá el
  // onSuccess refresca la lista de clientes de esta pantalla.
  const cobro = useRegistrarCobro(() => fetchData());
  const {
    selectedClient: clienteCobro,
    isPaymentDialogOpen, setIsPaymentDialogOpen,
    paymentData, setPaymentData,
    formasPago,
    tcParalelo,
    isProcessingPayment,
    facturasAbiertas,
    imputaciones, setImputaciones,
    imputacionesFX, setImputacionesFX,
    autoDistribuirFIFO,
    handleRegisterPayment,
    openPaymentDialog,
    lastRecibo,
    showParaleloTCModal, setShowParaleloTCModal,
  } = cobro;

  // Aging Report
  const [activeTab, setActiveTab] = useState('clientes');
  const [agingData, setAgingData] = useState([]);
  const [agingLoading, setAgingLoading] = useState(false);

  useEffect(() => {
    if (user && user.empresa_id) {
      fetchData();
    }
  }, [user]);

  // Deep-link de solo lectura desde "Ver en Cuenta Corriente" (Mapa de
  // Relaciones / Flujo del documento de una Factura, 29/08) — abre el
  // detalle del cliente para revisar sus movimientos, ninguna acción
  // automática (a diferencia del viejo autoAbrirCobro, que abría el diálogo
  // de cobro: eso ya no hace falta, "Registrar Cobro" es inline ahora). El
  // ref evita reabrir si el usuario cierra el modal y el componente
  // re-renderiza con el mismo prop.
  const abrioDetalleRef = useRef(null);
  useEffect(() => {
    if (!initialClienteId || clients.length === 0) return;
    if (abrioDetalleRef.current === initialClienteId) return;
    const cliente = clients.find(c => c.id === initialClienteId);
    if (cliente) {
      abrioDetalleRef.current = initialClienteId;
      setSelectedClient(cliente);
      setDetailModalOpen(true);
    }
  }, [initialClienteId, clients]);

  useEffect(() => {
    if (activeTab === 'antigüedad' && user?.empresa_id) {
      fetchAgingData();
    }
  }, [activeTab, user]);

  const fetchAgingData = async () => {
    setAgingLoading(true);
    try {
      // Open Item Management real (migration 169): saldo_pendiente = total -
      // suma de imputaciones. Antes esto miraba solo el flag estado_pago='pendiente'
      // y mostraba el total COMPLETO de la factura aunque ya se hubiese cobrado
      // parcialmente — hallazgo de la auditoría contable, corregido acá.
      const { data: comprobantes, error } = await supabase
        .from('facturas_saldo_pendiente')
        .select('comprobante_id, numero_venta, fecha, saldo_pendiente, cliente_id, cliente_nombre')
        .eq('empresa_id', user.empresa_id)
        .gt('saldo_pendiente', 0)
        .order('fecha', { ascending: true });

      if (error) throw error;
      if (!comprobantes?.length) { setAgingData([]); return; }

      // La imputación a factura puntual es opcional en registrar_cobro_cliente
      // (un "pago a cuenta" genérico reduce saldo_actual sin cancelar ninguna
      // factura puntual), así que la suma de comprobantes "abiertos" de un
      // cliente puede sobrestimar su deuda real. Reconciliamos escalando cada
      // comprobante para que la suma por cliente coincida siempre con
      // clientes.saldo_actual — mismo criterio que Cartera de Clientes
      // (reportDefinitions.jsx / ReportesSection.jsx).
      const saldoRealPorCliente = {};
      clients.forEach(c => { saldoRealPorCliente[c.id] = c.saldo_actual || 0; });

      const sumaRawPorCliente = {};
      comprobantes.forEach(comp => {
        sumaRawPorCliente[comp.cliente_id] = (sumaRawPorCliente[comp.cliente_id] || 0) + Number(comp.saldo_pendiente);
      });

      const now = getNowAR();
      const result = comprobantes.map(comp => {
        const dias = Math.floor((now - new Date(comp.fecha)) / 86400000);
        let banda, color;
        if (dias <= 30)      { banda = '0–30 días';  color = 'green'; }
        else if (dias <= 60) { banda = '31–60 días'; color = 'yellow'; }
        else if (dias <= 90) { banda = '61–90 días'; color = 'orange'; }
        else                 { banda = '+90 días';   color = 'red'; }

        let monto = Number(comp.saldo_pendiente);
        const saldoReal = saldoRealPorCliente[comp.cliente_id];
        const sumaRaw = sumaRawPorCliente[comp.cliente_id];
        if (saldoReal !== undefined) {
          if (saldoReal <= 0) {
            monto = 0;
          } else if (sumaRaw > 0 && Math.abs(sumaRaw - saldoReal) > 0.01) {
            monto = Math.round(monto * (saldoReal / sumaRaw) * 100) / 100;
          }
        }

        return {
          comprobante_id: comp.comprobante_id,
          numero_venta:   comp.numero_venta,
          fecha:          comp.fecha,
          total:          monto,
          cliente_id:     comp.cliente_id,
          cliente_nombre: comp.cliente_nombre,
          dias,
          banda,
          color,
        };
      }).filter(comp => comp.total > 0.01);

      setAgingData(result.sort((a, b) => b.dias - a.dias));
    } catch (err) {
      console.error('Error aging:', err);
      toast({ title: 'Error', description: 'No se pudo calcular la antigüedad.', variant: 'destructive' });
    } finally {
      setAgingLoading(false);
    }
  };

  const agingBandas = useMemo(() => {
    const bandas = {
      '0–30 días':  { monto: 0, count: 0, color: 'green' },
      '31–60 días': { monto: 0, count: 0, color: 'yellow' },
      '61–90 días': { monto: 0, count: 0, color: 'orange' },
      '+90 días':   { monto: 0, count: 0, color: 'red' },
    };
    for (const comp of agingData) {
      if (bandas[comp.banda]) {
        bandas[comp.banda].monto += comp.total;
        bandas[comp.banda].count += 1;
      }
    }
    return bandas;
  }, [agingData]);

  const fetchData = async () => {
    try {
      setLoading(true);
      // Fixed: fetching clients by empresa_id instead of user_id/tenant_id
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .order('nombre');

      if (error) throw error;
      setClients(data || []);
    } catch (error) {
      console.error('Error fetching CC data:', error);
      toast({
        title: "Error",
        description: "No se pudieron cargar los datos de cuenta corriente",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // --- Filtering & Sorting ---
  const filteredClients = useMemo(() => {
    let result = clients;

    // 1. Text Search
    if (searchTerm) {
      const lowerQuery = searchTerm.toLowerCase();
      result = result.filter(c =>
        c.nombre.toLowerCase().includes(lowerQuery)
      );
    }

    // 2. Status Filter
    if (statusFilter === 'Con Deuda') {
      result = result.filter(c => (c.saldo_actual || 0) > 0);
    } else if (statusFilter === 'Al Día') {
      result = result.filter(c => (c.saldo_actual || 0) <= 0);
    }

    // 3. Sort: Debtors first, then Alphabetical
    return result.sort((a, b) => {
      const debtA = (a.saldo_actual || 0) > 0 ? 1 : 0;
      const debtB = (b.saldo_actual || 0) > 0 ? 1 : 0;

      if (debtA !== debtB) return debtB - debtA; // Debtors first
      return a.nombre.localeCompare(b.nombre); // Then alphabetical
    });
  }, [clients, searchTerm, statusFilter]);

  // --- Metrics Calculation ---
  const metrics = useMemo(() => {
    const totalAdeudado = filteredClients.reduce((sum, c) => sum + Math.max(0, c.saldo_actual || 0), 0);
    const countConDeuda = filteredClients.filter(c => (c.saldo_actual || 0) > 0).length;
    const countAlDia = filteredClients.filter(c => (c.saldo_actual || 0) <= 0).length;

    return { totalAdeudado, countConDeuda, countAlDia };
  }, [filteredClients]);

  // --- Actions ---
  const openDetailModal = (client) => {
    setSelectedClient(client);
    setDetailModalOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-kx-text">Cuenta Corriente</h2>
          <p className="text-slate-500 dark:text-kx-text-2">Control de saldos y movimientos de clientes</p>
        </div>
        {!isSessionOpen && (
          <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-4 py-2 rounded-lg flex items-center gap-2 border border-red-200 dark:border-red-800 text-sm font-bold shadow-sm">
            <AlertTriangle className="h-4 w-4" /> CAJA CERRADA
          </div>
        )}
      </div>

      {/* Metrics Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden shadow-sm dark:shadow-none">
        <div className="bg-kx-surface p-5 flex flex-col justify-between border-t-2 border-t-kx-amber hover:bg-kx-surface-2 transition-colors duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-2xs text-kx-text-2 uppercase tracking-wide font-medium">Total Deuda (Filtrada)</span>
            <DollarSign className="h-4 w-4 text-kx-amber" />
          </div>
          <div>
            <div className="text-2xl font-black text-kx-red tabular-nums">
              ${metrics.totalAdeudado.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </div>
            {tcParalelo.enabled && tcParalelo.tcHoy && metrics.totalAdeudado > 0 && (
              <p className="text-xs text-kx-text-3 mt-0.5">
                ≈ {(metrics.totalAdeudado / tcParalelo.tcHoy).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}
              </p>
            )}
            <p className="text-xs text-kx-text-3 mt-1">Suma de saldos pendientes</p>
          </div>
        </div>

        <div className="bg-kx-surface p-5 flex flex-col justify-between border-t-2 border-t-kx-red hover:bg-kx-surface-2 transition-colors duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-2xs text-kx-text-2 uppercase tracking-wide font-medium">Clientes con Deuda</span>
            <ArrowDownCircle className="h-4 w-4 text-kx-red" />
          </div>
          <div>
            <div className="text-2xl font-bold text-kx-text tabular-nums">{metrics.countConDeuda}</div>
            <p className="text-xs text-kx-text-3 mt-1">Clientes que deben dinero</p>
          </div>
        </div>

        <div className="bg-kx-surface p-5 flex flex-col justify-between border-t-2 border-t-kx-green hover:bg-kx-surface-2 transition-colors duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-2xs text-kx-text-2 uppercase tracking-wide font-medium">Clientes Al Día</span>
            <ArrowUpCircle className="h-4 w-4 text-kx-green" />
          </div>
          <div>
            <div className="text-2xl font-bold text-kx-text tabular-nums">{metrics.countAlDia}</div>
            <p className="text-xs text-kx-text-3 mt-1">Sin deuda o con saldo a favor</p>
          </div>
        </div>
      </div>

      {/* ── Tabs: Clientes / Antigüedad ──────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-transparent p-0 gap-2 mb-4 flex justify-start">
          <TabsTrigger value="clientes" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-kx-violet data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md px-4 py-2">
            <Users className="w-4 h-4 mr-2" /> Clientes
          </TabsTrigger>
          <TabsTrigger value="antigüedad" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-kx-violet data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md px-4 py-2">
            <Clock className="w-4 h-4 mr-2" /> Antigüedad de Deuda
          </TabsTrigger>
        </TabsList>

        <TabsContent value="clientes">
          <TablaClientes
            searchTerm={searchTerm} setSearchTerm={setSearchTerm}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
            loading={loading} clients={clients} filteredClients={filteredClients}
            tcParalelo={tcParalelo}
            openDetailModal={openDetailModal} openPaymentDialog={openPaymentDialog}
          />
        </TabsContent>

        <TabsContent value="antigüedad">
          <TabAntiguedad
            agingBandas={agingBandas} agingLoading={agingLoading} agingData={agingData}
            tcParalelo={tcParalelo}
            onVerDetalle={(cliente) => { setSelectedClient(cliente); setDetailModalOpen(true); setActiveTab('clientes'); }}
          />
        </TabsContent>
      </Tabs>

      {/* DETAIL MODAL */}
      <ClientDetailModal
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        clientId={selectedClient?.id}
        clientData={selectedClient}
        onUpdate={() => fetchData()}
      />

      {/* QUICK PAYMENT DIALOG (From list view) */}
      <ModalCobro
        isPaymentDialogOpen={isPaymentDialogOpen} setIsPaymentDialogOpen={setIsPaymentDialogOpen}
        selectedClient={clienteCobro}
        paymentData={paymentData} setPaymentData={setPaymentData}
        formasPago={formasPago}
        tcParalelo={tcParalelo}
        isProcessingPayment={isProcessingPayment}
        handleRegisterPayment={handleRegisterPayment}
        facturasAbiertas={facturasAbiertas}
        imputaciones={imputaciones} setImputaciones={setImputaciones}
        imputacionesFX={imputacionesFX} setImputacionesFX={setImputacionesFX}
        autoDistribuirFIFO={autoDistribuirFIFO}
      />

      {/* Comprobante de Pago imprimible — item 6 del plan de rediseño (22/08).
          Vive siempre oculto en el DOM, igual que TicketPrint del POS. */}
      <ReciboPago recibo={lastRecibo} />

      {/* Carga del TC de paridad cuando falta — el gate de handleRegisterPayment lo abre */}
      <TipoCambioModal
        open={showParaleloTCModal}
        onOpenChange={setShowParaleloTCModal}
        moneda={tcParalelo.monedaParalela}
        onConfirm={(t) => { tcParalelo.setTC(t); setShowParaleloTCModal(false); }}
      />
    </div>
  );
}

export default CuentaCorrienteSection;
