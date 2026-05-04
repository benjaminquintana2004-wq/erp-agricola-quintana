// ==============================================
// reportes.js — Página de informes / reportes
// ==============================================
// Plantillas predefinidas. Cada plantilla define cómo cargar sus datos,
// qué filtros muestra, cómo renderiza la tabla y cómo se serializa a
// texto plano para WhatsApp / portapapeles.
// ==============================================

// Estado del reporte abierto (para acciones globales como copiar/WhatsApp)
let reporteActivo = null;        // id de la plantilla activa, ej 'contratos-vencer'
let datosReporteActivo = [];     // filas resultantes (después de filtros)
let textoReporteActivo = '';     // serialización a texto para copiar/WhatsApp

// Empresas cargadas al inicio (para el filtro empresa en los reportes)
let empresasReporte = [];        // [{id, nombre, slug}]

// Mapeo slug ↔ id (slug existe como texto en contratos.empresa, pero no en empresas.id)
function slugDeNombre(nombre) {
    if (!nombre) return '';
    const n = nombre.toLowerCase();
    if (n.includes('diego')) return 'diego_quintana';
    if (n.includes('ataco')) return 'el_ataco';
    return n.replace(/\s+/g, '_');
}

// ==============================================
// CATÁLOGO DE PLANTILLAS
// ==============================================

const PLANTILLAS = [
    {
        id: 'contratos-vencer',
        categoria: 'Contratos',
        titulo: 'Contratos próximos a vencer',
        descripcion: 'Lista de contratos cuya fecha de fin está dentro de los próximos N meses, ordenados por urgencia.',
        icono: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        cargar:    cargarContratosPorVencer,
        renderizar: renderContratosPorVencer,
        aTexto:    textoContratosPorVencer,
        filtrosHTML: `
            <div class="campo-grupo">
                <label class="campo-label">Mostrar contratos que vencen en los próximos</label>
                <select id="filtro-meses" class="campo-select" onchange="ejecutarReporteActivo()">
                    <option value="3">3 meses</option>
                    <option value="6" selected>6 meses</option>
                    <option value="12">12 meses</option>
                    <option value="24">24 meses</option>
                    <option value="0">Todos los vigentes</option>
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Empresa</label>
                <select id="filtro-empresa" class="campo-select" onchange="ejecutarReporteActivo()">
                    <option value="">Todas</option>
                </select>
            </div>
        `
    },
    {
        id: 'adelantos-pendientes',
        categoria: 'Contratos',
        titulo: 'Adelantos pendientes',
        descripcion: 'Contratos con pago adelantado pactado, ordenados por proximidad de vencimiento.',
        icono: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
        cargar:    cargarAdelantosPendientes,
        renderizar: renderAdelantosPendientes,
        aTexto:    textoAdelantosPendientes,
        filtrosHTML: `
            <div class="campo-grupo">
                <label class="campo-label">Empresa</label>
                <select id="filtro-empresa" class="campo-select" onchange="ejecutarReporteActivo()">
                    <option value="">Todas</option>
                </select>
            </div>
        `
    },
    {
        id: 'saldos-grupos',
        categoria: 'Arrendadores',
        titulo: 'Saldos pendientes por grupo',
        descripcion: 'Cuántos quintales le debe Diego a cada grupo arrendador en la campaña activa.',
        icono: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        cargar:    cargarSaldosGrupos,
        renderizar: renderSaldosGrupos,
        aTexto:    textoSaldosGrupos,
        filtrosHTML: `
            <div class="campo-grupo">
                <label class="campo-label">Mostrar</label>
                <select id="filtro-saldo" class="campo-select" onchange="ejecutarReporteActivo()">
                    <option value="con_saldo" selected>Solo con saldo &gt; 0</option>
                    <option value="todos">Todos los grupos</option>
                </select>
            </div>
        `
    },
    {
        id: 'cheques-vencer',
        categoria: 'Tesorería',
        titulo: 'Cheques por vencer',
        descripcion: 'Cheques pendientes y futuros con fecha de cobro en los próximos N días.',
        icono: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
        cargar:    cargarChequesPorVencer,
        renderizar: renderChequesPorVencer,
        aTexto:    textoChequesPorVencer,
        filtrosHTML: `
            <div class="campo-grupo">
                <label class="campo-label">Próximos</label>
                <select id="filtro-dias" class="campo-select" onchange="ejecutarReporteActivo()">
                    <option value="15">15 días</option>
                    <option value="30" selected>30 días</option>
                    <option value="60">60 días</option>
                    <option value="90">90 días</option>
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Empresa</label>
                <select id="filtro-empresa" class="campo-select" onchange="ejecutarReporteActivo()">
                    <option value="">Todas</option>
                </select>
            </div>
        `
    },
    {
        id: 'facturas-faltantes',
        categoria: 'Tesorería',
        titulo: 'Cheques sin factura',
        descripcion: 'Cheques pagados a contratistas u "otros" que aún no tienen factura adjunta.',
        icono: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
        cargar:    cargarFacturasFaltantes,
        renderizar: renderFacturasFaltantes,
        aTexto:    textoFacturasFaltantes,
        filtrosHTML: `
            <div class="campo-grupo">
                <label class="campo-label">Empresa</label>
                <select id="filtro-empresa" class="campo-select" onchange="ejecutarReporteActivo()">
                    <option value="">Todas</option>
                </select>
            </div>
        `
    }
];

// ==============================================
// INICIALIZACIÓN
// ==============================================

async function inicializarReportes() {
    // Cargar empresas para usar en filtros (campo empresa_id en cheques)
    const emps = await ejecutarConsulta(
        db.from('empresas').select('id, nombre').order('nombre'),
        'cargar empresas'
    ) || [];
    empresasReporte = emps.map(e => ({ ...e, slug: slugDeNombre(e.nombre) }));

    document.getElementById('pantalla-carga').style.display = 'none';
    document.getElementById('contenido-principal').style.display = 'block';
    renderizarGridPlantillas();
}

// Genera el HTML de las opciones de empresa para usar en filtrosHTML
function opcionesEmpresaHTML() {
    return empresasReporte.map(e =>
        `<option value="${e.id}">${e.nombre}</option>`
    ).join('');
}

function renderizarGridPlantillas() {
    const cont = document.getElementById('reportes-grid');
    cont.innerHTML = PLANTILLAS.map(p => `
        <div class="reporte-card" onclick="abrirReporte('${p.id}')">
            <div class="reporte-card-icono">${p.icono}</div>
            <div class="reporte-card-categoria">${p.categoria}</div>
            <h3 class="reporte-card-titulo">${p.titulo}</h3>
            <p class="reporte-card-descripcion">${p.descripcion}</p>
        </div>
    `).join('');
}

// ==============================================
// ROUTER DE REPORTES
// ==============================================

function abrirReporte(id) {
    const plantilla = PLANTILLAS.find(p => p.id === id);
    if (!plantilla) { mostrarError('Reporte no encontrado.'); return; }

    reporteActivo = id;
    document.getElementById('vista-plantillas').style.display = 'none';
    document.getElementById('vista-reporte').style.display = 'block';
    document.getElementById('reporte-titulo').textContent = plantilla.titulo;
    document.getElementById('reporte-subtitulo').textContent = plantilla.descripcion;
    document.getElementById('reporte-filtros').innerHTML = plantilla.filtrosHTML || '';

    // Si hay un select de empresa en los filtros, agregamos las opciones desde la BD
    const selectEmpresa = document.getElementById('filtro-empresa');
    if (selectEmpresa) selectEmpresa.insertAdjacentHTML('beforeend', opcionesEmpresaHTML());

    ejecutarReporteActivo();
}

function volverAPlantillas() {
    reporteActivo = null;
    datosReporteActivo = [];
    textoReporteActivo = '';
    document.getElementById('vista-plantillas').style.display = 'block';
    document.getElementById('vista-reporte').style.display = 'none';
}

async function ejecutarReporteActivo() {
    if (!reporteActivo) return;
    const plantilla = PLANTILLAS.find(p => p.id === reporteActivo);
    if (!plantilla) return;

    // Estado de carga
    document.getElementById('reporte-resumen').innerHTML = '';
    document.getElementById('reporte-contenido').innerHTML = `
        <div class="reporte-vacio">
            <div class="spinner spinner-grande" style="margin: 0 auto;"></div>
            <p style="margin-top: var(--espacio-md);">Cargando datos…</p>
        </div>
    `;

    try {
        const filtros = leerFiltrosActuales();
        datosReporteActivo = await plantilla.cargar(filtros);
        plantilla.renderizar(datosReporteActivo, filtros);
        textoReporteActivo = plantilla.aTexto(datosReporteActivo, filtros);
        actualizarLinkWhatsApp();
    } catch (err) {
        console.error('Error ejecutando reporte:', err);
        document.getElementById('reporte-contenido').innerHTML = `
            <div class="reporte-vacio">
                <p style="color: var(--color-error);">Error al cargar el reporte: ${err.message}</p>
            </div>
        `;
    }
}

function leerFiltrosActuales() {
    const f = {};
    document.querySelectorAll('#reporte-filtros select, #reporte-filtros input').forEach(el => {
        f[el.id.replace('filtro-', '')] = el.value;
    });
    return f;
}

// ==============================================
// ACCIONES: Imprimir / PDF / Copiar / WhatsApp
// ==============================================

function imprimirReporte() {
    window.print();
}

function copiarReporteTexto() {
    if (!textoReporteActivo) {
        mostrarAlerta('Todavía no hay datos para copiar.');
        return;
    }
    navigator.clipboard.writeText(textoReporteActivo)
        .then(() => mostrarExito('Reporte copiado al portapapeles'))
        .catch(() => mostrarError('No se pudo copiar. Probá seleccionar el texto manualmente.'));
}

function actualizarLinkWhatsApp() {
    const link = document.getElementById('reporte-whatsapp');
    if (!link) return;
    if (!textoReporteActivo) { link.href = '#'; return; }
    link.href = `https://wa.me/?text=${encodeURIComponent(textoReporteActivo)}`;
}

// ==============================================
// HELPERS
// ==============================================

function fechaConDiff(fechaISO) {
    if (!fechaISO) return { fecha: '—', dias: null, label: '' };
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fin = new Date(fechaISO + 'T00:00:00');
    const dias = Math.ceil((fin - hoy) / (1000 * 60 * 60 * 24));
    let label = '';
    if (dias < 0) label = `Venció hace ${Math.abs(dias)} días`;
    else if (dias === 0) label = 'Vence hoy';
    else if (dias === 1) label = 'Vence mañana';
    else label = `Faltan ${dias} días`;
    return { fecha: formatearFecha(fechaISO), dias, label };
}

function tipoGrupoDesdeArr(arrs) {
    if (arrs.length === 0) return 'Vacío';
    if (arrs.length === 1) return arrs[0].tipo === 'empresa' ? 'Empresa' : 'Persona';
    if (arrs.some(a => a.tipo === 'empresa')) return 'Sociedad';
    // Heurística: si comparten apellido → Familia
    const apellidos = arrs.map(a => (a.nombre || '').split(' ').pop().toLowerCase()).filter(Boolean);
    if (new Set(apellidos).size === 1) return 'Familia';
    return 'Sociedad';
}

function nombreEmpresaCorto(slug) {
    if (slug === 'diego_quintana') return 'Diego Quintana';
    if (slug === 'el_ataco') return 'El Ataco';
    return slug || '—';
}

function fechaHoyHumana() {
    const d = new Date();
    return d.toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ==============================================
// REPORTE 1: CONTRATOS PRÓXIMOS A VENCER
// ==============================================

async function cargarContratosPorVencer(filtros) {
    const meses = parseInt(filtros.meses || '6', 10);
    const empresaId = filtros.empresa || '';
    // El campo contratos.empresa es texto ('diego_quintana' / 'el_ataco'),
    // así que convertimos el UUID seleccionado al slug correspondiente.
    const empresaSlug = empresaId ? empresasReporte.find(e => e.id === empresaId)?.slug : '';

    let q = db.from('contratos').select(`
        id, fecha_inicio, fecha_fin, estado, campo, nombre_grupo, empresa,
        hectareas, qq_pactados_anual, qq_negro_anual,
        contratos_arrendadores ( arrendador_id, orden, arrendadores ( id, nombre, cuit, dni ) )
    `).neq('estado', 'renovado');

    if (empresaSlug) q = q.eq('empresa', empresaSlug);

    const contratos = await ejecutarConsulta(q, 'cargar contratos para reporte') || [];

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const limiteMs = meses > 0 ? meses * 30 * 24 * 60 * 60 * 1000 : null;

    return contratos
        .filter(c => {
            if (!c.fecha_fin) return false;
            const fin = new Date(c.fecha_fin + 'T00:00:00');
            if (fin < hoy) return false;                              // ya vencido
            if (limiteMs && (fin - hoy) > limiteMs) return false;     // muy lejos
            return true;
        })
        .sort((a, b) => a.fecha_fin.localeCompare(b.fecha_fin));
}

function renderContratosPorVencer(rows, filtros) {
    const totalQQ = rows.reduce((s, c) => s + Number(c.qq_pactados_anual || 0), 0);
    const totalHa = rows.reduce((s, c) => s + Number(c.hectareas || 0), 0);

    document.getElementById('reporte-resumen').innerHTML = `
        <div class="reporte-resumen-card">
            <div class="reporte-resumen-label">Contratos en el rango</div>
            <div class="reporte-resumen-valor">${rows.length}</div>
        </div>
        <div class="reporte-resumen-card">
            <div class="reporte-resumen-label">Hectáreas afectadas</div>
            <div class="reporte-resumen-valor">${formatearNumero(totalHa)} ha</div>
        </div>
        <div class="reporte-resumen-card">
            <div class="reporte-resumen-label">QQ pactados (suma)</div>
            <div class="reporte-resumen-valor">${formatearNumero(totalQQ)}</div>
        </div>
    `;

    if (rows.length === 0) {
        document.getElementById('reporte-contenido').innerHTML = `
            <div class="reporte-vacio">No hay contratos en el rango seleccionado.</div>
        `;
        return;
    }

    const filas = rows.map(c => {
        const arrs = (c.contratos_arrendadores || []).map(ca => ca.arrendadores).filter(Boolean);
        const nombres = arrs.map(a => a.nombre).join(', ') || '—';
        const grupo = c.nombre_grupo || arrs[0]?.nombre || 'Sin nombre';
        const { fecha, label } = fechaConDiff(c.fecha_fin);
        return `
            <tr>
                <td><strong>${grupo}</strong>${c.nombre_grupo && nombres !== grupo ? `<br><span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${nombres}</span>` : ''}</td>
                <td>${nombreEmpresaCorto(c.empresa)}</td>
                <td>${c.campo || '—'}</td>
                <td>${c.hectareas ? formatearNumero(c.hectareas) + ' ha' : '—'}</td>
                <td>${formatearNumero(c.qq_pactados_anual || 0)} qq</td>
                <td>${fecha}<br><span style="font-size:var(--texto-xs);color:var(--color-dorado);">${label}</span></td>
            </tr>
        `;
    }).join('');

    document.getElementById('reporte-contenido').innerHTML = `
        <table class="tabla">
            <thead>
                <tr>
                    <th>Grupo / Arrendadores</th>
                    <th>Empresa</th>
                    <th>Campo</th>
                    <th>Hectáreas</th>
                    <th>QQ/año</th>
                    <th>Fecha fin</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    `;
}

function textoContratosPorVencer(rows, filtros) {
    const meses = filtros.meses || '6';
    let t = `📋 CONTRATOS PRÓXIMOS A VENCER\n`;
    t += `📅 ${fechaHoyHumana()}\n`;
    t += `Próximos ${meses} ${meses === '0' ? '— todos' : 'meses'}\n`;
    t += `${'─'.repeat(40)}\n\n`;
    if (rows.length === 0) { t += 'Sin contratos en el rango.\n'; return t; }
    rows.forEach(c => {
        const arrs = (c.contratos_arrendadores || []).map(ca => ca.arrendadores).filter(Boolean);
        const nombre = c.nombre_grupo || arrs.map(a => a.nombre).join(', ') || 'Sin nombre';
        const { fecha, label } = fechaConDiff(c.fecha_fin);
        t += `• ${nombre}\n`;
        t += `  Campo: ${c.campo || '—'} · ${c.hectareas ? c.hectareas + ' ha' : '—'} · ${formatearNumero(c.qq_pactados_anual || 0)} qq/año\n`;
        t += `  Vence: ${fecha} (${label})\n\n`;
    });
    t += `${'─'.repeat(40)}\nGenerado por ERP Agrícola Quintana`;
    return t;
}

// ==============================================
// REPORTE 2: ADELANTOS PENDIENTES
// ==============================================

async function cargarAdelantosPendientes(filtros) {
    let q = db.from('contratos').select(`
        id, fecha_fin, estado, campo, nombre_grupo, empresa,
        adelanto_qq, adelanto_dia, adelanto_mes, adelanto_observaciones,
        contratos_arrendadores ( orden, arrendadores ( nombre ) )
    `)
    .not('adelanto_qq', 'is', null)
    .gt('adelanto_qq', 0)
    .neq('estado', 'renovado');

    const empresaId = filtros.empresa || '';
    const empresaSlug = empresaId ? empresasReporte.find(e => e.id === empresaId)?.slug : '';
    if (empresaSlug) q = q.eq('empresa', empresaSlug);

    const data = await ejecutarConsulta(q, 'cargar adelantos') || [];

    // Filtrar contratos vigentes (fecha_fin >= hoy)
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const vigentes = data.filter(c => !c.fecha_fin || new Date(c.fecha_fin + 'T00:00:00') >= hoy);

    // Calcular próxima fecha de vencimiento del adelanto (este año o el próximo)
    return vigentes
        .map(c => {
            let proxima = null;
            if (c.adelanto_dia && c.adelanto_mes) {
                let intento = new Date(hoy.getFullYear(), c.adelanto_mes - 1, c.adelanto_dia);
                if (intento < hoy) intento = new Date(hoy.getFullYear() + 1, c.adelanto_mes - 1, c.adelanto_dia);
                proxima = intento;
            }
            const diasRest = proxima ? Math.ceil((proxima - hoy) / (1000 * 60 * 60 * 24)) : null;
            return { ...c, _proxima: proxima, _diasRest: diasRest };
        })
        .sort((a, b) => {
            if (a._proxima === null) return 1;
            if (b._proxima === null) return -1;
            return a._proxima - b._proxima;
        });
}

function renderAdelantosPendientes(rows) {
    const totalQQ = rows.reduce((s, c) => s + Number(c.adelanto_qq || 0), 0);

    document.getElementById('reporte-resumen').innerHTML = `
        <div class="reporte-resumen-card">
            <div class="reporte-resumen-label">Contratos con adelanto</div>
            <div class="reporte-resumen-valor">${rows.length}</div>
        </div>
        <div class="reporte-resumen-card">
            <div class="reporte-resumen-label">QQ a adelantar (total)</div>
            <div class="reporte-resumen-valor">${formatearNumero(totalQQ)}</div>
        </div>
    `;

    if (rows.length === 0) {
        document.getElementById('reporte-contenido').innerHTML = `
            <div class="reporte-vacio">No hay contratos con adelanto pactado.</div>
        `;
        return;
    }

    const filas = rows.map(c => {
        const arrs = (c.contratos_arrendadores || []).map(ca => ca.arrendadores).filter(Boolean);
        const grupo = c.nombre_grupo || arrs[0]?.nombre || 'Sin nombre';
        let venc = '—', label = '';
        if (c._proxima) {
            const yyyy = c._proxima.getFullYear();
            const mm   = String(c._proxima.getMonth() + 1).padStart(2, '0');
            const dd   = String(c._proxima.getDate()).padStart(2, '0');
            venc = formatearFecha(`${yyyy}-${mm}-${dd}`);
            const d = c._diasRest;
            if (d < 0) label = `Vencido hace ${Math.abs(d)} días`;
            else if (d === 0) label = 'Vence hoy';
            else if (d <= 30) label = `Faltan ${d} días`;
            else label = `Faltan ${d} días`;
        }
        return `
            <tr>
                <td><strong>${grupo}</strong></td>
                <td>${nombreEmpresaCorto(c.empresa)}</td>
                <td>${c.campo || '—'}</td>
                <td>${formatearNumero(c.adelanto_qq)} qq</td>
                <td>${venc}<br><span style="font-size:var(--texto-xs);color:var(--color-dorado);">${label}</span></td>
                <td style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${c.adelanto_observaciones || ''}</td>
            </tr>
        `;
    }).join('');

    document.getElementById('reporte-contenido').innerHTML = `
        <table class="tabla">
            <thead>
                <tr>
                    <th>Grupo</th>
                    <th>Empresa</th>
                    <th>Campo</th>
                    <th>QQ a adelantar</th>
                    <th>Próximo vencimiento</th>
                    <th>Observaciones</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    `;
}

function textoAdelantosPendientes(rows) {
    let t = `💰 ADELANTOS PENDIENTES\n📅 ${fechaHoyHumana()}\n${'─'.repeat(40)}\n\n`;
    if (rows.length === 0) { t += 'Sin adelantos pactados.\n'; return t; }
    rows.forEach(c => {
        const arrs = (c.contratos_arrendadores || []).map(ca => ca.arrendadores).filter(Boolean);
        const grupo = c.nombre_grupo || arrs[0]?.nombre || 'Sin nombre';
        t += `• ${grupo} — ${formatearNumero(c.adelanto_qq)} qq\n`;
        if (c._proxima) {
            const dd = String(c._proxima.getDate()).padStart(2, '0');
            const mm = String(c._proxima.getMonth() + 1).padStart(2, '0');
            t += `  Vence: ${dd}/${mm}/${c._proxima.getFullYear()} (faltan ${c._diasRest} días)\n`;
        }
        if (c.adelanto_observaciones) t += `  Obs: ${c.adelanto_observaciones}\n`;
        t += '\n';
    });
    return t + `${'─'.repeat(40)}\nGenerado por ERP Agrícola Quintana`;
}

// ==============================================
// REPORTE 3: SALDOS POR GRUPO
// ==============================================

async function cargarSaldosGrupos(filtros) {
    // Cargar saldos de campaña activa con datos del contrato y arrendadores
    const saldos = await ejecutarConsulta(
        db.from('saldos').select(`
            qq_deuda_blanco, qq_deuda_negro,
            campanas!inner(id, activa),
            contratos!inner(
                id, nombre_grupo, empresa,
                contratos_arrendadores ( arrendadores ( id, nombre, cuit, dni, tipo ) )
            )
        `).eq('campanas.activa', true),
        'cargar saldos de campaña activa'
    ) || [];

    // Agrupar por SET de arrendadores (para detectar mismo grupo aunque tengan
    // múltiples contratos)
    const grupos = new Map();
    saldos.forEach(s => {
        const c = s.contratos;
        if (!c) return;
        const arrs = (c.contratos_arrendadores || [])
            .map(ca => ca.arrendadores)
            .filter(Boolean)
            .sort((a, b) => a.id.localeCompare(b.id));
        const key = arrs.map(a => a.id).join('|');
        if (!grupos.has(key)) {
            grupos.set(key, {
                key,
                nombre: c.nombre_grupo || arrs[0]?.nombre || 'Sin nombre',
                arrendadores: arrs,
                contratos: 0,
                blanco: 0,
                negro: 0
            });
        }
        const g = grupos.get(key);
        g.contratos++;
        g.blanco += Number(s.qq_deuda_blanco || 0);
        g.negro  += Number(s.qq_deuda_negro || 0);
    });

    let lista = [...grupos.values()];
    if ((filtros.saldo || 'con_saldo') === 'con_saldo') {
        lista = lista.filter(g => (g.blanco + g.negro) > 0);
    }
    lista.sort((a, b) => (b.blanco + b.negro) - (a.blanco + a.negro));
    return lista;
}

function renderSaldosGrupos(rows) {
    const totalB = rows.reduce((s, g) => s + g.blanco, 0);
    const totalN = rows.reduce((s, g) => s + g.negro, 0);

    document.getElementById('reporte-resumen').innerHTML = `
        <div class="reporte-resumen-card">
            <div class="reporte-resumen-label">Grupos con saldo</div>
            <div class="reporte-resumen-valor">${rows.filter(g => g.blanco + g.negro > 0).length}</div>
        </div>
        <div class="reporte-resumen-card">
            <div class="reporte-resumen-label">QQ pendientes (blanco)</div>
            <div class="reporte-resumen-valor">${formatearNumero(totalB)}</div>
        </div>
        <div class="reporte-resumen-card">
            <div class="reporte-resumen-label">QQ pendientes (negro)</div>
            <div class="reporte-resumen-valor">${formatearNumero(totalN)}</div>
        </div>
    `;

    if (rows.length === 0) {
        document.getElementById('reporte-contenido').innerHTML = `
            <div class="reporte-vacio">No hay grupos con saldo en la campaña activa.</div>
        `;
        return;
    }

    const filas = rows.map(g => {
        const tipo = tipoGrupoDesdeArr(g.arrendadores);
        const total = g.blanco + g.negro;
        return `
            <tr>
                <td><strong>${g.nombre}</strong>${g.arrendadores.length > 1 ? `<br><span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${g.arrendadores.length} miembros</span>` : ''}</td>
                <td>${tipo}</td>
                <td>${g.contratos}</td>
                <td>${formatearNumero(g.blanco)}</td>
                <td>${formatearNumero(g.negro)}</td>
                <td><strong>${formatearNumero(total)} qq</strong></td>
            </tr>
        `;
    }).join('');

    document.getElementById('reporte-contenido').innerHTML = `
        <table class="tabla">
            <thead>
                <tr>
                    <th>Grupo</th>
                    <th>Tipo</th>
                    <th>Contratos</th>
                    <th>QQ blanco</th>
                    <th>QQ negro</th>
                    <th>Total</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    `;
}

function textoSaldosGrupos(rows) {
    let t = `📊 SALDOS PENDIENTES POR GRUPO\n📅 ${fechaHoyHumana()}\n${'─'.repeat(40)}\n\n`;
    if (rows.length === 0) { t += 'Sin saldos pendientes.\n'; return t; }
    rows.forEach(g => {
        const total = g.blanco + g.negro;
        t += `• ${g.nombre} — ${formatearNumero(total)} qq\n`;
        if (g.blanco > 0) t += `  Blanco: ${formatearNumero(g.blanco)} qq\n`;
        if (g.negro > 0)  t += `  Negro:  ${formatearNumero(g.negro)} qq\n`;
        t += '\n';
    });
    return t + `${'─'.repeat(40)}\nGenerado por ERP Agrícola Quintana`;
}

// ==============================================
// REPORTE 4: CHEQUES POR VENCER
// ==============================================

async function cargarChequesPorVencer(filtros) {
    const dias = parseInt(filtros.dias || '30', 10);
    const empresaId = filtros.empresa || '';

    const hoy = new Date();
    const limite = new Date(hoy);
    limite.setDate(limite.getDate() + dias);
    const yyyy = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    let q = db.from('movimientos_tesoreria').select(`
        id, numero_cheque, fecha_cobro, monto, estado, empresa_id,
        empresas(nombre),
        cuentas_bancarias(id, alias, banco),
        beneficiarios(nombre, tipo),
        categorias_gasto(nombre)
    `)
    .eq('tipo', 'cheque')
    .in('estado', ['pendiente', 'futuro'])
    .lte('fecha_cobro', yyyy(limite))
    .order('fecha_cobro', { ascending: true });

    if (empresaId) q = q.eq('empresa_id', empresaId);

    return await ejecutarConsulta(q, 'cargar cheques por vencer') || [];
}

function renderChequesPorVencer(rows) {
    const total = rows.reduce((s, m) => s + Number(m.monto || 0), 0);

    document.getElementById('reporte-resumen').innerHTML = `
        <div class="reporte-resumen-card">
            <div class="reporte-resumen-label">Cheques en el rango</div>
            <div class="reporte-resumen-valor">${rows.length}</div>
        </div>
        <div class="reporte-resumen-card">
            <div class="reporte-resumen-label">Monto total (ARS)</div>
            <div class="reporte-resumen-valor">$ ${formatearNumero(total)}</div>
        </div>
    `;

    if (rows.length === 0) {
        document.getElementById('reporte-contenido').innerHTML = `
            <div class="reporte-vacio">No hay cheques en el rango seleccionado.</div>
        `;
        return;
    }

    const filas = rows.map(m => {
        const { fecha, label } = fechaConDiff(m.fecha_cobro);
        const cuenta = m.cuentas_bancarias?.alias || m.cuentas_bancarias?.banco || '—';
        const empresa = m.empresas?.nombre || '—';
        const ben = m.beneficiarios?.nombre || '—';
        const cat = m.categorias_gasto?.nombre || '';
        const estado = m.estado === 'futuro'
            ? '<span class="badge badge-futuro">Futuro</span>'
            : '<span class="badge badge-pendiente-pago">Pendiente</span>';
        return `
            <tr>
                <td><span style="font-family:var(--fuente-mono);">${m.numero_cheque || '—'}</span></td>
                <td>${empresa}<br><span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${cuenta}</span></td>
                <td><strong>${ben}</strong>${cat ? `<br><span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${cat}</span>` : ''}</td>
                <td>${fecha}<br><span style="font-size:var(--texto-xs);color:var(--color-dorado);">${label}</span></td>
                <td style="font-family:var(--fuente-mono);">$ ${formatearNumero(m.monto)}</td>
                <td>${estado}</td>
            </tr>
        `;
    }).join('');

    document.getElementById('reporte-contenido').innerHTML = `
        <table class="tabla">
            <thead>
                <tr>
                    <th>Nro. cheque</th>
                    <th>Empresa / Cuenta</th>
                    <th>Beneficiario</th>
                    <th>Fecha cobro</th>
                    <th>Monto</th>
                    <th>Estado</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    `;
}

function textoChequesPorVencer(rows, filtros) {
    let t = `💼 CHEQUES POR VENCER (${filtros.dias || 30} días)\n📅 ${fechaHoyHumana()}\n${'─'.repeat(40)}\n\n`;
    if (rows.length === 0) { t += 'Sin cheques en el rango.\n'; return t; }
    rows.forEach(m => {
        const { fecha, label } = fechaConDiff(m.fecha_cobro);
        t += `• Cheque ${m.numero_cheque || '—'} — $ ${formatearNumero(m.monto)}\n`;
        t += `  ${m.beneficiarios?.nombre || 'Sin beneficiario'} · ${fecha} (${label})\n\n`;
    });
    return t + `${'─'.repeat(40)}\nGenerado por ERP Agrícola Quintana`;
}

// ==============================================
// REPORTE 5: FACTURAS FALTANTES
// ==============================================

async function cargarFacturasFaltantes(filtros) {
    const empresaId = filtros.empresa || '';

    // Cargamos cheques no anulados con sus facturas vinculadas
    let q = db.from('movimientos_tesoreria').select(`
        id, numero_cheque, fecha_cobro, monto, estado, empresa_id,
        empresas(nombre),
        cuentas_bancarias(alias, banco),
        beneficiarios(nombre, tipo),
        categorias_gasto(nombre),
        cheques_facturas(factura_id)
    `)
    .eq('tipo', 'cheque')
    .neq('estado', 'anulado')
    .order('fecha_cobro', { ascending: true });

    if (empresaId) q = q.eq('empresa_id', empresaId);

    const data = await ejecutarConsulta(q, 'cargar cheques sin factura') || [];

    return data.filter(m => {
        // Excluir empleados (no emiten factura) y arrendadores (otro flujo)
        const tipoBen = m.beneficiarios?.tipo;
        if (tipoBen === 'empleado' || tipoBen === 'arrendador') return false;
        // Solo los que NO tienen factura vinculada
        if (m.cheques_facturas && m.cheques_facturas.length > 0) return false;
        return true;
    });
}

function renderFacturasFaltantes(rows) {
    const total = rows.reduce((s, m) => s + Number(m.monto || 0), 0);

    document.getElementById('reporte-resumen').innerHTML = `
        <div class="reporte-resumen-card">
            <div class="reporte-resumen-label">Cheques sin factura</div>
            <div class="reporte-resumen-valor">${rows.length}</div>
        </div>
        <div class="reporte-resumen-card">
            <div class="reporte-resumen-label">Monto total sin facturar</div>
            <div class="reporte-resumen-valor">$ ${formatearNumero(total)}</div>
        </div>
    `;

    if (rows.length === 0) {
        document.getElementById('reporte-contenido').innerHTML = `
            <div class="reporte-vacio" style="color:var(--color-verde);">¡Todos los cheques tienen su factura adjunta!</div>
        `;
        return;
    }

    const filas = rows.map(m => {
        const ben = m.beneficiarios?.nombre || '—';
        const cat = m.categorias_gasto?.nombre || '';
        const empresa = m.empresas?.nombre || '—';
        return `
            <tr>
                <td><span style="font-family:var(--fuente-mono);">${m.numero_cheque || '—'}</span></td>
                <td>${empresa}</td>
                <td><strong>${ben}</strong>${cat ? `<br><span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${cat}</span>` : ''}</td>
                <td>${formatearFecha(m.fecha_cobro)}</td>
                <td style="font-family:var(--fuente-mono);">$ ${formatearNumero(m.monto)}</td>
            </tr>
        `;
    }).join('');

    document.getElementById('reporte-contenido').innerHTML = `
        <table class="tabla">
            <thead>
                <tr>
                    <th>Nro. cheque</th>
                    <th>Empresa</th>
                    <th>Beneficiario</th>
                    <th>Fecha cobro</th>
                    <th>Monto</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    `;
}

function textoFacturasFaltantes(rows) {
    let t = `📄 CHEQUES SIN FACTURA\n📅 ${fechaHoyHumana()}\n${'─'.repeat(40)}\n\n`;
    if (rows.length === 0) { t += '¡Todo facturado!\n'; return t; }
    rows.forEach(m => {
        t += `• Cheque ${m.numero_cheque || '—'} — $ ${formatearNumero(m.monto)}\n`;
        t += `  ${m.beneficiarios?.nombre || 'Sin beneficiario'} · ${formatearFecha(m.fecha_cobro)}\n\n`;
    });
    return t + `${'─'.repeat(40)}\nGenerado por ERP Agrícola Quintana`;
}
