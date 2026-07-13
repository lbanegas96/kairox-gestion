# Auditoría visual — primera pasada — 2026-07-13 (sesión 61 Nadia)

Auditoría corrida sobre datos reales de Nalux (login `nalux2430@gmail.com`), viewport 1440×900,
ambos modos (dark/light). El objetivo de esta pasada es **inventariar problemas concretos con
mediciones**, no arreglarlos — las decisiones de diseño quedan para Luciano en frío.

## 🔴 Hallazgos de accesibilidad (WCAG)

### 1. `--kx-text-3` no cumple WCAG AA en ninguno de los 2 modos

Contraste medido del token contra su fondo respectivo:

| Modo | Token actual | Contraste | Mínimo AA (texto ≤17px) | Mínimo AA-large (≥18px) |
|---|---|---|---|---|
| **Dark** (`--kx-bg: 10 10 13`) | `--kx-text-3: 82 84 92` | **2.37 : 1** ❌ | 4.5 : 1 | 3 : 1 |
| **Light** (`--kx-bg: 246 246 248`) | `--kx-text-3: 168 170 179` | **2.15 : 1** ❌ | 4.5 : 1 | 3 : 1 |

**Impacto**: `text-kx-text-3` está usado en labels de tablas, meta-info bajo títulos, hints
("por defecto está oculto..."), fechas relativas ("34 días vencido"). Con este contraste,
literalmente **son texto ilegible** para cualquier usuario con visión imperfecta y en cualquier
pantalla con brillo bajo.

**Fix conservador propuesto** (mantiene jerarquía pero no cumple AAA):
- Dark: subir a `140 142 152` → 6.06 : 1 ✅
- Light: bajar a `100 102 112` → 5.29 : 1 ✅

**Complicación** que hace que Luciano lo revise antes de aplicar: en dark, con estos valores,
`text-3` (contraste 6.06) queda casi igual que el `text-2` actual (`139 141 152` → 5.99). Se
pierde la separación visual entre tokens. La solución correcta es rediseñar toda la escala
(text/text-2/text-3) con jerarquía visual + accesibilidad simultáneas — es un rediseño de tokens,
no un patch.

Archivo: `src/index.css:127` (light) y `src/index.css:143` (dark).

## 🟡 Hallazgos de consistencia

### 2. Tres tamaños distintos para "texto chico" en la misma pantalla

En Dashboard con viewport 1440×900, tokens `.text-xs`, `.text-[10px]`, `.text-[11px]` conviven:
- 10px — 53 elementos
- 11px — 53 elementos
- 12px — 53 elementos

No hay regla de cuándo se usa cada uno. Debería haber máximo 2 escalones de "texto chico"
(por ejemplo: 11px para labels, 12px para meta) documentados.

### 3. Tres colores de texto en la misma tabla (Historial de Ventas)

Tabla de comprobantes, celdas de una misma fila:
- `rgb(203, 213, 225)` — slate-300 hardcodeado
- `rgb(139, 141, 152)` — token `--kx-text-2`
- `rgb(250, 250, 250)` — token `--kx-text`

El slate-300 hardcodeado no viene del sistema de tokens. Grep sugerido para
encontrar los demás:
```
grep -rE "text-slate-(300|400|500)" src/components
```

### 4. Padding de cards inconsistente

En Dashboard, 8 cards visibles tienen padding computado: `0px`, `0px`, `0px`, `20px`, `20px`,
`10px`, `10px`, `10px`. Sin patrón. Recomendación: definir 2 tamaños de card (compact = 12px,
default = 20px) y aplicarlos con clase compartida.

## 🟢 Cosas que están bien

- Alturas de filas de tabla consistentes (65px en todas las de Historial).
- Contraste del texto **primario** (`--kx-text`) excelente en ambos modos (17+ : 1).
- Los acentos de color (verde/rojo/naranja) tienen contraste alto (8-10 : 1).
- Tokens semánticos (`--kx-green`, `--kx-red`, etc.) están bien definidos y usados
  consistentemente.

## Próximos pasos sugeridos (para Luciano)

1. **Rediseñar escala de grises** con jerarquía + accesibilidad. Es una hora de diseño
   colaborativa contigo/tu diseñador, no un fix aislado.
2. **Consolidar tamaños de texto chico** a 2 escalones documentados.
3. **Grep sistemático** de `text-slate-`/`text-gray-` hardcodeados y migrarlos a tokens
   semánticos.
4. **Auditoría segunda pasada** con más módulos (POS, Compras, Cheques, Recepciones, Modales)
   antes de decidir el rediseño de tokens.

## Metodología

- Contrastes medidos vía WCAG 2.1 (fórmula relative luminance en `document.body.backgroundColor`).
- Tokens leídos de `src/index.css:113-150`.
- Recorrido: Dashboard → Historial de Ventas → Impuestos, en ambos modos.
- No se ejecutaron cambios de estilo. Todo es inventario.
