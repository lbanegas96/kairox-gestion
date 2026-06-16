import React, { useState, useEffect } from 'react';

import {
  BarChart3, Package, TrendingUp, Banknote, ShoppingCart,
  Users, CreditCard, FileSpreadsheet, ArrowLeftRight, BookOpen
} from 'lucide-react';
import ReporteParidad from '@/components/reportes/ReporteParidad';
import ReporteLibroIVA from '@/components/reportes/ReporteLibroIVA';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { generatePDF } from '@/lib/pdfUtils';
import ReportHeader from '@/components/reports/ReportHeader';
import ReportTable from '@/components/reports/ReportTable';
import { formatDateAR } from '@/lib/dateUtils';
import { formatCurrency } from '@/lib/currencyUtils';

function ReportesSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { enabled: tcParaleloEnabled, monedaParalela } = useTCParalelo();

  const [selectedReport, setSelectedReport] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showParidad, setShowParidad] = useState(false);
  const [showLibroIVA, setShowLibroIVA] = useState(false);
  const [afipActivo, setAfipActivo] = useState(false);

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

  // Report Definitions
  const reports = [
    {
      id: 'ventas',
      title: 'Reporte de Ventas',
      description: 'Detalle de ventas por período con totales.',
      icon: <BarChart3 className="w-8 h-8 text-kx-violet" />,
      borderClass: 'border-t-kx-violet',
      requiresDate: true
    },
    {
      id: 'compras',
      title: 'Historial de Compras',
      description: 'Registro detallado de compras a proveedores.',
      icon: <ShoppingCart className="w-8 h-8 text-kx-blue" />,
      borderClass: 'border-t-kx-blue',
      requiresDate: true
    },
    {
      id: 'clientes',
      title: 'Cartera de Clientes',
      description: 'Estado de cuentas y saldos de clientes.',
      icon: <Users className="w-8 h-8 text-kx-green" />,
      borderClass: 'border-t-kx-green',
      requiresDate: false
    },
    {
      id: 'cuenta_corriente',
      title: 'Movimientos Cta. Corriente',
      description: 'Flujo de pagos y deudas global.',
      icon: <CreditCard className="w-8 h-8 text-kx-amber" />,
      borderClass: 'border-t-kx-amber',
      requiresDate: true
    },
    {
      id: 'financiero',
      title: 'Reporte Financiero',
      description: 'Balance de ingresos y egresos de caja.',
      icon: <Banknote className="w-8 h-8 text-kx-green" />,
      borderClass: 'border-t-kx-green',
      requiresDate: true
    },
  ];

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

      // 1. VENTAS — lee de comprobantes/comprobante_items (schema actual)
      if (selectedReport.id === 'ventas') {
        const { data: sales, error } = await supabase
          .from('comprobantes')
          .select('*, comprobante_items(*)')
          .eq('empresa_id', user.empresa_id)
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
      
      generatePDF({
        title: selectedReport.title,
        startDate: startDate,
        endDate: endDate,
        columns: columns,
        data: reportData,
        totals: totals ? totals.map(t => t.content) : null,
        filename: selectedReport.id
      });
      
      toast({ title: "Éxito", description: "PDF generado correctamente.", className: "bg-green-600 text-white" });
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Falló la generación del PDF.", variant: "destructive" });
    }
  };

  // --- TABLE CONFIGURATION ---
  const getTableConfig = (reportId, data) => {
    if (reportId === 'ventas') {
      const totalAmount = data.reduce((acc, curr) => acc + (curr.total || 0), 0);
      return {
        columns: [
          { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
          { header: 'Cliente', key: 'cliente', align: 'left' },
          { header: 'Pago', key: 'metodo_pago', align: 'center' },
          { header: 'Items', key: 'items', align: 'center' },
          { header: 'Total', key: 'total', align: 'right', render: (r) => formatCurrency(r.total), pdfRender: (r) => formatCurrency(r.total) }
        ],
        totals: [
          { content: 'TOTALES', colSpan: 3, align: 'right' },
          { content: data.length, align: 'center' },
          { content: formatCurrency(totalAmount), align: 'right' }
        ]
      };
    }
    
    if (reportId === 'compras') {
      const totalAmount = data.reduce((acc, curr) => acc + (curr.total || 0), 0);
      return {
        columns: [
          { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
          { header: 'Proveedor', key: 'proveedor', align: 'left' },
          { header: 'N° Factura', key: 'numero_factura', align: 'left' },
          { header: 'Total', key: 'total', align: 'right', render: (r) => formatCurrency(r.total), pdfRender: (r) => formatCurrency(r.total) }
        ],
        totals: [
          { content: 'TOTAL COMPRAS', colSpan: 3, align: 'right' },
          { content: formatCurrency(totalAmount), align: 'right' }
        ]
      };
    }

    if (reportId === 'clientes') {
       const totalBalance = data.reduce((acc, curr) => acc + (curr.saldo || 0), 0);
       return {
        columns: [
          { header: 'Nombre', key: 'nombre', align: 'left' },
          { header: 'Email', key: 'email', align: 'left', render: (r) => r.email || '-' },
          { header: 'Teléfono', key: 'telefono', align: 'left', render: (r) => r.telefono || '-' },
          { header: 'Saldo Actual', key: 'saldo', align: 'right', render: (r) => <span className={r.saldo > 0 ? 'text-red-600 font-bold' : 'text-green-600 dark:text-green-400'}>{formatCurrency(r.saldo)}</span>, pdfRender: (r) => formatCurrency(r.saldo) }
        ],
        totals: [
          { content: 'TOTAL CARTERA', colSpan: 3, align: 'right' },
          { content: formatCurrency(totalBalance), align: 'right' }
        ]
       };
    }

    if (reportId === 'cuenta_corriente') {
       const totalDebe = data.filter(d => d.tipo === 'DEBE').reduce((acc, c) => acc + c.monto, 0);
       const totalHaber = data.filter(d => d.tipo === 'HABER').reduce((acc, c) => acc + c.monto, 0);
       const balance = totalDebe - totalHaber;
       
       return {
         columns: [
           { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
           { header: 'Cliente', key: 'cliente', align: 'left' },
           { header: 'Tipo', key: 'tipo', align: 'center', render: (r) => <span className={`px-2 py-1 rounded text-xs font-bold ${r.tipo === 'DEBE' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>{r.tipo}</span> },
           { header: 'Descripción', key: 'descripcion', align: 'left' },
           { header: 'Monto', key: 'monto', align: 'right', render: (r) => formatCurrency(r.monto), pdfRender: (r) => formatCurrency(r.monto) }
         ],
         totals: [
            { content: `DEBE: ${formatCurrency(totalDebe)} | HABER: ${formatCurrency(totalHaber)} | NETO: ${formatCurrency(balance)}`, colSpan: 5, align: 'right' }
         ]
       };
    }

    if (reportId === 'financiero') {
        const ingresos = data.filter(d => d.tipo === 'ingreso').reduce((acc, curr) => acc + curr.monto, 0);
        const egresos = data.filter(d => d.tipo === 'egreso').reduce((acc, curr) => acc + curr.monto, 0);
        return {
          columns: [
             { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => formatDateAR(r.fecha), pdfRender: (r) => formatDateAR(r.fecha) },
             { header: 'Tipo', key: 'tipo', align: 'center', render: (r) => r.tipo.toUpperCase() },
             { header: 'Categoría', key: 'categoria', align: 'left' },
             { header: 'Concepto', key: 'concepto', align: 'left' },
             { header: 'Monto', key: 'monto', align: 'right', render: (r) => formatCurrency(r.monto), pdfRender: (r) => formatCurrency(r.monto) }
          ],
          totals: [
             { content: `INGRESOS: ${formatCurrency(ingresos)} | EGRESOS: ${formatCurrency(egresos)} | BALANCE: ${formatCurrency(ingresos - egresos)}`, colSpan: 5, align: 'right' }
          ]
        };
    }

    return { columns: [], totals: [] };
  };

  // Reportes inline: reemplazan el grid
  if (showParidad) {
    return <ReporteParidad onBack={() => setShowParidad(false)} />;
  }
  if (showLibroIVA) {
    return <ReporteLibroIVA onBack={() => setShowLibroIVA(false)} />;
  }

  return (
    <div className="space-y-8 pb-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-kx-surface dark:bg-transparent p-6 -mx-6 -mt-6 mb-6 border-b border-kx-border dark:border-none">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-kx-text mb-2 flex items-center gap-2">
             <FileSpreadsheet className="w-8 h-8 text-blue-600 dark:text-[#00D4FF]" />
             Centro de Reportes
          </h2>
          <p className="text-slate-500 dark:text-kx-text-2">
            Genera y exporta información detallada para la toma de decisiones estratégicas.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.map((report) => (
          <div
            key={report.id}
            className={`group bg-kx-surface border border-kx-border rounded-2xl p-6 shadow-sm dark:shadow-none
              hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer
              border-t-2 ${report.borderClass}`}
            onClick={() => openReportDialog(report)}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-kx-surface-2 rounded-xl border border-kx-border">
                {report.icon}
              </div>
            </div>

            <div className="mb-5">
              <h3 className="text-lg font-bold text-kx-text mb-1.5 group-hover:text-kx-violet transition-colors">
                {report.title}
              </h3>
              <p className="text-kx-text-2 text-sm line-clamp-2">
                {report.description}
              </p>
            </div>

            <Button className="w-full bg-kx-surface-2 hover:bg-kx-border text-kx-text border border-kx-border transition-all">
              Ver Reporte
            </Button>
          </div>
        ))}

        {/* ── Reporte de Paridad ARS / Moneda Paralela ── */}
        <div
          className={`group bg-kx-surface border border-kx-border rounded-2xl p-6 shadow-sm dark:shadow-none
            border-t-2 border-t-kx-blue transition-all duration-200
            ${tcParaleloEnabled ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : 'opacity-60 cursor-default'}`}
          onClick={() => tcParaleloEnabled && setShowParidad(true)}
          title={!tcParaleloEnabled ? 'Activá la Moneda Paralela en Configuración para usar este reporte' : ''}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-kx-surface-2 rounded-xl border border-kx-border">
              <ArrowLeftRight className="w-8 h-8 text-kx-blue" />
            </div>
            {tcParaleloEnabled && (
              <span className="text-xs font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">
                {monedaParalela}
              </span>
            )}
          </div>
          <div className="mb-5">
            <h3 className="text-lg font-bold text-kx-text mb-1.5 group-hover:text-kx-violet transition-colors">
              Reporte de Paridad
            </h3>
            <p className="text-kx-text-2 text-sm line-clamp-2">
              {tcParaleloEnabled
                ? `Comparativa ARS / ${monedaParalela} por comprobante al TC histórico.`
                : 'Activá la Moneda Paralela en Configuración para habilitar este reporte.'}
            </p>
          </div>
          <Button
            disabled={!tcParaleloEnabled}
            className="w-full bg-kx-surface-2 hover:bg-kx-border text-kx-text border border-kx-border transition-all disabled:opacity-50"
          >
            {tcParaleloEnabled ? 'Ver Reporte' : 'Requiere configuración'}
          </Button>
        </div>

        {/* ── Libro IVA Ventas (AFIP) ── */}
        <div
          className={`group bg-kx-surface border border-kx-border rounded-2xl p-6 shadow-sm dark:shadow-none
            border-t-2 border-t-kx-violet transition-all duration-200
            ${afipActivo ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : 'opacity-60 cursor-default'}`}
          onClick={() => afipActivo && setShowLibroIVA(true)}
          title={!afipActivo ? 'Activá la facturación electrónica (AFIP) en Configuración para habilitar este reporte' : ''}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-kx-surface-2 rounded-xl border border-kx-border">
              <BookOpen className="w-8 h-8 text-kx-violet" />
            </div>
            {afipActivo && (
              <span className="text-xs font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">
                AFIP
              </span>
            )}
          </div>
          <div className="mb-5">
            <h3 className="text-lg font-bold text-kx-text mb-1.5 group-hover:text-kx-violet transition-colors">
              Libro IVA Ventas
            </h3>
            <p className="text-kx-text-2 text-sm line-clamp-2">
              {afipActivo
                ? 'Comprobantes emitidos con CAE, neto gravado e IVA 21% por período.'
                : 'Activá la facturación electrónica (AFIP) en Configuración para habilitar.'}
            </p>
          </div>
          <Button
            disabled={!afipActivo}
            className="w-full bg-kx-surface-2 hover:bg-kx-border text-kx-text border border-kx-border transition-all disabled:opacity-50"
          >
            {afipActivo ? 'Ver Reporte' : 'Requiere AFIP activo'}
          </Button>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="kairox-bg-card border kairox-border kairox-text-primary sm:max-w-[900px] flex flex-col max-h-[90vh] dark:bg-kx-bg dark:border-kx-border">
          <DialogTitle className="sr-only">{selectedReport?.title ?? 'Reporte'}</DialogTitle>
          <DialogDescription className="sr-only">Visualización y descarga del reporte seleccionado.</DialogDescription>
          {selectedReport && (
             <>
               <div className="flex-none">
                 <ReportHeader 
                    title={selectedReport.title}
                    startDate={startDate}
                    setStartDate={setStartDate}
                    endDate={endDate}
                    setEndDate={setEndDate}
                    onGenerate={handleGenerate}
                    onClear={resetFilters}
                    loading={loading}
                    hasData={reportData.length > 0}
                    onDownloadPDF={handleDownloadPDF}
                 />
               </div>
               
               <div className="flex-1 overflow-y-auto mt-4 min-h-[300px]">
                 <ReportTable 
                    columns={getTableConfig(selectedReport.id, reportData).columns}
                    data={reportData}
                    loading={loading}
                    totals={getTableConfig(selectedReport.id, reportData).totals}
                 />
               </div>
             </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ReportesSection;