import React from 'react';
import { Receipt } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TabIVA from '@/components/impuestos/TabIVA';
import TabAlicuotas from '@/components/impuestos/TabAlicuotas';
import TabRetenciones from '@/components/impuestos/TabRetenciones';

function ImpuestosSection({ onNavigate }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Receipt className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-kx-text">Impuestos</h1>
          <p className="text-sm text-slate-500 dark:text-kx-text-2">IVA, retenciones y alícuotas provinciales.</p>
        </div>
      </div>

      <Tabs defaultValue="iva" className="w-full">
        <TabsList>
          <TabsTrigger value="iva">IVA</TabsTrigger>
          <TabsTrigger value="retenciones">Retenciones y Percepciones</TabsTrigger>
          <TabsTrigger value="alicuotas">Alícuotas</TabsTrigger>
        </TabsList>
        <TabsContent value="iva" className="mt-4">
          <TabIVA onNavigate={onNavigate} />
        </TabsContent>
        <TabsContent value="retenciones" className="mt-4">
          <TabRetenciones />
        </TabsContent>
        <TabsContent value="alicuotas" className="mt-4">
          <TabAlicuotas />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ImpuestosSection;
