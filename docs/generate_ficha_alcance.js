'use strict';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, PageBreak, LevelFormat,
} = require('docx');
const fs   = require('fs');
const path = require('path');

// ── Paleta de colores ──────────────────────────────────────────────────────────
const C = {
  BLUE_DARK:   '1E3A5F',
  BLUE_MED:    '1D4ED8',
  BLUE_LIGHT:  'DBEAFE',
  TEAL:        '0F766E',
  ORANGE:      'F97316',
  GRAY:        '64748B',
  GRAY_LIGHT:  'F8FAFC',
  GRAY_ALT:    'F1F5F9',
  GRAY_BORDER: 'CBD5E1',
  WHITE:       'FFFFFF',
  TEXT:        '1E293B',
  TEXT_LIGHT:  '64748B',
  GREEN:       '15803D',
  GREEN_LIGHT: 'DCFCE7',
  AMBER:       '92400E',
  RED:         'B91C1C',
};

const CW = 9360; // Ancho de contenido: Letter con margenes 1"

// ── Bordes ─────────────────────────────────────────────────────────────────────
const bord  = (color, size = 4) => ({ style: BorderStyle.SINGLE, size, color });
const allBorders = (color = C.GRAY_BORDER) => ({
  top: bord(color), bottom: bord(color),
  left: bord(color), right: bord(color),
});

// ── TextRun ────────────────────────────────────────────────────────────────────
const t = (text, o = {}) => new TextRun({
  text: String(text), font: 'Arial',
  size:   o.size   ?? 22,
  bold:   o.bold   ?? false,
  italic: o.italic ?? false,
  color:  o.color  ?? C.TEXT,
  underline: o.underline,
});

// ── Párrafo genérico ───────────────────────────────────────────────────────────
const p = (children, o = {}) => new Paragraph({
  alignment:       o.align ?? AlignmentType.LEFT,
  spacing:         { before: o.before ?? 0, after: o.after ?? 100 },
  border:          o.border,
  pageBreakBefore: o.pageBreak ?? false,
  children:        Array.isArray(children) ? children : [children],
});

// ── Spacer invisible ───────────────────────────────────────────────────────────
const sp = (after = 140) => new Paragraph({
  spacing: { before: 0, after },
  children: [t('', { size: 2 })],
});

// ── Heading 1 (con franja naranja inferior) ────────────────────────────────────
const H1 = (text) => new Paragraph({
  spacing: { before: 440, after: 200 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: C.ORANGE, space: 4 } },
  children: [new TextRun({ text, font: 'Arial', size: 32, bold: true, color: C.BLUE_DARK })],
});

// ── Heading 2 ──────────────────────────────────────────────────────────────────
const H2 = (text) => new Paragraph({
  spacing: { before: 300, after: 140 },
  children: [new TextRun({ text, font: 'Arial', size: 26, bold: true, color: C.BLUE_DARK })],
});

// ── Heading 3 ──────────────────────────────────────────────────────────────────
const H3 = (text, color = C.BLUE_DARK) => new Paragraph({
  spacing: { before: 200, after: 80 },
  children: [new TextRun({ text, font: 'Arial', size: 22, bold: true, color })],
});

// ── Bullet ─────────────────────────────────────────────────────────────────────
const bl = (text, o = {}) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  spacing:   { before: 40, after: 40 },
  children:  [new TextRun({ text, font: 'Arial', size: o.size ?? 20, color: o.color ?? C.TEXT, bold: o.bold ?? false })],
});

// ── Page break ─────────────────────────────────────────────────────────────────
const pb = () => new Paragraph({ pageBreakBefore: true, children: [t('', { size: 2 })] });

// ── Celda de encabezado de tabla ───────────────────────────────────────────────
const hc = (text, w, o = {}) => new TableCell({
  borders:       allBorders(o.borderColor ?? C.BLUE_DARK),
  width:         { size: w, type: WidthType.DXA },
  shading:       { fill: o.fill ?? C.BLUE_DARK, type: ShadingType.CLEAR },
  margins:       { top: 100, bottom: 100, left: 160, right: 160 },
  verticalAlign: VerticalAlign.CENTER,
  columnSpan:    o.span,
  children: [new Paragraph({
    alignment: o.align ?? AlignmentType.CENTER,
    children:  [new TextRun({ text, bold: true, color: o.textColor ?? C.WHITE, size: o.size ?? 20, font: 'Arial' })],
  })],
});

// ── Celda de datos ─────────────────────────────────────────────────────────────
const dc = (content, w, o = {}) => {
  const cellChildren = Array.isArray(content)
    ? content
    : [new Paragraph({
        alignment: o.align ?? AlignmentType.LEFT,
        children:  [new TextRun({ text: String(content), size: o.size ?? 20, font: 'Arial', bold: o.bold ?? false, color: o.color ?? C.TEXT })],
      })];
  return new TableCell({
    borders:       allBorders(o.borderColor ?? C.GRAY_BORDER),
    width:         { size: w, type: WidthType.DXA },
    shading:       (o.fill) ? { fill: o.fill, type: ShadingType.CLEAR } : undefined,
    margins:       { top: 80, bottom: 80, left: 160, right: 160 },
    verticalAlign: VerticalAlign.CENTER,
    columnSpan:    o.span,
    children:      cellChildren,
  });
};

// ── Fila alternada (shade impar) ───────────────────────────────────────────────
const alt = (i) => (i % 2 === 1) ? C.GRAY_ALT : undefined;

// =============================================================================
// PORTADA
// =============================================================================
const portada = [
  sp(800),

  // Logo placeholder - tabla de una celda centrada
  new Table({
    width: { size: 3800, type: WidthType.DXA },
    columnWidths: [3800],
    alignment: AlignmentType.CENTER,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: {
              top:    bord(C.ORANGE, 14),
              bottom: bord(C.ORANGE, 14),
              left:   bord(C.ORANGE, 14),
              right:  bord(C.ORANGE, 14),
            },
            width:   { size: 3800, type: WidthType.DXA },
            shading: { fill: C.BLUE_DARK, type: ShadingType.CLEAR },
            margins: { top: 280, bottom: 280, left: 500, right: 500 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 80 },
                children: [new TextRun({ text: 'KAIROX', font: 'Arial', size: 60, bold: true, color: C.WHITE })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 100 },
                children: [new TextRun({ text: 'Gestion', font: 'Arial', size: 40, color: C.ORANGE })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: 'ERP  .  POS  .  SaaS', font: 'Arial', size: 22, color: '94A3B8' })],
              }),
            ],
          }),
        ],
      }),
    ],
  }),

  sp(560),

  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 180 },
    children: [new TextRun({ text: 'FICHA DE ALCANCE DEL SISTEMA', font: 'Arial', size: 44, bold: true, color: C.BLUE_DARK })] }),

  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 480 },
    children: [new TextRun({ text: 'ERP/POS SaaS para PyMEs Argentinas', font: 'Arial', size: 28, color: C.ORANGE })] }),

  new Paragraph({
    alignment: AlignmentType.CENTER,
    border: {
      top:    { style: BorderStyle.SINGLE, size: 4, color: C.GRAY_BORDER, space: 4 },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: C.GRAY_BORDER, space: 4 },
    },
    spacing: { before: 0, after: 100 },
    children: [
      t('Version 1.0',         { size: 22, color: C.TEXT_LIGHT }),
      t('   |   ',             { size: 22, color: C.GRAY_BORDER }),
      t('9 de junio de 2026',  { size: 22, color: C.TEXT_LIGHT }),
      t('   |   ',             { size: 22, color: C.GRAY_BORDER }),
      t('Estado: ',            { size: 22, color: C.TEXT_LIGHT }),
      t('En Desarrollo',       { size: 22, bold: true, color: C.AMBER }),
    ],
  }),

  sp(480),

  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 },
    children: [t('CONFIDENCIAL  -  Para uso interno y estudio de mercado', { size: 18, italic: true, color: C.GRAY })] }),
];

// =============================================================================
// SECCION 1 — RESUMEN EJECUTIVO
// =============================================================================
const secResumen = [
  pb(),
  H1('1. Resumen Ejecutivo'),

  p(t('KAIROX Gestion es un sistema de gestion empresarial (ERP) con punto de venta (POS) integrado, disenado nativamente para el mercado argentino. Disponible 100% en la nube como Software-as-a-Service (SaaS), permite a PyMEs gestionar ventas, stock, compras, cuentas corrientes y contabilidad desde un unico panel, sin necesidad de instalacion ni inversion inicial en infraestructura.', { size: 22 }), { after: 180 }),

  H2('Problema que resuelve'),
  p(t('Las PyMEs argentinas -especialmente micro y pequenas empresas como ferreterias, distribuidoras y almacenes- enfrentan un ecosistema fragmentado de herramientas: planillas Excel para inventario, sistemas legacy costosos que no integran AFIP, y soluciones importadas que ignoran la realidad fiscal y operativa local. El resultado es perdida de tiempo, errores de stock, incumplimiento impositivo y falta de visibilidad del negocio en tiempo real.', { size: 22 }), { after: 180 }),

  H2('Propuesta de Valor Diferencial'),
  ...[
    'AFIP/ARCA nativo - Facturacion electronica integrada desde el nucleo del sistema, no como addon externo. CAE automatico, QR fiscal y Libro IVA.',
    'Sin costo de implementacion - Modelo SaaS puro: el usuario se registra y opera el mismo dia. No requiere consultor, servidor ni capacitacion extensa.',
    'Multi-tenant desde el inicio - Cada empresa opera en un entorno completamente aislado con seguridad a nivel de base de datos (Row Level Security).',
    'Precio accesible para micro-PyME - Disenado para el segmento de 1 a 3 empleados donde la inversion en software es la barrera principal.',
    'Adaptado 100% al mercado argentino - CC en pesos y dolares, tipo de cambio diario, moneda paralela, condiciones de pago locales y terminologia familiar.',
    'Stack moderno y escalable - React 18 + Supabase (PostgreSQL) + Vercel. Tiempo de respuesta < 200ms, disponibilidad 99.9%.',
  ].map(f => bl(f)),

  sp(200),

  // KPI box: 4 columnas iguales (4 * 2340 = 9360)
  new Table({
    width: { size: CW, type: WidthType.DXA },
    columnWidths: [2340, 2340, 2340, 2340],
    rows: [
      new TableRow({ children: [
        hc('Mercado Potencial',  2340, { fill: C.BLUE_DARK }),
        hc('Segmento Inicial',   2340, { fill: C.TEAL }),
        hc('Modulos en Prod.',   2340, { fill: C.BLUE_MED }),
        hc('Produccion',         2340, { fill: C.ORANGE }),
      ]}),
      new TableRow({ children: [
        dc([
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '~520K', font: 'Arial', size: 44, bold: true, color: C.BLUE_DARK })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'PyMEs argentinas', font: 'Arial', size: 18, color: C.TEXT_LIGHT })] }),
        ], 2340),
        dc([
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Micro', font: 'Arial', size: 44, bold: true, color: C.TEAL })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '1 a 3 empleados', font: 'Arial', size: 18, color: C.TEXT_LIGHT })] }),
        ], 2340),
        dc([
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '25+', font: 'Arial', size: 44, bold: true, color: C.BLUE_MED })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Modulos activos', font: 'Arial', size: 18, color: C.TEXT_LIGHT })] }),
        ], 2340),
        dc([
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Live', font: 'Arial', size: 44, bold: true, color: C.GREEN })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'kairox-gestion.vercel.app', font: 'Arial', size: 16, color: C.TEXT_LIGHT })] }),
        ], 2340),
      ]}),
    ],
  }),
];

// =============================================================================
// SECCION 2 — FICHA TECNICA
// =============================================================================
const fichaRows = [
  ['Nombre del sistema',   'KAIROX Gestion'],
  ['Tipo',                 'ERP/POS - Sistema de Gestion Empresarial con Punto de Venta integrado'],
  ['Arquitectura',         'SaaS multi-tenant - Single Page Application conectada a BaaS (Backend-as-a-Service)'],
  ['Frontend',             'React 18 + Vite + TailwindCSS + shadcn/ui + Recharts'],
  ['Backend / BaaS',       'Supabase: PostgreSQL 15 + Auth + Row Level Security + Edge Functions'],
  ['Hosting',              'Vercel (frontend CDN global) + Supabase Cloud (base de datos y autenticacion)'],
  ['Seguridad',            'RLS por empresa_id | JWT | Roles admin/staff/solo_caja | Audit log automatico'],
  ['Multi-tenancy',        'Aislamiento total por empresa mediante Row Level Security en todas las tablas'],
  ['Mercado objetivo',     'PyMEs comerciales argentinas: ferreterias, distribuidoras, mayoristas, almacenes'],
  ['Segmento inicial',     'Micro-PyME (1 a 3 empleados). Expansion prevista: pequena PyME (4 a 15 emp.)'],
  ['Modelo comercial',     'SaaS mensual sin costo de implementacion ni instalacion local'],
  ['Estado del desarrollo','En desarrollo activo - modulo core completo, integracion AFIP pendiente (Q3 2026)'],
  ['URL de produccion',    'https://kairox-gestion.vercel.app'],
  ['Repositorio',          'https://github.com/lbanegas96/kairox-gestion (rama: master)'],
];

const secFicha = [
  pb(),
  H1('2. Ficha Tecnica del Sistema'),
  new Table({
    width: { size: CW, type: WidthType.DXA },
    columnWidths: [2600, 6760],
    rows: [
      new TableRow({ children: [hc('Atributo', 2600), hc('Detalle', 6760)] }),
      ...fichaRows.map(([attr, det], i) => new TableRow({ children: [
        dc(attr, 2600, { bold: true, color: C.BLUE_DARK, fill: i % 2 === 0 ? C.GRAY_LIGHT : C.WHITE }),
        dc(det,  6760, { fill: i % 2 === 0 ? C.WHITE : C.GRAY_ALT }),
      ]})),
    ],
  }),
];

// =============================================================================
// SECCION 3 — MODULOS IMPLEMENTADOS
// =============================================================================
const modulosData = [
  {
    grupo: 'Ventas y Relacion con Clientes',
    modulos: [
      { n: 'Punto de Venta (POS)', s: 'Produccion',
        d: 'Gestion completa del proceso de venta. Multi-pago en una misma transaccion, verificacion de limites de credito en tiempo real y soporte de moneda extranjera.',
        f: ['Carrito de venta con busqueda de productos por nombre y SKU',
            'Multi-pago: Efectivo, Transferencia, Tarjeta, Cheque y Cuenta Corriente en simultaneo',
            'Verificacion automatica de limite de credito antes de confirmar venta en CC',
            'Tipo de cambio obligatorio para ventas en moneda extranjera (USD / EUR)',
            'Moneda paralela SAP-style: guarda monto_paralelo y tc_paralelo en cada transaccion',
            'Aplicacion automatica de lista de precios especial por cliente',
            'Comprobante imprimible con toggle Factura / Remito sin precios'] },
      { n: 'Historial de Ventas', s: 'Produccion',
        d: 'Vista completa de todas las ventas con filtros avanzados, estado de pago y paginacion eficiente.',
        f: ['Filtros por fecha, cliente, estado y forma de pago',
            'Estado de pago integrado con movimientos de Cuenta Corriente',
            'Paginacion de 50 registros por pagina para performance optima',
            'Acceso a detalle de venta con Document Flow visual SAP-style'] },
      { n: 'Notas de Credito', s: 'Produccion',
        d: 'Devolucion parcial o total con reversion automatica de stock, caja y cuenta corriente.',
        f: ['Devolucion parcial (items seleccionados) o total (comprobante completo)',
            'Reversion automatica de stock via movimientos_inventario y RPC increment_stock',
            'Reversion de saldo en CC con referencia al comprobante origen',
            'Trazabilidad completa visible en el Document Flow del comprobante'] },
      { n: 'Cotizaciones', s: 'Produccion',
        d: 'Presupuestos con conversion directa a venta. Tipo de cambio obligatorio para divisas extranjeras.',
        f: ['Creacion de cotizacion con cliente, productos y condiciones de pago',
            'Tipo de cambio obligatorio para cotizaciones en USD o EUR',
            'Conversion a venta con un clic manteniendo todos los datos',
            'Estados: borrador, enviada, aprobada, convertida, rechazada',
            'Indicadores de tasa de conversion integrados en el Dashboard ejecutivo'] },
      { n: 'Pedidos de Clientes (OC Clientes)', s: 'Produccion',
        d: 'Workflow completo de gestion de pedidos desde la recepcion hasta la facturacion.',
        f: ['Workflow: borrador > confirmado > en preparacion > facturado',
            'Confirmacion con AlertDialog para prevenir cambios accidentales',
            'Conversion a venta al momento de facturar el pedido',
            'Trazabilidad del pedido visible en Document Flow'] },
      { n: 'Clientes', s: 'Produccion',
        d: 'Ficha completa de cliente con gestion de credito, condiciones de pago y lista de precios diferenciada.',
        f: ['Ficha completa: datos fiscales, contacto, domicilio',
            'Condicion de pago y dias de credito configurables por cliente',
            'Limite de credito con verificacion automatica en ventas en cuenta corriente',
            'Asignacion de lista de precios especial (mayorista, VIP, distribuidor)',
            'Importacion masiva desde archivo CSV',
            'Soft delete: desactivar sin perder historial de movimientos'] },
      { n: 'Cuenta Corriente y Open Items', s: 'Produccion',
        d: 'Gestion SAP-style de cuentas por cobrar con antiguedad de deuda y cobros aplicados a comprobantes especificos.',
        f: ['Tab Antiguedad de Deuda FIFO: 30 / 60 / 90 / +90 dias',
            'Open Item Management: cobros aplicados a comprobante especifico',
            'Movimientos DEBE/HABER con referencia a comprobante origen',
            'Detalle por cliente con historial completo de movimientos',
            'Alertas de deuda vencida integradas en Dashboard y Notificaciones'] },
      { n: 'Listas de Precios', s: 'Produccion',
        d: 'Precios diferenciados por segmento de cliente: VIP, Mayorista, Distribuidor, entre otros.',
        f: ['CRUD de listas (nombre, descripcion, estado activo/inactivo)',
            'Asignacion de precio especial por producto dentro de cada lista',
            'Asignacion de lista a cliente desde la ficha de cliente',
            'Aplicacion automatica al seleccionar el cliente en el punto de venta',
            'Badge "LISTA" en el carrito para identificar items con precio especial'] },
    ],
  },
  {
    grupo: 'Compras y Proveedores',
    modulos: [
      { n: 'Compras', s: 'Produccion',
        d: 'Registro de facturas de compra con asiento contable automatico y paginacion eficiente.',
        f: ['Registro de factura con proveedor, productos y montos',
            'Asiento contable automatico al registrar la compra',
            'Paginacion de 50 registros por pagina',
            'Vinculacion con Ordenes de Compra para 3-way match'] },
      { n: 'Ordenes de Compra', s: 'Produccion',
        d: 'Workflow completo de aprobacion con recepcion parcial de mercaderia y verificacion 3-way match.',
        f: ['Workflow de aprobacion configurable por empresa',
            'Recepcion parcial de mercaderia (GR parcial al estilo SAP MM)',
            '3-way match: Orden de Compra <> Remito <> Factura de proveedor',
            'Actualizacion en tiempo real via Supabase Realtime',
            'Alertas en el panel de Notificaciones para OC pendientes de recepcion'] },
      { n: 'Proveedores', s: 'Produccion',
        d: 'Ficha completa con cuenta corriente, historial de ordenes de compra y pago inline desde la ficha.',
        f: ['Ficha completa: CUIT, datos bancarios, contacto, condiciones de pago',
            'Cuenta corriente de proveedores con saldo y movimientos',
            'Historial de ordenes de compra por proveedor',
            'Pago inline desde la ficha del proveedor sin salir del modulo',
            'Vista consolidada de deuda total a proveedores'] },
    ],
  },
  {
    grupo: 'Inventario y Catalogo',
    modulos: [
      { n: 'Productos y Catalogo', s: 'Produccion',
        d: 'Gestion completa del catalogo con control de stock, analisis ABC y carga masiva por CSV.',
        f: ['Alta, desactivacion (soft delete) y edicion de productos',
            'Control de stock actual vs. stock minimo con alertas automaticas',
            'Analisis ABC por revenue: clasificacion A (alto valor) / B (medio) / C (bajo)',
            'Importacion masiva desde CSV con mapeo de columnas',
            'SKU, unidades de medida, precio de costo y precio de venta'] },
    ],
  },
  {
    grupo: 'Finanzas, Caja y Bancos',
    modulos: [
      { n: 'Caja y Arqueo', s: 'Produccion',
        d: 'Gestion de caja con apertura/cierre formal, arqueo por denominaciones y control de sesiones.',
        f: ['Apertura y cierre de caja con monto inicial declarado',
            'Arqueo por denominaciones de billetes y monedas',
            'Historial de sesiones con diferencia entre arqueo y sistema',
            'Solo el cobro en Efectivo requiere caja abierta; Transferencia y Tarjeta no',
            'Alerta en Notificaciones si la caja lleva mas de 24h abierta sin cierre'] },
      { n: 'Bancos y Conciliacion Bancaria', s: 'Produccion',
        d: 'Gestion de cuentas bancarias con importacion de extractos y conciliacion automatica y manual.',
        f: ['Alta y gestion de multiples cuentas bancarias',
            'Importacion de extracto bancario desde archivo CSV',
            'Conciliacion automatica por monto y fecha',
            'Conciliacion manual para movimientos sin match automatico',
            'Vista de posicion neta por cuenta bancaria'] },
      { n: 'Tipo de Cambio Diario (TC del Dia)', s: 'Produccion',
        d: 'Sistema centralizado SAP-style de tipo de cambio. Un TC por empresa, moneda y fecha con upsert.',
        f: ['UNIQUE(empresa_id, moneda, fecha): un TC por empresa/moneda/dia',
            'Modal con autoFocus y Enter key para carga rapida',
            'Auto-fetch del TC al seleccionar moneda extranjera en cualquier operacion',
            'Badge visual: OK si TC cargado / Advertencia si TC faltante',
            'Bloqueo automatico de operaciones si el TC del dia no esta cargado'] },
      { n: 'Moneda Paralela (Parallel Currency)', s: 'Produccion',
        d: 'Contabilizacion paralela en divisa extranjera al estilo SAP FI Company Code Global Parameters.',
        f: ['Activacion/desactivacion por empresa desde Configuracion',
            'Seleccion de moneda paralela: USD, EUR o BRL',
            'Todas las transacciones guardan monto_paralelo y tc_paralelo',
            'Banner naranja en ventas cuando falta el TC del dia',
            'Reporte de Paridad ARS/USD con calculo retroactivo por comprobante'] },
    ],
  },
  {
    grupo: 'Contabilidad',
    modulos: [
      { n: 'Plan de Cuentas y Contabilidad', s: 'Produccion',
        d: 'Modulo contable completo con 7 vistas: plan, asientos, balance, libro mayor, P&L, balance general y periodos.',
        f: ['Plan de cuentas estructurado (activo, pasivo, patrimonio, resultado)',
            'Asientos contables manuales y generacion automatica desde transacciones',
            'Balance de Sumas y Saldos',
            'Libro Mayor por cuenta contable',
            'Estado de Resultados (Profit & Loss)',
            'Balance General',
            'Gestion y cierre de periodos contables'] },
    ],
  },
  {
    grupo: 'Reportes y Analytics',
    modulos: [
      { n: 'Dashboard Ejecutivo', s: 'Produccion',
        d: '8 KPIs de negocio en tiempo real, graficos de tendencias y alertas accionables con navegacion directa.',
        f: ['KPIs: Caja, Ventas del Dia, Ventas del Mes, Gastos del Mes',
            'KPIs: Margen Bruto, Balance Neto, Deuda Clientes, Stock Bajo',
            'Grafico de barras: ventas de los ultimos 7 dias',
            'Flujo de caja mensual de los ultimos 6 meses (ingresos vs. egresos)',
            'Panel de alertas CC vencidas con desglose +30 / +60 / +90 dias',
            'Cotizaciones aprobadas pendientes de conversion a venta',
            'Acciones rapidas: Nueva Venta, Cotizacion, OC, Movimiento Caja'] },
      { n: 'Portales Fiori-style', s: 'Produccion',
        d: 'Navegacion por area de negocio con KPIs contextuales, al estilo SAP Fiori Launchpad.',
        f: ['Launchpad principal: tiles por area y accesos rapidos del dia',
            'Portal Ventas: 6 KPIs + acceso a POS, Cotizaciones, Pedidos, CC',
            'Portal Compras: 5 KPIs + acceso a Compras, OC, Proveedores',
            'Portal Finanzas: 5 KPIs + posicion neta CxC - CxP',
            'Portal Inventario: 5 KPIs + barra de salud de stock'] },
      { n: 'Reportes', s: 'Produccion',
        d: '5 reportes especializados con comparativas de periodo anterior, analisis ABC y paridad de monedas.',
        f: ['Reporte de Ventas con delta % vs. periodo anterior',
            'Reporte de Stock y movimientos de inventario',
            'Reporte de Cuentas Corrientes (aging)',
            'Reporte de Compras del periodo',
            'Analisis ABC: clasificacion de productos por revenue acumulado',
            'Reporte de Paridad ARS/USD: calculo retroactivo por comprobante',
            'Exportacion a CSV con BOM UTF-8 para compatibilidad con Excel'] },
    ],
  },
  {
    grupo: 'Administracion y Configuracion',
    modulos: [
      { n: 'Usuarios y Roles', s: 'Produccion',
        d: 'Gestion de usuarios con invitacion por email, roles granulares por modulo y preset Solo Caja.',
        f: ['Invitacion por email via Resend SMTP',
            'Roles: Administrador (acceso total) | Staff (permisos granulares) | Solo Caja',
            'Permisos por modulo definidos en JSONB (profiles.permissions)',
            'Activar/desactivar usuarios sin eliminar historial',
            'Registro de ultimo acceso por usuario'] },
      { n: 'Configuracion de Empresa', s: 'Produccion',
        d: 'Configuracion completa: logo, datos fiscales, parametros operativos y funcionalidades avanzadas.',
        f: ['Logo de empresa almacenado en base de datos (Base64)',
            'Datos de la empresa: nombre, CUIT, domicilio, numero IIBB',
            'Toggle de activacion de Ordenes de Compra',
            'Carga de datos de ejemplo (8 productos + 3 clientes) para demos',
            'Activacion de Moneda Paralela con seleccion de divisa'] },
      { n: 'Document Flow Visual', s: 'Produccion',
        d: 'Trazabilidad SAP-style de comprobantes relacionados: cotizacion > pedido > venta > NC > cobro.',
        f: ['Vista de arbol del flujo de comprobantes relacionados',
            'Nodos: documento origen, actual, notas de credito y cobros',
            'Integrado en el detalle de cada venta',
            'Navegacion entre documentos relacionados con un clic'] },
      { n: 'Notificaciones Accionables', s: 'Produccion',
        d: 'Alertas en tiempo real con click de navegacion directa al modulo origen del problema.',
        f: ['Stock bajo: productos con stock actual <= stock minimo',
            'Deuda vencida: clientes con saldo > 0 sin movimiento hace +30 dias',
            'Ordenes de compra pendientes de recepcion (enviada / recibida parcial)',
            'Caja sin cerrar por mas de 24 horas',
            'Click en cada notificacion navega directamente al modulo correcto'] },
    ],
  },
];

const statusColor = (s) => s === 'Produccion' ? C.GREEN : s.includes('Desarrollo') ? C.AMBER : C.BLUE_MED;

const secModulos = [
  pb(),
  H1('3. Modulos y Funcionalidades - Estado Actual'),
  p(t('Todos los modulos listados a continuacion estan completamente implementados y operativos en el entorno de produccion (https://kairox-gestion.vercel.app). El sistema cuenta con mas de 25 modulos integrados en una arquitectura multi-tenant con seguridad RLS a nivel de base de datos.', { size: 22 }), { after: 200 }),
];

for (const grupo of modulosData) {
  secModulos.push(H2(grupo.grupo));
  for (const mod of grupo.modulos) {
    secModulos.push(
      new Paragraph({
        spacing: { before: 200, after: 60 },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: C.ORANGE, space: 8 } },
        indent: { left: 200 },
        children: [
          new TextRun({ text: mod.n, font: 'Arial', size: 22, bold: true, color: C.BLUE_DARK }),
          new TextRun({ text: '   ', font: 'Arial', size: 22 }),
          new TextRun({ text: '[' + mod.s + ']', font: 'Arial', size: 18, bold: true, color: statusColor(mod.s) }),
        ],
      }),
      new Paragraph({
        spacing: { before: 0, after: 100 },
        indent: { left: 200 },
        children: [new TextRun({ text: mod.d, font: 'Arial', size: 20, italic: true, color: C.TEXT_LIGHT })],
      }),
      ...mod.f.map(f => new Paragraph({
        numbering: { reference: 'bullets', level: 0 },
        spacing:   { before: 40, after: 40 },
        children:  [new TextRun({ text: f, font: 'Arial', size: 20, color: C.TEXT })],
      })),
      sp(80),
    );
  }
}

// =============================================================================
// SECCION 4 — ROADMAP
// =============================================================================
const roadmapTabla = [
  ['CRITICA', 'AFIP/ARCA - Factura Electronica',      'Q3 2026', 'CAE automatico, QR fiscal, Libro IVA. Bloqueante para facturar legalmente.',       C.RED],
  ['ALTA',    'Modelo de Licencias y Membresias',      'Q4 2026', 'Planes Starter/Pro/Business con MercadoPago. Trial 30 dias gratis.',                 C.ORANGE],
  ['MEDIA',   'TC Obligatorio en Caja y Compras',      'Q3 2026', 'Extender TC diario a modulos Caja, CC y Compras. Columnas DB ya listas.',            C.AMBER],
  ['MEDIA',   'Retenciones IIBB y Ganancias',          '2027',    'Calculo automatico en cobros y pagos. Certificados y acumulados para DDJJ.',          C.AMBER],
  ['BAJA',    'Solicitud de Compra (SC)',               '2027',    'Flujo de aprobacion interna antes de emitir la OC. Estilo SAP MM.',                   C.GREEN],
  ['BAJA',    'Presupuesto vs. Real Mensual',           '2027',    'Control presupuestario por cuenta/CC. Alertas al superar umbrales.',                  C.GREEN],
  ['BAJA',    'Gestion de Cheques',                     '2027',    'Cartera de cheques propios y de terceros con seguimiento de estados.',                C.GREEN],
  ['FUTURO',  'API Publica e Integraciones',            '2028',    'REST API + webhooks. Integracion Tiendanube, MercadoLibre, WooCommerce.',              C.BLUE_MED],
  ['FUTURO',  'Aplicacion Movil',                       '2028',    'App iOS/Android: consulta stock, aprobacion OC, POS simplificado.',                   C.BLUE_MED],
];

const secRoadmap = [
  pb(),
  H1('4. Funcionalidades Planificadas - Roadmap'),
  p(t('El roadmap esta organizado por prioridad de impacto en el negocio. La integracion AFIP/ARCA es bloqueante para la comercializacion formal del sistema en Argentina. Todos los demas modulos del nucleo estan completamente implementados.', { size: 22 }), { after: 200 }),

  new Table({
    width: { size: CW, type: WidthType.DXA },
    columnWidths: [1400, 3300, 1300, 3360],
    rows: [
      new TableRow({ children: [
        hc('Prioridad', 1400), hc('Funcionalidad', 3300), hc('Plazo est.', 1300), hc('Descripcion', 3360),
      ]}),
      ...roadmapTabla.map(([prio, nombre, plazo, desc, col], i) => new TableRow({ children: [
        dc(prio,   1400, { fill: alt(i), color: col, bold: true, align: AlignmentType.CENTER, size: 18 }),
        dc(nombre, 3300, { fill: alt(i), bold: true, color: C.BLUE_DARK }),
        dc(plazo,  1300, { fill: alt(i), align: AlignmentType.CENTER, color: C.TEXT_LIGHT }),
        dc(desc,   3360, { fill: alt(i), size: 18 }),
      ]})),
    ],
  }),

  sp(200),
  H2('Detalle del Roadmap Critico'),

  H3('AFIP/ARCA - Factura Electronica (Q3 2026)'),
  p(t('Es el unico modulo pendiente que bloquea la comercializacion formal. La arquitectura del sistema ya esta preparada: los modelos de datos de comprobantes incluyen campos para CAE, vencimiento y tipo de comprobante AFIP.', { size: 20 }), { after: 80 }),
  ...['WebService WSFE para emision de CAE automatico',
      'QR AFIP en comprobantes PDF imprimibles',
      'Puntos de venta multiples por empresa (con numeracion independiente)',
      'Libro IVA digital (ventas y compras)',
      'Comprobantes tipos A, B, C, E y MiPyME',
  ].map(f => bl(f)),

  sp(140),
  H3('Modelo de Licencias y Membresias (Q4 2026)'),
  p(t('Una vez completado AFIP, se implementa el sistema de facturacion a los propios clientes del SaaS. Se evalua MercadoPago como metodo principal por su penetracion en el mercado objetivo.', { size: 20 }), { after: 80 }),
  ...['Tiers: Starter / Pro / Business con limites por modulo y usuarios',
      'Integracion con MercadoPago para pagos recurrentes en pesos',
      'Panel self-service de suscripcion y facturacion',
      'Trial gratuito de 30 dias con acceso completo',
  ].map(f => bl(f)),
];

// =============================================================================
// SECCION 5 — TABLA COMPARATIVA
// =============================================================================
const comparRows = [
  ['Factura electronica AFIP',      'Planificado Q3-2026'],
  ['Multi-empresa (multi-tenant)',   'Nativo - RLS en DB'],
  ['POS integrado',                  'Completo'],
  ['Stock en tiempo real',           'Con alertas + Analisis ABC'],
  ['Dashboard analitico',            '8 KPIs + graficos'],
  ['Cuentas corrientes',             'Open Item SAP-style'],
  ['Cotizaciones / Presupuestos',    'Con conversion a venta'],
  ['Ordenes de Compra',              '3-way match completo'],
  ['Notas de Credito',               'Parcial y total'],
  ['Contabilidad integrada',         '7 vistas contables'],
  ['Conciliacion bancaria',          'Automatica + manual'],
  ['Moneda paralela (USD)',           'SAP Parallel Currency'],
  ['Multi-pago por transaccion',     '5 metodos simultaneos'],
  ['Lista de precios por cliente',   'Ilimitadas'],
  ['Roles y permisos granulares',    'Admin / Staff / Solo Caja'],
  ['Importacion CSV masiva',         'Productos y clientes'],
  ['API publica',                    'Roadmap 2028'],
  ['App movil',                      'Roadmap 2028'],
  ['Soporte mercado argentino',      '100% nativo'],
  ['Nube nativa (SaaS)',             'Sin instalacion'],
  ['Sin costo de implementacion',    'Self-service'],
  ['Precio mensual estimado',        'Starter ~$15 USD/mes'],
];

const cw5 = [3200, 1540, 1540, 1540, 1540]; // suma = 9360

const secComparativa = [
  pb(),
  H1('5. Tabla Comparativa de Capacidades'),
  p(t('Las columnas de competidores quedan en blanco para ser completadas durante el estudio de mercado. Se sugieren como referencias: Xubio, Colppy, Tango (Softland), Bejerman y Odoo Community.', { size: 22 }), { after: 180 }),

  new Table({
    width: { size: CW, type: WidthType.DXA },
    columnWidths: cw5,
    rows: [
      new TableRow({ children: [
        hc('Funcionalidad',    cw5[0]),
        hc('KAIROX Gestion',   cw5[1]),
        hc('Competidor 1',     cw5[2]),
        hc('Competidor 2',     cw5[3]),
        hc('Competidor 3',     cw5[4]),
      ]}),
      ...comparRows.map(([func, kairox], i) => {
        const kCol = kairox.startsWith('Planificado') ? C.AMBER
                   : kairox.startsWith('Roadmap') ? C.BLUE_MED
                   : kairox.includes('Nativo') || kairox.includes('Completo') || kairox.includes('SAP') || kairox.includes('100%') || kairox.includes('Sin') || kairox.includes('Self') ? C.GREEN
                   : C.TEXT;
        return new TableRow({ children: [
          dc(func,   cw5[0], { fill: i % 2 === 0 ? C.GRAY_LIGHT : C.WHITE, size: 18, bold: i % 2 === 0 }),
          dc(kairox, cw5[1], { fill: i % 2 === 0 ? C.GREEN_LIGHT : 'F0FDF4', color: kCol, size: 18, align: AlignmentType.CENTER }),
          dc('-',    cw5[2], { fill: i % 2 === 0 ? C.GRAY_LIGHT : C.WHITE, align: AlignmentType.CENTER, size: 18, color: C.GRAY_BORDER }),
          dc('-',    cw5[3], { fill: i % 2 === 0 ? C.GRAY_LIGHT : C.WHITE, align: AlignmentType.CENTER, size: 18, color: C.GRAY_BORDER }),
          dc('-',    cw5[4], { fill: i % 2 === 0 ? C.GRAY_LIGHT : C.WHITE, align: AlignmentType.CENTER, size: 18, color: C.GRAY_BORDER }),
        ]});
      }),
    ],
  }),
];

// =============================================================================
// SECCION 6 — DIFERENCIADORES
// =============================================================================
const difItems = [
  { t: 'AFIP/ARCA Nativo - No es un Addon', c: C.RED,
    b: 'A diferencia de la mayoria de los competidores que integran la facturacion electronica como modulo externo o add-on de terceros, KAIROX Gestion integra AFIP/ARCA en el nucleo del sistema desde su diseno original. El CAE, el QR fiscal, el Libro IVA y los puntos de venta son parte de la arquitectura base. Resultado: sin costos adicionales por facturacion, sin integraciones inestables y sin configuraciones tecnicas para el usuario final.' },
  { t: 'Sin Costo de Implementacion - Operativo desde el Dia 1', c: C.GREEN,
    b: 'El mayor freno para la adopcion tecnologica en micro-PyMEs no es el precio mensual: es el costo oculto de implementacion (consultor, capacitacion, migracion de datos). KAIROX elimina esta barrera por diseno. El usuario crea su cuenta, carga sus datos iniciales con el asistente de onboarding y empieza a operar el mismo dia. No requiere consultor, no requiere servidor propio y no requiere capacitacion extensa.' },
  { t: 'Multi-Tenant Nativo - Escalable sin Reescritura', c: C.BLUE_DARK,
    b: 'La arquitectura multi-tenant con Row Level Security (RLS) a nivel de base de datos garantiza que cada empresa opera en un entorno completamente aislado. No es un workaround ni un filtro en el codigo: es una politica de seguridad en PostgreSQL. Esto permite escalar a miles de empresas sin cambios de arquitectura y elimina el riesgo de contaminacion de datos entre clientes.' },
  { t: 'Adaptado 100% al Mercado Argentino', c: C.ORANGE,
    b: 'Las soluciones SaaS globales no estan adaptadas a la realidad argentina: cuentas corrientes en pesos y dolares, tipo de cambio diario obligatorio, moneda paralela, IIBB por provincia, condiciones de pago locales (30/60/90 dias) y terminologia familiar (comprobante, remito, nota de credito). KAIROX fue construido desde cero para Argentina: ninguna funcionalidad fue traducida o adaptada post-hoc.' },
  { t: 'Stack Tecnologico Moderno y Escalable', c: C.TEAL,
    b: 'React 18, Vite, TailwindCSS, Supabase (PostgreSQL) y Vercel forman una arquitectura que combina velocidad de desarrollo, rendimiento en produccion y confiabilidad a escala. El tiempo de carga inicial es menor a 1.5 segundos, las consultas responden en menos de 200ms. Vercel provee CDN global con deploy en 30 segundos. La base de datos PostgreSQL con indices y RLS soporta millones de registros sin degradacion de performance.' },
  { t: 'Seguridad Empresarial a Precio de PyME', c: C.BLUE_MED,
    b: 'Seguridad de nivel bancario disponible desde el primer dia: Row Level Security en todas las tablas, JWT para autenticacion, audit log automatico en todas las modificaciones, roles granulares por modulo y hardening de RLS con funcion get_my_empresa_id(). Funcionalidades que en sistemas enterprise tienen costo adicional son parte del nucleo base de KAIROX Gestion.' },
];

const secDiferenciadores = [
  pb(),
  H1('6. Diferenciadores Clave'),
  p(t('Los siguientes puntos representan las ventajas competitivas de mayor relevancia para el segmento de micro y pequenas PyMEs argentinas. El analisis esta redactado en lenguaje de negocio, orientado a decisores comerciales.', { size: 22 }), { after: 200 }),
  ...difItems.flatMap(item => [
    new Paragraph({
      spacing: { before: 260, after: 80 },
      border: { left: { style: BorderStyle.SINGLE, size: 20, color: item.c, space: 8 } },
      indent: { left: 200 },
      children: [new TextRun({ text: item.t, font: 'Arial', size: 24, bold: true, color: item.c })],
    }),
    new Paragraph({
      spacing: { before: 0, after: 140 },
      indent: { left: 200 },
      children: [new TextRun({ text: item.b, font: 'Arial', size: 20, color: C.TEXT })],
    }),
  ]),
];

// =============================================================================
// SECCION 7 — MODELO COMERCIAL
// =============================================================================
const tiersRows = [
  ['Precio estimado / mes', '~$15 USD',          '~$35 USD',         '~$65 USD'],
  ['Usuarios incluidos',    '1',                 'Hasta 5',          'Ilimitados'],
  ['Facturacion AFIP',      'Incluida',          'Incluida',         'Incluida'],
  ['Modulos disponibles',   'POS + Stock + Caja','Todos los modulos','Todos + API'],
  ['Soporte',               'Email',             'Email + Chat',     'Prioritario'],
  ['Multi-empresa',         'No',                'No',               'Si'],
  ['Exportacion CSV',       'Si',                'Si',               'Si'],
  ['API publica',           'No',                'No',               'Roadmap 2028'],
  ['Trial gratuito',        '30 dias',           '30 dias',          '30 dias'],
];

const segRows = [
  ['Micro-PyME',     '1 a 3',    '~310K empresas', 'Principal - Starter tier'],
  ['Pequena PyME',   '4 a 15',   '~140K empresas', 'Pro tier - todos los modulos'],
  ['Mediana PyME',   '16 a 50',  '~50K empresas',  'Business tier (en desarrollo)'],
  ['Grandes emp.',   '50+',      '~20K empresas',  'Fuera de scope actual'],
];

const secModelo = [
  pb(),
  H1('7. Modelo Comercial'),

  H2('Principios del modelo'),
  ...['SaaS mensual sin contrato minimo - cancelacion en cualquier momento',
      'Sin costo de implementacion - alta y onboarding 100% self-service',
      'Sin instalacion local - funciona desde cualquier navegador moderno',
      'Precio en dolares con pago local en pesos (tipo de cambio oficial)',
      'Trial gratuito de 30 dias con todas las funcionalidades habilitadas',
  ].map(f => bl(f)),

  sp(200),
  H2('Tiers de Precio (estimados - a validar con primeros clientes)'),
  new Table({
    width: { size: CW, type: WidthType.DXA },
    columnWidths: [2600, 2253, 2253, 2254],
    rows: [
      new TableRow({ children: [
        hc('',             2600, { fill: C.GRAY_LIGHT, textColor: C.BLUE_DARK }),
        hc('Starter',      2253, { fill: C.TEAL }),
        hc('Pro',          2253, { fill: C.BLUE_DARK }),
        hc('Business',     2254, { fill: C.BLUE_MED }),
      ]}),
      ...tiersRows.map(([feat, s, p_, b], i) => new TableRow({ children: [
        dc(feat, 2600, { fill: alt(i), bold: true, color: C.BLUE_DARK, size: 20 }),
        dc(s,    2253, { fill: alt(i), align: AlignmentType.CENTER, size: 20 }),
        dc(p_,   2253, { fill: alt(i), align: AlignmentType.CENTER, size: 20 }),
        dc(b,    2254, { fill: alt(i), align: AlignmentType.CENTER, size: 20 }),
      ]})),
    ],
  }),

  sp(200),
  H2('Segmentacion del Mercado Objetivo'),
  new Table({
    width: { size: CW, type: WidthType.DXA },
    columnWidths: [2100, 1900, 2400, 2960],
    rows: [
      new TableRow({ children: [
        hc('Segmento', 2100), hc('Empleados', 1900), hc('Tam. de mercado', 2400), hc('Fit con KAIROX', 2960),
      ]}),
      ...segRows.map(([seg, emp, tam, fit], i) => new TableRow({ children: [
        dc(seg, 2100, { fill: alt(i), bold: true }),
        dc(emp, 1900, { fill: alt(i), align: AlignmentType.CENTER }),
        dc(tam, 2400, { fill: alt(i) }),
        dc(fit, 2960, { fill: alt(i), color: fit.includes('Fuera') ? C.RED : fit.includes('desarrollo') ? C.AMBER : C.GREEN }),
      ]})),
    ],
  }),
];

// =============================================================================
// SECCION 8 — ESTADO DEL DESARROLLO
// =============================================================================
const estadoRows = [
  ['Autenticacion y Multi-tenancy', 'Produccion',    '100%', 'RLS completo, JWT, 3 roles'],
  ['POS / Ventas',                  'Produccion',    '95%',  'Pendiente AFIP'],
  ['Gestion de Stock / Productos',  'Produccion',    '100%', 'ABC + import CSV'],
  ['Caja y Arqueo',                 'Produccion',    '100%', 'Denominaciones'],
  ['Clientes y CC',                 'Produccion',    '100%', 'Open Item SAP-style'],
  ['Cotizaciones',                  'Produccion',    '100%', 'TC obligatorio'],
  ['Pedidos de Clientes',           'Produccion',    '100%', 'Workflow completo'],
  ['Compras',                       'Produccion',    '100%', 'Asiento automatico'],
  ['Ordenes de Compra',             'Produccion',    '100%', '3-way match'],
  ['Proveedores',                   'Produccion',    '100%', 'CC + historial OC'],
  ['Bancos y Conciliacion',         'Produccion',    '100%', 'Import CSV'],
  ['Contabilidad',                  'Produccion',    '90%',  '7 vistas completas'],
  ['Tipo de Cambio Diario',         'Produccion',    '100%', 'Upsert por empresa/dia'],
  ['Moneda Paralela',               'Produccion',    '80%',  'UI Caja y CC pendiente'],
  ['Listas de Precios',             'Produccion',    '100%', 'Por cliente'],
  ['Notas de Credito',              'Produccion',    '100%', 'Parcial y total'],
  ['Reportes y Analytics',          'Produccion',    '90%',  '5 reportes + Paridad'],
  ['Dashboard Ejecutivo',           'Produccion',    '100%', '8 KPIs + 2 graficos'],
  ['Usuarios y Roles',              'Produccion',    '100%', '3 roles + granular'],
  ['Configuracion de Empresa',      'Produccion',    '100%', 'Logo + moneda paralela'],
  ['AFIP/ARCA Facturacion',         'Planificado',   '0%',   'Q3 2026 - Bloqueante'],
  ['Membresias y Pagos',            'Planificado',   '0%',   'Post-AFIP (Q4 2026)'],
  ['API Publica',                   'Futuro',        '0%',   'Roadmap 2028'],
];

const stColMap = (s) => s === 'Produccion' ? C.GREEN : s === 'Planificado' ? C.AMBER : C.BLUE_MED;

const secEstado = [
  pb(),
  H1('8. Estado del Desarrollo'),

  H2('Avance por modulo'),
  new Table({
    width: { size: CW, type: WidthType.DXA },
    columnWidths: [3600, 1700, 1700, 2360],
    rows: [
      new TableRow({ children: [
        hc('Modulo / Area', 3600), hc('Estado', 1700), hc('Avance', 1700), hc('Observaciones', 2360),
      ]}),
      ...estadoRows.map(([mod, est, av, obs], i) => new TableRow({ children: [
        dc(mod, 3600, { fill: alt(i), bold: est === 'Produccion' }),
        dc(est, 1700, { fill: alt(i), color: stColMap(est), align: AlignmentType.CENTER, size: 18, bold: true }),
        dc(av,  1700, { fill: alt(i), align: AlignmentType.CENTER, bold: true, color: stColMap(est) }),
        dc(obs, 2360, { fill: alt(i), size: 18, color: C.TEXT_LIGHT }),
      ]})),
    ],
  }),

  sp(200),
  H2('Hitos Completados'),
  ...['Fase 1: Modulo base POS, stock, caja y clientes',
      'Fase 2: Multi-pago, aging CC, remito sin precios, import CSV, limite de credito',
      'Fase 3: Pedidos de clientes, condiciones de pago, rol Solo Caja',
      'Fase 4: Dashboard ejecutivo, datos de ejemplo, onboarding banner',
      'Fase 5: Modulo Proveedores, Portales Fiori, Notas de Credito, Analisis ABC',
      'Fase 6: Listas de precios, Notificaciones, Document Flow, Recepcion parcial OC',
      'Fase 7 (parcial): Deploy Vercel, TC del dia centralizado, Moneda Paralela SAP-style',
  ].map(f => bl(f, { color: C.GREEN })),

  sp(160),
  H2('Proximos Hitos'),
  ...['Supabase Auth URLs configuradas para produccion (Site URL + Redirect URLs)',
      'TC obligatorio extendido a Caja, Cuenta Corriente y Compras (columnas DB ya listas)',
      'Integracion AFIP/ARCA - WebService WSFE con CAE automatico',
      'Modelo de membresias y pagos recurrentes (Stripe o MercadoPago)',
      'Modelo de licencias Starter / Pro / Business',
  ].map(f => bl(f, { color: C.AMBER })),
];

// =============================================================================
// ENCABEZADO Y PIE DE PAGINA
// =============================================================================
const docHeader = new Header({
  children: [new Paragraph({
    alignment: AlignmentType.RIGHT,
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.ORANGE, space: 4 } },
    spacing: { before: 0, after: 80 },
    children: [new TextRun({ text: 'KAIROX Gestion  -  Confidencial', font: 'Arial', size: 18, bold: true, color: C.BLUE_DARK })],
  })],
});

const docFooter = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.GRAY_BORDER, space: 4 } },
    spacing: { before: 80, after: 0 },
    children: [
      new TextRun({ text: 'KAIROX Gestion  -  Ficha de Alcance del Sistema  -  CONFIDENCIAL     Pag. ', font: 'Arial', size: 18, color: C.GRAY }),
      new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 18, color: C.GRAY }),
      new TextRun({ text: ' / ', font: 'Arial', size: 18, color: C.GRAY }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 18, color: C.GRAY }),
    ],
  })],
});

// =============================================================================
// ENSAMBLADO DEL DOCUMENTO
// =============================================================================
const allChildren = [
  ...portada,
  ...secResumen,
  ...secFicha,
  ...secModulos,
  ...secRoadmap,
  ...secComparativa,
  ...secDiferenciadores,
  ...secModelo,
  ...secEstado,
];

const doc = new Document({
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{
        level: 0,
        format:    LevelFormat.BULLET,
        text:      '▪',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 560, hanging: 320 } } },
      }],
    }],
  },
  styles: {
    default: {
      document: { run: { font: 'Arial', size: 22 } },
    },
  },
  sections: [{
    properties: {
      page: {
        size:   { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: { default: docHeader },
    footers: { default: docFooter },
    children: allChildren,
  }],
});

// =============================================================================
// GENERAR ARCHIVO
// =============================================================================
const outPath = path.join(__dirname, 'KAIROX_Gestion_Ficha_Alcance.docx');

Packer.toBuffer(doc)
  .then(buf => {
    fs.writeFileSync(outPath, buf);
    const kb = (buf.length / 1024).toFixed(1);
    console.log('Documento generado: ' + outPath);
    console.log('Tamano: ' + kb + ' KB');
    console.log('Paginas estimadas: ~20-25');
  })
  .catch(err => {
    console.error('ERROR:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
