import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

// ── Paleta y estilos — mismo patrón que CotizacionPDF/FacturaPDF/OrdenCompraPDF,
// para que todos los documentos impresos de KAIROX se vean parte de un mismo
// sistema. Reemplaza el window.print() crudo que tenía Compra Rápida (hallazgo
// 09/09: "el PDF de Compra Rápida lo veo muy pelado").
const C = {
  navy:    '#0f172a',
  blue:    '#1d4ed8',
  slate:   '#475569',
  muted:   '#64748b',
  border:  '#cbd5e1',
  bgRow:   '#f8fafc',
  white:   '#ffffff',
};

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 40,
    backgroundColor: C.white,
    color: C.navy,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 14,
    borderBottom: `1.5pt solid ${C.navy}`,
    paddingBottom: 12,
  },
  headerLeft: {
    flex: 3,
    paddingRight: 12,
    borderRight: `1pt solid ${C.border}`,
  },
  headerRight: {
    flex: 3,
    paddingLeft: 12,
  },
  logo: {
    width: 55,
    height: 28,
    objectFit: 'contain',
    marginBottom: 5,
  },
  emisorNombre: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: C.navy,
    marginBottom: 3,
  },
  emisorDato: {
    fontSize: 8,
    color: C.slate,
    lineHeight: 1.5,
  },
  compLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.2,
    marginBottom: 1,
  },
  compValue: {
    fontSize: 9,
    color: C.navy,
    marginBottom: 6,
  },
  compValueLg: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: C.blue,
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  sectionBox: {
    borderRadius: 3,
    border: `0.5pt solid ${C.border}`,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  receptorRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  receptorCol: {
    flex: 1,
  },
  receptorNombre: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.navy,
    marginBottom: 2,
  },
  table: {
    marginBottom: 10,
    border: `0.5pt solid ${C.border}`,
    borderRadius: 3,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: C.navy,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  thText: {
    color: C.white,
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottom: `0.5pt solid ${C.border}`,
  },
  tableRowAlt: {
    backgroundColor: C.bgRow,
  },
  tdText: {
    fontSize: 8.5,
    color: C.navy,
  },
  totalesWrap: {
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  totalesBox: {
    width: 220,
    border: `0.5pt solid ${C.border}`,
    borderRadius: 3,
    overflow: 'hidden',
  },
  totalesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderBottom: `0.5pt solid ${C.border}`,
  },
  totalesLabel: {
    fontSize: 8,
    color: C.muted,
  },
  totalesVal: {
    fontSize: 8,
    color: C.navy,
  },
  totalFinalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: C.navy,
  },
  totalFinalText: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
  },
  avisoBox: {
    marginTop: 4,
    padding: 8,
    backgroundColor: C.bgRow,
    border: `0.5pt solid ${C.border}`,
    borderRadius: 3,
  },
  avisoText: {
    fontSize: 7.5,
    color: C.muted,
    lineHeight: 1.5,
  },
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 28,
    right: 28,
    borderTop: `0.5pt solid ${C.border}`,
    paddingTop: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 6.5,
    color: C.muted,
  },
});

const formatMonto = (num) =>
  Number(num).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatFecha = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return [
    String(d.getUTCDate()).padStart(2, '0'),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    d.getUTCFullYear(),
  ].join('/');
};

const ALICUOTA_LABEL = { '21': '21%', '10.5': '10.5%', '0': '0%', '27': '27%' };

const ESTADO_LABEL = { pagada: 'Pagada', pendiente: 'Pendiente', parcial: 'Parcial', anulada: 'Anulada' };

export function CompraPDF({ compra, items, empresa }) {
  const moneda = compra.moneda ?? 'ARS';
  const esExtranjera = moneda !== 'ARS';
  const simbolo = esExtranjera ? `${moneda} ` : '$ ';
  const proveedorNombre = compra.proveedores?.nombre ?? compra.proveedor_nombre ?? 'Proveedor sin especificar';
  const totalNum = Number(compra.total) || 0;
  // neto_gravado/iva_discriminado ya vienen calculados por ítem al crear la
  // compra (ver CompraRapidaSection.jsx) — se usan directo, sin recalcular.
  const neto = Number(compra.neto_gravado) || 0;
  const iva = Number(compra.iva_discriminado) || 0;

  return (
    <Document title={`Compra ${compra.numero_factura || 'S-N'}`}>
      <Page size="A4" style={styles.page}>

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {empresa?.logo ? <Image src={empresa.logo} style={styles.logo} /> : null}
            <Text style={styles.emisorNombre}>{empresa?.nombre ?? 'Mi Empresa'}</Text>
            {empresa?.direccion ? <Text style={styles.emisorDato}>{empresa.direccion}</Text> : null}
            {empresa?.telefono ? <Text style={styles.emisorDato}>Tel: {empresa.telefono}</Text> : null}
          </View>

          <View style={styles.headerRight}>
            <Text style={styles.compLabel}>Compra</Text>
            <Text style={styles.compValueLg}>{compra.numero_factura || 'S/N'}</Text>

            <Text style={styles.compLabel}>Fecha</Text>
            <Text style={styles.compValue}>{formatFecha(compra.fecha)}</Text>

            <Text style={styles.compLabel}>Forma de pago</Text>
            <Text style={styles.compValue}>{compra.forma_pago ?? '—'}</Text>

            <Text style={styles.compLabel}>Estado</Text>
            <Text style={styles.compValue}>{ESTADO_LABEL[compra.estado_pago] ?? compra.estado_pago ?? '—'}</Text>
          </View>
        </View>

        {/* ── PROVEEDOR ──────────────────────────────────────────────── */}
        <View style={styles.sectionBox}>
          <Text style={styles.sectionTitle}>Compra a</Text>
          <View style={styles.receptorRow}>
            <View style={styles.receptorCol}>
              <Text style={styles.receptorNombre}>{proveedorNombre}</Text>
            </View>
          </View>
        </View>

        {/* ── TABLA DE ITEMS ─────────────────────────────────────────── */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.thText, { flex: 4 }]}>Producto</Text>
            <Text style={[styles.thText, { flex: 1, textAlign: 'right' }]}>Cant.</Text>
            <Text style={[styles.thText, { flex: 1, textAlign: 'right' }]}>IVA</Text>
            <Text style={[styles.thText, { flex: 2, textAlign: 'right' }]}>
              {`Costo unit. (${moneda})`}
            </Text>
            <Text style={[styles.thText, { flex: 2, textAlign: 'right' }]}>
              {`Subtotal (${moneda})`}
            </Text>
          </View>
          {items.map((item, i) => (
            <View key={item.id ?? i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
              <Text style={[styles.tdText, { flex: 4 }]}>
                {item.productos?.nombre ?? 'Producto eliminado'}
                {item.productos?.codigo_sku ? ` (${item.productos.codigo_sku})` : ''}
              </Text>
              <Text style={[styles.tdText, { flex: 1, textAlign: 'right' }]}>{item.cantidad}</Text>
              <Text style={[styles.tdText, { flex: 1, textAlign: 'right' }]}>
                {ALICUOTA_LABEL[String(item.alicuota_iva)] ?? '21%'}
              </Text>
              <Text style={[styles.tdText, { flex: 2, textAlign: 'right' }]}>
                {simbolo}{formatMonto(item.costo_unitario)}
              </Text>
              <Text style={[styles.tdText, { flex: 2, textAlign: 'right' }]}>
                {simbolo}{formatMonto(item.subtotal)}
              </Text>
            </View>
          ))}
        </View>

        {/* ── TOTALES ────────────────────────────────────────────────── */}
        <View style={styles.totalesWrap}>
          <View style={styles.totalesBox}>
            <View style={styles.totalesRow}>
              <Text style={styles.totalesLabel}>Neto gravado</Text>
              <Text style={styles.totalesVal}>{simbolo}{formatMonto(neto)}</Text>
            </View>
            <View style={styles.totalesRow}>
              <Text style={styles.totalesLabel}>IVA</Text>
              <Text style={styles.totalesVal}>{simbolo}{formatMonto(iva)}</Text>
            </View>
            <View style={styles.totalFinalRow}>
              <Text style={styles.totalFinalText}>TOTAL</Text>
              <Text style={styles.totalFinalText}>{simbolo}{formatMonto(totalNum)}</Text>
            </View>
          </View>
        </View>

        {/* ── AVISO ──────────────────────────────────────────────────── */}
        {esExtranjera && (
          <View style={styles.avisoBox}>
            <Text style={styles.avisoText}>
              Tipo de cambio de referencia: 1 {moneda} = ${formatMonto(compra.tipo_cambio_tasa)} ARS.
            </Text>
          </View>
        )}

        {/* ── PIE ────────────────────────────────────────────────────── */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>{empresa?.pie_documento ?? ''}</Text>
          <Text style={styles.footerText}>
            Generado por KAIROX Gestión · {formatFecha(new Date().toISOString())}
          </Text>
        </View>

      </Page>
    </Document>
  );
}
