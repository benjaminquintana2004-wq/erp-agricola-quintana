// ==============================================
// auth.js — Autenticación y control de roles
// Este archivo maneja el login con Google y verifica
// qué rol tiene cada usuario (admin_total, admin, empleado).
// Es como el portero del sistema: verifica quién sos
// y a qué áreas podés acceder.
// ==============================================

// Los 3 roles del sistema
const ROLES = {
    ADMIN_TOTAL: 'admin_total',  // Diego — ve y edita todo
    ADMIN: 'admin',              // Administrativa — carga datos
    EMPLEADO: 'empleado'         // Empleados — solo lectura
};

/**
 * Inicia sesión con Google.
 * Supabase se encarga de todo: abre la ventana de Google,
 * el usuario pone su cuenta, y vuelve ya logueado.
 */
async function iniciarSesion() {
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin
        }
    });

    if (error) {
        console.error('Error al iniciar sesión:', error.message);
        mostrarError('No se pudo iniciar sesión con Google. Intentá de nuevo.');
    }
}

/**
 * Cierra la sesión del usuario actual.
 */
async function cerrarSesion() {
    const { error } = await supabase.auth.signOut();
    if (error) {
        console.error('Error al cerrar sesión:', error.message);
        mostrarError('No se pudo cerrar la sesión.');
        return;
    }
    window.location.href = '/login.html';
}

/**
 * Obtiene el usuario actualmente logueado.
 * Devuelve null si no hay nadie logueado.
 */
async function obtenerUsuarioActual() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user;
}

/**
 * Obtiene el rol del usuario desde la tabla 'usuarios'.
 * Si el usuario no tiene un registro en la tabla, no tiene acceso.
 */
async function obtenerRolUsuario(userId) {
    const data = await ejecutarConsulta(
        supabase.from('usuarios').select('rol, activo').eq('id', userId).single(),
        'obtener el rol del usuario'
    );

    if (!data) return null;
    if (!data.activo) {
        mostrarError('Tu cuenta está desactivada. Contactá al administrador.');
        return null;
    }
    return data.rol;
}

/**
 * Verifica si el usuario tiene permiso para una acción según su rol.
 * - admin_total: puede hacer todo
 * - admin: puede leer y escribir, pero no borrar ni cambiar roles
 * - empleado: solo puede leer
 */
function tienePermiso(rolUsuario, accion) {
    const permisos = {
        [ROLES.ADMIN_TOTAL]: ['leer', 'escribir', 'eliminar', 'gestionar_usuarios'],
        [ROLES.ADMIN]: ['leer', 'escribir'],
        [ROLES.EMPLEADO]: ['leer']
    };

    return permisos[rolUsuario]?.includes(accion) || false;
}

/**
 * Protege una página: si el usuario no está logueado o no tiene el rol
 * necesario, lo redirige al login.
 * Llamar esto al inicio de cada página protegida.
 */
async function protegerPagina(rolesPermitidos) {
    const user = await obtenerUsuarioActual();
    if (!user) {
        window.location.href = '/login.html';
        return null;
    }

    const rol = await obtenerRolUsuario(user.id);
    if (!rol || !rolesPermitidos.includes(rol)) {
        mostrarError('No tenés permiso para acceder a esta página.');
        window.location.href = '/login.html';
        return null;
    }

    return { user, rol };
}

// Escuchar cambios en la sesión (login, logout, expiración)
supabase.auth.onAuthStateChange((evento, sesion) => {
    if (evento === 'SIGNED_OUT') {
        window.location.href = '/login.html';
    }
});
