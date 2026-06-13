import React, { useState } from 'react';
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

  const handleDevolucionNavigate = (tipo) => {
    if (tipo === 'factura_compra') setActiveTab('facturas');
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
            <OrdenesCompraSection />
          </TabsContent>

          <TabsContent value="recepciones" className="mt-4">
            <RecepcionesSection />
          </TabsContent>

          <TabsContent value="facturas" className="mt-4">
            <FacturasCompraSection />
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
