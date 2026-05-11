import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cgzaiijspgafruytozzk.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnemFpaWpzcGdhZnJ1eXRvenprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MzU1MzAsImV4cCI6MjA4MDAxMTUzMH0.1QBoYN6V64pkJ0j_098f7IxlDsEdheayCVRbi-_ME0I';

const customSupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

export default customSupabaseClient;

export { 
    customSupabaseClient,
    customSupabaseClient as supabase,
};
