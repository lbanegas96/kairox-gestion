import { useState } from 'react';
import { ShoppingCart, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import OrdenesCompraSection from '@/components/sections/OrdenesCompraSection';
import RecepcionesSection from '@/components/compras/RecepcionesSection';
import FacturasCompraSection from '@/components/compras/FacturasCompraSection';
import DevolucionesProveedorSection from '@/components/compras/DevolucionesProveedorSection';
import CompraRapidaSection from '@/components/sections/CompraRapidaSection';

const TABS = [
  { value: 'ordenes',      label: 'Órdenes de Compra' },
  { value: 'recepciones',  label: 'Recepciones' },
  { value: 'facturas',     label: 'Facturas' },
  { value: 'devoluciones', label: 'Devoluciones' },
];

function ComprasSection({ initialTab = 'ordenes' }) {
  const [activeTab, setActiveTab] = useState(
    initialTab === 'rapida' ? 'rapida' : initialTab
  );
  // Navegación cross-tab (12/09, mismo criterio que VentasSection): antes
  // ninguna sección de Compras recibía onNavigate, así que clickear "ver
  // detalle" de un nodo del Mapa de Relaciones (o un chip del Flujo del
  // Documento) cerraba todo sin ir a ningún lado (hallazgo Luciano: "no pasa
  // nada, se cierra todo").
  const [navigateOrdenId, setNavigateOrdenId]         = useState(null);
  const [navigateRecepcionId, setNavigateRecepcionId] = useState(null);
  const [navigateFacturaId, setNavigateFacturaId]     = useState(null);
  // "Registrar Factura del Proveedor" desde la Recepción (13/09, hallazgo
  // Luciano: "sigo sin manera") — navegar a la OC de origen YA no alcanza
  // sola (exige un segundo click adentro de la OC), así que este flag le
  // pide a OrdenesCompraSection que abra el form de factura apenas cargue
  // esa OC, en vez de solo dejarla abierta.
  const [autoFacturarOrdenId, setAutoFacturarOrdenId] = useState(null);

  // 13/09 — antes solo cambiaba de tab sin el id, así que el chip "Factura
  // origen" de Devoluciones/NC/ND nunca abría la factura puntual (quedaba en
  // la lista de Facturas sin nada seleccionado). Mismo criterio que
  // handleComprasNavigate.
  const handleDevolucionNavigate = (tipo, id) => {
    if (tipo !== 'factura_compra') return;
    setActiveTab('facturas');
    if (id) setNavigateFacturaId(id);
  };

  const handleComprasNavigate = (tipo, id) => {
    const SECCION = { orden_compra: 'ordenes', recepcion: 'recepciones', factura_compra: 'facturas' };
    const seccion = SECCION[tipo];
    if (!seccion) return;
    setActiveTab(seccion);
    if (!id) return;
    if (seccion === 'ordenes') setNavigateOrdenId(id);
    else if (seccion === 'recepciones') setNavigateRecepcionId(id);
    else if (seccion === 'facturas') setNavigateFacturaId(id);
  };

  const handleFacturarDesdeRecepcion = (ordenCompraId) => {
    if (!ordenCompraId) return;
    setActiveTab('ordenes');
    setNavigateOrdenId(ordenCompraId);
    setAutoFacturarOrdenId(ordenCompraId);
  };

  const tabClass = [
    'rounded-none rounded-t-sm px-4 py-2 text-sm border-b-2 transition-colors',
    'data-[state=active]:border-[rgb(var(--kx-violet))] data-[state=active]:text-kx-text data-[state=active]:font-semibold',
    'data-[state=inactive]:border-transparent data-[state=inactive]:text-kx-text-2',
    'data-[state=inactive]:hover:text-kx-text',
  ].join(' ');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-kx-text">Compras</h2>
          <p className="text-sm text-kx-text-2">Órdenes, Recepciones, Facturas y Devoluciones</p>
        </div>
        {activeTab !== 'rapida' && (
          <Button
            onClick={() => setActiveTab('rapida')}
            className="bg-[rgb(var(--kx-violet))] hover:opacity-90 text-white gap-2 h-9 px-4 text-sm font-medium"
          >
            <ShoppingCart className="w-4 h-4" />
            Compra Rápida
          </Button>
        )}
      </div>

      {/* Vista Compra Rápida */}
      {activeTab === 'rapida' ? (
        <div className="space-y-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveTab('facturas')}
            className="gap-1 text-kx-text-2 dark:border-kx-border dark:text-kx-text-2"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Volver a Compras
          </Button>
          <CompraRapidaSection />
        </div>
      ) : (
        /* Shell con tabs */
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-transparent p-0 gap-1 flex justify-start border-b border-kx-border rounded-none h-auto pb-0">
            {TABS.map(tab => (
              <TabsTrigger key={tab.value} value={tab.value} className={tabClass}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="ordenes" className="mt-4">
            <OrdenesCompraSection
              navigateOrdenId={navigateOrdenId}
              onNavigated={() => setNavigateOrdenId(null)}
              onNavigate={handleComprasNavigate}
              autoFacturarOrdenId={autoFacturarOrdenId}
              onAutoFacturarConsumed={() => setAutoFacturarOrdenId(null)}
            />
          </TabsContent>

          <TabsContent value="recepciones" className="mt-4">
            <RecepcionesSection
              navigateRecepcionId={navigateRecepcionId}
              onNavigated={() => setNavigateRecepcionId(null)}
              onNavigate={handleComprasNavigate}
              onFacturarOC={handleFacturarDesdeRecepcion}
            />
          </TabsContent>

          <TabsContent value="facturas" className="mt-4">
            <FacturasCompraSection
              navigateFacturaId={navigateFacturaId}
              onNavigated={() => setNavigateFacturaId(null)}
              onNavigate={handleComprasNavigate}
            />
          </TabsContent>

          <TabsContent value="devoluciones" className="mt-4">
            <DevolucionesProveedorSection onNavigate={handleDevolucionNavigate} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

export default ComprasSection;
