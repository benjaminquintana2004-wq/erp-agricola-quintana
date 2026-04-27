// ==============================================
// contratos.js — CRUD de contratos de arrendamiento
// Crear, editar, ver y eliminar contratos.
// Incluye: subida de PDF, extracción con Gemini,
// fracciones catastrales, cláusulas y RENSPA.
// ==============================================

// Datos en memoria
let contratosCargados = [];
let arrendadoresParaSelect = [];   // catálogo global para buscar/vincular
let contratoEditandoId = null;
let filtroEstadoActual = 'todos';
let filtroEmpresaActual = 'todas';
let archivoPDFSeleccionado = null;

// Estado del formulario de contrato (multi-arrendador)
// Cada item: { id|null, tipo, nombre_completo, nombre_pila, apellido,
//              dni, cuit, domicilio, es_titular_principal, _existente }
let arrendadoresContrato = [];
// IDs originalmente vinculados al contrato al abrir el form (para diff al guardar)
let arrendadoresOriginalIds = new Set();
// Flag: si el usuario editó el nombre del grupo a mano, no lo pisamos con el autocálculo
let nombreGrupoEditadoManualmente = false;

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

    // Cargar contratos junto con los arrendadores vinculados via pivot
    const data = await ejecutarConsulta(
        db.from('contratos')
            .select(`
                *,
                contratos_arrendadores (
                    arrendador_id,
                    es_titular_principal,
                    orden,
                    arrendadores ( id, nombre, tipo, apellido, nombre_pila, dni, cuit )
                )
            `)
            .order('fecha_fin', { ascending: true }),
        'cargar contratos'
    );

    if (data === undefined) return;

    // Cargar catálogo completo de arrendadores (para búsqueda en el form)
    const arrendadores = await ejecutarConsulta(
        db.from('arrendadores')
            .select('id, nombre, tipo, apellido, nombre_pila, dni, cuit, domicilio')
            .eq('activo', true)
            .order('nombre'),
        'cargar arrendadores para select'
    );

    if (arrendadores !== undefined) {
        arrendadoresParaSelect = arrendadores;
    }

    // Calcular el estado de cada contrato + normalizar la lista de arrendadores
    contratosCargados = data.map(c => {
        const vinculos = (c.contratos_arrendadores || [])
            .slice()
            .sort((a, b) => {
                // Titular primero, después por orden
                if (a.es_titular_principal && !b.es_titular_principal) return -1;
                if (!a.es_titular_principal && b.es_titular_principal) return 1;
                return (a.orden || 0) - (b.orden || 0);
            });
        return {
            ...c,
            arrendadores_vinculados: vinculos,
            estado_calculado: calcularEstadoContrato(c),
            renspa_estado_calculado: calcularEstadoRenspa(c)
        };
    });

    // Actualizar el estado en la base de datos si cambió
    actualizarEstadosEnBD(contratosCargados);

    renderizarTablaContratos(contratosCargados);
    actualizarContadores(contratosCargados);
    mostrarAlertas(contratosCargados);
}

/**
 * Calcula el estado del contrato según las fechas.
 * - vigente: falta más de 6 meses (180 días) para vencer
 * - por_vencer: faltan 6 meses (180 días) o menos
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
    if (diasRestantes <= 180) return 'por_vencer';
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
    // Filtrar por estado y empresa
    let mostrar = contratos;
    if (filtroEstadoActual !== 'todos') {
        mostrar = mostrar.filter(c => c.estado_calculado === filtroEstadoActual);
    }
    if (filtroEmpresaActual !== 'todas') {
        mostrar = mostrar.filter(c => (c.empresa || 'diego_quintana') === filtroEmpresaActual);
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
        const vinculos = c.arrendadores_vinculados || [];
        const arrendadoresMin = vinculos
            .map(v => v.arrendadores)
            .filter(Boolean);

        // Nombre del grupo: usa nombre_grupo si está, sino arma uno
        const nombreGrupo = c.nombre_grupo
            || (arrendadoresMin[0]?.nombre || 'Sin arrendador');

        // Subtítulo: CUIT si es uno solo, nombres si son 2-3, "N arrendadores" si son más
        let subtitulo = '';
        if (arrendadoresMin.length === 1) {
            subtitulo = arrendadoresMin[0].cuit || arrendadoresMin[0].dni || '';
        } else if (arrendadoresMin.length >= 2 && arrendadoresMin.length <= 3) {
            subtitulo = arrendadoresMin.map(a => a.nombre).filter(Boolean).join(' · ');
        } else if (arrendadoresMin.length > 3) {
            subtitulo = `${arrendadoresMin.length} arrendadores`;
        }

        const campoContrato = c.campo || '—';
        const estadoBadge = obtenerBadgeEstado(c.estado_calculado);
        const renspaBadge = obtenerBadgeRenspa(c);
        const diasRestantes = calcularDiasRestantes(c.fecha_fin);
        const empresaBadge = obtenerBadgeEmpresa(c.empresa);

        return `
        <tr>
            <td>
                <strong>${nombreGrupo}</strong>
                ${subtitulo ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">${subtitulo}</span>` : ''}
            </td>
            <td>${empresaBadge}</td>
            <td>${campoContrato}</td>
            <td>${mostrarHectareas(c)}</td>
            <td>${renderizarQQAnualCelda(c)}</td>
            <td>
                <span style="font-size: var(--texto-sm);">
                    ${formatearFecha(c.fecha_inicio)} — ${formatearFecha(c.fecha_fin)}
                </span>
                ${diasRestantes !== null ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">${diasRestantes}</span>` : ''}
            </td>
            <td>
                <div style="display:flex; flex-direction:column; gap:3px; align-items:flex-start;">
                    ${estadoBadge}
                    ${renderBadgeAdelanto(c)}
                </div>
            </td>
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
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarContrato('${c.id}', '${nombreGrupo.replace(/'/g, "\\'")}')" title="Eliminar">
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
function renderizarQQAnualCelda(c) {
    const blanco = parseFloat(c.qq_pactados_anual || 0);
    const negro = parseFloat(c.qq_negro_anual || 0);
    const total = blanco + negro;

    if (total <= 0) {
        return '<span style="color: var(--color-texto-tenue);">—</span>';
    }

    const totalStr = Number(total).toLocaleString('es-AR', { maximumFractionDigits: 2 });
    let detalle = '';
    if (blanco > 0 && negro > 0) {
        detalle = `B: ${Number(blanco).toLocaleString('es-AR')} · N: ${Number(negro).toLocaleString('es-AR')}`;
    } else if (negro > 0) {
        detalle = 'Negro';
    } else if (blanco > 0) {
        detalle = 'Blanco';
    }

    return `
        <strong>${totalStr} qq</strong>
        ${detalle ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">${detalle}</span>` : ''}
    `;
}

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

function obtenerBadgeEmpresa(empresa) {
    if (empresa === 'el_ataco') {
        return '<span class="badge badge-azul">El Ataco</span>';
    }
    if (empresa === 'diego_quintana' || !empresa) {
        return '<span class="badge badge-dorado">Diego Quintana</span>';
    }
    return '<span class="badge badge-gris">—</span>';
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
    // Contadores de estado
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

    // Contadores de empresa
    const dq = contratos.filter(c => !c.empresa || c.empresa === 'diego_quintana').length;
    const ea = contratos.filter(c => c.empresa === 'el_ataco').length;
    document.getElementById('cont-emp-todas').textContent = contratos.length;
    document.getElementById('cont-emp-dq').textContent = dq;
    document.getElementById('cont-emp-ea').textContent = ea;
}

function actualizarContadorTexto(cantidad) {
    const contador = document.getElementById('tabla-contador');
    if (contador) {
        contador.textContent = `${cantidad} contrato${cantidad !== 1 ? 's' : ''}`;
    }
}

function filtrarPorEstado(estado) {
    filtroEstadoActual = estado;
    document.querySelectorAll('.filtro-btn:not(.filtro-empresa)').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.filtro === estado);
    });
    renderizarTablaContratos(contratosCargados);
}

function filtrarPorEmpresa(empresa) {
    filtroEmpresaActual = empresa;
    document.querySelectorAll('.filtro-empresa').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.empresa === empresa);
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
                ${vencidos.map(c => (c.nombre_grupo || c.arrendadores_vinculados?.[0]?.arrendadores?.nombre || 'Sin nombre')).join(', ')}</span>
            </div>
        `;
    }

    // Contratos por vencer (próximos 6 meses)
    const porVencer = contratos.filter(c => c.estado_calculado === 'por_vencer');
    if (porVencer.length > 0) {
        alertasHTML += `
            <div class="alerta-contrato alerta-contrato-amarillo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span><strong>${porVencer.length} contrato${porVencer.length > 1 ? 's' : ''} por vencer:</strong>
                ${porVencer.map(c => (c.nombre_grupo || c.arrendadores_vinculados?.[0]?.arrendadores?.nombre || 'Sin nombre')).join(', ')}</span>
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
                ${renspaVencidos.map(c => `${(c.nombre_grupo || c.arrendadores_vinculados?.[0]?.arrendadores?.nombre || 'Sin nombre')} (${c.renspa_numero})`).join(', ')}
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
                ${renspaPorVencer.map(c => `${(c.nombre_grupo || c.arrendadores_vinculados?.[0]?.arrendadores?.nombre || 'Sin nombre')} (vence ${formatearFecha(c.renspa_vencimiento)})`).join(', ')}</span>
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

    const filtrados = contratosCargados.filter(c => {
        if (c.nombre_grupo && c.nombre_grupo.toLowerCase().includes(t)) return true;
        if (c.campo && c.campo.toLowerCase().includes(t)) return true;
        if (c.renspa_numero && c.renspa_numero.includes(t)) return true;
        // Buscar en cualquier arrendador vinculado
        const vinculos = c.arrendadores_vinculados || [];
        return vinculos.some(v => {
            const a = v.arrendadores;
            if (!a) return false;
            return (a.nombre && a.nombre.toLowerCase().includes(t))
                || (a.cuit && a.cuit.includes(t))
                || (a.dni && a.dni.includes(t));
        });
    });

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
    arrendadoresContrato = [];
    arrendadoresOriginalIds = new Set();
    nombreGrupoEditadoManualmente = false;
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

    // Cargar arrendadores actualmente vinculados al contrato
    const vinculos = contrato.arrendadores_vinculados || [];
    arrendadoresContrato = vinculos
        .filter(v => v.arrendadores)
        .map(v => ({
            id: v.arrendadores.id,
            tipo: v.arrendadores.tipo || 'persona_fisica',
            nombre_completo: v.arrendadores.nombre || '',
            nombre_pila: v.arrendadores.nombre_pila || null,
            apellido: v.arrendadores.apellido || null,
            dni: v.arrendadores.dni || null,
            cuit: v.arrendadores.cuit || null,
            domicilio: v.arrendadores.domicilio || null,
            es_titular_principal: !!v.es_titular_principal,
            _existente: true
        }));
    arrendadoresOriginalIds = new Set(arrendadoresContrato.map(a => a.id).filter(Boolean));
    // Al editar, si ya tiene nombre_grupo, lo consideramos "manual" para no pisarlo
    nombreGrupoEditadoManualmente = !!contrato.nombre_grupo;

    abrirModalContrato('Editar Contrato', contrato);
}

function abrirModalContrato(titulo, datos) {
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
        <div class="form-seccion-titulo">Arrendadores del contrato</div>
        <span class="campo-ayuda" style="display:block; margin-bottom: var(--espacio-md);">
            Podés agregar uno o varios. Si la IA extrae el contrato, los completa automáticamente.
        </span>

        <div class="arrendadores-chips" id="arrendadores-chips">
            <!-- Se llena dinámicamente por renderChipsArrendadores() -->
        </div>

        <div id="form-nuevo-arrendador" style="display:none; margin-top: var(--espacio-md); padding: var(--espacio-md); background: var(--color-fondo-secundario); border-radius: var(--radio-md, 6px); border: 1px dashed var(--color-borde);">
            <!-- Sub-formulario para agregar un arrendador. Se renderiza al vuelo. -->
        </div>

        <div style="display:flex; gap: var(--espacio-sm); margin-top: var(--espacio-sm); flex-wrap: wrap;">
            <button type="button" class="btn-agregar-fraccion" onclick="mostrarFormNuevoArrendador()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Agregar arrendador
            </button>
        </div>

        <div class="campo-grupo" style="margin-top: var(--espacio-lg);">
            <label class="campo-label">Nombre del grupo <span class="campo-requerido">*</span></label>
            <input type="text" id="campo-nombre-grupo" class="campo-input"
                value="${datos.nombre_grupo || ''}"
                placeholder="Ej: Familia Rebufatti, ACME SA, Pérez y López"
                oninput="marcarNombreGrupoManual()">
            <span class="campo-ayuda" id="nombre-grupo-ayuda">Se completa automáticamente según los arrendadores que cargues. Podés editarlo.</span>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Campo / Establecimiento</label>
            <input type="text" id="campo-campo" class="campo-input"
                value="${datos.campo || ''}"
                placeholder="Ej: Villa Ascasubi, Córdoba">
            <span class="campo-ayuda">Nombre o ubicación del campo arrendado en este contrato</span>
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo">Contrato</div>

        <div class="campo-grupo">
            <label class="campo-label">Empresa arrendataria <span class="campo-requerido">*</span></label>
            <select id="campo-empresa" class="campo-select">
                <option value="diego_quintana" ${!datos.empresa || datos.empresa === 'diego_quintana' ? 'selected' : ''}>Diego Quintana</option>
                <option value="el_ataco" ${datos.empresa === 'el_ataco' ? 'selected' : ''}>El Ataco</option>
            </select>
            <span class="campo-ayuda">Empresa que figura como arrendataria en el contrato</span>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Fecha de inicio <span class="campo-requerido">*</span></label>
                <input type="text" data-fecha id="campo-fecha-inicio" class="campo-input" value="${isoADDMM(datos.fecha_inicio)}" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Fecha de fin <span class="campo-requerido">*</span></label>
                <input type="text" data-fecha id="campo-fecha-fin" class="campo-input" value="${isoADDMM(datos.fecha_fin)}" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Hectáreas arrendadas</label>
                <input type="number" id="campo-hectareas" class="campo-input" value="${datos.hectareas || ''}" placeholder="Ej: 33.30" step="0.01" min="0">
                <span class="campo-ayuda">Total de hectáreas que se arriendan en este contrato</span>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">QQ pactados por año (blanco) <span class="campo-requerido">*</span></label>
                <input type="number" id="campo-qq" class="campo-input" value="${datos.qq_pactados_anual || ''}" placeholder="Ej: 333" step="0.01" min="0">
                <span class="campo-ayuda">Total de qq que figuran en el contrato</span>
            </div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">QQ adicionales en negro por año</label>
            <input type="number" id="campo-qq-negro" class="campo-input" value="${datos.qq_negro_anual || ''}" placeholder="Ej: 133" step="0.01" min="0">
            <span class="campo-ayuda">Si hay un acuerdo verbal por qq extra fuera del contrato. Dejar en blanco si no aplica.</span>
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo">Pago adelantado <span style="font-weight: 400; color: var(--color-texto-tenue); font-size: var(--texto-xs);">(opcional)</span></div>

        <div class="campo-grupo">
            <label class="campo-checkbox-inline">
                <input type="checkbox" id="campo-tiene-adelanto" ${datos.adelanto_qq ? 'checked' : ''} onchange="toggleAdelantoCampos()">
                <span>Este contrato incluye un pago adelantado</span>
            </label>
            <span class="campo-ayuda">Marcalo si una parte de los qq pactados debe pagarse antes de una fecha específica (ej: "50% para la siembra").</span>
        </div>

        <div id="bloque-adelanto" style="display: ${datos.adelanto_qq ? 'block' : 'none'};">
            <div class="campos-fila">
                <div class="campo-grupo">
                    <label class="campo-label">QQ a adelantar</label>
                    <input type="number" id="campo-adelanto-qq" class="campo-input" value="${datos.adelanto_qq || ''}" placeholder="Ej: 166.5" step="0.01" min="0">
                    <span class="campo-ayuda">Cantidad de qq que se deben pagar por adelantado</span>
                </div>
                <div class="campo-grupo">
                    <label class="campo-label">Vencimiento (día y mes)</label>
                    <div style="display: flex; gap: 8px;">
                        <select id="campo-adelanto-dia" class="campo-select" style="flex: 1;">
                            <option value="">Día</option>
                            ${Array.from({length: 31}, (_, i) => i + 1).map(d =>
                                `<option value="${d}" ${Number(datos.adelanto_dia) === d ? 'selected' : ''}>${d}</option>`
                            ).join('')}
                        </select>
                        <select id="campo-adelanto-mes" class="campo-select" style="flex: 2;">
                            <option value="">Mes</option>
                            ${['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) =>
                                `<option value="${i + 1}" ${Number(datos.adelanto_mes) === (i + 1) ? 'selected' : ''}>${m}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <span class="campo-ayuda">Se repite todos los años (no incluye año específico)</span>
                </div>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Observaciones del adelanto</label>
                <textarea id="campo-adelanto-obs" class="campo-input" rows="2" placeholder="Ej: 50% según cláusula 5 del contrato, para la siembra">${datos.adelanto_observaciones || ''}</textarea>
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
                <input type="text" data-fecha id="campo-renspa-venc" class="campo-input" value="${isoADDMM(datos.renspa_vencimiento)}" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
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

    // Renderizar chips de arrendadores (estado cargado en editarContrato / abrirModalNuevoContrato)
    renderChipsArrendadores();
    // Si el nombre_grupo está vacío y hay arrendadores, autocalcularlo
    if (!contratoEditandoId && !nombreGrupoEditadoManualmente) {
        actualizarNombreGrupoAuto();
    }
}

// ==============================================
// PAGO ADELANTADO — Mostrar / ocultar campos
// ==============================================

function toggleAdelantoCampos() {
    const check = document.getElementById('campo-tiene-adelanto');
    const bloque = document.getElementById('bloque-adelanto');
    if (!check || !bloque) return;
    bloque.style.display = check.checked ? 'block' : 'none';
    if (!check.checked) {
        // Limpiar valores si se desactiva
        const qq = document.getElementById('campo-adelanto-qq');
        const dia = document.getElementById('campo-adelanto-dia');
        const mes = document.getElementById('campo-adelanto-mes');
        const obs = document.getElementById('campo-adelanto-obs');
        if (qq) qq.value = '';
        if (dia) dia.value = '';
        if (mes) mes.value = '';
        if (obs) obs.value = '';
    }
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
 * Lista de modelos Gemini en orden de preferencia.
 * Si el primero está saturado (503) o falla con error transitorio,
 * se cae al siguiente. Todos son gratuitos y aceptan PDF.
 */
const MODELOS_GEMINI = [
    'gemini-2.5-flash',      // mejor calidad, más saturado
    'gemini-2.0-flash',      // buen balance
    'gemini-1.5-flash'       // más estable, calidad un poco menor
];

// Errores HTTP que justifican reintentar (son transitorios del lado del servidor)
const CODIGOS_REINTENTO = [429, 500, 502, 503, 504];

/**
 * Actualiza el cartel de estado visible al usuario, si existe.
 */
function actualizarEstadoGemini(mensaje, tipo = 'cargando') {
    const container = document.getElementById('gemini-estado-container');
    if (!container) return;

    if (tipo === 'cargando') {
        container.innerHTML = `
            <div class="gemini-estado">
                <div class="spinner"></div>
                ${mensaje}
            </div>
        `;
    } else if (tipo === 'warning') {
        container.innerHTML = `
            <div class="gemini-estado" style="border-color: rgba(201, 168, 76, 0.4); color: var(--color-dorado);">
                <div class="spinner"></div>
                ${mensaje}
            </div>
        `;
    }
}

/**
 * Pausa la ejecución por los milisegundos indicados.
 */
function dormir(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Hace una única llamada al modelo Gemini indicado.
 * Si la respuesta no es ok, lanza un error con una propiedad .status
 * para que el orquestador pueda decidir si reintenta o cambia de modelo.
 */
async function invocarModeloGemini(apiKey, pdfBase64, modelo, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;

    const body = {
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
            maxOutputTokens: 16384
        }
    };

    // Solo 2.5 soporta thinkingConfig
    if (modelo.startsWith('gemini-2.5')) {
        body.generationConfig.thinkingConfig = { thinkingBudget: 2048 };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const mensaje = errorData.error?.message || `Error HTTP ${response.status}`;
        const err = new Error(mensaje);
        err.status = response.status;
        throw err;
    }

    const result = await response.json();
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

    // Parsear JSON (puede venir envuelto en ```json ... ```)
    let jsonStr = textoRespuesta.trim();
    if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\s*$/g, '').trim();
    }

    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('Error parseando JSON de Gemini. JSON completo:', jsonStr);
        throw new Error('La respuesta de Gemini no es un JSON válido.');
    }
}

/**
 * Llama a la API de Gemini para extraer datos del contrato.
 * Estrategia:
 *   1. Intenta con gemini-2.5-flash (mejor calidad).
 *   2. Si devuelve error transitorio (503/429/500...) reintenta hasta 3 veces
 *      con backoff exponencial (1s, 2s, 4s).
 *   3. Si agota reintentos, cae al siguiente modelo de la lista.
 *   4. Si todos los modelos fallan, lanza el último error.
 */
async function llamarGemini(apiKey, pdfBase64) {
    const prompt = `Analizá este contrato de arrendamiento agrícola argentino y extraé los siguientes datos en formato JSON estricto.

Si un campo no aparece en el documento, poné null. No inventes datos.

IMPORTANTE — Arrendadores múltiples: un contrato puede tener UNO o VARIOS arrendadores (propietarios/locadores/dadores del campo). Es común que sean hermanos, matrimonios, sucesiones o socios. Devolvé a TODOS en el array "arrendadores", uno por elemento. Si en el contrato aparece una sola razón social (empresa), devolvé un único elemento con tipo='empresa'.

Formato de respuesta (solo JSON, sin markdown ni explicaciones):
{
    "arrendadores": [
        {
            "tipo": "persona_fisica o empresa. Usá 'empresa' si es una razón social (SA, SRL, SAS, Ltda, Sucesión, Cooperativa, Asociación, etc.). Usá 'persona_fisica' para personas con nombre y apellido.",
            "nombre_completo": "nombre completo tal cual figura en el contrato. Para personas: 'Roberto Mateo Rebufatti'. Para empresas: 'Agropecuaria Los Álamos SA'.",
            "nombre_pila": "solo los nombres de pila, sin apellido. Ej: 'Roberto Mateo'. Null si es empresa.",
            "apellido": "solo el apellido. Ej: 'Rebufatti'. Si son varios apellidos (paterno+materno), devolvé los dos tal como están ('García López'). Null si es empresa.",
            "dni": "DNI sin puntos ni guiones, ej '10677055'. Null si es empresa o si no aparece.",
            "cuit": "CUIT en formato XX-XXXXXXXX-X (con guiones). Null si no aparece.",
            "domicilio": "domicilio completo si aparece, null si no."
        }
    ],
    "empresa_arrendataria": "empresa que figura como arrendataria (quien toma el campo en arriendo). Si dice 'Diego Ricardo Quintana' o similar devolvé 'diego_quintana'. Si dice 'El Ataco' o similar devolvé 'el_ataco'. Si no podés determinarlo devolvé null.",
    "fecha_inicio": "YYYY-MM-DD",
    "fecha_fin": "YYYY-MM-DD",
    "hectareas_totales": 0,
    "qq_por_hectarea": 0,
    "qq_totales_anual": 0,
    "grano": "tipo de grano principal (Soja/Maíz/Trigo/Girasol/Sorgo)",
    "campo_nombre": "nombre del campo o establecimiento",
    "ubicacion": "ciudad, localidad o zona donde está el campo (ej: Villa Ascasubi, Córdoba)",
    "renspa_numero": "número de RENSPA si aparece",
    "adelanto_qq": "cantidad de quintales que el contrato indica pagar por adelantado. Buscá cláusulas como 'se abonará por adelantado', 'el 50% antes de', 'mitad a la firma', 'adelanto de X qq', etc. Si no se menciona un pago adelantado, devolvé null. Si es un porcentaje del total, calculá la cantidad de qq en base al total anual. Solo un número, sin comas.",
    "adelanto_dia": "día del mes (1-31) en que vence el pago adelantado cada año. El adelanto se repite todas las campañas en el mismo día/mes, por eso solo día y mes sin año. Null si no hay adelanto o no hay fecha concreta.",
    "adelanto_mes": "mes (1-12) en que vence el pago adelantado cada año. Ejemplo: si el contrato dice 'antes del 30 de septiembre', adelanto_dia=30 y adelanto_mes=9. Null si no hay adelanto o no hay fecha concreta.",
    "adelanto_observaciones": "texto corto describiendo las condiciones del adelanto, tal como aparecen en el contrato (ej: '50% según cláusula 5, para la siembra'). Null si no hay adelanto.",
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

    let ultimoError = null;

    // Recorrer modelos en orden de preferencia
    for (let m = 0; m < MODELOS_GEMINI.length; m++) {
        const modelo = MODELOS_GEMINI[m];
        const esFallback = m > 0;

        // 3 intentos por modelo con backoff exponencial (1s, 2s, 4s)
        const maxIntentos = 3;
        for (let intento = 1; intento <= maxIntentos; intento++) {
            try {
                if (esFallback && intento === 1) {
                    actualizarEstadoGemini(
                        `El modelo principal está saturado. Probando con <strong>${modelo}</strong>...`,
                        'warning'
                    );
                } else if (intento > 1) {
                    actualizarEstadoGemini(
                        `Reintentando (${intento}/${maxIntentos}) con <strong>${modelo}</strong>...`,
                        'warning'
                    );
                }

                console.log(`[Gemini] Intento ${intento}/${maxIntentos} con ${modelo}`);
                const datos = await invocarModeloGemini(apiKey, pdfBase64, modelo, prompt);
                console.log(`[Gemini] Éxito con ${modelo} en intento ${intento}`);
                return datos;

            } catch (err) {
                ultimoError = err;
                console.warn(`[Gemini] Falló ${modelo} intento ${intento}:`, err.status || '', err.message);

                const esTransitorio = CODIGOS_REINTENTO.includes(err.status);

                // Error no transitorio (400, 401, JSON inválido, etc.) → no reintenta, salta de modelo
                if (!esTransitorio) {
                    break;
                }

                // Si quedan intentos para este modelo, esperar antes del próximo
                if (intento < maxIntentos) {
                    const espera = 1000 * Math.pow(2, intento - 1); // 1s, 2s, 4s
                    await dormir(espera);
                }
            }
        }
        // Agotados los 3 intentos de este modelo — pasa al siguiente
    }

    // Todos los modelos fallaron
    const msg = ultimoError?.status === 503
        ? 'Gemini está saturado en este momento. Probá de nuevo en unos minutos.'
        : (ultimoError?.message || 'Error desconocido al llamar a Gemini.');
    throw new Error(msg);
}

/**
 * Auto-completa los campos del formulario con los datos extraídos.
 * Si el arrendador no existe en la base de datos, lo crea automáticamente.
 */
async function autocompletarFormulario(datos) {
    // ---- Arrendadores (nuevo formato: array) ----
    // No se crean en la DB acá; se dejan en memoria en arrendadoresContrato.
    // Al guardar el contrato, los que no tengan id se insertarán.
    if (Array.isArray(datos.arrendadores) && datos.arrendadores.length > 0) {
        for (const a of datos.arrendadores) {
            if (!a) continue;

            // Buscar si ya existe en el catálogo (por CUIT, luego DNI)
            let existente = null;
            const cuitN = normalizarCuit(a.cuit);
            const dniN = normalizarDni(a.dni);
            if (cuitN) existente = arrendadoresParaSelect.find(x => normalizarCuit(x.cuit) === cuitN);
            if (!existente && dniN) existente = arrendadoresParaSelect.find(x => normalizarDni(x.dni) === dniN);

            // Evitar duplicados dentro del contrato
            const yaEnContrato = arrendadoresContrato.some(x =>
                (existente && x.id === existente.id) ||
                (cuitN && normalizarCuit(x.cuit) === cuitN)
            );
            if (yaEnContrato) continue;

            const tipo = a.tipo === 'empresa' ? 'empresa' : 'persona_fisica';
            const nombrePila = tipo === 'empresa' ? null : (a.nombre_pila || null);
            const apellido = tipo === 'empresa' ? null : (a.apellido || null);
            const nombreCompleto = a.nombre_completo
                || [nombrePila, apellido].filter(Boolean).join(' ').trim()
                || '(sin nombre)';

            arrendadoresContrato.push({
                id: existente?.id || null,
                tipo,
                nombre_completo: nombreCompleto,
                nombre_pila: nombrePila,
                apellido: apellido,
                dni: a.dni || null,
                cuit: a.cuit || null,
                domicilio: a.domicilio || null,
                es_titular_principal: false,
                _existente: !!existente
            });
        }

        renderChipsArrendadores();
        if (!nombreGrupoEditadoManualmente) actualizarNombreGrupoAuto();
    }

    // ---- Campo / ubicación ----
    const ubicacion = datos.ubicacion || datos.campo_nombre || null;
    if (ubicacion) {
        const campoCampo = document.getElementById('campo-campo');
        if (campoCampo && !campoCampo.value) campoCampo.value = ubicacion;
    }

    // Empresa arrendataria
    if (datos.empresa_arrendataria) {
        const campo = document.getElementById('campo-empresa');
        if (campo && ['diego_quintana', 'el_ataco'].includes(datos.empresa_arrendataria)) {
            campo.value = datos.empresa_arrendataria;
        }
    }

    // Fechas (Gemini devuelve ISO YYYY-MM-DD; nuestros inputs son dd/mm/aaaa)
    if (datos.fecha_inicio) {
        const campo = document.getElementById('campo-fecha-inicio');
        if (campo) campo.value = isoADDMM(datos.fecha_inicio);
    }
    if (datos.fecha_fin) {
        const campo = document.getElementById('campo-fecha-fin');
        if (campo) campo.value = isoADDMM(datos.fecha_fin);
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

    // Pago adelantado — si Gemini detectó algún dato, activamos el bloque
    const hayAdelanto = datos.adelanto_qq || datos.adelanto_dia || datos.adelanto_mes || datos.adelanto_observaciones;
    if (hayAdelanto) {
        const checkbox = document.getElementById('campo-tiene-adelanto');
        if (checkbox) {
            checkbox.checked = true;
            if (typeof toggleAdelantoCampos === 'function') toggleAdelantoCampos();
        }
        if (datos.adelanto_qq) {
            const c = document.getElementById('campo-adelanto-qq');
            if (c) c.value = datos.adelanto_qq;
        }
        if (datos.adelanto_dia) {
            const c = document.getElementById('campo-adelanto-dia');
            if (c) c.value = datos.adelanto_dia;
        }
        if (datos.adelanto_mes) {
            const c = document.getElementById('campo-adelanto-mes');
            if (c) c.value = datos.adelanto_mes;
        }
        if (datos.adelanto_observaciones) {
            const c = document.getElementById('campo-adelanto-obs');
            if (c) c.value = datos.adelanto_observaciones;
        }
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
    const empresa = document.getElementById('campo-empresa')?.value;
    const fechaInicio = ddmmAISO(document.getElementById('campo-fecha-inicio')?.value);
    const fechaFin = ddmmAISO(document.getElementById('campo-fecha-fin')?.value);
    const hectareas = document.getElementById('campo-hectareas')?.value;
    const qqPactados = document.getElementById('campo-qq')?.value;
    const qqNegroAnual = document.getElementById('campo-qq-negro')?.value;
    const grano = document.getElementById('campo-grano')?.value;
    const tipo = document.getElementById('campo-tipo')?.value;
    const renspaNumero = document.getElementById('campo-renspa')?.value.trim();
    const renspaVenc = ddmmAISO(document.getElementById('campo-renspa-venc')?.value);
    const nombreGrupo = document.getElementById('campo-nombre-grupo')?.value.trim();
    const campoContrato = document.getElementById('campo-campo')?.value.trim();

    // Pago adelantado (opcional)
    const tieneAdelanto = document.getElementById('campo-tiene-adelanto')?.checked;
    const adelantoQQ = tieneAdelanto ? document.getElementById('campo-adelanto-qq')?.value : '';
    const adelantoDia = tieneAdelanto ? document.getElementById('campo-adelanto-dia')?.value : '';
    const adelantoMes = tieneAdelanto ? document.getElementById('campo-adelanto-mes')?.value : '';
    const adelantoObs = tieneAdelanto ? document.getElementById('campo-adelanto-obs')?.value.trim() : '';

    // Validaciones
    if (arrendadoresContrato.length === 0) {
        mostrarError('Agregá al menos un arrendador al contrato.');
        return;
    }
    // Titular es opcional: puede quedar nadie marcado (contratos sin un principal)
    if (!nombreGrupo) {
        document.getElementById('campo-nombre-grupo')?.focus();
        mostrarError('Ingresá un nombre para el grupo de arrendadores.');
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

    // --------------------------------------------------------------
    // Paso 1: asegurar que cada arrendador exista en la DB.
    //         Los que vienen con id=null se INSERTAN ahora.
    // --------------------------------------------------------------
    for (let i = 0; i < arrendadoresContrato.length; i++) {
        const a = arrendadoresContrato[i];
        if (a.id) continue; // ya existe

        const payload = {
            nombre: a.nombre_completo,
            tipo: a.tipo,
            nombre_pila: a.nombre_pila || null,
            apellido: a.apellido || null,
            dni: a.dni || null,
            cuit: a.cuit || null,
            domicilio: a.domicilio || null
        };

        const insertado = await ejecutarConsulta(
            db.from('arrendadores').insert(payload).select(),
            `crear arrendador "${a.nombre_completo}"`
        );
        if (!insertado || insertado.length === 0) {
            mostrarError(`No se pudo crear el arrendador "${a.nombre_completo}". Operación cancelada.`);
            return;
        }
        a.id = insertado[0].id;
        a._existente = true;
        // Agregar al catálogo en memoria
        arrendadoresParaSelect.push(insertado[0]);
    }

    // --------------------------------------------------------------
    // Paso 2: subir PDF (si hay)
    // --------------------------------------------------------------
    let pdfUrl = contratoEditandoId
        ? contratosCargados.find(c => c.id === contratoEditandoId)?.pdf_url
        : null;

    if (archivoPDFSeleccionado) {
        // Nombre para el archivo: usamos nombre_grupo
        mostrarAlerta('Subiendo PDF...');
        pdfUrl = await subirPDFContrato(archivoPDFSeleccionado, nombreGrupo);
        if (!pdfUrl) return;
    }

    // Campaña activa (para el saldo)
    const campanaData = await ejecutarConsulta(
        db.from('campanas').select('id').eq('activa', true).limit(1),
        'obtener campaña activa'
    );
    const campanaId = campanaData?.[0]?.id || null;

    // Detectar cambio en qq al editar (para preguntar ajuste de saldo)
    let ajusteSaldoEdicion = null;
    if (contratoEditandoId) {
        const contratoAnterior = contratosCargados.find(c => c.id === contratoEditandoId);
        if (contratoAnterior) {
            const oldBlanco = parseFloat(contratoAnterior.qq_pactados_anual || 0);
            const oldNegro = parseFloat(contratoAnterior.qq_negro_anual || 0);
            const newBlanco = parseFloat(qqPactados || 0);
            const newNegro = parseFloat(qqNegroAnual || 0);
            const diffBlanco = newBlanco - oldBlanco;
            const diffNegro = newNegro - oldNegro;

            if (diffBlanco !== 0 || diffNegro !== 0) {
                let mensaje = 'Cambiaste los qq pactados:\n\n';
                if (diffBlanco !== 0) mensaje += `  Blanco: ${oldBlanco} → ${newBlanco}  (${diffBlanco >= 0 ? '+' : ''}${diffBlanco})\n`;
                if (diffNegro !== 0) mensaje += `  Negro: ${oldNegro} → ${newNegro}  (${diffNegro >= 0 ? '+' : ''}${diffNegro})\n`;
                mensaje += '\n¿Querés ajustar el saldo del contrato con esta diferencia?\n\nAceptar = ajustar saldo\nCancelar = solo actualizar contrato';

                if (confirm(mensaje)) {
                    ajusteSaldoEdicion = { diffBlanco, diffNegro };
                }
            }
        }
    }

    // --------------------------------------------------------------
    // Paso 3: insertar/actualizar el contrato
    // --------------------------------------------------------------
    const datosContrato = {
        nombre_grupo: nombreGrupo,
        campo: campoContrato || null,
        empresa: empresa || 'diego_quintana',
        campana_id: campanaId,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        hectareas: hectareas ? parseFloat(hectareas) : null,
        qq_pactados_anual: parseFloat(qqPactados),
        qq_negro_anual: qqNegroAnual ? parseFloat(qqNegroAnual) : 0,
        grano: grano || null,
        tipo: tipo || 'arrendamiento',
        pdf_url: pdfUrl || null,
        renspa_numero: renspaNumero || null,
        renspa_vencimiento: renspaVenc || null,
        adelanto_qq: tieneAdelanto && adelantoQQ ? parseFloat(adelantoQQ) : null,
        adelanto_dia: tieneAdelanto && adelantoDia ? parseInt(adelantoDia, 10) : null,
        adelanto_mes: tieneAdelanto && adelantoMes ? parseInt(adelantoMes, 10) : null,
        adelanto_observaciones: tieneAdelanto && adelantoObs ? adelantoObs : null
    };

    let resultado;
    let contratoId;

    if (contratoEditandoId) {
        resultado = await ejecutarConsulta(
            db.from('contratos').update(datosContrato).eq('id', contratoEditandoId).select(),
            'actualizar contrato'
        );
        contratoId = contratoEditandoId;
    } else {
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

    // --------------------------------------------------------------
    // Paso 4: sincronizar tabla pivot contratos_arrendadores
    //         Estrategia simple: borrar todo y reinsertar.
    // --------------------------------------------------------------
    await ejecutarConsulta(
        db.from('contratos_arrendadores').delete().eq('contrato_id', contratoId),
        'limpiar vínculos anteriores'
    );

    const vinculos = arrendadoresContrato.map((a, idx) => ({
        contrato_id: contratoId,
        arrendador_id: a.id,
        es_titular_principal: !!a.es_titular_principal,
        orden: idx
    }));

    const vinculosInsertados = await ejecutarConsulta(
        db.from('contratos_arrendadores').insert(vinculos).select(),
        'vincular arrendadores al contrato'
    );
    if (vinculosInsertados === undefined) return;

    // Fracciones y cláusulas (igual que antes)
    await guardarFracciones(contratoId);
    await guardarClausulas(contratoId);

    // --------------------------------------------------------------
    // Paso 5: inicializar / ajustar saldo (ahora por contrato)
    // --------------------------------------------------------------
    if (campanaId) {
        if (!contratoEditandoId) {
            await inicializarSaldoContrato(
                contratoId,
                campanaId,
                parseFloat(qqPactados || 0),
                parseFloat(qqNegroAnual || 0)
            );
        } else if (ajusteSaldoEdicion) {
            await inicializarSaldoContrato(
                contratoId,
                campanaId,
                ajusteSaldoEdicion.diffBlanco,
                ajusteSaldoEdicion.diffNegro
            );
        }
    }

    cerrarModal();
    mostrarExito(contratoEditandoId ? 'Contrato actualizado' : 'Contrato creado');
    contratoEditandoId = null;
    archivoPDFSeleccionado = null;
    arrendadoresContrato = [];
    arrendadoresOriginalIds = new Set();
    nombreGrupoEditadoManualmente = false;
    await cargarContratos();
}

// ==============================================
// INICIALIZAR SALDO — usado al crear o editar contratos
// ==============================================

/**
 * Inicializa o ajusta el saldo del arrendador para una campaña.
 * Si ya existe un saldo para (arrendador, campaña), suma los qq pasados
 * a los valores existentes. Si no existe, crea un registro nuevo.
 * Útil tanto para inicializar (saldo nuevo) como para ajustar (pasar diff).
 */
async function inicializarSaldoContrato(contratoId, campanaId, qqBlanco, qqNegro) {
    if (!contratoId || !campanaId) return;

    const saldos = await ejecutarConsulta(
        db.from('saldos')
            .select('*')
            .eq('contrato_id', contratoId)
            .eq('campana_id', campanaId),
        'buscar saldo para inicializar'
    );

    if (saldos && saldos.length > 0) {
        const s = saldos[0];
        const nuevoBlanco = parseFloat(s.qq_deuda_blanco || 0) + parseFloat(qqBlanco || 0);
        const nuevoNegro = parseFloat(s.qq_deuda_negro || 0) + parseFloat(qqNegro || 0);
        await ejecutarConsulta(
            db.from('saldos')
                .update({ qq_deuda_blanco: nuevoBlanco, qq_deuda_negro: nuevoNegro })
                .eq('id', s.id),
            'ajustar saldo existente'
        );
    } else {
        await ejecutarConsulta(
            db.from('saldos').insert({
                contrato_id: contratoId,
                campana_id: campanaId,
                qq_deuda_blanco: parseFloat(qqBlanco || 0),
                qq_deuda_negro: parseFloat(qqNegro || 0)
            }),
            'crear saldo inicial del contrato'
        );
    }
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

    const vinculos = (contrato.arrendadores_vinculados || contrato.contratos_arrendadores || [])
        .slice()
        .sort((a, b) => {
            if (a.es_titular_principal !== b.es_titular_principal) {
                return a.es_titular_principal ? -1 : 1;
            }
            return (a.orden || 0) - (b.orden || 0);
        });
    const arrendadoresVinc = vinculos.map(v => v.arrendadores).filter(Boolean);
    const nombreGrupo = contrato.nombre_grupo || arrendadoresVinc[0]?.nombre || 'Sin nombre';
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
                <span class="contrato-detalle-label">${arrendadoresVinc.length > 1 ? 'Grupo' : 'Arrendador'}</span>
                <span class="contrato-detalle-valor"><strong>${nombreGrupo}</strong></span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Campo</span>
                <span class="contrato-detalle-valor">${contrato.campo || '—'}</span>
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

        ${arrendadoresVinc.length > 0 ? `
            <hr class="form-separador">
            <div class="form-seccion-titulo">Arrendadores del contrato (${arrendadoresVinc.length})</div>
            <div style="display: flex; flex-direction: column; gap: var(--espacio-sm);">
                ${vinculos.map(v => {
                    const a = v.arrendadores;
                    if (!a) return '';
                    const tipoLabel = a.tipo === 'empresa' ? 'Empresa' : 'Persona';
                    const id = a.cuit ? `CUIT ${a.cuit}` : (a.dni ? `DNI ${a.dni}` : '');
                    return `
                        <div style="display: flex; align-items: center; gap: var(--espacio-sm); padding: var(--espacio-sm) var(--espacio-md); background-color: var(--color-fondo-secundario); border-radius: var(--radio-md); border: 1px solid var(--color-borde);">
                            ${v.es_titular_principal ? '<span style="color: var(--color-acento); font-size: var(--texto-md);" title="Titular principal">★</span>' : ''}
                            <div style="flex: 1;">
                                <div style="font-weight: 600;">${a.nombre || '—'}</div>
                                <div style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">
                                    ${tipoLabel}${id ? ' · ' + id : ''}
                                </div>
                            </div>
                            ${v.es_titular_principal ? '<span class="badge badge-amarillo">Titular</span>' : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        ` : ''}

        ${contrato.adelanto_qq ? `
            <hr class="form-separador">
            <div class="form-seccion-titulo">Pago adelantado</div>
            <div class="contrato-detalle-grid">
                <div class="contrato-detalle-item">
                    <span class="contrato-detalle-label">QQ a adelantar</span>
                    <span class="contrato-detalle-valor"><strong>${formatearQQ(contrato.adelanto_qq)}</strong></span>
                </div>
                <div class="contrato-detalle-item">
                    <span class="contrato-detalle-label">Vencimiento anual</span>
                    <span class="contrato-detalle-valor">${formatearDiaMes(contrato.adelanto_dia, contrato.adelanto_mes)}</span>
                </div>
                ${contrato.adelanto_observaciones ? `
                    <div class="contrato-detalle-item" style="grid-column: 1 / -1;">
                        <span class="contrato-detalle-label">Observaciones</span>
                        <span class="contrato-detalle-valor">${contrato.adelanto_observaciones}</span>
                    </div>
                ` : ''}
            </div>
        ` : ''}

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

    abrirModal(`Contrato — ${nombreGrupo}`, contenido, footer);
}

// ==============================================
// ELIMINAR — Borrar contrato
// ==============================================

async function confirmarEliminarContrato(id, nombreGrupo) {
    // Buscar el contrato en memoria
    const contrato = contratosCargados.find(c => c.id === id);
    if (!contrato) {
        mostrarError('No se encontró el contrato.');
        return;
    }

    window.__idEliminarContrato = id;

    // Si no hay campaña, no hay saldo ni movimientos asociados para verificar
    if (!contrato.campana_id) {
        const contenido = `
            <p style="font-size: var(--texto-lg); color: var(--color-texto); margin-bottom: var(--espacio-md);">
                ¿Seguro que querés eliminar el contrato de <strong>${nombreGrupo}</strong>?
            </p>
            <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">
                Se eliminará el contrato junto con sus fracciones, cláusulas y vínculos con arrendadores.
                Los arrendadores (personas/empresas) NO se eliminan.
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
        return;
    }

    // Verificar si hay movimientos asociados a este contrato
    const movimientos = await ejecutarConsulta(
        db.from('movimientos')
            .select('id, fecha, qq, tipo, estado_factura')
            .eq('contrato_id', id),
        'verificar movimientos asociados'
    );

    if (movimientos && movimientos.length > 0) {
        const cant = movimientos.length;
        const totalQQ = movimientos.reduce((s, m) => s + parseFloat(m.qq || 0), 0);

        const contenido = `
            <div style="background: rgba(220, 38, 38, 0.1); border: 1px solid rgba(220, 38, 38, 0.4); border-radius: 8px; padding: var(--espacio-md); margin-bottom: var(--espacio-md);">
                <p style="font-size: var(--texto-lg); color: var(--color-texto); margin: 0 0 var(--espacio-sm) 0;">
                    <strong>No se puede eliminar este contrato</strong>
                </p>
                <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario); margin: 0;">
                    Hay <strong>${cant} movimiento${cant === 1 ? '' : 's'}</strong> cargado${cant === 1 ? '' : 's'} para ${nombreGrupo}
                    (${formatearQQ(totalQQ)} en total).
                </p>
            </div>
            <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">
                Para eliminar el contrato, primero revisá o eliminá los movimientos asociados
                desde la sección <strong>Movimientos</strong>.
            </p>
        `;
        const footer = `
            <button class="btn-secundario" onclick="cerrarModal()">Entendido</button>
            <button class="btn-primario" onclick="cerrarModal(); window.location.href='/movimientos.html?contrato=${id}'">
                Ver movimientos
            </button>
        `;
        abrirModal('Eliminación bloqueada', contenido, footer);
        return;
    }

    // Sin movimientos — se puede eliminar
    const qqBlanco = parseFloat(contrato.qq_pactados_anual || 0);
    const qqNegro = parseFloat(contrato.qq_negro_anual || 0);
    const hayQQ = qqBlanco > 0 || qqNegro > 0;

    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto); margin-bottom: var(--espacio-md);">
            ¿Seguro que querés eliminar el contrato de <strong>${nombreGrupo}</strong>?
        </p>
        <div style="background: var(--color-fondo-terciario); border-radius: 8px; padding: var(--espacio-md); margin-bottom: var(--espacio-md);">
            <p style="font-size: var(--texto-sm); color: var(--color-texto); margin: 0 0 var(--espacio-sm) 0;">
                <strong>Qué se va a hacer:</strong>
            </p>
            <ul style="font-size: var(--texto-sm); color: var(--color-texto-secundario); margin: 0; padding-left: var(--espacio-lg);">
                <li>Eliminar el contrato, sus fracciones catastrales, cláusulas y vínculos con arrendadores.</li>
                ${hayQQ ? `<li>Eliminar el saldo de esta campaña para este contrato (<strong>${formatearQQ(qqBlanco)} blanco</strong>${qqNegro > 0 ? ` y <strong>${formatearQQ(qqNegro)} negro</strong>` : ''}).</li>` : ''}
                <li>Los arrendadores (personas/empresas) NO se borran — quedan en el directorio.</li>
            </ul>
        </div>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">
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
    const contrato = contratosCargados.find(c => c.id === id);
    if (!contrato) {
        mostrarError('No se encontró el contrato.');
        return;
    }

    // Borrar contrato. Fracciones, cláusulas, saldos y pivot se
    // eliminan en cascada por FK (ON DELETE CASCADE).
    const resultado = await ejecutarConsulta(
        db.from('contratos').delete().eq('id', id),
        'eliminar contrato'
    );

    if (resultado === undefined) return;

    mostrarExito('Contrato eliminado');
    await cargarContratos();
}

// ==============================================
// ARRENDADORES DEL CONTRATO — chips y helpers
// ==============================================

/**
 * Normaliza un CUIT: saca guiones, espacios y puntos.
 * Se usa para comparar duplicados de forma consistente.
 */
function normalizarCuit(cuit) {
    if (!cuit) return '';
    return String(cuit).replace(/[-\s.]/g, '').trim();
}

function normalizarDni(dni) {
    if (!dni) return '';
    return String(dni).replace(/[-\s.]/g, '').trim();
}

/**
 * Formatea día+mes como "30 de septiembre" (sin año, se repite cada campaña).
 */
function formatearDiaMes(dia, mes) {
    if (!dia || !mes) return '—';
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const m = meses[Number(mes) - 1];
    if (!m) return '—';
    return `${Number(dia)} de ${m}`;
}

/**
 * Dibuja la lista de arrendadores del contrato en el DOM.
 * Se llama cada vez que cambia el array arrendadoresContrato.
 */
function renderChipsArrendadores() {
    const cont = document.getElementById('arrendadores-chips');
    if (!cont) return;

    if (arrendadoresContrato.length === 0) {
        cont.innerHTML = `
            <div style="padding: var(--espacio-md); text-align:center; color: var(--color-texto-tenue); border: 1px dashed var(--color-borde); border-radius: var(--radio-md, 6px);">
                Sin arrendadores cargados. Subí el PDF y usá la IA, o agregalos a mano.
            </div>
        `;
        return;
    }

    cont.innerHTML = arrendadoresContrato.map((a, idx) => {
        const tipoIcon = a.tipo === 'empresa'
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

        const badgeTitular = a.es_titular_principal
            ? '<span class="badge badge-dorado" style="font-size: 10px; margin-left: 6px;">TITULAR</span>'
            : '';
        const badgeExistente = a._existente
            ? '<span class="badge badge-verde" style="font-size: 10px; margin-left: 6px;" title="Ya existe en la base de datos">existente</span>'
            : '<span class="badge badge-gris" style="font-size: 10px; margin-left: 6px;" title="Se creará al guardar">nuevo</span>';

        const detalles = [];
        if (a.dni) detalles.push('DNI ' + a.dni);
        if (a.cuit) detalles.push('CUIT ' + a.cuit);

        return `
            <div style="display:flex; align-items:flex-start; gap: var(--espacio-sm); padding: var(--espacio-sm) var(--espacio-md); background: var(--color-fondo-secundario); border-radius: var(--radio-md, 6px); border: 1px solid var(--color-borde); margin-bottom: var(--espacio-sm);">
                <div style="color: var(--color-dorado); margin-top: 2px;">${tipoIcon}</div>
                <div style="flex: 1;">
                    <div style="font-weight: 600;">
                        ${a.nombre_completo || '(sin nombre)'}
                        ${badgeTitular}
                        ${badgeExistente}
                    </div>
                    ${detalles.length ? `<div style="font-size: var(--texto-xs); color: var(--color-texto-tenue); margin-top: 2px;">${detalles.join(' · ')}</div>` : ''}
                </div>
                <div style="display:flex; gap: 4px; flex-wrap: wrap;">
                    ${!a.es_titular_principal ? `
                        <button type="button" class="tabla-btn" onclick="marcarTitularPrincipal(${idx})" title="Marcar como titular">★</button>
                    ` : ''}
                    <button type="button" class="tabla-btn" onclick="editarArrendadorChip(${idx})" title="Editar">✎</button>
                    <button type="button" class="tabla-btn btn-eliminar" onclick="quitarArrendadorChip(${idx})" title="Quitar del contrato">✕</button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Alterna el titular principal.
 * Si el arrendador ya era titular, lo desmarca (queda sin titular).
 * Si no lo era, lo marca y desmarca a los demás.
 * El titular es opcional: puede haber cero o uno.
 */
function marcarTitularPrincipal(idx) {
    const a = arrendadoresContrato[idx];
    if (!a) return;
    if (a.es_titular_principal) {
        // Ya era titular → destitular
        a.es_titular_principal = false;
    } else {
        // No era titular → marcarlo y desmarcar a los demás
        arrendadoresContrato.forEach((x, i) => {
            x.es_titular_principal = (i === idx);
        });
    }
    renderChipsArrendadores();
}

/**
 * Saca un arrendador del contrato (no lo elimina de la base — solo lo desvincula).
 */
function quitarArrendadorChip(idx) {
    const a = arrendadoresContrato[idx];
    if (!a) return;
    if (!confirm(`¿Quitar a "${a.nombre_completo}" de este contrato?`)) return;
    arrendadoresContrato.splice(idx, 1);
    // Si era el titular y quedan otros, marcar el primero
    if (a.es_titular_principal && arrendadoresContrato.length > 0) {
        arrendadoresContrato[0].es_titular_principal = true;
    }
    renderChipsArrendadores();
    if (!nombreGrupoEditadoManualmente) actualizarNombreGrupoAuto();
}

/**
 * Edita un arrendador existente en el contrato.
 * Abre el mini-form con los datos del arrendador para modificar.
 */
function editarArrendadorChip(idx) {
    const a = arrendadoresContrato[idx];
    if (!a) return;
    mostrarFormNuevoArrendador(idx);
}

/**
 * Muestra el sub-formulario para agregar (o editar, si se pasa idx) un arrendador.
 * Si se pasa idx, se precargan los datos del arrendador existente en el array.
 */
function mostrarFormNuevoArrendador(idx = null) {
    const bloque = document.getElementById('form-nuevo-arrendador');
    if (!bloque) return;

    const editando = idx !== null;
    const a = editando ? arrendadoresContrato[idx] : {
        tipo: 'persona_fisica',
        nombre_completo: '',
        nombre_pila: '',
        apellido: '',
        dni: '',
        cuit: '',
        domicilio: ''
    };

    // Armar opciones de búsqueda (solo al agregar, no al editar)
    const datalistOpts = !editando
        ? arrendadoresParaSelect.map(x =>
            `<option value="${x.cuit || ''}">${x.nombre}${x.cuit ? ' — ' + x.cuit : ''}</option>`
        ).join('')
        : '';

    bloque.innerHTML = `
        <div style="font-weight: 600; margin-bottom: var(--espacio-sm);">
            ${editando ? 'Editar arrendador' : 'Agregar arrendador'}
        </div>

        ${!editando ? `
            <div class="campo-grupo">
                <label class="campo-label">Buscar existente por CUIT</label>
                <input type="text" id="nuevo-arr-buscar" class="campo-input"
                    list="lista-arrendadores-existentes"
                    placeholder="Escribí el CUIT y elegí de la lista, o seguí cargando nuevo..."
                    oninput="buscarYAutocompletarArrendador(this.value)">
                <datalist id="lista-arrendadores-existentes">${datalistOpts}</datalist>
                <span class="campo-ayuda">Si ya está cargado en el sistema, se vincula automáticamente.</span>
            </div>
            <hr class="form-separador" style="margin: var(--espacio-sm) 0;">
        ` : ''}

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Tipo</label>
                <select id="nuevo-arr-tipo" class="campo-select" onchange="toggleCamposPersonaEmpresa()">
                    <option value="persona_fisica" ${a.tipo === 'persona_fisica' ? 'selected' : ''}>Persona física</option>
                    <option value="empresa" ${a.tipo === 'empresa' ? 'selected' : ''}>Empresa</option>
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">CUIT</label>
                <input type="text" id="nuevo-arr-cuit" class="campo-input" value="${a.cuit || ''}" placeholder="20-12345678-9">
            </div>
        </div>

        <div id="campos-persona" style="display: ${a.tipo === 'empresa' ? 'none' : 'block'};">
            <div class="campos-fila">
                <div class="campo-grupo">
                    <label class="campo-label">Nombre de pila</label>
                    <input type="text" id="nuevo-arr-nombre-pila" class="campo-input" value="${a.nombre_pila || ''}" placeholder="Roberto Mateo">
                </div>
                <div class="campo-grupo">
                    <label class="campo-label">Apellido</label>
                    <input type="text" id="nuevo-arr-apellido" class="campo-input" value="${a.apellido || ''}" placeholder="Rebufatti">
                </div>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">DNI</label>
                <input type="text" id="nuevo-arr-dni" class="campo-input" value="${a.dni || ''}" placeholder="10677055">
            </div>
        </div>

        <div id="campos-empresa" style="display: ${a.tipo === 'empresa' ? 'block' : 'none'};">
            <div class="campo-grupo">
                <label class="campo-label">Razón social</label>
                <input type="text" id="nuevo-arr-razon-social" class="campo-input" value="${a.tipo === 'empresa' ? (a.nombre_completo || '') : ''}" placeholder="Agropecuaria Los Álamos SA">
            </div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Domicilio</label>
            <input type="text" id="nuevo-arr-domicilio" class="campo-input" value="${a.domicilio || ''}" placeholder="Opcional">
        </div>

        <div style="display:flex; gap: var(--espacio-sm); margin-top: var(--espacio-sm);">
            <button type="button" class="btn-primario" onclick="confirmarNuevoArrendador(${editando ? idx : 'null'})">
                ${editando ? 'Guardar cambios' : 'Agregar al contrato'}
            </button>
            <button type="button" class="btn-secundario" onclick="cancelarNuevoArrendador()">Cancelar</button>
        </div>
    `;
    bloque.style.display = 'block';
}

function cancelarNuevoArrendador() {
    const bloque = document.getElementById('form-nuevo-arrendador');
    if (bloque) {
        bloque.style.display = 'none';
        bloque.innerHTML = '';
    }
}

function toggleCamposPersonaEmpresa() {
    const tipo = document.getElementById('nuevo-arr-tipo')?.value;
    const persona = document.getElementById('campos-persona');
    const empresa = document.getElementById('campos-empresa');
    if (persona) persona.style.display = tipo === 'empresa' ? 'none' : 'block';
    if (empresa) empresa.style.display = tipo === 'empresa' ? 'block' : 'none';
}

/**
 * Si el usuario escribe un CUIT que ya existe, precarga los campos
 * con los datos guardados — así puede vincular en lugar de duplicar.
 */
function buscarYAutocompletarArrendador(valor) {
    const cuitNorm = normalizarCuit(valor);
    if (cuitNorm.length < 8) return;

    const existente = arrendadoresParaSelect.find(a => normalizarCuit(a.cuit) === cuitNorm);
    if (!existente) return;

    // Precarga los campos del formulario
    document.getElementById('nuevo-arr-tipo').value = existente.tipo || 'persona_fisica';
    document.getElementById('nuevo-arr-cuit').value = existente.cuit || '';
    document.getElementById('nuevo-arr-nombre-pila').value = existente.nombre_pila || '';
    document.getElementById('nuevo-arr-apellido').value = existente.apellido || '';
    document.getElementById('nuevo-arr-dni').value = existente.dni || '';
    const razonInput = document.getElementById('nuevo-arr-razon-social');
    if (razonInput && existente.tipo === 'empresa') razonInput.value = existente.nombre || '';
    const domInput = document.getElementById('nuevo-arr-domicilio');
    if (domInput) domInput.value = existente.domicilio || '';
    toggleCamposPersonaEmpresa();
}

/**
 * Toma los datos del mini-formulario y los agrega al array del contrato.
 * Si existe un arrendador con ese CUIT en la DB, lo vincula (no duplica).
 */
function confirmarNuevoArrendador(idxEditando) {
    const tipo = document.getElementById('nuevo-arr-tipo').value;
    const cuit = document.getElementById('nuevo-arr-cuit').value.trim() || null;
    const domicilio = document.getElementById('nuevo-arr-domicilio').value.trim() || null;

    let nombre_pila = null, apellido = null, nombre_completo = '', dni = null;

    if (tipo === 'empresa') {
        nombre_completo = document.getElementById('nuevo-arr-razon-social').value.trim();
        if (!nombre_completo) {
            mostrarError('Ingresá la razón social de la empresa.');
            return;
        }
    } else {
        nombre_pila = document.getElementById('nuevo-arr-nombre-pila').value.trim() || null;
        apellido = document.getElementById('nuevo-arr-apellido').value.trim() || null;
        dni = document.getElementById('nuevo-arr-dni').value.trim() || null;
        if (!nombre_pila && !apellido) {
            mostrarError('Ingresá al menos nombre o apellido.');
            return;
        }
        nombre_completo = [nombre_pila, apellido].filter(Boolean).join(' ');
    }

    // Detectar existente por CUIT o DNI
    let existente = null;
    if (cuit) {
        const cn = normalizarCuit(cuit);
        existente = arrendadoresParaSelect.find(a => normalizarCuit(a.cuit) === cn);
    }
    if (!existente && dni) {
        const dn = normalizarDni(dni);
        existente = arrendadoresParaSelect.find(a => normalizarDni(a.dni) === dn);
    }

    const nuevo = {
        id: existente?.id || null,
        tipo,
        nombre_completo,
        nombre_pila,
        apellido,
        dni,
        cuit,
        domicilio,
        es_titular_principal: false, // el usuario lo marca explícitamente si quiere
        _existente: !!existente
    };

    if (idxEditando !== null && idxEditando !== undefined) {
        // Mantener titularidad al editar
        nuevo.es_titular_principal = arrendadoresContrato[idxEditando].es_titular_principal;
        arrendadoresContrato[idxEditando] = nuevo;
    } else {
        // Evitar duplicados (mismo CUIT o mismo id)
        const yaAgregado = arrendadoresContrato.some(a =>
            (nuevo.id && a.id === nuevo.id) ||
            (nuevo.cuit && normalizarCuit(a.cuit) === normalizarCuit(nuevo.cuit))
        );
        if (yaAgregado) {
            mostrarError('Ese arrendador ya está en este contrato.');
            return;
        }
        arrendadoresContrato.push(nuevo);
    }

    cancelarNuevoArrendador();
    renderChipsArrendadores();
    if (!nombreGrupoEditadoManualmente) actualizarNombreGrupoAuto();
}

/**
 * Calcula el nombre del grupo según las reglas:
 *  - 1 empresa → razón social
 *  - 1 persona → nombre completo
 *  - N personas con mismo apellido → "Familia APELLIDO"
 *  - N personas con apellidos distintos → apellidos concatenados
 */
function calcularNombreGrupoAuto() {
    const arr = arrendadoresContrato;
    if (arr.length === 0) return '';
    if (arr.length === 1) return arr[0].nombre_completo || '';

    // Si alguno es empresa, concatenamos todos los nombres
    const hayEmpresa = arr.some(a => a.tipo === 'empresa');
    if (hayEmpresa) {
        return arr.map(a => a.nombre_completo).filter(Boolean).join(' y ');
    }

    // Todas personas físicas: comparar apellidos (normalizado para case/espacios)
    const apellidos = arr.map(a => (a.apellido || '').trim()).filter(Boolean);
    if (apellidos.length === arr.length) {
        const primero = apellidos[0].toLowerCase();
        const todosIguales = apellidos.every(ap => ap.toLowerCase() === primero);
        if (todosIguales) {
            return `Familia ${apellidos[0]}`;
        }
    }

    // Apellidos distintos → concatenar
    const apsOrNombre = arr.map(a => a.apellido || a.nombre_completo).filter(Boolean);
    if (apsOrNombre.length <= 2) {
        return apsOrNombre.join(' y ');
    }
    return apsOrNombre.slice(0, -1).join(', ') + ' y ' + apsOrNombre[apsOrNombre.length - 1];
}

function actualizarNombreGrupoAuto() {
    const input = document.getElementById('campo-nombre-grupo');
    if (!input) return;
    const nuevoNombre = calcularNombreGrupoAuto();
    input.value = nuevoNombre;
}

/**
 * Cuando el usuario edita el nombre del grupo a mano, dejamos de autocalcularlo.
 */
function marcarNombreGrupoManual() {
    nombreGrupoEditadoManualmente = true;
    const ayuda = document.getElementById('nombre-grupo-ayuda');
    if (ayuda) ayuda.textContent = 'Editado manualmente. Se mantendrá este valor.';
}

