// Agregaciones de los reportes del Backlog de Reportería (24/09) — puras, sin
// red ni React, para poder probarlas con datos armados a mano. Cada función
// recibe las filas que ya trajo ReportesSection.jsx y devuelve las filas del
// reporte; la regla de negocio de cada uno vive acá y no en el query.

const ESTANDAR = 'Precio estándar';

// ── Rendimiento por Lista de Precios (asignada vs. usada) ───────────────────

/** Nombre de una lista de precios; "Precio estándar" cuando la venta no usó ninguna. */
export function nombreLista(id, nombres = {}) {
  return id ? (nombres[id] || 'Lista eliminada') : ESTANDAR;
}

/**
 * Cómo se compara la lista USADA en una venta contra la ASIGNADA al cliente.
 *  - coincide:     usó la lista que le corresponde (o ninguna, y no tiene asignada).
 *  - sin_lista:    el cliente tiene una lista asignada pero se facturó a precio estándar.
 *  - sin_asignar:  se aplicó una lista que el cliente no tiene asignada.
 *  - otra_lista:   se aplicó una lista distinta a la asignada.
 */
export function situacionLista(usada, asignada) {
  const u = usada || null;
  const a = asignada || null;
  if (u === a) return 'coincide';
  if (!u) return 'sin_lista';
  if (!a) return 'sin_asignar';
  return 'otra_lista';
}

export const SITUACION_LISTA_LABEL = {
  coincide: 'Coincide',
  sin_lista: 'No se aplicó la lista del cliente',
  sin_asignar: 'Lista aplicada sin estar asignada',
  otra_lista: 'Lista distinta a la asignada',
};

/**
 * Una fila por par (lista usada, lista asignada). Las filas donde no coinciden
 * van primero: son las que hay que mirar (fuga de margen o descuento mal aplicado).
 *   ventas:  [{ cliente_id, lista_precio_id, total, costo_mercaderia_vendida }]
 *   listaAsignadaPorCliente: { [cliente_id]: lista_precio_id | null }
 *   nombres: { [lista_id]: nombre }
 * El costo es el COGS guardado en cada venta — una venta vieja sin costo suma 0
 * y su margen sale inflado (mismo caveat que Rentabilidad).
 */
export function rendimientoListasPrecio(ventas, listaAsignadaPorCliente = {}, nombres = {}) {
  const filas = new Map();
  (ventas || []).forEach(v => {
    const usada = v.lista_precio_id || null;
    const asignada = v.cliente_id ? (listaAsignadaPorCliente[v.cliente_id] || null) : null;
    const clave = `${usada ?? '-'}|${asignada ?? '-'}`;
    if (!filas.has(clave)) {
      filas.set(clave, {
        id: clave,
        usada: nombreLista(usada, nombres),
        asignada: asignada ? nombreLista(asignada, nombres) : 'Sin lista asignada',
        situacion: situacionLista(usada, asignada),
        ventas: 0, clientes: new Set(), venta: 0, costo: 0,
      });
    }
    const f = filas.get(clave);
    f.ventas += 1;
    f.clientes.add(v.cliente_id || 'consumidor_final');
    f.venta += Number(v.total) || 0;
    f.costo += Number(v.costo_mercaderia_vendida) || 0;
  });
  return [...filas.values()]
    .map(f => ({
      ...f,
      clientes: f.clientes.size,
      margen: f.venta - f.costo,
      margenPct: f.venta > 0 ? ((f.venta - f.costo) / f.venta) * 100 : 0,
      esDesvio: f.situacion !== 'coincide',
    }))
    .sort((a, b) => (Number(b.esDesvio) - Number(a.esDesvio)) || (b.venta - a.venta));
}

// ── Ranking de Proveedores ──────────────────────────────────────────────────

/**
 * Concentración de compra por proveedor: volumen, cantidad de facturas, ticket
 * promedio, % del total y % acumulado (para ver cuántos proveedores explican
 * el 80% del gasto).
 *   compras: [{ proveedor_id, proveedor, total, fecha }]
 */
export function rankingProveedores(compras) {
  const por = new Map();
  let totalGeneral = 0;
  (compras || []).forEach(c => {
    const id = c.proveedor_id || 'sin_proveedor';
    if (!por.has(id)) por.set(id, { id, nombre: c.proveedor || 'Sin proveedor', facturas: 0, total: 0, ultima: null });
    const p = por.get(id);
    const total = Number(c.total) || 0;
    p.facturas += 1;
    p.total += total;
    totalGeneral += total;
    if (c.fecha && (!p.ultima || c.fecha > p.ultima)) p.ultima = c.fecha;
  });
  let acumulado = 0;
  return [...por.values()]
    .sort((a, b) => b.total - a.total)
    .map((p, i) => {
      acumulado += p.total;
      return {
        ...p,
        posicion: i + 1,
        ticket: p.facturas > 0 ? p.total / p.facturas : 0,
        pct: totalGeneral > 0 ? (p.total / totalGeneral) * 100 : 0,
        pctAcum: totalGeneral > 0 ? (acumulado / totalGeneral) * 100 : 0,
      };
    });
}

// ── Historial de Ajustes de Inventario ──────────────────────────────────────

/**
 * Motivo tipeado en un ajuste manual, sacado de la descripción de su asiento
 * ("Ajuste de stock — <producto> (<motivo>)"). Como el nombre del producto
 * puede tener paréntesis, se le saca el nombre conocido en vez de adivinar por
 * los paréntesis. Acepta también el formato viejo, sin la raya.
 */
export function motivoDeAsiento(descripcion, nombreProducto) {
  let resto = String(descripcion || '').replace(/^Ajuste de stock\s*(?:—|-)?\s*/, '');
  if (nombreProducto && resto.startsWith(nombreProducto)) resto = resto.slice(nombreProducto.length);
  resto = resto.trim();
  if (resto.startsWith('(') && resto.endsWith(')')) resto = resto.slice(1, -1).trim();
  return resto;
}

/**
 * Todos los ajustes de stock del período, de las dos fuentes que hay:
 *  - Recuentos confirmados: unidades = contado − sistema, $ = unidades × el costo
 *    que tenía el ítem al contarlo (dato histórico, no el costo de hoy).
 *  - Ajustes manuales (Productos → Ajustar stock): se toman de su asiento
 *    contable (por eso solo hay $, no unidades — y un ajuste sin costo cargado
 *    no genera asiento, así que no aparece).
 * `veces` = cuántos ajustes tuvo ese producto en el período: el que ajusta
 * siempre es señal de merma sistemática.
 *   recuentoItems: [{ recuento_id, numero, fecha, producto_id, producto, stock_sistema, cantidad_contada, costo_unitario }]
 *   manuales:      [{ id, fecha, producto_id, producto, descripcion, monto, esFaltante }]
 */
export function historialAjustesInventario({ recuentoItems = [], manuales = [] } = {}) {
  const filas = [];
  recuentoItems.forEach((it, idx) => {
    if (it.cantidad_contada == null) return; // ítem que nunca se contó
    const unidades = (Number(it.cantidad_contada) || 0) - (Number(it.stock_sistema) || 0);
    if (unidades === 0) return;
    filas.push({
      id: `rc_${it.recuento_id}_${it.producto_id}_${idx}`,
      fecha: it.fecha,
      origen: 'Recuento',
      documento: it.numero,
      productoId: it.producto_id,
      producto: it.producto || 'Producto eliminado',
      unidades,
      valor: unidades * (Number(it.costo_unitario) || 0),
      detalle: '',
    });
  });
  manuales.forEach(m => {
    filas.push({
      id: `mn_${m.id}`,
      fecha: m.fecha,
      origen: 'Ajuste manual',
      documento: 'Ajuste manual',
      productoId: m.producto_id,
      producto: m.producto || 'Producto eliminado',
      unidades: null,
      valor: (m.esFaltante ? -1 : 1) * (Number(m.monto) || 0),
      detalle: motivoDeAsiento(m.descripcion, m.producto),
    });
  });
  const veces = {};
  filas.forEach(f => { veces[f.productoId] = (veces[f.productoId] || 0) + 1; });
  return filas
    .map(f => ({ ...f, veces: veces[f.productoId] }))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

// ── Devoluciones a Proveedores por motivo ───────────────────────────────────

export const COMPENSACION_LABEL = {
  nota_credito: 'Nota de crédito',
  reemplazo: 'Reemplazo',
  reembolso: 'Reembolso',
  ninguna: 'Sin compensación',
};

const sinAcentosMinuscula = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Una fila por devolución a proveedor. El motivo es texto libre y opcional: los
 * que se escriben distinto solo en mayúsculas/tildes se juntan bajo la primera
 * grafía vista, y los que no tienen motivo quedan como "Sin motivo".
 *   devs: [{ id, numero_devolucion, fecha, motivo, compensacion, proveedores: { nombre }, devolucion_items: [{ subtotal }] }]
 */
export function devolucionesProveedor(devs) {
  const canonica = new Map();
  return (devs || [])
    .map(d => {
      const crudo = String(d.motivo || '').trim();
      let motivo = 'Sin motivo';
      if (crudo) {
        const clave = sinAcentosMinuscula(crudo);
        if (!canonica.has(clave)) canonica.set(clave, crudo);
        motivo = canonica.get(clave);
      }
      return {
        id: d.id,
        fecha: d.fecha,
        numero: d.numero_devolucion,
        proveedor: d.proveedores?.nombre || 'Sin proveedor',
        motivo,
        sinMotivo: !crudo,
        compensacion: COMPENSACION_LABEL[d.compensacion] || d.compensacion || '—',
        total: (d.devolucion_items || []).reduce((s, i) => s + (Number(i.subtotal) || 0), 0),
      };
    })
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}
