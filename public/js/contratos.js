// ==============================================
// contratos.js — CRUD de contratos de arrendamiento
// Crear, editar, ver y eliminar contratos.
// Incluye: subida de PDF, extracción con Gemini,
// fracciones catastrales, cláusulas y RENSPA.
// ==============================================

// Datos en memoria
let contratosCargados = [];
let arrendadoresParaSelect = [];
let contratoEditandoId = null;
let filtroEstadoActual = 'todos';
let archivoPDFSeleccionado = null;

// ==============================================
// LEER — Cargar y mostrar contratos
// ==============================================

/**
 * Carga todos los contratos con datos del arrendador.
 * Calcula el estado en el frontend según las fechas.
 */
async function cargarContratos() {
    const tbody = document.getElementById('tabla-contratos-body');
    tbody.innerHTML = `
        <tr>
            <td colspan="8" style="text-align: center; padding: var(--espacio-xl);">
                <div class="spinner" style="margin: 0 auto;"></div>
                <p style="color: var(--color-texto-tenue); margin-top: var(--espacio-md);">Cargando contratos...</p>
            </td>
        </tr>
    `;

    // Cargar contratos con datos del arrendador (join)
    const data = await ejecutarConsulta(
        db.from('contratos')
            .select('*, arrendadores(nombre, campo, cuit)')
            .order('fecha_fin', { ascending: true }),
        'cargar contratos'
    );

    if (data === undefined) return;

    // También cargar arrendadores activos para el select del formulario
    const arrendadores = await ejecutarConsulta(
        db.from('arrendadores')
            .select('id, nombre, campo, cuit')
            .eq('activo', true)
            .order('nombre'),
        'cargar arrendadores para select'
    );

    if (arrendadores !== undefined) {
        arrendadoresParaSelect = arrendadores;
    }

    // Calcular el estado de cada contrato según la fecha
    contratosCargados = data.map(c => ({
        ...c,
        estado_calculado: calcularEstadoContrato(c),
        renspa_estado_calculado: calcularEstadoRenspa(c)
    }));

    // Actualizar el estado en la base de datos si cambió
    actualizarEstadosEnBD(contratosCargados);

    renderizarTablaContratos(contratosCargados);
    actualizarContadores(contratosCargados);
    mostrarAlertas(contratosCargados);
}

/**
 * Calcula el estado del contrato según las fechas.
 * - vigente: falta más de 90 días para vencer
 * - por_vencer: faltan 90 días o menos
 * - vencido: ya pasó la fecha de fin
 * - renovado: se mantiene si ya fue marcado así
 */
function calcularEstadoContrato(contrato) {
    if (contrato.estado === 'renovado') return 'renovado';

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fin = new Date(contrato.fecha_fin + 'T00:00:00');
    const diasRestantes = Math.ceil((fin - hoy) / (1000 * 60 * 60 * 24));

    if (diasRestantes < 0) return 'vencido';
    if (diasRestantes <= 90) return 'por_vencer';
    return 'vigente';
}

/**
 * Calcula el estado del RENSPA según la fecha de vencimiento.
 */
function calcularEstadoRenspa(contrato) {
    if (!contrato.renspa_vencimiento) return null;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const venc = new Date(contrato.renspa_vencimiento + 'T00:00:00');
    const diasRestantes = Math.ceil((venc - hoy) / (1000 * 60 * 60 * 24));

    if (diasRestantes < 0) return 'vencido';
    if (diasRestantes <= 60) return 'por_vencer';
    return 'vigente';
}

/**
 * Actualiza en la BD los contratos cuyo estado cambió.
 * Esto se hace silenciosamente en background.
 */
async function actualizarEstadosEnBD(contratos) {
    for (const c of contratos) {
        if (c.estado !== c.estado_calculado && c.estado !== 'renovado') {
            // Actualizar silenciosamente
            await db.from('contratos')
                .update({ estado: c.estado_calculado })
                .eq('id', c.id);
        }
        if (c.renspa_vencimiento && c.renspa_estado !== c.renspa_estado_calculado) {
            await db.from('contratos')
                .update({ renspa_estado: c.renspa_estado_calculado })
                .eq('id', c.id);
        }
    }
}

// ==============================================
// RENDERIZAR — Tabla de contratos
// ==============================================

function renderizarTablaContratos(contratos) {
    // Filtrar por estado si hay filtro activo
    let mostrar = contratos;
    if (filtroEstadoActual !== 'todos') {
        mostrar = contratos.filter(c => c.estado_calculado === filtroEstadoActual);
    }

    const tbody = document.getElementById('tabla-contratos-body');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);
    const puedeEliminar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (mostrar.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="tabla-vacia">
                    ${filtroEstadoActual !== 'todos'
                        ? 'No hay contratos con este estado'
                        : 'No hay contratos registrados'}
                    <p>${filtroEstadoActual === 'todos' ? 'Hacé click en "Nuevo Contrato" para agregar el primero' : 'Probá con otro filtro'}</p>
                </td>
            </tr>
        `;
        actualizarContadorTexto(mostrar.length);
        return;
    }

    tbody.innerHTML = mostrar.map(c => {
        const nombreArrendador = c.arrendadores?.nombre || 'Sin arrendador';
        const campoArrendador = c.arrendadores?.campo || '—';
        const estadoBadge = obtenerBadgeEstado(c.estado_calculado);
        const renspaBadge = obtenerBadgeRenspa(c);
        const diasRestantes = calcularDiasRestantes(c.fecha_fin);

        return `
        <tr>
            <td>
                <strong>${nombreArrendador}</strong>
                ${c.arrendadores?.cuit ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">${c.arrendadores.cuit}</span>` : ''}
            </td>
            <td>${campoArrendador}</td>
            <td>${mostrarHectareas(c)}</td>
            <td><strong>${c.qq_pactados_anual ? Number(c.qq_pactados_anual).toLocaleString('es-AR') + ' qq' : '—'}</strong></td>
            <td>
                <span style="font-size: var(--texto-sm);">
                    ${formatearFecha(c.fecha_inicio)} — ${formatearFecha(c.fecha_fin)}
                </span>
                ${diasRestantes !== null ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">${diasRestantes}</span>` : ''}
            </td>
            <td>${estadoBadge}</td>
            <td>${renspaBadge}</td>
            <td>
                <div class="tabla-acciones">
                    <button class="tabla-btn" onclick="verContrato('${c.id}')" title="Ver detalle">
                        ${ICONOS.ver}
                    </button>
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="editarContrato('${c.id}')" title="Editar">
                            ${ICONOS.editar}
                        </button>
                    ` : ''}
                    ${puedeEliminar ? `
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarContrato('${c.id}', '${nombreArrendador.replace(/'/g, "\\'")}')" title="Eliminar">
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

/**
 * Muestra las hectáreas del contrato.
 */
function mostrarHectareas(contrato) {
    if (contrato.hectareas) {
        return `${Number(contrato.hectareas).toLocaleString('es-AR')} ha`;
    }
    return '—';
}

function calcularDiasRestantes(fechaFin) {
    if (!fechaFin) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fin = new Date(fechaFin + 'T00:00:00');
    const dias = Math.ceil((fin - hoy) / (1000 * 60 * 60 * 24));

    if (dias < 0) return `Venció hace ${Math.abs(dias)} días`;
    if (dias === 0) return 'Vence hoy';
    if (dias === 1) return 'Vence mañana';
    return `Faltan ${dias} días`;
}

function obtenerBadgeEstado(estado) {
    const estados = {
        vigente: '<span class="badge badge-verde">Vigente</span>',
        por_vencer: '<span class="badge badge-amarillo">Por vencer</span>',
        vencido: '<span class="badge badge-rojo">Vencido</span>',
        renovado: '<span class="badge badge-gris">Renovado</span>'
    };
    return estados[estado] || '<span class="badge badge-gris">—</span>';
}

function obtenerBadgeRenspa(contrato) {
    if (!contrato.renspa_numero) return '<span style="color: var(--color-texto-tenue);">—</span>';

    const estados = {
        vigente: `<span class="badge badge-verde" title="${contrato.renspa_numero}">OK</span>`,
        por_vencer: `<span class="badge badge-amarillo" title="${contrato.renspa_numero}">Por vencer</span>`,
        vencido: `<span class="badge badge-rojo" title="${contrato.renspa_numero}">Vencido</span>`
    };
    return estados[contrato.renspa_estado_calculado] || '—';
}

// ==============================================
// CONTADORES Y FILTROS
// ==============================================

function actualizarContadores(contratos) {
    const conteos = { todos: contratos.length, vigente: 0, por_vencer: 0, vencido: 0 };
    for (const c of contratos) {
        if (conteos[c.estado_calculado] !== undefined) {
            conteos[c.estado_calculado]++;
        }
    }

    document.getElementById('cont-todos').textContent = conteos.todos;
    document.getElementById('cont-vigente').textContent = conteos.vigente;
    document.getElementById('cont-por_vencer').textContent = conteos.por_vencer;
    document.getElementById('cont-vencido').textContent = conteos.vencido;
}

function actualizarContadorTexto(cantidad) {
    const contador = document.getElementById('tabla-contador');
    if (contador) {
        contador.textContent = `${cantidad} contrato${cantidad !== 1 ? 's' : ''}`;
    }
}

function filtrarPorEstado(estado) {
    filtroEstadoActual = estado;

    // Actualizar botón activo
    document.querySelectorAll('.filtro-btn').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.filtro === estado);
    });

    renderizarTablaContratos(contratosCargados);
}

// ==============================================
// ALERTAS DE VENCIMIENTO
// ==============================================

function mostrarAlertas(contratos) {
    const contenedor = document.getElementById('alertas-contratos');
    if (!contenedor) return;

    let alertasHTML = '';

    // Contratos vencidos
    const vencidos = contratos.filter(c => c.estado_calculado === 'vencido');
    if (vencidos.length > 0) {
        alertasHTML += `
            <div class="alerta-contrato alerta-contrato-rojo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span><strong>${vencidos.length} contrato${vencidos.length > 1 ? 's' : ''} vencido${vencidos.length > 1 ? 's' : ''}:</strong>
                ${vencidos.map(c => c.arrendadores?.nombre || 'Sin nombre').join(', ')}</span>
            </div>
        `;
    }

    // Contratos por vencer (próximos 90 días)
    const porVencer = contratos.filter(c => c.estado_calculado === 'por_vencer');
    if (porVencer.length > 0) {
        alertasHTML += `
            <div class="alerta-contrato alerta-contrato-amarillo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span><strong>${porVencer.length} contrato${porVencer.length > 1 ? 's' : ''} por vencer:</strong>
                ${porVencer.map(c => c.arrendadores?.nombre || 'Sin nombre').join(', ')}</span>
            </div>
        `;
    }

    // RENSPA vencidos
    const renspaVencidos = contratos.filter(c => c.renspa_estado_calculado === 'vencido');
    if (renspaVencidos.length > 0) {
        alertasHTML += `
            <div class="alerta-contrato alerta-contrato-rojo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span><strong>RENSPA vencido:</strong>
                ${renspaVencidos.map(c => `${c.arrendadores?.nombre || 'Sin nombre'} (${c.renspa_numero})`).join(', ')}
                — No se pueden despachar granos de estos campos</span>
            </div>
        `;
    }

    // RENSPA por vencer
    const renspaPorVencer = contratos.filter(c => c.renspa_estado_calculado === 'por_vencer');
    if (renspaPorVencer.length > 0) {
        alertasHTML += `
            <div class="alerta-contrato alerta-contrato-amarillo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span><strong>RENSPA por vencer:</strong>
                ${renspaPorVencer.map(c => `${c.arrendadores?.nombre || 'Sin nombre'} (vence ${formatearFecha(c.renspa_vencimiento)})`).join(', ')}</span>
            </div>
        `;
    }

    contenedor.innerHTML = alertasHTML;
}

// ==============================================
// BUSCAR — Filtrar en tiempo real
// ==============================================

function buscarContratos(termino) {
    const t = termino.toLowerCase().trim();
    if (!t) {
        renderizarTablaContratos(contratosCargados);
        return;
    }

    const filtrados = contratosCargados.filter(c =>
        (c.arrendadores?.nombre && c.arrendadores.nombre.toLowerCase().includes(t)) ||
        (c.arrendadores?.campo && c.arrendadores.campo.toLowerCase().includes(t)) ||
        (c.arrendadores?.cuit && c.arrendadores.cuit.includes(t)) ||
        (c.renspa_numero && c.renspa_numero.includes(t))
    );

    // Aplicar filtro de estado también
    let mostrar = filtrados;
    if (filtroEstadoActual !== 'todos') {
        mostrar = filtrados.filter(c => c.estado_calculado === filtroEstadoActual);
    }

    const tbody = document.getElementById('tabla-contratos-body');
    // Re-renderizar con los filtrados
    const backup = contratosCargados;
    contratosCargados = filtrados;
    renderizarTablaContratos(filtrados);
    contratosCargados = backup;
}

// ==============================================
// CREAR / EDITAR — Modal de formulario
// ==============================================

function abrirModalNuevoContrato() {
    contratoEditandoId = null;
    archivoPDFSeleccionado = null;
    abrirModalContrato('Nuevo Contrato', {});
}

async function editarContrato(id) {
    const contrato = contratosCargados.find(c => c.id === id);
    if (!contrato) {
        mostrarError('No se encontró el contrato.');
        return;
    }
    contratoEditandoId = id;
    archivoPDFSeleccionado = null;
    abrirModalContrato('Editar Contrato', contrato);
}

function abrirModalContrato(titulo, datos) {
    // Generar opciones del select de arrendadores
    const opcionesArrendadores = arrendadoresParaSelect.map(a =>
        `<option value="${a.id}" ${datos.arrendador_id === a.id ? 'selected' : ''}>${a.nombre}${a.campo ? ' — ' + a.campo : ''}</option>`
    ).join('');

    // Sección de PDF
    let pdfSeccion = '';
    if (datos.pdf_url) {
        pdfSeccion = `
            <div class="pdf-archivo-actual" id="pdf-actual">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <div class="pdf-archivo-info">
                    <div class="pdf-archivo-nombre">Contrato PDF</div>
                </div>
                <div class="pdf-archivo-acciones">
                    <button onclick="verPDFContrato('${datos.pdf_url}')">Ver PDF</button>
                    <button onclick="extraerConGeminiDesdeStorage('${datos.pdf_url}')">Extraer datos con IA</button>
                </div>
            </div>
        `;
    }

    const contenido = `
        <div class="form-seccion-titulo">Documento PDF del contrato</div>
        <span class="campo-ayuda" style="display: block; margin-bottom: var(--espacio-md);">
            Podés subir el PDF primero y la IA extrae todos los datos automáticamente, incluyendo el arrendador.
            Si el arrendador no existe, se crea solo.
        </span>

        <div id="pdf-seccion">
            ${pdfSeccion}
            <div class="pdf-upload-area" id="pdf-upload-area">
                <input type="file" id="campo-pdf" accept=".pdf" onchange="seleccionarPDF(event)">
                <div class="pdf-upload-icono">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                </div>
                <div class="pdf-upload-texto">
                    <strong>Hacé click</strong> o arrastrá un PDF acá
                    <br>Máximo 10 MB
                </div>
            </div>
            <div id="gemini-estado-container"></div>
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo">Arrendador y contrato</div>

        <div class="campo-grupo">
            <label class="campo-label">Arrendador <span class="campo-requerido">*</span></label>
            <select id="campo-arrendador" class="campo-select">
                <option value="">Seleccionar arrendador...</option>
                ${opcionesArrendadores}
            </select>
            <span class="campo-ayuda" id="arrendador-ayuda"></span>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Fecha de inicio <span class="campo-requerido">*</span></label>
                <input type="date" id="campo-fecha-inicio" class="campo-input" value="${datos.fecha_inicio || ''}">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Fecha de fin <span class="campo-requerido">*</span></label>
                <input type="date" id="campo-fecha-fin" class="campo-input" value="${datos.fecha_fin || ''}">
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Hectáreas arrendadas</label>
                <input type="number" id="campo-hectareas" class="campo-input" value="${datos.hectareas || ''}" placeholder="Ej: 33.30" step="0.01" min="0">
                <span class="campo-ayuda">Total de hectáreas que se arriendan en este contrato</span>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Quintales pactados por año <span class="campo-requerido">*</span></label>
                <input type="number" id="campo-qq" class="campo-input" value="${datos.qq_pactados_anual || ''}" placeholder="Ej: 333" step="0.01" min="0">
                <span class="campo-ayuda">Total de qq que se deben al arrendador por año</span>
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Grano</label>
                <select id="campo-grano" class="campo-select">
                    <option value="">Seleccionar...</option>
                    <option value="Soja" ${datos.grano === 'Soja' ? 'selected' : ''}>Soja</option>
                    <option value="Maíz" ${datos.grano === 'Maíz' ? 'selected' : ''}>Maíz</option>
                    <option value="Trigo" ${datos.grano === 'Trigo' ? 'selected' : ''}>Trigo</option>
                    <option value="Girasol" ${datos.grano === 'Girasol' ? 'selected' : ''}>Girasol</option>
                    <option value="Sorgo" ${datos.grano === 'Sorgo' ? 'selected' : ''}>Sorgo</option>
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Tipo de contrato</label>
                <select id="campo-tipo" class="campo-select">
                    <option value="arrendamiento" ${datos.tipo === 'arrendamiento' || !datos.tipo ? 'selected' : ''}>Arrendamiento</option>
                    <option value="aparceria" ${datos.tipo === 'aparceria' ? 'selected' : ''}>Aparcería</option>
                    <option value="pastoreo" ${datos.tipo === 'pastoreo' ? 'selected' : ''}>Pastoreo</option>
                    <option value="otro" ${datos.tipo === 'otro' ? 'selected' : ''}>Otro</option>
                </select>
            </div>
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo">RENSPA</div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Número de RENSPA</label>
                <input type="text" id="campo-renspa" class="campo-input" value="${datos.renspa_numero || ''}" placeholder="Ej: 04.058.0.00123/00">
                <span class="campo-ayuda">Registro Nacional Sanitario de Productores Agropecuarios</span>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Vencimiento RENSPA</label>
                <input type="date" id="campo-renspa-venc" class="campo-input" value="${datos.renspa_vencimiento || ''}">
                <span class="campo-ayuda">Se alerta a 60 y 30 días antes del vencimiento</span>
            </div>
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo">Fracciones catastrales</div>
        <span class="campo-ayuda" style="display: block; margin-bottom: var(--espacio-md);">
            Cada fracción es una porción del campo con su propia denominación catastral
        </span>
        <div class="fracciones-lista" id="fracciones-lista">
            <!-- Se llena dinámicamente -->
        </div>
        <button class="btn-agregar-fraccion" onclick="agregarFraccion()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Agregar fracción
        </button>

        <hr class="form-separador">
        <div class="form-seccion-titulo">Cláusulas relevantes</div>
        <span class="campo-ayuda" style="display: block; margin-bottom: var(--espacio-md);">
            Recordatorios operativos extraídos del contrato
        </span>
        <div class="clausulas-lista" id="clausulas-lista">
            <!-- Se llena dinámicamente -->
        </div>
        <button class="btn-agregar-fraccion" onclick="agregarClausula()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Agregar cláusula
        </button>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarContrato()">
            ${contratoEditandoId ? 'Guardar cambios' : 'Crear contrato'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);

    // Cargar fracciones y cláusulas existentes si estamos editando
    if (contratoEditandoId) {
        cargarFraccionesExistentes(contratoEditandoId);
        cargarClausulasExistentes(contratoEditandoId);
    }

    // Configurar drag and drop en el área de PDF
    configurarDragDrop();
}

// ==============================================
// FRACCIONES CATASTRALES — Dinámicas
// ==============================================

let contadorFracciones = 0;

function agregarFraccion(datos = {}) {
    contadorFracciones++;
    const id = contadorFracciones;
    const lista = document.getElementById('fracciones-lista');
    if (!lista) return;

    const html = `
        <div class="fraccion-item" data-fraccion-id="${id}">
            <input type="text" placeholder="Denominación catastral" value="${datos.denominacion_catastral || ''}">
            <input type="text" placeholder="Nro cuenta" value="${datos.nro_cuenta || ''}">
            <input type="number" placeholder="Ha" step="0.01" min="0" value="${datos.hectareas || ''}">
            <input type="number" placeholder="%" step="0.01" min="0" max="100" value="${datos.porcentaje_titularidad || ''}">
            <button class="fraccion-eliminar" onclick="this.closest('.fraccion-item').remove()" title="Quitar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    `;
    lista.insertAdjacentHTML('beforeend', html);
}

async function cargarFraccionesExistentes(contratoId) {
    const data = await ejecutarConsulta(
        db.from('fracciones_catastrales')
            .select('*')
            .eq('contrato_id', contratoId)
            .order('created_at'),
        'cargar fracciones catastrales'
    );

    if (data && data.length > 0) {
        for (const f of data) {
            agregarFraccion(f);
        }
    }
}

function recogerFracciones() {
    const items = document.querySelectorAll('.fraccion-item');
    const fracciones = [];
    items.forEach(item => {
        const inputs = item.querySelectorAll('input');
        const denominacion = inputs[0]?.value.trim();
        const nroCuenta = inputs[1]?.value.trim();
        const hectareas = inputs[2]?.value;
        const porcentaje = inputs[3]?.value;

        // Solo incluir si tiene al menos denominación o hectáreas
        if (denominacion || hectareas) {
            fracciones.push({
                denominacion_catastral: denominacion || null,
                nro_cuenta: nroCuenta || null,
                hectareas: hectareas ? parseFloat(hectareas) : null,
                porcentaje_titularidad: porcentaje ? parseFloat(porcentaje) : null
            });
        }
    });
    return fracciones;
}

// ==============================================
// CLÁUSULAS — Dinámicas
// ==============================================

let contadorClausulas = 0;

function agregarClausula(datos = {}) {
    contadorClausulas++;
    const id = contadorClausulas;
    const lista = document.getElementById('clausulas-lista');
    if (!lista) return;

    const html = `
        <div class="clausula-item" data-clausula-id="${id}">
            <select>
                <option value="">Tipo...</option>
                <option value="cultivos_permitidos" ${datos.tipo === 'cultivos_permitidos' ? 'selected' : ''}>Cultivos permitidos</option>
                <option value="malezas" ${datos.tipo === 'malezas' ? 'selected' : ''}>Control de malezas</option>
                <option value="subarrendar" ${datos.tipo === 'subarrendar' ? 'selected' : ''}>Subarrendar</option>
                <option value="inspeccion" ${datos.tipo === 'inspeccion' ? 'selected' : ''}>Inspección</option>
                <option value="impuestos" ${datos.tipo === 'impuestos' ? 'selected' : ''}>Impuestos</option>
                <option value="otra" ${datos.tipo === 'otra' ? 'selected' : ''}>Otra</option>
            </select>
            <input type="text" placeholder="Descripción de la cláusula" value="${datos.descripcion || ''}">
            <button class="fraccion-eliminar" onclick="this.closest('.clausula-item').remove()" title="Quitar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    `;
    lista.insertAdjacentHTML('beforeend', html);
}

async function cargarClausulasExistentes(contratoId) {
    const data = await ejecutarConsulta(
        db.from('clausulas_contrato')
            .select('*')
            .eq('contrato_id', contratoId)
            .order('created_at'),
        'cargar cláusulas'
    );

    if (data && data.length > 0) {
        for (const cl of data) {
            agregarClausula(cl);
        }
    }
}

function recogerClausulas() {
    const items = document.querySelectorAll('.clausula-item');
    const clausulas = [];
    items.forEach(item => {
        const tipo = item.querySelector('select')?.value;
        const descripcion = item.querySelector('input')?.value.trim();

        if (tipo && descripcion) {
            clausulas.push({ tipo, descripcion });
        }
    });
    return clausulas;
}

// ==============================================
// SUBIDA DE PDF
// ==============================================

function seleccionarPDF(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
        mostrarError('Solo se permiten archivos PDF.');
        event.target.value = '';
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        mostrarError('El archivo es demasiado grande. Máximo 10 MB.');
        event.target.value = '';
        return;
    }

    archivoPDFSeleccionado = file;

    // Actualizar UI para mostrar el archivo seleccionado
    const area = document.getElementById('pdf-upload-area');
    if (area) {
        area.innerHTML = `
            <div class="pdf-archivo-actual" style="border: none; background: none; padding: 0;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;color:var(--color-verde);">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <div class="pdf-archivo-info">
                    <div class="pdf-archivo-nombre">${file.name}</div>
                    <span class="campo-ayuda">${(file.size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
                <div class="pdf-archivo-acciones">
                    <button onclick="extraerDePDFLocal()">Extraer datos con IA</button>
                </div>
            </div>
        `;
    }
}

function configurarDragDrop() {
    const area = document.getElementById('pdf-upload-area');
    if (!area) return;

    area.addEventListener('dragover', (e) => {
        e.preventDefault();
        area.classList.add('arrastrando');
    });

    area.addEventListener('dragleave', () => {
        area.classList.remove('arrastrando');
    });

    area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.classList.remove('arrastrando');
        const file = e.dataTransfer.files[0];
        if (file) {
            // Simular selección de archivo
            const input = document.getElementById('campo-pdf');
            if (input) {
                // No se puede setear .files directamente, usamos el archivo guardado
                archivoPDFSeleccionado = file;
                seleccionarPDF({ target: { files: [file] } });
            }
        }
    });
}

/**
 * Sube un archivo PDF al bucket "contratos" de Supabase Storage.
 * Retorna la URL pública del archivo subido.
 */
async function subirPDFContrato(archivo, arrendadorNombre) {
    // Generar nombre único para el archivo
    const timestamp = Date.now();
    const nombreLimpio = arrendadorNombre
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Quitar acentos
        .replace(/[^a-zA-Z0-9]/g, '_') // Solo alfanuméricos
        .toLowerCase();
    const path = `${nombreLimpio}_${timestamp}.pdf`;

    const { data, error } = await db.storage
        .from('contratos')
        .upload(path, archivo, {
            contentType: 'application/pdf',
            upsert: false
        });

    if (error) {
        console.error('Error subiendo PDF:', error.message);
        mostrarError('No se pudo subir el PDF. Intentá de nuevo.');
        return null;
    }

    // Guardar el path del archivo (no la URL pública, porque el bucket puede ser privado)
    return path;
}

/**
 * Abre el PDF del contrato en una nueva pestaña.
 * Genera una URL firmada temporal (válida por 1 hora) porque el bucket puede ser privado.
 */
async function verPDFContrato(pdfPath) {
    if (!pdfPath) {
        mostrarError('Este contrato no tiene un PDF asociado.');
        return;
    }

    // Si es una URL completa (legacy), abrir directo
    if (pdfPath.startsWith('http')) {
        window.open(pdfPath, '_blank');
        return;
    }

    // Generar URL firmada temporal (1 hora)
    const { data, error } = await db.storage
        .from('contratos')
        .createSignedUrl(pdfPath, 3600);

    if (error || !data?.signedUrl) {
        console.error('Error generando URL firmada:', error?.message);
        mostrarError('No se pudo acceder al PDF. Intentá de nuevo.');
        return;
    }

    window.open(data.signedUrl, '_blank');
}

// ==============================================
// EXTRACCIÓN CON GEMINI
// ==============================================

/**
 * Extrae datos del PDF seleccionado localmente usando Gemini.
 */
async function extraerDePDFLocal() {
    if (!archivoPDFSeleccionado) {
        mostrarError('No hay un PDF seleccionado.');
        return;
    }

    const geminiKey = window.__ENV__?.GEMINI_API_KEY;
    if (!geminiKey) {
        mostrarError('La API Key de Gemini no está configurada. Avisale al administrador.');
        return;
    }

    // Mostrar estado de carga
    const container = document.getElementById('gemini-estado-container');
    if (container) {
        container.innerHTML = `
            <div class="gemini-estado">
                <div class="spinner"></div>
                Enviando PDF a Gemini para extraer datos...
            </div>
        `;
    }

    try {
        // Convertir PDF a base64
        const base64 = await archivoABase64(archivoPDFSeleccionado);

        // Llamar a Gemini
        const datosExtraidos = await llamarGemini(geminiKey, base64);

        if (datosExtraidos) {
            // Auto-completar los campos del formulario (puede crear arrendador)
            await autocompletarFormulario(datosExtraidos);

            if (container) {
                container.innerHTML = `
                    <div class="gemini-estado gemini-exito">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Datos extraídos exitosamente. Revisá los campos antes de guardar.
                    </div>
                `;
            }
            mostrarExito('Datos extraídos del PDF. Revisá y corregí lo que haga falta.');
        }
    } catch (err) {
        console.error('Error extrayendo datos del PDF:', err);
        if (container) {
            container.innerHTML = `
                <div class="gemini-estado gemini-error">
                    Error al extraer datos: ${err.message}
                </div>
            `;
        }
        mostrarError('No se pudieron extraer datos del PDF.');
    }
}

/**
 * Extrae datos de un PDF ya subido (por URL).
 * Descarga el PDF, lo convierte a base64 y lo manda a Gemini.
 */
async function extraerConGeminiDesdeStorage(pdfPath) {
    const geminiKey = window.__ENV__?.GEMINI_API_KEY;
    if (!geminiKey) {
        mostrarError('La API Key de Gemini no está configurada.');
        return;
    }

    const container = document.getElementById('gemini-estado-container');
    if (container) {
        container.innerHTML = `
            <div class="gemini-estado">
                <div class="spinner"></div>
                Descargando PDF y enviando a Gemini...
            </div>
        `;
    }

    try {
        // Descargar el PDF desde Supabase Storage usando URL firmada
        const { data: urlData, error: urlError } = await db.storage
            .from('contratos')
            .createSignedUrl(pdfPath, 300);

        if (urlError || !urlData?.signedUrl) {
            throw new Error('No se pudo acceder al PDF.');
        }

        const response = await fetch(urlData.signedUrl);
        const blob = await response.blob();
        const base64 = await blobABase64(blob);

        const datosExtraidos = await llamarGemini(geminiKey, base64);

        if (datosExtraidos) {
            await autocompletarFormulario(datosExtraidos);
            if (container) {
                container.innerHTML = `
                    <div class="gemini-estado gemini-exito">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Datos extraídos exitosamente.
                    </div>
                `;
            }
            mostrarExito('Datos extraídos del PDF.');
        }
    } catch (err) {
        console.error('Error:', err);
        if (container) {
            container.innerHTML = `
                <div class="gemini-estado gemini-error">Error: ${err.message}</div>
            `;
        }
    }
}

/**
 * Convierte un File a base64 (sin el prefijo data:...)
 */
function archivoABase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // Quitar el prefijo "data:application/pdf;base64,"
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Convierte un Blob a base64 (sin el prefijo)
 */
function blobABase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Llama a la API de Gemini para extraer datos del contrato.
 * Usa Gemini 2.5 Flash con un prompt estructurado.
 */
async function llamarGemini(apiKey, pdfBase64) {
    const prompt = `Analizá este contrato de arrendamiento agrícola argentino y extraé los siguientes datos en formato JSON estricto.

Si un campo no aparece en el documento, poné null. No inventes datos.

Formato de respuesta (solo JSON, sin markdown ni explicaciones):
{
    "arrendador_nombre": "nombre completo del arrendador/propietario",
    "arrendador_dni": "DNI del arrendador",
    "arrendador_cuit": "CUIT del arrendador en formato XX-XXXXXXXX-X",
    "arrendador_domicilio": "domicilio del arrendador",
    "fecha_inicio": "YYYY-MM-DD",
    "fecha_fin": "YYYY-MM-DD",
    "hectareas_totales": 0,
    "qq_por_hectarea": 0,
    "qq_totales_anual": 0,
    "grano": "tipo de grano principal (Soja/Maíz/Trigo/Girasol/Sorgo)",
    "campo_nombre": "nombre del campo o establecimiento",
    "ubicacion": "ciudad, localidad o zona donde está el campo (ej: Villa Ascasubi, Córdoba)",
    "renspa_numero": "número de RENSPA si aparece",
    "fracciones": [
        {
            "denominacion_catastral": "denominación catastral",
            "nro_cuenta": "número de cuenta",
            "hectareas": 0,
            "porcentaje_titularidad": 100
        }
    ],
    "clausulas": [
        {
            "tipo": "cultivos_permitidos|malezas|subarrendar|inspeccion|impuestos|otra",
            "descripcion": "resumen de la cláusula"
        }
    ]
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: 'application/pdf',
                            data: pdfBase64
                        }
                    }
                ]
            }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 16384,
                thinkingConfig: {
                    thinkingBudget: 2048
                }
            }
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Error HTTP ${response.status}`);
    }

    const result = await response.json();

    // Gemini 2.5 Flash devuelve varias "parts": una de pensamiento y otra con la respuesta.
    // Buscamos la última part que tenga texto (la respuesta final, no el pensamiento).
    const parts = result.candidates?.[0]?.content?.parts || [];
    let textoRespuesta = null;
    for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].text) {
            textoRespuesta = parts[i].text;
            break;
        }
    }

    if (!textoRespuesta) {
        console.error('Respuesta completa de Gemini:', JSON.stringify(result, null, 2));
        throw new Error('Gemini no devolvió una respuesta válida.');
    }

    // Parsear JSON de la respuesta (puede venir envuelto en ```json ... ```)
    let jsonStr = textoRespuesta.trim();
    if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\s*$/g, '').trim();
    }

    // Log para debug — ver qué devuelve Gemini
    console.log('=== RESPUESTA GEMINI ===');
    console.log('Parts recibidas:', parts.length);
    parts.forEach((p, i) => console.log(`Part ${i}:`, p.text ? p.text.substring(0, 200) : '(sin texto)', p.thought ? '(pensamiento)' : ''));
    console.log('Texto seleccionado:', textoRespuesta.substring(0, 300));
    console.log('JSON a parsear:', jsonStr.substring(0, 300));

    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('Error parseando JSON de Gemini. JSON completo:', jsonStr);
        throw new Error('La respuesta de Gemini no es un JSON válido.');
    }
}

/**
 * Auto-completa los campos del formulario con los datos extraídos.
 * Si el arrendador no existe en la base de datos, lo crea automáticamente.
 */
async function autocompletarFormulario(datos) {
    // Intentar seleccionar el arrendador por nombre o CUIT
    if (datos.arrendador_nombre || datos.arrendador_cuit) {
        const select = document.getElementById('campo-arrendador');
        if (select) {
            // Buscar por CUIT primero (más preciso)
            const cuitLimpio = datos.arrendador_cuit?.replace(/[-\s]/g, '');
            let encontrado = false;

            for (const opt of select.options) {
                const arrendador = arrendadoresParaSelect.find(a => a.id === opt.value);
                if (arrendador) {
                    const cuitArr = arrendador.cuit?.replace(/[-\s]/g, '');
                    if (cuitLimpio && cuitArr === cuitLimpio) {
                        select.value = opt.value;
                        encontrado = true;
                        break;
                    }
                }
            }

            // Si no encontró por CUIT, buscar por nombre
            if (!encontrado && datos.arrendador_nombre) {
                const nombreLower = datos.arrendador_nombre.toLowerCase();
                for (const opt of select.options) {
                    if (opt.textContent.toLowerCase().includes(nombreLower)) {
                        select.value = opt.value;
                        encontrado = true;
                        break;
                    }
                }
            }

            // Si encontró al arrendador, actualizar datos faltantes (ej: ubicación)
            if (encontrado) {
                const arrendadorId = select.value;
                const arrendador = arrendadoresParaSelect.find(a => a.id === arrendadorId);
                const ubicacion = datos.ubicacion || datos.campo_nombre || null;

                // Actualizar campos vacíos del arrendador con datos del PDF
                const actualizaciones = {};
                if (!arrendador?.campo && ubicacion) actualizaciones.campo = ubicacion;
                if (!arrendador?.dni && datos.arrendador_dni) actualizaciones.dni = datos.arrendador_dni;
                if (!arrendador?.cuit && datos.arrendador_cuit) actualizaciones.cuit = datos.arrendador_cuit;
                if (!arrendador?.domicilio && datos.arrendador_domicilio) actualizaciones.domicilio = datos.arrendador_domicilio;

                if (Object.keys(actualizaciones).length > 0) {
                    await db.from('arrendadores').update(actualizaciones).eq('id', arrendadorId);
                    // Actualizar en memoria también
                    Object.assign(arrendador, actualizaciones);

                    const ayuda = document.getElementById('arrendador-ayuda');
                    if (ayuda) {
                        ayuda.textContent = `Datos del arrendador actualizados desde el PDF.`;
                        ayuda.style.color = 'var(--color-verde)';
                    }
                }
            }

            // Si no encontró al arrendador, CREARLO automáticamente
            if (!encontrado && datos.arrendador_nombre) {
                const ayuda = document.getElementById('arrendador-ayuda');
                if (ayuda) {
                    ayuda.textContent = `Creando arrendador "${datos.arrendador_nombre}"...`;
                    ayuda.style.color = 'var(--color-dorado)';
                }

                // Armar ubicación: preferir "ubicacion", sino "campo_nombre"
                const ubicacion = datos.ubicacion || datos.campo_nombre || null;

                const nuevoArrendador = {
                    nombre: datos.arrendador_nombre,
                    dni: datos.arrendador_dni || null,
                    cuit: datos.arrendador_cuit || null,
                    domicilio: datos.arrendador_domicilio || null,
                    campo: ubicacion,
                    hectareas: datos.hectareas_totales || null,
                    grano: datos.grano || null
                };

                const resultado = await ejecutarConsulta(
                    db.from('arrendadores').insert(nuevoArrendador).select(),
                    'crear arrendador desde PDF'
                );

                if (resultado && resultado.length > 0) {
                    const nuevo = resultado[0];
                    // Agregar al select
                    const opcion = document.createElement('option');
                    opcion.value = nuevo.id;
                    opcion.textContent = `${nuevo.nombre}${nuevo.campo ? ' — ' + nuevo.campo : ''}`;
                    opcion.selected = true;
                    select.appendChild(opcion);

                    // Agregar a la lista en memoria
                    arrendadoresParaSelect.push(nuevo);

                    if (ayuda) {
                        ayuda.textContent = `Arrendador "${datos.arrendador_nombre}" creado automáticamente desde el PDF.`;
                        ayuda.style.color = 'var(--color-verde)';
                    }

                    mostrarExito(`Arrendador "${datos.arrendador_nombre}" creado automáticamente.`);
                } else {
                    if (ayuda) {
                        ayuda.textContent = `No se pudo crear el arrendador. Seleccionalo manualmente.`;
                        ayuda.style.color = 'var(--color-error)';
                    }
                }
            }
        }
    }

    // Fechas
    if (datos.fecha_inicio) {
        const campo = document.getElementById('campo-fecha-inicio');
        if (campo) campo.value = datos.fecha_inicio;
    }
    if (datos.fecha_fin) {
        const campo = document.getElementById('campo-fecha-fin');
        if (campo) campo.value = datos.fecha_fin;
    }

    // Hectáreas
    if (datos.hectareas_totales) {
        const campo = document.getElementById('campo-hectareas');
        if (campo) campo.value = datos.hectareas_totales;
    }

    // Quintales
    if (datos.qq_totales_anual) {
        const campo = document.getElementById('campo-qq');
        if (campo) campo.value = datos.qq_totales_anual;
    }

    // Grano
    if (datos.grano) {
        const campo = document.getElementById('campo-grano');
        if (campo) {
            // Buscar la opción que coincida (case insensitive)
            for (const opt of campo.options) {
                if (opt.value.toLowerCase() === datos.grano.toLowerCase()) {
                    campo.value = opt.value;
                    break;
                }
            }
        }
    }

    // RENSPA
    if (datos.renspa_numero) {
        const campo = document.getElementById('campo-renspa');
        if (campo) campo.value = datos.renspa_numero;
    }

    // Fracciones catastrales
    if (datos.fracciones && datos.fracciones.length > 0) {
        // Limpiar fracciones existentes
        const lista = document.getElementById('fracciones-lista');
        if (lista) lista.innerHTML = '';
        contadorFracciones = 0;

        for (const f of datos.fracciones) {
            agregarFraccion(f);
        }
    }

    // Cláusulas
    if (datos.clausulas && datos.clausulas.length > 0) {
        const lista = document.getElementById('clausulas-lista');
        if (lista) lista.innerHTML = '';
        contadorClausulas = 0;

        for (const cl of datos.clausulas) {
            agregarClausula(cl);
        }
    }
}

// ==============================================
// GUARDAR — Crear o actualizar contrato
// ==============================================

async function guardarContrato() {
    // Leer valores del formulario
    const arrendadorId = document.getElementById('campo-arrendador')?.value;
    const fechaInicio = document.getElementById('campo-fecha-inicio')?.value;
    const fechaFin = document.getElementById('campo-fecha-fin')?.value;
    const hectareas = document.getElementById('campo-hectareas')?.value;
    const qqPactados = document.getElementById('campo-qq')?.value;
    const grano = document.getElementById('campo-grano')?.value;
    const tipo = document.getElementById('campo-tipo')?.value;
    const renspaNumero = document.getElementById('campo-renspa')?.value.trim();
    const renspaVenc = document.getElementById('campo-renspa-venc')?.value;

    // Validaciones
    if (!arrendadorId) {
        document.getElementById('campo-arrendador')?.focus();
        mostrarError('Seleccioná un arrendador.');
        return;
    }

    if (!fechaInicio || !fechaFin) {
        mostrarError('Las fechas de inicio y fin son obligatorias.');
        return;
    }

    if (new Date(fechaFin) <= new Date(fechaInicio)) {
        mostrarError('La fecha de fin debe ser posterior a la de inicio.');
        return;
    }

    if (!qqPactados || parseFloat(qqPactados) <= 0) {
        document.getElementById('campo-qq')?.focus();
        mostrarError('Ingresá los quintales pactados por año.');
        return;
    }

    // Subir PDF si hay uno seleccionado
    let pdfUrl = contratoEditandoId
        ? contratosCargados.find(c => c.id === contratoEditandoId)?.pdf_url
        : null;

    if (archivoPDFSeleccionado) {
        const arrendador = arrendadoresParaSelect.find(a => a.id === arrendadorId);
        const nombreArr = arrendador?.nombre || 'contrato';

        mostrarAlerta('Subiendo PDF...');
        pdfUrl = await subirPDFContrato(archivoPDFSeleccionado, nombreArr);
        if (!pdfUrl) return; // Error ya mostrado
    }

    // Obtener la campaña activa
    const campanaData = await ejecutarConsulta(
        db.from('campanas').select('id').eq('activa', true).limit(1),
        'obtener campaña activa'
    );

    const campanaId = campanaData?.[0]?.id || null;

    // Armar objeto del contrato
    const datosContrato = {
        arrendador_id: arrendadorId,
        campana_id: campanaId,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        hectareas: hectareas ? parseFloat(hectareas) : null,
        qq_pactados_anual: parseFloat(qqPactados),
        grano: grano || null,
        tipo: tipo || 'arrendamiento',
        pdf_url: pdfUrl || null,
        renspa_numero: renspaNumero || null,
        renspa_vencimiento: renspaVenc || null
    };

    let resultado;
    let contratoId;

    if (contratoEditandoId) {
        // ACTUALIZAR
        resultado = await ejecutarConsulta(
            db.from('contratos').update(datosContrato).eq('id', contratoEditandoId).select(),
            'actualizar contrato'
        );
        contratoId = contratoEditandoId;
    } else {
        // CREAR
        resultado = await ejecutarConsulta(
            db.from('contratos').insert(datosContrato).select(),
            'crear contrato'
        );
        contratoId = resultado?.[0]?.id;
    }

    if (resultado === undefined) return;

    if (!contratoId) {
        mostrarError('No se pudo obtener el ID del contrato.');
        return;
    }

    // Guardar fracciones catastrales
    await guardarFracciones(contratoId);

    // Guardar cláusulas
    await guardarClausulas(contratoId);

    cerrarModal();
    mostrarExito(contratoEditandoId ? 'Contrato actualizado' : 'Contrato creado');
    contratoEditandoId = null;
    archivoPDFSeleccionado = null;
    await cargarContratos();
}

/**
 * Guarda las fracciones catastrales del contrato.
 * Borra las anteriores y crea las nuevas (reemplazo completo).
 */
async function guardarFracciones(contratoId) {
    const fracciones = recogerFracciones();

    // Borrar fracciones anteriores
    await db.from('fracciones_catastrales')
        .delete()
        .eq('contrato_id', contratoId);

    // Insertar nuevas
    if (fracciones.length > 0) {
        const fraccionesConId = fracciones.map(f => ({
            ...f,
            contrato_id: contratoId
        }));

        await ejecutarConsulta(
            db.from('fracciones_catastrales').insert(fraccionesConId),
            'guardar fracciones catastrales'
        );
    }
}

/**
 * Guarda las cláusulas del contrato.
 */
async function guardarClausulas(contratoId) {
    const clausulas = recogerClausulas();

    // Borrar cláusulas anteriores
    await db.from('clausulas_contrato')
        .delete()
        .eq('contrato_id', contratoId);

    // Insertar nuevas
    if (clausulas.length > 0) {
        const clausulasConId = clausulas.map(cl => ({
            ...cl,
            contrato_id: contratoId
        }));

        await ejecutarConsulta(
            db.from('clausulas_contrato').insert(clausulasConId),
            'guardar cláusulas'
        );
    }
}

// ==============================================
// VER DETALLE — Modal de solo lectura
// ==============================================

async function verContrato(id) {
    const contrato = contratosCargados.find(c => c.id === id);
    if (!contrato) {
        mostrarError('No se encontró el contrato.');
        return;
    }

    // Cargar fracciones y cláusulas
    const fracciones = await ejecutarConsulta(
        db.from('fracciones_catastrales').select('*').eq('contrato_id', id),
        'cargar fracciones'
    );

    const clausulas = await ejecutarConsulta(
        db.from('clausulas_contrato').select('*').eq('contrato_id', id),
        'cargar cláusulas'
    );

    const nombreArr = contrato.arrendadores?.nombre || 'Sin nombre';
    const estadoBadge = obtenerBadgeEstado(contrato.estado_calculado);
    const renspaBadge = obtenerBadgeRenspa(contrato);
    const diasRestantes = calcularDiasRestantes(contrato.fecha_fin);

    let fraccionesHTML = '';
    if (fracciones && fracciones.length > 0) {
        fraccionesHTML = `
            <hr class="form-separador">
            <div class="form-seccion-titulo">Fracciones catastrales (${fracciones.length})</div>
            <table class="tabla" style="font-size: var(--texto-sm);">
                <thead>
                    <tr>
                        <th>Denominación</th>
                        <th>Nro cuenta</th>
                        <th>Hectáreas</th>
                        <th>Titularidad</th>
                    </tr>
                </thead>
                <tbody>
                    ${fracciones.map(f => `
                        <tr>
                            <td>${f.denominacion_catastral || '—'}</td>
                            <td>${f.nro_cuenta || '—'}</td>
                            <td>${f.hectareas ? f.hectareas + ' ha' : '—'}</td>
                            <td>${f.porcentaje_titularidad ? f.porcentaje_titularidad + '%' : '—'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <p style="font-size: var(--texto-sm); color: var(--color-texto-tenue); margin-top: var(--espacio-sm);">
                Total: ${fracciones.reduce((sum, f) => sum + (f.hectareas || 0), 0).toFixed(2)} ha
            </p>
        `;
    }

    let clausulasHTML = '';
    if (clausulas && clausulas.length > 0) {
        const tiposLabels = {
            cultivos_permitidos: 'Cultivos permitidos',
            malezas: 'Control de malezas',
            subarrendar: 'Subarrendar',
            inspeccion: 'Inspección',
            impuestos: 'Impuestos',
            otra: 'Otra'
        };

        clausulasHTML = `
            <hr class="form-separador">
            <div class="form-seccion-titulo">Cláusulas relevantes</div>
            <div style="display: flex; flex-direction: column; gap: var(--espacio-sm);">
                ${clausulas.map(cl => `
                    <div style="padding: var(--espacio-sm) var(--espacio-md); background-color: var(--color-fondo-secundario); border-radius: var(--radio-md); border: 1px solid var(--color-borde);">
                        <span class="badge badge-gris" style="margin-bottom: 4px;">${tiposLabels[cl.tipo] || cl.tipo}</span>
                        <p style="font-size: var(--texto-sm); color: var(--color-texto); margin-top: 4px;">${cl.descripcion}</p>
                    </div>
                `).join('')}
            </div>
        `;
    }

    const contenido = `
        <div class="contrato-detalle-grid">
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Arrendador</span>
                <span class="contrato-detalle-valor"><strong>${nombreArr}</strong></span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Estado</span>
                <span class="contrato-detalle-valor">${estadoBadge} ${diasRestantes ? `<span style="font-size: var(--texto-sm); color: var(--color-texto-tenue); margin-left: var(--espacio-sm);">${diasRestantes}</span>` : ''}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Fecha de inicio</span>
                <span class="contrato-detalle-valor">${formatearFecha(contrato.fecha_inicio)}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Fecha de fin</span>
                <span class="contrato-detalle-valor">${formatearFecha(contrato.fecha_fin)}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Hectáreas arrendadas</span>
                <span class="contrato-detalle-valor"><strong>${contrato.hectareas ? contrato.hectareas + ' ha' : '—'}</strong></span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Quintales pactados/año</span>
                <span class="contrato-detalle-valor"><strong>${formatearQQ(contrato.qq_pactados_anual)}</strong></span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Grano</span>
                <span class="contrato-detalle-valor">${contrato.grano || '—'}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Tipo</span>
                <span class="contrato-detalle-valor" style="text-transform: capitalize;">${contrato.tipo || 'Arrendamiento'}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">RENSPA</span>
                <span class="contrato-detalle-valor">${contrato.renspa_numero || '—'} ${renspaBadge}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Vencimiento RENSPA</span>
                <span class="contrato-detalle-valor">${contrato.renspa_vencimiento ? formatearFecha(contrato.renspa_vencimiento) : '—'}</span>
            </div>
        </div>

        ${contrato.pdf_url ? `
            <hr class="form-separador">
            <div class="form-seccion-titulo">Documento</div>
            <div class="pdf-archivo-actual">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <div class="pdf-archivo-info">
                    <div class="pdf-archivo-nombre">Contrato PDF</div>
                </div>
                <div class="pdf-archivo-acciones">
                    <button onclick="verPDFContrato('${contrato.pdf_url}')">Ver PDF</button>
                </div>
            </div>
        ` : ''}

        ${fraccionesHTML}
        ${clausulasHTML}
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cerrar</button>
    `;

    abrirModal(`Contrato — ${nombreArr}`, contenido, footer);
}

// ==============================================
// ELIMINAR — Borrar contrato
// ==============================================

function confirmarEliminarContrato(id, nombreArrendador) {
    window.__idEliminarContrato = id;
    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto); margin-bottom: var(--espacio-md);">
            ¿Seguro que querés eliminar el contrato de <strong>${nombreArrendador}</strong>?
        </p>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">
            Se eliminará el contrato junto con sus fracciones catastrales y cláusulas.
            Esta acción no se puede deshacer.
        </p>
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-peligro" onclick="cerrarModal(); eliminarContrato(window.__idEliminarContrato)">
            Sí, eliminar
        </button>
    `;
    abrirModal('Confirmar eliminación', contenido, footer);
}

async function eliminarContrato(id) {
    // Las fracciones y cláusulas se eliminan en cascada (ON DELETE CASCADE)
    const resultado = await ejecutarConsulta(
        db.from('contratos').delete().eq('id', id),
        'eliminar contrato'
    );

    if (resultado !== undefined) {
        mostrarExito('Contrato eliminado');
        await cargarContratos();
    }
}
