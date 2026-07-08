import { Badge } from '@/components/ui/badge';

const EstadoBadge = ({ estado }) => {
  const s = (estado || 'pendiente').toLowerCase();
  
  let className = "font-medium border shadow-none capitalize ";
  let style = {};
  
  // Mapping based on requirements: PENDIENTE=yellow, PAGADO=green, CANCELADO=red
  if (s === 'pagada' || s === 'pagado') {
    className += "bg-green-100 text-green-800 border-green-200 hover:bg-green-200";
    // Inline fallback
    style = { backgroundColor: '#dcfce7', color: '#166534', borderColor: '#bbf7d0' };
  } else if (s === 'pendiente') {
    className += "bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-200";
    style = { backgroundColor: '#fef9c3', color: '#854d0e', borderColor: '#fde047' };
  } else if (s === 'cancelado' || s === 'cancelada') {
    className += "bg-red-100 text-red-800 border-red-200 hover:bg-red-200";
    style = { backgroundColor: '#fee2e2', color: '#991b1b', borderColor: '#fecaca' };
  } else if (s === 'parcial') {
    className += "bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200";
    style = { backgroundColor: '#ffedd5', color: '#9a3412', borderColor: '#fed7aa' };
  } else {
    className += "bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-200";
  }

  return (
    <Badge className={className} style={style} variant="outline">
      {estado || 'Desconocido'}
    </Badge>
  );
};

export default EstadoBadge;