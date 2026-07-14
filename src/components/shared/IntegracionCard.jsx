import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ESTADO_STYLES = {
  activo:      'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
  inactivo:    'bg-kx-surface-2 text-kx-text-3 border-kx-border',
  proximamente:'bg-kx-surface-2 text-kx-text-3 border-kx-border',
  error:       'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
};

const ESTADO_LABELS = {
  activo:      'Activo',
  inactivo:    'Inactivo',
  proximamente:'Próximamente',
  error:       'Error',
};

function IntegracionCard({ nombre, descripcion, estado = 'proximamente', logo, onConfigure }) {
  const isProximamente = estado === 'proximamente';

  return (
    <div className={`kairox-bg-card border kairox-border p-5 rounded-xl shadow-sm flex flex-col gap-3 transition-opacity ${isProximamente ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none mt-0.5" role="img" aria-label={nombre}>{logo}</span>
        <div>
          <h4 className="font-semibold text-kx-text text-sm">{nombre}</h4>
          <span className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border mt-1 ${ESTADO_STYLES[estado] ?? ESTADO_STYLES.inactivo}`}>
            {ESTADO_LABELS[estado] ?? estado}
          </span>
        </div>
      </div>

      <p className="text-xs text-kx-text-2 leading-relaxed">{descripcion}</p>

      {!isProximamente && onConfigure && (
        <Button variant="outline" size="sm" className="mt-auto text-xs h-8 self-start" onClick={onConfigure}>
          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
          Configurar
        </Button>
      )}
    </div>
  );
}

export default IntegracionCard;
