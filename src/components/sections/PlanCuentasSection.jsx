import React, { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, BookMarked, FileText, BarChart2, ListOrdered, Loader2,
  TrendingUp, Scale, Lock,
} from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { planCuentasService, PLAN_CUENTAS_KEYS } from '@/services/planCuentasService';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TabPlanCuentas from '@/components/plan-cuentas/TabPlanCuentas';
import TabAsientos from '@/components/plan-cuentas/TabAsientos';
import TabBalance from '@/components/plan-cuentas/TabBalance';
import TabEstadoResultados from '@/components/plan-cuentas/TabEstadoResultados';
import TabBalanceGeneral from '@/components/plan-cuentas/TabBalanceGeneral';
import TabLibroMayor from '@/components/plan-cuentas/TabLibroMayor';
import TabPeriodos from '@/components/plan-cuentas/TabPeriodos';

export default function PlanCuentasSection() {
  const { user } = useAuth();
  // OJO: NO usar user?.tenant_id como fallback — es un campo legacy que puede
  // contener un UUID viejo distinto de empresa_id. get_my_empresa_id() en la DB
  // siempre devuelve empresa_id, así que si pasamos tenant_id las RLS y los RPC
  // con validación de empresa van a rechazar la operación.
  const empresaId = user?.empresa_id;
  const userId    = user?.id;
  const userRole  = user?.role;
  const qc        = useQueryClient();

  const { data: cuentasFlat = [], isLoading } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.cuentas(empresaId),
    queryFn: () => planCuentasService.getCuentas(empresaId),
    enabled: !!empresaId,
    staleTime: 2 * 60 * 1000,
  });

  const tree = useMemo(() => planCuentasService.buildTree(cuentasFlat), [cuentasFlat]);

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ['plan_cuentas', empresaId] });
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <BookOpen size={18} className="text-white" />
            </div>
            Plan de Cuentas
          </h1>
          <p className="text-kx-text-3 text-sm mt-1">Contabilidad · Libro diario · Balance de comprobación</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-[#00D4FF]" />
        </div>
      ) : (
        <Tabs defaultValue="cuentas" className="space-y-4">
          <TabsList className="bg-slate-800 border border-slate-700 p-1">
            <TabsTrigger value="cuentas"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-kx-text-3 gap-2">
              <ListOrdered size={14} /> Plan de Cuentas
            </TabsTrigger>
            <TabsTrigger value="asientos"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-kx-text-3 gap-2">
              <FileText size={14} /> Asientos
            </TabsTrigger>
            <TabsTrigger value="balance"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-kx-text-3 gap-2">
              <BarChart2 size={14} /> Balance
            </TabsTrigger>
            <TabsTrigger value="resultados"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-kx-text-3 gap-2">
              <TrendingUp size={14} /> Estado de Resultados
            </TabsTrigger>
            <TabsTrigger value="balance_general"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-kx-text-3 gap-2">
              <Scale size={14} /> Balance General
            </TabsTrigger>
            <TabsTrigger value="libro_mayor"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-kx-text-3 gap-2">
              <BookMarked size={14} /> Libro Mayor
            </TabsTrigger>
            <TabsTrigger value="periodos"
              className="data-[state=active]:bg-[#00D4FF] data-[state=active]:text-black text-kx-text-3 gap-2">
              <Lock size={14} /> Períodos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cuentas">
            <TabPlanCuentas
              cuentasFlat={cuentasFlat}
              tree={tree}
              empresaId={empresaId}
              onRefresh={handleRefresh}
            />
          </TabsContent>

          <TabsContent value="asientos">
            <TabAsientos
              empresaId={empresaId}
              userId={userId}
              cuentasFlat={cuentasFlat}
              onRefresh={handleRefresh}
            />
          </TabsContent>

          <TabsContent value="balance">
            <TabBalance empresaId={empresaId} />
          </TabsContent>

          <TabsContent value="resultados">
            <TabEstadoResultados empresaId={empresaId} />
          </TabsContent>

          <TabsContent value="balance_general">
            <TabBalanceGeneral empresaId={empresaId} />
          </TabsContent>

          <TabsContent value="libro_mayor">
            <TabLibroMayor empresaId={empresaId} cuentasFlat={cuentasFlat} />
          </TabsContent>

          <TabsContent value="periodos">
            <TabPeriodos empresaId={empresaId} userId={userId} userRole={userRole} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
