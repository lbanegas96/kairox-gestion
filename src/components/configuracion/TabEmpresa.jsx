import {
  Building, Mail, MapPin, Hash, Upload, Loader2, Trash2, AlertCircle,
  Image as ImageIcon, Save,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatCuit } from '@/lib/cuitUtils';

/**
 * Tab "Empresa" de ConfiguracionSection — identidad y datos de contacto + logo +
 * CUIT/condición IVA, con vista previa. Extraído de ConfiguracionSection.jsx
 * (Fase C auditoría de código). Componente presentacional: estado (formData,
 * saving, uploading), handlers y fileInputRef vienen por props desde el padre.
 */
const TabEmpresa = ({
  formData, setFormData, saving, uploading, fileInputRef,
  handleSave, handleChange, handleFileSelect, handleRemoveLogo,
}) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
    {/* Formulario */}
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
      <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text mb-6 border-b kairox-border pb-2">
        Identidad y Datos de Contacto
      </h3>
      <form onSubmit={handleSave} className="space-y-5">
        <div className="space-y-2">
          <Label className="text-slate-700 dark:text-slate-300">Nombre de la Empresa</Label>
          <div className="relative">
            <Building className="absolute left-3 top-2.5 h-5 w-5 text-kx-text-3" />
            <Input name="nombre_empresa" value={formData.nombre_empresa} onChange={handleChange} placeholder="Ej. Mi Empresa S.A." className="pl-10 kairox-input" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-700 dark:text-slate-300">Email de contacto</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-kx-text-3" />
              <Input name="email_empresa" value={formData.email_empresa} onChange={handleChange} placeholder="info@empresa.com" className="pl-9 kairox-input" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-700 dark:text-slate-300">Rubro / Actividad</Label>
            <Input name="rubro" value={formData.rubro} onChange={handleChange} placeholder="Ej. Comercio al por menor" className="kairox-input" />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-700 dark:text-slate-300">Dirección</Label>
          <div className="relative">
            <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-kx-text-3" />
            <Input name="direccion" value={formData.direccion} onChange={handleChange} placeholder="Av. Corrientes 1234" className="pl-9 kairox-input" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2 col-span-2">
            <Label className="text-slate-700 dark:text-slate-300">Localidad</Label>
            <Input name="localidad" value={formData.localidad} onChange={handleChange} placeholder="Buenos Aires" className="kairox-input" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-700 dark:text-slate-300">CP</Label>
            <div className="relative">
              <Hash className="absolute left-3 top-2.5 h-4 w-4 text-kx-text-3" />
              <Input name="cp" value={formData.cp} onChange={handleChange} placeholder="1000" className="pl-9 kairox-input" />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-700 dark:text-slate-300">Provincia</Label>
          <Input name="provincia" value={formData.provincia} onChange={handleChange} placeholder="Buenos Aires" className="kairox-input" />
        </div>

        {/* CUIT — editable, escribe directo a empresas.afip_cuit */}
        <div className="space-y-2">
          <Label className="text-slate-700 dark:text-slate-300">CUIT</Label>
          <Input
            name="afip_cuit"
            value={formData.afip_cuit}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 11);
              setFormData(prev => ({ ...prev, afip_cuit: digits.length === 11 ? formatCuit(digits) : digits }));
            }}
            placeholder="XX-XXXXXXXX-X"
            inputMode="numeric"
            className="kairox-input"
          />
          {formData.afip_cuit && formData.afip_cuit.replace(/\D/g, '').length !== 11 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">El CUIT debe tener 11 dígitos.</p>
          )}
        </div>

        {/* Condición frente al IVA — editable, escribe directo a empresas.condicion_iva */}
        <div className="space-y-2">
          <Label className="text-slate-700 dark:text-slate-300">Condición frente al IVA</Label>
          <select
            name="condicion_iva"
            value={formData.condicion_iva}
            onChange={(e) => setFormData(prev => ({ ...prev, condicion_iva: e.target.value }))}
            className="w-full h-10 rounded-md border border-kx-border bg-kx-surface dark:bg-kx-surface px-3 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Sin especificar —</option>
            <option value="RI">Responsable Inscripto</option>
            <option value="Monotributo">Monotributista</option>
            <option value="Exento">Exento</option>
            <option value="CF">Consumidor Final</option>
          </select>
          <p className="text-[11px] text-kx-text-3">Se usa en certificados de retención y facturas. Si activás AFIP, se usa el mismo dato.</p>
        </div>

        {/* Logo */}
        <div className="space-y-2">
          <Label className="text-slate-700 dark:text-slate-300">Logo de la Empresa</Label>
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept=".png,.jpg,.jpeg,.svg,.webp" className="hidden" />
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="w-full border-dashed border-2 border-slate-300 dark:border-kx-border hover:border-blue-500 dark:hover:border-[#00D4FF] hover:bg-kx-surface-2">
              {uploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Subiendo...</> : <><Upload className="w-4 h-4 mr-2" /> Subir Logo</>}
            </Button>
            {formData.company_logo && (
              <Button type="button" variant="destructive" onClick={handleRemoveLogo} disabled={uploading}
                className="bg-red-100 text-red-600 hover:bg-red-200 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50">
                <Trash2 className="w-4 h-4 mr-2" /> Eliminar
              </Button>
            )}
          </div>
          <div className="flex items-start gap-2 text-xs text-slate-500 bg-kx-surface-2 dark:bg-slate-900/50 p-3 rounded border kairox-border">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <div>Formatos: PNG, JPG, SVG, WEBP.<br />Tamaño máximo: 2MB.<br />El logo se guarda directamente en la base de datos.</div>
          </div>
        </div>

        <div className="pt-2">
          <Button type="submit" disabled={saving || uploading}
            className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-[#00D4FF] dark:hover:bg-[#00D4FF]/90 text-white dark:text-black font-bold shadow-lg">
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar Datos de Empresa</>}
          </Button>
        </div>
      </form>
    </div>

    {/* Vista previa */}
    <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm flex flex-col items-center justify-center text-center space-y-6 bg-kx-surface-2 dark:bg-slate-900/50">
      <div className="w-full max-w-sm p-6 bg-kx-surface dark:bg-kx-surface rounded-lg border kairox-border shadow-md">
        <p className="text-xs font-bold text-kx-text-3 uppercase tracking-widest mb-4">Vista Previa</p>
        <div className="flex flex-col items-center gap-4">
          {formData.company_logo ? (
            <div className="h-32 flex items-center justify-center p-2 border border-dashed border-kx-border dark:border-kx-border rounded-lg w-full bg-slate-50/50 dark:bg-slate-950/50">
              <img src={formData.company_logo} alt="Logo Preview" className="max-h-full max-w-[200px] object-contain" />
            </div>
          ) : (
            <div className="h-32 w-full bg-slate-100 dark:bg-kx-surface-2 rounded-lg flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-kx-border">
              <ImageIcon className="h-10 w-10 text-kx-text-3 mb-2" />
              <span className="text-xs text-slate-500">Sin logo configurado</span>
            </div>
          )}
          <div className="w-full">
            <h4 className="text-xl font-bold bg-gradient-to-r from-[#00D4FF] to-[#A855F7] bg-clip-text text-transparent break-words">
              {formData.nombre_empresa || 'Nombre de Empresa'}
            </h4>
            {(formData.localidad || formData.provincia) && (
              <p className="text-xs text-slate-500 mt-1">
                {[formData.localidad, formData.provincia].filter(Boolean).join(', ')}
              </p>
            )}
            {formData.email_empresa && <p className="text-xs text-slate-400 mt-0.5">{formData.email_empresa}</p>}
            <p className="text-xs text-slate-500 mt-2">Así se verá en la pantalla de inicio</p>
          </div>
        </div>
      </div>
      <p className="text-sm text-slate-500 max-w-xs">Los cambios se aplicarán inmediatamente para todos los usuarios.</p>
    </div>
  </div>
);

export default TabEmpresa;
