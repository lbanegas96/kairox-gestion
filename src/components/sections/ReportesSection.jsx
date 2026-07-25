import { useState, useEffect } from 'react';

import ReporteParidad from '@/components/reportes/ReporteParidad';
import ReporteLibroIVA from '@/components/reportes/ReporteLibroIVA';
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
    setReportData([]);
    setGroupBy('none');
    setPreviousPeriodStats(null);
    setSoloConDeuda(false);
  };

  const openReportDialog = (report) => {
    setSelectedReport(report);
    resetFilters();
    setIsDialogOpen(true);
  };

  // --- FETCHING LOGIC ---
  const handleGenerate = async () => {
    if (!user?.empresa_id) return;
    if (selectedReport?.requiresCliente && !clienteId) {
      toast({ description: "Seleccioná un cliente para generar el extracto.", variant: "destructive" });
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
          .select('*, comprobante_items(*)')
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
          total: s.total
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
          .select('*, proveedores(nombre)')
          .eq('empresa_id', user.empresa_id)
          .gte('fecha', start)
          .lte('fecha', end);
         if (centroCostoId) query = query.eq('centro_costo_id', centroCostoId);
         const { data: purchases, error } = await query.order('fecha', { ascending: false });

        if (error) throw error;

        data = purchases.map(p => ({
          id: p.id,
          fecha: p.fecha,
          proveedor: p.proveedores?.nombre || 'Desconocido',
          numero_factura: p.numero_factura,
          forma_pago: p.forma_pago,
          total: p.total
        }));

        setPreviousPeriodStats(await fetchPreviousPeriodStats('compras', {
          centro_costo_id: centroCostoId,
        }));
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
              saldo: saldoReal,
              limite_credito: c.limite_credito || 0,
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
    const lineas = [
      `📊 *${selectedReport.title}*`,
      `Período: ${startDate} al ${endDate}`,
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

  return (
    <div className="space-y-8 pb-8 animate-in fade-in duration-500">
      <GridReportes
        openReportDialog={openReportDialog}
        tcParaleloEnabled={tcParaleloEnabled} monedaParalela={monedaParalela} setShowParidad={setShowParidad}
        afipActivo={afipActivo} setShowLibroIVA={setShowLibroIVA} setLibroIVAOrigen={setLibroIVAOrigen}
      />

      <ModalReporte
        isDialogOpen={isDialogOpen} setIsDialogOpen={setIsDialogOpen}
        selectedReport={selectedReport}
        startDate={startDate} setStartDate={setStartDate} endDate={endDate} setEndDate={setEndDate}
        handleGenerate={handleGenerate} resetFilters={resetFilters} loading={loading}
        reportData={reportData} handleDownloadPDF={handleDownloadPDF} handleDownloadExcel={handleDownloadExcel} handleShareWhatsApp={handleShareWhatsApp}
        centrosCosto={centrosCosto} centroCostoId={centroCostoId} setCentroCostoId={setCentroCostoId}
        clientesList={clientesList} clienteId={clienteId} setClienteId={setClienteId}
        groupBy={groupBy} setGroupBy={setGroupBy}
        soloConDeuda={soloConDeuda} setSoloConDeuda={setSoloConDeuda}
      />
    </div>
  );
}

export default ReportesSection;
