import React from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import ReportHeader from '@/components/reports/ReportHeader';
import ReportTable from '@/components/reports/ReportTable';
import { getTableConfig } from './reportDefinitions';

function ModalReporte({
  isDialogOpen, setIsDialogOpen,
  selectedReport,
  startDate, setStartDate, endDate, setEndDate,
  handleGenerate, resetFilters, loading,
  reportData, handleDownloadPDF,
}) {
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
  );
}

export default ModalReporte;
