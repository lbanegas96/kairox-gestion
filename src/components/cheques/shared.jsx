import { Clock, Eye, ArrowRightLeft } from 'lucide-react';
import { getTodayAR } from '@/lib/dateUtils';

export const BANCOS_AR = [
  'Banco Nación', 'Banco Provincia', 'Banco Galicia',
  'Banco Santander', 'BBVA', 'Banco ICBC', 'Banco Macro',
  'Banco Supervielle', 'Banco Patagonia', 'Banco Ciudad',
  'Banco Credicoop', 'Banco Hipotecario', 'Brubank',
];

export const TRANSICIONES_TERCERO = {
  en_cartera: ['depositado', 'endosado', 'descontado', 'rechazado'],
  depositado:  ['cobrado', 'rechazado'],
  endosado:    ['cobrado', 'rechazado'],
  descontado:  ['cobrado', 'rechazado'],
};

export const TRANSICIONES_PROPIO = {
  pendiente: ['entregado', 'rechazado'],
  entregado: ['cobrado', 'rechazado'],
};

export const ESTADO_LABELS = {
  pendiente:  'Pendiente',
  entregado:  'Entregado',
  en_cartera: 'En cartera',
  depositado: 'Depositado',
  endosado:   'Endosado',
  descontado: 'Descontado',
  cobrado:    'Cobrado',
  rechazado:  'Rechazado',
};

export const ESTADO_COLOR = {
  pendiente:  'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  entregado:  'bg-blue-500/10 text-blue-400 border-blue-500/30',
  en_cartera: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  depositado: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  endosado:   'bg-purple-500/10 text-purple-400 border-purple-500/30',
  descontado: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  cobrado:    'bg-green-500/10 text-green-400 border-green-500/30',
  rechazado:  'bg-red-500/10 text-red-400 border-red-500/30',
};

export const fmt = (n) =>
  `$ ${Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) => {
  if (!d) return '—';
  // Extrae solo la parte 'YYYY-MM-DD' — funciona igual con 'date' plano y con el
  // timestamptz de Postgres ('2026-06-09T18:48:42+00'), cuyo offset '+00' es
  // parcialmente rechazado por Date() según la versión de V8.
  const s = typeof d === 'string' ? d.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const parsed = new Date(s + 'T12:00:00');
  return isNaN(parsed) ? '—' : parsed.toLocaleDateString('es-AR');
};

export const addDays = (dateStr, days) =>
  new Date(new Date(dateStr + 'T00:00:00Z').getTime() + days * 86400000)
    .toISOString().split('T')[0];

export const emptyTerceroForm = () => ({
  numero: '', banco: '', monto: '',
  fecha_emision: getTodayAR(), fecha_vencimiento: '',
  cliente_id: '', comprobante_id: '', observaciones: '',
});

export const emptyPropioForm = () => ({
  numero: '', banco: '', cuenta_bancaria_id: '', monto: '',
  fecha_emision: getTodayAR(), fecha_vencimiento: '',
  proveedor_id: '', compra_id: '', observaciones: '',
});

export function EstadoBadge({ estado }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${ESTADO_COLOR[estado] ?? ''}`}>
      {ESTADO_LABELS[estado] ?? estado}
    </span>
  );
}

export function AccionesCheque({ cheque, onVerDetalle, onCambiarEstado }) {
  const opciones = cheque.tipo === 'tercero'
    ? TRANSICIONES_TERCERO[cheque.estado]
    : TRANSICIONES_PROPIO[cheque.estado];
  return (
    <div className="flex items-center justify-center gap-1">
      <button
        onClick={() => onVerDetalle(cheque)}
        className="px-2 py-1 text-xs rounded text-kx-text-3 hover:text-white hover:bg-kx-surface-2 border border-kx-border transition-colors flex items-center gap-1"
      >
        <Eye size={11} /> Ver
      </button>
      {opciones?.length > 0 && (
        <button
          onClick={() => onCambiarEstado(cheque)}
          className="px-2 py-1 text-xs rounded text-[#00D4FF] hover:text-white hover:bg-[#00D4FF]/10 border border-[#00D4FF]/30 transition-colors flex items-center gap-1"
        >
          <ArrowRightLeft size={11} /> Mover
        </button>
      )}
    </div>
  );
}

export function FechaVto({ fecha, estado }) {
  if (!fecha) return '—';
  const hoy = getTodayAR();
  const in7d = addDays(hoy, 7);
  const activo   = !['cobrado', 'rechazado'].includes(estado);
  const vencido  = activo && fecha < hoy;
  const proximo  = activo && !vencido && fecha <= in7d;
  return (
    <span className={`flex items-center gap-1 font-mono text-xs whitespace-nowrap
      ${vencido ? 'text-red-400' : proximo ? 'text-amber-400' : 'text-slate-300'}`}>
      {(vencido || proximo) && <Clock size={11} className="flex-shrink-0" />}
      {fmtDate(fecha)}
      {vencido && <span className="text-[10px] font-medium">(vencido)</span>}
      {proximo && <span className="text-[10px] font-medium">(&lt;7d)</span>}
    </span>
  );
}
