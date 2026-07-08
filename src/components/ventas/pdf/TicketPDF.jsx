import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    padding: '20 30',
    backgroundColor: '#FFFFFF',
    color: '#1a1a1a',
  },
  header: {
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottom: '0.5pt solid #e2e8f0',
  },
  logo: {
    width: 60,
    height: 40,
    objectFit: 'contain',
    marginBottom: 6,
  },
  empresaNombre: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#1e40af',
    textAlign: 'center',
    marginBottom: 2,
  },
  empresaSubtitle: {
    fontSize: 8,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 1.4,
  },
  ticketTitle: {
    textAlign: 'center',
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1,
    marginBottom: 2,
    marginTop: 8,
  },
  noValido: {
    textAlign: 'center',
    fontSize: 7.5,
    color: '#94a3b8',
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
    fontSize: 8.5,
  },
  infoLabel: { color: '#64748b', fontFamily: 'Helvetica-Bold' },
  infoValue: { color: '#1a1a1a' },
  separator: {
    borderBottom: '0.5pt dashed #cbd5e1',
    marginVertical: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    padding: '4 6',
    marginBottom: 2,
  },
  tableHeaderText: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  tableRow: {
    flexDirection: 'row',
    padding: '3 6',
    borderBottom: '0.5pt solid #f1f5f9',
  },
  totalesBox: {
    marginTop: 8,
    alignItems: 'flex-end',
  },
  pagoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 200,
    padding: '2 6',
    fontSize: 8,
  },
  totalFinal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 200,
    padding: '6 10',
    backgroundColor: '#1e40af',
    borderRadius: 4,
    marginTop: 4,
  },
  totalFinalText: {
    color: '#FFFFFF',
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
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
    paddingTop: 5,
  },
});

const fmt = (n) =>
  Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtFecha = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

export function TicketPDF({ comprobante, items, pagos, empresa }) {
  const tc = Number(comprobante.tipo_cambio_tasa) || 1;
  const esExtranjera = comprobante.moneda && comprobante.moneda !== 'ARS' && tc > 0;
  const simbolo = esExtranjera ? `${comprobante.moneda} ` : '$ ';
  const conv = esExtranjera ? (n) => Number(n) / tc : (n) => Number(n);

  return (
    <Document title={`Ticket ${comprobante.numero_venta}`}>
      <Page size="A4" style={styles.page}>

        {/* HEADER */}
        <View style={styles.header}>
          {empresa?.logo ? <Image src={empresa.logo} style={styles.logo} /> : null}
          <Text style={styles.empresaNombre}>{empresa?.nombre ?? 'Mi Empresa'}</Text>
          {empresa?.direccion ? (
            <Text style={styles.empresaSubtitle}>{empresa.direccion}</Text>
          ) : null}
          {empresa?.telefono ? (
            <Text style={styles.empresaSubtitle}>Tel: {empresa.telefono}</Text>
          ) : null}
        </View>

        {/* Título */}
        <Text style={styles.ticketTitle}>TICKET DE VENTA</Text>
        <Text style={styles.noValido}>Comprobante no válido como factura</Text>

        {/* Info del comprobante */}
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Nro:</Text>
          <Text style={styles.infoValue}>{comprobante.numero_venta}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Fecha:</Text>
          <Text style={styles.infoValue}>{fmtFecha(comprobante.fecha)}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Cliente:</Text>
          <Text style={styles.infoValue}>
            {comprobante.cliente_nombre ?? 'Consumidor Final'}
          </Text>
        </View>
        {comprobante.forma_pago ? (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Pago:</Text>
            <Text style={styles.infoValue}>{comprobante.forma_pago}</Text>
          </View>
        ) : null}

        <View style={styles.separator} />

        {/* Tabla de items */}
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, { flex: 4 }]}>Descripción</Text>
          <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' }]}>Cant</Text>
          <Text style={[styles.tableHeaderText, { flex: 2, textAlign: 'right' }]}>Precio</Text>
          <Text style={[styles.tableHeaderText, { flex: 2, textAlign: 'right' }]}>Subtotal</Text>
        </View>
        {(items ?? []).map((item, i) => (
          <View key={i} style={[styles.tableRow, i % 2 === 1 ? { backgroundColor: '#f8fafc' } : {}]}>
            <Text style={{ flex: 4, fontSize: 8.5 }}>{item.producto_nombre}</Text>
            <Text style={{ flex: 1, textAlign: 'right', fontSize: 8.5 }}>{item.cantidad}</Text>
            <Text style={{ flex: 2, textAlign: 'right', fontSize: 8.5 }}>
              {simbolo}{fmt(conv(item.precio_unitario))}
            </Text>
            <Text style={{ flex: 2, textAlign: 'right', fontSize: 8.5 }}>
              {simbolo}{fmt(conv(item.subtotal))}
            </Text>
          </View>
        ))}

        {/* Totales */}
        <View style={styles.totalesBox}>
          {(pagos ?? []).map((p, i) => (
            <View key={i} style={styles.pagoRow}>
              <Text style={{ color: '#64748b' }}>{p.metodo}</Text>
              <Text>{simbolo}{fmt(conv(p.monto))}</Text>
            </View>
          ))}
          {esExtranjera ? (
            <>
              <View style={styles.pagoRow}>
                <Text style={{ color: '#64748b' }}>Tipo de cambio</Text>
                <Text>1 {comprobante.moneda} = $ {fmt(tc)}</Text>
              </View>
              <View style={styles.pagoRow}>
                <Text style={{ color: '#64748b' }}>Equivale a</Text>
                <Text>$ {fmt(comprobante.total)} ARS</Text>
              </View>
            </>
          ) : null}
          <View style={styles.totalFinal}>
            <Text style={styles.totalFinalText}>TOTAL</Text>
            <Text style={styles.totalFinalText}>
              {simbolo}{fmt(conv(comprobante.total))}
            </Text>
          </View>
        </View>

        {/* Pie */}
        <Text style={styles.footer}>
          {empresa?.pie_documento ? empresa.pie_documento + '\n' : ''}Gracias por su compra · {empresa?.nombre ?? ''} · Generado por KAIROX Gestión
        </Text>

      </Page>
    </Document>
  );
}
