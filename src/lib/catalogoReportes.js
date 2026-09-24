// Orden del Centro de Reportes: qué reporte va en qué rubro, buscador y
// favoritos. Puro (sin React) para poder probarlo con el catálogo real: con 28
// reportes en una sola grilla plana, encontrar uno puntual era buscar una aguja
// en un pajar (pedido de Luciano, 24/09).

/** Minúsculas y sin tildes — "inflacion" tiene que encontrar "Inflación". */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Todo el texto por el que se puede encontrar una tarjeta (título, descripción, ayuda y rubro). */
export function textoBuscable(tarjeta, tituloRubro = '') {
  return normalizar([
    tarjeta.title,
    tarjeta.description,
    tarjeta.ayuda?.queEs,
    ...(tarjeta.ayuda?.queMuestra || []),
    ...(tarjeta.ayuda?.filtros || []),
    ...(tarjeta.palabrasClave || []),
    tituloRubro,
  ].filter(Boolean).join(' '));
}

/**
 * Cada palabra buscada tiene que ser el comienzo de alguna palabra del reporte
 * (en cualquier orden): "iva compras" encuentra "Libro IVA Compras", "vent"
 * encuentra "ventas". Por comienzo de palabra y no por cualquier pedazo, porque
 * si no "iva" encontraba también "activá" y "relativa".
 */
export function coincideBusqueda(tarjeta, tituloRubro, busqueda) {
  const buscadas = normalizar(busqueda).split(/[^a-z0-9]+/).filter(Boolean);
  if (buscadas.length === 0) return true;
  const palabras = textoBuscable(tarjeta, tituloRubro).split(/[^a-z0-9]+/).filter(Boolean);
  return buscadas.every(b => palabras.some(p => p.startsWith(b)));
}

/**
 * Reparte las tarjetas en sus rubros (en el orden que define cada rubro). Lo que
 * no figure en ningún rubro cae en "Otros reportes": un reporte nuevo nunca puede
 * quedar invisible por olvidarse de ubicarlo.
 *   tarjetas: [{ id, title, description, ayuda?, palabrasClave? }]
 *   rubros:   [{ id, titulo, ids: [id de tarjeta] }]
 */
export function repartirEnRubros(tarjetas, rubros) {
  const porId = new Map(tarjetas.map(t => [t.id, t]));
  const usadas = new Set();
  const secciones = rubros.map(r => {
    const lista = r.ids.map(id => porId.get(id)).filter(Boolean);
    lista.forEach(t => usadas.add(t.id));
    return { ...r, tarjetas: lista };
  });
  const sueltas = tarjetas.filter(t => !usadas.has(t.id));
  if (sueltas.length > 0) {
    secciones.push({ id: 'otros', titulo: 'Otros reportes', descripcion: '', tarjetas: sueltas });
  }
  return secciones;
}

/**
 * Lo que se muestra según la búsqueda, el rubro elegido y los favoritos.
 *  - rubroActivo 'todos': todos los rubros (con los favoritos arriba si no hay búsqueda).
 *  - rubroActivo 'favoritos': solo los marcados con la estrella.
 *  - rubroActivo <id de rubro>: solo ese rubro.
 * La búsqueda siempre se aplica primero. Nunca devuelve secciones vacías.
 */
export function armarSecciones({ tarjetas, rubros, busqueda = '', rubroActivo = 'todos', favoritos = [] }) {
  const esFavorita = new Set(favoritos);
  const conBusqueda = repartirEnRubros(tarjetas, rubros)
    .map(s => ({ ...s, tarjetas: s.tarjetas.filter(t => coincideBusqueda(t, s.titulo, busqueda)) }))
    .filter(s => s.tarjetas.length > 0);

  const hayBusqueda = normalizar(busqueda).trim() !== '';
  const soloFavoritas = () => ({
    id: 'favoritos',
    titulo: 'Favoritos',
    descripcion: 'Los que marcaste con la estrella',
    tarjetas: conBusqueda.flatMap(s => s.tarjetas).filter(t => esFavorita.has(t.id)),
  });

  if (rubroActivo === 'favoritos') {
    const fav = soloFavoritas();
    return fav.tarjetas.length > 0 ? [fav] : [];
  }
  if (rubroActivo !== 'todos') {
    return conBusqueda.filter(s => s.id === rubroActivo);
  }
  if (!hayBusqueda) {
    const fav = soloFavoritas();
    if (fav.tarjetas.length > 0) return [fav, ...conBusqueda];
  }
  return conBusqueda;
}

/** Cuántos reportes hay en cada chip (con la búsqueda ya aplicada, para ver dónde cayeron los resultados). */
export function contarPorRubro({ tarjetas, rubros, busqueda = '', favoritos = [] }) {
  const esFavorita = new Set(favoritos);
  const secciones = repartirEnRubros(tarjetas, rubros)
    .map(s => ({ ...s, tarjetas: s.tarjetas.filter(t => coincideBusqueda(t, s.titulo, busqueda)) }));
  const cuentas = { todos: 0, favoritos: 0 };
  secciones.forEach(s => {
    cuentas[s.id] = s.tarjetas.length;
    cuentas.todos += s.tarjetas.length;
    cuentas.favoritos += s.tarjetas.filter(t => esFavorita.has(t.id)).length;
  });
  return cuentas;
}
