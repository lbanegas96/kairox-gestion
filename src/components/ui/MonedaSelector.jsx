import { useState, useEffect } from 'react';
import { MONEDAS, isMonedaExtranjera, parseNumberLocale } from '@/lib/currencyUtils';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { tipoCambioService } from '@/services/tipoCambioService';
import { TipoCambioModal } from '@/components/ui/TipoCambioModal';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Selector de moneda con tipo de cambio del día centralizado.
 *
 * Comportamiento:
 *   - Al seleccionar una moneda extranjera, consulta automáticamente si hay TC
 *     registrado para hoy.
 *   - Si existe: auto-rellena la tasa y muestra badge verde "TC del día: $X".
 *   - Si no existe: abre el modal TipoCambioModal para que el usuario lo cargue
 *     una sola vez. Muestra badge naranja de advertencia.
 *   - El padre recibe `onTCMissingChange(bool)` para poder bloquear el submit.
 *
 * Props:
 *   moneda           — string ('ARS', 'USD', ...)
 *   tasa             — number (1 si ARS)
 *   onMonedaChange   — fn(string)
 *   onTasaChange     — fn(number)
 *   onTCMissingChange— fn(bool) — true cuando no hay TC del día para la moneda
 *   disabled         — bool
 *   labelMoneda      — string (label override)
 */
export function MonedaSelector({
  moneda = 'ARS',
  tasa = 1,
  onMonedaChange,
  onTasaChange,
  onTCMissingChange,
  disabled = false,
  labelMoneda = 'Moneda',
}) {
  const { user } = useAuth();
  const [tcLoading, setTcLoading] = useState(false);
  const [tcStatus, setTcStatus] = useState(null); // null | 'ok' | 'missing'
  const [showTCModal, setShowTCModal] = useState(false);

  const extranjera = isMonedaExtranjera(moneda);

  // Al cambiar la moneda (o al montar con moneda extranjera), consulta el TC del día
  useEffect(() => {
    if (!extranjera) {
      setTcStatus(null);
      onTCMissingChange?.(false);
      return;
    }
    if (!user?.empresa_id) return;

    const fetchTC = async () => {
      setTcLoading(true);
      try {
        const rate = await tipoCambioService.getToday(user.empresa_id, moneda);
        if (rate !== null) {
          onTasaChange?.(rate);
          setTcStatus('ok');
          onTCMissingChange?.(false);
        } else {
          setTcStatus('missing');
          onTCMissingChange?.(true);
          setShowTCModal(true); // Abre el modal automáticamente
        }
      } catch (err) {
        console.error('[TC] Error consultando tipo de cambio:', err);
        setTcStatus('missing');
        onTCMissingChange?.(true);
      } finally {
        setTcLoading(false);
      }
    };

    fetchTC();
  }, [moneda, extranjera, user?.empresa_id]);

  const handleMonedaChange = (v) => {
    onMonedaChange?.(v);
    if (!isMonedaExtranjera(v)) {
      onTasaChange?.(1);
      setTcStatus(null);
      onTCMissingChange?.(false);
    }
  };

  // Llamado por TipoCambioModal después de guardar exitosamente
  const handleTCConfirm = (newTasa) => {
    onTasaChange?.(newTasa);
    setTcStatus('ok');
    onTCMissingChange?.(false);
    setShowTCModal(false);
  };

  // Estado local para permitir tipear comas/puntos sin que el input number las rechace
  const [tasaInput, setTasaInput] = useState('');
  useEffect(() => {
    // Sincroniza el input local cuando la tasa cambia desde afuera (ej. fetch del TC)
    setTasaInput(tasa ? String(tasa) : '');
  }, [tasa]);

  // Si el usuario edita manualmente la tasa, la validamos
  const handleTasaManual = (e) => {
    // Permitir solo dígitos, coma y punto
    const raw = e.target.value.replace(/[^\d.,]/g, '');
    setTasaInput(raw);
    const v = parseNumberLocale(raw);
    onTasaChange?.(isNaN(v) ? 1 : v);
    if (v > 0) {
      setTcStatus('ok');
      onTCMissingChange?.(false);
    }
  };

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex gap-3 items-end">
          {/* Selector de moneda */}
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground mb-1 block">{labelMoneda}</Label>
            <Select value={moneda} onValueChange={handleMonedaChange} disabled={disabled}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONEDAS.map(m => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Campo de tasa (solo si moneda extranjera) */}
          {extranjera && (
            <div className="w-44">
              <Label className="text-xs text-muted-foreground mb-1 block">
                1 {moneda} = ? ARS
              </Label>
              {tcLoading ? (
                <div className="h-9 flex items-center gap-2 px-3 border rounded-md border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-kx-text-2" />
                  <span className="text-xs text-kx-text-2">Consultando TC…</span>
                </div>
              ) : (
                <Input
                  type="text"
                  inputMode="decimal"
                  value={tasaInput}
                  onChange={handleTasaManual}
                  disabled={disabled}
                  className="h-9"
                  placeholder="ej. 1.250,50"
                />
              )}
            </div>
          )}
        </div>

        {/* Feedback de estado del TC */}
        {extranjera && !tcLoading && tcStatus === 'ok' && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
            TC del día: 1 {moneda} = ${Number(tasa).toLocaleString('es-AR')} ARS
          </div>
        )}
        {extranjera && !tcLoading && tcStatus === 'missing' && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              Sin TC del día — requerido para operar en {moneda}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 text-xs px-2 py-0 border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
              onClick={() => setShowTCModal(true)}
            >
              Cargar ahora
            </Button>
          </div>
        )}
      </div>

      <TipoCambioModal
        open={showTCModal}
        onOpenChange={setShowTCModal}
        moneda={moneda}
        onConfirm={handleTCConfirm}
      />
    </>
  );
}
