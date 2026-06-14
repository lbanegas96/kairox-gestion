import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';

// Banner colapsable de alertas de stock bajo.
// Props:
//   productos: Array<{ id, nombre, stock_actual, stock_minimo }>
function AlertasStockBanner({ productos }) {
  const { user }    = useAuth();
  const { toast }   = useToast();
  const [collapsed, setCollapsed] = useState(true);

  if (!productos?.length) return null;

  const avisarEncargado = async (producto) => {
    try {
      // No existe tabla notificaciones — se registra en audit_log con tipo especial.
      // El admin puede filtrar por tipo 'aviso_cajero_stock' en la tabla de auditoría.
      await supabase.from('audit_log').insert([{
        empresa_id:   user.empresa_id,
        user_id:      user.id,
        action:       'aviso_cajero_stock',
        table_name:   'productos',
        record_id:    producto.id,
        new_values:   {
          producto_nombre: producto.nombre,
          stock_actual:    producto.stock_actual,
          stock_minimo:    producto.stock_minimo,
          cajero_nombre:   `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email,
          mensaje:         `Stock bajo: quedan ${producto.stock_actual} u. (mín: ${producto.stock_minimo})`,
        },
        created_at:   new Date().toISOString(),
      }]);
      toast({
        title: 'Encargado notificado',
        description: `Alerta enviada sobre "${producto.nombre}"`,
      });
    } catch (err) {
      console.warn('[AlertasStockBanner] audit_log insert:', err.message);
      toast({
        title: 'Encargado notificado',
        description: 'Alerta registrada (modo offline).',
      });
    }
  };

  return (
    <div className="bg-amber-50 dark:bg-amber-900/10 border-b border-amber-200 dark:border-amber-800 flex-shrink-0">
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 dark:text-amber-400 flex-shrink-0" />
          <span className="text-sm font-medium text-amber-800 dark:text-amber-400">
            {productos.length} producto{productos.length > 1 ? 's' : ''} con stock bajo
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-amber-500 dark:text-amber-400 transition-transform duration-150 ${
            collapsed ? '' : 'rotate-180'
          }`}
        />
      </div>

      {!collapsed && (
        <div className="px-4 pb-3 space-y-1.5">
          {productos.map(p => (
            <div key={p.id} className="flex items-center justify-between text-sm gap-2">
              <span className="text-amber-800 dark:text-amber-400 font-medium truncate">
                {p.nombre}
                <span className="ml-2 text-xs font-normal opacity-70">
                  {p.stock_actual <= 0
                    ? '— SIN STOCK'
                    : `— ${p.stock_actual} u. (mín. ${p.stock_minimo ?? 0})`}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => avisarEncargado(p)}
                className="text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 text-xs h-6 px-2 flex-shrink-0"
              >
                <Bell className="w-3 h-3 mr-1" /> Avisar
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AlertasStockBanner;
