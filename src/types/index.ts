// =============================================================================
// KAIROX Gestión — Tipos del dominio
// =============================================================================

// ---------------------------------------------------------------------------
// Utilidades genéricas
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  data: T[];
  count: number;
  pages: number;
}

export interface ServiceResult<T> {
  data: T | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Auth / Usuarios
// ---------------------------------------------------------------------------

export type UserRole = 'admin' | 'staff';

export interface UserProfile {
  id: string;
  empresa_id: string;
  tenant_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  role: UserRole;
  permissions: Record<string, boolean>;
  active: boolean;
  created_at: string;
}

export interface AuthUser extends UserProfile {
  // extendido por SupabaseAuthContext
}

// ---------------------------------------------------------------------------
// Empresa / Config
// ---------------------------------------------------------------------------

export interface Empresa {
  id: string;
  nombre: string;
  created_at: string;
}

export interface AppConfig {
  nombre_empresa: string;
  logo_base64: string;
  company_logo: string;
}

// ---------------------------------------------------------------------------
// Inventario
// ---------------------------------------------------------------------------

export interface Categoria {
  id: string;
  empresa_id: string;
  nombre: string;
}

export interface Proveedor {
  id: string;
  empresa_id: string;
  nombre: string;
  contacto?: string | null;
  telefono?: string | null;
  email?: string | null;
}

export interface Producto {
  id: string;
  empresa_id: string;
  user_id: string;
  nombre: string;
  descripcion?: string | null;
  codigo_sku?: string | null;
  categoria_id?: string | null;
  proveedor_id?: string | null;
  precio_venta: number;
  costo_compra: number;
  stock_actual: number;
  stock_minimo: number;
  unidad_medida: string;
  activo: boolean;
  created_at: string;
  // joins
  categorias?: Pick<Categoria, 'nombre'> | null;
  proveedores?: Pick<Proveedor, 'nombre'> | null;
}

export type MovimientoInventarioTipo = 'entrada' | 'salida' | 'ajuste';

export interface MovimientoInventario {
  id: string;
  producto_id: string;
  user_id: string;
  tipo: MovimientoInventarioTipo;
  cantidad: number;
  motivo?: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export interface Cliente {
  id: string;
  empresa_id: string;
  user_id: string;
  nombre: string;
  documento?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  limite_credito: number;
  saldo_actual: number;
  created_at: string;
}

export type CuentaCorrienteTipo = 'DEBE' | 'HABER';

export interface CuentaCorrienteMovimiento {
  id: string;
  cliente_id: string;
  empresa_id: string;
  tipo: CuentaCorrienteTipo;
  monto: number;
  descripcion?: string | null;
  comprobante_id?: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------

export interface Comprobante {
  id: string;
  empresa_id: string;
  numero_venta: string;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  forma_pago: string;
  total: number;
  created_at: string;
  // joins
  clientes?: Pick<Cliente, 'nombre'> | null;
}

export interface ComprobanteItem {
  id: string;
  comprobante_id: string;
  empresa_id: string;
  producto_id?: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  // joins
  productos?: Pick<Producto, 'nombre' | 'unidad_medida'> | null;
}

// ---------------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------------

export type EstadoPago = 'pendiente' | 'parcial' | 'pagada';

export interface Compra {
  id: string;
  empresa_id: string;
  user_id: string;
  proveedor_id?: string | null;
  numero_factura: string;
  fecha: string;
  total: number;
  forma_pago: string;
  estado_pago: EstadoPago;
  created_at: string;
  // joins
  proveedores?: Pick<Proveedor, 'nombre'> | null;
}

export interface DetalleCompra {
  id: string;
  compra_id: string;
  empresa_id: string;
  producto_id?: string | null;
  cantidad: number;
  costo_unitario: number;
  subtotal: number;
}

// ---------------------------------------------------------------------------
// Cotizaciones
// ---------------------------------------------------------------------------

export type CotizacionEstado =
  | 'borrador'
  | 'enviada'
  | 'aprobada'
  | 'rechazada'
  | 'vencida'
  | 'convertida';

export interface Cotizacion {
  id: string;
  empresa_id: string;
  user_id: string;
  numero: string;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  fecha: string;
  fecha_vencimiento?: string | null;
  estado: CotizacionEstado;
  subtotal: number;
  descuento: number;
  total: number;
  moneda: string;
  notas?: string | null;
  condiciones_pago?: string | null;
  comprobante_id?: string | null;
  created_at: string;
  updated_at: string;
  // joins
  clientes?: Pick<Cliente, 'nombre'> | null;
  cotizacion_items?: CotizacionItem[];
}

export interface CotizacionItem {
  id: string;
  cotizacion_id: string;
  empresa_id: string;
  producto_id?: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento_item: number;
  subtotal: number;
  unidad_medida?: string | null;
  // joins
  productos?: Pick<Producto, 'nombre' | 'unidad_medida'> | null;
}

// ---------------------------------------------------------------------------
// Órdenes de Compra
// ---------------------------------------------------------------------------

export type OrdenCompraEstado =
  | 'pendiente_aprobacion'
  | 'borrador'
  | 'enviada'
  | 'recibida_parcial'
  | 'recibida'
  | 'cancelada';

export type FacturaEstado = 'pendiente' | 'pagada' | 'vencida' | 'anulada';

export interface FacturaProveedor {
  id: string;
  empresa_id: string;
  orden_compra_id?: string | null;
  proveedor_id?: string | null;
  numero_factura: string;
  fecha_factura: string;
  fecha_vencimiento?: string | null;
  monto_total: number;
  notas?: string | null;
  estado: FacturaEstado;
  created_at: string;
}

export interface OrdenCompra {
  id: string;
  empresa_id: string;
  user_id: string;
  numero: string;
  proveedor_id?: string | null;
  proveedor_nombre?: string | null;
  fecha: string;
  fecha_entrega_esperada?: string | null;
  estado: OrdenCompraEstado;
  subtotal: number;
  total: number;
  moneda: string;
  forma_pago: string;
  estado_pago: EstadoPago;
  notas?: string | null;
  compra_id?: string | null;
  created_at: string;
  updated_at: string;
  // joins
  proveedores?: Pick<Proveedor, 'nombre'> | null;
  ordenes_compra_items?: OrdenCompraItem[];
}

export interface OrdenCompraItem {
  id: string;
  orden_id: string;
  empresa_id: string;
  producto_id?: string | null;
  descripcion: string;
  cantidad_pedida: number;
  cantidad_recibida: number;
  costo_unitario: number;
  subtotal: number;
  unidad_medida?: string | null;
}

// ---------------------------------------------------------------------------
// Caja
// ---------------------------------------------------------------------------

export type CajaSesionEstado = 'abierta' | 'cerrada';
export type MovimientoCajaTipo = 'ingreso' | 'egreso';

export interface CajaSesion {
  id: string;
  empresa_id: string;
  user_id: string;
  estado: CajaSesionEstado;
  monto_inicial: number;
  monto_cierre?: number | null;
  apertura_fecha: string;
  cierre_fecha?: string | null;
  created_at: string;
}

export interface MovimientoCaja {
  id: string;
  empresa_id: string;
  user_id: string;
  caja_sesion_id?: string | null;
  tipo: MovimientoCajaTipo;
  categoria: string;
  concepto: string;
  monto: number;
  metodo_pago: string;
  fecha: string;
  is_automatic: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Dashboard / Métricas
// ---------------------------------------------------------------------------

export interface DashboardKPIs {
  ventasHoy: number;
  ventasAyer: number;
  variacionVentas: number;
  ventasMes: number;
  gastosMes: number;
  margenBruto: number;
  deudaClientes: number;
  productosStockBajo: Pick<Producto, 'id' | 'nombre' | 'stock_actual' | 'stock_minimo' | 'unidad_medida'>[];
}

export interface VentasPorDia {
  fecha: string;
  total: number;
}

export interface FlujoCajaMensual {
  label: string;
  ingresos: number;
  egresos: number;
  balance: number;
}

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------
// Plan de Cuentas / Contabilidad
// ---------------------------------------------------------------------------

export type CuentaTipo = 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'egreso';

export interface PlanCuenta {
  id: string;
  empresa_id: string;
  codigo: string;
  nombre: string;
  tipo: CuentaTipo;
  nivel: number;
  cuenta_padre_id: string | null;
  permite_movimientos: boolean;
  saldo_actual: number;
  activa: boolean;
  created_at: string;
  // join virtual para árbol
  hijos?: PlanCuenta[];
}

export type AsientoEstado = 'borrador' | 'confirmado' | 'anulado';
export type AsientoOrigen = 'venta' | 'compra' | 'caja' | 'manual';

export interface AsientoContable {
  id: string;
  empresa_id: string;
  user_id: string;
  numero: string;
  fecha: string;
  descripcion: string | null;
  estado: AsientoEstado;
  total_debe: number;
  total_haber: number;
  origen: AsientoOrigen | null;
  origen_id: string | null;
  created_at: string;
  // join
  asientos_items?: AsientoItem[];
}

export interface AsientoItem {
  id: string;
  asiento_id: string;
  empresa_id: string;
  cuenta_id: string;
  descripcion: string | null;
  debe: number;
  haber: number;
  created_at: string;
  // join
  plan_cuentas?: Pick<PlanCuenta, 'codigo' | 'nombre' | 'tipo'>;
}

// ---------------------------------------------------------------------------

export type AuditOperacion = 'INSERT' | 'UPDATE' | 'DELETE';

export interface AuditLog {
  id: number;
  tabla: string;
  operacion: AuditOperacion;
  registro_id: string | null;
  empresa_id: string | null;
  user_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
}
