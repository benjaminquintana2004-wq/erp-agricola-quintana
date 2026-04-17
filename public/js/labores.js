// ==============================================
// labores.js — CRUD de labores (cuaderno de campo)
// Registrar siembras, fumigaciones, fertilizaciones,
// cosechas, herbicidas y otras labores por lote/campaña.
// ==============================================

let laboresCargadas = [];
let loteCampanasParaSelect = [];
let laborEditandoId = null;
let filtroTipoActual = 'todos';

// ==============================================
// LEER — Cargar labores de la campaña activa
// ==============================================

async function cargarLabores() {
    const tbody = document.getElementById('tabla-labores-body');
    tbody.innerHTML = `
        <tr>
            <td colspan="7" style="text-align: center; padding: var(--espacio-xl);">
                <div class="spinner" style="margin: 0 auto;"></div>
                <p style="color: var(--color-texto-tenue); margin-top: var(--espacio-md);">Cargando labores...</p>
            </td>
        </tr>
    `;

    // Obtener campaña activa
    const campanas = await ejecutarConsulta(
        db.from('campanas').select('id, nombre').eq('activa', true).limit(1),
        'obtener campaña activa'
    );

    const campanaActiva = campanas?.[0];
    if (!campanaActiva) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="tabla-vacia">
                    No hay campaña activa
                    <p>Creá y activá una campaña desde la sección Campañas para registrar labores.</p>
                </td>
            </tr>
        `;
        return;
    }

    // Cargar lote_campanas de la campaña activa (para el select)
    const loteCampanas = await ejecutarConsulta(
        db.from('lote_campanas')
            .select('id, cultivo, lotes(id, nombre, campo, hectareas)')
            .eq('campana_id', campanaActiva.id)
            .order('created_at'),
        'cargar lote-campañas'
    );

    loteCampanasParaSelect = loteCampanas || [];

    // Cargar labores vinculadas a esos lote_campanas
    const lcIds = loteCampanasParaSelect.map(lc => lc.id);

    if (lcIds.length === 0) {
        laboresCargadas = [];
        renderizarTabla([]);
        actualizarContadores([]);
        renderizarResumen([]);
        return;
    }

    const labores = await ejecutarConsulta(
        db.from('labores')
            .select('*, lote_campanas(id, cultivo, lotes(nombre, campo, hectareas))')
            .in('lote_campana_id', lcIds)
            .order('fecha', { ascending: false }),
        'cargar labores'
    );

    if (labores === undefined) return;

    laboresCargadas = labores;
    renderizarTabla(labores);
    actualizarContadores(labores);
    renderizarResumen(labores);
}

// ==============================================
// RENDERIZAR — Tabla
// ==============================================

function renderizarTabla(labores) {
    let mostrar = labores;

    if (filtroTipoActual !== 'todos') {
        mostrar = mostrar.filter(l => l.tipo === filtroTipoActual);
    }

    const tbody = document.getElementById('tabla-labores-body');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);
    const puedeEliminar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (mostrar.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="tabla-vacia">
                    No hay labores registradas
                    <p>Hacé click en "Nueva Labor" para registrar una actividad en un lote</p>
                </td>
            </tr>
        `;
        actualizarContadorTexto(0);
        return;
    }

    tbody.innerHTML = mostrar.map(l => {
        const loteNombre = l.lote_campanas?.lotes?.nombre || '—';
        const loteCampo = l.lote_campanas?.lotes?.campo || '';
        const tipoBadge = obtenerBadgeTipo(l.tipo);

        return `
        <tr>
            <td>${formatearFecha(l.fecha)}</td>
            <td>
                <strong>${loteNombre}</strong>
                ${loteCampo ? `<br><span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${loteCampo}</span>` : ''}
            </td>
            <td>${tipoBadge}</td>
            <td>
                ${l.producto ? `<strong>${l.producto}</strong>` : '—'}
                ${l.observaciones ? `<br><span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${l.observaciones.substring(0, 40)}${l.observaciones.length > 40 ? '...' : ''}</span>` : ''}
            </td>
            <td>${l.dosis ? `${l.dosis}${l.unidad ? ' ' + l.unidad : ''}` : '—'}</td>
            <td>${l.costo_total ? formatearMoneda(l.costo_total) : '—'}</td>
            <td>
                <div class="tabla-acciones">
                    <button class="tabla-btn" onclick="verLabor('${l.id}')" title="Ver detalle">
                        ${ICONOS.ver}
                    </button>
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="editarLabor('${l.id}')" title="Editar">
                            ${ICONOS.editar}
                        </button>
                    ` : ''}
                    ${puedeEliminar ? `
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarLabor('${l.id}')" title="Eliminar">
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

function obtenerBadgeTipo(tipo) {
    const badges = {
        siembra: '<span class="badge badge-siembra">Siembra</span>',
        fumigacion: '<span class="badge badge-fumigacion">Fumigación</span>',
        fertilizacion: '<span class="badge badge-fertilizacion">Fertilización</span>',
        cosecha: '<span class="badge badge-cosecha">Cosecha</span>',
        herbicida: '<span class="badge badge-herbicida">Herbicida</span>',
        otro: '<span class="badge badge-otro">Otro</span>'
    };
    return badges[tipo] || `<span class="badge badge-otro">${tipo}</span>`;
}

function actualizarContadorTexto(cantidad) {
    const contador = document.getElementById('tabla-contador');
    if (contador) {
        contador.textContent = `${cantidad} labor${cantidad !== 1 ? 'es' : ''}`;
    }
}

// ==============================================
// CONTADORES, FILTROS Y RESUMEN
// ==============================================

function actualizarContadores(labores) {
    const tipos = ['todos', 'siembra', 'fumigacion', 'fertilizacion', 'cosecha', 'herbicida', 'otro'];
    tipos.forEach(tipo => {
        const el = document.getElementById(`cont-${tipo}`);
        if (el) {
            el.textContent = tipo === 'todos'
                ? labores.length
                : labores.filter(l => l.tipo === tipo).length;
        }
    });
}

function filtrarPorTipo(tipo) {
    filtroTipoActual = tipo;
    document.querySelectorAll('.filtro-btn').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.filtro === tipo);
    });
    renderizarTabla(laboresCargadas);
}

function buscarLabores(termino) {
    const t = termino.toLowerCase().trim();
    if (!t) {
        renderizarTabla(laboresCargadas);
        return;
    }

    const filtradas = laboresCargadas.filter(l =>
        (l.lote_campanas?.lotes?.nombre && l.lote_campanas.lotes.nombre.toLowerCase().includes(t)) ||
        (l.producto && l.producto.toLowerCase().includes(t)) ||
        (l.tipo && l.tipo.toLowerCase().includes(t)) ||
        (l.observaciones && l.observaciones.toLowerCase().includes(t))
    );

    const backup = laboresCargadas;
    laboresCargadas = filtradas;
    renderizarTabla(filtradas);
    laboresCargadas = backup;
}

function renderizarResumen(labores) {
    const contenedor = document.getElementById('labores-resumen');
    if (!contenedor) return;

    const totalLabores = labores.length;
    const costoTotal = labores.reduce((sum, l) => sum + parseFloat(l.costo_total || 0), 0);

    // Costo por tipo
    const costosPorTipo = {};
    labores.forEach(l => {
        if (l.costo_total) {
            costosPorTipo[l.tipo] = (costosPorTipo[l.tipo] || 0) + parseFloat(l.costo_total);
        }
    });

    // Hectáreas únicas trabajadas
    const lotesUnicos = new Set();
    let hasTotales = 0;
    labores.forEach(l => {
        const loteId = l.lote_campanas?.lotes?.nombre;
        if (loteId && !lotesUnicos.has(loteId)) {
            lotesUnicos.add(loteId);
            hasTotales += parseFloat(l.lote_campanas?.lotes?.hectareas || 0);
        }
    });

    const costoPorHa = hasTotales > 0 ? costoTotal / hasTotales : 0;

    contenedor.innerHTML = `
        <div class="resumen-tarjeta">
            <span class="resumen-valor">${totalLabores}</span>
            <span class="resumen-label">Labores registradas</span>
        </div>
        <div class="resumen-tarjeta">
            <span class="resumen-valor">${formatearMoneda(costoTotal)}</span>
            <span class="resumen-label">Costo total</span>
        </div>
        <div class="resumen-tarjeta">
            <span class="resumen-valor">${lotesUnicos.size}</span>
            <span class="resumen-label">Lotes trabajados</span>
        </div>
        ${hasTotales > 0 ? `
            <div class="resumen-tarjeta">
                <span class="resumen-valor">${formatearMoneda(costoPorHa)}</span>
                <span class="resumen-label">Costo / hectárea</span>
            </div>
        ` : ''}
    `;
}

// ==============================================
// CREAR / EDITAR — Modal
// ==============================================

function abrirModalNuevaLabor() {
    laborEditandoId = null;
    abrirModalLabor('Nueva Labor', {});
}

function editarLabor(id) {
    const labor = laboresCargadas.find(l => l.id === id);
    if (!labor) {
        mostrarError('No se encontró la labor.');
        return;
    }
    laborEditandoId = id;
    abrirModalLabor('Editar Labor', labor);
}

function abrirModalLabor(titulo, datos) {
    if (loteCampanasParaSelect.length === 0) {
        mostrarError('No hay lotes asignados a la campaña activa. Primero asigná un cultivo a un lote desde la sección Lotes.');
        return;
    }

    const opcionesLotes = loteCampanasParaSelect.map(lc => {
        const nombre = lc.lotes?.nombre || '?';
        const cultivo = lc.cultivo || 'sin cultivo';
        return `<option value="${lc.id}" ${datos.lote_campana_id === lc.id ? 'selected' : ''}>${nombre} — ${cultivo}</option>`;
    }).join('');

    const hoy = new Date().toISOString().split('T')[0];

    const contenido = `
        <div class="form-seccion-titulo">Datos de la labor</div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Lote <span class="campo-requerido">*</span></label>
                <select id="campo-lote-campana" class="campo-select">
                    <option value="">Seleccionar lote...</option>
                    ${opcionesLotes}
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Tipo de labor <span class="campo-requerido">*</span></label>
                <select id="campo-tipo" class="campo-select">
                    <option value="">Seleccionar...</option>
                    <option value="siembra" ${datos.tipo === 'siembra' ? 'selected' : ''}>Siembra</option>
                    <option value="fumigacion" ${datos.tipo === 'fumigacion' ? 'selected' : ''}>Fumigación</option>
                    <option value="fertilizacion" ${datos.tipo === 'fertilizacion' ? 'selected' : ''}>Fertilización</option>
                    <option value="cosecha" ${datos.tipo === 'cosecha' ? 'selected' : ''}>Cosecha</option>
                    <option value="herbicida" ${datos.tipo === 'herbicida' ? 'selected' : ''}>Herbicida</option>
                    <option value="otro" ${datos.tipo === 'otro' ? 'selected' : ''}>Otro</option>
                </select>
            </div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Fecha <span class="campo-requerido">*</span></label>
            <input type="date" id="campo-fecha" class="campo-input" value="${datos.fecha || hoy}">
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo">Producto aplicado</div>

        <div class="campo-grupo">
            <label class="campo-label">Producto / Insumo</label>
            <input type="text" id="campo-producto" class="campo-input" value="${datos.producto || ''}" placeholder="Ej: Glifosato, Urea, Semilla DM 46i17">
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Dosis</label>
                <input type="text" id="campo-dosis" class="campo-input" value="${datos.dosis || ''}" placeholder="Ej: 3">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Unidad</label>
                <select id="campo-unidad" class="campo-select">
                    <option value="">Seleccionar...</option>
                    <option value="lt/ha" ${datos.unidad === 'lt/ha' ? 'selected' : ''}>lt/ha</option>
                    <option value="kg/ha" ${datos.unidad === 'kg/ha' ? 'selected' : ''}>kg/ha</option>
                    <option value="cc/ha" ${datos.unidad === 'cc/ha' ? 'selected' : ''}>cc/ha</option>
                    <option value="gr/ha" ${datos.unidad === 'gr/ha' ? 'selected' : ''}>gr/ha</option>
                    <option value="bolsas" ${datos.unidad === 'bolsas' ? 'selected' : ''}>bolsas</option>
                    <option value="unidades" ${datos.unidad === 'unidades' ? 'selected' : ''}>unidades</option>
                </select>
            </div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Costo total</label>
            <input type="number" id="campo-costo" class="campo-input" value="${datos.costo_total || ''}" placeholder="Costo total de la labor en $" step="0.01" min="0">
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo">Observaciones</div>

        <div class="campo-grupo">
            <textarea id="campo-observaciones" class="campo-textarea" rows="2" placeholder="Notas adicionales...">${datos.observaciones || ''}</textarea>
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarLabor()">
            ${laborEditandoId ? 'Guardar cambios' : 'Registrar labor'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
}

// ==============================================
// GUARDAR
// ==============================================

async function guardarLabor() {
    const loteCampanaId = document.getElementById('campo-lote-campana')?.value;
    const tipo = document.getElementById('campo-tipo')?.value;
    const fecha = document.getElementById('campo-fecha')?.value;
    const producto = document.getElementById('campo-producto')?.value.trim();
    const dosis = document.getElementById('campo-dosis')?.value.trim();
    const unidad = document.getElementById('campo-unidad')?.value;
    const costo = document.getElementById('campo-costo')?.value;
    const observaciones = document.getElementById('campo-observaciones')?.value.trim();

    if (!loteCampanaId) {
        mostrarError('Seleccioná un lote.');
        return;
    }
    if (!tipo) {
        mostrarError('Seleccioná el tipo de labor.');
        return;
    }
    if (!fecha) {
        mostrarError('La fecha es obligatoria.');
        return;
    }

    const datosLabor = {
        lote_campana_id: loteCampanaId,
        tipo,
        fecha,
        producto: producto || null,
        dosis: dosis || null,
        unidad: unidad || null,
        costo_total: costo ? parseFloat(costo) : null,
        observaciones: observaciones || null
    };

    let resultado;

    if (laborEditandoId) {
        resultado = await ejecutarConsulta(
            db.from('labores').update(datosLabor).eq('id', laborEditandoId).select(),
            'actualizar labor'
        );
    } else {
        resultado = await ejecutarConsulta(
            db.from('labores').insert(datosLabor).select(),
            'crear labor'
        );
    }

    if (resultado === undefined) return;

    cerrarModal();
    mostrarExito(laborEditandoId ? 'Labor actualizada' : 'Labor registrada');
    laborEditandoId = null;
    await cargarLabores();
}

// ==============================================
// VER DETALLE
// ==============================================

function verLabor(id) {
    const l = laboresCargadas.find(lab => lab.id === id);
    if (!l) {
        mostrarError('No se encontró la labor.');
        return;
    }

    const loteNombre = l.lote_campanas?.lotes?.nombre || '—';
    const loteCampo = l.lote_campanas?.lotes?.campo || '';
    const cultivo = l.lote_campanas?.cultivo || '—';
    const tipoBadge = obtenerBadgeTipo(l.tipo);

    const contenido = `
        <div class="contrato-detalle-grid">
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Lote</span>
                <span class="contrato-detalle-valor"><strong>${loteNombre}</strong>${loteCampo ? ' — ' + loteCampo : ''}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Cultivo</span>
                <span class="contrato-detalle-valor">${cultivo}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Fecha</span>
                <span class="contrato-detalle-valor">${formatearFecha(l.fecha)}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Tipo</span>
                <span class="contrato-detalle-valor">${tipoBadge}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Producto</span>
                <span class="contrato-detalle-valor">${l.producto || '—'}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Dosis</span>
                <span class="contrato-detalle-valor">${l.dosis ? `${l.dosis} ${l.unidad || ''}` : '—'}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Costo total</span>
                <span class="contrato-detalle-valor"><strong>${l.costo_total ? formatearMoneda(l.costo_total) : '—'}</strong></span>
            </div>
        </div>
        ${l.observaciones ? `
            <hr class="form-separador">
            <div class="form-seccion-titulo">Observaciones</div>
            <p style="color: var(--color-texto); font-size: var(--texto-base);">${l.observaciones}</p>
        ` : ''}
    `;

    const footer = `<button class="btn-secundario" onclick="cerrarModal()">Cerrar</button>`;
    abrirModal(`Labor — ${loteNombre}`, contenido, footer);
}

// ==============================================
// ELIMINAR
// ==============================================

function confirmarEliminarLabor(id) {
    window.__idEliminarLabor = id;
    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto); margin-bottom: var(--espacio-md);">
            ¿Seguro que querés eliminar esta labor?
        </p>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">
            Esta acción no se puede deshacer.
        </p>
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-peligro" onclick="cerrarModal(); eliminarLabor(window.__idEliminarLabor)">
            Sí, eliminar
        </button>
    `;
    abrirModal('Confirmar eliminación', contenido, footer);
}

async function eliminarLabor(id) {
    const resultado = await ejecutarConsulta(
        db.from('labores').delete().eq('id', id),
        'eliminar labor'
    );

    if (resultado !== undefined) {
        mostrarExito('Labor eliminada');
        await cargarLabores();
    }
}
