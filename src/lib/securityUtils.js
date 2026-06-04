/**
 * securityUtils.js — Utilidades de seguridad del lado cliente
 * - Sanitización de inputs
 * - Validación robusta de contraseñas
 * - Logger condicional (solo en DEV)
 */

const IS_DEV = import.meta.env.DEV;

// ─── Logger seguro ────────────────────────────────────────────────────────────
// En producción, todos los logs se suprimen para no exponer datos sensibles.
// En desarrollo, se comporta igual que console.
export const logger = {
  log:   (...args) => { if (IS_DEV) console.log(...args); },
  warn:  (...args) => { if (IS_DEV) console.warn(...args); },
  error: (...args) => { if (IS_DEV) console.error(...args); },
  info:  (...args) => { if (IS_DEV) console.info(...args); },
};

// ─── Sanitización de inputs ───────────────────────────────────────────────────

/**
 * Elimina caracteres HTML peligrosos de un string.
 * Úsalo antes de mostrar cualquier dato proveniente del usuario en innerHTML.
 */
export function sanitizeInput(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Limpia un string para uso en contextos de texto plano (formularios, DB).
 * Recorta espacios y limita longitud.
 */
export function sanitizeText(str, maxLength = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength);
}

/**
 * Sanitiza un número: devuelve el número parseado o null si no es válido.
 */
export function sanitizeNumber(val, { min, max } = {}) {
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  if (min !== undefined && n < min) return null;
  if (max !== undefined && n > max) return null;
  return n;
}

// ─── Validación de contraseña robusta ─────────────────────────────────────────

const PASSWORD_RULES = [
  { test: (p) => p.length >= 12,        message: 'Al menos 12 caracteres' },
  { test: (p) => /[A-Z]/.test(p),       message: 'Al menos una mayúscula' },
  { test: (p) => /[a-z]/.test(p),       message: 'Al menos una minúscula' },
  { test: (p) => /[0-9]/.test(p),       message: 'Al menos un número' },
  { test: (p) => /[^A-Za-z0-9]/.test(p), message: 'Al menos un carácter especial (!@#$%...)' },
];

/**
 * Valida la fortaleza de una contraseña.
 * @returns { valid: boolean, errors: string[], strength: 'weak'|'medium'|'strong' }
 */
export function validatePasswordStrength(password) {
  if (!password) return { valid: false, errors: ['La contraseña es requerida'], strength: 'weak' };

  const errors = PASSWORD_RULES
    .filter(rule => !rule.test(password))
    .map(rule => rule.message);

  const passed = PASSWORD_RULES.length - errors.length;
  const strength = passed <= 2 ? 'weak' : passed <= 4 ? 'medium' : 'strong';

  return { valid: errors.length === 0, errors, strength };
}

// ─── Mensajes de error seguros ────────────────────────────────────────────────

/**
 * Convierte un error de Supabase/API en un mensaje amigable para el usuario.
 * Nunca expone detalles internos (nombres de tabla, constraints, etc.).
 */
export function safeErrorMessage(error) {
  if (!error) return 'Ocurrió un error inesperado.';

  const msg = (error.message || error.toString()).toLowerCase();

  // Errores de autenticación conocidos
  if (msg.includes('invalid login credentials')) return 'Credenciales inválidas.';
  if (msg.includes('email not confirmed'))       return 'El email no está confirmado.';
  if (msg.includes('user not found'))            return 'Usuario no encontrado.';
  if (msg.includes('email already registered'))  return 'El email ya está registrado.';

  // Errores de permisos
  if (msg.includes('permission denied') || msg.includes('403') || msg.includes('rls'))
    return 'No tenés permiso para realizar esta acción.';

  // Errores de red
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout'))
    return 'Error de conexión. Verificá tu internet e intentá de nuevo.';

  // Errores de duplicados
  if (msg.includes('duplicate') || msg.includes('unique'))
    return 'Ya existe un registro con esos datos.';

  // Genérico — no filtrar detalles al usuario final
  return 'Ocurrió un error. Por favor intentá de nuevo.';
}
