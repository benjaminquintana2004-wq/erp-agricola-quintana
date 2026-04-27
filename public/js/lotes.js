// ==============================================
// lotes.js — CRUD de lotes de campo
// Registrar lotes, asignar cultivos por campaña,
// filtrar por estado, buscar.
// ==============================================

let lotesCargados = [];
let arrendadoresParaSelect = [];
let campanasParaSelect = [];
let campanaActivaId = null;
let loteEditandoId = null;
let filtroEstadoActual = 'todos';

// ==============================================
// LEER — Cargar lotes
// ==============================================

async function cargarLotes() {
    const tbody = document.getElementById('tabla-lotes-body');
    tbody.innerHTML = `
        <tr>
            <td colspan="7" style="text-align: center; padding: var(--espacio-xl);">
                <div class="spinner" style="margin: 0 auto;"></div>
                <p style="color: var(--color-texto-tenue); margin-top: var(--espacio-md);">Cargando lotes...</p>
            </td>
        </tr>
    `;

    // Cargar todo en paralelo
    const [lotes, arrendadores, campanas] = await Promise.all([
        ejecutarConsulta(
            db.from('lotes')
                .select('*, arrendadores(nombre, campo), lote_campanas(*, campanas(nombre, activa))')
                .order('nombre'),
            'cargar lotes'
        ),
        ejecutarConsulta(
            db.from('arrendadores')
                .select('id, nombre, campo')
                .eq('activo', true)
                .order('nombre'),
            'cargar arrendadores'
        ),
        ejecutarConsulta(
            db.from('campanas')
                .select('id, nombre, activa')
                .order('anio_inicio', { ascending: false }),
            'cargar campañas'
        )
    ]);

    if (lotes === undefined) return;

    arrendadoresParaSelect = arrendadores || [];
    campanasParaSelect = campanas || [];
    campanaActivaId = campanas?.find(c => c.activa)?.id || null;

    lotesCargados = lotes;
    renderizarTabla(lotes);
    actualizarContadores(lotes);
}

// ==============================================
// RENDERIZAR — Tabla de lotes
// ==============================================

function renderizarTabla(lotes) {
    let mostrar = lotes;

    if (filtroEstadoActual !== 'todos') {
        mostrar = mostrar.filter(l => l.estado === filtroEstadoActual);
    }

    const tbody = document.getElementById('tabla-lotes-body');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);
    const puedeEliminar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (mostrar.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="tabla-vacia">
                    No hay lotes registrados
                    <p>Hacé click en "Nuevo Lote" para agregar el primero</p>
                </td>
            </tr>
        `;
        actualizarContadorTexto(0);
        return;
    }

    tbody.innerHTML = mostrar.map(l => {
        const nombreArr = l.arrendadores?.nombre || '—';
        const estadoBadge = obtenerBadgeEstado(l.estado);

        // Info de campaña activa
        const campanaActual = l.lote_campanas?.find(lc => lc.campanas?.activa);
        let campanaInfo = '—';
        if (campanaActual) {
            campanaInfo = `
                <span style="font-weight:600;">${campanaActual.cultivo || '?'}</span>
                ${campanaActual.variedad ? `<br><span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${campanaActual.variedad}</span>` : ''}
                ${campanaActual.qq_reales ? `<br><span style="font-size:var(--texto-xs);color:var(--color-verde);font-weight:600;">${formatearQQ(campanaActual.qq_reales)} reales</span>` : ''}
            `;
        }

        return `
        <tr>
            <td><strong>${l.nombre}</strong></td>
            <td>${l.campo || '—'}</td>
            <td>${l.hectareas ? Number(l.hectareas).toLocaleString('es-AR') + ' ha' : '—'}</td>
            <td>${nombreArr}</td>
            <td>${estadoBadge}</td>
            <td>${campanaInfo}</td>
            <td>
                <div class="tabla-acciones">
                    <button class="tabla-btn" onclick="verLote('${l.id}')" title="Ver detalle">
                        ${ICONOS.ver}
                    </button>
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="editarLote('${l.id}')" title="Editar">
                            ${ICONOS.editar}
                        </button>
                    ` : ''}
                    ${puedeEliminar ? `
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarLote('${l.id}', '${l.nombre.replace(/'/g, "\\'")}')" title="Eliminar">
                            ${ICONOS.eliminar}
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');

    actualizarContadorTexto(mostrar.length);
}

function obtenerBadgeEstado(estado) {
    const badges = {
        libre: '<span class="badge badge-libre">Libre</span>',
        en_preparacion: '<span class="badge badge-en-preparacion">En preparación</span>',
        sembrado: '<span class="badge badge-sembrado">Sembrado</span>',
        cosechado: '<span class="badge badge-cosechado">Cosechado</span>',
        barbecho: '<span class="badge badge-barbecho">Barbecho</span>'
    };
    return badges[estado] || '<span class="badge badge-gris">?</span>';
}

function actualizarContadorTexto(cantidad) {
    const contador = document.getElementById('tabla-contador');
    if (contador) {
        contador.textContent = `${cantidad} lote${cantidad !== 1 ? 's' : ''}`;
    }
}

// ==============================================
// CONTADORES Y FILTROS
// ==============================================

function actualizarContadores(lotes) {
    const conteos = {
        todos: lotes.length,
        libre: lotes.filter(l => l.estado === 'libre').length,
        en_preparacion: lotes.filter(l => l.estado === 'en_preparacion').length,
        sembrado: lotes.filter(l => l.estado === 'sembrado').length,
        cosechado: lotes.filter(l => l.estado === 'cosechado').length,
        barbecho: lotes.filter(l => l.estado === 'barbecho').length
    };

    Object.entries(conteos).forEach(([key, val]) => {
        const el = document.getElementById(`cont-${key}`);
        if (el) el.textContent = val;
    });
}

function filtrarPorEstado(estado) {
    filtroEstadoActual = estado;
    document.querySelectorAll('.filtro-btn').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.filtro === estado);
    });
    renderizarTabla(lotesCargados);
}

function buscarLotes(termino) {
    const t = termino.toLowerCase().trim();
    if (!t) {
        renderizarTabla(lotesCargados);
        return;
    }

    const filtrados = lotesCargados.filter(l =>
        (l.nombre && l.nombre.toLowerCase().includes(t)) ||
        (l.campo && l.campo.toLowerCase().includes(t)) ||
        (l.arrendadores?.nombre && l.arrendadores.nombre.toLowerCase().includes(t))
    );

    const backup = lotesCargados;
    lotesCargados = filtrados;
    renderizarTabla(filtrados);
    lotesCargados = backup;
}

// ==============================================
// CREAR / EDITAR — Modal
// ==============================================

function abrirModalNuevoLote() {
    loteEditandoId = null;
    abrirModalLote('Nuevo Lote', {});
}

async function editarLote(id) {
    const lote = lotesCargados.find(l => l.id === id);
    if (!lote) {
        mostrarError('No se encontró el lote.');
        return;
    }
    loteEditandoId = id;
    abrirModalLote('Editar Lote', lote);
}

function abrirModalLote(titulo, datos) {
    const opcionesArrendadores = arrendadoresParaSelect.map(a =>
        `<option value="${a.id}" ${datos.arrendador_id === a.id ? 'selected' : ''}>${a.nombre}${a.campo ? ' — ' + a.campo : ''}</option>`
    ).join('');

    // Obtener datos de campaña activa si estamos editando
    const campanaActual = datos.lote_campanas?.find(lc => lc.campanas?.activa);
    const campanaActivaNombre = campanasParaSelect.find(c => c.activa)?.nombre || '';

    const contenido = `
        <div class="form-seccion-titulo">Datos del lote</div>

        <div class="campo-grupo">
            <label class="campo-label">Nombre del lote <span class="campo-requerido">*</span></label>
            <input type="text" id="campo-nombre" class="campo-input" value="${datos.nombre || ''}" placeholder="Ej: Lote 5 Norte">
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Ubicación / Campo</label>
                <input type="text" id="campo-campo" class="campo-input" value="${datos.campo || ''}" placeholder="Ej: Villa Ascasubi">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Hectáreas</label>
                <input type="number" id="campo-hectareas" class="campo-input" value="${datos.hectareas || ''}" placeholder="Ej: 150" step="0.01" min="0">
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Arrendador</label>
                <select id="campo-arrendador" class="campo-select">
                    <option value="">Sin arrendador vinculado</option>
                    ${opcionesArrendadores}
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Estado <span class="campo-requerido">*</span></label>
                <select id="campo-estado" class="campo-select">
                    <option value="libre" ${datos.estado === 'libre' || !datos.estado ? 'selected' : ''}>Libre</option>
                    <option value="en_preparacion" ${datos.estado === 'en_preparacion' ? 'selected' : ''}>En preparación</option>
                    <option value="sembrado" ${datos.estado === 'sembrado' ? 'selected' : ''}>Sembrado</option>
                    <option value="cosechado" ${datos.estado === 'cosechado' ? 'selected' : ''}>Cosechado</option>
                    <option value="barbecho" ${datos.estado === 'barbecho' ? 'selected' : ''}>Barbecho</option>
                </select>
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Latitud</label>
                <input type="number" id="campo-lat" class="campo-input" value="${datos.lat || ''}" placeholder="Ej: -31.4507" step="any">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Longitud</label>
                <input type="number" id="campo-lng" class="campo-input" value="${datos.lng || ''}" placeholder="Ej: -64.1827" step="any">
            </div>
        </div>

        ${campanaActivaId ? `
            <hr class="form-separador">
            <div class="form-seccion-titulo">Campaña ${campanaActivaNombre}</div>

            <div class="campos-fila">
                <div class="campo-grupo">
                    <label class="campo-label">Cultivo</label>
                    <select id="campo-cultivo" class="campo-select">
                        <option value="">Sin cultivo</option>
                        <option value="Soja" ${campanaActual?.cultivo === 'Soja' ? 'selected' : ''}>Soja</option>
                        <option value="Maíz" ${campanaActual?.cultivo === 'Maíz' ? 'selected' : ''}>Maíz</option>
                        <option value="Trigo" ${campanaActual?.cultivo === 'Trigo' ? 'selected' : ''}>Trigo</option>
                        <option value="Girasol" ${campanaActual?.cultivo === 'Girasol' ? 'selected' : ''}>Girasol</option>
                        <option value="Sorgo" ${campanaActual?.cultivo === 'Sorgo' ? 'selected' : ''}>Sorgo</option>
                    </select>
                </div>
                <div class="campo-grupo">
                    <label class="campo-label">Variedad</label>
                    <input type="text" id="campo-variedad" class="campo-input" value="${campanaActual?.variedad || ''}" placeholder="Ej: DM 46i17">
                </div>
            </div>

            <div class="campos-fila">
                <div class="campo-grupo">
                    <label class="campo-label">Fecha de siembra</label>
                    <input type="text" data-fecha id="campo-fecha-siembra" class="campo-input" value="${isoADDMM(campanaActual?.fecha_siembra)}" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
                </div>
                <div class="campo-grupo">
                    <label class="campo-label">QQ/ha estimados</label>
                    <input type="number" id="campo-qq-estimados" class="campo-input" value="${campanaActual?.qq_estimados || ''}" placeholder="Ej: 35" step="0.01" min="0">
                </div>
            </div>

            <div class="campos-fila">
                <div class="campo-grupo">
                    <label class="campo-label">QQ/ha reales (al cosechar)</label>
                    <input type="number" id="campo-qq-reales" class="campo-input" value="${campanaActual?.qq_reales || ''}" placeholder="Se completa al cosechar" step="0.01" min="0">
                </div>
                <div class="campo-grupo"></div>
            </div>
        ` : `
            <hr class="form-separador">
            <div style="color:var(--color-texto-tenue); font-size:var(--texto-sm); padding:var(--espacio-md) 0;">
                No hay campaña activa. Creá una en la sección Campañas para asignar cultivos.
            </div>
        `}
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarLote()">
            ${loteEditandoId ? 'Guardar cambios' : 'Crear lote'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
    setTimeout(() => document.getElementById('campo-nombre')?.focus(), 100);
}

// ==============================================
// GUARDAR
// ==============================================

async function guardarLote() {
    const nombre = document.getElementById('campo-nombre')?.value.trim();
    const campo = document.getElementById('campo-campo')?.value.trim();
    const hectareas = document.getElementById('campo-hectareas')?.value;
    const arrendadorId = document.getElementById('campo-arrendador')?.value;
    const estado = document.getElementById('campo-estado')?.value;
    const lat = document.getElementById('campo-lat')?.value;
    const lng = document.getElementById('campo-lng')?.value;

    if (!nombre) {
        mostrarError('El nombre del lote es obligatorio.');
        return;
    }

    const datosLote = {
        nombre,
        campo: campo || null,
        hectareas: hectareas ? parseFloat(hectareas) : null,
        arrendador_id: arrendadorId || null,
        estado: estado || 'libre',
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null
    };

    let loteId = loteEditandoId;

    if (loteEditandoId) {
        const resultado = await ejecutarConsulta(
            db.from('lotes').update(datosLote).eq('id', loteEditandoId).select(),
            'actualizar lote'
        );
        if (resultado === undefined) return;
    } else {
        const resultado = await ejecutarConsulta(
            db.from('lotes').insert(datosLote).select(),
            'crear lote'
        );
        if (resultado === undefined) return;
        loteId = resultado[0]?.id;
    }

    // Guardar datos de campaña activa si hay
    if (campanaActivaId && loteId) {
        await guardarLoteCampana(loteId);
    }

    cerrarModal();
    mostrarExito(loteEditandoId ? 'Lote actualizado' : 'Lote creado');
    loteEditandoId = null;
    await cargarLotes();
}

/**
 * Guarda o actualiza la asociación lote-campaña activa.
 * Usa upsert para crear o actualizar según exista.
 */
async function guardarLoteCampana(loteId) {
    const cultivo = document.getElementById('campo-cultivo')?.value;
    const variedad = document.getElementById('campo-variedad')?.value.trim();
    const fechaSiembra = ddmmAISO(document.getElementById('campo-fecha-siembra')?.value);
    const qqEstimados = document.getElementById('campo-qq-estimados')?.value;
    const qqReales = document.getElementById('campo-qq-reales')?.value;

    // Si no hay cultivo, no guardar
    if (!cultivo) return;

    const datos = {
        lote_id: loteId,
        campana_id: campanaActivaId,
        cultivo: cultivo || null,
        variedad: variedad || null,
        fecha_siembra: fechaSiembra || null,
        qq_estimados: qqEstimados ? parseFloat(qqEstimados) : null,
        qq_reales: qqReales ? parseFloat(qqReales) : null,
        cerrada: qqReales ? true : false
    };

    // Intentar buscar si ya existe
    const existente = await ejecutarConsulta(
        db.from('lote_campanas')
            .select('id')
            .eq('lote_id', loteId)
            .eq('campana_id', campanaActivaId),
        'buscar lote-campaña'
    );

    if (existente && existente.length > 0) {
        await ejecutarConsulta(
            db.from('lote_campanas')
                .update(datos)
                .eq('id', existente[0].id),
            'actualizar lote-campaña'
        );
    } else {
        await ejecutarConsulta(
            db.from('lote_campanas').insert(datos),
            'crear lote-campaña'
        );
    }
}

// ==============================================
// VER DETALLE
// ==============================================

function verLote(id) {
    const l = lotesCargados.find(lote => lote.id === id);
    if (!l) {
        mostrarError('No se encontró el lote.');
        return;
    }

    const estadoBadge = obtenerBadgeEstado(l.estado);
    const nombreArr = l.arrendadores?.nombre || '—';

    // Historial de campañas
    let historialHTML = '';
    if (l.lote_campanas && l.lote_campanas.length > 0) {
        const campanas = l.lote_campanas.sort((a, b) => {
            const na = a.campanas?.nombre || '';
            const nb = b.campanas?.nombre || '';
            return nb.localeCompare(na);
        });

        historialHTML = `
            <hr class="form-separador">
            <div class="form-seccion-titulo">Historial de cultivos</div>
            <table class="tabla" style="font-size: var(--texto-sm);">
                <thead>
                    <tr>
                        <th>Campaña</th>
                        <th>Cultivo</th>
                        <th>Variedad</th>
                        <th>Siembra</th>
                        <th>QQ/ha est.</th>
                        <th>QQ/ha real</th>
                        <th>Resultado</th>
                    </tr>
                </thead>
                <tbody>
                    ${campanas.map(lc => {
                        let comparativa = '';
                        if (lc.qq_estimados && lc.qq_reales) {
                            const diff = lc.qq_reales - lc.qq_estimados;
                            const pct = ((diff / lc.qq_estimados) * 100).toFixed(1);
                            if (diff > 0) {
                                comparativa = `<span class="comparativa comparativa-arriba">+${pct}%</span>`;
                            } else if (diff < 0) {
                                comparativa = `<span class="comparativa comparativa-abajo">${pct}%</span>`;
                            } else {
                                comparativa = '<span class="comparativa">= estimado</span>';
                            }
                        }

                        return `
                        <tr>
                            <td>${lc.campanas?.nombre || '—'} ${lc.campanas?.activa ? '<span class="badge badge-verde" style="font-size:0.6rem;padding:1px 5px;">Activa</span>' : ''}</td>
                            <td><strong>${lc.cultivo || '—'}</strong></td>
                            <td>${lc.variedad || '—'}</td>
                            <td>${lc.fecha_siembra ? formatearFecha(lc.fecha_siembra) : '—'}</td>
                            <td>${lc.qq_estimados || '—'}</td>
                            <td>${lc.qq_reales || '—'}</td>
                            <td>${comparativa}</td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    const contenido = `
        <div class="contrato-detalle-grid">
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Nombre</span>
                <span class="contrato-detalle-valor"><strong>${l.nombre}</strong></span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Ubicación</span>
                <span class="contrato-detalle-valor">${l.campo || '—'}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Hectáreas</span>
                <span class="contrato-detalle-valor">${l.hectareas ? Number(l.hectareas).toLocaleString('es-AR') + ' ha' : '—'}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Arrendador</span>
                <span class="contrato-detalle-valor">${nombreArr}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Estado</span>
                <span class="contrato-detalle-valor">${estadoBadge}</span>
            </div>
            ${l.lat && l.lng ? `
                <div class="contrato-detalle-item">
                    <span class="contrato-detalle-label">Coordenadas</span>
                    <span class="contrato-detalle-valor">${l.lat}, ${l.lng}</span>
                </div>
            ` : ''}
        </div>
        ${historialHTML}
    `;

    const footer = `<button class="btn-secundario" onclick="cerrarModal()">Cerrar</button>`;
    abrirModal(`Lote — ${l.nombre}`, contenido, footer);
}

// ==============================================
// ELIMINAR
// ==============================================

function confirmarEliminarLote(id, nombre) {
    window.__idEliminarLote = id;
    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto); margin-bottom: var(--espacio-md);">
            ¿Seguro que querés eliminar el lote <strong>${nombre}</strong>?
        </p>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">
            Se eliminará el historial de cultivos de todas las campañas.
            Esta acción no se puede deshacer.
        </p>
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-peligro" onclick="cerrarModal(); eliminarLote(window.__idEliminarLote)">
            Sí, eliminar
        </button>
    `;
    abrirModal('Confirmar eliminación', contenido, footer);
}

async function eliminarLote(id) {
    const resultado = await ejecutarConsulta(
        db.from('lotes').delete().eq('id', id),
        'eliminar lote'
    );

    if (resultado !== undefined) {
        mostrarExito('Lote eliminado');
        await cargarLotes();
    }
}
