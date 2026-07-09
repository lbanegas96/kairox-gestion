import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, DollarSign, ArrowDownCircle, ArrowUpCircle, Users, Clock } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { getNowAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { tipoCambioService } from '@/services/tipoCambioService';
import ClientDetailModal from './ClientDetailModal';
import TablaClientes from '@/components/cuenta-corriente/TablaClientes';
import TabAntiguedad from '@/components/cuenta-corriente/TabAntiguedad';
import ModalCobro from '@/components/cuenta-corriente/ModalCobro';

function CuentaCorrienteSection() {
  const { user } = useAuth();
  const { isSessionOpen, currentSession } = useCaja();
  const { toast } = useToast();
  const qc = useQueryClient();
  const tcParalelo = useTCParalelo();
  // Las notifs de deuda_vencida dependen de cuenta_corriente_movimientos:
  // tras cada cobro hay que invalidarlas o quedan stale hasta 30s.
  const invalidateNotifs = () => qc.invalidateQueries({ queryKey: ['notif'] });

  // Data State
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState('Todos'); // 'Todos', 'Con Deuda', 'Al Día'

  // Modals
  const [selectedClient, setSelectedClient] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);

  // Payment Form
  const [paymentData, setPaymentData] = useState({
    monto: '',
    metodo: 'Efectivo',
    nota: ''
  });
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  // Imputación por factura (Open Item clearing, migration 169) — opcional.
  // Si el usuario no imputa nada, el cobro se comporta igual que siempre
  // (reduce el saldo corrido, sin marcar ninguna factura puntual como paga).
  const [facturasAbiertas, setFacturasAbiertas] = useState([]);
  const [imputaciones, setImputaciones] = useState({}); // { comprobante_id: "monto string" }
  // Imputación en moneda extranjera (Fase 3 Multimoneda — diferencia de cambio):
  // solo aplica a facturas con moneda != 'ARS'. Separado de `imputaciones` (ARS)
  // porque el RPC necesita saber cuántas unidades de moneda extranjera se están
  // cancelando para calcular la diferencia de cambio realizada al TC de hoy.
  const [imputacionesFX, setImputacionesFX] = useState({}); // { comprobante_id: "monto FX string" }

  // Aging Report
  const [activeTab, setActiveTab] = useState('clientes');
  const [agingData, setAgingData] = useState([]);
  const [agingLoading, setAgingLoading] = useState(false);

  useEffect(() => {
    if (user && user.empresa_id) {
      fetchData();
    }
  }, [user]);

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

      const now = getNowAR();
      const result = comprobantes.map(comp => {
        const dias = Math.floor((now - new Date(comp.fecha)) / 86400000);
        let banda, color;
        if (dias <= 30)      { banda = '0–30 días';  color = 'green'; }
        else if (dias <= 60) { banda = '31–60 días'; color = 'yellow'; }
        else if (dias <= 90) { banda = '61–90 días'; color = 'orange'; }
        else                 { banda = '+90 días';   color = 'red'; }
        return {
          comprobante_id: comp.comprobante_id,
          numero_venta:   comp.numero_venta,
          fecha:          comp.fecha,
          total:          Number(comp.saldo_pendiente),
          cliente_id:     comp.cliente_id,
          cliente_nombre: comp.cliente_nombre,
          dias,
          banda,
          color,
        };
      });

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

  const openPaymentDialog = (client, e) => {
    e?.stopPropagation();
    setSelectedClient(client);
    setPaymentData({ monto: '', metodo: 'Efectivo', nota: '' });
    setImputaciones({});
    setImputacionesFX({});
    setFacturasAbiertas([]);
    setIsPaymentDialogOpen(true);
    fetchFacturasAbiertas(client.id);
  };

  const fetchFacturasAbiertas = async (clienteId) => {
    const { data, error } = await supabase
      .from('facturas_saldo_pendiente')
      .select('comprobante_id, numero_venta, fecha, saldo_pendiente, moneda, tipo_cambio_tasa')
      .eq('cliente_id', clienteId)
      .gt('saldo_pendiente', 0)
      .order('fecha', { ascending: true });
    if (error) {
      console.error('[facturas_saldo_pendiente]', error.message);
      return;
    }
    let facturas = data || [];

    // Para facturas en moneda extranjera, traer el TC de hoy (una consulta por
    // moneda distinta) para mostrar el equivalente ARS y validar el clearing.
    const monedasExtranjeras = [...new Set(facturas.filter(f => f.moneda && f.moneda !== 'ARS').map(f => f.moneda))];
    if (monedasExtranjeras.length > 0) {
      const tasas = {};
      await Promise.all(monedasExtranjeras.map(async (m) => {
        try {
          tasas[m] = await tipoCambioService.getToday(user.empresa_id, m);
        } catch {
          tasas[m] = null;
        }
      }));
      facturas = facturas.map(f => (f.moneda && f.moneda !== 'ARS') ? { ...f, tc_hoy: tasas[f.moneda] } : f);
    }

    setFacturasAbiertas(facturas);
  };

  // Reparte `monto` entre las facturas abiertas más viejas primero (FIFO),
  // hasta agotar el monto o las facturas. El usuario puede editar el
  // resultado a mano después. Solo aplica a facturas en ARS — las facturas en
  // moneda extranjera se imputan a mano con el input dedicado (necesitan el
  // monto en esa moneda, no en pesos).
  const autoDistribuirFIFO = (monto) => {
    let restante = monto;
    const nuevo = {};
    for (const f of facturasAbiertas) {
      if (f.moneda && f.moneda !== 'ARS') continue;
      if (restante <= 0) break;
      const aplicar = Math.min(restante, f.saldo_pendiente);
      if (aplicar > 0) {
        nuevo[f.comprobante_id] = String(aplicar);
        restante -= aplicar;
      }
    }
    setImputaciones(nuevo);
  };

  const handleRegisterPayment = async () => {
    // Solo Efectivo requiere caja abierta — Transferencia/Tarjeta/Cheque no
    if (paymentData.metodo === 'Efectivo' && !isSessionOpen) {
      toast({
        variant: 'destructive',
        title: 'Caja cerrada',
        description: 'Abrí la caja antes de registrar cobros en efectivo.',
      });
      return;
    }

    if (!selectedClient) return;

    const amount = parseNumberLocale(paymentData.monto);
    if (!amount || isNaN(amount) || amount <= 0) {
      toast({ title: "Error", description: "Ingrese un monto válido mayor a 0", variant: "destructive" });
      return;
    }

    setIsProcessingPayment(true);
    const date = getNowAR().toISOString();

    // Calcular monto en moneda paralela si la empresa lo usa
    const pagoParalelo = tcParalelo.enabled && tcParalelo.tcHoy
      ? tcParalelo.calcParalelo(amount, 'ARS', 1)
      : null;

    // Imputación por factura (opcional, migration 169): solo se arma el array
    // si el usuario cargó algún monto — si no, se manda null y el cobro se
    // comporta exactamente igual que antes (reduce el saldo corrido, sin
    // marcar ninguna factura puntual como cancelada).
    // Facturas en moneda extranjera (Fase 3 Multimoneda) usan monto_moneda_extranjera
    // en vez de monto ARS — el RPC calcula la diferencia de cambio realizada.
    const imputacionesArray = facturasAbiertas
      .map(f => {
        if (f.moneda && f.moneda !== 'ARS') {
          const fx = parseNumberLocale(imputacionesFX[f.comprobante_id] || '');
          return fx > 0 ? { comprobante_id: f.comprobante_id, monto_moneda_extranjera: fx } : null;
        }
        const monto = parseNumberLocale(imputaciones[f.comprobante_id] || '');
        return monto > 0 ? { comprobante_id: f.comprobante_id, monto } : null;
      })
      .filter(Boolean);

    try {
      // Cobro ATÓMICO: cuenta corriente (HABER) + caja (ingreso) en un solo RPC (migration 130).
      // Antes eran 2 inserts sueltos: si el 2º fallaba, la deuda del cliente bajaba SIN registrar
      // la plata en caja, y un reintento reducía la deuda dos veces. Ahora es todo o nada.
      const { data: cobroData, error: cobroError } = await supabase.rpc('registrar_cobro_cliente', {
        p_empresa_id:     user.empresa_id,
        p_user_id:        user.id,
        p_cliente_id:     selectedClient.id,
        p_cliente_nombre: selectedClient.nombre,
        p_monto:          amount,
        p_metodo:         paymentData.metodo,
        p_fecha:          date,
        p_descripcion:    paymentData.nota ? `Pago: ${paymentData.nota}` : 'Pago de deuda',
        p_caja_sesion_id: currentSession?.id ?? null,
        p_monto_paralelo: pagoParalelo,
        p_tc_paralelo:    pagoParalelo !== null ? tcParalelo.tcHoy : null,
        p_imputaciones:   imputacionesArray.length > 0 ? imputacionesArray : null,
      });

      if (cobroError) throw cobroError;

      toast({
        title: "Pago Registrado",
        description: `Se registró el cobro de $${amount.toLocaleString('es-AR')}.`,
        className: "bg-emerald-600 text-white border-none"
      });

      // El RPC genera el asiento contable en la misma transacción, pero de forma
      // no bloqueante (mismo patrón que asientosAutoService): si falla por período
      // cerrado o cuenta faltante, el cobro igual se registra. Antes esto era
      // invisible — data.asiento_generado nunca se leía en el frontend.
      if (cobroData?.asiento_generado === false) {
        toast({
          title: "Cobro registrado sin asiento contable",
          description: "El cobro se guardó correctamente, pero no se generó el asiento (período cerrado o cuenta contable faltante). Revisar Plan de Cuentas.",
          variant: "destructive",
        });
      }

      setIsPaymentDialogOpen(false);
      fetchData(); // Refresh list
      invalidateNotifs();

      // Update selected client in modal if open
      if (selectedClient) {
        const updatedClient = { ...selectedClient, saldo_actual: (selectedClient.saldo_actual || 0) - amount };
        setSelectedClient(updatedClient);
      }

    } catch (error) {
      console.error("Error registering payment:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsProcessingPayment(false);
    }
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
            <span className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Total Deuda (Filtrada)</span>
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
            <span className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Clientes con Deuda</span>
            <ArrowDownCircle className="h-4 w-4 text-kx-red" />
          </div>
          <div>
            <div className="text-2xl font-bold text-kx-text tabular-nums">{metrics.countConDeuda}</div>
            <p className="text-xs text-kx-text-3 mt-1">Clientes que deben dinero</p>
          </div>
        </div>

        <div className="bg-kx-surface p-5 flex flex-col justify-between border-t-2 border-t-kx-green hover:bg-kx-surface-2 transition-colors duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Clientes Al Día</span>
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
          <TabsTrigger value="clientes" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md px-4 py-2">
            <Users className="w-4 h-4 mr-2" /> Clientes
          </TabsTrigger>
          <TabsTrigger value="antigüedad" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md px-4 py-2">
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
            setSelectedClient={setSelectedClient} setDetailModalOpen={setDetailModalOpen} setActiveTab={setActiveTab}
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
        selectedClient={selectedClient}
        paymentData={paymentData} setPaymentData={setPaymentData}
        tcParalelo={tcParalelo}
        isProcessingPayment={isProcessingPayment}
        handleRegisterPayment={handleRegisterPayment}
        facturasAbiertas={facturasAbiertas}
        imputaciones={imputaciones} setImputaciones={setImputaciones}
        imputacionesFX={imputacionesFX} setImputacionesFX={setImputacionesFX}
        autoDistribuirFIFO={autoDistribuirFIFO}
      />
    </div>
  );
}

export default CuentaCorrienteSection;
