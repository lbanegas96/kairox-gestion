import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, Sparkles } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';

const SIN_MAPEAR = '__none__';

/**
 * Mapeo producto KAIROX ↔ variante de Tiendanube. Trae el catálogo real vía el
 * edge function tiendanube-catalogo y lo ofrece en un dropdown por producto, con
 * auto-sugerencia: si el SKU/código de barras de KAIROX coincide con el SKU de una
 * variante de Tiendanube, la pre-selecciona (el usuario confirma al guardar).
 */
function MapeoProductosModal({ open, onOpenChange, integracion }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [productos, setProductos] = useState([]);
  const [variantes, setVariantes] = useState([]); // catálogo Tiendanube: [{external_id, external_sku, nombre, stock}]
  const [mapeos, setMapeos] = useState({});        // producto_id -> { external_id, sincronizar_stock }
  const [loading, setLoading] = useState(false);
  const [errorCatalogo, setErrorCatalogo] = useState(null);
  const [autoMatch, setAutoMatch] = useState(0);   // cuántos se auto-sugirieron
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!open || !user?.empresa_id || !integracion?.id) return;
    setLoading(true);
    setErrorCatalogo(null);
    setAutoMatch(0);
    (async () => {
      // Productos propios + mapeos ya guardados + catálogo de Tiendanube en paralelo
      const [{ data: prods }, { data: existentes }, catalogoRes] = await Promise.all([
        supabase.from('productos')
          .select('id, nombre, codigo_sku, codigo_barras')
          .eq('empresa_id', user.empresa_id)
          .eq('activo', true)
          .order('nombre'),
        supabase.from('integraciones_producto_mapeo')
          .select('producto_id, external_id, sincronizar_stock')
          .eq('integracion_id', integracion.id),
        supabase.functions.invoke('tiendanube-catalogo', { body: {} }),
      ]);

      const listaProductos = prods ?? [];
      setProductos(listaProductos);

      const cat = catalogoRes?.data?.variantes ?? [];
      const errCat = catalogoRes?.error || catalogoRes?.data?.error;
      if (errCat) setErrorCatalogo(catalogoRes?.data?.error ?? catalogoRes?.error?.message ?? 'No se pudo leer el catálogo');
      setVariantes(cat);

      // Mapeos ya guardados
      const map = {};
      for (const m of existentes ?? []) {
        map[m.producto_id] = { external_id: m.external_id ?? '', sincronizar_stock: m.sincronizar_stock };
      }

      // Auto-sugerencia por SKU/código de barras contra el SKU de la variante
      const porSku = new Map();
      for (const v of cat) {
        if (v.external_sku) porSku.set(String(v.external_sku).trim().toLowerCase(), v.external_id);
      }
      let sugeridos = 0;
      for (const p of listaProductos) {
        if (map[p.id]?.external_id) continue; // ya mapeado, no pisar
        const claves = [p.codigo_sku, p.codigo_barras].filter(Boolean).map(s => String(s).trim().toLowerCase());
        const match = claves.map(c => porSku.get(c)).find(Boolean);
        if (match) {
          map[p.id] = { external_id: match, sincronizar_stock: true, _sugerido: true };
          sugeridos++;
        }
      }
      setAutoMatch(sugeridos);
      setMapeos(map);
      setLoading(false);
    })();
  }, [open, user?.empresa_id, integracion?.id]);

  const setCampo = (productoId, campo, valor) => {
    setMapeos(prev => ({
      ...prev,
      [productoId]: { external_id: '', sincronizar_stock: true, ...prev[productoId], [campo]: valor, _sugerido: false },
    }));
  };

  const handleGuardar = async () => {
    if (!integracion?.id) return;
    const filas = Object.entries(mapeos)
      .filter(([, v]) => v.external_id?.trim())
      .map(([productoId, v]) => {
        const variante = variantes.find(x => x.external_id === v.external_id);
        return {
          integracion_id: integracion.id,
          producto_id: productoId,
          external_id: v.external_id.trim(),
          external_sku: variante?.external_sku ?? null,
          sincronizar_stock: v.sincronizar_stock ?? true,
        };
      });

    if (filas.length === 0) {
      toast({ title: 'Nada para guardar', description: 'Asigná al menos un producto de Tiendanube.', variant: 'destructive' });
      return;
    }

    setGuardando(true);
    try {
      const { error } = await supabase
        .from('integraciones_producto_mapeo')
        .upsert(filas, { onConflict: 'integracion_id,producto_id' });

      if (error) {
        toast({ title: 'Error al guardar el mapeo', description: error.message, variant: 'destructive' });
        return;
      }
      toast({ title: `✓ Mapeo guardado (${filas.length})`, className: 'bg-green-600 text-white border-green-700' });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Error al guardar el mapeo', description: e.message, variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] bg-kx-surface border-kx-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-kx-text">Mapeo de productos — Tiendanube</DialogTitle>
          <DialogDescription>
            Asigná a cada producto de KAIROX su variante correspondiente en Tiendanube. Los que tienen el
            mismo SKU / código de barras se sugieren solos — revisá y guardá. Se puede completar de a poco.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-kx-text-2">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando productos y catálogo de Tiendanube...
          </div>
        ) : productos.length === 0 ? (
          <div className="p-4 text-sm text-kx-text-2">No hay productos activos para mapear.</div>
        ) : (
          <>
            {errorCatalogo && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-400">
                No se pudo leer el catálogo de Tiendanube ({errorCatalogo}). Podés mapear igual cuando se resuelva, o reconectar la integración.
              </div>
            )}
            {!errorCatalogo && autoMatch > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <Sparkles className="w-3.5 h-3.5" />
                {autoMatch} producto{autoMatch > 1 ? 's' : ''} sugerido{autoMatch > 1 ? 's' : ''} por coincidencia de SKU — revisá antes de guardar.
              </div>
            )}

            <div className="space-y-2">
              {productos.map(p => {
                const m = mapeos[p.id] ?? { external_id: '', sincronizar_stock: true };
                const referencia = p.codigo_sku || p.codigo_barras;
                return (
                  <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg border border-kx-border">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-kx-text truncate flex items-center gap-1.5">
                        {p.nombre}
                        {m._sugerido && <Sparkles className="w-3 h-3 text-emerald-500 shrink-0" />}
                      </p>
                      {referencia && <p className="text-2xs text-kx-text-3">Ref: {referencia}</p>}
                    </div>
                    <Select
                      value={m.external_id || SIN_MAPEAR}
                      onValueChange={v => setCampo(p.id, 'external_id', v === SIN_MAPEAR ? '' : v)}
                    >
                      <SelectTrigger className="w-52 h-8 text-xs kairox-input shrink-0">
                        <SelectValue placeholder="— Sin asignar —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SIN_MAPEAR}>— Sin asignar —</SelectItem>
                        {variantes.map(v => (
                          <SelectItem key={v.external_id} value={v.external_id}>
                            {v.nombre}{v.external_sku ? ` · ${v.external_sku}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-1.5 text-2xs text-kx-text-2 shrink-0 cursor-pointer">
                      <Checkbox
                        checked={m.sincronizar_stock}
                        onCheckedChange={v => setCampo(p.id, 'sincronizar_stock', v === true)}
                      />
                      Stock
                    </label>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="flex gap-2 justify-end pt-2 border-t border-kx-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <Button onClick={handleGuardar} disabled={guardando || loading} className="gap-2">
            {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Guardar mapeo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MapeoProductosModal;
