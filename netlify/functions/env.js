// ==============================================
// Netlify Function: /api/env
// Le pasa al navegador SOLO las credenciales públicas de Supabase.
//
// La URL y la "anon key" de Supabase son públicas POR DISEÑO: la
// seguridad real la dan las políticas RLS de la base de datos.
//
// IMPORTANTE: las claves de IA (Gemini / Anthropic) NO se exponen acá.
// Viven como secretos del lado del servidor en las Supabase Edge Functions
// (gemini-proxy / anthropic-proxy). El navegador nunca las ve.
// ==============================================

exports.handler = async function () {
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        },
        body: JSON.stringify({
            SUPABASE_URL: process.env.SUPABASE_URL || '',
            SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || ''
        })
    };
};
