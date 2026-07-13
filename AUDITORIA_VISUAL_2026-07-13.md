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

## ⚠️ Hallazgos que quedan (para Luciano decidir)

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

### 2. Tres tamaños de "texto chico" conviviendo (10/11/12px)

**129 ocurrencias** de tamaños hardcodeados en 48 archivos:
```
grep -rE "text-\[10px\]|text-\[11px\]" src/components | wc -l
```

No hay regla de cuándo se usa cada uno. Recomendación: definir 2 escalones oficiales
(por ejemplo, `.text-xs` = 12px para labels, un `.text-xxs` = 11px para meta) y grep+migrar.

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
