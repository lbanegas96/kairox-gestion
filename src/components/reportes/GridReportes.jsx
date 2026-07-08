import { FileSpreadsheet, ArrowLeftRight, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { REPORTS } from './reportDefinitions';

function GridReportes({
  openReportDialog,
  tcParaleloEnabled, monedaParalela, setShowParidad,
  afipActivo, setShowLibroIVA, setLibroIVAOrigen,
}) {
  return (
    <>
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
        {REPORTS.map((report) => (
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
              {report.badge && (
                <span className="text-xs font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">
                  {report.badge}
                </span>
              )}
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
          className="group bg-kx-surface border border-kx-border rounded-2xl p-6 shadow-sm dark:shadow-none
            border-t-2 border-t-kx-violet transition-all duration-200
            hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
          onClick={() => { setShowLibroIVA(true); setLibroIVAOrigen('reportes'); }}
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
              Comprobantes emitidos con neto gravado e IVA discriminado por período.
            </p>
          </div>
          <Button
            className="w-full bg-kx-surface-2 hover:bg-kx-border text-kx-text border border-kx-border transition-all"
          >
            Ver Libro IVA Ventas
          </Button>
        </div>
      </div>
    </>
  );
}

export default GridReportes;
