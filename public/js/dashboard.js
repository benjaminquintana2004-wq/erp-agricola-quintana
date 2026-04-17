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
                .select('id, fecha_fin, estado')
                .order('fecha_fin'),
            'dashboard: contratos'
        ),
        ejecutarConsulta(
            db.from('saldos')
                .select('*, arrendadores(nombre, campo), campanas(nombre, activa)')
                .order('qq_deuda_blanco', { ascending: false }),
            'dashboard: saldos'
        )
    ]);

    // KPIs
    renderizarKPIs(arrendadores, movimientos, contratos, saldos);

    // Alertas urgentes
    renderizarAlertas(movimientos, contratos);

    // Top arrendadores
    renderizarTopArrendadores(saldos);

    // Últimos movimientos
    renderizarUltimosMovimientos(movimientos);

    // Gráficos
    renderizarGraficoQQMes(movimientos);
    renderizarGraficoSaldos(saldos);
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
// TOP 5 ARRENDADORES CON MAYOR SALDO
// ==============================================

function renderizarTopArrendadores(saldos) {
    const body = document.getElementById('top-arrendadores-body');
    if (!body) return;

    if (!saldos || saldos.length === 0) {
        body.innerHTML = `
            <div class="panel-vacio">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                Sin datos de saldos
            </div>
        `;
        return;
    }

    // Filtrar campaña activa y calcular saldo total
    const saldosActivos = saldos
        .filter(s => s.campanas?.activa)
        .map(s => ({
            nombre: s.arrendadores?.nombre || 'Sin nombre',
            campo: s.arrendadores?.campo || '',
            blanco: parseFloat(s.qq_deuda_blanco || 0),
            negro: parseFloat(s.qq_deuda_negro || 0),
            total: parseFloat(s.qq_deuda_blanco || 0) + parseFloat(s.qq_deuda_negro || 0)
        }))
        .filter(s => s.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

    if (saldosActivos.length === 0) {
        body.innerHTML = `
            <div class="panel-vacio">
                No hay saldos pendientes en la campaña activa
            </div>
        `;
        return;
    }

    body.innerHTML = saldosActivos.map((s, i) => `
        <div class="top-arrendador">
            <div class="top-posicion">${i + 1}</div>
            <div class="top-info">
                <div class="top-nombre">${s.nombre}</div>
                ${s.campo ? `<div class="top-campo">${s.campo}</div>` : ''}
            </div>
            <div class="top-saldo">
                <div class="top-qq">${formatearQQ(s.total)}</div>
                <div class="top-tipo">${s.blanco > 0 ? 'B:' + formatearQQ(s.blanco) : ''} ${s.negro > 0 ? 'N:' + formatearQQ(s.negro) : ''}</div>
            </div>
        </div>
    `).join('');
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
            nombre: s.arrendadores?.nombre || '?',
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
