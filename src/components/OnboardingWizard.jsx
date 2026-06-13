import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Check, ChevronRight, Package, Store, Rocket, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { parseNumberLocale } from '@/lib/currencyUtils';

const RUBROS = [
  'Ferretería',
  'Distribuidora / Mayorista',
  'Almacén / Minimercado',
  'Corralón / Materiales',
  'Indumentaria / Textil',
  'Electrónica / Tecnología',
  'Farmacia / Perfumería',
  'Librería / Bazar',
  'Servicios / Otro',
];

export function OnboardingWizard({ open, onComplete }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [empresaForm, setEmpresaForm] = useState({
    nombre: '',
    cuit: '',
    rubro: '',
    telefono: '',
    direccion: '',
  });

  const [productoForm, setProductoForm] = useState({
    nombre: '',
    precio_venta: '',
    stock_actual: '',
    codigo_sku: '',
  });

  useEffect(() => {
    if (!open || !user?.empresa_id) return;
    supabase
      .from('empresas')
      .select('nombre, cuit, rubro, telefono, direccion, onboarding_paso')
      .eq('id', user.empresa_id)
      .single()
      .then(({ data }) => {
        if (data) {
          setEmpresaForm({
            nombre: data.nombre ?? '',
            cuit: data.cuit ?? '',
            rubro: data.rubro ?? '',
            telefono: data.telefono ?? '',
            direccion: data.direccion ?? '',
          });
          if (data.onboarding_paso > 0 && data.onboarding_paso < 3) {
            setStep(data.onboarding_paso + 1);
          }
        }
      });
  }, [open, user?.empresa_id]);

  const handleGuardarEmpresa = async () => {
    if (!empresaForm.nombre || !empresaForm.rubro) {
      toast({ title: 'Completá los campos obligatorios', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('empresas')
        .update({
          nombre:          empresaForm.nombre,
          cuit:            empresaForm.cuit.replace(/-/g, ''),
          rubro:           empresaForm.rubro,
          telefono:        empresaForm.telefono,
          direccion:       empresaForm.direccion,
          onboarding_paso: 1,
        })
        .eq('id', user.empresa_id);
      if (error) throw error;
      setStep(2);
    } catch (err) {
      toast({ title: 'Error al guardar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleGuardarProducto = async () => {
    if (!productoForm.nombre || !productoForm.precio_venta) {
      toast({ title: 'Completá nombre y precio', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('productos')
        .insert([{
          empresa_id:   user.empresa_id,
          user_id:      user.id,
          nombre:       productoForm.nombre,
          codigo_sku:   productoForm.codigo_sku || 'SKU-001',
          precio_venta: parseNumberLocale(productoForm.precio_venta),
          stock_actual: parseInt(productoForm.stock_actual) || 0,
          stock_minimo: 0,
          activo:       true,
        }]);
      if (error) throw error;
      await supabase
        .from('empresas')
        .update({ onboarding_paso: 2 })
        .eq('id', user.empresa_id);
      setStep(3);
    } catch (err) {
      toast({ title: 'Error al guardar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaltearProducto = async () => {
    await supabase
      .from('empresas')
      .update({ onboarding_paso: 2 })
      .eq('id', user.empresa_id);
    setStep(3);
  };

  const handleCompletar = async () => {
    setSaving(true);
    try {
      await supabase
        .from('empresas')
        .update({ onboarding_completado: true, onboarding_paso: 3 })
        .eq('id', user.empresa_id);
      onComplete?.();
    } catch (err) {
      console.error('[Onboarding] Error al completar:', err);
      onComplete?.();
    } finally {
      setSaving(false);
    }
  };

  const skuPlaceholder = empresaForm.rubro === 'Ferretería'
    ? 'Ej: TOR-0025'
    : productoForm.nombre
      ? productoForm.nombre.slice(0, 4).toUpperCase() + '-001'
      : 'SKU-001';

  const nombreProductoPlaceholder =
    empresaForm.rubro === 'Ferretería'    ? 'Ej: Tornillo 1/4" punta aguja' :
    empresaForm.rubro === 'Distribuidora / Mayorista' ? 'Ej: Caja x12 aceite 900ml' :
    empresaForm.rubro === 'Almacén / Minimercado' ? 'Ej: Leche entera 1L' :
    empresaForm.rubro === 'Indumentaria / Textil' ? 'Ej: Remera algodón talle M' :
    empresaForm.rubro === 'Electrónica / Tecnología' ? 'Ej: Cable USB-C 1m' :
    'Nombre del producto';

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        hideCloseButton
        className="max-w-lg dark:bg-kx-bg dark:border-kx-border overflow-y-auto max-h-[90vh]"
      >
        {/* Stepper */}
        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3].map(s => (
            <React.Fragment key={s}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors flex-shrink-0
                ${step > s  ? 'bg-green-600 text-white'
                  : step === s ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-kx-surface-2 text-kx-text-3'
                }`}>
                {step > s ? <Check className="w-4 h-4" /> : s}
              </div>
              {s < 3 && (
                <div className={`flex-1 h-0.5 transition-colors
                  ${step > s ? 'bg-green-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* ── PASO 1: Datos empresa ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                <Store className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold dark:text-kx-text">Bienvenido a KAIROX</h2>
                <p className="text-sm text-slate-500">Contanos un poco sobre tu negocio</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label>Nombre del negocio <span className="text-red-500">*</span></Label>
                <Input
                  value={empresaForm.nombre}
                  onChange={e => setEmpresaForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: Ferretería San Martín"
                  className="mt-1"
                  autoFocus
                />
              </div>

              <div>
                <Label>Rubro <span className="text-red-500">*</span></Label>
                <Select
                  value={empresaForm.rubro}
                  onValueChange={v => setEmpresaForm(f => ({ ...f, rubro: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccioná tu rubro" />
                  </SelectTrigger>
                  <SelectContent>
                    {RUBROS.map(r => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>CUIT <span className="text-kx-text-3 text-xs">(opcional)</span></Label>
                <Input
                  value={empresaForm.cuit}
                  onChange={e => setEmpresaForm(f => ({ ...f, cuit: e.target.value }))}
                  placeholder="20-12345678-9"
                  className="mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Teléfono <span className="text-kx-text-3 text-xs">(opcional)</span></Label>
                  <Input
                    value={empresaForm.telefono}
                    onChange={e => setEmpresaForm(f => ({ ...f, telefono: e.target.value }))}
                    placeholder="351 000-0000"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Ciudad <span className="text-kx-text-3 text-xs">(opcional)</span></Label>
                  <Input
                    value={empresaForm.direccion}
                    onChange={e => setEmpresaForm(f => ({ ...f, direccion: e.target.value }))}
                    placeholder="Córdoba"
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            <Button
              onClick={handleGuardarEmpresa}
              disabled={saving || !empresaForm.nombre || !empresaForm.rubro}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2 mt-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
              Continuar
            </Button>
          </div>
        )}

        {/* ── PASO 2: Primer producto ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                <Package className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold dark:text-kx-text">Cargá tu primer producto</h2>
                <p className="text-sm text-slate-500">Necesitás al menos uno para poder vender</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label>Nombre del producto <span className="text-red-500">*</span></Label>
                <Input
                  value={productoForm.nombre}
                  onChange={e => setProductoForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder={nombreProductoPlaceholder}
                  className="mt-1"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Precio de venta <span className="text-red-500">*</span></Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={productoForm.precio_venta}
                    onChange={e => setProductoForm(f => ({ ...f, precio_venta: e.target.value }))}
                    placeholder="0,00"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Stock inicial</Label>
                  <Input
                    type="number"
                    min="0"
                    value={productoForm.stock_actual}
                    onChange={e => setProductoForm(f => ({ ...f, stock_actual: e.target.value }))}
                    placeholder="0"
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <Label>Código / SKU <span className="text-kx-text-3 text-xs">(opcional)</span></Label>
                <Input
                  value={productoForm.codigo_sku}
                  onChange={e => setProductoForm(f => ({ ...f, codigo_sku: e.target.value }))}
                  placeholder={skuPlaceholder}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-2">
              <Button
                variant="ghost"
                onClick={handleSaltearProducto}
                className="flex-1 text-slate-500"
                disabled={saving}
              >
                Cargar después
              </Button>
              <Button
                onClick={handleGuardarProducto}
                disabled={saving || !productoForm.nombre || !productoForm.precio_venta}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                Continuar
              </Button>
            </div>
          </div>
        )}

        {/* ── PASO 3: ¡Listo! ── */}
        {step === 3 && (
          <div className="text-center space-y-5 py-4">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
              <Rocket className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold dark:text-kx-text mb-1">
                ¡{empresaForm.nombre || 'Tu negocio'} está listo!
              </h2>
              <p className="text-slate-500 text-sm">
                Podés empezar a vender ahora mismo. Tu sistema ya está configurado.
              </p>
            </div>

            <div className="bg-kx-surface-2 dark:bg-kx-surface rounded-xl p-4 text-left space-y-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">
                ¿Qué podés hacer ahora?
              </p>
              {[
                { icon: '🛒', text: 'Registrar ventas desde el POS' },
                { icon: '📦', text: 'Cargar tu catálogo de productos' },
                { icon: '👥', text: 'Agregar clientes con cuenta corriente' },
                { icon: '📊', text: 'Ver el Dashboard con tus KPIs' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-kx-text-2 dark:text-kx-text-2">
                  <span>{item.icon}</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>

            <Button
              onClick={handleCompletar}
              disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white h-12 text-base font-semibold gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              Ir al sistema
            </Button>
          </div>
        )}

        <p className="text-center text-xs text-kx-text-3 mt-2">
          🎉 Estás en tu período de prueba — acceso completo por 14 días
        </p>
      </DialogContent>
    </Dialog>
  );
}
