import { Badge } from '@/components/ui/badge';

const EstadoBadge = ({ estado }) => {
  const s = (estado || 'pendiente').toLowerCase();

  let className = "font-medium border shadow-none capitalize ";

  // Mapping based on requirements: PENDIENTE=yellow, PAGADO=green, CANCELADO=red
  if (s === 'pagada' || s === 'pagado') {
    className += "bg-green-100 text-green-800 border-green-200 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-900 dark:hover:bg-green-900/50";
  } else if (s === 'pendiente') {
    className += "bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-900 dark:hover:bg-yellow-900/50";
  } else if (s === 'cancelado' || s === 'cancelada') {
    className += "bg-red-100 text-red-800 border-red-200 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-900 dark:hover:bg-red-900/50";
  } else if (s === 'parcial') {
    className += "bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-900 dark:hover:bg-orange-900/50";
  } else {
    className += "bg-kx-surface-2 text-kx-text-2 border-kx-border hover:bg-kx-surface-2";
  }

  return (
    <Badge className={className} variant="outline">
      {estado || 'Desconocido'}
    </Badge>
  );
};

export default EstadoBadge;