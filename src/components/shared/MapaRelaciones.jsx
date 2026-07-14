import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowRight, ArrowDown, Network, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatDateAR } from '@/lib/dateUtils';

const fmt = (n) =>
  Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TIPO_CONFIG = {
  // ── Ventas ─────────────────────────────────────────────────────────────────
  cotizacion:      { label: 'Cotización',      color: 'border-t-kx-text-3', accent: 'text-kx-text-3'   },
  pedido:          { label: 'Pedido',          color: 'border-t-kx-blue',   accent: 'text-kx-blue'     },
  entrega:         { label: 'Entrega',         color: 'border-t-kx-violet', accent: 'text-kx-violet'   },
  venta:           { label: 'Factura',         color: 'border-t-kx-green',  accent: 'text-kx-green'    },
  nota_credito:    { label: 'Nota de Crédito', color: 'border-t-kx-amber',  accent: 'text-kx-amber'    },
  nota_debito:     { label: 'Nota de Débito',  color: 'border-t-kx-red',    accent: 'text-kx-red'      },
  devolucion:      { label: 'Devolución',      color: 'border-t-kx-amber',  accent: 'text-kx-amber'    },
  cobro_cc:        { label: 'Cobro CC',        color: 'border-t-kx-green',  accent: 'text-kx-green'    },
  // ── Compras ────────────────────────────────────────────────────────────────
  orden_compra:    { label: 'Orden de Compra', color: 'border-t-kx-blue',   accent: 'text-kx-blue'     },
  recepcion:       { label: 'Recepción',       color: 'border-t-kx-violet', accent: 'text-kx-violet'   },
  factura_compra:  { label: 'Factura Compra',  color: 'border-t-kx-blue',   accent: 'text-kx-blue'     },
  pago_proveedor:  { label: 'Pago CC',         color: 'border-t-kx-green',  accent: 'text-kx-green'    },
  nc_proveedor:    { label: 'NC Proveedor',    color: 'border-t-kx-amber',  accent: 'text-kx-amber'    },
  nd_proveedor:    { label: 'ND Recibida',     color: 'border-t-kx-red',    accent: 'text-kx-red'      },
  devolucion_prov: { label: 'Dev. Proveedor',  color: 'border-t-kx-amber',  accent: 'text-kx-amber'    },
};

function NodoMapa({ nodo, activo = false, onClick }) {
  const config    = TIPO_CONFIG[nodo.tipo] ?? TIPO_CONFIG.venta;
  const clickable = !!onClick && !activo;

  return (
    <div
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      className={[
        'bg-kx-surface border border-kx-border rounded-xl p-3',
        'min-w-[130px] max-w-[160px] flex-shrink-0 select-none',
        'border-t-2',
        activo
          ? 'border-t-[rgb(var(--kx-violet))] ring-2 ring-[rgb(var(--kx-violet)/0.18)]'
          : config.color,
        clickable
          ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-150'
          : 'cursor-default',
      ].join(' ')}
    >
      <div className={`text-2xs font-bold uppercase tracking-wider mb-1 flex items-center gap-1 ${
        activo ? 'text-[rgb(var(--kx-violet))]' : config.accent
      }`}>
        {config.label}
        {activo && (
          <span className="text-[8px] bg-[rgb(var(--kx-violet)/0.12)] px-1 py-0.5 rounded font-semibold">
            actual
          </span>
        )}
      </div>

      <div className="text-xs font-bold text-kx-text truncate">
        {nodo.numero || '—'}
      </div>

      {nodo.fecha && (
        <div className="text-2xs text-kx-text-2 mt-0.5">{formatDateAR(nodo.fecha)}</div>
      )}

      {(nodo.total != null || nodo.monto != null) && (
        <div className="text-2xs font-semibold text-kx-text mt-1 tabular-nums">
          ${fmt(nodo.total ?? nodo.monto)}
        </div>
      )}

      {nodo.estado && (
        <div className="text-[9px] text-kx-text-3 mt-0.5 capitalize">{nodo.estado}</div>
      )}

      {clickable && (
        <div className="mt-1.5 text-[9px] text-kx-text-3 flex items-center gap-0.5">
          <ExternalLink className="w-2.5 h-2.5" /> ver detalle
        </div>
      )}
    </div>
  );
}

function Flecha({ vertical = false }) {
  return vertical
    ? <ArrowDown  className="w-4 h-4 text-kx-text-3 flex-shrink-0 my-1 mx-auto" />
    : <ArrowRight className="w-4 h-4 text-kx-text-3 flex-shrink-0 mx-1 self-center" />;
}

// ── Componente principal ─────────────────────────────────────────────────────

function MapaRelaciones({ open, onOpenChange, comprobanteId, compraId, onNavigate }) {
  const { user }  = useAuth();
  const [loading, setLoading] = useState(false);
  const [mapa, setMapa]       = useState(null);
  const isCompra = !!compraId && !comprobanteId;

  useEffect(() => {
    if (!open || !user?.empresa_id) return;
    if (comprobanteId) fetchMapaVenta();
    else if (compraId) fetchMapaCompra();
  }, [open, comprobanteId, compraId, user?.empresa_id]);

  useEffect(() => {
    if (!open) setMapa(null);
  }, [open]);

  // ── Fetch lado Ventas ────────────────────────────────────────────────────────
  const fetchMapaVenta = async () => {
    setLoading(true);
    try {
      const { data: comp } = await supabase.from('comprobantes')
        .select('id, numero_venta, numero_afip, tipo, total, fecha, cliente_nombre, comprobante_origen_id, pedido_id, cotizacion_id')
        .eq('id', comprobanteId).single();

      if (!comp) { setMapa(null); return; }

      const [origenRes, pedidoRes, entregasRes, ncsRes, ndsRes, devRes, cobrosRes] = await Promise.allSettled([
        comp.comprobante_origen_id
          ? supabase.from('comprobantes')
              .select('id, numero_venta, numero_afip, tipo, total, fecha')
              .eq('id', comp.comprobante_origen_id).single()
          : Promise.resolve({ data: null }),

        comp.pedido_id
          ? supabase.from('pedidos')
              .select('id, numero, fecha, total, estado')
              .eq('id', comp.pedido_id).eq('empresa_id', user.empresa_id).maybeSingle()
          : Promise.resolve({ data: null }),

        // Entregas: las que apuntan al comprobante (POS implícita) Y las que apuntan al pedido (manual)
        comp.pedido_id
          ? supabase.from('entregas')
              .select('id, numero_entrega, fecha, estado, origen, pedido_id')
              .or(`comprobante_id.eq.${comprobanteId},pedido_id.eq.${comp.pedido_id}`)
              .eq('empresa_id', user.empresa_id)
          : supabase.from('entregas')
              .select('id, numero_entrega, fecha, estado, origen, pedido_id')
              .eq('comprobante_id', comprobanteId)
              .eq('empresa_id', user.empresa_id),

        supabase.from('comprobantes')
          .select('id, numero_venta, numero_afip, tipo, total, fecha, estado_pago')
          .eq('comprobante_origen_id', comprobanteId)
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'nota_credito'),

        supabase.from('notas_debito')
          .select('id, numero_nd, concepto, monto, fecha')
          .eq('comprobante_id', comprobanteId)
          .eq('empresa_id', user.empresa_id),

        supabase.from('devoluciones')
          .select('id, numero_devolucion, fecha, compensacion')
          .eq('comprobante_id', comprobanteId)
          .eq('empresa_id', user.empresa_id),

        supabase.from('cuenta_corriente_movimientos')
          .select('id, tipo, monto, fecha, descripcion')
          .eq('comprobante_id', comprobanteId)
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'HABER'),
      ]);

      const safe    = (res) => res.status === 'fulfilled' ? (res.value.data ?? null) : null;
      const safeArr = (res) => res.status === 'fulfilled' ? (res.value.data ?? []) : [];

      // Dedupe + priorización
      const entregasRaw = safeArr(entregasRes);
      const seen = new Set();
      const entregasDedup = entregasRaw.filter(e => seen.has(e.id) ? false : (seen.add(e.id), true));

      // Si el comprobante viene de un pedido, priorizar la entrega manual vinculada a ese pedido
      // y descartar todas las implícitas (para evitar la duplicación POS).
      let entregas;
      if (comp.pedido_id) {
        const manualesDelPedido = entregasDedup.filter(e => e.pedido_id === comp.pedido_id && e.origen === 'manual');
        if (manualesDelPedido.length > 0) {
          entregas = manualesDelPedido;
        } else {
          // Sin manual del pedido: caer al criterio general (manual gana a implícita si coexisten)
          const hayManual = entregasDedup.some(e => e.origen === 'manual');
          entregas = hayManual ? entregasDedup.filter(e => e.origen !== 'implicita') : entregasDedup;
        }
      } else {
        const hayManual = entregasDedup.some(e => e.origen === 'manual');
        entregas = hayManual ? entregasDedup.filter(e => e.origen !== 'implicita') : entregasDedup;
      }

      // Fallback de pedido: si el comprobante no lo trae, tomar el de la primera entrega que tenga pedido_id
      let pedido = safe(pedidoRes);
      if (!pedido) {
        const pedIdDesdeEntrega = entregas.find(e => e.pedido_id)?.pedido_id;
        if (pedIdDesdeEntrega) {
          const { data: ped } = await supabase.from('pedidos')
            .select('id, numero, fecha, total, estado')
            .eq('id', pedIdDesdeEntrega).eq('empresa_id', user.empresa_id).maybeSingle();
          pedido = ped;
        }
      }

      setMapa({
        modo:         'venta',
        comp,
        origen:       safe(origenRes),
        pedido,
        entregas,
        ncs:          safeArr(ncsRes),
        nds:          safeArr(ndsRes),
        devoluciones: safeArr(devRes),
        cobros:       safeArr(cobrosRes),
      });
    } catch (err) {
      console.error('[MapaRelaciones/venta]', err);
      setMapa(null);
    } finally {
      setLoading(false);
    }
  };

  // ── Fetch lado Compras ───────────────────────────────────────────────────────
  const fetchMapaCompra = async () => {
    setLoading(true);
    try {
      const { data: compra } = await supabase.from('compras')
        .select('id, numero_factura, total, fecha, proveedor_id, proveedores(nombre)')
        .eq('id', compraId).single();

      if (!compra) { setMapa(null); return; }

      const [recepcionesRes, ncsRes, ndsRes, pagosRes] = await Promise.allSettled([
        // Recepciones vinculadas a esta compra
        supabase.from('recepciones')
          .select('id, numero_recepcion, fecha, estado')
          .eq('compra_id', compraId)
          .eq('empresa_id', user.empresa_id),

        // Devoluciones (NC físicas) al proveedor
        supabase.from('devoluciones')
          .select('id, numero_devolucion, fecha, compensacion')
          .eq('compra_id', compraId)
          .eq('tipo', 'proveedor')
          .eq('empresa_id', user.empresa_id),

        // ND recibidas de este proveedor sobre esta compra
        supabase.from('notas_debito')
          .select('id, numero_nd, concepto, monto, fecha')
          .eq('compra_id', compraId)
          .eq('empresa_id', user.empresa_id),

        // Pagos / NC financieras en CC proveedores (referencia_id = compraId)
        supabase.from('cuenta_corriente_proveedores')
          .select('id, tipo, monto, fecha, descripcion, referencia_tipo')
          .eq('referencia_id', compraId)
          .eq('empresa_id', user.empresa_id),
      ]);

      const safeArr = (res) => res.status === 'fulfilled' ? (res.value.data ?? []) : [];

      const ccMovs        = safeArr(pagosRes);
      const pagosCC       = ccMovs.filter(m => m.tipo === 'DEBE' && m.referencia_tipo !== 'nc_proveedor');
      const ncsFinancieras = ccMovs.filter(m => m.referencia_tipo === 'nc_proveedor');

      setMapa({
        modo:         'compra',
        compra,
        recepciones:  safeArr(recepcionesRes),
        devoluciones: safeArr(ncsRes),
        nds:          safeArr(ndsRes),
        pagos:        pagosCC,
        ncsFinancieras,
      });
    } catch (err) {
      console.error('[MapaRelaciones/compra]', err);
      setMapa(null);
    } finally {
      setLoading(false);
    }
  };

  const navigate = (tipo, id) => {
    onNavigate?.(tipo, id);
    onOpenChange(false);
  };

  // ── Nodos para ventas ────────────────────────────────────────────────────────
  const compNodo = mapa?.modo === 'venta' ? {
    id:     mapa.comp.id,
    tipo:   mapa.comp.tipo === 'nota_credito' ? 'nota_credito' : 'venta',
    numero: mapa.comp.numero_afip ?? mapa.comp.numero_venta,
    fecha:  mapa.comp.fecha,
    total:  mapa.comp.total,
  } : null;

  // ── Nodo para compras ────────────────────────────────────────────────────────
  const compraNodo = mapa?.modo === 'compra' ? {
    id:     mapa.compra.id,
    tipo:   'factura_compra',
    numero: mapa.compra.numero_factura || 'S/N',
    fecha:  mapa.compra.fecha,
    total:  mapa.compra.total,
  } : null;

  // ── Sin relaciones ───────────────────────────────────────────────────────────
  const sinRelacionesVenta = mapa?.modo === 'venta' && !mapa.origen && !mapa.pedido
    && mapa.entregas.length === 0 && mapa.ncs.length === 0
    && mapa.nds.length === 0 && mapa.devoluciones.length === 0
    && mapa.cobros.length === 0;

  const sinRelacionesCompra = mapa?.modo === 'compra'
    && mapa.recepciones.length === 0 && mapa.devoluciones.length === 0
    && mapa.nds.length === 0 && mapa.pagos.length === 0
    && mapa.ncsFinancieras.length === 0;

  const tieneDerivadosVenta = mapa?.modo === 'venta' && (
    mapa.ncs.length > 0 || mapa.nds.length > 0 ||
    mapa.cobros.length > 0 || mapa.devoluciones.length > 0
  );

  const tieneDerivadosCompra = mapa?.modo === 'compra' && (
    mapa.devoluciones.length > 0 || mapa.nds.length > 0 ||
    mapa.pagos.length > 0 || mapa.ncsFinancieras.length > 0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl bg-kx-surface border-kx-border text-kx-text">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="w-5 h-5 text-kx-violet" />
            Mapa de Relaciones
            {isCompra && (
              <span className="text-2xs font-normal text-kx-text-3 bg-kx-surface-2 px-2 py-0.5 rounded-full">
                Compras
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            Árbol de documentos vinculados
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[180px] overflow-x-auto py-2">
          {loading && (
            <div className="flex items-center justify-center h-36">
              <Loader2 className="w-6 h-6 animate-spin text-kx-text-3" />
            </div>
          )}

          {!loading && !mapa && (
            <div className="text-center text-kx-text-3 text-sm py-12">
              No se pudo cargar el mapa de relaciones.
            </div>
          )}

          {/* ── VENTAS: sin relaciones ─────────────────────────────────────── */}
          {!loading && mapa?.modo === 'venta' && sinRelacionesVenta && (
            <div className="flex flex-col items-center gap-3 py-8">
              <NodoMapa nodo={compNodo} activo />
              <p className="text-xs text-kx-text-3">
                Sin documentos relacionados — comprobante independiente
              </p>
            </div>
          )}

          {/* ── VENTAS: con relaciones ─────────────────────────────────────── */}
          {!loading && mapa?.modo === 'venta' && !sinRelacionesVenta && (
            <div className="space-y-6">
              <div>
                <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider mb-3">
                  Cadena de documentos
                </p>
                <div className="flex items-start gap-1 flex-wrap">
                  {mapa.origen && (
                    <>
                      <NodoMapa
                        nodo={{
                          id:     mapa.origen.id,
                          tipo:   mapa.origen.tipo === 'nota_credito' ? 'nota_credito' : 'venta',
                          numero: mapa.origen.numero_afip ?? mapa.origen.numero_venta,
                          fecha:  mapa.origen.fecha,
                          total:  mapa.origen.total,
                        }}
                        onClick={() => navigate('comprobante', mapa.origen.id)}
                      />
                      <Flecha />
                    </>
                  )}
                  {mapa.pedido && (
                    <>
                      <NodoMapa
                        nodo={{
                          id:     mapa.pedido.id,
                          tipo:   'pedido',
                          numero: mapa.pedido.numero,
                          fecha:  mapa.pedido.fecha,
                          total:  mapa.pedido.total,
                          estado: mapa.pedido.estado,
                        }}
                        onClick={() => navigate('pedido', mapa.pedido.id)}
                      />
                      <Flecha />
                    </>
                  )}
                  {mapa.entregas.map((e, i) => (
                    <React.Fragment key={e.id}>
                      <NodoMapa
                        nodo={{ id: e.id, tipo: 'entrega', numero: e.numero_entrega, fecha: e.fecha, estado: e.estado }}
                        onClick={() => navigate('entrega', e.id)}
                      />
                      {(i < mapa.entregas.length - 1 || true) && <Flecha />}
                    </React.Fragment>
                  ))}
                  <NodoMapa nodo={compNodo} activo />
                </div>
              </div>

              {tieneDerivadosVenta && (
                <div className="pl-5 border-l-2 border-dashed border-kx-border ml-4 space-y-3">
                  <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider">
                    Documentos derivados
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {mapa.ncs.map(nc => (
                      <NodoMapa
                        key={nc.id}
                        nodo={{ id: nc.id, tipo: 'nota_credito', numero: nc.numero_afip ?? nc.numero_venta, fecha: nc.fecha, total: nc.total, estado: nc.estado_pago }}
                        onClick={() => navigate('comprobante', nc.id)}
                      />
                    ))}
                    {mapa.nds.map(nd => (
                      <NodoMapa
                        key={nd.id}
                        nodo={{ id: nd.id, tipo: 'nota_debito', numero: nd.numero_nd, fecha: nd.fecha, monto: nd.monto, estado: nd.concepto }}
                      />
                    ))}
                    {mapa.cobros.map(c => (
                      <NodoMapa
                        key={c.id}
                        nodo={{ id: c.id, tipo: 'cobro_cc', numero: c.descripcion || 'Cobro CC', fecha: c.fecha, monto: c.monto }}
                      />
                    ))}
                    {mapa.devoluciones.map(d => (
                      <NodoMapa
                        key={d.id}
                        nodo={{ id: d.id, tipo: 'devolucion', numero: d.numero_devolucion, fecha: d.fecha, estado: d.compensacion }}
                        onClick={() => navigate('devolucion', d.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-2 border-t border-kx-border">
                {['venta', 'pedido', 'entrega', 'nota_credito', 'nota_debito', 'cobro_cc', 'devolucion'].map(tipo => (
                  <div key={tipo} className="flex items-center gap-1.5 text-2xs text-kx-text-3">
                    <div className={`w-2 h-2 rounded-full ${TIPO_CONFIG[tipo].accent.replace('text-', 'bg-')}`} />
                    {TIPO_CONFIG[tipo].label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── COMPRAS: sin relaciones ────────────────────────────────────── */}
          {!loading && mapa?.modo === 'compra' && sinRelacionesCompra && (
            <div className="flex flex-col items-center gap-3 py-8">
              <NodoMapa nodo={compraNodo} activo />
              <p className="text-xs text-kx-text-3">
                Sin documentos relacionados — factura independiente
              </p>
            </div>
          )}

          {/* ── COMPRAS: con relaciones ────────────────────────────────────── */}
          {!loading && mapa?.modo === 'compra' && !sinRelacionesCompra && (
            <div className="space-y-6">
              <div>
                <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider mb-3">
                  Cadena de documentos
                </p>
                <div className="flex items-start gap-1 flex-wrap">
                  {/* Recepciones previas */}
                  {mapa.recepciones.map((r, i) => (
                    <React.Fragment key={r.id}>
                      <NodoMapa
                        nodo={{ id: r.id, tipo: 'recepcion', numero: r.numero_recepcion, fecha: r.fecha, estado: r.estado }}
                        onClick={() => navigate('recepcion', r.id)}
                      />
                      {(i < mapa.recepciones.length - 1 || true) && <Flecha />}
                    </React.Fragment>
                  ))}
                  {/* Factura actual */}
                  <NodoMapa nodo={compraNodo} activo />
                  {/* Pagos CC */}
                  {mapa.pagos.map(p => (
                    <React.Fragment key={p.id}>
                      <Flecha />
                      <NodoMapa
                        nodo={{ id: p.id, tipo: 'pago_proveedor', numero: p.descripcion || 'Pago CC', fecha: p.fecha, monto: p.monto }}
                      />
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {tieneDerivadosCompra && (
                <div className="pl-5 border-l-2 border-dashed border-kx-border ml-4 space-y-3">
                  <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider">
                    Documentos derivados
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {/* Devoluciones físicas */}
                    {mapa.devoluciones.map(d => (
                      <NodoMapa
                        key={d.id}
                        nodo={{ id: d.id, tipo: 'devolucion_prov', numero: d.numero_devolucion, fecha: d.fecha, estado: d.compensacion }}
                        onClick={() => navigate('devolucion', d.id)}
                      />
                    ))}
                    {/* NC financieras recibidas */}
                    {mapa.ncsFinancieras.map(nc => (
                      <NodoMapa
                        key={nc.id}
                        nodo={{ id: nc.id, tipo: 'nc_proveedor', numero: nc.descripcion || 'NC', fecha: nc.fecha, monto: nc.monto }}
                      />
                    ))}
                    {/* ND recibidas */}
                    {mapa.nds.map(nd => (
                      <NodoMapa
                        key={nd.id}
                        nodo={{ id: nd.id, tipo: 'nd_proveedor', numero: nd.numero_nd, fecha: nd.fecha, monto: nd.monto, estado: nd.concepto }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-2 border-t border-kx-border">
                {['factura_compra', 'recepcion', 'pago_proveedor', 'nc_proveedor', 'nd_proveedor', 'devolucion_prov'].map(tipo => (
                  <div key={tipo} className="flex items-center gap-1.5 text-2xs text-kx-text-3">
                    <div className={`w-2 h-2 rounded-full ${TIPO_CONFIG[tipo].accent.replace('text-', 'bg-')}`} />
                    {TIPO_CONFIG[tipo].label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-3 border-t border-kx-border">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}
            className="border-kx-border text-kx-text-2 text-xs">
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MapaRelaciones;
