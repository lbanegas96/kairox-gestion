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
 * Devuelve:
 *   - afipConfig: { usa_factura_electronica, condicion_iva, afip_cuit, punto_venta } | null
 *   - afipActivo: boolean — true sólo si la empresa factura electrónicamente y
 *     tiene un punto de venta activo.
 *   - determinarTipoComprobante(emisor, receptor): 'A' | 'B' | 'C'
 *
 * La queryKey ['afip-config', empresa_id] es compartida: react-query dedupe la
 * lectura entre todos los consumidores (POS + modal de venta).
 */
export function useAfipConfig() {
  const { user } = useAuth();

  const { data: afipConfig } = useQuery({
    queryKey: ['afip-config', user?.empresa_id],
    queryFn: async () => {
      if (!user?.empresa_id) return null;
      const { data: empresa } = await supabase
        .from('empresas')
        .select('usa_factura_electronica, condicion_iva, afip_cuit')
        .eq('id', user.empresa_id)
        .single();
      if (!empresa?.usa_factura_electronica) return null;
      const { data: pv } = await supabase
        .from('puntos_venta')
        .select('id, numero, tipo_comprobante_default')
        .eq('empresa_id', user.empresa_id)
        .eq('activo', true)
        .limit(1)
        .maybeSingle();
      return { ...empresa, punto_venta: pv };
    },
    enabled: !!user?.empresa_id,
    staleTime: 5 * 60 * 1000,
  });

  const afipActivo = afipConfig?.usa_factura_electronica === true && !!afipConfig?.punto_venta;

  return { afipConfig, afipActivo, determinarTipoComprobante };
}
