import React, { useState, useEffect, useRef } from 'react';
import { Settings, Save, Building, Image as ImageIcon, Loader2, Upload, Trash2, AlertCircle, LayoutDashboard, Package, ShoppingCart, ArrowLeftRight, Wallet, FileText, Users, Contact, CreditCard, ClipboardList, ShoppingBag, BookOpen, Banknote, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useConfig, ALL_MODULES } from '@/contexts/ConfigContext';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const MODULE_ICONS = {
  dashboard:        LayoutDashboard,
  productos:        Package,
  ventas:           ShoppingCart,
  cotizaciones:     ClipboardList,
  compras:          ArrowLeftRight,
  ordenes_compra:   ShoppingBag,
  caja:             Wallet,
  'movimientos-uala': Banknote,
  clientes:         Contact,
  cuentacorriente:  CreditCard,
  plan_cuentas:     BookOpen,
  reportes:         FileText,
  usuarios:         Users,
  configuracion:    Settings,
};

const ConfiguracionSection = () => {
  const { config, updateConfig, isModuloActivo } = useConfig();
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  
  const [formData, setFormData] = useState({
    nombre_empresa: '',
    company_logo: '' // URL of the uploaded image
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingModulos, setSavingModulos] = useState(false);

  // Estado local de módulos: { [id]: boolean }
  const [modulosState, setModulosState] = useState(() =>
    Object.fromEntries(ALL_MODULES.map(m => [m.id, true]))
  );

  useEffect(() => {
    if (config) {
      setFormData({
        nombre_empresa: config.nombre_empresa || '',
        company_logo: config.company_logo || config.logo_base64 || ''
      });
      // Sincronizar switches con la configuración guardada
      setModulosState(
        Object.fromEntries(ALL_MODULES.map(m => [m.id, isModuloActivo(m.id)]))
      );
    }
  }, [config, isModuloActivo]);

  const handleToggleModulo = (moduleId) => {
    const mod = ALL_MODULES.find(m => m.id === moduleId);
    if (mod?.required) return; // no se puede deshabilitar
    setModulosState(prev => ({ ...prev, [moduleId]: !prev[moduleId] }));
  };

  const handleSaveModulos = async () => {
    setSavingModulos(true);
    // Guardar solo los habilitados (required siempre true, no es necesario incluirlos)
    const activos = ALL_MODULES
      .filter(m => m.required || modulosState[m.id])
      .map(m => m.id);
    const result = await updateConfig({ modulos_activos: JSON.stringify(activos) });
    setSavingModulos(false);
    if (result.success) {
      toast({ title: 'Módulos actualizados', description: 'Los cambios se aplicaron inmediatamente.', className: 'bg-green-600 text-white border-green-700' });
    } else {
      toast({ title: 'Error al guardar módulos', variant: 'destructive' });
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

      {/* ── Módulos del Sistema ── */}
      <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
        <div className="flex items-center justify-between mb-5 border-b kairox-border pb-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Módulos del Sistema</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Activá o desactivá los módulos que tu empresa necesita. Los módulos desactivados no aparecen en el menú.
            </p>
          </div>
          <Button
            onClick={handleSaveModulos}
            disabled={savingModulos}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 dark:bg-[#00D4FF] dark:hover:bg-[#00D4FF]/90 text-white dark:text-black font-bold"
          >
            {savingModulos ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
            Guardar módulos
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ALL_MODULES.map(mod => {
            const Icon = MODULE_ICONS[mod.id] || Settings;
            const isActive = modulosState[mod.id] ?? true;
            return (
              <div
                key={mod.id}
                className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                  isActive
                    ? 'border-blue-200 bg-blue-50/50 dark:border-blue-900/50 dark:bg-blue-900/10'
                    : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/30 opacity-60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-blue-500 dark:text-[#00D4FF]' : 'text-slate-400'}`} />
                  <span className={`text-sm font-medium ${isActive ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'}`}>
                    {mod.label}
                  </span>
                  {mod.required && (
                    <Lock className="w-3 h-3 text-slate-400" title="Módulo obligatorio" />
                  )}
                </div>
                <Switch
                  checked={isActive}
                  onCheckedChange={() => handleToggleModulo(mod.id)}
                  disabled={mod.required}
                  className="data-[state=checked]:bg-blue-500 dark:data-[state=checked]:bg-[#00D4FF]"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ConfiguracionSection;