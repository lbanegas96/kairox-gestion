import { MapPin, Truck, Info, AlertCircle } from 'lucide-react';
import { PanelSeccion, CampoDato, GrillaCampos, SolapaVacia } from './DocumentoTabs';

// Solapa "Logística" — item 7 del plan de rediseño (22/08).
//
// Es la única de las cuatro que necesitó base de datos (mig.345): `clientes`
// solo tenía `direccion` como texto libre, sin localidad/provincia/CP, y
// `entregas` no tenía ninguna columna de destino. Fue el hallazgo de Luciano
// al pedir esta solapa — y de paso destapó que el remito salía incompleto.
//
// Dos modos, y la diferencia se le dice al usuario en la cara:
//  · congelado=true  → la Entrega guardó el destino al emitirse (Regla 7).
//  · congelado=false → no hay snapshot; se muestra la dirección ACTUAL del
//    maestro. Pasa en documentos que no son Entrega, y en Entregas anteriores
//    a mig.345. Mentir acá sería peor que no mostrar nada.

function lineaDireccion({ localidad, provincia, codigo_postal }) {
  // "Quilmes, Buenos Aires (B1878)" — arma solo con lo que hay, sin comas
  // colgando cuando falta una parte.
  const ciudad = [localidad, provincia].filter(Boolean).join(', ');
  const cp = codigo_postal ? `(${codigo_postal})` : '';
  return [ciudad, cp].filter(Boolean).join(' ') || null;
}

function TabLogistica({
  destino,
  fallback,
  congelado = false,
  transportista,
  observaciones,
  nombreDestinatario,
  onIrAlMaestro,
}) {
  // El snapshot manda; si está vacío, se cae al maestro.
  const hayDestino = destino && (destino.direccion || destino.localidad || destino.provincia || destino.codigo_postal);
  const datos = hayDestino ? destino : (fallback ?? {});
  const usandoFallback = !hayDestino;
  const hayAlgo = !!(datos.direccion || datos.localidad || datos.provincia || datos.codigo_postal);

  if (!hayAlgo && !transportista && !observaciones) {
    return (
      <SolapaVacia
        icon={MapPin}
        titulo="Sin datos de domicilio"
        detalle={
          onIrAlMaestro
            ? 'Este socio de negocio no tiene dirección cargada. Completala en su ficha para que los remitos y las entregas salgan con el domicilio completo.'
            : 'Este socio de negocio no tiene dirección cargada en su ficha.'
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <PanelSeccion
        titulo="Domicilio de entrega"
        accion={
          <span className="inline-flex items-center gap-1 text-2xs text-slate-400 dark:text-kx-text-3">
            <Info className="h-3 w-3" />
            {congelado && !usandoFallback ? 'Registrado al emitir' : 'Dirección actual del cliente'}
          </span>
        }
      >
        <GrillaCampos cols={3}>
          <CampoDato label="Destinatario" valor={nombreDestinatario} />
          <CampoDato label="Domicilio" valor={datos.direccion} className="lg:col-span-2" />
          <CampoDato label="Localidad" valor={datos.localidad} />
          <CampoDato label="Provincia" valor={datos.provincia} />
          <CampoDato label="Código postal" valor={datos.codigo_postal} mono />
        </GrillaCampos>

        {hayAlgo && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-slate-200 bg-kx-surface p-2.5 dark:border-kx-border dark:bg-kx-bg">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-kx-text-3" />
            <span className="text-sm text-kx-text dark:text-kx-text">
              {[datos.direccion, lineaDireccion(datos)].filter(Boolean).join(' — ')}
            </span>
          </div>
        )}

        {congelado && usandoFallback && (
          <div className="mt-3 flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Esta entrega es anterior a que empezáramos a guardar el domicilio en el documento,
              así que se muestra el que el cliente tiene hoy — puede no ser el de aquel momento.
            </span>
          </div>
        )}

        {onIrAlMaestro && (
          <button
            type="button"
            onClick={onIrAlMaestro}
            className="mt-3 text-2xs font-medium text-kx-violet hover:opacity-80"
          >
            Editar domicilio en la ficha del cliente
          </button>
        )}
      </PanelSeccion>

      {(transportista || observaciones) && (
        <PanelSeccion titulo="Transporte">
          <GrillaCampos cols={2}>
            <CampoDato
              label="Transportista"
              valor={transportista ? (
                <span className="inline-flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5 text-slate-400" /> {transportista}
                </span>
              ) : null}
            />
            <CampoDato label="Observaciones de entrega" valor={observaciones} />
          </GrillaCampos>
        </PanelSeccion>
      )}
    </div>
  );
}

export default TabLogistica;
