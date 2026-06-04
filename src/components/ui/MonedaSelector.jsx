import { MONEDAS, isMonedaExtranjera } from '@/lib/currencyUtils';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * Selector de moneda + campo de tasa de cambio condicional.
 * Props:
 *   moneda: string            — valor actual ('ARS', 'USD', etc.)
 *   tasa: number              — tasa de cambio actual (1 si ARS)
 *   onMonedaChange: fn        — callback cuando cambia la moneda
 *   onTasaChange: fn          — callback cuando cambia la tasa
 *   disabled: bool            — deshabilitar todo el bloque
 *   labelMoneda: string       — label override para el selector
 */
export function MonedaSelector({
  moneda = 'ARS',
  tasa = 1,
  onMonedaChange,
  onTasaChange,
  disabled = false,
  labelMoneda = 'Moneda',
}) {
  const extranjera = isMonedaExtranjera(moneda);

  return (
    <div className="flex gap-3 items-end">
      <div className="flex-1">
        <Label className="text-xs text-muted-foreground mb-1 block">{labelMoneda}</Label>
        <Select
          value={moneda}
          onValueChange={onMonedaChange}
          disabled={disabled}
        >
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

      {extranjera && (
        <div className="w-36">
          <Label className="text-xs text-muted-foreground mb-1 block">
            Tasa (1 {moneda} = ? ARS)
          </Label>
          <Input
            type="number"
            min="0.0001"
            step="0.01"
            value={tasa}
            onChange={e => onTasaChange?.(parseFloat(e.target.value) || 1)}
            disabled={disabled}
            className="h-9"
            placeholder="ej. 1250"
          />
        </div>
      )}
    </div>
  );
}
