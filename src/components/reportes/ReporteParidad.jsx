import { TrendingUp, ArrowLeft, History, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import TabHistorico from '@/components/paridad/TabHistorico';
import TabPosicionActual from '@/components/paridad/TabPosicionActual';

/**
 * Reporte de Paridad ARS / Moneda Paralela — dos vistas que responden
 * preguntas distintas (estándar de mercado, ver TabHistorico/TabPosicionActual):
 *  - Histórico: a cuánto equivalía cada operación CUANDO pasó (transaction rate).
 *  - Posición Actual: cuánto valen los saldos ABIERTOS hoy (closing rate /
 *    revaluación — "Foreign Currency Revaluation" en SAP/NetSuite, RT FACPCE).
 *
 * Props:
 *   onBack — fn(): vuelve al grid de reportes
 */
function ReporteParidad({ onBack }) {
  const { monedaParalela } = useTCParalelo();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="dark:text-slate-300">
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-kx-blue" />
            Reporte de Paridad ARS / {monedaParalela}
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
            Histórico por operación y posición actual revaluada al TC de hoy
          </p>
        </div>
      </div>

      <Tabs defaultValue="historico">
        <TabsList className="bg-transparent p-0 gap-2 mb-4 flex justify-start">
          <TabsTrigger value="historico" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-kx-violet data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md px-4 py-2">
            <History className="w-4 h-4 mr-2" /> Histórico
          </TabsTrigger>
          <TabsTrigger value="posicion" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-kx-violet data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md px-4 py-2">
            <Scale className="w-4 h-4 mr-2" /> Posición Actual
          </TabsTrigger>
        </TabsList>

        <TabsContent value="historico">
          <TabHistorico />
        </TabsContent>

        <TabsContent value="posicion">
          <TabPosicionActual />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ReporteParidad;
