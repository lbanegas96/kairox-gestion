import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

// ── Paleta (misma que FacturaPDF/CotizacionPDF, consistencia visual) ────────
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

  // ── FIRMA ──────────────────────────────────────────────────────────────
  firmaWrap: {
    flexDirection: 'row',
    marginTop: 28,
    gap: 20,
  },
  firmaBox: {
    flex: 1,
  },
  firmaLinea: {
    borderTop: `0.75pt solid ${C.navy}`,
    marginBottom: 4,
    height: 34,
  },
  firmaLabel: {
    fontSize: 7.5,
    color: C.muted,
    textAlign: 'center',
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

const formatFecha = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return [
    String(d.getUTCDate()).padStart(2, '0'),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    d.getUTCFullYear(),
  ].join('/');
};

export function RemitoPDF({ entrega, empresa }) {
  const items = entrega.entrega_items ?? [];
  const cliente = entrega.clientes ?? null;
  const clienteNombre = cliente?.nombre ?? 'Consumidor Final';

  // Domicilio de destino (mig.345, item 7). Antes esto imprimía
  // `cliente.direccion` a secas — sin localidad, provincia ni CP, un remito que
  // un transportista no podía usar para entregar. Ahora:
  //  1º el snapshot congelado en la entrega (dónde se entregó DE VERDAD),
  //  2º si no hay (entregas anteriores a mig.345), el domicilio actual del
  //     cliente como mejor aproximación disponible.
  const destino = entrega.destino_direccion || entrega.destino_localidad
    ? {
        direccion: entrega.destino_direccion,
        localidad: entrega.destino_localidad,
        provincia: entrega.destino_provincia,
        codigo_postal: entrega.destino_codigo_postal,
      }
    : {
        direccion: cliente?.direccion,
        localidad: cliente?.localidad,
        provincia: cliente?.provincia,
        codigo_postal: cliente?.codigo_postal,
      };

  // "Quilmes, Buenos Aires (B1878)" — sin comas colgando si falta una parte.
  const destinoCiudad = [
    [destino.localidad, destino.provincia].filter(Boolean).join(', '),
    destino.codigo_postal ? `(${destino.codigo_postal})` : '',
  ].filter(Boolean).join(' ');

  return (
    <Document title={`Remito ${entrega.numero_remito ?? entrega.numero_entrega}`}>
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
            <Text style={styles.compLabel}>Remito</Text>
            <Text style={styles.compValueLg}>{entrega.numero_remito ?? entrega.numero_entrega}</Text>

            <Text style={styles.compLabel}>Fecha</Text>
            <Text style={styles.compValue}>{formatFecha(entrega.fecha)}</Text>

            {entrega.cai_remito_usado ? (
              <>
                <Text style={styles.compLabel}>CAI</Text>
                <Text style={styles.compValue}>{entrega.cai_remito_usado}</Text>
              </>
            ) : null}
            {entrega.cai_remito_vencimiento_usado ? (
              <>
                <Text style={styles.compLabel}>CAI Vto.</Text>
                <Text style={styles.compValue}>{formatFecha(entrega.cai_remito_vencimiento_usado)}</Text>
              </>
            ) : null}
          </View>
        </View>

        {/* ── RECEPTOR ───────────────────────────────────────────────── */}
        <View style={styles.sectionBox}>
          <Text style={styles.sectionTitle}>Entregar a</Text>
          <View style={styles.receptorRow}>
            <View style={styles.receptorCol}>
              <Text style={styles.receptorNombre}>{clienteNombre}</Text>
              {destino.direccion ? <Text style={styles.compValue}>{destino.direccion}</Text> : null}
              {destinoCiudad ? <Text style={styles.compValue}>{destinoCiudad}</Text> : null}
            </View>
            {cliente?.documento ? (
              <View style={[styles.receptorCol, { alignItems: 'flex-end' }]}>
                <Text style={styles.compLabel}>CUIT / DNI</Text>
                <Text style={styles.compValue}>{cliente.documento}</Text>
              </View>
            ) : null}
          </View>
          {entrega.transportista ? (
            <View style={{ marginTop: 4 }}>
              <Text style={styles.compLabel}>Transportista</Text>
              <Text style={styles.compValue}>{entrega.transportista}</Text>
            </View>
          ) : null}
        </View>

        {/* ── TABLA DE ITEMS (sin precios: el remito no es un comprobante
             de venta, solo de traslado de mercadería) ─────────────────── */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.thText, { flex: 6 }]}>Descripción</Text>
            <Text style={[styles.thText, { flex: 2, textAlign: 'right' }]}>Cantidad</Text>
            <Text style={[styles.thText, { flex: 2, textAlign: 'right' }]}>Unidad</Text>
          </View>
          {items.map((item, i) => (
            <View key={item.id ?? i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
              <Text style={[styles.tdText, { flex: 6 }]}>
                {item.productos?.nombre ?? item.producto_id}
              </Text>
              <Text style={[styles.tdText, { flex: 2, textAlign: 'right' }]}>{item.cantidad}</Text>
              <Text style={[styles.tdText, { flex: 2, textAlign: 'right' }]}>
                {item.productos?.unidad_medida ?? '—'}
              </Text>
            </View>
          ))}
        </View>

        {/* ── ORIGEN / OBSERVACIONES ─────────────────────────────────── */}
        {entrega.pedidos?.numero ? (
          <View style={styles.avisoBox}>
            <Text style={styles.avisoText}>Basado en Pedido {entrega.pedidos.numero}.</Text>
          </View>
        ) : null}
        {entrega.observaciones ? (
          <View style={[styles.avisoBox, { marginTop: 6 }]}>
            <Text style={styles.avisoText}>{entrega.observaciones}</Text>
          </View>
        ) : null}

        {/* ── FIRMA ──────────────────────────────────────────────────── */}
        <View style={styles.firmaWrap}>
          <View style={styles.firmaBox}>
            <View style={styles.firmaLinea} />
            <Text style={styles.firmaLabel}>Firma y aclaración</Text>
          </View>
          <View style={styles.firmaBox}>
            <View style={styles.firmaLinea} />
            <Text style={styles.firmaLabel}>DNI</Text>
          </View>
          <View style={styles.firmaBox}>
            <View style={styles.firmaLinea} />
            <Text style={styles.firmaLabel}>Fecha de recepción</Text>
          </View>
        </View>

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
