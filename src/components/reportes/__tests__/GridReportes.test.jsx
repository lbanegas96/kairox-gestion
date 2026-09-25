import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/contexts/SupabaseAuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', empresa_id: 'emp-1' } }) }));

import GridReportes from '@/components/reportes/GridReportes';
import { REPORTS } from '@/components/reportes/reportDefinitions';

// Centro de Reportes ordenado por rubro, con buscador y favoritos (pedido de
// Luciano, 24/09: con 28 reportes (hoy 29) en una grilla plana, uno puntual era una aguja
// en un pajar).
const props = () => ({
  openReportDialog: vi.fn(),
  tcParaleloEnabled: false, monedaParalela: 'USD', setShowParidad: vi.fn(),
  afipActivo: true, setShowLibroIVA: vi.fn(), setLibroIVAOrigen: vi.fn(), setShowLibroIVACompras: vi.fn(),
  setShowEstadoResultadosCC: vi.fn(), setShowComparativoPeriodos: vi.fn(), setShowPosicionFiscal: vi.fn(),
  ajusteInflacionHabilitado: true, setShowMemoriaAjuste: vi.fn(), setShowConciliacion: vi.fn(),
});
const montar = (extra = {}) => {
  const p = { ...props(), ...extra };
  const r = render(<GridReportes {...p} />);
  return { p, ...r };
};
const seccion = (titulo) => {
  const h = screen.getByRole('heading', { level: 3, name: new RegExp(`^${titulo}`) });
  return within(h.closest('section'));
};
const titulosVisibles = () => screen.queryAllByRole('heading', { level: 4 }).map(h => h.textContent);
const buscar = (texto) => fireEvent.change(screen.getByLabelText('Buscar reporte'), { target: { value: texto } });

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

describe('GridReportes — por rubro', () => {
  it('muestra los 5 rubros en orden, cada uno con su cantidad', () => {
    montar();
    const rubros = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(rubros).toEqual([
      'Ventas y Clientes (7)', 'Compras y Proveedores (6)', 'Inventario (3)',
      'Caja, Bancos y Cobros (5)', 'Impuestos y Contabilidad (8)',
    ]);
  });

  it('están los 29 reportes, cada uno una sola vez, y ninguno quedó suelto en "Otros"', () => {
    montar();
    const titulos = titulosVisibles();
    expect(titulos).toHaveLength(29);
    expect(new Set(titulos).size).toBe(29);
    expect(screen.queryByText(/Otros reportes/)).toBeNull();
    // Los 21 del catálogo general + los 8 que abren pantalla propia.
    REPORTS.forEach(r => expect(titulos).toContain(r.title));
    ['Reporte de Paridad', 'Libro IVA Ventas', 'Libro IVA Compras', 'Estado de Resultados por CC',
      'Comparativo entre Períodos', 'Posición Fiscal Consolidada', 'Memoria de Cálculo — Ajuste por Inflación',
      'Conciliación de Cuentas de Control']
      .forEach(t => expect(titulos).toContain(t));
  });

  it('cada reporte está en el rubro que corresponde', () => {
    montar();
    expect(seccion('Ventas y Clientes').getByText('Rentabilidad por Cliente')).toBeTruthy();
    expect(seccion('Ventas y Clientes').getByText('Cartera de Clientes')).toBeTruthy();
    expect(seccion('Compras y Proveedores').getByText('Cartera de Proveedores')).toBeTruthy();
    expect(seccion('Compras y Proveedores').getByText('Ranking de Proveedores')).toBeTruthy();
    expect(seccion('Inventario').getByText('Kardex de Inventario')).toBeTruthy();
    expect(seccion('Caja, Bancos y Cobros').getByText('Flujo de Cheques Proyectado')).toBeTruthy();
    expect(seccion('Impuestos y Contabilidad').getByText('Libro IVA Compras')).toBeTruthy();
    expect(seccion('Impuestos y Contabilidad').getByText('Memoria de Cálculo — Ajuste por Inflación')).toBeTruthy();
  });

  it('los chips de rubro filtran y "Todos" vuelve a mostrar todo', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: /^Inventario/ }));
    expect(titulosVisibles().sort()).toEqual(['Historial de Ajustes de Inventario', 'Kardex de Inventario', 'Valorización de Inventario']);
    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }));
    expect(titulosVisibles()).toHaveLength(29);
  });
});

describe('GridReportes — buscador', () => {
  it('"iva" encuentra los reportes de IVA y no los que dicen "activá"', () => {
    montar();
    buscar('iva');
    const t = titulosVisibles();
    expect(t).toEqual(expect.arrayContaining(['Libro IVA Ventas', 'Libro IVA Compras', 'Posición Fiscal Consolidada']));
    expect(t).not.toContain('Reporte de Paridad');
  });

  it('"stock" encuentra los 3 de inventario', () => {
    montar();
    buscar('stock');
    expect(titulosVisibles()).toEqual(expect.arrayContaining(['Valorización de Inventario', 'Kardex de Inventario', 'Historial de Ajustes de Inventario']));
  });

  it('"deuda" encuentra las carteras', () => {
    montar();
    buscar('deuda');
    expect(titulosVisibles()).toEqual(expect.arrayContaining(['Cartera de Clientes', 'Cartera de Proveedores']));
  });

  it('con o sin tilde: "inflacion" e "inflación" encuentran la Memoria', () => {
    montar();
    buscar('inflacion');
    expect(titulosVisibles()).toContain('Memoria de Cálculo — Ajuste por Inflación');
    buscar('INFLACIÓN');
    expect(titulosVisibles()).toContain('Memoria de Cálculo — Ajuste por Inflación');
  });

  it('busca también en lo que explica cada reporte (no solo en el título)', () => {
    montar();
    buscar('aging'); // aparece en las palabras clave de las carteras
    expect(titulosVisibles()).toEqual(expect.arrayContaining(['Cartera de Clientes', 'Cartera de Proveedores']));
  });

  it('los chips muestran cuántos resultados cayeron en cada rubro y se apagan los que quedan en cero', () => {
    montar();
    buscar('kardex');
    expect(screen.getByRole('button', { name: /^Inventario/ }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /^Contabilidad 0/ }).disabled).toBe(true);
  });

  it('sin resultados avisa y ofrece limpiar; limpiar vuelve a mostrar todo', () => {
    montar();
    buscar('zzzz');
    expect(screen.getByText(/No encontré reportes con «zzzz»/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    expect(titulosVisibles()).toHaveLength(29);
  });

  it('la X del buscador borra el texto', () => {
    montar();
    buscar('iva');
    fireEvent.click(screen.getByRole('button', { name: 'Borrar lo escrito' }));
    expect(screen.getByLabelText('Buscar reporte').value).toBe('');
  });
});

describe('GridReportes — recuerda lo que estabas mirando', () => {
  // Los reportes de pantalla entera desmontan el Centro; al "Volver" no se puede perder el filtro.
  it('vuelve con la misma búsqueda y el mismo rubro', () => {
    const { unmount } = montar();
    buscar('stock');
    fireEvent.click(screen.getByRole('button', { name: /^Inventario/ }));
    unmount();

    montar();
    expect(screen.getByLabelText('Buscar reporte').value).toBe('stock');
    expect(screen.getByRole('button', { name: /^Inventario/ }).getAttribute('aria-pressed')).toBe('true');
    expect(titulosVisibles().sort()).toEqual(['Historial de Ajustes de Inventario', 'Kardex de Inventario', 'Valorización de Inventario']);
  });

  it('con basura guardada arranca limpio', () => {
    window.sessionStorage.setItem('kx_reportes_vista', '{no es json');
    montar();
    expect(screen.getByLabelText('Buscar reporte').value).toBe('');
    expect(titulosVisibles()).toHaveLength(29);
  });
});

describe('GridReportes — favoritos', () => {
  it('marcar con la estrella lo sube a una sección Favoritos, arriba de todo, y lo recuerda', () => {
    const { unmount } = montar();
    expect(screen.queryByRole('button', { name: /^Favoritos/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar Reporte de Ventas como favorito' }));

    const rubros = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(rubros[0]).toBe('Favoritos (1)');
    expect(screen.getByRole('button', { name: /^Favoritos/ })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('kx_reportes_favoritos_u1'))).toEqual(['ventas']);

    // Otra vez en pantalla (otra sesión): sigue marcado.
    unmount();
    montar();
    expect(screen.getAllByRole('heading', { level: 3 })[0].textContent).toBe('Favoritos (1)');
  });

  it('el chip Favoritos muestra solo los marcados; desmarcar el último vuelve a mostrar todo', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar Kardex de Inventario como favorito' }));
    fireEvent.click(screen.getByRole('button', { name: /^Favoritos/ }));
    expect(titulosVisibles()).toEqual(['Kardex de Inventario']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Quitar Kardex de Inventario de favoritos' })[0]);
    expect(screen.getByText(/Todavía no marcaste ningún favorito/)).toBeTruthy();
  });

  it('con una búsqueda activa no se repite la sección de favoritos', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar Reporte de Ventas como favorito' }));
    buscar('ventas');
    expect(screen.queryByRole('heading', { level: 3, name: /^Favoritos/ })).toBeNull();
  });

  it('la estrella no abre el reporte', () => {
    const { p } = montar();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar Reporte de Ventas como favorito' }));
    expect(p.openReportDialog).not.toHaveBeenCalled();
  });
});

describe('GridReportes — abrir cada tipo de reporte', () => {
  it('un reporte del catálogo general se abre en su diálogo', () => {
    const { p } = montar();
    fireEvent.click(screen.getByText('Ranking de Proveedores'));
    expect(p.openReportDialog).toHaveBeenCalledTimes(1);
    expect(p.openReportDialog.mock.calls[0][0].id).toBe('ranking_proveedores');
  });

  it('los que ocupan pantalla entera llaman a su propio abridor', () => {
    const { p } = montar();
    fireEvent.click(screen.getByText('Libro IVA Ventas'));
    expect(p.setShowLibroIVA).toHaveBeenCalledWith(true);
    expect(p.setLibroIVAOrigen).toHaveBeenCalledWith('reportes');
    fireEvent.click(screen.getByText('Libro IVA Compras'));
    expect(p.setShowLibroIVACompras).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText('Estado de Resultados por CC'));
    expect(p.setShowEstadoResultadosCC).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText('Comparativo entre Períodos'));
    expect(p.setShowComparativoPeriodos).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText('Posición Fiscal Consolidada'));
    expect(p.setShowPosicionFiscal).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText('Memoria de Cálculo — Ajuste por Inflación'));
    expect(p.setShowMemoriaAjuste).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText('Conciliación de Cuentas de Control'));
    expect(p.setShowConciliacion).toHaveBeenCalledWith(true);
  });

  it('Paridad y Memoria quedan apagados hasta que se active lo que necesitan', () => {
    const { p } = montar({ ajusteInflacionHabilitado: false });
    fireEvent.click(screen.getByText('Reporte de Paridad'));
    fireEvent.click(screen.getByText('Memoria de Cálculo — Ajuste por Inflación'));
    expect(p.setShowParidad).not.toHaveBeenCalled();
    expect(p.setShowMemoriaAjuste).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'Requiere configuración' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Requiere configuración' }).every(b => b.disabled)).toBe(true);
  });

  it('con la moneda paralela activa Paridad se abre y muestra la moneda', () => {
    const { p } = montar({ tcParaleloEnabled: true });
    expect(screen.getByText('USD')).toBeTruthy();
    fireEvent.click(screen.getByText('Reporte de Paridad'));
    expect(p.setShowParidad).toHaveBeenCalledWith(true);
  });

  it('el badge AFIP de los libros de IVA sale solo si AFIP está activo', () => {
    montar({ afipActivo: false });
    expect(screen.queryAllByText('AFIP')).toHaveLength(0);
  });

  it('la "i" abre la explicación del reporte', () => {
    montar();
    const tarjeta = screen.getByText('Posición Fiscal Consolidada').closest('div.group');
    fireEvent.click(within(tarjeta).getByTitle('Qué muestra este reporte'));
    expect(screen.getByText(/Cruza en una sola pantalla los 3 cálculos impositivos/)).toBeTruthy();
  });
});
