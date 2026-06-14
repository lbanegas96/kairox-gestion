import React, { useState } from 'react';
import { Zap, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import NuevaVentaModal from '@/components/ventas/NuevaVentaModal';
import NuevaFacturaModal from '@/components/ventas/NuevaFacturaModal';
import CotizacionesSection from '@/components/sections/CotizacionesSection';
import PedidosSection from '@/components/sections/PedidosSection';
import EntregasSection from '@/components/ventas/EntregasSection';
import HistorialVentas from '@/components/ventas/HistorialVentas';
import DevolucionesSection from '@/components/ventas/DevolucionesSection';

function VentasSection({ initialTab = 'pedidos' }) {
  const [activeTab, setActiveTab]           = useState(initialTab);
  const [isNewSaleOpen, setIsNewSaleOpen]   = useState(false);
  const [showNuevaFactura, setShowNuevaFactura] = useState(false);
  const [refreshKey, setRefreshKey]         = useState(0);
  const [navigateSaleId, setNavigateSaleId] = useState(null);

  const handleSaleSuccess = () => setRefreshKey(k => k + 1);

  // Called from DevolucionesSection: (tipo, id)
  const handleChildNavigate = (tipo, id) => {
    if (tipo === 'comprobante') {
      setActiveTab('historial');
      setNavigateSaleId(id);
    }
  };

  // Called from DocumentFlowPanel chip clicks (section string)
  const handleDocFlowNavigate = (seccion) => {
    const map = { cotizaciones: 'cotizaciones', pedidos: 'pedidos', ventas: 'historial', historial: 'historial', devoluciones: 'devoluciones' };
    if (map[seccion]) setActiveTab(map[seccion]);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-kx-text">Ventas</h2>
          <p className="text-sm text-kx-text-2">Cotizaciones, Pedidos, Entregas e Historial</p>
        </div>
        <Button
          onClick={() => setIsNewSaleOpen(true)}
          className="bg-[rgb(var(--kx-violet))] hover:opacity-90 text-white gap-2 h-9 px-4 text-sm font-medium"
        >
          <Zap className="w-4 h-4" />
          Nueva Venta (POS)
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-transparent p-0 gap-1 flex justify-start border-b border-kx-border rounded-none h-auto pb-0">
          {[
            { value: 'cotizaciones', label: 'Cotizaciones' },
            { value: 'pedidos',      label: 'Pedidos'      },
            { value: 'entregas',     label: 'Entregas'     },
            { value: 'historial',    label: 'Facturas'     },
            { value: 'devoluciones', label: 'Devoluciones' },
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
          <CotizacionesSection />
        </TabsContent>

        <TabsContent value="pedidos" className="mt-4">
          <PedidosSection />
        </TabsContent>

        <TabsContent value="entregas" className="mt-4">
          <EntregasSection />
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
            onNavigate={handleDocFlowNavigate}
          />
        </TabsContent>

        <TabsContent value="devoluciones" className="mt-4">
          <DevolucionesSection onNavigate={handleChildNavigate} />
        </TabsContent>
      </Tabs>

      <NuevaVentaModal
        isOpen={isNewSaleOpen}
        onOpenChange={setIsNewSaleOpen}
        onSaleSuccess={handleSaleSuccess}
      />

      <NuevaFacturaModal
        open={showNuevaFactura}
        onOpenChange={setShowNuevaFactura}
        onSuccess={handleSaleSuccess}
      />
    </div>
  );
}

export default VentasSection;
