import {
  FileText, Loader2, Check, AlertCircle, Shield, RefreshCw, Plus, Pencil, Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCuit } from '@/lib/cuitUtils';
import { formatDateAR, getTodayAR } from '@/lib/dateUtils';

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

// Pura — solo depende de la serie y de la fecha de hoy (AR). Preview del próximo
// número formateado según el formato_fecha de la serie.
const previewProximoNumero = (serie) => {
  const todayStr = getTodayAR().replace(/-/g, '');
  let periodo = '';
  if (serie.formato_fecha === 'YYYYMMDD') periodo = `${todayStr}-`;
  else if (serie.formato_fecha === 'YYYY') periodo = `${todayStr.slice(0, 4)}-`;
  const n = parseInt(serie.proximo_numero, 10);
  const numeroStr = isNaN(n) ? '?' : String(n).padStart(serie.digitos, '0');
  return `${serie.prefijo ?? ''}${periodo}${numeroStr}`;
};

/**
 * Tab "Facturación" de ConfiguracionSection — el más grande y crítico: toggle AFIP,
 * credenciales/certificado ARCA (Vault), puntos de venta, tipos de comprobante,
 * facturas con error de CAE, series de numeración y pie de documento. Extraído de
 * ConfiguracionSection.jsx (Fase C auditoría de código). Componente presentacional:
 * todo el estado, los handlers de negocio (fetch/save/RPC) y los modales (cert ARCA,
 * punto de venta, detalle de error) viven en el padre; este componente sólo renderiza
 * y dispara callbacks. Los nombres de props coinciden con los del padre a propósito
 * para minimizar el riesgo de desajuste en el call-site.
 */
const TabFacturacion = ({
  // AFIP toggle + estado general
  afipConfig, loadingAFIP, handleToggleAFIP, afipConfigCompleta, puntoVentaActivo, openWizard,
  // Credenciales / certificado
  certStatus, onOpenCertModal, handleProbarConexion, probandoConexion,
  // Puntos de venta
  allPuntosVenta, openAddPv, openEditPv,
  // Tipos de comprobante
  selectedPvId, setSelectedPvId, loadingTipos, tiposComprobante, savingTipoId,
  updateTipoLocal, handleSaveTipoProximoNumero,
  // Series de numeración
  loadingSeries, seriesNumeracion, savingSerieId, updateSerieLocal, handleSaveSerie,
  // Pie de documento
  pieDoc, setPieDoc, savingPieDoc, handleSavePieDoc,
}) => (
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
          <Button size="sm" variant="outline" onClick={onOpenCertModal}>
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
                        {pv.es_default && <Check className="w-4 h-4 text-kx-green mx-auto" />}
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
);

export default TabFacturacion;
