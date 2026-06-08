import React, { useState, useEffect, useRef } from 'react';
import { Settings, Save, Building, Image as ImageIcon, Loader2, Upload, Trash2, AlertCircle, TrendingUp, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfig } from '@/contexts/ConfigContext';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';

const ConfiguracionSection = () => {
  const { config, updateConfig } = useConfig();
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  
  const [formData, setFormData] = useState({
    nombre_empresa: '',
    company_logo: '' // URL of the uploaded image
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // ── Configuración de Moneda Paralela ──────────────────────────────────────
  const [tcConfig, setTcConfig] = useState({ usa_tc_paralelo: false, moneda_paralela: 'USD' });
  const [loadingTC, setLoadingTC] = useState(false);
  const [savingTC, setSavingTC] = useState(false);

  useEffect(() => {
    if (config) {
      setFormData({
        nombre_empresa: config.nombre_empresa || '',
        company_logo: config.company_logo || config.logo_base64 || ''
      });
    }
  }, [config]);

  // Cargar configuración de moneda paralela desde la tabla empresas
  useEffect(() => {
    if (!user?.empresa_id) return;
    const loadTC = async () => {
      setLoadingTC(true);
      try {
        const { data } = await supabase
          .from('empresas')
          .select('usa_tc_paralelo, moneda_paralela')
          .eq('id', user.empresa_id)
          .single();
        if (data) setTcConfig({
          usa_tc_paralelo: data.usa_tc_paralelo ?? false,
          moneda_paralela: data.moneda_paralela ?? 'USD',
        });
      } catch (e) {
        console.error('[TC Paralela] Error al cargar config:', e);
      } finally {
        setLoadingTC(false);
      }
    };
    loadTC();
  }, [user?.empresa_id]);

  const handleSaveTC = async () => {
    if (!user?.empresa_id) return;
    setSavingTC(true);
    try {
      const { error } = await supabase
        .from('empresas')
        .update({
          usa_tc_paralelo: tcConfig.usa_tc_paralelo,
          moneda_paralela: tcConfig.moneda_paralela,
        })
        .eq('id', user.empresa_id);
      if (error) throw error;
      toast({
        title: 'Moneda paralela guardada',
        description: tcConfig.usa_tc_paralelo
          ? `Activada. El sistema pedirá el TC de ${tcConfig.moneda_paralela} antes de cada operación.`
          : 'Desactivada. El sistema no requerirá TC paralelo.',
        className: 'bg-green-600 text-white border-green-700',
      });
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingTC(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const convertToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Formato no soportado",
        description: "Sube una imagen PNG, JPG, SVG o WEBP.",
        variant: "destructive"
      });
      return;
    }

    const maxSize = 2 * 1024 * 1024; // 2MB — razonable para base64 en DB
    if (file.size > maxSize) {
      toast({
        title: "Archivo muy grande",
        description: "El logo debe pesar menos de 2MB. Comprime la imagen e intentá de nuevo.",
        variant: "destructive"
      });
      return;
    }

    try {
      setUploading(true);
      const base64 = await convertToBase64(file);
      setFormData(prev => ({ ...prev, company_logo: base64, logo_base64: base64 }));
      toast({
        title: "Logo cargado",
        description: "Hacé clic en Guardar para aplicar el cambio.",
        className: "bg-blue-600 text-white border-blue-500"
      });
    } catch (error) {
      toast({
        title: "Error al cargar el logo",
        description: error.message || "No se pudo procesar la imagen.",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveLogo = () => {
    setFormData(prev => ({ ...prev, company_logo: '' }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    toast({
      title: "Logo eliminado",
      description: "El logo se ha eliminado de la vista previa.",
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const result = await updateConfig(formData);
      
      if (result.success) {
        toast({
          title: "Configuración guardada",
          description: "Los datos de la empresa se han actualizado correctamente.",
          className: "bg-green-600 text-white border-green-500"
        });
      } else {
        throw new Error("No se pudo guardar en la base de datos.");
      }
    } catch (error) {
      console.error(error);
      toast({
        title: "Error al guardar",
        description: "Hubo un problema al guardar la configuración.",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center bg-white dark:bg-transparent p-6 -mx-6 -mt-6 mb-6 border-b border-slate-200 dark:border-none">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
            <Settings className="w-8 h-8 text-blue-600 dark:text-[#00D4FF]" />
            Configuración del Sistema
          </h2>
          <p className="text-slate-500 dark:text-slate-400">Personaliza la identidad visual de tu empresa</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Form Card */}
        <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 border-b kairox-border pb-2">
            Datos Generales
          </h3>
          
          <form onSubmit={handleSave} className="space-y-6">
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300">Nombre de la Empresa</Label>
              <div className="relative">
                <Building className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                <Input
                  name="nombre_empresa"
                  value={formData.nombre_empresa}
                  onChange={handleChange}
                  placeholder="Ej. Mi Empresa S.A."
                  className="pl-10 kairox-input"
                />
              </div>
              <p className="text-xs text-slate-500">Este nombre aparecerá en el encabezado y reportes.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300">Logo de la Empresa</Label>
              <div className="flex flex-col gap-3">
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept=".png, .jpg, .jpeg, .svg, .webp"
                  className="hidden"
                />
                
                <div className="flex gap-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full border-dashed border-2 border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-[#00D4FF] hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                    {uploading ? "Subiendo..." : "Subir Logo"}
                  </Button>
                  
                  {formData.company_logo && (
                    <Button 
                      type="button" 
                      variant="destructive"
                      onClick={handleRemoveLogo}
                      disabled={uploading}
                      className="bg-red-100 text-red-600 hover:bg-red-200 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Eliminar
                    </Button>
                  )}
                </div>
                
                <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 dark:bg-slate-900/50 p-3 rounded border kairox-border">
                   <AlertCircle className="w-4 h-4 shrink-0" />
                   <div>
                     Formatos: PNG, JPG, SVG, WEBP. <br/>
                     Tamaño máximo: 2MB. <br/>
                     El logo se guarda directamente en la base de datos.
                   </div>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <Button 
                type="submit" 
                disabled={saving || uploading}
                className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-[#00D4FF] dark:hover:bg-[#00D4FF]/90 text-white dark:text-black font-bold shadow-lg"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" /> Guardar Configuración
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>

        {/* Preview Card */}
        <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm flex flex-col items-center justify-center text-center space-y-6 bg-slate-50 dark:bg-slate-900/50">
          <div className="w-full max-w-sm p-6 bg-white dark:bg-slate-900 rounded-lg border kairox-border shadow-md">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Vista Previa</p>
            
            <div className="flex flex-col items-center gap-4">
              {formData.company_logo ? (
                <div className="h-32 flex items-center justify-center p-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg w-full bg-slate-50/50 dark:bg-slate-950/50">
                  <img 
                    src={formData.company_logo} 
                    alt="Logo Preview" 
                    className="max-h-full max-w-[200px] object-contain"
                  />
                </div>
              ) : (
                <div className="h-32 w-full bg-slate-100 dark:bg-slate-800 rounded-lg flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-700">
                  <ImageIcon className="h-10 w-10 text-slate-400 mb-2" />
                  <span className="text-xs text-slate-500">Sin logo configurado</span>
                </div>
              )}
              
              <div className="w-full">
                <h4 className="text-xl font-bold bg-gradient-to-r from-[#00D4FF] to-[#A855F7] bg-clip-text text-transparent break-words">
                  {formData.nombre_empresa || 'Nombre de Empresa'}
                </h4>
                <p className="text-xs text-slate-500 mt-1">Así se verá en la pantalla de inicio</p>
              </div>
            </div>
          </div>
          
          <div className="text-sm text-slate-500 max-w-xs">
            <p>Los cambios se aplicarán inmediatamente en toda la aplicación para todos los usuarios.</p>
          </div>
        </div>
      </div>
      {/* ── Moneda Paralela (TC) ─────────────────────────────────────────────── */}
      <div className="lg:col-span-2 kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
            <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Moneda Paralela (Tipo de Cambio)
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Similar a "Parallel Currency" en SAP S/4. Cuando está activo, el sistema exige el TC del día
              antes de cualquier movimiento contable y habilita el <strong>Reporte de Paridad ARS / {tcConfig.moneda_paralela}</strong>.
            </p>
          </div>
        </div>

        {loadingTC ? (
          <div className="flex items-center gap-2 text-slate-400 py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
          </div>
        ) : (
          <div className="space-y-5">
            {/* Toggle */}
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border kairox-border">
              <div>
                <Label className="text-slate-800 dark:text-slate-200 font-medium">
                  Activar moneda paralela
                </Label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {tcConfig.usa_tc_paralelo
                    ? 'El TC del día es obligatorio antes de vender, cotizar o registrar pagos.'
                    : 'El TC del día es opcional (solo para operaciones en moneda extranjera).'}
                </p>
              </div>
              <Switch
                checked={tcConfig.usa_tc_paralelo}
                onCheckedChange={v => setTcConfig(prev => ({ ...prev, usa_tc_paralelo: v }))}
              />
            </div>

            {/* Selector de moneda paralela */}
            {tcConfig.usa_tc_paralelo && (
              <div className="space-y-2 max-w-xs">
                <Label className="text-slate-700 dark:text-slate-300">Moneda paralela</Label>
                <Select
                  value={tcConfig.moneda_paralela}
                  onValueChange={v => setTcConfig(prev => ({ ...prev, moneda_paralela: v }))}
                >
                  <SelectTrigger className="h-9 dark:bg-slate-900 dark:border-slate-700 dark:text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD — Dólar estadounidense</SelectItem>
                    <SelectItem value="EUR">EUR — Euro</SelectItem>
                    <SelectItem value="BRL">BRL — Real brasileño</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Todos los comprobantes y movimientos se guardarán también en {tcConfig.moneda_paralela} usando el TC del día.
                </p>
              </div>
            )}

            {/* Info boxes */}
            {tcConfig.usa_tc_paralelo && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                {[
                  { icon: <CheckCircle2 className="h-3.5 w-3.5" />, text: 'TC obligatorio antes de operar' },
                  { icon: <CheckCircle2 className="h-3.5 w-3.5" />, text: `Comprobantes con equiv. ${tcConfig.moneda_paralela}` },
                  { icon: <CheckCircle2 className="h-3.5 w-3.5" />, text: 'Reporte de Paridad habilitado' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2 border border-emerald-200 dark:border-emerald-800">
                    {item.icon}
                    {item.text}
                  </div>
                ))}
              </div>
            )}

            <Button
              onClick={handleSaveTC}
              disabled={savingTC}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {savingTC
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</>
                : <><Save className="mr-2 h-4 w-4" /> Guardar configuración de moneda</>}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfiguracionSection;