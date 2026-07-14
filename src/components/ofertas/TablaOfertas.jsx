import { Tag, ToggleLeft, ToggleRight, Plus, Edit, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate } from './shared';

function TablaOfertas({
  ofertas, isLoading,
  activas, vigentesHoy,
  openNueva, openEditar, setDeleteConfirm,
  toggleActivo,
}) {
  const hoy = new Date().toISOString().split('T')[0];

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="dark:bg-kx-surface dark:border-kx-border">
          <CardContent className="p-4">
            <p className="text-xs text-kx-text-3 uppercase mb-1">Ofertas activas</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-kx-text">{activas}</p>
          </CardContent>
        </Card>
        <Card className="dark:bg-kx-surface dark:border-kx-border">
          <CardContent className="p-4">
            <p className="text-xs text-kx-text-3 uppercase mb-1">Total ofertas</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-kx-text">{ofertas.length}</p>
          </CardContent>
        </Card>
        <Card className="dark:bg-kx-surface dark:border-kx-border">
          <CardContent className="p-4">
            <p className="text-xs text-kx-text-3 uppercase mb-1">Vigentes hoy</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-kx-text">{vigentesHoy}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla */}
      <Card className="dark:bg-kx-bg dark:border-kx-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-kx-text-3 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando...
            </div>
          ) : ofertas.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center gap-3">
              <Tag className="w-10 h-10 text-slate-300 dark:text-slate-700" />
              <p className="text-slate-500 dark:text-kx-text-2 font-medium">No hay ofertas configuradas</p>
              <p className="text-sm text-kx-text-3">
                Creá tu primera oferta para aplicar descuentos automáticos en el POS
              </p>
              <Button onClick={openNueva} variant="outline" className="mt-2 gap-2 dark:border-kx-border dark:text-slate-300">
                <Plus className="w-4 h-4" /> Crear primera oferta
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2">
                  <tr>
                    <th className="p-4 text-left">Nombre</th>
                    <th className="p-4 text-center">Descuento</th>
                    <th className="p-4 text-left hidden lg:table-cell">Condiciones</th>
                    <th className="p-4 text-center hidden md:table-cell">Vigencia</th>
                    <th className="p-4 text-center">Estado</th>
                    <th className="p-4 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {ofertas.map(oferta => {
                    const vencida = oferta.fecha_hasta && oferta.fecha_hasta < hoy;
                    return (
                      <tr key={oferta.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-md bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                              <Tag className="w-3.5 h-3.5 text-kx-green" />
                            </div>
                            <div className="min-w-0">
                              <span className="font-semibold text-kx-text dark:text-kx-text block truncate">{oferta.nombre}</span>
                              {oferta.descripcion && (
                                <span className="text-xs text-kx-text-3 block truncate">{oferta.descripcion}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          {oferta.tipo_descuento === 'porcentaje' ? (
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-100">
                              {oferta.valor_descuento}%
                            </Badge>
                          ) : (
                            <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-100">
                              ${Number(oferta.valor_descuento).toLocaleString('es-AR')}
                            </Badge>
                          )}
                        </td>
                        <td className="p-4 hidden lg:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {oferta.producto_id && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {oferta.productos?.nombre ?? 'Producto específico'}
                              </span>
                            )}
                            {oferta.categoria_nombre && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                Cat: {oferta.categoria_nombre}
                              </span>
                            )}
                            {oferta.medio_pago && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {oferta.medio_pago}
                              </span>
                            )}
                            {oferta.dia_semana && oferta.dia_semana.length > 0 && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                Días específicos
                              </span>
                            )}
                            {oferta.monto_minimo_carrito && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                Min ${Number(oferta.monto_minimo_carrito).toLocaleString('es-AR')}
                              </span>
                            )}
                            {!oferta.producto_id && !oferta.categoria_nombre && !oferta.medio_pago
                              && (!oferta.dia_semana || oferta.dia_semana.length === 0)
                              && !oferta.monto_minimo_carrito && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-kx-text-3">
                                Todos los productos
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-center hidden md:table-cell">
                          {vencida ? (
                            <Badge variant="destructive" className="text-xs">Vencida</Badge>
                          ) : oferta.fecha_desde && oferta.fecha_hasta ? (
                            <span className="text-xs text-kx-text-3">
                              {formatDate(oferta.fecha_desde)} — {formatDate(oferta.fecha_hasta)}
                            </span>
                          ) : oferta.fecha_hasta ? (
                            <span className="text-xs text-kx-text-3">
                              Hasta {formatDate(oferta.fecha_hasta)}
                            </span>
                          ) : (
                            <span className="text-xs text-kx-text-3 italic">Sin vencimiento</span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => toggleActivo.mutate({ id: oferta.id, activo: !oferta.activo })}
                            className="flex items-center justify-center mx-auto"
                            title={oferta.activo ? 'Desactivar oferta' : 'Activar oferta'}
                          >
                            {oferta.activo
                              ? <ToggleRight className="w-6 h-6 text-kx-green" />
                              : <ToggleLeft className="w-6 h-6 text-kx-text-3" />
                            }
                          </button>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-kx-blue"
                              onClick={() => openEditar(oferta)} title="Editar oferta">
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-kx-red"
                              onClick={() => setDeleteConfirm(oferta.id)} title="Eliminar oferta">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export default TablaOfertas;
