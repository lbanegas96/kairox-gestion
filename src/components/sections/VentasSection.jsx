import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import NuevaFacturaModal from '@/components/ventas/NuevaFacturaModal';
import CotizacionesSection from '@/components/sections/CotizacionesSection';
import PedidosSection from '@/components/sections/PedidosSection';
import EntregasSection from '@/components/ventas/EntregasSection';
import HistorialVentas from '@/components/ventas/HistorialVentas';
import DevolucionesSection from '@/components/ventas/DevolucionesSection';
import MonitorFacturacionAFIP from '@/components/ventas/MonitorFacturacionAFIP';
import { useAfipConfig } from '@/hooks/useAfipConfig';
import { useCotizacionesActivo } from '@/hooks/useCotizacionesActivo';
import { useRegistrarCobro } from '@/hooks/useRegistrarCobro';
import ModalCobro from '@/components/cuenta-corriente/ModalCobro';
import ReciboPago from '@/components/shared/ReciboPago';
import { TipoCambioModal } from '@/components/ui/TipoCambioModal';

function VentasSection({ initialTab = 'historial' }) {
  const { afipActivo } = useAfipConfig();
  const cotizacionesActivo = useCotizacionesActivo();
  const [activeTab, setActiveTab]           = useState(initialTab);
  const [showNuevaFactura, setShowNuevaFactura] = useState(false);
  const [refreshKey, setRefreshKey]         = useState(0);
  const [navigateSaleId, setNavigateSaleId] = useState(null);
  const [navigateEntregaId, setNavigateEntregaId] = useState(null);
  const [navigateCotizacionId, setNavigateCotizacionId] = useState(null);
  const [navigatePedidoId, setNavigatePedidoId] = useState(null);
  const [prefillPedidoCotizacion, setPrefillPedidoCotizacion] = useState(null);

  const handleSaleSuccess = () => setRefreshKey(k => k + 1);

  // "Registrar Cobro" desde la confirmación de NuevaFacturaModal tras crear
  // una factura (único caller que queda — el de SaleDetailModal ahora se
  // resuelve solo, adentro de ese mismo modal). Antes esto saltaba a Cuenta
  // Corriente vía onNavigateGlobal; ahora abre el mismo ModalCobro sin salir
  // de Ventas (29/08, hallazgo Luciano).
  const cobroPostFactura = useRegistrarCobro(() => setRefreshKey(k => k + 1));

  // Called from DevolucionesSection: (tipo, id) — 'factura'/'nota_credito'/
  // 'nota_debito' son todos filas de comprobantes, mismo destino que 'comprobante'.
  const handleChildNavigate = (tipo, id) => {
    if (tipo === 'comprobante' || tipo === 'factura' || tipo === 'nota_credito' || tipo === 'nota_debito') {
      setActiveTab('historial');
      setNavigateSaleId(id);
    }
  };

  // Handler único para HistorialVentas → SaleDetailModal, que a su vez lo pasa
  // a DOS orígenes que llaman distinto:
  //   - DocumentFlow (pastillas del flujo del documento, item 7 — antes
  //     SaleDetailModal usaba un DocumentFlowPanel propio con onNavigate
  //     (seccion); unificado a chips con onNavigate(tipo, id), igual que
  //     Entrega/OC/Pedido): deep-linkea al documento real.
  //   - MapaRelaciones (22/08): onNavigate(tipo, id) — mismo patrón.
  // 'cobro_cc' no está mapeado a propósito: el chip queda visible pero sin
  // navegación — el cobro en sí ya no navega a ningún lado (se resuelve
  // inline, ver cobroPostFactura más arriba), así que no hay destino al que
  // saltar desde acá.
  const handleVentasNavigate = (tipoOSeccion, id) => {
    const TIPO_A_SECCION = {
      cotizacion: 'cotizaciones', pedido: 'pedidos', entrega: 'entregas',
      venta: 'historial', nota_credito: 'historial', nota_debito: 'historial',
      devolucion: 'devoluciones',
    };
    const SECCION_DIRECTA = { cotizaciones: 'cotizaciones', pedidos: 'pedidos', ventas: 'historial', historial: 'historial', devoluciones: 'devoluciones' };
    const seccion = TIPO_A_SECCION[tipoOSeccion] ?? SECCION_DIRECTA[tipoOSeccion];
    if (!seccion) return;
    setActiveTab(seccion);
    if (!id) return;
    if (seccion === 'cotizaciones') setNavigateCotizacionId(id);
    else if (seccion === 'pedidos') setNavigatePedidoId(id);
    else if (seccion === 'entregas') setNavigateEntregaId(id);
    else if (seccion === 'historial') setNavigateSaleId(id);
  };

  const handleRegistrarCobro = (clienteId, facturaId) => {
    cobroPostFactura.abrirCobroPorClienteId(clienteId, facturaId);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-kx-text">Ventas</h2>
        <p className="text-sm text-kx-text-2">Cotizaciones, Pedidos, Entregas y Facturas</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-transparent p-0 gap-1 flex justify-start border-b border-kx-border rounded-none h-auto pb-0">
          {[
            ...(cotizacionesActivo ? [{ value: 'cotizaciones', label: 'Cotizaciones' }] : []),
            { value: 'pedidos',      label: 'Pedidos'      },
            { value: 'entregas',     label: 'Entregas'     },
            { value: 'historial',    label: 'Facturas'     },
            { value: 'devoluciones', label: 'Devoluciones' },
            ...(afipActivo ? [{ value: 'afip', label: 'Facturación AFIP' }] : []),
          ].map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className={[
                'rounded-none rounded-t-sm px-4 py-2 text-sm border-b-2 transition-colors',
                'data-[state=active]:border-[rgb(var(--kx-violet))] data-[state=active]:text-kx-text data-[state=active]:font-semibold',
                'data-[state=inactive]:border-transparent data-[state=inactive]:text-kx-text-2',
                'data-[state=inactive]:hover:text-kx-text',
              ].join(' ')}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="cotizaciones" className="mt-4">
          <CotizacionesSection
            onNavigateToSale={(id) => { setActiveTab('historial'); setNavigateSaleId(id); }}
            onCopiarAPedido={(cot) => { setPrefillPedidoCotizacion(cot); setActiveTab('pedidos'); }}
            onVerPedido={(id) => { setActiveTab('pedidos'); setNavigatePedidoId(id); }}
            onVerEntrega={(id) => { setActiveTab('entregas'); setNavigateEntregaId(id); }}
            navigateCotizacionId={navigateCotizacionId}
            onNavigated={() => setNavigateCotizacionId(null)}
          />
        </TabsContent>

        <TabsContent value="pedidos" className="mt-4">
          <PedidosSection
            onNavigate={(tipo, id) => {
              if (tipo === 'entrega') { setActiveTab('entregas'); setNavigateEntregaId(id); }
              else if (tipo === 'factura' || tipo === 'comprobante') { setActiveTab('historial'); setNavigateSaleId(id); }
              else if (tipo === 'cotizacion') { setActiveTab('cotizaciones'); setNavigateCotizacionId(id); }
            }}
            prefillCotizacion={prefillPedidoCotizacion}
            onPrefillConsumed={() => setPrefillPedidoCotizacion(null)}
            navigatePedidoId={navigatePedidoId}
            onNavigated={() => setNavigatePedidoId(null)}
          />
        </TabsContent>

        <TabsContent value="entregas" className="mt-4">
          <EntregasSection
            navigateEntregaId={navigateEntregaId}
            onNavigated={() => setNavigateEntregaId(null)}
            onNavigate={(tipo, id) => {
              if (tipo === 'pedido') { setActiveTab('pedidos'); setNavigatePedidoId(id); }
              else if (tipo === 'factura' || tipo === 'comprobante') { setActiveTab('historial'); setNavigateSaleId(id); }
            }}
          />
        </TabsContent>

        <TabsContent value="historial" className="mt-4">
          <div className="flex justify-end mb-4">
            <Button
              onClick={() => setShowNuevaFactura(true)}
              size="sm"
              className="bg-[rgb(var(--kx-green))] hover:opacity-90 text-white gap-2 h-8 px-3 text-xs font-medium"
            >
              <FileText className="w-3.5 h-3.5" />
              Nueva Factura
            </Button>
          </div>
          <HistorialVentas
            key={refreshKey}
            navigateSaleId={navigateSaleId}
            onNavigated={() => setNavigateSaleId(null)}
            onNavigate={handleVentasNavigate}
          />
        </TabsContent>

        <TabsContent value="devoluciones" className="mt-4">
          <DevolucionesSection onNavigate={handleChildNavigate} />
        </TabsContent>

        {afipActivo && (
          <TabsContent value="afip" className="mt-4">
            <MonitorFacturacionAFIP />
          </TabsContent>
        )}
      </Tabs>

      <NuevaFacturaModal
        open={showNuevaFactura}
        onOpenChange={setShowNuevaFactura}
        onSuccess={handleSaleSuccess}
        onRegistrarCobro={handleRegistrarCobro}
      />

      <ModalCobro
        isPaymentDialogOpen={cobroPostFactura.isPaymentDialogOpen} setIsPaymentDialogOpen={cobroPostFactura.setIsPaymentDialogOpen}
        selectedClient={cobroPostFactura.selectedClient}
        paymentData={cobroPostFactura.paymentData} setPaymentData={cobroPostFactura.setPaymentData}
        formasPago={cobroPostFactura.formasPago}
        tcParalelo={cobroPostFactura.tcParalelo}
        isProcessingPayment={cobroPostFactura.isProcessingPayment}
        handleRegisterPayment={cobroPostFactura.handleRegisterPayment}
        facturasAbiertas={cobroPostFactura.facturasAbiertas}
        imputaciones={cobroPostFactura.imputaciones} setImputaciones={cobroPostFactura.setImputaciones}
        imputacionesFX={cobroPostFactura.imputacionesFX} setImputacionesFX={cobroPostFactura.setImputacionesFX}
        autoDistribuirFIFO={cobroPostFactura.autoDistribuirFIFO}
      />
      <ReciboPago recibo={cobroPostFactura.lastRecibo} />
      <TipoCambioModal
        open={cobroPostFactura.showParaleloTCModal}
        onOpenChange={cobroPostFactura.setShowParaleloTCModal}
        moneda={cobroPostFactura.tcParalelo.monedaParalela}
        onConfirm={(t) => { cobroPostFactura.tcParalelo.setTC(t); cobroPostFactura.setShowParaleloTCModal(false); }}
      />
    </div>
  );
}

export default VentasSection;
