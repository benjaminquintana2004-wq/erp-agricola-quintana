// ==============================================
// ui.js — Componentes reutilizables de la interfaz
// Sidebar, header, modales y funciones de UI compartidas.
// Este archivo se usa en TODAS las páginas de la app.
// ==============================================

// Íconos SVG usados en el sidebar (Lucide icons style)
const ICONOS = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    arrendadores: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    movimientos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    contratos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    lotes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
    stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    maquinaria: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    reportes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    salir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
    mas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    editar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    eliminar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    buscar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    cerrar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    ver: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
};

// Definición de las secciones del menú
const SECCIONES_MENU = [
    { seccion: 'Principal' },
    { nombre: 'Dashboard', icono: 'dashboard', url: '/index.html' },
    { nombre: 'Arrendadores', icono: 'arrendadores', url: '/arrendadores.html' },
    { nombre: 'Movimientos', icono: 'movimientos', url: '/movimientos.html' },
    { nombre: 'Contratos', icono: 'contratos', url: '/contratos.html' },
    { seccion: 'Producción' },
    { nombre: 'Lotes', icono: 'lotes', url: '/lotes.html' },
    { nombre: 'Stock de Granos', icono: 'stock', url: '/stock.html' },
    { nombre: 'Maquinaria', icono: 'maquinaria', url: '/maquinaria.html' },
    { seccion: 'Informes' },
    { nombre: 'Reportes', icono: 'reportes', url: '/reportes.html' }
];

// ==============================================
// Renderizar sidebar
// ==============================================

/**
 * Genera el HTML del sidebar y lo inserta en el DOM.
 * Marca como activo el link que corresponde a la página actual.
 */
function renderizarSidebar() {
    const usuario = window.__USUARIO__;
    const paginaActual = window.location.pathname;

    // Construir los links de navegación
    let navHTML = '';
    for (const item of SECCIONES_MENU) {
        if (item.seccion) {
            navHTML += `<div class="sidebar-seccion-titulo">${item.seccion}</div>`;
        } else {
            const activo = paginaActual === item.url || paginaActual.endsWith(item.url) ? 'activo' : '';
            navHTML += `
                <a href="${item.url}" class="sidebar-link ${activo}">
                    ${ICONOS[item.icono]}
                    <span>${item.nombre}</span>
                </a>
            `;
        }
    }

    // Obtener iniciales del nombre para el avatar
    const iniciales = obtenerIniciales(usuario?.nombre || 'U');
    const rolFormateado = formatearRolSidebar(usuario?.rol || '');

    // Avatar: usar foto de Google si existe, sino iniciales
    let avatarHTML;
    if (usuario?.avatar) {
        avatarHTML = `<img src="${usuario.avatar}" alt="${usuario.nombre}">`;
    } else {
        avatarHTML = `<span class="sidebar-avatar-iniciales">${iniciales}</span>`;
    }

    const sidebarHTML = `
        <div class="sidebar">
            <div class="sidebar-logo">
                <div class="sidebar-logo-icono">${ICONOS.logo}</div>
                <div>
                    <div class="sidebar-logo-texto">ERP Quintana</div>
                    <div class="sidebar-logo-subtexto">Gestión Agrícola</div>
                </div>
            </div>
            <nav class="sidebar-nav">
                ${navHTML}
            </nav>
            <div class="sidebar-footer">
                <div class="sidebar-avatar">${avatarHTML}</div>
                <div class="sidebar-usuario-info">
                    <div class="sidebar-usuario-nombre">${usuario?.nombre || 'Usuario'}</div>
                    <div class="sidebar-usuario-rol">${rolFormateado}</div>
                </div>
                <button class="sidebar-btn-salir" onclick="cerrarSesion()" title="Cerrar sesión">
                    ${ICONOS.salir}
                </button>
            </div>
        </div>
    `;

    // Insertar al inicio del body
    document.body.insertAdjacentHTML('afterbegin', sidebarHTML);
}

// ==============================================
// Renderizar header de página
// ==============================================

/**
 * Genera el header de la página con título y subtítulo.
 * @param {string} titulo - Título principal
 * @param {string} subtitulo - Descripción corta
 * @param {string} accionesHTML - HTML para botones a la derecha (opcional)
 */
function renderizarHeader(titulo, subtitulo, accionesHTML = '') {
    return `
        <div class="pagina-header">
            <div class="pagina-header-izq">
                <h1 class="pagina-titulo">${titulo}</h1>
                ${subtitulo ? `<p class="pagina-subtitulo">${subtitulo}</p>` : ''}
            </div>
            <div class="pagina-header-der">
                ${accionesHTML}
            </div>
        </div>
    `;
}

// ==============================================
// Crear layout completo de la página
// ==============================================

/**
 * Inicializa la estructura completa de una página:
 * 1. Carga config y Supabase
 * 2. Verifica autenticación
 * 3. Renderiza sidebar
 * 4. Retorna el usuario para uso posterior
 *
 * @param {string} titulo - Título de la página
 * @param {string} subtitulo - Subtítulo descriptivo
 * @param {string} accionesHTML - Botones para el header (opcional)
 * @returns {object|null} Datos del usuario o null si no tiene acceso
 */
async function crearLayout(titulo, subtitulo, accionesHTML = '') {
    // 1. Cargar credenciales
    const configOk = await cargarConfiguracion();
    if (!configOk) {
        window.location.href = '/login.html';
        return null;
    }

    // 2. Inicializar Supabase
    inicializarSupabase();
    escucharCambiosDeSesion();

    // 3. Verificar sesión
    const user = await obtenerUsuarioActual();
    if (!user) {
        window.location.href = '/login.html';
        return null;
    }

    // 4. Obtener rol
    const rol = await obtenerRolUsuario(user.id);
    if (!rol) {
        window.location.href = '/login.html';
        return null;
    }

    // 5. Guardar datos del usuario en memoria
    window.__USUARIO__ = {
        id: user.id,
        email: user.email,
        nombre: user.user_metadata?.full_name || user.email,
        avatar: user.user_metadata?.avatar_url || null,
        rol: rol
    };

    // 6. Ocultar pantalla de carga
    const pantallaCarga = document.getElementById('pantalla-carga');
    if (pantallaCarga) pantallaCarga.style.display = 'none';

    // 7. Renderizar sidebar
    renderizarSidebar();

    // 8. Mostrar contenido principal
    const contenido = document.getElementById('contenido-principal');
    if (contenido) {
        contenido.style.display = 'flex';
        // Insertar header al inicio del contenido
        contenido.insertAdjacentHTML('afterbegin', renderizarHeader(titulo, subtitulo, accionesHTML));
    }

    return window.__USUARIO__;
}

// ==============================================
// Modal reutilizable
// ==============================================

/**
 * Abre un modal con el contenido dado.
 * @param {string} titulo - Título del modal
 * @param {string} contenidoHTML - HTML del cuerpo del modal
 * @param {string} footerHTML - HTML de los botones del footer
 */
function abrirModal(titulo, contenidoHTML, footerHTML = '') {
    // Cerrar modal anterior si existe
    cerrarModal();

    const modalHTML = `
        <div class="modal-overlay" onclick="cerrarModalSiClickAfuera(event)">
            <div class="modal">
                <div class="modal-header">
                    <h2 class="modal-titulo">${titulo}</h2>
                    <button class="modal-btn-cerrar" onclick="cerrarModal()">
                        ${ICONOS.cerrar}
                    </button>
                </div>
                <div class="modal-body">
                    ${contenidoHTML}
                </div>
                ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    document.body.style.overflow = 'hidden';
}

/**
 * Cierra el modal actual.
 */
function cerrarModal() {
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) {
        overlay.remove();
        document.body.style.overflow = '';
    }
}

/**
 * Cierra el modal solo si se hace click en el overlay (fondo oscuro).
 */
function cerrarModalSiClickAfuera(event) {
    if (event.target.classList.contains('modal-overlay')) {
        cerrarModal();
    }
}

// ==============================================
// Confirmación antes de eliminar
// ==============================================

/**
 * Muestra un diálogo de confirmación antes de una acción destructiva.
 * @param {string} mensaje - Qué se va a hacer
 * @param {Function} callbackConfirmar - Función a ejecutar si confirma
 */
function confirmarAccion(mensaje, callbackConfirmar) {
    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto); margin-bottom: var(--espacio-md);">
            ${mensaje}
        </p>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">
            Esta acción no se puede deshacer.
        </p>
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-peligro" onclick="cerrarModal(); (${callbackConfirmar.toString()})()">
            Sí, eliminar
        </button>
    `;
    abrirModal('Confirmar eliminación', contenido, footer);
}

// ==============================================
// Funciones auxiliares
// ==============================================

/**
 * Obtiene las iniciales de un nombre (ej: "Benjamin Quintana" → "BQ")
 */
function obtenerIniciales(nombre) {
    return nombre
        .split(' ')
        .map(p => p.charAt(0))
        .join('')
        .toUpperCase()
        .substring(0, 2);
}

/**
 * Formatea el rol para mostrar en el sidebar
 */
function formatearRolSidebar(rol) {
    const nombres = {
        'admin_total': 'Admin Total',
        'admin': 'Administrador',
        'empleado': 'Empleado'
    };
    return nombres[rol] || rol;
}

/**
 * Formatea una fecha ISO a formato argentino (dd/mm/aaaa)
 */
function formatearFecha(fechaISO) {
    if (!fechaISO) return '—';
    const fecha = new Date(fechaISO);
    return fecha.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

/**
 * Formatea un número como moneda argentina
 */
function formatearMoneda(monto, moneda = 'ARS') {
    if (monto == null) return '—';
    const simbolo = moneda === 'USD' ? 'U$D' : '$';
    return `${simbolo} ${Number(monto).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}

/**
 * Formatea quintales con 2 decimales
 */
function formatearQQ(qq) {
    if (qq == null) return '—';
    return `${Number(qq).toLocaleString('es-AR', { minimumFractionDigits: 2 })} qq`;
}
