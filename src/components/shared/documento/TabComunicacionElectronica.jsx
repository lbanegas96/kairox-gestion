import { useState } from 'react';
import {
  ShieldCheck, ShieldAlert, Clock, AlertTriangle, Code2, RefreshCw, FileX2, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateAR } from '@/lib/dateUtils';
import { PanelSeccion, CampoDato, GrillaCampos, SolapaVacia } from './DocumentoTabs';

// Solapa "Comunicación Electrónica" — equivalente a la de "Documentos
// electrónicos" que Luciano marcó en las capturas de SAP (22/08).
//
// Todos los datos que muestra YA existían en `comprobantes` (cae, cae_estado,
// cae_vencimiento, tipo_comprobante_afip, numero_afip, punto_venta_id,
// modo_autorizacion, error_afip, error_afip_usuario). Antes vivían desparramados
// entre un panel del modal de Venta y ningún lado en el resto de los
// documentos — por eso esta solapa es puro frontend, sin migración.

const ESTADO_BADGE = {
  emitido: {
    icon: ShieldCheck, texto: 'CAE emitido',
    clase: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  },
  pendiente: {
    icon: Clock, texto: 'CAE pendiente',
    clase: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  pendiente_caea: {
    icon: Clock, texto: 'Pendiente CAEA',
    clase: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  error: {
    icon: ShieldAlert, texto: 'Error CAE',
    clase: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
  error_definitivo: {
    icon: ShieldAlert, texto: 'Error definitivo',
    clase: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
};

const MODO_AUTORIZACION = {
  cae: 'CAE (en línea)',
  caea: 'CAEA (contingencia)',
};

function TabComunicacionElectronica({
  comprobante,
  puntoVenta,
  onReintentarCae,
  reintentando = false,
}) {
  const [verTecnico, setVerTecnico] = useState(false);

  if (!comprobante) return null;

  const estado = comprobante.cae_estado;

  // 'no_aplica' = emitido por un PdV que no envía a ARCA (interno, mig.293).
  // No es una falla ni algo "pendiente": es una decisión de configuración, y
  // decirlo explícitamente evita que el usuario espere un CAE que nunca va a
  // llegar. El criterio fiscal lo define el PdV (mig.294/295/296).
  if (!estado || estado === 'no_aplica') {
    return (
      <SolapaVacia
        icon={FileX2}
        titulo="Este comprobante no se envía a ARCA"
        detalle={
          puntoVenta?.nombre
            ? `El punto de venta "${puntoVenta.nombre}" está configurado como no fiscal, así que este documento no lleva CAE. Es un comprobante interno.`
            : 'El punto de venta con el que se emitió está configurado como no fiscal, así que este documento no lleva CAE.'
        }
      />
    );
  }

  const badge = ESTADO_BADGE[estado];
  const esError = estado === 'error' || estado === 'error_definitivo';
  const pdvTexto = puntoVenta
    ? `${String(puntoVenta.numero).padStart(4, '0')} — ${puntoVenta.nombre}`
    : null;

  return (
    <div className="space-y-4">
      <PanelSeccion
        titulo="Autorización ARCA / AFIP"
        accion={
          badge && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badge.clase}`}>
              <badge.icon className="h-3 w-3" /> {badge.texto}
            </span>
          )
        }
      >
        <GrillaCampos cols={4}>
          <CampoDato label="Número CAE" valor={comprobante.cae} mono />
          <CampoDato
            label="Vencimiento CAE"
            valor={comprobante.cae_vencimiento ? formatDateAR(comprobante.cae_vencimiento) : null}
          />
          <CampoDato
            label="Tipo de comprobante"
            valor={comprobante.tipo_comprobante_afip ? `Factura ${comprobante.tipo_comprobante_afip}` : null}
          />
          <CampoDato label="Número ante ARCA" valor={comprobante.numero_afip} mono />
          <CampoDato label="Punto de venta" valor={pdvTexto} />
          <CampoDato
            label="Modo de autorización"
            valor={comprobante.modo_autorizacion ? (MODO_AUTORIZACION[comprobante.modo_autorizacion] ?? comprobante.modo_autorizacion) : null}
          />
          {/* "Declarado" a propósito: estos son los valores que se le informaron
              a ARCA, no el recálculo desde los ítems que muestra la solapa
              Contenido. Suelen coincidir — cuando no coinciden, eso mismo es el
              dato importante. (Ojo: están en NULL en comprobantes viejos.) */}
          <CampoDato
            label="Neto gravado declarado"
            valor={comprobante.neto_gravado != null
              ? `$${Number(comprobante.neto_gravado).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : null}
          />
          <CampoDato
            label="IVA declarado"
            valor={comprobante.iva_discriminado != null
              ? `$${Number(comprobante.iva_discriminado).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : null}
          />
        </GrillaCampos>
      </PanelSeccion>

      {(estado === 'pendiente' || estado === 'pendiente_caea') && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
          <Zap className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {estado === 'pendiente_caea'
              ? 'Se emitió con CAEA (contingencia). El comprobante es válido; queda pendiente informarlo a ARCA dentro del plazo.'
              : 'El CAE se procesa automáticamente en los próximos minutos. Podés volver a abrir el documento para ver el estado actualizado.'}
          </span>
        </div>
      )}

      {esError && (
        <PanelSeccion titulo="Detalle del error">
          <div className="space-y-3">
            {comprobante.error_afip && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className={verTecnico || !comprobante.error_afip_usuario ? 'font-mono' : ''}>
                    {verTecnico || !comprobante.error_afip_usuario
                      ? comprobante.error_afip
                      : comprobante.error_afip_usuario}
                  </span>
                </div>
                {comprobante.error_afip_usuario && (
                  <button
                    type="button"
                    onClick={() => setVerTecnico(v => !v)}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-red-700 hover:underline dark:text-red-400"
                  >
                    <Code2 className="h-3 w-3" />
                    {verTecnico ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}
                  </button>
                )}
              </div>
            )}
            {onReintentarCae && (
              <Button
                size="sm"
                variant="outline"
                className="gap-2 border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
                onClick={onReintentarCae}
                disabled={reintentando}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${reintentando ? 'animate-spin' : ''}`} />
                {reintentando ? 'Reencolando...' : 'Reintentar CAE'}
              </Button>
            )}
          </div>
        </PanelSeccion>
      )}
    </div>
  );
}

export default TabComunicacionElectronica;
