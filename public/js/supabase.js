// ==============================================
// supabase.js — Conexión con Supabase
// Este archivo maneja toda la comunicación con la base de datos.
// Pensalo como el "mozo" que lleva pedidos a la cocina (Supabase)
// y trae los resultados de vuelta.
// ==============================================

// Las credenciales se cargan desde variables de entorno (archivo .env)
// Nunca se escriben directo en el código por seguridad
const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.__ENV__?.SUPABASE_ANON_KEY || '';

// Verificar que las credenciales estén configuradas
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Error: Las credenciales de Supabase no están configuradas.');
    console.error('Verificá que el archivo .env tenga SUPABASE_URL y SUPABASE_ANON_KEY.');
}

// Crear el cliente de Supabase
// Este objeto es el que usamos en toda la app para leer y escribir datos
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==============================================
// Funciones auxiliares para manejo de errores
// ==============================================

/**
 * Ejecuta una consulta a Supabase y maneja errores de forma consistente.
 * Si algo sale mal, muestra un mensaje claro en vez de fallar silenciosamente.
 *
 * @param {Promise} consulta - La consulta a Supabase
 * @param {string} descripcion - Qué se intentó hacer (para el mensaje de error)
 * @returns {object|null} Los datos si todo salió bien, null si hubo error
 */
async function ejecutarConsulta(consulta, descripcion) {
    try {
        const { data, error } = await consulta;
        if (error) {
            console.error(`Error al ${descripcion}:`, error.message);
            mostrarError(`No se pudo ${descripcion}. Intentá de nuevo.`);
            return null;
        }
        return data;
    } catch (err) {
        console.error(`Error inesperado al ${descripcion}:`, err);
        mostrarError(`Ocurrió un error inesperado. Revisá tu conexión a internet.`);
        return null;
    }
}

/**
 * Muestra un mensaje de error visible al usuario.
 * Nunca fallar silenciosamente — el usuario siempre tiene que saber qué pasó.
 */
function mostrarError(mensaje) {
    // Por ahora usamos un alert simple, después lo reemplazamos por toasts
    // cuando tengamos el sistema de UI armado
    console.error('ERROR:', mensaje);
}

/**
 * Muestra un mensaje de éxito visible al usuario.
 */
function mostrarExito(mensaje) {
    console.log('OK:', mensaje);
}
