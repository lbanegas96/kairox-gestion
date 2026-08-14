import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { cotizacionesService, COTIZACIONES_KEYS } from '@/services/cotizacionesService';
import { supabase } from '@/lib/customSupabaseClient';
import NuevaVentaModal from '@/components/ventas/NuevaVentaModal';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { EMPTY_ITEM } from '@/components/cotizaciones/shared';
import TablaCotizaciones from '@/components/cotizaciones/TablaCotizaciones';
import FormNuevaCotizacion from '@/components/cotizaciones/FormNuevaCotizacion';
import ModalDetalleCotizacion from '@/components/cotizaciones/ModalDetalleCotizacion';
import MapaRelaciones from '@/components/shared/MapaRelaciones';
import { determinarTipoComprobante } from '@/hooks/useAfipConfig';

// precio_unitario es SIEMPRE el precio final que paga el cliente (IVA incluido) —
// mismo criterio que NuevaFacturaModal/crear_venta (Ley de Defensa del Consumidor:
// el precio que se muestra es el precio final). Para separar neto/IVA hay que
// DIVIDIR por el factor de la alícuota, nunca sumarlo — sumarlo duplica el IVA.
const FACTOR_IVA = { '21': 1.21, '10.5': 1.105 }; // resto (exento/0/no_gravado) → factor 1
// Bug real encontrado por revisión automática (13/08): sin esto, un typo como "150" en vez
// de "15" en un % de descuento producía un total negativo en el resumen (y persistido, si
// no fuera por el clamp del lado del servidor en actualizar_cotizacion/create()). Recibe
// un número ya parseado (usar junto con parseNumberLocale).
const clampPct = (n) => Math.min(100, Math.max(0, n || 0));

function CotizacionesSection({ onNavigateToSale, onCopiarAPedido, onVerPedido, onVerEntrega, navigateCotizacionId, onNavigated } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [estadoFiltro, setEstadoFiltro] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Form state
  const [form, setForm] = useState({
    cliente_id: '',
    cliente_nombre: '',
    notas: '',
    condiciones_pago: '',
    fecha_vencimiento: '',
    moneda: 'ARS',
    tipoCambioTasa: 1,
    descuento: '',
  });
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [prodSearch, setProdSearch] = useState({});
  const [prodResults, setProdResults] = useState({});
  const [prodOpen, setProdOpen] = useState({});  // qué fila tiene el dropdown abierto

  // Edición (12/08, pedido de Luciano): mismo form/items que "Nueva Cotización" — al editar,
  // se prefillean acá y el modal reusa el mismo componente. null = modo creación.
  const [editingId, setEditingId] = useState(null);

  const [showClienteDropdown, setShowClienteDropdown] = useState(false);
  const clienteWrapperRef = useRef(null);

  // Detail modal
  const [viewId, setViewId] = useState(null);

  // Mapa de relaciones (Fase 3, PLAN_MAPA_RELACIONES.md)
  const [mapaCotId, setMapaCotId] = useState(null);
  const [isMapaOpen, setIsMapaOpen] = useState(false);

  // Conversión a venta
  const [convertirCot, setConvertirCot] = useState(null);  // cotización completa para convertir
  const [showVentaModal, setShowVentaModal] = useState(false);

  // Copiar a Pedido cuando la cotización YA generó uno — SAP B1 permite copiar
  // varias veces (una cotización puede entregarse en tandas), pero siempre avisa
  // antes; sin el aviso se generaban pedidos duplicados sin que nadie se entere
  // (bug real reportado por Luciano, 13/08).
  const [copiarDuplicado, setCopiarDuplicado] = useState(null);

  // Bloqueo por tipo de cambio faltante
  const [tcMissing, setTcMissing] = useState(false);

  const empresaId = user?.empresa_id;

  // Navegación desde el Flujo del Documento de otra sección (ej. Pedido → Cotización de origen)
  useEffect(() => {
    if (navigateCotizacionId) {
      setViewId(navigateCotizacionId);
      onNavigated?.();
    }
  }, [navigateCotizacionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Productos y clientes para autocompletar
  const { data: allProducts = [] } = useQuery({
    queryKey: ['cotizaciones_productos_autocomplete', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from('productos').select('id, nombre, precio_venta, unidad_medida, alicuota_iva').eq('empresa_id', empresaId).eq('activo', true).order('nombre').limit(200);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  const { data: allClientes = [] } = useQuery({
    queryKey: ['cotizaciones_clientes_autocomplete', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clientes').select('id, nombre, condicion_pago_id, condicion_iva').eq('empresa_id', empresaId).order('nombre').limit(500);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  // Condición de IVA de la propia empresa — determina, junto con la del cliente
  // elegido, si la cotización va a discriminar IVA (Factura A) o no (B/C) el día
  // que se convierta — mismo determinarTipoComprobante() que ya usan las facturas
  // reales, no una opción manual aparte que se pueda desincronizar de la ley.
  const { data: empresaCondicionIva } = useQuery({
    queryKey: ['empresa_condicion_iva', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from('empresas').select('condicion_iva').eq('id', empresaId).single();
      if (error) throw error;
      return data?.condicion_iva ?? null;
    },
    enabled: !!empresaId,
  });

  const { data: condicionesPago = [] } = useQuery({
    queryKey: ['condiciones_pago', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('condiciones_pago')
        .select('id, nombre, dias_credito, descuento_pct')
        .eq('empresa_id', empresaId)
        .eq('activo', true)
        .order('dias_credito');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  // Condición de pago por defecto: la de 30 días si existe, si no la primera del maestro
  const condicionPagoDefault = () => {
    if (condicionesPago.length === 0) return '';
    return (condicionesPago.find(c => c.dias_credito === 30) ?? condicionesPago[0]).nombre;
  };

  useEffect(() => {
    if (form.condiciones_pago || condicionesPago.length === 0) return;
    setForm(f => (f.condiciones_pago ? f : { ...f, condiciones_pago: condicionPagoDefault() }));
  }, [condicionesPago]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cliente por defecto: "Consumidor Final" (cliente real en la base, no texto
  // libre) — evita el paso extra de tener que buscarlo a mano en cada cotización
  // nueva, igual que ya hace el POS. El usuario puede borrarlo y tipear otro.
  const clienteFinalDefault = () =>
    allClientes.find(c => c.nombre?.trim().toLowerCase() === 'consumidor final') ?? null;

  useEffect(() => {
    if (form.cliente_id || form.cliente_nombre || allClientes.length === 0) return;
    const cf = clienteFinalDefault();
    if (cf) setForm(f => (f.cliente_id || f.cliente_nombre) ? f : { ...f, cliente_id: cf.id, cliente_nombre: cf.nombre });
  }, [allClientes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cerrar dropdowns al hacer click afuera
  useEffect(() => {
    const onClick = (e) => {
      if (clienteWrapperRef.current && !clienteWrapperRef.current.contains(e.target)) {
        setShowClienteDropdown(false);
      }
      if (!e.target.closest('[data-prod-row]')) {
        setProdOpen({});
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const { data: listData, isLoading } = useQuery({
    queryKey: COTIZACIONES_KEYS.list(empresaId, { estado: estadoFiltro, page }),
    queryFn: () => cotizacionesService.getAll(empresaId, { estado: estadoFiltro || undefined, page }),
    enabled: !!empresaId,
  });

  const { data: detalle } = useQuery({
    queryKey: COTIZACIONES_KEYS.detail(viewId),
    queryFn: () => cotizacionesService.getById(viewId),
    enabled: !!viewId,
  });

  const { data: unidadesMedida = [] } = useQuery({
    queryKey: ['unidades_medida', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('unidades_medida')
        .select('*')
        .eq('empresa_id', empresaId)
        .eq('activo', true)
        .order('codigo');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  const createMutation = useMutation({
    mutationFn: (payload) => cotizacionesService.create(empresaId, user.id, payload),
    onSuccess: (cot) => {
      qc.invalidateQueries({ queryKey: ['cotizaciones', empresaId] });
      toast({ title: 'Cotización creada', className: 'bg-green-600 text-white' });
      setIsModalOpen(false);
      resetForm();
      // Mostrar el draft recién creado en vez de solo cerrar el modal — el usuario
      // quiere confirmar de un vistazo qué quedó guardado antes de seguir.
      setViewId(cot.id);
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => cotizacionesService.update(id, payload),
    onSuccess: (cot) => {
      qc.invalidateQueries({ queryKey: ['cotizaciones', empresaId] });
      qc.invalidateQueries({ queryKey: ['cotizacion'] });
      toast({ title: 'Cotización actualizada', className: 'bg-green-600 text-white' });
      setIsModalOpen(false);
      resetForm();
      setViewId(cot.id);
    },
    onError: (e) => toast({ title: 'Error al guardar los cambios', description: e.message, variant: 'destructive' }),
  });

  const estadoMutation = useMutation({
    mutationFn: ({ id, estado }) => cotizacionesService.updateEstado(id, estado),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cotizaciones', empresaId] });
      // COTIZACIONES_KEYS.detail() usa la clave singular 'cotizacion' (no
      // 'cotizaciones') — sin esto, el modal de detalle abierto (que lee de esa
      // clave) nunca se refresca tras cambiar el estado, aunque el cambio sí se
      // haya guardado bien en la base. Bug real encontrado por Luciano probando
      // "Marcar como enviada" en vivo (11/08): el estado cambiaba en la DB pero
      // el modal seguía mostrando "Borrador" — parecía que el botón no hacía nada.
      qc.invalidateQueries({ queryKey: ['cotizacion'] });
    },
    onError: (e) => toast({ title: 'Error al cambiar estado', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => cotizacionesService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cotizaciones', empresaId] });
      toast({ title: 'Cotización eliminada' });
    },
  });

  const convertirMutation = useMutation({
    mutationFn: ({ cotizacionId, comprobanteId }) =>
      cotizacionesService.convertir(cotizacionId, comprobanteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cotizaciones', empresaId] });
      qc.invalidateQueries({ queryKey: ['cotizacion'] });
      toast({ title: '✅ Cotización convertida en venta', className: 'bg-green-600 text-white' });
    },
    onError: (e) => toast({ title: 'Error al convertir', description: e.message, variant: 'destructive' }),
  });

  const handleConvertirClick = async (cot) => {
    // Cargar detalle completo (con items) antes de abrir el modal
    const detalle = await cotizacionesService.getById(cot.id);
    setConvertirCot(detalle);
    setShowVentaModal(true);
  };

  const handleConvertSuccess = (comprobanteId) => {
    if (convertirCot) {
      convertirMutation.mutate({ cotizacionId: convertirCot.id, comprobanteId });
      setConvertirCot(null);
    }
  };

  const resetForm = () => {
    const cf = clienteFinalDefault();
    setForm({
      cliente_id: cf?.id ?? '', cliente_nombre: cf?.nombre ?? '',
      notas: '', condiciones_pago: condicionPagoDefault(), fecha_vencimiento: '',
      moneda: 'ARS', tipoCambioTasa: 1, descuento: '',
    });
    setItems([{ ...EMPTY_ITEM }]);
    setProdSearch({});
    setProdResults({});
    setProdOpen({});
    setTcMissing(false);
    setEditingId(null);
  };

  // "Editar" desde el detalle (solo se ofrece si estado !== 'convertida', ver
  // ModalDetalleCotizacion) — reusa el mismo form/items/modal de "Nueva
  // Cotización" en vez de duplicar toda esa UI.
  const handleEditarClick = async (cot) => {
    const full = await cotizacionesService.getById(cot.id);
    setProdSearch({});
    setProdResults({});
    setProdOpen({});
    setForm({
      cliente_id: full.cliente_id ?? '',
      cliente_nombre: full.cliente_nombre ?? full.clientes?.nombre ?? '',
      notas: full.notas ?? '',
      condiciones_pago: full.condiciones_pago ?? '',
      fecha_vencimiento: full.fecha_vencimiento ?? '',
      moneda: full.moneda ?? 'ARS',
      tipoCambioTasa: full.tipo_cambio_tasa ?? 1,
      descuento: full.descuento ? String(full.descuento) : '',
    });
    setItems((full.cotizacion_items ?? []).map(i => ({
      id: i.id,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      descuento_item: i.descuento_item || '',
      producto_id: i.producto_id,
      unidad_medida: i.unidad_medida ?? '',
      alicuota_iva: i.alicuota_iva ?? '21',
    })));
    setEditingId(full.id);
    setViewId(null);
    setIsModalOpen(true);
  };

  // Bug real encontrado por Luciano (12/08): el combo cortaba a 10 resultados
  // incluso con el buscador vacío — con Nalux teniendo 17 productos activos,
  // 7 nunca aparecían al abrir el campo sin tipear nada. Subido a 50 (cubre
  // catálogos chicos/medianos enteros); si algún día hay más de 50 productos,
  // el filtro por texto ya reduce la lista antes de llegar a ese tope.
  const searchProducto = (idx, q) => {
    setProdSearch(prev => ({ ...prev, [idx]: q }));
    const query = (q ?? '').toLowerCase().trim();
    const filtered = query
      ? allProducts.filter(p => p.nombre.toLowerCase().includes(query)).slice(0, 50)
      : allProducts.slice(0, 50);
    setProdResults(prev => ({ ...prev, [idx]: filtered }));
  };

  const selectProducto = (idx, prod) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], producto_id: prod.id, descripcion: prod.nombre, precio_unitario: prod.precio_venta ?? '', unidad_medida: prod.unidad_medida ?? '', alicuota_iva: prod.alicuota_iva ?? '21' };
    setItems(updated);
    setProdSearch(prev => ({ ...prev, [idx]: prod.nombre }));
    setProdResults(prev => ({ ...prev, [idx]: [] }));
    setProdOpen(prev => ({ ...prev, [idx]: false }));
  };

  const updateItem = (idx, field, value) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    setItems(updated);
  };

  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  // Letra probable (A/B/C) — misma función que ya deciden las facturas reales,
  // nunca una opción manual aparte. Determina si se discrimina IVA (solo "A")
  // o se muestra únicamente el total (B/C), igual que el PDF real terminará
  // mostrando el día que esta cotización se convierta en factura.
  const clienteSeleccionado = allClientes.find(c => c.id === form.cliente_id);
  const letra = determinarTipoComprobante(empresaCondicionIva, clienteSeleccionado?.condicion_iva ?? 'CF');
  const discrimina = letra === 'A';

  const totales = items.reduce((acc, i) => {
    const cant = parseInt(i.cantidad) || 0;
    const precio = parseNumberLocale(i.precio_unitario) || 0;
    const descPct = clampPct(parseNumberLocale(i.descuento_item) || 0);
    // "subtotal" es precio de lista sin ningún descuento (cant × precio) —
    // mismo criterio que ya usa CotizacionPDF.jsx para poder mostrar una línea
    // de "Descuento" que sume línea + global. Antes acá "subtotal" ya venía
    // con el descuento por línea aplicado en silencio, así que un ítem con
    // % Desc. > 0 no dejaba ningún rastro visible en los totales (bug real
    // reportado por Luciano 13/08).
    const brutoLista = cant * precio;
    const brutoConDescLinea = brutoLista * (1 - descPct / 100);
    const factor = FACTOR_IVA[i.alicuota_iva] ?? 1;
    const neto = brutoConDescLinea / factor;
    acc.subtotal += brutoLista;
    acc.subtotalConDescLinea += brutoConDescLinea;
    acc.subtotalNeto += neto;
    acc.subtotalIva += brutoConDescLinea - neto;
    return acc;
  }, { subtotal: 0, subtotalConDescLinea: 0, subtotalNeto: 0, subtotalIva: 0 });
  // Descuento global se aplica DESPUÉS de los descuentos por línea (mismo orden
  // que SAP), y se escala proporcionalmente sobre neto/IVA ya calculados — así
  // neto + iva sigue dando exacto el total, sin importar cuántas alícuotas
  // distintas se mezclen en los ítems.
  const descuentoGlobalPct = clampPct(parseNumberLocale(form.descuento) || 0);
  const factorDescGlobal = 1 - descuentoGlobalPct / 100;
  totales.total = totales.subtotalConDescLinea * factorDescGlobal;
  totales.neto = totales.subtotalNeto * factorDescGlobal;
  totales.iva = totales.subtotalIva * factorDescGlobal;
  // Descuento mostrado = TODO lo que se restó del precio de lista (línea + global
  // combinados), no solo el % global — así una línea con descuento propio y
  // 0% global ya no queda invisible en el resumen.
  totales.descuento = totales.subtotal - totales.total;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (items.every(i => !i.descripcion)) {
      toast({ title: 'Agrega al menos un ítem', variant: 'destructive' }); return;
    }
    if (form.moneda !== 'ARS' && tcMissing) {
      toast({
        title: 'Falta el tipo de cambio del día',
        description: `Cargá la tasa de ${form.moneda} para hoy antes de guardar la cotización.`,
        variant: 'destructive',
      });
      return;
    }
    const validItems = items
      .map(i => ({
        ...i,
        cantidad: parseInt(i.cantidad) || 0,
        precio_unitario: parseNumberLocale(i.precio_unitario) || 0,
        descuento_item: parseNumberLocale(i.descuento_item) || 0,
      }))
      .filter(i => i.descripcion && i.cantidad > 0 && i.precio_unitario > 0);
    if (validItems.length === 0) {
      return toast({ title: 'Ítems inválidos', description: 'Revisá cantidades y precios (usar coma para decimales).', variant: 'destructive' });
    }
    // Bug real encontrado por revisión automática (13/08): un ítem con descripción pero
    // cantidad/precio inválido (ej. el usuario borró el precio sin querer al editar) se
    // sacaba en silencio de validItems — y al EDITAR, el diffing de la RPC lo interpreta
    // como "se sacó" y lo BORRA de la cotización real, sin ningún aviso. Ahora bloquea el
    // guardado entero con un error claro en vez de perder la línea calladamente.
    const conDescripcionSinValidar = items.filter(i => i.descripcion?.trim()).length - validItems.length;
    if (conDescripcionSinValidar > 0) {
      return toast({
        title: 'Hay ítems con datos incompletos',
        description: `${conDescripcionSinValidar === 1 ? 'Un ítem tiene' : `${conDescripcionSinValidar} ítems tienen`} cantidad o precio vacío/en cero — completalo o quitalo con la papelera antes de guardar.`,
        variant: 'destructive',
      });
    }
    const payload = {
      cliente: form.cliente_nombre ? { id: form.cliente_id || null, nombre: form.cliente_nombre } : null,
      items: validItems,
      notas: form.notas,
      condicionesPago: form.condiciones_pago,
      fechaVencimiento: form.fecha_vencimiento || null,
      moneda: form.moneda,
      tipoCambioTasa: form.tipoCambioTasa,
      descuentoGlobal: descuentoGlobalPct,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const filteredData = (listData?.data ?? []).filter(c =>
    !search || c.numero?.includes(search) || (c.cliente_nombre ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <FileText className="w-6 h-6 text-kx-blue" /> Cotizaciones
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-1">
            Genera presupuestos y convierte en ventas
          </p>
        </div>
        <Button onClick={() => { resetForm(); setIsModalOpen(true); }} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
          <Plus className="w-4 h-4" /> Nueva Cotización
        </Button>
      </div>

      <TablaCotizaciones
        search={search} setSearch={setSearch}
        estadoFiltro={estadoFiltro} setEstadoFiltro={setEstadoFiltro} setPage={setPage}
        isLoading={isLoading} filteredData={filteredData}
        listData={listData} page={page}
        setViewId={setViewId} estadoMutation={estadoMutation} deleteMutation={deleteMutation}
        handleConvertirClick={handleConvertirClick} onNavigateToSale={onNavigateToSale} onVerPedido={onVerPedido}
        onOpenMapa={(id) => { setMapaCotId(id); setIsMapaOpen(true); }}
      />

      <MapaRelaciones
        open={isMapaOpen}
        onOpenChange={setIsMapaOpen}
        cotizacionId={mapaCotId}
        onNavigate={(tipo, id) => {
          if (tipo === 'comprobante') onNavigateToSale?.(id);
          else if (tipo === 'pedido') onVerPedido?.(id);
          else if (tipo === 'entrega') onVerEntrega?.(id);
        }}
      />

      {/* MODAL NUEVA COTIZACIÓN — pantalla completa (mismo criterio de tamaño que
          el fullscreen de MapaRelaciones) para que el cuerpo de ítems tenga lugar
          real y los botones de abajo no dependan de escrollear todo el diálogo. */}
      <Dialog open={isModalOpen} onOpenChange={v => { if (!v) { setIsModalOpen(false); setEditingId(null); } }}>
        <DialogContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="max-w-[96vw] w-[96vw] h-[92vh] flex flex-col dark:bg-kx-bg dark:border-kx-border"
        >
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="dark:text-kx-text">{editingId ? 'Editar Cotización' : 'Nueva Cotización'}</DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              {editingId ? 'Modificá los datos y guardá los cambios.' : 'Cargá los ítems y datos de la cotización.'}
            </DialogDescription>
          </DialogHeader>
          <FormNuevaCotizacion
            form={form} setForm={setForm}
            items={items} addItem={addItem} removeItem={removeItem} updateItem={updateItem}
            prodSearch={prodSearch} prodResults={prodResults} prodOpen={prodOpen} setProdOpen={setProdOpen}
            searchProducto={searchProducto} selectProducto={selectProducto}
            unidadesMedida={unidadesMedida}
            condicionesPago={condicionesPago}
            allClientes={allClientes} showClienteDropdown={showClienteDropdown}
            setShowClienteDropdown={setShowClienteDropdown} clienteWrapperRef={clienteWrapperRef}
            tcMissing={tcMissing} setTcMissing={setTcMissing}
            totales={totales} discrimina={discrimina}
            handleSubmit={handleSubmit} resetForm={resetForm}
            onCancel={() => { setIsModalOpen(false); setEditingId(null); }}
            createMutation={editingId ? updateMutation : createMutation}
            isEditing={!!editingId}
          />
        </DialogContent>
      </Dialog>

      {/* MODAL CONVERTIR EN VENTA */}
      <NuevaVentaModal
        isOpen={showVentaModal}
        onOpenChange={(open) => { setShowVentaModal(open); if (!open) setConvertirCot(null); }}
        cotizacion={convertirCot}
        onConvertSuccess={handleConvertSuccess}
      />

      {/* MODAL DETALLE */}
      <ModalDetalleCotizacion
        viewId={viewId} setViewId={setViewId} detalle={detalle}
        onCopiarAPedido={onCopiarAPedido ? async (cot) => {
          // Se relee de la base en vez de confiar en cot.pedidos: el pedido puede
          // haberse creado en esta misma sesión desde la pestaña Pedidos, que no
          // invalida la query de la cotización.
          const { data: yaCopiada } = await supabase
            .from('pedidos')
            .select('id, numero')
            .eq('cotizacion_id', cot.id)
            .eq('empresa_id', empresaId)
            .neq('estado', 'cancelado');
          if ((yaCopiada ?? []).length > 0) { setCopiarDuplicado({ ...cot, pedidos: yaCopiada }); return; }
          setViewId(null);
          onCopiarAPedido(cot);
        } : undefined}
        onCancelar={(id) => { estadoMutation.mutate({ id, estado: 'cancelada' }); setViewId(null); }}
        onVerPedido={onVerPedido ? (id) => { setViewId(null); onVerPedido(id); } : undefined}
        onCambiarEstado={(id, estado) => estadoMutation.mutate({ id, estado })}
        onEditar={handleEditarClick}
        discrimina={detalle ? determinarTipoComprobante(empresaCondicionIva, detalle.clientes?.condicion_iva ?? 'CF') === 'A' : false}
      />

      {/* Aviso de copia duplicada — no bloquea (SAP B1 permite copiar en tandas),
          pero obliga a que sea una decisión consciente. */}
      <AlertDialog open={!!copiarDuplicado} onOpenChange={v => !v && setCopiarDuplicado(null)}>
        <AlertDialogContent className="dark:bg-kx-bg dark:border-kx-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="dark:text-kx-text">Esta cotización ya generó un pedido</AlertDialogTitle>
            <AlertDialogDescription className="dark:text-kx-text-2">
              {(copiarDuplicado?.pedidos ?? []).length === 1
                ? <>La cotización <strong>{copiarDuplicado?.numero}</strong> ya fue copiada al pedido <strong>{copiarDuplicado?.pedidos?.[0]?.numero}</strong>.</>
                : <>La cotización <strong>{copiarDuplicado?.numero}</strong> ya fue copiada a <strong>{(copiarDuplicado?.pedidos ?? []).length} pedidos</strong>.</>}
              {' '}Si continuás se creará un pedido nuevo y adicional, no se modificará el existente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="dark:text-kx-text dark:border-kx-border">Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const cot = copiarDuplicado;
                setCopiarDuplicado(null);
                setViewId(null);
                onCopiarAPedido?.(cot);
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Crear otro pedido igual
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default CotizacionesSection;
