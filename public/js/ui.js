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
    tesoreria: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    reportes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    salir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
    mas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    editar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    eliminar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    buscar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    cerrar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    ver: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    subir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    alerta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    campanas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    labores: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    insumos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
    despachos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    contratistas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    empleados: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
    mapa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'
};

// Definición de las secciones del menú
const SECCIONES_MENU = [
    { seccion: 'Principal' },
    { nombre: 'Dashboard', icono: 'dashboard', url: '/index.html' },
    { nombre: 'Arrendadores', icono: 'arrendadores', url: '/arrendadores.html' },
    { nombre: 'Movimientos', icono: 'movimientos', url: '/movimientos.html' },
    { nombre: 'Contratos', icono: 'contratos', url: '/contratos.html' },
    { seccion: 'Producción' },
    { nombre: 'Campañas', icono: 'campanas', url: '/campanas.html' },
    { nombre: 'Lotes', icono: 'lotes', url: '/lotes.html' },
    { nombre: 'Labores', icono: 'labores', url: '/labores.html' },
    { nombre: 'Insumos', icono: 'insumos', url: '/insumos.html' },
    { nombre: 'Stock de Granos', icono: 'stock', url: '/stock.html' },
    { nombre: 'Maquinaria', icono: 'maquinaria', url: '/maquinaria.html' },
    { nombre: 'Mapa de campos', icono: 'mapa', url: '/mapa.html' },
    { seccion: 'Logística y Personal' },
    { nombre: 'Despachos', icono: 'despachos', url: '/despachos.html' },
    { nombre: 'Contratistas', icono: 'contratistas', url: '/contratistas.html' },
    { nombre: 'Empleados', icono: 'empleados', url: '/empleados.html' },
    { seccion: 'Finanzas' },
    { nombre: 'Tesorería', icono: 'tesoreria', url: '/tesoreria.html' },
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
/**
 * Popup chico que pregunta al usuario con qué IA extraer un PDF.
 * Se renderiza por encima de cualquier modal existente sin cerrarlo
 * (z-index alto, no toca el DOM del modal abajo).
 *
 * Devuelve una Promise que resuelve a:
 *   'gemini' | 'claude' | 'sin' | null (cancelado)
 */
function elegirIA() {
    return new Promise((resolve) => {
        const id = 'chooser-ia-popup';
        document.getElementById(id)?.remove();

        const overlay = document.createElement('div');
        overlay.id = id;
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:var(--espacio-md);';
        overlay.innerHTML = `
            <div style="background:var(--color-fondo-tarjeta);border:1px solid var(--color-borde);border-radius:var(--radio-lg);padding:var(--espacio-lg);max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
                <h3 style="margin:0 0 var(--espacio-xs) 0;color:var(--color-texto);font-size:var(--texto-lg);">Elegí con qué IA extraer</h3>
                <p style="margin:0 0 var(--espacio-md) 0;font-size:var(--texto-sm);color:var(--color-texto-tenue);">
                    Ambas leen el PDF y devuelven los datos. Si una está saturada o lee mal, probá la otra.
                </p>
                <div style="display:flex;flex-direction:column;gap:var(--espacio-sm);">
                    <button class="btn-primario" data-ia="gemini" style="display:flex;align-items:center;justify-content:space-between;padding:var(--espacio-md);text-align:left;">
                        <span><strong>Gemini</strong> <span style="opacity:0.7;font-size:var(--texto-xs);">(Google · gratis)</span></span>
                        <span style="opacity:0.6;">→</span>
                    </button>
                    <button class="btn-primario" data-ia="claude" style="display:flex;align-items:center;justify-content:space-between;padding:var(--espacio-md);text-align:left;">
                        <span><strong>Claude</strong> <span style="opacity:0.7;font-size:var(--texto-xs);">(Anthropic · pago)</span></span>
                        <span style="opacity:0.6;">→</span>
                    </button>
                    <button class="btn-secundario" data-ia="sin" style="padding:var(--espacio-sm);">Sin IA (cargar datos a mano)</button>
                    <button class="btn-secundario" data-ia="cancelar" style="padding:var(--espacio-sm);opacity:0.7;">Cancelar</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-ia]');
            if (!btn) return;
            const eleccion = btn.dataset.ia;
            overlay.remove();
            resolve(eleccion === 'cancelar' ? null : eleccion);
        });
    });
}

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

    // Activar máscara dd/mm/aaaa en cualquier input de fecha del modal
    activarFechasDDMM(document.querySelector('.modal'));
}

// ==============================================
// FECHAS dd/mm/aaaa — máscara y conversión ISO ↔ dd/mm/aaaa
// ==============================================
// Browser nativo de <input type="date"> muestra el formato según locale del SO,
// y muchas veces termina en mm/dd/yyyy. Para forzar dd/mm/aaaa usamos un
// <input type="text"> con máscara y convertimos a ISO al guardar.
//
// Uso en HTML:
//   <input type="text" data-fecha placeholder="dd/mm/aaaa" maxlength="10"
//          inputmode="numeric" value="${isoADDMM(datos.fecha)}">
// Uso al leer:
//   const fechaISO = ddmmAISO(document.getElementById('campo-fecha').value);

/**
 * Convierte YYYY-MM-DD → dd/mm/yyyy. Devuelve '' si vacío o inválido.
 */
function isoADDMM(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Convierte dd/mm/yyyy → YYYY-MM-DD. Devuelve null si vacío o inválido.
 * Acepta dd/mm/yyyy, d/m/yyyy y dd-mm-yyyy.
 */
function ddmmAISO(valor) {
    if (!valor) return null;
    const limpio = String(valor).trim();
    if (!limpio) return null;
    const m = limpio.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (!m) return null;
    const dia = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10);
    const anio = parseInt(m[3], 10);
    if (mes < 1 || mes > 12) return null;
    if (dia < 1 || dia > 31) return null;
    return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Aplica máscara dd/mm/aaaa en vivo a un input de texto.
 * Inserta las barras automáticamente y limita a 10 caracteres.
 */
function aplicarMascaraFecha(input) {
    if (!input || input.dataset.fechaActivo === '1') return;
    input.dataset.fechaActivo = '1';
    if (!input.getAttribute('maxlength')) input.setAttribute('maxlength', '10');
    if (!input.getAttribute('placeholder')) input.setAttribute('placeholder', 'dd/mm/aaaa');
    if (!input.getAttribute('inputmode')) input.setAttribute('inputmode', 'numeric');

    input.addEventListener('input', (e) => {
        const v = e.target.value.replace(/\D/g, '').slice(0, 8);
        let out = '';
        if (v.length > 0) out = v.slice(0, 2);
        if (v.length >= 3) out += '/' + v.slice(2, 4);
        if (v.length >= 5) out += '/' + v.slice(4, 8);
        e.target.value = out;
    });
}

/**
 * Activa la máscara en todos los inputs con data-fecha dentro de un scope.
 * Se llama automáticamente al abrir un modal.
 */
function activarFechasDDMM(scope) {
    const root = scope || document;
    root.querySelectorAll('input[data-fecha]').forEach(aplicarMascaraFecha);
}

// Auto-activar fechas que ya estén en el DOM al cargar la página
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => activarFechasDDMM(document));
    } else {
        activarFechasDDMM(document);
    }
}

// ==============================================
// BADGE "ADELANTO" — indicador visual de pago adelantado
// ==============================================
// Un contrato tiene "adelanto" si tiene `adelanto_qq` o un día/mes pactado.
// El badge cambia de color según proximidad a la fecha de vencimiento del
// adelanto (que se repite todas las campañas en el mismo día/mes).

/**
 * Devuelve true si el contrato tiene algún tipo de pago adelantado pactado.
 */
function contratoTieneAdelanto(c) {
    if (!c) return false;
    return !!(c.adelanto_qq || c.adelanto_dia || c.adelanto_mes || c.adelanto_observaciones);
}

/**
 * Renderiza un badge "Adelanto" para un contrato. Devuelve '' si el
 * contrato no tiene adelanto pactado. Mismo color para todos
 * (no varía con la proximidad a la fecha).
 */
function renderBadgeAdelanto(c) {
    if (!contratoTieneAdelanto(c)) return '';

    const qq = c.adelanto_qq ? `${Number(c.adelanto_qq).toLocaleString('es-AR')} qq` : 'pago adelantado';
    const fechaTxt = (c.adelanto_dia && c.adelanto_mes)
        ? ` antes del ${String(c.adelanto_dia).padStart(2, '0')}/${String(c.adelanto_mes).padStart(2, '0')} cada año`
        : '';
    const tooltip = `Pago adelantado: ${qq}${fechaTxt}`;
    return `<span class="badge badge-gris" title="${tooltip}">💰 Adelanto</span>`;
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
 * Fecha de hoy en formato YYYY-MM-DD respetando la zona horaria LOCAL.
 * NO uses new Date().toISOString().split('T')[0] porque convierte a UTC
 * y en Argentina (UTC-3) corre el día después de las 21:00 hs.
 */
function fechaHoyStr() {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}-${String(h.getDate()).padStart(2,'0')}`;
}

/**
 * Convierte un objeto Date a YYYY-MM-DD respetando la zona horaria LOCAL.
 * Mismo motivo que fechaHoyStr(): evitar desfase UTC.
 */
function fechaALocalStr(d) {
    if (!(d instanceof Date)) return null;
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * Formatea una fecha ISO a formato argentino (dd/mm/aaaa)
 */
function formatearFecha(fechaISO) {
    if (!fechaISO) return '—';
    // Tomamos solo la parte de fecha (antes de la T) para evitar conversión UTC
    // que en Argentina (UTC-3) correría el día hacia atrás
    const soloFecha = fechaISO.split('T')[0]; // "2026-01-05"
    const [anio, mes, dia] = soloFecha.split('-');
    if (!anio || !mes || !dia) return '—';
    return `${dia}/${mes}/${anio}`;
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

/**
 * Formatea un número con separador de miles argentino
 */
function formatearNumero(num) {
    if (num == null) return '0';
    return Number(num).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
