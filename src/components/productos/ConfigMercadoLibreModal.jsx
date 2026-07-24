import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, Search, Sparkles, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { dispararPublicacionMercadoLibre } from '@/services/integracionesService';

/**
 * Formulario de publicación a MercadoLibre por producto (Fase 5/6). Deja elegir la
 * categoría (con el predictor de MELI a partir del nombre), completar los
 * atributos obligatorios (marca/modelo/etc.) y — Fase 6 — buscar y enganchar el
 * producto a una ficha del catálogo oficial de MELI. Esto último es necesario en
 * la práctica: MELI rechaza crear una publicación libre (título/fotos propios)
 * en casi todas las categorías reales (exige family_name → obliga catálogo, ver
 * CONTEXT.md). Al guardar, hace upsert en producto_mercadolibre_config — el
 * trigger de la mig.240 encola la publicación, y disparamos el worker al toque.
 */
function ConfigMercadoLibreModal({ open, onOpenChange, producto }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [categorias, setCategorias] = useState([]);        // [{category_id, category_name}]
  const [buscandoCat, setBuscandoCat] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [condicion, setCondicion] = useState('new');
  const [atributosDef, setAtributosDef] = useState([]);    // definición de atributos de la categoría
  const [cargandoAttrs, setCargandoAttrs] = useState(false);
  const [valores, setValores] = useState({});              // { [attrId]: value_name }
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogResultados, setCatalogResultados] = useState([]); // [{catalog_product_id, name, pictures}]
  const [buscandoCatalogo, setBuscandoCatalogo] = useState(false);
  const [catalogProductId, setCatalogProductId] = useState('');
  const [catalogProductName, setCatalogProductName] = useState('');

  const predecir = useCallback(async (q) => {
    if (!q?.trim()) return;
    setBuscandoCat(true);
    try {
      const { data } = await supabase.functions.invoke('mercadolibre-categorias', {
        body: { action: 'predict', q: q.trim() },
      });
      setCategorias(data?.categorias ?? []);
    } catch (e) {
      toast({ title: 'No se pudo buscar la categoría', description: e.message, variant: 'destructive' });
    } finally {
      setBuscandoCat(false);
    }
  }, [toast]);

  const cargarAtributos = useCallback(async (catId) => {
    if (!catId) { setAtributosDef([]); return; }
    setCargandoAttrs(true);
    try {
      const { data } = await supabase.functions.invoke('mercadolibre-categorias', {
        body: { action: 'attributes', category_id: catId },
      });
      // Mostramos los obligatorios (los que MELI exige para publicar).
      setAtributosDef((data?.atributos ?? []).filter(a => a.obligatorio));
    } catch (e) {
      toast({ title: 'No se pudieron cargar los atributos', description: e.message, variant: 'destructive' });
    } finally {
      setCargandoAttrs(false);
    }
  }, [toast]);

  const buscarCatalogo = useCallback(async (q, catId) => {
    if (!q?.trim() || !catId) return;
    setBuscandoCatalogo(true);
    try {
      const { data, error } = await supabase.functions.invoke('mercadolibre-categorias', {
        body: { action: 'catalog_search', category_id: catId, q: q.trim() },
      });
      if (error) throw error;
      setCatalogResultados(data?.resultados ?? []);
    } catch (e) {
      toast({ title: 'No se pudo buscar en el catálogo', description: e.message, variant: 'destructive' });
    } finally {
      setBuscandoCatalogo(false);
    }
  }, [toast]);

  const elegirCatalogo = (p) => {
    setCatalogProductId(p.catalog_product_id);
    setCatalogProductName(p.name);
  };

  const quitarCatalogo = () => {
    setCatalogProductId('');
    setCatalogProductName('');
  };

  // Al abrir: cargar config existente; si no hay, predecir desde el nombre.
  useEffect(() => {
    if (!open || !producto?.id) return;
    setLoading(true);
    (async () => {
      const { data: cfg } = await supabase
        .from('producto_mercadolibre_config')
        .select('category_id, category_name, condicion, atributos, catalog_product_id, catalog_product_name')
        .eq('producto_id', producto.id)
        .maybeSingle();

      setCatalogProductId(cfg?.catalog_product_id ?? '');
      setCatalogProductName(cfg?.catalog_product_name ?? '');
      setCatalogResultados([]);
      setCatalogQuery(producto.nombre ?? '');

      if (cfg?.category_id) {
        setCategoryId(cfg.category_id);
        setCategoryName(cfg.category_name ?? '');
        setCondicion(cfg.condicion ?? 'new');
        const v = {};
        for (const a of cfg.atributos ?? []) if (a?.id) v[a.id] = a.value_name ?? '';
        setValores(v);
        setCategorias(cfg.category_name ? [{ category_id: cfg.category_id, category_name: cfg.category_name }] : []);
        await cargarAtributos(cfg.category_id);
      } else {
        setCategoryId(''); setCategoryName(''); setCondicion('new'); setValores({}); setAtributosDef([]);
        setBusqueda(producto.nombre ?? '');
        await predecir(producto.nombre ?? '');
      }
      setLoading(false);
    })();
  }, [open, producto?.id, producto?.nombre, predecir, cargarAtributos]);

  const elegirCategoria = async (catId) => {
    const cat = categorias.find(c => String(c.category_id) === String(catId));
    setCategoryId(catId);
    setCategoryName(cat?.category_name ?? '');
    setValores({}); // los atributos dependen de la categoría
    quitarCatalogo(); // el catálogo también es por categoría — no vale el de otra
    setCatalogResultados([]);
    await cargarAtributos(catId);
  };

  const handleGuardar = async () => {
    if (!producto?.id || !user?.empresa_id) return;
    if (!categoryId) {
      toast({ title: 'Elegí una categoría', description: 'MercadoLibre la necesita para publicar.', variant: 'destructive' });
      return;
    }
    // Validar obligatorios completos.
    const faltan = atributosDef.filter(a => !valores[a.id]?.toString().trim());
    if (faltan.length) {
      toast({
        title: 'Faltan datos obligatorios',
        description: `Completá: ${faltan.map(a => a.name).join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    const atributos = atributosDef
      .filter(a => valores[a.id]?.toString().trim())
      .map(a => ({ id: a.id, value_name: valores[a.id].toString().trim() }));

    setGuardando(true);
    try {
      const { error } = await supabase
        .from('producto_mercadolibre_config')
        .upsert({
          empresa_id: user.empresa_id,
          producto_id: producto.id,
          category_id: categoryId,
          category_name: categoryName,
          condicion,
          atributos,
          catalog_product_id: catalogProductId || null,
          catalog_product_name: catalogProductId ? catalogProductName : null,
        }, { onConflict: 'producto_id' });

      if (error) {
        toast({ title: 'Error al guardar', description: error.message, variant: 'destructive' });
        return;
      }
      toast({ title: '✓ Configuración guardada', description: 'Se publicará en MercadoLibre en unos minutos.', className: 'bg-green-600 text-white border-green-700' });
      dispararPublicacionMercadoLibre();
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] bg-kx-surface border-kx-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-kx-text">Publicar en MercadoLibre — {producto?.nombre}</DialogTitle>
          <DialogDescription>
            MercadoLibre necesita una categoría y algunos datos obligatorios (marca, modelo, etc.) para publicar.
            Completalos una vez y el producto se publica solo.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-kx-text-2">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando…
          </div>
        ) : (
          <div className="space-y-4">
            {/* Buscador / predictor de categoría */}
            <div className="space-y-1.5">
              <Label className="text-xs">Categoría</Label>
              <div className="flex gap-2">
                <Input
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); predecir(busqueda); } }}
                  placeholder="Ej: termo stanley 1L"
                  className="kairox-input h-9 text-sm"
                />
                <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-1" onClick={() => predecir(busqueda)} disabled={buscandoCat}>
                  {buscandoCat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Buscar
                </Button>
              </div>
              <Select value={categoryId || undefined} onValueChange={elegirCategoria}>
                <SelectTrigger className="kairox-input h-9 text-sm">
                  <SelectValue placeholder={categorias.length ? '— Elegí la categoría —' : 'Buscá arriba para ver sugerencias'} />
                </SelectTrigger>
                <SelectContent>
                  {categorias.map(c => (
                    <SelectItem key={c.category_id} value={String(c.category_id)}>{c.category_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {categoryName && (
                <p className="text-2xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> {categoryName}
                </p>
              )}
            </div>

            {/* Enganche al catálogo oficial de MELI — necesario en casi todas las categorías reales */}
            {categoryId && (
              <div className="space-y-1.5">
                <Label className="text-xs">Producto del catálogo de MercadoLibre</Label>
                <p className="text-2xs text-kx-text-3">
                  MercadoLibre exige en la mayoría de las categorías enganchar la publicación a una
                  ficha de su catálogo oficial (no deja crear un aviso 100% libre). Buscá por marca y
                  modelo y elegí el que coincida.
                </p>
                {catalogProductId ? (
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20">
                    <span className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 min-w-0">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{catalogProductName}</span>
                    </span>
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs shrink-0" onClick={quitarCatalogo}>
                      Quitar
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Input
                        value={catalogQuery}
                        onChange={e => setCatalogQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscarCatalogo(catalogQuery, categoryId); } }}
                        placeholder="Ej: Philips Satinelle Advanced"
                        className="kairox-input h-9 text-sm"
                      />
                      <Button
                        type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-1"
                        onClick={() => buscarCatalogo(catalogQuery, categoryId)} disabled={buscandoCatalogo}
                      >
                        {buscandoCatalogo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        Buscar
                      </Button>
                    </div>
                    {catalogResultados.length > 0 && (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {catalogResultados.map(p => (
                          <button
                            type="button" key={p.catalog_product_id}
                            onClick={() => elegirCatalogo(p)}
                            className="w-full flex items-center gap-2 p-1.5 rounded-lg border border-kx-border hover:bg-kx-surface-2 text-left"
                          >
                            {p.pictures?.[0] && (
                              <img src={p.pictures[0]} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                            )}
                            <span className="text-xs text-kx-text truncate">{p.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {!buscandoCatalogo && catalogResultados.length === 0 && (
                      <p className="text-2xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <XCircle className="w-3 h-3 shrink-0" />
                        Sin match todavía, esta publicación puede fallar sin un producto de catálogo.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Condición */}
            <div className="space-y-1.5">
              <Label className="text-xs">Condición</Label>
              <Select value={condicion} onValueChange={setCondicion}>
                <SelectTrigger className="kairox-input h-9 text-sm w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Nuevo</SelectItem>
                  <SelectItem value="used">Usado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Atributos obligatorios de la categoría */}
            {cargandoAttrs ? (
              <div className="flex items-center text-xs text-kx-text-2 py-2">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Cargando datos obligatorios…
              </div>
            ) : categoryId && atributosDef.length === 0 ? (
              <p className="text-2xs text-kx-text-3">Esta categoría no pide datos obligatorios extra.</p>
            ) : (
              atributosDef.map(a => (
                <div key={a.id} className="space-y-1.5">
                  <Label className="text-xs">{a.name} <span className="text-red-500">*</span></Label>
                  {a.usa_dropdown ? (
                    <Select value={valores[a.id] || undefined} onValueChange={v => setValores(prev => ({ ...prev, [a.id]: v }))}>
                      <SelectTrigger className="kairox-input h-9 text-sm"><SelectValue placeholder="— Elegí —" /></SelectTrigger>
                      <SelectContent className="max-h-64">
                        {a.valores.map(v => (
                          <SelectItem key={v.id ?? v.name} value={v.name}>{v.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={valores[a.id] ?? ''}
                      onChange={e => setValores(prev => ({ ...prev, [a.id]: e.target.value }))}
                      placeholder={a.name}
                      className="kairox-input h-9 text-sm"
                    />
                  )}
                </div>
              ))
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2 border-t border-kx-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleGuardar} disabled={guardando || loading} className="gap-2">
            {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Guardar y publicar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ConfigMercadoLibreModal;
