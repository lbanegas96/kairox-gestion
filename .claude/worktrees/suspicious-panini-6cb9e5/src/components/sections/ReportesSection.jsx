import React, { useState, useEffect } from 'react';
import { getTodayAR } from '@/lib/dateUtils';
import { motion } from 'framer-motion';
import { 
  BarChart3, Package, TrendingUp, Banknote, ShoppingCart, 
  Users, CreditCard, FileSpreadsheet
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { generatePDF } from '@/lib/pdfUtils';
import ReportHeader from '@/components/reports/ReportHeader';
import ReportTable from '@/components/reports/ReportTable';

function ReportesSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [selectedReport, setSelectedReport] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Filters
  const todayAR = getTodayAR();
  const firstOfMonth = todayAR.substring(0, 7) + '-01';
  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(todayAR);
  
  // Data
  const [reportData, setReportData] = useState([]);

  // Report Definitions
  const reports = [
    {
      id: 'ventas',
      title: 'Reporte de Ventas',
      description: 'Detalle de ventas por período con totales.',
      icon: <BarChart3 className="w-8 h-8 text-blue-500" />,
      gradient: 'from-blue-600 to-blue-500',
      requiresDate: true
    },
    {
      id: 'compras',
      title: 'Historial de Compras',
      description: 'Registro detallado de compras a proveedores.',
      icon: <ShoppingCart className="w-8 h-8 text-rose-500" />,
      gradient: 'from-rose-600 to-red-500',
      requiresDate: true
    },
    {
      id: 'clientes',
      title: 'Cartera de Clientes',
      description: 'Estado de cuentas y saldos de clientes.',
      icon: <Users className="w-8 h-8 text-emerald-500" />,
      gradient: 'from-emerald-600 to-emerald-500',
      requiresDate: false 
    },
    {
      id: 'cuenta_corriente',
      title: 'Movimientos Cta. Corriente',
      description: 'Flujo de pagos y deudas global.',
      icon: <CreditCard className="w-8 h-8 text-violet-500" />,
      gradient: 'from-violet-600 to-purple-500',
      requiresDate: true
    },
     {
      id: 'financiero',
      title: 'Reporte Financiero',
      description: 'Balance de ingresos y egresos de caja.',
      icon: <Banknote className="w-8 h-8 text-amber-500" />,
      gradient: 'from-amber-500 to-orange-500',
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
          { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => new Date(r.fecha).toLocaleDateString('es-AR'), pdfRender: (r) => new Date(r.fecha).toLocaleDateString('es-AR') },
          { header: 'Cliente', key: 'cliente', align: 'left' },
          { header: 'Pago', key: 'metodo_pago', align: 'center' },
          { header: 'Items', key: 'items', align: 'center' },
          { header: 'Total', key: 'total', align: 'right', render: (r) => `$${Number(r.total).toFixed(2)}`, pdfRender: (r) => `$${Number(r.total).toFixed(2)}` }
        ],
        totals: [
          { content: 'TOTALES', colSpan: 3, align: 'right' },
          { content: data.length, align: 'center' },
          { content: `$${totalAmount.toFixed(2)}`, align: 'right' }
        ]
      };
    }
    
    if (reportId === 'compras') {
      const totalAmount = data.reduce((acc, curr) => acc + (curr.total || 0), 0);
      return {
        columns: [
          { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => new Date(r.fecha).toLocaleDateString('es-AR'), pdfRender: (r) => new Date(r.fecha).toLocaleDateString('es-AR') },
          { header: 'Proveedor', key: 'proveedor', align: 'left' },
          { header: 'N° Factura', key: 'numero_factura', align: 'left' },
          { header: 'Total', key: 'total', align: 'right', render: (r) => `$${Number(r.total).toFixed(2)}`, pdfRender: (r) => `$${Number(r.total).toFixed(2)}` }
        ],
        totals: [
          { content: 'TOTAL COMPRAS', colSpan: 3, align: 'right' },
          { content: `$${totalAmount.toFixed(2)}`, align: 'right' }
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
          { header: 'Saldo Actual', key: 'saldo', align: 'right', render: (r) => <span className={r.saldo > 0 ? 'text-red-600 font-bold' : 'text-green-600 dark:text-green-400'}>${Number(r.saldo).toFixed(2)}</span>, pdfRender: (r) => `$${Number(r.saldo).toFixed(2)}` }
        ],
        totals: [
          { content: 'TOTAL CARTERA', colSpan: 3, align: 'right' },
          { content: `$${totalBalance.toFixed(2)}`, align: 'right' }
        ]
       };
    }

    if (reportId === 'cuenta_corriente') {
       const totalDebe = data.filter(d => d.tipo === 'DEBE').reduce((acc, c) => acc + c.monto, 0);
       const totalHaber = data.filter(d => d.tipo === 'HABER').reduce((acc, c) => acc + c.monto, 0);
       const balance = totalDebe - totalHaber;
       
       return {
         columns: [
           { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => new Date(r.fecha).toLocaleDateString('es-AR'), pdfRender: (r) => new Date(r.fecha).toLocaleDateString('es-AR') },
           { header: 'Cliente', key: 'cliente', align: 'left' },
           { header: 'Tipo', key: 'tipo', align: 'center', render: (r) => <span className={`px-2 py-1 rounded text-xs font-bold ${r.tipo === 'DEBE' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>{r.tipo}</span> },
           { header: 'Descripción', key: 'descripcion', align: 'left' },
           { header: 'Monto', key: 'monto', align: 'right', render: (r) => `$${Number(r.monto).toFixed(2)}`, pdfRender: (r) => `$${Number(r.monto).toFixed(2)}` }
         ],
         totals: [
            { content: `DEBE: $${totalDebe.toFixed(2)} | HABER: $${totalHaber.toFixed(2)} | NETO: $${balance.toFixed(2)}`, colSpan: 5, align: 'right' }
         ]
       };
    }

    if (reportId === 'financiero') {
        const ingresos = data.filter(d => d.tipo === 'ingreso').reduce((acc, curr) => acc + curr.monto, 0);
        const egresos = data.filter(d => d.tipo === 'egreso').reduce((acc, curr) => acc + curr.monto, 0);
        return {
          columns: [
             { header: 'Fecha', key: 'fecha', align: 'left', render: (r) => new Date(r.fecha).toLocaleDateString('es-AR'), pdfRender: (r) => new Date(r.fecha).toLocaleDateString('es-AR') },
             { header: 'Tipo', key: 'tipo', align: 'center', render: (r) => r.tipo.toUpperCase() },
             { header: 'Categoría', key: 'categoria', align: 'left' },
             { header: 'Concepto', key: 'concepto', align: 'left' },
             { header: 'Monto', key: 'monto', align: 'right', render: (r) => `$${Number(r.monto).toFixed(2)}`, pdfRender: (r) => `$${Number(r.monto).toFixed(2)}` }
          ],
          totals: [
             { content: `INGRESOS: $${ingresos.toFixed(2)} | EGRESOS: $${egresos.toFixed(2)} | BALANCE: $${(ingresos - egresos).toFixed(2)}`, colSpan: 5, align: 'right' }
          ]
        };
    }

    return { columns: [], totals: [] };
  };

  return (
    <div className="space-y-8 pb-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-transparent p-6 -mx-6 -mt-6 mb-6 border-b border-slate-200 dark:border-none">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
             <FileSpreadsheet className="w-8 h-8 text-blue-600 dark:text-[#00D4FF]" />
             Centro de Reportes
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            Genera y exporta información detallada para la toma de decisiones estratégicas.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reports.map((report, index) => (
          <motion.div
            key={report.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="group relative kairox-bg-card border kairox-border hover:border-slate-400 dark:hover:border-slate-600 rounded-xl p-6 shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden cursor-pointer dark:bg-slate-950 dark:border-slate-800"
            onClick={() => openReportDialog(report)}
          >
            <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${report.gradient} opacity-5 rounded-bl-[100px] transition-opacity group-hover:opacity-10`} />
            
            <div className="flex items-start justify-between mb-4 relative z-10">
              <div className="p-3 bg-slate-100 dark:bg-slate-900 rounded-lg border kairox-border group-hover:border-slate-300 dark:group-hover:border-slate-700 transition-colors">
                {report.icon}
              </div>
            </div>
            
            <div className="mb-6 relative z-10">
              <h3 className="text-xl font-bold kairox-text-primary dark:text-white mb-2 group-hover:text-blue-600 dark:group-hover:text-[#00D4FF] transition-colors">
                {report.title}
              </h3>
              <p className="kairox-text-secondary dark:text-slate-400 text-sm h-10 line-clamp-2">
                {report.description}
              </p>
            </div>
            
            <Button className="w-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white border kairox-border group-hover:border-slate-300 dark:group-hover:border-slate-500 transition-all relative z-10">
              Ver Reporte
            </Button>
          </motion.div>
        ))}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="kairox-bg-card border kairox-border kairox-text-primary sm:max-w-[900px] flex flex-col max-h-[90vh] dark:bg-slate-950 dark:border-slate-800">
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