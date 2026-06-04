import { supabase } from '@/lib/customSupabaseClient';

export const checkEmailExists = async (email, excludeUserId = null) => {
  if (!email) return false;
  
  let query = supabase
    .from('profiles')
    .select('id')
    .eq('email', email);
    
  if (excludeUserId) {
    query = query.neq('id', excludeUserId);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Error checking email existence:', error);
    return false;
  }
  
  return data.length > 0;
};

export const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

export const validatePassword = (password) => {
  return password && password.length >= 6;
};