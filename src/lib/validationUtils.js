import { supabase } from '@/lib/customSupabaseClient';
import { validatePasswordStrength } from '@/lib/securityUtils';

/**
 * Verifica si un email ya existe en el sistema (cualquier tenant).
 * Usa RPC SECURITY DEFINER para evitar filtrar datos por RLS.
 */
export const checkEmailExists = async (email) => {
  if (!email) return false;
  try {
    const { data, error } = await supabase.rpc('email_exists_in_system', { p_email: email.toLowerCase().trim() });
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
};

/**
 * Validación de email con regex RFC 5322 simplificado.
 */
export const validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const re = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  return re.test(email.trim()) && email.length <= 254;
};

/**
 * Validación de contraseña robusta.
 * Retorna true/false para compatibilidad con código existente.
 * Usar validatePasswordStrength() para obtener detalle de errores.
 */
export const validatePassword = (password) => {
  return validatePasswordStrength(password).valid;
};

/**
 * Validación de nombre/apellido (solo texto, sin scripts).
 */
export const validateName = (name) => {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 100) return false;
  // No permitir caracteres HTML ni scripts
  if (/<|>|script|javascript|onerror|onload/i.test(trimmed)) return false;
  return true;
};

/**
 * Validación de CUIT/CUIL argentino (11 dígitos, formato xx-xxxxxxxx-x).
 */
export const validateCUIT = (cuit) => {
  if (!cuit) return true; // Opcional
  const clean = cuit.replace(/[-\s]/g, '');
  if (!/^\d{11}$/.test(clean)) return false;
  // Verificar dígito verificador
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = mult.reduce((acc, m, i) => acc + m * parseInt(clean[i]), 0);
  const remainder = sum % 11;
  const check = remainder === 0 ? 0 : remainder === 1 ? 9 : 11 - remainder;
  return check === parseInt(clean[10]);
};

export { validatePasswordStrength };
