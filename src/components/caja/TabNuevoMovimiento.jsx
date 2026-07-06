import React from 'react';
import { Plus, ArrowUpRight, ArrowDownRight, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { categoriasIngreso, categoriasEgreso } from './shared';

function TabNuevoMovimiento({
  formData,
  handleInputChange,
  handleSubmit,
  loading,
  currentThemeColor,
  currentBorderColor,
}) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className={`kairox-bg-card border kairox-border rounded-xl p-6 shadow-xl transition-all duration-300 dark:bg-kx-bg dark:border-kx-border ${formData.tipo === 'ingreso' ? 'shadow-green-500/10' : 'shadow-red-500/10'}`}>
        <div className="flex items-center justify-between mb-6">
          <h3 className={`text-xl font-bold flex items-center gap-2 ${currentThemeColor}`}><Plus className="w-5 h-5" />Registrar {formData.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-slate-100 dark:bg-kx-surface p-1 rounded-lg border kairox-border flex gap-2">
            <label className={`flex-1 cursor-pointer rounded-md px-4 py-3 flex items-center justify-center gap-2 transition-all duration-200 ${formData.tipo === 'ingreso' ? 'bg-green-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-200 dark:text-kx-text-2 dark:hover:bg-slate-800'}`}>
              <input type="radio" name="tipo" value="ingreso" checked={formData.tipo === 'ingreso'} onChange={handleInputChange} className="hidden"/>
              <ArrowUpRight className="w-5 h-5" /><span className="font-bold">INGRESO</span>
            </label>
            <label className={`flex-1 cursor-pointer rounded-md px-4 py-3 flex items-center justify-center gap-2 transition-all duration-200 ${formData.tipo === 'egreso' ? 'bg-red-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-200 dark:text-kx-text-2 dark:hover:bg-slate-800'}`}>
              <input type="radio" name="tipo" value="egreso" checked={formData.tipo === 'egreso'} onChange={handleInputChange} className="hidden"/>
              <ArrowDownRight className="w-5 h-5" /><span className="font-bold">EGRESO</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className={currentThemeColor}>Monto ($)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-2.5 h-5 w-5 text-slate-500"/>
                <Input type="text" inputMode="decimal" name="monto" value={formData.monto} onChange={handleInputChange} className={`pl-10 h-12 text-xl font-mono font-bold kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text ${currentBorderColor}`} placeholder="0,00" required/>
              </div>
            </div>

            <div className="space-y-2">
               <Label className="dark:text-kx-text">Método de Pago</Label>
               <select name="metodo_pago" value={formData.metodo_pago} onChange={handleInputChange} className={`w-full h-12 rounded-md kairox-input px-3 text-sm focus:outline-none focus:ring-2 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text ${currentBorderColor}`}>
                  <option value="Efectivo">Efectivo</option>
                  <option value="Tarjeta Débito">Tarjeta Débito</option>
                  <option value="Tarjeta Crédito">Tarjeta Crédito</option>
                  <option value="Transferencia">Transferencia</option>
                  <option value="Cheque">Cheque</option>
               </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="dark:text-kx-text">Categoría</Label>
            <select name="categoria" value={formData.categoria} onChange={handleInputChange} className={`w-full h-12 rounded-md kairox-input px-3 text-sm text-slate-700 dark:text-kx-text focus:outline-none focus:ring-2 dark:bg-kx-surface dark:border-kx-border ${currentBorderColor}`}>
              {formData.tipo === 'ingreso'
                ? categoriasIngreso.map(cat => (<option key={cat.value} value={cat.value} disabled={cat.disabled} className={cat.disabled ? 'text-kx-text-3 italic' : ''}>{cat.label}</option>))
                : categoriasEgreso.map(cat => (<option key={cat.value} value={cat.value} disabled={cat.disabled} className={cat.disabled ? 'text-kx-text-3 italic' : ''}>{cat.label}</option>))
              }
            </select>
          </div>

          <div className="space-y-2">
            <Label className="dark:text-kx-text">Concepto / Descripción</Label>
            <Input name="concepto" value={formData.concepto} onChange={handleInputChange} className={`h-12 kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text ${currentBorderColor}`} required/>
          </div>

          <div className="pt-4">
            <Button type="submit" disabled={loading} className={`w-full h-14 text-lg font-bold shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] ${formData.tipo === 'ingreso' ? 'bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600' : 'bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600'}`}>
              {loading ? 'Guardando...' : `REGISTRAR ${formData.tipo === 'ingreso' ? 'INGRESO' : 'EGRESO'}`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TabNuevoMovimiento;
