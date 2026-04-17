// ==============================================
// empleados.js — Empleados + Jornadas + Liquidación
// ==============================================

let empleadosCargados = [];
let jornadasCargadas = [];
let lotesParaSelectEmpleados = [];
let empleadoEditandoId = null;
let jornadaEditandoId = null;

// ==============================================
// CARGAR
// ==============================================

async function cargarEmpleados() {
    const [empleados, jornadas, lotes] = await Promise.all([
        ejecutarConsulta(
            db.from('empleados').select('*').order('nombre'),
            'cargar empleados'
        ),
        ejecutarConsulta(
            db.from('jornadas')
                .select('*, empleados(nombre, jornal_diario), lotes(nombre, campo)')
                .order('fecha', { ascending: false }),
            'cargar jornadas'
        ),
        ejecutarConsulta(
            db.from('lotes').select('id, nombre, campo').order('nombre'),
            'cargar lotes'
        )
    ]);

    empleadosCargados = empleados || [];
    jornadasCargadas = jornadas || [];
    lotesParaSelectEmpleados = lotes || [];

    renderizarResumenEmpleados();
    renderizarEmpleados();
    renderizarJornadas();
    cargarSelectLiquidacion();
}

// ==============================================
// RESUMEN
// ==============================================

function renderizarResumenEmpleados() {
    const container = document.getElementById('resumen-empleados');
    const activos = empleadosCargados.filter(e => e.activo !== false);
    const inactivos = empleadosCargados.filter(e => e.activo === false);

    // Horas del mes actual
    const ahora = new Date();
    const mesActual = ahora.getMonth();
    const anioActual = ahora.getFullYear();
    const jornadasMes = jornadasCargadas.filter(j => {
        const f = new Date(j.fecha);
        return f.getMonth() === mesActual && f.getFullYear() === anioActual;
    });
    const horasMes = jornadasMes.reduce((sum, j) => sum + (j.horas || 0), 0);

    container.innerHTML = `
        <div class="empleado-stat">
            <div class="empleado-stat-valor">${activos.length}</div>
            <div class="empleado-stat-label">Empleados activos${inactivos.length > 0 ? ` (${inactivos.length} inactivo${inactivos.length !== 1 ? 's' : ''})` : ''}</div>
        </div>
        <div class="empleado-stat">
            <div class="empleado-stat-valor">${jornadasCargadas.length}</div>
            <div class="empleado-stat-label">Jornadas registradas</div>
        </div>
        <div class="empleado-stat">
            <div class="empleado-stat-valor" style="color:var(--color-dorado);">${horasMes}h</div>
            <div class="empleado-stat-label">Horas trabajadas este mes</div>
        </div>
    `;
}

// ==============================================
// TABS
// ==============================================

function cambiarTabEmpleados(tab) {
    document.querySelectorAll('.empleados-tab').forEach(t => t.classList.remove('activo'));
    document.querySelectorAll('.empleados-seccion').forEach(s => s.classList.remove('activa'));

    if (tab === 'empleados') {
        document.querySelector('.empleados-tab:nth-child(1)').classList.add('activo');
        document.getElementById('seccion-empleados').classList.add('activa');
    } else if (tab === 'jornadas') {
        document.querySelector('.empleados-tab:nth-child(2)').classList.add('activo');
        document.getElementById('seccion-jornadas').classList.add('activa');
    } else {
        document.querySelector('.empleados-tab:nth-child(3)').classList.add('activo');
        document.getElementById('seccion-liquidacion').classList.add('activa');
    }
}

// ==============================================
// EMPLEADOS — Renderizar
// ==============================================

function renderizarEmpleados() {
    const tbody = document.getElementById('tabla-empleados-body');
    const contador = document.getElementById('contador-empleados');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (contador) contador.textContent = `${empleadosCargados.length} empleado${empleadosCargados.length !== 1 ? 's' : ''}`;

    if (empleadosCargados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="tabla-vacia">No hay empleados registrados</td></tr>`;
        return;
    }

    tbody.innerHTML = empleadosCargados.map(e => {
        const estadoBadge = e.activo !== false
            ? '<span class="badge badge-activo">Activo</span>'
            : '<span class="badge badge-inactivo">Inactivo</span>';

        return `
        <tr>
            <td><strong>${e.nombre || '—'}</strong></td>
            <td>${e.dni || '—'}</td>
            <td>${e.cuil || '—'}</td>
            <td>${e.rol || '—'}</td>
            <td>${e.fecha_ingreso ? formatearFecha(e.fecha_ingreso) : '—'}</td>
            <td>${e.jornal_diario ? '$' + formatearNumero(e.jornal_diario) : '—'}</td>
            <td>${estadoBadge}</td>
            <td>
                <div class="tabla-acciones">
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="editarEmpleado('${e.id}')" title="Editar">${ICONOS.editar}</button>
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarEmpleado('${e.id}', '${(e.nombre || '').replace(/'/g, "\\'")}')" title="Eliminar">${ICONOS.eliminar}</button>
                    ` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function buscarEmpleados(termino) {
    const t = termino.toLowerCase().trim();
    if (!t) { renderizarEmpleados(); return; }

    const filtrados = empleadosCargados.filter(e =>
        (e.nombre && e.nombre.toLowerCase().includes(t)) ||
        (e.dni && e.dni.includes(t)) ||
        (e.rol && e.rol.toLowerCase().includes(t))
    );

    const backup = empleadosCargados;
    empleadosCargados = filtrados;
    renderizarEmpleados();
    empleadosCargados = backup;
}

// ==============================================
// EMPLEADOS — CRUD
// ==============================================

function abrirModalNuevoEmpleado() {
    empleadoEditandoId = null;
    abrirModalEmpleado('Nuevo Empleado', {});
}

function editarEmpleado(id) {
    const e = empleadosCargados.find(x => x.id === id);
    if (!e) { mostrarError('No se encontró.'); return; }
    empleadoEditandoId = id;
    abrirModalEmpleado('Editar Empleado', e);
}

function abrirModalEmpleado(titulo, datos) {
    const hoy = new Date().toISOString().split('T')[0];

    const contenido = `
        <div class="campo-grupo">
            <label class="campo-label">Nombre completo <span class="campo-requerido">*</span></label>
            <input type="text" id="campo-nombre" class="campo-input" value="${datos.nombre || ''}" placeholder="Nombre y apellido">
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">DNI</label>
                <input type="text" id="campo-dni" class="campo-input" value="${datos.dni || ''}" placeholder="Ej: 35.123.456">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">CUIL</label>
                <input type="text" id="campo-cuil" class="campo-input" value="${datos.cuil || ''}" placeholder="XX-XXXXXXXX-X">
            </div>
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Rol / Puesto</label>
                <select id="campo-rol" class="campo-select">
                    <option value="">Seleccionar...</option>
                    <option value="Peón rural" ${datos.rol === 'Peón rural' ? 'selected' : ''}>Peón rural</option>
                    <option value="Tractorista" ${datos.rol === 'Tractorista' ? 'selected' : ''}>Tractorista</option>
                    <option value="Maquinista" ${datos.rol === 'Maquinista' ? 'selected' : ''}>Maquinista</option>
                    <option value="Encargado" ${datos.rol === 'Encargado' ? 'selected' : ''}>Encargado</option>
                    <option value="Administrativo" ${datos.rol === 'Administrativo' ? 'selected' : ''}>Administrativo</option>
                    <option value="Chofer" ${datos.rol === 'Chofer' ? 'selected' : ''}>Chofer</option>
                    <option value="Otro" ${datos.rol === 'Otro' ? 'selected' : ''}>Otro</option>
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Teléfono</label>
                <input type="text" id="campo-telefono" class="campo-input" value="${datos.telefono || ''}" placeholder="Teléfono de contacto">
            </div>
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Fecha de ingreso</label>
                <input type="date" id="campo-fecha-ingreso" class="campo-input" value="${datos.fecha_ingreso || hoy}">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Jornal diario ($)</label>
                <input type="number" id="campo-jornal" class="campo-input" value="${datos.jornal_diario || ''}" placeholder="Monto del jornal diario" step="0.01" min="0">
            </div>
        </div>
        ${empleadoEditandoId ? `
        <div class="campo-grupo">
            <label class="campo-label">Estado</label>
            <select id="campo-activo" class="campo-select">
                <option value="true" ${datos.activo !== false ? 'selected' : ''}>Activo</option>
                <option value="false" ${datos.activo === false ? 'selected' : ''}>Inactivo</option>
            </select>
        </div>
        ` : ''}
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarEmpleado()">
            ${empleadoEditandoId ? 'Guardar cambios' : 'Crear empleado'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
}

async function guardarEmpleado() {
    const nombre = document.getElementById('campo-nombre')?.value.trim();
    if (!nombre) { mostrarError('El nombre es obligatorio.'); return; }

    const datos = {
        nombre,
        dni: document.getElementById('campo-dni')?.value.trim() || null,
        cuil: document.getElementById('campo-cuil')?.value.trim() || null,
        rol: document.getElementById('campo-rol')?.value || null,
        telefono: document.getElementById('campo-telefono')?.value.trim() || null,
        fecha_ingreso: document.getElementById('campo-fecha-ingreso')?.value || null,
        jornal_diario: parseFloat(document.getElementById('campo-jornal')?.value) || null
    };

    if (empleadoEditandoId) {
        const activoSelect = document.getElementById('campo-activo');
        if (activoSelect) datos.activo = activoSelect.value === 'true';
    }

    let resultado;
    if (empleadoEditandoId) {
        resultado = await ejecutarConsulta(db.from('empleados').update(datos).eq('id', empleadoEditandoId), 'actualizar empleado');
    } else {
        resultado = await ejecutarConsulta(db.from('empleados').insert(datos), 'crear empleado');
    }

    if (resultado === undefined) return;
    cerrarModal();
    mostrarExito(empleadoEditandoId ? 'Empleado actualizado' : 'Empleado creado');
    empleadoEditandoId = null;
    await cargarEmpleados();
}

function confirmarEliminarEmpleado(id, nombre) {
    window.__idEliminar = id;
    abrirModal('Confirmar eliminación',
        `<p style="font-size:var(--texto-lg);color:var(--color-texto);">¿Eliminar empleado <strong>${nombre}</strong>?</p>
         <p style="font-size:var(--texto-sm);color:var(--color-texto-secundario);">Se eliminarán también todas sus jornadas registradas.</p>`,
        `<button class="btn-secundario" onclick="cerrarModal()">Cancelar</button><button class="btn-peligro" onclick="cerrarModal(); eliminarEmpleado(window.__idEliminar)">Sí, eliminar</button>`
    );
}

async function eliminarEmpleado(id) {
    await ejecutarConsulta(db.from('jornadas').delete().eq('empleado_id', id), 'eliminar jornadas del empleado');
    const r = await ejecutarConsulta(db.from('empleados').delete().eq('id', id), 'eliminar empleado');
    if (r !== undefined) { mostrarExito('Empleado eliminado'); await cargarEmpleados(); }
}

// ==============================================
// JORNADAS — Renderizar
// ==============================================

function renderizarJornadas() {
    const tbody = document.getElementById('tabla-jornadas-body');
    const contador = document.getElementById('contador-jornadas');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (contador) contador.textContent = `${jornadasCargadas.length} jornada${jornadasCargadas.length !== 1 ? 's' : ''}`;

    if (jornadasCargadas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="tabla-vacia">No hay jornadas registradas</td></tr>`;
        return;
    }

    tbody.innerHTML = jornadasCargadas.map(j => {
        const empleadoNombre = j.empleados?.nombre || '—';
        const loteNombre = j.lotes ? `${j.lotes.nombre}${j.lotes.campo ? ' — ' + j.lotes.campo : ''}` : '—';

        return `
        <tr>
            <td>${formatearFecha(j.fecha)}</td>
            <td><strong>${empleadoNombre}</strong></td>
            <td>${j.horas || 0}h</td>
            <td>${loteNombre}</td>
            <td>${j.tarea || '—'}</td>
            <td>
                <div class="tabla-acciones">
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="editarJornada('${j.id}')" title="Editar">${ICONOS.editar}</button>
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarJornada('${j.id}')" title="Eliminar">${ICONOS.eliminar}</button>
                    ` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function buscarJornadas(termino) {
    const t = termino.toLowerCase().trim();
    if (!t) { renderizarJornadas(); return; }

    const filtrados = jornadasCargadas.filter(j =>
        (j.empleados?.nombre && j.empleados.nombre.toLowerCase().includes(t)) ||
        (j.tarea && j.tarea.toLowerCase().includes(t)) ||
        (j.lotes?.nombre && j.lotes.nombre.toLowerCase().includes(t))
    );

    const backup = jornadasCargadas;
    jornadasCargadas = filtrados;
    renderizarJornadas();
    jornadasCargadas = backup;
}

// ==============================================
// JORNADAS — CRUD
// ==============================================

function abrirModalNuevaJornada() {
    jornadaEditandoId = null;
    abrirModalJornada('Nueva Jornada', {});
}

function editarJornada(id) {
    const j = jornadasCargadas.find(x => x.id === id);
    if (!j) { mostrarError('No se encontró.'); return; }
    jornadaEditandoId = id;
    abrirModalJornada('Editar Jornada', j);
}

function abrirModalJornada(titulo, datos) {
    const empleadosActivos = empleadosCargados.filter(e => e.activo !== false);
    const opcionesEmpleados = empleadosActivos.map(e =>
        `<option value="${e.id}" ${datos.empleado_id === e.id ? 'selected' : ''}>${e.nombre}${e.rol ? ' — ' + e.rol : ''}</option>`
    ).join('');

    const opcionesLotes = lotesParaSelectEmpleados.map(l =>
        `<option value="${l.id}" ${datos.lote_id === l.id ? 'selected' : ''}>${l.nombre}${l.campo ? ' — ' + l.campo : ''}</option>`
    ).join('');

    const hoy = new Date().toISOString().split('T')[0];

    const contenido = `
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Fecha <span class="campo-requerido">*</span></label>
                <input type="date" id="campo-fecha" class="campo-input" value="${datos.fecha || hoy}">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Empleado <span class="campo-requerido">*</span></label>
                <select id="campo-empleado" class="campo-select">
                    <option value="">Seleccionar empleado...</option>
                    ${opcionesEmpleados}
                </select>
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Horas trabajadas <span class="campo-requerido">*</span></label>
                <input type="number" id="campo-horas" class="campo-input" value="${datos.horas || ''}" placeholder="Ej: 8" step="0.5" min="0.5" max="24">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Lote</label>
                <select id="campo-lote" class="campo-select">
                    <option value="">Seleccionar lote...</option>
                    ${opcionesLotes}
                </select>
            </div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Tarea realizada</label>
            <select id="campo-tarea" class="campo-select">
                <option value="">Seleccionar...</option>
                <option value="Siembra" ${datos.tarea === 'Siembra' ? 'selected' : ''}>Siembra</option>
                <option value="Cosecha" ${datos.tarea === 'Cosecha' ? 'selected' : ''}>Cosecha</option>
                <option value="Fumigación" ${datos.tarea === 'Fumigación' ? 'selected' : ''}>Fumigación</option>
                <option value="Laboreo" ${datos.tarea === 'Laboreo' ? 'selected' : ''}>Laboreo</option>
                <option value="Mantenimiento" ${datos.tarea === 'Mantenimiento' ? 'selected' : ''}>Mantenimiento</option>
                <option value="Transporte" ${datos.tarea === 'Transporte' ? 'selected' : ''}>Transporte</option>
                <option value="Embolsado" ${datos.tarea === 'Embolsado' ? 'selected' : ''}>Embolsado</option>
                <option value="Alambrado" ${datos.tarea === 'Alambrado' ? 'selected' : ''}>Alambrado</option>
                <option value="Limpieza" ${datos.tarea === 'Limpieza' ? 'selected' : ''}>Limpieza</option>
                <option value="Varios" ${datos.tarea === 'Varios' ? 'selected' : ''}>Varios</option>
            </select>
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarJornada()">
            ${jornadaEditandoId ? 'Guardar cambios' : 'Registrar jornada'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
}

async function guardarJornada() {
    const fecha = document.getElementById('campo-fecha')?.value;
    const empleado_id = document.getElementById('campo-empleado')?.value;
    const horas = document.getElementById('campo-horas')?.value;

    if (!fecha) { mostrarError('La fecha es obligatoria.'); return; }
    if (!empleado_id) { mostrarError('Seleccioná un empleado.'); return; }
    if (!horas || parseFloat(horas) <= 0) { mostrarError('Ingresá las horas trabajadas.'); return; }

    const datos = {
        fecha,
        empleado_id,
        horas: parseFloat(horas),
        lote_id: document.getElementById('campo-lote')?.value || null,
        tarea: document.getElementById('campo-tarea')?.value || null
    };

    let resultado;
    if (jornadaEditandoId) {
        resultado = await ejecutarConsulta(db.from('jornadas').update(datos).eq('id', jornadaEditandoId), 'actualizar jornada');
    } else {
        resultado = await ejecutarConsulta(db.from('jornadas').insert(datos), 'crear jornada');
    }

    if (resultado === undefined) return;
    cerrarModal();
    mostrarExito(jornadaEditandoId ? 'Jornada actualizada' : 'Jornada registrada');
    jornadaEditandoId = null;
    await cargarEmpleados();
}

function confirmarEliminarJornada(id) {
    window.__idEliminar = id;
    abrirModal('Confirmar eliminación',
        '<p style="font-size:var(--texto-lg);color:var(--color-texto);">¿Eliminar esta jornada?</p>',
        `<button class="btn-secundario" onclick="cerrarModal()">Cancelar</button><button class="btn-peligro" onclick="cerrarModal(); eliminarJornada(window.__idEliminar)">Sí, eliminar</button>`
    );
}

async function eliminarJornada(id) {
    const r = await ejecutarConsulta(db.from('jornadas').delete().eq('id', id), 'eliminar jornada');
    if (r !== undefined) { mostrarExito('Jornada eliminada'); await cargarEmpleados(); }
}

// ==============================================
// LIQUIDACIÓN
// ==============================================

function cargarSelectLiquidacion() {
    const select = document.getElementById('liquidacion-empleado');
    if (!select) return;

    const activos = empleadosCargados.filter(e => e.activo !== false);
    select.innerHTML = '<option value="">Seleccionar empleado...</option>' +
        activos.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');

    // Mes actual por defecto
    const mesInput = document.getElementById('liquidacion-mes');
    if (mesInput && !mesInput.value) {
        const ahora = new Date();
        mesInput.value = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    }
}

function calcularLiquidacion() {
    const empleadoId = document.getElementById('liquidacion-empleado')?.value;
    const mesValor = document.getElementById('liquidacion-mes')?.value;
    const resultadoDiv = document.getElementById('liquidacion-resultado');

    if (!empleadoId) { mostrarError('Seleccioná un empleado.'); return; }
    if (!mesValor) { mostrarError('Seleccioná un mes.'); return; }

    const empleado = empleadosCargados.find(e => e.id === empleadoId);
    if (!empleado) { mostrarError('Empleado no encontrado.'); return; }

    const [anio, mes] = mesValor.split('-').map(Number);

    // Filtrar jornadas del mes seleccionado
    const jornadasMes = jornadasCargadas.filter(j => {
        if (j.empleado_id !== empleadoId) return false;
        const f = new Date(j.fecha);
        return f.getMonth() === mes - 1 && f.getFullYear() === anio;
    });

    const totalHoras = jornadasMes.reduce((sum, j) => sum + (j.horas || 0), 0);
    const totalDias = jornadasMes.length;
    const jornalDiario = empleado.jornal_diario || 0;

    // Liquidación = días trabajados × jornal diario
    const totalLiquidacion = totalDias * jornalDiario;

    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    resultadoDiv.innerHTML = `
        <p style="color:var(--color-texto-secundario);font-size:var(--texto-sm);margin-bottom:var(--espacio-md);">
            Liquidación de <strong style="color:var(--color-texto);">${empleado.nombre}</strong> — ${meses[mes - 1]} ${anio}
        </p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--espacio-md);margin-bottom:var(--espacio-md);">
            <div>
                <div style="font-size:var(--texto-sm);color:var(--color-texto-secundario);">Jornadas trabajadas</div>
                <div style="font-size:var(--texto-lg);font-weight:600;color:var(--color-texto);">${totalDias}</div>
            </div>
            <div>
                <div style="font-size:var(--texto-sm);color:var(--color-texto-secundario);">Horas totales</div>
                <div style="font-size:var(--texto-lg);font-weight:600;color:var(--color-texto);">${totalHoras}h</div>
            </div>
            <div>
                <div style="font-size:var(--texto-sm);color:var(--color-texto-secundario);">Jornal diario</div>
                <div style="font-size:var(--texto-lg);font-weight:600;color:var(--color-texto);">$${formatearNumero(jornalDiario)}</div>
            </div>
        </div>
        <div style="border-top:1px solid var(--color-borde);padding-top:var(--espacio-md);">
            <div style="font-size:var(--texto-sm);color:var(--color-texto-secundario);">Total a pagar (${totalDias} jornadas × $${formatearNumero(jornalDiario)})</div>
            <div class="liquidacion-total">$${formatearNumero(totalLiquidacion)}</div>
        </div>
        ${totalDias === 0 ? '<p style="color:var(--color-texto-tenue);font-size:var(--texto-sm);margin-top:var(--espacio-sm);">No hay jornadas registradas en este período.</p>' : ''}
    `;
    resultadoDiv.classList.add('visible');
}
