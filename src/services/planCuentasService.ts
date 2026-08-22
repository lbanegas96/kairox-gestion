import { supabase } from '@/lib/customSupabaseClient';
import type {
  PlanCuenta,
  AsientoContable,
  AsientoItem,
  PaginatedResult,
} from '@/types';

// ─── Plan de Cuentas ──────────────────────────────────────────────────────────

export const planCuentasService = {
  async getCuentas(empresaId: string): Promise<PlanCuenta[]> {
    const { data, error } = await supabase
      .from('plan_cuentas')
      .select('*')
      .eq('empresa_id', empresaId)
      .order('codigo', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PlanCuenta[];
  },

  async seedCuentas(empresaId: string): Promise<void> {
    const { error } = await supabase.rpc('seed_plan_cuentas', {
      p_empresa_id: empresaId,
    });
    if (error) throw new Error(error.message);
  },

  async createCuenta(
    empresaId: string,
    payload: Omit<PlanCuenta, 'id' | 'empresa_id' | 'saldo_actual' | 'created_at' | 'hijos'>
  ): Promise<PlanCuenta> {
    const { data, error } = await supabase
      .from('plan_cuentas')
      .insert([{ ...payload, empresa_id: empresaId }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as PlanCuenta;
  },

  async updateCuenta(
    id: string,
    payload: Partial<Pick<PlanCuenta, 'nombre' | 'activa' | 'permite_movimientos'>>
  ): Promise<PlanCuenta> {
    const { data, error } = await supabase
      .from('plan_cuentas')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as PlanCuenta;
  },

  /** Construye árbol jerárquico desde lista plana */
  buildTree(cuentas: PlanCuenta[]): PlanCuenta[] {
    const map: Record<string, PlanCuenta> = {};
    const roots: PlanCuenta[] = [];

    cuentas.forEach((c) => {
      map[c.id] = { ...c, hijos: [] };
    });

    cuentas.forEach((c) => {
      if (c.cuenta_padre_id && map[c.cuenta_padre_id]) {
        map[c.cuenta_padre_id].hijos!.push(map[c.id]);
      } else if (!c.cuenta_padre_id) {
        roots.push(map[c.id]);
      }
    });

    return roots;
  },
};

// ─── Asientos Contables ───────────────────────────────────────────────────────

export const asientosService = {
  async getAsientos(
    empresaId: string,
    { page = 1, pageSize = 30, estado, fechaDesde, fechaHasta }: {
      page?: number;
      pageSize?: number;
      estado?: string;
      fechaDesde?: string;
      fechaHasta?: string;
    } = {}
  ): Promise<PaginatedResult<AsientoContable>> {
    const from = (page - 1) * pageSize;
    let q = supabase
      .from('asientos_contables')
      .select('*, asientos_items(*, plan_cuentas(codigo, nombre, tipo)), centro_costo:centros_costo(nombre)', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .order('fecha', { ascending: false })
      .order('numero', { ascending: false })
      .range(from, from + pageSize - 1);

    if (estado) q = q.eq('estado', estado);
    if (fechaDesde) q = q.gte('fecha', fechaDesde);
    if (fechaHasta) q = q.lte('fecha', fechaHasta);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return {
      data: (data ?? []) as AsientoContable[],
      count: count ?? 0,
      pages: Math.ceil((count ?? 0) / pageSize),
    };
  },

  async getAsiento(id: string): Promise<AsientoContable> {
    const { data, error } = await supabase
      .from('asientos_contables')
      .select('*, asientos_items(*, plan_cuentas(codigo, nombre, tipo)), centro_costo:centros_costo(nombre)')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as AsientoContable;
  },

  /**
   * Busca el asiento generado para un documento por (origen, origen_id) —
   * para documentos que no guardan `asiento_id` directo en su propia tabla
   * (OC, Recepciones, ajustes de stock, etc.). Null si nunca se generó uno
   * (ej. período cerrado en el momento, o diferencia $0 que no amerita asiento).
   */
  async getAsientoPorOrigen(
    empresaId: string,
    origen: string,
    origenId: string
  ): Promise<AsientoContable | null> {
    const { data, error } = await supabase
      .from('asientos_contables')
      .select('*, asientos_items(*, plan_cuentas(codigo, nombre, tipo)), centro_costo:centros_costo(nombre)')
      .eq('empresa_id', empresaId)
      .eq('origen', origen)
      .eq('origen_id', origenId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as AsientoContable) ?? null;
  },

  // mig.314: asientos_contables/asientos_items son de escritura EXCLUSIVA vía RPC
  // (auditoría contable 2026-08-07, hallazgo crítico: RLS permitía INSERT/UPDATE/
  // DELETE directo sobre asientos ya confirmados, sin validar partida doble en
  // ningún lado). createAsientoManual queda en 'borrador' (se confirma después,
  // ModalNuevoAsiento + TabAsientos); createAsientoAutomatico valida cuadre y
  // período cerrado server-side y confirma en la misma transacción atómica —
  // reemplaza el patrón viejo de 2 llamadas separadas (create + confirm) que
  // podía dejar un borrador huérfano si la segunda fallaba.

  async createAsientoManual(
    empresaId: string,
    userId: string,
    payload: { fecha: string; descripcion?: string; centro_costo_id?: string | null },
    items: Omit<AsientoItem, 'id' | 'asiento_id' | 'empresa_id' | 'created_at'>[]
  ): Promise<{ id: string; numero: string; estado: string }> {
    const { data, error } = await supabase.rpc('crear_asiento_manual', {
      p_empresa_id: empresaId,
      p_user_id: userId,
      p_fecha: payload.fecha,
      p_descripcion: payload.descripcion ?? null,
      p_centro_costo_id: payload.centro_costo_id ?? null,
      p_items: items,
    });
    if (error) throw new Error(error.message);
    return data as { id: string; numero: string; estado: string };
  },

  async createAsientoAutomatico(
    empresaId: string,
    userId: string,
    payload: {
      fecha: string;
      descripcion?: string;
      origen?: string;
      origen_id?: string;
      centro_costo_id?: string | null;
    },
    items: Omit<AsientoItem, 'id' | 'asiento_id' | 'empresa_id' | 'created_at'>[]
  ): Promise<{ id: string; numero: string; estado: string }> {
    const { data, error } = await supabase.rpc('crear_asiento_automatico', {
      p_empresa_id: empresaId,
      p_user_id: userId,
      p_fecha: payload.fecha,
      p_descripcion: payload.descripcion ?? null,
      p_origen: payload.origen ?? null,
      p_origen_id: payload.origen_id ?? null,
      p_centro_costo_id: payload.centro_costo_id ?? null,
      p_items: items,
    });
    if (error) throw new Error(error.message);
    return data as { id: string; numero: string; estado: string };
  },

  async confirmarAsiento(id: string): Promise<void> {
    const { error } = await supabase.rpc('confirmar_asiento', { p_asiento_id: id });
    if (error) throw new Error(error.message);
  },

  async anularAsiento(id: string): Promise<void> {
    const { error } = await supabase.rpc('anular_asiento', { p_asiento_id: id });
    if (error) throw new Error(error.message);
  },

  /** Balance de comprobación: suma debe/haber por cuenta */
  async getBalanceComprobacion(empresaId: string, fechaDesde?: string, fechaHasta?: string, centroCostoId?: string) {
    let q = supabase
      .from('asientos_items')
      .select('cuenta_id, debe, haber, plan_cuentas(codigo, nombre, tipo), asientos_contables!inner(estado, fecha, empresa_id, centro_costo_id)')
      .eq('empresa_id', empresaId)
      .eq('asientos_contables.estado', 'confirmado')
      .eq('asientos_contables.empresa_id', empresaId);

    if (fechaDesde) q = q.gte('asientos_contables.fecha', fechaDesde);
    if (fechaHasta) q = q.lte('asientos_contables.fecha', fechaHasta);
    if (centroCostoId) q = q.eq('asientos_contables.centro_costo_id', centroCostoId);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    // Agrupar por cuenta
    const map: Record<string, {
      cuenta_id: string;
      codigo: string;
      nombre: string;
      tipo: string;
      total_debe: number;
      total_haber: number;
    }> = {};

    (data ?? []).forEach((row: any) => {
      const id = row.cuenta_id;
      if (!map[id]) {
        map[id] = {
          cuenta_id: id,
          codigo: row.plan_cuentas?.codigo ?? '',
          nombre: row.plan_cuentas?.nombre ?? '',
          tipo: row.plan_cuentas?.tipo ?? '',
          total_debe: 0,
          total_haber: 0,
        };
      }
      map[id].total_debe  += Number(row.debe);
      map[id].total_haber += Number(row.haber);
    });

    return Object.values(map).sort((a, b) => a.codigo.localeCompare(b.codigo));
  },

  /** Libro Mayor: todos los movimientos confirmados de una cuenta con saldo acumulado */
  async getLibroMayor(
    empresaId: string,
    cuentaId: string,
    fechaDesde?: string,
    fechaHasta?: string
  ): Promise<any[]> {
    let q = supabase
      .from('asientos_items')
      .select('*, asientos_contables!inner(numero, fecha, descripcion, origen, estado, empresa_id)')
      .eq('cuenta_id', cuentaId)
      .eq('asientos_contables.empresa_id', empresaId)
      .eq('asientos_contables.estado', 'confirmado')
      .order('asientos_contables(fecha)', { ascending: true });

    if (fechaDesde) q = (q as any).gte('asientos_contables.fecha', fechaDesde);
    if (fechaHasta) q = (q as any).lte('asientos_contables.fecha', fechaHasta);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    let saldo = 0;
    return (data ?? []).map((row: any) => {
      saldo += Number(row.debe) - Number(row.haber);
      return { ...row, saldo_acumulado: saldo };
    });
  },
};

// ─── Query keys ───────────────────────────────────────────────────────────────

export const PLAN_CUENTAS_KEYS = {
  cuentas: (empresaId: string) => ['plan_cuentas', empresaId] as const,
  asientos: (empresaId: string, filters?: object) => ['asientos', empresaId, filters] as const,
  balance: (empresaId: string, desde?: string, hasta?: string) =>
    ['balance_comprobacion', empresaId, desde, hasta] as const,
  libroMayor: (empresaId: string, cuentaId: string, desde?: string, hasta?: string) =>
    ['libro_mayor', empresaId, cuentaId, desde, hasta] as const,
  estadoResultados: (empresaId: string, desde?: string, hasta?: string, centroCostoId?: string) =>
    ['estado_resultados', empresaId, desde, hasta, centroCostoId] as const,
  balanceGeneral: (empresaId: string, fechaCorte?: string) =>
    ['balance_general', empresaId, fechaCorte] as const,
  asiento: (id: string) => ['asiento', id] as const,
  asientoPorOrigen: (origen: string, origenId: string) => ['asiento_por_origen', origen, origenId] as const,
};

// ─── Asientos automáticos ────────────────────────────────────────────────────
// Helper interno: busca cuenta por código, retorna null si no existe

async function findCuentaByCodigo(empresaId: string, codigo: string): Promise<string | null> {
  const { data } = await supabase
    .from('plan_cuentas')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('codigo', codigo)
    .maybeSingle();
  return (data as any)?.id ?? null;
}

export const asientosAutoService = {
  /**
   * Crea y confirma el asiento de una venta al contado.
   *   DEBE  1.1.1 Caja y Bancos  (o 1.1.2 Cuentas a Cobrar si es crédito)  total
   *   HABER 4.1   Ventas de Productos                                      neto
   *   HABER 2.1.3 IVA Débito Fiscal                                        iva
   * Si `neto`/`iva` no vienen (o no existe la cuenta 2.1.3), cae al asiento
   * viejo de 2 líneas con el total entero a Ventas — nunca bloquea la venta
   * por esto. Si la empresa no tiene plan de cuentas, sale silenciosamente.
   *
   * mig.286: si `montoPendienteLiquidacion` viene (venta pagada con tarjeta,
   * `crear_venta` ya resolvió cuánto tiene `dias_acreditacion > 0`) y existe la
   * cuenta puente 1.1.8, la línea de cobro se parte en dos: la porción
   * inmediata sigue yendo a 1.1.1/1.1.2 como siempre, la porción pendiente va a
   * 1.1.8 — mismo criterio que ya usa `registrar_cobro_cliente` (mig.216). Si
   * no existe 1.1.8, cae al comportamiento de siempre (todo a Caja) — no
   * bloquea la venta por faltar esa cuenta.
   */
  async crearAsientoVenta(
    empresaId: string,
    userId: string,
    params: {
      ventaId: string;
      total: number;
      neto?: number;
      iva?: number;
      fecha: string;       // YYYY-MM-DD
      descripcion: string;
      esCredito?: boolean;
      centroCostoId?: string | null;
      montoPendienteLiquidacion?: number;
      costoMercaderiaVendida?: number;
    }
  ): Promise<void> {
    // Non-critical period check — RPC errors never block the sale
    try {
      const { data: cerrado, error: rpcErr } = await supabase.rpc('fecha_en_periodo_cerrado', {
        p_empresa_id: empresaId,
        p_fecha: params.fecha,
      });
      if (rpcErr) {
        console.warn('[asientosAutoService] período check failed:', rpcErr.message);
      } else if (cerrado) {
        throw new Error(`Período cerrado: la fecha ${params.fecha} pertenece a un período contable cerrado.`);
      }
    } catch (e: any) {
      if (e.message?.startsWith('Período cerrado:')) throw e;
      console.warn('[asientosAutoService] período check error:', e);
    }

    const codigoCobro = params.esCredito ? '1.1.2' : '1.1.1';
    // mig.286: solo tiene sentido partir a la cuenta puente en ventas al contado
    // (una venta a Cuenta Corriente no tiene "cobro" propiamente dicho todavía).
    const montoPendiente = !params.esCredito
      ? Math.min(Math.max(Number(params.montoPendienteLiquidacion) || 0, 0), params.total)
      : 0;
    const costoMercaderia = Math.max(Number(params.costoMercaderiaVendida) || 0, 0);
    const [cuentaCobro, cuentaVentas, cuentaIvaDebito, cuentaPuenteTarjetas, cuentaCostoMercaderia, cuentaInventario] = await Promise.all([
      findCuentaByCodigo(empresaId, codigoCobro),
      findCuentaByCodigo(empresaId, '4.1'),
      findCuentaByCodigo(empresaId, '2.1.3'),
      montoPendiente > 0 ? findCuentaByCodigo(empresaId, '1.1.8') : Promise.resolve(null),
      costoMercaderia > 0 ? findCuentaByCodigo(empresaId, '5.1') : Promise.resolve(null),
      costoMercaderia > 0 ? findCuentaByCodigo(empresaId, '1.1.3') : Promise.resolve(null),
    ]);
    if (!cuentaCobro || !cuentaVentas) return; // empresa sin plan de cuentas

    const iva = Number(params.iva) || 0;
    const neto = params.neto != null ? Number(params.neto) : params.total;
    const discriminar = cuentaIvaDebito && iva > 0 && neto + iva > 0;

    const usaPuente = montoPendiente > 0 && !!cuentaPuenteTarjetas;
    const montoInmediato = params.total - (usaPuente ? montoPendiente : 0);
    const lineasCobro = usaPuente
      ? [
          ...(montoInmediato > 0 ? [{ cuenta_id: cuentaCobro, debe: montoInmediato, haber: 0, descripcion: 'Cobro por venta' }] : []),
          { cuenta_id: cuentaPuenteTarjetas!, debe: montoPendiente, haber: 0, descripcion: 'Cobro por venta (pendiente de acreditar)' },
        ]
      : [{ cuenta_id: cuentaCobro, debe: params.total, haber: 0, descripcion: 'Cobro por venta' }];

    const items = discriminar
      ? [
          ...lineasCobro,
          { cuenta_id: cuentaVentas,     debe: 0, haber: neto, descripcion: 'Ingreso por venta (neto)' },
          { cuenta_id: cuentaIvaDebito!, debe: 0, haber: iva,  descripcion: 'IVA Débito Fiscal' },
        ]
      : [
          ...lineasCobro,
          { cuenta_id: cuentaVentas, debe: 0, haber: params.total, descripcion: 'Ingreso por venta' },
        ];

    // Costo de Mercadería Vendida: sin esto, el Estado de Resultados nunca
    // refleja el costo de lo vendido y el Inventario nunca se consume
    // contablemente aunque el stock físico sí baje (hallazgo de auditoría
    // 2026-08). Se agrega como líneas adicionales balanceadas entre sí — no
    // afecta el resto del asiento si falta alguna cuenta o el costo es 0.
    if (costoMercaderia > 0 && cuentaCostoMercaderia && cuentaInventario) {
      items.push(
        { cuenta_id: cuentaCostoMercaderia, debe: costoMercaderia, haber: 0, descripcion: 'Costo de mercadería vendida' },
        { cuenta_id: cuentaInventario,      debe: 0, haber: costoMercaderia, descripcion: 'Salida de mercadería por venta' },
      );
    }

    const asiento = await asientosService.createAsientoAutomatico(
      empresaId, userId,
      {
        fecha: params.fecha, descripcion: params.descripcion, origen: 'venta', origen_id: params.ventaId,
        centro_costo_id: params.centroCostoId ?? null,
      },
      items
    );
    // mig.281: guarda el vínculo para poder detectar "sin asiento" y ofrecer
    // regenerar_asiento_venta si esta llamada nunca llega (venta ya confirmada).
    await supabase.from('comprobantes').update({ asiento_id: asiento.id }).eq('id', params.ventaId);
  },

  /**
   * Reversa el asiento de una Factura cancelada (RPC cancelar_factura,
   * mig.259) — documento de reversa estilo SAP: el asiento original de la
   * venta queda 'confirmado' tal cual quedó posteado (nunca se borra ni se
   * reescribe), se crea uno NUEVO con debe/haber invertidos que lo
   * neutraliza en el balance. Si la factura nunca tuvo asiento (empresa sin
   * plan de cuentas, o el asiento original no se pudo generar), no hace nada
   * — mismo criterio permisivo que el resto de este servicio.
   */
  async crearAsientoReversaVenta(
    empresaId: string,
    userId: string,
    params: { ventaId: string; numeroVenta: string; fecha: string }
  ): Promise<void> {
    const { data: original, error } = await supabase
      .from('asientos_contables')
      .select('id, asientos_items(cuenta_id, debe, haber, descripcion)')
      .eq('empresa_id', empresaId)
      .eq('origen', 'venta')
      .eq('origen_id', params.ventaId)
      .eq('estado', 'confirmado')
      .maybeSingle();
    if (error || !original || !(original as any).asientos_items?.length) return;

    const items = ((original as any).asientos_items as any[]).map((i) => ({
      cuenta_id: i.cuenta_id,
      debe: Number(i.haber),
      haber: Number(i.debe),
      descripcion: `Reversa — ${i.descripcion || ''}`,
    }));

    await asientosService.createAsientoAutomatico(
      empresaId, userId,
      {
        fecha: params.fecha,
        descripcion: `Reversa — Cancelación Factura ${params.numeroVenta}`,
        origen: 'cancelacion_venta',
        origen_id: params.ventaId,
      },
      items
    );
  },

  /**
   * Crea y confirma el asiento de una compra.
   *   DEBE  1.1.3 Mercaderías / Inventario                                 neto
   *   DEBE  1.1.4 IVA Crédito Fiscal                                       iva
   *   HABER 1.1.1 Caja y Bancos  (o 2.1.1 Cuentas a Pagar si es crédito)   total
   * Mismo criterio permisivo que crearAsientoVenta: si `neto`/`iva` no
   * vienen o no existe la cuenta 1.1.4, cae al asiento viejo de 2 líneas.
   */
  async crearAsientoCompra(
    empresaId: string,
    userId: string,
    params: {
      compraId: string;
      total: number;
      neto?: number;
      iva?: number;
      fecha: string;       // YYYY-MM-DD
      descripcion: string;
      esCredito?: boolean;
      centroCostoId?: string | null;
    }
  ): Promise<void> {
    // Non-critical period check — RPC errors never block the purchase
    try {
      const { data: cerrado, error: rpcErr } = await supabase.rpc('fecha_en_periodo_cerrado', {
        p_empresa_id: empresaId,
        p_fecha: params.fecha,
      });
      if (rpcErr) {
        console.warn('[asientosAutoService] período check failed:', rpcErr.message);
      } else if (cerrado) {
        throw new Error(`Período cerrado: la fecha ${params.fecha} pertenece a un período contable cerrado.`);
      }
    } catch (e: any) {
      if (e.message?.startsWith('Período cerrado:')) throw e;
      console.warn('[asientosAutoService] período check error:', e);
    }

    const codigoPago = params.esCredito ? '2.1.1' : '1.1.1';
    const [cuentaInventario, cuentaPago, cuentaIvaCredito] = await Promise.all([
      findCuentaByCodigo(empresaId, '1.1.3'),
      findCuentaByCodigo(empresaId, codigoPago),
      findCuentaByCodigo(empresaId, '1.1.4'),
    ]);
    if (!cuentaInventario || !cuentaPago) return;

    const iva = Number(params.iva) || 0;
    const neto = params.neto != null ? Number(params.neto) : params.total;
    const discriminar = cuentaIvaCredito && iva > 0 && neto + iva > 0;

    const items = discriminar
      ? [
          { cuenta_id: cuentaInventario,  debe: neto,          haber: 0,            descripcion: 'Compra de mercadería (neto)' },
          { cuenta_id: cuentaIvaCredito!, debe: iva,           haber: 0,            descripcion: 'IVA Crédito Fiscal' },
          { cuenta_id: cuentaPago,        debe: 0,             haber: params.total, descripcion: 'Pago por compra' },
        ]
      : [
          { cuenta_id: cuentaInventario, debe: params.total, haber: 0,            descripcion: 'Compra de mercadería' },
          { cuenta_id: cuentaPago,       debe: 0,            haber: params.total, descripcion: 'Pago por compra' },
        ];

    const asiento = await asientosService.createAsientoAutomatico(
      empresaId, userId,
      {
        fecha: params.fecha, descripcion: params.descripcion, origen: 'compra', origen_id: params.compraId,
        centro_costo_id: params.centroCostoId ?? null,
      },
      items
    );
    // mig.281: mismo vínculo que crearAsientoVenta, para regenerar_asiento_compra.
    await supabase.from('compras').update({ asiento_id: asiento.id }).eq('id', params.compraId);
  },

  /**
   * Crea y confirma el asiento de una Nota de Crédito o Débito de CLIENTE.
   * Ambas SIEMPRE mueven Cuenta Corriente (nunca Caja — `crear_nota_credito`/
   * `crear_nota_debito_cliente` solo tocan `cuenta_corriente_movimientos`),
   * así que la contrapartida es siempre 1.1.2 Cuentas a Cobrar.
   *   NC (reversa de venta):  DEBE 4.1 Ventas (neto) + DEBE 2.1.3 IVA Débito Fiscal (iva)  / HABER 1.1.2 CxC (total)
   *   ND (cargo adicional):   DEBE 1.1.2 CxC (total)                                        / HABER 4.1 Ventas (neto) + HABER 2.1.3 IVA Débito Fiscal (iva)
   * Si no hay `neto`/`iva` o falta alguna cuenta, sale silenciosamente —
   * mismo criterio permisivo que el resto de este servicio.
   */
  async crearAsientoNotaCliente(
    empresaId: string,
    userId: string,
    params: {
      comprobanteId: string;
      tipo: 'nota_credito' | 'nota_debito';
      total: number;
      neto: number;
      iva: number;
      fecha: string;       // YYYY-MM-DD
      descripcion: string;
      centroCostoId?: string | null;
      costoMercaderiaRevertida?: number;
    }
  ): Promise<void> {
    try {
      const { data: cerrado } = await supabase.rpc('fecha_en_periodo_cerrado', {
        p_empresa_id: empresaId, p_fecha: params.fecha,
      });
      if (cerrado) throw new Error(`Período cerrado: la fecha ${params.fecha} pertenece a un período contable cerrado.`);
    } catch (e: any) {
      if (e.message?.startsWith('Período cerrado:')) throw e;
    }

    const [cuentaCxC, cuentaVentas, cuentaIvaDebito] = await Promise.all([
      findCuentaByCodigo(empresaId, '1.1.2'),
      findCuentaByCodigo(empresaId, '4.1'),
      findCuentaByCodigo(empresaId, '2.1.3'),
    ]);
    if (!cuentaCxC || !cuentaVentas || !cuentaIvaDebito || !(params.neto + params.iva > 0)) return;

    const items = params.tipo === 'nota_credito'
      ? [
          { cuenta_id: cuentaVentas,    debe: params.neto, haber: 0,           descripcion: 'Reversa de venta (neto)' },
          { cuenta_id: cuentaIvaDebito, debe: params.iva,  haber: 0,           descripcion: 'Reversa IVA Débito Fiscal' },
          { cuenta_id: cuentaCxC,       debe: 0,           haber: params.total, descripcion: 'Nota de Crédito a cliente' },
        ]
      : [
          { cuenta_id: cuentaCxC,       debe: params.total, haber: 0,          descripcion: 'Nota de Débito a cliente' },
          { cuenta_id: cuentaVentas,    debe: 0,             haber: params.neto, descripcion: 'Cargo adicional (neto)' },
          { cuenta_id: cuentaIvaDebito, debe: 0,             haber: params.iva,  descripcion: 'IVA Débito Fiscal' },
        ];

    // NC que compensa una devolución con reingreso de stock: revierte también
    // el Costo de Mercadería que se cargó en la venta original (mig.288) — sin
    // esto, el stock vuelve pero el costo queda cargado para siempre.
    const costoRevertido = Math.max(Number(params.costoMercaderiaRevertida) || 0, 0);
    if (params.tipo === 'nota_credito' && costoRevertido > 0) {
      const [cuentaInventario, cuentaCostoMercaderia] = await Promise.all([
        findCuentaByCodigo(empresaId, '1.1.3'),
        findCuentaByCodigo(empresaId, '5.1'),
      ]);
      if (cuentaInventario && cuentaCostoMercaderia) {
        items.push(
          { cuenta_id: cuentaInventario,      debe: costoRevertido, haber: 0, descripcion: 'Reingreso de mercadería por NC' },
          { cuenta_id: cuentaCostoMercaderia, debe: 0, haber: costoRevertido, descripcion: 'Reversa de costo de mercadería vendida' },
        );
      }
    }

    await asientosService.createAsientoAutomatico(
      empresaId, userId,
      { fecha: params.fecha, descripcion: params.descripcion, origen: params.tipo, origen_id: params.comprobanteId, centro_costo_id: params.centroCostoId ?? null },
      items
    );
  },

  /**
   * Crea y confirma el asiento de un ajuste manual de stock (rotura, faltante,
   * corrección de inventario físico — ProductosSection.jsx → ajustar_stock_manual,
   * mig.289). Decisión de negocio: siempre generar asiento, sin distinguir motivo.
   *   Faltante (stock baja): DEBE 5.8 Otros Gastos / HABER 1.1.3 Mercaderías-Inventario
   *   Sobrante (stock sube): DEBE 1.1.3 Mercaderías-Inventario / HABER 4.3 Otros Ingresos
   */
  async crearAsientoAjusteStock(
    empresaId: string,
    userId: string,
    params: {
      productoId: string;
      delta: number;       // negativo = faltante, positivo = sobrante
      costoUnitario: number;
      fecha: string;        // YYYY-MM-DD
      descripcion: string;
    }
  ): Promise<void> {
    const monto = Math.abs(Number(params.delta) || 0) * (Number(params.costoUnitario) || 0);
    if (monto <= 0) return;

    try {
      const { data: cerrado } = await supabase.rpc('fecha_en_periodo_cerrado', {
        p_empresa_id: empresaId, p_fecha: params.fecha,
      });
      if (cerrado) throw new Error(`Período cerrado: la fecha ${params.fecha} pertenece a un período contable cerrado.`);
    } catch (e: any) {
      if (e.message?.startsWith('Período cerrado:')) throw e;
    }

    const [cuentaInventario, cuentaGastos, cuentaIngresos] = await Promise.all([
      findCuentaByCodigo(empresaId, '1.1.3'),
      findCuentaByCodigo(empresaId, '5.8'),
      findCuentaByCodigo(empresaId, '4.3'),
    ]);
    if (!cuentaInventario) return;

    const items = params.delta < 0
      ? (cuentaGastos ? [
          { cuenta_id: cuentaGastos,     debe: monto, haber: 0,    descripcion: 'Faltante de inventario (ajuste manual)' },
          { cuenta_id: cuentaInventario, debe: 0,     haber: monto, descripcion: 'Salida de mercadería por ajuste manual' },
        ] : null)
      : (cuentaIngresos ? [
          { cuenta_id: cuentaInventario, debe: monto, haber: 0,    descripcion: 'Ingreso de mercadería por ajuste manual' },
          { cuenta_id: cuentaIngresos,   debe: 0,     haber: monto, descripcion: 'Sobrante de inventario (ajuste manual)' },
        ] : null);
    if (!items) return;

    await asientosService.createAsientoAutomatico(
      empresaId, userId,
      { fecha: params.fecha, descripcion: params.descripcion, origen: 'ajuste_stock', origen_id: params.productoId },
      items
    );
  },

  /**
   * Crea y confirma el asiento único de un Recuento de Inventario (mig.335,
   * confirmar_recuento_inventario) — reemplaza N asientos por producto por UNO
   * solo para todo el recuento, con cuentas dedicadas (no 5.8/4.3 genéricas):
   *   Faltante: DEBE 5.10 Diferencias de Inventario (Faltantes) / HABER 1.1.3 Mercaderías-Inventario
   *   Sobrante: DEBE 1.1.3 Mercaderías-Inventario / HABER 4.5 Diferencias de Inventario (Sobrantes)
   * Ambas líneas pueden coexistir en el mismo asiento si el recuento tuvo faltantes Y sobrantes.
   */
  async crearAsientoRecuentoInventario(
    empresaId: string,
    userId: string,
    params: { recuentoId: string; numero: string; totalFaltante: number; totalSobrante: number; fecha: string }
  ): Promise<void> {
    if (params.totalFaltante <= 0 && params.totalSobrante <= 0) return;

    const { data: cerrado } = await supabase.rpc('fecha_en_periodo_cerrado', {
      p_empresa_id: empresaId, p_fecha: params.fecha,
    });
    if (cerrado) throw new Error(`Período cerrado: la fecha ${params.fecha} pertenece a un período contable cerrado.`);

    const [cuentaInventario, cuentaFaltantes, cuentaSobrantes] = await Promise.all([
      findCuentaByCodigo(empresaId, '1.1.3'),
      findCuentaByCodigo(empresaId, '5.10'),
      findCuentaByCodigo(empresaId, '4.5'),
    ]);
    if (!cuentaInventario) return;

    const items: Omit<AsientoItem, 'id' | 'asiento_id' | 'empresa_id' | 'created_at'>[] = [];
    if (params.totalFaltante > 0 && cuentaFaltantes) {
      items.push(
        { cuenta_id: cuentaFaltantes,  debe: params.totalFaltante, haber: 0, descripcion: `Faltante de inventario (${params.numero})` },
        { cuenta_id: cuentaInventario, debe: 0, haber: params.totalFaltante, descripcion: `Salida de mercadería por recuento (${params.numero})` },
      );
    }
    if (params.totalSobrante > 0 && cuentaSobrantes) {
      items.push(
        { cuenta_id: cuentaInventario, debe: params.totalSobrante, haber: 0, descripcion: `Ingreso de mercadería por recuento (${params.numero})` },
        { cuenta_id: cuentaSobrantes,  debe: 0, haber: params.totalSobrante, descripcion: `Sobrante de inventario (${params.numero})` },
      );
    }
    if (!items.length) return;

    const asiento = await asientosService.createAsientoAutomatico(
      empresaId, userId,
      { fecha: params.fecha, descripcion: `Recuento de Inventario ${params.numero}`, origen: 'recuento_inventario', origen_id: params.recuentoId },
      items
    );
    await supabase.rpc('set_asiento_recuento_inventario', { p_recuento_id: params.recuentoId, p_asiento_id: asiento.id });
  },

  /**
   * Crea y confirma el asiento único de una Revalorización de Inventario
   * (mig.336, confirmar_revalorizacion_inventario) — corrige el VALOR del
   * inventario (costo unitario), no la cantidad:
   *   Pérdida:  DEBE 5.11 Revalorización de Inventario (Pérdida) / HABER 1.1.3 Mercaderías-Inventario
   *   Ganancia: DEBE 1.1.3 Mercaderías-Inventario / HABER 4.6 Revalorización de Inventario (Ganancia)
   */
  async crearAsientoRevalorizacionInventario(
    empresaId: string,
    userId: string,
    params: { revalorizacionId: string; numero: string; totalPerdida: number; totalGanancia: number; fecha: string }
  ): Promise<void> {
    if (params.totalPerdida <= 0 && params.totalGanancia <= 0) return;

    const { data: cerrado } = await supabase.rpc('fecha_en_periodo_cerrado', {
      p_empresa_id: empresaId, p_fecha: params.fecha,
    });
    if (cerrado) throw new Error(`Período cerrado: la fecha ${params.fecha} pertenece a un período contable cerrado.`);

    const [cuentaInventario, cuentaPerdida, cuentaGanancia] = await Promise.all([
      findCuentaByCodigo(empresaId, '1.1.3'),
      findCuentaByCodigo(empresaId, '5.11'),
      findCuentaByCodigo(empresaId, '4.6'),
    ]);
    if (!cuentaInventario) return;

    const items: Omit<AsientoItem, 'id' | 'asiento_id' | 'empresa_id' | 'created_at'>[] = [];
    if (params.totalPerdida > 0 && cuentaPerdida) {
      items.push(
        { cuenta_id: cuentaPerdida,    debe: params.totalPerdida, haber: 0, descripcion: `Pérdida por revalorización de inventario (${params.numero})` },
        { cuenta_id: cuentaInventario, debe: 0, haber: params.totalPerdida, descripcion: `Baja de valor de mercadería (${params.numero})` },
      );
    }
    if (params.totalGanancia > 0 && cuentaGanancia) {
      items.push(
        { cuenta_id: cuentaInventario, debe: params.totalGanancia, haber: 0, descripcion: `Alza de valor de mercadería (${params.numero})` },
        { cuenta_id: cuentaGanancia,   debe: 0, haber: params.totalGanancia, descripcion: `Ganancia por revalorización de inventario (${params.numero})` },
      );
    }
    if (!items.length) return;

    const asiento = await asientosService.createAsientoAutomatico(
      empresaId, userId,
      { fecha: params.fecha, descripcion: `Revalorización de Inventario ${params.numero}`, origen: 'revalorizacion_inventario', origen_id: params.revalorizacionId },
      items
    );
    await supabase.rpc('set_asiento_revalorizacion_inventario', { p_revalorizacion_id: params.revalorizacionId, p_asiento_id: asiento.id });
  },

  /**
   * Crea y confirma el asiento de una Nota de Crédito o Débito de PROVEEDOR.
   * Ambas SIEMPRE mueven `cuenta_corriente_proveedores` (el reembolso en
   * efectivo de una NC es un movimiento de Caja aparte, con su propio
   * asiento) — la contrapartida es siempre 2.1.1 Cuentas a Pagar.
   *   NC (reversa de compra): DEBE 2.1.1 CxP (total)                                          / HABER 1.1.3 Mercaderías (neto) + HABER 1.1.4 IVA Crédito Fiscal (iva)
   *   ND (cargo adicional):   DEBE 1.1.3 Mercaderías (neto) + DEBE 1.1.4 IVA Crédito Fiscal (iva) / HABER 2.1.1 CxP (total)
   */
  async crearAsientoNotaProveedor(
    empresaId: string,
    userId: string,
    params: {
      documentoId: string;
      tipo: 'nota_credito' | 'nota_debito';
      total: number;
      neto: number;
      iva: number;
      fecha: string;       // YYYY-MM-DD
      descripcion: string;
      centroCostoId?: string | null;
    }
  ): Promise<void> {
    try {
      const { data: cerrado } = await supabase.rpc('fecha_en_periodo_cerrado', {
        p_empresa_id: empresaId, p_fecha: params.fecha,
      });
      if (cerrado) throw new Error(`Período cerrado: la fecha ${params.fecha} pertenece a un período contable cerrado.`);
    } catch (e: any) {
      if (e.message?.startsWith('Período cerrado:')) throw e;
    }

    const [cuentaCxP, cuentaMercaderias, cuentaIvaCredito] = await Promise.all([
      findCuentaByCodigo(empresaId, '2.1.1'),
      findCuentaByCodigo(empresaId, '1.1.3'),
      findCuentaByCodigo(empresaId, '1.1.4'),
    ]);
    if (!cuentaCxP || !cuentaMercaderias || !cuentaIvaCredito || !(params.neto + params.iva > 0)) return;

    const items = params.tipo === 'nota_credito'
      ? [
          { cuenta_id: cuentaCxP,         debe: params.total, haber: 0,           descripcion: 'Nota de Crédito de proveedor' },
          { cuenta_id: cuentaMercaderias, debe: 0,             haber: params.neto, descripcion: 'Reversa de compra (neto)' },
          { cuenta_id: cuentaIvaCredito,  debe: 0,             haber: params.iva,  descripcion: 'Reversa IVA Crédito Fiscal' },
        ]
      : [
          { cuenta_id: cuentaMercaderias, debe: params.neto, haber: 0,            descripcion: 'Cargo adicional (neto)' },
          { cuenta_id: cuentaIvaCredito,  debe: params.iva,  haber: 0,            descripcion: 'IVA Crédito Fiscal' },
          { cuenta_id: cuentaCxP,         debe: 0,           haber: params.total, descripcion: 'Nota de Débito de proveedor' },
        ];

    await asientosService.createAsientoAutomatico(
      empresaId, userId,
      { fecha: params.fecha, descripcion: params.descripcion, origen: params.tipo + '_proveedor', origen_id: params.documentoId, centro_costo_id: params.centroCostoId ?? null },
      items
    );
  },

  /**
   * Crea y confirma el asiento de un movimiento de caja MANUAL
   * (ingresos/egresos cargados a mano desde CajaSection).
   *
   * No se invoca para movimientos automáticos (Venta/Compra) — esos ya tienen
   * sus propios asientos en `crearAsientoVenta`/`crearAsientoCompra`.
   *
   * Egreso → DEBE cuenta de gasto (según categoría), HABER 1.1.1 Caja y Bancos.
   * Ingreso → DEBE 1.1.1 Caja y Bancos, HABER cuenta de ingreso (4.3 Otros Ingresos).
   * Si la empresa no tiene plan de cuentas, sale silenciosamente (mismo patrón
   * que crearAsientoVenta).
   */
  async crearAsientoMovimientoCaja(
    empresaId: string,
    userId: string,
    params: {
      movimientoId: string;
      tipo: 'ingreso' | 'egreso';
      categoria: string;
      monto: number;
      fecha: string;       // YYYY-MM-DD
      descripcion: string;
    }
  ): Promise<void> {
    // Map categoría → código de cuenta (contrapartida de Caja y Bancos)
    // Egresos: cada categoría va a su cuenta de gasto correspondiente.
    // Ingresos manuales: todos a 4.3 Otros Ingresos (la venta operativa va por
    // crearAsientoVenta — acá solo caen cobros sueltos, aportes, etc.).
    const MAPA_EGRESO: Record<string, string> = {
      'Sueldos':       '5.2', // Gastos de Personal
      'Servicios':     '5.4', // Gastos de Administración
      'Alquiler':      '5.4',
      'Mantenimiento': '5.4',
      'Impuestos':     '5.6', // Impuestos y Tasas
      'Otro Egreso':   '5.8', // Otros Gastos
    };
    const MAPA_INGRESO: Record<string, string> = {
      'Cobro':        '4.3', // Otros Ingresos
      'Inversión':    '4.3',
      'Otro Ingreso': '4.3',
    };

    const codigoContrapartida = params.tipo === 'egreso'
      ? (MAPA_EGRESO[params.categoria] ?? '5.8')
      : (MAPA_INGRESO[params.categoria] ?? '4.3');

    // Non-critical period check — RPC errors never block the cash movement
    try {
      const { data: cerrado, error: rpcErr } = await supabase.rpc('fecha_en_periodo_cerrado', {
        p_empresa_id: empresaId,
        p_fecha: params.fecha,
      });
      if (rpcErr) {
        console.warn('[asientosAutoService] período check failed:', rpcErr.message);
      } else if (cerrado) {
        throw new Error(`Período cerrado: la fecha ${params.fecha} pertenece a un período contable cerrado.`);
      }
    } catch (e: any) {
      if (e.message?.startsWith('Período cerrado:')) throw e;
      console.warn('[asientosAutoService] período check error:', e);
    }

    const [cuentaCaja, cuentaContra] = await Promise.all([
      findCuentaByCodigo(empresaId, '1.1.1'),
      findCuentaByCodigo(empresaId, codigoContrapartida),
    ]);
    if (!cuentaCaja || !cuentaContra) return; // empresa sin plan de cuentas

    const items = params.tipo === 'egreso'
      ? [
          { cuenta_id: cuentaContra, debe: params.monto, haber: 0,           descripcion: params.categoria },
          { cuenta_id: cuentaCaja,   debe: 0,            haber: params.monto, descripcion: 'Salida de caja' },
        ]
      : [
          { cuenta_id: cuentaCaja,   debe: params.monto, haber: 0,           descripcion: 'Entrada a caja' },
          { cuenta_id: cuentaContra, debe: 0,            haber: params.monto, descripcion: params.categoria },
        ];

    await asientosService.createAsientoAutomatico(
      empresaId, userId,
      {
        fecha: params.fecha,
        descripcion: params.descripcion,
        origen: 'movimiento_caja',
        origen_id: params.movimientoId,
      },
      items
    );
  },
};
