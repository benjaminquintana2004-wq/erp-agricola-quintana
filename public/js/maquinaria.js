// ==============================================
// maquinaria.js — CRUD de maquinaria propia
// Alta de máquinas, registro de mantenimientos,
// alertas de service próximo.
// ==============================================

let maquinariaCargada = [];
let maquinaEditandoId = null;

// ==============================================
// LEER
// ==============================================

async function cargarMaquinaria() {
    const tbody = document.getElementById('tabla-maquinaria-body');
    tbody.innerHTML = `
        <tr><td colspan="8" style="text-align:center;padding:var(--espacio-xl);">
            <div class="spinner" style="margin:0 auto;"></div>
            <p style="color:var(--color-texto-tenue);margin-top:var(--espacio-md);">Cargando maquinaria...</p>
        </td></tr>
    `;

    const data = await ejecutarConsulta(
        db.from('maquinaria')
            .select('*, mantenimientos(id, fecha, tipo, costo, descripcion)')
            .order('nombre'),
        'cargar maquinaria'
    );

    if (data === undefined) return;

    maquinariaCargada = data;
    renderizarTabla(data);
    actualizarContador(data.length);
    mostrarAlertasService(data);
}

// ==============================================
// RENDERIZAR
// ==============================================

function renderizarTabla(maquinas) {
    const tbody = document.getElementById('tabla-maquinaria-body');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (maquinas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="tabla-vacia">No hay maquinaria registrada<p>Hacé click en "Nueva Máquina" para agregar la primera</p></td></tr>`;
        return;
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    tbody.innerHTML = maquinas.map(m => {
        const marcaModelo = [m.marca, m.modelo].filter(Boolean).join(' ') || '—';
        let serviceBadge = '—';

        if (m.proximo_service_fecha) {
            const serviceDate = new Date(m.proximo_service_fecha + 'T00:00:00');
            const dias = Math.floor((serviceDate - hoy) / (1000 * 60 * 60 * 24));

            if (dias < 0) {
                serviceBadge = `<span class="badge badge-service-vencido">Vencido (${Math.abs(dias)}d)</span>`;
            } else if (dias <= 30) {
                serviceBadge = `<span class="badge badge-service-proximo">${dias}d</span>`;
            } else {
                serviceBadge = `<span class="badge badge-service-ok">${formatearFecha(m.proximo_service_fecha)}</span>`;
            }
        }

        return `
        <tr>
            <td><strong>${m.nombre}</strong></td>
            <td>${m.tipo || '—'}</td>
            <td>${marcaModelo}</td>
            <td>${m.anio || '—'}</td>
            <td>${m.horas_totales ? Number(m.horas_totales).toLocaleString('es-AR') + ' hs' : '—'}</td>
            <td>${m.costo_hora ? formatearMoneda(m.costo_hora) : '—'}</td>
            <td>${serviceBadge}</td>
            <td>
                <div class="tabla-acciones">
                    <button class="tabla-btn" onclick="verMaquina('${m.id}')" title="Ver detalle">
                        ${ICONOS.ver}
                    </button>
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="abrirModalMantenimiento('${m.id}', '${m.nombre.replace(/'/g, "\\'")}')" title="Registrar mantenimiento" style="color:var(--color-verde);">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                        </button>
                        <button class="tabla-btn" onclick="editarMaquina('${m.id}')" title="Editar">
                            ${ICONOS.editar}
                        </button>
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarMaquina('${m.id}', '${m.nombre.replace(/'/g, "\\'")}')" title="Eliminar">
                            ${ICONOS.eliminar}
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function actualizarContador(cantidad) {
    const el = document.getElementById('tabla-contador');
    if (el) el.textContent = `${cantidad} máquina${cantidad !== 1 ? 's' : ''}`;
}

// ==============================================
// ALERTAS DE SERVICE
// ==============================================

function mostrarAlertasService(maquinas) {
    const contenedor = document.getElementById('alertas-service');
    if (!contenedor) return;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const vencidos = [];
    const proximos = [];

    maquinas.forEach(m => {
        if (!m.proximo_service_fecha) return;
        const serviceDate = new Date(m.proximo_service_fecha + 'T00:00:00');
        const dias = Math.floor((serviceDate - hoy) / (1000 * 60 * 60 * 24));
        if (dias < 0) vencidos.push(m.nombre);
        else if (dias <= 30) proximos.push(m.nombre);
    });

    let html = '';

    if (vencidos.length > 0) {
        html += `
            <div class="alerta-service alerta-service-rojo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span><strong>Service vencido:</strong> ${vencidos.join(', ')}</span>
            </div>
        `;
    }

    if (proximos.length > 0) {
        html += `
            <div class="alerta-service alerta-service-amarillo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span><strong>Service próximo (30 días):</strong> ${proximos.join(', ')}</span>
            </div>
        `;
    }

    contenedor.innerHTML = html;
}

// ==============================================
// BUSCAR
// ==============================================

function buscarMaquinaria(termino) {
    const t = termino.toLowerCase().trim();
    if (!t) { renderizarTabla(maquinariaCargada); actualizarContador(maquinariaCargada.length); return; }

    const filtradas = maquinariaCargada.filter(m =>
        (m.nombre && m.nombre.toLowerCase().includes(t)) ||
        (m.tipo && m.tipo.toLowerCase().includes(t)) ||
        (m.marca && m.marca.toLowerCase().includes(t)) ||
        (m.modelo && m.modelo.toLowerCase().includes(t))
    );

    renderizarTabla(filtradas);
    actualizarContador(filtradas.length);
}

// ==============================================
// CREAR / EDITAR MÁQUINA
// ==============================================

function abrirModalNuevaMaquina() {
    maquinaEditandoId = null;
    abrirModalMaquina('Nueva Máquina', {});
}

function editarMaquina(id) {
    const m = maquinariaCargada.find(x => x.id === id);
    if (!m) { mostrarError('No se encontró la máquina.'); return; }
    maquinaEditandoId = id;
    abrirModalMaquina('Editar Máquina', m);
}

function abrirModalMaquina(titulo, datos) {
    const contenido = `
        <div class="campo-grupo">
            <label class="campo-label">Nombre <span class="campo-requerido">*</span></label>
            <input type="text" id="campo-nombre" class="campo-input" value="${datos.nombre || ''}" placeholder="Ej: Tractor John Deere 7215R">
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Tipo</label>
                <select id="campo-tipo" class="campo-select">
                    <option value="">Seleccionar...</option>
                    <option value="Tractor" ${datos.tipo === 'Tractor' ? 'selected' : ''}>Tractor</option>
                    <option value="Cosechadora" ${datos.tipo === 'Cosechadora' ? 'selected' : ''}>Cosechadora</option>
                    <option value="Sembradora" ${datos.tipo === 'Sembradora' ? 'selected' : ''}>Sembradora</option>
                    <option value="Pulverizadora" ${datos.tipo === 'Pulverizadora' ? 'selected' : ''}>Pulverizadora</option>
                    <option value="Tolva" ${datos.tipo === 'Tolva' ? 'selected' : ''}>Tolva</option>
                    <option value="Acoplado" ${datos.tipo === 'Acoplado' ? 'selected' : ''}>Acoplado</option>
                    <option value="Camioneta" ${datos.tipo === 'Camioneta' ? 'selected' : ''}>Camioneta</option>
                    <option value="Otro" ${datos.tipo === 'Otro' ? 'selected' : ''}>Otro</option>
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Año</label>
                <input type="number" id="campo-anio" class="campo-input" value="${datos.anio || ''}" placeholder="Ej: 2018" min="1970" max="2030">
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Marca</label>
                <input type="text" id="campo-marca" class="campo-input" value="${datos.marca || ''}" placeholder="Ej: John Deere">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Modelo</label>
                <input type="text" id="campo-modelo" class="campo-input" value="${datos.modelo || ''}" placeholder="Ej: 7215R">
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Horas totales</label>
                <input type="number" id="campo-horas" class="campo-input" value="${datos.horas_totales || ''}" placeholder="Horómetro actual" step="0.1" min="0">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Costo por hora ($/h)</label>
                <input type="number" id="campo-costo-hora" class="campo-input" value="${datos.costo_hora || ''}" placeholder="Costo operativo estimado" step="0.01" min="0">
            </div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Próximo service</label>
            <input type="date" id="campo-proximo-service" class="campo-input" value="${datos.proximo_service_fecha || ''}">
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarMaquina()">
            ${maquinaEditandoId ? 'Guardar cambios' : 'Crear máquina'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
    setTimeout(() => document.getElementById('campo-nombre')?.focus(), 100);
}

async function guardarMaquina() {
    const nombre = document.getElementById('campo-nombre')?.value.trim();
    if (!nombre) { mostrarError('El nombre es obligatorio.'); return; }

    const datos = {
        nombre,
        tipo: document.getElementById('campo-tipo')?.value || null,
        marca: document.getElementById('campo-marca')?.value.trim() || null,
        modelo: document.getElementById('campo-modelo')?.value.trim() || null,
        anio: document.getElementById('campo-anio')?.value ? parseInt(document.getElementById('campo-anio').value) : null,
        horas_totales: document.getElementById('campo-horas')?.value ? parseFloat(document.getElementById('campo-horas').value) : 0,
        costo_hora: document.getElementById('campo-costo-hora')?.value ? parseFloat(document.getElementById('campo-costo-hora').value) : 0,
        proximo_service_fecha: document.getElementById('campo-proximo-service')?.value || null
    };

    let resultado;
    if (maquinaEditandoId) {
        resultado = await ejecutarConsulta(db.from('maquinaria').update(datos).eq('id', maquinaEditandoId), 'actualizar máquina');
    } else {
        resultado = await ejecutarConsulta(db.from('maquinaria').insert(datos), 'crear máquina');
    }

    if (resultado === undefined) return;

    cerrarModal();
    mostrarExito(maquinaEditandoId ? 'Máquina actualizada' : 'Máquina creada');
    maquinaEditandoId = null;
    await cargarMaquinaria();
}

// ==============================================
// VER DETALLE (con historial de mantenimientos)
// ==============================================

function verMaquina(id) {
    const m = maquinariaCargada.find(x => x.id === id);
    if (!m) { mostrarError('No se encontró la máquina.'); return; }

    const marcaModelo = [m.marca, m.modelo].filter(Boolean).join(' ') || '—';

    let mantenimientosHTML = '';
    if (m.mantenimientos && m.mantenimientos.length > 0) {
        const ordenados = m.mantenimientos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        const costoTotal = ordenados.reduce((sum, mt) => sum + parseFloat(mt.costo || 0), 0);

        mantenimientosHTML = `
            <hr class="form-separador">
            <div class="form-seccion-titulo">Historial de mantenimientos (${ordenados.length}) — Total: ${formatearMoneda(costoTotal)}</div>
            ${ordenados.map(mt => `
                <div class="mantenimiento-item">
                    <div class="mantenimiento-fecha">${formatearFecha(mt.fecha)}</div>
                    <div class="mantenimiento-info">
                        <strong>${mt.tipo || 'Mantenimiento'}</strong>
                        ${mt.descripcion ? `<br><span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${mt.descripcion}</span>` : ''}
                    </div>
                    <div class="mantenimiento-costo">${mt.costo ? formatearMoneda(mt.costo) : '—'}</div>
                </div>
            `).join('')}
        `;
    }

    const contenido = `
        <div class="contrato-detalle-grid">
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Nombre</span>
                <span class="contrato-detalle-valor"><strong>${m.nombre}</strong></span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Tipo</span>
                <span class="contrato-detalle-valor">${m.tipo || '—'}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Marca / Modelo</span>
                <span class="contrato-detalle-valor">${marcaModelo}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Año</span>
                <span class="contrato-detalle-valor">${m.anio || '—'}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Horas totales</span>
                <span class="contrato-detalle-valor">${m.horas_totales ? Number(m.horas_totales).toLocaleString('es-AR') + ' hs' : '—'}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Costo/hora</span>
                <span class="contrato-detalle-valor">${m.costo_hora ? formatearMoneda(m.costo_hora) : '—'}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Próximo service</span>
                <span class="contrato-detalle-valor">${m.proximo_service_fecha ? formatearFecha(m.proximo_service_fecha) : '—'}</span>
            </div>
        </div>
        ${mantenimientosHTML}
    `;

    const footer = `<button class="btn-secundario" onclick="cerrarModal()">Cerrar</button>`;
    abrirModal(`Máquina — ${m.nombre}`, contenido, footer);
}

// ==============================================
// MANTENIMIENTO — Registrar
// ==============================================

function abrirModalMantenimiento(maquinaId, nombreMaquina) {
    const hoy = new Date().toISOString().split('T')[0];

    const contenido = `
        <div style="margin-bottom:var(--espacio-md);padding:var(--espacio-md);background:var(--color-fondo-secundario);border-radius:var(--radio-md);">
            <strong>${nombreMaquina}</strong>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Fecha <span class="campo-requerido">*</span></label>
                <input type="date" id="campo-mant-fecha" class="campo-input" value="${hoy}">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Tipo de mantenimiento</label>
                <select id="campo-mant-tipo" class="campo-select">
                    <option value="">Seleccionar...</option>
                    <option value="Service general">Service general</option>
                    <option value="Cambio de aceite">Cambio de aceite</option>
                    <option value="Cambio de filtros">Cambio de filtros</option>
                    <option value="Reparación">Reparación</option>
                    <option value="Cambio de correas">Cambio de correas</option>
                    <option value="Neumáticos">Neumáticos</option>
                    <option value="Electricidad">Electricidad</option>
                    <option value="Hidráulica">Hidráulica</option>
                    <option value="Otro">Otro</option>
                </select>
            </div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Costo</label>
            <input type="number" id="campo-mant-costo" class="campo-input" placeholder="Costo total del mantenimiento" step="0.01" min="0">
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Descripción</label>
            <textarea id="campo-mant-desc" class="campo-textarea" rows="2" placeholder="Detalles del trabajo realizado..."></textarea>
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarMantenimiento('${maquinaId}')">Registrar mantenimiento</button>
    `;

    abrirModal(`Mantenimiento — ${nombreMaquina}`, contenido, footer);
}

async function guardarMantenimiento(maquinaId) {
    const fecha = document.getElementById('campo-mant-fecha')?.value;
    if (!fecha) { mostrarError('La fecha es obligatoria.'); return; }

    const datos = {
        maquina_id: maquinaId,
        fecha,
        tipo: document.getElementById('campo-mant-tipo')?.value || null,
        costo: document.getElementById('campo-mant-costo')?.value ? parseFloat(document.getElementById('campo-mant-costo').value) : null,
        descripcion: document.getElementById('campo-mant-desc')?.value.trim() || null
    };

    const resultado = await ejecutarConsulta(
        db.from('mantenimientos').insert(datos),
        'registrar mantenimiento'
    );

    if (resultado === undefined) return;

    cerrarModal();
    mostrarExito('Mantenimiento registrado');
    await cargarMaquinaria();
}

// ==============================================
// ELIMINAR
// ==============================================

function confirmarEliminarMaquina(id, nombre) {
    window.__idEliminarMaquina = id;
    const contenido = `
        <p style="font-size:var(--texto-lg);color:var(--color-texto);">¿Eliminar <strong>${nombre}</strong>?</p>
        <p style="font-size:var(--texto-sm);color:var(--color-texto-secundario);">Se eliminará el historial de mantenimientos. Esta acción no se puede deshacer.</p>
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-peligro" onclick="cerrarModal(); eliminarMaquina(window.__idEliminarMaquina)">Sí, eliminar</button>
    `;
    abrirModal('Confirmar eliminación', contenido, footer);
}

async function eliminarMaquina(id) {
    const r = await ejecutarConsulta(db.from('maquinaria').delete().eq('id', id), 'eliminar máquina');
    if (r !== undefined) { mostrarExito('Máquina eliminada'); await cargarMaquinaria(); }
}
