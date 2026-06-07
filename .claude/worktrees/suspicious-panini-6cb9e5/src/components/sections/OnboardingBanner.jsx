import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useConfig } from '@/contexts/ConfigContext';
import { dashboardExtrasService, DASHBOARD_KEYS } from '@/services/dashboardService';
import { useUserPermissions } from '@/hooks/useUserPermissions';

function OnboardingBanner({ onNavigate }) {
  const { user } = useAuth();
  const { config } = useConfig();
  const { isAdmin } = useUserPermissions();
  const empresaId = user?.empresa_id;

  const storageKey = `kairox_onboarding_done_${empresaId}`;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === '1');
  const [expanded, setExpanded] = useState(true);

  const { data: status } = useQuery({
    queryKey: DASHBOARD_KEYS.onboarding(empresaId),
    queryFn: () => dashboardExtrasService.checkOnboardingStatus(empresaId, user?.id),
    enabled: !!empresaId && !dismissed && isAdmin(),
    staleTime: 1000 * 60 * 2,
  });

  const empresaOk = !!(config?.nombre_empresa);
  const productosOk = status?.productos ?? false;
  const ventasOk = status?.ventas ?? false;
  const allDone = empresaOk && productosOk && ventasOk;

  // Auto-dismiss when all steps are done
  useEffect(() => {
    if (allDone && !dismissed) {
      localStorage.setItem(storageKey, '1');
      setDismissed(true);
    }
  }, [allDone, dismissed, storageKey]);

  const handleDismiss = () => {
    localStorage.setItem(storageKey, '1');
    setDismissed(true);
  };

  if (!isAdmin() || dismissed) return null;

  const steps = [
    {
      id: 'empresa',
      label: 'Configurar nombre de empresa',
      desc: 'Aparece en comprobantes y reportes',
      done: empresaOk,
      action: () => onNavigate?.('configuracion'),
      actionLabel: 'Configurar →',
    },
    {
      id: 'productos',
      label: 'Agregar al menos un producto',
      desc: 'Necesario para registrar ventas con stock',
      done: productosOk,
      action: () => onNavigate?.('productos'),
      actionLabel: 'Ir a Inventario →',
    },
    {
      id: 'ventas',
      label: 'Registrar la primera venta',
      desc: 'Desde el módulo Ventas o usando datos de ejemplo',
      done: ventasOk,
      action: () => onNavigate?.('ventas'),
      actionLabel: 'Nueva Venta →',
    },
    {
      id: 'arca',
      label: 'Integración ARCA/AFIP (próximamente)',
      desc: 'Facturación electrónica con CAE automático — Fase 1 en desarrollo',
      done: false,
      disabled: true,
    },
  ];

  const doneCnt = [empresaOk, productosOk, ventasOk].filter(Boolean).length;

  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 overflow-hidden mb-2">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
            <Rocket className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-blue-900 dark:text-blue-200">
              Primeros pasos — {doneCnt}/3 completados
            </p>
            <div className="flex items-center gap-1 mt-0.5">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className={`h-1.5 w-8 rounded-full transition-colors ${i < doneCnt ? 'bg-blue-500' : 'bg-blue-200 dark:bg-blue-700'}`}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-blue-500 hover:text-blue-700 dark:text-blue-400"
            onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-blue-400 hover:text-blue-700 dark:hover:text-blue-200"
            onClick={e => { e.stopPropagation(); handleDismiss(); }}
            title="Cerrar guía"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Steps */}
      {expanded && (
        <div className="border-t border-blue-200 dark:border-blue-800 divide-y divide-blue-100 dark:divide-blue-800/50">
          {steps.map(step => (
            <div
              key={step.id}
              className={`flex items-center gap-3 px-5 py-3 ${step.disabled ? 'opacity-50' : ''}`}
            >
              {step.done ? (
                <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
              ) : (
                <Circle className={`w-5 h-5 shrink-0 ${step.disabled ? 'text-slate-400' : 'text-blue-400 dark:text-blue-500'}`} />
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${step.done ? 'text-slate-500 dark:text-slate-400 line-through' : 'text-slate-800 dark:text-slate-200'}`}>
                  {step.label}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{step.desc}</p>
              </div>
              {!step.done && !step.disabled && step.action && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 whitespace-nowrap"
                  onClick={step.action}
                >
                  {step.actionLabel}
                </Button>
              )}
              {step.disabled && (
                <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">Próximamente</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default OnboardingBanner;
