import { describe, it, expect, beforeEach } from 'vitest';
import {
  offlineDb, guardarSnapshot, leerSnapshot, guardarEmpresaMeta, leerEmpresaMeta,
  encolarVenta, listarVentasPendientes, marcarVentaSincronizada, marcarVentaConflicto,
  eliminarVentaPendiente, contarVentasPendientes, decrementarStockLocal,
  encolarAperturaCaja, listarAperturasPendientes, marcarAperturaSincronizada,
  marcarAperturaConflicto, contarAperturasPendientes, medioPagoDisponibleOffline,
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

  // Modo Offline del POS — Fase 3: cola de ventas + apertura de caja offline.
  describe('cola de ventas offline', () => {
    it('encolarVenta genera client_uuid y numero_provisorio, y queda en estado pendiente', async () => {
      const fila = await encolarVenta(EMPRESA_A, {
        payload: { p_total: 1000 },
        itemsSnapshot: [{ id: 'p1', cantidad: 2 }],
      });
      expect(fila.estado).toBe('pendiente');
      expect(fila.client_uuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(fila.numero_provisorio).toMatch(/^OFFLINE-\d+$/);
      expect(fila.payload.p_total).toBe(1000);
    });

    it('listarVentasPendientes devuelve en orden cronológico de creación', async () => {
      const v1 = await encolarVenta(EMPRESA_A, { payload: {}, itemsSnapshot: [] });
      // Fuerza un creado_en posterior determinístico (Date.now() puede repetirse en test rápido).
      await offlineDb.ventasPendientes.update(v1.localId, { creado_en: '2026-08-05T10:00:00.000Z' });
      const v2 = await encolarVenta(EMPRESA_A, { payload: {}, itemsSnapshot: [] });
      await offlineDb.ventasPendientes.update(v2.localId, { creado_en: '2026-08-05T10:00:01.000Z' });

      const filas = await listarVentasPendientes(EMPRESA_A);
      expect(filas.map(f => f.localId)).toEqual([v1.localId, v2.localId]);
    });

    it('no mezcla ventas pendientes entre empresas', async () => {
      await encolarVenta(EMPRESA_A, { payload: {}, itemsSnapshot: [] });
      await encolarVenta(EMPRESA_B, { payload: {}, itemsSnapshot: [] });
      expect(await listarVentasPendientes(EMPRESA_A)).toHaveLength(1);
      expect(await listarVentasPendientes(EMPRESA_B)).toHaveLength(1);
    });

    it('marcarVentaSincronizada guarda el resultado real y ya no cuenta como pendiente', async () => {
      const fila = await encolarVenta(EMPRESA_A, { payload: {}, itemsSnapshot: [] });
      expect(await contarVentasPendientes(EMPRESA_A)).toBe(1);

      await marcarVentaSincronizada(fila.localId, { comprobante_id: 'c1', numero_venta: '0001' });
      const actualizada = await offlineDb.ventasPendientes.get(fila.localId);
      expect(actualizada.estado).toBe('sincronizada');
      expect(actualizada.resultado.numero_venta).toBe('0001');
      expect(await contarVentasPendientes(EMPRESA_A)).toBe(0);
    });

    it('marcarVentaConflicto sigue contando como pendiente de atención', async () => {
      const fila = await encolarVenta(EMPRESA_A, { payload: {}, itemsSnapshot: [] });
      await marcarVentaConflicto(fila.localId, 'Stock insuficiente');
      const actualizada = await offlineDb.ventasPendientes.get(fila.localId);
      expect(actualizada.estado).toBe('conflicto');
      expect(actualizada.error).toBe('Stock insuficiente');
      expect(await contarVentasPendientes(EMPRESA_A)).toBe(1);
    });

    it('eliminarVentaPendiente la saca de la cola (anular un conflicto)', async () => {
      const fila = await encolarVenta(EMPRESA_A, { payload: {}, itemsSnapshot: [] });
      await eliminarVentaPendiente(fila.localId);
      expect(await offlineDb.ventasPendientes.get(fila.localId)).toBeUndefined();
      expect(await contarVentasPendientes(EMPRESA_A)).toBe(0);
    });
  });

  describe('decrementarStockLocal', () => {
    it('descuenta stock del snapshot local de productos', async () => {
      await guardarSnapshot('productos', EMPRESA_A, [{ id: 'p1', nombre: 'Agua', stock_actual: 10 }]);
      await decrementarStockLocal(EMPRESA_A, [{ producto_id: 'p1', cantidad: 3 }]);
      const [p1] = await leerSnapshot('productos', EMPRESA_A);
      expect(p1.stock_actual).toBe(7);
    });

    it('no toca stock de un producto de otra empresa (defensa multi-tenant en el cliente)', async () => {
      await guardarSnapshot('productos', EMPRESA_B, [{ id: 'p1', nombre: 'Agua', stock_actual: 10 }]);
      // p1 existe pero pertenece a EMPRESA_B — decrementarStockLocal(EMPRESA_A, ...) no debe tocarlo.
      await decrementarStockLocal(EMPRESA_A, [{ producto_id: 'p1', cantidad: 3 }]);
      const [p1] = await leerSnapshot('productos', EMPRESA_B);
      expect(p1.stock_actual).toBe(10);
    });

    it('ignora items de un producto que no está en el snapshot, sin explotar', async () => {
      await expect(decrementarStockLocal(EMPRESA_A, [{ producto_id: 'no-existe', cantidad: 1 }])).resolves.not.toThrow();
    });
  });

  describe('medioPagoDisponibleOffline', () => {
    const FORMAS_PAGO = [
      { nombre: 'Efectivo', tipo_instrumento: 'efectivo' },
      { nombre: 'Transferencia', tipo_instrumento: 'transferencia' },
      { nombre: 'Tarjeta Débito', tipo_instrumento: 'tarjeta_debito' },
      { nombre: 'Tarjeta Crédito', tipo_instrumento: 'tarjeta_credito' },
      { nombre: 'QR MercadoPago', tipo_instrumento: 'billetera' },
    ];

    it('Efectivo y Transferencia OK offline (por tipo_instrumento, no por nombre)', () => {
      expect(medioPagoDisponibleOffline('Efectivo', FORMAS_PAGO)).toBe(true);
      expect(medioPagoDisponibleOffline('Transferencia', FORMAS_PAGO)).toBe(true);
    });

    it('Tarjeta (débito/crédito) y QR MercadoPago bloqueados offline', () => {
      expect(medioPagoDisponibleOffline('Tarjeta Débito', FORMAS_PAGO)).toBe(false);
      expect(medioPagoDisponibleOffline('Tarjeta Crédito', FORMAS_PAGO)).toBe(false);
      expect(medioPagoDisponibleOffline('QR MercadoPago', FORMAS_PAGO)).toBe(false);
    });

    it('Cuenta Corriente siempre bloqueada offline, aunque no tenga fila en formas_pago', () => {
      expect(medioPagoDisponibleOffline('Cuenta Corriente', FORMAS_PAGO)).toBe(false);
    });

    it('respeta un nombre editado por la empresa: lo que importa es tipo_instrumento', () => {
      const formas = [{ nombre: 'Contado', tipo_instrumento: 'efectivo' }];
      expect(medioPagoDisponibleOffline('Contado', formas)).toBe(true);
    });

    it('sin maestro formas_pago (empresa nueva): fallback por nombre exacto', () => {
      expect(medioPagoDisponibleOffline('Efectivo', [])).toBe(true);
      expect(medioPagoDisponibleOffline('Tarjeta', [])).toBe(false);
    });

    it('un tipo_instrumento desconocido en la lista se bloquea por defecto', () => {
      expect(medioPagoDisponibleOffline('Cheque', [{ nombre: 'Cheque', tipo_instrumento: 'cheque' }])).toBe(false);
    });
  });

  describe('apertura de caja offline', () => {
    it('encolarAperturaCaja genera client_uuid y queda pendiente', async () => {
      const fila = await encolarAperturaCaja(EMPRESA_A, { p_monto_inicial: 5000 });
      expect(fila.estado).toBe('pendiente');
      expect(fila.client_uuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(await contarAperturasPendientes(EMPRESA_A)).toBe(1);
    });

    it('listarAperturasPendientes en orden cronológico, aislado por empresa', async () => {
      const a1 = await encolarAperturaCaja(EMPRESA_A, {});
      await offlineDb.cajaSesionesPendientes.update(a1.localId, { creado_en: '2026-08-05T09:00:00.000Z' });
      const a2 = await encolarAperturaCaja(EMPRESA_A, {});
      await offlineDb.cajaSesionesPendientes.update(a2.localId, { creado_en: '2026-08-05T09:00:05.000Z' });
      await encolarAperturaCaja(EMPRESA_B, {});

      const deA = await listarAperturasPendientes(EMPRESA_A);
      expect(deA.map(f => f.localId)).toEqual([a1.localId, a2.localId]);
    });

    it('marcarAperturaSincronizada/Conflicto actualizan estado y afectan el conteo', async () => {
      const fila = await encolarAperturaCaja(EMPRESA_A, {});
      await marcarAperturaSincronizada(fila.localId, { sesion_id: 's1' });
      expect(await contarAperturasPendientes(EMPRESA_A)).toBe(0);

      const otra = await encolarAperturaCaja(EMPRESA_A, {});
      await marcarAperturaConflicto(otra.localId, 'Ya había una caja abierta');
      expect(await contarAperturasPendientes(EMPRESA_A)).toBe(1);
    });
  });
});
