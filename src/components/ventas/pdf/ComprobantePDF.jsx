import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    padding: 30,
    backgroundColor: '#FFFFFF',
    color: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
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
  tipoBadge: {
    width: 50,
    height: 50,
    border: '2pt solid #1e40af',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tipoLetra: {
    fontSize: 28,
    fontFamily: 'Helvetica-Bold',
    color: '#1e40af',
  },
  comprobanteBox: {
    backgroundColor: '#f8fafc',
    border: '0.5pt solid #e2e8f0',
    borderRadius: 4,
    padding: 10,
    marginBottom: 12,
  },
  comprobanteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  label: {
    fontSize: 8,
    color: '#64748b',
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  value: {
    fontSize: 9,
    color: '#1a1a1a',
  },
  clienteBox: {
    marginBottom: 12,
    padding: 8,
    border: '0.5pt solid #e2e8f0',
    borderRadius: 4,
  },
  table: {
    marginBottom: 12,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1e40af',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  tableHeaderText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottom: '0.5pt solid #f1f5f9',
  },
  tableRowAlt: {
    backgroundColor: '#f8fafc',
  },
  totalesBox: {
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 180,
    marginBottom: 2,
  },
  totalFinal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 180,
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: '#1e40af',
    borderRadius: 4,
    marginTop: 4,
  },
  totalFinalText: {
    color: '#FFFFFF',
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
  },
  caeSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 16,
    paddingTop: 12,
    borderTop: '1pt solid #e2e8f0',
  },
  caeBox: {
    flex: 1,
  },
  caeLabel: {
    fontSize: 8,
    color: '#64748b',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  caeValue: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#1a1a1a',
    letterSpacing: 0.5,
  },
  caeFecha: {
    fontSize: 8,
    color: '#64748b',
    marginTop: 2,
  },
  qrImage: {
    width: 80,
    height: 80,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 30,
    right: 30,
    textAlign: 'center',
    fontSize: 7,
    color: '#94a3b8',
    borderTop: '0.5pt solid #e2e8f0',
    paddingTop: 6,
  },
});

const formatARS = (num) =>
  Number(num).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatFecha = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export function ComprobantePDF({ comprobante, items, pagos, empresaData, qrDataUrl }) {
  const tipoLabel = comprobante.tipo_comprobante_afip
    ? `Factura ${comprobante.tipo_comprobante_afip}`
    : 'Ticket de Venta';

  return (
    <Document title={`${tipoLabel} ${comprobante.numero_afip ?? comprobante.numero_venta}`}>
      <Page size="A4" style={styles.page}>

        {/* HEADER */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.empresaNombre}>{empresaData?.nombre ?? 'KAIROX Gestión'}</Text>
            <Text style={styles.empresaDatos}>
              {'CUIT: ' + (empresaData?.afip_cuit ?? '—') + '\n'}
              {'Condición IVA: ' + (empresaData?.condicion_iva ?? '—') + '\n'}
              {empresaData?.direccion ?? ''}
            </Text>
          </View>
          {comprobante.tipo_comprobante_afip ? (
            <View style={styles.tipoBadge}>
              <Text style={styles.tipoLetra}>{comprobante.tipo_comprobante_afip}</Text>
            </View>
          ) : null}
        </View>

        {/* DATOS DEL COMPROBANTE */}
        <View style={styles.comprobanteBox}>
          <View style={styles.comprobanteRow}>
            <View>
              <Text style={styles.label}>Comprobante</Text>
              <Text style={styles.value}>
                {comprobante.numero_afip ?? ('Nro. ' + comprobante.numero_venta)}
              </Text>
            </View>
            <View>
              <Text style={styles.label}>Fecha</Text>
              <Text style={styles.value}>{formatFecha(comprobante.fecha)}</Text>
            </View>
            <View>
              <Text style={styles.label}>Forma de pago</Text>
              <Text style={styles.value}>{comprobante.forma_pago ?? '—'}</Text>
            </View>
            <View>
              <Text style={styles.label}>Moneda</Text>
              <Text style={styles.value}>{comprobante.moneda ?? 'ARS'}</Text>
            </View>
          </View>
        </View>

        {/* CLIENTE */}
        <View style={styles.clienteBox}>
          <Text style={styles.label}>Receptor</Text>
          <Text style={[styles.value, { fontSize: 10, marginTop: 2 }]}>
            {comprobante.cliente_nombre ?? 'Consumidor Final'}
          </Text>
        </View>

        {/* TABLA ITEMS */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, { flex: 4 }]}>Descripción</Text>
            <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' }]}>Cant.</Text>
            <Text style={[styles.tableHeaderText, { flex: 2, textAlign: 'right' }]}>P. Unit.</Text>
            <Text style={[styles.tableHeaderText, { flex: 2, textAlign: 'right' }]}>Subtotal</Text>
          </View>
          {(items ?? []).map((item, i) => (
            <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
              <Text style={{ flex: 4, fontSize: 9 }}>{item.producto_nombre}</Text>
              <Text style={{ flex: 1, textAlign: 'right', fontSize: 9 }}>{item.cantidad}</Text>
              <Text style={{ flex: 2, textAlign: 'right', fontSize: 9 }}>
                {'$ ' + formatARS(item.precio_unitario)}
              </Text>
              <Text style={{ flex: 2, textAlign: 'right', fontSize: 9 }}>
                {'$ ' + formatARS(item.subtotal)}
              </Text>
            </View>
          ))}
        </View>

        {/* TOTALES */}
        <View style={styles.totalesBox}>
          {(pagos ?? []).map((pago, i) => (
            <View key={i} style={styles.totalRow}>
              <Text style={{ fontSize: 8, color: '#64748b' }}>{pago.metodo}</Text>
              <Text style={{ fontSize: 9 }}>{'$ ' + formatARS(pago.monto)}</Text>
            </View>
          ))}
          <View style={styles.totalFinal}>
            <Text style={styles.totalFinalText}>TOTAL</Text>
            <Text style={styles.totalFinalText}>{'$ ' + formatARS(comprobante.total)}</Text>
          </View>
        </View>

        {/* CAE + QR — solo si tiene CAE emitido */}
        {comprobante.cae_estado === 'emitido' && comprobante.cae ? (
          <View style={styles.caeSection}>
            <View style={styles.caeBox}>
              <Text style={styles.caeLabel}>Código de Autorización Electrónico (CAE)</Text>
              <Text style={styles.caeValue}>{comprobante.cae}</Text>
              {comprobante.cae_vencimiento ? (
                <Text style={styles.caeFecha}>
                  {'Vto. CAE: ' + formatFecha(comprobante.cae_vencimiento)}
                </Text>
              ) : null}
              <Text style={[styles.caeFecha, { marginTop: 8 }]}>
                Comprobante emitido según RG AFIP 4291/2018
              </Text>
            </View>
            {qrDataUrl ? (
              <Image src={qrDataUrl} style={styles.qrImage} />
            ) : null}
          </View>
        ) : null}

        {/* PIE */}
        <Text style={styles.footer}>
          {'Generado por KAIROX Gestión · ' + formatFecha(new Date().toISOString())}
        </Text>

      </Page>
    </Document>
  );
}
