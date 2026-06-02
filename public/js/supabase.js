// ==============================================
// supabase.js — Conexión con Supabase
// Este archivo maneja toda la comunicación con la base de datos.
// Pensalo como el "mozo" que lleva pedidos a la cocina (Supabase)
// y trae los resultados de vuelta.
// ==============================================

// Variable global del cliente Supabase
// Usamos "db" porque "supabase" ya la usa el CDN (window.supabase)
// Se inicializa después de cargar las credenciales desde el servidor
let db = null;

/**
 * Inicializa el cliente de Supabase con las credenciales cargadas.
 * Debe llamarse DESPUÉS de cargarConfiguracion() en config.js.
 */
function inicializarSupabase() {
    const url = window.__ENV__?.SUPABASE_URL || '';
    const key = window.__ENV__?.SUPABASE_ANON_KEY || '';

    if (!url || !key) {
        console.error('Error: Las credenciales de Supabase no están configuradas.');
        console.error('Verificá que el archivo .env tenga SUPABASE_URL y SUPABASE_ANON_KEY.');
        return false;
    }

    db = window.supabase.createClient(url, key);
    return true;
}

// ==============================================
// Proxy de IA (Supabase Edge Functions)
// La clave de Gemini/Anthropic vive SOLO en el servidor.
// El navegador llama a estas funciones, que verifican que el
// usuario esté logueado y recién ahí usan la clave secreta.
// ==============================================

/** URL del proxy de Gemini. El modelo viaja como query param. */
function urlProxyGemini(modelo = 'gemini-2.5-flash') {
    const base = window.__ENV__?.SUPABASE_URL || '';
    return `${base}/functions/v1/gemini-proxy?model=${encodeURIComponent(modelo)}`;
}

/** URL del proxy de Anthropic (Claude). */
function urlProxyAnthropic() {
    const base = window.__ENV__?.SUPABASE_URL || '';
    return `${base}/functions/v1/anthropic-proxy`;
}

/**
 * Headers para llamar a los proxies de IA.
 * Incluye el token de sesión del usuario (la Edge Function exige login)
 * y la apikey pública que el gateway de Supabase requiere.
 */
async function headersProxyIA() {
    let token = window.__ENV__?.SUPABASE_ANON_KEY || '';
    try {
        const { data } = await db.auth.getSession();
        if (data?.session?.access_token) token = data.session.access_token;
    } catch (err) {
        console.warn('No se pudo obtener la sesión para el proxy de IA:', err);
    }
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': window.__ENV__?.SUPABASE_ANON_KEY || ''
    };
}

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
            return undefined;
        }
        // Para insert/update sin .select(), data es null pero la operación fue exitosa
        return data !== undefined ? data : [];
    } catch (err) {
        console.error(`Error inesperado al ${descripcion}:`, err);
        mostrarError(`Ocurrió un error inesperado. Revisá tu conexión a internet.`);
        return undefined;
    }
}

// ==============================================
// Sistema de notificaciones (toasts)
// ==============================================

/**
 * Muestra un toast (notificación) al usuario.
 * Aparece abajo a la derecha y desaparece después de 4 segundos.
 */
function mostrarToast(mensaje, tipo = 'exito') {
    // Eliminar toast anterior si existe
    const toastAnterior = document.querySelector('.toast');
    if (toastAnterior) toastAnterior.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.textContent = mensaje;
    document.body.appendChild(toast);

    // Eliminar después de 4 segundos
    setTimeout(() => toast.remove(), 4000);
}

/**
 * Muestra un mensaje de error visible al usuario.
 */
function mostrarError(mensaje) {
    mostrarToast(mensaje, 'error');
}

/**
 * Muestra un mensaje de éxito visible al usuario.
 */
function mostrarExito(mensaje) {
    mostrarToast(mensaje, 'exito');
}

/**
 * Muestra un mensaje de alerta/advertencia visible al usuario.
 */
function mostrarAlerta(mensaje) {
    mostrarToast(mensaje, 'alerta');
}
