// ==============================================
// contratistas.js — Contratistas + Trabajos
// ==============================================

let contratistasCargados = [];
let trabajosCargados = [];
let lotesParaSelectContratistas = [];
let contratistaEditandoId = null;
let trabajoEditandoId = null;

// ==============================================
// CARGAR
// ==============================================

async function cargarContratistas() {
    const [contratistas, trabajos, lotes] = await Promise.all([
        ejecutarConsulta(
            db.from('contratistas').select('*').order('nombre'),
            'cargar contratistas'
        ),
        ejecutarConsulta(
            db.from('trabajos_contratistas')
                .select('*, contratistas(nombre), lotes(nombre, campo)')
                .order('fecha', { ascending: false }),
            'cargar trabajos'
        ),
        ejecutarConsulta(
            db.from('lotes').select('id, nombre, campo').order('nombre'),
            'cargar lotes'
        )
    ]);

    contratistasCargados = contratistas || [];
    trabajosCargados = trabajos || [];
    lotesParaSelectContratistas = lotes || [];

    renderizarResumen();
    renderizarContratistas();
    renderizarTrabajos();
}

// ==============================================
// RESUMEN
// ==============================================

function renderizarResumen() {
    const container = document.getElementById('resumen-contratistas');
    const totalContratistas = contratistasCargados.length;
    const pendientes = trabajosCargados.filter(t => !t.pagado);
    const montoPendiente = pendientes.reduce((sum, t) => sum + (t.precio || 0), 0);
    const montoPagado = trabajosCargados.filter(t => t.pagado).reduce((sum, t) => sum + (t.precio || 0), 0);

    container.innerHTML = `
        <div class="contratista-stat">
            <div class="contratista-stat-valor">${totalContratistas}</div>
            <div class="contratista-stat-label">Contratistas</div>
        </div>
        <div class="contratista-stat">
            <div class="contratista-stat-valor pendiente">$${formatearNumero(montoPendiente)}</div>
            <div class="contratista-stat-label">${pendientes.length} trabajo${pendientes.length !== 1 ? 's' : ''} pendiente${pendientes.length !== 1 ? 's' : ''} de pago</div>
        </div>
        <div class="contratista-stat">
            <div class="contratista-stat-valor pagado">$${formatearNumero(montoPagado)}</div>
            <div class="contratista-stat-label">Total pagado</div>
        </div>
    `;
}

// ==============================================
// TABS
// ==============================================

function cambiarTabContratistas(tab) {
    document.querySelectorAll('.contratistas-tab').forEach(t => t.classList.remove('activo'));
    document.querySelectorAll('.contratistas-seccion').forEach(s => s.classList.remove('activa'));

    const tabs = { contratistas: 1, trabajos: 2, cheques: 3 };
    const idx = tabs[tab] || 1;
    document.querySelector(`.contratistas-tab:nth-child(${idx})`).classList.add('activo');
    document.getElementById(`seccion-${tab}`).classList.add('activa');

    if (tab === 'cheques') poblarSelectChequesContratista();
}

// ==============================================
// CONTRATISTAS — Renderizar
// ==============================================

function renderizarContratistas() {
    const tbody = document.getElementById('tabla-contratistas-body');
    const contador = document.getElementById('contador-contratistas');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (contador) contador.textContent = `${contratistasCargados.length} contratista${contratistasCargados.length !== 1 ? 's' : ''}`;

    if (contratistasCargados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="tabla-vacia">No hay contratistas registrados</td></tr>`;
        return;
    }

    tbody.innerHTML = contratistasCargados.map(c => {
        // Calcular trabajos y deuda de este contratista
        const trabajos = trabajosCargados.filter(t => t.contratista_id === c.id);
        const cantTrabajos = trabajos.length;
        const deudaPendiente = trabajos.filter(t => !t.pagado).reduce((sum, t) => sum + (t.precio || 0), 0);

        return `
        <tr>
            <td><strong>${c.nombre || '—'}</strong></td>
            <td>${c.cuit || '—'}</td>
            <td>${c.telefono || '—'}</td>
            <td>${c.especialidad || '—'}</td>
            <td>${cantTrabajos}</td>
            <td>${deudaPendiente > 0
                ? `<span class="badge badge-pendiente">$${formatearNumero(deudaPendiente)}</span>`
                : '<span class="badge badge-pagado">Al día</span>'
            }</td>
            <td>
                <div class="tabla-acciones">
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="editarContratista('${c.id}')" title="Editar">${ICONOS.editar}</button>
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarContratista('${c.id}', '${(c.nombre || '').replace(/'/g, "\\'")}')" title="Eliminar">${ICONOS.eliminar}</button>
                    ` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function buscarContratistas(termino) {
    const t = termino.toLowerCase().trim();
    if (!t) { renderizarContratistas(); return; }

    const tbody = document.getElementById('tabla-contratistas-body');
    const filtrados = contratistasCargados.filter(c =>
        (c.nombre && c.nombre.toLowerCase().includes(t)) ||
        (c.cuit && c.cuit.includes(t)) ||
        (c.especialidad && c.especialidad.toLowerCase().includes(t))
    );

    const backup = contratistasCargados;
    contratistasCargados = filtrados;
    renderizarContratistas();
    contratistasCargados = backup;
}

// ==============================================
// CONTRATISTAS — CRUD
// ==============================================

function abrirModalNuevoContratista() {
    contratistaEditandoId = null;
    abrirModalContratista('Nuevo Contratista', {});
}

function editarContratista(id) {
    const c = contratistasCargados.find(x => x.id === id);
    if (!c) { mostrarError('No se encontró.'); return; }
    contratistaEditandoId = id;
    abrirModalContratista('Editar Contratista', c);
}

function abrirModalContratista(titulo, datos) {
    const contenido = `
        <div class="campo-grupo">
            <label class="campo-label">Nombre <span class="campo-requerido">*</span></label>
            <input type="text" id="campo-nombre" class="campo-input" value="${datos.nombre || ''}" placeholder="Nombre del contratista o empresa">
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">CUIT</label>
                <input type="text" id="campo-cuit" class="campo-input" value="${datos.cuit || ''}" placeholder="XX-XXXXXXXX-X">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Teléfono</label>
                <input type="text" id="campo-telefono" class="campo-input" value="${datos.telefono || ''}" placeholder="Teléfono de contacto">
            </div>
        </div>
        <div class="campo-grupo">
            <label class="campo-label">Especialidad</label>
            <select id="campo-especialidad" class="campo-select">
                <option value="">Seleccionar...</option>
                <option value="Fumigación" ${datos.especialidad === 'Fumigación' ? 'selected' : ''}>Fumigación</option>
                <option value="Cosecha" ${datos.especialidad === 'Cosecha' ? 'selected' : ''}>Cosecha</option>
                <option value="Siembra" ${datos.especialidad === 'Siembra' ? 'selected' : ''}>Siembra</option>
                <option value="Transporte" ${datos.especialidad === 'Transporte' ? 'selected' : ''}>Transporte</option>
                <option value="Laboreo" ${datos.especialidad === 'Laboreo' ? 'selected' : ''}>Laboreo</option>
                <option value="Varios" ${datos.especialidad === 'Varios' ? 'selected' : ''}>Varios</option>
            </select>
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarContratista()">
            ${contratistaEditandoId ? 'Guardar cambios' : 'Crear contratista'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
}

async function guardarContratista() {
    const nombre = document.getElementById('campo-nombre')?.value.trim();
    if (!nombre) { mostrarError('El nombre es obligatorio.'); return; }

    const datos = {
        nombre,
        cuit: document.getElementById('campo-cuit')?.value.trim() || null,
        telefono: document.getElementById('campo-telefono')?.value.trim() || null,
        especialidad: document.getElementById('campo-especialidad')?.value || null
    };

    let resultado;
    if (contratistaEditandoId) {
        resultado = await ejecutarConsulta(db.from('contratistas').update(datos).eq('id', contratistaEditandoId), 'actualizar contratista');
    } else {
        resultado = await ejecutarConsulta(db.from('contratistas').insert(datos), 'crear contratista');
    }

    if (resultado === undefined) return;
    cerrarModal();
    mostrarExito(contratistaEditandoId ? 'Contratista actualizado' : 'Contratista creado');
    contratistaEditandoId = null;
    await cargarContratistas();
}

function confirmarEliminarContratista(id, nombre) {
    window.__idEliminar = id;
    abrirModal('Confirmar eliminación',
        `<p style="font-size:var(--texto-lg);color:var(--color-texto);">¿Eliminar contratista <strong>${nombre}</strong>?</p>
         <p style="font-size:var(--texto-sm);color:var(--color-texto-secundario);">Se eliminarán también todos sus trabajos registrados.</p>`,
        `<button class="btn-secundario" onclick="cerrarModal()">Cancelar</button><button class="btn-peligro" onclick="cerrarModal(); eliminarContratista(window.__idEliminar)">Sí, eliminar</button>`
    );
}

async function eliminarContratista(id) {
    // Primero eliminar trabajos del contratista
    await ejecutarConsulta(db.from('trabajos_contratistas').delete().eq('contratista_id', id), 'eliminar trabajos del contratista');
    const r = await ejecutarConsulta(db.from('contratistas').delete().eq('id', id), 'eliminar contratista');
    if (r !== undefined) { mostrarExito('Contratista eliminado'); await cargarContratistas(); }
}

// ==============================================
// TRABAJOS — Renderizar
// ==============================================

function renderizarTrabajos() {
    const tbody = document.getElementById('tabla-trabajos-body');
    const contador = document.getElementById('contador-trabajos');
    const alertaDiv = document.getElementById('alerta-pagos-pendientes');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (contador) contador.textContent = `${trabajosCargados.length} trabajo${trabajosCargados.length !== 1 ? 's' : ''}`;

    // Alerta de pagos pendientes
    const pendientes = trabajosCargados.filter(t => !t.pagado);
    if (pendientes.length > 0 && alertaDiv) {
        const montoPendiente = pendientes.reduce((sum, t) => sum + (t.precio || 0), 0);
        alertaDiv.innerHTML = `
            <div class="alerta-pagos">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span><strong>${pendientes.length} trabajo${pendientes.length !== 1 ? 's' : ''}</strong> pendiente${pendientes.length !== 1 ? 's' : ''} de pago — Total: <strong>$${formatearNumero(montoPendiente)}</strong></span>
            </div>
        `;
    } else if (alertaDiv) {
        alertaDiv.innerHTML = '';
    }

    if (trabajosCargados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="tabla-vacia">No hay trabajos registrados</td></tr>`;
        return;
    }

    tbody.innerHTML = trabajosCargados.map(t => {
        const contratistaNombre = t.contratistas?.nombre || '—';
        const loteNombre = t.lotes ? `${t.lotes.nombre}${t.lotes.campo ? ' — ' + t.lotes.campo : ''}` : '—';
        const precioTexto = t.precio ? `$${formatearNumero(t.precio)}${t.unidad ? '/' + t.unidad : ''}` : '—';
        const estadoBadge = t.pagado
            ? '<span class="badge badge-pagado">Pagado</span>'
            : '<span class="badge badge-pendiente">Pendiente</span>';

        return `
        <tr>
            <td>${formatearFecha(t.fecha)}</td>
            <td><strong>${contratistaNombre}</strong></td>
            <td>${loteNombre}</td>
            <td>${t.tarea || '—'}</td>
            <td>${precioTexto}</td>
            <td>${estadoBadge}</td>
            <td>${t.fecha_pago ? formatearFecha(t.fecha_pago) : '—'}</td>
            <td>
                <div class="tabla-acciones">
                    ${puedeEditar ? `
                        ${!t.pagado ? `<button class="tabla-btn" onclick="marcarComoPagado('${t.id}')" title="Marcar como pagado" style="color:var(--color-verde);">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="20 6 9 17 4 12"/></svg>
                        </button>` : ''}
                        <button class="tabla-btn" onclick="editarTrabajo('${t.id}')" title="Editar">${ICONOS.editar}</button>
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarTrabajo('${t.id}')" title="Eliminar">${ICONOS.eliminar}</button>
                    ` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function buscarTrabajos(termino) {
    const t = termino.toLowerCase().trim();
    if (!t) { renderizarTrabajos(); return; }

    const filtrados = trabajosCargados.filter(tr =>
        (tr.contratistas?.nombre && tr.contratistas.nombre.toLowerCase().includes(t)) ||
        (tr.tarea && tr.tarea.toLowerCase().includes(t)) ||
        (tr.lotes?.nombre && tr.lotes.nombre.toLowerCase().includes(t))
    );

    const backup = trabajosCargados;
    trabajosCargados = filtrados;
    renderizarTrabajos();
    trabajosCargados = backup;
}

// ==============================================
// TRABAJOS — CRUD
// ==============================================

function abrirModalNuevoTrabajo() {
    trabajoEditandoId = null;
    abrirModalTrabajo('Nuevo Trabajo', {});
}

function editarTrabajo(id) {
    const t = trabajosCargados.find(x => x.id === id);
    if (!t) { mostrarError('No se encontró.'); return; }
    trabajoEditandoId = id;
    abrirModalTrabajo('Editar Trabajo', t);
}

function abrirModalTrabajo(titulo, datos) {
    const opcionesContratistas = contratistasCargados.map(c =>
        `<option value="${c.id}" ${datos.contratista_id === c.id ? 'selected' : ''}>${c.nombre}${c.especialidad ? ' — ' + c.especialidad : ''}</option>`
    ).join('');

    const opcionesLotes = lotesParaSelectContratistas.map(l =>
        `<option value="${l.id}" ${datos.lote_id === l.id ? 'selected' : ''}>${l.nombre}${l.campo ? ' — ' + l.campo : ''}</option>`
    ).join('');

    const hoy = fechaHoyStr();

    const contenido = `
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Fecha <span class="campo-requerido">*</span></label>
                <input type="text" data-fecha id="campo-fecha" class="campo-input" value="${isoADDMM(datos.fecha || hoy)}" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Contratista <span class="campo-requerido">*</span></label>
                <select id="campo-contratista" class="campo-select">
                    <option value="">Seleccionar contratista...</option>
                    ${opcionesContratistas}
                </select>
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Lote</label>
                <select id="campo-lote" class="campo-select">
                    <option value="">Seleccionar lote...</option>
                    ${opcionesLotes}
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Tarea <span class="campo-requerido">*</span></label>
                <select id="campo-tarea" class="campo-select">
                    <option value="">Seleccionar...</option>
                    <option value="Fumigación" ${datos.tarea === 'Fumigación' ? 'selected' : ''}>Fumigación</option>
                    <option value="Cosecha" ${datos.tarea === 'Cosecha' ? 'selected' : ''}>Cosecha</option>
                    <option value="Siembra" ${datos.tarea === 'Siembra' ? 'selected' : ''}>Siembra</option>
                    <option value="Laboreo" ${datos.tarea === 'Laboreo' ? 'selected' : ''}>Laboreo</option>
                    <option value="Transporte" ${datos.tarea === 'Transporte' ? 'selected' : ''}>Transporte</option>
                    <option value="Embolsado" ${datos.tarea === 'Embolsado' ? 'selected' : ''}>Embolsado</option>
                    <option value="Extracción de silo" ${datos.tarea === 'Extracción de silo' ? 'selected' : ''}>Extracción de silo</option>
                    <option value="Otro" ${datos.tarea === 'Otro' ? 'selected' : ''}>Otro</option>
                </select>
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Precio ($)</label>
                <input type="number" id="campo-precio" class="campo-input" value="${datos.precio || ''}" placeholder="Monto total del trabajo" step="0.01" min="0">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Unidad</label>
                <select id="campo-unidad" class="campo-select">
                    <option value="">Seleccionar...</option>
                    <option value="ha" ${datos.unidad === 'ha' ? 'selected' : ''}>Por hectárea</option>
                    <option value="total" ${datos.unidad === 'total' ? 'selected' : ''}>Total</option>
                    <option value="qq" ${datos.unidad === 'qq' ? 'selected' : ''}>Por quintal</option>
                    <option value="hora" ${datos.unidad === 'hora' ? 'selected' : ''}>Por hora</option>
                </select>
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Estado de pago</label>
                <select id="campo-pagado" class="campo-select">
                    <option value="false" ${!datos.pagado ? 'selected' : ''}>Pendiente</option>
                    <option value="true" ${datos.pagado ? 'selected' : ''}>Pagado</option>
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Fecha de pago</label>
                <input type="text" data-fecha id="campo-fecha-pago" class="campo-input" value="${isoADDMM(datos.fecha_pago)}" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
            </div>
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarTrabajo()">
            ${trabajoEditandoId ? 'Guardar cambios' : 'Registrar trabajo'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
}

async function guardarTrabajo() {
    const fecha = ddmmAISO(document.getElementById('campo-fecha')?.value);
    const contratista_id = document.getElementById('campo-contratista')?.value;
    const tarea = document.getElementById('campo-tarea')?.value;

    if (!fecha) { mostrarError('La fecha es obligatoria.'); return; }
    if (!contratista_id) { mostrarError('Seleccioná un contratista.'); return; }
    if (!tarea) { mostrarError('Seleccioná la tarea realizada.'); return; }

    const pagado = document.getElementById('campo-pagado')?.value === 'true';

    const datos = {
        fecha,
        contratista_id,
        lote_id: document.getElementById('campo-lote')?.value || null,
        tarea,
        precio: parseFloat(document.getElementById('campo-precio')?.value) || null,
        unidad: document.getElementById('campo-unidad')?.value || null,
        pagado,
        fecha_pago: pagado ? (ddmmAISO(document.getElementById('campo-fecha-pago')?.value) || fecha) : null
    };

    let resultado;
    if (trabajoEditandoId) {
        resultado = await ejecutarConsulta(db.from('trabajos_contratistas').update(datos).eq('id', trabajoEditandoId), 'actualizar trabajo');
    } else {
        resultado = await ejecutarConsulta(db.from('trabajos_contratistas').insert(datos), 'crear trabajo');
    }

    if (resultado === undefined) return;
    cerrarModal();
    mostrarExito(trabajoEditandoId ? 'Trabajo actualizado' : 'Trabajo registrado');
    trabajoEditandoId = null;
    await cargarContratistas();
}

async function marcarComoPagado(id) {
    const hoy = fechaHoyStr();
    const resultado = await ejecutarConsulta(
        db.from('trabajos_contratistas').update({ pagado: true, fecha_pago: hoy }).eq('id', id),
        'marcar como pagado'
    );
    if (resultado !== undefined) {
        mostrarExito('Trabajo marcado como pagado');
        await cargarContratistas();
    }
}

function confirmarEliminarTrabajo(id) {
    window.__idEliminar = id;
    abrirModal('Confirmar eliminación',
        '<p style="font-size:var(--texto-lg);color:var(--color-texto);">¿Eliminar este trabajo?</p><p style="font-size:var(--texto-sm);color:var(--color-texto-secundario);">Esta acción no se puede deshacer.</p>',
        `<button class="btn-secundario" onclick="cerrarModal()">Cancelar</button><button class="btn-peligro" onclick="cerrarModal(); eliminarTrabajo(window.__idEliminar)">Sí, eliminar</button>`
    );
}

async function eliminarTrabajo(id) {
    const r = await ejecutarConsulta(db.from('trabajos_contratistas').delete().eq('id', id), 'eliminar trabajo');
    if (r !== undefined) { mostrarExito('Trabajo eliminado'); await cargarContratistas(); }
}

// ==============================================
// CHEQUES POR CONTRATISTA
// ==============================================

function poblarSelectChequesContratista() {
    const select = document.getElementById('select-contratista-cheques');
    if (!select) return;
    const valorActual = select.value;
    select.innerHTML = `<option value="">— Seleccioná un contratista —</option>` +
        contratistasCargados.map(c =>
            `<option value="${c.id}" ${c.id === valorActual ? 'selected' : ''}>${c.nombre}</option>`
        ).join('');
    if (valorActual) cargarChequesPorContratista(valorActual);
}

async function cargarChequesPorContratista(contratistaId) {
    const container = document.getElementById('cheques-contratista-resultado');
    if (!container) return;
    if (!contratistaId) { container.innerHTML = ''; return; }

    container.innerHTML = `<div style="display:flex;align-items:center;gap:var(--espacio-md);color:var(--color-texto-secundario);padding:var(--espacio-md) 0;">
        <div class="spinner" style="width:18px;height:18px;"></div>
        <span style="font-size:var(--texto-sm);">Buscando cheques...</span>
    </div>`;

    // 1. Buscar el beneficiario vinculado a este contratista
    const bens = await ejecutarConsulta(
        db.from('beneficiarios').select('id, nombre').eq('contratista_id', contratistaId),
        'buscar beneficiario del contratista'
    );

    if (!bens || bens.length === 0) {
        container.innerHTML = `<p style="color:var(--color-texto-tenue);font-size:var(--texto-sm);padding:var(--espacio-md) 0;">
            Este contratista no tiene cheques registrados en tesorería.
        </p>`;
        return;
    }

    const benIds = bens.map(b => b.id);

    // 2. Traer todos los movimientos de tesorería para esos beneficiarios
    const cheques = await ejecutarConsulta(
        db.from('movimientos_tesoreria')
            .select('*, cuentas_bancarias(alias), categorias_gasto(nombre)')
            .in('beneficiario_id', benIds)
            .order('fecha_cobro', { ascending: true }),
        'cargar cheques del contratista'
    );

    if (!cheques || cheques.length === 0) {
        container.innerHTML = `<p style="color:var(--color-texto-tenue);font-size:var(--texto-sm);padding:var(--espacio-md) 0;">
            Este contratista no tiene cheques registrados en tesorería.
        </p>`;
        return;
    }

    // Totales
    const totalPendiente = cheques.filter(c => c.estado === 'pendiente').reduce((s, c) => s + Number(c.monto), 0);
    const totalCobrado   = cheques.filter(c => c.estado === 'cobrado').reduce((s, c) => s + Number(c.monto), 0);

    const filas = cheques.map(c => {
        const badgeEstado = c.estado === 'pendiente'
            ? `<span class="badge badge-pendiente-pago">Pendiente</span>`
            : c.estado === 'cobrado'
                ? `<span class="badge badge-cobrado">Cobrado</span>`
                : `<span class="badge badge-anulado">Anulado</span>`;

        return `
        <tr>
            <td style="white-space:nowrap;">${formatearFecha(c.fecha_cobro)}</td>
            <td style="font-family:var(--fuente-mono);">${c.numero_cheque || '—'}</td>
            <td>${c.cuentas_bancarias?.alias || '—'}</td>
            <td>${c.categorias_gasto?.nombre || '—'}</td>
            <td style="font-weight:600;font-family:var(--fuente-mono);white-space:nowrap;">$ ${formatearNumero(c.monto)}</td>
            <td>${badgeEstado}</td>
            <td style="white-space:nowrap;color:var(--color-texto-tenue);font-size:var(--texto-xs);">${formatearFecha(c.fecha_emision)}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        <!-- Resumen rápido -->
        <div style="display:flex;gap:var(--espacio-lg);margin-bottom:var(--espacio-lg);flex-wrap:wrap;">
            <div style="background:var(--color-fondo-tarjeta);border:1px solid var(--color-borde);border-radius:var(--radio-md);padding:var(--espacio-md) var(--espacio-lg);">
                <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">Total cheques</div>
                <div style="font-size:var(--texto-xl);font-weight:700;color:var(--color-texto);">${cheques.length}</div>
            </div>
            <div style="background:var(--color-fondo-tarjeta);border:1px solid var(--color-borde);border-radius:var(--radio-md);padding:var(--espacio-md) var(--espacio-lg);">
                <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">Pendiente de cobro</div>
                <div style="font-size:var(--texto-xl);font-weight:700;color:var(--color-alerta);">$ ${formatearNumero(totalPendiente)}</div>
            </div>
            <div style="background:var(--color-fondo-tarjeta);border:1px solid var(--color-borde);border-radius:var(--radio-md);padding:var(--espacio-md) var(--espacio-lg);">
                <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">Ya cobrado</div>
                <div style="font-size:var(--texto-xl);font-weight:700;color:var(--color-verde);">$ ${formatearNumero(totalCobrado)}</div>
            </div>
        </div>

        <!-- Tabla de cheques -->
        <div class="tabla-contenedor" style="overflow-x:auto;">
            <table class="tabla" style="min-width:700px;">
                <thead>
                    <tr>
                        <th>F. Cobro</th>
                        <th>Nro. Cheque</th>
                        <th>Cuenta</th>
                        <th>Categoría</th>
                        <th>Monto</th>
                        <th>Estado</th>
                        <th>F. Emisión</th>
                    </tr>
                </thead>
                <tbody>${filas}</tbody>
            </table>
        </div>
    `;
}
