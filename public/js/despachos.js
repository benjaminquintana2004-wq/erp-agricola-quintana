// ==============================================
// despachos.js — Despachos de granos + Camiones
// ==============================================

let despachosCargados = [];
let camionesCargados = [];
let lotesParaSelect = [];
let despachoEditandoId = null;
let camionEditandoId = null;

// ==============================================
// CARGAR
// ==============================================

async function cargarDespachos() {
    const [despachos, camiones, lotes] = await Promise.all([
        ejecutarConsulta(
            db.from('despachos')
                .select('*, lotes(nombre, campo), camiones(empresa, patente, chofer)')
                .order('fecha', { ascending: false }),
            'cargar despachos'
        ),
        ejecutarConsulta(
            db.from('camiones').select('*').order('empresa'),
            'cargar camiones'
        ),
        ejecutarConsulta(
            db.from('lotes').select('id, nombre, campo').order('nombre'),
            'cargar lotes'
        )
    ]);

    despachosCargados = despachos || [];
    camionesCargados = camiones || [];
    lotesParaSelect = lotes || [];

    renderizarDespachos();
    renderizarCamiones();
}

// ==============================================
// TABS
// ==============================================

function cambiarTabDespachos(tab) {
    document.querySelectorAll('.despachos-tab').forEach(t => t.classList.remove('activo'));
    document.querySelectorAll('.despachos-seccion').forEach(s => s.classList.remove('activa'));

    if (tab === 'despachos') {
        document.querySelector('.despachos-tab:nth-child(1)').classList.add('activo');
        document.getElementById('seccion-despachos').classList.add('activa');
    } else {
        document.querySelector('.despachos-tab:nth-child(2)').classList.add('activo');
        document.getElementById('seccion-camiones').classList.add('activa');
    }
}

// ==============================================
// DESPACHOS — Renderizar
// ==============================================

function renderizarDespachos() {
    const tbody = document.getElementById('tabla-despachos-body');
    const contador = document.getElementById('contador-despachos');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (contador) contador.textContent = `${despachosCargados.length} despacho${despachosCargados.length !== 1 ? 's' : ''}`;

    if (despachosCargados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="tabla-vacia">No hay despachos registrados</td></tr>`;
        return;
    }

    tbody.innerHTML = despachosCargados.map(d => {
        const loteNombre = d.lotes?.nombre || '—';
        const camionInfo = d.camiones ? `${d.camiones.empresa || ''} ${d.camiones.patente || ''}`.trim() : '—';
        const cpeBadge = d.nro_cpe
            ? `<span class="badge badge-cpe">${d.nro_cpe}</span>`
            : '<span class="badge badge-sin-cpe">Sin CPE</span>';

        return `
        <tr>
            <td>${formatearFecha(d.fecha)}</td>
            <td><strong>${loteNombre}</strong></td>
            <td>${d.cultivo || '—'}</td>
            <td><strong>${formatearQQ(d.qq_netos)}</strong></td>
            <td>${camionInfo}</td>
            <td>${d.destino || '—'}</td>
            <td>${cpeBadge}</td>
            <td>
                <div class="tabla-acciones">
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="editarDespacho('${d.id}')" title="Editar">${ICONOS.editar}</button>
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarDespacho('${d.id}')" title="Eliminar">${ICONOS.eliminar}</button>
                    ` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function buscarDespachos(termino) {
    const t = termino.toLowerCase().trim();
    if (!t) { despachosCargados = [...despachosCargados]; renderizarDespachos(); return; }

    const tbody = document.getElementById('tabla-despachos-body');
    const filtrados = despachosCargados.filter(d =>
        (d.lotes?.nombre && d.lotes.nombre.toLowerCase().includes(t)) ||
        (d.destino && d.destino.toLowerCase().includes(t)) ||
        (d.nro_cpe && d.nro_cpe.includes(t)) ||
        (d.cultivo && d.cultivo.toLowerCase().includes(t))
    );

    const backup = despachosCargados;
    despachosCargados = filtrados;
    renderizarDespachos();
    despachosCargados = backup;
}

// ==============================================
// DESPACHOS — CRUD
// ==============================================

function abrirModalNuevoDespacho() {
    despachoEditandoId = null;
    abrirModalDespacho('Nuevo Despacho', {});
}

function editarDespacho(id) {
    const d = despachosCargados.find(x => x.id === id);
    if (!d) { mostrarError('No se encontró.'); return; }
    despachoEditandoId = id;
    abrirModalDespacho('Editar Despacho', d);
}

function abrirModalDespacho(titulo, datos) {
    const opcionesLotes = lotesParaSelect.map(l =>
        `<option value="${l.id}" ${datos.lote_id === l.id ? 'selected' : ''}>${l.nombre}${l.campo ? ' — ' + l.campo : ''}</option>`
    ).join('');

    const opcionesCamiones = camionesCargados.map(c =>
        `<option value="${c.id}" ${datos.camion_id === c.id ? 'selected' : ''}>${c.empresa || ''} — ${c.patente || ''} (${c.chofer || ''})</option>`
    ).join('');

    const hoy = fechaHoyStr();

    const contenido = `
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Fecha <span class="campo-requerido">*</span></label>
                <input type="text" data-fecha id="campo-fecha" class="campo-input" value="${isoADDMM(datos.fecha || hoy)}" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Lote de origen</label>
                <select id="campo-lote" class="campo-select">
                    <option value="">Seleccionar lote...</option>
                    ${opcionesLotes}
                </select>
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Cultivo</label>
                <select id="campo-cultivo" class="campo-select">
                    <option value="">Seleccionar...</option>
                    <option value="Soja" ${datos.cultivo === 'Soja' ? 'selected' : ''}>Soja</option>
                    <option value="Maíz" ${datos.cultivo === 'Maíz' ? 'selected' : ''}>Maíz</option>
                    <option value="Trigo" ${datos.cultivo === 'Trigo' ? 'selected' : ''}>Trigo</option>
                    <option value="Girasol" ${datos.cultivo === 'Girasol' ? 'selected' : ''}>Girasol</option>
                    <option value="Sorgo" ${datos.cultivo === 'Sorgo' ? 'selected' : ''}>Sorgo</option>
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">QQ netos <span class="campo-requerido">*</span></label>
                <input type="number" id="campo-qq" class="campo-input" value="${datos.qq_netos || ''}" placeholder="Quintales netos despachados" step="0.01" min="0">
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Camión</label>
                <select id="campo-camion" class="campo-select">
                    <option value="">Seleccionar camión...</option>
                    ${opcionesCamiones}
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Destino</label>
                <input type="text" id="campo-destino" class="campo-input" value="${datos.destino || ''}" placeholder="Ej: ACA Berrotarán, Puerto Rosario">
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Nro. CPE (Carta de Porte)</label>
                <input type="text" id="campo-cpe" class="campo-input" value="${datos.nro_cpe || ''}" placeholder="Número de Carta de Porte Electrónica">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Ticket Nro.</label>
                <input type="text" id="campo-ticket" class="campo-input" value="${datos.ticket_nro || ''}" placeholder="Número de ticket correlativo">
            </div>
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarDespacho()">
            ${despachoEditandoId ? 'Guardar cambios' : 'Registrar despacho'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
}

async function guardarDespacho() {
    const fecha = ddmmAISO(document.getElementById('campo-fecha')?.value);
    const qq = document.getElementById('campo-qq')?.value;

    if (!fecha) { mostrarError('La fecha es obligatoria.'); return; }
    if (!qq || parseFloat(qq) <= 0) { mostrarError('Ingresá los QQ netos.'); return; }

    const datos = {
        fecha,
        lote_id: document.getElementById('campo-lote')?.value || null,
        cultivo: document.getElementById('campo-cultivo')?.value || null,
        qq_netos: parseFloat(qq),
        camion_id: document.getElementById('campo-camion')?.value || null,
        destino: document.getElementById('campo-destino')?.value.trim() || null,
        nro_cpe: document.getElementById('campo-cpe')?.value.trim() || null,
        ticket_nro: document.getElementById('campo-ticket')?.value.trim() || null
    };

    let resultado;
    if (despachoEditandoId) {
        resultado = await ejecutarConsulta(db.from('despachos').update(datos).eq('id', despachoEditandoId), 'actualizar despacho');
    } else {
        resultado = await ejecutarConsulta(db.from('despachos').insert(datos), 'crear despacho');
    }

    if (resultado === undefined) return;
    cerrarModal();
    mostrarExito(despachoEditandoId ? 'Despacho actualizado' : 'Despacho registrado');
    despachoEditandoId = null;
    await cargarDespachos();
}

function confirmarEliminarDespacho(id) {
    window.__idEliminar = id;
    abrirModal('Confirmar eliminación',
        '<p style="font-size:var(--texto-lg);color:var(--color-texto);">¿Eliminar este despacho?</p><p style="font-size:var(--texto-sm);color:var(--color-texto-secundario);">Esta acción no se puede deshacer.</p>',
        `<button class="btn-secundario" onclick="cerrarModal()">Cancelar</button><button class="btn-peligro" onclick="cerrarModal(); eliminarDespacho(window.__idEliminar)">Sí, eliminar</button>`
    );
}

async function eliminarDespacho(id) {
    const r = await ejecutarConsulta(db.from('despachos').delete().eq('id', id), 'eliminar despacho');
    if (r !== undefined) { mostrarExito('Despacho eliminado'); await cargarDespachos(); }
}

// ==============================================
// CAMIONES — Renderizar
// ==============================================

function renderizarCamiones() {
    const tbody = document.getElementById('tabla-camiones-body');
    const contador = document.getElementById('contador-camiones');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (contador) contador.textContent = `${camionesCargados.length} camión${camionesCargados.length !== 1 ? 'es' : ''}`;

    if (camionesCargados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="tabla-vacia">No hay camiones registrados</td></tr>`;
        return;
    }

    tbody.innerHTML = camionesCargados.map(c => `
        <tr>
            <td><strong>${c.empresa || '—'}</strong></td>
            <td>${c.patente || '—'}</td>
            <td>${c.chofer || '—'}</td>
            <td>${c.telefono || '—'}</td>
            <td>
                <div class="tabla-acciones">
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="editarCamion('${c.id}')" title="Editar">${ICONOS.editar}</button>
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarCamion('${c.id}', '${(c.empresa || '').replace(/'/g, "\\'")}')" title="Eliminar">${ICONOS.eliminar}</button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

// ==============================================
// CAMIONES — CRUD
// ==============================================

function abrirModalNuevoCamion() {
    camionEditandoId = null;
    abrirModalCamion('Nuevo Camión', {});
}

function editarCamion(id) {
    const c = camionesCargados.find(x => x.id === id);
    if (!c) { mostrarError('No se encontró.'); return; }
    camionEditandoId = id;
    abrirModalCamion('Editar Camión', c);
}

function abrirModalCamion(titulo, datos) {
    const contenido = `
        <div class="campo-grupo">
            <label class="campo-label">Empresa</label>
            <input type="text" id="campo-empresa" class="campo-input" value="${datos.empresa || ''}" placeholder="Ej: Transporte García">
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Patente</label>
                <input type="text" id="campo-patente" class="campo-input" value="${datos.patente || ''}" placeholder="Ej: AB 123 CD">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Chofer</label>
                <input type="text" id="campo-chofer" class="campo-input" value="${datos.chofer || ''}" placeholder="Nombre del chofer">
            </div>
        </div>
        <div class="campo-grupo">
            <label class="campo-label">Teléfono</label>
            <input type="text" id="campo-telefono" class="campo-input" value="${datos.telefono || ''}" placeholder="Teléfono de contacto">
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarCamion()">
            ${camionEditandoId ? 'Guardar cambios' : 'Crear camión'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
}

async function guardarCamion() {
    const datos = {
        empresa: document.getElementById('campo-empresa')?.value.trim() || null,
        patente: document.getElementById('campo-patente')?.value.trim() || null,
        chofer: document.getElementById('campo-chofer')?.value.trim() || null,
        telefono: document.getElementById('campo-telefono')?.value.trim() || null
    };

    if (!datos.empresa && !datos.patente) { mostrarError('Ingresá al menos la empresa o patente.'); return; }

    let resultado;
    if (camionEditandoId) {
        resultado = await ejecutarConsulta(db.from('camiones').update(datos).eq('id', camionEditandoId), 'actualizar camión');
    } else {
        resultado = await ejecutarConsulta(db.from('camiones').insert(datos), 'crear camión');
    }

    if (resultado === undefined) return;
    cerrarModal();
    mostrarExito(camionEditandoId ? 'Camión actualizado' : 'Camión creado');
    camionEditandoId = null;
    await cargarDespachos();
}

function confirmarEliminarCamion(id, nombre) {
    window.__idEliminar = id;
    abrirModal('Confirmar eliminación',
        `<p style="font-size:var(--texto-lg);color:var(--color-texto);">¿Eliminar camión <strong>${nombre}</strong>?</p>`,
        `<button class="btn-secundario" onclick="cerrarModal()">Cancelar</button><button class="btn-peligro" onclick="cerrarModal(); eliminarCamion(window.__idEliminar)">Sí, eliminar</button>`
    );
}

async function eliminarCamion(id) {
    const r = await ejecutarConsulta(db.from('camiones').delete().eq('id', id), 'eliminar camión');
    if (r !== undefined) { mostrarExito('Camión eliminado'); await cargarDespachos(); }
}
