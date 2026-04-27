// ==============================================
// campana.js — Detalle de una campaña
// Resumen ejecutivo, alertas de adelantos,
// tabla de arrendadores, adelantos recibidos
// para la próxima campaña.
// ==============================================

let campanaActualDetalle = null;
let todasLasCampanas = [];

/**
 * Escapa HTML para evitar XSS al renderizar texto libre.
 */
function escHTML(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Formatea un número de qq con 2 decimales y separadores.
 */
function fqq(valor) {
    if (typeof formatearQQ === 'function') return formatearQQ(valor);
    const n = parseFloat(valor || 0);
    return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' qq';
}

/**
 * Formatea una fecha YYYY-MM-DD a DD/MM/YYYY.
 */
function ffecha(fecha) {
    if (!fecha) return '—';
    if (typeof formatearFecha === 'function') return formatearFecha(fecha);
    const d = new Date(fecha + 'T00:00:00');
    return d.toLocaleDateString('es-AR');
}

/**
 * Calcula días entre una fecha y hoy.
 */
function diasDesde(fecha) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const f = new Date(fecha + 'T00:00:00');
    return Math.floor((hoy - f) / (1000 * 60 * 60 * 24));
}

// ==============================================
// CARGA PRINCIPAL
// ==============================================

async function cargarCampanaDetalle(campanaId, usuario) {
    // Cargar todas las campañas para el selector
    todasLasCampanas = await ejecutarConsulta(
        db.from('campanas').select('*').order('anio_inicio', { ascending: false }),
        'cargar campañas'
    ) || [];

    if (todasLasCampanas.length === 0) {
        document.getElementById('campana-contenido').innerHTML = `
            <div class="panel-vacio">
                <p>No hay campañas creadas todavía.</p>
                <a class="btn-primario" href="/campanas.html" style="margin-top: 1rem;">Crear primera campaña</a>
            </div>
        `;
        document.getElementById('pantalla-carga').style.display = 'none';
        document.getElementById('contenido-principal').style.display = 'block';
        return;
    }

    // Si no hay ID en la URL, usar la activa. Si no hay activa, la más reciente.
    if (!campanaId) {
        const activa = todasLasCampanas.find(c => c.activa);
        campanaId = (activa || todasLasCampanas[0]).id;
    }

    campanaActualDetalle = todasLasCampanas.find(c => c.id === campanaId);

    if (!campanaActualDetalle) {
        mostrarError('No se encontró la campaña indicada.');
        return;
    }

    // Renderizar selector
    renderizarSelectorCampana();

    // Cargar todo en paralelo
    const [contratos, saldos, movimientos] = await Promise.all([
        ejecutarConsulta(
            db.from('contratos')
                .select('*, contratos_arrendadores(es_titular_principal, orden, arrendadores(id, nombre, telefono))')
                .eq('campana_id', campanaActualDetalle.id),
            'cargar contratos de la campaña'
        ),
        ejecutarConsulta(
            db.from('saldos')
                .select('*, contratos(id, nombre_grupo)')
                .eq('campana_id', campanaActualDetalle.id),
            'cargar saldos'
        ),
        ejecutarConsulta(
            db.from('movimientos')
                .select('*, arrendadores(id, nombre), contratos(id, nombre_grupo, campo), campanas(id, nombre, activa)')
                .order('fecha', { ascending: false }),
            'cargar movimientos'
        )
    ]);

    // Pre-procesar contratos: ordenar arrendadores y armar lista plana
    (contratos || []).forEach(c => {
        const ca = (c.contratos_arrendadores || []).slice().sort((a, b) => {
            if (a.es_titular_principal && !b.es_titular_principal) return -1;
            if (!a.es_titular_principal && b.es_titular_principal) return 1;
            return (a.orden ?? 999) - (b.orden ?? 999);
        });
        c.arrendadores_lista = ca.map(x => x.arrendadores).filter(Boolean);
    });

    // Renderizar bloques
    const html = `
        ${renderizarResumenEjecutivo(contratos || [], saldos || [], movimientos || [])}
        ${renderizarAlertasAdelantos(contratos || [], movimientos || [])}
        ${renderizarTablaArrendadores(contratos || [], saldos || [], movimientos || [])}
        ${renderizarAdelantosParaSiguiente(movimientos || [])}
    `;

    document.getElementById('campana-contenido').innerHTML = html;

    // Ocultar pantalla de carga
    document.getElementById('pantalla-carga').style.display = 'none';
    document.getElementById('contenido-principal').style.display = 'block';
}

/**
 * Cambia de campaña desde el selector.
 */
function cambiarCampana(campanaId) {
    window.location.href = `/campana.html?id=${campanaId}`;
}

// ==============================================
// SELECTOR DE CAMPAÑA
// ==============================================

function renderizarSelectorCampana() {
    const sel = document.getElementById('selector-campana');
    if (!sel) return;

    sel.innerHTML = todasLasCampanas.map(c => `
        <option value="${c.id}" ${c.id === campanaActualDetalle.id ? 'selected' : ''}>
            ${escHTML(c.nombre)} ${c.activa ? '(activa)' : ''}
        </option>
    `).join('');
}

// ==============================================
// BLOQUE A — RESUMEN EJECUTIVO
// ==============================================

function renderizarResumenEjecutivo(contratos, saldos, movimientos) {
    const campanaId = campanaActualDetalle.id;

    // Hectáreas totales
    const hectareas = contratos.reduce((s, c) => s + parseFloat(c.hectareas || 0), 0);

    // QQ pactados (blanco + negro)
    const pactadosBlanco = contratos.reduce((s, c) => s + parseFloat(c.qq_pactados_anual || 0), 0);
    const pactadosNegro = contratos.reduce((s, c) => s + parseFloat(c.qq_negro_anual || 0), 0);
    const pactadosTotal = pactadosBlanco + pactadosNegro;

    // QQ entregados — movimientos cuya campana_id = esta campaña
    const movsCampana = movimientos.filter(m => m.campana_id === campanaId);
    const entregadosBlanco = movsCampana.filter(m => m.tipo !== 'negro').reduce((s, m) => s + parseFloat(m.qq || 0), 0);
    const entregadosNegro = movsCampana.filter(m => m.tipo === 'negro').reduce((s, m) => s + parseFloat(m.qq || 0), 0);
    const entregadosTotal = entregadosBlanco + entregadosNegro;

    // QQ pendientes — suma de saldos
    let pendientesBlanco = 0, pendientesNegro = 0;
    saldos.forEach(s => {
        pendientesBlanco += parseFloat(s.qq_deuda_blanco || 0);
        pendientesNegro += parseFloat(s.qq_deuda_negro || 0);
    });
    const pendientesTotal = pendientesBlanco + pendientesNegro;

    // % cumplimiento
    const pct = pactadosTotal > 0 ? Math.round((entregadosTotal / pactadosTotal) * 100) : 0;
    let claseBarra = 'cumplimiento-barra-bajo';
    if (pct >= 80) claseBarra = 'cumplimiento-barra-alto';
    else if (pct >= 50) claseBarra = 'cumplimiento-barra-medio';

    // Split por empresa arrendataria
    const porEmpresa = {
        diego_quintana: { ha: 0, pactados: 0, contratos: 0 },
        el_ataco: { ha: 0, pactados: 0, contratos: 0 }
    };
    contratos.forEach(c => {
        const e = c.empresa || 'diego_quintana';
        if (!porEmpresa[e]) porEmpresa[e] = { ha: 0, pactados: 0, contratos: 0 };
        porEmpresa[e].ha += parseFloat(c.hectareas || 0);
        porEmpresa[e].pactados += parseFloat(c.qq_pactados_anual || 0) + parseFloat(c.qq_negro_anual || 0);
        porEmpresa[e].contratos++;
    });

    // Días restantes hasta fin de campaña (30 de junio del año_fin)
    const finCampana = new Date(`${campanaActualDetalle.anio_fin}-06-30T00:00:00`);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const diasRestantes = Math.floor((finCampana - hoy) / (1000 * 60 * 60 * 24));

    const setArr = new Set();
    contratos.forEach(c => (c.arrendadores_lista || []).forEach(a => a?.id && setArr.add(a.id)));
    const arrendadoresUnicos = setArr.size;

    return `
        <div class="campana-header-detalle">
            <div>
                <h2 class="campana-titulo-grande">${escHTML(campanaActualDetalle.nombre)}</h2>
                <div class="campana-periodo-texto">
                    Julio ${campanaActualDetalle.anio_inicio} — Junio ${campanaActualDetalle.anio_fin}
                    ${campanaActualDetalle.activa ? '<span class="badge badge-verde" style="margin-left: 8px;">Activa</span>' : ''}
                </div>
            </div>
            <div class="campana-dias-restantes">
                ${diasRestantes >= 0
                    ? `<strong>${diasRestantes}</strong> días restantes`
                    : `<strong>Finalizó</strong> hace ${Math.abs(diasRestantes)} días`}
            </div>
        </div>

        <!-- Tarjetas KPI -->
        <div class="campana-kpis">
            <div class="kpi-tarjeta">
                <div class="kpi-icono kpi-icono-dorado">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                </div>
                <div class="kpi-contenido">
                    <div class="kpi-valor">${arrendadoresUnicos}</div>
                    <div class="kpi-label">Arrendadores</div>
                </div>
            </div>

            <div class="kpi-tarjeta">
                <div class="kpi-icono kpi-icono-azul">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M3 9h18M9 21V9"/></svg>
                </div>
                <div class="kpi-contenido">
                    <div class="kpi-valor">${hectareas.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</div>
                    <div class="kpi-label">Hectáreas arrendadas</div>
                </div>
            </div>

            <div class="kpi-tarjeta">
                <div class="kpi-icono kpi-icono-verde">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                </div>
                <div class="kpi-contenido">
                    <div class="kpi-valor">${fqq(pactadosTotal)}</div>
                    <div class="kpi-label">Pactados (${fqq(pactadosBlanco)} blanco · ${fqq(pactadosNegro)} negro)</div>
                </div>
            </div>

            <div class="kpi-tarjeta">
                <div class="kpi-icono kpi-icono-verde">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div class="kpi-contenido">
                    <div class="kpi-valor">${fqq(entregadosTotal)}</div>
                    <div class="kpi-label">Entregados hasta hoy</div>
                </div>
            </div>

            <div class="kpi-tarjeta">
                <div class="kpi-icono kpi-icono-amarillo">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
                <div class="kpi-contenido">
                    <div class="kpi-valor">${fqq(pendientesTotal)}</div>
                    <div class="kpi-label">Pendientes de entregar</div>
                </div>
            </div>
        </div>

        <!-- Barra de cumplimiento grande -->
        <div class="campana-cumplimiento-global">
            <div class="cumplimiento-label-grande">
                <span>Cumplimiento de la campaña</span>
                <span class="cumplimiento-pct-grande">${pct}%</span>
            </div>
            <div class="cumplimiento-barra-track" style="height: 14px;">
                <div class="cumplimiento-barra ${claseBarra}" style="width: ${pct}%"></div>
            </div>
            <div class="cumplimiento-detalle-grande">
                <span>${fqq(entregadosTotal)} entregados de ${fqq(pactadosTotal)} pactados</span>
            </div>
        </div>

        <!-- Split por empresa -->
        <div class="campana-empresas-grid">
            ${renderizarBloqueEmpresa('Diego Quintana', porEmpresa.diego_quintana)}
            ${renderizarBloqueEmpresa('El Ataco', porEmpresa.el_ataco)}
        </div>
    `;
}

function renderizarBloqueEmpresa(nombre, datos) {
    return `
        <div class="campana-empresa-card">
            <div class="campana-empresa-nombre">${nombre}</div>
            <div class="campana-empresa-stats">
                <div>
                    <div class="campana-empresa-valor">${datos.contratos}</div>
                    <div class="campana-empresa-label">Contratos</div>
                </div>
                <div>
                    <div class="campana-empresa-valor">${datos.ha.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</div>
                    <div class="campana-empresa-label">Hectáreas</div>
                </div>
                <div>
                    <div class="campana-empresa-valor">${fqq(datos.pactados)}</div>
                    <div class="campana-empresa-label">QQ pactados</div>
                </div>
            </div>
        </div>
    `;
}

// ==============================================
// BLOQUE B — ALERTAS DE ADELANTOS
// ==============================================
// Muestra contratos con adelanto_dia/mes próxima o vencida
// y que NO están cubiertos por movimientos del contrato anteriores a esa fecha.

/**
 * Construye fecha YYYY-MM-DD del vencimiento del adelanto en la campaña.
 * Si mes >= 7 → año_inicio; si mes < 7 → año_fin.
 */
function fechaVencimientoAdelanto(dia, mes, anioInicio, anioFin) {
    if (!dia || !mes) return null;
    const anio = mes >= 7 ? anioInicio : anioFin;
    const mm = String(mes).padStart(2, '0');
    const dd = String(dia).padStart(2, '0');
    return `${anio}-${mm}-${dd}`;
}

function renderizarAlertasAdelantos(contratos, movimientos) {
    const adelantos = contratos.filter(c => c.adelanto_qq && c.adelanto_dia && c.adelanto_mes);
    if (adelantos.length === 0) return '';

    // Para cada adelanto, calcular si fue cubierto (qq de movimientos hasta esa fecha)
    const items = adelantos.map(c => {
        const vencimiento = fechaVencimientoAdelanto(
            c.adelanto_dia, c.adelanto_mes,
            campanaActualDetalle.anio_inicio, campanaActualDetalle.anio_fin
        );
        const diasHasta = diasDesde(vencimiento); // positivo = venció
        const qqRequeridos = parseFloat(c.adelanto_qq);

        // Suma de movimientos del contrato hasta la fecha de vencimiento
        const movsAplicados = movimientos
            .filter(m => m.contrato_id === c.id
                && m.campana_id === c.campana_id
                && m.fecha
                && m.fecha <= vencimiento);
        const qqCubiertos = movsAplicados.reduce((s, m) => s + parseFloat(m.qq || 0), 0);

        const pagado = qqCubiertos >= qqRequeridos;

        let estado = 'proximo';
        if (pagado) estado = 'pagado';
        else if (diasHasta > 0) estado = 'vencido';
        else if (diasHasta >= -30) estado = 'proximo';
        else estado = 'lejano';

        return {
            contrato: c,
            vencimiento,
            diasHasta,
            qqRequeridos,
            qqCubiertos,
            pagado,
            estado
        };
    });

    // Filtrar: solo mostrar pagados, vencidos o próximos (esconder "lejanos" > 30 días)
    const relevantes = items.filter(i => i.estado !== 'lejano');
    if (relevantes.length === 0) return '';

    // Ordenar: vencidos primero, después próximos, después pagados
    const orden = { vencido: 0, proximo: 1, pagado: 2 };
    relevantes.sort((a, b) => orden[a.estado] - orden[b.estado]);

    return `
        <div class="campana-seccion">
            <h3 class="campana-seccion-titulo">Pagos adelantados</h3>
            <div class="adelantos-lista">
                ${relevantes.map(i => {
                    const c = i.contrato;
                    let iconoClass, texto, detalleEstado;

                    if (i.estado === 'pagado') {
                        iconoClass = 'adelanto-ok';
                        texto = '✓ Pagado';
                        detalleEstado = `Cubierto con ${fqq(i.qqCubiertos)} antes del ${ffecha(i.vencimiento)}`;
                    } else if (i.estado === 'vencido') {
                        iconoClass = 'adelanto-vencido';
                        texto = `⚠ Vencido hace ${i.diasHasta} días`;
                        detalleEstado = i.qqCubiertos > 0
                            ? `Pagado ${fqq(i.qqCubiertos)} de ${fqq(i.qqRequeridos)} — falta ${fqq(i.qqRequeridos - i.qqCubiertos)}`
                            : `No se registró ningún pago — falta ${fqq(i.qqRequeridos)}`;
                    } else {
                        iconoClass = 'adelanto-proximo';
                        texto = `Vence en ${Math.abs(i.diasHasta)} días`;
                        detalleEstado = i.qqCubiertos > 0
                            ? `Ya pagado ${fqq(i.qqCubiertos)} — falta ${fqq(i.qqRequeridos - i.qqCubiertos)}`
                            : `Se espera pago de ${fqq(i.qqRequeridos)}`;
                    }

                    const nombreGrupo = c.nombre_grupo || (c.arrendadores_lista?.[0]?.nombre) || 'Sin nombre';
                    return `
                        <a class="adelanto-item ${iconoClass}" href="/contratos.html?id=${c.id}">
                            <div class="adelanto-izq">
                                <div class="adelanto-nombre">${escHTML(nombreGrupo)}</div>
                                <div class="adelanto-detalle">
                                    ${fqq(i.qqRequeridos)} · vence ${ffecha(i.vencimiento)}
                                    ${c.adelanto_observaciones ? ` · ${escHTML(c.adelanto_observaciones)}` : ''}
                                </div>
                                <div class="adelanto-detalle-estado">${detalleEstado}</div>
                            </div>
                            <div class="adelanto-der">
                                <span class="adelanto-badge">${texto}</span>
                            </div>
                        </a>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

// ==============================================
// BLOQUE C — TABLA DE ARRENDADORES
// ==============================================

function renderizarTablaArrendadores(contratos, saldos, movimientos) {
    if (contratos.length === 0) {
        return `
            <div class="campana-seccion">
                <h3 class="campana-seccion-titulo">Contratos en esta campaña</h3>
                <div class="panel-vacio">
                    <p>No hay contratos cargados para esta campaña.</p>
                </div>
            </div>
        `;
    }

    const campanaId = campanaActualDetalle.id;

    // Entregados por contrato
    const entregadosPorCt = {};
    movimientos
        .filter(m => m.campana_id === campanaId && m.contrato_id)
        .forEach(m => {
            const k = m.contrato_id;
            if (!entregadosPorCt[k]) entregadosPorCt[k] = { blanco: 0, negro: 0 };
            const qq = parseFloat(m.qq || 0);
            if (m.tipo === 'negro') entregadosPorCt[k].negro += qq;
            else entregadosPorCt[k].blanco += qq;
        });

    // Saldos por contrato
    const saldosPorCt = {};
    saldos.forEach(s => {
        if (!s.contrato_id) return;
        saldosPorCt[s.contrato_id] = {
            blanco: parseFloat(s.qq_deuda_blanco || 0),
            negro: parseFloat(s.qq_deuda_negro || 0)
        };
    });

    // Una fila por contrato
    const filas = contratos.map(c => {
        const entregado = entregadosPorCt[c.id] || { blanco: 0, negro: 0 };
        const saldo = saldosPorCt[c.id] || { blanco: 0, negro: 0 };
        const pactadosBlanco = parseFloat(c.qq_pactados_anual || 0);
        const pactadosNegro = parseFloat(c.qq_negro_anual || 0);
        const pactado = pactadosBlanco + pactadosNegro;
        const entregadoTotal = entregado.blanco + entregado.negro;
        const pendiente = saldo.blanco + saldo.negro;
        const pct = pactado > 0 ? Math.round((entregadoTotal / pactado) * 100) : 0;

        // Estado del adelanto del contrato
        let adelantoInfo = '—';
        if (c.adelanto_qq && c.adelanto_dia && c.adelanto_mes) {
            const fecha = fechaVencimientoAdelanto(
                c.adelanto_dia, c.adelanto_mes,
                campanaActualDetalle.anio_inicio, campanaActualDetalle.anio_fin
            );
            const qqAd = parseFloat(c.adelanto_qq);
            const dias = diasDesde(fecha);
            if (entregadoTotal >= qqAd) {
                adelantoInfo = `<span class="tabla-estado-ok">✓ Pagado</span>`;
            } else if (dias > 0) {
                adelantoInfo = `<span class="tabla-estado-rojo">🔴 Vencido ${dias}d</span>`;
            } else if (dias >= -30) {
                adelantoInfo = `<span class="tabla-estado-amarillo">🟡 Vence ${Math.abs(dias)}d</span>`;
            } else {
                adelantoInfo = `<span class="tabla-estado-gris">${ffecha(fecha)}</span>`;
            }
        }

        // Estado general
        let estadoGral;
        if (pct >= 100) estadoGral = `<span class="tabla-estado-ok">Completado</span>`;
        else if (pct >= 50) estadoGral = `<span class="tabla-estado-amarillo">En curso</span>`;
        else if (pct > 0) estadoGral = `<span class="tabla-estado-amarillo">Parcial</span>`;
        else estadoGral = `<span class="tabla-estado-gris">Sin movimientos</span>`;

        const nombreGrupo = c.nombre_grupo || (c.arrendadores_lista?.[0]?.nombre) || 'Sin nombre';
        const subtitulo = c.campo
            ? c.campo
            : (c.arrendadores_lista?.length > 1 ? `${c.arrendadores_lista.length} arrendadores` : '');

        return {
            contratoId: c.id,
            nombre: nombreGrupo,
            campo: subtitulo,
            hectareas: parseFloat(c.hectareas || 0),
            pactado,
            entregadoTotal,
            pendiente,
            pct,
            adelantoInfo,
            estadoGral
        };
    });

    // Ordenar por % ascendente (los más atrasados arriba)
    filas.sort((a, b) => a.pct - b.pct);

    return `
        <div class="campana-seccion">
            <h3 class="campana-seccion-titulo">Contratos en esta campaña</h3>
            <div class="tabla-contenedor" style="overflow-x: auto;">
                <table class="tabla" style="min-width: 900px;">
                    <thead>
                        <tr>
                            <th>Grupo / Arrendador</th>
                            <th style="text-align: right;">Ha</th>
                            <th style="text-align: right;">Pactado</th>
                            <th style="text-align: right;">Entregado</th>
                            <th style="text-align: right;">Pendiente</th>
                            <th style="width: 180px;">Cumplimiento</th>
                            <th>Adelanto</th>
                            <th>Estado</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filas.map(f => {
                            let claseBarra = 'cumplimiento-barra-bajo';
                            if (f.pct >= 80) claseBarra = 'cumplimiento-barra-alto';
                            else if (f.pct >= 50) claseBarra = 'cumplimiento-barra-medio';

                            return `
                                <tr onclick="window.location.href='/contratos.html?id=${f.contratoId}'" style="cursor: pointer;">
                                    <td>
                                        <div style="font-weight: 600;">${escHTML(f.nombre)}</div>
                                        ${f.campo ? `<div class="tabla-texto-tenue">${escHTML(f.campo)}</div>` : ''}
                                    </td>
                                    <td style="text-align: right;">${f.hectareas.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</td>
                                    <td style="text-align: right;">${fqq(f.pactado)}</td>
                                    <td style="text-align: right; color: var(--color-verde); font-weight: 600;">${fqq(f.entregadoTotal)}</td>
                                    <td style="text-align: right; color: var(--color-dorado); font-weight: 600;">${fqq(f.pendiente)}</td>
                                    <td>
                                        <div class="tabla-cumplimiento">
                                            <div class="cumplimiento-barra-track" style="height: 6px;">
                                                <div class="cumplimiento-barra ${claseBarra}" style="width: ${f.pct}%"></div>
                                            </div>
                                            <span class="tabla-cumplimiento-pct">${f.pct}%</span>
                                        </div>
                                    </td>
                                    <td>${f.adelantoInfo}</td>
                                    <td>${f.estadoGral}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// ==============================================
// BLOQUE D — ADELANTOS PARA PRÓXIMA CAMPAÑA
// ==============================================
// Movimientos que ocurrieron DENTRO del período de esta campaña
// pero cuyo campana_id apunta a una campaña POSTERIOR.
// Son adelantos sobre la campaña siguiente.

function renderizarAdelantosParaSiguiente(movimientos) {
    const actual = campanaActualDetalle;
    const inicioCampana = `${actual.anio_inicio}-07-01`;
    const finCampana = `${actual.anio_fin}-06-30`;

    // Encontrar campañas posteriores
    const posteriores = todasLasCampanas.filter(c => c.anio_inicio > actual.anio_inicio);
    if (posteriores.length === 0) return '';

    const idsPosteriores = new Set(posteriores.map(c => c.id));

    // Movimientos hechos durante esta campaña (por fecha) pero que pertenecen a una campaña posterior
    const adelantosSiguiente = movimientos.filter(m => {
        if (!m.fecha || !m.campana_id) return false;
        if (m.fecha < inicioCampana || m.fecha > finCampana) return false;
        return idsPosteriores.has(m.campana_id);
    });

    if (adelantosSiguiente.length === 0) return '';

    // Agrupar por contrato + campaña destino (un saldo es por contrato)
    const grupos = {};
    adelantosSiguiente.forEach(m => {
        const key = `${m.contrato_id || m.arrendador_id}|${m.campana_id}`;
        if (!grupos[key]) {
            grupos[key] = {
                contratoId: m.contrato_id,
                arrendadorId: m.arrendador_id,
                nombre: m.contratos?.nombre_grupo || m.arrendadores?.nombre || 'Sin nombre',
                campanaDestino: m.campanas?.nombre || '—',
                qq: 0,
                movimientos: []
            };
        }
        grupos[key].qq += parseFloat(m.qq || 0);
        grupos[key].movimientos.push(m);
    });

    const filas = Object.values(grupos).sort((a, b) => b.qq - a.qq);
    const totalQQ = filas.reduce((s, g) => s + g.qq, 0);

    return `
        <div class="campana-seccion">
            <h3 class="campana-seccion-titulo">
                Adelantos recibidos para próximas campañas
                <span class="campana-seccion-total">${fqq(totalQQ)} total</span>
            </h3>
            <div class="adelantos-siguiente-info">
                Estos son movimientos hechos dentro del período de la campaña actual
                (${ffecha(inicioCampana)} — ${ffecha(finCampana)}) pero que se descuentan del saldo
                de una campaña posterior.
            </div>
            <div class="tabla-contenedor" style="overflow-x: auto;">
                <table class="tabla">
                    <thead>
                        <tr>
                            <th>Arrendador</th>
                            <th>Campaña destino</th>
                            <th style="text-align: right;">QQ adelantados</th>
                            <th style="text-align: right;">Movimientos</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filas.map(g => `
                            <tr onclick="window.location.href='${g.contratoId ? `/contratos.html?id=${g.contratoId}` : `/arrendador.html?id=${g.arrendadorId}`}'" style="cursor: pointer;">
                                <td><strong>${escHTML(g.nombre)}</strong></td>
                                <td>${escHTML(g.campanaDestino)}</td>
                                <td style="text-align: right; color: var(--color-dorado); font-weight: 600;">${fqq(g.qq)}</td>
                                <td style="text-align: right;">${g.movimientos.length}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}
