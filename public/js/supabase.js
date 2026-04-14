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
