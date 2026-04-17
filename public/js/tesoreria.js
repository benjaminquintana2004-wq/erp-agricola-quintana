// ==============================================
// tesoreria.js — Módulo de Tesorería
// Cheques, transferencias a arrendadores, préstamos,
// saldo real y timeline de baldes.
// ==============================================

// ── Estado global del módulo ─────────────────
let empresas             = [];
let cuentas              = [];
let categorias           = [];
let beneficiarios        = [];
let contratistasTesoreria = [];   // contratistas para el selector de beneficiario
let empleadosTesoreria    = [];   // empleados para el selector de beneficiario
let movimientosTesoreria  = [];
let prestamos             = [];
let cuotas                = [];
let saldosBancarios       = [];

let empresaActivaId     = null;   // empresa seleccionada
let chequeEditandoId    = null;
let prestamoEditandoId  = null;

// ==============================================
// CARGAR DATOS
// ==============================================

async function cargarTesoreria() {
    const [
        empData, cuentasData, catData, benData,
        contratistasData, empleadosData,
        movData, prestData, cuotasData, saldosData
    ] = await Promise.all([
        ejecutarConsulta(db.from('empresas').select('*').order('nombre'), 'cargar empresas'),
        ejecutarConsulta(db.from('cuentas_bancarias').select('*, empresas(nombre)').order('alias'), 'cargar cuentas'),
        ejecutarConsulta(db.from('categorias_gasto').select('*').eq('activa', true).order('nombre'), 'cargar categorías'),
        ejecutarConsulta(db.from('beneficiarios').select('*, contratistas(nombre), empleados(nombre)').order('nombre'), 'cargar beneficiarios'),
        ejecutarConsulta(db.from('contratistas').select('id, nombre, especialidad').order('nombre'), 'cargar contratistas'),
        ejecutarConsulta(db.from('empleados').select('id, nombre, rol').eq('activo', true).order('nombre'), 'cargar empleados'),
        ejecutarConsulta(
            db.from('movimientos_tesoreria')
                .select('*, empresas(nombre), cuentas_bancarias(alias, moneda), beneficiarios(nombre), categorias_gasto(nombre)')
                .order('fecha_balde', { ascending: false })
                .order('fecha_cobro', { ascending: false }),
            'cargar movimientos'
        ),
        ejecutarConsulta(db.from('prestamos').select('*, empresas(nombre)').order('fecha_otorgamiento', { ascending: false }), 'cargar préstamos'),
        ejecutarConsulta(db.from('cuotas_prestamo').select('*').order('fecha_vencimiento'), 'cargar cuotas'),
        ejecutarConsulta(db.from('saldos_bancarios').select('*, cuentas_bancarias(alias, moneda, empresa_id)').order('fecha', { ascending: false }), 'cargar saldos')
    ]);

    empresas              = empData          || [];
    cuentas               = cuentasData      || [];
    categorias            = catData          || [];
    beneficiarios         = benData          || [];
    contratistasTesoreria = contratistasData || [];
    empleadosTesoreria    = empleadosData    || [];
    movimientosTesoreria  = movData          || [];
    prestamos             = prestData        || [];
    cuotas                = cuotasData       || [];
    saldosBancarios       = saldosData       || [];

    poblarSelectEmpresa();
    poblarSelectCuentasConciliacion();
    renderizarTodo();
}

// ==============================================
// SELECTOR DE EMPRESA
// ==============================================

function poblarSelectEmpresa() {
    const select = document.getElementById('select-empresa');
    if (!select) return;

    select.innerHTML = empresas.map(e =>
        `<option value="${e.id}">${e.nombre}</option>`
    ).join('');

    // Usar la empresa guardada en sessionStorage o la primera
    const guardada = sessionStorage.getItem('tesoreria_empresa_id');
    if (guardada && empresas.find(e => e.id === guardada)) {
        select.value = guardada;
        empresaActivaId = guardada;
    } else if (empresas.length > 0) {
        empresaActivaId = empresas[0].id;
        select.value = empresaActivaId;
    }
}

function cambiarEmpresa(id) {
    empresaActivaId = id;
    sessionStorage.setItem('tesoreria_empresa_id', id);
    renderizarTodo();
}

function renderizarTodo() {
    renderizarDashboard();
    renderizarMovimientos();
    renderizarPrestamos();
    poblarSelectCuentasConciliacion();
}

// ==============================================
// TABS
// ==============================================

function cambiarTabTesoreria(tab) {
    document.querySelectorAll('.tesoreria-tab').forEach(t => t.classList.remove('activo'));
    document.querySelectorAll('.tesoreria-seccion').forEach(s => s.classList.remove('activa'));

    const tabs = document.querySelectorAll('.tesoreria-tab');
    const orden = ['dashboard', 'movimientos', 'prestamos', 'conciliacion', 'reporte', 'sync'];
    const idx = orden.indexOf(tab);
    if (idx >= 0) tabs[idx].classList.add('activo');
    document.getElementById(`seccion-${tab}`)?.classList.add('activa');
    // Renderizar contenido lazy de la tab Sheets
    if (tab === 'sync') renderizarSync();
}

// ==============================================
// DASHBOARD
// ==============================================

function renderizarDashboard() {
    if (!empresaActivaId) return;

    renderizarSaldoBanco();
    renderizarCards();
    renderizarTimeline();
}

function renderizarSaldoBanco() {
    const cuentasEmpresa = cuentas.filter(c => c.empresa_id === empresaActivaId && c.moneda === 'ARS');
    const idsCuentas = cuentasEmpresa.map(c => c.id);

    // Último saldo ARS de esta empresa
    const saldo = saldosBancarios.find(s => idsCuentas.includes(s.cuenta_bancaria_id));

    const textoFecha = document.getElementById('saldo-fecha-texto');
    const textoMonto = document.getElementById('saldo-banco-monto');

    if (saldo) {
        textoFecha.textContent = `Saldo al ${formatearFecha(saldo.fecha)}`;
        textoMonto.textContent = `$ ${formatearNumero(saldo.saldo)}`;
    } else {
        textoFecha.textContent = 'Sin saldo cargado — ingresá el saldo del banco';
        textoMonto.textContent = '—';
    }
}

function renderizarCards() {
    const container = document.getElementById('tesoreria-cards');
    if (!container) return;

    const pendientes = movimientosTesoreria.filter(m =>
        m.empresa_id === empresaActivaId && m.estado === 'pendiente'
    );

    const totalCheques       = pendientes.filter(m => m.tipo === 'cheque').reduce((s, m) => s + Number(m.monto), 0);
    const totalTransferencias = pendientes.filter(m => m.tipo === 'transferencia').reduce((s, m) => s + Number(m.monto), 0);
    const totalPendiente     = totalCheques + totalTransferencias;

    // Cuotas ARS pendientes de esta empresa
    const prestamosEmpresa = prestamos.filter(p => p.empresa_id === empresaActivaId && p.estado === 'vigente');
    const idsPrestamos     = prestamosEmpresa.map(p => p.id);
    const cuotasPendientes  = cuotas.filter(c => idsPrestamos.includes(c.prestamo_id) && c.estado === 'pendiente' && c.moneda === 'ARS');
    const totalCuotasARS   = cuotasPendientes.reduce((s, c) => s + Number(c.monto_total), 0);

    const totalEgresos = totalPendiente + totalCuotasARS;

    // Saldo real = saldo banco - todos los egresos pendientes ARS
    const cuentasEmpresa = cuentas.filter(c => c.empresa_id === empresaActivaId && c.moneda === 'ARS');
    const idsCuentas = cuentasEmpresa.map(c => c.id);
    const saldo = saldosBancarios.find(s => idsCuentas.includes(s.cuenta_bancaria_id));
    const saldoBanco = saldo ? Number(saldo.saldo) : null;
    const saldoReal  = saldoBanco !== null ? saldoBanco - totalEgresos : null;

    const claseSaldoReal = saldoReal === null ? '' :
                           saldoReal >= 0      ? 'positivo' : 'negativo';

    container.innerHTML = `
        <div class="tesoreria-card card-saldo-real">
            <div class="tesoreria-card-label">Saldo real (ARS)</div>
            <div class="tesoreria-card-valor ${claseSaldoReal}">
                ${saldoReal !== null ? '$ ' + formatearNumero(saldoReal) : '—'}
            </div>
            <div class="tesoreria-card-sub">Saldo banco menos todos los egresos pendientes</div>
        </div>
        <div class="tesoreria-card">
            <div class="tesoreria-card-label">Cheques pendientes</div>
            <div class="tesoreria-card-valor advertencia">$ ${formatearNumero(totalCheques)}</div>
            <div class="tesoreria-card-sub">${pendientes.filter(m => m.tipo === 'cheque').length} cheque${pendientes.filter(m => m.tipo === 'cheque').length !== 1 ? 's' : ''}</div>
        </div>
        <div class="tesoreria-card">
            <div class="tesoreria-card-label">Transferencias pendientes</div>
            <div class="tesoreria-card-valor advertencia">$ ${formatearNumero(totalTransferencias)}</div>
            <div class="tesoreria-card-sub">${pendientes.filter(m => m.tipo === 'transferencia').length} a arrendadores</div>
        </div>
        <div class="tesoreria-card">
            <div class="tesoreria-card-label">Cuotas pendientes (ARS)</div>
            <div class="tesoreria-card-valor advertencia">$ ${formatearNumero(totalCuotasARS)}</div>
            <div class="tesoreria-card-sub">${cuotasPendientes.length} cuota${cuotasPendientes.length !== 1 ? 's' : ''} de préstamos</div>
        </div>
    `;
}

function renderizarTimeline() {
    const container = document.getElementById('timeline-baldes');
    if (!container) return;

    // Generar los próximos 10 baldes desde hoy
    // Usamos componentes locales para evitar desfase UTC (Argentina = UTC-3)
    const hoyLocal = new Date();
    const hoyStr2  = `${hoyLocal.getFullYear()}-${String(hoyLocal.getMonth()+1).padStart(2,'0')}-${String(hoyLocal.getDate()).padStart(2,'0')}`;
    const baldes   = [];

    // Primer balde = balde del día de hoy
    let baldeActual = calcularFechaBaldeJS(hoyStr2);

    // Generar 10 baldes hacia adelante (de a 5 días)
    for (let i = 0; i < 10; i++) {
        baldes.push(baldeActual);
        // Avanzar 5 días usando T12:00:00 para no caer en el borde UTC
        const next = new Date(baldeActual + 'T12:00:00');
        next.setDate(next.getDate() + 5);
        baldeActual = `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
    }

    // Egresos pendientes de esta empresa
    const pendientes = movimientosTesoreria.filter(m =>
        m.empresa_id === empresaActivaId && m.estado === 'pendiente'
    );
    const prestamosEmpresa = prestamos.filter(p => p.empresa_id === empresaActivaId && p.estado === 'vigente');
    const idsPrestamos = prestamosEmpresa.map(p => p.id);
    const cuotasPend = cuotas.filter(c => idsPrestamos.includes(c.prestamo_id) && c.estado === 'pendiente' && c.moneda === 'ARS');

    // Calcular saldo banco
    const cuentasEmpresa = cuentas.filter(c => c.empresa_id === empresaActivaId && c.moneda === 'ARS');
    const idsCuentas = cuentasEmpresa.map(c => c.id);
    const saldoObj = saldosBancarios.find(s => idsCuentas.includes(s.cuenta_bancaria_id));
    const saldoBanco = saldoObj ? Number(saldoObj.saldo) : null;

    // Monto máximo para escalar barras
    let saldoAcumulado = saldoBanco;
    const montoMax = Math.max(
        ...baldes.map(b => {
            const mov = pendientes.filter(m => m.fecha_balde === b);
            const cuo = cuotasPend.filter(c => c.fecha_balde === b);
            return mov.reduce((s, m) => s + Number(m.monto), 0) +
                   cuo.reduce((s, c) => s + Number(c.monto_total), 0);
        }),
        1
    );

    const baldeHoy = calcularFechaBaldeJS(hoyStr2);

    container.innerHTML = baldes.map(balde => {
        const movBalde   = pendientes.filter(m => m.fecha_balde === balde);
        const cuoBalde   = cuotasPend.filter(c => c.fecha_balde === balde);
        const totalBalde = movBalde.reduce((s, m) => s + Number(m.monto), 0) +
                           cuoBalde.reduce((s, c) => s + Number(c.monto_total), 0);

        const cantCheques = movBalde.filter(m => m.tipo === 'cheque').length;
        const cantTransf  = movBalde.filter(m => m.tipo === 'transferencia').length;
        const cantCuotas  = cuoBalde.length;

        const porcentaje = Math.min((totalBalde / montoMax) * 100, 100);
        const esBaldehoy = balde === baldeHoy;

        // Descuento acumulado para saber si hay faltante
        if (saldoAcumulado !== null) saldoAcumulado -= totalBalde;
        const hayFaltante = saldoAcumulado !== null && saldoAcumulado < 0;

        return `
        <div class="balde-item ${esBaldehoy ? 'balde-hoy' : ''} ${hayFaltante && totalBalde > 0 ? 'balde-faltante' : ''}">
            <div class="balde-fecha">
                ${formatearFechaCorta(balde)}
                ${esBaldehoy ? '<span class="balde-fecha-hoy-label">← hoy</span>' : ''}
            </div>
            <div class="balde-barra-wrap">
                <div class="balde-barra" style="width:${totalBalde > 0 ? porcentaje : 0}%"></div>
            </div>
            <div class="balde-desglose">
                ${cantCheques > 0    ? `<span>✓ ${cantCheques} cheque${cantCheques > 1 ? 's' : ''}</span>` : ''}
                ${cantTransf > 0     ? `<span>→ ${cantTransf} transf.</span>` : ''}
                ${cantCuotas > 0     ? `<span>🏦 ${cantCuotas} cuota${cantCuotas > 1 ? 's' : ''}</span>` : ''}
                ${totalBalde === 0   ? `<span style="color:var(--color-texto-tenue);">Sin vencimientos</span>` : ''}
            </div>
            <div class="balde-monto">
                ${totalBalde > 0 ? '$ ' + formatearNumero(totalBalde) : '—'}
            </div>
        </div>
        `;
    }).join('');
}

// ==============================================
// MOVIMIENTOS — Renderizar agrupado por balde
// ==============================================

function renderizarMovimientos() {
    const container   = document.getElementById('lista-movimientos');
    const contador    = document.getElementById('contador-movimientos');
    const usuario     = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);
    if (!container) return;

    // Aplicar filtros
    const filtroEstado    = document.getElementById('filtro-estado')?.value    || '';
    const filtroTipo      = document.getElementById('filtro-tipo')?.value      || '';
    const filtroDesde     = document.getElementById('filtro-desde')?.value     || '';
    const filtroHasta     = document.getElementById('filtro-hasta')?.value     || '';
    const filtroBusqueda  = document.getElementById('filtro-busqueda')?.value.toLowerCase().trim() || '';

    let filtrados = movimientosTesoreria.filter(m => {
        if (m.empresa_id !== empresaActivaId) return false;
        if (filtroEstado && m.estado !== filtroEstado) return false;
        if (filtroTipo   && m.tipo   !== filtroTipo)   return false;
        if (filtroDesde  && m.fecha_cobro < filtroDesde) return false;
        if (filtroHasta  && m.fecha_cobro > filtroHasta) return false;
        if (filtroBusqueda) {
            const benNombre = m.beneficiarios?.nombre?.toLowerCase() || '';
            const nroCheque = m.numero_cheque?.toLowerCase() || '';
            if (!benNombre.includes(filtroBusqueda) && !nroCheque.includes(filtroBusqueda)) return false;
        }
        return true;
    });

    if (contador) contador.textContent = `${filtrados.length} movimiento${filtrados.length !== 1 ? 's' : ''}`;

    if (filtrados.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:var(--espacio-xl);color:var(--color-texto-tenue);">
                No hay movimientos con los filtros seleccionados.
            </div>
        `;
        return;
    }

    // Agrupar por fecha_balde
    const grupos = {};
    filtrados.forEach(m => {
        const k = m.fecha_balde;
        if (!grupos[k]) grupos[k] = [];
        grupos[k].push(m);
    });

    // Ordenar baldes de más reciente a más antiguo
    const baldesOrdenados = Object.keys(grupos).sort((a, b) => b.localeCompare(a));

    container.innerHTML = baldesOrdenados.map(balde => {
        const movs       = grupos[balde];
        const totalBalde = movs.reduce((s, m) => s + Number(m.monto), 0);

        const filas = movs.map(m => {
            const badgeTipo  = m.tipo === 'cheque'
                ? `<span class="badge badge-cheque">Cheque</span>`
                : `<span class="badge badge-transferencia">Transferencia</span>`;
            const badgeEstado = m.estado === 'pendiente'
                ? `<span class="badge badge-pendiente-pago">Pendiente</span>`
                : m.estado === 'cobrado'
                    ? `<span class="badge badge-cobrado">Cobrado</span>`
                    : `<span class="badge badge-anulado">Anulado</span>`;

            return `
            <tr>
                <td>${formatearFecha(m.fecha_cobro)}</td>
                <td>${badgeTipo}</td>
                <td>${m.numero_cheque ? `<span style="font-family:var(--fuente-mono);font-size:var(--texto-sm);">${m.numero_cheque}</span>` : '—'}</td>
                <td><strong>${m.beneficiarios?.nombre || '—'}</strong></td>
                <td>${m.categorias_gasto?.nombre || '—'}</td>
                <td style="font-weight:600;font-family:var(--fuente-mono);">$ ${formatearNumero(m.monto)}</td>
                <td>${badgeEstado}</td>
                <td>
                    <div class="tabla-acciones">
                        ${puedeEditar && m.estado === 'pendiente' ? `
                            <button class="tabla-btn" style="color:var(--color-verde);" onclick="marcarCobrado('${m.id}')" title="Marcar como cobrado">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="20 6 9 17 4 12"/></svg>
                            </button>
                        ` : ''}
                        ${puedeEditar ? `
                            <button class="tabla-btn" onclick="editarMovimiento('${m.id}')" title="Editar">${ICONOS.editar}</button>
                            ${m.estado !== 'anulado' ? `<button class="tabla-btn btn-eliminar" onclick="confirmarAnularMovimiento('${m.id}')" title="Anular">${ICONOS.eliminar}</button>` : ''}
                        ` : ''}
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        return `
        <div class="grupo-balde">
            <div class="grupo-balde-header">
                <span class="grupo-balde-fecha">Balde ${formatearFecha(balde)}</span>
                <span class="grupo-balde-total">${movs.length} movimiento${movs.length !== 1 ? 's' : ''} — <strong>$ ${formatearNumero(totalBalde)}</strong></span>
            </div>
            <div class="tabla-contenedor" style="overflow-x:auto;">
                <table class="tabla" style="min-width:900px;">
                    <thead>
                        <tr>
                            <th>Fecha cobro</th>
                            <th>Tipo</th>
                            <th>Nro. cheque</th>
                            <th>Beneficiario</th>
                            <th>Categoría</th>
                            <th>Monto</th>
                            <th>Estado</th>
                            <th style="width:100px;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>
        </div>
        `;
    }).join('');
}

function limpiarFiltros() {
    document.getElementById('filtro-estado').value    = 'pendiente';
    document.getElementById('filtro-tipo').value      = '';
    document.getElementById('filtro-desde').value     = '';
    document.getElementById('filtro-hasta').value     = '';
    document.getElementById('filtro-busqueda').value  = '';
    renderizarMovimientos();
}

// ==============================================
// CHEQUES — Modal y CRUD
// ==============================================

function abrirModalCheque(datos = {}) {
    chequeEditandoId = datos.id || null;

    // Solo cuentas ARS de la empresa activa
    const cuentasEmpresa = cuentas.filter(c =>
        c.empresa_id === empresaActivaId && c.moneda === 'ARS' && c.activa
    );
    const opcionesCuentas = cuentasEmpresa.map(c =>
        `<option value="${c.id}" ${datos.cuenta_bancaria_id === c.id ? 'selected' : ''}>${c.alias || c.banco}</option>`
    ).join('');

    const opcionesCat = categorias.map(c =>
        `<option value="${c.id}" ${datos.categoria_id === c.id ? 'selected' : ''}>${c.nombre}</option>`
    ).join('');

    // Pre-cargar beneficiario si estamos editando
    const benActual   = beneficiarios.find(b => b.id === datos.beneficiario_id);
    const tipoPresel  = benActual?.tipo || 'contratista';
    const contrPresel = benActual?.contratista_id || '';
    const emplPresel  = benActual?.empleado_id    || '';
    const otroNombre  = (tipoPresel === 'otro' ? benActual?.nombre : '') || '';
    const otroCuit    = (tipoPresel === 'otro' ? benActual?.cuit   : '') || '';

    const opcionesContr = contratistasTesoreria.map(c =>
        `<option value="${c.id}" ${contrPresel === c.id ? 'selected' : ''}>${c.nombre}${c.especialidad ? ' — ' + c.especialidad : ''}</option>`
    ).join('');
    const opcionesEmpl = empleadosTesoreria.map(e =>
        `<option value="${e.id}" ${emplPresel === e.id ? 'selected' : ''}>${e.nombre}</option>`
    ).join('');

    const hoyLocal = new Date();
    const hoy = `${hoyLocal.getFullYear()}-${String(hoyLocal.getMonth()+1).padStart(2,'0')}-${String(hoyLocal.getDate()).padStart(2,'0')}`;

    const contenido = `
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Cuenta bancaria <span class="campo-requerido">*</span></label>
                <select id="campo-cuenta" class="campo-select">
                    <option value="">Seleccionar...</option>
                    ${opcionesCuentas}
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Nro. de cheque <span class="campo-requerido">*</span></label>
                <input type="text" id="campo-nro-cheque" class="campo-input"
                    value="${datos.numero_cheque || ''}"
                    placeholder="Ej: 00012345">
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Fecha de emisión <span class="campo-requerido">*</span></label>
                <input type="date" id="campo-fecha-emision" class="campo-input"
                    value="${datos.fecha_emision || hoy}">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Fecha de cobro <span class="campo-requerido">*</span></label>
                <input type="date" id="campo-fecha-cobro" class="campo-input"
                    value="${datos.fecha_cobro || ''}"
                    oninput="actualizarHintBalde(this.value)"
                    onchange="actualizarHintBalde(this.value)">
                <div class="balde-hint" id="hint-balde">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span id="hint-balde-texto"></span>
                </div>
            </div>
        </div>

        <!-- ── Beneficiario inline ── -->
        <div style="border:1px solid var(--color-borde);border-radius:var(--radio-md);padding:var(--espacio-md);margin-bottom:var(--espacio-md);">
            <div style="font-size:var(--texto-sm);font-weight:600;color:var(--color-texto-secundario);margin-bottom:var(--espacio-sm);">BENEFICIARIO</div>
            <div class="campos-fila">
                <div class="campo-grupo">
                    <label class="campo-label">Tipo</label>
                    <select id="ben-tipo" class="campo-select" onchange="actualizarFormBeneficiario(this.value)">
                        <option value="contratista" ${tipoPresel === 'contratista' ? 'selected' : ''}>Contratista</option>
                        <option value="empleado"    ${tipoPresel === 'empleado'    ? 'selected' : ''}>Empleado</option>
                        <option value="otro"        ${tipoPresel === 'otro'        ? 'selected' : ''}>Otro</option>
                    </select>
                </div>
                <!-- Contratista -->
                <div class="campo-grupo" id="ben-grupo-contratista" style="${tipoPresel !== 'contratista' ? 'display:none' : ''}">
                    <label class="campo-label">Contratista</label>
                    <select id="ben-contratista" class="campo-select">
                        <option value="">Seleccionar...</option>
                        ${opcionesContr}
                    </select>
                </div>
                <!-- Empleado -->
                <div class="campo-grupo" id="ben-grupo-empleado" style="${tipoPresel !== 'empleado' ? 'display:none' : ''}">
                    <label class="campo-label">Empleado</label>
                    <select id="ben-empleado" class="campo-select">
                        <option value="">Seleccionar...</option>
                        ${opcionesEmpl}
                    </select>
                </div>
            </div>
            <!-- Otro: nombre + CUIT -->
            <div id="ben-grupo-otro" style="${tipoPresel !== 'otro' ? 'display:none' : ''}">
                <div class="campos-fila">
                    <div class="campo-grupo">
                        <label class="campo-label">Nombre / Razón social</label>
                        <input type="text" id="ben-otro-nombre" class="campo-input"
                            value="${otroNombre}" placeholder="Ej: Agro Servicios SRL">
                    </div>
                    <div class="campo-grupo">
                        <label class="campo-label">CUIT (opcional)</label>
                        <input type="text" id="ben-otro-cuit" class="campo-input"
                            value="${otroCuit}" placeholder="Ej: 20-12345678-9">
                    </div>
                </div>
            </div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Categoría</label>
            <select id="campo-categoria" class="campo-select">
                <option value="">Seleccionar...</option>
                ${opcionesCat}
            </select>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Monto (ARS) <span class="campo-requerido">*</span></label>
            <input type="number" id="campo-monto" class="campo-input"
                value="${datos.monto || ''}"
                placeholder="Monto en pesos" step="0.01" min="0.01">
            <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);margin-top:2px;">Siempre en pesos argentinos — no hay cheques en dólares.</div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Notas</label>
            <input type="text" id="campo-notas" class="campo-input"
                value="${datos.notas || ''}"
                placeholder="Observaciones opcionales">
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarCheque()">
            ${chequeEditandoId ? 'Guardar cambios' : 'Registrar cheque'}
        </button>
    `;

    abrirModal(chequeEditandoId ? 'Editar cheque' : 'Cargar cheque', contenido, footer);

    // Si hay fecha de cobro ya cargada, mostrar hint
    if (datos.fecha_cobro) actualizarHintBalde(datos.fecha_cobro);
}

function editarMovimiento(id) {
    const m = movimientosTesoreria.find(x => x.id === id);
    if (!m) { mostrarError('No se encontró el movimiento.'); return; }
    if (m.tipo === 'transferencia') {
        mostrarAlerta('Las transferencias se generan desde el módulo de Movimientos.');
        return;
    }
    abrirModalCheque(m);
}

// Muestra en tiempo real a qué balde pertenece la fecha ingresada
function actualizarHintBalde(fechaStr) {
    const hint      = document.getElementById('hint-balde');
    const hintTexto = document.getElementById('hint-balde-texto');
    if (!hint || !hintTexto || !fechaStr) return;

    // Validar que el día termine en 0 o 5
    const dia = parseInt(fechaStr.split('-')[2]);
    if (dia % 5 !== 0) {
        hint.classList.add('visible');
        hint.classList.add('balde-hint-error');
        hintTexto.textContent = `⚠️ La fecha de cobro debe terminar en 0 o 5 (día ${dia} no es válido). Usá: ${obtenerFechasBalde(fechaStr)}`;
        return;
    }

    const balde = calcularFechaBaldeJS(fechaStr);
    hint.classList.add('visible');
    hint.classList.remove('balde-hint-error');
    hintTexto.textContent = `Este cheque se agrupa al balde del ${formatearFecha(balde)}`;
}

// Sugiere las fechas válidas más cercanas
function obtenerFechasBalde(fechaStr) {
    const fecha = new Date(fechaStr + 'T12:00:00');
    const dia = fecha.getDate();
    const resto = dia % 5;
    const anterior = new Date(fecha);
    anterior.setDate(dia - resto);
    const siguiente = new Date(anterior);
    siguiente.setDate(anterior.getDate() + 5);
    return `${formatearFecha(anterior.toISOString().split('T')[0])} o ${formatearFecha(siguiente.toISOString().split('T')[0])}`;
}

async function guardarCheque() {
    const cuentaId   = document.getElementById('campo-cuenta')?.value;
    const nroCheque  = document.getElementById('campo-nro-cheque')?.value.trim();
    const fechaEmis  = document.getElementById('campo-fecha-emision')?.value;
    const fechaCobro = document.getElementById('campo-fecha-cobro')?.value;
    const monto      = document.getElementById('campo-monto')?.value;

    if (!cuentaId)   { mostrarError('Seleccioná la cuenta bancaria.'); return; }
    if (!nroCheque)  { mostrarError('El número de cheque es obligatorio.'); return; }
    if (!fechaEmis)  { mostrarError('La fecha de emisión es obligatoria.'); return; }
    if (!fechaCobro) { mostrarError('La fecha de cobro es obligatoria.'); return; }

    const dia = parseInt(fechaCobro.split('-')[2]);
    if (dia % 5 !== 0) {
        mostrarError('La fecha de cobro debe terminar en 0 o 5 (ej: 05, 10, 15, 20, 25, 30).');
        return;
    }

    if (!monto || parseFloat(monto) <= 0) { mostrarError('Ingresá el monto del cheque.'); return; }

    // ── Resolver beneficiario inline ──────────────────────────────
    const benTipo = document.getElementById('ben-tipo')?.value || 'contratista';
    let beneficiarioId = null;

    if (benTipo === 'contratista') {
        const contrId = document.getElementById('ben-contratista')?.value;
        if (contrId) {
            // Buscar si ya existe un beneficiario para este contratista
            let benExist = beneficiarios.find(b => b.contratista_id === contrId);
            if (!benExist) {
                const contr = contratistasTesoreria.find(c => c.id === contrId);
                const nuevo = await ejecutarConsulta(
                    db.from('beneficiarios').insert({
                        nombre: contr?.nombre || 'Contratista',
                        tipo: 'contratista',
                        contratista_id: contrId
                    }).select(),
                    'crear beneficiario contratista'
                );
                if (nuevo?.[0]) { beneficiarios.push(nuevo[0]); benExist = nuevo[0]; }
            }
            beneficiarioId = benExist?.id || null;
        }
    } else if (benTipo === 'empleado') {
        const emplId = document.getElementById('ben-empleado')?.value;
        if (emplId) {
            let benExist = beneficiarios.find(b => b.empleado_id === emplId);
            if (!benExist) {
                const empl = empleadosTesoreria.find(e => e.id === emplId);
                const nuevo = await ejecutarConsulta(
                    db.from('beneficiarios').insert({
                        nombre: empl?.nombre || 'Empleado',
                        tipo: 'empleado',
                        empleado_id: emplId
                    }).select(),
                    'crear beneficiario empleado'
                );
                if (nuevo?.[0]) { beneficiarios.push(nuevo[0]); benExist = nuevo[0]; }
            }
            beneficiarioId = benExist?.id || null;
        }
    } else {
        // Otro: nombre + cuit libre
        const otroNombre = document.getElementById('ben-otro-nombre')?.value.trim();
        const otroCuit   = document.getElementById('ben-otro-cuit')?.value.trim();
        if (otroNombre) {
            let benExist = beneficiarios.find(b =>
                b.tipo === 'otro' && b.nombre?.toLowerCase() === otroNombre.toLowerCase()
            );
            if (!benExist) {
                const nuevo = await ejecutarConsulta(
                    db.from('beneficiarios').insert({
                        nombre: otroNombre,
                        tipo: 'otro',
                        cuit: otroCuit || null
                    }).select(),
                    'crear beneficiario otro'
                );
                if (nuevo?.[0]) { beneficiarios.push(nuevo[0]); benExist = nuevo[0]; }
            }
            beneficiarioId = benExist?.id || null;
        }
    }
    // ─────────────────────────────────────────────────────────────

    const datos = {
        empresa_id:         empresaActivaId,
        cuenta_bancaria_id: cuentaId,
        tipo:               'cheque',
        numero_cheque:      nroCheque,
        fecha_emision:      fechaEmis,
        fecha_cobro:        fechaCobro,
        fecha_balde:        calcularFechaBaldeJS(fechaCobro),
        beneficiario_id:    beneficiarioId,
        categoria_id:       document.getElementById('campo-categoria')?.value || null,
        monto:              parseFloat(monto),
        notas:              document.getElementById('campo-notas')?.value.trim() || null,
        origen:             'manual'
    };

    let resultado;
    if (chequeEditandoId) {
        resultado = await ejecutarConsulta(
            db.from('movimientos_tesoreria').update(datos).eq('id', chequeEditandoId),
            'actualizar cheque'
        );
    } else {
        resultado = await ejecutarConsulta(
            db.from('movimientos_tesoreria').insert(datos),
            'registrar cheque'
        );
    }

    if (resultado === undefined) return;
    cerrarModal();
    mostrarExito(chequeEditandoId ? 'Cheque actualizado' : 'Cheque registrado');
    chequeEditandoId = null;
    await cargarTesoreria();
}

async function marcarCobrado(id) {
    const hoy = new Date().toISOString().split('T')[0];
    const r = await ejecutarConsulta(
        db.from('movimientos_tesoreria').update({ estado: 'cobrado', fecha_cobrado_real: hoy }).eq('id', id),
        'marcar como cobrado'
    );
    if (r !== undefined) {
        mostrarExito('Marcado como cobrado');
        await cargarTesoreria();
    }
}

function confirmarAnularMovimiento(id) {
    window.__idEliminar = id;
    abrirModal('Confirmar anulación',
        `<p style="font-size:var(--texto-lg);color:var(--color-texto);">¿Anular este movimiento?</p>
         <p style="font-size:var(--texto-sm);color:var(--color-texto-secundario);">Quedará marcado como anulado y no afectará el saldo real.</p>`,
        `<button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
         <button class="btn-peligro" onclick="cerrarModal(); anularMovimiento(window.__idEliminar)">Sí, anular</button>`
    );
}

async function anularMovimiento(id) {
    const r = await ejecutarConsulta(
        db.from('movimientos_tesoreria').update({ estado: 'anulado' }).eq('id', id),
        'anular movimiento'
    );
    if (r !== undefined) { mostrarExito('Movimiento anulado'); await cargarTesoreria(); }
}

// ==============================================
// BENEFICIARIOS — Modal rápido
// ==============================================

function abrirModalNuevoBeneficiario() {
    const opcionesContratistas = contratistasTesoreria.map(c =>
        `<option value="${c.id}">${c.nombre}${c.especialidad ? ' — ' + c.especialidad : ''}</option>`
    ).join('');

    const opcionesEmpleados = empleadosTesoreria.map(e =>
        `<option value="${e.id}">${e.nombre}${e.rol ? ' — ' + e.rol : ''}</option>`
    ).join('');

    const contenido = `
        <div class="campo-grupo">
            <label class="campo-label">Tipo <span class="campo-requerido">*</span></label>
            <select id="ben-tipo" class="campo-select" onchange="actualizarFormBeneficiario(this.value)">
                <option value="">Seleccionar...</option>
                <option value="contratista">Contratista</option>
                <option value="empleado">Empleado</option>
                <option value="otro">Otro (proveedor, banco, etc.)</option>
            </select>
        </div>

        <!-- Contratista: dropdown de contratistas cargados -->
        <div class="campo-grupo" id="ben-grupo-contratista" style="display:none;">
            <label class="campo-label">Contratista <span class="campo-requerido">*</span></label>
            <select id="ben-contratista" class="campo-select">
                <option value="">Seleccionar contratista...</option>
                ${opcionesContratistas}
            </select>
        </div>

        <!-- Empleado: dropdown de empleados activos -->
        <div class="campo-grupo" id="ben-grupo-empleado" style="display:none;">
            <label class="campo-label">Empleado <span class="campo-requerido">*</span></label>
            <select id="ben-empleado" class="campo-select">
                <option value="">Seleccionar empleado...</option>
                ${opcionesEmpleados}
            </select>
        </div>

        <!-- Otro: nombre libre + CUIT -->
        <div id="ben-grupo-otro" style="display:none;">
            <div class="campo-grupo">
                <label class="campo-label">Nombre <span class="campo-requerido">*</span></label>
                <input type="text" id="ben-nombre" class="campo-input" placeholder="Ej: Ferretería López, YPF, AFIP">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">CUIT</label>
                <input type="text" id="ben-cuit" class="campo-input" placeholder="XX-XXXXXXXX-X">
            </div>
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="abrirModalCheque()">Cancelar</button>
        <button class="btn-primario" onclick="guardarBeneficiario()">Crear beneficiario</button>
    `;

    abrirModal('Nuevo beneficiario', contenido, footer);
}

// Muestra/oculta los campos según el tipo de beneficiario
function actualizarFormBeneficiario(tipo) {
    document.getElementById('ben-grupo-contratista').style.display = tipo === 'contratista' ? '' : 'none';
    document.getElementById('ben-grupo-empleado').style.display    = tipo === 'empleado'    ? '' : 'none';
    document.getElementById('ben-grupo-otro').style.display        = tipo === 'otro'        ? '' : 'none';
}

async function guardarBeneficiario() {
    const tipo = document.getElementById('ben-tipo')?.value;
    if (!tipo) { mostrarError('Seleccioná el tipo de beneficiario.'); return; }

    let nombre        = null;
    let contratistaId = null;
    let empleadoId    = null;

    if (tipo === 'contratista') {
        contratistaId = document.getElementById('ben-contratista')?.value;
        if (!contratistaId) { mostrarError('Seleccioná el contratista.'); return; }
        const c = contratistasTesoreria.find(x => x.id === contratistaId);
        nombre = c?.nombre || '';
    } else if (tipo === 'empleado') {
        empleadoId = document.getElementById('ben-empleado')?.value;
        if (!empleadoId) { mostrarError('Seleccioná el empleado.'); return; }
        const e = empleadosTesoreria.find(x => x.id === empleadoId);
        nombre = e?.nombre || '';
    } else {
        nombre = document.getElementById('ben-nombre')?.value.trim();
        if (!nombre) { mostrarError('El nombre es obligatorio.'); return; }
    }

    const datos = {
        nombre,
        tipo,
        contratista_id: contratistaId || null,
        empleado_id:    empleadoId    || null,
        cuit:           tipo === 'otro' ? (document.getElementById('ben-cuit')?.value.trim() || null) : null
    };

    const resultado = await ejecutarConsulta(
        db.from('beneficiarios').insert(datos).select(),
        'crear beneficiario'
    );

    if (!resultado || resultado.length === 0) return;

    beneficiarios.push(resultado[0]);
    mostrarExito(`Beneficiario "${nombre}" creado`);
    abrirModalCheque(); // Volver al form de cheque
}

// ==============================================
// SALDO BANCARIO — Modal
// ==============================================

function abrirModalSaldo() {
    const cuentasEmpresa = cuentas.filter(c =>
        c.empresa_id === empresaActivaId && c.activa
    );
    const opcionesCuentas = cuentasEmpresa.map(c =>
        `<option value="${c.id}">${c.alias || c.banco} (${c.moneda})</option>`
    ).join('');

    const hoy = new Date().toISOString().split('T')[0];

    const contenido = `
        <div class="campo-grupo">
            <label class="campo-label">Cuenta bancaria <span class="campo-requerido">*</span></label>
            <select id="saldo-cuenta" class="campo-select">
                <option value="">Seleccionar...</option>
                ${opcionesCuentas}
            </select>
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Fecha <span class="campo-requerido">*</span></label>
                <input type="date" id="saldo-fecha" class="campo-input" value="${hoy}">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Saldo ($) <span class="campo-requerido">*</span></label>
                <input type="number" id="saldo-monto" class="campo-input" placeholder="Saldo actual del banco" step="0.01">
            </div>
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarSaldo()">Guardar saldo</button>
    `;

    abrirModal('Actualizar saldo bancario', contenido, footer);
}

async function guardarSaldo() {
    const cuentaId = document.getElementById('saldo-cuenta')?.value;
    const fecha    = document.getElementById('saldo-fecha')?.value;
    const saldo    = document.getElementById('saldo-monto')?.value;

    if (!cuentaId) { mostrarError('Seleccioná la cuenta.'); return; }
    if (!fecha)    { mostrarError('La fecha es obligatoria.'); return; }
    if (!saldo)    { mostrarError('Ingresá el saldo.'); return; }

    // Upsert: si ya hay saldo para esa cuenta y fecha, actualiza
    const resultado = await ejecutarConsulta(
        db.from('saldos_bancarios').upsert({
            cuenta_bancaria_id: cuentaId,
            fecha,
            saldo: parseFloat(saldo),
            origen: 'manual'
        }, { onConflict: 'cuenta_bancaria_id,fecha' }),
        'guardar saldo'
    );

    if (resultado === undefined) return;
    cerrarModal();
    mostrarExito('Saldo bancario actualizado');
    await cargarTesoreria();
}

// ==============================================
// PRÉSTAMOS — Renderizar
// ==============================================

function renderizarPrestamos() {
    const container = document.getElementById('lista-prestamos');
    const contador  = document.getElementById('contador-prestamos');
    const usuario   = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);
    if (!container) return;

    const prestamosEmpresa = prestamos.filter(p => p.empresa_id === empresaActivaId);

    if (contador) contador.textContent = `${prestamosEmpresa.length} préstamo${prestamosEmpresa.length !== 1 ? 's' : ''}`;

    if (prestamosEmpresa.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:var(--espacio-xl);color:var(--color-texto-tenue);">
                No hay préstamos registrados para esta empresa.
            </div>
        `;
        return;
    }

    container.innerHTML = prestamosEmpresa.map(p => {
        const cuotasP      = cuotas.filter(c => c.prestamo_id === p.id);
        const pendientesP  = cuotasP.filter(c => c.estado === 'pendiente');
        const montoPend    = pendientesP.reduce((s, c) => s + Number(c.monto_total), 0);

        const filasCuotas = cuotasP.map(c => {
            const badgeCuota = c.estado === 'pendiente'
                ? `<span class="badge badge-pendiente-pago">Pendiente</span>`
                : c.estado === 'pagada'
                    ? `<span class="badge badge-cobrado">Pagada</span>`
                    : `<span class="badge" style="background:rgba(201,76,76,0.15);color:var(--color-error);">Vencida</span>`;

            return `
            <tr>
                <td>Cuota ${c.numero_cuota}</td>
                <td>${formatearFecha(c.fecha_vencimiento)}</td>
                <td style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${formatearFecha(c.fecha_balde)}</td>
                <td>${c.moneda}</td>
                <td style="font-family:var(--fuente-mono);">$ ${formatearNumero(c.monto_total)}</td>
                <td>${badgeCuota}</td>
                <td>
                    ${puedeEditar && c.estado === 'pendiente' ? `
                    <button class="tabla-btn" style="color:var(--color-verde);" onclick="marcarCuotaPagada('${c.id}')" title="Marcar como pagada">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>` : ''}
                </td>
            </tr>
            `;
        }).join('');

        return `
        <div class="prestamo-card">
            <div class="prestamo-card-header" onclick="toggleCuotas('${p.id}')">
                <div class="prestamo-info">
                    <div class="prestamo-acreedor">${p.acreedor}</div>
                    <div class="prestamo-datos">
                        ${p.empresas?.nombre || ''} · ${p.moneda} · ${p.cantidad_cuotas} cuotas ·
                        Otorgado ${formatearFecha(p.fecha_otorgamiento)} ·
                        <span class="badge ${p.estado === 'vigente' ? 'badge-cobrado' : 'badge-anulado'}">${p.estado}</span>
                    </div>
                </div>
                <div class="prestamo-monto">
                    <div class="prestamo-monto-total">$ ${formatearNumero(p.monto_total)}</div>
                    <div class="prestamo-monto-pendiente">${montoPend > 0 ? '$ ' + formatearNumero(montoPend) + ' pendiente' : 'Al día ✓'}</div>
                </div>
                <svg class="prestamo-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;flex-shrink:0;"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div class="prestamo-cuotas" id="cuotas-${p.id}">
                <div class="tabla-contenedor" style="overflow-x:auto;">
                    <table class="tabla" style="min-width:650px;">
                        <thead>
                            <tr>
                                <th>Cuota</th>
                                <th>Vencimiento</th>
                                <th>Balde</th>
                                <th>Moneda</th>
                                <th>Monto</th>
                                <th>Estado</th>
                                <th style="width:60px;"></th>
                            </tr>
                        </thead>
                        <tbody>${filasCuotas}</tbody>
                    </table>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

function toggleCuotas(prestamoId) {
    const panel  = document.getElementById(`cuotas-${prestamoId}`);
    const header = panel?.previousElementSibling;
    if (!panel) return;
    const abierto = panel.classList.toggle('abierto');
    header?.classList.toggle('abierto', abierto);
}

// ==============================================
// PRÉSTAMOS — CRUD + generación de cuotas
// ==============================================

function abrirModalPrestamo() {
    prestamoEditandoId = null;

    const cuentasEmpresa = cuentas.filter(c => c.empresa_id === empresaActivaId && c.activa);
    const opcionesCuentas = cuentasEmpresa.map(c =>
        `<option value="${c.id}">${c.alias || c.banco} (${c.moneda})</option>`
    ).join('');

    const hoy = new Date().toISOString().split('T')[0];

    const contenido = `
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Acreedor <span class="campo-requerido">*</span></label>
                <input type="text" id="prest-acreedor" class="campo-input" placeholder="Ej: Banco Galicia, Banco Nación">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Moneda <span class="campo-requerido">*</span></label>
                <select id="prest-moneda" class="campo-select">
                    <option value="ARS">Pesos (ARS)</option>
                    <option value="USD">Dólares (USD)</option>
                </select>
            </div>
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Monto total <span class="campo-requerido">*</span></label>
                <input type="number" id="prest-monto" class="campo-input" placeholder="Monto total del préstamo" step="0.01" min="1">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Cantidad de cuotas <span class="campo-requerido">*</span></label>
                <input type="number" id="prest-cuotas" class="campo-input" placeholder="Ej: 12" min="1" max="360">
            </div>
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Fecha de otorgamiento <span class="campo-requerido">*</span></label>
                <input type="date" id="prest-fecha" class="campo-input" value="${hoy}">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Tasa de interés anual (%)</label>
                <input type="number" id="prest-tasa" class="campo-input" placeholder="Ej: 45 (opcional)" step="0.01" min="0">
            </div>
        </div>
        <div class="campo-grupo">
            <label class="campo-label">Cuenta bancaria asociada</label>
            <select id="prest-cuenta" class="campo-select">
                <option value="">Sin cuenta específica</option>
                ${opcionesCuentas}
            </select>
        </div>
        <div class="campo-grupo">
            <label class="campo-label">Notas</label>
            <input type="text" id="prest-notas" class="campo-input" placeholder="Condiciones, garantías u observaciones">
        </div>
        <div style="padding:var(--espacio-md);background:var(--color-fondo);border-radius:var(--radio-sm);font-size:var(--texto-sm);color:var(--color-texto-secundario);">
            💡 Al guardar, el sistema genera automáticamente las cuotas mensuales. Podés editarlas individualmente después.
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarPrestamo()">Registrar préstamo</button>
    `;

    abrirModal('Nuevo préstamo', contenido, footer);
}

async function guardarPrestamo() {
    const acreedor   = document.getElementById('prest-acreedor')?.value.trim();
    const moneda     = document.getElementById('prest-moneda')?.value;
    const monto      = parseFloat(document.getElementById('prest-monto')?.value);
    const cantCuotas = parseInt(document.getElementById('prest-cuotas')?.value);
    const fechaOtorg = document.getElementById('prest-fecha')?.value;
    const tasaInput  = document.getElementById('prest-tasa')?.value;
    const cuentaId   = document.getElementById('prest-cuenta')?.value || null;
    const notas      = document.getElementById('prest-notas')?.value.trim() || null;

    if (!acreedor)                  { mostrarError('El acreedor es obligatorio.'); return; }
    if (!monto || monto <= 0)       { mostrarError('Ingresá el monto total.'); return; }
    if (!cantCuotas || cantCuotas < 1) { mostrarError('La cantidad de cuotas debe ser al menos 1.'); return; }
    if (!fechaOtorg)                { mostrarError('La fecha de otorgamiento es obligatoria.'); return; }

    const tasa = tasaInput ? parseFloat(tasaInput) / 100 : 0;

    const datosPrestamo = {
        empresa_id:         empresaActivaId,
        cuenta_bancaria_id: cuentaId,
        acreedor,
        monto_total:        monto,
        moneda,
        fecha_otorgamiento: fechaOtorg,
        cantidad_cuotas:    cantCuotas,
        tasa_interes:       tasa || null,
        notas,
        estado:             'vigente'
    };

    const resPrestamo = await ejecutarConsulta(
        db.from('prestamos').insert(datosPrestamo).select(),
        'registrar préstamo'
    );

    if (!resPrestamo || resPrestamo.length === 0) return;
    const prestamoNuevo = resPrestamo[0];

    // Generar las cuotas automáticamente
    const cuotasGeneradas = generarCuotas(prestamoNuevo.id, monto, cantCuotas, tasa, fechaOtorg, moneda);

    const resCuotas = await ejecutarConsulta(
        db.from('cuotas_prestamo').insert(cuotasGeneradas),
        'generar cuotas'
    );

    if (resCuotas === undefined) return;

    cerrarModal();
    mostrarExito(`Préstamo registrado con ${cantCuotas} cuota${cantCuotas > 1 ? 's' : ''} generada${cantCuotas > 1 ? 's' : ''}`);
    await cargarTesoreria();
    // Abrir automáticamente las cuotas del préstamo nuevo
    setTimeout(() => toggleCuotas(prestamoNuevo.id), 400);
}

// Genera N cuotas mensuales con sistema francés simplificado
// Si no hay tasa, cuotas iguales de capital puro
function generarCuotas(prestamoId, montoTotal, cantCuotas, tasaAnual, fechaOtorg, moneda) {
    const cuotasArr = [];
    const fechaBase = new Date(fechaOtorg + 'T12:00:00');

    if (tasaAnual > 0) {
        // Sistema francés: cuota fija = P * i / (1 - (1+i)^-n)
        const tasaMensual = tasaAnual / 12;
        const cuotaFija = montoTotal * tasaMensual / (1 - Math.pow(1 + tasaMensual, -cantCuotas));
        let saldo = montoTotal;

        for (let i = 1; i <= cantCuotas; i++) {
            const fechaVenc = new Date(fechaBase);
            fechaVenc.setMonth(fechaBase.getMonth() + i);
            const fechaVencStr = fechaVenc.toISOString().split('T')[0];

            const interes  = saldo * tasaMensual;
            const capital  = cuotaFija - interes;
            saldo -= capital;

            cuotasArr.push({
                prestamo_id:       prestamoId,
                numero_cuota:      i,
                fecha_vencimiento: fechaVencStr,
                fecha_balde:       calcularFechaBaldeJS(fechaVencStr),
                monto_capital:     Math.round(capital * 100) / 100,
                monto_interes:     Math.round(interes * 100) / 100,
                monto_total:       Math.round(cuotaFija * 100) / 100,
                moneda,
                estado:            'pendiente'
            });
        }
    } else {
        // Sin tasa: cuotas iguales de capital
        const cuotaCapital = Math.round((montoTotal / cantCuotas) * 100) / 100;

        for (let i = 1; i <= cantCuotas; i++) {
            const fechaVenc = new Date(fechaBase);
            fechaVenc.setMonth(fechaBase.getMonth() + i);
            const fechaVencStr = fechaVenc.toISOString().split('T')[0];

            cuotasArr.push({
                prestamo_id:       prestamoId,
                numero_cuota:      i,
                fecha_vencimiento: fechaVencStr,
                fecha_balde:       calcularFechaBaldeJS(fechaVencStr),
                monto_capital:     cuotaCapital,
                monto_interes:     0,
                monto_total:       cuotaCapital,
                moneda,
                estado:            'pendiente'
            });
        }
    }

    return cuotasArr;
}

async function marcarCuotaPagada(cuotaId) {
    const hoy = new Date().toISOString().split('T')[0];
    const r = await ejecutarConsulta(
        db.from('cuotas_prestamo').update({ estado: 'pagada', fecha_pago_real: hoy }).eq('id', cuotaId),
        'marcar cuota como pagada'
    );
    if (r !== undefined) { mostrarExito('Cuota marcada como pagada'); await cargarTesoreria(); }
}

// ==============================================
// CONCILIACIÓN — Buscar por monto
// ==============================================

function buscarPorMonto(montoStr) {
    const container = document.getElementById('resultado-busqueda-monto');
    if (!container) return;

    const monto = parseFloat(montoStr);
    if (!monto || monto <= 0) { container.innerHTML = ''; return; }

    const encontrados = movimientosTesoreria.filter(m =>
        m.empresa_id === empresaActivaId &&
        m.estado === 'pendiente' &&
        Math.abs(Number(m.monto) - monto) < 0.01
    );

    if (encontrados.length === 0) {
        container.innerHTML = `
            <div style="padding:var(--espacio-md);color:var(--color-texto-tenue);font-size:var(--texto-sm);">
                No se encontró ningún cheque pendiente por $ ${formatearNumero(monto)}
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="tabla-contenedor" style="overflow-x:auto;">
            <table class="tabla" style="min-width:600px;">
                <thead>
                    <tr><th>Fecha cobro</th><th>Nro. cheque</th><th>Beneficiario</th><th>Monto</th><th></th></tr>
                </thead>
                <tbody>
                    ${encontrados.map(m => `
                        <tr>
                            <td>${formatearFecha(m.fecha_cobro)}</td>
                            <td>${m.numero_cheque || '—'}</td>
                            <td>${m.beneficiarios?.nombre || '—'}</td>
                            <td style="font-family:var(--fuente-mono);font-weight:600;">$ ${formatearNumero(m.monto)}</td>
                            <td>
                                <button class="btn-primario" style="padding:var(--espacio-xs) var(--espacio-md);font-size:var(--texto-sm);"
                                    onclick="marcarCobrado('${m.id}'); document.getElementById('buscar-monto-conciliacion').value=''; buscarPorMonto('');">
                                    Marcar cobrado ✓
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function poblarSelectCuentasConciliacion() {
    const select = document.getElementById('extracto-cuenta');
    if (!select) return;
    select.innerHTML = '<option value="">Seleccionar cuenta...</option>' +
        cuentas.map(c => `<option value="${c.id}">${c.empresas?.nombre || ''} — ${c.alias || c.banco} (${c.moneda})</option>`).join('');
}

// ==============================================
// CONCILIACIÓN CON PDF — Gemini 2.5 Flash
// ==============================================

async function procesarExtracto() {
    const cuentaId = document.getElementById('extracto-cuenta')?.value;
    const archivo  = document.getElementById('extracto-archivo')?.files[0];
    const contenedor = document.getElementById('resultado-extracto');

    if (!cuentaId) { mostrarError('Seleccioná la cuenta bancaria antes de procesar.'); return; }
    if (!archivo)  { mostrarError('Seleccioná un archivo PDF del extracto.'); return; }
    if (archivo.type !== 'application/pdf') { mostrarError('El archivo debe ser un PDF.'); return; }

    const geminiKey = window.__ENV__?.GEMINI_API_KEY;
    if (!geminiKey) {
        mostrarError('La API Key de Gemini no está configurada. Avisale al administrador.');
        return;
    }

    // Estado: procesando
    contenedor.innerHTML = `
        <div style="display:flex;align-items:center;gap:var(--espacio-md);color:var(--color-texto-secundario);padding:var(--espacio-lg);">
            <div class="spinner"></div>
            <div>
                <div style="font-weight:600;">Enviando extracto a Gemini...</div>
                <div style="font-size:var(--texto-sm);margin-top:4px;">Esto puede tardar hasta 30 segundos según el tamaño del PDF.</div>
            </div>
        </div>`;

    try {
        // Convertir PDF a base64
        const base64 = await leerArchivoBase64(archivo);

        // Llamar a Gemini con prompt específico para extracto bancario Galicia
        const movimientosBanco = await extraerMovimientosBanco(geminiKey, base64);

        if (!movimientosBanco || movimientosBanco.length === 0) {
            contenedor.innerHTML = `
                <div class="alerta alerta-advertencia">
                    Gemini no encontró movimientos en el PDF. Verificá que sea un extracto bancario válido del Galicia.
                </div>`;
            return;
        }

        // Guardar extracto en Supabase
        const extractoData = await ejecutarConsulta(
            db.from('extractos_bancarios').insert({
                cuenta_bancaria_id: cuentaId,
                tipo_archivo: 'pdf',
                archivo_url: archivo.name,
                estado_procesamiento: 'procesado',
                movimientos_detectados: movimientosBanco
            }).select(),
            'guardar extracto'
        );
        const extractoId = extractoData?.[0]?.id || null;

        // Cruzar con cheques pendientes de la cuenta
        const resultado = cruzarMovimientos(movimientosBanco, cuentaId, extractoId);

        // Mostrar resultados para revisión
        mostrarResultadoConciliacion(resultado, contenedor);

    } catch (error) {
        console.error('Error al procesar extracto:', error);
        contenedor.innerHTML = `
            <div class="alerta alerta-error">
                <strong>Error al procesar el PDF:</strong> ${error.message || 'Error desconocido.'} Probá con otro archivo o cargá el saldo manualmente.
            </div>`;
    }
}

// Convierte un archivo File a string base64
function leerArchivoBase64(archivo) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = e => resolve(e.target.result.split(',')[1]); // quitar prefijo data:...
        reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
        reader.readAsDataURL(archivo);
    });
}

// Llama a Gemini 2.5 Flash para extraer movimientos de un extracto bancario
async function extraerMovimientosBanco(apiKey, pdfBase64) {
    const prompt = `Analizá este extracto bancario del Banco Galicia de Argentina y extraé todos los movimientos en formato JSON estricto.

Reglas:
- Solo extraé movimientos reales (débitos y créditos), no datos del encabezado ni resúmenes.
- Para cada movimiento detectá: fecha, descripción, número de cheque (si lo dice), monto, y si es débito o crédito.
- Los débitos son egresos (pagos de cheques, transferencias salientes, comisiones).
- Los créditos son ingresos (depósitos, transferencias entrantes).
- Fechas en formato YYYY-MM-DD (ej: 2026-04-15).
- Montos siempre positivos como número (sin signo, sin puntos de miles, con punto decimal).
- Si el número de cheque no aparece en la descripción, poné null.
- No inventes datos. Si no podés leer algo con certeza, omitilo.

Formato de respuesta (SOLO el JSON, sin markdown, sin explicaciones, sin bloques de código):
[
  {
    "fecha": "2026-04-10",
    "descripcion": "Cheque propio 00012345",
    "numero_cheque": "00012345",
    "monto": 150000.00,
    "tipo": "debito"
  },
  {
    "fecha": "2026-04-11",
    "descripcion": "Transferencia recibida de AGD",
    "numero_cheque": null,
    "monto": 2500000.00,
    "tipo": "credito"
  }
]`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } }
                ]
            }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 8192,
                thinkingConfig: { thinkingBudget: 1024 }
            }
        })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `Error HTTP ${response.status}`);
    }

    const result = await response.json();

    // Gemini 2.5 Flash puede devolver varias parts (pensamiento + respuesta). Buscamos la última con texto.
    const parts = result.candidates?.[0]?.content?.parts || [];
    let texto = null;
    for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].text) { texto = parts[i].text; break; }
    }

    if (!texto) throw new Error('Gemini no devolvió texto en la respuesta.');

    // Limpiar posible markdown (```json ... ```)
    const limpio = texto.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    try {
        const datos = JSON.parse(limpio);
        return Array.isArray(datos) ? datos : [];
    } catch (e) {
        console.error('Respuesta de Gemini que no se pudo parsear:', texto);
        throw new Error('La respuesta de Gemini no tiene el formato esperado. Revisá la consola para más detalle.');
    }
}

// Cruza los movimientos del banco contra los cheques pendientes
function cruzarMovimientos(movimientosBanco, cuentaId, extractoId) {
    const chequesPendientes = movimientosTesoreria.filter(m =>
        m.cuenta_bancaria_id === cuentaId &&
        m.estado === 'pendiente'
    );

    const conciliados  = [];  // match automático confirmado
    const manuales     = [];  // match por monto (varios posibles)
    const sinMatch     = [];  // movimiento del banco sin cheque
    const chequesResto = [...chequesPendientes]; // los que quedan sin match

    // Solo procesamos débitos (los créditos no afectan cheques)
    const debitos = movimientosBanco.filter(m => m.tipo === 'debito');

    for (const debito of debitos) {
        // Intento 1: match por número de cheque
        if (debito.numero_cheque) {
            const idx = chequesResto.findIndex(c =>
                c.numero_cheque && c.numero_cheque.replace(/^0+/, '') === debito.numero_cheque.replace(/^0+/, '')
            );
            if (idx >= 0) {
                conciliados.push({ banco: debito, cheque: chequesResto[idx], metodo: 'numero' });
                chequesResto.splice(idx, 1);
                continue;
            }
        }

        // Intento 2: match por monto exacto (entre todos los pendientes de la cuenta)
        const porMonto = chequesResto.filter(c => Math.abs(Number(c.monto) - debito.monto) < 0.01);
        if (porMonto.length === 1) {
            conciliados.push({ banco: debito, cheque: porMonto[0], metodo: 'monto' });
            chequesResto.splice(chequesResto.indexOf(porMonto[0]), 1);
        } else if (porMonto.length > 1) {
            manuales.push({ banco: debito, candidatos: porMonto });
        } else {
            sinMatch.push(debito);
        }
    }

    return { conciliados, manuales, sinMatch, chequesResto, extractoId };
}

// Renderiza los resultados de la conciliación para revisión de Vale
function mostrarResultadoConciliacion(resultado, contenedor) {
    const { conciliados, manuales, sinMatch, chequesResto } = resultado;
    const total = conciliados.length + manuales.length + sinMatch.length;

    let html = `
        <div style="margin-bottom:var(--espacio-xl);">
            <div style="display:flex;gap:var(--espacio-md);flex-wrap:wrap;margin-bottom:var(--espacio-lg);">
                <div class="tesoreria-card" style="flex:1;min-width:140px;">
                    <div class="tesoreria-card-label">Débitos detectados</div>
                    <div class="tesoreria-card-valor">${total}</div>
                </div>
                <div class="tesoreria-card" style="flex:1;min-width:140px;">
                    <div class="tesoreria-card-label">Macheo automático</div>
                    <div class="tesoreria-card-valor positivo">${conciliados.length}</div>
                </div>
                <div class="tesoreria-card" style="flex:1;min-width:140px;">
                    <div class="tesoreria-card-label">Revisión manual</div>
                    <div class="tesoreria-card-valor advertencia">${manuales.length}</div>
                </div>
                <div class="tesoreria-card" style="flex:1;min-width:140px;">
                    <div class="tesoreria-card-label">Sin match</div>
                    <div class="tesoreria-card-valor ${sinMatch.length > 0 ? 'negativo' : ''}">${sinMatch.length}</div>
                </div>
            </div>`;

    // ── Matches automáticos ────────────────────────────────────
    if (conciliados.length > 0) {
        html += `
            <div style="margin-bottom:var(--espacio-lg);">
                <h4 style="font-size:var(--texto-base);color:var(--color-verde);margin-bottom:var(--espacio-md);display:flex;align-items:center;gap:var(--espacio-sm);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="20 6 9 17 4 12"/></svg>
                    Macheo automático (${conciliados.length}) — confirmá para marcar como cobrados
                </h4>
                <div class="tabla-contenedor">
                <table class="tabla">
                    <thead><tr>
                        <th>Fecha banco</th><th>Descripción</th><th>Nro. cheque</th>
                        <th>Monto banco</th><th>Cheque ERP</th><th>Beneficiario</th><th>Match por</th><th>Acción</th>
                    </tr></thead>
                    <tbody>
                    ${conciliados.map((c, i) => `
                        <tr>
                            <td>${c.banco.fecha}</td>
                            <td style="font-size:var(--texto-sm);max-width:200px;white-space:normal;">${c.banco.descripcion || '—'}</td>
                            <td style="font-family:var(--fuente-mono);">${c.banco.numero_cheque || '—'}</td>
                            <td style="font-family:var(--fuente-mono);font-weight:600;">$ ${formatearNumero(c.banco.monto)}</td>
                            <td style="font-family:var(--fuente-mono);">${c.cheque.numero_cheque || 'Transf.'}</td>
                            <td>${c.cheque.beneficiarios?.nombre || '—'}</td>
                            <td><span class="badge ${c.metodo === 'numero' ? 'badge-cobrado' : 'badge-transferencia'}">${c.metodo === 'numero' ? 'N° cheque' : 'Monto'}</span></td>
                            <td>
                                <button class="btn-primario" style="padding:var(--espacio-xs) var(--espacio-md);font-size:var(--texto-sm);"
                                    onclick="confirmarConciliacion('${c.cheque.id}', '${c.banco.fecha}', this)">
                                    Confirmar ✓
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                    </tbody>
                </table>
                </div>
                <div style="margin-top:var(--espacio-md);">
                    <button class="btn-primario" onclick="confirmarTodosConciliados(${JSON.stringify(conciliados.map(c => ({ chequeId: c.cheque.id, fecha: c.banco.fecha }))).replace(/"/g, '&quot;')})">
                        Confirmar todos (${conciliados.length}) de una vez
                    </button>
                </div>
            </div>`;
    }

    // ── Revisión manual ────────────────────────────────────────
    if (manuales.length > 0) {
        html += `
            <div style="margin-bottom:var(--espacio-lg);">
                <h4 style="font-size:var(--texto-base);color:var(--color-dorado);margin-bottom:var(--espacio-md);display:flex;align-items:center;gap:var(--espacio-sm);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    Revisión manual (${manuales.length}) — múltiples cheques con el mismo monto
                </h4>
                ${manuales.map((m, i) => `
                    <div style="border:1px solid var(--color-dorado);border-radius:var(--radio-md);padding:var(--espacio-md);margin-bottom:var(--espacio-md);background:rgba(201,168,76,0.05);">
                        <div style="font-size:var(--texto-sm);margin-bottom:var(--espacio-sm);">
                            <strong>Débito del banco:</strong> ${m.banco.fecha} — ${m.banco.descripcion || 'Sin descripción'} — <span style="font-family:var(--fuente-mono);font-weight:700;">$ ${formatearNumero(m.banco.monto)}</span>
                        </div>
                        <div style="font-size:var(--texto-sm);color:var(--color-texto-secundario);margin-bottom:var(--espacio-sm);">Cheques pendientes con ese monto:</div>
                        <div style="display:flex;flex-direction:column;gap:var(--espacio-xs);">
                        ${m.candidatos.map(c => `
                            <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--espacio-xs) var(--espacio-md);background:var(--color-fondo-tarjeta);border-radius:var(--radio-sm);border:1px solid var(--color-borde);">
                                <div style="font-size:var(--texto-sm);">
                                    <span style="font-family:var(--fuente-mono);">${c.numero_cheque || 'Sin nro.'}</span>
                                    ${c.beneficiarios?.nombre ? ` — ${c.beneficiarios.nombre}` : ''}
                                    — vence <strong>${c.fecha_cobro}</strong>
                                </div>
                                <button class="btn-primario" style="padding:var(--espacio-xs) var(--espacio-md);font-size:var(--texto-sm);"
                                    onclick="confirmarConciliacion('${c.id}', '${m.banco.fecha}', this)">
                                    Este ✓
                                </button>
                            </div>
                        `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>`;
    }

    // ── Sin match ──────────────────────────────────────────────
    if (sinMatch.length > 0) {
        html += `
            <div style="margin-bottom:var(--espacio-lg);">
                <h4 style="font-size:var(--texto-base);color:var(--color-error);margin-bottom:var(--espacio-md);display:flex;align-items:center;gap:var(--espacio-sm);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                    Sin match en el ERP (${sinMatch.length}) — probablemente no fueron cargados
                </h4>
                <div class="tabla-contenedor">
                <table class="tabla">
                    <thead><tr><th>Fecha</th><th>Descripción</th><th>Nro. cheque</th><th>Monto</th></tr></thead>
                    <tbody>
                    ${sinMatch.map(m => `
                        <tr>
                            <td>${m.fecha}</td>
                            <td style="font-size:var(--texto-sm);max-width:240px;white-space:normal;">${m.descripcion || '—'}</td>
                            <td style="font-family:var(--fuente-mono);">${m.numero_cheque || '—'}</td>
                            <td style="font-family:var(--fuente-mono);font-weight:600;color:var(--color-error);">$ ${formatearNumero(m.monto)}</td>
                        </tr>
                    `).join('')}
                    </tbody>
                </table>
                </div>
                <p style="font-size:var(--texto-sm);color:var(--color-texto-tenue);margin-top:var(--espacio-sm);">
                    Estos débitos aparecen en el banco pero no están cargados en el ERP. Cargalos manualmente desde la pestaña "Movimientos".
                </p>
            </div>`;
    }

    // ── Cheques pendientes sin movimiento en el banco ──────────
    if (chequesResto.length > 0) {
        html += `
            <div>
                <h4 style="font-size:var(--texto-base);color:var(--color-texto-secundario);margin-bottom:var(--espacio-md);">
                    Cheques pendientes no vistos en este extracto (${chequesResto.length})
                </h4>
                <p style="font-size:var(--texto-sm);color:var(--color-texto-tenue);margin-bottom:var(--espacio-sm);">
                    Puede ser que aún no se cobraron o que sean de un período no cubierto por este extracto.
                </p>
                <div class="tabla-contenedor">
                <table class="tabla">
                    <thead><tr><th>Nro. cheque</th><th>Beneficiario</th><th>Fecha cobro</th><th>Monto</th></tr></thead>
                    <tbody>
                    ${chequesResto.map(c => `
                        <tr>
                            <td style="font-family:var(--fuente-mono);">${c.numero_cheque || 'Transf.'}</td>
                            <td>${c.beneficiarios?.nombre || '—'}</td>
                            <td>${c.fecha_cobro}</td>
                            <td style="font-family:var(--fuente-mono);">$ ${formatearNumero(c.monto)}</td>
                        </tr>
                    `).join('')}
                    </tbody>
                </table>
                </div>
            </div>`;
    }

    html += `</div>`;
    contenedor.innerHTML = html;
}

// Confirma una conciliación individual: marca el cheque como cobrado con la fecha real del banco
async function confirmarConciliacion(chequeId, fechaBanco, boton) {
    boton.disabled = true;
    boton.textContent = '...';

    const resultado = await ejecutarConsulta(
        db.from('movimientos_tesoreria').update({
            estado: 'cobrado',
            fecha_cobrado_real: fechaBanco
        }).eq('id', chequeId),
        'confirmar conciliación'
    );

    if (resultado === undefined) {
        boton.disabled = false;
        boton.textContent = 'Confirmar ✓';
        return;
    }

    // Actualizar en memoria
    const idx = movimientosTesoreria.findIndex(m => m.id === chequeId);
    if (idx >= 0) {
        movimientosTesoreria[idx].estado = 'cobrado';
        movimientosTesoreria[idx].fecha_cobrado_real = fechaBanco;
    }

    // Marcar fila visualmente
    const fila = boton.closest('tr') || boton.closest('div[style]');
    if (fila) {
        fila.style.opacity = '0.5';
        fila.style.textDecoration = 'line-through';
    }
    boton.textContent = '✓ Cobrado';
    boton.style.background = 'var(--color-verde)';
}

// Confirma todos los matches automáticos de una vez
async function confirmarTodosConciliados(items) {
    if (!Array.isArray(items) || items.length === 0) return;

    const confirmado = confirm(`¿Confirmar ${items.length} cheque(s) como cobrados?`);
    if (!confirmado) return;

    let ok = 0;
    for (const item of items) {
        const res = await ejecutarConsulta(
            db.from('movimientos_tesoreria').update({
                estado: 'cobrado',
                fecha_cobrado_real: item.fecha
            }).eq('id', item.chequeId),
            'confirmar conciliación masiva'
        );
        if (res !== undefined) {
            ok++;
            const idx = movimientosTesoreria.findIndex(m => m.id === item.chequeId);
            if (idx >= 0) {
                movimientosTesoreria[idx].estado = 'cobrado';
                movimientosTesoreria[idx].fecha_cobrado_real = item.fecha;
            }
        }
    }

    mostrarExito(`${ok} de ${items.length} cheques marcados como cobrados`);
    cambiarEmpresa(empresaActivaId); // refrescar dashboard y movimientos
    // Limpiar el extracto procesado
    document.getElementById('resultado-extracto').innerHTML = `
        <div class="alerta alerta-exito">Conciliación completada. Se marcaron ${ok} cheques como cobrados.</div>`;
    document.getElementById('extracto-archivo').value = '';
}

// ==============================================
// REPORTE DIARIO
// ==============================================

function generarReporte() {
    const empresa = empresas.find(e => e.id === empresaActivaId);
    if (!empresa) return;

    const cuentasEmpresa = cuentas.filter(c => c.empresa_id === empresaActivaId && c.moneda === 'ARS');
    const idsCuentas = cuentasEmpresa.map(c => c.id);
    const saldoObj = saldosBancarios.find(s => idsCuentas.includes(s.cuenta_bancaria_id));

    const pendientes = movimientosTesoreria.filter(m =>
        m.empresa_id === empresaActivaId && m.estado === 'pendiente'
    );

    // Calcular saldo real
    const totalMov   = pendientes.reduce((s, m) => s + Number(m.monto), 0);
    const prestamosE = prestamos.filter(p => p.empresa_id === empresaActivaId && p.estado === 'vigente');
    const idsPrest   = prestamosE.map(p => p.id);
    const cuotasPend = cuotas.filter(c => idsPrest.includes(c.prestamo_id) && c.estado === 'pendiente' && c.moneda === 'ARS');
    const totalCuotas = cuotasPend.reduce((s, c) => s + Number(c.monto_total), 0);
    const totalEgresos = totalMov + totalCuotas;
    const saldoBanco = saldoObj ? Number(saldoObj.saldo) : null;
    const saldoReal  = saldoBanco !== null ? saldoBanco - totalEgresos : null;

    // Agrupar pendientes por balde (próximos 6)
    const hoyStr = new Date().toISOString().split('T')[0];
    const grupos = {};
    pendientes.forEach(m => {
        if (m.fecha_balde >= calcularFechaBaldeJS(hoyStr)) {
            if (!grupos[m.fecha_balde]) grupos[m.fecha_balde] = [];
            grupos[m.fecha_balde].push(m);
        }
    });
    cuotasPend.forEach(c => {
        if (c.fecha_balde >= calcularFechaBaldeJS(hoyStr)) {
            if (!grupos[c.fecha_balde]) grupos[c.fecha_balde] = [];
            grupos[c.fecha_balde].push({ ...c, monto: c.monto_total, tipo: 'cuota', beneficiarios: { nombre: prestamosE.find(p => p.id === c.prestamo_id)?.acreedor || 'Préstamo' } });
        }
    });

    const baldesOrdenados = Object.keys(grupos).sort().slice(0, 6);

    const fechaHoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    let texto = `📊 TESORERÍA — ${empresa.nombre.toUpperCase()}\n`;
    texto += `📅 ${fechaHoy}\n`;
    texto += `${'─'.repeat(38)}\n\n`;

    if (saldoBanco !== null) {
        texto += `🏦 Saldo banco (ARS):   $ ${formatearNumero(saldoBanco)}\n`;
        texto += `📋 Egresos pendientes:  $ ${formatearNumero(totalEgresos)}\n`;
        texto += `✅ Saldo real:          $ ${formatearNumero(saldoReal)}\n\n`;
    } else {
        texto += `⚠️ Saldo banco no cargado — actualizarlo para ver saldo real.\n\n`;
    }

    if (baldesOrdenados.length > 0) {
        texto += `📆 PRÓXIMOS VENCIMIENTOS\n`;
        texto += `${'─'.repeat(38)}\n`;
        baldesOrdenados.forEach(balde => {
            const movs  = grupos[balde];
            const total = movs.reduce((s, m) => s + Number(m.monto), 0);
            texto += `\n🗓️ Balde ${formatearFecha(balde)} — $ ${formatearNumero(total)}\n`;
            movs.forEach(m => {
                const tipo = m.tipo === 'cheque' ? '  ✓ Cheque' : m.tipo === 'transferencia' ? '  → Transf.' : '  🏦 Cuota ';
                texto += `${tipo}  ${(m.beneficiarios?.nombre || '').padEnd(22)} $ ${formatearNumero(m.monto)}\n`;
            });
        });
    } else {
        texto += `✅ Sin vencimientos próximos.\n`;
    }

    texto += `\n${'─'.repeat(38)}\nGenerado por ERP Agrícola Quintana`;

    const reporte = document.getElementById('reporte-texto');
    if (reporte) reporte.textContent = texto;

    document.getElementById('btn-copiar-reporte')?.style.setProperty('display', 'inline-flex');

    const btnWA = document.getElementById('btn-whatsapp-reporte');
    if (btnWA) {
        btnWA.href = `https://wa.me/?text=${encodeURIComponent(texto)}`;
        btnWA.style.setProperty('display', 'inline-flex');
    }
}

function copiarReporte() {
    const texto = document.getElementById('reporte-texto')?.textContent;
    if (!texto) return;
    navigator.clipboard.writeText(texto)
        .then(() => mostrarExito('Reporte copiado al portapapeles'))
        .catch(() => mostrarError('No se pudo copiar. Seleccioná el texto manualmente.'));
}

// ==============================================
// UTILIDADES
// ==============================================

/**
 * Calcula la fecha del balde en JavaScript.
 * Replica exactamente la función SQL calcular_fecha_balde().
 * Ej: 07/04 → 05/04 | 02/04 → 30/03 | 10/04 → 10/04
 */
function calcularFechaBaldeJS(fechaStr) {
    if (!fechaStr) return fechaStr;
    // Usar mediodía para evitar problemas de zona horaria
    const fecha   = new Date(fechaStr + 'T12:00:00');
    const dia     = fecha.getDate();
    const offset  = dia % 5;
    const balde   = new Date(fecha);
    balde.setDate(dia - offset);
    return balde.toISOString().split('T')[0];
}

/**
 * Formatea una fecha como "14 abr" o "30 mar" para el timeline
 */
function formatearFechaCorta(fechaISO) {
    if (!fechaISO) return '—';
    const f = new Date(fechaISO + 'T12:00:00');
    const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    return `${f.getDate()} ${meses[f.getMonth()]}`;
}
