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
  headerLeft: {
    flex: 1,
  },
  logo: {
    width: 60,
    height: 35,
    objectFit: 'contain',
    marginBottom: 5,
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
    width: 200,
    marginBottom: 2,
  },
  ivaSection: {
    width: 200,
    borderTop: '0.5pt solid #e2e8f0',
    marginTop: 4,
    paddingTop: 4,
    marginBottom: 4,
  },
  totalFinal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 200,
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
  caeErrorSection: {
    marginTop: 16,
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 12,
    paddingRight: 12,
    borderTop: '1pt solid #fca5a5',
    backgroundColor: '#fef2f2',
    borderRadius: 4,
  },
  caeErrorLabel: {
    fontSize: 8,
    color: '#dc2626',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 3,
  },
  caeErrorText: {
    fontSize: 8,
    color: '#b91c1c',
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
  const day   = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year  = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

export function FacturaPDF({ comprobante, items, pagos, empresa, qrDataUrl }) {
  const tipoLabel = comprobante.tipo_comprobante_afip
    ? `Factura ${comprobante.tipo_comprobante_afip}`
    : 'Comprobante';

  const totalNum = Number(comprobante.total) || 0;
  const neto = comprobante.neto_gravado != null
    ? Number(comprobante.neto_gravado)
    : totalNum / 1.21;
  const iva = comprobante.iva_discriminado != null
    ? Number(comprobante.iva_discriminado)
    : totalNum - neto;

  const tc = Number(comprobante.tipo_cambio_tasa) || 1;
  const esExtranjera = comprobante.moneda && comprobante.moneda !== 'ARS' && tc > 0;
  const monedaDisp = esExtranjera ? comprobante.moneda : 'ARS';
  const simbolo = esExtranjera ? `${comprobante.moneda} ` : '$ ';
  const conv = esExtranjera ? (n) => Number(n) / tc : (n) => Number(n);

  return (
    <Document title={`${tipoLabel} ${comprobante.numero_afip ?? comprobante.numero_venta}`}>
      <Page size="A4" style={styles.page}>

        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {empresa?.logo ? (
              <Image src={empresa.logo} style={styles.logo} />
            ) : null}
            <Text style={styles.empresaNombre}>{empresa?.nombre ?? 'Mi Empresa'}</Text>
            <Text style={styles.empresaDatos}>
              {'CUIT: ' + (empresa?.cuit ?? empresa?.afip_cuit ?? '—') + '\n'}
              {'Condición IVA: ' + (empresa?.condicion_iva ?? '—') + '\n'}
              {empresa?.direccion ?? ''}
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

        {/* RECEPTOR */}
        <View style={styles.clienteBox}>
          <Text style={styles.label}>Receptor</Text>
          <Text style={[styles.value, { fontSize: 10, marginTop: 2 }]}>
            {comprobante.cliente_nombre ?? 'Consumidor Final'}
          </Text>
          {comprobante.cliente_cuit ? (
            <Text style={[styles.empresaDatos, { marginTop: 2 }]}>
              CUIT: {comprobante.cliente_cuit}
            </Text>
          ) : null}
          {comprobante.cliente_condicion_iva ? (
            <Text style={styles.empresaDatos}>
              Cond. IVA: {comprobante.cliente_condicion_iva}
            </Text>
          ) : null}
        </View>

        {/* TABLA ITEMS */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, { flex: 4 }]}>Descripción</Text>
            <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' }]}>Cant.</Text>
            <Text style={[styles.tableHeaderText, { flex: 2, textAlign: 'right' }]}>
              {`P. Unit. (${monedaDisp})`}
            </Text>
            <Text style={[styles.tableHeaderText, { flex: 2, textAlign: 'right' }]}>
              {`Subtotal (${monedaDisp})`}
            </Text>
          </View>
          {(items ?? []).map((item, i) => (
            <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
              <Text style={{ flex: 4, fontSize: 9 }}>{item.producto_nombre}</Text>
              <Text style={{ flex: 1, textAlign: 'right', fontSize: 9 }}>{item.cantidad}</Text>
              <Text style={{ flex: 2, textAlign: 'right', fontSize: 9 }}>
                {simbolo}{formatARS(conv(item.precio_unitario))}
              </Text>
              <Text style={{ flex: 2, textAlign: 'right', fontSize: 9 }}>
                {simbolo}{formatARS(conv(item.subtotal))}
              </Text>
            </View>
          ))}
        </View>

        {/* TOTALES con IVA discriminado */}
        <View style={styles.totalesBox}>
          {(pagos ?? []).map((pago, i) => (
            <View key={i} style={styles.totalRow}>
              <Text style={{ fontSize: 8, color: '#64748b' }}>{pago.metodo}</Text>
              <Text style={{ fontSize: 9 }}>{simbolo}{formatARS(conv(pago.monto))}</Text>
            </View>
          ))}
          <View style={styles.ivaSection}>
            <View style={styles.totalRow}>
              <Text style={{ fontSize: 8, color: '#64748b' }}>Subtotal (neto gravado)</Text>
              <Text style={{ fontSize: 9 }}>{simbolo}{formatARS(conv(neto))}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={{ fontSize: 8, color: '#64748b' }}>IVA (21%)</Text>
              <Text style={{ fontSize: 9 }}>{simbolo}{formatARS(conv(iva))}</Text>
            </View>
          </View>
          <View style={styles.totalFinal}>
            <Text style={styles.totalFinalText}>TOTAL</Text>
            <Text style={styles.totalFinalText}>
              {simbolo}{formatARS(conv(comprobante.total))}
            </Text>
          </View>
          {esExtranjera ? (
            <>
              <View style={[styles.totalRow, { marginTop: 4 }]}>
                <Text style={{ fontSize: 8, color: '#64748b' }}>Tipo de cambio</Text>
                <Text style={{ fontSize: 9 }}>
                  {'1 ' + comprobante.moneda + ' = $ ' + formatARS(tc)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={{ fontSize: 8, color: '#64748b' }}>Equivale a</Text>
                <Text style={{ fontSize: 9 }}>{'$ ' + formatARS(comprobante.total) + ' ARS'}</Text>
              </View>
            </>
          ) : null}
        </View>

        {/* CAE + QR */}
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
                Comprobante válido como factura · RG AFIP 4291/2018
              </Text>
            </View>
            {qrDataUrl ? (
              <Image src={qrDataUrl} style={styles.qrImage} />
            ) : null}
          </View>
        ) : (comprobante.cae_estado === 'error' || comprobante.cae_estado === 'error_definitivo') ? (
          <View style={styles.caeErrorSection}>
            <Text style={styles.caeErrorLabel}>DOCUMENTO SIN VALIDEZ FISCAL</Text>
            <Text style={styles.caeErrorText}>
              Este comprobante no tiene CAE emitido por AFIP/ARCA y no es válido como factura electrónica.
              {comprobante.cae_estado === 'error_definitivo'
                ? ' Los reintentos automáticos se agotaron — es necesaria intervención manual.'
                : ' La emisión del CAE está pendiente o falló — verificar en el sistema.'}
            </Text>
          </View>
        ) : null}

        {/* PIE */}
        <Text style={styles.footer}>
          {empresa?.pie_documento ? empresa.pie_documento + '\n' : ''}{'Generado por KAIROX Gestión · ' + formatFecha(new Date().toISOString())}
        </Text>

      </Page>
    </Document>
  );
}
