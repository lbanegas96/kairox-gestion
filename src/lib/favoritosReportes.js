// Favoritos del Centro de Reportes: los reportes que cada usuario marcó con la
// estrella. Viven en el navegador (localStorage), por usuario — es una comodidad
// de cada persona, no un dato del negocio, así que no toca la base.

const PREFIJO = 'kx_reportes_favoritos';

export function claveFavoritos(userId) {
  return `${PREFIJO}_${userId || 'anonimo'}`;
}

/** Ids marcados. Nunca lanza: sin storage (modo privado, datos bloqueados) o con basura guardada devuelve []. */
export function leerFavoritos(clave) {
  try {
    const guardado = JSON.parse(window.localStorage.getItem(clave) || '[]');
    return Array.isArray(guardado) ? guardado.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function guardarFavoritos(clave, ids) {
  try {
    window.localStorage.setItem(clave, JSON.stringify(ids));
  } catch {
    // Sin storage el favorito vale solo mientras la pantalla esté abierta.
  }
}

/** Agrega el id si no estaba, lo saca si estaba. */
export function alternarFavorito(ids, id) {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

// Lo último que se buscó / el rubro elegido, mientras dure la pestaña: los
// reportes que ocupan toda la pantalla (Libros de IVA, Posición Fiscal, etc.)
// desmontan el Centro de Reportes, y al tocar "Volver" el filtro no puede
// haberse perdido — si no, buscar → abrir → volver obligaba a buscar de nuevo.
const CLAVE_VISTA = 'kx_reportes_vista';
const VISTA_VACIA = { busqueda: '', rubroActivo: 'todos' };

export function leerVista() {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(CLAVE_VISTA) || '{}');
    return {
      busqueda: typeof v.busqueda === 'string' ? v.busqueda : VISTA_VACIA.busqueda,
      rubroActivo: typeof v.rubroActivo === 'string' ? v.rubroActivo : VISTA_VACIA.rubroActivo,
    };
  } catch {
    return { ...VISTA_VACIA };
  }
}

export function guardarVista(vista) {
  try {
    window.sessionStorage.setItem(CLAVE_VISTA, JSON.stringify(vista));
  } catch {
    // Sin storage se pierde el filtro al volver, nada más.
  }
}
