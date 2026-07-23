import { EyeOff, Eye, Copy, CreditCard, Loader2, Save, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import IntegracionCard from '@/components/shared/IntegracionCard';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { formatDateAR } from '@/lib/dateUtils';

const METODOS_BANCARIOS = ['Transferencia', 'Tarjeta'];
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

/**
 * Tab "Integraciones" de ConfiguracionSection — cards de MP / Ualá / integraciones
 * futuras + puente Caja→Bancos (mapeo de métodos de pago a cuentas). Extraído de
 * ConfiguracionSection.jsx (Fase C auditoría de código). Los modales de config de
 * MP/Ualá viven en el padre; este componente sólo dispara su apertura por callback.
 * Usa useAuth/useToast directamente (cross-cutting) para no inflar la lista de props.
 */
const TabIntegraciones = ({
  usaEcommerce, savingUsaEcommerce, onToggleUsaEcommerce,
  integracionMP, integracionUala, integracionTiendanube, integracionMercadoLibre, afipConfig,
  showWebhookUrl, setShowWebhookUrl,
  mapeosCuentas, setMapeosCuentas, savingMapeos, cuentasBancariasLista,
  onConfigMP, onConfigUala, onConectarTiendanube, onMapeoProductosTiendanube, onConectarMercadoLibre, onMapeoProductosMercadoLibre, onGoFacturacion, onSaveMapeos,
}) => {
  const { user } = useAuth();
  const { toast } = useToast();

  return (
    <>
      {/* ── Switch maestro de ecommerce (toggle de plan, mig.236) ──
          Siempre visible. Con OFF, se oculta la card de Tiendanube (y el tilde
          "Publicar" del producto en Inventario). Es la puerta del módulo. */}
      <div className="kairox-bg-card border kairox-border rounded-xl shadow-sm p-5 mb-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#00C7B1]/10 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-5 h-5 text-[#00C7B1]" />
          </div>
          <div>
            <h4 className="font-semibold text-kx-text text-sm">Ecommerce</h4>
            <p className="text-xs text-kx-text-2 leading-relaxed mt-0.5 max-w-xl">
              Conectá tu tienda online (Tiendanube) y publicá tu catálogo directo desde KAIROX.
              Al activarlo aparece la integración acá y la opción "Publicar en ecommerce" en cada producto.
            </p>
          </div>
        </div>
        <Switch checked={!!usaEcommerce} onCheckedChange={onToggleUsaEcommerce} disabled={savingUsaEcommerce} />
      </div>

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
                  <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 mt-1">
                    ✓ Conectado
                  </span>
                ) : (
                  <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-kx-surface-2 text-kx-text-3 border-kx-border mt-1">
                    Sin configurar
                  </span>
                )}
              </div>
            </div>
            <Button size="sm" variant="outline" className="text-xs h-8 shrink-0" onClick={onConfigMP}>
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
                <code className="text-2xs text-kx-text flex-1 break-all leading-relaxed">
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
                  <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 mt-1">
                    ✓ Conectado
                  </span>
                ) : (
                  <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-kx-surface-2 text-kx-text-3 border-kx-border mt-1">
                    Sin configurar
                  </span>
                )}
              </div>
            </div>
            <Button size="sm" variant="outline" className="text-xs h-8 shrink-0" onClick={onConfigUala}>
              {integracionUala ? 'Editar' : 'Conectar'}
            </Button>
          </div>

          <p className="text-xs text-kx-text-2 leading-relaxed">
            Las transferencias de Ualá sincronizadas desde Gmail por el Apps Script se registran automáticamente en Bancos (no en Caja) una vez que elegís a qué cuenta bancaria corresponden.
          </p>
        </div>

        {/* ── Tiendanube — card rica con estado real (solo si el plan tiene ecommerce) ── */}
        {usaEcommerce && (
        <div className="kairox-bg-card border kairox-border p-5 rounded-xl shadow-sm flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#00C7B1] flex items-center justify-center text-white font-bold text-sm shrink-0">
                TN
              </div>
              <div>
                <h4 className="font-semibold text-kx-text text-sm">Tiendanube</h4>
                {integracionTiendanube?.activo ? (
                  <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 mt-1">
                    ✓ Conectado
                  </span>
                ) : (
                  <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-kx-surface-2 text-kx-text-3 border-kx-border mt-1">
                    Sin configurar
                  </span>
                )}
              </div>
            </div>
            <Button size="sm" variant="outline" className="text-xs h-8 shrink-0" onClick={onConectarTiendanube}>
              {integracionTiendanube?.activo ? 'Reconectar' : 'Conectar'}
            </Button>
          </div>

          <p className="text-xs text-kx-text-2 leading-relaxed">
            Sincronización de catálogo y pedidos con tu tienda Tiendanube. Los pedidos pagados se registran como ventas en KAIROX.
          </p>

          {integracionTiendanube?.activo && (
            <Button size="sm" variant="ghost" className="text-xs h-8 self-start -ml-2" onClick={onMapeoProductosTiendanube}>
              Mapear productos →
            </Button>
          )}
        </div>
        )}

        {/* ── MercadoLibre — card rica con estado real (solo si el plan tiene ecommerce) ── */}
        {usaEcommerce && (
        <div className="kairox-bg-card border kairox-border p-5 rounded-xl shadow-sm flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FFE600] flex items-center justify-center text-[#2D3277] font-bold text-sm shrink-0">
                ML
              </div>
              <div>
                <h4 className="font-semibold text-kx-text text-sm">MercadoLibre</h4>
                {integracionMercadoLibre?.activo ? (
                  <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 mt-1">
                    ✓ Conectado
                  </span>
                ) : (
                  <span className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full border bg-kx-surface-2 text-kx-text-3 border-kx-border mt-1">
                    Sin configurar
                  </span>
                )}
              </div>
            </div>
            <Button size="sm" variant="outline" className="text-xs h-8 shrink-0" onClick={onConectarMercadoLibre}>
              {integracionMercadoLibre?.activo ? 'Reconectar' : 'Conectar'}
            </Button>
          </div>

          <p className="text-xs text-kx-text-2 leading-relaxed">
            Sincronización de publicaciones, órdenes y stock con tu cuenta de MercadoLibre. Las órdenes pagadas se registran como pedidos en KAIROX.
          </p>

          {integracionMercadoLibre?.activo && (
            <Button size="sm" variant="ghost" className="text-xs h-8 self-start -ml-2" onClick={onMapeoProductosMercadoLibre}>
              Mapear productos →
            </Button>
          )}
        </div>
        )}

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
          onConfigure={onGoFacturacion}
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
          <Button size="sm" onClick={onSaveMapeos} disabled={savingMapeos} className="gap-2">
            {savingMapeos ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Guardar mapeo
          </Button>
        </div>
      </div>
    </>
  );
};

export default TabIntegraciones;
