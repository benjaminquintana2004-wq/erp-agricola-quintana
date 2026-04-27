// ==============================================
// dashboard.js — Lógica del dashboard principal
// Carga KPIs, alertas, top arrendadores,
// últimos movimientos y gráficos Chart.js.
// ==============================================

async function cargarDashboard() {
    // Cargar todo en paralelo
    const [arrendadores, movimientos, contratos, saldos] = await Promise.all([
        ejecutarConsulta(
            db.from('arrendadores').select('id, nombre, campo').eq('activo', true),
            'dashboard: arrendadores'
        ),
        ejecutarConsulta(
            db.from('movimientos')
                .select('*, arrendadores(nombre)')
                .order('fecha', { ascending: false }),
            'dashboard: movimientos'
        ),
        ejecutarConsulta(
            db.from('contratos')
                .select('id, fecha_inicio, fecha_fin, estado, hectareas, qq_pactados_anual, nombre_grupo, campo, contratos_arrendadores(es_titular_principal, orden, arrendadores(nombre, telefono))')
                .order('fecha_fin'),
            'dashboard: contratos'
        ),
        ejecutarConsulta(
            db.from('saldos')
                .select('*, contratos(id, nombre_grupo, campo), campanas(nombre, activa)')
                .order('qq_deuda_blanco', { ascending: false }),
            'dashboard: saldos'
        )
    ]);

    // Pre-procesar contratos: lista plana de arrendadores ordenada (titular primero)
    (contratos || []).forEach(c => {
        const ca = (c.contratos_arrendadores || []).slice().sort((a, b) => {
            if (a.es_titular_principal && !b.es_titular_principal) return -1;
            if (!a.es_titular_principal && b.es_titular_principal) return 1;
            return (a.orden ?? 999) - (b.orden ?? 999);
        });
        c.arrendadores_lista = ca.map(x => x.arrendadores).filter(Boolean);
    });

    // KPIs
    renderizarKPIs(arrendadores, movimientos, contratos, saldos);

    // Alertas urgentes
    renderizarAlertas(movimientos, contratos);

    // Contratos vigentes
    renderizarContratosPanel(contratos);

    // Últimos movimientos
    renderizarUltimosMovimientos(movimientos);

    // Gráficos
    renderizarGraficoQQMes(movimientos);
    renderizarGraficoSaldos(saldos);

    // Paneles comparativos (Fase 4.2)
    renderizarCumplimiento(saldos, movimientos);
    renderizarDemoraFacturacion(movimientos);
}

// ==============================================
// KPIs
// ==============================================

function renderizarKPIs(arrendadores, movimientos, contratos, saldos) {
    // Arrendadores activos
    const totalArr = arrendadores?.length || 0;
    document.getElementById('kpi-arrendadores').textContent = totalArr;

    // QQ pendientes totales (suma de saldos positivos de campaña activa)
    let qqTotal = 0;
    if (saldos) {
        saldos
            .filter(s => s.campanas?.activa)
            .forEach(s => {
                qqTotal += parseFloat(s.qq_deuda_blanco || 0) + parseFloat(s.qq_deuda_negro || 0);
            });
    }
    document.getElementById('kpi-qq-pendientes').textContent = formatearQQ(qqTotal);

    // Movimientos sin factura
    const sinFactura = movimientos?.filter(m => m.estado_factura === 'sin_factura').length || 0;
    document.getElementById('kpi-sin-factura').textContent = sinFactura;

    // Contratos vigentes
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const vigentes = contratos?.filter(c => {
        const fin = new Date(c.fecha_fin + 'T00:00:00');
        return fin >= hoy;
    }).length || 0;
    document.getElementById('kpi-contratos').textContent = vigentes;

    // ---- Cumplimiento campaña activa ----
    // % = (qq entregados total / qq pactados total) de la campaña activa
    // qq pactados = pendiente + entregado, que es qq inicial del contrato.
    // Como no tenemos histórico directo del "pactado inicial" aparte del saldo,
    // reconstruimos: pactado = qq_entregados (movimientos) + qq_pendiente (saldo actual).
    const saldosActivos = (saldos || []).filter(s => s.campanas?.activa);
    let totalEntregados = 0;
    let totalPactados = 0;

    // Sumar qq entregados: movimientos cuyo contrato_id tiene saldo en campaña activa
    const contratosActivos = new Set(saldosActivos.map(s => s.contrato_id).filter(Boolean));
    (movimientos || []).forEach(m => {
        if (m.contrato_id && contratosActivos.has(m.contrato_id)) {
            totalEntregados += parseFloat(m.qq || 0);
        }
    });

    // Sumar qq pendientes (saldos actuales)
    let totalPendientes = 0;
    saldosActivos.forEach(s => {
        totalPendientes += parseFloat(s.qq_deuda_blanco || 0) + parseFloat(s.qq_deuda_negro || 0);
    });

    totalPactados = totalEntregados + totalPendientes;
    const porcentajeCumplimiento = totalPactados > 0
        ? Math.round((totalEntregados / totalPactados) * 100)
        : 0;

    const kpiCumpl = document.getElementById('kpi-cumplimiento');
    const kpiCumplIcono = document.getElementById('kpi-cumplimiento-icono');
    if (kpiCumpl) {
        kpiCumpl.textContent = totalPactados > 0 ? `${porcentajeCumplimiento}%` : '—';
    }
    if (kpiCumplIcono) {
        kpiCumplIcono.classList.remove('kpi-icono-verde', 'kpi-icono-amarillo', 'kpi-icono-rojo');
        if (porcentajeCumplimiento >= 80) kpiCumplIcono.classList.add('kpi-icono-verde');
        else if (porcentajeCumplimiento >= 50) kpiCumplIcono.classList.add('kpi-icono-amarillo');
        else kpiCumplIcono.classList.add('kpi-icono-rojo');
    }

    // ---- Demora promedio de facturas ----
    // Promedio de días de facturas con estado != factura_ok
    const movimientosSinOk = (movimientos || []).filter(m =>
        m.estado_factura !== 'factura_ok' && m.fecha
    );
    let sumaDias = 0;
    movimientosSinOk.forEach(m => {
        const fm = new Date(m.fecha + 'T00:00:00');
        const dias = Math.floor((hoy - fm) / (1000 * 60 * 60 * 24));
        if (dias > 0) sumaDias += dias;
    });
    const demoraProm = movimientosSinOk.length > 0
        ? Math.round(sumaDias / movimientosSinOk.length)
        : 0;

    const kpiDemora = document.getElementById('kpi-demora-factura');
    const kpiDemoraIcono = document.getElementById('kpi-demora-icono');
    if (kpiDemora) {
        kpiDemora.textContent = movimientosSinOk.length > 0 ? `${demoraProm} d` : '0 d';
    }
    if (kpiDemoraIcono) {
        kpiDemoraIcono.classList.remove('kpi-icono-dorado', 'kpi-icono-verde', 'kpi-icono-amarillo', 'kpi-icono-rojo');
        if (movimientosSinOk.length === 0 || demoraProm < 7) kpiDemoraIcono.classList.add('kpi-icono-verde');
        else if (demoraProm < 20) kpiDemoraIcono.classList.add('kpi-icono-amarillo');
        else kpiDemoraIcono.classList.add('kpi-icono-rojo');
    }
}

// ==============================================
// ALERTAS URGENTES
// ==============================================

function renderizarAlertas(movimientos, contratos) {
    const panel = document.getElementById('panel-alertas');
    const body = document.getElementById('alertas-body');
    if (!panel || !body) return;

    const alertas = [];
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    // Facturas pendientes > 20 días
    if (movimientos) {
        movimientos
            .filter(m => m.estado_factura !== 'factura_ok')
            .forEach(m => {
                const fecha = new Date(m.fecha + 'T00:00:00');
                const dias = Math.floor((hoy - fecha) / (1000 * 60 * 60 * 24));
                if (dias >= 20) {
                    alertas.push({
                        tipo: 'rojo',
                        titulo: `${m.arrendadores?.nombre || 'Sin nombre'} — ${formatearQQ(m.qq)}`,
                        detalle: `Factura pendiente hace ${dias} días`,
                        badge: `<span class="badge badge-rojo">${dias}d</span>`
                    });
                } else if (dias >= 10) {
                    alertas.push({
                        tipo: 'amarillo',
                        titulo: `${m.arrendadores?.nombre || 'Sin nombre'} — ${formatearQQ(m.qq)}`,
                        detalle: `Factura pendiente hace ${dias} días`,
                        badge: `<span class="badge badge-amarillo">${dias}d</span>`
                    });
                }
            });
    }

    // Contratos por vencer (< 90 días)
    if (contratos) {
        contratos.forEach(c => {
            const fin = new Date(c.fecha_fin + 'T00:00:00');
            const dias = Math.floor((fin - hoy) / (1000 * 60 * 60 * 24));
            if (dias < 0) {
                alertas.push({
                    tipo: 'rojo',
                    titulo: 'Contrato vencido',
                    detalle: `Venció hace ${Math.abs(dias)} días`,
                    badge: '<span class="badge badge-rojo">Vencido</span>'
                });
            } else if (dias <= 90) {
                alertas.push({
                    tipo: 'amarillo',
                    titulo: 'Contrato por vencer',
                    detalle: `Vence en ${dias} días`,
                    badge: `<span class="badge badge-amarillo">${dias}d</span>`
                });
            }
        });
    }

    if (alertas.length === 0) {
        panel.style.display = 'none';
        return;
    }

    // Ordenar: rojos primero
    alertas.sort((a, b) => (a.tipo === 'rojo' ? 0 : 1) - (b.tipo === 'rojo' ? 0 : 1));

    // Mostrar máximo 8
    const mostrar = alertas.slice(0, 8);

    panel.style.display = 'block';
    body.innerHTML = mostrar.map(a => `
        <div class="alerta-item">
            <div class="alerta-item-icono alerta-item-icono-${a.tipo}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
            </div>
            <div class="alerta-item-info">
                <div class="alerta-item-titulo">${a.titulo}</div>
                <div class="alerta-item-detalle">${a.detalle}</div>
            </div>
            <div class="alerta-item-badge">${a.badge}</div>
        </div>
    `).join('') + (alertas.length > 8 ? `
        <div class="alerta-item" style="justify-content:center; color:var(--color-texto-tenue);">
            y ${alertas.length - 8} alertas más...
        </div>
    ` : '');
}

// ==============================================
// CONTRATOS VIGENTES
// ==============================================

function renderizarContratosPanel(contratos) {
    const body = document.getElementById('contratos-panel-body');
    if (!body) return;

    if (!contratos || contratos.length === 0) {
        body.innerHTML = `
            <div class="panel-vacio">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Sin contratos registrados
            </div>
        `;
        return;
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    // Calcular días restantes y badge; excluir vencidos
    const activos = contratos
        .map(c => {
            const fin = new Date(c.fecha_fin + 'T00:00:00');
            const dias = Math.ceil((fin - hoy) / (1000 * 60 * 60 * 24));
            let badgeHtml;
            if (dias < 0) {
                badgeHtml = '<span class="badge badge-rojo">Vencido</span>';
            } else if (dias <= 90) {
                badgeHtml = '<span class="badge badge-amarillo">Por vencer</span>';
            } else {
                badgeHtml = '<span class="badge badge-verde">Vigente</span>';
            }
            return { ...c, diasRestantes: dias, badgeHtml };
        })
        .filter(c => c.diasRestantes >= 0)
        .sort((a, b) => a.diasRestantes - b.diasRestantes); // próximos a vencer primero

    if (activos.length === 0) {
        body.innerHTML = `<div class="panel-vacio">No hay contratos vigentes</div>`;
        return;
    }

    body.innerHTML = `
        <div style="overflow-x:auto;">
            <table class="tabla" style="min-width:520px;">
                <thead>
                    <tr>
                        <th>Arrendador</th>
                        <th>Teléfono</th>
                        <th>Ha</th>
                        <th>Estado</th>
                        <th>Vence</th>
                    </tr>
                </thead>
                <tbody>
                    ${activos.map(c => {
                        const nombre = c.nombre_grupo || (c.arrendadores_lista?.[0]?.nombre) || '—';
                        const tel = c.arrendadores_lista?.[0]?.telefono;
                        return `
                    <tr>
                        <td>
                            <strong>${nombre}</strong>
                            ${c.campo ? `<br><span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${c.campo}</span>` : ''}
                        </td>
                        <td style="white-space:nowrap;">${tel || '<span style="color:var(--color-texto-tenue);">—</span>'}</td>
                        <td style="white-space:nowrap;">${c.hectareas ? Number(c.hectareas).toLocaleString('es-AR') + ' ha' : '—'}</td>
                        <td>${c.badgeHtml}</td>
                        <td style="white-space:nowrap;font-size:var(--texto-xs);color:var(--color-texto-tenue);">
                            ${formatearFechaMedia(c.fecha_fin)}<br>
                            <span style="color:${c.diasRestantes <= 90 ? 'var(--color-amarillo)' : 'inherit'};">
                                ${c.diasRestantes === 0 ? 'Hoy' : `${c.diasRestantes}d`}
                            </span>
                        </td>
                    </tr>
                    `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * Formatea fecha como "14 abr 2026"
 */
function formatearFechaMedia(fechaStr) {
    if (!fechaStr) return '—';
    const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const [anio, mes, dia] = fechaStr.split('-');
    return `${parseInt(dia)} ${meses[parseInt(mes) - 1]} ${anio}`;
}

// ==============================================
// ÚLTIMOS 10 MOVIMIENTOS
// ==============================================

function renderizarUltimosMovimientos(movimientos) {
    const body = document.getElementById('ultimos-movimientos-body');
    if (!body) return;

    if (!movimientos || movimientos.length === 0) {
        body.innerHTML = `
            <div class="panel-vacio">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                Sin movimientos registrados
            </div>
        `;
        return;
    }

    const ultimos = movimientos.slice(0, 10);

    body.innerHTML = ultimos.map(m => {
        const tipoBadge = m.tipo === 'blanco'
            ? '<span class="badge badge-blanco" style="font-size:0.65rem;padding:1px 6px;">B</span>'
            : '<span class="badge badge-negro" style="font-size:0.65rem;padding:1px 6px;">N</span>';

        return `
        <div class="mov-item">
            <div class="mov-fecha">${formatearFechaCorta(m.fecha)}</div>
            <div class="mov-nombre">${m.arrendadores?.nombre || '—'}</div>
            <div class="mov-qq">${formatearQQ(m.qq)}</div>
            <div class="mov-tipo">${tipoBadge}</div>
        </div>
        `;
    }).join('');
}

/**
 * Formatea fecha en formato corto: "14 abr"
 */
function formatearFechaCorta(fechaStr) {
    if (!fechaStr) return '—';
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const fecha = new Date(fechaStr + 'T00:00:00');
    return `${fecha.getDate()} ${meses[fecha.getMonth()]}`;
}

// ==============================================
// GRÁFICO: QQ ENTREGADOS POR MES
// ==============================================

function renderizarGraficoQQMes(movimientos) {
    const canvas = document.getElementById('grafico-qq-mes');
    if (!canvas || !movimientos) return;

    // Agrupar por mes (últimos 12 meses)
    const hoy = new Date();
    const meses = [];
    const datos = [];

    for (let i = 11; i >= 0; i--) {
        const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
        const anio = fecha.getFullYear();
        const mes = fecha.getMonth();
        const mesesNombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        meses.push(`${mesesNombres[mes]} ${anio.toString().slice(2)}`);

        const qqMes = movimientos
            .filter(m => {
                const f = new Date(m.fecha + 'T00:00:00');
                return f.getFullYear() === anio && f.getMonth() === mes;
            })
            .reduce((sum, m) => sum + parseFloat(m.qq || 0), 0);

        datos.push(Math.round(qqMes * 100) / 100);
    }

    new Chart(canvas, {
        type: 'bar',
        data: {
            labels: meses,
            datasets: [{
                label: 'QQ entregados',
                data: datos,
                backgroundColor: 'rgba(201, 168, 76, 0.6)',
                borderColor: 'rgba(201, 168, 76, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { color: '#6b6760', font: { size: 11 } },
                    grid: { display: false }
                },
                y: {
                    ticks: { color: '#6b6760', font: { size: 11 } },
                    grid: { color: 'rgba(58, 56, 53, 0.5)' },
                    beginAtZero: true
                }
            }
        }
    });
}

// ==============================================
// GRÁFICO: SALDO PENDIENTE POR ARRENDADOR
// ==============================================

function renderizarGraficoSaldos(saldos) {
    const canvas = document.getElementById('grafico-saldos');
    if (!canvas || !saldos) return;

    // Top 10 saldos de campaña activa
    const top = saldos
        .filter(s => s.campanas?.activa)
        .map(s => ({
            nombre: s.contratos?.nombre_grupo || '?',
            blanco: parseFloat(s.qq_deuda_blanco || 0),
            negro: parseFloat(s.qq_deuda_negro || 0)
        }))
        .filter(s => (s.blanco + s.negro) > 0)
        .sort((a, b) => (b.blanco + b.negro) - (a.blanco + a.negro))
        .slice(0, 10);

    if (top.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#6b6760';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Sin datos de saldos', canvas.width / 2, canvas.height / 2);
        return;
    }

    // Acortar nombres largos
    const nombres = top.map(s => {
        if (s.nombre.length > 15) return s.nombre.substring(0, 14) + '…';
        return s.nombre;
    });

    new Chart(canvas, {
        type: 'bar',
        data: {
            labels: nombres,
            datasets: [
                {
                    label: 'Blanco',
                    data: top.map(s => s.blanco),
                    backgroundColor: 'rgba(232, 228, 220, 0.5)',
                    borderColor: 'rgba(232, 228, 220, 0.8)',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: 'Negro',
                    data: top.map(s => s.negro),
                    backgroundColor: 'rgba(107, 103, 96, 0.5)',
                    borderColor: 'rgba(107, 103, 96, 0.8)',
                    borderWidth: 1,
                    borderRadius: 4
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#a09b90',
                        font: { size: 11 },
                        boxWidth: 12,
                        padding: 15
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: '#6b6760', font: { size: 11 } },
                    grid: { color: 'rgba(58, 56, 53, 0.5)' },
                    beginAtZero: true
                },
                y: {
                    stacked: true,
                    ticks: { color: '#a09b90', font: { size: 11 } },
                    grid: { display: false }
                }
            }
        }
    });
}

// ==============================================
// PANEL: CUMPLIMIENTO POR ARRENDADOR (Fase 4.2)
// ==============================================
// Muestra cada arrendador de la campaña activa con una barra de
// progreso: qq entregados / qq pactados. Orden ascendente por %
// para destacar a los que más falta entregarles.
// ==============================================

function renderizarCumplimiento(saldos, movimientos) {
    const body = document.getElementById('cumplimiento-body');
    if (!body) return;

    const saldosActivos = (saldos || []).filter(s => s.campanas?.activa);

    if (saldosActivos.length === 0) {
        body.innerHTML = `
            <div class="panel-vacio">
                <p>No hay arrendadores con saldo en la campaña activa.</p>
            </div>
        `;
        return;
    }

    // Sumar entregados por contrato (de la campaña activa)
    const entregadosPorCt = {};
    const contratosActivosSet = new Set(saldosActivos.map(s => s.contrato_id).filter(Boolean));
    (movimientos || []).forEach(m => {
        if (!m.contrato_id || !m.campana_id) return;
        if (!contratosActivosSet.has(m.contrato_id)) return;
        entregadosPorCt[m.contrato_id] = (entregadosPorCt[m.contrato_id] || 0) + parseFloat(m.qq || 0);
    });

    // Armar filas (una por contrato con saldo en campaña activa)
    const filas = saldosActivos.map(s => {
        const pendiente = parseFloat(s.qq_deuda_blanco || 0) + parseFloat(s.qq_deuda_negro || 0);
        const entregado = entregadosPorCt[s.contrato_id] || 0;
        const pactado = pendiente + entregado;
        const pct = pactado > 0 ? Math.round((entregado / pactado) * 100) : 0;
        return {
            nombre: s.contratos?.nombre_grupo || 'Sin nombre',
            contratoId: s.contrato_id,
            entregado,
            pendiente,
            pactado,
            pct
        };
    }).filter(f => f.pactado > 0);

    if (filas.length === 0) {
        body.innerHTML = `
            <div class="panel-vacio">
                <p>Todavía no hay qq pactados en la campaña activa.</p>
            </div>
        `;
        return;
    }

    // Ordenar ascendente por % (los más atrasados arriba)
    filas.sort((a, b) => a.pct - b.pct);

    // Limitar a top 8
    const mostrar = filas.slice(0, 8);

    body.innerHTML = mostrar.map(f => {
        let claseBarra = 'cumplimiento-barra-alto';
        if (f.pct < 50) claseBarra = 'cumplimiento-barra-bajo';
        else if (f.pct < 80) claseBarra = 'cumplimiento-barra-medio';

        return `
        <a class="cumplimiento-item" href="/contratos.html?id=${f.contratoId}">
            <div class="cumplimiento-header">
                <span class="cumplimiento-nombre">${f.nombre}</span>
                <span class="cumplimiento-pct ${claseBarra.replace('barra', 'texto')}">${f.pct}%</span>
            </div>
            <div class="cumplimiento-barra-track">
                <div class="cumplimiento-barra ${claseBarra}" style="width: ${f.pct}%"></div>
            </div>
            <div class="cumplimiento-detalle">
                <span>${formatearQQ(f.entregado)} entregados</span>
                <span>·</span>
                <span>${formatearQQ(f.pendiente)} pendientes</span>
                <span>·</span>
                <span>${formatearQQ(f.pactado)} pactados</span>
            </div>
        </a>
        `;
    }).join('');
}

// ==============================================
// PANEL: DEMORA DE FACTURACIÓN (Fase 4.2)
// ==============================================
// Top 5 arrendadores más lentos en enviar factura.
// Para cada arrendador: cuenta sus movimientos sin factura_ok,
// calcula el promedio de días pendientes, y ordena descendente.
// ==============================================

function renderizarDemoraFacturacion(movimientos) {
    const body = document.getElementById('demora-body');
    if (!body) return;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    // Agrupar movimientos pendientes por arrendador
    const porArr = {};
    (movimientos || [])
        .filter(m => m.estado_factura !== 'factura_ok' && m.fecha && m.arrendador_id)
        .forEach(m => {
            const fm = new Date(m.fecha + 'T00:00:00');
            const dias = Math.floor((hoy - fm) / (1000 * 60 * 60 * 24));
            if (dias < 0) return;

            if (!porArr[m.arrendador_id]) {
                porArr[m.arrendador_id] = {
                    nombre: m.arrendadores?.nombre || 'Sin nombre',
                    arrendadorId: m.arrendador_id,
                    sumaDias: 0,
                    maxDias: 0,
                    cantidad: 0,
                    qqTotal: 0,
                    reclamadas: 0
                };
            }
            const r = porArr[m.arrendador_id];
            r.sumaDias += dias;
            r.maxDias = Math.max(r.maxDias, dias);
            r.cantidad++;
            r.qqTotal += parseFloat(m.qq || 0);
            if (m.estado_factura === 'reclamada') r.reclamadas++;
        });

    const filas = Object.values(porArr).map(r => ({
        ...r,
        promedio: Math.round(r.sumaDias / r.cantidad)
    }));

    if (filas.length === 0) {
        body.innerHTML = `
            <div class="panel-vacio panel-vacio-ok">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:32px;height:32px;opacity:0.6;">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                <p>Todas las facturas al día.</p>
            </div>
        `;
        return;
    }

    // Ordenar descendente por promedio de días (los más lentos arriba)
    filas.sort((a, b) => b.promedio - a.promedio);

    const mostrar = filas.slice(0, 5);

    body.innerHTML = mostrar.map(r => {
        let claseColor = 'demora-verde';
        if (r.promedio >= 20) claseColor = 'demora-rojo';
        else if (r.promedio >= 10) claseColor = 'demora-amarillo';

        return `
        <a class="demora-item" href="/arrendador.html?id=${r.arrendadorId}">
            <div class="demora-izq">
                <div class="demora-nombre">${r.nombre}</div>
                <div class="demora-detalle">
                    ${r.cantidad} factura${r.cantidad === 1 ? '' : 's'} pendiente${r.cantidad === 1 ? '' : 's'}
                    · ${formatearQQ(r.qqTotal)}
                    ${r.reclamadas > 0 ? `<span class="badge badge-amarillo" style="margin-left:6px;">${r.reclamadas} reclamada${r.reclamadas === 1 ? '' : 's'}</span>` : ''}
                </div>
            </div>
            <div class="demora-der">
                <div class="demora-dias ${claseColor}">${r.promedio}d</div>
                <div class="demora-max">máx ${r.maxDias}d</div>
            </div>
        </a>
        `;
    }).join('');
}
