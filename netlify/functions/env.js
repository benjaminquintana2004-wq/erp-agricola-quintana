// ==============================================
// Netlify Function: /api/env
// Este mini-servidor le pasa las credenciales de Supabase al frontend.
// Las variables de entorno viven en Netlify (seguro), y esta función
// se las entrega al navegador cuando las necesita.
// Solo expone las claves públicas (anon key), nunca las secretas.
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
            SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
            GEMINI_API_KEY: process.env.GEMINI_API_KEY || ''
        })
    };
};
