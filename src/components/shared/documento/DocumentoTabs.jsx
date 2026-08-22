import { TabsList, TabsTrigger } from '@/components/ui/tabs';

// Shell tabulado compartido para el detalle de documentos — item 7 del plan de
// rediseño (22/08). Nace del pedido explícito de Luciano: "es mandatorio que
// todos los comprobantes tengan el mismo diseño, lo que puede variar es la
// cantidad de información dentro de los mismos".
//
// El punto de este archivo es que la consistencia no dependa de que cada modal
// se acuerde de copiar las clases: el estilo vive acá una sola vez y los
// documentos componen. Si mañana cambia el look, cambia en un lugar.
//
// Estilo de solapa SUBRAYADO a propósito, distinto del de las secciones
// (TabsList con pastillas llenas, ej. CuentaCorrienteSection): son dos niveles
// de jerarquía distintos. Pastilla = navegación de nivel superior; subrayado =
// estás adentro de un documento. Es el mismo criterio que usa SAP en sus
// documentos de marketing.

export function DocumentoTabsList({ children, className = '' }) {
  return (
    <TabsList
      className={`h-auto w-full justify-start gap-1 rounded-none border-b border-slate-200 dark:border-kx-border bg-transparent p-0 ${className}`}
    >
      {children}
    </TabsList>
  );
}

// `alerta` pinta un punto ámbar en la solapa. Sirve para que el usuario no
// tenga que abrir las 4 para descubrir que el CAE falló o que falta el asiento
// — el problema se ve desde la solapa cerrada. Usarlo solo para cosas que el
// usuario puede accionar, no para "este documento no tiene X y está bien".
export function DocumentoTab({ value, icon: Icon, alerta = false, children }) {
  return (
    <TabsTrigger
      value={value}
      className="relative rounded-none border-b-2 border-transparent bg-transparent px-4 py-2.5 text-sm font-medium text-slate-500 dark:text-kx-text-2 shadow-none transition-colors hover:text-slate-800 dark:hover:text-kx-text data-[state=active]:border-blue-600 dark:data-[state=active]:border-kx-violet data-[state=active]:bg-transparent data-[state=active]:text-blue-700 dark:data-[state=active]:text-kx-violet data-[state=active]:shadow-none"
    >
      <span className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {children}
        {alerta && (
          <span
            className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-500"
            title="Esta solapa tiene algo que requiere atención"
          />
        )}
      </span>
    </TabsTrigger>
  );
}

// Bloque de datos con título — la unidad visual que se repite en todas las
// solapas. Reemplaza los `bg-kx-surface-2 ... p-4 rounded-lg border` sueltos
// que cada modal venía escribiendo por su cuenta.
export function PanelSeccion({ titulo, accion, children, className = '' }) {
  return (
    <div className={`rounded-lg border kairox-border bg-kx-surface-2 dark:bg-slate-900/50 p-4 ${className}`}>
      {(titulo || accion) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {titulo && (
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-kx-text-2">
              {titulo}
            </div>
          )}
          {accion}
        </div>
      )}
      {children}
    </div>
  );
}

// Par etiqueta/valor. `mono` para números de comprobante, CAE, CUIT — cualquier
// cosa que el usuario vaya a comparar carácter por carácter contra otro papel.
export function CampoDato({ label, valor, mono = false, className = '' }) {
  const vacio = valor === null || valor === undefined || valor === '';
  return (
    <div className={className}>
      <span className="mb-0.5 block text-xs text-slate-500 dark:text-kx-text-2">{label}</span>
      <span
        className={`block text-sm ${mono ? 'font-mono' : ''} ${
          vacio ? 'text-slate-400 dark:text-kx-text-3 italic' : 'text-kx-text dark:text-kx-text'
        }`}
      >
        {vacio ? '—' : valor}
      </span>
    </div>
  );
}

// Grilla estándar de campos. Una sola definición de breakpoints para que dos
// documentos distintos no terminen con 3 y 4 columnas en la misma pantalla.
export function GrillaCampos({ children, cols = 4, className = '' }) {
  const map = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
  };
  return <div className={`grid grid-cols-1 gap-4 ${map[cols] ?? map[4]} ${className}`}>{children}</div>;
}

// Estado vacío de una solapa. Explica POR QUÉ está vacía en vez de mostrar un
// panel en blanco — si un documento no tiene logística porque nunca se entregó,
// eso es información, no una falla.
export function SolapaVacia({ icon: Icon, titulo, detalle }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {Icon && <Icon className="h-8 w-8 text-slate-300 dark:text-kx-text-3" />}
      <div className="text-sm font-medium text-slate-600 dark:text-kx-text-2">{titulo}</div>
      {detalle && <div className="max-w-md text-xs text-slate-400 dark:text-kx-text-3">{detalle}</div>}
    </div>
  );
}
