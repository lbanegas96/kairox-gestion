import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import ReportHeader from '@/components/reportes/ReportHeader';
import ReportTable from '@/components/reportes/ReportTable';
import { getTableConfig, applyGrouping } from './reportDefinitions';

function ModalReporte({
  isDialogOpen, setIsDialogOpen,
  selectedReport,
  startDate, setStartDate, endDate, setEndDate,
  handleGenerate, resetFilters, loading,
  reportData, handleDownloadPDF, handleDownloadExcel, handleShareWhatsApp,
  centrosCosto, centroCostoId, setCentroCostoId,
  groupBy, setGroupBy,
}) {
  // Totales/columnas siempre sobre los datos crudos (nunca sobre las filas
  // sintéticas de agrupamiento, o el total general quedaría duplicado con
  // los subtotales) — solo la vista de tabla usa los datos agrupados.
  const { columns, totals } = selectedReport ? getTableConfig(selectedReport.id, reportData) : { columns: [], totals: null };
  const displayData = selectedReport ? applyGrouping(selectedReport.id, reportData, groupBy) : reportData;

  return (
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
                onDownloadExcel={handleDownloadExcel}
                onShareWhatsApp={handleShareWhatsApp}
                showCentroCosto={!!selectedReport.supportsCentroCosto}
                centrosCosto={centrosCosto}
                centroCostoId={centroCostoId}
                setCentroCostoId={setCentroCostoId}
                showGroupBy={!!selectedReport.supportsGroupBy}
                groupBy={groupBy}
                setGroupBy={setGroupBy}
              />
            </div>

            <div className="flex-1 overflow-y-auto mt-4 min-h-[300px]">
              <ReportTable
                columns={columns}
                data={displayData}
                loading={loading}
                totals={totals}
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ModalReporte;
