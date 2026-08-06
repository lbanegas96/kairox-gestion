import Dexie from 'dexie';

// Modo Offline del POS — Fase 2 (snapshot read-only) + Fase 3 (cola de ventas
// offline + sincronización). IndexedDB vía Dexie.
//
// Fase 2: snapshot de solo lectura de productos/clientes/formas de pago/
// centros de costo/datos de empresa — cachea, mientras hay red, lo que ya se
// lee hoy desde Supabase para tener un fallback cuando la red falla.
//
// Fase 3: `ventasPendientes`/`cajaSesionesPendientes` guardan lo que el
// cajero cobró (Efectivo/Transferencia únicamente) o abrió sin conexión, para
// mandarlo al servidor cuando vuelve la red. Ver `useSyncEngine.js` para el
// motor que las procesa y `useConfirmarVenta.js`/`CajaContext.jsx` para quién
// las encola.
export const offlineDb = new Dexie('kairox_offline_v1');

offlineDb.version(2).stores({
  // Índice compuesto por empresa_id para poder borrar/leer el snapshot de una
  // sola empresa sin tocar el de otra (multi-tenant también en el cliente).
  productos: 'id, empresa_id, nombre, codigo_sku, codigo_barras',
  clientes: 'id, empresa_id, nombre',
  formasPago: 'id, empresa_id, nombre',
  centrosCosto: 'id, empresa_id, nombre',
  empresaMeta: 'empresa_id',
  // Fase 3 — cola de ventas offline. `estado`: 'pendiente' -> 'sincronizada' |
  // 'conflicto'. `creado_en` (ISO) define el orden de sincronización — importa
  // para la numeración fiscal correlativa (se asigna recién al sincronizar).
  ventasPendientes: '++localId, empresa_id, client_uuid, estado, creado_en',
  // Fase 3 — apertura de caja offline. Mismo patrón de estados.
  cajaSesionesPendientes: '++localId, empresa_id, client_uuid, estado, creado_en',
});

// Reemplaza por completo el snapshot de una tabla para una empresa: borra lo
// viejo de esa empresa antes de insertar lo nuevo. Evita acumular productos
// dados de baja, renombrados, o con precio/stock desactualizado.
export async function guardarSnapshot(tabla, empresaId, filas) {
  if (!empresaId) return;
  const conEmpresa = (filas ?? []).map(f => ({ ...f, empresa_id: empresaId }));
  await offlineDb.transaction('rw', offlineDb[tabla], async () => {
    await offlineDb[tabla].where('empresa_id').equals(empresaId).delete();
    if (conEmpresa.length) await offlineDb[tabla].bulkPut(conEmpresa);
  });
}

export async function leerSnapshot(tabla, empresaId) {
  if (!empresaId) return [];
  return offlineDb[tabla].where('empresa_id').equals(empresaId).toArray();
}

// empresaMeta guarda un único registro por empresa (logo, nombre, datos de
// encabezado de ticket) — no es una lista, así que usa put/get directo.
export async function guardarEmpresaMeta(empresaId, datos) {
  if (!empresaId) return;
  await offlineDb.empresaMeta.put({ empresa_id: empresaId, ...datos });
}

export async function leerEmpresaMeta(empresaId) {
  if (!empresaId) return null;
  return offlineDb.empresaMeta.get(empresaId);
}

// Qué formas de pago pueden cobrarse sin conexión. Se decide por
// `tipo_instrumento` (mig.214, maestro `formas_pago`), no por `nombre` — el
// nombre lo puede editar cada empresa, tipo_instrumento no. 'Cuenta
// Corriente' no tiene fila en formas_pago (es una modalidad de venta a
// crédito, no un instrumento) y siempre necesita conexión: valida
// saldo/límite del cliente en el momento.
const TIPOS_INSTRUMENTO_OFFLINE = ['efectivo', 'transferencia'];

export function medioPagoDisponibleOffline(nombreMetodo, formasPago = []) {
  if (nombreMetodo === 'Cuenta Corriente') return false;
  const fila = formasPago.find(f => f.nombre === nombreMetodo);
  if (fila) return TIPOS_INSTRUMENTO_OFFLINE.includes(fila.tipo_instrumento);
  // Sin maestro de formas_pago todavía (empresa recién creada, no seedeada) —
  // fallback por nombre, mismo criterio que METODOS_FALLBACK en PanelCarrito.jsx.
  return ['Efectivo', 'Transferencia'].includes(nombreMetodo);
}

// ── Fase 3 — cola de ventas offline ─────────────────────────────────────────

// Etiqueta visual, no un identificador fiscal: el número real de venta sólo
// se asigna al sincronizar (obtener_proximo_numero necesita red). El dedupe
// real ante reintentos es `client_uuid`, no este número.
export function generarNumeroProvisorio() {
  return `OFFLINE-${Date.now().toString().slice(-6)}`;
}

// payload: exactamente los mismos p_* que useConfirmarVenta.js le manda hoy a
// crear_venta (menos p_numero_venta, que no existe todavía). itemsSnapshot es
// el carrito tal cual, para que el ticket pueda mostrar el detalle mientras la
// venta sigue pendiente. `cajaSesionId`/`cajaSesionClientUuid`: sólo una de
// las dos, según si la sesión de caja ya tenía id real al momento de vender o
// también está encolada (caso "abrí la caja ya sin internet"). `clienteCondicionIva`
// no lo necesita crear_venta — lo necesita el post-proceso de AFIP al
// sincronizar (determinarTipoComprobante), y no está en ningún otro lado del
// payload de la venta.
export async function encolarVenta(empresaId, {
  payload, itemsSnapshot, clienteCondicionIva = null,
  cajaSesionId = null, cajaSesionClientUuid = null,
}) {
  const clientUuid = crypto.randomUUID();
  const localId = await offlineDb.ventasPendientes.add({
    empresa_id: empresaId,
    client_uuid: clientUuid,
    estado: 'pendiente',
    creado_en: new Date().toISOString(),
    numero_provisorio: generarNumeroProvisorio(),
    caja_sesion_id: cajaSesionId,
    caja_sesion_client_uuid: cajaSesionClientUuid,
    cliente_condicion_iva: clienteCondicionIva,
    payload,
    itemsSnapshot,
    resultado: null,
    error: null,
  });
  const fila = await offlineDb.ventasPendientes.get(localId);
  return fila;
}

export async function listarVentasPendientes(empresaId) {
  if (!empresaId) return [];
  const filas = await offlineDb.ventasPendientes.where('empresa_id').equals(empresaId).toArray();
  return filas.sort((a, b) => a.creado_en.localeCompare(b.creado_en));
}

export async function marcarVentaSincronizada(localId, resultado) {
  await offlineDb.ventasPendientes.update(localId, { estado: 'sincronizada', resultado, error: null });
}

export async function marcarVentaConflicto(localId, error) {
  await offlineDb.ventasPendientes.update(localId, { estado: 'conflicto', error });
}

export async function eliminarVentaPendiente(localId) {
  await offlineDb.ventasPendientes.delete(localId);
}

// Cuenta lo que todavía necesita atención (no sincronizado con éxito) — usado
// para bloquear el cierre de caja: tanto 'pendiente' como 'conflicto' son
// ventas que el servidor no reconoce todavía.
export async function contarVentasPendientes(empresaId) {
  if (!empresaId) return 0;
  return offlineDb.ventasPendientes
    .where('empresa_id').equals(empresaId)
    .filter(f => f.estado !== 'sincronizada')
    .count();
}

// Ajuste optimista del snapshot local de productos (Fase 2) para que el mismo
// dispositivo no se sobre-venda a sí mismo entre dos ventas encoladas. Es
// sólo indicativo — la validación real de stock es la del servidor al
// sincronizar (crear_venta vuelve a chequear todo con FOR UPDATE).
export async function decrementarStockLocal(empresaId, items) {
  if (!empresaId || !items?.length) return;
  await offlineDb.transaction('rw', offlineDb.productos, async () => {
    for (const item of items) {
      const producto = await offlineDb.productos.get(item.producto_id ?? item.id);
      if (!producto || producto.empresa_id !== empresaId) continue;
      const cantidad = Number(item.cantidad) || 0;
      await offlineDb.productos.update(producto.id, {
        stock_actual: Number(producto.stock_actual ?? 0) - cantidad,
      });
    }
  });
}

// ── Fase 3 — apertura de caja offline ───────────────────────────────────────

export async function encolarAperturaCaja(empresaId, payload) {
  const clientUuid = crypto.randomUUID();
  const localId = await offlineDb.cajaSesionesPendientes.add({
    empresa_id: empresaId,
    client_uuid: clientUuid,
    estado: 'pendiente',
    creado_en: new Date().toISOString(),
    payload,
    resultado: null,
    error: null,
  });
  return offlineDb.cajaSesionesPendientes.get(localId);
}

export async function listarAperturasPendientes(empresaId) {
  if (!empresaId) return [];
  const filas = await offlineDb.cajaSesionesPendientes.where('empresa_id').equals(empresaId).toArray();
  return filas.sort((a, b) => a.creado_en.localeCompare(b.creado_en));
}

export async function marcarAperturaSincronizada(localId, resultado) {
  await offlineDb.cajaSesionesPendientes.update(localId, { estado: 'sincronizada', resultado, error: null });
}

export async function marcarAperturaConflicto(localId, error) {
  await offlineDb.cajaSesionesPendientes.update(localId, { estado: 'conflicto', error });
}

export async function contarAperturasPendientes(empresaId) {
  if (!empresaId) return 0;
  return offlineDb.cajaSesionesPendientes
    .where('empresa_id').equals(empresaId)
    .filter(f => f.estado !== 'sincronizada')
    .count();
}

// Bug real encontrado en pruebas de producción (07/08): un intento de "abrir
// caja sin conexión" puede quedar encolado y abandonado (ej. el cajero lo
// intentó, no llegó a usarlo, y después terminó abriendo la caja de nuevo ya
// con internet). Si nadie lo resuelve, ese registro viejo queda "vivo" en
// Dexie — y cuando el motor de sync lo procesa más tarde, el servidor
// correctamente le dice `conflict:true` (ya hay otra sesión real abierta
// para esa caja). Antes ahí se lo dejaba en un conflicto muerto, sin salida
// automática — y de paso, mientras seguía 'pendiente', podía llegar a
// "resucitarse" por error en `CajaContext.fetchCurrentSession` y pisar la
// sesión real en memoria (exactamente lo que le pasó a Nadia: 4 ventas
// reales quedaron encoladas contra una sesión que nunca existió del lado
// del servidor).
//
// La resolución correcta no es un callejón sin salida: para el cajero da lo
// mismo bajo qué número de sesión haya quedado la caja realmente abierta —
// sólo quiere que su venta entre. Esta función reconcilia CUALQUIER apertura
// vieja sin resolver de esa misma caja (y las ventas que dependían de su
// client_uuid) contra la sesión real que se sabe que ganó, en vez de dejarlas
// varadas para siempre.
export async function reconciliarAperturasViejas(empresaId, cajaId, sesionRealId) {
  if (!empresaId || !cajaId || !sesionRealId) return;

  const aperturas = await offlineDb.cajaSesionesPendientes
    .where('empresa_id').equals(empresaId).toArray();
  const viejas = aperturas.filter(a =>
    a.payload?.p_caja_id === cajaId && a.estado !== 'sincronizada'
  );
  if (!viejas.length) return;

  const ventas = await offlineDb.ventasPendientes
    .where('empresa_id').equals(empresaId).toArray();

  for (const vieja of viejas) {
    // Cualquier venta que se haya encolado dependiendo de esta apertura
    // abandonada (por client_uuid, porque todavía no tenía id real) ahora sí
    // lo tiene — se reasigna para que el próximo intento de sync la procese
    // como una venta normal, ya no como una que espera a una sesión que
    // nunca va a llegar.
    for (const venta of ventas) {
      if (venta.caja_sesion_client_uuid === vieja.client_uuid && venta.estado !== 'sincronizada') {
        await offlineDb.ventasPendientes.update(venta.localId, {
          caja_sesion_id: sesionRealId,
          caja_sesion_client_uuid: null,
        });
      }
    }
    await offlineDb.cajaSesionesPendientes.update(vieja.localId, {
      estado: 'sincronizada',
      resultado: { sesion_id: sesionRealId, reconciliada: true },
      error: null,
    });
  }
}
