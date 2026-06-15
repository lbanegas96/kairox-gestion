import React, { useState, useEffect, useRef } from 'react';
import {
  Settings, Save, Building, Image as ImageIcon, Loader2, Upload, Trash2,
  AlertCircle, TrendingUp, CheckCircle2, FileText, Check, Download,
  Users, Puzzle, Bell, Package2, Info, Mail, MapPin, Hash,
  CreditCard, Warehouse, BarChart3, Cpu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConfig } from '@/contexts/ConfigContext';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import UsuariosSection from '@/components/sections/UsuariosSection';
import IntegracionCard from '@/components/shared/IntegracionCard';

const formatCuit = (raw) => {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length !== 11) return raw ?? '';
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
};

const TAB_IDS = ['empresa', 'finanzas', 'facturacion', 'inventario', 'integraciones', 'alertas', 'usuarios', 'sistema'];

const TABS = [
  { id: 'empresa',        label: 'Empresa',       Icon: Building    },
  { id: 'finanzas',       label: 'Finanzas',       Icon: TrendingUp  },
  { id: 'facturacion',    label: 'Facturación',    Icon: FileText    },
  { id: 'inventario',     label: 'Inventario',     Icon: Package2    },
  { id: 'integraciones',  label: 'Integraciones',  Icon: Puzzle      },
  { id: 'alertas',        label: 'Alertas',        Icon: Bell        },
  { id: 'usuarios',       label: 'Usuarios',       Icon: Users       },
  { id: 'sistema',        label: 'Sistema',        Icon: Cpu         },
];

const ConfiguracionSection = ({ initialTab }) => {
  const { config, updateConfig } = useConfig();
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef(null);

  const [activeTab, setActiveTab] = useState(
    initialTab && TAB_IDS.includes(initialTab) ? initialTab : 'empresa'
  );

  useEffect(() => {
    if (initialTab && TAB_IDS.includes(initialTab)) setActiveTab(initialTab);
  }, [initialTab]);

  // ── Tab 1: Empresa ────────────────────────────────────────────────────────
  const [formData, setFormData] = useState({
    nombre_empresa: '',
    company_logo: '',
    email_empresa: '',
    direccion: '',
    rubro: '',
    provincia: '',
    localidad: '',
    cp: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [empresaDatos, setEmpresaDatos] = useState({ afip_cuit: null, condicion_iva: null });

  // ── Tab 2: Finanzas ───────────────────────────────────────────────────────
  const [tcConfig, setTcConfig] = useState({ usa_tc_paralelo: false, moneda_paralela: 'USD' });
  const [loadingTC, setLoadingTC] = useState(false);
  const [savingTC, setSavingTC] = useState(false);

  // ── Tab 3: Facturación ────────────────────────────────────────────────────
  const [afipConfig, setAfipConfig] = useState({
    usa_factura_electronica: false,
    condicion_iva: null,
    afip_cuit: null,
    nombre: '',
  });
  const [puntosVenta, setPuntosVenta] = useState([]);
  const [loadingAFIP, setLoadingAFIP] = useState(false);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [afipForm, setAfipForm] = useState({
    cuit: '',
    condicion_iva: 'RI',
    pv_numero: '',
    pv_nombre: 'Punto de Venta Principal',
    tipo_comprobante_default: 'B',
    crt_content: '',
  });
  const [csrGenerado, setCsrGenerado] = useState(null);
  const [generandoCsr, setGenerandoCsr] = useState(false);
  const [subiendoConfig, setSubiendoConfig] = useState(false);

  // ── Tab 6: Alertas ────────────────────────────────────────────────────────
  const ALERTA_KEYS = [
    'alerta_stock_bajo', 'alerta_stock_umbral',
    'alerta_vencimiento_cc', 'alerta_vencimiento_dias',
    'alerta_caja_apertura',
    'alerta_cheque_vencimiento', 'alerta_cheque_dias',
  ];
  const [alertas, setAlertas] = useState({
    alerta_stock_bajo: true,
    alerta_stock_umbral: '5',
    alerta_vencimiento_cc: true,
    alerta_vencimiento_dias: '30',
    alerta_caja_apertura: true,
    alerta_cheque_vencimiento: true,
    alerta_cheque_dias: '7',
  });
  const [loadingAlertas, setLoadingAlertas] = useState(false);
  const [savingAlertas, setSavingAlertas] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────────────────────
  const puntoVentaActivo = puntosVenta?.[0];
  const afipConfigCompleta = !!(afipConfig.afip_cuit && afipConfig.condicion_iva && puntoVentaActivo);

  // ─────────────────────────────────────────────────────────────────────────
  // Data loaders
  // ─────────────────────────────────────────────────────────────────────────
  const reloadAFIP = async () => {
    if (!user?.empresa_id) return;
    setLoadingAFIP(true);
    try {
      const { data: emp } = await supabase
        .from('empresas')
        .select('usa_factura_electronica, condicion_iva, afip_cuit, nombre')
        .eq('id', user.empresa_id)
        .single();
      if (emp) {
        setAfipConfig({
          usa_factura_electronica: emp.usa_factura_electronica ?? false,
          condicion_iva: emp.condicion_iva ?? null,
          afip_cuit: emp.afip_cuit ?? null,
          nombre: emp.nombre ?? '',
        });
        setEmpresaDatos({ afip_cuit: emp.afip_cuit ?? null, condicion_iva: emp.condicion_iva ?? null });
      }
      const { data: pvs } = await supabase
        .from('puntos_venta')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .eq('activo', true)
        .order('numero');
      setPuntosVenta(pvs ?? []);
    } catch (e) {
      console.error('[AFIP] Error al cargar config:', e);
    } finally {
      setLoadingAFIP(false);
    }
  };

  useEffect(() => { reloadAFIP(); }, [user?.empresa_id]);

  useEffect(() => {
    if (config) {
      setFormData({
        nombre_empresa:  config.nombre_empresa  || '',
        company_logo:    config.company_logo    || config.logo_base64 || '',
        email_empresa:   config.email_empresa   || '',
        direccion:       config.direccion       || '',
        rubro:           config.rubro           || '',
        provincia:       config.provincia       || '',
        localidad:       config.localidad       || '',
        cp:              config.cp              || '',
      });
    }
  }, [config]);

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
        if (data) setTcConfig({ usa_tc_paralelo: data.usa_tc_paralelo ?? false, moneda_paralela: data.moneda_paralela ?? 'USD' });
      } catch (e) {
        console.error('[TC Paralela] Error al cargar config:', e);
      } finally {
        setLoadingTC(false);
      }
    };
    loadTC();
  }, [user?.empresa_id]);

  useEffect(() => {
    if (!user?.empresa_id) return;
    const loadAlertas = async () => {
      setLoadingAlertas(true);
      try {
        const { data } = await supabase
          .from('configuracion')
          .select('clave, valor')
          .eq('empresa_id', user.empresa_id)
          .in('clave', ALERTA_KEYS);
        if (data?.length) {
          const map = Object.fromEntries(data.map(r => [r.clave, r.valor]));
          setAlertas(prev => ({
            alerta_stock_bajo:        map.alerta_stock_bajo        !== undefined ? map.alerta_stock_bajo === 'true'        : prev.alerta_stock_bajo,
            alerta_stock_umbral:      map.alerta_stock_umbral      ?? prev.alerta_stock_umbral,
            alerta_vencimiento_cc:    map.alerta_vencimiento_cc    !== undefined ? map.alerta_vencimiento_cc === 'true'    : prev.alerta_vencimiento_cc,
            alerta_vencimiento_dias:  map.alerta_vencimiento_dias  ?? prev.alerta_vencimiento_dias,
            alerta_caja_apertura:     map.alerta_caja_apertura     !== undefined ? map.alerta_caja_apertura === 'true'     : prev.alerta_caja_apertura,
            alerta_cheque_vencimiento:map.alerta_cheque_vencimiento!== undefined ? map.alerta_cheque_vencimiento === 'true': prev.alerta_cheque_vencimiento,
            alerta_cheque_dias:       map.alerta_cheque_dias       ?? prev.alerta_cheque_dias,
          }));
        }
      } catch (e) {
        console.error('[Alertas] Error al cargar:', e);
      } finally {
        setLoadingAlertas(false);
      }
    };
    loadAlertas();
  }, [user?.empresa_id]);

  // ─────────────────────────────────────────────────────────────────────────
  // Tab 1 handlers
  // ─────────────────────────────────────────────────────────────────────────
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
      toast({ title: 'Formato no soportado', description: 'Sube una imagen PNG, JPG, SVG o WEBP.', variant: 'destructive' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'Archivo muy grande', description: 'El logo debe pesar menos de 2MB. Comprime la imagen e intentá de nuevo.', variant: 'destructive' });
      return;
    }
    try {
      setUploading(true);
      const base64 = await convertToBase64(file);
      setFormData(prev => ({ ...prev, company_logo: base64, logo_base64: base64 }));
      toast({ title: 'Logo cargado', description: 'Hacé clic en Guardar para aplicar el cambio.', className: 'bg-blue-600 text-white border-blue-500' });
    } catch (error) {
      toast({ title: 'Error al cargar el logo', description: error.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveLogo = () => {
    setFormData(prev => ({ ...prev, company_logo: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
    toast({ title: 'Logo eliminado', description: 'El logo se ha eliminado de la vista previa.' });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await updateConfig(formData);
      if (result.success) {
        toast({ title: 'Configuración guardada', description: 'Los datos de la empresa se han actualizado correctamente.', className: 'bg-green-600 text-white border-green-500' });
      } else {
        throw new Error('No se pudo guardar en la base de datos.');
      }
    } catch (error) {
      console.error(error);
      toast({ title: 'Error al guardar', description: 'Hubo un problema al guardar la configuración.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Tab 2 handlers
  // ─────────────────────────────────────────────────────────────────────────
  const handleSaveTC = async () => {
    if (!user?.empresa_id) return;
    setSavingTC(true);
    try {
      const { error } = await supabase
        .from('empresas')
        .update({ usa_tc_paralelo: tcConfig.usa_tc_paralelo, moneda_paralela: tcConfig.moneda_paralela })
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

  // ─────────────────────────────────────────────────────────────────────────
  // Tab 3 handlers
  // ─────────────────────────────────────────────────────────────────────────
  const openWizard = () => {
    setAfipForm({
      cuit: afipConfig.afip_cuit ? formatCuit(afipConfig.afip_cuit) : '',
      condicion_iva: afipConfig.condicion_iva ?? 'RI',
      pv_numero: puntoVentaActivo?.numero ? String(puntoVentaActivo.numero) : '',
      pv_nombre: puntoVentaActivo?.nombre ?? 'Punto de Venta Principal',
      tipo_comprobante_default: puntoVentaActivo?.tipo_comprobante_default ?? 'B',
      crt_content: '',
    });
    setCsrGenerado(null);
    setWizardStep(1);
    setWizardOpen(true);
  };

  const handleToggleAFIP = async (checked) => {
    if (checked && !afipConfigCompleta) { openWizard(); return; }
    try {
      const { error } = await supabase
        .from('empresas')
        .update({ usa_factura_electronica: checked })
        .eq('id', user.empresa_id);
      if (error) throw error;
      await reloadAFIP();
      toast({ title: checked ? 'Facturación electrónica activada' : 'Facturación electrónica desactivada' });
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleGenerarCSR = async () => {
    setGenerandoCsr(true);
    try {
      const { data, error } = await supabase.functions.invoke('generar-csr', {
        body: { cuit: afipForm.cuit.replace(/\D/g, ''), razon_social: config?.nombre_empresa || afipConfig.nombre || 'KAIROX' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCsrGenerado(data.csr);
      toast({ title: 'Archivo generado', description: 'Descargá el archivo y subilo en ARCA.' });
    } catch (err) {
      toast({ title: 'Error al generar', description: err.message, variant: 'destructive' });
    } finally {
      setGenerandoCsr(false);
    }
  };

  const handleDescargarCSR = () => {
    if (!csrGenerado) return;
    const blob = new Blob([csrGenerado], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kairox_${afipForm.cuit.replace(/\D/g, '')}.csr`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCertUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setAfipForm(f => ({ ...f, crt_content: ev.target?.result ?? '' }));
    reader.readAsText(file);
  };

  const handleGuardarConfigAFIP = async () => {
    setSubiendoConfig(true);
    try {
      const { data: certData, error: vaultError } = await supabase.functions.invoke('generar-csr', {
        body: { action: 'store_cert', cert_content: afipForm.crt_content },
      });
      if (vaultError) throw vaultError;
      if (certData?.error) throw new Error(certData.error);

      const { error: empError } = await supabase
        .from('empresas')
        .update({
          usa_factura_electronica: true,
          condicion_iva: afipForm.condicion_iva,
          afip_cuit: afipForm.cuit.replace(/\D/g, ''),
        })
        .eq('id', user.empresa_id);
      if (empError) throw empError;

      const { error: pvError } = await supabase
        .from('puntos_venta')
        .upsert({
          empresa_id: user.empresa_id,
          numero: parseInt(afipForm.pv_numero, 10),
          nombre: afipForm.pv_nombre,
          tipo_comprobante_default: afipForm.tipo_comprobante_default,
          activo: true,
        }, { onConflict: 'empresa_id,numero' });
      if (pvError) throw pvError;

      toast({ title: '✓ Facturación electrónica activada', description: 'Ya podés emitir facturas con CAE automático.', className: 'bg-green-600 text-white border-green-700' });
      setWizardOpen(false);
      await reloadAFIP();
    } catch (err) {
      toast({ title: 'Error al guardar', description: err.message, variant: 'destructive' });
    } finally {
      setSubiendoConfig(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Tab 6 handlers
  // ─────────────────────────────────────────────────────────────────────────
  const handleSaveAlertas = async () => {
    if (!user?.empresa_id) return;
    setSavingAlertas(true);
    try {
      const entries = Object.entries(alertas).map(([clave, valor]) => ({
        empresa_id: user.empresa_id,
        clave,
        valor: String(valor),
      }));
      const { error } = await supabase
        .from('configuracion')
        .upsert(entries, { onConflict: 'empresa_id,clave' });
      if (error) throw error;
      toast({ title: 'Alertas guardadas', className: 'bg-green-600 text-white border-green-700' });
    } catch (e) {
      toast({ title: 'Error al guardar alertas', description: e.message, variant: 'destructive' });
    } finally {
      setSavingAlertas(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center bg-kx-surface dark:bg-transparent p-6 -mx-6 -mt-6 mb-6 border-b border-kx-border dark:border-none">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-kx-text mb-1 flex items-center gap-2">
            <Settings className="w-8 h-8 text-blue-600 dark:text-[#00D4FF]" />
            Configuración del Sistema
          </h2>
          <p className="text-slate-500 dark:text-kx-text-2">Administración centralizada — toda la configuración en un solo lugar</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Tab list */}
        <TabsList className="flex flex-wrap gap-1 h-auto p-1 bg-kx-surface-2 dark:bg-kx-surface-2 border border-kx-border rounded-xl mb-6 w-full">
          {TABS.map(({ id, label, Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg data-[state=active]:bg-kx-surface data-[state=active]:text-kx-text data-[state=active]:shadow-sm text-kx-text-2 hover:text-kx-text transition-colors"
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 1 — EMPRESA
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="empresa">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Formulario */}
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
              <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text mb-6 border-b kairox-border pb-2">
                Identidad y Datos de Contacto
              </h3>
              <form onSubmit={handleSave} className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-slate-300">Nombre de la Empresa</Label>
                  <div className="relative">
                    <Building className="absolute left-3 top-2.5 h-5 w-5 text-kx-text-3" />
                    <Input name="nombre_empresa" value={formData.nombre_empresa} onChange={handleChange} placeholder="Ej. Mi Empresa S.A." className="pl-10 kairox-input" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-slate-700 dark:text-slate-300">Email de contacto</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 h-4 w-4 text-kx-text-3" />
                      <Input name="email_empresa" value={formData.email_empresa} onChange={handleChange} placeholder="info@empresa.com" className="pl-9 kairox-input" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-700 dark:text-slate-300">Rubro / Actividad</Label>
                    <Input name="rubro" value={formData.rubro} onChange={handleChange} placeholder="Ej. Comercio al por menor" className="kairox-input" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-slate-300">Dirección</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-kx-text-3" />
                    <Input name="direccion" value={formData.direccion} onChange={handleChange} placeholder="Av. Corrientes 1234" className="pl-9 kairox-input" />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2 col-span-2">
                    <Label className="text-slate-700 dark:text-slate-300">Localidad</Label>
                    <Input name="localidad" value={formData.localidad} onChange={handleChange} placeholder="Buenos Aires" className="kairox-input" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-700 dark:text-slate-300">CP</Label>
                    <div className="relative">
                      <Hash className="absolute left-3 top-2.5 h-4 w-4 text-kx-text-3" />
                      <Input name="cp" value={formData.cp} onChange={handleChange} placeholder="1000" className="pl-9 kairox-input" />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-slate-300">Provincia</Label>
                  <Input name="provincia" value={formData.provincia} onChange={handleChange} placeholder="Buenos Aires" className="kairox-input" />
                </div>

                {/* CUIT / condicion_iva — read-only, gestionados desde pestaña Facturación */}
                {(empresaDatos.afip_cuit || empresaDatos.condicion_iva) && (
                  <div className="p-3 bg-kx-surface-2 rounded-lg border border-kx-border">
                    <p className="text-xs font-medium text-kx-text-2 mb-2">Datos fiscales AFIP — configurados en la pestaña Facturación</p>
                    <div className="flex gap-4 text-xs">
                      {empresaDatos.afip_cuit && (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <Check className="w-3 h-3" /> CUIT {formatCuit(empresaDatos.afip_cuit)}
                        </span>
                      )}
                      {empresaDatos.condicion_iva && (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <Check className="w-3 h-3" /> {empresaDatos.condicion_iva}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Logo */}
                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-slate-300">Logo de la Empresa</Label>
                  <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept=".png,.jpg,.jpeg,.svg,.webp" className="hidden" />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                      className="w-full border-dashed border-2 border-slate-300 dark:border-kx-border hover:border-blue-500 dark:hover:border-[#00D4FF] hover:bg-kx-surface-2">
                      {uploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Subiendo...</> : <><Upload className="w-4 h-4 mr-2" /> Subir Logo</>}
                    </Button>
                    {formData.company_logo && (
                      <Button type="button" variant="destructive" onClick={handleRemoveLogo} disabled={uploading}
                        className="bg-red-100 text-red-600 hover:bg-red-200 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50">
                        <Trash2 className="w-4 h-4 mr-2" /> Eliminar
                      </Button>
                    )}
                  </div>
                  <div className="flex items-start gap-2 text-xs text-slate-500 bg-kx-surface-2 dark:bg-slate-900/50 p-3 rounded border kairox-border">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <div>Formatos: PNG, JPG, SVG, WEBP.<br />Tamaño máximo: 2MB.<br />El logo se guarda directamente en la base de datos.</div>
                  </div>
                </div>

                <div className="pt-2">
                  <Button type="submit" disabled={saving || uploading}
                    className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-[#00D4FF] dark:hover:bg-[#00D4FF]/90 text-white dark:text-black font-bold shadow-lg">
                    {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar Datos de Empresa</>}
                  </Button>
                </div>
              </form>
            </div>

            {/* Vista previa */}
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm flex flex-col items-center justify-center text-center space-y-6 bg-kx-surface-2 dark:bg-slate-900/50">
              <div className="w-full max-w-sm p-6 bg-kx-surface dark:bg-kx-surface rounded-lg border kairox-border shadow-md">
                <p className="text-xs font-bold text-kx-text-3 uppercase tracking-widest mb-4">Vista Previa</p>
                <div className="flex flex-col items-center gap-4">
                  {formData.company_logo ? (
                    <div className="h-32 flex items-center justify-center p-2 border border-dashed border-kx-border dark:border-kx-border rounded-lg w-full bg-slate-50/50 dark:bg-slate-950/50">
                      <img src={formData.company_logo} alt="Logo Preview" className="max-h-full max-w-[200px] object-contain" />
                    </div>
                  ) : (
                    <div className="h-32 w-full bg-slate-100 dark:bg-kx-surface-2 rounded-lg flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-kx-border">
                      <ImageIcon className="h-10 w-10 text-kx-text-3 mb-2" />
                      <span className="text-xs text-slate-500">Sin logo configurado</span>
                    </div>
                  )}
                  <div className="w-full">
                    <h4 className="text-xl font-bold bg-gradient-to-r from-[#00D4FF] to-[#A855F7] bg-clip-text text-transparent break-words">
                      {formData.nombre_empresa || 'Nombre de Empresa'}
                    </h4>
                    {(formData.localidad || formData.provincia) && (
                      <p className="text-xs text-slate-500 mt-1">
                        {[formData.localidad, formData.provincia].filter(Boolean).join(', ')}
                      </p>
                    )}
                    {formData.email_empresa && <p className="text-xs text-slate-400 mt-0.5">{formData.email_empresa}</p>}
                    <p className="text-xs text-slate-500 mt-2">Así se verá en la pantalla de inicio</p>
                  </div>
                </div>
              </div>
              <p className="text-sm text-slate-500 max-w-xs">Los cambios se aplicarán inmediatamente para todos los usuarios.</p>
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 2 — FINANZAS Y MONEDA
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="finanzas">
          <div className="space-y-6 max-w-2xl">
            {/* Moneda Paralela */}
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
              <div className="flex items-start gap-3 mb-4">
                <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
                  <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Moneda Paralela (Tipo de Cambio)</h3>
                  <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
                    Similar a "Parallel Currency" en SAP S/4. Cuando está activo, el sistema exige el TC del día
                    antes de cualquier movimiento contable y habilita el <strong>Reporte de Paridad ARS / {tcConfig.moneda_paralela}</strong>.
                  </p>
                </div>
              </div>

              {loadingTC ? (
                <div className="flex items-center gap-2 text-kx-text-3 py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center justify-between p-4 bg-kx-surface-2 dark:bg-slate-900/50 rounded-lg border kairox-border">
                    <div>
                      <Label className="text-kx-text dark:text-kx-text font-medium">Activar moneda paralela</Label>
                      <p className="text-xs text-slate-500 dark:text-kx-text-2 mt-0.5">
                        {tcConfig.usa_tc_paralelo
                          ? 'El TC del día es obligatorio antes de vender, cotizar o registrar pagos.'
                          : 'El TC del día es opcional (solo para operaciones en moneda extranjera).'}
                      </p>
                    </div>
                    <Switch checked={tcConfig.usa_tc_paralelo} onCheckedChange={v => setTcConfig(prev => ({ ...prev, usa_tc_paralelo: v }))} />
                  </div>

                  {tcConfig.usa_tc_paralelo && (
                    <div className="space-y-2 max-w-xs">
                      <Label className="text-slate-700 dark:text-slate-300">Moneda paralela</Label>
                      <Select value={tcConfig.moneda_paralela} onValueChange={v => setTcConfig(prev => ({ ...prev, moneda_paralela: v }))}>
                        <SelectTrigger className="h-9 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USD">USD — Dólar estadounidense</SelectItem>
                          <SelectItem value="EUR">EUR — Euro</SelectItem>
                          <SelectItem value="BRL">BRL — Real brasileño</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-kx-text-3">
                        Todos los comprobantes y movimientos se guardarán también en {tcConfig.moneda_paralela} usando el TC del día.
                      </p>
                    </div>
                  )}

                  {tcConfig.usa_tc_paralelo && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      {[
                        'TC obligatorio antes de operar',
                        `Comprobantes con equiv. ${tcConfig.moneda_paralela}`,
                        'Reporte de Paridad habilitado',
                      ].map((text, i) => (
                        <div key={i} className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2 border border-emerald-200 dark:border-emerald-800">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {text}
                        </div>
                      ))}
                    </div>
                  )}

                  <Button onClick={handleSaveTC} disabled={savingTC} className="bg-blue-600 hover:bg-blue-700 text-white">
                    {savingTC ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar configuración de moneda</>}
                  </Button>
                </div>
              )}
            </div>

            {/* Condiciones de pago — placeholder */}
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm opacity-60">
              <div className="flex items-center gap-2 mb-3">
                <CreditCard className="w-5 h-5 text-kx-text-3" />
                <h3 className="font-semibold text-kx-text">Condiciones de Pago</h3>
                <span className="text-xs bg-kx-surface-2 text-kx-text-3 px-2 py-0.5 rounded-full border border-kx-border">Próximamente</span>
              </div>
              <p className="text-sm text-kx-text-2">Configuración de plazos (contado, 30/60/90 días, etc.) para clientes y proveedores.</p>
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 3 — FACTURACIÓN Y DOCUMENTOS
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="facturacion">
          <div className="space-y-6 max-w-2xl">
            {/* AFIP toggle */}
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-kx-text dark:text-kx-text">Facturación Electrónica AFIP/ARCA</h3>
                    <p className="text-sm text-slate-500 dark:text-kx-text-2">Emití facturas electrónicas con CAE automático</p>
                  </div>
                </div>
                {loadingAFIP
                  ? <Loader2 className="h-5 w-5 animate-spin text-kx-text-3" />
                  : <Switch checked={afipConfig.usa_factura_electronica ?? false} onCheckedChange={handleToggleAFIP} />
                }
              </div>

              {afipConfig.usa_factura_electronica && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {afipConfigCompleta ? (
                    <>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-full px-3 py-1">
                        <Check className="w-3 h-3" /> CUIT {formatCuit(afipConfig.afip_cuit)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-full px-3 py-1">
                        <Check className="w-3 h-3" /> {afipConfig.condicion_iva}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-full px-3 py-1">
                        <Check className="w-3 h-3" /> Punto de venta {puntoVentaActivo?.numero}
                      </span>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-blue-600 dark:text-blue-400" onClick={openWizard}>
                        Editar configuración
                      </Button>
                    </>
                  ) : (
                    <div className="flex items-center justify-between w-full gap-3 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-full px-3 py-1">
                        <AlertCircle className="w-3 h-3" /> Completá la configuración para emitir facturas
                      </span>
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={openWizard}>
                        Completar configuración
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tipos de comprobante — placeholder */}
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm opacity-60">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-5 h-5 text-kx-text-3" />
                <h3 className="font-semibold text-kx-text">Tipos de Comprobante</h3>
                <span className="text-xs bg-kx-surface-2 text-kx-text-3 px-2 py-0.5 rounded-full border border-kx-border">Próximamente</span>
              </div>
              <p className="text-sm text-kx-text-2">Configurar series, numeración y habilitación por tipo (A, B, C, remito, etc.).</p>
            </div>

            {/* Pie de documento — placeholder */}
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm opacity-60">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-5 h-5 text-kx-text-3" />
                <h3 className="font-semibold text-kx-text">Pie de Documento</h3>
                <span className="text-xs bg-kx-surface-2 text-kx-text-3 px-2 py-0.5 rounded-full border border-kx-border">Próximamente</span>
              </div>
              <p className="text-sm text-kx-text-2">Texto libre que aparece al pie de facturas, remitos y cotizaciones impresas.</p>
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 4 — INVENTARIO
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="inventario">
          <div className="space-y-6 max-w-2xl">
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm opacity-60">
              <div className="flex items-center gap-2 mb-3">
                <Warehouse className="w-5 h-5 text-kx-text-3" />
                <h3 className="font-semibold text-kx-text">Método de Valoración de Stock</h3>
                <span className="text-xs bg-kx-surface-2 text-kx-text-3 px-2 py-0.5 rounded-full border border-kx-border">Próximamente</span>
              </div>
              <p className="text-sm text-kx-text-2">FIFO, LIFO o Precio Promedio Ponderado. El método afecta el cálculo del costo de ventas.</p>
            </div>

            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm opacity-60">
              <div className="flex items-center gap-2 mb-3">
                <Package2 className="w-5 h-5 text-kx-text-3" />
                <h3 className="font-semibold text-kx-text">Unidades de Medida</h3>
                <span className="text-xs bg-kx-surface-2 text-kx-text-3 px-2 py-0.5 rounded-full border border-kx-border">Próximamente</span>
              </div>
              <p className="text-sm text-kx-text-2">Definición de unidades personalizadas (kg, lt, m², caja de 12, etc.) con factores de conversión.</p>
            </div>

            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm opacity-60">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-5 h-5 text-kx-text-3" />
                <h3 className="font-semibold text-kx-text">Stock Mínimo Global</h3>
                <span className="text-xs bg-kx-surface-2 text-kx-text-3 px-2 py-0.5 rounded-full border border-kx-border">Próximamente</span>
              </div>
              <p className="text-sm text-kx-text-2">Umbral global para alertas de stock bajo (puede sobreescribirse por producto).</p>
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 5 — INTEGRACIONES
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="integraciones">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <IntegracionCard
              nombre="Mercado Pago"
              descripcion="Procesamiento de pagos con tarjeta, QR y billetera virtual directamente desde el POS."
              estado="proximamente"
              logo="🛒"
            />
            <IntegracionCard
              nombre="Ualá"
              descripcion="Pagos con QR Ualá desde la pantalla de caja. Cobros instantáneos sin hardware adicional."
              estado="proximamente"
              logo="💳"
            />
            <IntegracionCard
              nombre="AFIP / ARCA"
              descripcion="Facturación electrónica con CAE automático. Configurado en la pestaña Facturación."
              estado={afipConfig.usa_factura_electronica ? 'activo' : 'inactivo'}
              logo="🏛️"
              onConfigure={() => setActiveTab('facturacion')}
            />
            <IntegracionCard
              nombre="WhatsApp Business"
              descripcion="Envío de presupuestos y facturas por WhatsApp directamente desde KAIROX."
              estado="proximamente"
              logo="💬"
            />
            <IntegracionCard
              nombre="Google Sheets"
              descripcion="Exportación periódica de reportes a Google Sheets para análisis externos."
              estado="proximamente"
              logo="📊"
            />
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 6 — ALERTAS
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="alertas">
          <div className="space-y-4 max-w-2xl">
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
              <h3 className="text-lg font-bold text-kx-text mb-5 flex items-center gap-2">
                <Bell className="w-5 h-5 text-amber-500" />
                Configuración de Alertas
              </h3>

              {loadingAlertas ? (
                <div className="flex items-center gap-2 text-kx-text-3 py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Alerta stock bajo */}
                  <div className="flex items-start justify-between gap-4 p-4 bg-kx-surface-2 rounded-lg border border-kx-border">
                    <div className="flex-1">
                      <p className="font-medium text-kx-text text-sm">Alerta de stock bajo</p>
                      <p className="text-xs text-kx-text-2 mt-0.5">Notificar cuando el stock de un producto baje del umbral definido.</p>
                      {alertas.alerta_stock_bajo && (
                        <div className="flex items-center gap-2 mt-3">
                          <span className="text-xs text-kx-text-2">Umbral:</span>
                          <Input
                            type="number" min="0"
                            value={alertas.alerta_stock_umbral}
                            onChange={e => setAlertas(prev => ({ ...prev, alerta_stock_umbral: e.target.value }))}
                            className="h-7 w-20 text-xs kairox-input"
                          />
                          <span className="text-xs text-kx-text-3">unidades</span>
                        </div>
                      )}
                    </div>
                    <Switch checked={alertas.alerta_stock_bajo} onCheckedChange={v => setAlertas(prev => ({ ...prev, alerta_stock_bajo: v }))} />
                  </div>

                  {/* Vencimiento CC */}
                  <div className="flex items-start justify-between gap-4 p-4 bg-kx-surface-2 rounded-lg border border-kx-border">
                    <div className="flex-1">
                      <p className="font-medium text-kx-text text-sm">Vencimiento de cuenta corriente</p>
                      <p className="text-xs text-kx-text-2 mt-0.5">Alertar cuando un saldo de CC supere los días de plazo configurados.</p>
                      {alertas.alerta_vencimiento_cc && (
                        <div className="flex items-center gap-2 mt-3">
                          <span className="text-xs text-kx-text-2">Días de plazo:</span>
                          <Input
                            type="number" min="1"
                            value={alertas.alerta_vencimiento_dias}
                            onChange={e => setAlertas(prev => ({ ...prev, alerta_vencimiento_dias: e.target.value }))}
                            className="h-7 w-20 text-xs kairox-input"
                          />
                          <span className="text-xs text-kx-text-3">días</span>
                        </div>
                      )}
                    </div>
                    <Switch checked={alertas.alerta_vencimiento_cc} onCheckedChange={v => setAlertas(prev => ({ ...prev, alerta_vencimiento_cc: v }))} />
                  </div>

                  {/* Apertura de caja */}
                  <div className="flex items-center justify-between p-4 bg-kx-surface-2 rounded-lg border border-kx-border">
                    <div>
                      <p className="font-medium text-kx-text text-sm">Recordatorio apertura de caja</p>
                      <p className="text-xs text-kx-text-2 mt-0.5">Mostrar aviso si la caja no fue abierta en el primer acceso del día.</p>
                    </div>
                    <Switch checked={alertas.alerta_caja_apertura} onCheckedChange={v => setAlertas(prev => ({ ...prev, alerta_caja_apertura: v }))} />
                  </div>

                  {/* Cheques */}
                  <div className="flex items-start justify-between gap-4 p-4 bg-kx-surface-2 rounded-lg border border-kx-border">
                    <div className="flex-1">
                      <p className="font-medium text-kx-text text-sm">Cheques próximos a vencer</p>
                      <p className="text-xs text-kx-text-2 mt-0.5">Alertar sobre cheques propios o de terceros que vencen pronto.</p>
                      {alertas.alerta_cheque_vencimiento && (
                        <div className="flex items-center gap-2 mt-3">
                          <span className="text-xs text-kx-text-2">Avisar con:</span>
                          <Input
                            type="number" min="1"
                            value={alertas.alerta_cheque_dias}
                            onChange={e => setAlertas(prev => ({ ...prev, alerta_cheque_dias: e.target.value }))}
                            className="h-7 w-20 text-xs kairox-input"
                          />
                          <span className="text-xs text-kx-text-3">días de antelación</span>
                        </div>
                      )}
                    </div>
                    <Switch checked={alertas.alerta_cheque_vencimiento} onCheckedChange={v => setAlertas(prev => ({ ...prev, alerta_cheque_vencimiento: v }))} />
                  </div>

                  <Button onClick={handleSaveAlertas} disabled={savingAlertas} className="bg-blue-600 hover:bg-blue-700 text-white">
                    {savingAlertas ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar Alertas</>}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 7 — USUARIOS Y ROLES
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="usuarios">
          <UsuariosSection />
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 8 — SISTEMA
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="sistema">
          <div className="space-y-6 max-w-2xl">
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
              <h3 className="text-lg font-bold text-kx-text mb-4 flex items-center gap-2">
                <Info className="w-5 h-5 text-kx-text-3" />
                Información del Sistema
              </h3>
              <dl className="space-y-0">
                {[
                  { label: 'Versión',      value: '1.4.0',                          mono: true  },
                  { label: 'Empresa ID',   value: user?.empresa_id,                 mono: true, small: true },
                  { label: 'Usuario',      value: user?.email,                      mono: false },
                  { label: 'Base de datos',value: null,                             isStatus: true },
                ].map(({ label, value, mono, small, isStatus }) => (
                  <div key={label} className="flex justify-between items-center py-3 border-b border-kx-border last:border-b-0">
                    <dt className="text-sm text-kx-text-2">{label}</dt>
                    <dd className={[
                      mono ? 'font-mono' : '',
                      small ? 'text-xs text-kx-text-3 break-all max-w-[260px] text-right' : 'text-sm text-kx-text',
                    ].join(' ')}>
                      {isStatus
                        ? <span className="text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Conectada</span>
                        : value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm opacity-60">
              <h3 className="font-semibold text-kx-text mb-2 flex items-center gap-2">
                <Package2 className="w-4 h-4 text-kx-text-3" />
                Datos de Demostración
                <span className="text-xs bg-kx-surface-2 text-kx-text-3 px-2 py-0.5 rounded-full border border-kx-border">Próximamente</span>
              </h3>
              <p className="text-sm text-kx-text-2">Cargar un conjunto de datos de prueba (clientes, productos, ventas) para explorar el sistema antes de usar datos reales.</p>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ═══════════════════════════════════════════════════════════════════
          WIZARD AFIP (fuera del sistema de tabs — persiste al navegar)
      ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="sm:max-w-[540px] bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-kx-text dark:text-kx-text">
              <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              Activar Facturación Electrónica
            </DialogTitle>
            <DialogDescription>
              Configurá tu facturación AFIP/ARCA en 3 pasos. Solo se hace una vez.
            </DialogDescription>
          </DialogHeader>

          {/* Stepper */}
          <div className="flex items-center gap-2 mb-2 mt-2">
            {[1, 2, 3].map(step => (
              <React.Fragment key={step}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${wizardStep >= step ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-kx-surface-2 text-kx-text-3'}`}>
                  {wizardStep > step ? <Check className="w-4 h-4" /> : step}
                </div>
                {step < 3 && <div className={`flex-1 h-0.5 ${wizardStep > step ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`} />}
              </React.Fragment>
            ))}
          </div>
          <div className="text-xs text-kx-text-3 flex justify-between mb-4">
            <span>Datos fiscales</span>
            <span>Certificado</span>
            <span>Punto de venta</span>
          </div>

          {/* Paso 1 — Datos fiscales */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500 dark:text-kx-text-2">Estos datos se usan para emitir tus facturas electrónicas. Solo se configuran una vez.</p>
              <div className="space-y-2">
                <Label>CUIT de la empresa</Label>
                <Input value={afipForm.cuit} onChange={e => setAfipForm(f => ({ ...f, cuit: e.target.value }))} placeholder="20-12345678-9" />
              </div>
              <div className="space-y-2">
                <Label>Condición ante IVA</Label>
                <Select value={afipForm.condicion_iva} onValueChange={v => setAfipForm(f => ({ ...f, condicion_iva: v }))}>
                  <SelectTrigger className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RI">Responsable Inscripto — emite Facturas A y B</SelectItem>
                    <SelectItem value="Monotributo">Monotributista — emite solo Facturas C</SelectItem>
                    <SelectItem value="Exento">Exento — emite Facturas B</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => setWizardStep(2)} disabled={afipForm.cuit.replace(/\D/g, '').length !== 11 || !afipForm.condicion_iva} className="bg-blue-600 hover:bg-blue-700 text-white">
                  Siguiente →
                </Button>
              </div>
            </div>
          )}

          {/* Paso 2 — Certificado digital */}
          {wizardStep === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500 dark:text-kx-text-2">KAIROX genera el archivo que necesitás subir a ARCA. Es un proceso de un solo clic.</p>

              {!csrGenerado ? (
                <div className="border kairox-border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs flex items-center justify-center font-medium">1</span>
                    <span className="text-sm font-medium text-slate-700 dark:text-kx-text">Generá tu archivo para ARCA</span>
                  </div>
                  <p className="text-xs text-slate-500 pl-8">KAIROX crea automáticamente las claves criptográficas. Solo descargás el archivo y lo subís en ARCA.</p>
                  <Button onClick={handleGenerarCSR} disabled={generandoCsr} className="ml-8" variant="outline">
                    {generandoCsr ? <><Loader2 className="animate-spin w-4 h-4 mr-2" /> Generando...</> : '⚙ Generar archivo para ARCA'}
                  </Button>
                </div>
              ) : (
                <div className="border border-green-200 dark:border-green-800 rounded-lg p-4 space-y-3 bg-green-50 dark:bg-green-900/20">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                    <Check className="w-4 h-4" /><span className="text-sm font-medium">Archivo generado</span>
                  </div>
                  <Button onClick={handleDescargarCSR} variant="outline" size="sm" className="ml-6">
                    <Download className="w-4 h-4 mr-2" /> Descargar archivo (.csr)
                  </Button>
                </div>
              )}

              <div className="border kairox-border rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-slate-100 dark:bg-kx-surface-2 text-kx-text-2 dark:text-slate-300 text-xs flex items-center justify-center font-medium">2</span>
                  <span className="text-sm font-medium text-slate-700 dark:text-kx-text">Subí el archivo en ARCA</span>
                </div>
                <ol className="text-xs text-slate-500 pl-8 space-y-1 list-decimal list-inside">
                  <li>Entrá a <a href="https://www.afip.gob.ar" target="_blank" rel="noreferrer" className="text-blue-500 underline">afip.gob.ar</a> con tu CUIT y clave fiscal</li>
                  <li>Ir a <strong>Administración de Certificados Digitales</strong></li>
                  <li>Subí el archivo .csr que descargaste</li>
                  <li>Descargá el certificado .crt que ARCA te entrega</li>
                </ol>
              </div>

              <div className="border kairox-border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-slate-100 dark:bg-kx-surface-2 text-kx-text-2 dark:text-slate-300 text-xs flex items-center justify-center font-medium">3</span>
                  <span className="text-sm font-medium text-slate-700 dark:text-kx-text">Subí el certificado que te dio ARCA</span>
                </div>
                <div className="pl-8">
                  <input type="file" accept=".crt,.pem,.cer" onChange={handleCertUpload}
                    className="text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:text-sm file:font-medium file:bg-kx-surface-2 file:text-slate-700 hover:file:bg-slate-100 dark:file:bg-slate-800 dark:file:text-slate-200" />
                  {afipForm.crt_content && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1.5 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Certificado cargado correctamente
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2 justify-between">
                <Button variant="outline" onClick={() => setWizardStep(1)}>← Anterior</Button>
                <Button onClick={() => setWizardStep(3)} disabled={!afipForm.crt_content} className="bg-blue-600 hover:bg-blue-700 text-white">
                  Siguiente →
                </Button>
              </div>
            </div>
          )}

          {/* Paso 3 — Punto de venta */}
          {wizardStep === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500 dark:text-kx-text-2">El punto de venta es el número que configuraste en ARCA para emitir facturas.</p>
              <div className="space-y-2">
                <Label>Número de punto de venta</Label>
                <Input type="number" min="1" max="9999" value={afipForm.pv_numero} onChange={e => setAfipForm(f => ({ ...f, pv_numero: e.target.value }))} placeholder="Ej: 1" />
                <p className="text-xs text-kx-text-3">Encontrás este número en ARCA → Administración de Puntos de Venta</p>
              </div>
              <div className="space-y-2">
                <Label>Nombre del punto de venta (interno)</Label>
                <Input value={afipForm.pv_nombre} onChange={e => setAfipForm(f => ({ ...f, pv_nombre: e.target.value }))} placeholder="Ej: Caja Principal" />
              </div>
              <div className="space-y-2">
                <Label>Tipo de comprobante por defecto</Label>
                <Select value={afipForm.tipo_comprobante_default} onValueChange={v => setAfipForm(f => ({ ...f, tipo_comprobante_default: v }))}>
                  <SelectTrigger className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="B">Factura B (consumidor final / monotributista)</SelectItem>
                    <SelectItem value="A">Factura A (responsable inscripto)</SelectItem>
                    <SelectItem value="C">Factura C (solo para monotributistas)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 justify-between">
                <Button variant="outline" onClick={() => setWizardStep(2)}>← Anterior</Button>
                <Button onClick={handleGuardarConfigAFIP} disabled={!afipForm.pv_numero || subiendoConfig} className="bg-blue-600 hover:bg-blue-700 text-white">
                  {subiendoConfig ? <><Loader2 className="animate-spin w-4 h-4 mr-2" /> Guardando...</> : '✓ Activar facturación electrónica'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ConfiguracionSection;
