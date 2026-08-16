import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Plus, Trash2, FileText, Info, AlertTriangle, Network } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useToast } from '@/components/ui/use-toast';
import { getTodayAR, getNowAR, addDaysAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { asientosAutoService } from '@/services/planCuentasService';
import ClienteSelector from '@/components/shared/ClienteSelector';
import MapaRelaciones from '@/components/shared/MapaRelaciones';
import ProductoAutocomplete from '@/components/shared/ProductoAutocomplete';

// Sin 27% a propósito — viola el CHECK real de comprobante_items.alicuota_iva
// (mismo set que cotizacion_items/pedido_items: 21/10.5/0/exento/no_gravado).
// Bug real encontrado 13/08 auditando contra el estándar de Cotizaciones.
const ALICUOTAS = [
  { value: 0,    label: 'Exento 0%' },
  { value: 10.5, label: '10.5%'     },
  { value: 21,   label: '21%'       },
];

const FORMAS_PAGO = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cuenta Corriente'];
const TIPOS_DOC   = ['Ticket', 'Factura A', 'Factura B', 'Factura C'];

const newItem = () => ({
  _id:           Math.random().toString(36).slice(2),
  producto_id:   null,
  descripcion:   '',
  cantidad:      1,
  precio_unit:   0,
  descuento_pct: 0,
  alicuota_iva:  21,
});

// precio_unit es SIEMPRE el precio final que paga el cliente (IVA incluido) —
// mismo criterio que crear_venta (POS) y que espera el mercado AR (Ley de
// Defensa del Consumidor: el precio que se muestra es el precio final).
// calcBruto = línea tal como se factura (cantidad × precio × descuento).
// Para separar neto/IVA hay que DIVIDIR por el factor de la alícuota, nunca
// sumarlo encima — sumarlo duplica el IVA (bug real encontrado en producción:
// facturas y NC generadas acá quedaban infladas exactamente ×(1+alícuota)).
const FACTOR_IVA = { '21': 1.21, '10.5': 1.105 }; // resto (exento/0/no_gravado) → factor 1, mismo criterio que crear_venta
const calcBruto = (item) => {
  const bruto = Number(item.cantidad) * (parseNumberLocale(item.precio_unit) || 0);
  const neto  = bruto * (1 - Number(item.descuento_pct) / 100);
  return isNaN(neto) ? 0 : neto;
};
const calcNetoIva = (item) => {
  const bruto  = calcBruto(item);
  const factor = FACTOR_IVA[String(item.alicuota_iva)] ?? 1;
  const neto   = bruto / factor;
  return { neto, iva: bruto - neto };
};

// pedido: cuando viene seteado, este modal factura un Pedido/Entrega del ERP
// en vez de operar en modo standalone. En ese modo, handleConfirmar llama a
// la RPC crear_venta (la misma que usa el POS) en lugar del INSERT manual —
// es la única forma de heredar, sin duplicarla, toda la lógica de Document
// Flow que esa función ya tiene probada: saltear el descuento de stock si el
// pedido ya tuvo una Entrega manual, tope de sobre-facturación contra
// pedido_items, vínculo pedidos.comprobante_id/entregas.comprobante_id y COGS.
// Ver PENDIENTE #1 (14/08) en CONTEXT.md — antes esto abría NuevaVentaModal
// (el carrito del POS), que no tiene forma de elegir tipo de comprobante,
// punto de venta ni referencia del cliente.
function NuevaFacturaModal({ open, onOpenChange, comprobanteOrigen = null, pedido = null, duplicadoDeId = null, onSuccess }) {
  const { user }                     = useAuth();
  const { currentSession, isSessionOpen } = useCaja();
  const { toast }                    = useToast();

  const [clientes, setClientes]           = useState([]);
  const [clienteId, setClienteId]         = useState('');
  const [fecha, setFecha]                 = useState(getTodayAR());
  const [referenciaCliente, setReferenciaCliente] = useState('');
  const [tipoDoc, setTipoDoc]             = useState('Ticket');
  const [formaPago, setFormaPago]         = useState('Efectivo');
  const [items, setItems]                 = useState([newItem()]);
  const [loading, setLoading]             = useState(false);
  const [productosCache, setProductosCache] = useState([]);
  const [searchFocusId, setSearchFocusId] = useState(null);
  const [afipConfig, setAfipConfig]       = useState(null);
  // Patrón SAP "Relevante para impuestos": por defecto todo documento SÍ es
  // relevante. Tildar acá excluye este comprobante de la emisión de CAE aunque
  // AFIP esté activo — para ajustes internos, pruebas o correcciones manuales
  // que nunca deben presentarse ante ARCA.
  // Punto de venta — criterio fiscal unificado (mig.294): es el ÚNICO selector.
  // Un PdV con envia_arca=false emite comprobante interno que no va a ARCA.
  const [puntosVenta, setPuntosVenta] = useState([]);
  const [puntoVentaId, setPuntoVentaId] = useState('');
  // Centro de costo (Fase 1 del plan de 4 frentes contables) — opcional, para
  // reportar por sucursal/línea de negocio. null = sin asignar, igual que hoy.
  const [centrosCosto, setCentrosCosto]   = useState([]);
  const [centroCostoId, setCentroCostoId] = useState('');
  // Frente 3 del plan "Facturar Pedido" (PLAN_FACTURAR_PEDIDO_5_FRENTES.md,
  // 15/08): este modal no tenía botón "Mapa de relaciones", a diferencia de
  // casi todos los demás documentos. Solo tiene sentido cuando ya existe algo
  // que mapear (viene de un pedido, o es "Copiar a Factura"/"Duplicar" de un
  // comprobante existente) — una Factura nueva en blanco todavía no tiene
  // cadena de documentos.
  const [mapaOpen, setMapaOpen] = useState(false);

  // ── Carga de datos al abrir ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !user?.empresa_id) return;

    supabase.from('clientes').select('id, nombre, dias_credito')
      .eq('empresa_id', user.empresa_id).neq('activo', false).order('nombre')
      .then(({ data }) => setClientes(data || []));

    supabase.from('empresas')
      .select('usa_factura_electronica, condicion_iva, afip_cuit, usa_centros_costo')
      .eq('id', user.empresa_id).single()
      .then(({ data: emp }) => {
        if (emp?.usa_centros_costo) {
          supabase.from('centros_costo').select('id, nombre')
            .eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre')
            .then(({ data }) => setCentrosCosto(data || []));
        } else {
          setCentrosCosto([]);
        }
        if (!emp?.usa_factura_electronica) return;
        // Puntos de venta activos — criterio fiscal unificado (mig.294): el PdV
        // es el único selector y su `envia_arca` define si el comprobante va a
        // ARCA. Antes acá había un `.limit(1)` sin ORDER BY ni filtro de
        // envia_arca (mismo bug que useAfipConfig tenía, duplicado en este modal).
        supabase.from('puntos_venta').select('id, numero, nombre, envia_arca, es_default')
          .eq('empresa_id', user.empresa_id).eq('activo', true).order('numero')
          .then(({ data: pvs }) => {
            setPuntosVenta(pvs ?? []);
            const porDefecto = pvs?.find(p => p.es_default) ?? pvs?.find(p => p.envia_arca) ?? null;
            setPuntoVentaId(prev => prev || (porDefecto?.id ?? ''));
            if (porDefecto) setAfipConfig({ ...emp, punto_venta: porDefecto });
          });
      });

    // Pre-carga desde Pedido (flujo "Facturar Pedido/Entrega" del ERP).
    // pedido_items.precio_unitario es SIN descontar (mismo criterio que
    // ordenes_compra_items/cotizacion_items) y descuento_item es el % —
    // exactamente el shape que espera item.precio_unit/descuento_pct acá.
    if (pedido?.id) {
      setClienteId(pedido.cliente_id || '');
      setReferenciaCliente(pedido.referencia_cliente || '');
      if (pedido.pedido_items?.length > 0) {
        setItems(pedido.pedido_items.map(i => ({
          _id:           Math.random().toString(36).slice(2),
          producto_id:   i.producto_id,
          descripcion:   i.descripcion || '',
          cantidad:      Number(i.cantidad),
          precio_unit:   Number(i.precio_unitario),
          descuento_pct: Number(i.descuento_item) || 0,
          alicuota_iva:  Number(i.alicuota_iva ?? 21),
        })));
      }
    } else if (comprobanteOrigen?.id) {
      // Pre-carga desde comprobante origen (flujo "Duplicar" — Fase 5, 15/08:
      // única llamadora real hoy). tipoDoc/puntoVentaId se copian como DEFAULT
      // editable — el duplicado nunca hereda cae/cae_estado/numero_afip (nunca
      // se insertan acá, se computan de cero al confirmar), pero si el usuario
      // no toca nada sale con el mismo tipo de comprobante y PdV que el
      // original, y arranca su propio trámite de CAE si el PdV lo requiere.
      setClienteId(comprobanteOrigen.cliente_id || '');
      setReferenciaCliente(comprobanteOrigen.referencia_cliente || '');
      if (comprobanteOrigen.tipo_comprobante_afip) {
        setTipoDoc(`Factura ${comprobanteOrigen.tipo_comprobante_afip}`);
      }
      if (comprobanteOrigen.punto_venta_id) {
        setPuntoVentaId(comprobanteOrigen.punto_venta_id);
      }
      supabase.from('comprobante_items')
        .select('id, producto_id, descripcion, cantidad, precio_unitario, alicuota_iva, descuento_pct, productos(nombre)')
        .eq('comprobante_id', comprobanteOrigen.id)
        .eq('empresa_id', user.empresa_id)
        .then(({ data }) => {
          if (data?.length > 0) {
            setItems(data.map(i => ({
              _id:           Math.random().toString(36).slice(2),
              producto_id:   i.producto_id,
              descripcion:   i.descripcion || i.productos?.nombre || '',
              cantidad:      Number(i.cantidad),
              precio_unit:   Number(i.precio_unitario),
              descuento_pct: Number(i.descuento_pct) || 0,
              alicuota_iva:  Number(i.alicuota_iva ?? 21),
            })));
          }
        });
    }
  }, [open, user?.empresa_id, comprobanteOrigen?.id, pedido?.id]);

  // ── Reset al cerrar ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setClienteId('');
      setFecha(getTodayAR());
      setReferenciaCliente('');
      setTipoDoc('Ticket');
      setFormaPago('Efectivo');
      setItems([newItem()]);
      setSearchFocusId(null);
      setAfipConfig(null);
      setPuntoVentaId(''); // vuelve a resolver el PdV por defecto al reabrir
      setCentroCostoId('');
    }
  }, [open]);

  // ── Búsqueda de productos inline ────────────────────────────────────────────
  const loadProductos = async () => {
    if (productosCache.length > 0) return;
    const { data } = await supabase.from('productos')
      .select('id, nombre, precio_venta, alicuota_iva, stock_actual')
      .eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre').limit(500);
    setProductosCache(data || []);
  };

  const getProductosFiltrados = (query) => {
    if (!query || query.length < 2) return [];
    return productosCache
      .filter(p => p.nombre.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8);
  };

  const selectProducto = (rowId, producto) => {
    setItems(prev => prev.map(i =>
      i._id === rowId
        ? { ...i, producto_id: producto.id, descripcion: producto.nombre,
            precio_unit: Number(producto.precio_venta || 0),
            alicuota_iva: Number(producto.alicuota_iva ?? 21) }
        : i
    ));
    setSearchFocusId(null);
    // Después de elegir producto (click o Enter) pasa el foco a Cantidad —
    // mismo patrón que Cotización/Pedido/OC: sin esto, Tab volvía a arrancar
    // desde el primer campo del formulario en vez de seguir en la fila.
    cantRefs.current[rowId]?.focus();
    cantRefs.current[rowId]?.select?.();
  };

  const updateItem = (id, field, value) => {
    setItems(prev => prev.map(i => i._id === id ? { ...i, [field]: value } : i));
  };
  const removeItem = (id) => setItems(prev => prev.filter(i => i._id !== id));
  const addItem    = ()   => setItems(prev => [...prev, newItem()]);

  // ── Atajo Enter (14/08, Fase 2 — mismo patrón que Cotización/Pedido/OC) ────
  // Enter en cualquier campo de una fila agrega la siguiente y le pasa el foco
  // a su Descripción. En Descripción, si el desplegable de búsqueda está
  // abierto con resultados, Enter elige el primero en vez de agregar fila —
  // si no, el atajo "Enter agrega fila" le gana al gesto natural de confirmar
  // la sugerencia y el ítem queda como texto libre sin producto vinculado.
  const descRefs = useRef({});
  const cantRefs = useRef({});
  const prevItemsLength = useRef(items.length);
  useEffect(() => {
    // Bug real encontrado 15/08 (Frente 1): con `> prevItemsLength.current`
    // esto también se disparaba al precargar de golpe los ítems de un pedido
    // (1 → 3, por ejemplo) — el foco saltaba solo al ÚLTIMO ítem y le abría
    // el desplegable de autocompletar sin que el usuario tocara nada. Ahora
    // solo enfoca cuando la lista creció de a UNO (el caso real: clic en
    // "Agregar ítem"), nunca en una carga masiva.
    if (items.length === prevItemsLength.current + 1) {
      const ultimoId = items[items.length - 1]._id;
      descRefs.current[ultimoId]?.focus();
    }
    prevItemsLength.current = items.length;
  }, [items.length, items]);

  const handleItemRowKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addItem(); }
  };

  const handleDescripcionKeyDown = (item) => (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const filtrados = searchFocusId === item._id ? getProductosFiltrados(item.descripcion) : [];
    if (filtrados.length > 0) { selectProducto(item._id, filtrados[0]); return; }
    addItem();
  };

  // ── Cálculos ────────────────────────────────────────────────────────────────
  // total = suma de calcBruto (lo que realmente paga el cliente) — subtotalNeto
  // e totalIva son el desglose de ESE total, no un extra a sumarle encima.
  const subtotalNeto = useMemo(() => items.reduce((s, i) => s + calcNetoIva(i).neto, 0), [items]);
  const totalIva     = useMemo(() => items.reduce((s, i) => s + calcNetoIva(i).iva, 0), [items]);
  const total        = useMemo(() => items.reduce((s, i) => s + calcBruto(i), 0), [items]);
  // Precio de lista SIN descuento — mismo criterio que CotizacionPDF.jsx, para
  // poder mostrar "Descuento" como línea propia (antes quedaba invisible, el
  // descuento por línea ni se guardaba — bug real corregido 13/08).
  const subtotalBruto = useMemo(() => items.reduce((s, i) => s + Number(i.cantidad) * (parseNumberLocale(i.precio_unit) || 0), 0), [items]);
  const descuento     = Math.max(0, subtotalBruto - total);
  const descuentoPct  = subtotalBruto > 0 ? (descuento / subtotalBruto) * 100 : 0;
  const isCC         = formaPago === 'Cuenta Corriente';

  // ── Generación de número correlativo ────────────────────────────────────────
  const generateNumero = async () => {
    // mig.295: numeración por PdV (sólo si el PdV elegido no es el default).
    const { data, error } = await supabase.rpc('obtener_proximo_numero', {
      p_empresa_id: user.empresa_id,
      p_tipo_documento: 'factura',
      p_punto_venta_id: puntoVentaId || null,
    });
    if (error) throw error;
    return data;
  };

  // ── Confirmar ───────────────────────────────────────────────────────────────
  const handleConfirmar = async () => {
    if (!clienteId && isCC) {
      toast({ title: 'Cliente requerido para Cuenta Corriente', variant: 'destructive' });
      return;
    }
    const itemsValidos = items.filter(i => i.descripcion.trim());
    if (itemsValidos.length === 0) {
      toast({ title: 'Agregá al menos un ítem con descripción', variant: 'destructive' });
      return;
    }
    if (total <= 0) {
      toast({ title: 'El total debe ser mayor a cero', variant: 'destructive' });
      return;
    }
    // Regla: solo cobros en Efectivo requieren caja abierta. Transferencia/Tarjeta/CC no.
    if (formaPago === 'Efectivo' && !isSessionOpen) {
      toast({ title: 'Abrí la caja para registrar el cobro en Efectivo', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const numero     = await generateNumero();
      const now        = getNowAR().toISOString();
      const clienteObj = clientes.find(c => c.id === clienteId);
      // Mismo criterio que la RPC crear_venta: vencimiento = fecha de venta + dias_credito
      // del cliente (0/null → vence el mismo día). Se calcula siempre, no solo en CC.
      const fechaVencimiento = addDaysAR(now, clienteObj?.dias_credito ?? 0);

      // Tipo de comprobante AFIP (A/B/C/E o null para Ticket).
      // Se guarda SIEMPRE, sin importar si AFIP está activo, para poder mostrarlo
      // en el historial aunque la factura sea no electrónica.
      const tipoAfipInsert = tipoDoc === 'Ticket' ? null : tipoDoc.replace('Factura ', '');

      let comprobanteId;
      let costoMercaderiaVendida = 0;

      if (pedido?.id) {
        // ── Facturar Pedido/Entrega: una sola llamada transaccional a la RPC
        // crear_venta (misma que usa el POS) — hereda sin duplicar toda la
        // lógica de Document Flow (stock-skip si ya hubo Entrega manual, tope
        // de sobre-facturación, vínculo pedidos/entregas.comprobante_id, COGS).
        // Ver PENDIENTE #1 (14/08) en CONTEXT.md.
        const itemsPayload = itemsValidos.map(i => ({
          producto_id:     i.producto_id || null,
          cantidad:        Number(i.cantidad),
          precio_unitario: parseNumberLocale(i.precio_unit) || 0,
          subtotal:        calcBruto(i),
          alicuota_iva:    String(i.alicuota_iva),
          descuento_pct:   Number(i.descuento_pct) || 0,
        }));
        // Sin CC: un solo pago por el total, mismo forma_pago que eligió el
        // usuario (este modal no tiene multi-pago, a diferencia del POS).
        const pagosPayload = isCC ? [] : [{
          metodo: formaPago, monto: total, monto_paralelo: '', tc_paralelo: '', forma_pago_id: null,
        }];

        const { data: rpcResult, error: rpcError } = await supabase.rpc('crear_venta', {
          p_empresa_id:       user.empresa_id,
          p_user_id:          user.id,
          p_numero_venta:     numero,
          p_fecha:            now,
          p_cliente_id:       clienteId || null,
          p_cliente_nombre:   clienteObj?.nombre ?? 'Consumidor Final',
          p_total:            total,
          p_forma_pago:       formaPago,
          p_estado_pago:      isCC ? 'pendiente' : 'pagada',
          p_moneda:           'ARS',
          p_tipo_cambio_tasa: 1,
          p_monto_paralelo:   null,
          p_tc_paralelo:      null,
          p_items:            itemsPayload,
          p_pagos:            pagosPayload,
          p_es_cc:            isCC,
          p_caja_sesion_id:   currentSession?.id ?? null,
          p_pedido_id:        pedido.id,
          p_monto_moneda_original: null,
          p_centro_costo_id:  centroCostoId || null,
          p_client_uuid:      crypto.randomUUID(),
          p_puntos_canjeados: 0,
          p_tipo_comprobante_afip: tipoAfipInsert,
          p_punto_venta_id:   puntoVentaId || null,
          p_referencia_cliente: referenciaCliente.trim() || null,
        });
        if (rpcError) throw rpcError;

        comprobanteId = rpcResult.comprobante_id;
        costoMercaderiaVendida = rpcResult.costo_mercaderia_vendida || 0;

        // AFIP — crear_venta ya guardó tipo_comprobante_afip/punto_venta_id/
        // referencia_cliente en el INSERT; acá solo se dispara la cola (mismo
        // criterio que el resto del modal: PdV que envía a ARCA y no Ticket).
        const pvElegido = puntosVenta.find(p => p.id === puntoVentaId) ?? null;
        const afipActivo = afipConfig?.usa_factura_electronica && pvElegido?.envia_arca !== false;
        if (afipActivo && pvElegido && tipoDoc !== 'Ticket') {
          const { error: afipQueueErr } = await supabase.from('comprobantes')
            .update({ cae_estado: 'pendiente' })
            .eq('id', comprobanteId);
          if (afipQueueErr) console.warn('[AFIP queue]', afipQueueErr.message);
        }
      } else {
        // 1. INSERT comprobante — sin user_id (no existe en comprobantes)
        const { data: comp, error: compErr } = await supabase.from('comprobantes').insert([{
          empresa_id:            user.empresa_id,
          tenant_id:             user.empresa_id,
          numero_venta:          numero,
          fecha:                 now,
          cliente_id:            clienteId || null,
          cliente_nombre:        clienteObj?.nombre ?? 'Consumidor Final',
          total,
          neto_gravado:          subtotalNeto,
          iva_discriminado:      totalIva,
          forma_pago:            formaPago,
          estado_pago:           isCC ? 'pendiente' : 'pagada',
          moneda:                'ARS',
          tipo_cambio_tasa:      1,
          tipo:                  'venta',
          tipo_comprobante_afip: tipoAfipInsert,
          fecha_vencimiento:     fechaVencimiento,
          relevante_fiscal:      true, // la relevancia la define el PdV, no un flag por documento
          punto_venta_id:        puntoVentaId || null, // se registra siempre, aunque sea PdV interno
          centro_costo_id:       centroCostoId || null,
          referencia_cliente:    referenciaCliente.trim() || null,
          duplicado_de_id:       duplicadoDeId,
        }]).select('id').single();
        if (compErr) throw compErr;
        comprobanteId = comp.id;

        // 2. INSERT comprobante_items — columnas en ESPAÑOL: producto_id, cantidad.
        // producto_id es nullable (mig.256): un ítem de servicio no tiene producto
        // de catálogo, y su descripcion se guarda tal cual la escribió el usuario.
        const { error: itemsErr } = await supabase.from('comprobante_items').insert(
          itemsValidos.map(i => ({
            comprobante_id:  comp.id,
            empresa_id:      user.empresa_id,
            producto_id:     i.producto_id || null,
            descripcion:     i.descripcion.trim(),
            cantidad:        Number(i.cantidad),
            precio_unitario: parseNumberLocale(i.precio_unit) || 0,
            subtotal:        calcBruto(i),
            alicuota_iva:    String(i.alicuota_iva),
            // Bug real encontrado 13/08: el % de descuento se cargaba en la UI y se
            // usaba para calcular calcBruto()/subtotal, pero nunca se guardaba en la
            // columna — quedaba invisible para siempre después de crear la factura.
            descuento_pct:   Number(i.descuento_pct) || 0,
          }))
        );
        if (itemsErr) throw itemsErr;

        // 3. CC → DEBE en cuenta corriente (Open Item)
        if (isCC && clienteId) {
          await supabase.from('cuenta_corriente_movimientos').insert([{
            empresa_id:     user.empresa_id,
            user_id:        user.id,
            cliente_id:     clienteId,
            comprobante_id: comp.id,
            tipo:           'DEBE',
            monto:          total,
            descripcion:    `Factura ${numero}`,
            fecha:          now,
          }]);
        }

        // 4. Cualquier medio no-CC → movimientos_caja (mismo criterio que crear_venta:
        // Efectivo, Tarjeta y Transferencia dejan rastro en caja; caja_sesion_id es
        // nullable a propósito para poder registrar Tarjeta/Transferencia aunque no
        // haya una caja de efectivo abierta — antes solo Efectivo generaba el
        // movimiento, y una factura por Tarjeta/Transferencia quedaba "pagada" sin
        // ningún rastro en movimientos_caja).
        if (!isCC) {
          await supabase.from('movimientos_caja').insert([{
            empresa_id:     user.empresa_id,
            user_id:        user.id,
            caja_sesion_id: currentSession?.id ?? null,
            tipo:           'ingreso',
            categoria:      'Venta',
            concepto:       `Factura ${numero}`,
            monto:          total,
            metodo_pago:    formaPago,
            is_automatic:   true,
            fecha:          now,
            comprobante_id: comp.id,
          }]);
        }

        // 5. AFIP — encolar en facturas_pendientes_arca vía trigger (SAP async posting).
        // El UPDATE a cae_estado='pendiente' dispara fn_queue_factura_arca, que inserta
        // en la cola. El arca-worker (cron */5 * * * *) es la única fuente de verdad
        // para llamar a ARCA — nunca desde el frontend. Si el documento se marcó
        // "no relevante", ni siquiera se intenta (el trigger igual lo bloquearía,
        // pero evitamos el UPDATE innecesario).
        // El PdV elegido decide: si no envía a ARCA, es comprobante interno y no se
        // encola (criterio unificado, mig.294 — ya no hay checkbox aparte).
        const pvElegido = puntosVenta.find(p => p.id === puntoVentaId) ?? null;
        const afipActivo = afipConfig?.usa_factura_electronica && pvElegido?.envia_arca !== false;
        if (afipActivo && pvElegido && tipoDoc !== 'Ticket') {
          const tipoAfip = tipoDoc.replace('Factura ', '');
          const { error: afipQueueErr } = await supabase.from('comprobantes').update({
            tipo_comprobante_afip: tipoAfip,
            punto_venta_id:        pvElegido.id,
            cae_estado:            'pendiente',
          }).eq('id', comp.id);
          if (afipQueueErr) console.warn('[AFIP queue]', afipQueueErr.message);
        }
      }

      // 6. Asiento contable (fire & forget) — incluye COGS cuando la RPC movió
      // stock (siempre 0 en el path standalone, que nunca toca inventario).
      asientosAutoService.crearAsientoVenta(user.empresa_id, user.id, {
        ventaId:     comprobanteId,
        total,
        neto:        subtotalNeto,
        iva:         totalIva,
        fecha:       getTodayAR(),
        descripcion: `Factura ${numero}`,
        esCredito:   isCC,
        centroCostoId: centroCostoId || null,
        costoMercaderiaVendida,
      }).catch(e => {
        if (e.message?.startsWith('Período cerrado:')) {
          toast({ title: 'Asiento contable no generado', description: e.message, variant: 'destructive' });
        } else {
          console.warn('[Contabilidad Factura]', e.message);
        }
      });

      toast({ title: `Factura ${numero} creada correctamente` });
      onSuccess?.({ id: comprobanteId, numero_venta: numero, total });
      onOpenChange(false);
    } catch (err) {
      console.error('[NuevaFactura]', err);
      toast({ title: 'Error al crear factura', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Frente 1 del plan "Facturar Pedido" (PLAN_FACTURAR_PEDIDO_5_FRENTES.md,
  // 15/08): este modal no respetaba la línea de diseño densa estilo SAP que
  // ya tienen FormNuevaCotizacion.jsx/FormNuevaOC.jsx — modal angosto en vez
  // de pantalla casi completa, cabecera aireada en vez de la grilla de 12
  // columnas compacta, buscador de producto con el patrón viejo (`position:
  // absolute` sin portal — el mismo que tenía el bug del desplegable cortado
  // arreglado el 14/08 en los otros 3 formularios, nunca migrado acá), y todo
  // el modal scrolleando junto en vez de que solo la lista de ítems lo haga
  // (con pedidos largos, había que bajar para ver el total y el botón
  // Confirmar). Alineado a los 5 puntos sin tocar handleConfirmar/estado.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="max-w-[96vw] w-[96vw] h-[92vh] bg-kx-surface border-kx-border text-kx-text flex flex-col p-0 gap-0 overflow-hidden"
      >
        <DialogHeader className="px-4 py-3 border-b border-kx-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <FileText className="w-5 h-5 text-kx-violet" />
            {pedido
              ? `Facturar Pedido — ${pedido.numero}`
              : comprobanteOrigen
                ? `Copiar a Factura — ${comprobanteOrigen.numero_venta}`
                : 'Nueva Factura de Venta'}
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            {pedido
              ? 'Ítems pre-cargados desde el pedido. Revisá antes de confirmar.'
              : comprobanteOrigen
                ? 'Ítems pre-cargados desde el comprobante origen. Revisá antes de confirmar.'
                : 'Factura financiera — no afecta stock. Para descontar stock usá el flujo Pedido → Entrega.'}
          </DialogDescription>
        </DialogHeader>

        {/* overflow-y-auto (no -hidden) a propósito: es la red de seguridad para
            pantallas bajas. En el caso normal la lista de Ítems (más abajo)
            scrollea sola y esto no se nota — pero como esa lista tiene
            min-h-0 + flex-1, en una ventana muy baja el navegador la puede
            encoger hasta 0px (bug real encontrado 15/08 probando Frente 1: la
            tarjeta de Ítems —con su botón "Agregar ítem" y todas las filas—
            desaparecía por completo, sin scroll posible, incluso con un solo
            ítem vacío). Con el body scrolleable entero como respaldo y un
            min-height en la tarjeta de Ítems, en el peor caso hay que
            scrollear el modal, pero los ítems nunca quedan inalcanzables. */}
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto p-3">
          {/* Banner informativo + Mapa de relaciones — shrink-0 */}
          <div className="shrink-0 space-y-1.5">
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/30 text-xs text-blue-700 dark:text-blue-300">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {pedido
                  ? <>Vinculada al Pedido <strong>{pedido.numero}</strong>. Si el pedido ya tuvo una Entrega, el stock no se vuelve a descontar; si es la primera vez que se factura, esta factura genera la entrega y descuenta el stock ahora.</>
                  : <>Esta factura <strong>no afecta el inventario</strong>. Para descontar stock, usá el flujo Pedido → Entrega → Facturar lo entregado.</>}
              </span>
            </div>

            {(pedido?.id || comprobanteOrigen?.id) && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setMapaOpen(true)}
                  className="text-2xs text-kx-violet hover:opacity-80 font-medium flex items-center gap-1"
                  title="Ver mapa de relaciones completo"
                >
                  <Network className="w-3.5 h-3.5" /> Mapa de relaciones
                </button>
              </div>
            )}
          </div>

          <MapaRelaciones
            open={mapaOpen}
            onOpenChange={setMapaOpen}
            pedidoId={pedido?.id}
            comprobanteId={!pedido ? comprobanteOrigen?.id : undefined}
          />

          {/* Cabecera — misma densidad (grilla de 12, inputs h-8) que
              FormNuevaCotizacion.jsx/FormNuevaOC.jsx. */}
          <Card className="dark:bg-kx-bg dark:border-kx-border shrink-0">
            <CardContent className="p-3 space-y-2">
              <div className="grid grid-cols-12 gap-3 items-start">
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs dark:text-kx-text">Cliente</Label>
                  <ClienteSelector
                    clientes={clientes}
                    value={clienteId}
                    onChange={setClienteId}
                    onClienteCreado={c => { setClientes(p => [...p, c]); setClienteId(c.id); }}
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs dark:text-kx-text">Tipo de documento</Label>
                  <select
                    value={tipoDoc}
                    onChange={e => setTipoDoc(e.target.value)}
                    className="w-full h-8 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs dark:text-kx-text">Fecha</Label>
                  <Input
                    type="date" value={fecha}
                    onChange={e => setFecha(e.target.value)}
                    className="h-8 text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                  />
                </div>
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs dark:text-kx-text">N° Referencia del Cliente (PO)</Label>
                  <Input
                    value={referenciaCliente}
                    onChange={e => setReferenciaCliente(e.target.value)}
                    placeholder="Ej. orden de compra del cliente"
                    className="h-8 text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                  />
                </div>
                {centrosCosto.length > 0 && (
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs dark:text-kx-text">Centro de costo</Label>
                    <select
                      value={centroCostoId}
                      onChange={e => setCentroCostoId(e.target.value)}
                      className="w-full h-8 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Sin asignar</option>
                      {centrosCosto.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Punto de venta — el único selector fiscal (mig.294). Su
                  envia_arca define si el comprobante se factura ante ARCA o
                  queda interno. */}
              {puntosVenta.length > 0 && tipoDoc !== 'Ticket' && (
                <div className="pt-1 space-y-1.5">
                  <div className="grid grid-cols-12 gap-3 items-start">
                    <div className="col-span-4 space-y-1">
                      <Label className="text-xs dark:text-kx-text">Punto de venta</Label>
                      <select
                        value={puntoVentaId}
                        onChange={e => setPuntoVentaId(e.target.value)}
                        className="w-full h-8 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {puntosVenta.map(pv => (
                          <option key={pv.id} value={pv.id}>
                            {pv.numero} · {pv.nombre}{pv.envia_arca === false ? ' (interno)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {puntosVenta.find(pv => pv.id === puntoVentaId)?.envia_arca === false && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                      Comprobante <strong>interno</strong>: no se emite CAE ni se informa a ARCA.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ítems — solo esta lista scrollea (mismo criterio que Cotización/
              OC/Pedido): cabecera, totales y el botón de confirmar quedan
              siempre a la vista sin tener que bajar todo el modal. */}
          <Card className="dark:bg-kx-bg dark:border-kx-border flex-1 min-h-[220px] flex flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between shrink-0 p-3">
              <CardTitle className="text-sm dark:text-kx-text">Ítems</CardTitle>
              <Button type="button" size="sm" variant="outline" onClick={addItem}
                className="h-7 text-xs dark:border-kx-border dark:text-slate-300 dark:hover:bg-slate-800">
                <Plus className="w-3.5 h-3.5 mr-1" /> Agregar ítem
              </Button>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden p-3 pt-0">
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                {items.map(item => (
                  <div key={item._id} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4 space-y-1" data-prod-row>
                      <Label className="text-xs dark:text-kx-text-2">Descripción / Producto</Label>
                      <ProductoAutocomplete
                        inputRef={el => { descRefs.current[item._id] = el; }}
                        value={item.descripcion}
                        onChange={e => updateItem(item._id, 'descripcion', e.target.value)}
                        onFocus={() => { setSearchFocusId(item._id); loadProductos(); }}
                        onBlur={() => setTimeout(() => setSearchFocusId(null), 200)}
                        onKeyDown={handleDescripcionKeyDown(item)}
                        placeholder="Descripción o buscar producto..."
                        open={searchFocusId === item._id}
                        results={getProductosFiltrados(item.descripcion)}
                        onSelect={p => selectProducto(item._id, p)}
                        className="h-8 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm"
                      />
                    </div>
                    <div className="col-span-1 space-y-1">
                      <Label className="text-xs dark:text-kx-text-2">Cant.</Label>
                      <Input
                        ref={el => { cantRefs.current[item._id] = el; }}
                        type="number" min="1" step="1" value={item.cantidad}
                        onChange={e => updateItem(item._id, 'cantidad', e.target.value.replace(/[^\d]/g, ''))}
                        onKeyDown={handleItemRowKeyDown}
                        className="h-8 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm text-center"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs dark:text-kx-text-2">Precio Unit.</Label>
                      <Input
                        type="text" inputMode="decimal" placeholder="0,00" value={item.precio_unit}
                        onChange={e => updateItem(item._id, 'precio_unit', e.target.value)}
                        onKeyDown={handleItemRowKeyDown}
                        className="h-8 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm text-right"
                      />
                    </div>
                    <div className="col-span-1 space-y-1">
                      <Label className="text-xs dark:text-kx-text-2">Desc%</Label>
                      <Input
                        type="number" min="0" max="100" step="0.01" value={item.descuento_pct}
                        onChange={e => updateItem(item._id, 'descuento_pct', e.target.value)}
                        onKeyDown={handleItemRowKeyDown}
                        className="h-8 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm text-center"
                      />
                    </div>
                    <div className="col-span-1 space-y-1">
                      <Label className="text-xs dark:text-kx-text-2">IVA</Label>
                      <select
                        value={item.alicuota_iva}
                        onChange={e => updateItem(item._id, 'alicuota_iva', Number(e.target.value))}
                        onKeyDown={handleItemRowKeyDown}
                        className="w-full h-8 px-1.5 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {ALICUOTAS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs dark:text-kx-text-2">Subtotal</Label>
                      <div className="h-8 flex items-center justify-end px-2 text-xs font-semibold text-kx-text tabular-nums">
                        ${fmt(calcBruto(item))}
                      </div>
                    </div>
                    <div className="col-span-1 flex justify-end pb-0.5">
                      {items.length > 1 && (
                        <Button type="button" size="icon" variant="ghost" onClick={() => removeItem(item._id)}
                          className="h-7 w-7 text-kx-text-3 hover:text-kx-red">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Totales + Pago — shrink-0, siempre visibles junto al botón Confirmar. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 shrink-0">
            <div className="bg-kx-surface-2 rounded-xl border border-kx-border p-3 space-y-1.5 text-sm">
              {descuento > 0.005 && (
                <>
                  <div className="flex justify-between text-kx-text-2">
                    <span>Subtotal</span>
                    <span className="tabular-nums">${fmt(subtotalBruto)}</span>
                  </div>
                  <div className="flex justify-between text-kx-red">
                    <span>Descuento ({descuentoPct.toFixed(descuentoPct % 1 === 0 ? 0 : 1)}%)</span>
                    <span className="tabular-nums">-${fmt(descuento)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-kx-text-2">
                <span>Subtotal neto</span>
                <span className="tabular-nums">${fmt(subtotalNeto)}</span>
              </div>
              {totalIva > 0 && (
                <div className="flex justify-between text-kx-text-2">
                  <span>IVA</span>
                  <span className="tabular-nums">${fmt(totalIva)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-base text-kx-text border-t border-kx-border pt-2 mt-2">
                <span>TOTAL</span>
                <span className="tabular-nums text-kx-green">${fmt(total)}</span>
              </div>
            </div>

            <div className="bg-kx-surface-2 rounded-xl border border-kx-border p-3 space-y-2">
              <Label className="text-xs font-medium text-kx-text-2 block">Forma de pago</Label>
              <div className="grid grid-cols-2 gap-2">
                {FORMAS_PAGO.map(fp => (
                  <button
                    key={fp}
                    type="button"
                    onClick={() => setFormaPago(fp)}
                    className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                      formaPago === fp
                        ? 'border-[rgb(var(--kx-violet))] bg-[rgb(var(--kx-violet)/0.08)] text-[rgb(var(--kx-violet))]'
                        : 'border-kx-border text-kx-text-2 hover:bg-kx-surface hover:border-kx-text-3'
                    }`}
                  >
                    {fp}
                  </button>
                ))}
              </div>
              {isCC && (
                <div className="flex items-center gap-1.5 text-xs text-kx-amber">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Genera deuda en cuenta corriente del cliente
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="px-4 py-3 border-t border-kx-border shrink-0">
          <div className="flex gap-3 w-full justify-between">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}
              className="border-kx-border text-kx-text-2 hover:bg-kx-surface-2">
              Cancelar
            </Button>
            <Button onClick={handleConfirmar} disabled={loading || total <= 0}
              className="bg-[rgb(var(--kx-violet))] hover:opacity-90 text-white gap-2">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Creando...</>
                : <><FileText className="w-4 h-4" /> Crear Factura</>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NuevaFacturaModal;
