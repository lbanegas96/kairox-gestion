import jsPDF from 'jspdf';
import { formatDateTimeAR, getNowAR } from './dateUtils';
import 'jspdf-autotable';

export const generatePDF = ({
  title,
  startDate,
  endDate,
  columns,
  data,
  totals = null,
  filename = 'reporte'
}) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  
  // Header
  // Logo placeholder or text
  doc.setFontSize(22);
  doc.setTextColor(0, 51, 102); // Dark blue
  doc.text('KAIROX Gestión', 14, 20);
  
  // Report Title
  doc.setFontSize(14);
  doc.setTextColor(100);
  doc.text(title, 14, 30);
  
  // Metadata
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(`Período: ${startDate} al ${endDate}`, 14, 38);
  doc.text(`Generado: ${formatDateTimeAR(getNowAR().toISOString())}`, 14, 44);

  // Line Separator
  doc.setLineWidth(0.5);
  doc.setDrawColor(200);
  doc.line(14, 48, pageWidth - 14, 48);

  // Prepare body data based on keys in columns
  const bodyData = data.map(row => {
    return columns.map(col => {
      // Handle custom render logic if it was simple string, but for PDF we usually need raw values.
      // We assume data objects have keys corresponding to col.key
      // If data has a 'renderPDF' property for a column, use that, otherwise use col.key
      if (col.pdfRender) return col.pdfRender(row);
      return row[col.key];
    });
  });

  // Table
  doc.autoTable({
    startY: 55,
    head: [columns.map(c => c.header)],
    body: bodyData,
    theme: 'striped',
    headStyles: { 
      fillColor: [41, 128, 185],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'center'
    },
    styles: { 
      fontSize: 9,
      cellPadding: 3,
      valign: 'middle'
    },
    columnStyles: columns.reduce((acc, col, index) => {
      if (col.align) acc[index] = { halign: col.align };
      return acc;
    }, {}),
    alternateRowStyles: {
      fillColor: [245, 245, 245]
    },
    foot: totals ? [totals] : undefined,
    footStyles: {
      fillColor: [220, 220, 220],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      halign: 'right' // Default right align for totals often looks best
    },
    didDrawPage: (data) => {
      // Footer
      const str = 'Página ' + doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(str, pageWidth - 30, doc.internal.pageSize.height - 10);
      doc.text("KAIROX Gestión - Sistema Integral", 14, doc.internal.pageSize.height - 10);
    }
  });

  doc.save(`${filename}_${new Date().toISOString().slice(0,10)}.pdf`);
};