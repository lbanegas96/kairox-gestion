import { useState, useEffect } from 'react';

import ReporteParidad from '@/components/reportes/ReporteParidad';
import ReporteLibroIVA from '@/components/reportes/ReporteLibroIVA';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useConfig } from '@/contexts/ConfigContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { generatePDF } from '@/lib/pdfUtils';
import { buildSummaryMetrics, getTableConfig } from '@/components/reportes/reportDefinitions';
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

  // Filters
  const [startDate, setStartDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  // Data
  const [reportData, setReportData] = useState([]);

  const resetFilters = () => {
    setStartDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
    setEndDate(new Date().toISOString().split('T')[0]);
    setReportData([]);
  };

  const openReportDialog = (report) => {
    setSelectedReport(report);
    resetFilters();
    setIsDialogOpen(true);
  };

  // --- FETCHING LOGIC ---
  const handleGenerate = async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    try {
      const [sy, sm, sd] = startDate.split('-').map(Number);
      const [ey, em, ed] = endDate.split('-').map(Number);
      const start = new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0)).toISOString();
      const end = new Date(Date.UTC(ey, em - 1, ed, 23, 59, 59, 999)).toISOString();

      let data = [];

      // 1. VENTAS — lee de comprobantes/comprobante_items (schema actual).
      // tipo='venta' explícito: `comprobantes` también guarda Notas de Crédito
      // (tipo='nota_credito') — sin este filtro se sumaban como si fueran ventas
      // (hallazgo auditoría sesión 59, confirmado con datos reales: sobreestimaba
      // el total ~14%). Mismo filtro que ya usa ReporteLibroIVA.jsx.
      if (selectedReport.id === 'ventas') {
        const { data: sales, error } = await supabase
          .from('comprobantes')
          .select('*, comprobante_items(*)')
          .eq('empresa_id', user.empresa_id)
          .eq('tipo', 'venta')
          .gte('fecha', start)
          .lte('fecha', end)
          .order('fecha', { ascending: false });

        if (error) throw error;

        data = sales.map(s => ({
          id: s.id,
          fecha: s.fecha,
          cliente: s.cliente_nombre || 'Consumidor Final',
          metodo_pago: s.forma_pago,
          items: s.comprobante_items?.length || 0,
          total: s.total
        }));
      }

      // 2. COMPRAS
      else if (selectedReport.id === 'compras') {
         const { data: purchases, error } = await supabase
          .from('compras')
          .select('*, proveedores(nombre)')
          .eq('empresa_id', user.empresa_id)
          .gte('fecha', start)
          .lte('fecha', end)
          .order('fecha', { ascending: false });

        if (error) throw error;

        data = purchases.map(p => ({
          id: p.id,
          fecha: p.fecha,
          proveedor: p.proveedores?.nombre || 'Desconocido',
          numero_factura: p.numero_factura,
          total: p.total
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

         data = clients.map(c => ({
            id: c.id,
            nombre: c.nombre,
            telefono: c.telefono,
            email: c.email,
            saldo: c.saldo_actual || 0
         }));
      }

      // 4. CUENTA CORRIENTE
      else if (selectedReport.id === 'cuenta_corriente') {
         const { data: movs, error } = await supabase
           .from('cuenta_corriente_movimientos')
           .select('*, clientes(nombre)')
           .eq('empresa_id', user.empresa_id)
           .gte('created_at', start)
           .lte('created_at', end)
           .order('created_at', { ascending: false });

         if (error) throw error;

         data = movs.map(m => ({
           id: m.id,
           fecha: m.created_at,
           cliente: m.clientes?.nombre || 'Desconocido',
           tipo: m.tipo,
           descripcion: m.descripcion,
           monto: m.monto
         }));
      }

      // 5. FINANCIERO
      else if (selectedReport.id === 'financiero') {
         const { data: fins, error } = await supabase
            .from('movimientos_caja')
            .select('*')
            .eq('empresa_id', user.empresa_id)
            .gte('fecha', start)
            .lte('fecha', end)
            .order('fecha', { ascending: false });
         if (error) throw error;
         data = fins;
      }

      // 6. MERCADOPAGO POR TIPO
      else if (selectedReport.id === 'mp_movimientos') {
        const { data: movs, error } = await supabase
          .from('movimientos_bancarios')
          .select('id, fecha, descripcion, subtipo, monto')
          .eq('empresa_id', user.empresa_id)
          .eq('origen', 'mercadopago')
          .gte('fecha', start)
          .lte('fecha', end)
          .order('fecha', { ascending: false });

        if (error) throw error;
        data = movs;
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
  const handleDownloadPDF = () => {
    try {
      const { columns, totals } = getTableConfig(selectedReport.id, reportData);
      const summaryMetrics = buildSummaryMetrics(selectedReport.id, reportData);

      generatePDF({
        title:           selectedReport.title,
        startDate:       startDate,
        endDate:         endDate,
        columns:         columns,
        data:            reportData,
        totals:          totals ? totals.map(t => t.content) : null,
        filename:        selectedReport.id,
        companyName:     config?.nombre_empresa || 'KAIROX Gestión',
        summaryMetrics,
      });

      toast({ title: "Éxito", description: "PDF generado correctamente.", className: "bg-green-600 text-white" });
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Falló la generación del PDF.", variant: "destructive" });
    }
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
        reportData={reportData} handleDownloadPDF={handleDownloadPDF}
      />
    </div>
  );
}

export default ReportesSection;
