import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    padding: 36,
    backgroundColor: '#FFFFFF',
    color: '#1a1a1a',
  },
  header: {
    marginBottom: 18,
    paddingBottom: 12,
    borderBottom: '1pt solid #e2e8f0',
  },
  empresaNombre: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#1e40af',
    marginBottom: 3,
  },
  empresaDatos: {
    fontSize: 8,
    color: '#64748b',
    lineHeight: 1.4,
  },
  titulo: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subtitulo: {
    fontSize: 9,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 18,
  },
  box: {
    backgroundColor: '#f8fafc',
    border: '0.5pt solid #e2e8f0',
    borderRadius: 4,
    padding: 12,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  label: {
    fontSize: 8,
    color: '#64748b',
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  value: {
    fontSize: 10,
    color: '#1a1a1a',
  },
  montoBox: {
    backgroundColor: '#1e40af',
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  montoLabel: {
    color: '#FFFFFF',
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
  },
  montoValue: {
    color: '#FFFFFF',
    fontFamily: 'Helvetica-Bold',
    fontSize: 16,
  },
  sectionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#1e40af',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 36,
    right: 36,
    textAlign: 'center',
    fontSize: 8,
    color: '#94a3b8',
    borderTop: '0.5pt solid #e2e8f0',
    paddingTop: 8,
  },
});

const fmtARS = (n) =>
  `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtFecha = (dateStr) => {
  if (!dateStr) return '—';
  const [y, m, d] = String(dateStr).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export function CertificadoRetencionPDF({ retencion, empresaData }) {
  const impuestoLabel = retencion.impuesto === 'IIBB'
    ? 'INGRESOS BRUTOS'
    : retencion.impuesto === 'Ganancias'
      ? 'GANANCIAS'
      : (retencion.impuesto ?? '').toUpperCase();

  return (
    <Document title={`Certificado de Retención ${retencion.numero_certificado ?? ''}`}>
      <Page size="A4" style={styles.page}>
        {/* AGENTE DE RETENCIÓN (empresa) */}
        <View style={styles.header}>
          <Text style={styles.empresaNombre}>{empresaData?.nombre ?? 'KAIROX Gestión'}</Text>
          <Text style={styles.empresaDatos}>
            {'CUIT: ' + (empresaData?.afip_cuit ?? '—') + '\n'}
            {'Condición IVA: ' + (empresaData?.condicion_iva ?? '—') + '\n'}
            {'Agente de retención'}
          </Text>
        </View>

        <Text style={styles.titulo}>{'Certificado de Retención — ' + impuestoLabel}</Text>
        <Text style={styles.subtitulo}>
          {'Nro. ' + (retencion.numero_certificado ?? '—') + '  ·  Emitido el ' + fmtFecha(retencion.fecha)}
        </Text>

        {/* SUJETO RETENIDO */}
        <Text style={styles.sectionTitle}>Sujeto retenido</Text>
        <View style={styles.box}>
          <View style={styles.row}>
            <Text style={styles.label}>Nombre / Razón social</Text>
            <Text style={styles.value}>{retencion.contraparte_nombre ?? '—'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>CUIT</Text>
            <Text style={styles.value}>{retencion.contraparte_cuit ?? '—'}</Text>
          </View>
        </View>

        {/* DETALLE */}
        <Text style={styles.sectionTitle}>Detalle de la retención</Text>
        <View style={styles.box}>
          <View style={styles.row}>
            <Text style={styles.label}>Impuesto</Text>
            <Text style={styles.value}>{retencion.impuesto}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Jurisdicción / Régimen</Text>
            <Text style={styles.value}>{retencion.jurisdiccion ?? '—'}</Text>
          </View>
          {retencion.alicuota_aplicada != null ? (
            <View style={styles.row}>
              <Text style={styles.label}>Alícuota aplicada</Text>
              <Text style={styles.value}>{Number(retencion.alicuota_aplicada) + ' %'}</Text>
            </View>
          ) : null}
          {retencion.observaciones ? (
            <View style={styles.row}>
              <Text style={styles.label}>Concepto</Text>
              <Text style={styles.value}>{retencion.observaciones}</Text>
            </View>
          ) : null}
        </View>

        {/* MONTO RETENIDO */}
        <View style={styles.montoBox}>
          <Text style={styles.montoLabel}>MONTO RETENIDO</Text>
          <Text style={styles.montoValue}>{fmtARS(retencion.monto)}</Text>
        </View>

        <Text style={styles.footer}>
          Este certificado debe ser conservado por el sujeto retenido para su declaración jurada.{'\n'}
          Generado por KAIROX Gestión.
        </Text>
      </Page>
    </Document>
  );
}

export default CertificadoRetencionPDF;
