import { supabase } from '@/lib/customSupabaseClient';

/**
 * Verifica si un email ya está registrado en el sistema (a nivel auth.users).
 * Usa la RPC `email_exists_in_system` con SECURITY DEFINER porque la policy RLS
 * de `profiles` no permite ver perfiles de otras empresas, lo cual hace que
 * `SELECT FROM profiles WHERE email=...` devuelva 0 aunque el email esté tomado
 * en otro tenant. La RPC consulta directamente `auth.users` (tabla global).
 *
 * @param {string} email
 * @param {string|null} excludeUserId - si se pasa, ignora ese user.id (útil para edición)
 * @returns {Promise<boolean>}
 */
export const checkEmailExists = async (email, excludeUserId = null) => {
  if (!email) return false;

  const { data, error } = await supabase.rpc('email_exists_in_system', {
    p_email: email.trim().toLowerCase(),
  });

  if (error) {
    console.error('Error checking email existence:', error);
    return false;
  }

  // Si pasaron excludeUserId y el email existe, hay que verificar si es el mismo usuario.
  // Para eso consultamos profiles (que sí permite leer el propio).
  if (data && excludeUserId) {
    const { data: ownProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', excludeUserId)
      .eq('email', email)
      .maybeSingle();
    if (ownProfile) return false; // es el mismo usuario, no es un conflicto
  }

  return !!data;
};

export const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

export const validatePassword = (password) => {
  return password && password.length >= 6;
};