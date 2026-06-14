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
  cotizacion:   { label: 'Cotización',      color: 'border-t-kx-text-3', accent: 'text-kx-text-3'   },
  pedido:       { label: 'Pedido',          color: 'border-t-kx-blue',   accent: 'text-kx-blue'     },
  entrega:      { label: 'Entrega',         color: 'border-t-kx-violet', accent: 'text-kx-violet'   },
  venta:        { label: 'Factura',         color: 'border-t-kx-green',  accent: 'text-kx-green'    },
  nota_credito: { label: 'Nota de Crédito', color: 'border-t-kx-amber',  accent: 'text-kx-amber'    },
  nota_debito:  { label: 'Nota de Débito',  color: 'border-t-kx-red',    accent: 'text-kx-red'      },
  devolucion:   { label: 'Devolución',      color: 'border-t-kx-amber',  accent: 'text-kx-amber'    },
  cobro_cc:     { label: 'Cobro CC',        color: 'border-t-kx-green',  accent: 'text-kx-green'    },
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
      <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1 ${
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
        <div className="text-[10px] text-kx-text-2 mt-0.5">{formatDateAR(nodo.fecha)}</div>
      )}

      {(nodo.total != null || nodo.monto != null) && (
        <div className="text-[11px] font-semibold text-kx-text mt-1 tabular-nums">
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

function MapaRelaciones({ open, onOpenChange, comprobanteId, onNavigate }) {
  const { user }  = useAuth();
  const [loading, setLoading] = useState(false);
  const [mapa, setMapa]       = useState(null);

  useEffect(() => {
    if (!open || !comprobanteId || !user?.empresa_id) return;
    fetchMapa();
  }, [open, comprobanteId, user?.empresa_id]);

  useEffect(() => {
    if (!open) setMapa(null);
  }, [open]);

  const fetchMapa = async () => {
    setLoading(true);
    try {
      // 1. Comprobante actual
      const { data: comp } = await supabase.from('comprobantes')
        .select('id, numero_venta, numero_afip, tipo, total, fecha, cliente_nombre, comprobante_origen_id, pedido_id, cotizacion_id')
        .eq('id', comprobanteId).single();

      if (!comp) { setMapa(null); return; }

      // 2-8. Queries paralelas
      const [origenRes, pedidoRes, entregasRes, ncsRes, ndsRes, devRes, cobrosRes] = await Promise.allSettled([
        // 2. Origen (si este comprobante es una NC sobre una factura)
        comp.comprobante_origen_id
          ? supabase.from('comprobantes')
              .select('id, numero_venta, numero_afip, tipo, total, fecha')
              .eq('id', comp.comprobante_origen_id).single()
          : Promise.resolve({ data: null }),

        // 3. Pedido origen
        comp.pedido_id
          ? supabase.from('pedidos')
              .select('id, numero, fecha_pedido, total, estado')
              .eq('id', comp.pedido_id).eq('empresa_id', user.empresa_id).maybeSingle()
          : Promise.resolve({ data: null }),

        // 4. Entregas ligadas a este comprobante (factura generó entrega implícita)
        supabase.from('entregas')
          .select('id, numero_entrega, fecha, estado')
          .eq('comprobante_id', comprobanteId)
          .eq('empresa_id', user.empresa_id),

        // 5. NC hijas (comprobantes que tienen este como origen)
        supabase.from('comprobantes')
          .select('id, numero_venta, numero_afip, tipo, total, fecha, estado_pago')
          .eq('comprobante_origen_id', comprobanteId)
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'nota_credito'),

        // 6. NDs de la tabla notas_debito referenciando este comprobante
        supabase.from('notas_debito')
          .select('id, numero_nd, concepto, monto, fecha')
          .eq('comprobante_id', comprobanteId)
          .eq('empresa_id', user.empresa_id),

        // 7. Devoluciones contra este comprobante
        supabase.from('devoluciones')
          .select('id, numero_devolucion, fecha, compensacion')
          .eq('comprobante_id', comprobanteId)
          .eq('empresa_id', user.empresa_id),

        // 8. Cobros CC (HABER) sobre este comprobante
        supabase.from('cuenta_corriente_movimientos')
          .select('id, tipo, monto, fecha, descripcion')
          .eq('comprobante_id', comprobanteId)
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'HABER'),
      ]);

      const safe = (res) => res.status === 'fulfilled' ? (res.value.data ?? null) : null;
      const safeArr = (res) => res.status === 'fulfilled' ? (res.value.data ?? []) : [];

      setMapa({
        comp,
        origen:       safe(origenRes),
        pedido:       safe(pedidoRes),
        entregas:     safeArr(entregasRes),
        ncs:          safeArr(ncsRes),
        nds:          safeArr(ndsRes),
        devoluciones: safeArr(devRes),
        cobros:       safeArr(cobrosRes),
      });
    } catch (err) {
      console.error('[MapaRelaciones]', err);
      setMapa(null);
    } finally {
      setLoading(false);
    }
  };

  const navigate = (tipo, id) => {
    onNavigate?.(tipo, id);
    onOpenChange(false);
  };

  // Nodo del comprobante actual
  const compNodo = mapa ? {
    id:     mapa.comp.id,
    tipo:   mapa.comp.tipo === 'nota_credito' ? 'nota_credito' : 'venta',
    numero: mapa.comp.numero_afip ?? mapa.comp.numero_venta,
    fecha:  mapa.comp.fecha,
    total:  mapa.comp.total,
  } : null;

  const sinRelaciones = mapa && !mapa.origen && !mapa.pedido
    && mapa.entregas.length === 0 && mapa.ncs.length === 0
    && mapa.nds.length === 0 && mapa.devoluciones.length === 0
    && mapa.cobros.length === 0;

  const tieneDerivados = mapa && (
    mapa.ncs.length > 0 || mapa.nds.length > 0 ||
    mapa.cobros.length > 0 || mapa.devoluciones.length > 0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl bg-kx-surface border-kx-border text-kx-text">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="w-5 h-5 text-kx-violet" />
            Mapa de Relaciones
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            Árbol de documentos vinculados — estilo SAP B1 Document Flow
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[180px] overflow-x-auto py-2">
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center h-36">
              <Loader2 className="w-6 h-6 animate-spin text-kx-text-3" />
            </div>
          )}

          {/* Error */}
          {!loading && !mapa && (
            <div className="text-center text-kx-text-3 text-sm py-12">
              No se pudo cargar el mapa de relaciones.
            </div>
          )}

          {/* Sin relaciones */}
          {!loading && mapa && sinRelaciones && (
            <div className="flex flex-col items-center gap-3 py-8">
              <NodoMapa nodo={compNodo} activo />
              <p className="text-xs text-kx-text-3">
                Sin documentos relacionados — comprobante independiente
              </p>
            </div>
          )}

          {/* Con relaciones */}
          {!loading && mapa && !sinRelaciones && (
            <div className="space-y-6">
              {/* FILA PRINCIPAL: cadena ascendente hacia el comprobante actual */}
              <div>
                <p className="text-[10px] font-semibold text-kx-text-3 uppercase tracking-wider mb-3">
                  Cadena de documentos
                </p>
                <div className="flex items-start gap-1 flex-wrap">
                  {/* Factura origen si esta es una NC */}
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

                  {/* Pedido origen */}
                  {mapa.pedido && (
                    <>
                      <NodoMapa
                        nodo={{
                          id:     mapa.pedido.id,
                          tipo:   'pedido',
                          numero: mapa.pedido.numero,
                          fecha:  mapa.pedido.fecha_pedido,
                          total:  mapa.pedido.total,
                          estado: mapa.pedido.estado,
                        }}
                        onClick={() => navigate('pedido', mapa.pedido.id)}
                      />
                      <Flecha />
                    </>
                  )}

                  {/* Entregas */}
                  {mapa.entregas.map((e, i) => (
                    <React.Fragment key={e.id}>
                      <NodoMapa
                        nodo={{
                          id:     e.id,
                          tipo:   'entrega',
                          numero: e.numero_entrega,
                          fecha:  e.fecha,
                          estado: e.estado,
                        }}
                        onClick={() => navigate('entrega', e.id)}
                      />
                      {(i < mapa.entregas.length - 1 || true) && <Flecha />}
                    </React.Fragment>
                  ))}

                  {/* Comprobante actual */}
                  <NodoMapa nodo={compNodo} activo />
                </div>
              </div>

              {/* BLOQUE DERIVADOS */}
              {tieneDerivados && (
                <div className="pl-5 border-l-2 border-dashed border-kx-border ml-4 space-y-3">
                  <p className="text-[10px] font-semibold text-kx-text-3 uppercase tracking-wider">
                    Documentos derivados
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {/* NC hijas */}
                    {mapa.ncs.map(nc => (
                      <NodoMapa
                        key={nc.id}
                        nodo={{
                          id:     nc.id,
                          tipo:   'nota_credito',
                          numero: nc.numero_afip ?? nc.numero_venta,
                          fecha:  nc.fecha,
                          total:  nc.total,
                          estado: nc.estado_pago,
                        }}
                        onClick={() => navigate('comprobante', nc.id)}
                      />
                    ))}

                    {/* NDs (sin navegación directa — solo informativos) */}
                    {mapa.nds.map(nd => (
                      <NodoMapa
                        key={nd.id}
                        nodo={{
                          id:     nd.id,
                          tipo:   'nota_debito',
                          numero: nd.numero_nd,
                          fecha:  nd.fecha,
                          monto:  nd.monto,
                          estado: nd.concepto,
                        }}
                      />
                    ))}

                    {/* Cobros CC (sin navegación directa) */}
                    {mapa.cobros.map(c => (
                      <NodoMapa
                        key={c.id}
                        nodo={{
                          id:    c.id,
                          tipo:  'cobro_cc',
                          numero: c.descripcion || 'Cobro CC',
                          fecha: c.fecha,
                          monto: c.monto,
                        }}
                      />
                    ))}

                    {/* Devoluciones */}
                    {mapa.devoluciones.map(d => (
                      <NodoMapa
                        key={d.id}
                        nodo={{
                          id:     d.id,
                          tipo:   'devolucion',
                          numero: d.numero_devolucion,
                          fecha:  d.fecha,
                          estado: d.compensacion,
                        }}
                        onClick={() => navigate('devolucion', d.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Leyenda */}
              <div className="flex flex-wrap gap-3 pt-2 border-t border-kx-border">
                {['venta', 'pedido', 'entrega', 'nota_credito', 'nota_debito', 'cobro_cc', 'devolucion'].map(tipo => (
                  <div key={tipo} className="flex items-center gap-1.5 text-[10px] text-kx-text-3">
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
