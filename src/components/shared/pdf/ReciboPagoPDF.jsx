import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

// PDF real (react-pdf) del Comprobante de Pago/Cobro — reemplaza el flujo
// anterior de ReciboPago.jsx (HTML) + window.print(). Motivo (01/09,
// hallazgo Luciano con 2 PDF reales de "Microsoft Print to PDF"): el
// @page CSS del navegador (probado con size 210mm×210mm y luego con A4)
// nunca llegó a aplicarse contra un destino de impresión que es un
// PRINTER de Windows, no el "Guardar como PDF" nativo de Chrome — el
// MediaBox del PDF resultante seguía saliendo Carta/Letter (612×792pt)
// pase lo que pase en el CSS. La Factura nunca tuvo este problema porque
// no depende del diálogo de impresión: se genera como PDF real con
// @react-pdf/renderer (FacturaPDF.jsx, mismo patrón de colores/tamaños
// copiado acá) y se abre/descarga ya con su tamaño A4 fijo en el archivo,
// sin pasar por ningún driver de impresora.
const NAVY = '#0f172a';
const BLUE = '#1d4ed8';
const SLATE = '#475569';
const MUTED = '#64748b';
const BORDER = '#cbd5e1';
const BG_ROW = '#f8fafc';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 40,
    backgroundColor: '#ffffff',
    color: NAVY,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 14,
    borderBottom: `1.5pt solid ${NAVY}`,
    paddingBottom: 12,
  },
  headerLeft: {
    flex: 3,
    paddingRight: 12,
    borderRight: `1pt solid ${BORDER}`,
  },
  headerRight: {
    flex: 3,
    paddingLeft: 12,
  },
  logo: {
    width: 46,
    height: 24,
    objectFit: 'contain',
    marginBottom: 5,
  },
  emisorNombre: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    marginBottom: 3,
  },
  emisorDato: {
    fontSize: 8,
    color: SLATE,
    lineHeight: 1.5,
  },
  compLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.2,
    marginBottom: 1,
  },
  compValue: {
    fontSize: 9,
    color: NAVY,
    marginBottom: 6,
  },
  tituloComprobante: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
    marginBottom: 6,
  },
  sectionBox: {
    borderRadius: 3,
    border: `0.5pt solid ${BORDER}`,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  receptorNombre: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
  },
  montoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  montoDato: {
    fontSize: 9,
    color: NAVY,
    marginBottom: 2,
  },
  montoDatoLabel: {
    fontFamily: 'Helvetica-Bold',
  },
  montoLabel: {
    fontSize: 7,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    textAlign: 'right',
  },
  montoValor: {
    fontSize: 19,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
  },
  table: {
    marginBottom: 10,
    border: `0.5pt solid ${BORDER}`,
    borderRadius: 3,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: NAVY,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  thText: {
    color: '#ffffff',
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottom: `0.5pt solid ${BORDER}`,
  },
  tableRowAlt: {
    backgroundColor: BG_ROW,
  },
  tdText: {
    fontSize: 8.5,
    color: NAVY,
  },
  saldosWrap: {
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  saldosBox: {
    width: 180,
  },
  saldoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  saldoLabel: {
    fontSize: 8.5,
    color: SLATE,
  },
  saldoValor: {
    fontSize: 8.5,
    color: SLATE,
  },
  saldoFinalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 4,
    borderTop: `1pt solid ${NAVY}`,
  },
  saldoFinalLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
  },
  saldoFinalValor: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
  },
  firmaWrap: {
    flexDirection: 'row',
    marginTop: 40,
  },
  firmaCol: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 20,
  },
  firmaImg: {
    height: 40,
    objectFit: 'contain',
    marginBottom: 6,
  },
  firmaLinea: {
    width: '100%',
    borderTop: `0.75pt solid ${NAVY}`,
    paddingTop: 3,
  },
  firmaLabel: {
    fontSize: 7.5,
    color: MUTED,
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 28,
    right: 28,
    borderTop: `0.5pt solid ${BORDER}`,
    paddingTop: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 6.5,
    color: MUTED,
  },
});

const formatARS = (n) =>
  Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatFechaHora = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const fecha = d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const hora = d.toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  return `${fecha} ${hora}`;
};

export function ReciboPagoPDF({ recibo }) {
  const {
    tipo,
    movimientoId,
    fecha,
    contraparteNombre,
    monto,
    metodo,
    referenciaPago,
    nota,
    imputaciones = [],
    saldoAnteriorTotal,
    saldoNuevoTotal,
    empresa = {},
  } = recibo;

  const esCobro = tipo === 'cobro';
  const numeroInterno = movimientoId ? movimientoId.slice(0, 8).toUpperCase() : '—';
  const cuit = empresa.afip_cuit || empresa.cuit;

  return (
    <Document title={`${esCobro ? 'Recibo de Cobro' : 'Comprobante de Pago'} ${numeroInterno}`}>
      <Page size="A4" style={styles.page}>

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {empresa.logo ? <Image src={empresa.logo} style={styles.logo} /> : null}
            <Text style={styles.emisorNombre}>{empresa.nombre ?? 'Mi Empresa'}</Text>
            {cuit ? <Text style={styles.emisorDato}>CUIT: {cuit}</Text> : null}
            {empresa.condicion_iva ? <Text style={styles.emisorDato}>Cond. IVA: {empresa.condicion_iva}</Text> : null}
            {empresa.direccion ? <Text style={styles.emisorDato}>{empresa.direccion}</Text> : null}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.compLabel}>Comprobante</Text>
            <Text style={styles.tituloComprobante}>
              {esCobro ? 'Recibo de Cobro' : 'Comprobante de Pago'}
            </Text>
            <Text style={styles.compLabel}>N° interno</Text>
            <Text style={styles.compValue}>{numeroInterno}</Text>
            <Text style={styles.compLabel}>Fecha</Text>
            <Text style={styles.compValue}>{formatFechaHora(fecha)}</Text>
          </View>
        </View>

        {/* ── RECIBIDO DE / PAGADO A ─────────────────────────────────── */}
        <View style={styles.sectionBox}>
          <Text style={styles.sectionTitle}>{esCobro ? 'Recibido de' : 'Pagado a'}</Text>
          <Text style={styles.receptorNombre}>{contraparteNombre}</Text>
        </View>

        {/* ── MEDIO DE PAGO + MONTO ─────────────────────────────────── */}
        <View style={styles.montoRow}>
          <View>
            <Text style={styles.montoDato}>
              <Text style={styles.montoDatoLabel}>Medio de pago: </Text>{metodo || 'Efectivo'}
            </Text>
            {referenciaPago ? (
              <Text style={styles.montoDato}>
                <Text style={styles.montoDatoLabel}>Referencia: </Text>{referenciaPago}
              </Text>
            ) : null}
            {nota ? (
              <Text style={styles.montoDato}>
                <Text style={styles.montoDatoLabel}>Nota: </Text>{nota}
              </Text>
            ) : null}
          </View>
          <View>
            <Text style={styles.montoLabel}>{esCobro ? 'Monto cobrado' : 'Monto pagado'}</Text>
            <Text style={styles.montoValor}>${formatARS(monto)}</Text>
          </View>
        </View>

        {/* ── COMPROBANTES IMPUTADOS ────────────────────────────────── */}
        {imputaciones.length > 0 ? (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.thText, { flex: 6 }]}>Comprobante</Text>
              <Text style={[styles.thText, { flex: 2, textAlign: 'right' }]}>Aplicado</Text>
            </View>
            {imputaciones.map((imp, i) => (
              <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
                <Text style={[styles.tdText, { flex: 6 }]}>{imp.numero}</Text>
                <Text style={[styles.tdText, { flex: 2, textAlign: 'right' }]}>${formatARS(imp.monto)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── SALDOS ─────────────────────────────────────────────────── */}
        {(saldoAnteriorTotal != null || saldoNuevoTotal != null) ? (
          <View style={styles.saldosWrap}>
            <View style={styles.saldosBox}>
              {saldoAnteriorTotal != null ? (
                <View style={styles.saldoRow}>
                  <Text style={styles.saldoLabel}>Saldo anterior:</Text>
                  <Text style={styles.saldoValor}>${formatARS(saldoAnteriorTotal)}</Text>
                </View>
              ) : null}
              {saldoNuevoTotal != null ? (
                <View style={styles.saldoFinalRow}>
                  <Text style={styles.saldoFinalLabel}>Saldo actual:</Text>
                  <Text style={styles.saldoFinalValor}>${formatARS(saldoNuevoTotal)}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* ── FIRMA ──────────────────────────────────────────────────── */}
        <View style={styles.firmaWrap}>
          <View style={styles.firmaCol}>
            {empresa.firma ? <Image src={empresa.firma} style={styles.firmaImg} /> : <View style={{ height: 40, marginBottom: 6 }} />}
            <View style={styles.firmaLinea}>
              <Text style={styles.firmaLabel}>Firma</Text>
            </View>
          </View>
          <View style={styles.firmaCol}>
            <View style={{ height: 40, marginBottom: 6 }} />
            <View style={styles.firmaLinea}>
              <Text style={styles.firmaLabel}>Aclaración</Text>
            </View>
          </View>
        </View>

        {/* ── PIE ────────────────────────────────────────────────────── */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Comprobante interno — no reemplaza a la factura ni a un recibo fiscal.
          </Text>
          <Text style={styles.footerText}>
            Generado por KAIROX Gestión · {formatFechaHora(new Date().toISOString())}
          </Text>
        </View>

      </Page>
    </Document>
  );
}
