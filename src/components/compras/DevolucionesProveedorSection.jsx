import { useState, useEffect } from 'react';
import { RotateCcw, FileWarning, FileMinus, Ban, Loader2, Copy, Network, MoreHorizontal, Eye } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatDateAR, getTodayAR } from '@/lib/dateUtils';
import { useToast } from '@/components/ui/use-toast';
import { asientosAutoService } from '@/services/planCuentasService';
import ConfirmDuplicarDialog from '@/components/shared/ConfirmDuplicarDialog';
import MapaRelaciones from '@/components/shared/MapaRelaciones';
import NuevaNCProveedorModal from './NuevaNCProveedorModal';
import NuevaNotaDebitoModal from '@/components/shared/NuevaNotaDebitoModal';
import ModalDetalleDevolucion from '@/components/ventas/ModalDetalleDevolucion';
import ModalDetalleNotaProveedor from './ModalDetalleNotaProveedor';

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

function DevolucionesTab({ onNavigate, onOpenMapa }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [devoluciones, setDevoluciones] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [viewDevolucionId, setViewDevolucionId] = useState(null);
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
        devolucion_items(id, cantidad, precio_unitario, subtotal, alicuota_iva, producto_id, productos(nombre))
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

  const viewDevolucion = devoluciones.find(d => d.id === viewDevolucionId) ?? null;

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

  // Mismo criterio que DevolucionesSection.jsx (Ventas) — "reemplazo" es solo
  // una etiqueta de estado, no genera ningún documento ni movimiento contable.
  const handleMarcarReemplazo = async (dev) => {
    const { error } = await supabase.from('devoluciones')
      .update({ compensacion: 'reemplazo' })
      .eq('id', dev.id).eq('empresa_id', user.empresa_id);
    if (error) {
      toast({ title: 'No se pudo marcar como reemplazo', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Devolución marcada como Reemplazo' });
    setViewDevolucionId(null);
    fetchDevoluciones();
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
              <th className="text-left p-3 font-semibold text-kx-text-2">Factura origen</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Compensación</th>
              <th className="text-left p-3 font-semibold text-kx-text-2">Stock</th>
              <th className="text-center p-3 font-semibold text-kx-text-2">Ítems</th>
              <th className="text-right p-3 font-semibold text-kx-text-2">Acc.</th>
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
                const items = dev.devolucion_items || [];
                return (
                  <tr
                    key={dev.id}
                    className="hover:bg-kx-surface-2 cursor-pointer transition-colors"
                    onClick={() => setViewDevolucionId(dev.id)}
                  >
                    <td className="p-3 font-mono font-semibold text-[rgb(var(--kx-violet))]">
                      {dev.numero_devolucion}
                    </td>
                    <td className="p-3 text-kx-text-2 text-xs">{formatDateAR(dev.fecha)}</td>
                    <td className="p-3 text-kx-text">{dev.proveedores?.nombre || '—'}</td>
                    <td className="p-3 font-mono text-xs text-kx-text-2">
                      {dev.factura_compra?.numero_factura || '—'}
                    </td>
                    <td className="p-3"><CompensacionBadge comp={dev.compensacion} /></td>
                    <td className="p-3 text-xs text-kx-text-2">
                      {dev.reingresa_stock ? 'Egresó stock' : 'Sin movimiento'}
                    </td>
                    <td className="p-3 text-center text-kx-text-2">{items.length}</td>
                    <td className="p-3 text-right" onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-kx-text-3 hover:text-kx-text">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-kx-surface border-kx-border text-kx-text min-w-[200px]">
                          <DropdownMenuItem onClick={() => setViewDevolucionId(dev.id)} className="gap-2 cursor-pointer">
                            <Eye className="h-3.5 w-3.5" /> Ver detalle
                          </DropdownMenuItem>
                          {dev.compensacion === 'pendiente' && (
                            <DropdownMenuItem onClick={() => abrirNc(dev)} className="gap-2 cursor-pointer">
                              <FileMinus className="h-3.5 w-3.5" /> Generar NC
                            </DropdownMenuItem>
                          )}
                          {dev.compra_id && (
                            <>
                              <DropdownMenuSeparator className="bg-kx-border" />
                              <DropdownMenuItem onClick={() => onOpenMapa?.(dev.compra_id)} className="gap-2 cursor-pointer">
                                <Network className="h-3.5 w-3.5" /> Mapa de relaciones
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ModalDetalleDevolucion
        devolucion={viewDevolucion}
        onClose={() => setViewDevolucionId(null)}
        onNavigate={onNavigate}
        onGenerarNC={(dev) => { setViewDevolucionId(null); abrirNc(dev); }}
        onMarcarReemplazo={handleMarcarReemplazo}
      />

      <NuevaNCProveedorModal
        open={isNcOpen}
        // ncOrigen se limpia recién al cerrar de verdad -- si no, el título
        // del modal pierde la referencia mientras todavía está mostrando el
        // resumen de confirmación (ncCreada).
        onOpenChange={v => { setIsNcOpen(v); if (!v) setNcOrigen(null); }}
        devolucionOrigen={ncOrigen}
        onSuccess={() => fetchDevoluciones()}
      />
    </Card>
  );
}

function NotasDebitoRecibidas({ onOpenMapa, onNavigate }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notas, setNotas]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewNotaId, setViewNotaId] = useState(null);
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
      .select(`
        id, numero_nd, fecha, concepto, monto, neto_gravado, iva_discriminado, tipo, estado, proveedor_id, compra_id,
        proveedores(nombre),
        factura_compra:compras!compra_id(numero_factura),
        notas_debito_items(id, producto_id, descripcion, cantidad, precio_unitario, subtotal, alicuota_iva, productos(nombre))
      `)
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

  const viewNota = notas.find(n => n.id === viewNotaId) ?? null;

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
      // Hallazgo real (auditoría Ferretería NADIA, 28/08): la cancelación
      // solo reversaba cuenta_corriente_proveedores, el asiento de la ND
      // original quedaba para siempre en los libros.
      asientosAutoService.crearAsientoReversaNotaProveedor(user.empresa_id, user.id, {
        documentoId: cancelTarget.id,
        tipo: 'nota_debito',
        numero: cancelTarget.numero_nd,
        fecha: getTodayAR(),
      }).catch(e => console.warn('[Contabilidad] Reversa asiento ND proveedor (no crítico):', e.message));
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
                <tr
                  key={nd.id}
                  className="hover:bg-kx-surface-2 cursor-pointer transition-colors"
                  onClick={() => setViewNotaId(nd.id)}
                >
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
                  <td className="p-3 text-right" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-kx-text-3 hover:text-kx-text">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-kx-surface border-kx-border text-kx-text min-w-[200px]">
                        <DropdownMenuItem onClick={() => setViewNotaId(nd.id)} className="gap-2 cursor-pointer">
                          <Eye className="h-3.5 w-3.5" /> Ver detalle
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-kx-border" />
                        <DropdownMenuItem onClick={() => setDuplicarTarget(nd)} className="gap-2 cursor-pointer">
                          <Copy className="h-3.5 w-3.5" /> Duplicar
                        </DropdownMenuItem>
                        {nd.estado !== 'cancelada' && (
                          <DropdownMenuItem
                            onClick={() => setCancelTarget({ id: nd.id, numero_nd: nd.numero_nd })}
                            className="gap-2 cursor-pointer text-red-600 dark:text-red-400 focus:text-red-600"
                          >
                            <Ban className="h-3.5 w-3.5" /> Cancelar
                          </DropdownMenuItem>
                        )}
                        {nd.compra_id && (
                          <>
                            <DropdownMenuSeparator className="bg-kx-border" />
                            <DropdownMenuItem onClick={() => onOpenMapa?.(nd.compra_id)} className="gap-2 cursor-pointer">
                              <Network className="h-3.5 w-3.5" /> Mapa de relaciones
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ModalDetalleNotaProveedor
        nota={viewNota}
        tipo="debito"
        onClose={() => setViewNotaId(null)}
        onNavigate={onNavigate}
        onDuplicar={() => { setViewNotaId(null); setDuplicarTarget(viewNota); }}
        onCancelar={() => { setViewNotaId(null); setCancelTarget({ id: viewNota.id, numero_nd: viewNota.numero_nd }); }}
      />

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
        onSuccess={() => { setDuplicarTarget(null); fetchNotas(); }}
      />
    </Card>
  );
}

function NotasCreditoRecibidas({ onOpenMapa, onNavigate }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notas, setNotas]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewNotaId, setViewNotaId] = useState(null);
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
      .select(`
        id, numero_ncp, fecha, motivo, monto, neto_gravado, iva_discriminado, reembolso_efectivo, estado, proveedor_id, compra_id,
        proveedores(nombre),
        factura_compra:compras!compra_id(numero_factura),
        notas_credito_proveedor_items(id, producto_id, descripcion, cantidad, precio_unitario, subtotal, alicuota_iva, productos(nombre))
      `)
      .eq('empresa_id', user.empresa_id)
      .order('fecha', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast({ title: 'Error al cargar notas de crédito', description: error.message, variant: 'destructive' });
        setNotas(data || []);
        setLoading(false);
      });
  };

  useEffect(fetchNotas, [user?.empresa_id]);

  const viewNota = notas.find(n => n.id === viewNotaId) ?? null;

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
      // Hallazgo real (auditoría Ferretería NADIA, 28/08): la cancelación
      // solo reversaba cuenta_corriente_proveedores, el asiento de la NC
      // original quedaba para siempre en los libros — descuadraba el
      // Balance de Comprobación en el IVA Crédito Fiscal de la NC.
      asientosAutoService.crearAsientoReversaNotaProveedor(user.empresa_id, user.id, {
        documentoId: cancelTarget.id,
        tipo: 'nota_credito',
        numero: cancelTarget.numero_ncp,
        fecha: getTodayAR(),
      }).catch(e => console.warn('[Contabilidad] Reversa asiento NC proveedor (no crítico):', e.message));
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
                <tr
                  key={nc.id}
                  className="hover:bg-kx-surface-2 cursor-pointer transition-colors"
                  onClick={() => setViewNotaId(nc.id)}
                >
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
                  <td className="p-3 text-right" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-kx-text-3 hover:text-kx-text">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-kx-surface border-kx-border text-kx-text min-w-[200px]">
                        <DropdownMenuItem onClick={() => setViewNotaId(nc.id)} className="gap-2 cursor-pointer">
                          <Eye className="h-3.5 w-3.5" /> Ver detalle
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-kx-border" />
                        <DropdownMenuItem onClick={() => setDuplicarTarget(nc)} className="gap-2 cursor-pointer">
                          <Copy className="h-3.5 w-3.5" /> Duplicar
                        </DropdownMenuItem>
                        {nc.estado !== 'cancelada' && !nc.reembolso_efectivo && (
                          <DropdownMenuItem
                            onClick={() => setCancelTarget({ id: nc.id, numero_ncp: nc.numero_ncp })}
                            className="gap-2 cursor-pointer text-red-600 dark:text-red-400 focus:text-red-600"
                          >
                            <Ban className="h-3.5 w-3.5" /> Cancelar
                          </DropdownMenuItem>
                        )}
                        {nc.compra_id && (
                          <>
                            <DropdownMenuSeparator className="bg-kx-border" />
                            <DropdownMenuItem onClick={() => onOpenMapa?.(nc.compra_id)} className="gap-2 cursor-pointer">
                              <Network className="h-3.5 w-3.5" /> Mapa de relaciones
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ModalDetalleNotaProveedor
        nota={viewNota}
        tipo="credito"
        onClose={() => setViewNotaId(null)}
        onNavigate={onNavigate}
        onDuplicar={() => { setViewNotaId(null); setDuplicarTarget(viewNota); }}
        onCancelar={() => { setViewNotaId(null); setCancelTarget({ id: viewNota.id, numero_ncp: viewNota.numero_ncp }); }}
      />

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
        onSuccess={() => { setDuplicarTarget(null); fetchNotas(); }}
      />
    </Card>
  );
}

function DevolucionesProveedorSection({ onNavigate }) {
  const [tab, setTab] = useState('devoluciones');
  const [mapaCompraId, setMapaCompraId] = useState(null);
  const [isMapaOpen, setIsMapaOpen] = useState(false);
  const abrirMapa = (compraId) => { setMapaCompraId(compraId); setIsMapaOpen(true); };

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
          <DevolucionesTab onNavigate={onNavigate} onOpenMapa={abrirMapa} />
        </TabsContent>

        <TabsContent value="notas_debito" className="mt-4">
          <NotasDebitoRecibidas onOpenMapa={abrirMapa} onNavigate={onNavigate} />
        </TabsContent>

        <TabsContent value="notas_credito" className="mt-4">
          <NotasCreditoRecibidas onOpenMapa={abrirMapa} onNavigate={onNavigate} />
        </TabsContent>
      </Tabs>

      <MapaRelaciones
        open={isMapaOpen}
        onOpenChange={setIsMapaOpen}
        compraId={mapaCompraId}
        onNavigate={onNavigate}
      />
    </div>
  );
}

export default DevolucionesProveedorSection;
