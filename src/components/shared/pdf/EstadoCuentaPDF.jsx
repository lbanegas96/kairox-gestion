import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

// PDF real (react-pdf) del Estado de Cuenta de un cliente — mismo patrón de
// colores/estructura que ReciboPagoPDF.jsx/FacturaPDF.jsx (02/09, hallazgo
// Luciano: "un formato de pdf completo con los mismos diseños de reportes
// que venimos trabajando"). Muestra el detalle de movimientos con saldo
// corrido, en orden cronológico (más viejo primero) — es como se lee un
// resumen de cuenta, al revés del orden de pantalla (más nuevo primero).
const NAVY = '#0f172a';
const BLUE = '#1d4ed8';
const SLATE = '#475569';
const MUTED = '#64748b';
const BORDER = '#cbd5e1';
const BG_ROW = '#f8fafc';
const RED = '#dc2626';
const GREEN = '#059669';

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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  receptorDato: {
    fontSize: 8,
    color: SLATE,
  },
  rangoBox: {
    alignItems: 'flex-end',
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
    width: 200,
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
  pageNumber: {
    position: 'absolute',
    bottom: 16,
    right: 28,
    fontSize: 6.5,
    color: MUTED,
  },
});

const formatARS = (n) =>
  Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatFecha = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
};

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

export function EstadoCuentaPDF({ estadoCuenta }) {
  const {
    cliente = {},
    // Fase 3 de PLAN_PARIDAD_COMPRAS.md (04/09): mismo componente para el
    // Estado de Cuenta de Proveedores -- entidadLabel cambia "Cliente" por
    // "Proveedor" en el recuadro, el resto del documento es idéntico
    // (una compra pendiente de pagar es, ni más ni menos, una deuda propia).
    entidadLabel = 'Cliente',
    fechaDesde,
    fechaHasta,
    saldoAnterior = 0,
    movimientos = [], // ya vienen en orden cronológico con .saldo (corrido) y .esDebito calculados
    totalDebe = 0,
    totalHaber = 0,
    saldoFinal = 0,
    empresa = {},
  } = estadoCuenta;

  const cuit = empresa.afip_cuit || empresa.cuit;
  const rango = fechaDesde || fechaHasta
    ? `${fechaDesde ? formatFecha(fechaDesde) : 'Inicio'} al ${fechaHasta ? formatFecha(fechaHasta) : 'hoy'}`
    : 'Historial completo';

  return (
    <Document title={`Estado de Cuenta — ${cliente.nombre || ''}`}>
      <Page size="A4" style={styles.page}>

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            {empresa.logo ? <Image src={empresa.logo} style={styles.logo} /> : null}
            <Text style={styles.emisorNombre}>{empresa.nombre ?? 'Mi Empresa'}</Text>
            {cuit ? <Text style={styles.emisorDato}>CUIT: {cuit}</Text> : null}
            {empresa.condicion_iva ? <Text style={styles.emisorDato}>Cond. IVA: {empresa.condicion_iva}</Text> : null}
            {empresa.direccion ? <Text style={styles.emisorDato}>{empresa.direccion}</Text> : null}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.compLabel}>Comprobante</Text>
            <Text style={styles.tituloComprobante}>Estado de Cuenta</Text>
            <Text style={styles.compLabel}>Período</Text>
            <Text style={styles.compValue}>{rango}</Text>
            <Text style={styles.compLabel}>Emitido</Text>
            <Text style={styles.compValue}>{formatFechaHora(new Date().toISOString())}</Text>
          </View>
        </View>

        {/* ── CLIENTE ────────────────────────────────────────────────── */}
        <View style={styles.sectionBox}>
          <View>
            <Text style={styles.sectionTitle}>{entidadLabel}</Text>
            <Text style={styles.receptorNombre}>{cliente.nombre}</Text>
            {cliente.documento ? <Text style={styles.receptorDato}>CUIT/DNI: {cliente.documento}</Text> : null}
          </View>
          <View style={styles.rangoBox}>
            <Text style={styles.sectionTitle}>Saldo anterior al período</Text>
            <Text style={styles.receptorNombre}>${formatARS(saldoAnterior)}</Text>
          </View>
        </View>

        {/* ── MOVIMIENTOS ────────────────────────────────────────────── */}
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.thText, { flex: 2.2 }]}>Fecha</Text>
            <Text style={[styles.thText, { flex: 1.8 }]}>Tipo</Text>
            <Text style={[styles.thText, { flex: 5 }]}>Descripción</Text>
            <Text style={[styles.thText, { flex: 2, textAlign: 'right' }]}>Debe</Text>
            <Text style={[styles.thText, { flex: 2, textAlign: 'right' }]}>Haber</Text>
            <Text style={[styles.thText, { flex: 2.2, textAlign: 'right' }]}>Saldo</Text>
          </View>
          {movimientos.length === 0 ? (
            <View style={styles.tableRow}>
              <Text style={[styles.tdText, { flex: 15, textAlign: 'center', color: MUTED }]}>Sin movimientos en el período seleccionado</Text>
            </View>
          ) : (
            movimientos.map((mov, i) => {
              // esDebito lo calcula el caller (imprimirEstadoCuenta.jsx /
              // imprimirEstadoCuentaProveedor.jsx) -- cada uno conoce el
              // vocabulario real de su propia tabla (DEBE/HABER para
              // Clientes, compra/pago/nota_credito/nota_debito para
              // Proveedores). Fallback a 'DEBE' por compatibilidad si algún
              // caller viejo no lo manda.
              const isDebe = mov.esDebito ?? (mov.tipo === 'DEBE');
              return (
                <View key={mov.id || i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
                  <Text style={[styles.tdText, { flex: 2.2 }]}>{formatFecha(mov.fecha)}</Text>
                  <Text style={[styles.tdText, { flex: 1.8, color: isDebe ? RED : GREEN }]}>{isDebe ? 'Deuda' : 'Pago'}</Text>
                  <View style={{ flex: 5 }}>
                    <Text style={styles.tdText}>{mov.descripcion || '—'}</Text>
                    {mov.referencia ? (
                      <Text style={[styles.tdText, { fontSize: 7, color: MUTED, marginTop: 1 }]}>
                        {isDebe ? `Comprobante: ${mov.referencia}` : `Medio: ${mov.referencia}`}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.tdText, { flex: 2, textAlign: 'right' }]}>{isDebe ? `$${formatARS(mov.monto)}` : ''}</Text>
                  <Text style={[styles.tdText, { flex: 2, textAlign: 'right' }]}>{!isDebe ? `$${formatARS(mov.monto)}` : ''}</Text>
                  <Text style={[styles.tdText, { flex: 2.2, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>${formatARS(mov.saldo)}</Text>
                </View>
              );
            })
          )}
        </View>

        {/* ── TOTALES / SALDO FINAL ──────────────────────────────────── */}
        <View style={styles.saldosWrap}>
          <View style={styles.saldosBox}>
            <View style={styles.saldoRow}>
              <Text style={styles.saldoLabel}>Total deudas (Debe):</Text>
              <Text style={styles.saldoValor}>${formatARS(totalDebe)}</Text>
            </View>
            <View style={styles.saldoRow}>
              <Text style={styles.saldoLabel}>Total pagos (Haber):</Text>
              <Text style={styles.saldoValor}>${formatARS(totalHaber)}</Text>
            </View>
            <View style={styles.saldoFinalRow}>
              <Text style={styles.saldoFinalLabel}>
                Saldo final{saldoFinal !== 0 ? (saldoFinal > 0 ? ' (deuda):' : ' (a favor):') : ':'}
              </Text>
              <Text style={[styles.saldoFinalValor, { color: saldoFinal > 0 ? RED : saldoFinal < 0 ? GREEN : NAVY }]}>
                {saldoFinal > 0 ? '+' : saldoFinal < 0 ? '−' : ''}${formatARS(Math.abs(saldoFinal))}
              </Text>
            </View>
          </View>
        </View>

        {/* ── PIE ────────────────────────────────────────────────────── */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Comprobante interno — no reemplaza a la factura ni a un recibo fiscal.
          </Text>
          <Text style={styles.footerText}>
            Generado por KAIROX Gestión · {formatFechaHora(new Date().toISOString())}
          </Text>
        </View>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />

      </Page>
    </Document>
  );
}
