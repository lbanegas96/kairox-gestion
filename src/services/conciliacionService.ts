import { supabase } from '@/lib/customSupabaseClient';

export const CONC_KEYS = {
  extractos:  (cuentaId: string) => ['extractos', cuentaId] as const,
  lineas:     (extractoId: string) => ['extracto_lineas', extractoId] as const,
  movimientos:(cuentaId: string)  => ['movimientos_sin_conciliar', cuentaId] as const,
};

export interface ExtractoBancario {
  id: string;
  cuenta_bancaria_id: string;
  nombre_archivo: string;
  fecha_desde: string;
  fecha_hasta: string;
  total_debitos: number;
  total_creditos: number;
  movimientos_count: number;
  created_at: string;
}

export interface ExtractoLinea {
  id: string;
  extracto_id: string;
  cuenta_bancaria_id: string;
  fecha: string;
  descripcion: string;
  monto: number;
  tipo: 'ingreso' | 'egreso';
  movimiento_id: string | null;
  conciliado: boolean;
}

// ─── Parsear CSV de extracto bancario ─────────────────────────────────────────
// Formato esperado: fecha,descripcion,debito,credito  (o monto con signo)
export function parsearCSV(texto: string): { fecha: string; descripcion: string; monto: number; tipo: 'ingreso' | 'egreso' }[] {
  const lineas = texto.trim().split('\n').filter(l => l.trim());
  const resultados = [];

  for (let i = 1; i < lineas.length; i++) {      // saltar header
    const cols = lineas[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) continue;

    let fecha = '';
    let descripcion = '';
    let monto = 0;
    let tipo: 'ingreso' | 'egreso' = 'egreso';

    if (cols.length >= 4) {
      // formato: fecha, descripcion, debito, credito
      fecha = normalizarFecha(cols[0]);
      descripcion = cols[1];
      const debito  = parseFloat(cols[2].replace(/[^0-9.,\-]/g, '').replace(',', '.')) || 0;
      const credito = parseFloat(cols[3].replace(/[^0-9.,\-]/g, '').replace(',', '.')) || 0;
      if (credito > 0) { monto = credito; tipo = 'ingreso'; }
      else if (debito > 0) { monto = debito; tipo = 'egreso'; }
      else continue;
    } else if (cols.length >= 3) {
      // formato: fecha, descripcion, monto (negativo = débito)
      fecha = normalizarFecha(cols[0]);
      descripcion = cols[1];
      const raw = parseFloat(cols[2].replace(/[^0-9.,\-]/g, '').replace(',', '.')) || 0;
      monto = Math.abs(raw);
      tipo  = raw >= 0 ? 'ingreso' : 'egreso';
    } else continue;

    if (!fecha || monto <= 0) continue;
    resultados.push({ fecha, descripcion, monto, tipo });
  }
  return resultados;
}

function normalizarFecha(raw: string): string {
  const limpio = raw.trim();
  // DD/MM/YYYY → YYYY-MM-DD
  const m1 = limpio.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
  // YYYY-MM-DD ya está bien
  if (/^\d{4}-\d{2}-\d{2}$/.test(limpio)) return limpio;
  return limpio;
}

// ─── Importar extracto ────────────────────────────────────────────────────────
export async function importarExtracto(
  empresaId: string,
  cuentaId: string,
  userId: string,
  nombreArchivo: string,
  lineas: ReturnType<typeof parsearCSV>
): Promise<ExtractoBancario> {
  if (lineas.length === 0) throw new Error('El archivo no tiene movimientos válidos');

  const fechas   = lineas.map(l => l.fecha).sort();
  const debitos  = lineas.filter(l => l.tipo === 'egreso') .reduce((s, l) => s + l.monto, 0);
  const creditos = lineas.filter(l => l.tipo === 'ingreso').reduce((s, l) => s + l.monto, 0);

  const { data: extracto, error: eError } = await supabase
    .from('extractos_bancarios')
    .insert([{
      empresa_id: empresaId,
      cuenta_bancaria_id: cuentaId,
      nombre_archivo: nombreArchivo,
      fecha_desde: fechas[0],
      fecha_hasta: fechas[fechas.length - 1],
      total_debitos: debitos,
      total_creditos: creditos,
      movimientos_count: lineas.length,
      user_id: userId,
    }])
    .select()
    .single();

  if (eError) throw new Error(eError.message);

  const payload = lineas.map(l => ({
    empresa_id: empresaId,
    extracto_id: (extracto as ExtractoBancario).id,
    cuenta_bancaria_id: cuentaId,
    fecha: l.fecha,
    descripcion: l.descripcion,
    monto: l.monto,
    tipo: l.tipo,
    conciliado: false,
  }));

  const { error: lError } = await supabase.from('extracto_lineas').insert(payload);
  if (lError) throw new Error(lError.message);

  return extracto as ExtractoBancario;
}

// ─── Listar extractos de una cuenta ──────────────────────────────────────────
export async function getExtractos(cuentaId: string, empresaId: string): Promise<ExtractoBancario[]> {
  const { data, error } = await supabase
    .from('extractos_bancarios')
    .select('*')
    .eq('cuenta_bancaria_id', cuentaId)
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as ExtractoBancario[];
}

// ─── Listar líneas de un extracto ─────────────────────────────────────────────
export async function getLineas(extractoId: string, empresaId: string): Promise<ExtractoLinea[]> {
  const { data, error } = await supabase
    .from('extracto_lineas')
    .select('*')
    .eq('extracto_id', extractoId)
    .eq('empresa_id', empresaId)
    .order('fecha');
  if (error) throw new Error(error.message);
  return (data ?? []) as ExtractoLinea[];
}

// ─── Listar movimientos bancarios sin conciliar ───────────────────────────────
export async function getMovimientosSinConciliar(cuentaId: string, empresaId: string) {
  const { data, error } = await supabase
    .from('movimientos_bancarios')
    .select('*')
    .eq('cuenta_bancaria_id', cuentaId)
    .eq('empresa_id', empresaId)
    .eq('conciliado', false)
    .order('fecha', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ─── Match manual: vincular una línea con un movimiento ──────────────────────
export async function matchManual(lineaId: string, movimientoId: string): Promise<void> {
  const { error } = await supabase
    .from('extracto_lineas')
    .update({ movimiento_id: movimientoId, conciliado: true })
    .eq('id', lineaId);
  if (error) throw new Error(error.message);
}

// ─── Deshacer match ────────────────────────────────────────────────────────────
export async function desMatch(lineaId: string): Promise<void> {
  const { error } = await supabase
    .from('extracto_lineas')
    .update({ movimiento_id: null, conciliado: false })
    .eq('id', lineaId);
  if (error) throw new Error(error.message);
}

// ─── Auto-match: por monto + tipo + fecha ±1 día ─────────────────────────────
export async function autoMatch(extractoId: string, empresaId: string, cuentaId: string): Promise<number> {
  const [lineas, movimientos] = await Promise.all([
    getLineas(extractoId, empresaId),
    getMovimientosSinConciliar(cuentaId, empresaId),
  ]);

  const pendientes = lineas.filter(l => !l.conciliado);
  let matched = 0;

  for (const linea of pendientes) {
    const candidatos = movimientos.filter((m: { tipo: string; monto: number; fecha: string }) => {
      if (m.tipo !== linea.tipo) return false;
      if (Math.abs(Number(m.monto) - linea.monto) > 0.01) return false;
      const diff = Math.abs(new Date(m.fecha).getTime() - new Date(linea.fecha).getTime());
      return diff <= 2 * 24 * 60 * 60 * 1000;   // ±2 días
    });

    if (candidatos.length === 1) {
      await matchManual(linea.id, candidatos[0].id);
      // Remover del pool para no usarlo doble
      movimientos.splice(movimientos.indexOf(candidatos[0]), 1);
      matched++;
    }
  }
  return matched;
}

export const conciliacionService = {
  parsearCSV, importarExtracto, getExtractos, getLineas,
  getMovimientosSinConciliar, matchManual, desMatch, autoMatch,
};
