import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizar, textoBuscable, coincideBusqueda, repartirEnRubros, armarSecciones, contarPorRubro,
} from '@/lib/catalogoReportes';
import {
  claveFavoritos, leerFavoritos, guardarFavoritos, alternarFavorito,
} from '@/lib/favoritosReportes';

const tarjetas = [
  { id: 'ventas', title: 'Reporte de Ventas', description: 'Detalle de ventas por período', palabrasClave: ['facturación'] },
  { id: 'clientes', title: 'Cartera de Clientes', description: 'Estado de cuentas y saldos', palabrasClave: ['deuda', 'morosos'] },
  { id: 'stock', title: 'Valorización de Inventario', description: 'Cuánta plata hay parada', palabrasClave: ['stock'] },
  { id: 'libro', title: 'Libro IVA Ventas', description: 'Comprobantes con IVA discriminado', ayuda: { queEs: 'Posición mensual ante AFIP', queMuestra: ['Neto gravado'], filtros: ['Rango de fechas'] } },
  { id: 'paridad', title: 'Reporte de Paridad', description: 'Activá la Moneda Paralela en Configuración' },
  { id: 'nuevo', title: 'Reporte Nuevo', description: 'Todavía sin rubro' },
];
const rubros = [
  { id: 'v', titulo: 'Ventas y Clientes', ids: ['ventas', 'clientes'] },
  { id: 'i', titulo: 'Inventario', ids: ['stock'] },
  { id: 'c', titulo: 'Contabilidad', ids: ['libro', 'paridad', 'id-que-no-existe'] },
];

describe('normalizar', () => {
  it('minúsculas y sin tildes ni ñ', () => {
    expect(normalizar('Inflación')).toBe('inflacion');
    expect(normalizar('  Órdenes de COMPRA ')).toBe('  ordenes de compra ');
    expect(normalizar(null)).toBe('');
  });
});

describe('textoBuscable', () => {
  it('junta título, descripción, ayuda, palabras clave y rubro', () => {
    const t = textoBuscable(tarjetas[3], 'Contabilidad');
    ['libro iva ventas', 'iva discriminado', 'afip', 'neto gravado', 'rango de fechas', 'contabilidad'].forEach(s => expect(t).toContain(s));
    expect(textoBuscable(tarjetas[1])).toContain('morosos');
  });
});

describe('coincideBusqueda', () => {
  it('sin búsqueda coincide todo', () => {
    expect(coincideBusqueda(tarjetas[0], 'Ventas', '')).toBe(true);
    expect(coincideBusqueda(tarjetas[0], 'Ventas', '   ')).toBe(true);
  });
  it('encuentra por título, sin importar mayúsculas ni tildes', () => {
    expect(coincideBusqueda(tarjetas[2], 'Inventario', 'VALORIZACION')).toBe(true);
    expect(coincideBusqueda(tarjetas[2], 'Inventario', 'valorización')).toBe(true);
  });
  it('encuentra por palabra clave y por rubro', () => {
    expect(coincideBusqueda(tarjetas[1], 'Ventas y Clientes', 'deuda')).toBe(true);
    expect(coincideBusqueda(tarjetas[2], 'Inventario', 'stock')).toBe(true);
    expect(coincideBusqueda(tarjetas[1], 'Ventas y Clientes', 'ventas y clientes')).toBe(true);
  });
  it('por comienzo de palabra: "vent" encuentra "ventas"', () => {
    expect(coincideBusqueda(tarjetas[0], 'Ventas', 'vent')).toBe(true);
  });
  it('NO por cualquier pedazo: "iva" no encuentra "activá"', () => {
    expect(coincideBusqueda(tarjetas[4], 'Contabilidad', 'iva')).toBe(false);
    expect(coincideBusqueda(tarjetas[3], 'Contabilidad', 'iva')).toBe(true);
  });
  it('varias palabras: todas tienen que estar, en cualquier orden', () => {
    expect(coincideBusqueda(tarjetas[3], 'Contabilidad', 'ventas iva')).toBe(true);
    expect(coincideBusqueda(tarjetas[3], 'Contabilidad', 'iva compras')).toBe(false);
  });
});

describe('repartirEnRubros', () => {
  const r = repartirEnRubros(tarjetas, rubros);
  it('respeta el orden de los rubros y el de cada rubro; ignora ids que no existen', () => {
    expect(r.slice(0, 3).map(s => s.id)).toEqual(['v', 'i', 'c']);
    expect(r[0].tarjetas.map(t => t.id)).toEqual(['ventas', 'clientes']);
    expect(r[2].tarjetas.map(t => t.id)).toEqual(['libro', 'paridad']);
  });
  it('lo que no figura en ningún rubro cae en "Otros reportes" (nunca queda invisible)', () => {
    expect(r[3]).toMatchObject({ id: 'otros', titulo: 'Otros reportes' });
    expect(r[3].tarjetas.map(t => t.id)).toEqual(['nuevo']);
  });
  it('sin sueltas no agrega "Otros"', () => {
    expect(repartirEnRubros(tarjetas.slice(0, 2), rubros).some(s => s.id === 'otros')).toBe(false);
  });
});

describe('armarSecciones', () => {
  const base = { tarjetas, rubros };
  const ids = (secs) => secs.map(s => [s.id, s.tarjetas.map(t => t.id)]);

  it('sin nada: todos los rubros y no muestra rubros vacíos', () => {
    const s = armarSecciones(base);
    expect(s.map(x => x.id)).toEqual(['v', 'i', 'c', 'otros']);
    expect(armarSecciones({ tarjetas: tarjetas.slice(0, 1), rubros }).map(x => x.id)).toEqual(['v']);
  });
  it('la búsqueda deja solo lo que coincide y saca los rubros que quedan vacíos', () => {
    expect(ids(armarSecciones({ ...base, busqueda: 'iva' }))).toEqual([['c', ['libro']]]);
    expect(ids(armarSecciones({ ...base, busqueda: 'deuda' }))).toEqual([['v', ['clientes']]]);
    expect(armarSecciones({ ...base, busqueda: 'zzz' })).toEqual([]);
  });
  it('elegir un rubro muestra solo ese rubro (y respeta la búsqueda)', () => {
    expect(ids(armarSecciones({ ...base, rubroActivo: 'i' }))).toEqual([['i', ['stock']]]);
    expect(armarSecciones({ ...base, rubroActivo: 'i', busqueda: 'deuda' })).toEqual([]);
  });
  it('los favoritos van arriba cuando no hay búsqueda, y los rubros siguen completos', () => {
    const s = armarSecciones({ ...base, favoritos: ['clientes', 'paridad'] });
    expect(s[0]).toMatchObject({ id: 'favoritos', titulo: 'Favoritos' });
    expect(s[0].tarjetas.map(t => t.id)).toEqual(['clientes', 'paridad']);
    expect(s.slice(1).map(x => x.id)).toEqual(['v', 'i', 'c', 'otros']);
  });
  it('con búsqueda no se antepone la sección de favoritos', () => {
    expect(armarSecciones({ ...base, busqueda: 'ventas', favoritos: ['clientes'] }).some(s => s.id === 'favoritos')).toBe(false);
  });
  it('el chip Favoritos muestra solo los marcados (aplicando la búsqueda), o nada', () => {
    expect(ids(armarSecciones({ ...base, rubroActivo: 'favoritos', favoritos: ['clientes', 'stock'] }))).toEqual([['favoritos', ['clientes', 'stock']]]);
    expect(ids(armarSecciones({ ...base, rubroActivo: 'favoritos', favoritos: ['clientes', 'stock'], busqueda: 'stock' }))).toEqual([['favoritos', ['stock']]]);
    expect(armarSecciones({ ...base, rubroActivo: 'favoritos', favoritos: [] })).toEqual([]);
  });
});

describe('contarPorRubro', () => {
  it('cuenta lo que hay en cada chip', () => {
    expect(contarPorRubro({ tarjetas, rubros, favoritos: ['ventas', 'stock', 'nuevo'] }))
      .toEqual({ todos: 6, favoritos: 3, v: 2, i: 1, c: 2, otros: 1 });
  });
  it('con búsqueda, cuenta solo los resultados de cada rubro', () => {
    // "ventas" está en el nombre del rubro "Ventas y Clientes" (los 2 reportes de ese rubro
    // coinciden) y además en "Libro IVA Ventas", que es de Contabilidad.
    expect(contarPorRubro({ tarjetas, rubros, busqueda: 'ventas' }))
      .toMatchObject({ todos: 3, v: 2, i: 0, c: 1 });
  });
});

describe('favoritosReportes', () => {
  beforeEach(() => window.localStorage.clear());

  it('clave por usuario', () => {
    expect(claveFavoritos('u1')).toBe('kx_reportes_favoritos_u1');
    expect(claveFavoritos(undefined)).toBe('kx_reportes_favoritos_anonimo');
  });
  it('alternar agrega y saca sin mutar', () => {
    const a = ['x'];
    expect(alternarFavorito(a, 'y')).toEqual(['x', 'y']);
    expect(alternarFavorito(['x', 'y'], 'x')).toEqual(['y']);
    expect(a).toEqual(['x']);
  });
  it('guarda y lee', () => {
    guardarFavoritos('k', ['a', 'b']);
    expect(leerFavoritos('k')).toEqual(['a', 'b']);
  });
  it('vacío o con basura guardada → []', () => {
    expect(leerFavoritos('nada')).toEqual([]);
    window.localStorage.setItem('k', '{no es json');
    expect(leerFavoritos('k')).toEqual([]);
    window.localStorage.setItem('k', JSON.stringify({ a: 1 }));
    expect(leerFavoritos('k')).toEqual([]);
    window.localStorage.setItem('k', JSON.stringify(['ok', 5, null]));
    expect(leerFavoritos('k')).toEqual(['ok']);
  });
});
