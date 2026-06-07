import { supabase } from '@/lib/customSupabaseClient';
import { getNowAR } from '@/lib/dateUtils';

const PRODUCTOS_DEMO = [
  { codigo_sku: 'CLAV-001', nombre: 'Clavos 2" x 50g', precio_costo: 150, precio_venta: 250,  stock_actual: 500, stock_minimo: 50,  unidad_medida: 'bolsa', categoria: 'Ferretería' },
  { codigo_sku: 'TORN-001', nombre: 'Tornillos autoperf. 6×1"', precio_costo: 80,  precio_venta: 130,  stock_actual: 200, stock_minimo: 30,  unidad_medida: 'caja',  categoria: 'Ferretería' },
  { codigo_sku: 'PINT-001', nombre: 'Pintura látex blanca 4L', precio_costo: 2800, precio_venta: 4500, stock_actual: 20,  stock_minimo: 5,   unidad_medida: 'lata',  categoria: 'Pinturas' },
  { codigo_sku: 'SOGA-001', nombre: 'Soga PP 5mm',           precio_costo: 350, precio_venta: 600,  stock_actual: 150, stock_minimo: 20,  unidad_medida: 'metro', categoria: 'Materiales' },
  { codigo_sku: 'LLAV-001', nombre: 'Llave stilson 8"',       precio_costo: 1200, precio_venta: 2000, stock_actual: 15,  stock_minimo: 3,   unidad_medida: 'un',   categoria: 'Herramientas' },
  { codigo_sku: 'CTEF-001', nombre: 'Cinta teflón 3/4"',      precio_costo: 90,  precio_venta: 150,  stock_actual: 100, stock_minimo: 20,  unidad_medida: 'rollo', categoria: 'Plomería' },
  { codigo_sku: 'DISC-001', nombre: 'Disco de corte 115mm',   precio_costo: 400, precio_venta: 650,  stock_actual: 50,  stock_minimo: 10,  unidad_medida: 'un',   categoria: 'Herramientas' },
  { codigo_sku: 'CERR-001', nombre: 'Cerradura de paleta',    precio_costo: 1800, precio_venta: 3200, stock_actual: 8,   stock_minimo: 2,   unidad_medida: 'un',   categoria: 'Seguridad' },
];

const CLIENTES_DEMO = [
  { nombre: 'Martínez Construcciones S.A.', email: 'contacto@martinezcsa.ar', telefono: '11-4523-8900', condicion_pago: '30_dias', limite_credito: 50000, tipo_documento: 'CUIT', numero_documento: '30-71234567-9' },
  { nombre: 'García, Hugo Sebastián',        email: 'hgarcia@gmail.com',       telefono: '11-1541-2200', condicion_pago: 'contado', limite_credito: 0,     tipo_documento: 'DNI',  numero_documento: '28.712.345' },
  { nombre: 'Cooperativa Obra Quilmes',       email: 'compras@coopquilmes.ar',  telefono: '11-4257-1100', condicion_pago: '60_dias', limite_credito: 100000,tipo_documento: 'CUIT', numero_documento: '20-55123456-0' },
];

export const demoDataService = {
  async hasData(empresaId: string): Promise<boolean> {
    const { count } = await supabase
      .from('productos')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId);
    return (count ?? 0) > 0;
  },

  async loadDemoData(empresaId: string, userId: string): Promise<{ productos: number; clientes: number }> {
    const now = getNowAR().toISOString();

    // Insertar productos
    const productosPayload = PRODUCTOS_DEMO.map(p => ({
      ...p,
      empresa_id: empresaId,
      user_id: userId,
      activo: true,
      created_at: now,
    }));
    const { data: prodData, error: prodErr } = await supabase
      .from('productos')
      .insert(productosPayload)
      .select('id');
    if (prodErr) throw new Error(`Productos: ${prodErr.message}`);

    // Insertar clientes
    const clientesPayload = CLIENTES_DEMO.map(c => ({
      ...c,
      empresa_id: empresaId,
      user_id: userId,
      activo: true,
      saldo_actual: 0,
      created_at: now,
    }));
    const { data: cliData, error: cliErr } = await supabase
      .from('clientes')
      .insert(clientesPayload)
      .select('id');
    if (cliErr) throw new Error(`Clientes: ${cliErr.message}`);

    return {
      productos: prodData?.length ?? 0,
      clientes: cliData?.length ?? 0,
    };
  },
};
