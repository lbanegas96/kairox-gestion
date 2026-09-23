import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { TIPOS_COMPROBANTE } from '@/lib/comprasLibro';

// Letra + Punto de Venta + Número del comprobante del proveedor, para una
// Compra Rápida "Libro". Mismos 3 datos que NuevaFacturaProveedorModal y
// ModalRegistrarFactura (Fase 0 del Libro IVA Digital). PV hasta 5 dígitos y
// número hasta 8, que es lo que emite ARCA: el TXT recorta por la izquierda si
// se pasan, así que mejor no dejar escribirlos.
function ComprobanteProveedorFields({ form, setForm, className = '' }) {
  const set = (campo, valor) => setForm({ ...form, [campo]: valor });
  return (
    <div className={`space-y-2 ${className}`}>
      <Label className="dark:text-kx-text">
        Comprobante del Proveedor <span className="text-red-600 dark:text-red-400">*</span>
      </Label>
      <div className="flex gap-2">
        <select
          value={form.tipo_comprobante_letra}
          onChange={e => set('tipo_comprobante_letra', e.target.value)}
          title="Tipo de comprobante"
          aria-label="Tipo de comprobante"
          className="h-10 w-16 rounded-md bg-kx-surface dark:bg-kx-surface border border-slate-300 dark:border-kx-border text-slate-900 dark:text-kx-text px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-kx-violet"
        >
          {TIPOS_COMPROBANTE.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <Input
          placeholder="PV (0001)"
          inputMode="numeric"
          maxLength={5}
          value={form.punto_venta_proveedor}
          onChange={e => set('punto_venta_proveedor', e.target.value.replace(/\D/g, ''))}
          title="Punto de venta"
          aria-label="Punto de venta"
          className="w-24 font-mono kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
        />
        <Input
          placeholder="Número (00012345)"
          inputMode="numeric"
          maxLength={8}
          value={form.numero_comprobante_proveedor}
          onChange={e => set('numero_comprobante_proveedor', e.target.value.replace(/\D/g, ''))}
          title="Número de comprobante"
          aria-label="Número de comprobante"
          className="flex-1 font-mono kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
        />
      </div>
    </div>
  );
}

export default ComprobanteProveedorFields;
