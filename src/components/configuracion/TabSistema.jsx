import { Info, CheckCircle2, Package2 } from 'lucide-react';

/**
 * Tab "Sistema" de ConfiguracionSection — solo lectura (info del sistema + placeholder
 * de datos demo). Extraído de ConfiguracionSection.jsx (Fase C auditoría de código).
 * Depende únicamente de `user`.
 */
const TabSistema = ({ user }) => (
  <div className="space-y-6 max-w-2xl">
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <h3 className="text-lg font-bold text-kx-text mb-4 flex items-center gap-2">
        <Info className="w-5 h-5 text-kx-text-3" />
        Información del Sistema
      </h3>
      <dl className="space-y-0">
        {[
          { label: 'Versión',      value: '1.4.0',                          mono: true  },
          { label: 'Empresa ID',   value: user?.empresa_id,                 mono: true, small: true },
          { label: 'Usuario',      value: user?.email,                      mono: false },
          { label: 'Base de datos',value: null,                             isStatus: true },
        ].map(({ label, value, mono, small, isStatus }) => (
          <div key={label} className="flex justify-between items-center py-3 border-b border-kx-border last:border-b-0">
            <dt className="text-sm text-kx-text-2">{label}</dt>
            <dd className={[
              mono ? 'font-mono' : '',
              small ? 'text-xs text-kx-text-3 break-all max-w-[260px] text-right' : 'text-sm text-kx-text',
            ].join(' ')}>
              {isStatus
                ? <span className="text-kx-green flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Conectada</span>
                : value}
            </dd>
          </div>
        ))}
      </dl>
    </div>

    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm opacity-60">
      <h3 className="font-semibold text-kx-text mb-2 flex items-center gap-2">
        <Package2 className="w-4 h-4 text-kx-text-3" />
        Datos de Demostración
        <span className="text-xs bg-kx-surface-2 text-kx-text-3 px-2 py-0.5 rounded-full border border-kx-border">Próximamente</span>
      </h3>
      <p className="text-sm text-kx-text-2">Cargar un conjunto de datos de prueba (clientes, productos, ventas) para explorar el sistema antes de usar datos reales.</p>
    </div>
  </div>
);

export default TabSistema;
