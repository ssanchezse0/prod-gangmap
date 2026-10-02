window.SUPABASE_CONFIG = window.SUPABASE_CONFIG || {};
window.SUPABASE_CONFIG.url = window.SUPABASE_CONFIG.url || 'https://TU_PROYECTO.supabase.co';
window.SUPABASE_CONFIG.publicKey = window.SUPABASE_CONFIG.publicKey || 'TU_PUBLIC_ANON_KEY';
window.SUPABASE_CONFIG.anonKey = window.SUPABASE_CONFIG.anonKey || window.SUPABASE_CONFIG.publicKey;

// 1) Crea el proyecto en Supabase.
// 2) Ejecuta supabase/schema.sql desde el SQL Editor.
// 3) Crea el usuario admin en Authentication > Users.
// 4) Inserta su UUID en public.zone_admins.
// 5) Rellena los valores reales en index.html o aquí; no los dejes vacíos.