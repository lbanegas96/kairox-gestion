import { CheckCircle2, Timer, AlertTriangle } from 'lucide-react';
import { getNowAR } from '@/lib/dateUtils';

// Usa getNowAR() (hora Argentina calculada desde epoch, sin depender de la TZ
// del dispositivo) en vez de `new Date().getHours()` — si el navegador/SO del
// usuario tiene mal configurada la zona horaria, getHours() da la hora local
// del dispositivo y el saludo queda desincronizado de la hora real en AR.
//
// El rango horario tiene que arrancar en las 6 AM, no en medianoche: de 00:00
// a 05:59 sigue siendo de noche coloquialmente (nadie dice "buenos días" a la
// 1 AM), así que esas horas caen en "Buenas noches", no en "Buenos días".
export function saludoSegunHora() {
  const h = getNowAR().getUTCHours();
  if (h < 6)  return 'Buenas noches';
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export const fmt  = (n) => (n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });
export const fmtK = (n) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
  return `$${fmt(n)}`;
};

// DSO health thresholds (días en cobrar)
export const getDSOHealth = (dso) => {
  if (dso === null) return { color: 'text-kx-text-3', border: 'border-t-kx-border', label: 'Sin datos', icon: null };
  if (dso <= 30)   return { color: 'text-kx-green',  border: 'border-t-kx-green',  label: 'Saludable',   icon: <CheckCircle2 className="w-3.5 h-3.5" /> };
  if (dso <= 60)   return { color: 'text-kx-amber',  border: 'border-t-kx-amber',  label: 'Por mejorar', icon: <Timer className="w-3.5 h-3.5" /> };
  return             { color: 'text-kx-red',   border: 'border-t-kx-red',   label: 'Crítico',     icon: <AlertTriangle className="w-3.5 h-3.5" /> };
};

// ── Tooltip chart ─────────────────────────────────────────────────────────────
export const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-kx-surface border border-kx-border rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-kx-text-2 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">
          {p.name}: ${Number(p.value).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
        </p>
      ))}
    </div>
  );
};

// ── Skeleton de card ──────────────────────────────────────────────────────────
export const Skeleton = ({ className = '' }) => (
  <div className={`bg-kx-surface-2 rounded animate-pulse ${className}`} />
);

// ── QuickActionButton ─────────────────────────────────────────────────────────
export const QuickActionButton = ({ icon: Icon, label, onClick, gradient, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex flex-col items-center justify-center p-3 rounded-lg bg-gradient-to-br ${gradient} shadow-sm hover:shadow-md transition-all duration-200 group relative overflow-hidden hover:-translate-y-0.5 active:scale-95 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
  >
    <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors duration-200" />
    <div className="p-1.5 rounded-full bg-white/20 mb-1.5 group-hover:bg-white/30 transition-all relative z-10">
      <Icon className="h-3.5 w-3.5 text-white" />
    </div>
    <span className="text-[10.5px] font-semibold text-white relative z-10">{label}</span>
  </button>
);
