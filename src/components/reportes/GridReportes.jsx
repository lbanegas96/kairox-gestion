import { useState } from 'react';
import { FileSpreadsheet, ArrowLeftRight, BookOpen, Columns, GitCompareArrows, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { REPORTS } from './reportDefinitions';
import ReportInfoDialog, { ReportInfoButton } from './ReportInfoDialog';

const AYUDA_PARIDAD = {
  queEs: 'Compara el monto en Pesos contra el equivalente en la moneda paralela configurada (ej. Dólares), operación por operación, al tipo de cambio vigente en el momento de cada una.',
  queMuestra: ['Comprobante, monto en ARS y monto en moneda paralela', 'Tipo de cambio usado en cada operación', 'Posición actual: el total revaluado al tipo de cambio de hoy'],
  filtros: ['Requiere tener la Moneda Paralela activada en Configuración → Finanzas'],
};
const AYUDA_LIBRO_IVA_VENTAS = {
  queEs: 'Detalle de comprobantes emitidos con el IVA discriminado, en el formato que se usa para la posición mensual de IVA ante AFIP/ARCA.',
  queMuestra: ['Fecha, comprobante y cliente (con CUIT si corresponde)', 'Neto gravado e IVA discriminado por alícuota', 'Total por comprobante'],
  filtros: ['Rango de fechas (normalmente un mes calendario)'],
};
const AYUDA_LIBRO_IVA_COMPRAS = {
  queEs: 'Detalle de facturas de compra recibidas con el IVA Crédito Fiscal discriminado, en el formato que se usa para la posición mensual de IVA ante AFIP/ARCA.',
  queMuestra: ['Fecha, factura y proveedor (con CUIT si corresponde)', 'Neto gravado e IVA discriminado por alícuota', 'Total por factura'],
  filtros: ['Rango de fechas (normalmente un mes calendario)'],
};
const AYUDA_ESTADO_RESULTADOS_CC = {
  queEs: 'El mismo Estado de Resultados de Plan de Cuentas, pero con todos los Centros de Costo activos lado a lado en vez de tener que mirarlos uno a la vez.',
  queMuestra: ['Ingresos y Egresos por cuenta, una columna por Centro de Costo + el Total', 'Resultado del Período de cada Centro de Costo'],
  filtros: ['Rango de fechas', 'Requiere tener Centros de Costo activados en Configuración → Finanzas'],
};
const AYUDA_COMPARATIVO_PERIODOS = {
  queEs: 'Compara el resultado de 2 períodos contables ya CERRADOS (no un rango de fechas cualquiera) — el número que se muestra es el que quedó certificado al momento del cierre, no se recalcula.',
  queMuestra: ['Ingresos, Egresos y Resultado de cada período elegido', 'Variación % de un período contra el otro'],
  filtros: ['Elegí cuáles 2 períodos cerrados comparar — necesitás al menos 2 cerrados para poder usar este reporte'],
};
const AYUDA_POSICION_FISCAL = {
  queEs: 'Cruza en una sola pantalla los 3 cálculos impositivos que hoy viven sueltos en Impuestos: IVA (Débito vs. Crédito Fiscal), Ingresos Brutos y Retenciones.',
  queMuestra: ['Saldo de IVA del período (a pagar o a favor)', 'Base Imponible de IIBB y Coeficiente de Distribución (el sistema no tiene cargada la alícuota, así que no calcula el monto en pesos)', 'Retenciones Sufridas (a favor) y Practicadas (depósito de terceros, aparte)', 'Total Neto Estimado a Pagar — IVA menos Retenciones Sufridas, sin incluir IIBB'],
  filtros: ['Rango de fechas'],
};

function GridReportes({
  openReportDialog,
  tcParaleloEnabled, monedaParalela, setShowParidad,
  afipActivo, setShowLibroIVA, setLibroIVAOrigen, setShowLibroIVACompras,
  setShowEstadoResultadosCC, setShowComparativoPeriodos, setShowPosicionFiscal,
}) {
  const [infoAbierto, setInfoAbierto] = useState(null); // { title, icon, ayuda } | null

  return (
    <>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-kx-surface dark:bg-transparent p-6 -mx-6 -mt-6 mb-6 border-b border-kx-border dark:border-none">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-kx-text mb-2 flex items-center gap-2">
            <FileSpreadsheet className="w-8 h-8 text-blue-600 dark:text-kx-violet" />
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
              <div className="flex items-center gap-1">
                {report.badge && (
                  <span className="text-xs font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">
                    {report.badge}
                  </span>
                )}
                {report.ayuda && (
                  <ReportInfoButton onClick={() => setInfoAbierto({ title: report.title, icon: report.icon, ayuda: report.ayuda })} />
                )}
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
            <div className="flex items-center gap-1">
              {tcParaleloEnabled && (
                <span className="text-xs font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">
                  {monedaParalela}
                </span>
              )}
              <ReportInfoButton onClick={() => setInfoAbierto({ title: 'Reporte de Paridad', icon: <ArrowLeftRight className="w-8 h-8 text-kx-blue" />, ayuda: AYUDA_PARIDAD })} />
            </div>
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
            <div className="flex items-center gap-1">
              {afipActivo && (
                <span className="text-xs font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">
                  AFIP
                </span>
              )}
              <ReportInfoButton onClick={() => setInfoAbierto({ title: 'Libro IVA Ventas', icon: <BookOpen className="w-8 h-8 text-kx-violet" />, ayuda: AYUDA_LIBRO_IVA_VENTAS })} />
            </div>
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

        {/* ── Libro IVA Compras (AFIP) ── */}
        <div
          className="group bg-kx-surface border border-kx-border rounded-2xl p-6 shadow-sm dark:shadow-none
            border-t-2 border-t-kx-blue transition-all duration-200
            hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
          onClick={() => setShowLibroIVACompras(true)}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-kx-surface-2 rounded-xl border border-kx-border">
              <BookOpen className="w-8 h-8 text-kx-blue" />
            </div>
            <div className="flex items-center gap-1">
              {afipActivo && (
                <span className="text-xs font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">
                  AFIP
                </span>
              )}
              <ReportInfoButton onClick={() => setInfoAbierto({ title: 'Libro IVA Compras', icon: <BookOpen className="w-8 h-8 text-kx-blue" />, ayuda: AYUDA_LIBRO_IVA_COMPRAS })} />
            </div>
          </div>
          <div className="mb-5">
            <h3 className="text-lg font-bold text-kx-text mb-1.5 group-hover:text-kx-violet transition-colors">
              Libro IVA Compras
            </h3>
            <p className="text-kx-text-2 text-sm line-clamp-2">
              Facturas recibidas con neto gravado e IVA Crédito Fiscal discriminado por período.
            </p>
          </div>
          <Button
            className="w-full bg-kx-surface-2 hover:bg-kx-border text-kx-text border border-kx-border transition-all"
          >
            Ver Libro IVA Compras
          </Button>
        </div>

        {/* ── Estado de Resultados por Centro de Costo ── */}
        <div
          className="group bg-kx-surface border border-kx-border rounded-2xl p-6 shadow-sm dark:shadow-none
            border-t-2 border-t-kx-violet transition-all duration-200
            hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
          onClick={() => setShowEstadoResultadosCC(true)}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-kx-surface-2 rounded-xl border border-kx-border">
              <Columns className="w-8 h-8 text-kx-violet" />
            </div>
            <ReportInfoButton onClick={() => setInfoAbierto({ title: 'Estado de Resultados por Centro de Costo', icon: <Columns className="w-8 h-8 text-kx-violet" />, ayuda: AYUDA_ESTADO_RESULTADOS_CC })} />
          </div>
          <div className="mb-5">
            <h3 className="text-lg font-bold text-kx-text mb-1.5 group-hover:text-kx-violet transition-colors">
              Estado de Resultados por CC
            </h3>
            <p className="text-kx-text-2 text-sm line-clamp-2">
              Ingresos, Egresos y Resultado de cada Centro de Costo, lado a lado.
            </p>
          </div>
          <Button className="w-full bg-kx-surface-2 hover:bg-kx-border text-kx-text border border-kx-border transition-all">
            Ver Reporte
          </Button>
        </div>

        {/* ── Comparativo entre Períodos Cerrados ── */}
        <div
          className="group bg-kx-surface border border-kx-border rounded-2xl p-6 shadow-sm dark:shadow-none
            border-t-2 border-t-kx-blue transition-all duration-200
            hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
          onClick={() => setShowComparativoPeriodos(true)}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-kx-surface-2 rounded-xl border border-kx-border">
              <GitCompareArrows className="w-8 h-8 text-kx-blue" />
            </div>
            <ReportInfoButton onClick={() => setInfoAbierto({ title: 'Comparativo entre Períodos Cerrados', icon: <GitCompareArrows className="w-8 h-8 text-kx-blue" />, ayuda: AYUDA_COMPARATIVO_PERIODOS })} />
          </div>
          <div className="mb-5">
            <h3 className="text-lg font-bold text-kx-text mb-1.5 group-hover:text-kx-violet transition-colors">
              Comparativo entre Períodos
            </h3>
            <p className="text-kx-text-2 text-sm line-clamp-2">
              Cómo te fue en un período cerrado comparado con otro.
            </p>
          </div>
          <Button className="w-full bg-kx-surface-2 hover:bg-kx-border text-kx-text border border-kx-border transition-all">
            Ver Reporte
          </Button>
        </div>

        {/* ── Posición Fiscal Consolidada ── */}
        <div
          className="group bg-kx-surface border border-kx-border rounded-2xl p-6 shadow-sm dark:shadow-none
            border-t-2 border-t-kx-red transition-all duration-200
            hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
          onClick={() => setShowPosicionFiscal(true)}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-kx-surface-2 rounded-xl border border-kx-border">
              <Landmark className="w-8 h-8 text-kx-red" />
            </div>
            <ReportInfoButton onClick={() => setInfoAbierto({ title: 'Posición Fiscal Consolidada', icon: <Landmark className="w-8 h-8 text-kx-red" />, ayuda: AYUDA_POSICION_FISCAL })} />
          </div>
          <div className="mb-5">
            <h3 className="text-lg font-bold text-kx-text mb-1.5 group-hover:text-kx-violet transition-colors">
              Posición Fiscal Consolidada
            </h3>
            <p className="text-kx-text-2 text-sm line-clamp-2">
              IVA, IIBB y Retenciones del período, cruzados en un solo lugar.
            </p>
          </div>
          <Button className="w-full bg-kx-surface-2 hover:bg-kx-border text-kx-text border border-kx-border transition-all">
            Ver Reporte
          </Button>
        </div>
      </div>

      <ReportInfoDialog
        open={!!infoAbierto}
        onOpenChange={(v) => !v && setInfoAbierto(null)}
        title={infoAbierto?.title}
        icon={infoAbierto?.icon}
        ayuda={infoAbierto?.ayuda}
      />
    </>
  );
}

export default GridReportes;
