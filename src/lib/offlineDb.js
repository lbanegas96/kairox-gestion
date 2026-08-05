import Dexie from 'dexie';

// Modo Offline del POS — Fase 2. Snapshot local de SOLO LECTURA (IndexedDB vía
// Dexie) para que el cajero pueda seguir buscando productos/clientes/formas de
// pago si se corta la conexión a internet.
//
// A propósito, esto NO incluye todavía ninguna cola de ventas offline ni
// escritura diferida — eso es la Fase 3 (ver PLAN_MODO_OFFLINE_POS.md). Acá
// sólo se cachea, mientras hay red, lo que ya se lee hoy desde Supabase para
// tener un fallback de lectura cuando la red falla. Cobrar sigue necesitando
// conexión.
export const offlineDb = new Dexie('kairox_offline_v1');

offlineDb.version(1).stores({
  // Índice compuesto por empresa_id para poder borrar/leer el snapshot de una
  // sola empresa sin tocar el de otra (multi-tenant también en el cliente).
  productos: 'id, empresa_id, nombre, codigo_sku, codigo_barras',
  clientes: 'id, empresa_id, nombre',
  formasPago: 'id, empresa_id, nombre',
  centrosCosto: 'id, empresa_id, nombre',
  empresaMeta: 'empresa_id',
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
