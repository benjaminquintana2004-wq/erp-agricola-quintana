// ==============================================
// stock.js — Stock de granos: Silobolsas y Acopios
// CRUD de silobolsas, acopios, resumen por grano.
// ==============================================

let silobolsasCargadas = [];
let acopiosCargados = [];
let lotesParaSelect = [];

// ==============================================
// CARGAR TODO
// ==============================================

async function cargarStock() {
    const [silobolsas, acopios, lotes] = await Promise.all([
        ejecutarConsulta(
            db.from('silobolsas')
                .select('*, lotes(nombre, campo), campanas(nombre)')
                .order('fecha_armado', { ascending: false }),
            'cargar silobolsas'
        ),
        ejecutarConsulta(
            db.from('acopios')
                .select('*, stock_acopio(grano, qq_depositados)')
                .order('nombre'),
            'cargar acopios'
        ),
        ejecutarConsulta(
            db.from('lotes')
                .select('id, nombre, campo')
                .order('nombre'),
            'cargar lotes'
        )
    ]);

    silobolsasCargadas = silobolsas || [];
    acopiosCargados = acopios || [];
    lotesParaSelect = lotes || [];

    renderizarResumen();
    renderizarSilobolsas();
    renderizarAcopios();
}

// ==============================================
// RESUMEN POR GRANO
// ==============================================

function renderizarResumen() {
    const contenedor = document.getElementById('stock-resumen');
    if (!contenedor) return;

    // Agrupar QQ por grano (silobolsas activas + stock en acopios)
    const porGrano = {};

    silobolsasCargadas
        .filter(s => s.estado !== 'descartada')
        .forEach(s => {
            const grano = s.grano || 'Otro';
            if (!porGrano[grano]) porGrano[grano] = { silobolsas: 0, acopios: 0 };
            porGrano[grano].silobolsas += parseFloat(s.qq_actuales || 0);
        });

    acopiosCargados.forEach(a => {
        if (a.stock_acopio) {
            a.stock_acopio.forEach(sa => {
                const grano = sa.grano || 'Otro';
                if (!porGrano[grano]) porGrano[grano] = { silobolsas: 0, acopios: 0 };
                porGrano[grano].acopios += parseFloat(sa.qq_depositados || 0);
            });
        }
    });

    const granos = Object.entries(porGrano);

    if (granos.length === 0) {
        contenedor.innerHTML = '';
        return;
    }

    contenedor.innerHTML = granos.map(([grano, datos]) => {
        const total = datos.silobolsas + datos.acopios;
        return `
        <div class="stock-resumen-tarjeta">
            <div class="stock-resumen-grano">${grano}</div>
            <div class="stock-resumen-qq">${formatearQQ(total)}</div>
            <div class="stock-resumen-detalle">
                ${datos.silobolsas > 0 ? `Silobolsas: ${formatearQQ(datos.silobolsas)}` : ''}
                ${datos.silobolsas > 0 && datos.acopios > 0 ? ' · ' : ''}
                ${datos.acopios > 0 ? `Acopios: ${formatearQQ(datos.acopios)}` : ''}
            </div>
        </div>
        `;
    }).join('');
}

// ==============================================
// TABS
// ==============================================

function cambiarTab(tab) {
    document.querySelectorAll('.stock-tab').forEach(t => t.classList.remove('activo'));
    document.querySelectorAll('.stock-seccion').forEach(s => s.classList.remove('activa'));

    if (tab === 'silobolsas') {
        document.querySelector('.stock-tab:nth-child(1)').classList.add('activo');
        document.getElementById('seccion-silobolsas').classList.add('activa');
    } else {
        document.querySelector('.stock-tab:nth-child(2)').classList.add('activo');
        document.getElementById('seccion-acopios').classList.add('activa');
    }
}

// ==============================================
// SILOBOLSAS — Renderizar
// ==============================================

function renderizarSilobolsas() {
    const tbody = document.getElementById('tabla-silobolsas-body');
    const contador = document.getElementById('contador-silobolsas');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (contador) contador.textContent = `${silobolsasCargadas.length} silobolsa${silobolsasCargadas.length !== 1 ? 's' : ''}`;

    if (silobolsasCargadas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="tabla-vacia">No hay silobolsas registradas</td></tr>`;
        return;
    }

    tbody.innerHTML = silobolsasCargadas.map(s => {
        const loteNombre = s.lotes?.nombre || '—';
        const estadoBadge = obtenerBadgeSilobolsa(s.estado);
        const porcentaje = s.qq_iniciales > 0 ? ((s.qq_actuales / s.qq_iniciales) * 100).toFixed(0) : 0;

        let calidadHTML = '';
        if (s.humedad || s.proteina || s.peso_hectolitrico) {
            calidadHTML = `<div class="calidad-grid">
                ${s.humedad ? `<div class="calidad-item"><div class="calidad-valor">${s.humedad}%</div><div class="calidad-label">Humedad</div></div>` : ''}
                ${s.proteina ? `<div class="calidad-item"><div class="calidad-valor">${s.proteina}%</div><div class="calidad-label">Proteína</div></div>` : ''}
                ${s.peso_hectolitrico ? `<div class="calidad-item"><div class="calidad-valor">${s.peso_hectolitrico}</div><div class="calidad-label">PH</div></div>` : ''}
                ${s.cuerpos_extranos ? `<div class="calidad-item"><div class="calidad-valor">${s.cuerpos_extranos}%</div><div class="calidad-label">CE</div></div>` : ''}
            </div>`;
        } else {
            calidadHTML = '<span style="color:var(--color-texto-tenue);">—</span>';
        }

        return `
        <tr>
            <td><strong>${loteNombre}</strong>${s.lotes?.campo ? `<br><span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${s.lotes.campo}</span>` : ''}</td>
            <td>${s.grano}</td>
            <td>${formatearQQ(s.qq_iniciales)}</td>
            <td>
                <strong>${formatearQQ(s.qq_actuales)}</strong>
                <br><span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${porcentaje}% restante</span>
            </td>
            <td>${calidadHTML}</td>
            <td>${formatearFecha(s.fecha_armado)}</td>
            <td>${estadoBadge}</td>
            <td>
                <div class="tabla-acciones">
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="editarSilobolsa('${s.id}')" title="Editar">
                            ${ICONOS.editar}
                        </button>
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarSilobolsa('${s.id}')" title="Eliminar">
                            ${ICONOS.eliminar}
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function obtenerBadgeSilobolsa(estado) {
    const badges = {
        activa: '<span class="badge badge-silo-activa">Activa</span>',
        en_uso: '<span class="badge badge-silo-en-uso">En uso</span>',
        vacia: '<span class="badge badge-silo-vacia">Vacía</span>',
        descartada: '<span class="badge badge-silo-descartada">Descartada</span>'
    };
    return badges[estado] || '<span class="badge badge-gris">?</span>';
}

// ==============================================
// SILOBOLSAS — CRUD
// ==============================================

let silobolsaEditandoId = null;

function abrirModalNuevaSilobolsa() {
    silobolsaEditandoId = null;
    abrirModalSilobolsa('Nueva Silobolsa', {});
}

function editarSilobolsa(id) {
    const silo = silobolsasCargadas.find(s => s.id === id);
    if (!silo) { mostrarError('No se encontró la silobolsa.'); return; }
    silobolsaEditandoId = id;
    abrirModalSilobolsa('Editar Silobolsa', silo);
}

function abrirModalSilobolsa(titulo, datos) {
    const opcionesLotes = lotesParaSelect.map(l =>
        `<option value="${l.id}" ${datos.lote_id === l.id ? 'selected' : ''}>${l.nombre}${l.campo ? ' — ' + l.campo : ''}</option>`
    ).join('');

    const hoy = new Date().toISOString().split('T')[0];

    const contenido = `
        <div class="form-seccion-titulo">Ubicación y grano</div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Lote <span class="campo-requerido">*</span></label>
                <select id="campo-lote" class="campo-select">
                    <option value="">Seleccionar lote...</option>
                    ${opcionesLotes}
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Grano <span class="campo-requerido">*</span></label>
                <select id="campo-grano" class="campo-select">
                    <option value="">Seleccionar...</option>
                    <option value="Soja" ${datos.grano === 'Soja' ? 'selected' : ''}>Soja</option>
                    <option value="Maíz" ${datos.grano === 'Maíz' ? 'selected' : ''}>Maíz</option>
                    <option value="Trigo" ${datos.grano === 'Trigo' ? 'selected' : ''}>Trigo</option>
                    <option value="Girasol" ${datos.grano === 'Girasol' ? 'selected' : ''}>Girasol</option>
                    <option value="Sorgo" ${datos.grano === 'Sorgo' ? 'selected' : ''}>Sorgo</option>
                </select>
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Fecha de armado <span class="campo-requerido">*</span></label>
                <input type="date" id="campo-fecha" class="campo-input" value="${datos.fecha_armado || hoy}">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Estado</label>
                <select id="campo-estado" class="campo-select">
                    <option value="activa" ${datos.estado === 'activa' || !datos.estado ? 'selected' : ''}>Activa</option>
                    <option value="en_uso" ${datos.estado === 'en_uso' ? 'selected' : ''}>En uso</option>
                    <option value="vacia" ${datos.estado === 'vacia' ? 'selected' : ''}>Vacía</option>
                    <option value="descartada" ${datos.estado === 'descartada' ? 'selected' : ''}>Descartada</option>
                </select>
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">QQ iniciales <span class="campo-requerido">*</span></label>
                <input type="number" id="campo-qq-iniciales" class="campo-input" value="${datos.qq_iniciales || ''}" placeholder="QQ cargados al armar" step="0.01" min="0">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">QQ actuales</label>
                <input type="number" id="campo-qq-actuales" class="campo-input" value="${datos.qq_actuales || ''}" placeholder="QQ disponibles hoy" step="0.01" min="0">
                <span class="campo-ayuda">Si es nueva, es igual a QQ iniciales</span>
            </div>
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo">Datos de calidad (opcional)</div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Humedad (%)</label>
                <input type="number" id="campo-humedad" class="campo-input" value="${datos.humedad || ''}" placeholder="Ej: 13.5" step="0.01" min="0" max="100">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Proteína (%)</label>
                <input type="number" id="campo-proteina" class="campo-input" value="${datos.proteina || ''}" placeholder="Ej: 36" step="0.01" min="0" max="100">
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Peso hectolítrico</label>
                <input type="number" id="campo-ph" class="campo-input" value="${datos.peso_hectolitrico || ''}" placeholder="Ej: 78.5" step="0.01" min="0">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Cuerpos extraños (%)</label>
                <input type="number" id="campo-ce" class="campo-input" value="${datos.cuerpos_extranos || ''}" placeholder="Ej: 1.2" step="0.01" min="0" max="100">
            </div>
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo">Coordenadas GPS (opcional)</div>

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
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarSilobolsa()">
            ${silobolsaEditandoId ? 'Guardar cambios' : 'Crear silobolsa'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
}

async function guardarSilobolsa() {
    const loteId = document.getElementById('campo-lote')?.value;
    const grano = document.getElementById('campo-grano')?.value;
    const fecha = document.getElementById('campo-fecha')?.value;
    const estado = document.getElementById('campo-estado')?.value;
    const qqIniciales = document.getElementById('campo-qq-iniciales')?.value;
    const qqActuales = document.getElementById('campo-qq-actuales')?.value;

    if (!loteId) { mostrarError('Seleccioná un lote.'); return; }
    if (!grano) { mostrarError('Seleccioná el grano.'); return; }
    if (!fecha) { mostrarError('La fecha es obligatoria.'); return; }
    if (!qqIniciales || parseFloat(qqIniciales) <= 0) { mostrarError('Ingresá los QQ iniciales.'); return; }

    const datos = {
        lote_id: loteId,
        grano,
        fecha_armado: fecha,
        estado: estado || 'activa',
        qq_iniciales: parseFloat(qqIniciales),
        qq_actuales: qqActuales ? parseFloat(qqActuales) : parseFloat(qqIniciales),
        humedad: document.getElementById('campo-humedad')?.value ? parseFloat(document.getElementById('campo-humedad').value) : null,
        proteina: document.getElementById('campo-proteina')?.value ? parseFloat(document.getElementById('campo-proteina').value) : null,
        peso_hectolitrico: document.getElementById('campo-ph')?.value ? parseFloat(document.getElementById('campo-ph').value) : null,
        cuerpos_extranos: document.getElementById('campo-ce')?.value ? parseFloat(document.getElementById('campo-ce').value) : null,
        lat: document.getElementById('campo-lat')?.value ? parseFloat(document.getElementById('campo-lat').value) : null,
        lng: document.getElementById('campo-lng')?.value ? parseFloat(document.getElementById('campo-lng').value) : null
    };

    // Obtener campaña activa
    const campanas = await ejecutarConsulta(
        db.from('campanas').select('id').eq('activa', true).limit(1),
        'campaña activa'
    );
    if (campanas?.[0]) datos.campana_id = campanas[0].id;

    let resultado;
    if (silobolsaEditandoId) {
        resultado = await ejecutarConsulta(
            db.from('silobolsas').update(datos).eq('id', silobolsaEditandoId),
            'actualizar silobolsa'
        );
    } else {
        resultado = await ejecutarConsulta(
            db.from('silobolsas').insert(datos),
            'crear silobolsa'
        );
    }

    if (resultado === undefined) return;

    cerrarModal();
    mostrarExito(silobolsaEditandoId ? 'Silobolsa actualizada' : 'Silobolsa creada');
    silobolsaEditandoId = null;
    await cargarStock();
}

function confirmarEliminarSilobolsa(id) {
    window.__idEliminarSilo = id;
    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto);">¿Eliminar esta silobolsa?</p>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">Esta acción no se puede deshacer.</p>
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-peligro" onclick="cerrarModal(); eliminarSilobolsa(window.__idEliminarSilo)">Sí, eliminar</button>
    `;
    abrirModal('Confirmar eliminación', contenido, footer);
}

async function eliminarSilobolsa(id) {
    const r = await ejecutarConsulta(db.from('silobolsas').delete().eq('id', id), 'eliminar silobolsa');
    if (r !== undefined) { mostrarExito('Silobolsa eliminada'); await cargarStock(); }
}

// ==============================================
// ACOPIOS — Renderizar
// ==============================================

function renderizarAcopios() {
    const tbody = document.getElementById('tabla-acopios-body');
    const contador = document.getElementById('contador-acopios');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (contador) contador.textContent = `${acopiosCargados.length} acopio${acopiosCargados.length !== 1 ? 's' : ''}`;

    if (acopiosCargados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="tabla-vacia">No hay acopios registrados</td></tr>`;
        return;
    }

    tbody.innerHTML = acopiosCargados.map(a => {
        // Calcular stock total depositado
        let stockHTML = '—';
        if (a.stock_acopio && a.stock_acopio.length > 0) {
            stockHTML = a.stock_acopio.map(sa =>
                `<strong>${formatearQQ(sa.qq_depositados)}</strong> <span style="color:var(--color-texto-tenue);">${sa.grano}</span>`
            ).join('<br>');
        }

        return `
        <tr>
            <td><strong>${a.nombre}</strong></td>
            <td>${a.ubicacion || '—'}</td>
            <td>${a.contacto || '—'}</td>
            <td>${a.tarifa_qq_mes ? formatearMoneda(a.tarifa_qq_mes) : '—'}</td>
            <td>${stockHTML}</td>
            <td>
                <div class="tabla-acciones">
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="editarAcopio('${a.id}')" title="Editar">
                            ${ICONOS.editar}
                        </button>
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarAcopio('${a.id}', '${a.nombre.replace(/'/g, "\\'")}')" title="Eliminar">
                            ${ICONOS.eliminar}
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

// ==============================================
// ACOPIOS — CRUD
// ==============================================

let acopioEditandoId = null;

function abrirModalNuevoAcopio() {
    acopioEditandoId = null;
    abrirModalAcopio('Nuevo Acopio', {});
}

function editarAcopio(id) {
    const acopio = acopiosCargados.find(a => a.id === id);
    if (!acopio) { mostrarError('No se encontró el acopio.'); return; }
    acopioEditandoId = id;
    abrirModalAcopio('Editar Acopio', acopio);
}

function abrirModalAcopio(titulo, datos) {
    const contenido = `
        <div class="campo-grupo">
            <label class="campo-label">Nombre <span class="campo-requerido">*</span></label>
            <input type="text" id="campo-acopio-nombre" class="campo-input" value="${datos.nombre || ''}" placeholder="Ej: ACA Berrotarán">
        </div>
        <div class="campo-grupo">
            <label class="campo-label">Ubicación</label>
            <input type="text" id="campo-acopio-ubicacion" class="campo-input" value="${datos.ubicacion || ''}" placeholder="Ej: Ruta 36 km 520, Berrotarán">
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Contacto</label>
                <input type="text" id="campo-acopio-contacto" class="campo-input" value="${datos.contacto || ''}" placeholder="Teléfono o nombre de contacto">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Tarifa ($/qq/mes)</label>
                <input type="number" id="campo-acopio-tarifa" class="campo-input" value="${datos.tarifa_qq_mes || ''}" placeholder="Costo por quintal por mes" step="0.01" min="0">
            </div>
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarAcopio()">
            ${acopioEditandoId ? 'Guardar cambios' : 'Crear acopio'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
    setTimeout(() => document.getElementById('campo-acopio-nombre')?.focus(), 100);
}

async function guardarAcopio() {
    const nombre = document.getElementById('campo-acopio-nombre')?.value.trim();
    if (!nombre) { mostrarError('El nombre es obligatorio.'); return; }

    const datos = {
        nombre,
        ubicacion: document.getElementById('campo-acopio-ubicacion')?.value.trim() || null,
        contacto: document.getElementById('campo-acopio-contacto')?.value.trim() || null,
        tarifa_qq_mes: document.getElementById('campo-acopio-tarifa')?.value ? parseFloat(document.getElementById('campo-acopio-tarifa').value) : 0
    };

    let resultado;
    if (acopioEditandoId) {
        resultado = await ejecutarConsulta(db.from('acopios').update(datos).eq('id', acopioEditandoId), 'actualizar acopio');
    } else {
        resultado = await ejecutarConsulta(db.from('acopios').insert(datos), 'crear acopio');
    }

    if (resultado === undefined) return;

    cerrarModal();
    mostrarExito(acopioEditandoId ? 'Acopio actualizado' : 'Acopio creado');
    acopioEditandoId = null;
    await cargarStock();
}

function confirmarEliminarAcopio(id, nombre) {
    window.__idEliminarAcopio = id;
    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto);">¿Eliminar el acopio <strong>${nombre}</strong>?</p>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">Se eliminará el stock depositado asociado. Esta acción no se puede deshacer.</p>
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-peligro" onclick="cerrarModal(); eliminarAcopio(window.__idEliminarAcopio)">Sí, eliminar</button>
    `;
    abrirModal('Confirmar eliminación', contenido, footer);
}

async function eliminarAcopio(id) {
    const r = await ejecutarConsulta(db.from('acopios').delete().eq('id', id), 'eliminar acopio');
    if (r !== undefined) { mostrarExito('Acopio eliminado'); await cargarStock(); }
}
