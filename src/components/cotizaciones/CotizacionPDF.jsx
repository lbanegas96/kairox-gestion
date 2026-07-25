import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

// ── Paleta (misma que FacturaPDF, para mantener consistencia visual) ────────
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

  // ── HEADER ─────────────────────────────────────────────────────────────
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

  // ── SECCIÓN RECEPTOR ───────────────────────────────────────────────────
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

  // ── TABLA ──────────────────────────────────────────────────────────────
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

  // ── TOTALES ────────────────────────────────────────────────────────────
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

  // ── AVISO / CONDICIONES ────────────────────────────────────────────────
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

  // ── PIE ────────────────────────────────────────────────────────────────
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

export function CotizacionPDF({ cotizacion, empresa }) {
  const items = cotizacion.cotizacion_items ?? [];
  const moneda = cotizacion.moneda ?? 'ARS';
  const esExtranjera = moneda !== 'ARS';
  const simbolo = esExtranjera ? `${moneda} ` : '$ ';

  // Los montos ya están guardados en la moneda de la cotización — sin conversión.
  const bruto = items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario), 0);
  const totalNum = Number(cotizacion.total) || 0;
  const descuento = Math.max(0, bruto - totalNum);

  const cliente = cotizacion.clientes ?? null;
  const clienteNombre = cotizacion.cliente_nombre ?? cliente?.nombre ?? 'Consumidor Final';

  return (
    <Document title={`Cotizacion ${cotizacion.numero}`}>
      <Page size="A4" style={styles.page}>

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {empresa?.logo ? <Image src={empresa.logo} style={styles.logo} /> : null}
            <Text style={styles.emisorNombre}>{empresa?.nombre ?? 'Mi Empresa'}</Text>
            {empresa?.cuit ? <Text style={styles.emisorDato}>CUIT: {empresa.cuit}</Text> : null}
            {empresa?.condicion_iva ? (
              <Text style={styles.emisorDato}>Cond. IVA: {empresa.condicion_iva}</Text>
            ) : null}
            {empresa?.direccion ? <Text style={styles.emisorDato}>{empresa.direccion}</Text> : null}
            {empresa?.telefono ? <Text style={styles.emisorDato}>Tel: {empresa.telefono}</Text> : null}
          </View>

          <View style={styles.headerRight}>
            <Text style={styles.compLabel}>Cotización / Presupuesto</Text>
            <Text style={styles.compValueLg}>{cotizacion.numero}</Text>

            <Text style={styles.compLabel}>Fecha</Text>
            <Text style={styles.compValue}>{formatFecha(cotizacion.fecha ?? cotizacion.created_at)}</Text>

            <Text style={styles.compLabel}>Válido hasta</Text>
            <Text style={styles.compValue}>
              {cotizacion.fecha_vencimiento ? formatFecha(cotizacion.fecha_vencimiento) : 'Sin vencimiento definido'}
            </Text>

            {cotizacion.condiciones_pago ? (
              <>
                <Text style={styles.compLabel}>Condiciones de pago</Text>
                <Text style={styles.compValue}>{cotizacion.condiciones_pago}</Text>
              </>
            ) : null}
          </View>
        </View>

        {/* ── RECEPTOR ───────────────────────────────────────────────── */}
        <View style={styles.sectionBox}>
          <Text style={styles.sectionTitle}>Presupuesto para</Text>
          <View style={styles.receptorRow}>
            <View style={styles.receptorCol}>
              <Text style={styles.receptorNombre}>{clienteNombre}</Text>
            </View>
            {cliente?.documento ? (
              <View style={[styles.receptorCol, { alignItems: 'flex-end' }]}>
                <Text style={styles.compLabel}>CUIT / DNI</Text>
                <Text style={styles.compValue}>{cliente.documento}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ── TABLA DE ITEMS ─────────────────────────────────────────── */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.thText, { flex: 5 }]}>Descripción</Text>
            <Text style={[styles.thText, { flex: 1, textAlign: 'right' }]}>Cant.</Text>
            <Text style={[styles.thText, { flex: 2, textAlign: 'right' }]}>
              {`P. Unit. (${moneda})`}
            </Text>
            <Text style={[styles.thText, { flex: 2, textAlign: 'right' }]}>
              {`Subtotal (${moneda})`}
            </Text>
          </View>
          {items.map((item, i) => (
            <View key={item.id ?? i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
              <Text style={[styles.tdText, { flex: 5 }]}>
                {item.descripcion}
                {item.unidad_medida ? ` (${item.unidad_medida})` : ''}
              </Text>
              <Text style={[styles.tdText, { flex: 1, textAlign: 'right' }]}>{item.cantidad}</Text>
              <Text style={[styles.tdText, { flex: 2, textAlign: 'right' }]}>
                {simbolo}{formatMonto(item.precio_unitario)}
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
            {descuento > 0.005 ? (
              <>
                <View style={styles.totalesRow}>
                  <Text style={styles.totalesLabel}>Subtotal</Text>
                  <Text style={styles.totalesVal}>{simbolo}{formatMonto(bruto)}</Text>
                </View>
                <View style={styles.totalesRow}>
                  <Text style={styles.totalesLabel}>Descuento</Text>
                  <Text style={styles.totalesVal}>-{simbolo}{formatMonto(descuento)}</Text>
                </View>
              </>
            ) : null}
            <View style={styles.totalFinalRow}>
              <Text style={styles.totalFinalText}>TOTAL</Text>
              <Text style={styles.totalFinalText}>{simbolo}{formatMonto(totalNum)}</Text>
            </View>
          </View>
        </View>

        {/* ── AVISO ──────────────────────────────────────────────────── */}
        <View style={styles.avisoBox}>
          <Text style={styles.avisoText}>
            Este documento es un presupuesto y no posee validez fiscal como factura.
            {cotizacion.fecha_vencimiento
              ? ` Precios válidos hasta el ${formatFecha(cotizacion.fecha_vencimiento)}.`
              : ''}
          </Text>
        </View>

        {cotizacion.notas ? (
          <View style={[styles.avisoBox, { marginTop: 6 }]}>
            <Text style={styles.avisoText}>{cotizacion.notas}</Text>
          </View>
        ) : null}

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
