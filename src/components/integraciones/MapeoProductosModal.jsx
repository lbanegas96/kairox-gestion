import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Save } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Mapeo manual producto KAIROX ↔ id externo del canal. Primera versión: sin
 * traer el catálogo real de Tiendanube (eso implica un edge function propio
 * para llamar a su API de productos) — acá se pega el ID a mano, mostrando
 * código de barras/SKU propios como referencia para ubicarlo más rápido.
 */
function MapeoProductosModal({ open, onOpenChange, integracion }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [productos, setProductos] = useState([]);
  const [mapeos, setMapeos] = useState({}); // producto_id -> { external_id, sincronizar_stock }
  const [loading, setLoading] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!open || !user?.empresa_id || !integracion?.id) return;
    setLoading(true);
    (async () => {
      const [{ data: prods }, { data: existentes }] = await Promise.all([
        supabase.from('productos')
          .select('id, nombre, codigo_sku, codigo_barras')
          .eq('empresa_id', user.empresa_id)
          .eq('activo', true)
          .order('nombre'),
        supabase.from('integraciones_producto_mapeo')
          .select('producto_id, external_id, sincronizar_stock')
          .eq('integracion_id', integracion.id),
      ]);
      setProductos(prods ?? []);
      const map = {};
      for (const m of existentes ?? []) {
        map[m.producto_id] = { external_id: m.external_id ?? '', sincronizar_stock: m.sincronizar_stock };
      }
      setMapeos(map);
      setLoading(false);
    })();
  }, [open, user?.empresa_id, integracion?.id]);

  const setCampo = (productoId, campo, valor) => {
    setMapeos(prev => ({
      ...prev,
      [productoId]: { external_id: '', sincronizar_stock: true, ...prev[productoId], [campo]: valor },
    }));
  };

  const handleGuardar = async () => {
    if (!integracion?.id) return;
    const filas = Object.entries(mapeos)
      .filter(([, v]) => v.external_id?.trim())
      .map(([productoId, v]) => ({
        integracion_id: integracion.id,
        producto_id: productoId,
        external_id: v.external_id.trim(),
        sincronizar_stock: v.sincronizar_stock ?? true,
      }));

    if (filas.length === 0) {
      toast({ title: 'Nada para guardar', description: 'Cargá al menos un ID externo.', variant: 'destructive' });
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
      toast({ title: '✓ Mapeo guardado', className: 'bg-green-600 text-white border-green-700' });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Error al guardar el mapeo', description: e.message, variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] bg-kx-surface border-kx-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-kx-text">Mapeo de productos — Tiendanube</DialogTitle>
          <DialogDescription>
            Para cada producto de KAIROX, pegá el ID del producto (o variante) correspondiente en Tiendanube.
            Se puede completar de a poco — no hace falta mapear todo de una.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-kx-text-2">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando productos...
          </div>
        ) : productos.length === 0 ? (
          <div className="p-4 text-sm text-kx-text-2">No hay productos activos para mapear.</div>
        ) : (
          <div className="space-y-2">
            {productos.map(p => {
              const m = mapeos[p.id] ?? { external_id: '', sincronizar_stock: true };
              const referencia = p.codigo_sku || p.codigo_barras;
              return (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg border border-kx-border">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-kx-text truncate">{p.nombre}</p>
                    {referencia && (
                      <p className="text-2xs text-kx-text-3">Ref: {referencia}</p>
                    )}
                  </div>
                  <Input
                    value={m.external_id}
                    onChange={e => setCampo(p.id, 'external_id', e.target.value)}
                    placeholder="ID Tiendanube..."
                    className="kairox-input text-xs h-8 w-40 shrink-0"
                  />
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
