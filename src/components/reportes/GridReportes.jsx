import { useState, useMemo, useEffect } from 'react';
import {
  FileSpreadsheet, ArrowLeftRight, BookOpen, Columns, GitCompareArrows, Landmark, Calculator, Scale,
  Search, X, Star, LayoutGrid, SearchX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { REPORTS } from './reportDefinitions';
import ReportInfoDialog, { ReportInfoButton } from './ReportInfoDialog';
import { RUBROS, PALABRAS_CLAVE } from './reportCatalog';
import { armarSecciones, contarPorRubro } from '@/lib/catalogoReportes';
import {
  claveFavoritos, leerFavoritos, guardarFavoritos, alternarFavorito, leerVista, guardarVista,
} from '@/lib/favoritosReportes';

const AYUDA_PARIDAD = {
  queEs: 'Compara el monto en Pesos contra el equivalente en la moneda paralela configurada (ej. Dólares), operación por operación, al tipo de cambio vigente en el momento de cada una.',
  queMuestra: ['Comprobante, monto en ARS y monto en moneda paralela', 'Tipo de cambio usado en cada operación', 'Posición actual: el total revaluado al tipo de cambio de hoy'],
  filtros: ['Requiere tener la Moneda Paralela activada en Configuración → Finanzas'],
};
const AYUDA_LIBRO_IVA_VENTAS = {
  queEs: 'Detalle de comprobantes emitidos con el IVA discriminado, en el formato que se usa para la posición mensual de IVA ante AFIP/ARCA.',
  queMuestra: ['Fecha, comprobante y cliente (con CUIT si corresponde)', 'Neto gravado e IVA discriminado por alícuota', 'Total por comprobante'],
  filtros: ['Rango de fechas (normalmente un mes calendario)'],
};
const AYUDA_LIBRO_IVA_COMPRAS = {
  queEs: 'Detalle de facturas de compra recibidas con el IVA Crédito Fiscal discriminado, en el formato que se usa para la posición mensual de IVA ante AFIP/ARCA.',
  queMuestra: ['Fecha, factura y proveedor (con CUIT si corresponde)', 'Neto gravado e IVA discriminado por alícuota', 'Total por factura'],
  filtros: ['Rango de fechas (normalmente un mes calendario)'],
};
const AYUDA_ESTADO_RESULTADOS_CC = {
  queEs: 'El mismo Estado de Resultados de Plan de Cuentas, pero con todos los Centros de Costo activos lado a lado en vez de tener que mirarlos uno a la vez.',
  queMuestra: ['Ingresos y Egresos por cuenta, una columna por Centro de Costo + el Total', 'Resultado del Período de cada Centro de Costo'],
  filtros: ['Rango de fechas', 'Requiere tener Centros de Costo activados en Configuración → Finanzas'],
};
const AYUDA_COMPARATIVO_PERIODOS = {
  queEs: 'Compara el resultado de 2 períodos contables ya CERRADOS (no un rango de fechas cualquiera) — el número que se muestra es el que quedó certificado al momento del cierre, no se recalcula.',
  queMuestra: ['Ingresos, Egresos y Resultado de cada período elegido', 'Variación % de un período contra el otro'],
  filtros: ['Elegí cuáles 2 períodos cerrados comparar — necesitás al menos 2 cerrados para poder usar este reporte'],
};
const AYUDA_POSICION_FISCAL = {
  queEs: 'Cruza en una sola pantalla los 3 cálculos impositivos que hoy viven sueltos en Impuestos: IVA (Débito vs. Crédito Fiscal), Ingresos Brutos y Retenciones.',
  queMuestra: ['Saldo de IVA del período (a pagar o a favor)', 'Base Imponible de IIBB y Coeficiente de Distribución (el sistema no tiene cargada la alícuota, así que no calcula el monto en pesos)', 'Retenciones Sufridas (a favor) y Practicadas (depósito de terceros, aparte)', 'Total Neto Estimado a Pagar — IVA menos Retenciones Sufridas, sin incluir IIBB'],
  filtros: ['Rango de fechas'],
};
const AYUDA_MEMORIA_AJUSTE = {
  queEs: 'El papel de trabajo del Ajuste por Inflación contable de un período: cuenta por cuenta y mes por mes, con el saldo, el índice, el coeficiente aplicado y el ajuste — lo que el asiento resume en una línea por cuenta. Sirve de respaldo ante una inspección o para que tu contador revise el cálculo.',
  queMuestra: ['Por cada cuenta: saldo de apertura y movimientos de cada mes, con su índice y coeficiente', 'Saldo reexpresado y ajuste de cada línea, y el ajuste total de la cuenta', 'RECPAM (ganancia, pérdida y neto) y los índices utilizados', 'Un control de que el detalle cierra contra el ajuste que se va a postear'],
  filtros: ['Período contable', 'Requiere el Ajuste por Inflación activado en Configuración → Finanzas y los índices de inflación cargados', 'Descarga en PDF y Excel'],
};

const AYUDA_CONCILIACION = {
  queEs: 'Una foto a hoy de si el mayor contable coincide con los libros auxiliares que lo respaldan, para revisar en cada cierre. No genera ni corrige nada: solo muestra dónde hay diferencias y de dónde vienen.',
  queMuestra: ['Por cada cuenta de control (Cuentas a Cobrar, Cuentas a Pagar, Mercaderías, Caja y Bancos, IVA Débito e IVA Crédito): el saldo del mayor, el del subdiario y la diferencia', 'Controles de integridad con los casos concretos: movimientos de cuenta corriente sin cliente, saldos de clientes que no coinciden con sus movimientos, productos con stock y sin costo, cuentas con el saldo desactualizado, asientos desbalanceados, documentos sin asiento y asientos duplicados'],
  filtros: ['Ninguno: siempre es el estado actual', 'Descarga en PDF y Excel'],
};

const ICONO_FAVORITOS = <Star className="w-5 h-5 text-amber-500" />;
const ICONO_OTROS = <LayoutGrid className="w-5 h-5 text-kx-text-3" />;

function TarjetaReporte({ tarjeta, esFavorita, onAlternarFavorito, onInfo }) {
  const { disabled } = tarjeta;
  return (
    <div
      className={`group bg-kx-surface border border-kx-border rounded-2xl p-6 shadow-sm dark:shadow-none
        border-t-2 ${tarjeta.borderClass} transition-all duration-200
        ${disabled ? 'opacity-60 cursor-default' : 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer'}`}
      onClick={() => { if (!disabled) tarjeta.onOpen(); }}
      title={disabled ? tarjeta.disabledTitle : ''}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="p-3 bg-kx-surface-2 rounded-xl border border-kx-border">
          {tarjeta.icon}
        </div>
        <div className="flex items-center gap-1">
          {tarjeta.badge && (
            <span className="text-xs font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">
              {tarjeta.badge}
            </span>
          )}
          <button
            type="button"
            aria-pressed={esFavorita}
            aria-label={esFavorita ? `Quitar ${tarjeta.title} de favoritos` : `Marcar ${tarjeta.title} como favorito`}
            title={esFavorita ? 'Quitar de favoritos' : 'Marcar como favorito'}
            onClick={(e) => { e.stopPropagation(); onAlternarFavorito(tarjeta.id); }}
            className="p-1.5 rounded-full text-kx-text-3 hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
          >
            <Star className={`w-4 h-4 ${esFavorita ? 'fill-amber-400 text-amber-500' : ''}`} />
          </button>
          {tarjeta.ayuda && (
            <ReportInfoButton onClick={() => onInfo(tarjeta)} />
          )}
        </div>
      </div>

      <div className="mb-5">
        <h4 className="text-lg font-bold text-kx-text mb-1.5 group-hover:text-kx-violet transition-colors">
          {tarjeta.title}
        </h4>
        <p className="text-kx-text-2 text-sm line-clamp-2">
          {tarjeta.description}
        </p>
      </div>

      <Button
        disabled={disabled}
        className="w-full bg-kx-surface-2 hover:bg-kx-border text-kx-text border border-kx-border transition-all disabled:opacity-50"
      >
        {tarjeta.buttonLabel}
      </Button>
    </div>
  );
}

function Chip({ activo, onClick, disabled = false, children }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-sm font-medium border transition-colors
        ${activo
          ? 'bg-kx-violet text-white border-kx-violet'
          : 'bg-kx-surface text-kx-text-2 border-kx-border hover:border-kx-violet hover:text-kx-text'}
        ${disabled ? 'opacity-40 cursor-not-allowed hover:border-kx-border hover:text-kx-text-2' : ''}`}
    >
      {children}
    </button>
  );
}

function GridReportes({
  openReportDialog,
  tcParaleloEnabled, monedaParalela, setShowParidad,
  afipActivo, setShowLibroIVA, setLibroIVAOrigen, setShowLibroIVACompras,
  setShowEstadoResultadosCC, setShowComparativoPeriodos, setShowPosicionFiscal,
  ajusteInflacionHabilitado = false, setShowMemoriaAjuste, setShowConciliacion,
}) {
  const { user } = useAuth();
  const [infoAbierto, setInfoAbierto] = useState(null); // { title, icon, ayuda } | null
  const [busqueda, setBusqueda] = useState(() => leerVista().busqueda);
  const [rubroActivo, setRubroActivo] = useState(() => leerVista().rubroActivo);
  useEffect(() => { guardarVista({ busqueda, rubroActivo }); }, [busqueda, rubroActivo]);
  const clave = claveFavoritos(user?.id);
  const [favoritos, setFavoritos] = useState(() => leerFavoritos(clave));

  const alternar = (id) => {
    const nuevos = alternarFavorito(favoritos, id);
    setFavoritos(nuevos);
    guardarFavoritos(clave, nuevos);
  };

  // Todos los reportes en una sola forma: los que se abren en un diálogo
  // (REPORTS) y los que ocupan la pantalla entera (los de abajo). Cada uno
  // sabe cómo abrirse; el rubro al que pertenece lo define reportCatalog.jsx.
  const tarjetas = useMemo(() => {
    const generales = REPORTS.map(r => ({
      ...r,
      buttonLabel: 'Ver Reporte',
      onOpen: () => openReportDialog(r),
    }));
    const especiales = [
      {
        id: 'paridad',
        title: 'Reporte de Paridad',
        description: tcParaleloEnabled
          ? `Comparativa ARS / ${monedaParalela} por comprobante al TC histórico.`
          : 'Activá la Moneda Paralela en Configuración para habilitar este reporte.',
        icon: <ArrowLeftRight className="w-8 h-8 text-kx-blue" />,
        borderClass: 'border-t-kx-blue',
        badge: tcParaleloEnabled ? monedaParalela : null,
        ayuda: AYUDA_PARIDAD,
        disabled: !tcParaleloEnabled,
        disabledTitle: 'Activá la Moneda Paralela en Configuración para usar este reporte',
        buttonLabel: tcParaleloEnabled ? 'Ver Reporte' : 'Requiere configuración',
        onOpen: () => setShowParidad(true),
      },
      {
        id: 'libro_iva_ventas',
        title: 'Libro IVA Ventas',
        description: 'Comprobantes emitidos con neto gravado e IVA discriminado por período.',
        icon: <BookOpen className="w-8 h-8 text-kx-violet" />,
        borderClass: 'border-t-kx-violet',
        badge: afipActivo ? 'AFIP' : null,
        ayuda: AYUDA_LIBRO_IVA_VENTAS,
        buttonLabel: 'Ver Libro IVA Ventas',
        onOpen: () => { setShowLibroIVA(true); setLibroIVAOrigen('reportes'); },
      },
      {
        id: 'libro_iva_compras',
        title: 'Libro IVA Compras',
        description: 'Facturas recibidas con neto gravado e IVA Crédito Fiscal discriminado por período.',
        icon: <BookOpen className="w-8 h-8 text-kx-blue" />,
        borderClass: 'border-t-kx-blue',
        badge: afipActivo ? 'AFIP' : null,
        ayuda: AYUDA_LIBRO_IVA_COMPRAS,
        buttonLabel: 'Ver Libro IVA Compras',
        onOpen: () => setShowLibroIVACompras(true),
      },
      {
        id: 'estado_resultados_cc',
        title: 'Estado de Resultados por CC',
        ayudaTitulo: 'Estado de Resultados por Centro de Costo',
        description: 'Ingresos, Egresos y Resultado de cada Centro de Costo, lado a lado.',
        icon: <Columns className="w-8 h-8 text-kx-violet" />,
        borderClass: 'border-t-kx-violet',
        ayuda: AYUDA_ESTADO_RESULTADOS_CC,
        buttonLabel: 'Ver Reporte',
        onOpen: () => setShowEstadoResultadosCC(true),
      },
      {
        id: 'comparativo_periodos',
        title: 'Comparativo entre Períodos',
        ayudaTitulo: 'Comparativo entre Períodos Cerrados',
        description: 'Cómo te fue en un período cerrado comparado con otro.',
        icon: <GitCompareArrows className="w-8 h-8 text-kx-blue" />,
        borderClass: 'border-t-kx-blue',
        ayuda: AYUDA_COMPARATIVO_PERIODOS,
        buttonLabel: 'Ver Reporte',
        onOpen: () => setShowComparativoPeriodos(true),
      },
      {
        id: 'posicion_fiscal',
        title: 'Posición Fiscal Consolidada',
        description: 'IVA, IIBB y Retenciones del período, cruzados en un solo lugar.',
        icon: <Landmark className="w-8 h-8 text-kx-red" />,
        borderClass: 'border-t-kx-red',
        ayuda: AYUDA_POSICION_FISCAL,
        buttonLabel: 'Ver Reporte',
        onOpen: () => setShowPosicionFiscal(true),
      },
      {
        id: 'memoria_ajuste_inflacion',
        title: 'Memoria de Cálculo — Ajuste por Inflación',
        description: ajusteInflacionHabilitado
          ? 'Papel de trabajo cuenta por cuenta del ajuste de un período, para respaldo.'
          : 'Activá el Ajuste por Inflación en Configuración para habilitar este reporte.',
        icon: <Calculator className="w-8 h-8 text-kx-amber" />,
        borderClass: 'border-t-kx-amber',
        ayuda: AYUDA_MEMORIA_AJUSTE,
        disabled: !ajusteInflacionHabilitado,
        disabledTitle: 'Activá el Ajuste por Inflación en Configuración → Finanzas para usar este reporte',
        buttonLabel: ajusteInflacionHabilitado ? 'Ver Reporte' : 'Requiere configuración',
        onOpen: () => setShowMemoriaAjuste?.(true),
      },
      {
        id: 'conciliacion_cuentas_control',
        title: 'Conciliación de Cuentas de Control',
        description: 'Si el mayor coincide con clientes, proveedores, stock, caja e IVA — y dónde no.',
        icon: <Scale className="w-8 h-8 text-kx-red" />,
        borderClass: 'border-t-kx-red',
        ayuda: AYUDA_CONCILIACION,
        buttonLabel: 'Ver Reporte',
        onOpen: () => setShowConciliacion?.(true),
      },
    ];
    return [...generales, ...especiales].map(t => ({ ...t, palabrasClave: PALABRAS_CLAVE[t.id] }));
  }, [
    openReportDialog, tcParaleloEnabled, monedaParalela, setShowParidad, afipActivo, setShowLibroIVA,
    setLibroIVAOrigen, setShowLibroIVACompras, setShowEstadoResultadosCC, setShowComparativoPeriodos,
    setShowPosicionFiscal, ajusteInflacionHabilitado, setShowMemoriaAjuste, setShowConciliacion,
  ]);

  const secciones = useMemo(
    () => armarSecciones({ tarjetas, rubros: RUBROS, busqueda, rubroActivo, favoritos }),
    [tarjetas, busqueda, rubroActivo, favoritos]
  );
  const cuentas = useMemo(
    () => contarPorRubro({ tarjetas, rubros: RUBROS, busqueda, favoritos }),
    [tarjetas, busqueda, favoritos]
  );
  const hayBusqueda = busqueda.trim() !== '';
  const iconoDe = (s) => s.icon ?? (s.id === 'favoritos' ? ICONO_FAVORITOS : ICONO_OTROS);

  return (
    <>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-kx-surface dark:bg-transparent p-6 -mx-6 -mt-6 mb-6 border-b border-kx-border dark:border-none">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-kx-text mb-2 flex items-center gap-2">
            <FileSpreadsheet className="w-8 h-8 text-blue-600 dark:text-kx-violet" />
            Centro de Reportes
          </h2>
          <p className="text-slate-500 dark:text-kx-text-2">
            Genera y exporta información detallada para la toma de decisiones estratégicas.
          </p>
        </div>
      </div>

      {/* Buscador + rubros: encontrar un reporte puntual sin recorrer todos. */}
      <div className="space-y-4 mb-8">
        <div className="relative max-w-xl">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-kx-text-3" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscá un reporte: IVA, stock, deuda, margen, caja…"
            aria-label="Buscar reporte"
            className="h-10 pl-10 pr-10 kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
          />
          {hayBusqueda && (
            <button
              type="button"
              aria-label="Borrar lo escrito"
              onClick={() => setBusqueda('')}
              className="absolute right-2.5 top-2.5 p-0.5 rounded-full text-kx-text-3 hover:text-kx-text"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por rubro">
          <Chip activo={rubroActivo === 'todos'} onClick={() => setRubroActivo('todos')}>
            Todos <span className="opacity-70">{cuentas.todos}</span>
          </Chip>
          {favoritos.length > 0 && (
            <Chip
              activo={rubroActivo === 'favoritos'}
              onClick={() => setRubroActivo('favoritos')}
              disabled={hayBusqueda && cuentas.favoritos === 0}
            >
              <Star className="h-3.5 w-3.5" /> Favoritos <span className="opacity-70">{cuentas.favoritos}</span>
            </Chip>
          )}
          {RUBROS.map(r => (
            <Chip
              key={r.id}
              activo={rubroActivo === r.id}
              onClick={() => setRubroActivo(r.id)}
              disabled={hayBusqueda && !cuentas[r.id]}
            >
              {r.corto ?? r.titulo} <span className="opacity-70">{cuentas[r.id] ?? 0}</span>
            </Chip>
          ))}
        </div>
      </div>

      {secciones.length === 0 ? (
        <div className="text-center py-16 text-kx-text-2 bg-kx-surface border border-kx-border rounded-xl">
          <SearchX className="h-10 w-10 mx-auto mb-2 opacity-30" />
          {rubroActivo === 'favoritos' && !hayBusqueda ? (
            <>
              <p className="font-medium">Todavía no marcaste ningún favorito.</p>
              <p className="text-xs mt-1">Tocá la estrella de un reporte para tenerlo siempre a mano.</p>
            </>
          ) : (
            <>
              <p className="font-medium">No encontré reportes{hayBusqueda ? ` con «${busqueda.trim()}»` : ' en este rubro'}.</p>
              <p className="text-xs mt-1">Probá con otra palabra (ej. «IVA», «stock», «deuda»).</p>
              {hayBusqueda && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => { setBusqueda(''); setRubroActivo('todos'); }}>
                  Limpiar búsqueda
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        secciones.map(s => (
          <section key={s.id} aria-labelledby={`rubro-${s.id}`} className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="p-2 rounded-lg bg-kx-surface-2 border border-kx-border">{iconoDe(s)}</span>
              <div>
                <h3 id={`rubro-${s.id}`} className="text-lg font-bold text-kx-text">
                  {s.titulo} <span className="text-sm font-normal text-kx-text-3">({s.tarjetas.length})</span>
                </h3>
                {s.descripcion && <p className="text-xs text-kx-text-3">{s.descripcion}</p>}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {s.tarjetas.map(t => (
                <TarjetaReporte
                  key={`${s.id}-${t.id}`}
                  tarjeta={t}
                  esFavorita={favoritos.includes(t.id)}
                  onAlternarFavorito={alternar}
                  onInfo={(x) => setInfoAbierto({ title: x.ayudaTitulo ?? x.title, icon: x.icon, ayuda: x.ayuda })}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <ReportInfoDialog
        open={!!infoAbierto}
        onOpenChange={(v) => !v && setInfoAbierto(null)}
        title={infoAbierto?.title}
        icon={infoAbierto?.icon}
        ayuda={infoAbierto?.ayuda}
      />
    </>
  );
}

export default GridReportes;
