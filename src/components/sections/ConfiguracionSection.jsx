import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Settings, Building, Loader2, TrendingUp, FileText, Check, Download,
  Users, Puzzle, Bell, Package2, Info, Cpu, Shield, Scale,
} from 'lucide-react';
import DeterminacionCuentasTab from '@/components/configuracion/DeterminacionCuentasTab';
import TabSistema from '@/components/configuracion/TabSistema';
import TabAlertas from '@/components/configuracion/TabAlertas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConfig, LOGO_CACHE_KEY } from '@/contexts/ConfigContext';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import UsuariosSection from '@/components/sections/UsuariosSection';
import ConfigMercadoPagoModal from '@/components/bancos/ConfigMercadoPagoModal';
import ConfigUalaModal from '@/components/bancos/ConfigUalaModal';
import { formatCuit } from '@/lib/cuitUtils';
import TabEmpresa from '@/components/configuracion/TabEmpresa';
import TabFinanzas, { TIPO_INSTRUMENTO_LABEL } from '@/components/configuracion/TabFinanzas';
import TabInventario from '@/components/configuracion/TabInventario';
import TabIntegraciones from '@/components/configuracion/TabIntegraciones';
import ConectarTiendanubeModal from '@/components/integraciones/ConectarTiendanubeModal';
import ConectarMercadoLibreModal from '@/components/integraciones/ConectarMercadoLibreModal';
import MapeoProductosModal from '@/components/integraciones/MapeoProductosModal';
import TabFacturacion from '@/components/configuracion/TabFacturacion';
import { MAGNITUDES } from '@/lib/unidadesMedida';

const TAB_IDS = ['empresa', 'finanzas', 'facturacion', 'inventario', 'integraciones', 'alertas', 'usuarios', 'sistema'];

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
  const queryClient = useQueryClient();
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
    telefono: '',
    rubro: '',
    provincia: '',
    localidad: '',
    cp: '',
    afip_cuit: '',
    condicion_iva: '',
    numero_ingresos_brutos: '',
    fecha_inicio_actividades: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [empresaDatos, setEmpresaDatos] = useState({
    afip_cuit: null, condicion_iva: null, numero_ingresos_brutos: null, fecha_inicio_actividades: null,
  });

  // ── Tab 2: Finanzas ───────────────────────────────────────────────────────
  const [tcConfig, setTcConfig] = useState({ usa_tc_paralelo: false, moneda_paralela: 'USD', tc_automatico: false });
  const [loadingTC, setLoadingTC] = useState(false);
  const [savingTC, setSavingTC] = useState(false);

  // ── Tab 2: Finanzas — Toggle Impuestos Avanzados (IIBB / Retenciones) ──────
  const [impuestosAvanzados, setImpuestosAvanzados] = useState(false);
  const [loadingImpuestosAv, setLoadingImpuestosAv] = useState(false);
  const [cotizacionesActivo, setCotizacionesActivo] = useState(true);
  const [loadingCotizacionesActivo, setLoadingCotizacionesActivo] = useState(false);
  const [savingCotizacionesActivo, setSavingCotizacionesActivo] = useState(false);
  const [savingImpuestosAv, setSavingImpuestosAv] = useState(false);
  const [usaCentrosCosto, setUsaCentrosCosto] = useState(false);
  const [loadingUsaCentrosCosto, setLoadingUsaCentrosCosto] = useState(false);
  const [savingUsaCentrosCosto, setSavingUsaCentrosCosto] = useState(false);
  // Toggle de plan: integración de ecommerce (mig.236)
  const [usaEcommerce, setUsaEcommerce] = useState(false);
  const [savingUsaEcommerce, setSavingUsaEcommerce] = useState(false);

  // ── Tab 2: Finanzas — Fidelización por Puntos (mig.312, Fase 1) ────────────
  const [fidelizacionConfig, setFidelizacionConfig] = useState({
    usa_fidelizacion: false, puntos_pesos_por_punto: '', puntos_valor_pesos: '',
  });
  const [loadingFidelizacion, setLoadingFidelizacion] = useState(false);
  const [savingFidelizacion, setSavingFidelizacion] = useState(false);

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

  // ── Tab 2: Formas de Pago ────────────────────────────────────────────────
  const [formasPago, setFormasPago] = useState([]);
  const [loadingFormasPago, setLoadingFormasPago] = useState(true);
  const [showFormaPagoModal, setShowFormaPagoModal] = useState(false);
  const [editingFormaPago, setEditingFormaPago] = useState(null);
  const [formaPagoForm, setFormaPagoForm] = useState({
    nombre: '', tipo_instrumento: 'efectivo', cuenta_bancaria_id: '',
    dias_acreditacion: '', comision_porcentaje: '',
  });
  const [savingFormaPago, setSavingFormaPago] = useState(false);

  // ── Tab 2: Cajas (multi-caja simultánea del Modo Caja) ───────────────────
  const [cajas, setCajas] = useState([]);
  const [loadingCajas, setLoadingCajas] = useState(true);
  const [showCajaModal, setShowCajaModal] = useState(false);
  const [editingCaja, setEditingCaja] = useState(null);
  const [cajaForm, setCajaForm] = useState({ nombre: '' });
  const [savingCaja, setSavingCaja] = useState(false);

  // ── Tab 2: Centros de Costo (Fase 1 del plan de 4 frentes contables) ────
  const [centrosCosto, setCentrosCosto] = useState([]);
  const [loadingCentrosCosto, setLoadingCentrosCosto] = useState(true);
  const [showCentroCostoModal, setShowCentroCostoModal] = useState(false);
  const [editingCentroCosto, setEditingCentroCosto] = useState(null);
  const [centroCostoForm, setCentroCostoForm] = useState({ nombre: '' });
  const [savingCentroCosto, setSavingCentroCosto] = useState(false);

  // ── Tab 3: Facturación ────────────────────────────────────────────────────
  const [afipConfig, setAfipConfig] = useState({
    usa_factura_electronica: false,
    condicion_iva: null,
    afip_cuit: null,
    nombre: '',
  });
  const [puntosVenta, setPuntosVenta] = useState([]);
  const [loadingAFIP, setLoadingAFIP] = useState(false);
  // mig.347 — no es un dato fiscal (no depende de usa_factura_electronica),
  // pero se recarga junto con el resto porque ya hay un fetch de `empresas`
  // acá mismo (reloadAFIP) y no vale la pena uno aparte para un solo booleano.
  const [usaEnPreparacion, setUsaEnPreparacion] = useState(true);
  const [savingEnPreparacion, setSavingEnPreparacion] = useState(false);

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
  // PdV propio del Modo Caja (mig.293) — null = el mismo que el resto del sistema
  const [posPuntoVentaId, setPosPuntoVentaId] = useState(null);
  const [savingPosPv, setSavingPosPv]         = useState(false);
  const [certStatus, setCertStatus] = useState(null);
  const [certModalOpen, setCertModalOpen] = useState(false);
  const [certForm, setCertForm] = useState({ cert: '', key: '' });
  const [savingCert, setSavingCert] = useState(false);
  const [showPvModal, setShowPvModal] = useState(false);
  const [editingPv, setEditingPv] = useState(null);
  const [pvForm, setPvForm] = useState({
    numero: '', nombre: 'Punto de Venta Principal', tipo: 'web',
    cai_remito: '', cai_remito_vencimiento: '', proximo_numero_remito: 1,
    es_default: false, activo: true, solo_remito: false,
  });
  const [savingPv, setSavingPv] = useState(false);
  const [selectedPvId, setSelectedPvId] = useState(null);
  const [tiposComprobante, setTiposComprobante] = useState([]);
  const [loadingTipos, setLoadingTipos] = useState(false);
  const [savingTipoId, setSavingTipoId] = useState(null);

  // ── Tab 3b: prueba de conexión AFIP ───────────────────────────────────────
  // (La lista de facturas + su estado electrónico ahora vive en
  //  MonitorFacturacionAFIP, autocontenido con su propio fetching vía useQuery.)
  const [probandoConexion, setProbandoConexion] = useState(false);

  // ── Tab 4: Unidades de Medida ─────────────────────────────────────────────
  const [unidadesMedida, setUnidadesMedida] = useState([]);
  const [loadingUM, setLoadingUM] = useState(true);
  const [showUMModal, setShowUMModal] = useState(false);
  const [editingUM, setEditingUM] = useState(null);
  const [umForm, setUmForm] = useState({ codigo: '', descripcion: '', magnitud: '', factor_base: '' });
  const [savingUM, setSavingUM] = useState(false);

  // ── Tab 5: Integraciones — Mercado Pago ──────────────────────────────────
  const [integracionMP,  setIntegracionMP]  = useState(null);
  const [showConfigMP,   setShowConfigMP]   = useState(false);
  const [integracionUala, setIntegracionUala] = useState(null);
  const [showConfigUala,  setShowConfigUala]  = useState(false);
  const [showWebhookUrl, setShowWebhookUrl] = useState(false); // SECURITY-WEBHOOK-URL
  const [integracionTiendanube,    setIntegracionTiendanube]    = useState(null);
  const [showConectarTiendanube,   setShowConectarTiendanube]   = useState(false);
  const [integracionMercadoLibre,  setIntegracionMercadoLibre]  = useState(null);
  const [showConectarMercadoLibre, setShowConectarMercadoLibre] = useState(false);
  const [showMapeoProductosTN,     setShowMapeoProductosTN]     = useState(false);
  const [showMapeoProductosML,     setShowMapeoProductosML]     = useState(false);

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
        .select('usa_factura_electronica, condicion_iva, afip_cuit, nombre, numero_ingresos_brutos, fecha_inicio_actividades, pos_punto_venta_id, usa_estado_en_preparacion')
        .eq('id', user.empresa_id)
        .single();
      if (emp) {
        setPosPuntoVentaId(emp.pos_punto_venta_id ?? null);
        setUsaEnPreparacion(emp.usa_estado_en_preparacion ?? true);
        setAfipConfig({
          usa_factura_electronica: emp.usa_factura_electronica ?? false,
          condicion_iva: emp.condicion_iva ?? null,
          afip_cuit: emp.afip_cuit ?? null,
          nombre: emp.nombre ?? '',
        });
        setEmpresaDatos({
          afip_cuit: emp.afip_cuit ?? null,
          condicion_iva: emp.condicion_iva ?? null,
          numero_ingresos_brutos: emp.numero_ingresos_brutos ?? null,
          fecha_inicio_actividades: emp.fecha_inicio_actividades ?? null,
        });
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
    // 'empresa' es la tab por defecto (no 'facturacion') — antes esto solo se
    // disparaba al visitar Facturación, así que CUIT/Cond. IVA/IIBB/Inicio de
    // Actividades aparecían vacíos en Configuración → Empresa hasta que el
    // usuario pasara primero por la otra tab.
    if (activeTab === 'facturacion' || activeTab === 'empresa') reloadAFIP();
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
        nombre_empresa: config.nombre_empresa || '',
        // El resto de los campos de contacto (email, dirección, rubro, localidad,
        // provincia, cp, teléfono) NO viajan por este contexto global (EGRESS-FIX
        // sesión 78 lo acotó a solo nombre_empresa) — los trae el fetch dedicado
        // de abajo, dirigido con `.in('clave', [...])` para no repetir el problema
        // de egress. Antes de este fix quedaban permanentemente en blanco acá
        // aunque estuvieran guardados en la DB.
      }));
    }
  }, [config]);

  // Contacto/domicilio de la empresa: fetch dedicado y filtrado (no pasa por el
  // contexto global, ver comentario arriba). Antes de este fix, Configuración →
  // Empresa mostraba estos campos vacíos en cada carga de página aunque
  // estuvieran guardados — el usuario podía terminar re-tipeando y pisando datos
  // reales, y los PDFs (que sí leen esta tabla) mostraban valores desincronizados.
  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase
      .from('configuracion')
      .select('clave, valor')
      .eq('empresa_id', user.empresa_id)
      .in('clave', ['email_empresa', 'direccion', 'telefono', 'rubro', 'provincia', 'localidad', 'cp'])
      .then(({ data }) => {
        const cfg = Object.fromEntries((data ?? []).map(r => [r.clave, r.valor]));
        setFormData(prev => ({
          ...prev,
          email_empresa: cfg.email_empresa ?? '',
          direccion:     cfg.direccion     ?? '',
          telefono:      cfg.telefono      ?? '',
          rubro:         cfg.rubro         ?? '',
          provincia:     cfg.provincia     ?? '',
          localidad:     cfg.localidad     ?? '',
          cp:            cfg.cp            ?? '',
        }));
      });
  }, [user?.empresa_id]);

  // EGRESS-FIX (sesión 78): traer el logo existente por su cuenta, filtrado por clave
  // (nunca más vía el contexto global). Además lo cachea en localStorage para que la
  // pantalla de login pueda mostrar el branding sin pegarle a la DB.
  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase
      .from('configuracion')
      .select('valor')
      .eq('empresa_id', user.empresa_id)
      .eq('clave', 'logo_base64')
      .maybeSingle()
      .then(({ data }) => {
        const logo = data?.valor || '';
        setFormData(prev => ({ ...prev, company_logo: logo }));
        try {
          if (logo) localStorage.setItem(LOGO_CACHE_KEY, logo);
          else localStorage.removeItem(LOGO_CACHE_KEY);
        } catch { /* no crítico */ }
      });
  }, [user?.empresa_id]);

  // Hidratar afip_cuit/condicion_iva/IIBB/inicio de actividades en el form cuando llega desde empresas
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      afip_cuit:                empresaDatos.afip_cuit     ? formatCuit(empresaDatos.afip_cuit) : '',
      condicion_iva:            empresaDatos.condicion_iva ?? '',
      numero_ingresos_brutos:   empresaDatos.numero_ingresos_brutos ?? '',
      fecha_inicio_actividades: empresaDatos.fecha_inicio_actividades ?? '',
    }));
  }, [empresaDatos.afip_cuit, empresaDatos.condicion_iva, empresaDatos.numero_ingresos_brutos, empresaDatos.fecha_inicio_actividades]);

  useEffect(() => {
    if (!user?.empresa_id) return;
    const loadTC = async () => {
      setLoadingTC(true);
      try {
        const { data } = await supabase
          .from('empresas')
          .select('usa_tc_paralelo, moneda_paralela, tc_automatico')
          .eq('id', user.empresa_id)
          .single();
        if (data) setTcConfig({
          usa_tc_paralelo: data.usa_tc_paralelo ?? false,
          moneda_paralela: data.moneda_paralela ?? 'USD',
          tc_automatico:   data.tc_automatico   ?? false,
        });
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
    const loadImpuestosAv = async () => {
      setLoadingImpuestosAv(true);
      try {
        const { data } = await supabase
          .from('empresas')
          .select('usa_impuestos_avanzados')
          .eq('id', user.empresa_id)
          .single();
        if (data) setImpuestosAvanzados(data.usa_impuestos_avanzados ?? false);
      } catch (e) {
        console.error('[Impuestos Avanzados] Error al cargar config:', e);
      } finally {
        setLoadingImpuestosAv(false);
      }
    };
    loadImpuestosAv();
  }, [user?.empresa_id]);

  useEffect(() => {
    if (!user?.empresa_id) return;
    const loadCotizacionesActivo = async () => {
      setLoadingCotizacionesActivo(true);
      try {
        const { data } = await supabase
          .from('empresas')
          .select('cotizaciones_activo')
          .eq('id', user.empresa_id)
          .single();
        if (data) setCotizacionesActivo(data.cotizaciones_activo ?? true);
      } catch (e) {
        console.error('[Módulo Cotizaciones] Error al cargar config:', e);
      } finally {
        setLoadingCotizacionesActivo(false);
      }
    };
    loadCotizacionesActivo();
  }, [user?.empresa_id]);

  useEffect(() => {
    if (!user?.empresa_id) return;
    const loadUsaCentrosCosto = async () => {
      setLoadingUsaCentrosCosto(true);
      try {
        const { data } = await supabase
          .from('empresas')
          .select('usa_centros_costo')
          .eq('id', user.empresa_id)
          .single();
        if (data) setUsaCentrosCosto(data.usa_centros_costo ?? false);
      } catch (e) {
        console.error('[Centros de Costo] Error al cargar config:', e);
      } finally {
        setLoadingUsaCentrosCosto(false);
      }
    };
    loadUsaCentrosCosto();
  }, [user?.empresa_id]);

  useEffect(() => {
    if (!user?.empresa_id) return;
    const loadFidelizacion = async () => {
      setLoadingFidelizacion(true);
      try {
        const { data } = await supabase
          .from('empresas')
          .select('usa_fidelizacion, puntos_pesos_por_punto, puntos_valor_pesos')
          .eq('id', user.empresa_id)
          .single();
        if (data) setFidelizacionConfig({
          usa_fidelizacion: data.usa_fidelizacion ?? false,
          puntos_pesos_por_punto: data.puntos_pesos_por_punto ?? '',
          puntos_valor_pesos: data.puntos_valor_pesos ?? '',
        });
      } catch (e) {
        console.error('[Fidelización] Error al cargar config:', e);
      } finally {
        setLoadingFidelizacion(false);
      }
    };
    loadFidelizacion();
  }, [user?.empresa_id]);

  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase
      .from('empresas')
      .select('usa_ecommerce')
      .eq('id', user.empresa_id)
      .single()
      .then(({ data }) => { if (data) setUsaEcommerce(data.usa_ecommerce ?? false); });
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

  const reloadIntegracionTiendanube = () => {
    if (!user?.empresa_id) return;
    supabase
      .from('integraciones_canales')
      .select('id, empresa_id, canal, activo, external_store_id, ultimo_sync_productos, ultimo_sync_pedidos')
      .eq('empresa_id', user.empresa_id)
      .eq('canal', 'tiendanube')
      .maybeSingle()
      .then(({ data }) => setIntegracionTiendanube(data ?? null));
  };

  useEffect(() => { reloadIntegracionTiendanube(); }, [user?.empresa_id]);

  const reloadIntegracionMercadoLibre = () => {
    if (!user?.empresa_id) return;
    supabase
      .from('integraciones_canales')
      .select('id, empresa_id, canal, activo, external_store_id, ultimo_sync_productos, ultimo_sync_pedidos')
      .eq('empresa_id', user.empresa_id)
      .eq('canal', 'mercadolibre')
      .maybeSingle()
      .then(({ data }) => setIntegracionMercadoLibre(data ?? null));
  };

  useEffect(() => { reloadIntegracionMercadoLibre(); }, [user?.empresa_id]);

  // Volver de un flujo OAuth (integraciones-oauth-callback redirige acá con
  // ?integracion=X&status=ok|error) — refrescar el estado para que la card
  // muestre "Conectado" sin que el usuario tenga que recargar a mano.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const integracion = params.get('integracion');
    if (integracion === 'tiendanube') reloadIntegracionTiendanube();
    if (integracion === 'mercadolibre') reloadIntegracionMercadoLibre();
  }, [user?.empresa_id]);

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

  const fetchFormasPago = async () => {
    if (!user?.empresa_id) return;
    setLoadingFormasPago(true);
    try {
      const { data, error } = await supabase
        .from('formas_pago')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .order('nombre');
      if (error) throw error;
      setFormasPago(data ?? []);
    } catch (e) {
      console.error('[Formas de Pago] Error al cargar:', e);
    } finally {
      setLoadingFormasPago(false);
    }
  };

  useEffect(() => { fetchFormasPago(); }, [user?.empresa_id]);

  const fetchCentrosCosto = async () => {
    if (!user?.empresa_id) return;
    setLoadingCentrosCosto(true);
    try {
      const { data, error } = await supabase
        .from('centros_costo')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .order('nombre');
      if (error) throw error;
      setCentrosCosto(data ?? []);
    } catch (e) {
      console.error('[Centros de Costo] Error al cargar:', e);
    } finally {
      setLoadingCentrosCosto(false);
    }
  };

  useEffect(() => { fetchCentrosCosto(); }, [user?.empresa_id]);

  const fetchCajas = async () => {
    if (!user?.empresa_id) return;
    setLoadingCajas(true);
    try {
      const { data, error } = await supabase
        .from('cajas')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .order('created_at');
      if (error) throw error;
      setCajas(data ?? []);
    } catch (e) {
      console.error('[Cajas] Error al cargar:', e);
    } finally {
      setLoadingCajas(false);
    }
  };

  useEffect(() => { fetchCajas(); }, [user?.empresa_id]);

  // ─────────────────────────────────────────────────────────────────────────
  // Tab 1 handlers
  // ─────────────────────────────────────────────────────────────────────────
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // STORAGE-FIX (sesión 78, follow-up del fix de egress): el logo ya no se
  // guarda como base64 en Postgres — se sube al bucket `logos-empresa`
  // (migration 223) y solo se persiste la URL pública. Sigue redimensionado
  // en el browser antes de subir (perf/tamaño), pero el resultado ahora es
  // un Blob para `storage.upload`, no un data URI para una columna de texto.
  const resizeImageToBlob = (file, { maxSide = 400, quality = 0.85 } = {}) =>
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
          // PNG conserva transparencia; JPEG si no la necesita.
          canvas.toBlob(pngBlob => {
            if (pngBlob && pngBlob.size <= 300_000) {
              resolve({ blob: pngBlob, ext: 'png', contentType: 'image/png' });
              return;
            }
            canvas.toBlob(jpgBlob => {
              resolve({ blob: jpgBlob, ext: 'jpg', contentType: 'image/jpeg' });
            }, 'image/jpeg', quality);
          }, 'image/png');
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file || !user?.empresa_id) return;
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
      // SVG no necesita resize (suele ser chico y vectorial) — se sube tal cual.
      const { blob, ext, contentType } = file.type === 'image/svg+xml'
        ? { blob: file, ext: 'svg', contentType: file.type }
        : await resizeImageToBlob(file, { maxSide: 400 });

      const path = `${user.empresa_id}/logo.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('logos-empresa')
        .upload(path, blob, { upsert: true, contentType, cacheControl: '3600' });
      if (uploadError) throw uploadError;

      // Cache-bust: la URL pública es siempre la misma para un mismo path,
      // así que sin esto el <img> no refresca tras re-subir un logo nuevo.
      const { data: { publicUrl } } = supabase.storage.from('logos-empresa').getPublicUrl(path);
      const urlConCacheBust = `${publicUrl}?v=${Date.now()}`;

      setFormData(prev => ({ ...prev, company_logo: urlConCacheBust }));
      try { localStorage.setItem(LOGO_CACHE_KEY, urlConCacheBust); } catch { /* no crítico */ }
      const kb = Math.round(blob.size / 1024);
      toast({
        title: 'Logo cargado',
        description: `Subido a Storage (${kb}KB). Hacé clic en Guardar para aplicar.`,
        className: 'bg-blue-600 text-white border-blue-500',
      });
    } catch (error) {
      toast({ title: 'Error al cargar el logo', description: error.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveLogo = async () => {
    setFormData(prev => ({ ...prev, company_logo: '' }));
    try { localStorage.removeItem(LOGO_CACHE_KEY); } catch { /* no crítico */ }
    if (user?.empresa_id) {
      // Best-effort: borra los 3 posibles paths (no sabemos qué extensión tenía).
      await supabase.storage.from('logos-empresa').remove(
        ['png', 'jpg', 'svg'].map(ext => `${user.empresa_id}/logo.${ext}`)
      );
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    toast({ title: 'Logo eliminado', description: 'El logo se ha eliminado de la vista previa.' });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // 1. Guardar tabla `configuracion` (datos generales)
      const { afip_cuit, condicion_iva, numero_ingresos_brutos, fecha_inicio_actividades, ...configFields } = formData;
      const result = await updateConfig(configFields);
      if (!result.success) throw new Error('No se pudo guardar en la base de datos.');

      // 2. Guardar en `empresas` los datos fiscales (misma fuente que el wizard AFIP)
      if (user?.empresa_id) {
        const cuitDigits = (afip_cuit || '').replace(/\D/g, '');
        if (cuitDigits && cuitDigits.length !== 11) {
          toast({ title: 'CUIT inválido', description: 'Debe tener 11 dígitos. Se guardó el resto de los datos.', variant: 'destructive' });
        } else {
          const { error: empErr } = await supabase
            .from('empresas')
            .update({
              afip_cuit:                cuitDigits || null,
              condicion_iva:            condicion_iva || null,
              numero_ingresos_brutos:   numero_ingresos_brutos || null,
              fecha_inicio_actividades: fecha_inicio_actividades || null,
            })
            .eq('id', user.empresa_id);
          if (empErr) throw empErr;
          setEmpresaDatos({
            afip_cuit: cuitDigits || null,
            condicion_iva: condicion_iva || null,
            numero_ingresos_brutos: numero_ingresos_brutos || null,
            fecha_inicio_actividades: fecha_inicio_actividades || null,
          });
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
    // La carga automática solo tiene sentido con moneda paralela activa y en USD
    // (la Edge Function tc-diario-sync solo cubre USD en su v1). Si alguna de las
    // dos condiciones no se cumple, se persiste en false para que la DB nunca
    // quede en un estado que la UI no puede representar.
    const autoEfectivo = tcConfig.usa_tc_paralelo && tcConfig.moneda_paralela === 'USD' && tcConfig.tc_automatico;
    try {
      const { error } = await supabase
        .from('empresas')
        .update({
          usa_tc_paralelo: tcConfig.usa_tc_paralelo,
          moneda_paralela: tcConfig.moneda_paralela,
          tc_automatico:   autoEfectivo,
        })
        .eq('id', user.empresa_id);
      if (error) throw error;
      if (autoEfectivo !== tcConfig.tc_automatico) setTcConfig(prev => ({ ...prev, tc_automatico: autoEfectivo }));
      toast({
        title: 'Moneda paralela guardada',
        description: tcConfig.usa_tc_paralelo
          ? (autoEfectivo
              ? `Activada con carga automática. El TC de ${tcConfig.moneda_paralela} se actualiza solo cada mañana.`
              : `Activada. El sistema pedirá el TC de ${tcConfig.moneda_paralela} antes de cada operación.`)
          : 'Desactivada. El sistema no requerirá TC paralelo.',
        className: 'bg-green-600 text-white border-green-700',
      });
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingTC(false);
    }
  };

  const handleSaveFidelizacion = async () => {
    if (!user?.empresa_id) return;
    // Si está activo, ambos ratios son obligatorios y positivos — mismo criterio
    // que los CHECK de la migración 312 (IS NULL OR > 0), pero acá se avisa antes
    // de pegarle a la base en vez de esperar el error de Postgres.
    const pesosPorPunto = fidelizacionConfig.puntos_pesos_por_punto === '' ? null : Number(fidelizacionConfig.puntos_pesos_por_punto);
    const valorPesos = fidelizacionConfig.puntos_valor_pesos === '' ? null : Number(fidelizacionConfig.puntos_valor_pesos);
    if (fidelizacionConfig.usa_fidelizacion) {
      if (!(pesosPorPunto > 0) || !(valorPesos > 0)) {
        toast({
          title: 'Faltan datos',
          description: 'Para activar fidelización, cargá los dos valores de ratio (mayores a 0).',
          variant: 'destructive',
        });
        return;
      }
    }
    setSavingFidelizacion(true);
    try {
      const { error } = await supabase
        .from('empresas')
        .update({
          usa_fidelizacion: fidelizacionConfig.usa_fidelizacion,
          puntos_pesos_por_punto: pesosPorPunto,
          puntos_valor_pesos: valorPesos,
        })
        .eq('id', user.empresa_id);
      if (error) throw error;
      toast({
        title: 'Fidelización guardada',
        description: fidelizacionConfig.usa_fidelizacion
          ? `Activada: $${pesosPorPunto} = 1 punto, cada punto vale $${valorPesos} de descuento.`
          : 'Desactivada. Ningún cliente suma ni puede canjear puntos.',
        className: 'bg-green-600 text-white border-green-700',
      });
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingFidelizacion(false);
    }
  };

  const handleSaveImpuestosAv = async (nuevoValor) => {
    if (!user?.empresa_id) return;
    setSavingImpuestosAv(true);
    // Optimista — el Switch ya refleja el nuevo valor
    setImpuestosAvanzados(nuevoValor);
    try {
      const { error } = await supabase
        .from('empresas')
        .update({ usa_impuestos_avanzados: nuevoValor })
        .eq('id', user.empresa_id);
      if (error) throw error;
      toast({
        title: nuevoValor ? 'Impuestos avanzados activados' : 'Impuestos avanzados desactivados',
        description: nuevoValor
          ? 'IIBB, Retenciones/Percepciones y Alícuotas ya están disponibles en el módulo Impuestos.'
          : 'Se ocultaron IIBB, Retenciones/Percepciones y Alícuotas. IVA sigue disponible.',
        className: 'bg-green-600 text-white border-green-700',
      });
    } catch (e) {
      setImpuestosAvanzados(!nuevoValor); // revertir si falla
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingImpuestosAv(false);
    }
  };

  const handleToggleCotizacionesActivo = async (nuevoValor) => {
    if (!user?.empresa_id) return;
    setSavingCotizacionesActivo(true);
    setCotizacionesActivo(nuevoValor); // optimista
    try {
      const { error } = await supabase
        .from('empresas')
        .update({ cotizaciones_activo: nuevoValor })
        .eq('id', user.empresa_id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['cotizaciones-activo', user.empresa_id] });
      toast({
        title: nuevoValor ? 'Módulo Cotizaciones activado' : 'Módulo Cotizaciones desactivado',
        description: nuevoValor
          ? 'Ya está disponible en el menú y dentro de Ventas.'
          : 'Se ocultó del menú y de Ventas. Las cotizaciones ya cargadas no se borran.',
        className: 'bg-green-600 text-white border-green-700',
      });
    } catch (e) {
      setCotizacionesActivo(!nuevoValor); // revertir si falla
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingCotizacionesActivo(false);
    }
  };

  const handleSaveUsaEcommerce = async (nuevoValor) => {
    if (!user?.empresa_id) return;
    setSavingUsaEcommerce(true);
    setUsaEcommerce(nuevoValor); // optimista
    try {
      const { error } = await supabase
        .from('empresas')
        .update({ usa_ecommerce: nuevoValor })
        .eq('id', user.empresa_id);
      if (error) throw error;
      // Invalidar el hook cacheado que gatea la UI (ProductForm, etc.).
      queryClient.invalidateQueries({ queryKey: ['usa_ecommerce', user.empresa_id] });
      toast({
        title: nuevoValor ? 'Ecommerce activado' : 'Ecommerce desactivado',
        description: nuevoValor
          ? 'Ya podés conectar Tiendanube y publicar productos a tu tienda online.'
          : 'Se ocultó la integración de ecommerce y la opción de publicar productos.',
        className: 'bg-green-600 text-white border-green-700',
      });
    } catch (e) {
      setUsaEcommerce(!nuevoValor); // revertir si falla
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingUsaEcommerce(false);
    }
  };

  const handleSaveUsaCentrosCosto = async (nuevoValor) => {
    if (!user?.empresa_id) return;
    setSavingUsaCentrosCosto(true);
    setUsaCentrosCosto(nuevoValor);
    try {
      const { error } = await supabase
        .from('empresas')
        .update({ usa_centros_costo: nuevoValor })
        .eq('id', user.empresa_id);
      if (error) throw error;
      toast({
        title: nuevoValor ? 'Centros de costo activados' : 'Centros de costo desactivados',
        description: nuevoValor
          ? 'Los selectores de centro de costo ya están disponibles en Ventas, Compras y Estado de Resultados.'
          : 'Se ocultaron los selectores de centro de costo en todo el sistema.',
        className: 'bg-green-600 text-white border-green-700',
      });
    } catch (e) {
      setUsaCentrosCosto(!nuevoValor);
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingUsaCentrosCosto(false);
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

  // PdV del Modo Caja (mig.293). Guarda al instante — es un selector, no un form.
  const handleChangePosPuntoVenta = async (nuevoId) => {
    if (!user?.empresa_id) return;
    const anterior = posPuntoVentaId;
    setPosPuntoVentaId(nuevoId);
    setSavingPosPv(true);
    try {
      const { error } = await supabase.from('empresas')
        .update({ pos_punto_venta_id: nuevoId })
        .eq('id', user.empresa_id);
      if (error) throw error;
      // useAfipConfig cachea la config 5 min: invalidar para que el POS tome el
      // PdV nuevo sin necesidad de recargar la app.
      queryClient.invalidateQueries({ queryKey: ['afip-config'] });
      const pv = allPuntosVenta.find(p => p.id === nuevoId);
      toast({
        title: nuevoId ? `Modo Caja usa el PdV ${pv?.numero}` : 'Modo Caja usa el PdV por defecto',
        description: pv?.envia_arca === false ? 'Las ventas de mostrador no se enviarán a ARCA.' : undefined,
        className: 'bg-green-600 text-white border-green-700',
      });
    } catch (e) {
      setPosPuntoVentaId(anterior); // revertir el optimista
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingPosPv(false);
    }
  };

  // mig.347 — pedido 23/08: apagar esto NUNCA toca pedidos que ya estén en
  // en_preparacion (rige solo hacia adelante). Si queda alguno huérfano,
  // PedidosSection.jsx muestra un aviso propio para que se les dé tratamiento.
  const handleToggleEnPreparacion = async (checked) => {
    if (!user?.empresa_id) return;
    const anterior = usaEnPreparacion;
    setUsaEnPreparacion(checked);
    setSavingEnPreparacion(true);
    try {
      const { error } = await supabase.from('empresas')
        .update({ usa_estado_en_preparacion: checked })
        .eq('id', user.empresa_id);
      if (error) throw error;
      toast({
        title: checked ? 'Vuelve a pedir "En Preparación"' : '"En Preparación" desactivado',
        description: checked
          ? undefined
          : 'Los pedidos confirmados van directo a poder facturarse/entregarse, sin ese paso intermedio.',
        className: 'bg-green-600 text-white border-green-700',
      });
    } catch (e) {
      setUsaEnPreparacion(anterior);
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingEnPreparacion(false);
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
    setPvForm({ numero: '', nombre: 'Nuevo Punto de Venta', tipo: 'web', envia_arca: true, cai_remito: '', cai_remito_vencimiento: '', proximo_numero_remito: 1, es_default: false, activo: true, solo_remito: false });
    setShowPvModal(true);
  };

  const openEditPv = (pv) => {
    setEditingPv(pv);
    setPvForm({
      numero: String(pv.numero),
      nombre: pv.nombre,
      tipo: pv.tipo ?? 'web',
      envia_arca: pv.envia_arca ?? true,
      cai_remito: pv.cai_remito ?? '',
      cai_remito_vencimiento: pv.cai_remito_vencimiento ?? '',
      proximo_numero_remito: pv.proximo_numero_remito ?? 1,
      es_default: pv.es_default ?? false,
      activo: pv.activo ?? true,
      solo_remito: pv.solo_remito ?? false,
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
          envia_arca: pvForm.envia_arca,
          cai_remito: pvForm.cai_remito || null,
          cai_remito_vencimiento: pvForm.cai_remito_vencimiento || null,
          proximo_numero_remito: Number(pvForm.proximo_numero_remito) || 1,
          es_default: pvForm.es_default,
          activo: pvForm.activo,
          solo_remito: pvForm.solo_remito,
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
    setUmForm({ codigo: '', descripcion: '', magnitud: '', factor_base: '' });
    setShowUMModal(true);
  };

  const openEditarUM = (u) => {
    setEditingUM(u);
    setUmForm({
      codigo: u.codigo,
      descripcion: u.descripcion,
      magnitud: u.magnitud ?? '',
      factor_base: u.factor_base != null ? String(u.factor_base) : '',
    });
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
    // Magnitud + factor de conversión (migration 188): van juntos o ambos vacíos.
    const magnitud = umForm.magnitud || null;
    let factorBase = null;
    if (magnitud) {
      factorBase = parseFloat(String(umForm.factor_base).replace(',', '.'));
      if (!Number.isFinite(factorBase) || factorBase <= 0) {
        toast({ title: 'Factor inválido', description: 'Si elegís una magnitud, el factor debe ser un número mayor a 0.', variant: 'destructive' });
        return;
      }
    }
    setSavingUM(true);
    try {
      const payload = {
        codigo: umForm.codigo.trim().toUpperCase(),
        descripcion: umForm.descripcion.trim(),
        magnitud,
        factor_base: factorBase,
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
  // Tab 2: Formas de Pago — handlers
  // ─────────────────────────────────────────────────────────────────────────
  const openNuevaFormaPago = () => {
    setEditingFormaPago(null);
    setFormaPagoForm({ nombre: '', tipo_instrumento: 'efectivo', cuenta_bancaria_id: '', dias_acreditacion: '', comision_porcentaje: '' });
    setShowFormaPagoModal(true);
  };

  const openEditarFormaPago = (f) => {
    setEditingFormaPago(f);
    setFormaPagoForm({
      nombre: f.nombre,
      tipo_instrumento: f.tipo_instrumento,
      cuenta_bancaria_id: f.cuenta_bancaria_id ?? '',
      dias_acreditacion: String(f.dias_acreditacion ?? 0),
      comision_porcentaje: String(f.comision_porcentaje ?? 0),
    });
    setShowFormaPagoModal(true);
  };

  const toggleActivoFormaPago = async (id, activo) => {
    const { error } = await supabase.from('formas_pago').update({ activo }).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    fetchFormasPago();
  };

  const handleGuardarFormaPago = async () => {
    if (!formaPagoForm.nombre.trim()) {
      toast({ title: 'El nombre es obligatorio', variant: 'destructive' });
      return;
    }
    setSavingFormaPago(true);
    try {
      const payload = {
        nombre: formaPagoForm.nombre.trim(),
        tipo_instrumento: formaPagoForm.tipo_instrumento,
        cuenta_bancaria_id: formaPagoForm.tipo_instrumento === 'efectivo' || !formaPagoForm.cuenta_bancaria_id
          ? null : formaPagoForm.cuenta_bancaria_id,
        dias_acreditacion: formaPagoForm.dias_acreditacion !== '' ? parseInt(formaPagoForm.dias_acreditacion, 10) : 0,
        comision_porcentaje: formaPagoForm.comision_porcentaje !== '' ? parseFloat(formaPagoForm.comision_porcentaje) : 0,
      };
      if (editingFormaPago) {
        const { error } = await supabase.from('formas_pago').update(payload).eq('id', editingFormaPago.id);
        if (error) throw error;
        toast({ title: 'Forma de pago actualizada' });
      } else {
        const { error } = await supabase.from('formas_pago').insert({ ...payload, empresa_id: user.empresa_id });
        if (error) throw error;
        toast({ title: 'Forma de pago creada' });
      }
      setShowFormaPagoModal(false);
      fetchFormasPago();
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingFormaPago(false);
    }
  };

  // ── Handlers Cajas ────────────────────────────────────────────────────────
  const openNuevaCaja = () => {
    setEditingCaja(null);
    setCajaForm({ nombre: '' });
    setShowCajaModal(true);
  };

  const openEditarCaja = (c) => {
    setEditingCaja(c);
    setCajaForm({ nombre: c.nombre });
    setShowCajaModal(true);
  };

  const toggleActivoCaja = async (id, activo) => {
    if (!activo) {
      // No dejar apagar por error la caja de un cajero que está trabajando
      // en este momento — quedaría sin poder revalidar su selección.
      const { data: sesionAbierta } = await supabase
        .from('caja_sesiones')
        .select('id')
        .eq('caja_id', id)
        .eq('estado', 'abierta')
        .maybeSingle();
      if (sesionAbierta) {
        toast({
          title: 'No se puede desactivar',
          description: 'Esta caja tiene un turno abierto. Pedile al cajero que cierre caja primero.',
          variant: 'destructive',
        });
        return;
      }
    }
    const { error } = await supabase.from('cajas').update({ activo }).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    fetchCajas();
  };

  const handleGuardarCaja = async () => {
    if (!cajaForm.nombre.trim()) {
      toast({ title: 'El nombre es obligatorio', variant: 'destructive' });
      return;
    }
    setSavingCaja(true);
    try {
      const payload = { nombre: cajaForm.nombre.trim() };
      if (editingCaja) {
        const { error } = await supabase.from('cajas').update(payload).eq('id', editingCaja.id);
        if (error) throw error;
        toast({ title: 'Caja actualizada' });
      } else {
        const { error } = await supabase.from('cajas').insert({ ...payload, empresa_id: user.empresa_id });
        if (error) throw error;
        toast({ title: 'Caja creada' });
      }
      setShowCajaModal(false);
      fetchCajas();
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingCaja(false);
    }
  };

  // ── Handlers Centros de Costo ────────────────────────────────────────────
  const openNuevoCentroCosto = () => {
    setEditingCentroCosto(null);
    setCentroCostoForm({ nombre: '' });
    setShowCentroCostoModal(true);
  };

  const openEditarCentroCosto = (c) => {
    setEditingCentroCosto(c);
    setCentroCostoForm({ nombre: c.nombre });
    setShowCentroCostoModal(true);
  };

  const toggleActivoCentroCosto = async (id, activo) => {
    const { error } = await supabase.from('centros_costo').update({ activo }).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    fetchCentrosCosto();
  };

  const handleGuardarCentroCosto = async () => {
    if (!centroCostoForm.nombre.trim()) {
      toast({ title: 'El nombre es obligatorio', variant: 'destructive' });
      return;
    }
    setSavingCentroCosto(true);
    try {
      const payload = { nombre: centroCostoForm.nombre.trim() };
      if (editingCentroCosto) {
        const { error } = await supabase.from('centros_costo').update(payload).eq('id', editingCentroCosto.id);
        if (error) throw error;
        toast({ title: 'Centro de costo actualizado' });
      } else {
        const { error } = await supabase.from('centros_costo').insert({ ...payload, empresa_id: user.empresa_id });
        if (error) throw error;
        toast({ title: 'Centro de costo creado' });
      }
      setShowCentroCostoModal(false);
      fetchCentrosCosto();
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSavingCentroCosto(false);
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
            <Settings className="w-8 h-8 text-blue-600 dark:text-kx-violet" />
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
          <TabEmpresa
            formData={formData}
            setFormData={setFormData}
            saving={saving}
            uploading={uploading}
            fileInputRef={fileInputRef}
            handleSave={handleSave}
            handleChange={handleChange}
            handleFileSelect={handleFileSelect}
            handleRemoveLogo={handleRemoveLogo}
            usaFacturaElectronica={afipConfig.usa_factura_electronica}
          />
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 2 — FINANZAS Y MONEDA
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="finanzas">
          <TabFinanzas
            tcConfig={tcConfig}
            setTcConfig={setTcConfig}
            loadingTC={loadingTC}
            savingTC={savingTC}
            onSaveTC={handleSaveTC}
            condicionesPago={condicionesPago}
            loadingCondiciones={loadingCondiciones}
            onNuevaCondicion={openNuevaCondicion}
            onEditarCondicion={openEditarCondicion}
            onToggleCondicion={toggleActivoCondicion}
            formasPago={formasPago}
            loadingFormasPago={loadingFormasPago}
            cuentasBancariasLista={cuentasBancariasLista}
            onNuevaFormaPago={openNuevaFormaPago}
            onEditarFormaPago={openEditarFormaPago}
            onToggleFormaPago={toggleActivoFormaPago}
            cajas={cajas}
            loadingCajas={loadingCajas}
            onNuevaCaja={openNuevaCaja}
            onEditarCaja={openEditarCaja}
            onToggleCaja={toggleActivoCaja}
            centrosCosto={centrosCosto}
            loadingCentrosCosto={loadingCentrosCosto}
            onNuevoCentroCosto={openNuevoCentroCosto}
            onEditarCentroCosto={openEditarCentroCosto}
            onToggleCentroCosto={toggleActivoCentroCosto}
            impuestosAvanzados={impuestosAvanzados}
            loadingImpuestosAv={loadingImpuestosAv}
            savingImpuestosAv={savingImpuestosAv}
            onToggleImpuestosAv={handleSaveImpuestosAv}
            usaCentrosCosto={usaCentrosCosto}
            loadingUsaCentrosCosto={loadingUsaCentrosCosto}
            savingUsaCentrosCosto={savingUsaCentrosCosto}
            onToggleUsaCentrosCosto={handleSaveUsaCentrosCosto}
            fidelizacionConfig={fidelizacionConfig}
            setFidelizacionConfig={setFidelizacionConfig}
            loadingFidelizacion={loadingFidelizacion}
            savingFidelizacion={savingFidelizacion}
            onSaveFidelizacion={handleSaveFidelizacion}
          />
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
          <TabFacturacion
            afipConfig={afipConfig}
            loadingAFIP={loadingAFIP}
            handleToggleAFIP={handleToggleAFIP}
            afipConfigCompleta={afipConfigCompleta}
            puntoVentaActivo={puntoVentaActivo}
            openWizard={openWizard}
            certStatus={certStatus}
            onOpenCertModal={() => { setCertForm({ cert: '', key: '' }); setCertModalOpen(true); }}
            handleProbarConexion={handleProbarConexion}
            probandoConexion={probandoConexion}
            allPuntosVenta={allPuntosVenta}
            posPuntoVentaId={posPuntoVentaId}
            onChangePosPuntoVenta={handleChangePosPuntoVenta}
            savingPosPv={savingPosPv}
            openAddPv={openAddPv}
            openEditPv={openEditPv}
            selectedPvId={selectedPvId}
            setSelectedPvId={setSelectedPvId}
            loadingTipos={loadingTipos}
            tiposComprobante={tiposComprobante}
            savingTipoId={savingTipoId}
            updateTipoLocal={updateTipoLocal}
            handleSaveTipoProximoNumero={handleSaveTipoProximoNumero}
            loadingSeries={loadingSeries}
            seriesNumeracion={seriesNumeracion}
            savingSerieId={savingSerieId}
            updateSerieLocal={updateSerieLocal}
            handleSaveSerie={handleSaveSerie}
            pieDoc={pieDoc}
            setPieDoc={setPieDoc}
            savingPieDoc={savingPieDoc}
            handleSavePieDoc={handleSavePieDoc}
            cotizacionesActivo={cotizacionesActivo}
            loadingCotizacionesActivo={loadingCotizacionesActivo}
            savingCotizacionesActivo={savingCotizacionesActivo}
            onToggleCotizacionesActivo={handleToggleCotizacionesActivo}
            usaEnPreparacion={usaEnPreparacion}
            savingEnPreparacion={savingEnPreparacion}
            onToggleEnPreparacion={handleToggleEnPreparacion}
          />
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 4 — INVENTARIO
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="inventario">
          <TabInventario
            valoracionStock={valoracionStock}
            setValoracionStock={setValoracionStock}
            loadingValoracion={loadingValoracion}
            savingValoracion={savingValoracion}
            onSaveValoracion={handleSaveValoracion}
            unidadesMedida={unidadesMedida}
            loadingUM={loadingUM}
            onNuevaUM={openNuevaUM}
            onEditarUM={openEditarUM}
            onToggleUM={toggleActivoUM}
            stockMinimoGlobal={stockMinimoGlobal}
            setStockMinimoGlobal={setStockMinimoGlobal}
            savingStockMin={savingStockMin}
            onSaveStockMin={handleSaveStockMin}
          />
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 5 — INTEGRACIONES
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="integraciones">
          <TabIntegraciones
            usaEcommerce={usaEcommerce}
            savingUsaEcommerce={savingUsaEcommerce}
            onToggleUsaEcommerce={handleSaveUsaEcommerce}
            integracionMP={integracionMP}
            integracionUala={integracionUala}
            integracionTiendanube={integracionTiendanube}
            integracionMercadoLibre={integracionMercadoLibre}
            afipConfig={afipConfig}
            showWebhookUrl={showWebhookUrl}
            setShowWebhookUrl={setShowWebhookUrl}
            mapeosCuentas={mapeosCuentas}
            setMapeosCuentas={setMapeosCuentas}
            savingMapeos={savingMapeos}
            cuentasBancariasLista={cuentasBancariasLista}
            onConfigMP={() => setShowConfigMP(true)}
            onConfigUala={() => setShowConfigUala(true)}
            onConectarTiendanube={() => setShowConectarTiendanube(true)}
            onMapeoProductosTiendanube={() => setShowMapeoProductosTN(true)}
            onConectarMercadoLibre={() => setShowConectarMercadoLibre(true)}
            onMapeoProductosMercadoLibre={() => setShowMapeoProductosML(true)}
            onGoFacturacion={() => setActiveTab('facturacion')}
            onSaveMapeos={handleSaveMapeos}
          />
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 6 — ALERTAS
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="alertas">
          <TabAlertas
            alertas={alertas}
            setAlertas={setAlertas}
            loadingAlertas={loadingAlertas}
            savingAlertas={savingAlertas}
            onSave={handleSaveAlertas}
          />
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
            <div className="flex items-center justify-between rounded-lg border border-kx-border p-3 bg-kx-surface-2">
              <div>
                <Label className="text-kx-text text-sm">Envía a ARCA</Label>
                <p className="text-xs text-kx-text-3 mt-0.5">
                  {pvForm.envia_arca
                    ? 'Los comprobantes de este PdV se encolan para CAE automático.'
                    : 'PdV interno: nunca se envía a ARCA (ej. remitos con CAI).'}
                </p>
              </div>
              <Switch checked={pvForm.envia_arca} onCheckedChange={v => setPvForm(f => ({ ...f, envia_arca: v }))} />
            </div>
            {/* Distinto de "Envía a ARCA" (ajuste 23/08, hallazgo Luciano): un
                PdV interno puede seguir siendo válido para facturar (ej. el
                del Modo Caja). Este toggle es para el caso puntual de un PdV
                que EXISTE solo para numerar remitos — nunca debería ofrecerse
                al elegir tipo de documento en Nueva Factura. */}
            <div className="flex items-center justify-between rounded-lg border border-kx-border p-3 bg-kx-surface-2">
              <div>
                <Label className="text-kx-text text-sm">Solo para remitos</Label>
                <p className="text-xs text-kx-text-3 mt-0.5">
                  No se ofrece en el selector de Nueva Factura — existe únicamente para numerar remitos con su propio CAI.
                </p>
              </div>
              <Switch checked={pvForm.solo_remito} onCheckedChange={v => setPvForm(f => ({ ...f, solo_remito: v }))} />
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
          MODAL — Nueva/Editar Forma de Pago (fuera del sistema de tabs)
      ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={showFormaPagoModal} onOpenChange={setShowFormaPagoModal}>
        <DialogContent className="sm:max-w-[420px] bg-kx-surface border-kx-border">
          <DialogHeader>
            <DialogTitle className="text-kx-text">{editingFormaPago ? 'Editar' : 'Nueva'} Forma de Pago</DialogTitle>
            <DialogDescription>Medio que va a aparecer al cobrar o pagar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-kx-text">Nombre *</Label>
              <Input
                value={formaPagoForm.nombre}
                onChange={e => setFormaPagoForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Posnet Galicia Visa/Master"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-kx-text">Instrumento</Label>
              <Select
                value={formaPagoForm.tipo_instrumento}
                onValueChange={v => setFormaPagoForm(f => ({ ...f, tipo_instrumento: v, ...(v === 'efectivo' ? { cuenta_bancaria_id: '' } : {}) }))}
              >
                <SelectTrigger className="h-9 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPO_INSTRUMENTO_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {formaPagoForm.tipo_instrumento !== 'efectivo' && (
              <div className="space-y-1.5">
                <Label className="text-kx-text">Cuenta bancaria destino (opcional)</Label>
                <Select
                  value={formaPagoForm.cuenta_bancaria_id || '__none__'}
                  onValueChange={v => setFormaPagoForm(f => ({ ...f, cuenta_bancaria_id: v === '__none__' ? '' : v }))}
                >
                  <SelectTrigger className="h-9 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"><SelectValue placeholder="— Sin acreditación bancaria —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Sin acreditación bancaria —</SelectItem>
                    {cuentasBancariasLista.map(cb => (
                      <SelectItem key={cb.id} value={cb.id}>{cb.nombre} ({cb.banco})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-kx-text">Días de acreditación</Label>
                <Input
                  type="number" min="0"
                  value={formaPagoForm.dias_acreditacion}
                  onChange={e => setFormaPagoForm(f => ({ ...f, dias_acreditacion: e.target.value }))}
                  placeholder="0"
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-kx-text">Comisión %</Label>
                <Input
                  type="number" min="0" max="100" step="0.01"
                  value={formaPagoForm.comision_porcentaje}
                  onChange={e => setFormaPagoForm(f => ({ ...f, comision_porcentaje: e.target.value }))}
                  placeholder="0"
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                />
              </div>
            </div>
            <p className="text-2xs text-kx-text-3">
              Días de acreditación y comisión se guardan para el cálculo automático de una fase próxima —
              hoy no afectan el asiento contable.
            </p>
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-kx-border">
            <Button variant="outline" onClick={() => setShowFormaPagoModal(false)}>Cancelar</Button>
            <Button onClick={handleGuardarFormaPago} disabled={savingFormaPago}>
              {savingFormaPago ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</> : 'Guardar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════
          MODAL — Nueva/Editar Caja (fuera del sistema de tabs)
      ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={showCajaModal} onOpenChange={setShowCajaModal}>
        <DialogContent className="sm:max-w-[420px] bg-kx-surface border-kx-border">
          <DialogHeader>
            <DialogTitle className="text-kx-text">{editingCaja ? 'Editar' : 'Nueva'} Caja</DialogTitle>
            <DialogDescription>Punto de cobro físico del local (mostrador, terminal).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-kx-text">Nombre *</Label>
              <Input
                value={cajaForm.nombre}
                onChange={e => setCajaForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Mostrador 2"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-kx-border">
            <Button variant="outline" onClick={() => setShowCajaModal(false)}>Cancelar</Button>
            <Button onClick={handleGuardarCaja} disabled={savingCaja}>
              {savingCaja ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</> : 'Guardar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════
          MODAL — Nuevo/Editar Centro de Costo (fuera del sistema de tabs)
      ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={showCentroCostoModal} onOpenChange={setShowCentroCostoModal}>
        <DialogContent className="sm:max-w-[420px] bg-kx-surface border-kx-border">
          <DialogHeader>
            <DialogTitle className="text-kx-text">{editingCentroCosto ? 'Editar' : 'Nuevo'} Centro de Costo</DialogTitle>
            <DialogDescription>Dimensión opcional para reportar por sucursal o línea de negocio.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-kx-text">Nombre *</Label>
              <Input
                value={centroCostoForm.nombre}
                onChange={e => setCentroCostoForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Sucursal Centro"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-kx-border">
            <Button variant="outline" onClick={() => setShowCentroCostoModal(false)}>Cancelar</Button>
            <Button onClick={handleGuardarCentroCosto} disabled={savingCentroCosto}>
              {savingCentroCosto ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</> : 'Guardar'}
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

            {/* Magnitud + factor de conversión general (migration 188) */}
            <div className="space-y-1.5">
              <Label className="text-kx-text">Magnitud</Label>
              <select
                value={umForm.magnitud}
                onChange={e => setUmForm(f => ({ ...f, magnitud: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Sin magnitud (unidad suelta, ej: Caja)</option>
                {MAGNITUDES.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <p className="text-xs text-kx-text-3">
                Agrupá la unidad por lo que mide para poder convertir entre unidades de la misma
                magnitud (ej: Masa → KG, GR, TN se convierten entre sí). Dejala vacía para empaques
                sin conversión física fija (Caja, Paquete).
              </p>
            </div>

            {umForm.magnitud && (() => {
              const baseCode = MAGNITUDES.find(m => m.value === umForm.magnitud)?.base ?? '';
              const factorNum = parseFloat(String(umForm.factor_base).replace(',', '.'));
              const validFactor = Number.isFinite(factorNum) && factorNum > 0;
              const codeLabel = umForm.codigo.trim().toUpperCase() || 'esta unidad';
              return (
                <div className="space-y-1.5">
                  <Label className="text-kx-text">Equivale a (en {baseCode}) *</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={umForm.factor_base}
                    onChange={e => setUmForm(f => ({ ...f, factor_base: e.target.value }))}
                    placeholder={`Ej: 1000`}
                    className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                  />
                  <p className="text-xs text-kx-text-3">
                    Cuántos <span className="font-mono">{baseCode}</span> equivale 1 de esta unidad.
                    La unidad base ({baseCode}) lleva 1.
                  </p>
                  {validFactor && (
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      1 {codeLabel} = {factorNum.toLocaleString('es-AR', { maximumFractionDigits: 6 })} {baseCode}
                    </p>
                  )}
                </div>
              );
            })()}
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
                  <p className="text-xs text-kx-text-2 pl-8">KAIROX crea automáticamente las claves criptográficas. Solo descargás el archivo y lo subís en ARCA.</p>
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
                <ol className="text-xs text-kx-text-2 pl-8 space-y-1 list-decimal list-inside">
                  <li>Entrá a <a href="https://www.afip.gob.ar" target="_blank" rel="noreferrer" className="text-kx-blue underline">afip.gob.ar</a> con tu CUIT y clave fiscal</li>
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

      {/* ── Modal conectar Tiendanube (OAuth) ──────────────────────────────── */}
      <ConectarTiendanubeModal
        open={showConectarTiendanube}
        onOpenChange={setShowConectarTiendanube}
      />

      {/* ── Modal conectar MercadoLibre (OAuth) ────────────────────────────── */}
      <ConectarMercadoLibreModal
        open={showConectarMercadoLibre}
        onOpenChange={setShowConectarMercadoLibre}
      />

      {/* ── Modal mapeo de productos Tiendanube ────────────────────────────── */}
      <MapeoProductosModal
        open={showMapeoProductosTN}
        onOpenChange={setShowMapeoProductosTN}
        integracion={integracionTiendanube}
        canal="tiendanube"
      />

      {/* ── Modal mapeo de productos MercadoLibre ───────────────────────────── */}
      <MapeoProductosModal
        open={showMapeoProductosML}
        onOpenChange={setShowMapeoProductosML}
        integracion={integracionMercadoLibre}
        canal="mercadolibre"
      />

    </div>
  );
};

export default ConfiguracionSection;
