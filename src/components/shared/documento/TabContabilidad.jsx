import { RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { formatDateAR } from '@/lib/dateUtils';
import EstadoBadge from '@/components/ui/EstadoBadge';
import VerAsientoButton from '@/components/shared/VerAsientoButton';
import { asientosService, PLAN_CUENTAS_KEYS } from '@/services/planCuentasService';
import { PanelSeccion, CampoDato, GrillaCampos } from './DocumentoTabs';

// Solapa "Contabilidad" — equivalente a la de SAP en sus documentos de
// marketing. Item 7 del plan de rediseño (22/08).
//
// Reúne lo que hoy había que buscar en tres lugares distintos: el asiento
// generado (botón que ya construimos en el item 4), el centro de costo, y las
// condiciones financieras del documento. Sin migración — todas las columnas ya
// existían en `comprobantes` / `compras`.

const fmtMoneda = (n, moneda = 'ARS') => {
  if (n === null || n === undefined) return null;
  const simbolo = moneda === 'ARS' ? '$' : `${moneda} `;
  return `${simbolo}${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function TabContabilidad({
  documento,
  asientoId,
  empresaId,
  origen,
  origenId,
  onRegenerarAsiento,
  puedeRegenerarAsiento = false,
}) {
  // Resuelve por origen+origenId cuando el documento no guarda el id directo
  // (hallazgo Auditoría de Circuitos, 13/09: NC/ND de cliente mostraban "sin
  // asiento vinculado" aunque el asiento SÍ existía y estaba balanceado — el
  // texto de abajo solo miraba `asientoId`, que para NC/ND siempre es null,
  // mientras que VerAsientoButton ya sabía resolverlo por origen/origenId).
  // Mismo criterio que ya usaba VerAsientoButton — se sube acá para que el
  // texto y el botón queden sincronizados.
  const porOrigen = !asientoId && !!origen && !!origenId && !!empresaId;
  const { data: resuelto } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.asientoPorOrigen(origen ?? '', origenId ?? ''),
    queryFn: () => asientosService.getAsientoPorOrigen(empresaId, origen, origenId),
    enabled: porOrigen,
  });
  const asientoIdResuelto = asientoId ?? resuelto?.id ?? null;

  if (!documento) return null;

  const moneda = documento.moneda || 'ARS';
  const esFX = moneda !== 'ARS';

  return (
    <div className="space-y-4">
      <PanelSeccion
        titulo="Asiento contable"
        accion={
          <VerAsientoButton
            asientoId={asientoIdResuelto}
            empresaId={empresaId}
          />
        }
      >
        {asientoIdResuelto ? (
          <p className="text-sm text-slate-600 dark:text-kx-text-2">
            Este documento generó su asiento automáticamente. Abrilo para ver el detalle de Debe y Haber.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-kx-text-2">
              Este documento todavía no tiene un asiento vinculado. Suele pasar si el período
              estaba cerrado al emitirlo, si faltaba una cuenta del plan, o si la conexión se
              cortó justo después de confirmarlo.
            </p>
            {puedeRegenerarAsiento && onRegenerarAsiento && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-400 dark:hover:bg-amber-900/20"
                onClick={onRegenerarAsiento}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Regenerar asiento
              </Button>
            )}
          </div>
        )}
      </PanelSeccion>

      <PanelSeccion titulo="Condiciones del documento">
        <GrillaCampos cols={4}>
          <CampoDato
            label="Estado de pago"
            valor={documento.estado_pago ? <EstadoBadge estado={documento.estado_pago} /> : null}
          />
          <CampoDato
            label="Vencimiento"
            valor={documento.fecha_vencimiento ? formatDateAR(documento.fecha_vencimiento) : null}
          />
          <CampoDato label="Forma de pago" valor={documento.forma_pago} />
          <CampoDato label="Centro de costo" valor={documento.centro_costo?.nombre} />
          <CampoDato label="Moneda" valor={moneda} />
          {esFX && (
            <>
              <CampoDato
                label="Tipo de cambio"
                valor={documento.tipo_cambio_tasa ? Number(documento.tipo_cambio_tasa).toLocaleString('es-AR') : null}
              />
              <CampoDato
                label={`Importe en ${moneda}`}
                valor={fmtMoneda(documento.monto_moneda_original, moneda)}
              />
            </>
          )}
          <CampoDato label="Referencia del cliente" valor={documento.referencia_cliente} />
          {/* COGS: solo tiene sentido en una venta, y solo si el motor de
              inventario lo calculó (mig.287). En una NC/ND siempre es 0. */}
          {documento.costo_mercaderia_vendida > 0 && (
            <CampoDato
              label="Costo de mercadería vendida"
              valor={fmtMoneda(documento.costo_mercaderia_vendida)}
            />
          )}
        </GrillaCampos>
      </PanelSeccion>
    </div>
  );
}

export default TabContabilidad;
