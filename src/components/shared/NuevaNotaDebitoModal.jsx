import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, FileWarning, FilePlus } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import ClienteSelector from '@/components/shared/ClienteSelector';
import ProveedorSelector from '@/components/shared/ProveedorSelector';

function parseMontoAR(str) {
  if (!str) return 0;
  return parseFloat(String(str).trim().replace(/\./g, '').replace(',', '.')) || 0;
}

// Config por tipo — única fuente de las diferencias de negocio entre la ND
// emitida a un Cliente (con selector de factura relacionada opcional) y la ND
// recibida de un Proveedor (con origen bloqueado cuando viene de una Factura de Compra).
const CONFIG = {
  cliente: {
    icon: FileWarning,
    iconClass: 'text-amber-500',
    confirmClass: 'bg-amber-500 hover:bg-amber-600 text-white',
    entidadLabel: 'Cliente',
    entidadTabla: 'clientes',
    SelectorComponent: ClienteSelector,
    rpcTipo: 'emitida',
    rpcEntidadParam: 'p_cliente_id',
    rpcDocParam: 'p_comprobante_id',
    tituloDefault: 'Nueva Nota de Débito',
    descripcion: 'Cargo adicional al cliente — diferencia de precio, intereses, etc.',
    montoWarning: null,
  },
  proveedor: {
    icon: FilePlus,
    iconClass: 'text-kx-red',
    confirmClass: 'bg-red-500 hover:bg-red-600 text-white',
    entidadLabel: 'Proveedor',
    entidadTabla: 'proveedores',
    SelectorComponent: ProveedorSelector,
    rpcTipo: 'recibida',
    rpcEntidadParam: 'p_proveedor_id',
    rpcDocParam: 'p_compra_id',
    tituloDefault: 'Nueva ND de Proveedor',
    tituloOrigen: (docNumero) => `ND de Proveedor sobre ${docNumero}`,
    descripcion: 'El proveedor nos cobra un monto adicional — flete, diferencia de precio, etc.',
    montoWarning: 'Esta ND aumenta la deuda con el proveedor en Cuenta Corriente.',
  },
};

/**
 * NuevaNotaDebitoModal — registra una ND emitida (cliente) o recibida (proveedor)
 * vía la RPC compartida crear_nota_debito.
 * props:
 *   tipo:    'cliente' | 'proveedor'
 *   open, onOpenChange
 *   origen:  null | { entidadId, entidadNombre, docId, docNumero, docTotal, lockEntidad }
 *            - cliente: docNumero/docId son opcionales, preseleccionan la factura relacionada
 *              en el dropdown (no bloquean nada).
 *            - proveedor: si lockEntidad es true, el selector de proveedor se reemplaza por
 *              un display fijo (viene de "Copiar a ND" desde una Factura de Compra).
 *   onSuccess
 */
function NuevaNotaDebitoModal({ tipo, open, onOpenChange, origen = null, onSuccess }) {
  const cfg = CONFIG[tipo];
  const { user } = useAuth();
  const { toast } = useToast();

  const [entidades, setEntidades]         = useState([]);
  const [entidadId, setEntidadId]         = useState('');
  const [comprobantes, setComprobantes]   = useState([]);
  const [comprobanteId, setComprobanteId] = useState('');
  const [concepto, setConcepto]           = useState('');
  const [montoRaw, setMontoRaw]           = useState('');
  const [saving, setSaving]               = useState(false);

  const lockEntidad = tipo === 'proveedor' && !!origen?.lockEntidad;

  // ── Carga de entidades (clientes/proveedores) ───────────────────────────────
  useEffect(() => {
    if (!open || !user?.empresa_id || lockEntidad) return;
    supabase.from(cfg.entidadTabla).select('id, nombre')
      .eq('empresa_id', user.empresa_id).neq('activo', false).order('nombre')
      .then(({ data }) => setEntidades(data || []));
  }, [open, user?.empresa_id, tipo, lockEntidad]);

  // ── Preselección desde origen ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    if (origen?.entidadId) setEntidadId(origen.entidadId);
    if (origen?.docId)     setComprobanteId(origen.docId);
  }, [open, origen?.entidadId, origen?.docId]);

  // ── Cliente: cargar facturas del cliente seleccionado (solo tipo cliente) ───
  useEffect(() => {
    if (tipo !== 'cliente' || !entidadId || !user?.empresa_id) {
      if (tipo === 'cliente') { setComprobantes([]); setComprobanteId(prev => origen?.docId ? prev : ''); }
      return;
    }
    supabase.from('comprobantes').select('id, numero_venta, total')
      .eq('empresa_id', user.empresa_id).eq('cliente_id', entidadId).eq('tipo', 'venta')
      .order('fecha', { ascending: false }).limit(50)
      .then(({ data }) => setComprobantes(data || []));
  }, [tipo, entidadId, user?.empresa_id]);

  // ── Reset al cerrar ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setEntidadId('');
      setComprobanteId('');
      setConcepto('');
      setMontoRaw('');
      setComprobantes([]);
      setSaving(false);
    }
  }, [open]);

  const handleConfirmar = async () => {
    const monto = parseMontoAR(montoRaw);
    if (!entidadId)           { toast({ title: `Seleccioná un ${cfg.entidadLabel.toLowerCase()}`, variant: 'destructive' }); return; }
    if (!concepto.trim())     { toast({ title: 'Ingresá un concepto', variant: 'destructive' }); return; }
    if (!monto || monto <= 0) { toast({ title: 'Ingresá un monto válido', variant: 'destructive' }); return; }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('crear_nota_debito', {
        p_empresa_id: user.empresa_id,
        p_user_id:    user.id,
        p_tipo:       cfg.rpcTipo,
        p_concepto:   concepto.trim(),
        p_monto:      monto,
        [cfg.rpcEntidadParam]: entidadId,
        [cfg.rpcDocParam]:     comprobanteId || null,
      });
      if (error) throw error;

      const numeroNd = data?.numero_nd || 'ND';
      toast({ title: `Nota de Débito ${numeroNd} registrada` });
      onSuccess?.(data);
      onOpenChange(false);
    } catch (err) {
      toast({ title: err.message || 'Error al registrar la Nota de Débito', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const Icon = cfg.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-kx-surface border-kx-border text-kx-text dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-kx-text">
            <Icon className={`h-5 w-5 ${cfg.iconClass}`} />
            {origen?.docNumero && cfg.tituloOrigen ? cfg.tituloOrigen(origen.docNumero) : cfg.tituloDefault}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            {cfg.descripcion}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Entidad */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium dark:text-slate-300">{cfg.entidadLabel} *</Label>
            {lockEntidad ? (
              <div className="h-10 flex items-center px-3 rounded-md border border-kx-border bg-kx-surface-2 text-sm text-kx-text">
                {origen?.entidadNombre || cfg.entidadLabel}
              </div>
            ) : (
              <cfg.SelectorComponent
                {...(tipo === 'cliente' ? { clientes: entidades } : { proveedores: entidades })}
                value={entidadId}
                onChange={setEntidadId}
                {...(tipo === 'cliente'
                  ? { onClienteCreado: c => { setEntidades(p => [...p, c]); setEntidadId(c.id); } }
                  : { onProveedorCreado: p => { setEntidades(prev => [...prev, p]); setEntidadId(p.id); } })}
              />
            )}
          </div>

          {/* Documento relacionado */}
          {tipo === 'cliente' && entidadId && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium dark:text-slate-300">Factura relacionada (opcional)</Label>
              <select
                value={comprobanteId}
                onChange={e => setComprobanteId(e.target.value)}
                className="w-full h-9 rounded-md border border-kx-border bg-transparent px-3 text-sm dark:bg-kx-surface dark:text-kx-text focus:outline-none focus:ring-1 focus:ring-[rgb(var(--kx-violet))]"
              >
                <option value="">Sin factura asociada</option>
                {comprobantes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.numero_venta} — ${Number(c.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </option>
                ))}
              </select>
            </div>
          )}
          {tipo === 'proveedor' && origen && (
            <div className="p-2.5 rounded-lg bg-kx-surface-2 border border-kx-border text-xs text-kx-text-2">
              Factura origen: <span className="font-mono font-semibold text-kx-text">{origen.docNumero || 'S/N'}</span>
              {origen.docTotal != null && (
                <span className="ml-2 text-kx-text-3">
                  · ${Number(origen.docTotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </span>
              )}
            </div>
          )}

          {/* Concepto */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium dark:text-slate-300">Concepto *</Label>
            <Textarea
              placeholder={tipo === 'cliente'
                ? 'Diferencia de precio, intereses por mora, cargo adicional...'
                : 'Flete adicional, diferencia de precio, recargo, intereses...'}
              value={concepto}
              onChange={e => setConcepto(e.target.value)}
              className="resize-none h-16 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm"
            />
          </div>

          {/* Monto */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium dark:text-slate-300">Monto *</Label>
            <Input
              type="text" inputMode="decimal" placeholder="0,00"
              value={montoRaw}
              onChange={e => setMontoRaw(e.target.value)}
              className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text font-mono"
            />
            <p className="text-xs text-kx-text-3">Punto = separador de miles, coma = decimal (ej: 1.500,00)</p>
          </div>

          {cfg.montoWarning && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 text-xs text-red-700 dark:text-red-400">
              {cfg.montoWarning}
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex gap-3 w-full justify-between pt-2 border-t border-kx-border">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}
              className="dark:border-kx-border dark:text-slate-300">
              Cancelar
            </Button>
            <Button onClick={handleConfirmar} disabled={saving} className={`gap-2 ${cfg.confirmClass}`}>
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin" />Registrando...</>
                : <><Icon className="h-4 w-4" />Registrar ND</>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NuevaNotaDebitoModal;
