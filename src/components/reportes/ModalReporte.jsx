import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import ReportHeader from '@/components/reportes/ReportHeader';
import ReportTable from '@/components/reportes/ReportTable';
import { getTableConfig, applyGrouping, getGroupByOptions, applyFiltroDeuda } from './reportDefinitions';

function ModalReporte({
  isDialogOpen, setIsDialogOpen,
  selectedReport,
  startDate, setStartDate, endDate, setEndDate,
  handleGenerate, resetFilters, loading,
  reportData, handleDownloadPDF, handleDownloadExcel, handleShareWhatsApp,
  centrosCosto, centroCostoId, setCentroCostoId,
  clientesList, clienteId, setClienteId,
  productosList, productoId, setProductoId,
  groupBy, setGroupBy,
  soloConDeuda, setSoloConDeuda,
  onNavigate,
}) {
  // Totales/columnas siempre sobre los datos crudos filtrados (nunca sobre
  // las filas sintéticas de agrupamiento, o el total general quedaría
  // duplicado con los subtotales) — solo la vista de tabla usa los datos
  // agrupados.
  const filteredData = selectedReport ? applyFiltroDeuda(selectedReport.id, reportData, soloConDeuda) : reportData;
  const { columns, totals } = selectedReport ? getTableConfig(selectedReport.id, filteredData, { onNavigate }) : { columns: [], totals: null };
  const displayData = selectedReport ? applyGrouping(selectedReport.id, filteredData, groupBy) : filteredData;

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      {/* size="wide" — mismo shell que Factura/OC/Cotización/etc (hallazgo
          Luciano 19/09: los reportes tenían su propio max-w-[900px] y
          forzaban scroll lateral en tablas con muchas columnas, mientras el
          resto de los documentos ya usaba este shell compartido desde el
          22/08). Ver dialog.jsx para los gotchas de calc() si se toca. */}
      <DialogContent size="wide" className="kairox-bg-card border kairox-border kairox-text-primary dark:bg-kx-bg dark:border-kx-border">
        <DialogTitle className="sr-only">{selectedReport?.title ?? 'Reporte'}</DialogTitle>
        <DialogDescription className="sr-only">Visualización y descarga del reporte seleccionado.</DialogDescription>
        {selectedReport && (
          <>
            {/* size="wide" trae p-0 en el shell (mismo motivo que
                NuevaFacturaModal.jsx: header/footer necesitan su propio
                padding, no uno solo para todo el modal) — sin esto el
                contenido queda pegado al borde. */}
            <div className="flex-none px-4 pt-4">
              <ReportHeader
                title={selectedReport.title}
                showDateFilter={selectedReport.requiresDate !== false}
                startDate={startDate}
                setStartDate={setStartDate}
                endDate={endDate}
                setEndDate={setEndDate}
                onGenerate={handleGenerate}
                onClear={resetFilters}
                loading={loading}
                hasData={filteredData.length > 0}
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
                groupByOptions={getGroupByOptions(selectedReport.id)}
                showFiltroDeuda={!!selectedReport.supportsFiltroDeuda}
                soloConDeuda={soloConDeuda}
                setSoloConDeuda={setSoloConDeuda}
                showClienteFilter={!!selectedReport.requiresCliente}
                clientesList={clientesList}
                clienteId={clienteId}
                setClienteId={setClienteId}
                showProductoFilter={!!selectedReport.requiresProducto}
                productosList={productosList}
                productoId={productoId}
                setProductoId={setProductoId}
              />
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 mt-4 min-h-[300px]">
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
