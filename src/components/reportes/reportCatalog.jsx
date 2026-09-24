import { TrendingUp, Truck, Boxes, Wallet, Landmark } from 'lucide-react';

// Rubros del Centro de Reportes (pedido de Luciano, 24/09: "que no esté todo
// disperso"). Cada rubro lista los ids de sus reportes en el orden en que se
// muestran — los generales y de uso diario primero. Un reporte nuevo que no
// figure acá aparece igual, en "Otros reportes" (ver repartirEnRubros): agregarlo
// a su rubro es lo único que hay que hacer para ubicarlo.
export const RUBROS = [
  {
    id: 'ventas',
    titulo: 'Ventas y Clientes',
    corto: 'Ventas',
    descripcion: 'Qué vendés, a quién, con qué margen y qué te deben',
    icon: <TrendingUp className="w-5 h-5 text-kx-violet" />,
    ids: ['ventas', 'rentabilidad_productos', 'rentabilidad_clientes', 'rendimiento_listas_precio', 'clientes', 'cuenta_corriente', 'pasivo_fidelizacion'],
  },
  {
    id: 'compras',
    titulo: 'Compras y Proveedores',
    corto: 'Compras',
    descripcion: 'A quién le comprás, cuánto y qué le debés',
    icon: <Truck className="w-5 h-5 text-kx-blue" />,
    ids: ['compras', 'detalle_compras_producto', 'ranking_proveedores', 'proveedores', 'oc_abiertas', 'devoluciones_proveedor'],
  },
  {
    id: 'inventario',
    titulo: 'Inventario',
    corto: 'Inventario',
    descripcion: 'Cuánto stock tenés, cuánto vale y cómo se movió',
    icon: <Boxes className="w-5 h-5 text-kx-amber" />,
    ids: ['valorizacion_inventario', 'kardex_inventario', 'historial_ajustes_inventario'],
  },
  {
    id: 'caja',
    titulo: 'Caja, Bancos y Cobros',
    corto: 'Caja y Bancos',
    descripcion: 'La plata que entra y sale: caja, cheques, tarjetas y Mercado Pago',
    icon: <Wallet className="w-5 h-5 text-kx-green" />,
    ids: ['financiero', 'arqueos_caja', 'flujo_cheques', 'liquidacion_tarjetas', 'mp_movimientos'],
  },
  {
    id: 'contabilidad',
    titulo: 'Impuestos y Contabilidad',
    corto: 'Contabilidad',
    descripcion: 'IVA, posición fiscal, resultados y ajuste por inflación',
    icon: <Landmark className="w-5 h-5 text-kx-red" />,
    ids: ['libro_iva_ventas', 'libro_iva_compras', 'posicion_fiscal', 'estado_resultados_cc', 'comparativo_periodos', 'memoria_ajuste_inflacion', 'paridad'],
  },
];

// Palabras con las que la gente busca y que no están (o no en esa forma) en el
// título o la descripción: "deuda" para las carteras, "stock" para inventario, etc.
export const PALABRAS_CLAVE = {
  ventas: ['facturación', 'facturas', 'tickets', 'comprobantes'],
  rentabilidad_productos: ['ganancia', 'margen', 'qué conviene vender'],
  rentabilidad_clientes: ['ganancia', 'margen', 'mejores clientes'],
  rendimiento_listas_precio: ['descuentos', 'mayorista', 'fuga de margen'],
  clientes: ['deuda', 'deudores', 'morosos', 'cobrar', 'antigüedad', 'aging'],
  cuenta_corriente: ['extracto', 'saldo del cliente', 'deuda'],
  pasivo_fidelizacion: ['puntos', 'canje'],
  compras: ['facturas de compra', 'gastos'],
  detalle_compras_producto: ['costo promedio', 'qué compré'],
  ranking_proveedores: ['concentración', 'dependencia'],
  proveedores: ['deuda', 'pagar', 'antigüedad', 'aging'],
  oc_abiertas: ['pedidos pendientes', 'mercadería que falta'],
  devoluciones_proveedor: ['reclamos', 'mercadería rota'],
  valorizacion_inventario: ['stock', 'mercadería', 'plata parada'],
  kardex_inventario: ['stock', 'movimientos de un producto', 'ficha'],
  historial_ajustes_inventario: ['stock', 'merma', 'pérdidas', 'recuento', 'faltantes', 'sobrantes'],
  financiero: ['caja', 'libro de caja', 'efectivo', 'ingresos y egresos'],
  arqueos_caja: ['caja', 'cierre de caja', 'faltante', 'sobrante', 'cajero'],
  flujo_cheques: ['cheques', 'vencimientos', 'cobrar', 'pagar'],
  liquidacion_tarjetas: ['tarjeta', 'posnet', 'acreditación'],
  mp_movimientos: ['mercado pago', 'qr', 'billetera', 'transferencias'],
  libro_iva_ventas: ['iva', 'afip', 'arca', 'débito fiscal', 'txt'],
  libro_iva_compras: ['iva', 'afip', 'arca', 'crédito fiscal', 'txt'],
  posicion_fiscal: ['iva', 'ingresos brutos', 'iibb', 'retenciones', 'impuestos'],
  estado_resultados_cc: ['sucursal', 'centro de costo', 'ganancias y pérdidas'],
  comparativo_periodos: ['cierre', 'mes contra mes', 'evolución'],
  memoria_ajuste_inflacion: ['inflación', 'recpam', 'papel de trabajo', 'inspección'],
  paridad: ['dólar', 'moneda extranjera', 'tipo de cambio'],
};
