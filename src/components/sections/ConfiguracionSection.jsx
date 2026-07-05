import React, { useState, useEffect, useRef } from 'react';
import {
  Settings, Save, Building, Image as ImageIcon, Loader2, Upload, Trash2,
  AlertCircle, AlertTriangle, TrendingUp, CheckCircle2, CheckCircle, FileText, Check, Download,
  Users, Puzzle, Bell, Package2, Info, Mail, MapPin, Hash,
  CreditCard, Warehouse, BarChart3, Cpu, Copy, Pencil,
  Plus, Shield, RefreshCw, Eye, EyeOff, Scale,
} from 'lucide-react';
import DeterminacionCuentasTab from '@/components/configuracion/DeterminacionCuentasTab';
import TabSistema from '@/components/configuracion/TabSistema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConfig } from '@/contexts/ConfigContext';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import UsuariosSection from '@/components/sections/UsuariosSection';
import IntegracionCard from '@/components/shared/IntegracionCard';
import ConfigMercadoPagoModal from '@/components/bancos/ConfigMercadoPagoModal';
import ConfigUalaModal from '@/components/bancos/ConfigUalaModal';
import { formatDateAR, getTodayAR } from '@/lib/dateUtils';

const formatCuit = (raw) => {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length !== 11) return raw ?? '';
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
};

const TAB_IDS = ['empresa', 'finanzas', 'facturacion', 'inventario', 'integraciones', 'alertas', 'usuarios', 'sistema'];

const TIPO_DOCUMENTO_LABEL = {
  venta:         'Venta',
  factura:       'Factura',
  nota_credito:  'Nota de Crédito',
  nota_debito:   'Nota de Débito',
  orden_compra:  'Orden de Compra',
  cotizacion:    'Cotización',
  pedido:        'Pedido',
  entrega:       'Entrega',
  recepcion:     'Recepción',
};

const TABS = [
  { id: 'empresa',        label: 'Empresa',       Icon: Building    },
  { id: 'finanzas',       label: 'Finanzas',       Icon: TrendingUp  },
  { id: 'contabilidad',   label: 'Determinación de Cuentas', Icon: Scale },
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
    afip_cuit: '',
    condicion_iva: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [empresaDatos, setEmpresaDatos] = useState({ afip_cuit: null, condicion_iva: null });

  // ── Tab 2: Finanzas ───────────────────────────────────────────────────────
  const [tcConfig, setTcConfig] = useState({ usa_tc_paralelo: false, moneda_paralela: 'USD' });
  const [loadingTC, setLoadingTC] = useState(false);
  const [savingTC, setSavingTC] = useState(false);

  // ── Tab 4: Inventario — Método de Valoración de Stock ────────────────────
  const [valoracionStock, setValoracionStock] = useState('ultimo_costo');
  const [loadingValoracion, setLoadingValoracion] = useState(false);
  const [savingValoracion, setSavingValoracion] = useState(false);

  // ── Tab 3: Pie de Documento + Tab 4: Stock Mínimo Global ─────────────────
  const [pieDoc, setPieDoc] = useState('');
  const [savingPieDoc, setSavingPieDoc] = useState(false);
  const [stockMinimoGlobal, setStockMinimoGlobal] = useState(5);
  const [savingStockMin, setSavingStockMin] = useState(false);

  // ── Tab 3: Series de Numeración ───────────────────────────────────────────
  const [seriesNumeracion, setSeriesNumeracion] = useState([]);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [savingSerieId, setSavingSerieId] = useState(null);

  // ── Tab 2: Condiciones de Pago ───────────────────────────────────────────
  const [condicionesPago, setCondicionesPago] = useState([]);
  const [loadingCondiciones, setLoadingCondiciones] = useState(true);
  const [showCondicionModal, setShowCondicionModal] = useState(false);
  const [editingCondicion, setEditingCondicion] = useState(null);
  const [condicionForm, setCondicionForm] = useState({ nombre: '', dias_credito: '', descuento_pct: '' });
  const [savingCondicion, setSavingCondicion] = useState(false);

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

  // ── Tab 3: Puntos de Venta + Credenciales AFIP (gestión completa) ────────
  const [allPuntosVenta, setAllPuntosVenta] = useState([]);
  const [certStatus, setCertStatus] = useState(null);
  const [certModalOpen, setCertModalOpen] = useState(false);
  const [certForm, setCertForm] = useState({ cert: '', key: '' });
  const [savingCert, setSavingCert] = useState(false);
  const [showPvModal, setShowPvModal] = useState(false);
  const [editingPv, setEditingPv] = useState(null);
  const [pvForm, setPvForm] = useState({
    numero: '', nombre: 'Punto de Venta Principal', tipo: 'web',
    cai_remito: '', cai_remito_vencimiento: '', proximo_numero_remito: 1,
    es_default: false, activo: true,
  });
  const [savingPv, setSavingPv] = useState(false);
  const [selectedPvId, setSelectedPvId] = useState(null);
  const [tiposComprobante, setTiposComprobante] = useState([]);
  const [loadingTipos, setLoadingTipos] = useState(false);
  const [savingTipoId, setSavingTipoId] = useState(null);

  // ── Tab 3b: Facturas con Error CAE ────────────────────────────────────────
  const [facturasError, setFacturasError] = useState([]);
  const [loadingFacturasError, setLoadingFacturasError] = useState(false);
  const [errorDetailModal, setErrorDetailModal] = useState(null); // { mensaje }
  const [reintentandoId, setReintentandoId] = useState(null);
  const [resolviendoId, setResolviendoId] = useState(null);
  const [probandoConexion, setProbandoConexion] = useState(false);

  // ── Tab 4: Unidades de Medida ─────────────────────────────────────────────
  const [unidadesMedida, setUnidadesMedida] = useState([]);
  const [loadingUM, setLoadingUM] = useState(true);
  const [showUMModal, setShowUMModal] = useState(false);
  const [editingUM, setEditingUM] = useState(null);
  const [umForm, setUmForm] = useState({ codigo: '', descripcion: '' });
  const [savingUM, setSavingUM] = useState(false);

  // ── Tab 5: Integraciones — Mercado Pago ──────────────────────────────────
  const [integracionMP,  setIntegracionMP]  = useState(null);
  const [showConfigMP,   setShowConfigMP]   = useState(false);
  const [integracionUala, setIntegracionUala] = useState(null);
  const [showConfigUala,  setShowConfigUala]  = useState(false);
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const [showWebhookUrl, setShowWebhookUrl] = useState(false); // SECURITY-WEBHOOK-URL

  // ── Puente Caja ↔ Bancos ──────────────────────────────────────────────────
  const METODOS_BANCARIOS = ['Transferencia', 'Tarjeta'];
  const [mapeosCuentas, setMapeosCuentas] = useState({});
  const [cuentasBancariasLista, setCuentasBancariasLista] = useState([]);
  const [savingMapeos, setSavingMapeos] = useState(false);

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

      const { data: allPvs } = await supabase
        .from('puntos_venta')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .order('numero');
      setAllPuntosVenta(allPvs ?? []);
      if (allPvs?.length > 0) {
        setSelectedPvId(prev => prev ?? allPvs[0].id);
      }

      // Estado del certificado AFIP: usamos afip_cert_status() que devuelve solo
      // un booleano scoped a la empresa del caller — NO expone el secreto del vault.
      const { data: certExists, error: certErr } = await supabase.rpc('afip_cert_status');
      if (certErr) {
        setCertStatus(false);
      } else {
        setCertStatus(certExists === true);
      }
    } catch (e) {
      console.error('[AFIP] Error al cargar config:', e);
    } finally {
      setLoadingAFIP(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'facturacion') reloadAFIP();
  }, [user?.empresa_id, activeTab]);

  const reloadTipos = async (pvId) => {
    if (!pvId || !user?.empresa_id) return;
    setLoadingTipos(true);
    try {
      const { data } = await supabase
        .from('tipos_comprobante_afip')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .eq('punto_venta_id', pvId)
        .order('tipo_interno');
      setTiposComprobante(data ?? []);
    } catch (e) {
      console.error('[Tipos Comprobante AFIP] Error:', e);
    } finally {
      setLoadingTipos(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'facturacion' && selectedPvId) reloadTipos(selectedPvId);
  }, [selectedPvId, activeTab]);

  const reloadFacturasError = async () => {
    if (!user?.empresa_id) return;
    setLoadingFacturasError(true);
    try {
      const { data } = await supabase
        .from('facturas_pendientes_arca')
        .select('id, estado, intentos, max_intentos, proximo_intento, error_mensaje, created_at, comprobante_id, comprobantes(numero_venta, fecha, total, cliente_nombre)')
        .eq('empresa_id', user.empresa_id)
        .in('estado', ['pendiente', 'reintentando', 'error_datos', 'error_definitivo', 'procesando'])
        .order('created_at', { ascending: false })
        .limit(50);
      setFacturasError(data ?? []);
    } catch (e) {
      console.error('[FacturasError ARCA] Error al cargar:', e);
    } finally {
      setLoadingFacturasError(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'facturacion' && afipConfig?.usa_factura_electronica) {
      reloadFacturasError();
    }
  }, [user?.empresa_id, afipConfig?.usa_factura_electronica, activeTab]);

  const handleReintentarFactura = async (fpa) => {
    setReintentandoId(fpa.id);
    try {
      await supabase.from('facturas_pendientes_arca').update({
        estado: 'pendiente',
        intentos: 0,
        proximo_intento: new Date().toISOString(),
        error_mensaje: null,
      }).eq('id', fpa.id);
      await supabase.from('comprobantes').update({
        cae_estado: 'pendiente',
        error_afip: null,
      }).eq('id', fpa.comprobante_id);
      toast({ title: 'Factura encolada', description: 'El worker la procesará en los próximos minutos.', className: 'bg-green-600 text-white border-green-500' });
      reloadFacturasError();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setReintentandoId(null);
    }
  };

  const handleMarcarResuelta = async (fpa) => {
    setResolviendoId(fpa.id);
    try {
      await supabase.from('facturas_pendientes_arca').update({
        estado: 'emitida',
      }).eq('id', fpa.id);
      await supabase.from('comprobantes').update({
        cae_estado: 'emitido',
        error_afip: null,
      }).eq('id', fpa.comprobante_id);
      toast({ title: 'Marcada como resuelta', description: 'La factura fue marcada como emitida externamente.', className: 'bg-green-600 text-white border-green-500' });
      reloadFacturasError();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setResolviendoId(null);
    }
  };

  const handleProbarConexion = async () => {
    setProbandoConexion(true);
    try {
      const { data, error } = await supabase.functions.invoke('probar-conexion-afip', { method: 'POST' });
      if (error) throw new Error(error.message);
      if (data?.ok) {
        toast({
          title: 'Conexión exitosa con ARCA',
          description: `CUIT ${data.cuit} · PdV ${data.pvNumero} · Último Nro. FC emitida: ${data.lastNumber}`,
          className: 'bg-green-600 text-white border-green-500',
        });
      } else {
        toast({
          title: 'Error de conexión ARCA',
          description: data?.error ?? 'Error desconocido',
          variant: 'destructive',
        });
      }
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setProbandoConexion(false);
    }
  };

  useEffect(() => {
    if (config) {
      setFormData(prev => ({
        ...prev,
        nombre_empresa:  config.nombre_empresa  || '',
        company_logo:    config.company_logo    || config.logo_base64 || '',
        email_empresa:   config.email_empresa   || '',
        direccion:       config.direccion       || '',
        rubro:           config.rubro           || '',
        provincia:       config.provincia       || '',
        localidad:       config.localidad       || '',
        cp:              config.cp              || '',
      }));
    }
  }, [config]);

  // Hidratar afip_cuit/condicion_iva en el form cuando llega desde empresas
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      afip_cuit:     empresaDatos.afip_cuit     ? formatCuit(empresaDatos.afip_cuit) : '',
      condicion_iva: empresaDatos.condicion_iva ?? '',
    }));
  }, [empresaDatos.afip_cuit, empresaDatos.condicion_iva]);

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
    const loadValoracion = async () => {
      setLoadingValoracion(true);
      try {
        const { data } = await supabase
          .from('empresas')
          .select('metodo_valoracion_stock')
          .eq('id', user.empresa_id)
          .single();
        if (data) setValoracionStock(data.metodo_valoracion_stock ?? 'ultimo_costo');
      } catch (e) {
        console.error('[Valoración Stock] Error al cargar config:', e);
      } finally {
        setLoadingValoracion(false);
      }
    };
    loadValoracion();
  }, [user?.empresa_id]);

  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase.from('empresas')
      .select('pie_documento, stock_minimo_global')
      .eq('id', user.empresa_id).single()
      .then(({ data }) => {
        if (data) {
          setPieDoc(data.pie_documento ?? '');
          setStockMinimoGlobal(data.stock_minimo_global ?? 5);
        }
      });
  }, [user?.empresa_id]);

  useEffect(() => {
    if (!user?.empresa_id) return;
    const loadSeries = async () => {
      setLoadingSeries(true);
      try {
        const { data } = await supabase
          .from('series_numeracion')
          .select('*')
          .eq('empresa_id', user.empresa_id)
          .order('tipo_documento');
        setSeriesNumeracion(data ?? []);
      } catch (e) {
        console.error('[Series Numeración] Error al cargar:', e);
      } finally {
        setLoadingSeries(false);
      }
    };
    loadSeries();
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

  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase
      .from('integraciones_bancarias')
      .select('id, empresa_id, proveedor, cuenta_bancaria_id, activo, ultimo_sync, config') // SECURITY-SENSITIVE-DATA
      .eq('empresa_id', user.empresa_id)
      .eq('proveedor', 'mercadopago')
      .maybeSingle()
      .then(({ data }) => setIntegracionMP(data ?? null));
  }, [user?.empresa_id]);

  const reloadIntegracionMP = () => {
    if (!user?.empresa_id) return;
    supabase
      .from('integraciones_bancarias')
      .select('id, empresa_id, proveedor, cuenta_bancaria_id, activo, ultimo_sync, config') // SECURITY-SENSITIVE-DATA
      .eq('empresa_id', user.empresa_id)
      .eq('proveedor', 'mercadopago')
      .maybeSingle()
      .then(({ data }) => setIntegracionMP(data ?? null));
  };

  const reloadIntegracionUala = () => {
    if (!user?.empresa_id) return;
    supabase
      .from('integraciones_bancarias')
      .select('id, empresa_id, proveedor, cuenta_bancaria_id, activo, ultimo_sync, config') // SECURITY-SENSITIVE-DATA
      .eq('empresa_id', user.empresa_id)
      .eq('proveedor', 'uala')
      .maybeSingle()
      .then(({ data }) => setIntegracionUala(data ?? null));
  };

  useEffect(() => { reloadIntegracionUala(); }, [user?.empresa_id]);

  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase.from('cuentas_bancarias').select('id, nombre, banco')
      .eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre')
      .then(({ data }) => setCuentasBancariasLista(data ?? []));
    supabase.from('metodo_pago_cuenta_bancaria').select('metodo_pago, cuenta_bancaria_id')
      .eq('empresa_id', user.empresa_id)
      .then(({ data }) => {
        const m = {};
        (data ?? []).forEach(r => { m[r.metodo_pago] = r.cuenta_bancaria_id; });
        setMapeosCuentas(m);
      });
  }, [user?.empresa_id]);

  const handleSaveMapeos = async () => {
    if (!user?.empresa_id) return;
    setSavingMapeos(true);
    try {
      for (const metodo of METODOS_BANCARIOS) {
        const cuentaId = mapeosCuentas[metodo];
        if (cuentaId) {
          await supabase.from('metodo_pago_cuenta_bancaria').upsert(
            { empresa_id: user.empresa_id, metodo_pago: metodo, cuenta_bancaria_id: cuentaId, activo: true },
            { onConflict: 'empresa_id,metodo_pago' }
          );
        } else {
          await supabase.from('metodo_pago_cuenta_bancaria')
            .delete().eq('empresa_id', user.empresa_id).eq('metodo_pago', metodo);
        }
      }
      toast({ title: '✓ Mapeo guardado', description: 'Las ventas acreditarán automáticamente en la cuenta configurada.' });
    } catch (e) {
      toast({ title: 'Error al guardar mapeo', description: e.message, variant: 'destructive' });
    } finally {
      setSavingMapeos(false);
    }
  };

  const fetchUnidadesMedida = async () => {
    if (!user?.empresa_id) return;
    setLoadingUM(true);
    try {
      const { data, error } = await supabase
        .from('unidades_medida')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .order('codigo');
      if (error) throw error;
      setUnidadesMedida(data ?? []);
    } catch (e) {
      console.error('[Unidades de Medida] Error al cargar:', e);
    } finally {
      setLoadingUM(false);
    }
  };

  useEffect(() => { fetchUnidadesMedida(); }, [user?.empresa_id]);

  const fetchCondicionesPago = async () => {
    if (!user?.empresa_id) return;
    setLoadingCondiciones(true);
    try {
      const { data, error } = await supabase
        .from('condiciones_pago')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .order('dias_credito');
      if (error) throw error;
      setCondicionesPago(data ?? []);
    } catch (e) {
      console.error('[Condiciones de Pago] Error al cargar:', e);
    } finally {
      setLoadingCondiciones(false);
    }
  };

  useEffect(() => { fetchCondicionesPago(); }, [user?.empresa_id]);

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

  // Redimensiona y comprime el logo en el browser antes de guardarlo.
  // Objetivo: que el base64 final pese <300KB para que los PDFs (@react-pdf/renderer)
  // no se cuelguen renderizando imágenes gigantes.
  const resizeImageToBase64 = (file, { maxSide = 400, quality = 0.85 } = {}) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
        img.onload = () => {
          const ratio = Math.min(maxSide / img.width, maxSide / img.height, 1);
          const w = Math.round(img.width * ratio);
          const h = Math.round(img.height * ratio);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          // PNG conserva transparencia; JPEG si no la necesita. Probamos PNG primero,
          // si pesa demasiado caemos a JPEG comprimido.
          let out = canvas.toDataURL('image/png');
          if (out.length > 300_000) {
            out = canvas.toDataURL('image/jpeg', quality);
          }
          resolve(out);
        };
        img.src = reader.result;
      };
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
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Archivo muy grande', description: 'El logo debe pesar menos de 5MB. Comprime la imagen e intentá de nuevo.', variant: 'destructive' });
      return;
    }
    try {
      setUploading(true);
      // SVG no necesita resize (suele ser chico y vectorial). El resto va al canvas.
      const base64 = file.type === 'image/svg+xml'
        ? await convertToBase64(file)
        : await resizeImageToBase64(file, { maxSide: 400 });
      setFormData(prev => ({ ...prev, company_logo: base64, logo_base64: base64 }));
      const kb = Math.round(base64.length / 1024);
      toast({
        title: 'Logo cargado',
        description: `Redimensionado a ${kb}KB. Hacé clic en Guardar para aplicar.`,
        className: 'bg-blue-600 text-white border-blue-500',
      });
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
      // 1. Guardar tabla `configuracion` (datos generales)
      const { afip_cuit, condicion_iva, ...configFields } = formData;
      const result = await updateConfig(configFields);
      if (!result.success) throw new Error('No se pudo guardar en la base de datos.');

      // 2. Guardar `empresas.afip_cuit` y `empresas.condicion_iva` (misma fuente que el wizard AFIP)
      if (user?.empresa_id) {
        const cuitDigits = (afip_cuit || '').replace(/\D/g, '');
        if (cuitDigits && cuitDigits.length !== 11) {
          toast({ title: 'CUIT inválido', description: 'Debe tener 11 dígitos. Se guardó el resto de los datos.', variant: 'destructive' });
        } else {
          const { error: empErr } = await supabase
            .from('empresas')
            .update({
              afip_cuit:     cuitDigits || null,
              condicion_iva: condicion_iva || null,
            })
            .eq('id', user.empresa_id);
          if (empErr) throw empErr;
          setEmpresaDatos({ afip_cuit: cuitDigits || null, condicion_iva: condicion_iva || null });
        }
      }

      toast({ title: 'Configuración guardada', description: 'Los datos de la empresa se han actualizado correctamente.', className: 'bg-green-600 text-white border-green-500' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Error al guardar', description: error.message || 'Hubo un problema al guardar la configuración.', variant: 'destructive' });
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

  const handleSavePieDoc = async () => {
    if (!user?.empresa_id) return;
    setSavingPieDoc(true);
    try {
      const { error } = await supabase.from('empresas')
        .update({ pie_documento: pieDoc.trim() || null })
        .eq('id', user.empresa_id);
      if (error) throw error;
      toast({ title: 'Pie de documento guardado', className: 'bg-green-600 text-white border-green-700' });
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingPieDoc(false);
    }
  };

  const handleSaveStockMin = async () => {
    if (!user?.empresa_id) return;
    setSavingStockMin(true);
    try {
      const { error } = await supabase.from('empresas')
        .update({ stock_minimo_global: stockMinimoGlobal })
        .eq('id', user.empresa_id);
      if (error) throw error;
      toast({ title: 'Stock mínimo global guardado', className: 'bg-green-600 text-white border-green-700' });
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingStockMin(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Tab 4 handlers — Método de Valoración de Stock
  // ─────────────────────────────────────────────────────────────────────────
  const handleSaveValoracion = async () => {
    if (!user?.empresa_id) return;
    setSavingValoracion(true);
    try {
      const { error } = await supabase
        .from('empresas')
        .update({ metodo_valoracion_stock: valoracionStock })
        .eq('id', user.empresa_id);
      if (error) throw error;
      toast({
        title: 'Método de valoración guardado',
        description: valoracionStock === 'promedio_ponderado'
          ? 'A partir de ahora, cada compra recalcula el costo como promedio ponderado.'
          : 'A partir de ahora, cada compra actualiza el costo al valor más reciente.',
        className: 'bg-green-600 text-white border-green-700',
      });
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingValoracion(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Tab 3 handlers — Series de Numeración
  // ─────────────────────────────────────────────────────────────────────────
  const updateSerieLocal = (id, field, value) => {
    setSeriesNumeracion(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const handleSaveSerie = async (serie) => {
    setSavingSerieId(serie.id);
    try {
      const proximoNumero = parseInt(serie.proximo_numero, 10);
      if (isNaN(proximoNumero) || proximoNumero < 1) {
        toast({ title: 'Próximo número inválido', description: 'Tiene que ser un entero mayor o igual a 1.', variant: 'destructive' });
        return;
      }
      const { error } = await supabase
        .from('series_numeracion')
        .update({ prefijo: serie.prefijo, proximo_numero: proximoNumero })
        .eq('id', serie.id);
      if (error) throw error;
      toast({ title: 'Serie actualizada', className: 'bg-green-600 text-white border-green-700' });
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingSerieId(null);
    }
  };

  const previewProximoNumero = (serie) => {
    const todayStr = getTodayAR().replace(/-/g, '');
    let periodo = '';
    if (serie.formato_fecha === 'YYYYMMDD') periodo = `${todayStr}-`;
    else if (serie.formato_fecha === 'YYYY') periodo = `${todayStr.slice(0, 4)}-`;
    const n = parseInt(serie.proximo_numero, 10);
    const numeroStr = isNaN(n) ? '?' : String(n).padStart(serie.digitos, '0');
    return `${serie.prefijo ?? ''}${periodo}${numeroStr}`;
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
  // Tab 3: Credenciales cert ARCA
  // ─────────────────────────────────────────────────────────────────────────
  const handleSaveCert = async () => {
    if (!certForm.cert.trim() || !certForm.key.trim()) {
      toast({ title: 'Ingresá el certificado y la clave privada', variant: 'destructive' }); return;
    }
    setSavingCert(true);
    try {
      await supabase.rpc('vault_secret_upsert', {
        p_name: `afip_cert_${user.empresa_id}`,
        p_secret: certForm.cert.trim(),
        p_description: `AFIP/ARCA cert empresa ${user.empresa_id}`,
      });
      await supabase.rpc('vault_secret_upsert', {
        p_name: `afip_key_${user.empresa_id}`,
        p_secret: certForm.key.trim(),
        p_description: `AFIP/ARCA private key empresa ${user.empresa_id}`,
      });
      setCertStatus(true);
      setCertModalOpen(false);
      setCertForm({ cert: '', key: '' });
      toast({ title: 'Credenciales guardadas en vault', className: 'bg-green-600 text-white border-green-700' });
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingCert(false);
    }
  };

  const openAddPv = () => {
    setEditingPv(null);
    setPvForm({ numero: '', nombre: 'Nuevo Punto de Venta', tipo: 'web', cai_remito: '', cai_remito_vencimiento: '', proximo_numero_remito: 1, es_default: false, activo: true });
    setShowPvModal(true);
  };

  const openEditPv = (pv) => {
    setEditingPv(pv);
    setPvForm({
      numero: String(pv.numero),
      nombre: pv.nombre,
      tipo: pv.tipo ?? 'web',
      cai_remito: pv.cai_remito ?? '',
      cai_remito_vencimiento: pv.cai_remito_vencimiento ?? '',
      proximo_numero_remito: pv.proximo_numero_remito ?? 1,
      es_default: pv.es_default ?? false,
      activo: pv.activo ?? true,
    });
    setShowPvModal(true);
  };

  const handleSavePv = async () => {
    const numero = parseInt(pvForm.numero, 10);
    if (isNaN(numero) || numero < 1 || numero > 9999) {
      toast({ title: 'Número inválido (1–9999)', variant: 'destructive' }); return;
    }
    if (!pvForm.nombre.trim()) {
      toast({ title: 'El nombre es obligatorio', variant: 'destructive' }); return;
    }
    setSavingPv(true);
    try {
      const { error } = await supabase
        .from('puntos_venta')
        .upsert({
          empresa_id: user.empresa_id,
          numero,
          nombre: pvForm.nombre.trim(),
          tipo: pvForm.tipo,
          cai_remito: pvForm.cai_remito || null,
          cai_remito_vencimiento: pvForm.cai_remito_vencimiento || null,
          proximo_numero_remito: Number(pvForm.proximo_numero_remito) || 1,
          es_default: pvForm.es_default,
          activo: pvForm.activo,
        }, { onConflict: 'empresa_id,numero' });
      if (error) throw error;
      toast({ title: editingPv ? 'Punto de venta actualizado' : 'Punto de venta creado', className: 'bg-green-600 text-white border-green-700' });
      setShowPvModal(false);
      await reloadAFIP();
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingPv(false);
    }
  };

  const handleSaveTipoProximoNumero = async (tipo) => {
    setSavingTipoId(tipo.id);
    try {
      const { error } = await supabase
        .from('tipos_comprobante_afip')
        .update({ proximo_numero: tipo.proximo_numero })
        .eq('id', tipo.id);
      if (error) throw error;
      toast({ title: 'Próximo número guardado', className: 'bg-green-600 text-white border-green-700' });
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSavingTipoId(null);
    }
  };

  const updateTipoLocal = (id, field, value) =>
    setTiposComprobante(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));

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
  // Tab 4: Unidades de Medida — handlers
  // ─────────────────────────────────────────────────────────────────────────
  const openNuevaUM = () => {
    setEditingUM(null);
    setUmForm({ codigo: '', descripcion: '' });
    setShowUMModal(true);
  };

  const openEditarUM = (u) => {
    setEditingUM(u);
    setUmForm({ codigo: u.codigo, descripcion: u.descripcion });
    setShowUMModal(true);
  };

  const toggleActivoUM = async (id, activo) => {
    const { error } = await supabase.from('unidades_medida').update({ activo }).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    fetchUnidadesMedida();
  };

  const handleGuardarUM = async () => {
    if (!umForm.codigo.trim() || !umForm.descripcion.trim()) {
      toast({ title: 'Completá código y descripción', variant: 'destructive' });
      return;
    }
    setSavingUM(true);
    try {
      const payload = {
        codigo: umForm.codigo.trim().toUpperCase(),
        descripcion: umForm.descripcion.trim(),
      };
      if (editingUM) {
        const { error } = await supabase.from('unidades_medida').update(payload).eq('id', editingUM.id);
        if (error) throw error;
        toast({ title: 'Unidad actualizada' });
      } else {
        const { error } = await supabase.from('unidades_medida').insert({ ...payload, empresa_id: user.empresa_id });
        if (error) throw error;
        toast({ title: 'Unidad creada' });
      }
      setShowUMModal(false);
      fetchUnidadesMedida();
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingUM(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Tab 2: Condiciones de Pago — handlers
  // ─────────────────────────────────────────────────────────────────────────
  const openNuevaCondicion = () => {
    setEditingCondicion(null);
    setCondicionForm({ nombre: '', dias_credito: '', descuento_pct: '' });
    setShowCondicionModal(true);
  };

  const openEditarCondicion = (c) => {
    setEditingCondicion(c);
    setCondicionForm({
      nombre: c.nombre,
      dias_credito: String(c.dias_credito ?? 0),
      descuento_pct: String(c.descuento_pct ?? 0),
    });
    setShowCondicionModal(true);
  };

  const toggleActivoCondicion = async (id, activo) => {
    const { error } = await supabase.from('condiciones_pago').update({ activo }).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    fetchCondicionesPago();
  };

  const handleGuardarCondicion = async () => {
    if (!condicionForm.nombre.trim()) {
      toast({ title: 'El nombre es obligatorio', variant: 'destructive' });
      return;
    }
    setSavingCondicion(true);
    try {
      const payload = {
        nombre: condicionForm.nombre.trim(),
        dias_credito: condicionForm.dias_credito !== '' ? parseInt(condicionForm.dias_credito, 10) : 0,
        descuento_pct: condicionForm.descuento_pct !== '' ? parseFloat(condicionForm.descuento_pct) : 0,
      };
      if (editingCondicion) {
        const { error } = await supabase.from('condiciones_pago').update(payload).eq('id', editingCondicion.id);
        if (error) throw error;
        toast({ title: 'Condición de pago actualizada' });
      } else {
        const { error } = await supabase.from('condiciones_pago').insert({ ...payload, empresa_id: user.empresa_id });
        if (error) throw error;
        toast({ title: 'Condición de pago creada' });
      }
      setShowCondicionModal(false);
      fetchCondicionesPago();
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingCondicion(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  // La escritura en `configuracion` es solo-admin a nivel RLS (migration 119).
  // Gateamos la sección completa para que un staff no llegue a un formulario
  // que después le va a rechazar el guardado.
  if (user?.role !== 'admin') {
    return (
      <div className="p-8 text-center text-kx-text-2">
        No tenés permisos para acceder a Configuración.
      </div>
    );
  }

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

                {/* CUIT — editable, escribe directo a empresas.afip_cuit */}
                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-slate-300">CUIT</Label>
                  <Input
                    name="afip_cuit"
                    value={formData.afip_cuit}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 11);
                      setFormData(prev => ({ ...prev, afip_cuit: digits.length === 11 ? formatCuit(digits) : digits }));
                    }}
                    placeholder="XX-XXXXXXXX-X"
                    inputMode="numeric"
                    className="kairox-input"
                  />
                  {formData.afip_cuit && formData.afip_cuit.replace(/\D/g, '').length !== 11 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">El CUIT debe tener 11 dígitos.</p>
                  )}
                </div>

                {/* Condición frente al IVA — editable, escribe directo a empresas.condicion_iva */}
                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-slate-300">Condición frente al IVA</Label>
                  <select
                    name="condicion_iva"
                    value={formData.condicion_iva}
                    onChange={(e) => setFormData(prev => ({ ...prev, condicion_iva: e.target.value }))}
                    className="w-full h-10 rounded-md border border-kx-border bg-kx-surface dark:bg-kx-surface px-3 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Sin especificar —</option>
                    <option value="RI">Responsable Inscripto</option>
                    <option value="Monotributo">Monotributista</option>
                    <option value="Exento">Exento</option>
                    <option value="CF">Consumidor Final</option>
                  </select>
                  <p className="text-[11px] text-kx-text-3">Se usa en certificados de retención y facturas. Si activás AFIP, se usa el mismo dato.</p>
                </div>

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
                    Cuando está activo, el sistema exige el TC del día antes de cualquier movimiento contable y
                    habilita el <strong>Reporte de Paridad ARS / {tcConfig.moneda_paralela}</strong>.
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

            {/* Condiciones de pago */}
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-kx-text-3" />
                  <h3 className="font-semibold text-kx-text">Condiciones de Pago</h3>
                </div>
                <Button size="sm" onClick={openNuevaCondicion}>+ Nueva</Button>
              </div>
              <p className="text-sm text-kx-text-2 mb-4">Plazos disponibles para clientes y proveedores. Se usan al asignar la condición de pago de un cliente.</p>

              {loadingCondiciones ? (
                <div className="flex items-center gap-2 text-kx-text-3 py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
                </div>
              ) : condicionesPago.length === 0 ? (
                <p className="text-sm text-kx-text-3 py-4 text-center">No hay condiciones de pago cargadas.</p>
              ) : (
                <div className="border border-kx-border rounded-xl overflow-hidden">
                  {condicionesPago.map(c => (
                    <div key={c.id} className="flex items-center justify-between px-4 py-2.5 border-b border-kx-border last:border-0">
                      <div className={`flex items-center gap-2 ${!c.activo ? 'opacity-40' : ''}`}>
                        <span className="text-sm font-medium text-kx-text">{c.nombre}</span>
                        <span className="text-xs text-kx-text-2">
                          {c.dias_credito} días{c.descuento_pct > 0 ? ` · ${c.descuento_pct}% desc.` : ''}
                        </span>
                        {!c.activo && <Badge variant="outline" className="text-xs text-slate-400">Inactiva</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={c.activo} onCheckedChange={(v) => toggleActivoCondicion(c.id, v)} />
                        <Button size="sm" variant="ghost" onClick={() => openEditarCondicion(c)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB — DETERMINACIÓN DE CUENTAS DE MAYOR (estilo SAP EBS / OBYC)
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="contabilidad">
          <DeterminacionCuentasTab empresaId={user?.empresa_id} />
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

            {/* ── Sección 1: Credenciales AFIP/ARCA ─────────────────────────── */}
            {afipConfig.usa_factura_electronica && (
              <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
                <div className="flex items-start gap-3 mb-4">
                  <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
                    <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Credenciales AFIP/ARCA</h3>
                    <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">Datos fiscales y certificado digital para la emisión de CAE.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <div className="bg-kx-surface-2 dark:bg-slate-900/50 rounded-lg p-3 border kairox-border">
                    <p className="text-xs text-kx-text-3 mb-1">CUIT</p>
                    <p className="text-sm font-mono font-medium text-kx-text">
                      {afipConfig.afip_cuit ? formatCuit(afipConfig.afip_cuit) : <span className="text-kx-text-3 italic">Sin configurar</span>}
                    </p>
                  </div>
                  <div className="bg-kx-surface-2 dark:bg-slate-900/50 rounded-lg p-3 border kairox-border">
                    <p className="text-xs text-kx-text-3 mb-1">Condición IVA</p>
                    <p className="text-sm font-medium text-kx-text">
                      {afipConfig.condicion_iva ?? <span className="text-kx-text-3 italic">Sin configurar</span>}
                    </p>
                  </div>
                  <div className="bg-kx-surface-2 dark:bg-slate-900/50 rounded-lg p-3 border kairox-border">
                    <p className="text-xs text-kx-text-3 mb-1">Certificado digital</p>
                    {certStatus === null ? (
                      <span className="inline-flex items-center gap-1 text-xs text-kx-text-3"><Loader2 className="w-3 h-3 animate-spin" /> Verificando...</span>
                    ) : certStatus ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"><Check className="w-3 h-3" /> Configurado</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400"><AlertCircle className="w-3 h-3" /> Sin certificado</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setCertForm({ cert: '', key: '' }); setCertModalOpen(true); }}>
                    <Shield className="w-3.5 h-3.5 mr-1.5" /> {certStatus ? 'Actualizar certificado' : 'Configurar certificado'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleProbarConexion} disabled={probandoConexion}>
                    {probandoConexion
                      ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                    {probandoConexion ? 'Probando...' : 'Probar conexión'}
                  </Button>
                </div>
              </div>
            )}

            {/* ── Sección 2: Puntos de Venta ────────────────────────────────── */}
            {afipConfig.usa_factura_electronica && (
              <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Puntos de Venta</h3>
                      <p className="text-sm text-slate-500 dark:text-kx-text-2">Configurados en ARCA para emitir comprobantes electrónicos.</p>
                    </div>
                  </div>
                  <Button size="sm" onClick={openAddPv} className="bg-blue-600 hover:bg-blue-700 text-white">
                    <Plus className="w-3.5 h-3.5 mr-1" /> Nuevo PdV
                  </Button>
                </div>

                {allPuntosVenta.length === 0 ? (
                  <p className="text-sm text-kx-text-3 text-center py-4">No hay puntos de venta configurados. Usá el botón "Completar configuración" o "+  Nuevo PdV".</p>
                ) : (
                  <div className="rounded-xl border border-kx-border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-kx-surface-2 dark:bg-slate-900/50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3 w-12">Nº</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3">Nombre</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3 hidden sm:table-cell">Tipo</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3 hidden md:table-cell">CAI Remito</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3 hidden md:table-cell">Venc. CAI</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-kx-text-3 w-16">Default</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-kx-text-3 w-16">Activo</th>
                          <th className="px-3 py-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {allPuntosVenta.map((pv) => {
                          const diasVenc = pv.cai_remito_vencimiento
                            ? Math.ceil((new Date(pv.cai_remito_vencimiento) - new Date()) / 86400000)
                            : null;
                          const caiAlert = diasVenc !== null && diasVenc >= 0 && diasVenc < 30;
                          return (
                            <tr key={pv.id} className="border-t border-kx-border hover:bg-kx-surface-2/50">
                              <td className="px-3 py-2 font-mono text-kx-text font-medium">{pv.numero}</td>
                              <td className="px-3 py-2 text-kx-text">{pv.nombre}</td>
                              <td className="px-3 py-2 text-kx-text-2 hidden sm:table-cell capitalize">{pv.tipo ?? 'web'}</td>
                              <td className="px-3 py-2 text-kx-text-2 font-mono text-xs hidden md:table-cell">
                                {pv.cai_remito ? pv.cai_remito.slice(0, 12) + '…' : '—'}
                              </td>
                              <td className="px-3 py-2 hidden md:table-cell">
                                {pv.cai_remito_vencimiento ? (
                                  <span className={`text-xs font-medium ${caiAlert ? 'text-amber-600 dark:text-amber-400' : 'text-kx-text-2'}`}>
                                    {caiAlert && <AlertCircle className="w-3 h-3 inline mr-0.5" />}
                                    {formatDateAR(pv.cai_remito_vencimiento)}
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {pv.es_default && <Check className="w-4 h-4 text-emerald-500 mx-auto" />}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <span className={`inline-block w-2 h-2 rounded-full ${pv.activo ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                              </td>
                              <td className="px-3 py-2">
                                <Button size="sm" variant="ghost" onClick={() => openEditPv(pv)}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {allPuntosVenta.some(pv => pv.cai_remito_vencimiento && Math.ceil((new Date(pv.cai_remito_vencimiento) - new Date()) / 86400000) < 30 && Math.ceil((new Date(pv.cai_remito_vencimiento) - new Date()) / 86400000) >= 0) && (
                  <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 mt-3">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    Uno o más CAI de remito vencen en menos de 30 días. Renovalos en ARCA antes de que expiren.
                  </div>
                )}
              </div>
            )}

            {/* ── Sección 3: Tipos de Comprobante ───────────────────────────── */}
            {afipConfig.usa_factura_electronica && allPuntosVenta.length > 0 && (
              <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
                <div className="flex items-start gap-3 mb-4">
                  <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
                    <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Tipos de Comprobante AFIP</h3>
                    <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
                      Próximo Nº es referencial — ARCA es siempre la fuente de verdad antes de emitir.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <Label className="text-kx-text-3 text-xs shrink-0">Punto de venta:</Label>
                  <Select value={selectedPvId ?? ''} onValueChange={setSelectedPvId}>
                    <SelectTrigger className="h-8 text-xs w-56 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text">
                      <SelectValue placeholder="Seleccioná un PdV" />
                    </SelectTrigger>
                    <SelectContent>
                      {allPuntosVenta.map(pv => (
                        <SelectItem key={pv.id} value={pv.id}>
                          PdV {pv.numero} — {pv.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {loadingTipos ? (
                  <div className="flex items-center gap-2 text-kx-text-3 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Cargando...</div>
                ) : tiposComprobante.length === 0 ? (
                  <p className="text-sm text-kx-text-3 py-4 text-center">Este punto de venta no tiene tipos de comprobante. Se siembran automáticamente al crear un PdV nuevo.</p>
                ) : (
                  <div className="rounded-xl border border-kx-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-kx-surface-2 dark:bg-slate-900/50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3">Tipo</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3 w-20">Cód. AFIP</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3 w-32">Próximo Nº (ref.)</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-kx-text-3 w-20">Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tiposComprobante.map((t) => (
                          <tr key={t.id} className={`border-t border-kx-border ${!t.habilitado ? 'opacity-40' : ''}`}>
                            <td className="px-3 py-2 font-mono text-xs font-medium text-kx-text">{t.tipo_interno}</td>
                            <td className="px-3 py-2 text-kx-text-2 text-xs">{t.codigo_afip ?? '—'}</td>
                            <td className="px-3 py-2">
                              <Input
                                type="number" min={1}
                                value={t.proximo_numero}
                                onChange={e => updateTipoLocal(t.id, 'proximo_numero', parseInt(e.target.value, 10) || 1)}
                                className="h-7 w-24 text-xs dark:bg-kx-surface dark:border-kx-border"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Button
                                size="sm" variant="outline"
                                disabled={savingTipoId === t.id}
                                onClick={() => handleSaveTipoProximoNumero(t)}
                                className="h-7 text-xs dark:border-kx-border"
                              >
                                {savingTipoId === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── Sección 4: Facturas con Error CAE ─────────────────────────── */}
            {afipConfig.usa_factura_electronica && (
              <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded-lg mt-0.5">
                      <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Facturas con Error CAE</h3>
                      <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
                        Comprobantes que fallaron en la emisión electrónica. El worker las reintenta automáticamente cada 5 minutos.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={reloadFacturasError}
                    className="p-2 rounded-lg border kairox-border hover:bg-slate-100 dark:hover:bg-kx-surface-2 transition-colors"
                    title="Recargar"
                  >
                    <RefreshCw className={`w-4 h-4 text-kx-text-2 ${loadingFacturasError ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {loadingFacturasError ? (
                  <div className="flex items-center gap-2 text-kx-text-3 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Cargando...</div>
                ) : facturasError.length === 0 ? (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400 py-3 text-sm">
                    <CheckCircle className="w-4 h-4" />
                    <span>Sin facturas con error. Todos los CAE fueron emitidos correctamente.</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-kx-text-3 uppercase tracking-wide">
                          <th className="px-3 py-2">Comprobante</th>
                          <th className="px-3 py-2">Fecha</th>
                          <th className="px-3 py-2">Cliente</th>
                          <th className="px-3 py-2 text-right">Total</th>
                          <th className="px-3 py-2">Estado</th>
                          <th className="px-3 py-2">Intentos</th>
                          <th className="px-3 py-2">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {facturasError.map((fpa) => {
                          const comp = fpa.comprobantes;
                          const puedeReintentar = !['error_datos'].includes(fpa.estado);
                          const estadoBadge = {
                            pendiente:       'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                            reintentando:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                            procesando:      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
                            error_datos:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                            error_definitivo:'bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-300',
                          }[fpa.estado] ?? 'bg-slate-100 text-slate-600';
                          return (
                            <tr key={fpa.id} className="border-t border-kx-border">
                              <td className="px-3 py-2 font-mono text-xs text-kx-text font-medium">{comp?.numero_venta ?? '—'}</td>
                              <td className="px-3 py-2 text-kx-text-2 whitespace-nowrap">{comp?.fecha ? new Date(comp.fecha).toLocaleDateString('es-AR') : '—'}</td>
                              <td className="px-3 py-2 text-kx-text-2 max-w-[140px] truncate">{comp?.cliente_nombre ?? 'Consumidor Final'}</td>
                              <td className="px-3 py-2 text-kx-text text-right font-medium">
                                {comp?.total != null ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(comp.total) : '—'}
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${estadoBadge}`}>
                                  {fpa.estado.replace('_', ' ')}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center text-kx-text-2 text-xs">{fpa.intentos}/{fpa.max_intentos}</td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1">
                                  {puedeReintentar && (
                                    <button
                                      onClick={() => handleReintentarFactura(fpa)}
                                      disabled={reintentandoId === fpa.id}
                                      className="text-xs px-2 py-1 rounded border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 transition-colors"
                                    >
                                      {reintentandoId === fpa.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Reintentar'}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setErrorDetailModal({ mensaje: fpa.error_mensaje ?? 'Sin detalle de error.' })}
                                    className="text-xs px-2 py-1 rounded border border-kx-border text-kx-text-2 hover:bg-slate-100 dark:hover:bg-kx-surface-2 transition-colors"
                                  >
                                    Ver error
                                  </button>
                                  <button
                                    onClick={() => handleMarcarResuelta(fpa)}
                                    disabled={resolviendoId === fpa.id}
                                    className="text-xs px-2 py-1 rounded border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 transition-colors"
                                  >
                                    {resolviendoId === fpa.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Resuelta'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Series de Numeración */}
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
              <div className="flex items-start gap-3 mb-4">
                <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
                  <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Series de Numeración</h3>
                  <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
                    Prefijo y próximo número de cada tipo de comprobante. Venta/Factura/NC/Pedido reinician su
                    secuencia cada día; Entrega/Recepción/Nota de Débito cada año; Cotización/Orden de Compra nunca.
                  </p>
                </div>
              </div>

              {loadingSeries ? (
                <div className="flex items-center gap-2 text-kx-text-3 py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 mb-4">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    Cambiar el próximo número puede generar números repetidos o saltos en la numeración — usar con cuidado.
                  </div>

                  <div className="rounded-xl border border-kx-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-kx-surface-2 dark:bg-slate-900/50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3">Tipo</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3">Prefijo</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3">Próximo número</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-kx-text-3">Preview</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-kx-text-3 w-20">Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {seriesNumeracion.map((serie) => (
                          <tr key={serie.id} className="border-t border-kx-border">
                            <td className="px-3 py-2 text-kx-text font-medium whitespace-nowrap">
                              {TIPO_DOCUMENTO_LABEL[serie.tipo_documento] ?? serie.tipo_documento}
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={serie.prefijo}
                                onChange={(e) => updateSerieLocal(serie.id, 'prefijo', e.target.value)}
                                className="h-8 w-24 text-xs dark:bg-kx-surface dark:border-kx-border"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                min={1}
                                value={serie.proximo_numero}
                                onChange={(e) => updateSerieLocal(serie.id, 'proximo_numero', e.target.value)}
                                className="h-8 w-24 text-xs dark:bg-kx-surface dark:border-kx-border"
                              />
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">
                              {previewProximoNumero(serie)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={savingSerieId === serie.id}
                                onClick={() => handleSaveSerie(serie)}
                                className="h-7 text-xs dark:border-kx-border"
                              >
                                {savingSerieId === serie.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* NOTA FUTURA (Q3 2026): cuando lleguen las series específicas por tipo de
                      comprobante AFIP (A/B/C/E), esta tabla es el punto de extensión natural —
                      agregar una fila por combinación tipo_documento + letra AFIP en vez de una
                      serie única por tipo_documento. No implementado todavía, a propósito. */}
                </>
              )}
            </div>

            {/* Pie de documento */}
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-5 h-5 text-kx-text-3" />
                <h3 className="font-semibold text-kx-text">Pie de Documento</h3>
              </div>
              <p className="text-sm text-kx-text-2 mb-3">Texto que aparece al pie de facturas, remitos y cotizaciones impresas.</p>
              <textarea
                value={pieDoc}
                onChange={e => setPieDoc(e.target.value)}
                maxLength={300}
                rows={3}
                placeholder="Ej: KAIROX S.A. · CUIT 30-12345678-9 · Lun-Vie 9-18hs"
                className="w-full px-3 py-2 rounded-lg border border-kx-border bg-kx-surface text-kx-text text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-kx-text-3">{pieDoc.length}/300</span>
                <Button onClick={handleSavePieDoc} disabled={savingPieDoc} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
                  {savingPieDoc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar'}
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 4 — INVENTARIO
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="inventario">
          <div className="space-y-6 max-w-2xl">
            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
              <div className="flex items-start gap-3 mb-4">
                <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
                  <Warehouse className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Método de Valoración de Stock</h3>
                  <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
                    Define cómo se actualiza el costo de tus productos en cada compra. No cambia cómo se calculan tus ventas
                    ni tus márgenes — eso siempre lee el costo ya actualizado, sin importar qué método lo generó.
                  </p>
                </div>
              </div>

              {loadingValoracion ? (
                <div className="flex items-center gap-2 text-kx-text-3 py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setValoracionStock('ultimo_costo')}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                      valoracionStock === 'ultimo_costo'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-kx-border hover:bg-kx-surface-2'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-kx-text">Último Costo</span>
                      {valoracionStock === 'ultimo_costo' && <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />}
                    </div>
                    <p className="text-xs text-kx-text-2 mt-1">
                      El costo de tus productos se actualiza con cada compra al precio más reciente. Simple y rápido.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setValoracionStock('promedio_ponderado')}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                      valoracionStock === 'promedio_ponderado'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-kx-border hover:bg-kx-surface-2'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-kx-text">Promedio Ponderado</span>
                      {valoracionStock === 'promedio_ponderado' && <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />}
                    </div>
                    <p className="text-xs text-kx-text-2 mt-1">
                      El costo se calcula como un promedio entre lo que tenías y lo que compraste. Más preciso si tus
                      precios de compra varían seguido.
                    </p>
                  </button>

                  <div className="w-full text-left p-4 rounded-lg border-2 border-kx-border opacity-50 cursor-not-allowed">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-kx-text flex items-center gap-2">
                        FIFO
                        <span className="text-[10px] bg-kx-surface-2 text-kx-text-3 px-2 py-0.5 rounded-full border border-kx-border">
                          Próximamente
                        </span>
                      </span>
                    </div>
                    <p className="text-xs text-kx-text-2 mt-1">
                      Próximamente — calcula el costo según el orden real de entrada de mercadería. Ideal para mayor
                      precisión contable.
                    </p>
                  </div>

                  <Button onClick={handleSaveValoracion} disabled={savingValoracion} className="bg-blue-600 hover:bg-blue-700 text-white mt-2">
                    {savingValoracion
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</>
                      : <><Save className="mr-2 h-4 w-4" /> Guardar método de valoración</>}
                  </Button>
                </div>
              )}
            </div>

            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Package2 className="w-5 h-5 text-kx-text-3" />
                  <h3 className="font-semibold text-kx-text">Unidades de Medida</h3>
                </div>
                <Button size="sm" onClick={openNuevaUM}>+ Nueva</Button>
              </div>
              <p className="text-sm text-kx-text-2 mb-4">Unidades disponibles para productos, compras, OC y cotizaciones.</p>

              {loadingUM ? (
                <div className="flex items-center gap-2 text-kx-text-3 py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
                </div>
              ) : unidadesMedida.length === 0 ? (
                <p className="text-sm text-kx-text-3 py-4 text-center">No hay unidades de medida cargadas.</p>
              ) : (
                <div className="border border-kx-border rounded-xl overflow-hidden">
                  {unidadesMedida.map(u => (
                    <div key={u.id} className="flex items-center justify-between px-4 py-2.5 border-b border-kx-border last:border-0">
                      <div className={`flex items-center gap-3 ${!u.activo ? 'opacity-40' : ''}`}>
                        <span className="text-xs font-mono bg-kx-surface-2 px-2 py-0.5 rounded">{u.codigo}</span>
                        <span className="text-sm text-kx-text">{u.descripcion}</span>
                        {!u.activo && <Badge variant="outline" className="text-xs text-slate-400">Inactiva</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={u.activo}
                          onCheckedChange={(v) => toggleActivoUM(u.id, v)}
                        />
                        <Button size="sm" variant="ghost" onClick={() => openEditarUM(u)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-5 h-5 text-kx-text-3" />
                <h3 className="font-semibold text-kx-text">Stock Mínimo Global</h3>
              </div>
              <p className="text-sm text-kx-text-2 mb-4">Umbral de stock para alertas. Se aplica a productos sin mínimo individual — si el producto tiene su propio valor configurado, ese tiene prioridad.</p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={stockMinimoGlobal}
                  onChange={e => setStockMinimoGlobal(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-24 px-3 py-2 rounded-lg border border-kx-border bg-kx-surface text-kx-text text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
                <span className="text-sm text-kx-text-2">unidades</span>
                <Button onClick={handleSaveStockMin} disabled={savingStockMin} size="sm" className="ml-auto bg-blue-600 hover:bg-blue-700 text-white">
                  {savingStockMin ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar'}
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 5 — INTEGRACIONES
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="integraciones">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

            {/* ── Mercado Pago — card rica con estado real ── */}
            <div className="kairox-bg-card border kairox-border p-5 rounded-xl shadow-sm flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#009EE3] flex items-center justify-center text-white font-bold text-sm shrink-0">
                    MP
                  </div>
                  <div>
                    <h4 className="font-semibold text-kx-text text-sm">Mercado Pago</h4>
                    {integracionMP?.activo ? (
                      <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 mt-1">
                        ✓ Conectado
                      </span>
                    ) : (
                      <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border bg-kx-surface-2 text-kx-text-3 border-kx-border mt-1">
                        Sin configurar
                      </span>
                    )}
                  </div>
                </div>
                <Button size="sm" variant="outline" className="text-xs h-8 shrink-0" onClick={() => setShowConfigMP(true)}>
                  {integracionMP ? 'Editar' : 'Conectar'}
                </Button>
              </div>

              <p className="text-xs text-kx-text-2 leading-relaxed">
                Sincronización automática de cobros via QR, link de pago y tarjeta. Los pagos aprobados se registran en Bancos sin intervención manual.
              </p>

              {integracionMP?.ultimo_sync && (
                <p className="text-xs text-kx-text-3">
                  Último sync: {formatDateAR(integracionMP.ultimo_sync)}
                </p>
              )}

              {integracionMP?.activo && (
                <div className="p-3 bg-kx-surface-2 rounded-lg border border-kx-border space-y-1.5">
                  <p className="text-xs font-medium text-kx-text-2">URL del Webhook (configurar en MP Developers)</p>
                  {/* SECURITY-WEBHOOK-URL */}
                  <div className="flex items-center gap-2">
                    <code className="text-[10px] text-kx-text flex-1 break-all leading-relaxed">
                      {showWebhookUrl
                        ? `${supabaseUrl}/functions/v1/mp-webhook?empresa_id=${user?.empresa_id}`
                        : '••••••••••••••••••••••••••'}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={() => setShowWebhookUrl(v => !v)}
                      title={showWebhookUrl ? 'Ocultar URL' : 'Mostrar URL'}
                    >
                      {showWebhookUrl ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `${supabaseUrl}/functions/v1/mp-webhook?empresa_id=${user?.empresa_id}`
                        );
                        toast({ title: '✓ URL copiada al portapapeles' });
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Ualá (conciliación) — card rica con estado real ── */}
            <div className="kairox-bg-card border kairox-border p-5 rounded-xl shadow-sm flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-500 flex items-center justify-center text-white text-base shrink-0">
                    💳
                  </div>
                  <div>
                    <h4 className="font-semibold text-kx-text text-sm">Ualá (conciliación)</h4>
                    {integracionUala?.activo ? (
                      <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 mt-1">
                        ✓ Conectado
                      </span>
                    ) : (
                      <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border bg-kx-surface-2 text-kx-text-3 border-kx-border mt-1">
                        Sin configurar
                      </span>
                    )}
                  </div>
                </div>
                <Button size="sm" variant="outline" className="text-xs h-8 shrink-0" onClick={() => setShowConfigUala(true)}>
                  {integracionUala ? 'Editar' : 'Conectar'}
                </Button>
              </div>

              <p className="text-xs text-kx-text-2 leading-relaxed">
                Las transferencias de Ualá sincronizadas desde Gmail por el Apps Script se registran automáticamente en Bancos (no en Caja) una vez que elegís a qué cuenta bancaria corresponden.
              </p>
            </div>

            <IntegracionCard
              nombre="Ualá QR"
              descripcion="Pagos con QR Ualá desde la pantalla de caja. Cobros instantáneos sin hardware adicional."
              estado="proximamente"
              logo="📱"
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

          {/* ── Puente Caja ↔ Bancos ── */}
          <div className="mt-6 kairox-bg-card border kairox-border rounded-xl shadow-sm p-5">
            <h4 className="font-semibold text-kx-text text-sm mb-1 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-kx-accent" />
              Puente Caja → Bancos
            </h4>
            <p className="text-xs text-kx-text-2 mb-4 leading-relaxed">
              Cuando se confirma una venta con estos métodos de pago, se crea automáticamente un movimiento
              en la cuenta bancaria seleccionada. Efectivo y Cuenta Corriente nunca se acreditan en Bancos.
            </p>
            <div className="space-y-3">
              {METODOS_BANCARIOS.map(metodo => (
                <div key={metodo} className="flex items-center gap-3">
                  <span className="w-32 text-sm font-medium text-kx-text shrink-0">{metodo}</span>
                  <Select
                    value={mapeosCuentas[metodo] ?? '__none__'}
                    onValueChange={v => setMapeosCuentas(prev => ({ ...prev, [metodo]: v === '__none__' ? '' : v }))}
                  >
                    <SelectTrigger className="flex-1 h-9 text-sm kairox-input">
                      <SelectValue placeholder="— Sin acreditación bancaria —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Sin acreditación bancaria —</SelectItem>
                      {cuentasBancariasLista.map(cb => (
                        <SelectItem key={cb.id} value={cb.id}>{cb.nombre} ({cb.banco})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={handleSaveMapeos} disabled={savingMapeos} className="gap-2">
                {savingMapeos ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Guardar mapeo
              </Button>
            </div>
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
          <TabSistema user={user} />
        </TabsContent>
      </Tabs>

      {/* ═══════════════════════════════════════════════════════════════════
          MODAL — Certificado ARCA
      ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={certModalOpen} onOpenChange={setCertModalOpen}>
        <DialogContent className="sm:max-w-[560px] bg-kx-surface border-kx-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-kx-text">
              <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              Configurar Certificado Digital ARCA
            </DialogTitle>
            <DialogDescription>
              Pegá el certificado (.crt) y la clave privada (.key) que obtuviste de ARCA. Se guardan en Vault encriptados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-kx-text">Certificado (.crt / PEM) *</Label>
              <Textarea
                value={certForm.cert}
                onChange={e => setCertForm(f => ({ ...f, cert: e.target.value }))}
                placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                className="font-mono text-xs h-28 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-kx-text">Clave privada (.key / PEM) *</Label>
              <Textarea
                value={certForm.key}
                onChange={e => setCertForm(f => ({ ...f, key: e.target.value }))}
                placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                className="font-mono text-xs h-28 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text resize-none"
              />
            </div>
            <div className="flex items-start gap-2 text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Las credenciales se guardan encriptadas en Vault de Supabase con las claves <code className="font-mono">afip_cert_{'{empresa_id}'}</code> y <code className="font-mono">afip_key_{'{empresa_id}'}</code>. Nunca se almacenan en texto plano.
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-kx-border">
            <Button variant="outline" onClick={() => setCertModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveCert} disabled={savingCert} className="bg-blue-600 hover:bg-blue-700 text-white">
              {savingCert ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</> : <><Shield className="w-4 h-4 mr-2" /> Guardar en Vault</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════
          MODAL — Nuevo/Editar Punto de Venta
      ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={showPvModal} onOpenChange={setShowPvModal}>
        <DialogContent className="sm:max-w-[480px] bg-kx-surface border-kx-border">
          <DialogHeader>
            <DialogTitle className="text-kx-text">{editingPv ? 'Editar' : 'Nuevo'} Punto de Venta</DialogTitle>
            <DialogDescription>Registrá el punto de venta tal como está configurado en ARCA.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-kx-text">Número (1–9999) *</Label>
                <Input
                  type="number" min={1} max={9999}
                  value={pvForm.numero}
                  onChange={e => setPvForm(f => ({ ...f, numero: e.target.value }))}
                  placeholder="1"
                  disabled={!!editingPv}
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-kx-text">Tipo</Label>
                <Select value={pvForm.tipo} onValueChange={v => setPvForm(f => ({ ...f, tipo: v }))}>
                  <SelectTrigger className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="web">Web</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-kx-text">Nombre interno *</Label>
              <Input
                value={pvForm.nombre}
                onChange={e => setPvForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Caja Principal"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-kx-text">CAI Remito</Label>
              <Input
                value={pvForm.cai_remito}
                onChange={e => setPvForm(f => ({ ...f, cai_remito: e.target.value }))}
                placeholder="Número de CAI"
                className="font-mono dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-kx-text">Vencimiento CAI</Label>
                <Input
                  type="date"
                  value={pvForm.cai_remito_vencimiento}
                  onChange={e => setPvForm(f => ({ ...f, cai_remito_vencimiento: e.target.value }))}
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-kx-text">Próx. Nº Remito</Label>
                <Input
                  type="number" min={1}
                  value={pvForm.proximo_numero_remito}
                  onChange={e => setPvForm(f => ({ ...f, proximo_numero_remito: e.target.value }))}
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={pvForm.es_default} onCheckedChange={v => setPvForm(f => ({ ...f, es_default: v }))} />
                <Label className="text-kx-text text-sm">PdV por defecto</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={pvForm.activo} onCheckedChange={v => setPvForm(f => ({ ...f, activo: v }))} />
                <Label className="text-kx-text text-sm">Activo</Label>
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-kx-border">
            <Button variant="outline" onClick={() => setShowPvModal(false)}>Cancelar</Button>
            <Button onClick={handleSavePv} disabled={savingPv} className="bg-blue-600 hover:bg-blue-700 text-white">
              {savingPv ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</> : 'Guardar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════
          MODAL — Nueva/Editar Condición de Pago (fuera del sistema de tabs)
      ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={showCondicionModal} onOpenChange={setShowCondicionModal}>
        <DialogContent className="sm:max-w-[420px] bg-kx-surface border-kx-border">
          <DialogHeader>
            <DialogTitle className="text-kx-text">{editingCondicion ? 'Editar' : 'Nueva'} Condición de Pago</DialogTitle>
            <DialogDescription>Plazo y descuento aplicable a clientes/proveedores.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-kx-text">Nombre *</Label>
              <Input
                value={condicionForm.nombre}
                onChange={e => setCondicionForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: 45 días"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-kx-text">Días de crédito</Label>
              <Input
                type="number" min="0"
                value={condicionForm.dias_credito}
                onChange={e => setCondicionForm(f => ({ ...f, dias_credito: e.target.value }))}
                placeholder="0"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-kx-text">Descuento % (opcional)</Label>
              <Input
                type="number" min="0" max="100" step="0.01"
                value={condicionForm.descuento_pct}
                onChange={e => setCondicionForm(f => ({ ...f, descuento_pct: e.target.value }))}
                placeholder="0"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-kx-border">
            <Button variant="outline" onClick={() => setShowCondicionModal(false)}>Cancelar</Button>
            <Button onClick={handleGuardarCondicion} disabled={savingCondicion}>
              {savingCondicion ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</> : 'Guardar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════
          MODAL — Nueva/Editar Unidad de Medida (fuera del sistema de tabs)
      ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={showUMModal} onOpenChange={setShowUMModal}>
        <DialogContent className="sm:max-w-[380px] bg-kx-surface border-kx-border">
          <DialogHeader>
            <DialogTitle className="text-kx-text">{editingUM ? 'Editar' : 'Nueva'} Unidad de Medida</DialogTitle>
            <DialogDescription>Código corto + descripción para usar en productos, compras y ventas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-kx-text">Código *</Label>
              <Input
                value={umForm.codigo}
                onChange={e => setUmForm(f => ({ ...f, codigo: e.target.value }))}
                placeholder="Ej: TN"
                maxLength={10}
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text font-mono uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-kx-text">Descripción *</Label>
              <Input
                value={umForm.descripcion}
                onChange={e => setUmForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Ej: Tonelada"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-kx-border">
            <Button variant="outline" onClick={() => setShowUMModal(false)}>Cancelar</Button>
            <Button onClick={handleGuardarUM} disabled={savingUM}>
              {savingUM ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</> : 'Guardar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

      {/* ── Modal configuración Mercado Pago ──────────────────────────────── */}
      <ConfigMercadoPagoModal
        open={showConfigMP}
        onOpenChange={setShowConfigMP}
        integracion={integracionMP}
        onSuccess={reloadIntegracionMP}
      />

      {/* ── Modal configuración Ualá (conciliación) ───────────────────────── */}
      <ConfigUalaModal
        open={showConfigUala}
        onOpenChange={setShowConfigUala}
        integracion={integracionUala}
        onSuccess={reloadIntegracionUala}
      />

      {/* ── Modal detalle error ARCA ───────────────────────────────────────── */}
      <Dialog open={!!errorDetailModal} onOpenChange={(o) => !o && setErrorDetailModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-5 h-5" />
              Detalle del error ARCA
            </DialogTitle>
            <DialogDescription>
              Mensaje de error devuelto por el servicio WSFE de AFIP/ARCA.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <pre className="text-sm text-red-800 dark:text-red-300 whitespace-pre-wrap break-words font-mono">
              {errorDetailModal?.mensaje ?? ''}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ConfiguracionSection;
