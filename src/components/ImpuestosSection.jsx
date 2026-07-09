import { useState, useEffect } from 'react';
import { Receipt } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import TabIVA from '@/components/impuestos/TabIVA';
import TabAlicuotas from '@/components/impuestos/TabAlicuotas';
import TabRetenciones from '@/components/impuestos/TabRetenciones';
import TabIIBB from '@/components/impuestos/TabIIBB';

function ImpuestosSection({ onNavigate }) {
  const { user } = useAuth();
  // Impuestos avanzados (IIBB / Retenciones / Alícuotas) son opt-in por empresa
  // desde Configuración → Finanzas. IVA está SIEMPRE disponible. Si el flag está
  // apagado, esas solapas no se muestran (ni se pueden ejecutar sus acciones).
  const [impuestosAvanzados, setImpuestosAvanzados] = useState(false);

  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase
      .from('empresas')
      .select('usa_impuestos_avanzados')
      .eq('id', user.empresa_id)
      .single()
      .then(({ data }) => setImpuestosAvanzados(data?.usa_impuestos_avanzados ?? false));
  }, [user?.empresa_id]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Receipt className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-kx-text">Impuestos</h1>
          <p className="text-sm text-slate-500 dark:text-kx-text-2">
            {impuestosAvanzados
              ? 'IVA, IIBB, retenciones y alícuotas provinciales.'
              : 'Posición y alícuotas de IVA.'}
          </p>
        </div>
      </div>

      <Tabs defaultValue="iva" className="w-full">
        <TabsList>
          <TabsTrigger value="iva">IVA</TabsTrigger>
          {impuestosAvanzados && <TabsTrigger value="iibb">IIBB</TabsTrigger>}
          {impuestosAvanzados && <TabsTrigger value="retenciones">Retenciones y Percepciones</TabsTrigger>}
          {impuestosAvanzados && <TabsTrigger value="alicuotas">Alícuotas</TabsTrigger>}
        </TabsList>
        <TabsContent value="iva" className="mt-4">
          <TabIVA onNavigate={onNavigate} />
        </TabsContent>
        {impuestosAvanzados && (
          <>
            <TabsContent value="iibb" className="mt-4">
              <TabIIBB />
            </TabsContent>
            <TabsContent value="retenciones" className="mt-4">
              <TabRetenciones />
            </TabsContent>
            <TabsContent value="alicuotas" className="mt-4">
              <TabAlicuotas />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

export default ImpuestosSection;
