import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Loader2, AlertCircle, Check, Send, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { formatDateAR } from '@/lib/dateUtils';

const TIPO_CBTE_LABEL = { 1: 'Factura A', 6: 'Factura B', 11: 'Factura C' };

/**
 * Card "CAEA — Contingencia offline" en Configuración → Facturación.
 *
 * CAEA permite seguir facturando si ARCA está caído: se solicita el código de
 * antemano (una vez por quincena) y, si hace falta, un comprobante atascado en
 * error se autoriza con él desde el Monitor de Facturación AFIP (botón "Usar
 * CAEA", mig.206) en vez de esperar a que ARCA vuelva. Esta card es donde el
 * admin solicita el CAEA de la quincena e informa lo emitido al cierre —
 * infraestructura de backend ya existía (mig.103/104, 3 edge functions) pero
 * nunca tuvo UI (ver CAEA_IMPLEMENTACION.md, sección "Pendiente").
 *
 * Autocontenida (fetching propio vía useQuery), mismo patrón que
 * MonitorFacturacionAFIP — no agrega props nuevas a ConfiguracionSection.jsx.
 */
const CardCAEA = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const empresaId = user?.empresa_id;

  const [solicitando, setSolicitando] = useState(false);
  const [informando, setInformando] = useState(null); // id del registro en curso

  const queryKey = ['caea_config', empresaId];
  const { data, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const [{ data: empresa }, { data: registros }] = await Promise.all([
        supabase.from('empresas').select('afip_usa_caea').eq('id', empresaId).single(),
        supabase
          .from('caea_registros')
          .select('id, caea, periodo, orden, fecha_desde, fecha_hasta, fecha_tope_inf, tipo_cbte, estado, comprobantes_emitidos')
          .eq('empresa_id', empresaId)
          .order('fecha_hasta', { ascending: false })
          .limit(5),
      ]);
      return { afipUsaCaea: empresa?.afip_usa_caea ?? false, registros: registros ?? [] };
    },
    enabled: !!empresaId,
  });

  const afipUsaCaea = data?.afipUsaCaea ?? false;
  const registros = data?.registros ?? [];

  const toggleCaea = async (checked) => {
    const { error } = await supabase.from('empresas').update({ afip_usa_caea: checked }).eq('id', empresaId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: checked ? 'CAEA habilitado' : 'CAEA deshabilitado' });
    qc.invalidateQueries({ queryKey });
  };

  const solicitarCaea = async () => {
    setSolicitando(true);
    try {
      const { data: res, error } = await supabase.functions.invoke('solicitar-caea', {
        body: { empresa_id: empresaId },
      });
      if (error) throw error;
      if (res?.error) throw new Error(res.error);
      toast({
        title: 'CAEA obtenido',
        description: `${res.caea} — vigente hasta ${formatDateAR(res.fecha_hasta)}`,
        className: 'bg-green-600 text-white border-green-500',
      });
      qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast({ title: 'No se pudo solicitar el CAEA', description: e.message, variant: 'destructive' });
    } finally {
      setSolicitando(false);
    }
  };

  const informarQuincena = async (registro) => {
    setInformando(registro.id);
    try {
      const { data: res, error } = await supabase.functions.invoke('informar-caea', {
        body: { empresa_id: empresaId, caea_registro_id: registro.id },
      });
      if (error) throw error;
      if (res?.error) throw new Error(res.error);
      toast({
        title: res.sin_movimiento ? 'Informado — sin movimiento' : `${res.informados} comprobante(s) informado(s)`,
        description: res.errores?.length ? `${res.errores.length} lote(s) con error — reintentar más tarde.` : undefined,
        className: 'bg-green-600 text-white border-green-500',
      });
      qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast({ title: 'No se pudo informar', description: e.message, variant: 'destructive' });
    } finally {
      setInformando(null);
    }
  };

  if (!afipUsaCaea && !isLoading && registros.length === 0) {
    // Sin CAEA habilitado ni historial: mostrar solo el toggle, sin ruido.
    return (
      <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-violet-100 dark:bg-violet-900/30 rounded-lg flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h3 className="font-semibold text-kx-text">CAEA — Contingencia offline</h3>
              <p className="text-sm text-slate-500 dark:text-kx-text-2">
                Permite seguir facturando si ARCA está caído, con un código pedido de antemano.
              </p>
            </div>
          </div>
          <Switch checked={afipUsaCaea} onCheckedChange={toggleCaea} />
        </div>
      </div>
    );
  }

  const registroVigente = registros.find(r => r.estado === 'activo' && r.fecha_hasta >= new Date().toISOString().slice(0, 10));
  const registrosParaInformar = registros.filter(r => r.estado === 'activo' && r.comprobantes_emitidos > 0);

  return (
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-violet-50 dark:bg-violet-900/20 rounded-lg mt-0.5">
            <ShieldCheck className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">CAEA — Contingencia offline</h3>
            <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
              Código de autorización pedido por quincena — permite facturar aunque ARCA esté caído.
              Se usa manualmente desde el Monitor de Facturación (botón "Usar CAEA" en un comprobante con error).
            </p>
          </div>
        </div>
        <Switch checked={afipUsaCaea} onCheckedChange={toggleCaea} />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Cargando...</div>
      ) : !afipUsaCaea ? (
        <p className="text-sm text-kx-text-3 py-2">CAEA deshabilitado. Activá el switch para poder solicitarlo.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {registroVigente ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-full px-3 py-1">
                <Check className="w-3 h-3" /> CAEA vigente hasta {formatDateAR(registroVigente.fecha_hasta)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-full px-3 py-1">
                <AlertCircle className="w-3 h-3" /> Sin CAEA vigente para la quincena actual
              </span>
            )}
            <Button size="sm" variant="outline" onClick={solicitarCaea} disabled={solicitando} className="h-7 text-xs">
              {solicitando ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
              Solicitar CAEA
            </Button>
          </div>

          {registros.length > 0 && (
            <div className="rounded-xl border border-kx-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-kx-surface-2 dark:bg-slate-900/50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3">CAEA</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3">Tipo</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3">Vigencia</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-kx-text-3">Emitidos</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3">Estado</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-kx-text-3 w-28">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map((r) => (
                    <tr key={r.id} className="border-t border-kx-border">
                      <td className="px-3 py-2 font-mono text-xs text-kx-text">{r.caea}</td>
                      <td className="px-3 py-2 text-kx-text-2 text-xs">{TIPO_CBTE_LABEL[r.tipo_cbte] ?? r.tipo_cbte}</td>
                      <td className="px-3 py-2 text-kx-text-2 text-xs whitespace-nowrap">
                        {formatDateAR(r.fecha_desde)} – {formatDateAR(r.fecha_hasta)}
                      </td>
                      <td className="px-3 py-2 text-center text-kx-text tabular-nums">{r.comprobantes_emitidos}</td>
                      <td className="px-3 py-2 text-xs capitalize text-kx-text-2">{r.estado}</td>
                      <td className="px-3 py-2 text-center">
                        {r.estado === 'activo' && r.comprobantes_emitidos > 0 && (
                          <Button
                            size="sm" variant="outline"
                            disabled={informando === r.id}
                            onClick={() => informarQuincena(r)}
                            className="h-7 text-xs"
                          >
                            {informando === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
                            {informando === r.id ? '' : 'Informar'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {registrosParaInformar.length === 0 && registros.some(r => r.estado === 'activo') && (
            <p className="text-xs text-kx-text-3 mt-2">Ningún CAEA activo tiene comprobantes emitidos para informar todavía.</p>
          )}
        </>
      )}
    </div>
  );
};

export default CardCAEA;
