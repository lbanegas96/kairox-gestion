import { useState, useEffect } from 'react';

import ReporteParidad from '@/components/reportes/ReporteParidad';
import ReporteLibroIVA from '@/components/reportes/ReporteLibroIVA';
import ReporteLibroIVACompras from '@/components/reportes/ReporteLibroIVACompras';
import ReporteEstadoResultadosCC from '@/components/reportes/ReporteEstadoResultadosCC';
import ReporteComparativoPeriodos from '@/components/reportes/ReporteComparativoPeriodos';
import ReportePosicionFiscal from '@/components/reportes/ReportePosicionFiscal';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useConfig } from '@/contexts/ConfigContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { generatePDF } from '@/lib/pdfUtils';
import { exportReporte } from '@/lib/excelUtils';
import { buildSummaryMetrics, getTableConfig, applyGrouping, applyFiltroDeuda } from '@/components/reportes/reportDefinitions';
import { getNowAR } from '@/lib/dateUtils';
import GridReportes from '@/components/reportes/GridReportes';
import ModalReporte from '@/components/reportes/ModalReporte';

function ReportesSection({ initialView = null, onNavigate } = {}) {
  const { user } = useAuth();
  const { config } = useConfig();
  const { toast } = useToast();
  const { enabled: tcParaleloEnabled, monedaParalela } = useTCParalelo();

  const [selectedReport, setSelectedReport] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showParidad, setShowParidad] = useState(false);
  const [showLibroIVA, setShowLibroIVA] = useState(false);
  const [showLibroIVACompras, setShowLibroIVACompras] = useState(false);
  const [showEstadoResultadosCC, setShowEstadoResultadosCC] = useState(false);
  const [showComparativoPeriodos, setShowComparativoPeriodos] = useState(false);
  const [showPosicionFiscal, setShowPosicionFiscal] = useState(false);
  const [libroIVAOrigen, setLibroIVAOrigen] = useState(null);
  const [afipActivo, setAfipActivo] = useState(false);
  const [groupBy, setGroupBy] = useState('none');
  const [previousPeriodStats, setPreviousPeriodStats] = useState(null);
  const [soloConDeuda, setSoloConDeuda] = useState(false);

  useEffect(() => {
    if (initialView === 'libro_iva') {
      setShowLibroIVA(true);
      setLibroIVAOrigen('impuestos');
    }
  }, [initialView]);

  const handleLibroIVABack = () => {
    setShowLibroIVA(false);
    const origen = libroIVAOrigen;
    setLibroIVAOrigen(null);
    if (origen === 'impuestos') onNavigate?.('impuestos');
  };

  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase
      .from('empresas')
      .select('usa_factura_electronica')
      .eq('id', user.empresa_id)
      .single()
      .then(({ data }) => setAfipActivo(data?.usa_factura_electronica === true));
  }, [user?.empresa_id]);

  // Centro de costo (mismo patrón que TabEstadoResultados) — opcional, solo si la empresa lo usa.
  const [centrosCosto, setCentrosCosto] = useState([]);
  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase.from('empresas').select('usa_centros_costo').eq('id', user.empresa_id).single()
      .then(({ data: emp }) => {
        if (!emp?.usa_centros_costo) { setCentrosCosto([]); return; }
        supabase.from('centros_costo').select('id, nombre')
          .eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre')
          .then(({ data }) => setCentrosCosto(data || []));
      });
  }, [user?.empresa_id]);
  const [centroCostoId, setCentroCostoId] = useState('');

  // Selector de cliente — obligatorio para Movimientos Cta. Corriente
  // (requiresCliente): el saldo acumulado del extracto solo tiene sentido
  // para un cliente a la vez.
  const [clientesList, setClientesList] = useState([]);
  const [clienteId, setClienteId] = useState('');
  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase.from('clientes').select('id, nombre').eq('empresa_id', user.empresa_id)
      .neq('activo', false).order('nombre')
      .then(({ data }) => setClientesList(data || []));
  }, [user?.empresa_id]);

  // Selector de producto — obligatorio para Kardex de Inventario
  // (requiresProducto): el kardex es una ficha de UN producto a la vez.
  const [productosList, setProductosList] = useState([]);
  const [productoId, setProductoId] = useState('');
  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase.from('productos').select('id, nombre').eq('empresa_id', user.empresa_id)
      .eq('activo', true).order('nombre')
      .then(({ data }) => setProductosList(data || []));
  }, [user?.empresa_id]);

  // Filters
  const [startDate, setStartDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  // Data
  const [reportData, setReportData] = useState([]);

  const resetFilters = () => {
    setStartDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
    setEndDate(new Date().toISOString().split('T')[0]);
    setCentroCostoId('');
    setClienteId('');
    setProductoId('');
    setReportData([]);
    setGroupBy('none');
    setPreviousPeriodStats(null);
    setSoloConDeuda(false);
  };

  const openReportDialog = (report) => {
    setSelectedReport(report);
    resetFilters();
    // Flujo de Cheques mira para ADELANTE (vencimientos futuros), al revés
    // que el resto de los reportes (que miran hacia atrás desde hoy) — el
    // default de "inicio de mes -> hoy" no tendría ningún cheque para mostrar.
    if (report.id === 'flujo_cheques') {
      const hoy = new Date();
      const en30dias = new Date(hoy.getTime() + 30 * 86400000);
      setStartDate(hoy.toISOString().split('T')[0]);
      setEndDate(en30dias.toISOString().split('T')[0]);
    }
    setIsDialogOpen(true);
  };

  // --- FETCHING LOGIC ---
  const handleGenerate = async () => {
    if (!user?.empresa_id) return;
    if (selectedReport?.requiresCliente && !clienteId) {
      toast({ description: "Seleccioná un cliente para generar el extracto.", variant: "destructive" });
      return;
    }
    if (selectedReport?.requiresProducto && !productoId) {
      toast({ description: "Seleccioná un producto para generar el kardex.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const [sy, sm, sd] = startDate.split('-').map(Number);
      const [ey, em, ed] = endDate.split('-').map(Number);
      const start = new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0)).toISOString();
      const end = new Date(Date.UTC(ey, em - 1, ed, 23, 59, 59, 999)).toISOString();

      let data = [];

      // Período anterior (mismo largo de días, corrido hacia atrás) para el
      // % variación de las cajas KPI — compartido entre Ventas y Compras,
      // ambos reportes con supportsPeriodComparison.
      const rangeMs  = new Date(end).getTime() - new Date(start).getTime();
      const prevEnd  = new Date(new Date(start).getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - rangeMs);
      const fetchPreviousPeriodStats = async (table, extraFilters = {}) => {
        let q = supabase
          .from(table)
          .select('total')
          .eq('empresa_id', user.empresa_id)
          .gte('fecha', prevStart.toISOString())
          .lte('fecha', prevEnd.toISOString());
        Object.entries(extraFilters).forEach(([k, v]) => { if (v) q = q.eq(k, v); });
        const { data: prev } = await q;
        return prev ? { total: prev.reduce((s, r) => s + (r.total || 0), 0), count: prev.length } : null;
      };

      // 1. VENTAS — lee de comprobantes/comprobante_items (schema actual).
      // tipo='venta' explícito: `comprobantes` también guarda Notas de Crédito
      // (tipo='nota_credito') — sin este filtro se sumaban como si fueran ventas
      // (hallazgo auditoría sesión 59, confirmado con datos reales: sobreestimaba
      // el total ~14%). Mismo filtro que ya usa ReporteLibroIVA.jsx.
      if (selectedReport.id === 'ventas') {
        let query = supabase
          .from('comprobantes')
          .select('*, comprobante_items(*), listas_precio(nombre)')
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'venta')
          .gte('fecha', start)
          .lte('fecha', end);
        if (centroCostoId) query = query.eq('centro_costo_id', centroCostoId);
        const { data: sales, error } = await query.order('fecha', { ascending: false });

        if (error) throw error;

        data = sales.map(s => ({
          id: s.id,
          fecha: s.fecha,
          cliente: s.cliente_nombre || 'Consumidor Final',
          // Con CAE (factura fiscal AFIP) → tipo + número real. Sin CAE (venta
          // POS sin facturar) → número interno de KAIROX, siempre disponible.
          comprobante: s.numero_afip
            ? `${s.tipo_comprobante_afip || ''} ${s.numero_afip}`.trim()
            : `Venta #${s.numero_venta || '-'}`,
          metodo_pago: s.forma_pago,
          items: s.comprobante_items?.length || 0,
          total: s.total,
          // Mejora del auditor-contable (04/09): traza qué lista de precios se
          // usó, para poder agrupar y medir cuánto se facturó a cada una.
          lista_precio: s.listas_precio?.nombre ?? 'Precio estándar',
        }));

        setPreviousPeriodStats(await fetchPreviousPeriodStats('comprobantes', {
          tipo: 'venta',
          centro_costo_id: centroCostoId,
        }));
      }

      // 2. COMPRAS
      else if (selectedReport.id === 'compras') {
         let query = supabase
          .from('compras')
          .select('*, proveedores(nombre), detalle_compras(productos(categoria_id, categorias(nombre)))')
          .eq('empresa_id', user.empresa_id)
          .gte('fecha', start)
          .lte('fecha', end);
         if (centroCostoId) query = query.eq('centro_costo_id', centroCostoId);
         const { data: purchases, error } = await query.order('fecha', { ascending: false });

        if (error) throw error;

        data = purchases.map(p => {
          // Una Factura de Compra puede traer ítems de más de una categoría
          // (confirmado con datos reales) — a diferencia de "por lista de
          // precios" en Ventas (1 FK en el header), acá no hay un valor único
          // y honesto salvo que todos los ítems coincidan.
          const categoriasItems = [...new Set(
            (p.detalle_compras || []).map(d => d.productos?.categorias?.nombre).filter(Boolean)
          )];
          const categoria = categoriasItems.length === 0
            ? 'Sin categoría'
            : categoriasItems.length === 1
              ? categoriasItems[0]
              : 'Varias categorías';
          return {
            id: p.id,
            fecha: p.fecha,
            proveedor: p.proveedores?.nombre || 'Desconocido',
            numero_factura: p.numero_factura,
            forma_pago: p.forma_pago,
            categoria,
            total: p.total
          };
        });

        setPreviousPeriodStats(await fetchPreviousPeriodStats('compras', {
          centro_costo_id: centroCostoId,
        }));
      }

      // 2b. RENTABILIDAD (por Producto o por Cliente) — mismo cálculo de
      // margen en ambas, agrupado distinto. costo_unitario × cantidad de
      // comprobante_items ya es el mismo COGS que costo_mercaderia_vendida
      // guarda a nivel de header (verificado: coinciden exactamente) — reusa
      // ese dato línea por línea en vez de inventar un cálculo nuevo.
      // tipo='venta' explícito, mismo motivo que el reporte de Ventas: las
      // Notas de Crédito no tienen costo_unitario cargado (siempre NULL) y
      // no deben sumarse acá.
      else if (selectedReport.id === 'rentabilidad_productos' || selectedReport.id === 'rentabilidad_clientes') {
        const porProducto = selectedReport.id === 'rentabilidad_productos';
        let query = supabase
          .from('comprobantes')
          .select('cliente_id, cliente_nombre, centro_costo_id, comprobante_items(producto_id, cantidad, subtotal, costo_unitario, productos(nombre, codigo_sku))')
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'venta')
          .gte('fecha', start)
          .lte('fecha', end);
        if (centroCostoId) query = query.eq('centro_costo_id', centroCostoId);
        const { data: ventas, error } = await query;
        if (error) throw error;

        const acumulado = {};
        (ventas || []).forEach(v => {
          (v.comprobante_items || []).forEach(item => {
            const cantidad = Number(item.cantidad || 0);
            const key = porProducto ? item.producto_id : (v.cliente_id || 'sin_cliente');
            if (!key) return;
            if (!acumulado[key]) {
              acumulado[key] = {
                id: key,
                nombre: porProducto ? (item.productos?.nombre || 'Producto eliminado') : (v.cliente_nombre || 'Consumidor Final'),
                sku: porProducto ? (item.productos?.codigo_sku || '') : undefined,
                cantidad: 0, venta: 0, costo: 0,
              };
            }
            acumulado[key].cantidad += cantidad;
            acumulado[key].venta += Number(item.subtotal || 0);
            acumulado[key].costo += Number(item.costo_unitario || 0) * cantidad;
          });
        });

        data = Object.values(acumulado)
          .map(r => ({ ...r, margen: r.venta - r.costo, margenPct: r.venta > 0 ? ((r.venta - r.costo) / r.venta) * 100 : 0 }))
          .sort((a, b) => b.margen - a.margen);
      }

      // 3. CLIENTES
      else if (selectedReport.id === 'clientes') {
         const { data: clients, error } = await supabase
           .from('clientes')
           .select('*')
           .eq('empresa_id', user.empresa_id)
           .neq('activo', false)
           .order('nombre');

         if (error) throw error;

         // Antigüedad de saldos (Open Item Management real, migration 169 —
         // mismo criterio que ya usa CuentaCorrienteSection.fetchAgingData:
         // días desde la FECHA de la factura, no desde el vencimiento. Se
         // mantiene igual a propósito para que el número de "días" de un
         // mismo comprobante no varíe entre pantallas — pasar a antigüedad
         // por vencimiento es una decisión de producto distinta, no
         // implementada en ningún lado todavía.
         const { data: openItems, error: agingError } = await supabase
           .from('facturas_saldo_pendiente')
           .select('cliente_id, fecha, saldo_pendiente')
           .eq('empresa_id', user.empresa_id)
           .gt('saldo_pendiente', 0);
         if (agingError) throw agingError;

         const now = getNowAR();
         const agingPorCliente = {};
         (openItems || []).forEach(item => {
           const dias = Math.floor((now - new Date(item.fecha)) / 86400000);
           const bucket = dias <= 30 ? 'aging_0_30' : dias <= 60 ? 'aging_31_60' : dias <= 90 ? 'aging_61_90' : 'aging_90_mas';
           if (!agingPorCliente[item.cliente_id]) {
             agingPorCliente[item.cliente_id] = { aging_0_30: 0, aging_31_60: 0, aging_61_90: 0, aging_90_mas: 0 };
           }
           agingPorCliente[item.cliente_id][bucket] += Number(item.saldo_pendiente);
         });

         data = clients.map(c => {
            const raw = agingPorCliente[c.id] || { aging_0_30: 0, aging_31_60: 0, aging_61_90: 0, aging_90_mas: 0 };
            const saldoReal = c.saldo_actual || 0;
            const sumaBuckets = raw.aging_0_30 + raw.aging_31_60 + raw.aging_61_90 + raw.aging_90_mas;

            // Reconciliación: la imputación a factura puntual es OPCIONAL en
            // registrar_cobro_cliente (un "pago a cuenta" genérico no elige
            // qué facturas cubre) — un cliente puede tener saldo_actual
            // correcto pero facturas "abiertas" viejas que en realidad ya se
            // cobraron con un pago no imputado. Sin esto, la antigüedad podía
            // mostrar $789.000 para un cliente que en realidad debe $107.880.
            // Se escala proporcionalmente para que el total de antigüedad
            // SIEMPRE coincida con TOTAL A COBRAR — nunca mostrar un número
            // que contradiga el saldo real ya verificado.
            let aging = raw;
            if (saldoReal <= 0) {
              aging = { aging_0_30: 0, aging_31_60: 0, aging_61_90: 0, aging_90_mas: 0 };
            } else if (sumaBuckets > 0 && Math.abs(sumaBuckets - saldoReal) > 0.01) {
              const factor = saldoReal / sumaBuckets;
              aging = {
                aging_0_30:   Math.round(raw.aging_0_30   * factor * 100) / 100,
                aging_31_60:  Math.round(raw.aging_31_60  * factor * 100) / 100,
                aging_61_90:  Math.round(raw.aging_61_90  * factor * 100) / 100,
                aging_90_mas: Math.round(raw.aging_90_mas * factor * 100) / 100,
              };
            }

            return {
              id: c.id,
              nombre: c.nombre,
              telefono: c.telefono,
              email: c.email,
              documento: c.documento || '',
              // condiciones_pago es texto libre ("Contado", "30 días"...);
              // dias_credito es el fallback numérico cuando no se cargó texto
              // — mismo par de campos que ya usa la ficha de Cliente.
              condicionPago: c.condiciones_pago || (c.dias_credito ? `${c.dias_credito} días` : ''),
              saldo: saldoReal,
              limite_credito: c.limite_credito || 0,
              ...aging,
            };
         });
      }

      // 3b. PROVEEDORES — mismo criterio que Clientes (aging + reconciliación),
      // pero proveedores no tiene columna saldo_actual cacheada: el saldo real
      // se deriva sumando cuenta_corriente_proveedores (mismo cálculo que
      // proveedoresService.getSaldoProveedor, pero en un solo query para
      // todos a la vez, igual que ya hace ProveedoresSection.fetchAgingProveedores).
      else if (selectedReport.id === 'proveedores') {
        const { data: provs, error } = await supabase
          .from('proveedores')
          .select('*')
          .eq('empresa_id', user.empresa_id)
          .neq('activo', false)
          .order('nombre');
        if (error) throw error;

        const { data: openItems, error: agingError } = await supabase
          .from('compras_saldo_pendiente')
          .select('compra_id, proveedor_id, saldo_pendiente')
          .eq('empresa_id', user.empresa_id)
          .gt('saldo_pendiente', 0);
        if (agingError) throw agingError;

        // compras_saldo_pendiente no trae la fecha de la factura directo —
        // hace falta un segundo query a compras para poder bucketear por
        // antigüedad (mismo problema que ya resolvió ProveedoresSection).
        const { data: comprasInfo, error: comprasInfoError } = await supabase
          .from('compras')
          .select('id, fecha')
          .in('id', (openItems || []).map(i => i.compra_id));
        if (comprasInfoError) throw comprasInfoError;
        const fechaPorCompraId = Object.fromEntries((comprasInfo || []).map(c => [c.id, c.fecha]));

        const { data: ccpMovs, error: ccpError } = await supabase
          .from('cuenta_corriente_proveedores')
          .select('proveedor_id, tipo, monto')
          .eq('empresa_id', user.empresa_id);
        if (ccpError) throw ccpError;

        const saldoRealPorProv = {};
        (ccpMovs || []).forEach(m => {
          const delta = (m.tipo === 'compra' || m.tipo === 'nota_debito') ? Number(m.monto)
                      : (m.tipo === 'pago'   || m.tipo === 'nota_credito') ? -Number(m.monto)
                      : 0;
          saldoRealPorProv[m.proveedor_id] = (saldoRealPorProv[m.proveedor_id] || 0) + delta;
        });

        const now = getNowAR();
        const agingPorProveedor = {};
        (openItems || []).forEach(item => {
          const fecha = fechaPorCompraId[item.compra_id];
          const dias = fecha ? Math.floor((now - new Date(fecha)) / 86400000) : 0;
          const bucket = dias <= 30 ? 'aging_0_30' : dias <= 60 ? 'aging_31_60' : dias <= 90 ? 'aging_61_90' : 'aging_90_mas';
          if (!agingPorProveedor[item.proveedor_id]) {
            agingPorProveedor[item.proveedor_id] = { aging_0_30: 0, aging_31_60: 0, aging_61_90: 0, aging_90_mas: 0 };
          }
          agingPorProveedor[item.proveedor_id][bucket] += Number(item.saldo_pendiente);
        });

        data = provs.map(p => {
          const raw = agingPorProveedor[p.id] || { aging_0_30: 0, aging_31_60: 0, aging_61_90: 0, aging_90_mas: 0 };
          const saldoReal = saldoRealPorProv[p.id] || 0;
          const sumaBuckets = raw.aging_0_30 + raw.aging_31_60 + raw.aging_61_90 + raw.aging_90_mas;

          // Reconciliación: igual que Clientes — un pago a cuenta sin imputar
          // a una compra puntual no debe inflar la antigüedad por encima del
          // saldo real ya verificado.
          let aging = raw;
          if (saldoReal <= 0) {
            aging = { aging_0_30: 0, aging_31_60: 0, aging_61_90: 0, aging_90_mas: 0 };
          } else if (sumaBuckets > 0 && Math.abs(sumaBuckets - saldoReal) > 0.01) {
            const factor = saldoReal / sumaBuckets;
            aging = {
              aging_0_30:   Math.round(raw.aging_0_30   * factor * 100) / 100,
              aging_31_60:  Math.round(raw.aging_31_60  * factor * 100) / 100,
              aging_61_90:  Math.round(raw.aging_61_90  * factor * 100) / 100,
              aging_90_mas: Math.round(raw.aging_90_mas * factor * 100) / 100,
            };
          }

          return {
            id: p.id,
            nombre: p.nombre,
            telefono: p.telefono,
            email: p.email,
            cuit: p.cuit || '',
            condicionPago: p.condicion_pago || (p.plazo_pago_dias ? `${p.plazo_pago_dias} días` : ''),
            saldo: saldoReal,
            ...aging,
          };
        });
      }

      // 4. CUENTA CORRIENTE — extracto por cliente con saldo acumulado
      // (estilo resumen bancario). requiresCliente obliga a elegir un
      // cliente antes de generar: el saldo acumulado solo tiene sentido
      // para uno a la vez.
      else if (selectedReport.id === 'cuenta_corriente') {
         // Saldo previo al período: todo movimiento del cliente anterior a
         // `start`, para que el extracto no arranque de $0 como si el
         // cliente no tuviera historia.
         const { data: anteriores, error: errAnt } = await supabase
           .from('cuenta_corriente_movimientos')
           .select('tipo, monto')
           .eq('empresa_id', user.empresa_id)
           .eq('cliente_id', clienteId)
           .lt('fecha', start);
         if (errAnt) throw errAnt;
         const saldoAnterior = (anteriores || []).reduce(
           (s, m) => s + (m.tipo === 'DEBE' ? m.monto : -m.monto), 0
         );

         const { data: movs, error } = await supabase
           .from('cuenta_corriente_movimientos')
           .select('id, fecha, tipo, monto, descripcion')
           .eq('empresa_id', user.empresa_id)
           .eq('cliente_id', clienteId)
           .gte('fecha', start)
           .lte('fecha', end)
           .order('fecha', { ascending: true });
         if (error) throw error;

         let saldoCorrido = saldoAnterior;
         const movimientos = (movs || []).map(m => {
           saldoCorrido += m.tipo === 'DEBE' ? m.monto : -m.monto;
           return {
             id: m.id,
             fecha: m.fecha,
             descripcion: m.descripcion,
             debe:  m.tipo === 'DEBE'  ? m.monto : 0,
             haber: m.tipo === 'HABER' ? m.monto : 0,
             saldo: Math.round(saldoCorrido * 100) / 100,
           };
         });

         data = [
           { id: 'saldo_anterior', fecha: start, descripcion: 'Saldo anterior', debe: 0, haber: 0, saldo: Math.round(saldoAnterior * 100) / 100, esSaldoAnterior: true },
           ...movimientos,
         ];
      }

      // 5. FINANCIERO — Libro de Caja: saldo inicial + ingreso/egreso/saldo
      // acumulado fila a fila (mismo criterio que el extracto de Cta.
      // Corriente, aplicado a los movimientos de caja en vez de a un cliente).
      else if (selectedReport.id === 'financiero') {
         const { data: anteriores, error: errAnt } = await supabase
           .from('movimientos_caja')
           .select('tipo, monto')
           .eq('empresa_id', user.empresa_id)
           .lt('fecha', start);
         if (errAnt) throw errAnt;
         const saldoInicial = (anteriores || []).reduce(
           (s, m) => s + (m.tipo === 'ingreso' ? m.monto : -m.monto), 0
         );

         const { data: fins, error } = await supabase
            .from('movimientos_caja')
            .select('id, fecha, categoria, concepto, metodo_pago, tipo, monto')
            .eq('empresa_id', user.empresa_id)
            .gte('fecha', start)
            .lte('fecha', end)
            .order('fecha', { ascending: true });
         if (error) throw error;

         let saldoCorrido = saldoInicial;
         const movimientos = (fins || []).map(m => {
           const ingreso = m.tipo === 'ingreso' ? m.monto : 0;
           const egreso  = m.tipo === 'egreso'  ? m.monto : 0;
           saldoCorrido += ingreso - egreso;
           return {
             id: m.id,
             fecha: m.fecha,
             categoria: m.categoria,
             concepto: m.concepto,
             metodo_pago: m.metodo_pago,
             ingreso,
             egreso,
             saldo: Math.round(saldoCorrido * 100) / 100,
           };
         });

         data = [
           { id: 'saldo_inicial', fecha: start, categoria: '', concepto: 'Saldo inicial', metodo_pago: '', ingreso: 0, egreso: 0, saldo: Math.round(saldoInicial * 100) / 100, esSaldoInicial: true },
           ...movimientos,
         ];

         const { data: prevFins } = await supabase
           .from('movimientos_caja')
           .select('tipo, monto')
           .eq('empresa_id', user.empresa_id)
           .gte('fecha', prevStart.toISOString())
           .lte('fecha', prevEnd.toISOString());
         setPreviousPeriodStats({
           ingresos: (prevFins || []).filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0),
           egresos:  (prevFins || []).filter(m => m.tipo === 'egreso').reduce((s, m) => s + (m.monto || 0), 0),
         });
      }

      // 6. MERCADOPAGO POR TIPO — movimientos_bancarios con origen='mercadopago'
      // incluye cobros (tipo='ingreso') y reintegros/contracargos
      // (tipo='egreso'); se separan en columnas, nunca se suman ciego (ver
      // nota en reportDefinitions.jsx). No se agrega saldo acumulado: es un
      // recorte por origen de una cuenta bancaria, no la cuenta completa.
      else if (selectedReport.id === 'mp_movimientos') {
        const { data: movs, error } = await supabase
          .from('movimientos_bancarios')
          .select('id, fecha, descripcion, subtipo, tipo, monto, conciliado')
          .eq('empresa_id', user.empresa_id)
          .eq('origen', 'mercadopago')
          .gte('fecha', start)
          .lte('fecha', end)
          .order('fecha', { ascending: false });

        if (error) throw error;

        data = (movs || []).map(m => ({
          id: m.id,
          fecha: m.fecha,
          descripcion: m.descripcion,
          subtipo: m.subtipo,
          ingreso: m.tipo === 'ingreso' ? m.monto : 0,
          egreso:  m.tipo === 'egreso'  ? m.monto : 0,
          conciliado: m.conciliado,
        }));

        const { data: prevMovs } = await supabase
          .from('movimientos_bancarios')
          .select('tipo, monto')
          .eq('empresa_id', user.empresa_id)
          .eq('origen', 'mercadopago')
          .gte('fecha', prevStart.toISOString())
          .lte('fecha', prevEnd.toISOString());
        setPreviousPeriodStats({
          ingresos: (prevMovs || []).filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0),
          egresos:  (prevMovs || []).filter(m => m.tipo === 'egreso').reduce((s, m) => s + (m.monto || 0), 0),
        });
      }

      // 6. ARQUEOS DE CAJA — historial de diferencias al cerrar cada sesión
      // (mig.216/multi-caja). Solo sesiones 'cerrada' tienen un arqueo real;
      // 'abierta' todavía no comparó nada. Filtra por cierre_fecha, no por
      // apertura — una caja abierta el 31 y cerrada el 1 pertenece al día
      // que efectivamente se arqueó.
      else if (selectedReport.id === 'arqueos_caja') {
        let query = supabase
          .from('caja_sesiones')
          .select('id, cierre_fecha, monto_final_esperado, monto_final_real, diferencia, cerrado_por, caja_id, profiles:cerrado_por(first_name, last_name, email), cajas:caja_id(nombre)')
          .eq('empresa_id', user.empresa_id)
          .eq('estado', 'cerrada')
          .gte('cierre_fecha', start)
          .lte('cierre_fecha', end)
          .order('cierre_fecha', { ascending: false });
        const { data: sesiones, error } = await query;
        if (error) throw error;

        data = (sesiones || []).map(s => ({
          id: s.id,
          fecha: s.cierre_fecha,
          caja: s.cajas?.nombre || 'Caja única',
          cajero: s.profiles ? (`${s.profiles.first_name || ''} ${s.profiles.last_name || ''}`.trim() || s.profiles.email) : '—',
          esperado: Number(s.monto_final_esperado || 0),
          real: Number(s.monto_final_real || 0),
          diferencia: Number(s.diferencia || 0),
        }));
      }

      // 7. VALORIZACIÓN DE INVENTARIO — foto a HOY, no de un período (fecha
      // ignorada a propósito, igual que Clientes/Proveedores). Solo
      // es_inventariable: un servicio no tiene stock que valorizar.
      else if (selectedReport.id === 'valorizacion_inventario') {
        const { data: prods, error } = await supabase
          .from('productos')
          .select('id, nombre, codigo_sku, stock_actual, costo_compra, categorias(nombre)')
          .eq('empresa_id', user.empresa_id)
          .eq('activo', true)
          .eq('es_inventariable', true)
          .order('nombre');
        if (error) throw error;

        data = (prods || []).map(p => ({
          id: p.id,
          nombre: p.nombre,
          sku: p.codigo_sku,
          categoria: p.categorias?.nombre || 'Sin categoría',
          stock: Number(p.stock_actual || 0),
          costo: Number(p.costo_compra || 0),
          valor: Number(p.stock_actual || 0) * Number(p.costo_compra || 0),
        })).sort((a, b) => b.valor - a.valor);
      }

      // 8. KARDEX DE INVENTARIO — ficha de UN producto (requiresProducto).
      // movimientos_inventario.cantidad es un DELTA para tipo entrada/
      // ingreso/salida, pero para el legado tipo='ajuste' (de antes de que
      // ajustar_stock_manual/confirmar_recuento_inventario se reescribieran
      // para insertar entrada/salida) cantidad es el STOCK ABSOLUTO
      // resultante, no un delta — verificado contra datos reales (ej. motivo
      // "40->46" con cantidad=46, no 6). Tratarlo como delta daría un stock
      // acumulado incorrecto para cualquier producto con un ajuste viejo.
      // "Valor" usa el costo ACTUAL del producto (no hay costo histórico por
      // movimiento guardado) — aclarado en el diálogo de ayuda del reporte.
      else if (selectedReport.id === 'kardex_inventario') {
        const { data: prod, error: prodError } = await supabase
          .from('productos')
          .select('nombre, costo_compra')
          .eq('id', productoId)
          .eq('empresa_id', user.empresa_id)
          .single();
        if (prodError) throw prodError;
        const costoActual = Number(prod?.costo_compra || 0);

        const aplicarMovimiento = (stock, m) => {
          if (m.tipo === 'entrada' || m.tipo === 'ingreso') return stock + Number(m.cantidad);
          if (m.tipo === 'salida') return stock - Number(m.cantidad);
          if (m.tipo === 'ajuste') return Number(m.cantidad); // legado: valor absoluto
          return stock;
        };
        const signoDe = (tipo) => tipo === 'salida' ? -1 : tipo === 'ajuste' ? 0 : 1;

        const { data: anteriores, error: errAnt } = await supabase
          .from('movimientos_inventario')
          .select('tipo, cantidad')
          .eq('empresa_id', user.empresa_id)
          .eq('producto_id', productoId)
          .lt('fecha', start);
        if (errAnt) throw errAnt;
        const stockAnterior = (anteriores || []).reduce(aplicarMovimiento, 0);

        const { data: movs, error } = await supabase
          .from('movimientos_inventario')
          .select('id, fecha, tipo, cantidad, motivo')
          .eq('empresa_id', user.empresa_id)
          .eq('producto_id', productoId)
          .gte('fecha', start)
          .lte('fecha', end)
          .order('fecha', { ascending: true });
        if (error) throw error;

        let stockCorrido = stockAnterior;
        const movimientos = (movs || []).map(m => {
          stockCorrido = aplicarMovimiento(stockCorrido, m);
          return {
            id: m.id,
            fecha: m.fecha,
            tipo: m.tipo,
            motivo: m.motivo,
            cantidad: Number(m.cantidad),
            signo: signoDe(m.tipo),
            stock: stockCorrido,
            valor: Number(m.cantidad) * costoActual,
          };
        });

        data = [
          { id: 'stock_anterior', fecha: start, tipo: '', motivo: 'Stock anterior', cantidad: 0, signo: 0, stock: stockAnterior, valor: 0, esStockAnterior: true },
          ...movimientos,
        ];
      }

      // 9. LIQUIDACIÓN DE TARJETAS — movimientos_caja con estado_liquidacion
      // ='pendiente' (mig.216/362): el dinero todavía no está acreditado en
      // el banco. Snapshot a HOY, no de un período — una vez que se acredita
      // (acreditar_movimiento_caja) deja de aparecer, no tiene sentido
      // filtrar por fecha de la venta.
      else if (selectedReport.id === 'liquidacion_tarjetas') {
        const { data: movs, error } = await supabase
          .from('movimientos_caja')
          .select('id, fecha, concepto, metodo_pago, monto, monto_comision, monto_neto, fecha_acreditacion_estimada')
          .eq('empresa_id', user.empresa_id)
          .eq('estado_liquidacion', 'pendiente')
          .order('fecha_acreditacion_estimada', { ascending: true });
        if (error) throw error;

        data = (movs || []).map(m => ({
          id: m.id,
          fecha: m.fecha,
          concepto: m.concepto,
          metodo: m.metodo_pago,
          monto: Number(m.monto || 0),
          comision: Number(m.monto_comision || 0),
          neto: Number(m.monto_neto || 0),
          fechaAcreditacion: m.fecha_acreditacion_estimada,
        }));
      }

      // 10. PASIVO DE FIDELIZACIÓN — saldo_puntos de clientes (fuente de
      // verdad ya mantenida por el trigger de puntos, mig.312) valorizado al
      // tipo de cambio puntos->pesos configurado en Configuración > Finanzas.
      // No se reconstruye desde movimientos_puntos: ese ledger sirve para
      // auditar el detalle, pero el saldo YA está calculado y es más
      // confiable que re-sumar ganado/canjeado/reversión a mano.
      else if (selectedReport.id === 'pasivo_fidelizacion') {
        const { data: emp, error: empError } = await supabase
          .from('empresas')
          .select('puntos_valor_pesos')
          .eq('id', user.empresa_id)
          .single();
        if (empError) throw empError;
        const valorPorPunto = Number(emp?.puntos_valor_pesos || 0);

        const { data: clients, error } = await supabase
          .from('clientes')
          .select('id, nombre, saldo_puntos')
          .eq('empresa_id', user.empresa_id)
          .gt('saldo_puntos', 0)
          .order('saldo_puntos', { ascending: false });
        if (error) throw error;

        data = (clients || []).map(c => ({
          id: c.id,
          nombre: c.nombre,
          saldoPuntos: Number(c.saldo_puntos || 0),
          valorPesos: Number(c.saldo_puntos || 0) * valorPorPunto,
          valorPorPunto,
        }));
      }

      // 11. FLUJO DE CHEQUES PROYECTADO — cheques de terceros "en_cartera"
      // (a cobrar) + cheques propios "pendiente"/"entregado" (a pagar,
      // ChequesSection.jsx usa esos 2 estados para propios, NO 'en_cartera' —
      // los dos tipos tienen vocabularios de estado distintos). Filtra por
      // fecha_vencimiento (date puro), no por start/end (timestamptz de
      // start-of-month a hoy no tiene sentido para un flujo hacia adelante).
      else if (selectedReport.id === 'flujo_cheques') {
        const { data: terceros, error: e1 } = await supabase
          .from('cheques')
          .select('id, numero, banco, monto, fecha_vencimiento, clientes(nombre)')
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'tercero')
          .eq('estado', 'en_cartera')
          .gte('fecha_vencimiento', startDate)
          .lte('fecha_vencimiento', endDate);
        if (e1) throw e1;

        const { data: propios, error: e2 } = await supabase
          .from('cheques')
          .select('id, numero, banco, monto, fecha_vencimiento, proveedores(nombre)')
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'propio')
          .in('estado', ['pendiente', 'entregado'])
          .gte('fecha_vencimiento', startDate)
          .lte('fecha_vencimiento', endDate);
        if (e2) throw e2;

        data = [
          ...(terceros || []).map(c => ({
            id: c.id, fecha: c.fecha_vencimiento, direccion: 'cobrar',
            contraparte: c.clientes?.nombre || '-', banco: c.banco, numero: c.numero,
            monto: Number(c.monto || 0),
          })),
          ...(propios || []).map(c => ({
            id: c.id, fecha: c.fecha_vencimiento, direccion: 'pagar',
            contraparte: c.proveedores?.nombre || '-', banco: c.banco, numero: c.numero,
            monto: Number(c.monto || 0),
          })),
        ].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
      }

      // 12. ÓRDENES DE COMPRA ABIERTAS — consolidado línea por línea (no OC
      // por OC): cantidad_pedida/recibida/facturada ya están en
      // ordenes_compra_items, solo hace falta filtrar las líneas con algo
      // pendiente. Excluye 'cancelada' (nunca va a llegar). Snapshot a HOY,
      // no de un período — es "qué sigue abierto ahora", no un movimiento.
      else if (selectedReport.id === 'oc_abiertas') {
        const { data: ocs, error } = await supabase
          .from('ordenes_compra')
          .select('id, numero, proveedor_nombre, fecha, ordenes_compra_items(producto_id, descripcion, cantidad_pedida, cantidad_recibida, cantidad_facturada, costo_unitario, productos(nombre))')
          .eq('empresa_id', user.empresa_id)
          .neq('estado', 'cancelada')
          .order('fecha', { ascending: true });
        if (error) throw error;

        const now = getNowAR();
        const filas = [];
        (ocs || []).forEach(oc => {
          (oc.ordenes_compra_items || []).forEach((item, idx) => {
            const pedida = Number(item.cantidad_pedida || 0);
            const recibida = Number(item.cantidad_recibida || 0);
            const facturada = Number(item.cantidad_facturada || 0);
            const pendienteRecibir = Math.max(0, pedida - recibida);
            const pendienteFacturar = Math.max(0, recibida - facturada);
            if (pendienteRecibir <= 0 && pendienteFacturar <= 0) return;
            const dias = Math.floor((now - new Date(oc.fecha)) / 86400000);
            filas.push({
              id: `${oc.id}_${idx}`,
              ocId: oc.id,
              numero: oc.numero,
              proveedor: oc.proveedor_nombre,
              fecha: oc.fecha,
              producto: item.productos?.nombre || item.descripcion || 'Producto eliminado',
              pedida, recibida,
              pendienteRecibir, pendienteFacturar,
              dias,
              valorPendienteRecibir: pendienteRecibir * Number(item.costo_unitario || 0),
              valorPendienteFacturar: pendienteFacturar * Number(item.costo_unitario || 0),
            });
          });
        });
        data = filas;
      }

      // 13. DETALLE DE COMPRAS POR PRODUCTO — mismo patrón que Rentabilidad
      // por Producto (Fase 2), pero sobre detalle_compras en vez de
      // comprobante_items. costoPromedio = costo total / cantidad total:
      // promedio PONDERADO por cantidad (no un promedio ingenuo de
      // costo_unitario por fila), que es el criterio correcto cuando las
      // compras vienen en tandas de tamaño distinto.
      else if (selectedReport.id === 'detalle_compras_producto') {
        let query = supabase
          .from('compras')
          .select('centro_costo_id, detalle_compras(producto_id, cantidad, subtotal, productos(nombre, codigo_sku, categorias(nombre)))')
          .eq('empresa_id', user.empresa_id)
          .gte('fecha', start)
          .lte('fecha', end);
        if (centroCostoId) query = query.eq('centro_costo_id', centroCostoId);
        const { data: comprasData, error } = await query;
        if (error) throw error;

        const acumulado = {};
        (comprasData || []).forEach(c => {
          (c.detalle_compras || []).forEach(item => {
            if (!item.producto_id) return;
            if (!acumulado[item.producto_id]) {
              acumulado[item.producto_id] = {
                id: item.producto_id,
                nombre: item.productos?.nombre || 'Producto eliminado',
                sku: item.productos?.codigo_sku || '',
                categoria: item.productos?.categorias?.nombre || 'Sin categoría',
                cantidad: 0, costo: 0,
              };
            }
            acumulado[item.producto_id].cantidad += Number(item.cantidad || 0);
            acumulado[item.producto_id].costo += Number(item.subtotal || 0);
          });
        });

        data = Object.values(acumulado)
          .map(r => ({ ...r, costoPromedio: r.cantidad > 0 ? r.costo / r.cantidad : 0 }))
          .sort((a, b) => b.costo - a.costo);
      }

      setReportData(data);
      if (data.length === 0) {
        toast({ description: "No se encontraron datos para el período.", duration: 3000 });
      }

    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "No se pudo generar el reporte.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // --- PDF DOWNLOAD ---
  const handleDownloadPDF = async () => {
    try {
      const filteredData = applyFiltroDeuda(selectedReport.id, reportData, soloConDeuda);
      const { columns, totals } = getTableConfig(selectedReport.id, filteredData);
      const summaryMetrics = buildSummaryMetrics(selectedReport.id, filteredData, selectedReport.supportsPeriodComparison ? previousPeriodStats : null);
      const displayData = applyGrouping(selectedReport.id, filteredData, groupBy);

      await generatePDF({
        title:           selectedReport.title,
        esSnapshot:      selectedReport.requiresDate === false,
        startDate:       startDate,
        endDate:         endDate,
        columns:         columns,
        data:            displayData,
        totals:          totals,
        filename:        selectedReport.id,
        companyName:     config?.nombre_empresa || 'KAIROX Gestión',
        logoUrl:         config?.logo_base64 || null,
        summaryMetrics,
      });

      toast({ title: "Éxito", description: "PDF generado correctamente.", className: "bg-green-600 text-white" });
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Falló la generación del PDF.", variant: "destructive" });
    }
  };

  // --- EXCEL DOWNLOAD ---
  const handleDownloadExcel = () => {
    try {
      const filteredData = applyFiltroDeuda(selectedReport.id, reportData, soloConDeuda);
      const { columns, totals } = getTableConfig(selectedReport.id, filteredData);
      const displayData = applyGrouping(selectedReport.id, filteredData, groupBy);

      exportReporte({
        title:    selectedReport.title,
        columns:  columns,
        data:     displayData,
        totals:   totals,
        filename: selectedReport.id,
      });

      toast({ title: "Éxito", description: "Excel generado correctamente.", className: "bg-green-600 text-white" });
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Falló la generación del Excel.", variant: "destructive" });
    }
  };

  // --- WHATSAPP SHARE ---
  // wa.me abre WhatsApp con un mensaje pre-armado, sin adjuntar el PDF/Excel
  // (WhatsApp no permite adjuntar archivos vía link sin la API paga de
  // Business) — el usuario elige el contacto y adjunta el archivo a mano.
  const handleShareWhatsApp = () => {
    const filteredData = applyFiltroDeuda(selectedReport.id, reportData, soloConDeuda);
    const summaryMetrics = buildSummaryMetrics(selectedReport.id, filteredData, selectedReport.supportsPeriodComparison ? previousPeriodStats : null);
    // Mismo criterio que generatePDF (esSnapshot) — Cartera de Proveedores y
    // demás reportes requiresDate:false no filtran por fecha, así que
    // "Período: X al Y" acá sugeriría lo mismo que confundió a Luciano en
    // pantalla.
    const lineaFecha = selectedReport.requiresDate === false
      ? `Estado actual al ${new Date().toLocaleDateString('es-AR')}`
      : `Período: ${startDate} al ${endDate}`;
    const lineas = [
      `📊 *${selectedReport.title}*`,
      lineaFecha,
      ...(summaryMetrics || []).map(m => `${m.label}: ${m.value}${m.delta ? ` (${m.delta.text})` : ''}`),
    ];
    const texto = encodeURIComponent(lineas.join('\n'));
    window.open(`https://wa.me/?text=${texto}`, '_blank');
    toast({ description: "Se abrió WhatsApp con el resumen. Adjuntá el PDF/Excel descargado si querés mandarlo completo.", duration: 4000 });
  };

  // Reportes inline: reemplazan el grid
  if (showParidad) {
    return <ReporteParidad onBack={() => setShowParidad(false)} />;
  }
  if (showLibroIVA) {
    return <ReporteLibroIVA onBack={handleLibroIVABack} />;
  }
  if (showLibroIVACompras) {
    return <ReporteLibroIVACompras onBack={() => setShowLibroIVACompras(false)} />;
  }
  if (showEstadoResultadosCC) {
    return <ReporteEstadoResultadosCC onBack={() => setShowEstadoResultadosCC(false)} />;
  }
  if (showComparativoPeriodos) {
    return <ReporteComparativoPeriodos onBack={() => setShowComparativoPeriodos(false)} />;
  }
  if (showPosicionFiscal) {
    return <ReportePosicionFiscal onBack={() => setShowPosicionFiscal(false)} />;
  }

  return (
    <div className="space-y-8 pb-8 animate-in fade-in duration-500">
      <GridReportes
        openReportDialog={openReportDialog}
        tcParaleloEnabled={tcParaleloEnabled} monedaParalela={monedaParalela} setShowParidad={setShowParidad}
        afipActivo={afipActivo} setShowLibroIVA={setShowLibroIVA} setLibroIVAOrigen={setLibroIVAOrigen}
        setShowLibroIVACompras={setShowLibroIVACompras}
        setShowEstadoResultadosCC={setShowEstadoResultadosCC}
        setShowComparativoPeriodos={setShowComparativoPeriodos}
        setShowPosicionFiscal={setShowPosicionFiscal}
      />

      <ModalReporte
        isDialogOpen={isDialogOpen} setIsDialogOpen={setIsDialogOpen}
        selectedReport={selectedReport}
        startDate={startDate} setStartDate={setStartDate} endDate={endDate} setEndDate={setEndDate}
        handleGenerate={handleGenerate} resetFilters={resetFilters} loading={loading}
        reportData={reportData} handleDownloadPDF={handleDownloadPDF} handleDownloadExcel={handleDownloadExcel} handleShareWhatsApp={handleShareWhatsApp}
        centrosCosto={centrosCosto} centroCostoId={centroCostoId} setCentroCostoId={setCentroCostoId}
        clientesList={clientesList} clienteId={clienteId} setClienteId={setClienteId}
        productosList={productosList} productoId={productoId} setProductoId={setProductoId}
        groupBy={groupBy} setGroupBy={setGroupBy}
        soloConDeuda={soloConDeuda} setSoloConDeuda={setSoloConDeuda}
        onNavigate={onNavigate}
      />
    </div>
  );
}

export default ReportesSection;
