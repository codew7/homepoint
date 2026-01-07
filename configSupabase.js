// =====================================================
// CONFIGURACIÓN DE SUPABASE PARA HOMEPOINT
// =====================================================
// ⚠️ IMPORTANTE: Agregar este archivo a .gitignore
// =====================================================

const SUPABASE_CONFIG = {
    // URL de tu proyecto Supabase
    // Formato: https://tu-proyecto.supabase.co
    SUPABASE_URL: 'https://eygzrjvbnkqmeqakniyy.supabase.co',
    
    // Anon/Public Key de Supabase (segura para uso en frontend)
    // La encontrarás en: Settings > API > Project API keys > anon public
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5Z3pyanZibmtxbWVxYWtuaXl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NDM3NjAsImV4cCI6MjA4MzMxOTc2MH0.IaaYcZMFr1YA7xDQ5ktdx_ChAeeOXyW1gQylhz_Pxgs',
    
    // Service Role Key (solo para operaciones administrativas del backend)
    // ⚠️ NUNCA expongas esta clave en el frontend
    // SUPABASE_SERVICE_ROLE_KEY: 'TU_SERVICE_ROLE_KEY_AQUI',
};

// NOTA: GOOGLE_SHEETS_CONFIG ya está definido en configSB.js
// No es necesario duplicarlo aquí

// =====================================================
// INSTRUCCIONES PARA CONFIGURAR SUPABASE
// =====================================================
/*
1. Crear proyecto en Supabase (https://supabase.com)
2. Copiar la URL del proyecto desde Dashboard
3. Copiar la clave anon/public desde Settings > API
4. Ejecutar el archivo supabase-schema.sql en el SQL Editor:
   - Ir a SQL Editor en el dashboard de Supabase
   - Crear una nueva query
   - Pegar todo el contenido de supabase-schema.sql
   - Ejecutar (Run)
5. Configurar autenticación:
   - Ir a Authentication > Providers
   - Habilitar Email provider
   - (Opcional) Configurar otros providers según necesidad
6. Configurar políticas de seguridad (RLS):
   - Las políticas ya están en el schema SQL
   - Verificar en Authentication > Policies
7. Reemplazar los valores TU_SUPABASE_URL_AQUI y TU_SUPABASE_ANON_KEY_AQUI
   en este archivo con tus credenciales reales

NOTA SOBRE MIGRACIÓN DE DATOS:
- Los datos existentes en Firebase se mantendrán intactos
- Los nuevos registros se guardarán en Supabase
- Si deseas migrar datos históricos, contacta al desarrollador
*/
