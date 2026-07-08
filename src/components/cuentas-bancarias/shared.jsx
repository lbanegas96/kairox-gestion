import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { parseCSVText } from '@/lib/csvUtils';

export const BANCOS_COMUNES = ['Ualá', 'Mercado Pago', 'Banco Galicia', 'Banco Santander', 'BBVA', 'HSBC', 'Banco Nación', 'Banco Provincia', 'Brubank', 'Naranja X', 'Otro'];

export function formatMoney(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n ?? 0);
}

export const ORIGEN_META = {
  mercadopago: { label: 'Mercado Pago', dot: '#009EE3', cls: 'text-[#0082c1] dark:text-[#4db8e8] border-[#009EE3]/30 bg-[#009EE3]/10' },
  uala:        { label: 'Ualá',         dot: '#7C3AED', cls: 'text-violet-600 dark:text-violet-400 border-violet-400/30 bg-violet-500/10' },
  manual:      { label: 'Manual',       dot: '#64748b', cls: 'text-slate-600 dark:text-slate-300 border-slate-400/30 bg-slate-500/10' },
  csv:         { label: 'Importado',    dot: '#d97706', cls: 'text-amber-600 dark:text-amber-400 border-amber-400/30 bg-amber-500/10' },
  email:       { label: 'Email',        dot: '#0ea5e9', dot2: true, cls: 'text-sky-600 dark:text-sky-400 border-sky-400/30 bg-sky-500/10' },
  webhook:     { label: 'Webhook',      dot: '#10b981', cls: 'text-emerald-600 dark:text-emerald-400 border-emerald-400/30 bg-emerald-500/10' },
};

export function origenMeta(origen) {
  return ORIGEN_META[origen] ?? { label: origen || '—', dot: '#94a3b8', cls: 'text-kx-text-3 border-kx-border bg-kx-surface-2' };
}

export function parseReferencia(m) {
  const mp = /^MP #(\d+)/.exec(m.descripcion || '');
  if (mp) return { chip: `MP #${mp[1]}`, value: mp[1], externa: true };
  return { chip: `#${(m.id || '').slice(0, 8)}`, value: m.id, externa: false };
}

export function limpiarDescripcion(desc) {
  return (desc || '').replace(/^MP #\d+\s*[—-]\s*/, '').trim();
}

export function ejecutorDe(m) {
  if (m.created_by_nombre) return { nombre: m.created_by_nombre, sistema: false };
  if (m.origen === 'mercadopago') return { nombre: 'Integración Mercado Pago', sistema: true };
  if (m.origen === 'uala')        return { nombre: 'Integración Ualá', sistema: true };
  if (m.origen === 'csv')         return { nombre: 'Importación CSV', sistema: true };
  if (m.origen === 'email' || m.origen === 'webhook') return { nombre: 'Sistema', sistema: true };
  return { nombre: '—', sistema: true };
}

export function RefChip({ mov }) {
  const [copied, setCopied] = useState(false);
  const ref = parseReferencia(mov);
  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(ref.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <button
      onClick={copy}
      title={`Copiar ${ref.externa ? 'ID de pago' : 'ID interno'}: ${ref.value}`}
      className="group inline-flex items-center gap-1 font-mono text-[11px] text-kx-text-3 hover:text-kx-text transition-colors"
    >
      <span className="tabular-nums">{ref.chip}</span>
      {copied
        ? <Check className="w-3 h-3 text-emerald-500" />
        : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
    </button>
  );
}

export function parseCSV(text) {
  return parseCSVText(text);
}
