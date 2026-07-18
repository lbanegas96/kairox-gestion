import { useState, useMemo } from 'react';
import { Landmark, Plus, Upload, Pencil, Trash2, ArrowUpCircle, ArrowDownCircle, RefreshCw, FileText, ChevronRight, Building2, Wallet, Eye, EyeOff, User, Bot, Check, Scale, CreditCard } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { cuentasService, movimientosService, CB_KEYS } from '@/services/cuentasBancariasService';
import { liquidacionTarjetasService, LIQUIDACION_KEYS } from '@/services/liquidacionTarjetasService';
import { formatDateAR } from '@/lib/dateUtils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { formatMoney, origenMeta, limpiarDescripcion, ejecutorDe, RefChip } from '@/components/cuentas-bancarias/shared';
import CuentaModal from '@/components/cuentas-bancarias/CuentaModal';
import MovimientoModal from '@/components/cuentas-bancarias/MovimientoModal';
import ImportCSVModal from '@/components/cuentas-bancarias/ImportCSVModal';
import ConciliacionTab from '@/components/cuentas-bancarias/ConciliacionTab';
import TarjetasPendientesTab from '@/components/cuentas-bancarias/TarjetasPendientesTab';

function CuentasBancariasSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const empresaId = user?.empresa_id;

  const [activeTab, setActiveTab] = useState('cuentas');
  const [filterCuentaId, setFilterCuentaId] = useState('todas');
  const [filterDesde, setFilterDesde] = useState('');
  const [filterHasta, setFilterHasta] = useState('');
  const [filterTipo, setFilterTipo] = useState('todos');

  const [cuentaModal, setCuentaModal] = useState({ open: false, cuenta: null });
  const [movModal, setMovModal] = useState({ open: false, cuentaId: '' });
  const [csvModal, setCsvModal] = useState(false);
  const [syncing, setSyncing] = useState(false); // FIX-MP-SYNC
  const [showCbu, setShowCbu] = useState({}); // SECURITY-SENSITIVE-DATA

  const movFilters = useMemo(() => ({
    cuentaId: filterCuentaId !== 'todas' ? filterCuentaId : undefined,
    desde: filterDesde || undefined,
    hasta: filterHasta || undefined,
    tipo: filterTipo !== 'todos' ? filterTipo : undefined,
  }), [filterCuentaId, filterDesde, filterHasta, filterTipo]);

  const { data: cuentas = [], isLoading: loadingCuentas } = useQuery({
    queryKey: CB_KEYS.cuentas(empresaId),
    queryFn: () => cuentasService.getAll(empresaId),
    enabled: !!empresaId,
  });

  // FIX-SALDO-REAL — query con filtros SOLO para la tabla de movimientos
  const { data: movimientosTabla = [], isLoading: loadingMovs } = useQuery({
    queryKey: CB_KEYS.movimientos(empresaId, movFilters),
    queryFn: () => movimientosService.getAll(empresaId, movFilters),
    enabled: !!empresaId,
  });

  // FIX-SALDO-REAL — saldo agregado por cuenta calculado en SQL (RPC saldos_bancarios).
  // Antes se traían TODOS los movimientos al cliente y se sumaba en JS; ahora la base
  // devuelve un saldo por cuenta. Es la fuente de verdad de los saldos (sin filtros de tabla).
  const { data: saldos = new Map() } = useQuery({
    queryKey: CB_KEYS.movimientosSaldo(empresaId),
    queryFn: () => movimientosService.getSaldos(),
    enabled: !!empresaId,
  });

  const totalGeneral = useMemo(
    () => [...saldos.values()].reduce((a, b) => a + b, 0),
    [saldos]
  );

  const { data: pendientesLiq = [] } = useQuery({
    queryKey: LIQUIDACION_KEYS.pendientes(empresaId),
    queryFn: () => liquidacionTarjetasService.getPendientes(empresaId),
    enabled: !!empresaId,
  });

  const isAdmin = user?.role === 'admin';

  const deleteMov = useMutation({
    mutationFn: (id) => movimientosService.delete(id, empresaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movimientos_bancarios', empresaId] });
      qc.invalidateQueries({ queryKey: CB_KEYS.movimientosSaldo(empresaId) }); // FIX-SALDO-REAL
      toast({ title: 'Movimiento eliminado', className: 'bg-green-600 text-white' });
    },
    onError: (e) => toast({ title: 'Error al eliminar', description: e.message, variant: 'destructive' }),
  });

  // Contabilización de un movimiento suelto (genera asiento vía determinación de cuentas)
  const contabilizarMut = useMutation({
    mutationFn: (id) => movimientosService.contabilizar(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['movimientos_bancarios', empresaId] });
      toast({ title: `✓ Contabilizado — asiento ${res?.numero ?? ''}`, className: 'bg-green-600 text-white' });
    },
    onError: (e) => toast({ title: 'No se pudo contabilizar', description: e.message, variant: 'destructive' }),
  });

  const revertirMut = useMutation({
    mutationFn: (id) => movimientosService.revertirContabilizacion(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movimientos_bancarios', empresaId] });
      toast({ title: 'Contabilización revertida' });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deactivateCuenta = useMutation({
    mutationFn: (id) => cuentasService.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CB_KEYS.cuentas(empresaId) });
      toast({ title: 'Cuenta desactivada' });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  // FIX-MP-SYNC — sincronización manual de pagos MercadoPago
  // NOTA: mp-sync ignora el body y sincroniza TODAS las integraciones activas.
  // Se pasa empresa_id igual para forward-compat si la función filtra por empresa
  // a futuro (refactor pendiente con Luciano).
  const handleSyncMP = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('mp-sync', {
        body: { empresa_id: empresaId },
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['movimientos_bancarios', empresaId] });
      qc.invalidateQueries({ queryKey: CB_KEYS.movimientosSaldo(empresaId) });
      qc.invalidateQueries({ queryKey: CB_KEYS.cuentas(empresaId) });
      toast({ title: 'Movimientos actualizados', className: 'bg-green-600 text-white' });
    } catch (e) {
      toast({ title: 'Error al actualizar', description: e.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  if (!empresaId) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <Landmark className="h-6 w-6 text-indigo-600 dark:text-indigo-500" />
            Cuentas Bancarias
          </h1>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-1">
            Administrá tus cuentas y movimientos bancarios
          </p>
        </div>
        <div className="flex gap-2">
          {/* FIX-MP-SYNC */}
          <Button variant="outline" size="sm" onClick={handleSyncMP} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Actualizando...' : 'Actualizar'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCsvModal(true)}>
            <Upload className="w-4 h-4 mr-2" /> Importar CSV
          </Button>
          <Button size="sm" onClick={() => setCuentaModal({ open: true, cuenta: null })}>
            <Plus className="w-4 h-4 mr-2" /> Nueva cuenta
          </Button>
        </div>
      </div>

      {/* KPI global */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden shadow-sm dark:shadow-none">
        <div className="bg-kx-surface p-5 border-t-2 border-t-kx-blue hover:bg-kx-surface-2 transition-colors duration-200">
          <p className="text-2xs text-kx-text-2 uppercase font-medium tracking-wide">Saldo total</p>
          <p className={`text-3xl font-bold font-mono mt-2 tabular-nums ${totalGeneral >= 0 ? 'text-kx-blue' : 'text-kx-red'}`}>
            {formatMoney(totalGeneral)}
          </p>
          <p className="text-xs text-kx-text-3 mt-1">{cuentas.length} cuenta{cuentas.length !== 1 ? 's' : ''} activa{cuentas.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="bg-kx-surface p-5 sm:col-span-2 border-t-2 border-t-kx-text-3">
          <p className="text-2xs text-kx-text-2 uppercase font-medium tracking-wide mb-3">Saldo por cuenta</p>
          <div className="space-y-2">
            {cuentas.length === 0 && <p className="text-sm text-kx-text-3">Sin cuentas configuradas</p>}
            {cuentas.map(c => (
              <div key={c.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 text-kx-text-3 flex-shrink-0" />
                  <span className="text-sm text-kx-text truncate">{c.nombre}</span>
                  <Badge variant="outline" className="text-xs shrink-0">{c.banco}</Badge>
                </div>
                <span className={`text-sm font-mono font-semibold shrink-0 ml-2 ${(saldos.get(c.id) ?? 0) >= 0 ? 'text-kx-text' : 'text-kx-red'}`}>
                  {formatMoney(saldos.get(c.id) ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="cuentas">Cuentas ({cuentas.length})</TabsTrigger>
          <TabsTrigger value="movimientos">Movimientos ({movimientosTabla.length})</TabsTrigger>
          <TabsTrigger value="conciliacion">Conciliación</TabsTrigger>
          <TabsTrigger value="tarjetas" className="gap-1.5">
            <CreditCard className="w-3.5 h-3.5" /> Tarjetas pendientes
            {pendientesLiq.length > 0 && (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 h-4 px-1.5 text-2xs">
                {pendientesLiq.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Tab: Cuentas */}
        <TabsContent value="cuentas" className="mt-4">
          {loadingCuentas ? (
            <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-kx-text-3" /></div>
          ) : cuentas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-kx-text-3">
              <Landmark className="w-12 h-12 opacity-30" />
              <p className="font-medium">Sin cuentas bancarias</p>
              <p className="text-sm text-center max-w-xs">Agregá tu primera cuenta para empezar a registrar movimientos.</p>
              <Button onClick={() => setCuentaModal({ open: true, cuenta: null })}>
                <Plus className="w-4 h-4 mr-2" /> Agregar cuenta
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {cuentas.map(c => (
                <Card key={c.id} className="dark:border-kx-border hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate">{c.nombre}</CardTitle>
                        <p className="text-sm text-slate-500 dark:text-kx-text-2">{c.banco}</p>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-xs">{c.moneda}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className={`text-2xl font-bold font-mono ${(saldos.get(c.id) ?? 0) >= 0 ? 'text-kx-text dark:text-kx-text' : 'text-kx-red'}`}>
                      {formatMoney(saldos.get(c.id) ?? 0)}
                    </p>
                    {/* SECURITY-SENSITIVE-DATA */}
                    {c.cbu_alias && (
                      <div className="flex items-center gap-1">
                        <p className="text-xs text-kx-text-3 font-mono truncate">
                          {showCbu[c.id] ? c.cbu_alias : '•••• •••• •••• ••••'}
                        </p>
                        <button
                          onClick={() => setShowCbu(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                          className="text-kx-text-3 hover:text-kx-text shrink-0"
                          title={showCbu[c.id] ? 'Ocultar CBU' : 'Mostrar CBU'}
                        >
                          {showCbu[c.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                      </div>
                    )}
                    {c.plan_cuentas ? (
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                        <span className="text-xs text-indigo-600 dark:text-indigo-400">
                          {c.plan_cuentas.codigo} — {c.plan_cuentas.nombre}
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-kx-text-3 italic">Sin cuenta contable vinculada</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm" variant="outline" className="flex-1 text-xs"
                        onClick={() => { setFilterCuentaId(c.id); setActiveTab('movimientos'); }}
                      >
                        <ChevronRight className="w-3 h-3 mr-1" /> Ver movimientos
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCuentaModal({ open: true, cuenta: c })}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="text-kx-red hover:opacity-80"
                        onClick={() => deactivateCuenta.mutate(c.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tab: Movimientos */}
        <TabsContent value="movimientos" className="mt-4 space-y-4">
          {/* Filtros */}
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs">Cuenta</Label>
              <Select value={filterCuentaId} onValueChange={setFilterCuentaId}>
                <SelectTrigger className="w-44 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas las cuentas</SelectItem>
                  {cuentas.map(c => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={filterDesde} onChange={e => setFilterDesde(e.target.value)} className="h-8 text-sm w-36" />
            </div>
            <div>
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={filterHasta} onChange={e => setFilterHasta(e.target.value)} className="h-8 text-sm w-36" />
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={filterTipo} onValueChange={setFilterTipo}>
                <SelectTrigger className="w-32 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="ingreso">Ingresos</SelectItem>
                  <SelectItem value="egreso">Egresos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={() => setMovModal({ open: true, cuentaId: filterCuentaId !== 'todas' ? filterCuentaId : '' })}>
              <Plus className="w-4 h-4 mr-1" /> Movimiento
            </Button>
          </div>

          {/* Tabla */}
          {loadingMovs ? (
            <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-kx-text-3" /></div>
          ) : movimientosTabla.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-kx-text-3">
              <Wallet className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">Sin movimientos</p>
              <p className="text-xs text-center">Registrá un movimiento manual o importá un extracto CSV.</p>
            </div>
          ) : (
            <Card className="dark:border-kx-border">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b dark:border-kx-border bg-slate-50/70 dark:bg-slate-800/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-kx-text-2 uppercase">Fecha</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-kx-text-2 uppercase">Cuenta</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-kx-text-2 uppercase">Detalle · Referencia · Registrado por</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-kx-text-2 uppercase">Tipo</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-kx-text-2 uppercase">Monto</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-kx-text-2 uppercase">Origen</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-kx-text-2 uppercase"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-800">
                    {movimientosTabla.map(m => {
                      const o = origenMeta(m.origen);
                      const ej = ejecutorDe(m);
                      const desc = limpiarDescripcion(m.descripcion);
                      return (
                      <tr key={m.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-kx-text-2 whitespace-nowrap align-top">
                          {formatDateAR(m.fecha)}
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap align-top">
                          {m.cuentas_bancarias?.nombre ?? '—'}
                        </td>
                        {/* Detalle + Referencia (ID copiable) + Ejecutor — jerarquía fintech:
                            descripción arriba, metadatos "silenciosos" debajo */}
                        <td className="px-4 py-3 align-top max-w-sm">
                          <div className="flex flex-col gap-1">
                            <span className="text-kx-text dark:text-kx-text truncate">
                              {desc || <span className="italic text-kx-text-3">Sin descripción</span>}
                            </span>
                            <div className="flex items-center gap-2 flex-wrap">
                              <RefChip mov={m} />
                              <span className="text-kx-text-3 text-2xs">·</span>
                              <span className="inline-flex items-center gap-1 text-2xs text-kx-text-3" title={`Registrado por ${ej.nombre}`}>
                                {ej.sistema ? <Bot className="w-3 h-3 shrink-0" /> : <User className="w-3 h-3 shrink-0" />}
                                <span className="truncate max-w-[150px]">{ej.nombre}</span>
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center align-top">
                          {m.tipo === 'ingreso' ? (
                            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 gap-1">
                              <ArrowUpCircle className="w-3 h-3" /> ingreso
                            </Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 gap-1">
                              <ArrowDownCircle className="w-3 h-3" /> egreso
                            </Badge>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-semibold align-top ${m.tipo === 'ingreso' ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                          {m.tipo === 'egreso' ? '-' : ''}{formatMoney(m.monto)}
                        </td>
                        <td className="px-4 py-3 text-center align-top">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-2xs font-medium whitespace-nowrap ${o.cls}`}>
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: o.dot }} />
                            {o.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                            {m.asiento_id ? (
                              isAdmin ? (
                                <button
                                  onClick={() => revertirMut.mutate(m.id)}
                                  title="Contabilizado — click para revertir el asiento"
                                  className="inline-flex items-center gap-1 text-2xs text-emerald-600 dark:text-emerald-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                                >
                                  <Check className="w-3.5 h-3.5" /> Contabilizado
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-2xs text-emerald-600 dark:text-emerald-400">
                                  <Check className="w-3.5 h-3.5" /> Contabilizado
                                </span>
                              )
                            ) : isAdmin ? (
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 px-2 text-2xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700"
                                onClick={() => contabilizarMut.mutate(m.id)}
                                disabled={contabilizarMut.isPending}
                                title="Generar el asiento contable de este movimiento"
                              >
                                <Scale className="w-3.5 h-3.5 mr-1" /> Contabilizar
                              </Button>
                            ) : null}
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 w-7 p-0 text-kx-red hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                              onClick={() => deleteMov.mutate(m.id)}
                              disabled={!!m.asiento_id}
                              title={m.asiento_id ? 'No se puede eliminar un movimiento contabilizado — revertí la contabilización primero' : 'Eliminar movimiento'}
                            >
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
            </Card>
          )}
        </TabsContent>

        {/* Tab: Conciliación */}
        <TabsContent value="conciliacion" className="mt-4">
          <ConciliacionTab cuentas={cuentas} empresaId={empresaId} userId={user?.id} />
        </TabsContent>

        {/* Tab: Tarjetas pendientes de acreditación */}
        <TabsContent value="tarjetas" className="mt-4">
          <TarjetasPendientesTab empresaId={empresaId} />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <CuentaModal
        open={cuentaModal.open}
        onClose={() => setCuentaModal({ open: false, cuenta: null })}
        cuenta={cuentaModal.cuenta}
        empresaId={empresaId}
      />
      <MovimientoModal
        open={movModal.open}
        onClose={() => setMovModal({ open: false, cuentaId: '' })}
        cuentas={cuentas}
        empresaId={empresaId}
        defaultCuentaId={movModal.cuentaId}
      />
      <ImportCSVModal
        open={csvModal}
        onClose={() => setCsvModal(false)}
        cuentas={cuentas}
        empresaId={empresaId}
      />
    </div>
  );
}

export default CuentasBancariasSection;
