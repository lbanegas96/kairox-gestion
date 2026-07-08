import { ShoppingCart, ClipboardList, ShoppingBag, Wallet, UserPlus, FileText } from 'lucide-react';
import { QuickActionButton } from './shared';

function AccionesRapidas({ onNavigate, canAccessSection }) {
  return (
    <div className="bg-kx-surface border border-kx-border rounded-2xl p-5 shadow-sm dark:shadow-none transition-all duration-200 ease-out hover:shadow-lg dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 hover:border-kx-border-hover">
      <div className="text-[13px] font-semibold text-kx-text mb-4">Acciones Rápidas</div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <QuickActionButton icon={ShoppingCart} label="Nueva Venta"
          onClick={() => onNavigate?.('pos')} gradient="from-blue-600 to-blue-500"
          disabled={!canAccessSection('ventas')} />
        <QuickActionButton icon={ClipboardList} label="Cotización"
          onClick={() => onNavigate?.('cotizaciones')} gradient="from-indigo-600 to-indigo-500"
          disabled={!canAccessSection('ventas')} />
        <QuickActionButton icon={ShoppingBag} label="Orden Compra"
          onClick={() => onNavigate?.('ordenes_compra')} gradient="from-violet-600 to-purple-500"
          disabled={!canAccessSection('compras')} />
        <QuickActionButton icon={Wallet} label="Caja"
          onClick={() => onNavigate?.('caja')} gradient="from-emerald-600 to-emerald-500"
          disabled={!canAccessSection('caja')} />
        <QuickActionButton icon={UserPlus} label="Cliente"
          onClick={() => onNavigate?.('clientes')} gradient="from-teal-600 to-teal-500"
          disabled={!canAccessSection('clientes')} />
        <QuickActionButton icon={FileText} label="Reportes"
          onClick={() => onNavigate?.('reportes')} gradient="from-amber-600 to-amber-500"
          disabled={!canAccessSection('reportes')} />
      </div>
    </div>
  );
}

export default AccionesRapidas;
