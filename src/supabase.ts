import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://prpmxfsnpwyalolxvlpj.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBycG14ZnNucHd5YWxvbHh2bHBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MTE3NDIsImV4cCI6MjA4NzI4Nzc0Mn0._S_Gd_pGka7Gy_l8XW5FGNfwukhYdE9dAPYuXownPco';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
