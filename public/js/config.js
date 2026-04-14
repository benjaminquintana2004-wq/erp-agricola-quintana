// ==============================================
// config.js — Carga las variables de entorno desde Netlify Functions
// Este archivo se ejecuta PRIMERO, antes que cualquier otro JS.
// Pide las credenciales al servidor y las guarda en window.__ENV__
// para que supabase.js y auth.js puedan usarlas.
// ==============================================

/**
 * Carga las variables de entorno desde la Netlify Function.
 * Debe ejecutarse antes de inicializar Supabase.
 */
async function cargarConfiguracion() {
    try {
        const respuesta = await fetch('/.netlify/functions/env');
        if (!respuesta.ok) {
            throw new Error(`Error HTTP: ${respuesta.status}`);
        }
        const config = await respuesta.json();
        window.__ENV__ = config;
        return true;
    } catch (err) {
        console.error('No se pudieron cargar las variables de entorno:', err);
        console.error('Verificá que netlify dev esté corriendo o que las variables estén configuradas en Netlify.');
        return false;
    }
}
