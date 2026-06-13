import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, X, ChevronRight, Zap } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const ACCIONES = [
  { id: 'empresa',  label: 'Datos de la empresa',      seccion: 'configuracion' },
  { id: 'producto', label: 'Primer producto cargado',   seccion: 'productos'     },
  { id: 'venta',    label: 'Primera venta registrada',  seccion: 'ventas'        },
  { id: 'cliente',  label: 'Primer cliente cargado',    seccion: 'clientes'      },
];

export function ChecklistOnboarding({ onNavigate }) {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user?.empresa_id) return;
    if (localStorage.getItem(`checklist_dismissed_${user.empresa_id}`) === 'true') {
      setDismissed(true);
    }
  }, [user?.empresa_id]);

  const { data: progreso } = useQuery({
    queryKey: ['onboarding_checklist', user?.empresa_id],
    queryFn: async () => {
      const [
        { data: emp },
        { count: prodCount },
        { count: ventaCount },
        { count: clienteCount },
      ] = await Promise.all([
        supabase
          .from('empresas')
          .select('rubro')
          .eq('id', user.empresa_id)
          .single(),
        supabase
          .from('productos')
          .select('id', { count: 'exact', head: true })
          .eq('empresa_id', user.empresa_id),
        supabase
          .from('comprobantes')
          .select('id', { count: 'exact', head: true })
          .eq('empresa_id', user.empresa_id),
        supabase
          .from('clientes')
          .select('id', { count: 'exact', head: true })
          .eq('empresa_id', user.empresa_id),
      ]);
      return {
        empresa:  !!emp?.rubro,
        producto: (prodCount ?? 0) > 0,
        venta:    (ventaCount ?? 0) > 0,
        cliente:  (clienteCount ?? 0) > 0,
      };
    },
    enabled: !!user?.empresa_id,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  if (!progreso || dismissed) return null;

  const completadas = Object.values(progreso).filter(Boolean).length;

  // Auto-ocultar cuando todo está completo
  if (completadas === 4) return null;

  const handleDismiss = () => {
    setDismissed(true);
    if (user?.empresa_id) {
      localStorage.setItem(`checklist_dismissed_${user.empresa_id}`, 'true');
    }
  };

  return (
    <div className="mb-6 bg-kx-surface dark:bg-kx-surface border border-blue-200 dark:border-blue-900/50 rounded-xl p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
      {/* Cabecera */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-kx-text dark:text-kx-text leading-tight">
              Configuración inicial
            </h3>
            <p className="text-xs text-slate-500 dark:text-kx-text-2">
              {completadas} de 4 pasos completados
            </p>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-kx-text-3 hover:text-kx-text-2 dark:hover:text-slate-200 transition-colors p-1 -mr-1 -mt-1 rounded"
          aria-label="Ocultar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Barra de progreso */}
      <div className="w-full bg-slate-100 dark:bg-kx-surface-2 rounded-full h-1.5 mb-3">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${(completadas / 4) * 100}%` }}
        />
      </div>

      {/* Lista de acciones */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {ACCIONES.map(accion => {
          const done = progreso[accion.id];
          return (
            <button
              key={accion.id}
              onClick={() => !done && onNavigate?.(accion.seccion)}
              disabled={done}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left transition-all
                ${done
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 cursor-default'
                  : 'bg-kx-surface-2 dark:bg-kx-surface-2 text-kx-text-2 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-700 dark:hover:text-blue-400 cursor-pointer'
                }`}
            >
              <span className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center transition-colors
                ${done ? 'bg-green-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                {done
                  ? <Check className="w-3 h-3 text-white" />
                  : <ChevronRight className="w-3 h-3 text-kx-text-3" />
                }
              </span>
              <span className={done ? 'line-through opacity-70' : ''}>{accion.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
