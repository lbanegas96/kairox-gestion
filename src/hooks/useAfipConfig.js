import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';

/**
 * Mapeo emisor/receptor → tipo de comprobante AFIP (A/B/C).
 *
 * Reglas fiscales (RG AFIP):
 *   - Responsable Inscripto (RI): Factura A si el receptor también es RI,
 *     Factura B en cualquier otro caso (CF, Exento, Monotributo).
 *   - Monotributo: SIEMPRE Factura C (no discrimina IVA).
 *   - Exento:      SIEMPRE Factura C (no discrimina IVA). Un Exento NO puede
 *     emitir Factura A ni B — eso es exclusivo del RI.
 *
 * `emisorCondicion` viene de empresas.condicion_iva; `receptorCondicion` del
 * cliente (o 'CF' = Consumidor Final si no hay cliente).
 */
export function determinarTipoComprobante(emisorCondicion, receptorCondicion) {
  if (emisorCondicion === 'Monotributo') return 'C';
  if (emisorCondicion === 'Exento') return 'C';
  if (emisorCondicion === 'RI' || emisorCondicion === 'Responsable Inscripto') {
    const receptorRI = receptorCondicion === 'RI' || receptorCondicion === 'Responsable Inscripto';
    return receptorRI ? 'A' : 'B';
  }
  return 'B';
}

/**
 * Configuración AFIP/ARCA de la empresa para facturación electrónica.
 * Reusable entre NuevaVentaModal (factura clásica) y el POS (useConfirmarVenta).
 *
 * @param contexto 'erp' (default) | 'pos' — de qué circuito de venta se trata.
 *   El POS puede tener su propio punto de venta (`empresas.pos_punto_venta_id`,
 *   mig.293): numeración fiscal independiente del back-office, o directamente
 *   un PdV interno que no factura (caso "local chico que no emite factura").
 *
 * Devuelve:
 *   - afipConfig: { usa_factura_electronica, condicion_iva, afip_cuit, punto_venta } | null
 *   - afipActivo: boolean — true sólo si la empresa factura electrónicamente,
 *     hay un PdV activo resuelto, Y ese PdV envía a ARCA (`envia_arca`).
 *   - determinarTipoComprobante(emisor, receptor): 'A' | 'B' | 'C'
 *
 * Resolución del punto de venta (mig.293 — antes era `.limit(1)` sin ORDER BY
 * ni filtro de `envia_arca`, o sea NO determinístico: con un PdV fiscal y otro
 * de remitos, nada garantizaba cuál se usaba para facturar):
 *   1. `puntoVentaId` explícito (el selector de la factura en el ERP).
 *   2. contexto 'pos' y `empresas.pos_punto_venta_id` seteado → ese PdV.
 *   3. el PdV marcado `es_default` de la empresa (mig.294).
 *   4. fallback: primer PdV activo CON `envia_arca=true`, ordenado por número.
 *
 * @param puntoVentaId fuerza un PdV concreto (selector del ERP). Tiene
 *   prioridad sobre todo lo demás; si no se pasa, se resuelve por defecto.
 */
export function useAfipConfig(contexto = 'erp', puntoVentaId = null) {
  const { user } = useAuth();

  const { data: afipConfig } = useQuery({
    queryKey: ['afip-config', user?.empresa_id, contexto, puntoVentaId],
    queryFn: async () => {
      if (!user?.empresa_id) return null;
      const { data: empresa } = await supabase
        .from('empresas')
        .select('usa_factura_electronica, condicion_iva, afip_cuit, pos_punto_venta_id')
        .eq('id', user.empresa_id)
        .single();
      // Bug real encontrado en vivo (26/08, primera empresa de prueba con AFIP
      // apagado a propósito): este `return null` cortaba ANTES de resolver el
      // punto de venta, dejando `afipConfig.punto_venta` siempre null — el local
      // que "no emite factura electrónica" (el caso de uso que el docstring de
      // arriba dice explícitamente que este hook soporta) no podía facturar NI
      // NADA, ni Ticket, porque nunca se resolvía ningún PdV. `usa_factura_electronica`
      // no debe cortar la resolución del PdV — sólo importa para `afipActivo`
      // (ver más abajo), que ya es quien decide si corresponde enviar a ARCA.

      const COLS = 'id, numero, nombre, tipo_comprobante_default, envia_arca';
      const porId = async (id) => {
        const { data } = await supabase
          .from('puntos_venta')
          .select(COLS)
          .eq('id', id)
          .eq('empresa_id', user.empresa_id)
          .eq('activo', true)
          .maybeSingle();
        return data ?? null;
      };

      let pv = null;

      // 1. PdV elegido explícitamente (selector de la factura en el ERP)
      if (puntoVentaId) pv = await porId(puntoVentaId);

      // 2. PdV propio del POS, si la empresa lo configuró (mig.293)
      if (!pv && contexto === 'pos' && empresa.pos_punto_venta_id) {
        pv = await porId(empresa.pos_punto_venta_id);
      }

      // 3. El PdV marcado por defecto de la empresa (mig.294)
      if (!pv) {
        const { data } = await supabase
          .from('puntos_venta')
          .select(COLS)
          .eq('empresa_id', user.empresa_id)
          .eq('activo', true)
          .eq('es_default', true)
          .maybeSingle();
        pv = data ?? null;
      }

      // 4. Fallback determinístico: primer PdV fiscal activo, por número
      if (!pv) {
        const { data } = await supabase
          .from('puntos_venta')
          .select(COLS)
          .eq('empresa_id', user.empresa_id)
          .eq('activo', true)
          .eq('envia_arca', true)
          .order('numero')
          .limit(1)
          .maybeSingle();
        pv = data ?? null;
      }

      return { ...empresa, punto_venta: pv };
    },
    enabled: !!user?.empresa_id,
    staleTime: 5 * 60 * 1000,
  });

  // Un PdV con envia_arca=false es una serie interna: emite comprobante propio
  // y NUNCA se encola a ARCA (mig.244 creó el flag; recién acá se respeta en
  // el circuito de facturación).
  const afipActivo =
    afipConfig?.usa_factura_electronica === true &&
    !!afipConfig?.punto_venta &&
    afipConfig.punto_venta.envia_arca !== false;

  return { afipConfig, afipActivo, determinarTipoComprobante };
}
