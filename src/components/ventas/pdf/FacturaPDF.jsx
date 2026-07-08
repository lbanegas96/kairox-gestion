import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

// ── Paleta ──────────────────────────────────────────────────────────────────
const C = {
  navy:    '#0f172a',
  blue:    '#1d4ed8',
  blueLt:  '#dbeafe',
  slate:   '#475569',
  muted:   '#64748b',
  border:  '#cbd5e1',
  bgRow:   '#f8fafc',
  white:   '#ffffff',
  red:     '#dc2626',
  redBg:   '#fef2f2',
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

  // ── HEADER ─────────────────────────────────────────────────────────────────
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
  headerCenter: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
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
  tipoBox: {
    width: 54,
    height: 54,
    border: `2pt solid ${C.navy}`,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  tipoLetra: {
    fontSize: 30,
    fontFamily: 'Helvetica-Bold',
    color: C.navy,
    lineHeight: 1,
  },
  tipoLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  tipoOriginal: {
    fontSize: 6,
    color: C.muted,
    textAlign: 'center',
    marginTop: 2,
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
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: C.navy,
    marginBottom: 6,
  },

  // ── SECCIÓN RECEPTOR ───────────────────────────────────────────────────────
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

  // ── TABLA ──────────────────────────────────────────────────────────────────
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

  // ── TOTALES ────────────────────────────────────────────────────────────────
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

  // ── CAE ────────────────────────────────────────────────────────────────────
  caeSeparator: {
    borderTop: `1pt solid ${C.border}`,
    marginTop: 8,
    paddingTop: 10,
  },
  caeWrap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  caeLeft: {
    flex: 1,
  },
  caeTitleBar: {
    backgroundColor: C.navy,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  caeTitleText: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  caeNumero: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: C.navy,
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  caeVto: {
    fontSize: 8,
    color: C.slate,
    marginBottom: 2,
  },
  caeLegal: {
    fontSize: 7,
    color: C.muted,
    marginTop: 6,
  },
  qrImage: {
    width: 78,
    height: 78,
  },
  caeErrorBox: {
    marginTop: 10,
    padding: 10,
    backgroundColor: C.redBg,
    border: `0.5pt solid #fca5a5`,
    borderRadius: 3,
  },
  caeErrorTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: C.red,
    marginBottom: 3,
  },
  caeErrorText: {
    fontSize: 7.5,
    color: '#b91c1c',
  },

  // ── PIE ────────────────────────────────────────────────────────────────────
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

const formatARS = (num) =>
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

const tipoNombre = (letra) => {
  if (!letra) return 'COMPROBANTE';
  if (letra === 'A') return 'FACTURA A';
  if (letra === 'B') return 'FACTURA B';
  if (letra === 'C') return 'FACTURA C';
  return `FACTURA ${letra}`;
};

export function FacturaPDF({ comprobante, items, pagos, empresa, qrDataUrl }) {
  const letra = comprobante.tipo_comprobante_afip ?? null;

  const totalNum = Number(comprobante.total) || 0;
  const neto = comprobante.neto_gravado != null
    ? Number(comprobante.neto_gravado)
    : totalNum / 1.21;
  const iva = comprobante.iva_discriminado != null
    ? Number(comprobante.iva_discriminado)
    : totalNum - neto;

  const tc          = Number(comprobante.tipo_cambio_tasa) || 1;
  const esExtranjera = comprobante.moneda && comprobante.moneda !== 'ARS' && tc > 0;
  const monedaDisp  = esExtranjera ? comprobante.moneda : 'ARS';
  const simbolo     = esExtranjera ? `${comprobante.moneda} ` : '$ ';
  const conv        = esExtranjera ? (n) => Number(n) / tc : (n) => Number(n);

  const nroComprobante = comprobante.numero_afip ?? comprobante.numero_venta ?? '—';
  const cuitEmisor     = empresa?.afip_cuit ?? empresa?.cuit ?? '—';

  return (
    <Document title={`${tipoNombre(letra)} ${nroComprobante}`}>
      <Page size="A4" style={styles.page}>

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <View style={styles.header}>
          {/* Columna izquierda: Emisor */}
          <View style={styles.headerLeft}>
            {empresa?.logo ? (
              <Image src={empresa.logo} style={styles.logo} />
            ) : null}
            <Text style={styles.emisorNombre}>{empresa?.nombre ?? 'Mi Empresa'}</Text>
            <Text style={styles.emisorDato}>CUIT: {cuitEmisor}</Text>
            <Text style={styles.emisorDato}>
              Cond. IVA: {empresa?.condicion_iva ?? '—'}
            </Text>
            {empresa?.direccion ? (
              <Text style={styles.emisorDato}>{empresa.direccion}</Text>
            ) : null}
          </View>

          {/* Columna central: Tipo (A/B/C) */}
          <View style={styles.headerCenter}>
            {letra ? (
              <>
                <View style={styles.tipoBox}>
                  <Text style={styles.tipoLetra}>{letra}</Text>
                </View>
                <Text style={styles.tipoLabel}>
                  {letra === 'A' ? 'Factura' : letra === 'B' ? 'Factura' : 'Factura'}
                </Text>
                <Text style={styles.tipoOriginal}>ORIGINAL</Text>
              </>
            ) : (
              <Text style={styles.tipoLabel}>COMPROBANTE</Text>
            )}
          </View>

          {/* Columna derecha: Datos del comprobante */}
          <View style={styles.headerRight}>
            <Text style={styles.compLabel}>
              {tipoNombre(letra)}
            </Text>
            <Text style={styles.compValueLg}>{nroComprobante}</Text>

            <Text style={styles.compLabel}>Fecha de emisión</Text>
            <Text style={styles.compValue}>{formatFecha(comprobante.fecha)}</Text>

            {comprobante.forma_pago ? (
              <>
                <Text style={styles.compLabel}>Forma de pago</Text>
                <Text style={styles.compValue}>{comprobante.forma_pago}</Text>
              </>
            ) : null}

            {esExtranjera ? (
              <>
                <Text style={styles.compLabel}>Moneda / TC</Text>
                <Text style={styles.compValue}>
                  {comprobante.moneda} · TC {formatARS(tc)}
                </Text>
              </>
            ) : null}
          </View>
        </View>

        {/* ── RECEPTOR ───────────────────────────────────────────────── */}
        <View style={styles.sectionBox}>
          <Text style={styles.sectionTitle}>Receptor</Text>
          <View style={styles.receptorRow}>
            <View style={styles.receptorCol}>
              <Text style={styles.receptorNombre}>
                {comprobante.cliente_nombre ?? 'Consumidor Final'}
              </Text>
              {comprobante.cliente_condicion_iva ? (
                <Text style={styles.emisorDato}>
                  Cond. IVA: {comprobante.cliente_condicion_iva}
                </Text>
              ) : null}
            </View>
            {comprobante.cliente_cuit ? (
              <View style={[styles.receptorCol, { alignItems: 'flex-end' }]}>
                <Text style={styles.compLabel}>CUIT</Text>
                <Text style={styles.compValue}>{comprobante.cliente_cuit}</Text>
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
              {`P. Unit. (${monedaDisp})`}
            </Text>
            <Text style={[styles.thText, { flex: 2, textAlign: 'right' }]}>
              {`Subtotal (${monedaDisp})`}
            </Text>
          </View>
          {(items ?? []).map((item, i) => (
            <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
              <Text style={[styles.tdText, { flex: 5 }]}>{item.producto_nombre}</Text>
              <Text style={[styles.tdText, { flex: 1, textAlign: 'right' }]}>{item.cantidad}</Text>
              <Text style={[styles.tdText, { flex: 2, textAlign: 'right' }]}>
                {simbolo}{formatARS(conv(item.precio_unitario))}
              </Text>
              <Text style={[styles.tdText, { flex: 2, textAlign: 'right' }]}>
                {simbolo}{formatARS(conv(item.subtotal))}
              </Text>
            </View>
          ))}
        </View>

        {/* ── TOTALES ────────────────────────────────────────────────── */}
        <View style={styles.totalesWrap}>
          <View style={styles.totalesBox}>
            {/* Subtotales por método de pago (si hay varios) */}
            {(pagos ?? []).length > 1 ? (pagos ?? []).map((pago, i) => (
              <View key={i} style={styles.totalesRow}>
                <Text style={styles.totalesLabel}>{pago.metodo}</Text>
                <Text style={styles.totalesVal}>{simbolo}{formatARS(conv(pago.monto))}</Text>
              </View>
            )) : null}

            {/* IVA discriminado (solo Factura A) */}
            {letra === 'A' ? (
              <>
                <View style={styles.totalesRow}>
                  <Text style={styles.totalesLabel}>Subtotal neto gravado</Text>
                  <Text style={styles.totalesVal}>{simbolo}{formatARS(conv(neto))}</Text>
                </View>
                <View style={styles.totalesRow}>
                  <Text style={styles.totalesLabel}>IVA 21%</Text>
                  <Text style={styles.totalesVal}>{simbolo}{formatARS(conv(iva))}</Text>
                </View>
              </>
            ) : null}

            {/* TC si es moneda extranjera */}
            {esExtranjera ? (
              <>
                <View style={styles.totalesRow}>
                  <Text style={styles.totalesLabel}>
                    Total {comprobante.moneda}
                  </Text>
                  <Text style={styles.totalesVal}>
                    {simbolo}{formatARS(conv(totalNum))}
                  </Text>
                </View>
                <View style={styles.totalesRow}>
                  <Text style={styles.totalesLabel}>Equivale (ARS)</Text>
                  <Text style={styles.totalesVal}>
                    {'$ '}{formatARS(totalNum)}
                  </Text>
                </View>
              </>
            ) : null}

            {/* TOTAL FINAL */}
            <View style={styles.totalFinalRow}>
              <Text style={styles.totalFinalText}>TOTAL</Text>
              <Text style={styles.totalFinalText}>
                {simbolo}{formatARS(conv(totalNum))}
              </Text>
            </View>
          </View>
        </View>

        {/* ── CAE / QR ───────────────────────────────────────────────── */}
        {comprobante.cae_estado === 'emitido' && comprobante.cae ? (
          <View style={styles.caeSeparator}>
            <View style={styles.caeWrap}>
              <View style={styles.caeLeft}>
                <View style={styles.caeTitleBar}>
                  <Text style={styles.caeTitleText}>
                    Código de Autorización Electrónico (CAE)
                  </Text>
                </View>
                <Text style={styles.caeNumero}>{comprobante.cae}</Text>
                {comprobante.cae_vencimiento ? (
                  <Text style={styles.caeVto}>
                    Vto. CAE: {formatFecha(comprobante.cae_vencimiento)}
                  </Text>
                ) : null}
                <Text style={styles.caeLegal}>
                  Comprobante fiscal válido · ARCA · RG 1415/2003
                </Text>
              </View>
              {qrDataUrl ? (
                <Image src={qrDataUrl} style={styles.qrImage} />
              ) : null}
            </View>
          </View>
        ) : (comprobante.cae_estado === 'error' || comprobante.cae_estado === 'error_definitivo') ? (
          <View style={styles.caeErrorBox}>
            <Text style={styles.caeErrorTitle}>DOCUMENTO SIN VALIDEZ FISCAL</Text>
            <Text style={styles.caeErrorText}>
              Este comprobante no posee CAE emitido por ARCA/AFIP y no es válido como factura electrónica.
              {comprobante.cae_estado === 'error_definitivo'
                ? ' Los reintentos automáticos se agotaron — requiere intervención manual.'
                : ' La emisión del CAE está pendiente de procesamiento.'}
            </Text>
          </View>
        ) : null}

        {/* ── PIE ────────────────────────────────────────────────────── */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {empresa?.pie_documento ?? ''}
          </Text>
          <Text style={styles.footerText}>
            Generado por KAIROX Gestión · {formatFecha(new Date().toISOString())}
          </Text>
        </View>

      </Page>
    </Document>
  );
}
