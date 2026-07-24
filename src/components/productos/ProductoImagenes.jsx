import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Star, Trash2, Loader2, ImageOff } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { dispararPublicacionCatalogo } from '@/services/integracionesService';

const BUCKET = 'productos-imagenes';
const MAX_BYTES = 5 * 1024 * 1024; // 5MB, igual que el límite del bucket (mig.234)
const TIPOS_OK = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Gestor de imágenes de un producto (mig.234: tabla producto_imagenes + bucket
 * productos-imagenes). Sube al Storage (servido por CDN, no base64 en Postgres),
 * guarda la URL + orden en la tabla, y permite marcar principal / borrar.
 *
 * Solo se muestra en EDICIÓN: en el alta el producto todavía no tiene id para
 * asociar la imagen ni armar el path {empresa_id}/{producto_id}/... — se le pide
 * al usuario guardar primero.
 */
const ProductoImagenes = ({ productoId, publicarEcommerce = false }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const [subiendo, setSubiendo] = useState(false);
  const empresaId = user?.empresa_id;

  const queryKey = ['producto_imagenes', productoId];
  const { data: imagenes = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('producto_imagenes')
        .select('id, url, orden, es_principal')
        .eq('producto_id', productoId)
        .order('es_principal', { ascending: false })
        .order('orden', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!productoId,
  });

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ''; // permitir re-subir el mismo archivo
    if (!file || !empresaId || !productoId) return;

    if (!TIPOS_OK.includes(file.type)) {
      toast({ title: 'Formato no válido', description: 'Solo PNG, JPG o WEBP.', variant: 'destructive' });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: 'Imagen muy pesada', description: 'Máximo 5 MB por imagen.', variant: 'destructive' });
      return;
    }

    setSubiendo(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${empresaId}/${productoId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, cacheControl: '3600' });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);

      const esPrimera = imagenes.length === 0;
      const { error: insErr } = await supabase.from('producto_imagenes').insert({
        empresa_id: empresaId,
        producto_id: productoId,
        url: publicUrl,
        orden: imagenes.length,
        es_principal: esPrimera, // la primera imagen es principal por defecto
      });
      if (insErr) throw insErr;

      toast({ title: 'Imagen agregada' });
      qc.invalidateQueries({ queryKey });
      if (publicarEcommerce) dispararPublicacionCatalogo();
    } catch (err) {
      toast({ title: 'No se pudo subir', description: err.message, variant: 'destructive' });
    } finally {
      setSubiendo(false);
    }
  };

  const marcarPrincipal = async (img) => {
    if (img.es_principal) return;
    // Desmarcar la anterior y marcar esta (el índice único uq_producto_imagen_principal
    // no deja tener dos principales — hacemos el unset primero).
    await supabase.from('producto_imagenes').update({ es_principal: false }).eq('producto_id', productoId).eq('es_principal', true);
    const { error } = await supabase.from('producto_imagenes').update({ es_principal: true }).eq('id', img.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    qc.invalidateQueries({ queryKey });
  };

  const borrar = async (img) => {
    try {
      // Borrar de Storage: el path es todo lo que sigue al dominio /object/public/{bucket}/
      const marker = `/${BUCKET}/`;
      const idx = img.url.indexOf(marker);
      if (idx !== -1) {
        const path = img.url.slice(idx + marker.length).split('?')[0];
        await supabase.storage.from(BUCKET).remove([path]);
      }
      const { error } = await supabase.from('producto_imagenes').delete().eq('id', img.id);
      if (error) throw error;
      toast({ title: 'Imagen eliminada' });
      qc.invalidateQueries({ queryKey });
      if (publicarEcommerce) dispararPublicacionCatalogo();
    } catch (err) {
      toast({ title: 'No se pudo eliminar', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="col-span-1 md:col-span-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-kx-text">Imágenes</span>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleUpload} />
        <Button
          type="button" size="sm" variant="outline" className="h-8 text-xs gap-1.5"
          disabled={subiendo} onClick={() => fileRef.current?.click()}
        >
          {subiendo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
          Agregar imagen
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-kx-text-3 py-3 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</div>
      ) : imagenes.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center border border-dashed border-kx-border rounded-lg">
          <ImageOff className="w-6 h-6 text-kx-text-3" />
          <p className="text-xs text-kx-text-3">Sin imágenes. La principal se publica primero en el canal de ecommerce.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {imagenes.map((img) => (
            <div key={img.id} className="relative group rounded-lg overflow-hidden border border-kx-border aspect-square bg-kx-surface-2">
              <img src={img.url} alt="" className="w-full h-full object-cover" />
              {img.es_principal && (
                <span className="absolute top-1 left-1 text-[9px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                  <Star className="w-2.5 h-2.5 fill-current" /> Principal
                </span>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100">
                {!img.es_principal && (
                  <button type="button" onClick={() => marcarPrincipal(img)} title="Marcar como principal"
                    className="w-7 h-7 rounded-full bg-white/90 hover:bg-white flex items-center justify-center text-amber-600">
                    <Star className="w-3.5 h-3.5" />
                  </button>
                )}
                <button type="button" onClick={() => borrar(img)} title="Eliminar"
                  className="w-7 h-7 rounded-full bg-white/90 hover:bg-white flex items-center justify-center text-red-600">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductoImagenes;
