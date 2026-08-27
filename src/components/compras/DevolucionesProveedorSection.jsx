import React, { useState, useEffect } from 'react';
import { RotateCcw, FileWarning, FileMinus, ChevronDown, ChevronRight, Package, Ban, Loader2, Copy } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatDateAR } from '@/lib/dateUtils';
import { useToast } from '@/components/ui/use-toast';
import ConfirmDuplicarDialog from '@/components/shared/ConfirmDuplicarDialog';
import NuevaNCProveedorModal from './NuevaNCProveedorModal';
import NuevaNotaDebitoModal from '@/components/shared/NuevaNotaDebitoModal';

// Fase 4 (15/08): desglose Neto/IVA en el panel expandido de Devoluciones a
// Proveedor — mismo criterio que el resto de Compras (siempre visible, sin
// gating por letra). alicuota_iva es snapshot por ítem (mig.262).
const FACTOR_IVA = { '21': 1.21, '10.5': 1.105 };
const ALICUOTA_LABEL = { '21': '21%', '10.5': '10,5%', '0': '0%', exento: 'Exento', no_gravado: 'No gravado' };

function EstadoDocBadge({ estado }) {
  if (estado === 'cancelada') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-semibold bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-kx-text-2">
        Cancelada
      </span>
    );
  }
  return null;
}

const COMPENSACION_LABELS = {
  // mig.360 — 'nota_credito' faltaba acá aunque compensacion.CHECK ya lo
  // admite (mig.035) y es el único valor que de verdad se usa: aunque el
  // backend seteara compensacion='nota_credito' bien, esta pantalla lo caía
  // igual en "Sin definir" por no reconocer la clave. 'nota_debito' se deja
  // (no rompe nada) aunque compensacion no admite ese valor — no es un caso
  // real de esta tabla.
  nota_credito: { label: 'Nota de Crédito', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  nota_debito: { label: 'Nota de Débito', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  reemplazo:   { label: 'Reemplazo',      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  pendiente:   { label: 'Sin definir',    className: 'bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-kx-text-2' },
};

function CompensacionBadge({ comp }) {
  const cfg = COMPENSACION_LABELS[comp] || COMPENSACION_LABELS.pendiente;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>{cfg.label}</span>;
}

function DevolucionesTab({ onNavigate }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [devoluciones, setDevoluciones] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [expanded, setExpanded]         = useState({});
  // mig.360 — "Generar NC" desde una devolución puntual.
  const [ncOrigen, setNcOrigen]         = useState(null);
  const [isNcOpen, setIsNcOpen]         = useState(false);

  const fetchDevoluciones = () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    supabase
      .from('devoluciones')
      .select(`
        id, numero_devolucion, fecha, tipo, reingresa_stock, compensacion, motivo,
        compra_id, proveedor_id,
        proveedores(nombre),
        factura_compra:compras!compra_id(numero_factura),
        devolucion_items(id, cantidad, precio_unitario, subtotal, alicuota_iva, productos(nombre))
      `)
      .eq('empresa_id', user.empresa_id)
      .eq('tipo', 'proveedor')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast({ title: 'Error al cargar devoluciones', description: error.message, variant: 'destructive' });
        setDevoluciones(data || []);
        setLoading(false);
      });
  };

  useEffect(fetchDevoluciones, [user?.empresa_id]);

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const abrirNc = (dev) => {
    setNcOrigen({
      id:               dev.id,
      numero_devolucion: dev.numero_devolucion,
      proveedor_id:     dev.proveedor_id,
      proveedor_nombre: dev.proveedores?.nombre,
      compra_id:        dev.compra_id,
    });
    setIsNcOpen(true);
  };

  return (
    <Card className="overflow-hidden bg-kx-surface border-kx-border">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-kx-surface-2 border-b border-kx-border">
            <tr>
              <th className="text-left p-3 font-semibold text-kx-text-2 w-8"></th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Número</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Fecha</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Proveedor</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Factura origen</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Compensación</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Stock</th>
              <th className="text-center p-3 font-semibold text-kx-text-2">Ítems</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-kx-border">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="p-3">
                      <div className="h-4 bg-kx-surface-2 rounded animate-pulse w-16" />
                    </td>
                  ))}
                </tr>
              ))
            ) : devoluciones.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-12 text-center text-kx-text-3">
                  <RotateCcw className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="font-medium text-kx-text-2">No hay devoluciones a proveedores</p>
                </td>
              </tr>
            ) : (
              devoluciones.map(dev => {
                const items  = dev.devolucion_items || [];
                const isOpen = !!expanded[dev.id];
                const total  = items.reduce((s, i) => s + Number(i.subtotal || 0), 0);
                const neto   = items.reduce((s, i) => {
                  const factor = FACTOR_IVA[String(i.alicuota_iva)] ?? 1;
                  return s + Number(i.subtotal || 0) / factor;
                }, 0);
                const iva = total - neto;
                return (
                  <React.Fragment key={dev.id}>
                    <tr
                      className="hover:bg-kx-surface-2 cursor-pointer transition-colors"
                      onClick={() => toggleExpand(dev.id)}
                    >
                      <td className="p-3 text-kx-text-3">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </td>
                      <td className="p-3 font-mono font-semibold text-[rgb(var(--kx-violet))]">
                        {dev.numero_devolucion}
                      </td>
                      <td className="p-3 text-kx-text-2 text-xs">{formatDateAR(dev.fecha)}</td>
                      <td className="p-3 text-kx-text">{dev.proveedores?.nombre || '—'}</td>
                      <td className="p-3 font-mono text-xs text-kx-text-2">
                        {dev.compra_id && onNavigate ? (
                          <button
                            className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            onClick={e => { e.stopPropagation(); onNavigate('factura_compra', dev.compra_id); }}
                          >
                            {dev.factura_compra?.numero_factura || 'Ver →'}
                          </button>
                        ) : (
                          dev.factura_compra?.numero_factura || '—'
                        )}
                      </td>
                      <td className="p-3"><CompensacionBadge comp={dev.compensacion} /></td>
                      <td className="p-3 text-xs text-kx-text-2">
                        {dev.reingresa_stock ? 'Egresó stock' : 'Sin movimiento'}
                      </td>
                      <td className="p-3 text-center text-kx-text-2">{items.length}</td>
                    </tr>

                    {isOpen && items.length > 0 && (
                      <tr>
                        <td />
                        <td colSpan={7} className="pb-3 pr-3">
                          <div className="bg-kx-surface-2 rounded-lg border border-kx-border p-3">
                            <p className="text-xs font-semibold text-kx-text-3 uppercase mb-2">Ítems devueltos</p>
                            <div className="space-y-1">
                              {items.map(item => (
                                <div key={item.id} className="flex items-center justify-between text-sm">
                                  <div className="flex items-center gap-2 text-kx-text">
                                    <Package className="h-3.5 w-3.5 text-kx-text-3 shrink-0" />
                                    {item.productos?.nombre || '—'}
                                    <span className="text-2xs text-kx-text-3">
                                      ({ALICUOTA_LABEL[item.alicuota_iva] || item.alicuota_iva || '21%'})
                                    </span>
                                  </div>
                                  <span className="font-mono text-kx-text-2 text-xs">
                                    × {Number(item.cantidad).toLocaleString('es-AR')} · ${Number(item.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {iva > 0.005 && (
                              <div className="flex justify-end gap-4 text-xs text-kx-text-2 mt-2 pt-2 border-t border-kx-border">
                                <span>Neto: ${neto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                <span>IVA: ${iva.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                <span className="font-semibold text-kx-text">Total: ${total.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </div>
                            )}
                            {dev.motivo && (
                              <p className="text-xs text-kx-text-3 mt-2 pt-2 border-t border-kx-border">
                                Motivo: {dev.motivo}
                              </p>
                            )}
                            {/* mig.360 — antes el único puente a una NC era
                                texto libre en el motivo, sin FK ni forma de
                                generarla desde acá. */}
                            {dev.compensacion === 'pendiente' && (
                              <div className="flex justify-end mt-2 pt-2 border-t border-kx-border">
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-7 text-2xs text-kx-violet hover:bg-violet-50 dark:hover:bg-violet-900/20 gap-1"
                                  onClick={e => { e.stopPropagation(); abrirNc(dev); }}
                                >
                                  <FileMinus className="h-3 w-3" /> Generar NC
                                </Button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <NuevaNCProveedorModal
        open={isNcOpen}
        onOpenChange={setIsNcOpen}
        devolucionOrigen={ncOrigen}
        onSuccess={() => { setIsNcOpen(false); setNcOrigen(null); fetchDevoluciones(); }}
      />
    </Card>
  );
}

function NotasDebitoRecibidas() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notas, setNotas]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState(null); // { id, numero_nd }
  const [motivo, setMotivo]       = useState('');
  const [cancelando, setCancelando] = useState(false);
  const [duplicarTarget, setDuplicarTarget] = useState(null);
  const [duplicarVincular, setDuplicarVincular] = useState(false);
  const [isDuplicarOpen, setIsDuplicarOpen] = useState(false);

  const fetchNotas = () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    supabase
      .from('notas_debito')
      .select('id, numero_nd, fecha, concepto, monto, neto_gravado, iva_discriminado, tipo, estado, proveedor_id, proveedores(nombre)')
      .eq('empresa_id', user.empresa_id)
      .eq('tipo', 'recibida')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast({ title: 'Error al cargar notas de débito', description: error.message, variant: 'destructive' });
        setNotas(data || []);
        setLoading(false);
      });
  };

  useEffect(fetchNotas, [user?.empresa_id]);

  const handleCancelar = async () => {
    if (!cancelTarget) return;
    setCancelando(true);
    try {
      const { error } = await supabase.rpc('cancelar_nota_debito_proveedor', {
        p_empresa_id: user.empresa_id,
        p_user_id: user.id,
        p_nd_id: cancelTarget.id,
        p_motivo: motivo.trim() || null,
      });
      if (error) throw error;
      toast({ title: `ND ${cancelTarget.numero_nd} cancelada`, description: 'Se revirtió la deuda en cuenta corriente.' });
      setCancelTarget(null);
      setMotivo('');
      fetchNotas();
    } catch (err) {
      toast({ title: 'No se pudo cancelar la ND', description: err.message, variant: 'destructive' });
    } finally {
      setCancelando(false);
    }
  };

  return (
    <Card className="overflow-hidden bg-kx-surface border-kx-border">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-kx-surface-2 border-b border-kx-border">
            <tr>
              <th className="text-left p-3 font-semibold text-kx-text-2">Número</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Fecha</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Proveedor</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Concepto</th>
              <th className="text-right p-3 font-semibold text-kx-text-2">Neto</th>
              <th className="text-right p-3 font-semibold text-kx-text-2">IVA</th>
              <th className="text-right p-3 font-semibold text-kx-text-2">Monto</th>
              <th className="text-right p-3 font-semibold text-kx-text-2">Acc.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-kx-border">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="p-3">
                      <div className="h-4 bg-kx-surface-2 rounded animate-pulse w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : notas.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-12 text-center text-kx-text-3">
                  <FileWarning className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="font-medium text-kx-text-2">Sin notas de débito recibidas</p>
                </td>
              </tr>
            ) : (
              notas.map(nd => (
                <tr key={nd.id} className="hover:bg-kx-surface-2 transition-colors">
                  <td className="p-3 font-mono text-xs font-semibold text-[rgb(var(--kx-violet))]">
                    <div className="flex items-center gap-1.5">
                      {nd.numero_nd}
                      <EstadoDocBadge estado={nd.estado} />
                    </div>
                  </td>
                  <td className="p-3 text-kx-text-2 text-xs">{formatDateAR(nd.fecha)}</td>
                  <td className="p-3 text-kx-text">{nd.proveedores?.nombre || '—'}</td>
                  <td className="p-3 text-kx-text-2 max-w-xs truncate">{nd.concepto}</td>
                  <td className="p-3 text-right text-xs text-kx-text-2 tabular-nums">
                    {nd.neto_gravado != null ? `$${Number(nd.neto_gravado).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td className="p-3 text-right text-xs text-kx-text-2 tabular-nums">
                    {nd.iva_discriminado != null ? `$${Number(nd.iva_discriminado).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td className="p-3 text-right font-mono font-bold text-kx-text">
                    ${Number(nd.monto).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm" variant="ghost"
                        className="h-6 text-2xs text-kx-violet hover:bg-violet-50 dark:hover:bg-violet-900/20 gap-1"
                        onClick={() => setDuplicarTarget(nd)}
                      >
                        <Copy className="h-3 w-3" /> Duplicar
                      </Button>
                      {nd.estado !== 'cancelada' && (
                        <Button
                          size="sm" variant="ghost"
                          className="h-6 text-2xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 gap-1"
                          onClick={() => setCancelTarget({ id: nd.id, numero_nd: nd.numero_nd })}
                        >
                          <Ban className="h-3 w-3" /> Cancelar
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AlertDialog open={!!cancelTarget} onOpenChange={v => { if (!cancelando && !v) { setCancelTarget(null); setMotivo(''); } }}>
        <AlertDialogContent className="dark:bg-kx-bg dark:border-kx-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="dark:text-kx-text">¿Cancelar ND {cancelTarget?.numero_nd}?</AlertDialogTitle>
            <AlertDialogDescription className="dark:text-kx-text-2">
              Se revierte la deuda que generó en Cuenta Corriente del proveedor. Queda un registro completo de la reversión — nada se borra. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            placeholder="Motivo (opcional) — ej. error de carga..."
            className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            rows={2}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelando} className="dark:text-kx-text dark:border-kx-border">Volver</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelar} disabled={cancelando} className="bg-red-600 hover:bg-red-700 text-white">
              {cancelando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Ban className="h-4 w-4 mr-2" />}
              Sí, cancelar ND
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDuplicarDialog
        open={!!duplicarTarget}
        onOpenChange={(v) => !v && setDuplicarTarget(null)}
        tipoLabel="Nota de Débito"
        numero={duplicarTarget?.numero_nd}
        onConfirm={(vincular) => { setDuplicarVincular(vincular); setIsDuplicarOpen(true); }}
      />
      <NuevaNotaDebitoModal
        open={isDuplicarOpen}
        onOpenChange={v => { setIsDuplicarOpen(v); if (!v) setDuplicarTarget(null); }}
        duplicarOrigen={duplicarTarget ? { id: duplicarTarget.id, entidadId: duplicarTarget.proveedor_id } : null}
        duplicadoDeId={duplicarVincular ? (duplicarTarget?.id ?? null) : null}
        onSuccess={() => { setIsDuplicarOpen(false); setDuplicarTarget(null); fetchNotas(); }}
      />
    </Card>
  );
}

function NotasCreditoRecibidas() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notas, setNotas]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState(null); // { id, numero_ncp, reembolso_efectivo }
  const [motivo, setMotivo]       = useState('');
  const [cancelando, setCancelando] = useState(false);
  const [duplicarTarget, setDuplicarTarget] = useState(null);
  const [duplicarVincular, setDuplicarVincular] = useState(false);
  const [isDuplicarOpen, setIsDuplicarOpen] = useState(false);

  const fetchNotas = () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    supabase
      .from('notas_credito_proveedor')
      .select('id, numero_ncp, fecha, motivo, monto, neto_gravado, iva_discriminado, reembolso_efectivo, estado, proveedor_id, proveedores(nombre)')
      .eq('empresa_id', user.empresa_id)
      .order('fecha', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast({ title: 'Error al cargar notas de crédito', description: error.message, variant: 'destructive' });
        setNotas(data || []);
        setLoading(false);
      });
  };

  useEffect(fetchNotas, [user?.empresa_id]);

  const handleCancelar = async () => {
    if (!cancelTarget) return;
    setCancelando(true);
    try {
      const { error } = await supabase.rpc('cancelar_nota_credito_proveedor', {
        p_empresa_id: user.empresa_id,
        p_user_id: user.id,
        p_ncp_id: cancelTarget.id,
        p_motivo: motivo.trim() || null,
      });
      if (error) throw error;
      toast({ title: `NC ${cancelTarget.numero_ncp} cancelada`, description: 'Se revirtió el crédito en cuenta corriente.' });
      setCancelTarget(null);
      setMotivo('');
      fetchNotas();
    } catch (err) {
      toast({ title: 'No se pudo cancelar la NC', description: err.message, variant: 'destructive' });
    } finally {
      setCancelando(false);
    }
  };

  return (
    <Card className="overflow-hidden bg-kx-surface border-kx-border">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-kx-surface-2 border-b border-kx-border">
            <tr>
              <th className="text-left p-3 font-semibold text-kx-text-2">Número</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Fecha</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Proveedor</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Motivo</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Cobro</th>
              <th className="text-right p-3 font-semibold text-kx-text-2">Neto</th>
              <th className="text-right p-3 font-semibold text-kx-text-2">IVA</th>
              <th className="text-right p-3 font-semibold text-kx-text-2">Monto</th>
              <th className="text-right p-3 font-semibold text-kx-text-2">Acc.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-kx-border">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="p-3">
                      <div className="h-4 bg-kx-surface-2 rounded animate-pulse w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : notas.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-12 text-center text-kx-text-3">
                  <FileMinus className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="font-medium text-kx-text-2">Sin notas de crédito recibidas</p>
                </td>
              </tr>
            ) : (
              notas.map(nc => (
                <tr key={nc.id} className="hover:bg-kx-surface-2 transition-colors">
                  <td className="p-3 font-mono text-xs font-semibold text-[rgb(var(--kx-violet))]">
                    <div className="flex items-center gap-1.5">
                      {nc.numero_ncp}
                      <EstadoDocBadge estado={nc.estado} />
                    </div>
                  </td>
                  <td className="p-3 text-kx-text-2 text-xs">{formatDateAR(nc.fecha)}</td>
                  <td className="p-3 text-kx-text">{nc.proveedores?.nombre || '—'}</td>
                  <td className="p-3 text-kx-text-2 max-w-xs truncate">{nc.motivo}</td>
                  <td className="p-3 text-xs text-kx-text-2">{nc.reembolso_efectivo ? 'Efectivo' : 'Cta. Cte.'}</td>
                  <td className="p-3 text-right text-xs text-kx-text-2 tabular-nums">
                    {nc.neto_gravado != null ? `$${Number(nc.neto_gravado).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td className="p-3 text-right text-xs text-kx-text-2 tabular-nums">
                    {nc.iva_discriminado != null ? `$${Number(nc.iva_discriminado).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td className="p-3 text-right font-mono font-bold text-kx-text">
                    ${Number(nc.monto).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm" variant="ghost"
                        className="h-6 text-2xs text-kx-violet hover:bg-violet-50 dark:hover:bg-violet-900/20 gap-1"
                        onClick={() => setDuplicarTarget(nc)}
                      >
                        <Copy className="h-3 w-3" /> Duplicar
                      </Button>
                      {nc.estado !== 'cancelada' && !nc.reembolso_efectivo && (
                        <Button
                          size="sm" variant="ghost"
                          className="h-6 text-2xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 gap-1"
                          onClick={() => setCancelTarget({ id: nc.id, numero_ncp: nc.numero_ncp })}
                        >
                          <Ban className="h-3 w-3" /> Cancelar
                        </Button>
                      )}
                      {nc.estado !== 'cancelada' && nc.reembolso_efectivo && (
                        <span className="text-2xs text-kx-text-3 italic">Cobrada en efectivo</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AlertDialog open={!!cancelTarget} onOpenChange={v => { if (!cancelando && !v) { setCancelTarget(null); setMotivo(''); } }}>
        <AlertDialogContent className="dark:bg-kx-bg dark:border-kx-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="dark:text-kx-text">¿Cancelar NC {cancelTarget?.numero_ncp}?</AlertDialogTitle>
            <AlertDialogDescription className="dark:text-kx-text-2">
              Se revierte el crédito otorgado en Cuenta Corriente del proveedor (la deuda vuelve a subir). Queda un registro completo de la reversión — nada se borra. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            placeholder="Motivo (opcional) — ej. error de carga..."
            className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            rows={2}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelando} className="dark:text-kx-text dark:border-kx-border">Volver</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelar} disabled={cancelando} className="bg-red-600 hover:bg-red-700 text-white">
              {cancelando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Ban className="h-4 w-4 mr-2" />}
              Sí, cancelar NC
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDuplicarDialog
        open={!!duplicarTarget}
        onOpenChange={(v) => !v && setDuplicarTarget(null)}
        tipoLabel="Nota de Crédito"
        numero={duplicarTarget?.numero_ncp}
        onConfirm={(vincular) => { setDuplicarVincular(vincular); setIsDuplicarOpen(true); }}
      />
      <NuevaNCProveedorModal
        open={isDuplicarOpen}
        onOpenChange={v => { setIsDuplicarOpen(v); if (!v) setDuplicarTarget(null); }}
        duplicarOrigen={duplicarTarget ? { id: duplicarTarget.id, proveedor_id: duplicarTarget.proveedor_id } : null}
        duplicadoDeId={duplicarVincular ? (duplicarTarget?.id ?? null) : null}
        onSuccess={() => { setIsDuplicarOpen(false); setDuplicarTarget(null); fetchNotas(); }}
      />
    </Card>
  );
}

function DevolucionesProveedorSection({ onNavigate }) {
  const [tab, setTab] = useState('devoluciones');

  const tabClass = [
    'rounded-none rounded-t-sm px-4 py-2 text-sm border-b-2 transition-colors',
    'data-[state=active]:border-[rgb(var(--kx-violet))] data-[state=active]:text-kx-text data-[state=active]:font-semibold',
    'data-[state=inactive]:border-transparent data-[state=inactive]:text-kx-text-2',
    'data-[state=inactive]:hover:text-kx-text',
  ].join(' ');

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="bg-transparent p-0 gap-1 flex justify-start border-b border-kx-border rounded-none h-auto pb-0">
          <TabsTrigger value="devoluciones" className={tabClass}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Devoluciones a Proveedor
          </TabsTrigger>
          <TabsTrigger value="notas_debito" className={tabClass}>
            <FileWarning className="h-3.5 w-3.5 mr-1.5" />
            Notas de Débito Recibidas
          </TabsTrigger>
          <TabsTrigger value="notas_credito" className={tabClass}>
            <FileMinus className="h-3.5 w-3.5 mr-1.5" />
            Notas de Crédito Recibidas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="devoluciones" className="mt-4">
          <DevolucionesTab onNavigate={onNavigate} />
        </TabsContent>

        <TabsContent value="notas_debito" className="mt-4">
          <NotasDebitoRecibidas />
        </TabsContent>

        <TabsContent value="notas_credito" className="mt-4">
          <NotasCreditoRecibidas />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default DevolucionesProveedorSection;
