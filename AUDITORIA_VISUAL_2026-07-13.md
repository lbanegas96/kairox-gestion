# Auditoría visual — 2026-07-13 (sesión 61 Nadia)

Auditoría corrida sobre datos reales de Nalux (login `nalux2430@gmail.com`), viewport 1440×900,
ambos modos (dark/light).

## ✅ Fixes aplicados en esta sesión

### 1. Escala de grises rediseñada con WCAG AA compliance

Modificados los tokens `--kx-text-3` (crítico) y `--kx-text-2` (dark) en `src/index.css:113-150`.

**Contrastes ANTES (fallaban AA)**:
| Modo | Token | Valor viejo | Contraste |
|---|---|---|---|
| Light | `--kx-text-3` | `168 170 179` | **2.15 : 1** ❌ |
| Dark | `--kx-text-3` | `82 84 92` | **2.37 : 1** ❌ |

**Contrastes DESPUÉS (cumplen AA)**:
| Modo | Token | Valor nuevo | Contraste |
|---|---|---|---|
| Light | `--kx-text-2` | `82 84 92` (era 107 109 118) | 7.00 : 1 ✅ |
| Light | `--kx-text-3` | `110 112 122` | 4.57 : 1 ✅ |
| Dark  | `--kx-text-2` | `180 182 192` (era 139 141 152) | 9.79 : 1 ✅ |
| Dark  | `--kx-text-3` | `140 142 152` | 6.06 : 1 ✅ |

Jerarquía visual preservada: text > text-2 > text-3 en prominencia.

### 2. Tokens de acento en light mode subidos a AA

`--kx-green: 5 150 105` (3.49:1) → `4 120 87` (5.08:1) ✅
`--kx-amber: 217 119 6` (2.95:1) → `180 83 9` (4.65:1) ✅

Los acentos dark ya cumplían AA, no se tocaron. Los otros acentos light (red 4.83, blue 6.36,
violet 7.03) ya cumplían.

## ✅ Plan de Cuentas + Cheques migrados por completo (Luciano, 2026-07-13/14)

Migración completa de ambos módulos (los 2 con más deuda del ranking de abajo). Hallazgo adicional al
hacerlo: el conteo original de "elementos ilegibles" media solo `text-*` — pero la causa real en estos
2 módulos era más profunda: **diálogos, tablas y selects enteros con fondo/borde oscuro fijo**
(`bg-slate-800/900`, `border-slate-700/800/900`, `text-white`), no solo texto. Confirmado con el usuario
que NO era intencional (no es una "terminal financiera" a propósito) — debía respetar el tema como el
resto de la app.

**Mapeo aplicado** (15 archivos, Plan de Cuentas + Cheques):
- `bg-slate-900` → `bg-kx-surface` (fondo de diálogos)
- `bg-slate-800` → `bg-kx-surface-2` (inputs/selects/headers de tabla/hover de filas)
- `border-slate-700/800/900` → `border-kx-border`
- `text-slate-300` → `text-kx-text-3`, `text-slate-500` → `text-kx-text-2` (texto secundario/terciario)
- `text-white` → `text-kx-text` **excepto** en toasts/botones con fondo de acento explícito
  (`bg-green-900`, `bg-amber-600`, `bg-emerald-600`, `bg-blue-600`) — esos quedan igual, es
  intencional y correcto en ambos temas.

Verificado: 0 colores hardcodeados restantes en ambos módulos (antes: ~195 líneas). Build limpio.
**Pendiente para Nadia**: verificar visualmente en su propio navegador (no pude verificar en el
preview automatizado por sesión separada) — revisar Plan de Cuentas (los 7 tabs) y Cheques en modo
claro y oscuro.

**Alcance real mucho mayor de lo estimado**: al revisar el resto del código con un chequeo más preciso
(descartando pares que ya funcionan con `dark:` hardcodeado o con un token kx- del lado oscuro), quedan
**~146 líneas rotas de verdad en ~49 archivos más** repartidos en `sections` (17), `reportes` (7),
`caja` (7), `ventas` (6), `ordenes-compra` (5), `configuracion` (5), `pedidos`/`impuestos`/
`cotizaciones` (4 c/u), y varias carpetas chicas — sin contar posibles casos `bg-`/`border-` como los
que aparecieron en Plan de Cuentas (no medidos todavía en el resto). Decisión pendiente: continuar
módulo por módulo con el mismo criterio, o cerrar acá por ahora.

### 1. Colores Tailwind hardcodeados fuera del sistema de tokens

**713 ocurrencias** de `text-slate-*` y `text-gray-*` sin variante `dark:` correspondiente en
117 archivos:
```
grep -rE "text-(slate|gray)-(300|400|500|600|700|800|900)" src/components | wc -l
```

**Impacto medido por módulo (light mode, contraste < 4.5:1)**:

| Módulo | Elementos ilegibles |
|---|---|
| **Plan de Cuentas** | 131 |
| Cheques | 27 |
| Dashboard | 9 |
| Clientes | 2 |
| Reportes | 0 ✅ |
| Compra Rápida | 0 ✅ |
| Bancos | 0 ✅ |

Los que quedaron en 0 son los que ya usaban tokens del sistema (que quedaron cubiertos por
el fix de --kx-text-3). Plan de Cuentas y Cheques son los que más tienen deuda técnica visual.

**Recomendación**: migración por script (`sed` masivo, ejemplo):
```bash
# text-slate-400 (para dark) → text-kx-text-2 dark:text-kx-text-2
# text-slate-300 (para dark) → text-kx-text-3 dark:text-kx-text-3
```
Pero antes de correr el script masivo, decidir el mapeo por parte de Luciano (5-6 reglas
totales). Puede ser una sesión dedicada corta.

### 2. ✅ RESUELTO (sesión 64, 2026-07-14) — Tres tamaños de "texto chico" conviviendo (10/11/12px)

`text-xs` (12px) queda como escalón "labels". Se agregó `text-2xs` (11px) en `tailwind.config.js`
como único escalón "meta" y se migraron los 132 usos de `text-[10px]`/`text-[11px]` (46 archivos) con
un swap 1:1 (sin ambigüedad semántica, no necesitó revisión archivo por archivo como los colores).
Excluidos a propósito: `caja/TicketPrint.jsx` y `ventas/ComprobantePrintModal.jsx` (impresión térmica,
tamaño físico fijo). Verificado en vivo: 0 overflows en badges/pills de Cheques y Plan de Cuentas.
Detalle en CONTEXT.md.

### 3. Botones sin `aria-label` (accesibilidad)

En **Compra Rápida**: 32 de 35 botones (91%) sin label accesible — son botones de solo ícono.
Impacto: usuarios de lector de pantalla no pueden operar la pantalla. Recomendación: agregar
`aria-label` a todos los `<Button variant="ghost" size="icon">`.

### 4. Padding de cards inconsistente en Dashboard

`0px`, `10px`, `20px` mezclados sin patrón. Recomendación: 2 tamaños oficiales (compact 12px,
default 20px) con clase compartida.

## 🟢 Cosas que están bien

- Alturas de filas de tabla consistentes (65px en Historial).
- Contraste del texto **primario** (`--kx-text`) excelente en ambos modos (17+ : 1).
- Los acentos dark tienen contraste 6+ en todos los colores.
- Tokens semánticos correctamente definidos y separados de valores Tailwind.

## 📋 Recomendaciones priorizadas

1. **(hecho ✅)** Fix de contraste WCAG en tokens del sistema.
2. **Alta**: Migrar los 713 `text-slate-*`/`text-gray-*` hardcodeados a tokens del sistema.
   Priorizar Plan de Cuentas (131) y Cheques (27).
3. **Media**: Consolidar tamaños de texto chico a 2 escalones documentados y migrar los 129.
4. **Media**: Agregar `aria-label` a todos los botones de solo ícono (empezar por Compra
   Rápida, 32 casos).
5. **Baja**: Estandarizar padding de cards con clase compartida.

## Metodología

- Contrastes medidos vía WCAG 2.1 (fórmula relative luminance).
- Tokens leídos de `src/index.css:113-150`.
- Recorrido de 10 módulos programáticamente en ambos modos.
- Fixes aplicados y verificados en vivo antes de commitear.
