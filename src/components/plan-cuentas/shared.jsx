import { useState } from 'react';
import { ChevronRight, ChevronDown, Pencil, Power } from 'lucide-react';

export const TIPO_COLOR = {
  activo:     'bg-kx-blue/10 text-kx-blue border-kx-blue/30',
  pasivo:     'bg-kx-red/10 text-kx-red border-kx-red/30',
  patrimonio: 'bg-kx-violet/10 text-kx-violet border-kx-violet/30',
  ingreso:    'bg-kx-green/10 text-kx-green border-kx-green/30',
  egreso:     'bg-kx-amber/10 text-kx-amber border-kx-amber/30',
};

export const TIPO_LABEL = {
  activo: 'Activo', pasivo: 'Pasivo', patrimonio: 'Patrimonio',
  ingreso: 'Ingreso', egreso: 'Egreso',
};

export const ESTADO_COLOR = {
  borrador:   'bg-kx-amber/10 text-kx-amber border-kx-amber/30',
  confirmado: 'bg-kx-green/10 text-kx-green border-kx-green/30',
  anulado:    'bg-kx-red/10 text-kx-red border-kx-red/30',
};

export const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n ?? 0);

export function CuentaNode({ cuenta, depth = 0, onEdit, onToggleActiva, search }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = cuenta.hijos?.length > 0;
  const highlight = search && (
    cuenta.nombre.toLowerCase().includes(search.toLowerCase()) ||
    cuenta.codigo.includes(search)
  );

  if (search && !highlight && !cuenta.hijos?.some((h) => matchesSearch(h, search))) return null;

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors cursor-pointer group
          ${depth === 0 ? 'bg-kx-surface-2/60 mb-1' : 'hover:bg-kx-surface-2/40'}
          ${highlight ? 'ring-1 ring-[#00D4FF]/30' : ''}
        `}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        onClick={() => hasChildren && setOpen(!open)}
      >
        {hasChildren ? (
          open ? <ChevronDown size={14} className="text-kx-text-3 flex-shrink-0" /> : <ChevronRight size={14} className="text-kx-text-3 flex-shrink-0" />
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}

        <span className={`text-xs font-mono w-16 flex-shrink-0 ${depth === 0 ? 'text-kx-text-3' : 'text-kx-text-2'}`}>
          {cuenta.codigo}
        </span>

        <span className={`flex-1 text-sm ${depth === 0 ? 'font-semibold text-kx-text' : 'text-kx-text-3'} ${!cuenta.activa ? 'line-through opacity-50' : ''}`}>
          {cuenta.nombre}
        </span>

        {depth === 0 && (
          <span className={`text-2xs px-2 py-0.5 rounded-full border font-medium ${TIPO_COLOR[cuenta.tipo]}`}>
            {TIPO_LABEL[cuenta.tipo]}
          </span>
        )}

        {cuenta.permite_movimientos && cuenta.saldo_actual !== 0 && (
          <span className={`text-xs font-mono ${cuenta.saldo_actual >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
            {fmt(cuenta.saldo_actual)}
          </span>
        )}

        {onToggleActiva && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleActiva(cuenta); }}
            title={cuenta.activa ? 'Desactivar cuenta' : 'Activar cuenta'}
            className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-all ${cuenta.activa ? 'text-kx-text-3 hover:text-kx-text' : 'text-kx-green hover:opacity-80'}`}
          >
            <Power size={12} />
          </button>
        )}

        {cuenta.permite_movimientos && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(cuenta); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded text-kx-text-3 hover:text-kx-text transition-all"
          >
            <Pencil size={12} />
          </button>
        )}
      </div>

      {open && hasChildren && (
        <div className="overflow-hidden">
          {cuenta.hijos.map((h) => (
            <CuentaNode key={h.id} cuenta={h} depth={depth + 1} onEdit={onEdit} onToggleActiva={onToggleActiva} search={search} />
          ))}
        </div>
      )}
    </div>
  );
}

export function matchesSearch(cuenta, search) {
  if (!search) return true;
  const q = search.toLowerCase();
  if (cuenta.nombre.toLowerCase().includes(q) || cuenta.codigo.includes(q)) return true;
  return cuenta.hijos?.some((h) => matchesSearch(h, search));
}

export function csvDownload(filename, header, lines) {
  const csv = `${header}\n${lines.join('\n')}`;
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
