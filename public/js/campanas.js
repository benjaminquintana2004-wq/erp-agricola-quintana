// ==============================================
// campanas.js — CRUD de campañas agrícolas
// Crear, activar/desactivar y eliminar campañas.
// Solo una campaña puede estar activa a la vez.
// ==============================================

let campanasCargadas = [];

// ==============================================
// LEER — Cargar campañas
// ==============================================

async function cargarCampanas() {
    const data = await ejecutarConsulta(
        db.from('campanas')
            .select('*')
            .order('anio_inicio', { ascending: false }),
        'cargar campañas'
    );

    if (data === undefined) return;

    // Para cada campaña, contar contratos y saldos asociados
    const conStats = await Promise.all(data.map(async (c) => {
        const [contratos, saldos] = await Promise.all([
            ejecutarConsulta(
                db.from('contratos')
                    .select('id', { count: 'exact', head: true })
                    .eq('campana_id', c.id),
                'contar contratos'
            ),
            ejecutarConsulta(
                db.from('saldos')
                    .select('id, qq_deuda_blanco, qq_deuda_negro')
                    .eq('campana_id', c.id),
                'contar saldos'
            )
        ]);

        // Calcular QQ pendientes totales de esta campaña
        let qqTotal = 0;
        if (saldos) {
            saldos.forEach(s => {
                qqTotal += parseFloat(s.qq_deuda_blanco || 0) + parseFloat(s.qq_deuda_negro || 0);
            });
        }

        return {
            ...c,
            totalContratos: contratos?.length || 0,
            totalSaldos: saldos?.length || 0,
            qqPendientes: qqTotal
        };
    }));

    campanasCargadas = conStats;
    renderizarCampanas(conStats);
}

// ==============================================
// RENDERIZAR — Grid de tarjetas
// ==============================================

function renderizarCampanas(campanas) {
    const grid = document.getElementById('campanas-grid');
    const contador = document.getElementById('tabla-contador');
    const usuario = window.__USUARIO__;
    const esAdmin = ['admin_total', 'admin'].includes(usuario?.rol);

    if (contador) {
        contador.textContent = `${campanas.length} campaña${campanas.length !== 1 ? 's' : ''}`;
    }

    if (campanas.length === 0) {
        grid.innerHTML = `
            <div class="campanas-vacio">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <p>No hay campañas creadas.<br>Creá la primera para empezar a trabajar.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = campanas.map(c => {
        const esActiva = c.activa;
        const claseActiva = esActiva ? 'campana-tarjeta-activa' : '';
        const badgeActiva = esActiva
            ? '<span class="badge badge-verde">Activa</span>'
            : '<span class="badge badge-gris">Inactiva</span>';

        return `
        <div class="campana-tarjeta ${claseActiva}">
            <div class="campana-header">
                <span class="campana-nombre">${c.nombre}</span>
                ${badgeActiva}
            </div>
            <div class="campana-periodo">
                Julio ${c.anio_inicio} — Junio ${c.anio_fin}
            </div>
            <div class="campana-stats">
                <div class="campana-stat">
                    <span class="campana-stat-valor">${c.totalSaldos}</span>
                    <span class="campana-stat-label">Arrendadores</span>
                </div>
                <div class="campana-stat">
                    <span class="campana-stat-valor">${formatearQQ(c.qqPendientes)}</span>
                    <span class="campana-stat-label">QQ pendientes</span>
                </div>
            </div>
            ${esAdmin ? `
                <div class="campana-acciones">
                    ${!esActiva ? `
                        <button class="campana-btn campana-btn-activar" onclick="activarCampana('${c.id}', '${c.nombre}')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            Activar
                        </button>
                    ` : `
                        <button class="campana-btn" disabled style="opacity:0.5;cursor:default;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            Campaña activa
                        </button>
                    `}
                    <button class="campana-btn" onclick="editarCampana('${c.id}')">
                        ${ICONOS.editar}
                        Editar
                    </button>
                    ${!esActiva ? `
                        <button class="campana-btn campana-btn-eliminar" onclick="confirmarEliminarCampana('${c.id}', '${c.nombre.replace(/'/g, "\\'")}')">
                            ${ICONOS.eliminar}
                        </button>
                    ` : ''}
                </div>
            ` : ''}
        </div>
        `;
    }).join('');
}

// ==============================================
// CREAR / EDITAR — Modal
// ==============================================

let campanaEditandoId = null;

function abrirModalNuevaCampana() {
    campanaEditandoId = null;

    // Sugerir siguiente campaña
    const hoy = new Date();
    const anio = hoy.getMonth() >= 6 ? hoy.getFullYear() : hoy.getFullYear() - 1;
    const sugerido = {
        nombre: `${anio}/${(anio + 1).toString().slice(2)}`,
        anio_inicio: anio,
        anio_fin: anio + 1
    };

    abrirModalCampana('Nueva Campaña', sugerido);
}

function editarCampana(id) {
    const campana = campanasCargadas.find(c => c.id === id);
    if (!campana) {
        mostrarError('No se encontró la campaña.');
        return;
    }
    campanaEditandoId = id;
    abrirModalCampana('Editar Campaña', campana);
}

function abrirModalCampana(titulo, datos) {
    const contenido = `
        <div class="campo-grupo">
            <label class="campo-label">Nombre de la campaña <span class="campo-requerido">*</span></label>
            <input type="text" id="campo-nombre" class="campo-input" value="${datos.nombre || ''}" placeholder="Ej: 2025/26">
            <span class="campo-ayuda">Formato: año inicio / últimos 2 dígitos del año fin</span>
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Año inicio <span class="campo-requerido">*</span></label>
                <input type="number" id="campo-anio-inicio" class="campo-input" value="${datos.anio_inicio || ''}" placeholder="Ej: 2025" min="2020" max="2040">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Año fin <span class="campo-requerido">*</span></label>
                <input type="number" id="campo-anio-fin" class="campo-input" value="${datos.anio_fin || ''}" placeholder="Ej: 2026" min="2020" max="2040">
            </div>
        </div>
        <span class="campo-ayuda">Las campañas agrícolas van de julio a junio del año siguiente.</span>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarCampana()">
            ${campanaEditandoId ? 'Guardar cambios' : 'Crear campaña'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
    setTimeout(() => document.getElementById('campo-nombre')?.focus(), 100);

    // Auto-completar nombre cuando cambian los años
    const inputInicio = document.getElementById('campo-anio-inicio');
    const inputFin = document.getElementById('campo-anio-fin');
    const inputNombre = document.getElementById('campo-nombre');

    const actualizarNombre = () => {
        const inicio = inputInicio.value;
        const fin = inputFin.value;
        if (inicio && fin && fin.length >= 2) {
            inputNombre.value = `${inicio}/${fin.slice(-2)}`;
        }
    };

    inputInicio.addEventListener('change', actualizarNombre);
    inputFin.addEventListener('change', actualizarNombre);
}

async function guardarCampana() {
    const nombre = document.getElementById('campo-nombre')?.value.trim();
    const anioInicio = document.getElementById('campo-anio-inicio')?.value;
    const anioFin = document.getElementById('campo-anio-fin')?.value;

    if (!nombre) {
        mostrarError('El nombre es obligatorio.');
        return;
    }
    if (!anioInicio || !anioFin) {
        mostrarError('Los años de inicio y fin son obligatorios.');
        return;
    }
    if (parseInt(anioFin) <= parseInt(anioInicio)) {
        mostrarError('El año fin debe ser mayor al año inicio.');
        return;
    }

    // Verificar duplicados
    const duplicado = campanasCargadas.find(c => {
        if (campanaEditandoId && c.id === campanaEditandoId) return false;
        return c.nombre.toLowerCase() === nombre.toLowerCase();
    });
    if (duplicado) {
        mostrarError(`Ya existe una campaña con el nombre "${nombre}".`);
        return;
    }

    const datos = {
        nombre,
        anio_inicio: parseInt(anioInicio),
        anio_fin: parseInt(anioFin)
    };

    let resultado;

    if (campanaEditandoId) {
        resultado = await ejecutarConsulta(
            db.from('campanas').update(datos).eq('id', campanaEditandoId),
            'actualizar campaña'
        );
    } else {
        // Si es la primera campaña, activarla automáticamente
        if (campanasCargadas.length === 0) {
            datos.activa = true;
        }
        resultado = await ejecutarConsulta(
            db.from('campanas').insert(datos),
            'crear campaña'
        );
    }

    if (resultado !== undefined) {
        cerrarModal();
        mostrarExito(campanaEditandoId ? 'Campaña actualizada' : 'Campaña creada');
        campanaEditandoId = null;
        await cargarCampanas();
    }
}

// ==============================================
// ACTIVAR — Solo una activa a la vez
// ==============================================

async function activarCampana(id, nombre) {
    // Primero desactivar todas
    const desactivar = await ejecutarConsulta(
        db.from('campanas').update({ activa: false }).neq('id', id),
        'desactivar campañas'
    );

    // Luego activar la seleccionada
    const activar = await ejecutarConsulta(
        db.from('campanas').update({ activa: true }).eq('id', id),
        'activar campaña'
    );

    if (activar !== undefined) {
        mostrarExito(`Campaña "${nombre}" activada`);
        await cargarCampanas();
    }
}

// ==============================================
// ELIMINAR
// ==============================================

function confirmarEliminarCampana(id, nombre) {
    window.__idEliminarCampana = id;
    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto); margin-bottom: var(--espacio-md);">
            ¿Seguro que querés eliminar la campaña <strong>${nombre}</strong>?
        </p>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">
            Se eliminarán los saldos y asociaciones de lotes vinculadas a esta campaña.
            Esta acción no se puede deshacer.
        </p>
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-peligro" onclick="cerrarModal(); eliminarCampana(window.__idEliminarCampana)">
            Sí, eliminar
        </button>
    `;
    abrirModal('Confirmar eliminación', contenido, footer);
}

async function eliminarCampana(id) {
    const resultado = await ejecutarConsulta(
        db.from('campanas').delete().eq('id', id),
        'eliminar campaña'
    );

    if (resultado !== undefined) {
        mostrarExito('Campaña eliminada');
        await cargarCampanas();
    }
}
