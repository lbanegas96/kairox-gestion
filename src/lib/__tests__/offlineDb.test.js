import { describe, it, expect, beforeEach } from 'vitest';
import {
  offlineDb, guardarSnapshot, leerSnapshot, guardarEmpresaMeta, leerEmpresaMeta,
} from '@/lib/offlineDb';

// Modo Offline del POS — Fase 2. Verifica el aislamiento por empresa (mismo
// criterio multi-tenant del backend, replicado acá porque el snapshot vive en
// el dispositivo del cajero) y que un refresco reemplaza el snapshot viejo en
// vez de acumularlo.
describe('offlineDb', () => {
  const EMPRESA_A = '11111111-1111-1111-1111-111111111111';
  const EMPRESA_B = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    await Promise.all(offlineDb.tables.map(t => t.clear()));
  });

  it('guarda y lee un snapshot', async () => {
    await guardarSnapshot('productos', EMPRESA_A, [
      { id: 'p1', nombre: 'Coca Cola' },
      { id: 'p2', nombre: 'Agua' },
    ]);
    const filas = await leerSnapshot('productos', EMPRESA_A);
    expect(filas).toHaveLength(2);
    expect(filas.map(f => f.nombre).sort()).toEqual(['Agua', 'Coca Cola']);
  });

  it('no mezcla el snapshot de una empresa con el de otra', async () => {
    await guardarSnapshot('productos', EMPRESA_A, [{ id: 'p1', nombre: 'Producto A' }]);
    await guardarSnapshot('productos', EMPRESA_B, [{ id: 'p2', nombre: 'Producto B' }]);

    const deA = await leerSnapshot('productos', EMPRESA_A);
    const deB = await leerSnapshot('productos', EMPRESA_B);
    expect(deA).toEqual([expect.objectContaining({ id: 'p1' })]);
    expect(deB).toEqual([expect.objectContaining({ id: 'p2' })]);
  });

  it('un nuevo guardado reemplaza el snapshot anterior de esa empresa (no acumula)', async () => {
    await guardarSnapshot('productos', EMPRESA_A, [
      { id: 'p1', nombre: 'Viejo 1' },
      { id: 'p2', nombre: 'Viejo 2' },
    ]);
    // Simula: p1 se dio de baja, p2 cambió de nombre, se agregó p3.
    await guardarSnapshot('productos', EMPRESA_A, [
      { id: 'p2', nombre: 'Nuevo nombre' },
      { id: 'p3', nombre: 'Recién agregado' },
    ]);

    const filas = await leerSnapshot('productos', EMPRESA_A);
    expect(filas).toHaveLength(2);
    expect(filas.find(f => f.id === 'p1')).toBeUndefined();
    expect(filas.find(f => f.id === 'p2').nombre).toBe('Nuevo nombre');
  });

  it('guardarSnapshot con lista vacía deja el snapshot vacío (ej: empresa sin centros de costo)', async () => {
    await guardarSnapshot('centrosCosto', EMPRESA_A, [{ id: 'c1', nombre: 'Sucursal Centro' }]);
    await guardarSnapshot('centrosCosto', EMPRESA_A, []);
    expect(await leerSnapshot('centrosCosto', EMPRESA_A)).toEqual([]);
  });

  it('empresaMeta guarda y lee un único registro por empresa', async () => {
    await guardarEmpresaMeta(EMPRESA_A, { nombre: 'Kiosco A', logoUrl: 'data:image/png;base64,abc' });
    const meta = await leerEmpresaMeta(EMPRESA_A);
    expect(meta.nombre).toBe('Kiosco A');
    expect(meta.logoUrl).toBe('data:image/png;base64,abc');
  });

  it('leerSnapshot/leerEmpresaMeta sin empresa_id no explotan (devuelven vacío/null)', async () => {
    expect(await leerSnapshot('productos', null)).toEqual([]);
    expect(await leerEmpresaMeta(undefined)).toBeNull();
  });
});
