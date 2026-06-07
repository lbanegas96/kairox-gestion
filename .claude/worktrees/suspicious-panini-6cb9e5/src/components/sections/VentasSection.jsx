import React, { useState } from 'react';
import { ShoppingCart, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import NuevaVentaModal from '@/components/ventas/NuevaVentaModal';
import HistorialVentas from '@/components/ventas/HistorialVentas';

function VentasSection() {
  const [isNewSaleOpen, setIsNewSaleOpen] = useState(false);
  
  // Just to force refresh history when sale completes
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSaleSuccess = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white dark:bg-transparent p-6 -mx-6 -mt-6 mb-6 border-b border-slate-200 dark:border-slate-800 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-1">Gestión de Ventas</h2>
          <p className="text-slate-500 dark:text-slate-400">Registra ventas, emite comprobantes y revisa tu historial.</p>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="w-full space-y-6">
        <TabsList className="bg-transparent p-0 gap-2 mb-4 w-full flex justify-start">
          <TabsTrigger value="dashboard" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white bg-slate-100 dark:bg-slate-800 dark:text-slate-400 rounded-md">
            <ShoppingCart className="w-4 h-4 mr-2"/> Nueva Venta
          </TabsTrigger>
          <TabsTrigger value="historial" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white bg-slate-100 dark:bg-slate-800 dark:text-slate-400 rounded-md">
            <Receipt className="w-4 h-4 mr-2"/> Historial de Ventas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-0">
          <div className="flex flex-col items-center justify-center py-16 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
             <div className="h-20 w-20 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-6">
                <ShoppingCart className="h-10 w-10 text-blue-600 dark:text-blue-400" />
             </div>
             <h3 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Punto de Venta</h3>
             <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-md text-center">
               Registrá una nueva venta, controlá stock y elegí la forma de pago.
             </p>
             <div className="flex gap-3">
               <Button
                 size="lg"
                 className="h-14 px-8 text-lg font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xl shadow-blue-900/20"
                 onClick={() => setIsNewSaleOpen(true)}
               >
                 <ShoppingCart className="mr-2 h-5 w-5" /> Iniciar Nueva Venta
               </Button>
             </div>
          </div>
        </TabsContent>

        <TabsContent value="historial">
           <HistorialVentas key={refreshKey} />
        </TabsContent>
      </Tabs>

      <NuevaVentaModal 
        isOpen={isNewSaleOpen} 
        onOpenChange={setIsNewSaleOpen} 
        onSaleSuccess={handleSaleSuccess}
      />
    </div>
  );
}

export default VentasSection;