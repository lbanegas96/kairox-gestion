import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, AlertTriangle, RefreshCw, Loader2, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { formatDateAR } from '@/lib/dateUtils';
import { dispararPublicacionCatalogo } from '@/services/integracionesService';

/**
 * Estado de publicación de un producto a ecommerce (Tiendanube). Lee la cola
 * integraciones_producto_pendiente (mig.235) + el mapeo (para saber si ya está
 * publicado, external_product_id no nulo). Se refresca solo mientras hay algo
 * en curso, y ofrece "Reintentar" si quedó en error definitivo.
 *
 * Se muestra dentro del ProductForm, debajo del toggle "Publicar en ecommerce".
 */
const EstadoPublicacionEcommerce = ({ productoId, publicarEcommerce }) => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const queryKey = ['estado_publicacion', productoId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const [{ data: cola }, { data: mapeo }] = await Promise.all([
        supabase
          .from('integraciones_producto_pendiente')
          .select('id, estado, intentos, max_intentos, error_mensaje, updated_at')
          .eq('producto_id', productoId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('integraciones_producto_mapeo')
          .select('external_product_id, integraciones_canales!inner(canal, activo)')
          .eq('producto_id', productoId)
          .eq('integraciones_canales.canal', 'tiendanube')
          .eq('integraciones_canales.activo', true)
          .maybeSingle(),
      ]);
      return { cola: cola ?? null, publicado: !!mapeo?.external_product_id };
    },
    enabled: !!productoId,
    // Mientras hay algo en curso, refrescar cada 8s para ver el progreso del worker.
    refetchInterval: (query) => {
      const estado = query.state.data?.cola?.estado;
      return estado === 'pendiente' || estado === 'procesando' ? 8000 : false;
    },
  });

  const reintentar = async () => {
    if (!data?.cola?.id) return;
    const { error } = await supabase
      .from('integraciones_producto_pendiente')
      .update({ estado: 'pendiente', intentos: 0, error_mensaje: null, proximo_intento: new Date().toISOString() })
      .eq('id', data.cola.id);
    if (error) {
      toast({ title: 'No se pudo reintentar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Reintento encolado', description: 'El worker lo procesará en los próximos minutos.' });
    qc.invalidateQueries({ queryKey });
    dispararPublicacionCatalogo();
  };

  if (!productoId || isLoading) return null;

  const estado = data?.cola?.estado;
  const publicado = data?.publicado;

  // Nada que mostrar: no está marcado para publicar y nunca se publicó/encoló.
  if (!publicarEcommerce && !publicado && !estado) return null;

  // Base visual común.
  const wrap = 'flex items-start gap-2 text-xs rounded-lg border p-2.5 mt-1';

  // Error definitivo — lo más importante de mostrar + acción.
  if (estado === 'error_definitivo') {
    return (
      <div className={`${wrap} border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/15`}>
        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-red-700 dark:text-red-400">No se pudo publicar en Tiendanube</p>
          {data.cola.error_mensaje && (
            <p className="text-red-600/80 dark:text-red-400/80 mt-0.5 break-words">{data.cola.error_mensaje}</p>
          )}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={reintentar} className="h-7 text-xs gap-1 shrink-0">
          <RefreshCw className="w-3 h-3" /> Reintentar
        </Button>
      </div>
    );
  }

  // En cola / procesando.
  if (estado === 'pendiente' || estado === 'procesando') {
    return (
      <div className={`${wrap} border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/15`}>
        <Loader2 className="w-4 h-4 text-amber-500 shrink-0 mt-0.5 animate-spin" />
        <div>
          <p className="font-medium text-amber-700 dark:text-amber-400">
            {publicado ? 'Actualizando en Tiendanube…' : 'Publicando en Tiendanube…'}
          </p>
          <p className="text-amber-600/80 dark:text-amber-400/80 mt-0.5">El worker sincroniza cada pocos minutos.</p>
        </div>
      </div>
    );
  }

  // Publicado y sin nada pendiente.
  if (publicado) {
    return (
      <div className={`${wrap} border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/15`}>
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            Publicado en Tiendanube <ExternalLink className="w-3 h-3" />
          </p>
          {data.cola?.updated_at && (
            <p className="text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
              Última sincronización: {formatDateAR(data.cola.updated_at)}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Marcado para publicar pero todavía sin encolar (recién tildado, aún sin guardar).
  return (
    <div className={`${wrap} border-kx-border bg-kx-surface-2`}>
      <Clock className="w-4 h-4 text-kx-text-3 shrink-0 mt-0.5" />
      <p className="text-kx-text-3">Se publicará en Tiendanube al guardar los cambios.</p>
    </div>
  );
};

export default EstadoPublicacionEcommerce;
