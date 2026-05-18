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
let arrendadoresTesoreria = [];   // arrendadores para el selector de beneficiario
let movimientosTesoreria  = [];
let prestamos             = [];
let cuotas                = [];
let saldosBancarios       = [];

let empresaActivaId     = null;   // empresa seleccionada
let chequeEditandoId    = null;
// Facturas en memoria mientras se está creando un cheque nuevo (antes de tener chequeId).
// Cada item: { tempId, tipo:'nueva'|'existente',
//              // si tipo='nueva':
//              file, mimeType,
//              // datos extraídos / metadata visible:
//              numero, fecha, emisor_cuit, emisor_nombre, monto_total,
//              // si tipo='existente':
//              factura_id, archivo_url }
let facturasPendientesNuevas = [];

// Bulk de cheques (carga simultánea de varios con datos comunes).
// Cada item: { tempId, numero, fecha_cobro, monto, qq }
let chequesBulk = [];

// Estado del modal de e-cheques (PDF parseado por IA).
// echecksDetectados: cada item { numero, fecha_emision, fecha_cobro, monto }
// echeqMetadata: { cuenta_libradora, beneficiario_nombre, beneficiario_cuit, cuentaMatchId? }
let echecksDetectados = [];
let echeqMetadata = null;
let echeqFileSeleccionado = null;   // PDF en memoria mientras no se procesa
let prestamoEditandoId  = null;

// Cheque cuyo detalle está abierto (para refrescar sección de facturas al modificar)
let chequeDetalleActualId = null;

// ==============================================
// CARGAR DATOS
// ==============================================

async function cargarTesoreria() {
    const [
        empData, cuentasData, catData, benData,
        contratistasData, empleadosData, arrendadoresData,
        movData, prestData, cuotasData, saldosData, vincData
    ] = await Promise.all([
        ejecutarConsulta(db.from('empresas').select('*').order('nombre'), 'cargar empresas'),
        ejecutarConsulta(db.from('cuentas_bancarias').select('*, empresas(nombre)').order('alias'), 'cargar cuentas'),
        ejecutarConsulta(db.from('categorias_gasto').select('*').eq('activa', true).order('nombre'), 'cargar categorías'),
        ejecutarConsulta(db.from('beneficiarios').select('*, contratistas(nombre), empleados(nombre), arrendadores(nombre)').order('nombre'), 'cargar beneficiarios'),
        ejecutarConsulta(db.from('contratistas').select('id, nombre, especialidad, cuit').order('nombre'), 'cargar contratistas'),
        ejecutarConsulta(db.from('empleados').select('id, nombre, rol, cuit:cuil').eq('activo', true).order('nombre'), 'cargar empleados'),
        ejecutarConsulta(db.from('arrendadores').select('id, nombre, cuit').eq('activo', true).order('nombre'), 'cargar arrendadores'),
        ejecutarConsulta(
            db.from('movimientos_tesoreria')
                .select('*, empresas(nombre), cuentas_bancarias(alias, moneda), beneficiarios(nombre, tipo), categorias_gasto(nombre), empleado_entrega:empleados!empleado_entrega_id(id, nombre)')
                .order('fecha_balde', { ascending: false })
                .order('fecha_cobro', { ascending: false }),
            'cargar movimientos'
        ),
        ejecutarConsulta(db.from('prestamos').select('*, empresas(nombre)').order('fecha_otorgamiento', { ascending: false }), 'cargar préstamos'),
        ejecutarConsulta(db.from('cuotas_prestamo').select('*').order('fecha_vencimiento'), 'cargar cuotas'),
        ejecutarConsulta(db.from('saldos_bancarios').select('*, cuentas_bancarias(alias, moneda, empresa_id)').order('fecha', { ascending: false }), 'cargar saldos'),
        ejecutarConsulta(db.from('cheques_facturas').select('cheque_id, facturas(*)'), 'cargar vinculaciones cheque-factura')
    ]);

    empresas              = empData          || [];
    cuentas               = cuentasData      || [];
    categorias            = catData          || [];
    beneficiarios         = benData          || [];
    contratistasTesoreria = contratistasData  || [];
    empleadosTesoreria    = empleadosData     || [];
    arrendadoresTesoreria = arrendadoresData  || [];
    movimientosTesoreria  = movData          || [];
    prestamos             = prestData        || [];
    cuotas                = cuotasData       || [];
    saldosBancarios       = saldosData       || [];

    // ── Adjuntar facturas vinculadas a cada cheque (N:N) ──
    const vincs = vincData || [];
    const facturasPorCheque = {};     // cheque_id -> [factura, ...]
    const chequesIdsPorFactura = {};  // factura_id -> [cheque_id, ...]
    vincs.forEach(v => {
        if (!v.facturas) return;
        (facturasPorCheque[v.cheque_id] ||= []).push(v.facturas);
        (chequesIdsPorFactura[v.facturas.id] ||= []).push(v.cheque_id);
    });

    // Primero asignamos facturas_vinculadas; luego calculamos totales cruzados
    movimientosTesoreria.forEach(m => {
        m.facturas_vinculadas = facturasPorCheque[m.id] || [];
    });

    // Para cada factura vinculada a un cheque, guardar la lista de cheques
    // que la cubren y la suma de sus montos. Así el aviso de inconsistencia
    // puede comparar factura.monto_total vs sum(cheques que la cubren).
    movimientosTesoreria.forEach(m => {
        m.facturas_vinculadas.forEach(f => {
            const ids = chequesIdsPorFactura[f.id] || [];
            f._cheques_ids = ids;
            f._total_cheques = ids.reduce((s, cid) => {
                const ch = movimientosTesoreria.find(mm => mm.id === cid);
                return s + Number(ch?.monto || 0);
            }, 0);
        });
    });

    // ── Promoción FUTURO → PENDIENTE y degradación PENDIENTE → FUTURO ──
    // Aseguran que el estado refleja siempre la fecha de cobro al cargar.
    await promoverFuturosAPendientes();
    await degradarPendientesAFuturos();

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

// ── Helpers compartidos (cards + timeline) ─────────────────────

/**
 * Pasa a "pendiente" cualquier movimiento en "futuro" cuya fecha_cobro
 * ya llegó. Se ejecuta al cargar la tesorería.
 */
async function promoverFuturosAPendientes() {
    const hoyStr = fechaHoyStr();
    const aPromover = movimientosTesoreria.filter(m =>
        m.estado === 'futuro' && (m.fecha_cobro || '') <= hoyStr
    );
    if (aPromover.length === 0) return;

    const ids = aPromover.map(m => m.id);
    await ejecutarConsulta(
        db.from('movimientos_tesoreria').update({ estado: 'pendiente' }).in('id', ids),
        'promover futuros a pendientes'
    );
    // Reflejar el cambio en memoria para no tener que recargar
    aPromover.forEach(m => { m.estado = 'pendiente'; });
}

/**
 * Pasa a "futuro" cualquier movimiento en "pendiente" cuya fecha_cobro
 * todavía no llegó. Corrige datos importados o cargados con estado
 * incorrecto (por ejemplo, la sync desde Google Sheets que marca todo
 * como "pendiente" sin mirar la fecha).
 *
 * Se ejecuta al cargar la tesorería, después de la promoción.
 */
async function degradarPendientesAFuturos() {
    const hoyStr = fechaHoyStr();
    const aDegradar = movimientosTesoreria.filter(m =>
        m.estado === 'pendiente' && m.fecha_cobro && m.fecha_cobro > hoyStr
    );
    if (aDegradar.length === 0) return;

    const ids = aDegradar.map(m => m.id);
    await ejecutarConsulta(
        db.from('movimientos_tesoreria').update({ estado: 'futuro' }).in('id', ids),
        'degradar pendientes a futuros'
    );
    // Reflejar el cambio en memoria para no tener que recargar
    aDegradar.forEach(m => { m.estado = 'futuro'; });
}

// fechaHoyStr() ahora vive en ui.js (global), para reutilizarlo en toda la app.

/**
 * Calcula el saldo disponible hoy y devuelve las listas auxiliares
 * que usan renderizarCards() y renderizarTimeline().
 *
 *   saldo_disponible_hoy = saldo_banco
 *                          - cheques/transferencias con fecha_cobro <= hoy y pendientes
 *                          - cuotas con fecha_vencimiento <= hoy y pendientes
 *
 * Los pagos futuros NO restan del saldo disponible — entran en los baldes.
 */
function calcularSaldoDisponibleHoy() {
    const hoyStr = fechaHoyStr();

    // Saldo banco ARS de esta empresa
    const cuentasEmpresa = cuentas.filter(c => c.empresa_id === empresaActivaId && c.moneda === 'ARS');
    const idsCuentas     = cuentasEmpresa.map(c => c.id);
    const saldoObj       = saldosBancarios.find(s => idsCuentas.includes(s.cuenta_bancaria_id));
    const saldoBanco     = saldoObj ? Number(saldoObj.saldo) : null;

    // Movimientos y cuotas pendientes de esta empresa (incluye FUTURO + PENDIENTE)
    const pendientes = movimientosTesoreria.filter(m =>
        m.empresa_id === empresaActivaId &&
        (m.estado === 'pendiente' || m.estado === 'futuro')
    );
    const prestamosEmpresa = prestamos.filter(p => p.empresa_id === empresaActivaId && p.estado === 'vigente');
    const idsPrestamos     = prestamosEmpresa.map(p => p.id);
    const cuotasPend       = cuotas.filter(c =>
        idsPrestamos.includes(c.prestamo_id) && c.estado === 'pendiente' && c.moneda === 'ARS'
    );

    // Exigible hoy: ya vencido y sin debitar
    const exigibleMovs   = pendientes.filter(m => (m.fecha_cobro || '')       <= hoyStr);
    const exigibleCuotas = cuotasPend.filter(c => (c.fecha_vencimiento || '') <= hoyStr);
    const totalExigible  =
        exigibleMovs.reduce((s, m)   => s + Number(m.monto), 0) +
        exigibleCuotas.reduce((s, c) => s + Number(c.monto_total), 0);

    const saldoDisponible = saldoBanco !== null ? saldoBanco - totalExigible : null;

    // Futuros: los que van a aparecer en los baldes (para no doble-contar)
    const pendientesFuturos = pendientes.filter(m => (m.fecha_cobro || '')       > hoyStr);
    const cuotasFuturas     = cuotasPend.filter(c => (c.fecha_vencimiento || '') > hoyStr);

    return {
        saldoBanco, totalExigible, saldoDisponible,
        pendientes, cuotasPend,
        pendientesFuturos, cuotasFuturas
    };
}

function renderizarCards() {
    const container = document.getElementById('tesoreria-cards');
    if (!container) return;

    const {
        saldoBanco, totalExigible, saldoDisponible,
        pendientes, cuotasPend
    } = calcularSaldoDisponibleHoy();

    const chequesPend  = pendientes.filter(m => m.tipo === 'cheque');
    const transfPend   = pendientes.filter(m => m.tipo === 'transferencia');
    const totalCheques = chequesPend.reduce((s, m) => s + Number(m.monto), 0);
    const totalTransf  = transfPend.reduce((s, m)  => s + Number(m.monto), 0);
    const totalCuotas  = cuotasPend.reduce((s, c)  => s + Number(c.monto_total), 0);

    const claseSaldo = saldoDisponible === null ? '' :
                       saldoDisponible >  0      ? 'positivo' : 'negativo';

    container.innerHTML = `
        <div class="tesoreria-card">
            <div class="tesoreria-card-label">Saldo banco</div>
            <div class="tesoreria-card-valor">
                ${saldoBanco !== null ? '$ ' + formatearNumero(saldoBanco) : '—'}
            </div>
            <div class="tesoreria-card-sub">Último saldo ingresado</div>
        </div>

        <div class="tesoreria-card card-exigible">
            <div class="tesoreria-card-label">Exigible hoy pendiente</div>
            <div class="tesoreria-card-valor ${totalExigible > 0 ? 'advertencia' : ''}">
                $ ${formatearNumero(totalExigible)}
            </div>
            <div class="tesoreria-card-sub">Vencido sin debitar</div>
        </div>

        <div class="tesoreria-card card-saldo-real">
            <div class="tesoreria-card-label">Saldo disponible hoy</div>
            <div class="tesoreria-card-valor ${claseSaldo}">
                ${saldoDisponible !== null ? '$ ' + formatearNumero(saldoDisponible) : '—'}
            </div>
            <div class="tesoreria-card-sub">Banco menos lo ya vencido</div>
        </div>

        <div class="tesoreria-card">
            <div class="tesoreria-card-label">Cheques pendientes</div>
            <div class="tesoreria-card-valor advertencia">$ ${formatearNumero(totalCheques)}</div>
            <div class="tesoreria-card-sub">${chequesPend.length} cheque${chequesPend.length !== 1 ? 's' : ''}</div>
        </div>

        <div class="tesoreria-card">
            <div class="tesoreria-card-label">Transferencias pendientes</div>
            <div class="tesoreria-card-valor advertencia">$ ${formatearNumero(totalTransf)}</div>
            <div class="tesoreria-card-sub">${transfPend.length} transf.</div>
        </div>

        <div class="tesoreria-card">
            <div class="tesoreria-card-label">Cuotas pendientes (ARS)</div>
            <div class="tesoreria-card-valor advertencia">$ ${formatearNumero(totalCuotas)}</div>
            <div class="tesoreria-card-sub">${cuotasPend.length} cuota${cuotasPend.length !== 1 ? 's' : ''}</div>
        </div>

        ${renderizarCardFacturasFaltantes()}
    `;
}

/**
 * Card del dashboard: cheques que deberían tener factura y no la tienen.
 * Considera todos los cheques no anulados de contratistas/otros sin ninguna factura vinculada.
 * Click en la card → va a movimientos con filtro "falta factura" aplicado.
 */
function renderizarCardFacturasFaltantes() {
    const chequesSinFactura = movimientosTesoreria.filter(m =>
        m.empresa_id === empresaActivaId &&
        m.estado !== 'anulado' &&
        estadoFacturaMovimiento(m) === 'falta'
    );
    const cantidad = chequesSinFactura.length;
    const monto    = chequesSinFactura.reduce((s, m) => s + Number(m.monto), 0);

    const claseValor = cantidad === 0 ? 'positivo' : 'advertencia';
    const subtitulo  = cantidad === 0
        ? 'Todos los cheques tienen su factura'
        : `${cantidad} cheque${cantidad !== 1 ? 's' : ''} · $ ${formatearNumero(monto)}`;

    return `
        <div class="tesoreria-card" style="cursor:pointer;" onclick="verChequesSinFactura()" title="Ver cheques sin factura">
            <div class="tesoreria-card-label">Cheques sin factura</div>
            <div class="tesoreria-card-valor ${claseValor}">${cantidad}</div>
            <div class="tesoreria-card-sub">${subtitulo}</div>
        </div>
    `;
}

/**
 * Cambia al tab "Movimientos" con el filtro "falta factura" aplicado.
 */
function verChequesSinFactura() {
    cambiarTabTesoreria('movimientos');
    // Pequeño delay para que el tab esté montado antes de setear el filtro
    setTimeout(() => {
        const filtroFact = document.getElementById('filtro-factura');
        if (filtroFact) {
            filtroFact.value = 'falta';
            renderizarMovimientos();
        }
    }, 50);
}

function renderizarTimeline() {
    const container = document.getElementById('timeline-baldes');
    if (!container) return;

    const hoyStr = fechaHoyStr();
    const {
        saldoDisponible, pendientesFuturos, cuotasFuturas, totalExigible
    } = calcularSaldoDisponibleHoy();

    // Generar los próximos 10 baldes desde hoy (paso de 5 días)
    const baldes    = [];
    let baldeActual = calcularFechaBaldeJS(hoyStr);
    const baldeHoy  = baldeActual;

    for (let i = 0; i < 10; i++) {
        baldes.push(baldeActual);
        baldeActual = siguienteBalde(baldeActual);
    }

    // Proyección acumulada — parte del saldo disponible hoy
    // (lo ya vencido NO se descuenta acá porque ya está dentro de saldoDisponible)
    let saldoProyectado = saldoDisponible;

    container.innerHTML = baldes.map(balde => {
        const esBaldeHoy = balde === baldeHoy;

        // Movimientos/cuotas del balde — solo futuros para no doble-contar
        const movBalde = pendientesFuturos.filter(m => m.fecha_balde === balde);
        const cuoBalde = cuotasFuturas.filter(c    => c.fecha_balde  === balde);

        const chequesBalde = movBalde.filter(m => m.tipo === 'cheque');
        const transfBalde  = movBalde.filter(m => m.tipo === 'transferencia');

        const montoCheques = chequesBalde.reduce((s, m) => s + Number(m.monto), 0);
        const montoTransf  = transfBalde.reduce((s, m)  => s + Number(m.monto), 0);
        const montoCuotas  = cuoBalde.reduce((s, c)     => s + Number(c.monto_total), 0);
        const totalBalde   = montoCheques + montoTransf + montoCuotas;

        // Saldo antes y después del balde
        const saldoAntes   = saldoProyectado;
        const saldoDespues = saldoProyectado !== null ? saldoProyectado - totalBalde : null;
        if (saldoProyectado !== null) saldoProyectado -= totalBalde;

        // Semáforo (solo si hay movimientos en el balde)
        let claseSemaforo = '';
        if (saldoDespues !== null && totalBalde > 0) {
            if      (saldoDespues < 0)                   claseSemaforo = 'balde-rojo';
            else if (saldoDespues < totalBalde * 0.2)    claseSemaforo = 'balde-amarillo';
            else                                          claseSemaforo = 'balde-verde';
        }

        // Caso especial: balde de hoy vacío de futuros pero con exigible vencido pendiente.
        // En ese caso, el texto "Sin vencimientos" es engañoso — avisamos y resaltamos el borde.
        const muestraExigibleHoy = esBaldeHoy && totalBalde === 0 && totalExigible > 0;
        const textoTotalBalde = totalBalde > 0
            ? '$ ' + formatearNumero(totalBalde)
            : (muestraExigibleHoy ? 'Sin pendientes futuros' : 'Sin vencimientos');
        if (muestraExigibleHoy) claseSemaforo = 'balde-alerta-vencido';

        const saldoAntesFmt   = saldoAntes   !== null ? '$ ' + formatearNumero(saldoAntes)   : '—';
        const saldoDespuesFmt = saldoDespues !== null ? '$ ' + formatearNumero(saldoDespues) : '—';

        return `
        <div class="balde-item ${esBaldeHoy ? 'balde-hoy' : ''} ${claseSemaforo}">
            <div class="balde-fecha">
                ${formatearFechaCorta(balde)}
                ${esBaldeHoy ? '<span class="balde-fecha-hoy-label">← hoy</span>' : ''}
            </div>

            <div class="balde-desglose-detalle">
                <div class="balde-linea">
                    <span class="balde-linea-tipo">✓ Cheques</span>
                    <span class="balde-linea-cant">${chequesBalde.length}</span>
                    <span class="balde-linea-monto ${montoCheques > 0 ? '' : 'tenue'}">
                        ${montoCheques > 0 ? '$ ' + formatearNumero(montoCheques) : '$ 0'}
                    </span>
                </div>
                <div class="balde-linea">
                    <span class="balde-linea-tipo">→ Transferencias</span>
                    <span class="balde-linea-cant">${transfBalde.length}</span>
                    <span class="balde-linea-monto ${montoTransf > 0 ? '' : 'tenue'}">
                        ${montoTransf > 0 ? '$ ' + formatearNumero(montoTransf) : '$ 0'}
                    </span>
                </div>
                <div class="balde-linea">
                    <span class="balde-linea-tipo">🏦 Cuotas</span>
                    <span class="balde-linea-cant">${cuoBalde.length}</span>
                    <span class="balde-linea-monto ${montoCuotas > 0 ? '' : 'tenue'}">
                        ${montoCuotas > 0 ? '$ ' + formatearNumero(montoCuotas) : '$ 0'}
                    </span>
                </div>
            </div>

            <div class="balde-separador"></div>

            <div class="balde-proyeccion">
                <div class="balde-total-balde">
                    <span>Total balde</span>
                    <strong>${textoTotalBalde}</strong>
                </div>
                ${muestraExigibleHoy ? `
                <div class="balde-aviso-exigible">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <span>Hay <strong>$ ${formatearNumero(totalExigible)}</strong> exigibles hoy ya vencidos — ver KPI arriba</span>
                </div>
                ` : ''}
                ${saldoAntes !== null && totalBalde > 0 ? `
                <div class="balde-saldo-linea">
                    <span>Saldo antes</span>
                    <span>${saldoAntesFmt}</span>
                </div>
                <div class="balde-saldo-linea balde-saldo-despues ${claseSemaforo}">
                    <span>Saldo después</span>
                    <strong>${saldoDespuesFmt}</strong>
                </div>
                ` : ''}
            </div>
        </div>
        `;
    }).join('');
}

// ==============================================
// MOVIMIENTOS — Renderizar agrupado por balde
// ==============================================

function badgeTipoBen(tipo) {
    if (!tipo) return '—';
    const map = {
        contratista: { label: 'Contratista', color: '#4a9e6e' },
        empleado:    { label: 'Empleado',    color: '#5a8fc2' },
        arrendador:  { label: 'Arrendador',  color: '#c9a84c' },
        otro:        { label: 'Otro',         color: '#6b6760' },
    };
    const cfg = map[tipo] || { label: tipo, color: '#6b6760' };
    return `<span style="
        display:inline-block;
        padding:2px 8px;
        border-radius:var(--radio-completo);
        font-size:var(--texto-xs);
        font-weight:600;
        background:${cfg.color}22;
        color:${cfg.color};
        text-transform:uppercase;
        letter-spacing:0.03em;
    ">${cfg.label}</span>`;
}

/**
 * Decide si un movimiento debería tener factura adjunta.
 * @returns 'ok' | 'falta' | 'na'   — ok = tiene, falta = no tiene pero debería, na = no aplica
 */
function estadoFacturaMovimiento(m) {
    // Solo cheques reciben factura de proveedor; transferencias automáticas no aplican
    if (m.tipo !== 'cheque') return 'na';
    const tipoBen = m.beneficiarios?.tipo;
    // Empleados no emiten factura; arrendadores se manejan en el módulo de arrendamientos
    if (tipoBen === 'empleado' || tipoBen === 'arrendador') return 'na';
    return (m.facturas_vinculadas && m.facturas_vinculadas.length > 0) ? 'ok' : 'falta';
}

function badgeFactura(estado) {
    if (estado === 'ok') {
        return `<span title="Factura adjunta" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:rgba(74,158,110,0.15);color:var(--color-verde);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><polyline points="20 6 9 17 4 12"/></svg>
        </span>`;
    }
    if (estado === 'falta') {
        return `<span title="Falta factura" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:rgba(201,76,76,0.15);color:var(--color-error);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </span>`;
    }
    return `<span title="No aplica" style="color:var(--color-texto-tenue);">—</span>`;
}

function renderizarMovimientos() {
    const container   = document.getElementById('lista-movimientos');
    const contador    = document.getElementById('contador-movimientos');
    const usuario     = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);
    if (!container) return;

    // Aplicar filtros
    const filtroEstado    = document.getElementById('filtro-estado')?.value    || '';
    const filtroTipo      = document.getElementById('filtro-tipo')?.value      || '';
    const filtroDesde     = ddmmAISO(document.getElementById('filtro-desde')?.value)     || '';
    const filtroHasta     = ddmmAISO(document.getElementById('filtro-hasta')?.value)     || '';
    const filtroFactura   = document.getElementById('filtro-factura')?.value   || '';
    const filtroBusqueda  = document.getElementById('filtro-busqueda')?.value.toLowerCase().trim() || '';

    let filtrados = movimientosTesoreria.filter(m => {
        if (m.empresa_id !== empresaActivaId) return false;
        // Ocultar anulados salvo que el usuario los pida explícitamente
        // eligiendo "Anulado" en el filtro de Estado.
        if (m.estado === 'anulado' && filtroEstado !== 'anulado') return false;
        if (filtroEstado && m.estado !== filtroEstado) return false;
        if (filtroTipo   && m.tipo   !== filtroTipo)   return false;
        if (filtroDesde  && m.fecha_cobro < filtroDesde) return false;
        if (filtroHasta  && m.fecha_cobro > filtroHasta) return false;
        if (filtroFactura) {
            if (estadoFacturaMovimiento(m) !== filtroFactura) return false;
        }
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

    // Ordenar por fecha_cobro ascendente (más cercana a hoy primero)
    const hoyStr = (() => {
        const h = new Date();
        return `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}-${String(h.getDate()).padStart(2,'0')}`;
    })();

    filtrados.sort((a, b) => {
        const da = a.fecha_cobro || '';
        const db2 = b.fecha_cobro || '';
        // Primero las fechas >= hoy (pendientes), luego las pasadas
        const aFutura = da >= hoyStr;
        const bFutura = db2 >= hoyStr;
        if (aFutura && !bFutura) return -1;
        if (!aFutura && bFutura) return 1;
        return da.localeCompare(db2);
    });

    const filas = filtrados.map(m => {
        const badgeTipo = m.tipo === 'cheque'
            ? (m.es_echeck
                ? `<span class="badge badge-azul">📱 E-Cheq</span>`
                : `<span class="badge badge-cheque">Cheque</span>`)
            : `<span class="badge badge-transferencia">Transf.</span>`;
        const badgeEstado =
            m.estado === 'futuro'    ? `<span class="badge badge-futuro">Futuro</span>` :
            m.estado === 'pendiente' ? `<span class="badge badge-pendiente-pago">Pendiente</span>` :
            m.estado === 'cobrado'   ? `<span class="badge badge-cobrado">Cobrado</span>` :
                                       `<span class="badge badge-anulado">Anulado</span>`;

        const estadoFact = estadoFacturaMovimiento(m);

        return `
        <tr>
            <td style="white-space:nowrap;">${formatearFecha(m.fecha_cobro)}</td>
            <td>${badgeTipo}</td>
            <td style="font-family:var(--fuente-mono);">${m.numero_cheque || '—'}</td>
            <td><strong>${m.beneficiarios?.nombre || '—'}</strong></td>
            <td>${badgeTipoBen(m.beneficiarios?.tipo)}</td>
            <td>${m.categorias_gasto?.nombre || '—'}</td>
            <td style="font-weight:600;font-family:var(--fuente-mono);white-space:nowrap;">$ ${formatearNumero(m.monto)}</td>
            <td>${badgeEstado}</td>
            <td style="text-align:center;">${badgeFactura(estadoFact)}</td>
            <td style="white-space:nowrap;">
                <div class="tabla-acciones">
                    <button class="tabla-btn" onclick="verDetalleCheque('${m.id}')" title="Ver detalle">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    ${puedeEditar && (m.estado === 'pendiente' || m.estado === 'futuro') ? `
                        <button class="tabla-btn" style="color:var(--color-verde);" onclick="marcarCobrado('${m.id}')" title="Marcar como cobrado">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="20 6 9 17 4 12"/></svg>
                        </button>
                    ` : ''}
                    ${puedeEditar && m.estado === 'cobrado' ? `
                        <button class="tabla-btn" style="color:var(--color-alerta);" onclick="revertirAPendiente('${m.id}')" title="Revertir a pendiente">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
                        </button>
                    ` : ''}
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="editarMovimiento('${m.id}')" title="Editar">${ICONOS.editar}</button>
                        ${m.estado !== 'anulado'
                            ? `<button class="tabla-btn btn-eliminar" onclick="confirmarAnularMovimiento('${m.id}')" title="Anular">${ICONOS.eliminar}</button>`
                            : `<button class="tabla-btn" style="color:var(--color-verde);" onclick="reactivarCheque('${m.id}')" title="Reactivar (deshacer anulación)">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/></svg>
                              </button>`
                        }
                    ` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="tabla-contenedor" style="overflow-x:auto;">
            <table class="tabla" style="min-width:880px;">
                <thead>
                    <tr>
                        <th style="width:95px;">F. Cobro</th>
                        <th style="width:90px;">Tipo</th>
                        <th style="width:110px;">Nro. Cheque</th>
                        <th>Beneficiario</th>
                        <th style="width:100px;">Tipo ben.</th>
                        <th>Categoría</th>
                        <th style="width:120px;">Monto</th>
                        <th style="width:95px;">Estado</th>
                        <th style="width:70px;text-align:center;">Factura</th>
                        <th style="width:120px;">Acciones</th>
                    </tr>
                </thead>
                <tbody>${filas}</tbody>
            </table>
        </div>
    `;
}

function limpiarFiltros() {
    document.getElementById('filtro-estado').value    = '';
    document.getElementById('filtro-tipo').value      = '';
    document.getElementById('filtro-desde').value     = '';
    document.getElementById('filtro-hasta').value     = '';
    document.getElementById('filtro-busqueda').value  = '';
    const filtroFact = document.getElementById('filtro-factura');
    if (filtroFact) filtroFact.value = '';
    renderizarMovimientos();
}

// ==============================================
// CHEQUES — Modal y CRUD
// ==============================================

function abrirModalCheque(datos = {}, opciones = {}) {
    chequeEditandoId = datos.id || null;

    // Resetear facturas pendientes al abrir un cheque NUEVO
    // (salvo que estemos restaurando desde una pantalla intermedia,
    // ej: volver del panel "vincular existente").
    if (!chequeEditandoId && !opciones.preservarPendientes) {
        facturasPendientesNuevas = [];
    }

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
    const benActual      = beneficiarios.find(b => b.id === datos.beneficiario_id);
    const tipoPresel     = benActual?.tipo || 'contratista';
    const contrPresel    = benActual?.contratista_id  || '';
    const emplPresel     = benActual?.empleado_id     || '';
    const arrPresel      = benActual?.arrendador_id   || '';
    const otroNombre     = (tipoPresel === 'otro' ? benActual?.nombre : '') || '';
    const otroCuit       = (tipoPresel === 'otro' ? benActual?.cuit   : '') || '';

    const opcionesContr = contratistasTesoreria.map(c =>
        `<option value="${c.id}" ${contrPresel === c.id ? 'selected' : ''}>${c.nombre}${c.especialidad ? ' — ' + c.especialidad : ''}</option>`
    ).join('');
    const opcionesEmpl = empleadosTesoreria.map(e =>
        `<option value="${e.id}" ${emplPresel === e.id ? 'selected' : ''}>${e.nombre}</option>`
    ).join('');
    const opcionesArr = arrendadoresTesoreria.map(a =>
        `<option value="${a.id}" ${arrPresel === a.id ? 'selected' : ''}>${a.nombre}</option>`
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
                <input type="text" data-fecha id="campo-fecha-emision" class="campo-input"
                    value="${isoADDMM(datos.fecha_emision || hoy)}"
                    placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Fecha de cobro <span class="campo-requerido">*</span></label>
                <input type="text" data-fecha id="campo-fecha-cobro" class="campo-input"
                    value="${isoADDMM(datos.fecha_cobro)}"
                    placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10"
                    oninput="actualizarHintBalde(ddmmAISO(this.value))">
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
                        <option value="arrendador"  ${tipoPresel === 'arrendador'  ? 'selected' : ''}>Arrendador</option>
                        <option value="otro"        ${tipoPresel === 'otro'        ? 'selected' : ''}>Otro</option>
                    </select>
                </div>
                <!-- Contratista -->
                <div class="campo-grupo" id="ben-grupo-contratista" style="${tipoPresel !== 'contratista' ? 'display:none' : ''}">
                    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--espacio-sm);">
                        <label class="campo-label" style="margin:0;">Contratista</label>
                        <button type="button" onclick="togglePanelNuevoContratista()" style="background:none;border:none;color:var(--color-dorado);font-size:var(--texto-xs);cursor:pointer;padding:0;font-weight:600;">+ Nuevo</button>
                    </div>
                    <select id="ben-contratista" class="campo-select">
                        <option value="">Seleccionar...</option>
                        ${opcionesContr}
                    </select>
                    ${renderizarPanelNuevoContratista()}
                </div>
                <!-- Empleado -->
                <div class="campo-grupo" id="ben-grupo-empleado" style="${tipoPresel !== 'empleado' ? 'display:none' : ''}">
                    <label class="campo-label">Empleado</label>
                    <select id="ben-empleado" class="campo-select">
                        <option value="">Seleccionar...</option>
                        ${opcionesEmpl}
                    </select>
                </div>
                <!-- Arrendador -->
                <div class="campo-grupo" id="ben-grupo-arrendador" style="${tipoPresel !== 'arrendador' ? 'display:none' : ''}">
                    <label class="campo-label">Arrendador</label>
                    <select id="ben-arrendador" class="campo-select">
                        <option value="">Seleccionar...</option>
                        ${opcionesArr}
                    </select>
                </div>
            </div>
            <!-- QQ que representa el cheque (solo para arrendadores) -->
            <div id="ben-grupo-qq-arrendador" style="${tipoPresel !== 'arrendador' ? 'display:none' : ''}">
                <div class="campos-fila">
                    <div class="campo-grupo">
                        <label class="campo-label">QQ que representa este pago <span class="campo-requerido">*</span></label>
                        <input type="number" id="ben-arrendador-qq" class="campo-input"
                            placeholder="Ej: 140" step="0.01" min="0.01">
                        <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);margin-top:2px;">
                            Se descontará del saldo de quintales del arrendador en la campaña activa.
                        </div>
                    </div>
                    <div class="campo-grupo">
                        <label class="campo-label">Tipo</label>
                        <select id="ben-arrendador-tipo" class="campo-select">
                            <option value="blanco">Blanco (con factura)</option>
                            <option value="negro">Negro (sin factura)</option>
                        </select>
                    </div>
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
            <input type="text" data-monto id="campo-monto" class="campo-input"
                value="${formatearMontoInput(datos.monto)}"
                placeholder="Monto en pesos">
            <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);margin-top:2px;">Siempre en pesos argentinos — no hay cheques en dólares.</div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Notas</label>
            <input type="text" id="campo-notas" class="campo-input"
                value="${datos.notas || ''}"
                placeholder="Observaciones opcionales">
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Entregado por</label>
            <select id="campo-empleado-entrega" class="campo-select">
                <option value="">— Sin especificar —</option>
                ${empleadosTesoreria.map(e => `<option value="${e.id}" ${datos.empleado_entrega_id === e.id ? 'selected' : ''}>${e.nombre}</option>`).join('')}
            </select>
            <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);margin-top:2px;">Empleado que manejó o entregó el cheque (opcional).</div>
        </div>

        ${chequeEditandoId ? `
            <hr class="form-separador">
            <div class="form-seccion-titulo">Facturas</div>
            <div id="bloque-facturas-edicion">
                ${renderizarSeccionFacturasCheque(
                    movimientosTesoreria.find(x => x.id === chequeEditandoId) || {},
                    false
                )}
            </div>
        ` : `
            <hr class="form-separador">
            <div class="form-seccion-titulo">Facturas</div>
            <div id="bloque-facturas-pendientes">
                ${renderizarSeccionFacturasPendientes()}
            </div>
        `}
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

// Muestra en tiempo real a qué balde pertenece la fecha ingresada.
// Cualquier fecha es válida: el sistema la agrupa al balde de 5 días que
// corresponde (calcularFechaBaldeJS). Ej: 03/05 → balde 30/04.
function actualizarHintBalde(fechaStr) {
    const hint      = document.getElementById('hint-balde');
    const hintTexto = document.getElementById('hint-balde-texto');
    if (!hint || !hintTexto || !fechaStr) return;

    const balde = calcularFechaBaldeJS(fechaStr);
    const dia   = parseInt(fechaStr.split('-')[2]);
    hint.classList.add('visible');
    hint.classList.remove('balde-hint-error');

    if (dia % 5 === 0) {
        hintTexto.textContent = `Este cheque se agrupa al balde del ${formatearFecha(balde)}`;
    } else {
        hintTexto.textContent = `Día ${dia} → se agrupa automáticamente al balde del ${formatearFecha(balde)}`;
    }
}

// Sugiere las fechas válidas más cercanas
function obtenerFechasBalde(fechaStr) {
    const anteriorStr  = calcularFechaBaldeJS(fechaStr);
    const siguienteStr = siguienteBalde(anteriorStr);
    return `${formatearFecha(anteriorStr)} o ${formatearFecha(siguienteStr)}`;
}

// ==============================================
// FACTURAS DE CHEQUES — Gemini (helper compartido)
// ==============================================

function archivoABase64Cheque(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Llama a Gemini para extraer los datos de una factura de proveedor.
 * Usa retry con backoff exponencial y fallback entre modelos.
 * @param {string} apiKey
 * @param {string} pdfBase64
 * @param {string} mimeType — ej 'application/pdf' o 'image/png'
 */
async function llamarGeminiFacturaCheque(apiKey, pdfBase64, mimeType = 'application/pdf') {
    const prompt = `Analizá esta factura argentina (factura ARCA/AFIP emitida por un proveedor o contratista) y extraé los datos en formato JSON estricto.

Si un campo no aparece, poné null. No inventes datos.

Formato de respuesta (solo JSON, sin markdown):
{
    "vendedor_nombre": "razón social del proveedor emisor",
    "vendedor_cuit": "CUIT en formato XX-XXXXXXXX-X",
    "numero_factura": "número completo, ej 00002-00000058",
    "fecha": "YYYY-MM-DD de la factura",
    "total": 0,
    "moneda": "ARS o USD",
    "cae": "número de CAE",
    "cae_vencimiento": "YYYY-MM-DD"
}`;

    const modelos = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    const codigosReintento = [429, 500, 502, 503, 504];

    let ultimoError = null;

    for (let m = 0; m < modelos.length; m++) {
        const modelo = modelos[m];

        for (let intento = 0; intento < 3; intento++) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: prompt },
                                { inline_data: { mime_type: mimeType, data: pdfBase64 } }
                            ]
                        }],
                        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const err = new Error(errorData.error?.message || `Error HTTP ${response.status}`);
                    err.status = response.status;
                    throw err;
                }

                const result = await response.json();
                const parts = result.candidates?.[0]?.content?.parts || [];
                let texto = null;
                for (let i = parts.length - 1; i >= 0; i--) {
                    if (parts[i].text) { texto = parts[i].text; break; }
                }
                if (!texto) throw new Error('Gemini no devolvió respuesta.');

                let jsonStr = texto.trim();
                if (jsonStr.startsWith('```')) {
                    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\s*$/g, '').trim();
                }
                return JSON.parse(jsonStr);
            } catch (err) {
                ultimoError = err;
                const reintentable = codigosReintento.includes(err.status);
                if (!reintentable) break;
                if (intento < 2) {
                    const delay = Math.pow(2, intento) * 1000;
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
    }

    throw ultimoError || new Error('No se pudo extraer la factura con ningún modelo.');
}

// ==============================================
// FACTURAS DE CHEQUES — Claude (alternativa a Gemini)
// ==============================================

/**
 * Llama a Claude (Anthropic) para extraer datos de una factura.
 * Misma forma de respuesta que llamarGeminiFacturaCheque para que
 * el resto del flujo sea agnóstico de qué IA respondió.
 */
async function llamarClaudeFactura(apiKey, base64, mimeType = 'application/pdf') {
    const prompt = `Analizá esta factura argentina (factura ARCA/AFIP emitida por un proveedor o contratista) y extraé los datos en formato JSON estricto.

Si un campo no aparece en el documento, poné null. No inventes datos.

Formato de respuesta (solo JSON, sin markdown ni explicaciones):
{
    "numero_factura": "número completo, ej 00002-00000058",
    "fecha": "YYYY-MM-DD de la factura",
    "vendedor_nombre": "razón social del emisor",
    "vendedor_cuit": "CUIT del emisor en formato XX-XXXXXXXX-X",
    "total": número (monto total en pesos, sin separadores ni símbolos)
}`;

    // Document (PDF) o image, según mimeType
    const esImagen = mimeType.startsWith('image/');
    const contenido = esImagen
        ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }
        : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };

    const codigosReintento = [429, 500, 502, 503, 504, 529];
    let ultimoError = null;

    // Hasta 3 intentos con backoff (1s, 2s, 4s)
    for (let intento = 1; intento <= 3; intento++) {
        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-5',
                    max_tokens: 1024,
                    messages: [{
                        role: 'user',
                        content: [contenido, { type: 'text', text: prompt }]
                    }]
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const err = new Error(errorData.error?.message || `Error HTTP ${response.status}`);
                err.status = response.status;
                throw err;
            }

            const result = await response.json();
            const texto = result.content?.[0]?.text;
            if (!texto) throw new Error('Claude no devolvió respuesta.');

            let jsonStr = texto.trim();
            if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\s*$/g, '').trim();
            }
            return JSON.parse(jsonStr);
        } catch (err) {
            ultimoError = err;
            const reintentable = codigosReintento.includes(err.status);
            if (!reintentable) break;
            if (intento < 3) {
                await new Promise(r => setTimeout(r, Math.pow(2, intento - 1) * 1000));
            }
        }
    }

    throw ultimoError || new Error('No se pudo extraer la factura con Claude.');
}

/**
 * Abre un modal de solo lectura con todos los datos del cheque,
 * incluyendo los datos de la factura adjunta si existe.
 */
function verDetalleCheque(id) {
    const m = movimientosTesoreria.find(x => x.id === id);
    if (!m) { mostrarError('No se encontró el movimiento.'); return; }

    chequeDetalleActualId = id;

    const cuenta = cuentas.find(c => c.id === m.cuenta_bancaria_id);

    const filaEstado =
        m.estado === 'futuro'    ? `<span class="badge badge-futuro">Futuro</span>` :
        m.estado === 'pendiente' ? `<span class="badge badge-pendiente-pago">Pendiente</span>` :
        m.estado === 'cobrado'   ? `<span class="badge badge-cobrado">Cobrado</span>` :
                                   `<span class="badge badge-anulado">Anulado</span>`;

    const fila = (label, valor) => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--color-borde);font-size:var(--texto-sm);">
            <span style="color:var(--color-texto-tenue);">${label}</span>
            <span style="color:var(--color-texto);font-weight:500;text-align:right;">${valor}</span>
        </div>
    `;

    const contenido = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--espacio-lg);">
            <div>
                <div style="font-size:var(--texto-xs);font-weight:600;color:var(--color-texto-secundario);margin-bottom:var(--espacio-xs);text-transform:uppercase;letter-spacing:0.05em;">${m.es_echeck ? '📱 E-CHEQUE' : 'CHEQUE'}</div>
                ${fila('Nro. cheque', `<span style="font-family:var(--fuente-mono);">${m.numero_cheque || '—'}</span>`)}
                ${fila('Cuenta', cuenta?.alias || cuenta?.banco || '—')}
                ${fila('F. emisión', m.fecha_emision ? formatearFecha(m.fecha_emision) : '—')}
                ${fila('F. cobro', formatearFecha(m.fecha_cobro))}
                ${fila('F. balde', formatearFecha(m.fecha_balde))}
                ${fila('Monto', `<span style="font-family:var(--fuente-mono);">$ ${formatearNumero(m.monto)}</span>`)}
                ${fila('Estado', filaEstado)}
                ${m.fecha_cobrado_real ? fila('Cobrado el', formatearFecha(m.fecha_cobrado_real)) : ''}
            </div>
            <div>
                <div style="font-size:var(--texto-xs);font-weight:600;color:var(--color-texto-secundario);margin-bottom:var(--espacio-xs);text-transform:uppercase;letter-spacing:0.05em;">DESTINO</div>
                ${fila('Beneficiario', m.beneficiarios?.nombre || '—')}
                ${fila('Tipo', badgeTipoBen(m.beneficiarios?.tipo))}
                ${fila('Categoría', m.categorias_gasto?.nombre || '—')}
                ${m.empleado_entrega ? fila('Entregado por', m.empleado_entrega.nombre) : ''}
                ${m.notas ? fila('Notas', m.notas) : ''}
            </div>
        </div>
        <div id="bloque-facturas-detalle" style="margin-top:var(--espacio-md);">
            ${renderizarSeccionFacturasCheque(m, true)}
        </div>
    `;

    const puedeEditar = ['admin_total', 'admin'].includes(window.__USUARIO__?.rol);
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cerrar</button>
        ${m.es_echeck && m.pdf_url ? `<button class="btn-secundario" onclick="verPDFEcheck('${m.pdf_url}')">Ver PDF</button>` : ''}
        ${puedeEditar && m.estado === 'anulado' ? `<button class="btn-secundario" style="color:var(--color-verde);border-color:var(--color-verde);" onclick="reactivarCheque('${m.id}')">Reactivar</button>` : ''}
        ${puedeEditar ? `<button class="btn-primario" onclick="cerrarModal(); editarMovimiento('${m.id}')">Editar</button>` : ''}
    `;

    abrirModal('Detalle del movimiento', contenido, footer);
}

/**
 * Abre el PDF del e-cheque en una pestaña nueva (signed URL de 5 minutos).
 */
async function verPDFEcheck(path) {
    if (!path) return;
    try {
        const { data, error } = await db.storage
            .from('echecks')
            .createSignedUrl(path, 300);
        if (error || !data?.signedUrl) throw new Error(error?.message || 'No se pudo generar el link.');
        window.open(data.signedUrl, '_blank');
    } catch (err) {
        mostrarError('No se pudo abrir el PDF: ' + err.message);
    }
}

/**
 * Renderiza la sección de facturas vinculadas al cheque.
 * Se separa para poder refrescarla sin cerrar el modal.
 */
function renderizarSeccionFacturasCheque(m, soloLectura = false) {
    const estadoFact = estadoFacturaMovimiento(m);
    // En modo solo-lectura (ojito) se ocultan TODOS los botones de modificación,
    // incluso para admins. Para editar facturas hay que pasar al modal de "Editar".
    const puedeEditar = !soloLectura && ['admin_total', 'admin'].includes(window.__USUARIO__?.rol);

    if (estadoFact === 'na') {
        return `
            <div style="padding:var(--espacio-md);background:var(--color-fondo-secundario);border-radius:var(--radio-md);color:var(--color-texto-tenue);font-size:var(--texto-sm);">
                No corresponde factura para este movimiento.
            </div>
        `;
    }

    const facturas = m.facturas_vinculadas || [];
    const chequeId = m.id;

    const botones = puedeEditar ? `
        <div style="display:flex;gap:var(--espacio-xs);">
            <button class="btn-primario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="subirNuevaFacturaAlCheque('${chequeId}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Subir nueva
            </button>
            <button class="btn-secundario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="abrirModalVincularFactura('${chequeId}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                Vincular existente
            </button>
        </div>
    ` : '';

    if (facturas.length === 0) {
        return `
            <div style="padding:var(--espacio-md);background:rgba(201,76,76,0.06);border:1px solid var(--color-error);border-radius:var(--radio-md);">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--espacio-sm);flex-wrap:wrap;">
                    <div style="display:flex;align-items:center;gap:var(--espacio-xs);color:var(--color-error);">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        <strong>Falta la factura</strong>
                    </div>
                    ${botones}
                </div>
            </div>
        `;
    }

    // Aviso de inconsistencia entre montos.
    // Estrategia general: armar el "cluster" de facturas y cheques relacionados
    // entre sí, y comparar sum(facturas del cluster) vs sum(cheques del cluster).
    // Esto cubre:
    //   - 1 cheque ↔ N facturas
    //   - 1 factura ↔ N cheques
    //   - N cheques ↔ M facturas (M:N completo)
    // Si el cluster cuadra, no avisamos. Si no cuadra y los cheques son los mismos
    // para todas las facturas, mostramos un mensaje sumarizado. Si las facturas
    // están cubiertas por sub-conjuntos distintos, caemos al chequeo individual.
    const facturasConMonto = facturas.filter(f => Number(f.monto_total || 0) > 0);

    let avisoMonto = '';
    if (facturasConMonto.length > 0) {
        // Reunir todos los cheques que cubren al menos una de estas facturas
        const clusterChequeIds = new Set();
        facturasConMonto.forEach(f => (f._cheques_ids || []).forEach(id => clusterChequeIds.add(id)));

        // ¿Todas las facturas están cubiertas por exactamente el mismo set de cheques?
        const todasMismoSet = facturasConMonto.every(f => {
            const ids = f._cheques_ids || [];
            return ids.length === clusterChequeIds.size && ids.every(id => clusterChequeIds.has(id));
        });

        if (todasMismoSet) {
            // Caso unificado: el set de cheques cubre el set de facturas.
            // Sumamos ambos lados y comparamos.
            const sumaFact = facturasConMonto.reduce((s, f) => s + Number(f.monto_total), 0);
            const sumaCheq = [...clusterChequeIds].reduce((s, id) => {
                const ch = movimientosTesoreria.find(x => x.id === id);
                return s + Number(ch?.monto || 0);
            }, 0);
            const diferencia = sumaFact - sumaCheq;
            const nF = facturasConMonto.length;
            const nC = clusterChequeIds.size;
            const cuadra = sumaCheq > 0 && Math.abs(diferencia) <= 1;

            if (cuadra) {
                // Resumen informativo verde (cuando cuadra)
                avisoMonto = `
                    <div style="margin-top:var(--espacio-sm);padding:var(--espacio-sm);background:rgba(74,158,110,0.10);border:1px solid var(--color-verde);border-radius:var(--radio-sm,4px);font-size:var(--texto-xs);color:var(--color-verde);">
                        <div style="display:flex;align-items:flex-start;gap:var(--espacio-xs);">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;margin-top:2px;"><polyline points="20 6 9 17 4 12"/></svg>
                            <div>
                                <div style="font-weight:600;margin-bottom:4px;">Montos cuadran</div>
                                <div>${nF} factura${nF !== 1 ? 's' : ''} por <strong>$ ${formatearNumero(sumaFact)}</strong> · ${nC} cheque${nC !== 1 ? 's' : ''} por <strong>$ ${formatearNumero(sumaCheq)}</strong></div>
                            </div>
                        </div>
                    </div>
                `;
            } else if (sumaCheq > 0) {
                // Aviso amarillo (cuando no cuadra)
                avisoMonto = `
                    <div style="margin-top:var(--espacio-sm);padding:var(--espacio-sm);background:rgba(232,183,74,0.10);border:1px solid #e8b74a;border-radius:var(--radio-sm,4px);font-size:var(--texto-xs);color:#e8b74a;">
                        <div style="display:flex;align-items:flex-start;gap:var(--espacio-xs);">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;margin-top:2px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                            <div>
                                <div style="font-weight:600;margin-bottom:4px;">Atención: monto no cuadra</div>
                                <div>${nF} factura${nF !== 1 ? 's' : ''} por <strong>$ ${formatearNumero(sumaFact)}</strong> · ${nC} cheque${nC !== 1 ? 's' : ''} por <strong>$ ${formatearNumero(sumaCheq)}</strong></div>
                                <div style="margin-top:2px;">Diferencia: $ ${formatearNumero(Math.abs(diferencia))} ${diferencia > 0 ? '(las facturas superan)' : '(los cheques superan)'}</div>
                            </div>
                        </div>
                    </div>
                `;
            }
        } else {
            // Caso heterogéneo: las facturas están cubiertas por sub-conjuntos
            // distintos de cheques. Mostramos chequeo individual.
            const inconsistentes = facturasConMonto.filter(f =>
                Math.abs(Number(f.monto_total) - Number(f._total_cheques || 0)) > 1
            );
            if (inconsistentes.length > 0) {
                const detalles = inconsistentes.map(f => {
                    const cantCheques = (f._cheques_ids || []).length;
                    const chequeTxt = cantCheques === 1 ? '1 cheque' : `${cantCheques} cheques`;
                    return `<li>Factura ${f.numero || '(sin nº)'}: $ ${formatearNumero(f.monto_total)} — cubierta por ${chequeTxt} por un total de $ ${formatearNumero(f._total_cheques || 0)}</li>`;
                }).join('');
                avisoMonto = `
                    <div style="margin-top:var(--espacio-sm);padding:var(--espacio-sm);background:rgba(232,183,74,0.10);border:1px solid #e8b74a;border-radius:var(--radio-sm,4px);font-size:var(--texto-xs);color:#e8b74a;">
                        <div style="display:flex;align-items:flex-start;gap:var(--espacio-xs);">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;margin-top:2px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                            <div>
                                <div style="font-weight:600;margin-bottom:4px;">Atención: monto no cuadra (facturas compartidas)</div>
                                <ul style="margin:0;padding-left:16px;">${detalles}</ul>
                            </div>
                        </div>
                    </div>
                `;
            }
        }
    }

    const filasFact = facturas.map(f => {
        const sinDatos = !f.numero && !f.fecha && !f.emisor_cuit && !f.monto_total;
        const botonesIA = puedeEditar && sinDatos ? `
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
                <button class="btn-primario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="extraerDatosFacturaDB('${f.id}', 'gemini')" title="Extraer datos del PDF con Gemini (Google · gratis)">
                    ✨ Extraer con Gemini
                </button>
                <button class="btn-primario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="extraerDatosFacturaDB('${f.id}', 'claude')" title="Extraer datos del PDF con Claude (Anthropic · pago)">
                    ✨ Extraer con Claude
                </button>
            </div>
        ` : '';

        return `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--espacio-sm);padding:var(--espacio-sm);border-bottom:1px solid var(--color-borde);flex-wrap:wrap;">
            <div style="flex:1;min-width:180px;">
                <div style="font-size:var(--texto-sm);font-weight:500;color:var(--color-texto);">
                    <span style="font-family:var(--fuente-mono);">${f.numero || '(sin nº — pendiente de extraer)'}</span>
                    ${f.emisor_nombre ? `<span style="color:var(--color-texto-tenue);"> · ${f.emisor_nombre}</span>` : ''}
                </div>
                <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);margin-top:2px;">
                    ${f.fecha ? formatearFecha(f.fecha) : 'Sin fecha'}
                    ${f.monto_total ? ` · $ ${formatearNumero(f.monto_total)}` : ''}
                    ${f.emisor_cuit ? ` · CUIT ${f.emisor_cuit}` : ''}
                </div>
                ${(f._cheques_ids || []).length > 1 ? `
                    <div style="font-size:var(--texto-xs);color:var(--color-dorado);margin-top:2px;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:-1px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                        Vinculada a ${f._cheques_ids.length} cheques (total $ ${formatearNumero(f._total_cheques || 0)})
                    </div>
                ` : ''}
                ${botonesIA}
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;">
                <button class="btn-secundario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="verFacturaCheque('${f.archivo_url}')" title="Ver PDF">Ver</button>
                ${puedeEditar ? `
                    <button class="btn-secundario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="abrirModalEditarFactura('${f.id}')" title="Editar datos de la factura">Editar</button>
                    <button class="btn-secundario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="desvincularFactura('${chequeId}', '${f.id}')" title="Desvincular del cheque (la factura sigue existiendo)">Desvincular</button>
                    <button class="btn-secundario" style="padding:4px 10px;font-size:var(--texto-xs);color:var(--color-error);border-color:var(--color-error);" onclick="eliminarFacturaParaSiempre('${f.id}')" title="Eliminar la factura de todos los cheques y del sistema">🗑</button>
                ` : ''}
            </div>
        </div>
        `;
    }).join('');

    return `
        <div style="padding:var(--espacio-md);background:rgba(74,158,110,0.05);border:1px solid var(--color-verde);border-radius:var(--radio-md);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--espacio-sm);margin-bottom:var(--espacio-sm);flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:var(--espacio-xs);font-weight:600;color:var(--color-verde);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><polyline points="20 6 9 17 4 12"/></svg>
                    ${facturas.length} factura${facturas.length !== 1 ? 's' : ''} vinculada${facturas.length !== 1 ? 's' : ''}
                </div>
                ${botones}
            </div>
            <div style="border:1px solid var(--color-borde);border-radius:var(--radio-sm,4px);background:var(--color-fondo-tarjeta);">
                ${filasFact}
            </div>
            ${avisoMonto}
        </div>
    `;
}

/**
 * Refresca la sección de facturas dentro del modal de detalle sin cerrarlo.
 * Requiere que cargarTesoreria haya refrescado movimientosTesoreria.
 */
function refrescarSeccionFacturasDetalle() {
    // Refresca el modal del ojito (read-only) si está abierto
    if (chequeDetalleActualId) {
        const cont = document.getElementById('bloque-facturas-detalle');
        const m = movimientosTesoreria.find(x => x.id === chequeDetalleActualId);
        if (cont && m) cont.innerHTML = renderizarSeccionFacturasCheque(m, true);
    }
    // Refresca el modal de edición (con botones) si está abierto
    refrescarSeccionFacturasEdicion();
}

/**
 * Refresca la sección de facturas dentro del modal de EDICIÓN del cheque
 * (con todos los botones). Análoga a refrescarSeccionFacturasDetalle()
 * pero apuntando al bloque del modal de edición. Se llama después de
 * agregar/quitar/editar una factura para que el cambio se vea sin cerrar.
 */
function refrescarSeccionFacturasEdicion() {
    if (!chequeEditandoId) return;
    const cont = document.getElementById('bloque-facturas-edicion');
    if (!cont) return;
    const m = movimientosTesoreria.find(x => x.id === chequeEditandoId);
    if (!m) return;
    cont.innerHTML = renderizarSeccionFacturasCheque(m, false);
}

// ==============================================
// FACTURAS PENDIENTES (modo creación de cheque)
// Se acumulan en facturasPendientesNuevas y se aplican
// recién al guardar el cheque, cuando ya hay chequeId.
// ==============================================

/**
 * Renderiza la sección de facturas dentro del modal de CREACIÓN.
 * Muestra: lista de facturas en memoria + botones [Subir nueva] / [Vincular existente]
 * + panel inline de búsqueda (oculto por defecto).
 */
function renderizarSeccionFacturasPendientes() {
    const items = facturasPendientesNuevas;

    const filas = items.map(p => {
        const titulo = p.numero ? `Factura ${p.numero}` : (p.tipo === 'nueva' ? `Archivo: ${p.file?.name || 'PDF'}` : 'Factura sin número');
        const sub = [
            p.fecha ? `Fecha: ${formatearFecha(p.fecha)}` : null,
            p.emisor_nombre ? p.emisor_nombre : null,
            p.emisor_cuit ? `CUIT ${p.emisor_cuit}` : null,
            p.monto_total ? `$ ${formatearNumero(p.monto_total)}` : null,
            p.tipo === 'existente' ? '<span style="color:var(--color-dorado);">(ya existe en el sistema)</span>' : '<span style="color:var(--color-texto-tenue);">(nueva, se subirá al guardar)</span>'
        ].filter(Boolean).join(' · ');

        // Si es 'nueva' y todavía no se extrajeron datos → mostrar los dos botones de IA
        const mostrarBotonesIA = p.tipo === 'nueva' && !p.extraido && !(p.numero || p.fecha || p.emisor_cuit || p.monto_total);
        const botonesExtraccion = mostrarBotonesIA ? `
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
                <button class="btn-primario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="extraerDatosPendiente('${p.tempId}', 'gemini')" title="Extraer datos del PDF con Gemini (Google · gratis)">
                    ✨ Extraer con Gemini
                </button>
                <button class="btn-primario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="extraerDatosPendiente('${p.tempId}', 'claude')" title="Extraer datos del PDF con Claude (Anthropic · pago)">
                    ✨ Extraer con Claude
                </button>
            </div>
        ` : '';

        return `
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--espacio-sm);padding:var(--espacio-sm) var(--espacio-md);border-bottom:1px solid var(--color-borde);">
                <div style="min-width:0;flex:1;">
                    <div style="font-weight:600;color:var(--color-texto);">${titulo}</div>
                    <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);margin-top:2px;">${sub}</div>
                    ${botonesExtraccion}
                </div>
                <button class="btn-secundario" style="padding:4px 10px;font-size:var(--texto-xs);flex-shrink:0;" onclick="quitarFacturaPendiente('${p.tempId}')">Quitar</button>
            </div>
        `;
    }).join('');

    const cabecera = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--espacio-sm);padding:var(--espacio-sm) var(--espacio-md);background:var(--color-fondo-secundario);border-bottom:1px solid var(--color-borde);">
            <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">
                ${items.length === 0 ? 'Sin facturas adjuntas' : `${items.length} factura${items.length !== 1 ? 's' : ''} pendiente${items.length !== 1 ? 's' : ''} de guardar`}
            </div>
            <div style="display:flex;gap:var(--espacio-xs);">
                <button class="btn-primario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="agregarFacturaPendienteNueva()">+ Subir nueva</button>
                <button class="btn-secundario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="alternarPanelVincularPendiente()">🔗 Vincular existente</button>
            </div>
        </div>
    `;

    const lista = items.length === 0
        ? `<div style="padding:var(--espacio-md);text-align:center;font-size:var(--texto-xs);color:var(--color-texto-tenue);">Si todavía no tenés la factura, podés saltear y subirla más tarde.</div>`
        : filas;

    const panelVincular = `
        <div id="panel-vincular-pendiente" style="display:none;border-top:1px solid var(--color-borde);padding:var(--espacio-md);">
            <input type="text" id="buscador-factura-pendiente" class="campo-input"
                placeholder="Nº de factura, CUIT o emisor..." oninput="filtrarFacturasParaPendiente()">
            <div id="lista-facturas-pendiente" style="max-height:240px;overflow-y:auto;margin-top:var(--espacio-sm);"></div>
        </div>
    `;

    return `
        <div style="border:1px solid var(--color-borde);border-radius:var(--radio-md);overflow:hidden;">
            ${cabecera}
            ${lista}
            ${panelVincular}
        </div>
    `;
}

function refrescarSeccionFacturasPendientes() {
    const cont = document.getElementById('bloque-facturas-pendientes');
    if (cont) cont.innerHTML = renderizarSeccionFacturasPendientes();
}

function quitarFacturaPendiente(tempId) {
    facturasPendientesNuevas = facturasPendientesNuevas.filter(p => p.tempId !== tempId);
    refrescarSeccionFacturasPendientes();
}

/**
 * Extrae datos de una factura pendiente (en memoria) con la IA elegida.
 * Actualiza el item en facturasPendientesNuevas y re-renderiza.
 */
async function extraerDatosPendiente(tempId, ia) {
    const p = facturasPendientesNuevas.find(x => x.tempId === tempId);
    if (!p || p.tipo !== 'nueva' || !p.file) return;

    const apiKey = ia === 'gemini'
        ? window.__ENV__?.GEMINI_API_KEY
        : window.__ENV__?.ANTHROPIC_API_KEY;
    if (!apiKey) {
        mostrarError(`La API Key de ${ia === 'gemini' ? 'Gemini' : 'Claude'} no está configurada.`);
        return;
    }

    mostrarAlerta(`Extrayendo datos con ${ia === 'gemini' ? 'Gemini' : 'Claude'}... puede tardar unos segundos.`, 'info');

    try {
        const base64 = await archivoABase64Cheque(p.file);
        const datos = ia === 'gemini'
            ? await llamarGeminiFacturaCheque(apiKey, base64, p.mimeType)
            : await llamarClaudeFactura(apiKey, base64, p.mimeType);

        p.numero        = datos?.numero_factura  || null;
        p.fecha         = datos?.fecha           || null;
        p.emisor_cuit   = datos?.vendedor_cuit   || null;
        p.emisor_nombre = datos?.vendedor_nombre || null;
        p.monto_total   = datos?.total ? Number(datos.total) : null;
        p.extraido      = true;

        refrescarSeccionFacturasPendientes();
        mostrarExito(`Datos extraídos con ${ia === 'gemini' ? 'Gemini' : 'Claude'}.`);
    } catch (err) {
        console.error(`${ia} falló al extraer factura:`, err);
        mostrarError(`No se pudo extraer con ${ia === 'gemini' ? 'Gemini' : 'Claude'}: ${err.message}. Probá la otra IA o cargá los datos a mano.`);
    }
}

/**
 * "+ Subir nueva" en modo creación.
 * Pide el archivo, lo lee a base64, llama a Gemini, y agrega el item a la lista
 * en memoria. NO sube nada al servidor todavía.
 */
async function agregarFacturaPendienteNueva() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,image/*';
    input.style.display = 'none';

    input.onchange = async () => {
        const file = input.files?.[0];
        document.body.removeChild(input);
        if (!file) return;

        const mimeType = file.type?.startsWith('image/') ? file.type : 'application/pdf';

        // Solo subimos el archivo a memoria. Los datos se extraen recién cuando el
        // usuario toca [Extraer con Gemini] o [Extraer con Claude] en la fila.
        const item = {
            tempId: 'tmp_' + Math.random().toString(36).slice(2),
            tipo:   'nueva',
            file,
            mimeType,
            numero:        null,
            fecha:         null,
            emisor_cuit:   null,
            emisor_nombre: null,
            monto_total:   null,
            extraido:      false   // marca para mostrar los botones de IA
        };
        facturasPendientesNuevas.push(item);
        refrescarSeccionFacturasPendientes();
        mostrarExito('Factura agregada. Elegí Gemini o Claude para extraer los datos, o dejala así si querés cargar a mano.');
    };

    document.body.appendChild(input);
    input.click();
}

/**
 * Toggle del panel inline de "Vincular existente" en modo creación.
 * Al abrirlo, carga las facturas de la empresa activa.
 */
async function alternarPanelVincularPendiente() {
    const panel = document.getElementById('panel-vincular-pendiente');
    if (!panel) return;

    if (panel.style.display === 'none') {
        // Cargar facturas
        const facturas = await ejecutarConsulta(
            db.from('facturas').select('*').eq('empresa_id', empresaActivaId).order('fecha', { ascending: false }),
            'cargar facturas para vincular'
        ) || [];
        // Excluir las que ya están en la lista pendiente
        const idsPend = new Set(facturasPendientesNuevas.filter(p => p.tipo === 'existente').map(p => p.factura_id));
        window.__facturasParaPendiente = facturas.filter(f => !idsPend.has(f.id));
        panel.style.display = 'block';
        filtrarFacturasParaPendiente();
        document.getElementById('buscador-factura-pendiente')?.focus();
    } else {
        panel.style.display = 'none';
    }
}

function filtrarFacturasParaPendiente() {
    const q = (document.getElementById('buscador-factura-pendiente')?.value || '').toLowerCase().trim();
    const lista = window.__facturasParaPendiente || [];
    const filt = !q ? lista : lista.filter(f => {
        const tokens = [f.numero, f.emisor_cuit, f.emisor_nombre].filter(Boolean).join(' ').toLowerCase();
        return tokens.includes(q);
    });
    const cont = document.getElementById('lista-facturas-pendiente');
    if (!cont) return;
    if (filt.length === 0) {
        cont.innerHTML = `<div style="padding:var(--espacio-md);text-align:center;font-size:var(--texto-xs);color:var(--color-texto-tenue);">${lista.length === 0 ? 'No hay facturas cargadas en esta empresa todavía.' : 'Ninguna factura coincide con la búsqueda.'}</div>`;
        return;
    }
    cont.innerHTML = filt.map(f => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--espacio-sm);padding:var(--espacio-sm);border-bottom:1px solid var(--color-borde);">
            <div style="min-width:0;flex:1;">
                <div style="font-weight:600;font-size:var(--texto-sm);">${f.numero || '(sin nº)'}${f.monto_total ? ' — $ ' + formatearNumero(f.monto_total) : ''}</div>
                <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">
                    ${[f.emisor_nombre, f.emisor_cuit, f.fecha ? formatearFecha(f.fecha) : null].filter(Boolean).join(' · ')}
                </div>
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;">
                <button class="btn-secundario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="verFacturaCheque('${f.archivo_url}')">Ver</button>
                <button class="btn-primario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="elegirFacturaParaPendiente('${f.id}')">Vincular</button>
            </div>
        </div>
    `).join('');
}

function elegirFacturaParaPendiente(facturaId) {
    const lista = window.__facturasParaPendiente || [];
    const f = lista.find(x => x.id === facturaId);
    if (!f) return;
    facturasPendientesNuevas.push({
        tempId: 'tmp_' + Math.random().toString(36).slice(2),
        tipo:   'existente',
        factura_id:    f.id,
        archivo_url:   f.archivo_url,
        numero:        f.numero,
        fecha:         f.fecha,
        emisor_cuit:   f.emisor_cuit,
        emisor_nombre: f.emisor_nombre,
        monto_total:   f.monto_total
    });
    refrescarSeccionFacturasPendientes();
    mostrarExito('Factura agregada. Se vinculará al guardar el cheque.');
}

/**
 * Procesa la lista de facturas pendientes después de crear el cheque.
 * Para cada item:
 *   - 'existente': inserta fila en cheques_facturas
 *   - 'nueva':     dedup por (numero+cuit), si existe vincula; si no, sube PDF + crea factura + vincula
 * Devuelve { exitos, errores: string[] }.
 */
async function procesarFacturasPendientesParaCheque(chequeId, empresaId) {
    let exitos = 0;
    const errores = [];

    for (const p of facturasPendientesNuevas) {
        try {
            if (p.tipo === 'existente') {
                const { error } = await db.from('cheques_facturas')
                    .insert({ cheque_id: chequeId, factura_id: p.factura_id });
                if (error) throw error;
                exitos++;
                continue;
            }

            // tipo 'nueva' — primero dedup
            let facturaIdExistente = null;
            if (p.numero) {
                const q = db.from('facturas').select('id').eq('numero', p.numero);
                const finalQ = p.emisor_cuit ? q.eq('emisor_cuit', p.emisor_cuit) : q.is('emisor_cuit', null);
                const { data: dups, error: errDup } = await finalQ;
                if (errDup) throw errDup;
                if (dups && dups.length > 0) facturaIdExistente = dups[0].id;
            }

            if (facturaIdExistente) {
                // Ya existe: solo vincular (no se sube el archivo de nuevo)
                const { error } = await db.from('cheques_facturas')
                    .insert({ cheque_id: chequeId, factura_id: facturaIdExistente });
                if (error) throw error;
                exitos++;
                continue;
            }

            // Subir archivo
            const ext = (p.file.name.split('.').pop() || 'pdf').toLowerCase();
            const extOk = ['pdf', 'jpg', 'jpeg', 'png'].includes(ext) ? ext : 'pdf';
            const path = `${chequeId}/${Date.now()}.${extOk}`;
            const { error: upErr } = await db.storage
                .from('facturas-cheques')
                .upload(path, p.file, { upsert: false });
            if (upErr) throw upErr;

            // Insertar factura
            const { data: nueva, error: insErr } = await db.from('facturas').insert({
                numero:        p.numero,
                fecha:         p.fecha,
                emisor_cuit:   p.emisor_cuit,
                emisor_nombre: p.emisor_nombre,
                monto_total:   p.monto_total,
                archivo_url:   path,
                empresa_id:    empresaId,
                creado_por:    window.__USUARIO__?.id || null
            }).select().single();
            if (insErr) {
                await db.storage.from('facturas-cheques').remove([path]);
                throw insErr;
            }

            // Vincular
            const { error: vincErr } = await db.from('cheques_facturas')
                .insert({ cheque_id: chequeId, factura_id: nueva.id });
            if (vincErr) {
                await db.from('facturas').delete().eq('id', nueva.id);
                await db.storage.from('facturas-cheques').remove([path]);
                throw vincErr;
            }
            exitos++;
        } catch (err) {
            console.error('Error procesando factura pendiente:', err);
            errores.push(p.numero || p.file?.name || 'sin nombre');
        }
    }

    facturasPendientesNuevas = [];
    return { exitos, errores };
}

/**
 * Genera un signed URL y abre la factura en una pestaña nueva.
 */
async function verFacturaCheque(path) {
    if (!path) return;
    try {
        const { data, error } = await db.storage
            .from('facturas-cheques')
            .createSignedUrl(path, 300); // 5 minutos
        if (error) throw error;
        window.open(data.signedUrl, '_blank');
    } catch (err) {
        mostrarError('No se pudo abrir la factura: ' + err.message);
    }
}

// ==============================================
// GESTIÓN DE FACTURAS VINCULADAS A CHEQUES (N:N)
// ==============================================

/**
 * Dispara un <input type=file> oculto para que el usuario elija un archivo
 * de factura, lo extrae con Gemini, verifica duplicados y crea+vincula
 * la factura al cheque dado.
 */
async function subirNuevaFacturaAlCheque(chequeId) {
    // Crear input temporal oculto
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,image/*';
    input.style.display = 'none';

    input.onchange = async () => {
        const file = input.files?.[0];
        document.body.removeChild(input);
        if (!file) return;
        await procesarSubidaFacturaNueva(chequeId, file);
    };

    document.body.appendChild(input);
    input.click();
}

/**
 * Pipeline: Gemini → dedup (numero+CUIT) → crear o reusar factura → upload PDF → vincular.
 */
async function procesarSubidaFacturaNueva(chequeId, file) {
    const cheque = movimientosTesoreria.find(m => m.id === chequeId);
    if (!cheque) { mostrarError('No se encontró el cheque.'); return; }

    // Subir archivo a Storage (sin extraer datos todavía)
    const extOriginal = file.name.split('.').pop().toLowerCase();
    const ext = ['pdf', 'jpg', 'jpeg', 'png'].includes(extOriginal) ? extOriginal : 'pdf';
    const path = `${chequeId}/${Date.now()}.${ext}`;

    try {
        const { error: upErr } = await db.storage
            .from('facturas-cheques')
            .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
    } catch (err) {
        mostrarError('No se pudo subir el archivo: ' + err.message);
        return;
    }

    // Insertar factura sin datos (los va a completar la IA cuando el usuario elija una)
    const insertadas = await ejecutarConsulta(
        db.from('facturas').insert({
            numero:        null,
            fecha:         null,
            emisor_cuit:   null,
            emisor_nombre: null,
            monto_total:   null,
            archivo_url:   path,
            empresa_id:    cheque.empresa_id,
            creado_por:    window.__USUARIO__?.id || null
        }).select(),
        'crear factura'
    );

    if (!insertadas || insertadas.length === 0) {
        await db.storage.from('facturas-cheques').remove([path]);
        return;
    }

    const nuevaFacturaId = insertadas[0].id;

    // Vincular
    const vincOk = await ejecutarConsulta(
        db.from('cheques_facturas').insert({ cheque_id: chequeId, factura_id: nuevaFacturaId }),
        'vincular factura al cheque'
    );
    if (vincOk === undefined) {
        await db.from('facturas').delete().eq('id', nuevaFacturaId);
        await db.storage.from('facturas-cheques').remove([path]);
        return;
    }

    mostrarExito('Factura subida. Elegí Gemini o Claude en la fila para extraer los datos.');
    await cargarTesoreria();
    refrescarSeccionFacturasDetalle();
}

/**
 * Extrae datos de una factura ya subida a Storage.
 * Descarga el PDF, lo manda a la IA elegida, y actualiza la fila en facturas.
 * Después detecta si el (numero+cuit) ya existe en otra factura → avisa para deduplicar.
 */
async function extraerDatosFacturaDB(facturaId, ia) {
    const apiKey = ia === 'gemini'
        ? window.__ENV__?.GEMINI_API_KEY
        : window.__ENV__?.ANTHROPIC_API_KEY;
    if (!apiKey) {
        mostrarError(`La API Key de ${ia === 'gemini' ? 'Gemini' : 'Claude'} no está configurada.`);
        return;
    }

    const { data: f, error } = await db.from('facturas').select('*').eq('id', facturaId).single();
    if (error || !f) { mostrarError('No se encontró la factura.'); return; }

    mostrarAlerta(`Extrayendo datos con ${ia === 'gemini' ? 'Gemini' : 'Claude'}... puede tardar unos segundos.`, 'info');

    try {
        // Descargar el PDF desde Storage con URL firmada
        const { data: urlData, error: urlErr } = await db.storage
            .from('facturas-cheques')
            .createSignedUrl(f.archivo_url, 300);
        if (urlErr || !urlData?.signedUrl) throw new Error('No se pudo acceder al PDF.');

        const resp = await fetch(urlData.signedUrl);
        const blob = await resp.blob();
        const base64 = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result.split(',')[1]);
            r.onerror = reject;
            r.readAsDataURL(blob);
        });

        const mimeType = blob.type?.startsWith('image/') ? blob.type : 'application/pdf';
        const datos = ia === 'gemini'
            ? await llamarGeminiFacturaCheque(apiKey, base64, mimeType)
            : await llamarClaudeFactura(apiKey, base64, mimeType);

        const numero     = datos?.numero_factura || null;
        const fecha      = datos?.fecha || null;
        const emisorCuit = datos?.vendedor_cuit || null;
        const emisorNom  = datos?.vendedor_nombre || null;
        const montoTotal = datos?.total ? Number(datos.total) : null;

        const { error: updErr } = await db.from('facturas')
            .update({
                numero, fecha,
                emisor_cuit: emisorCuit,
                emisor_nombre: emisorNom,
                monto_total: montoTotal
            })
            .eq('id', facturaId);
        if (updErr) {
            // Si la dedup constraint salta, avisamos
            if (String(updErr.message || '').includes('duplicate') || updErr.code === '23505') {
                mostrarAlerta(`Esta factura (Nº ${numero}${emisorCuit ? ', CUIT ' + emisorCuit : ''}) ya está cargada en el sistema. Considerá eliminar esta y vincular la existente con el botón "🔗 Vincular existente".`);
            } else {
                mostrarError('No se pudo guardar los datos extraídos: ' + updErr.message);
            }
            return;
        }

        await cargarTesoreria();
        refrescarSeccionFacturasDetalle();

        // Aviso si el monto no coincide con el cheque
        const cheque = movimientosTesoreria.find(m =>
            (m.facturas_vinculadas || []).some(fv => fv.id === facturaId)
        );
        const montoCheque = Number(cheque?.monto || 0);
        if (montoTotal && montoCheque && Math.abs(montoTotal - montoCheque) > 1) {
            mostrarAlerta(`Datos extraídos. Atención: el total de la factura ($ ${formatearNumero(montoTotal)}) no coincide con el monto del cheque ($ ${formatearNumero(montoCheque)}).`);
        } else {
            mostrarExito(`Datos extraídos con ${ia === 'gemini' ? 'Gemini' : 'Claude'}.`);
        }
    } catch (err) {
        console.error(`${ia} falló al extraer factura:`, err);
        mostrarError(`No se pudo extraer con ${ia === 'gemini' ? 'Gemini' : 'Claude'}: ${err.message}. Probá la otra IA o cargá los datos a mano.`);
    }
}

/**
 * Modal con buscador de facturas existentes (por número, CUIT o emisor).
 * Al elegir una, la vincula al cheque dado.
 */
async function abrirModalVincularFactura(chequeId) {
    const cheque = movimientosTesoreria.find(m => m.id === chequeId);
    if (!cheque) { mostrarError('No se encontró el cheque.'); return; }

    // Cargar todas las facturas de la empresa del cheque
    const facturas = await ejecutarConsulta(
        db.from('facturas').select('*').eq('empresa_id', cheque.empresa_id).order('fecha', { ascending: false }),
        'cargar facturas para vincular'
    ) || [];

    // IDs de facturas ya vinculadas a este cheque
    const yaVinculadasIds = new Set((cheque.facturas_vinculadas || []).map(f => f.id));

    // Guardar en window para el buscador
    window.__facturasDisponibles = facturas.filter(f => !yaVinculadasIds.has(f.id));
    window.__chequeParaVincular = chequeId;

    const contenido = `
        <div class="campo-grupo">
            <label class="campo-label">Buscar factura</label>
            <input type="text" id="buscador-factura" class="campo-input" placeholder="Nº de factura, CUIT o emisor..." oninput="filtrarFacturasVinculables()" autofocus>
        </div>
        <div id="lista-facturas-vinculables" style="max-height:400px;overflow-y:auto;border:1px solid var(--color-borde);border-radius:var(--radio-md);background:var(--color-fondo-tarjeta);"></div>
    `;

    const footer = `<button class="btn-secundario" onclick="cerrarModal(); abrirDetalleDesdeVincular()">Volver</button>`;

    abrirModal('Vincular factura existente', contenido, footer);
    filtrarFacturasVinculables();
}

function filtrarFacturasVinculables() {
    const q = (document.getElementById('buscador-factura')?.value || '').toLowerCase().trim();
    const lista = window.__facturasDisponibles || [];
    const chequeId = window.__chequeParaVincular;

    const filtradas = !q ? lista : lista.filter(f =>
        (f.numero || '').toLowerCase().includes(q) ||
        (f.emisor_cuit || '').toLowerCase().includes(q) ||
        (f.emisor_nombre || '').toLowerCase().includes(q)
    );

    const cont = document.getElementById('lista-facturas-vinculables');
    if (!cont) return;

    if (filtradas.length === 0) {
        cont.innerHTML = `
            <div style="padding:var(--espacio-lg);text-align:center;color:var(--color-texto-tenue);font-size:var(--texto-sm);">
                ${lista.length === 0 ? 'No hay facturas disponibles para vincular en esta empresa.' : 'Ninguna factura coincide con la búsqueda.'}
            </div>
        `;
        return;
    }

    cont.innerHTML = filtradas.map(f => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--espacio-sm);padding:var(--espacio-sm) var(--espacio-md);border-bottom:1px solid var(--color-borde);">
            <div style="flex:1;min-width:0;">
                <div style="font-size:var(--texto-sm);font-weight:500;color:var(--color-texto);">
                    <span style="font-family:var(--fuente-mono);">${f.numero || '(sin nº)'}</span>
                    ${f.emisor_nombre ? `<span style="color:var(--color-texto-tenue);"> · ${f.emisor_nombre}</span>` : ''}
                </div>
                <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);margin-top:2px;">
                    ${f.fecha ? formatearFecha(f.fecha) : 'Sin fecha'}
                    ${f.monto_total ? ` · $ ${formatearNumero(f.monto_total)}` : ''}
                    ${f.emisor_cuit ? ` · CUIT ${f.emisor_cuit}` : ''}
                </div>
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;">
                <button class="btn-secundario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="verFacturaCheque('${f.archivo_url}')">Ver</button>
                <button class="btn-primario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="vincularFacturaAlCheque('${chequeId}', '${f.id}')">Vincular</button>
            </div>
        </div>
    `).join('');
}

async function vincularFacturaAlCheque(chequeId, facturaId) {
    const ok = await ejecutarConsulta(
        db.from('cheques_facturas').insert({ cheque_id: chequeId, factura_id: facturaId }),
        'vincular factura'
    );
    if (ok === undefined) return;
    mostrarExito('Factura vinculada.');
    cerrarModal();
    await cargarTesoreria();
    // Reabrir el detalle del cheque para que vea el cambio
    verDetalleCheque(chequeId);
}

function abrirDetalleDesdeVincular() {
    const id = window.__chequeParaVincular;
    if (id) verDetalleCheque(id);
}

async function desvincularFactura(chequeId, facturaId) {
    if (!confirm('¿Desvincular esta factura del cheque? La factura seguirá existiendo y podrás volver a vincularla más adelante.')) return;

    const { error } = await db.from('cheques_facturas')
        .delete()
        .eq('cheque_id', chequeId)
        .eq('factura_id', facturaId);

    if (error) {
        mostrarError('No se pudo desvincular: ' + error.message);
        return;
    }

    mostrarExito('Factura desvinculada.');
    await cargarTesoreria();
    refrescarSeccionFacturasDetalle();
}

async function eliminarFacturaParaSiempre(facturaId) {
    // Consultar a cuántos cheques está vinculada para advertir
    const vincs = await ejecutarConsulta(
        db.from('cheques_facturas').select('cheque_id').eq('factura_id', facturaId),
        'consultar vinculaciones'
    ) || [];

    const cant = vincs.length;
    const aviso = cant > 0
        ? `Esta factura está vinculada a ${cant} cheque${cant !== 1 ? 's' : ''}. Al eliminarla, se desvinculará de TODOS y se borrará el archivo PDF.\n\nEsta acción NO se puede deshacer.\n\n¿Eliminar la factura para siempre?`
        : `Esta factura no está vinculada a ningún cheque. Se borrará junto con su archivo PDF.\n\n¿Eliminar para siempre?`;

    if (!confirm(aviso)) return;

    // Obtener el path del archivo antes de borrar la fila
    const { data: facturaData, error: errSelect } = await db.from('facturas').select('archivo_url').eq('id', facturaId).single();
    if (errSelect) {
        mostrarError('No se pudo leer la factura: ' + errSelect.message);
        return;
    }
    const archivoPath = facturaData?.archivo_url;

    // Borrar la factura (CASCADE borra las filas de cheques_facturas)
    const { error: errDel } = await db.from('facturas').delete().eq('id', facturaId);
    if (errDel) {
        mostrarError('No se pudo eliminar la factura: ' + errDel.message);
        return;
    }

    // Borrar el archivo de Storage (no es crítico si falla, la factura ya está borrada)
    if (archivoPath) {
        const { error: errStorage } = await db.storage.from('facturas-cheques').remove([archivoPath]);
        if (errStorage) console.warn('No se pudo borrar el archivo de Storage:', errStorage.message);
    }

    mostrarExito('Factura eliminada para siempre.');
    await cargarTesoreria();
    refrescarSeccionFacturasDetalle();
}

/**
 * Abre un modal para editar los datos de una factura ya cargada
 * (nº, fecha, emisor, CUIT, monto). El PDF no se toca.
 */
async function abrirModalEditarFactura(facturaId) {
    const { data: f, error } = await db.from('facturas').select('*').eq('id', facturaId).single();
    if (error || !f) { mostrarError('No se encontró la factura.'); return; }

    // Guardar el id del cheque actual para volver al detalle después
    const chequeId = chequeDetalleActualId;

    const contenido = `
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Nº de factura</label>
                <input type="text" id="edit-fact-numero" class="campo-input"
                    value="${f.numero || ''}" placeholder="Ej: 00002-00000058">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Fecha</label>
                <input type="text" data-fecha id="edit-fact-fecha" class="campo-input"
                    value="${isoADDMM(f.fecha)}"
                    placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
            </div>
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Emisor (razón social)</label>
                <input type="text" id="edit-fact-emisor-nom" class="campo-input"
                    value="${f.emisor_nombre || ''}" placeholder="Ej: Veron Jorge Omar">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">CUIT emisor</label>
                <input type="text" id="edit-fact-emisor-cuit" class="campo-input"
                    value="${f.emisor_cuit || ''}" placeholder="Ej: 20-12345678-9">
            </div>
        </div>
        <div class="campo-grupo">
            <label class="campo-label">Monto total</label>
            <input type="text" data-monto id="edit-fact-monto" class="campo-input"
                value="${formatearMontoInput(f.monto_total)}" placeholder="Monto total de la factura">
        </div>
        <div style="margin-top:var(--espacio-sm);padding:var(--espacio-sm);background:var(--color-fondo-secundario);border-radius:var(--radio-sm,4px);font-size:var(--texto-xs);color:var(--color-texto-tenue);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            Dejá los campos en blanco si no tenés el dato. El PDF de la factura no se modifica.
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal(); ${chequeId ? `verDetalleCheque('${chequeId}')` : ''}">Cancelar</button>
        <button class="btn-primario" onclick="guardarEdicionFactura('${facturaId}', '${chequeId || ''}')">Guardar</button>
    `;

    abrirModal('Editar datos de la factura', contenido, footer);
}

async function guardarEdicionFactura(facturaId, chequeId) {
    const numero     = document.getElementById('edit-fact-numero')?.value.trim() || null;
    const fecha      = ddmmAISO(document.getElementById('edit-fact-fecha')?.value);
    const emisorNom  = document.getElementById('edit-fact-emisor-nom')?.value.trim() || null;
    const emisorCuit = document.getElementById('edit-fact-emisor-cuit')?.value.trim() || null;
    const monto      = parseMontoInput(document.getElementById('edit-fact-monto')?.value);

    const { error } = await db.from('facturas')
        .update({
            numero,
            fecha,
            emisor_nombre: emisorNom,
            emisor_cuit:   emisorCuit,
            monto_total:   monto
        })
        .eq('id', facturaId);

    if (error) {
        // El error más probable es el UNIQUE (numero + emisor_cuit) si ya existe otra con ese combo
        if (error.code === '23505' || (error.message || '').includes('duplicate')) {
            mostrarError('Ya existe otra factura con ese número y CUIT. Verificá que no sea duplicada.');
        } else {
            mostrarError('No se pudo guardar: ' + error.message);
        }
        return;
    }

    mostrarExito('Factura actualizada.');
    cerrarModal();
    await cargarTesoreria();
    // Volver al detalle del cheque
    if (chequeId) verDetalleCheque(chequeId);
}

async function guardarCheque() {
    const cuentaId   = document.getElementById('campo-cuenta')?.value;
    const nroCheque  = document.getElementById('campo-nro-cheque')?.value.trim();
    const fechaEmis  = ddmmAISO(document.getElementById('campo-fecha-emision')?.value);
    const fechaCobro = ddmmAISO(document.getElementById('campo-fecha-cobro')?.value);
    const monto      = parseMontoInput(document.getElementById('campo-monto')?.value);

    if (!cuentaId)   { mostrarError('Seleccioná la cuenta bancaria.'); return; }
    if (!nroCheque)  { mostrarError('El número de cheque es obligatorio.'); return; }
    if (!fechaEmis)  { mostrarError('La fecha de emisión es obligatoria.'); return; }
    if (!fechaCobro) { mostrarError('La fecha de cobro es obligatoria.'); return; }

    // La fecha de cobro puede ser cualquier día: el sistema la agrupa
    // automáticamente al balde de 5 días que corresponde (calcularFechaBaldeJS).
    // Ej: 03/05 → balde 30/04 (la plata tiene que estar antes del 05/05).

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
    } else if (benTipo === 'arrendador') {
        const arrId = document.getElementById('ben-arrendador')?.value;
        if (arrId) {
            let benExist = beneficiarios.find(b => b.arrendador_id === arrId);
            if (!benExist) {
                const arr = arrendadoresTesoreria.find(a => a.id === arrId);
                const nuevo = await ejecutarConsulta(
                    db.from('beneficiarios').insert({
                        nombre: arr?.nombre || 'Arrendador',
                        tipo: 'arrendador',
                        arrendador_id: arrId
                    }).select(),
                    'crear beneficiario arrendador'
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

    // Estado inicial: 'futuro' si la fecha de cobro todavía no llegó, 'pendiente' si ya llegó.
    // Se promueve automáticamente a 'pendiente' en cargarTesoreria() cuando pasa la fecha.
    const estadoCalc = fechaCobro > fechaHoyStr() ? 'futuro' : 'pendiente';

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
        empleado_entrega_id: document.getElementById('campo-empleado-entrega')?.value || null,
        origen:             'manual'
    };

    let resultado;
    let chequeId = chequeEditandoId;
    if (chequeEditandoId) {
        // Al editar, sólo reajustamos estado si venía en futuro/pendiente
        // (no tocamos cobrado/anulado).
        const actual = movimientosTesoreria.find(m => m.id === chequeEditandoId);
        if (actual && (actual.estado === 'futuro' || actual.estado === 'pendiente')) {
            datos.estado = estadoCalc;
        }
        resultado = await ejecutarConsulta(
            db.from('movimientos_tesoreria').update(datos).eq('id', chequeEditandoId),
            'actualizar cheque'
        );
    } else {
        datos.estado = estadoCalc;
        resultado = await ejecutarConsulta(
            db.from('movimientos_tesoreria').insert(datos).select(),
            'registrar cheque'
        );
        if (resultado && resultado[0]) chequeId = resultado[0].id;
    }

    if (resultado === undefined) return;

    // ── Si el beneficiario es un arrendador y hay QQ, crear movimiento y descontar saldo ──
    if (benTipo === 'arrendador' && !chequeEditandoId) {
        const arrId    = document.getElementById('ben-arrendador')?.value;
        const qqStr    = document.getElementById('ben-arrendador-qq')?.value;
        const tipoQQ   = document.getElementById('ben-arrendador-tipo')?.value || 'blanco';
        const qqVal    = parseFloat(qqStr);

        if (arrId && qqVal > 0) {
            // Precio por quintal = monto del cheque / qq (para registrar en movimientos)
            const precioQQ = parseFloat(monto) / qqVal;

            // Insertar en la tabla movimientos (la misma que usa el módulo de arrendamientos)
            const nuevoMov = await ejecutarConsulta(
                db.from('movimientos').insert({
                    arrendador_id:  arrId,
                    fecha:          fechaCobro,
                    qq:             qqVal,
                    precio_quintal: Math.round(precioQQ * 100) / 100,
                    moneda:         'ARS',
                    tipo:           tipoQQ,
                    estado_factura: 'sin_factura',
                    observaciones:  `Pago mediante cheque N° ${nroCheque}`,
                    usuario_id:     window.__USUARIO__?.id || null
                }),
                'crear movimiento arrendamiento desde tesorería'
            );

            if (nuevoMov !== undefined) {
                // Descontar qq del saldo del arrendador en la campaña activa
                await descontarQQArrendador(arrId, tipoQQ, qqVal);
            }
        }
    }
    // ─────────────────────────────────────────────────────────────────────────────

    const eraEdicion = !!chequeEditandoId;

    // ── Procesar facturas pendientes (solo en creación; en edición se manejan
    //    directamente contra la BD desde el bloque-facturas-edicion) ──
    let resumenFact = null;
    if (!eraEdicion && chequeId && facturasPendientesNuevas.length > 0) {
        resumenFact = await procesarFacturasPendientesParaCheque(chequeId, empresaActivaId);
    }

    // Mensajes
    if (eraEdicion) {
        mostrarExito('Cheque actualizado');
    } else if (resumenFact) {
        if (resumenFact.errores.length === 0) {
            mostrarExito(`Cheque registrado con ${resumenFact.exitos} factura${resumenFact.exitos !== 1 ? 's' : ''} adjunta${resumenFact.exitos !== 1 ? 's' : ''}.`);
        } else {
            mostrarAlerta(`Cheque registrado. ${resumenFact.exitos} factura${resumenFact.exitos !== 1 ? 's' : ''} adjunta${resumenFact.exitos !== 1 ? 's' : ''}, pero fallaron: ${resumenFact.errores.join(', ')}. Podés volver a intentar desde el lápiz de edición.`);
        }
    } else {
        mostrarExito('Cheque registrado');
    }

    cerrarModal();
    chequeEditandoId = null;
    await cargarTesoreria();
}

// ==============================================
// BULK — CARGA SIMULTÁNEA DE VARIOS CHEQUES
// Datos comunes + N cheques con su Nº/fecha/monto (y QQ si es arrendador).
// Las facturas se vinculan automáticamente a TODOS los cheques creados.
// ==============================================

function abrirModalChequesBulk() {
    chequeEditandoId = null;
    chequesBulk = [
        { tempId: 'b_' + Math.random().toString(36).slice(2), numero: '', fecha_cobro: '', monto: '', qq: '' }
    ];
    facturasPendientesNuevas = [];

    const cuentasEmpresa = cuentas.filter(c =>
        c.empresa_id === empresaActivaId && c.moneda === 'ARS' && c.activa
    );
    const opcionesCuentas = cuentasEmpresa.map(c =>
        `<option value="${c.id}">${c.alias || c.banco}</option>`
    ).join('');

    const opcionesCat  = categorias.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    const opcionesContr = contratistasTesoreria.map(c =>
        `<option value="${c.id}">${c.nombre}${c.especialidad ? ' — ' + c.especialidad : ''}</option>`
    ).join('');
    const opcionesEmpl  = empleadosTesoreria.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
    const opcionesArr   = arrendadoresTesoreria.map(a => `<option value="${a.id}">${a.nombre}</option>`).join('');

    const hoyLocal = new Date();
    const hoy = `${hoyLocal.getFullYear()}-${String(hoyLocal.getMonth()+1).padStart(2,'0')}-${String(hoyLocal.getDate()).padStart(2,'0')}`;

    const contenido = `
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Cuenta bancaria <span class="campo-requerido">*</span></label>
                <select id="bulk-cuenta" class="campo-select">
                    <option value="">Seleccionar...</option>
                    ${opcionesCuentas}
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Fecha de emisión <span class="campo-requerido">*</span></label>
                <input type="text" data-fecha id="bulk-fecha-emision" class="campo-input"
                    value="${isoADDMM(hoy)}" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
            </div>
        </div>

        <!-- ── Beneficiario inline (mismos IDs que el modal de un solo cheque) ── -->
        <div style="border:1px solid var(--color-borde);border-radius:var(--radio-md);padding:var(--espacio-md);margin-bottom:var(--espacio-md);">
            <div style="font-size:var(--texto-sm);font-weight:600;color:var(--color-texto-secundario);margin-bottom:var(--espacio-sm);">BENEFICIARIO (compartido)</div>
            <div class="campos-fila">
                <div class="campo-grupo">
                    <label class="campo-label">Tipo</label>
                    <select id="ben-tipo" class="campo-select" onchange="actualizarFormBeneficiarioBulk(this.value)">
                        <option value="contratista" selected>Contratista</option>
                        <option value="empleado">Empleado</option>
                        <option value="arrendador">Arrendador</option>
                        <option value="otro">Otro</option>
                    </select>
                </div>
                <div class="campo-grupo" id="ben-grupo-contratista">
                    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--espacio-sm);">
                        <label class="campo-label" style="margin:0;">Contratista</label>
                        <button type="button" onclick="togglePanelNuevoContratista()" style="background:none;border:none;color:var(--color-dorado);font-size:var(--texto-xs);cursor:pointer;padding:0;font-weight:600;">+ Nuevo</button>
                    </div>
                    <select id="ben-contratista" class="campo-select">
                        <option value="">Seleccionar...</option>${opcionesContr}
                    </select>
                    ${renderizarPanelNuevoContratista()}
                </div>
                <div class="campo-grupo" id="ben-grupo-empleado" style="display:none;">
                    <label class="campo-label">Empleado</label>
                    <select id="ben-empleado" class="campo-select">
                        <option value="">Seleccionar...</option>${opcionesEmpl}
                    </select>
                </div>
                <div class="campo-grupo" id="ben-grupo-arrendador" style="display:none;">
                    <label class="campo-label">Arrendador</label>
                    <select id="ben-arrendador" class="campo-select">
                        <option value="">Seleccionar...</option>${opcionesArr}
                    </select>
                </div>
            </div>
            <div id="ben-grupo-otro" style="display:none;">
                <div class="campos-fila">
                    <div class="campo-grupo">
                        <label class="campo-label">Nombre / Razón social</label>
                        <input type="text" id="ben-otro-nombre" class="campo-input" placeholder="Ej: Agro Servicios SRL">
                    </div>
                    <div class="campo-grupo">
                        <label class="campo-label">CUIT (opcional)</label>
                        <input type="text" id="ben-otro-cuit" class="campo-input" placeholder="Ej: 20-12345678-9">
                    </div>
                </div>
            </div>
            <!-- Para arrendadores: tipo blanco/negro (los QQ se cargan por cheque más abajo) -->
            <div id="bulk-arrendador-tipo-wrap" style="display:none;margin-top:var(--espacio-sm);">
                <div class="campo-grupo">
                    <label class="campo-label">Tipo (blanco/negro)</label>
                    <select id="bulk-arrendador-tipo" class="campo-select">
                        <option value="blanco">Blanco (con factura)</option>
                        <option value="negro">Negro (sin factura)</option>
                    </select>
                    <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);margin-top:2px;">Aplica a todos los cheques. Los QQ se cargan por cheque abajo.</div>
                </div>
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Categoría</label>
                <select id="bulk-categoria" class="campo-select">
                    <option value="">Seleccionar...</option>${opcionesCat}
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Entregado por</label>
                <select id="bulk-empleado-entrega" class="campo-select">
                    <option value="">— Sin especificar —</option>
                    ${empleadosTesoreria.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('')}
                </select>
            </div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Notas</label>
            <input type="text" id="bulk-notas" class="campo-input"
                placeholder="Observaciones opcionales (se aplican a todos los cheques)">
            <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);margin-top:2px;">Esta nota se copia idéntica en cada uno de los cheques del lote.</div>
        </div>

        <hr class="form-separador">

        <!-- ── Cheques (filas dinámicas) ── -->
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:var(--espacio-sm);margin-bottom:var(--espacio-sm);">
            <div class="form-seccion-titulo" style="margin:0;">Cheques <span id="bulk-contador" style="font-weight:400;color:var(--color-texto-tenue);font-size:var(--texto-sm);"></span></div>
            <div style="font-size:var(--texto-sm);color:var(--color-dorado);font-weight:600;" id="bulk-total">Total: $ 0</div>
        </div>

        <!-- Helpers de auto-rellenado (solo visibles con 2+ cheques) -->
        <div id="bulk-helpers" style="padding:var(--espacio-sm);background:var(--color-fondo-secundario);border-radius:var(--radio-sm,4px);margin-bottom:var(--espacio-sm);display:none;">
            <div class="campo-label" style="font-size:var(--texto-xs);margin-bottom:var(--espacio-sm);">Auto-escalonar fechas de cobro</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:var(--espacio-sm);padding-bottom:var(--espacio-sm);border-bottom:1px solid var(--color-borde);">
                <span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">El día</span>
                <input type="number" id="bulk-dia-mes" class="campo-input" value="30" min="1" max="31" style="width:60px;padding:4px 8px;">
                <span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">de cada mes a partir de</span>
                <select id="bulk-mes-inicio" class="campo-select" style="width:auto;padding:4px 8px;font-size:var(--texto-xs);">
                    ${['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
                        .map((m, i) => `<option value="${i+1}" ${i === new Date().getMonth() ? 'selected' : ''}>${m}</option>`).join('')}
                </select>
                <select id="bulk-ano-inicio" class="campo-select" style="width:auto;padding:4px 8px;font-size:var(--texto-xs);">
                    ${(() => {
                        const y = new Date().getFullYear();
                        return [y-1, y, y+1, y+2].map(a => `<option value="${a}" ${a === y ? 'selected' : ''}>${a}</option>`).join('');
                    })()}
                </select>
                <button type="button" class="btn-secundario" onclick="autoEscalonarFechasPorDiaMes()" style="padding:4px 10px;font-size:var(--texto-xs);margin-left:auto;">Aplicar</button>
            </div>

            <!-- Auto-rellenar monto en todos los cheques -->
            <div class="campo-label" style="font-size:var(--texto-xs);margin-bottom:var(--espacio-sm);">Auto-rellenar monto en todos los cheques</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">Monto:</span>
                <input type="text" id="bulk-monto-comun" data-monto class="campo-input" placeholder="Ej: 1.500.000" style="flex:1;min-width:140px;padding:4px 8px;">
                <span style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">ARS — se aplica a todas las filas</span>
                <button type="button" class="btn-secundario" onclick="autoRellenarMontoBulk()" style="padding:4px 10px;font-size:var(--texto-xs);margin-left:auto;">Aplicar</button>
            </div>

            <div style="margin-top:var(--espacio-sm);padding-top:var(--espacio-sm);border-top:1px solid var(--color-borde);font-size:var(--texto-xs);color:var(--color-texto-tenue);">
                💡 <strong>Tip:</strong> los números de cheque se autocompletan consecutivos al tipear el primero (ej: 47700970 → 47700971, 47700972...). Editá cualquier fila para sobreescribir manualmente.
            </div>
        </div>

        <div id="bulk-filas"></div>

        <div style="display:inline-flex;align-items:center;gap:6px;margin-top:var(--espacio-sm);font-size:var(--texto-xs);color:var(--color-texto-tenue);">
            <span>Cheques a agregar:</span>
            <input type="number" id="bulk-cantidad-agregar" value="1" min="1" max="50"
                style="width:55px;padding:3px 6px;background-color:#0f0e0c;border:1px solid var(--color-borde);border-radius:var(--radio-sm,4px);color:var(--color-texto);font-size:var(--texto-xs);text-align:center;">
            <button type="button" class="btn-secundario" onclick="agregarVariosChequesBulk()" style="padding:3px 10px;font-size:var(--texto-xs);">
                Aplicar
            </button>
        </div>

        <hr class="form-separador">

        <div class="form-seccion-titulo">Facturas <span style="font-weight:400;color:var(--color-texto-tenue);font-size:var(--texto-xs);">(compartidas — se vinculan a TODOS los cheques)</span></div>
        <div id="bloque-facturas-pendientes">
            ${renderizarSeccionFacturasPendientes()}
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarChequesBulk()" id="btn-guardar-bulk">Registrar cheques</button>
    `;

    abrirModal('Cargar cheque', contenido, footer);
    renderFilasChequesBulk();
}

/**
 * Variante para el bulk modal: igual que actualizarFormBeneficiario pero
 * NO muestra el QQ inline (porque QQ va por cheque). En su lugar muestra
 * el selector blanco/negro común a todos los cheques.
 */
function actualizarFormBeneficiarioBulk(tipo) {
    document.getElementById('ben-grupo-contratista').style.display = tipo === 'contratista' ? '' : 'none';
    document.getElementById('ben-grupo-empleado').style.display    = tipo === 'empleado'    ? '' : 'none';
    document.getElementById('ben-grupo-arrendador').style.display  = tipo === 'arrendador'  ? '' : 'none';
    document.getElementById('ben-grupo-otro').style.display        = tipo === 'otro'        ? '' : 'none';
    const wrapBN = document.getElementById('bulk-arrendador-tipo-wrap');
    if (wrapBN) wrapBN.style.display = tipo === 'arrendador' ? '' : 'none';
    // Re-renderizar las filas para mostrar/ocultar la columna QQ
    renderFilasChequesBulk();
}

function renderFilasChequesBulk() {
    const cont = document.getElementById('bulk-filas');
    if (!cont) return;

    // Antes de pintar: si el primer cheque tiene un número y los siguientes
    // están vacíos, los autocompletamos con números consecutivos.
    autoIncrementarNumerosCheques();

    // Mostrar/ocultar helpers según la cantidad de cheques
    // Con 1 sola fila los helpers no aportan nada y agregan ruido visual.
    const helpers = document.getElementById('bulk-helpers');
    if (helpers) helpers.style.display = chequesBulk.length >= 2 ? 'block' : 'none';

    const tipoBen = document.getElementById('ben-tipo')?.value;
    const mostrarQQ = tipoBen === 'arrendador';

    // Detectar números duplicados (mismo nro no vacío más de una vez)
    const conteoNumeros = {};
    chequesBulk.forEach(c => {
        const n = (c.numero || '').trim();
        if (n) conteoNumeros[n] = (conteoNumeros[n] || 0) + 1;
    });

    cont.innerHTML = chequesBulk.map((c, i) => {
        const dup = (c.numero || '').trim() && conteoNumeros[c.numero.trim()] > 1;
        const estiloDup = dup ? 'border-color:var(--color-error);' : '';
        return `
            <div style="border:1px solid var(--color-borde);border-radius:var(--radio-md);padding:var(--espacio-sm) var(--espacio-md);margin-bottom:var(--espacio-sm);background:var(--color-fondo-tarjeta);${estiloDup}">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--espacio-xs);">
                    <div style="font-size:var(--texto-xs);font-weight:600;color:var(--color-texto-secundario);">Cheque #${i + 1}${dup ? ' <span style="color:var(--color-error);">⚠ Nº duplicado</span>' : ''}</div>
                    ${chequesBulk.length > 1 ? `<button type="button" class="btn-secundario" style="padding:2px 8px;font-size:var(--texto-xs);color:var(--color-error);border-color:var(--color-error);" onclick="quitarFilaChequeBulk(${i})">Quitar</button>` : ''}
                </div>
                <div class="campos-fila">
                    <div class="campo-grupo">
                        <label class="campo-label">Nº de cheque <span class="campo-requerido">*</span></label>
                        <input type="text" class="campo-input" value="${c.numero || ''}"
                            placeholder="Ej: 00012345"
                            oninput="actualizarFilaChequeBulk(${i}, 'numero', this.value)"
                            onchange="renderFilasChequesBulk()">
                    </div>
                    <div class="campo-grupo">
                        <label class="campo-label">Fecha de cobro <span class="campo-requerido">*</span></label>
                        <input type="text" data-fecha class="campo-input" value="${isoADDMM(c.fecha_cobro)}"
                            placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10"
                            oninput="actualizarFilaChequeBulk(${i}, 'fecha_cobro', ddmmAISO(this.value))">
                    </div>
                    <div class="campo-grupo">
                        <label class="campo-label">Monto (ARS) <span class="campo-requerido">*</span></label>
                        <input type="text" data-monto class="campo-input" value="${formatearMontoInput(c.monto)}"
                            placeholder="0"
                            oninput="actualizarFilaChequeBulk(${i}, 'monto', parseMontoInput(this.value)); actualizarTotalBulk();">
                    </div>
                    ${mostrarQQ ? `
                        <div class="campo-grupo">
                            <label class="campo-label">QQ <span class="campo-requerido">*</span></label>
                            <input type="number" class="campo-input" value="${c.qq || ''}"
                                placeholder="Ej: 140" step="0.01" min="0.01"
                                oninput="actualizarFilaChequeBulk(${i}, 'qq', this.value)">
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('bulk-contador').textContent = `(${chequesBulk.length})`;
    actualizarTotalBulk();
    // Re-activar máscaras en los inputs nuevos (fechas + montos)
    if (typeof activarFechasDDMM === 'function') activarFechasDDMM(cont);
    if (typeof activarFormatoMonto === 'function') activarFormatoMonto(cont);
}

function actualizarFilaChequeBulk(idx, campo, valor) {
    const c = chequesBulk[idx];
    if (!c) return;
    c[campo] = valor;
}

function actualizarTotalBulk() {
    const total = chequesBulk.reduce((s, c) => s + (parseFloat(c.monto) || 0), 0);
    const el = document.getElementById('bulk-total');
    if (el) el.textContent = `Total: $ ${formatearNumero(total)}`;
}

/**
 * Agrega N filas vacías de una sola vez. El usuario elige el N en el input
 * "Cheques a agregar" y toca "Aplicar". Si tipea un valor inválido, muestra
 * error. Límite de 50 por accidente (ej: tipear 500 en lugar de 5).
 */
function agregarVariosChequesBulk() {
    const input = document.getElementById('bulk-cantidad-agregar');
    const n = parseInt(input?.value, 10);
    if (!n || n < 1) {
        mostrarError('Ingresá una cantidad válida (mínimo 1).');
        return;
    }
    if (n > 50) {
        mostrarError('Máximo 50 cheques a la vez. Si necesitás más, hacelo en dos pasos.');
        return;
    }
    for (let i = 0; i < n; i++) {
        chequesBulk.push({
            tempId: 'b_' + Math.random().toString(36).slice(2),
            numero: '', fecha_cobro: '', monto: '', qq: ''
        });
    }
    renderFilasChequesBulk();
    mostrarExito(`${n} cheques agregados.`);
}

function quitarFilaChequeBulk(idx) {
    if (chequesBulk.length <= 1) return;
    chequesBulk.splice(idx, 1);
    renderFilasChequesBulk();
}

/**
 * Auto-completa los números de cheque de las filas vacías con números
 * consecutivos a partir del primero. Respeta los inputs manuales: si una
 * fila ya tiene un número escrito, no se sobreescribe.
 *
 * Conserva el ancho del primer número con padding de ceros (ej: si el
 * primero es "00012345", el siguiente será "00012346", no "12346").
 *
 * Solo funciona si el primer número es puramente numérico. Si trae letras
 * o guiones, no autocompleta (mejor no adivinar formatos raros).
 */
function autoIncrementarNumerosCheques() {
    if (chequesBulk.length < 2) return;
    const primero = (chequesBulk[0]?.numero || '').trim();
    if (!primero) return;
    if (!/^\d+$/.test(primero)) return;   // solo si es numérico puro

    const ancho   = primero.length;
    const inicial = parseInt(primero, 10);
    if (!Number.isFinite(inicial)) return;

    for (let i = 1; i < chequesBulk.length; i++) {
        const actual = (chequesBulk[i].numero || '').trim();
        if (actual) continue;  // respetar valores escritos manualmente
        chequesBulk[i].numero = String(inicial + i).padStart(ancho, '0');
    }
}

/**
 * Llena las fechas de cobro con el día X de cada mes, empezando en
 * el mes/año seleccionado. Si el día no existe en algún mes (ej: 31 de
 * febrero), usa el último día válido de ese mes.
 *
 * Ej: día 30, a partir de mayo 2026, 4 cheques →
 *   30/05/2026, 30/06/2026, 30/07/2026, 30/08/2026
 */
function autoEscalonarFechasPorDiaMes() {
    const dia = parseInt(document.getElementById('bulk-dia-mes')?.value, 10);
    const mesInicio = parseInt(document.getElementById('bulk-mes-inicio')?.value, 10);
    const anoInicio = parseInt(document.getElementById('bulk-ano-inicio')?.value, 10);

    if (!dia || dia < 1 || dia > 31) {
        mostrarError('Día inválido (debe ser entre 1 y 31).');
        return;
    }
    if (!mesInicio || mesInicio < 1 || mesInicio > 12) {
        mostrarError('Mes inválido.');
        return;
    }
    if (!anoInicio || anoInicio < 2000 || anoInicio > 2100) {
        mostrarError('Año inválido.');
        return;
    }

    chequesBulk.forEach((c, i) => {
        // mesInicio es 1-12. Sumamos i meses al mes de inicio.
        const mesAbsoluto = mesInicio + i; // ej: mayo (5) + 0 = 5, mayo + 1 = 6 (junio)...
        const yearFinal = anoInicio + Math.floor((mesAbsoluto - 1) / 12);
        const monthFinal = ((mesAbsoluto - 1) % 12) + 1; // 1-12

        // Último día del mes (manejo de 31/feb, etc.)
        // new Date(year, monthFinal, 0) → día 0 del mes siguiente = último del actual
        const ultDia = new Date(yearFinal, monthFinal, 0).getDate();
        const diaFinal = Math.min(dia, ultDia);

        c.fecha_cobro = `${yearFinal}-${String(monthFinal).padStart(2,'0')}-${String(diaFinal).padStart(2,'0')}`;
    });
    renderFilasChequesBulk();

    const nombresMes = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    mostrarExito(`Fechas escalonadas el día ${dia} de cada mes desde ${nombresMes[mesInicio]} ${anoInicio}.`);
}

/**
 * Rellena el mismo monto en todas las filas de cheques del bulk.
 * Útil cuando todos los cheques del lote son por el mismo valor.
 */
function autoRellenarMontoBulk() {
    const raw = document.getElementById('bulk-monto-comun')?.value || '';
    const monto = parseMontoInput(raw);
    if (!monto || monto <= 0) {
        mostrarError('Ingresá un monto válido.');
        return;
    }
    chequesBulk.forEach(c => { c.monto = monto; });
    renderFilasChequesBulk();
    actualizarTotalBulk();
    mostrarExito(`Monto $ ${formatearNumero(monto)} aplicado a ${chequesBulk.length} cheque${chequesBulk.length !== 1 ? 's' : ''}.`);
}

/**
 * Devuelve el id de beneficiario que corresponde al input.
 * Si ya existe en `beneficiarios`, lo reusa; si no, lo crea en la BD.
 * Inputs aceptados (uno de):
 *   { tipo: 'contratista',  contratista_id }
 *   { tipo: 'empleado',     empleado_id }
 *   { tipo: 'arrendador',   arrendador_id }
 *   { tipo: 'otro',         nombre, cuit? }
 */
async function obtenerOCrearBeneficiario(input) {
    if (!input || !input.tipo) return null;
    const { tipo } = input;

    if (tipo === 'contratista') {
        let b = beneficiarios.find(x => x.contratista_id === input.contratista_id);
        if (!b) {
            const c = contratistasTesoreria.find(x => x.id === input.contratista_id);
            const r = await ejecutarConsulta(
                db.from('beneficiarios').insert({
                    nombre: c?.nombre || 'Contratista',
                    tipo: 'contratista',
                    contratista_id: input.contratista_id
                }).select(),
                'crear beneficiario contratista'
            );
            if (r?.[0]) { beneficiarios.push(r[0]); b = r[0]; }
        }
        return b?.id || null;
    }
    if (tipo === 'empleado') {
        let b = beneficiarios.find(x => x.empleado_id === input.empleado_id);
        if (!b) {
            const e = empleadosTesoreria.find(x => x.id === input.empleado_id);
            const r = await ejecutarConsulta(
                db.from('beneficiarios').insert({
                    nombre: e?.nombre || 'Empleado',
                    tipo: 'empleado',
                    empleado_id: input.empleado_id
                }).select(),
                'crear beneficiario empleado'
            );
            if (r?.[0]) { beneficiarios.push(r[0]); b = r[0]; }
        }
        return b?.id || null;
    }
    if (tipo === 'arrendador') {
        let b = beneficiarios.find(x => x.arrendador_id === input.arrendador_id);
        if (!b) {
            const a = arrendadoresTesoreria.find(x => x.id === input.arrendador_id);
            const r = await ejecutarConsulta(
                db.from('beneficiarios').insert({
                    nombre: a?.nombre || 'Arrendador',
                    tipo: 'arrendador',
                    arrendador_id: input.arrendador_id
                }).select(),
                'crear beneficiario arrendador'
            );
            if (r?.[0]) { beneficiarios.push(r[0]); b = r[0]; }
        }
        return b?.id || null;
    }
    if (tipo === 'otro') {
        const nombre = (input.nombre || '').trim();
        if (!nombre) return null;
        let b = beneficiarios.find(x =>
            x.tipo === 'otro' && x.nombre?.toLowerCase() === nombre.toLowerCase()
        );
        if (!b) {
            const r = await ejecutarConsulta(
                db.from('beneficiarios').insert({
                    nombre,
                    tipo: 'otro',
                    cuit: input.cuit || null
                }).select(),
                'crear beneficiario otro'
            );
            if (r?.[0]) { beneficiarios.push(r[0]); b = r[0]; }
        }
        return b?.id || null;
    }
    return null;
}

async function guardarChequesBulk() {
    // ── Validación de campos comunes ──
    const cuentaId   = document.getElementById('bulk-cuenta')?.value;
    const fechaEmis  = ddmmAISO(document.getElementById('bulk-fecha-emision')?.value);
    const tipoBen    = document.getElementById('ben-tipo')?.value;
    const categoriaId = document.getElementById('bulk-categoria')?.value || null;
    const empleadoEntregaId = document.getElementById('bulk-empleado-entrega')?.value || null;
    const notasComunes = document.getElementById('bulk-notas')?.value?.trim() || null;

    if (!cuentaId)  { mostrarError('Seleccioná una cuenta bancaria.'); return; }
    if (!fechaEmis) { mostrarError('Cargá la fecha de emisión.'); return; }

    // Resolver beneficiario (mismo flujo que en cheque único)
    let beneficiarioId = null;
    let arrId = null;
    let tipoArrBN = 'blanco';
    if (tipoBen === 'contratista') {
        const id = document.getElementById('ben-contratista')?.value;
        if (!id) { mostrarError('Seleccioná un contratista.'); return; }
        beneficiarioId = await obtenerOCrearBeneficiario({ tipo: 'contratista', contratista_id: id });
    } else if (tipoBen === 'empleado') {
        const id = document.getElementById('ben-empleado')?.value;
        if (!id) { mostrarError('Seleccioná un empleado.'); return; }
        beneficiarioId = await obtenerOCrearBeneficiario({ tipo: 'empleado', empleado_id: id });
    } else if (tipoBen === 'arrendador') {
        arrId = document.getElementById('ben-arrendador')?.value;
        if (!arrId) { mostrarError('Seleccioná un arrendador.'); return; }
        tipoArrBN = document.getElementById('bulk-arrendador-tipo')?.value || 'blanco';
        beneficiarioId = await obtenerOCrearBeneficiario({ tipo: 'arrendador', arrendador_id: arrId });
    } else if (tipoBen === 'otro') {
        const nombre = document.getElementById('ben-otro-nombre')?.value?.trim();
        const cuit   = document.getElementById('ben-otro-cuit')?.value?.trim() || null;
        if (!nombre) { mostrarError('Cargá el nombre del beneficiario.'); return; }
        beneficiarioId = await obtenerOCrearBeneficiario({ tipo: 'otro', nombre, cuit });
    }
    if (!beneficiarioId) return;

    // ── Validación de cada cheque ──
    const numerosVistos = new Set();
    for (let i = 0; i < chequesBulk.length; i++) {
        const c = chequesBulk[i];
        const numero = (c.numero || '').trim();
        if (!numero)       { mostrarError(`Cheque #${i + 1}: cargá el número.`); return; }
        if (!c.fecha_cobro){ mostrarError(`Cheque #${i + 1}: cargá la fecha de cobro.`); return; }
        const monto = parseFloat(c.monto);
        if (!monto || monto <= 0) { mostrarError(`Cheque #${i + 1}: monto inválido.`); return; }
        if (numerosVistos.has(numero)) { mostrarError(`El número de cheque "${numero}" está repetido en la lista.`); return; }
        numerosVistos.add(numero);
        if (tipoBen === 'arrendador') {
            const qqVal = parseFloat(c.qq);
            if (!qqVal || qqVal <= 0) { mostrarError(`Cheque #${i + 1}: cargá los QQ.`); return; }
        }
    }

    // ── Insertar los N cheques ──
    const btn = document.getElementById('btn-guardar-bulk');
    if (btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }

    const hoyStr = fechaHoyStr();
    const chequesCreados = [];   // ids para vincular facturas
    const errores = [];

    for (let i = 0; i < chequesBulk.length; i++) {
        const c = chequesBulk[i];
        const numero = (c.numero || '').trim();
        const fechaCobro = c.fecha_cobro;
        const monto = parseFloat(c.monto);
        const estadoCalc = fechaCobro > hoyStr ? 'futuro' : 'pendiente';

        const datos = {
            empresa_id:         empresaActivaId,
            cuenta_bancaria_id: cuentaId,
            tipo:               'cheque',
            numero_cheque:      numero,
            fecha_emision:      fechaEmis,
            fecha_cobro:        fechaCobro,
            fecha_balde:        calcularFechaBaldeJS(fechaCobro),
            beneficiario_id:    beneficiarioId,
            categoria_id:       categoriaId,
            monto:              monto,
            notas:              notasComunes,
            empleado_entrega_id: empleadoEntregaId,
            origen:             'manual',
            estado:             estadoCalc
        };

        const r = await ejecutarConsulta(
            db.from('movimientos_tesoreria').insert(datos).select(),
            `registrar cheque #${i + 1}`
        );
        if (r && r[0]) {
            chequesCreados.push(r[0].id);

            // Si es arrendador, registrar movimiento de QQ + descontar saldo
            if (tipoBen === 'arrendador' && arrId) {
                const qqVal = parseFloat(c.qq);
                const precioQQ = monto / qqVal;
                const movArr = await ejecutarConsulta(
                    db.from('movimientos').insert({
                        arrendador_id:  arrId,
                        fecha:          fechaCobro,
                        qq:             qqVal,
                        precio_quintal: Math.round(precioQQ * 100) / 100,
                        moneda:         'ARS',
                        tipo:           tipoArrBN,
                        estado_factura: 'sin_factura',
                        observaciones:  `Pago mediante cheque N° ${numero}`,
                        usuario_id:     window.__USUARIO__?.id || null
                    }),
                    'crear movimiento arrendamiento desde tesorería (bulk)'
                );
                if (movArr !== undefined) {
                    await descontarQQArrendador(arrId, tipoArrBN, qqVal);
                }
            }
        } else {
            errores.push(`#${i + 1} (Nº ${numero})`);
        }
    }

    // ── Procesar facturas comunes (1 sola subida, N vínculos) ──
    let resumenFact = null;
    if (chequesCreados.length > 0 && facturasPendientesNuevas.length > 0) {
        resumenFact = await procesarFacturasPendientesParaChequesBulk(chequesCreados, empresaActivaId);
    }

    // ── Mensaje final ──
    const nOK = chequesCreados.length;
    const nFail = errores.length;
    let msg = '';
    if (nFail === 0) {
        msg = `${nOK} cheque${nOK !== 1 ? 's' : ''} registrado${nOK !== 1 ? 's' : ''}`;
        if (resumenFact && resumenFact.exitos > 0) {
            msg += ` con ${resumenFact.exitos} factura${resumenFact.exitos !== 1 ? 's' : ''} vinculada${resumenFact.exitos !== 1 ? 's' : ''} a todos`;
        }
        mostrarExito(msg + '.');
    } else {
        mostrarAlerta(`${nOK} registrado${nOK !== 1 ? 's' : ''}, ${nFail} fallaron: ${errores.join(', ')}. Probá editarlos a mano.`);
    }

    cerrarModal();
    chequesBulk = [];
    facturasPendientesNuevas = [];
    await cargarTesoreria();
}

/**
 * Variante de procesarFacturasPendientesParaCheque para el caso bulk:
 * cada factura se sube/insertan UNA sola vez, pero el vínculo se crea
 * para CADA chequeId en chequesIds.
 */
async function procesarFacturasPendientesParaChequesBulk(chequesIds, empresaId) {
    let exitos = 0;
    const errores = [];

    for (const p of facturasPendientesNuevas) {
        try {
            let facturaId = null;

            if (p.tipo === 'existente') {
                facturaId = p.factura_id;
            } else {
                // tipo 'nueva' — dedup
                if (p.numero) {
                    const q = db.from('facturas').select('id').eq('numero', p.numero);
                    const finalQ = p.emisor_cuit ? q.eq('emisor_cuit', p.emisor_cuit) : q.is('emisor_cuit', null);
                    const { data: dups, error: errDup } = await finalQ;
                    if (errDup) throw errDup;
                    if (dups && dups.length > 0) facturaId = dups[0].id;
                }

                if (!facturaId) {
                    // Subir archivo (path bajo el primer cheque por convención)
                    const ext = (p.file.name.split('.').pop() || 'pdf').toLowerCase();
                    const extOk = ['pdf', 'jpg', 'jpeg', 'png'].includes(ext) ? ext : 'pdf';
                    const path = `${chequesIds[0]}/${Date.now()}.${extOk}`;
                    const { error: upErr } = await db.storage
                        .from('facturas-cheques')
                        .upload(path, p.file, { upsert: false });
                    if (upErr) throw upErr;

                    const { data: nueva, error: insErr } = await db.from('facturas').insert({
                        numero:        p.numero,
                        fecha:         p.fecha,
                        emisor_cuit:   p.emisor_cuit,
                        emisor_nombre: p.emisor_nombre,
                        monto_total:   p.monto_total,
                        archivo_url:   path,
                        empresa_id:    empresaId,
                        creado_por:    window.__USUARIO__?.id || null
                    }).select().single();
                    if (insErr) {
                        await db.storage.from('facturas-cheques').remove([path]);
                        throw insErr;
                    }
                    facturaId = nueva.id;
                }
            }

            // Crear N vínculos (uno por cheque). ON CONFLICT no se aplica porque
            // los pares (cheque,factura) son únicos por PK compuesto y los chequesIds
            // recién se crearon en este bulk → no debería haber duplicado.
            const filas = chequesIds.map(cid => ({ cheque_id: cid, factura_id: facturaId }));
            const { error: vincErr } = await db.from('cheques_facturas').insert(filas);
            if (vincErr) throw vincErr;

            exitos++;
        } catch (err) {
            console.error('Error procesando factura bulk:', err);
            errores.push(p.numero || p.file?.name || 'sin nombre');
        }
    }

    facturasPendientesNuevas = [];
    return { exitos, errores };
}

// ==============================================
// E-CHEQUES (cheques electrónicos)
// Flujo: subir PDF del banco → IA extrae todo → preview editable → guardar.
// Soporta múltiples e-cheques en un mismo PDF (Galicia, etc.).
// ==============================================

/**
 * Prompt común para Gemini y Claude. Extrae uno o varios e-cheques de un PDF.
 */
function promptEcheqExtraccion() {
    return `Analizá este PDF de e-cheques emitidos por un banco argentino (Galicia, Santander, Macro, BBVA, etc.) y extraé TODOS los e-cheques que aparezcan en la tabla. Puede haber uno solo o varios.

Si un campo no aparece, poné null. No inventes datos. Los importes vienen con separadores de miles como "$ 5.272.393,50" — devolvelos como número (5272393.50).

Formato de respuesta (solo JSON, sin markdown ni explicaciones):
{
    "cuenta_libradora": "número de cuenta libradora tal como aparece (ej: '00000190785'). Es común para todos los e-cheques del PDF.",
    "beneficiario_nombre": "nombre o razón social del beneficiario al que se le emitieron los cheques (ej: 'LOGITRACK SAS'). Suele aparecer como 'Emitido a'.",
    "beneficiario_cuit": "CUIT del beneficiario en formato XX-XXXXXXXX-X (con guiones). Si viene sin guiones (30718952499) reformatealo.",
    "echecks": [
        {
            "numero": "número del e-cheque, ej '00000383'",
            "fecha_emision": "YYYY-MM-DD",
            "fecha_cobro": "YYYY-MM-DD (fecha de pago)",
            "monto": número decimal sin separadores ni símbolos
        }
    ]
}`;
}

async function llamarGeminiEcheq(apiKey, pdfBase64) {
    const prompt = promptEcheqExtraccion();
    const modelos = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    const codigosReintento = [429, 500, 502, 503, 504];
    let ultimoError = null;

    for (let m = 0; m < modelos.length; m++) {
        const modelo = modelos[m];
        for (let intento = 1; intento <= 2; intento++) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
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
                        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
                    })
                });
                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    const err = new Error(errData.error?.message || `Error HTTP ${response.status}`);
                    err.status = response.status;
                    throw err;
                }
                const result = await response.json();
                const parts = result.candidates?.[0]?.content?.parts || [];
                let texto = null;
                for (let i = parts.length - 1; i >= 0; i--) {
                    if (parts[i].text) { texto = parts[i].text; break; }
                }
                if (!texto) throw new Error('Gemini no devolvió respuesta.');
                let jsonStr = texto.trim();
                if (jsonStr.startsWith('```')) {
                    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\s*$/g, '').trim();
                }
                return JSON.parse(jsonStr);
            } catch (err) {
                ultimoError = err;
                if (!codigosReintento.includes(err.status)) break;
                if (intento < 2) await new Promise(r => setTimeout(r, Math.pow(2, intento) * 1000));
            }
        }
    }
    throw ultimoError || new Error('No se pudo extraer el e-cheque con Gemini.');
}

async function llamarClaudeEcheq(apiKey, pdfBase64) {
    const prompt = promptEcheqExtraccion();
    const codigosReintento = [429, 500, 502, 503, 504, 529];
    let ultimoError = null;

    for (let intento = 1; intento <= 3; intento++) {
        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-5',
                    max_tokens: 4096,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
                            { type: 'text', text: prompt }
                        ]
                    }]
                })
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const err = new Error(errData.error?.message || `Error HTTP ${response.status}`);
                err.status = response.status;
                throw err;
            }
            const result = await response.json();
            const texto = result.content?.[0]?.text;
            if (!texto) throw new Error('Claude no devolvió respuesta.');
            let jsonStr = texto.trim();
            if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\s*$/g, '').trim();
            }
            return JSON.parse(jsonStr);
        } catch (err) {
            ultimoError = err;
            if (!codigosReintento.includes(err.status)) break;
            if (intento < 3) await new Promise(r => setTimeout(r, Math.pow(2, intento - 1) * 1000));
        }
    }
    throw ultimoError || new Error('No se pudo extraer el e-cheque con Claude.');
}

function abrirModalEcheck() {
    chequeEditandoId = null;
    echecksDetectados = [];
    echeqMetadata = null;
    echeqFileSeleccionado = null;
    facturasPendientesNuevas = [];

    abrirModal('Cargar e-cheque', renderContenidoEcheq(), renderFooterEcheq());
    configurarDragDropEcheq();
}

/**
 * Renderiza el contenido del modal según el estado.
 * Estado 1: sin PDF → solo el área de upload.
 * Estado 2: con PDF, sin scan → mostrar nombre + botones IA.
 * Estado 3: scaneado → preview con datos editables.
 */
function renderContenidoEcheq() {
    // Estado 3: ya hay datos extraídos → mostrar preview
    if (echecksDetectados.length > 0) {
        return renderEcheqFormulario();
    }

    // Estado 2: hay PDF pero sin scan → mostrar archivo + botones IA
    if (echeqFileSeleccionado) {
        return `
            <div style="border:1px solid var(--color-verde);background:rgba(74,158,110,0.05);border-radius:var(--radio-md);padding:var(--espacio-md);margin-bottom:var(--espacio-md);">
                <div style="display:flex;align-items:center;gap:var(--espacio-sm);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-verde)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;flex-shrink:0;">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:600;color:var(--color-texto);">${echeqFileSeleccionado.name}</div>
                        <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">${(echeqFileSeleccionado.size / 1024 / 1024).toFixed(2)} MB</div>
                    </div>
                    <button class="btn-secundario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="quitarEcheqPDF()">Cambiar</button>
                </div>
            </div>
            <div style="text-align:center;padding:var(--espacio-md);">
                <p style="margin-bottom:var(--espacio-md);color:var(--color-texto-secundario);font-size:var(--texto-sm);">Elegí una IA para extraer los datos del e-cheque:</p>
                <div style="display:flex;gap:var(--espacio-sm);justify-content:center;flex-wrap:wrap;">
                    <button class="btn-primario" onclick="extraerEcheq('gemini')" title="Extraer con Gemini (Google · gratis)">✨ Extraer con Gemini</button>
                    <button class="btn-primario" onclick="extraerEcheq('claude')" title="Extraer con Claude (Anthropic · pago)">✨ Extraer con Claude</button>
                </div>
            </div>
        `;
    }

    // Estado 1: sin PDF
    return `
        <div id="echeq-drop-area" style="border:2px dashed var(--color-borde);border-radius:var(--radio-md);padding:var(--espacio-xl) var(--espacio-md);text-align:center;cursor:pointer;transition:background var(--transicion-rapida);" onclick="document.getElementById('echeq-input').click()">
            <input type="file" id="echeq-input" accept=".pdf,application/pdf" style="display:none;" onchange="seleccionarEcheqPDF(this.files[0])">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:48px;height:48px;color:var(--color-dorado);margin-bottom:var(--espacio-sm);"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <div style="font-weight:600;color:var(--color-texto);margin-bottom:4px;">Hacé click o arrastrá el PDF del e-cheque</div>
            <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);">Soporta PDFs de Galicia, Santander, Macro, BBVA, etc.<br>Puede contener uno o varios e-cheques.</div>
        </div>
    `;
}

function renderFooterEcheq() {
    if (echecksDetectados.length === 0) {
        return `<button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>`;
    }
    const txt = echecksDetectados.length === 1 ? 'Registrar e-cheque' : `Registrar ${echecksDetectados.length} e-cheques`;
    return `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" id="btn-guardar-echeq" onclick="guardarEchecks()">${txt}</button>
    `;
}

function refrescarModalEcheq(titulo = 'Cargar e-cheque') {
    // Re-render del cuerpo y footer sin cerrar el modal
    const body = document.querySelector('.modal .modal-body');
    const footer = document.querySelector('.modal .modal-footer');
    if (body) body.innerHTML = renderContenidoEcheq();
    if (footer) footer.innerHTML = renderFooterEcheq();
    if (titulo) {
        const t = document.querySelector('.modal-titulo');
        if (t) t.textContent = titulo;
    }
    // Re-attach focus/blur de fechas y montos
    if (typeof activarFechasDDMM === 'function') activarFechasDDMM(document.querySelector('.modal'));
    if (typeof activarFormatoMonto === 'function') activarFormatoMonto(document.querySelector('.modal'));
    configurarDragDropEcheq();
}

function configurarDragDropEcheq() {
    const area = document.getElementById('echeq-drop-area');
    if (!area) return;
    area.addEventListener('dragover', e => { e.preventDefault(); area.style.background = 'rgba(201,168,76,0.08)'; });
    area.addEventListener('dragleave', () => { area.style.background = ''; });
    area.addEventListener('drop', e => {
        e.preventDefault(); area.style.background = '';
        const f = e.dataTransfer.files?.[0];
        if (f) seleccionarEcheqPDF(f);
    });
}

function seleccionarEcheqPDF(file) {
    if (!file) return;
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
        mostrarError('El archivo debe ser un PDF.');
        return;
    }
    echeqFileSeleccionado = file;
    refrescarModalEcheq();
}

function quitarEcheqPDF() {
    echeqFileSeleccionado = null;
    echecksDetectados = [];
    echeqMetadata = null;
    refrescarModalEcheq();
}

async function extraerEcheq(ia) {
    const apiKey = ia === 'gemini'
        ? window.__ENV__?.GEMINI_API_KEY
        : window.__ENV__?.ANTHROPIC_API_KEY;
    if (!apiKey) {
        mostrarError(`La API Key de ${ia === 'gemini' ? 'Gemini' : 'Claude'} no está configurada.`);
        return;
    }
    if (!echeqFileSeleccionado) {
        mostrarError('Subí primero el PDF.');
        return;
    }

    // Mostrar estado de carga en el body
    const body = document.querySelector('.modal .modal-body');
    if (body) {
        body.innerHTML = `
            <div style="text-align:center;padding:var(--espacio-xl);">
                <div class="spinner" style="margin:0 auto var(--espacio-md);"></div>
                <div style="color:var(--color-texto);">Extrayendo datos del e-cheque con <strong>${ia === 'gemini' ? 'Gemini' : 'Claude'}</strong>...</div>
                <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);margin-top:var(--espacio-xs);">Puede tardar unos segundos.</div>
            </div>
        `;
    }

    try {
        const base64 = await archivoABase64Cheque(echeqFileSeleccionado);
        const datos = ia === 'gemini'
            ? await llamarGeminiEcheq(apiKey, base64)
            : await llamarClaudeEcheq(apiKey, base64);

        const echecks = Array.isArray(datos?.echecks) ? datos.echecks : [];
        if (echecks.length === 0) {
            mostrarError('La IA no detectó e-cheques en el PDF. Probá la otra IA o verificá que sea el archivo correcto.');
            refrescarModalEcheq();
            return;
        }

        echecksDetectados = echecks.map(e => ({
            tempId: 'e_' + Math.random().toString(36).slice(2),
            numero:        e.numero        || '',
            fecha_emision: e.fecha_emision || '',
            fecha_cobro:   e.fecha_cobro   || '',
            monto:         e.monto != null ? Number(e.monto) : 0
        }));

        // Auto-match de cuenta libradora por número
        let cuentaMatchId = null;
        if (datos.cuenta_libradora) {
            const cuentasEmpresa = cuentas.filter(c => c.empresa_id === empresaActivaId);
            const numLimpio = String(datos.cuenta_libradora).replace(/^0+/, '');   // sacar ceros a la izq
            const match = cuentasEmpresa.find(c => {
                const n = String(c.numero_cuenta || '').replace(/^0+/, '');
                return n && n === numLimpio;
            });
            if (match) cuentaMatchId = match.id;
        }

        // Auto-match de beneficiario por CUIT normalizado en contratistas/empleados/arrendadores
        const benCuitRaw = datos.beneficiario_cuit || '';
        const benCuitN   = benCuitRaw ? String(benCuitRaw).replace(/\D/g, '') : null;
        const cuitsIguales = (a, b) => a && b && String(a).replace(/\D/g, '') === String(b).replace(/\D/g, '');
        let matchTipo = 'otro';
        let matchNombre = null;
        let matchEntidadId = null;
        if (benCuitN) {
            const c = contratistasTesoreria.find(x => cuitsIguales(x.cuit, benCuitN));
            if (c) { matchTipo = 'contratista'; matchNombre = c.nombre; matchEntidadId = c.id; }
            if (!matchEntidadId) {
                const e = empleadosTesoreria.find(x => cuitsIguales(x.cuit, benCuitN));
                if (e) { matchTipo = 'empleado'; matchNombre = e.nombre; matchEntidadId = e.id; }
            }
            if (!matchEntidadId) {
                const a = arrendadoresTesoreria.find(x => cuitsIguales(x.cuit, benCuitN));
                if (a) { matchTipo = 'arrendador'; matchNombre = a.nombre; matchEntidadId = a.id; }
            }
        }

        echeqMetadata = {
            cuenta_libradora: datos.cuenta_libradora || '',
            cuentaMatchId,
            beneficiario_nombre: datos.beneficiario_nombre || '',
            beneficiario_cuit:   datos.beneficiario_cuit   || '',
            beneficiario_match_tipo:   matchTipo,        // 'contratista' | 'empleado' | 'arrendador' | 'otro'
            beneficiario_match_nombre: matchNombre,      // nombre tal como está cargado en el catálogo
            beneficiario_match_id:     matchEntidadId    // id del contratista/empleado/arrendador matcheado
        };

        mostrarExito(`Se detectó${echecks.length !== 1 ? 'aron' : ''} ${echecks.length} e-cheque${echecks.length !== 1 ? 's' : ''}. Revisá los datos antes de guardar.`);
        refrescarModalEcheq();
    } catch (err) {
        console.error(`${ia} falló al extraer e-cheque:`, err);
        mostrarError(`No se pudo extraer con ${ia === 'gemini' ? 'Gemini' : 'Claude'}: ${err.message}. Probá la otra IA.`);
        refrescarModalEcheq();
    }
}

/**
 * Estado 3: formulario editable con los datos extraídos.
 */
function renderEcheqFormulario() {
    const cuentasEmpresa = cuentas.filter(c =>
        c.empresa_id === empresaActivaId && c.moneda === 'ARS' && c.activa
    );
    const opcionesCuentas = cuentasEmpresa.map(c => {
        const sel = c.id === echeqMetadata?.cuentaMatchId ? 'selected' : '';
        const num = c.numero_cuenta ? ` (${c.numero_cuenta})` : '';
        return `<option value="${c.id}" ${sel}>${c.alias || c.banco}${num}</option>`;
    }).join('');
    const opcionesCat = categorias.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');

    const totalMonto = echecksDetectados.reduce((s, e) => s + Number(e.monto || 0), 0);
    const benCuit  = echeqMetadata?.beneficiario_cuit   || '—';
    const benNom   = echeqMetadata?.beneficiario_nombre || '—';
    const cuentaLib = echeqMetadata?.cuenta_libradora   || '—';
    const cuentaMatchAlerta = !echeqMetadata?.cuentaMatchId
        ? `<div style="font-size:var(--texto-xs);color:var(--color-dorado);margin-top:4px;">⚠ No se encontró una cuenta tuya con ese número. Elegí cuál corresponde.</div>`
        : `<div style="font-size:var(--texto-xs);color:var(--color-verde);margin-top:4px;">✓ Coincide con una cuenta tuya.</div>`;

    return `
        <div style="background:rgba(74,158,110,0.05);border:1px solid var(--color-verde);border-radius:var(--radio-md);padding:var(--espacio-sm) var(--espacio-md);margin-bottom:var(--espacio-md);">
            <div style="display:flex;align-items:center;gap:var(--espacio-sm);flex-wrap:wrap;">
                <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-verde)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;flex-shrink:0;"><polyline points="20 6 9 17 4 12"/></svg>
                <div style="flex:1;">Detectado${echecksDetectados.length !== 1 ? 's' : ''} <strong>${echecksDetectados.length} e-cheque${echecksDetectados.length !== 1 ? 's' : ''}</strong> · Total: <strong>$ ${formatearNumero(totalMonto)}</strong></div>
                <button class="btn-secundario" style="padding:4px 10px;font-size:var(--texto-xs);" onclick="quitarEcheqPDF()">Cambiar PDF</button>
            </div>
        </div>

        <div class="form-seccion-titulo">Datos comunes</div>

        <div class="campo-grupo">
            <label class="campo-label">Cuenta libradora <span class="campo-requerido">*</span></label>
            <select id="echeq-cuenta" class="campo-select">
                <option value="">Seleccionar...</option>${opcionesCuentas}
            </select>
            <div style="font-size:var(--texto-xs);color:var(--color-texto-tenue);margin-top:2px;">PDF: <span style="font-family:var(--fuente-mono);">${cuentaLib}</span></div>
            ${cuentaMatchAlerta}
        </div>

        ${renderEcheqBloqueBeneficiario()}

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Categoría</label>
                <select id="echeq-categoria" class="campo-select">
                    <option value="">Seleccionar...</option>${opcionesCat}
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Entregado por</label>
                <select id="echeq-empleado-entrega" class="campo-select">
                    <option value="">— Sin especificar —</option>
                    ${empleadosTesoreria.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('')}
                </select>
            </div>
        </div>

        <hr class="form-separador">

        <div class="form-seccion-titulo">E-cheques detectados</div>
        <div id="echeq-lista">${renderFilasEcheck()}</div>

        <hr class="form-separador">

        <div class="form-seccion-titulo">Facturas <span style="font-weight:400;color:var(--color-texto-tenue);font-size:var(--texto-xs);">(compartidas — se vinculan a TODOS los e-cheques)</span></div>
        <div id="bloque-facturas-pendientes">
            ${renderizarSeccionFacturasPendientes()}
        </div>
    `;
}

/**
 * Bloque de beneficiario editable dentro del modal de e-cheque.
 * Reusa los mismos IDs (ben-tipo, ben-contratista, etc.) y la función
 * actualizarFormBeneficiario() del modal de cheque normal, así el usuario
 * puede modificar el beneficiario detectado por la IA cuando se equivocó.
 *
 * Pre-selección según el auto-match:
 *   - match en contratista/empleado/arrendador → tipo correspondiente + entidad
 *   - sin match (o solo "otro") → tipo 'otro' con nombre+CUIT del PDF
 */
function renderEcheqBloqueBeneficiario() {
    const benNom  = echeqMetadata?.beneficiario_nombre || '';
    const benCuit = echeqMetadata?.beneficiario_cuit   || '';
    const mt = echeqMetadata?.beneficiario_match_tipo || 'otro';
    const mid = echeqMetadata?.beneficiario_match_id   || '';

    // Cartel arriba con la lectura del PDF, para que el usuario sepa qué dijo la IA
    const aviso = `
        <div style="padding:var(--espacio-xs) var(--espacio-sm);background:var(--color-fondo-secundario);border-radius:var(--radio-sm,4px);font-size:var(--texto-xs);color:var(--color-texto-tenue);margin-bottom:var(--espacio-sm);">
            📄 Detectado del PDF: <strong style="color:var(--color-texto);">${benNom || '—'}</strong>${benCuit ? ` · CUIT ${benCuit}` : ''}
            ${mt !== 'otro' && echeqMetadata?.beneficiario_match_nombre
                ? `<br><span style="color:var(--color-verde);">✓ Coincide con ${echeqMetadata.beneficiario_match_nombre} (${mt})</span>`
                : ''}
        </div>
    `;

    const opcionesContr = contratistasTesoreria.map(c =>
        `<option value="${c.id}" ${mt === 'contratista' && mid === c.id ? 'selected' : ''}>${c.nombre}${c.especialidad ? ' — ' + c.especialidad : ''}</option>`
    ).join('');
    const opcionesEmpl = empleadosTesoreria.map(e =>
        `<option value="${e.id}" ${mt === 'empleado' && mid === e.id ? 'selected' : ''}>${e.nombre}</option>`
    ).join('');
    const opcionesArr = arrendadoresTesoreria.map(a =>
        `<option value="${a.id}" ${mt === 'arrendador' && mid === a.id ? 'selected' : ''}>${a.nombre}</option>`
    ).join('');

    return `
        ${aviso}
        <div style="border:1px solid var(--color-borde);border-radius:var(--radio-md);padding:var(--espacio-md);margin-bottom:var(--espacio-md);">
            <div style="font-size:var(--texto-sm);font-weight:600;color:var(--color-texto-secundario);margin-bottom:var(--espacio-sm);">BENEFICIARIO</div>
            <div class="campos-fila">
                <div class="campo-grupo">
                    <label class="campo-label">Tipo</label>
                    <select id="ben-tipo" class="campo-select" onchange="actualizarFormBeneficiarioEcheq(this.value)">
                        <option value="contratista" ${mt === 'contratista' ? 'selected' : ''}>Contratista</option>
                        <option value="empleado"    ${mt === 'empleado'    ? 'selected' : ''}>Empleado</option>
                        <option value="arrendador"  ${mt === 'arrendador'  ? 'selected' : ''}>Arrendador</option>
                        <option value="otro"        ${mt === 'otro'        ? 'selected' : ''}>Otro</option>
                    </select>
                </div>
                <div class="campo-grupo" id="ben-grupo-contratista" style="${mt !== 'contratista' ? 'display:none' : ''}">
                    <label class="campo-label">Contratista</label>
                    <select id="ben-contratista" class="campo-select">
                        <option value="">Seleccionar...</option>${opcionesContr}
                    </select>
                </div>
                <div class="campo-grupo" id="ben-grupo-empleado" style="${mt !== 'empleado' ? 'display:none' : ''}">
                    <label class="campo-label">Empleado</label>
                    <select id="ben-empleado" class="campo-select">
                        <option value="">Seleccionar...</option>${opcionesEmpl}
                    </select>
                </div>
                <div class="campo-grupo" id="ben-grupo-arrendador" style="${mt !== 'arrendador' ? 'display:none' : ''}">
                    <label class="campo-label">Arrendador</label>
                    <select id="ben-arrendador" class="campo-select">
                        <option value="">Seleccionar...</option>${opcionesArr}
                    </select>
                </div>
            </div>
            <div id="ben-grupo-otro" style="${mt !== 'otro' ? 'display:none' : ''}">
                <div class="campos-fila">
                    <div class="campo-grupo">
                        <label class="campo-label">Nombre / Razón social</label>
                        <input type="text" id="ben-otro-nombre" class="campo-input"
                            value="${benNom.replace(/"/g, '&quot;')}" placeholder="Ej: Agro Servicios SRL">
                    </div>
                    <div class="campo-grupo">
                        <label class="campo-label">CUIT (opcional)</label>
                        <input type="text" id="ben-otro-cuit" class="campo-input"
                            value="${benCuit.replace(/"/g, '&quot;')}" placeholder="Ej: 20-12345678-9">
                    </div>
                </div>
            </div>
            <!-- Para arrendadores: tipo blanco/negro (compartido para todos los e-cheques) -->
            <div id="echeq-arrendador-tipo-wrap" style="${mt !== 'arrendador' ? 'display:none' : ''};margin-top:var(--espacio-sm);">
                <div class="campo-grupo">
                    <label class="campo-label">Tipo (blanco/negro)</label>
                    <select id="echeq-arrendador-tipo" class="campo-select">
                        <option value="blanco">Blanco (con factura)</option>
                        <option value="negro">Negro (sin factura)</option>
                    </select>
                </div>
            </div>
        </div>
    `;
}

/**
 * Variante para el modal de e-cheque: hace lo mismo que actualizarFormBeneficiario
 * pero también muestra/oculta el selector blanco/negro del arrendador.
 */
function actualizarFormBeneficiarioEcheq(tipo) {
    document.getElementById('ben-grupo-contratista').style.display = tipo === 'contratista' ? '' : 'none';
    document.getElementById('ben-grupo-empleado').style.display    = tipo === 'empleado'    ? '' : 'none';
    document.getElementById('ben-grupo-arrendador').style.display  = tipo === 'arrendador'  ? '' : 'none';
    document.getElementById('ben-grupo-otro').style.display        = tipo === 'otro'        ? '' : 'none';
    const wrap = document.getElementById('echeq-arrendador-tipo-wrap');
    if (wrap) wrap.style.display = tipo === 'arrendador' ? '' : 'none';
}

function renderFilasEcheck() {
    return echecksDetectados.map((e, i) => `
        <div style="border:1px solid var(--color-borde);border-radius:var(--radio-md);padding:var(--espacio-sm) var(--espacio-md);margin-bottom:var(--espacio-sm);background:var(--color-fondo-tarjeta);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--espacio-xs);">
                <div style="font-size:var(--texto-xs);font-weight:600;color:var(--color-texto-secundario);">E-cheque #${i + 1} <span class="badge badge-azul" style="margin-left:6px;">📱 e-cheq</span></div>
                ${echecksDetectados.length > 1 ? `<button type="button" class="btn-secundario" style="padding:2px 8px;font-size:var(--texto-xs);color:var(--color-error);border-color:var(--color-error);" onclick="quitarFilaEcheck(${i})">Quitar</button>` : ''}
            </div>
            <div class="campos-fila">
                <div class="campo-grupo">
                    <label class="campo-label">Nº <span class="campo-requerido">*</span></label>
                    <input type="text" class="campo-input" value="${e.numero || ''}"
                        oninput="actualizarFilaEcheck(${i}, 'numero', this.value)">
                </div>
                <div class="campo-grupo">
                    <label class="campo-label">Emisión <span class="campo-requerido">*</span></label>
                    <input type="text" data-fecha class="campo-input" value="${isoADDMM(e.fecha_emision)}"
                        placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10"
                        oninput="actualizarFilaEcheck(${i}, 'fecha_emision', ddmmAISO(this.value))">
                </div>
                <div class="campo-grupo">
                    <label class="campo-label">Cobro <span class="campo-requerido">*</span></label>
                    <input type="text" data-fecha class="campo-input" value="${isoADDMM(e.fecha_cobro)}"
                        placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10"
                        oninput="actualizarFilaEcheck(${i}, 'fecha_cobro', ddmmAISO(this.value))">
                </div>
                <div class="campo-grupo">
                    <label class="campo-label">Monto <span class="campo-requerido">*</span></label>
                    <input type="text" data-monto class="campo-input" value="${formatearMontoInput(e.monto)}"
                        oninput="actualizarFilaEcheck(${i}, 'monto', parseMontoInput(this.value))">
                </div>
            </div>
        </div>
    `).join('');
}

function actualizarFilaEcheck(idx, campo, valor) {
    const e = echecksDetectados[idx];
    if (!e) return;
    e[campo] = valor;
}

function quitarFilaEcheck(idx) {
    if (echecksDetectados.length <= 1) return;
    echecksDetectados.splice(idx, 1);
    const cont = document.getElementById('echeq-lista');
    if (cont) cont.innerHTML = renderFilasEcheck();
    if (typeof activarFechasDDMM === 'function') activarFechasDDMM(document.querySelector('.modal'));
    if (typeof activarFormatoMonto === 'function') activarFormatoMonto(document.querySelector('.modal'));
    // Re-render del footer para actualizar la cantidad en el botón
    const footer = document.querySelector('.modal .modal-footer');
    if (footer) footer.innerHTML = renderFooterEcheq();
}

async function guardarEchecks() {
    const cuentaId       = document.getElementById('echeq-cuenta')?.value;
    const categoriaId    = document.getElementById('echeq-categoria')?.value || null;
    const empleadoEntregaId = document.getElementById('echeq-empleado-entrega')?.value || null;

    if (!cuentaId) { mostrarError('Elegí la cuenta libradora.'); return; }
    if (echecksDetectados.length === 0) { mostrarError('No hay e-cheques para registrar.'); return; }

    // Validar cada e-cheque
    const numerosVistos = new Set();
    for (let i = 0; i < echecksDetectados.length; i++) {
        const e = echecksDetectados[i];
        const numero = (e.numero || '').trim();
        if (!numero)            { mostrarError(`E-cheque #${i + 1}: cargá el número.`); return; }
        if (!e.fecha_emision)   { mostrarError(`E-cheque #${i + 1}: cargá la fecha de emisión.`); return; }
        if (!e.fecha_cobro)     { mostrarError(`E-cheque #${i + 1}: cargá la fecha de cobro.`); return; }
        if (!e.monto || e.monto <= 0) { mostrarError(`E-cheque #${i + 1}: monto inválido.`); return; }
        if (numerosVistos.has(numero)) { mostrarError(`Nº "${numero}" repetido.`); return; }
        numerosVistos.add(numero);
    }

    // Resolver beneficiario desde el selector inline (mismo patrón que cheque normal).
    // El usuario puede haber cambiado el tipo/entidad respecto del auto-match de la IA.
    const benTipo = document.getElementById('ben-tipo')?.value || 'otro';
    let beneficiarioId = null;
    let arrIdSel = null;
    let tipoArrBN = 'blanco';
    if (benTipo === 'contratista') {
        const id = document.getElementById('ben-contratista')?.value;
        if (!id) { mostrarError('Seleccioná el contratista.'); return; }
        beneficiarioId = await obtenerOCrearBeneficiario({ tipo: 'contratista', contratista_id: id });
    } else if (benTipo === 'empleado') {
        const id = document.getElementById('ben-empleado')?.value;
        if (!id) { mostrarError('Seleccioná el empleado.'); return; }
        beneficiarioId = await obtenerOCrearBeneficiario({ tipo: 'empleado', empleado_id: id });
    } else if (benTipo === 'arrendador') {
        arrIdSel = document.getElementById('ben-arrendador')?.value;
        if (!arrIdSel) { mostrarError('Seleccioná el arrendador.'); return; }
        tipoArrBN = document.getElementById('echeq-arrendador-tipo')?.value || 'blanco';
        beneficiarioId = await obtenerOCrearBeneficiario({ tipo: 'arrendador', arrendador_id: arrIdSel });
    } else {
        const nombre = document.getElementById('ben-otro-nombre')?.value?.trim();
        const cuit   = document.getElementById('ben-otro-cuit')?.value?.trim() || null;
        if (!nombre) { mostrarError('Cargá el nombre del beneficiario.'); return; }
        beneficiarioId = await obtenerOCrearBeneficiario({ tipo: 'otro', nombre, cuit });
    }
    if (!beneficiarioId) return;

    const btn = document.getElementById('btn-guardar-echeq');
    if (btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }

    // Subir el PDF UNA sola vez al Storage. Todos los e-cheques que vienen
    // de este PDF van a apuntar al mismo archivo.
    let pdfPath = null;
    if (echeqFileSeleccionado) {
        const ts = Date.now();
        const ext = (echeqFileSeleccionado.name.split('.').pop() || 'pdf').toLowerCase();
        const extOk = ['pdf'].includes(ext) ? ext : 'pdf';
        pdfPath = `${empresaActivaId}/${ts}.${extOk}`;
        try {
            const { error: upErr } = await db.storage
                .from('echecks')
                .upload(pdfPath, echeqFileSeleccionado, { upsert: false });
            if (upErr) throw upErr;
        } catch (err) {
            console.error('No se pudo subir el PDF del e-cheque:', err);
            mostrarAlerta('No se pudo subir el PDF al Storage. Los e-cheques se registran igual, pero no vas a poder verlos desde el ojito.');
            pdfPath = null;
        }
    }

    const hoyStr = fechaHoyStr();
    const idsCreados = [];
    const errores = [];

    for (let i = 0; i < echecksDetectados.length; i++) {
        const e = echecksDetectados[i];
        const numero = (e.numero || '').trim();
        const estadoCalc = e.fecha_cobro > hoyStr ? 'futuro' : 'pendiente';

        const datos = {
            empresa_id:          empresaActivaId,
            cuenta_bancaria_id:  cuentaId,
            tipo:                'cheque',
            es_echeck:           true,
            numero_cheque:       numero,
            fecha_emision:       e.fecha_emision,
            fecha_cobro:         e.fecha_cobro,
            fecha_balde:         calcularFechaBaldeJS(e.fecha_cobro),
            beneficiario_id:     beneficiarioId,
            categoria_id:        categoriaId,
            monto:               Number(e.monto),
            notas:               null,
            empleado_entrega_id: empleadoEntregaId,
            origen:              'manual',
            estado:              estadoCalc,
            pdf_url:             pdfPath
        };

        const r = await ejecutarConsulta(
            db.from('movimientos_tesoreria').insert(datos).select(),
            `registrar e-cheque #${i + 1}`
        );
        if (r && r[0]) {
            idsCreados.push(r[0].id);
        } else {
            errores.push(`#${i + 1} (Nº ${numero})`);
        }
    }

    // Procesar facturas (compartidas — se vinculan a todos)
    let resumenFact = null;
    if (idsCreados.length > 0 && facturasPendientesNuevas.length > 0) {
        resumenFact = await procesarFacturasPendientesParaChequesBulk(idsCreados, empresaActivaId);
    }

    const nOK = idsCreados.length;
    const nFail = errores.length;
    if (nFail === 0) {
        let msg = `${nOK} e-cheque${nOK !== 1 ? 's' : ''} registrado${nOK !== 1 ? 's' : ''}`;
        if (resumenFact?.exitos > 0) msg += ` con ${resumenFact.exitos} factura${resumenFact.exitos !== 1 ? 's' : ''} vinculada${resumenFact.exitos !== 1 ? 's' : ''}`;
        mostrarExito(msg + '.');
    } else {
        mostrarAlerta(`${nOK} registrado${nOK !== 1 ? 's' : ''}, ${nFail} fallaron: ${errores.join(', ')}.`);
    }

    cerrarModal();
    echecksDetectados = [];
    echeqMetadata = null;
    echeqFileSeleccionado = null;
    facturasPendientesNuevas = [];
    await cargarTesoreria();
}

/**
 * Descuenta qq del saldo del arrendador en la campaña activa.
 * Espejo simplificado de actualizarSaldo() en movimientos.js.
 */
async function descontarQQArrendador(arrendadorId, tipo, qq) {
    // Obtener campaña activa
    const campanas = await ejecutarConsulta(
        db.from('campanas').select('id').eq('activa', true).limit(1),
        'obtener campaña activa (tesorería)'
    );
    const campanaId = campanas?.[0]?.id;
    if (!campanaId) {
        console.warn('Tesorería: no hay campaña activa — saldo no descontado');
        return;
    }

    // Buscar registro de saldo existente
    const saldos = await ejecutarConsulta(
        db.from('saldos')
            .select('*')
            .eq('arrendador_id', arrendadorId)
            .eq('campana_id', campanaId),
        'buscar saldo (tesorería)'
    );

    const columna = tipo === 'blanco' ? 'qq_deuda_blanco' : 'qq_deuda_negro';

    if (saldos && saldos.length > 0) {
        // Restar los qq del saldo actual
        const saldoActual = saldos[0][columna] || 0;
        await ejecutarConsulta(
            db.from('saldos')
                .update({ [columna]: saldoActual - qq })
                .eq('id', saldos[0].id),
            'actualizar saldo (tesorería)'
        );
    } else {
        // No hay saldo previo — crear con valor negativo (se pagó antes de cargar la deuda)
        await ejecutarConsulta(
            db.from('saldos')
                .insert({
                    arrendador_id: arrendadorId,
                    campana_id:    campanaId,
                    [columna]:     -qq
                }),
            'crear saldo (tesorería)'
        );
    }
}

async function revertirAPendiente(id) {
    // Si la fecha de cobro todavía no llegó, el cheque vuelve a "futuro".
    // Si ya pasó, vuelve a "pendiente".
    const mov       = movimientosTesoreria.find(m => m.id === id);
    const nuevoEst  = mov && mov.fecha_cobro && mov.fecha_cobro > fechaHoyStr()
                      ? 'futuro' : 'pendiente';

    const r = await ejecutarConsulta(
        db.from('movimientos_tesoreria')
          .update({ estado: nuevoEst, fecha_cobrado_real: null })
          .eq('id', id),
        'revertir cheque'
    );
    if (r !== undefined) {
        mostrarExito(nuevoEst === 'futuro' ? 'Cheque revertido a futuro' : 'Cheque revertido a pendiente');
        await cargarTesoreria();
    }
}

async function marcarCobrado(id) {
    const hoy = fechaHoyStr();
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

/**
 * Reactiva un cheque anulado: lo vuelve a 'futuro' o 'pendiente' según
 * la fecha de cobro. Útil cuando se anuló por error.
 */
async function reactivarCheque(id) {
    const mov = movimientosTesoreria.find(m => m.id === id);
    if (!mov) { mostrarError('No se encontró el movimiento.'); return; }
    if (mov.estado !== 'anulado') {
        mostrarAlerta('Solo se pueden reactivar cheques anulados.');
        return;
    }
    if (!confirm(`¿Reactivar el cheque Nº ${mov.numero_cheque || '(sin nº)'}? Volverá a contar en los saldos.`)) return;

    const nuevoEst = mov.fecha_cobro && mov.fecha_cobro > fechaHoyStr() ? 'futuro' : 'pendiente';
    const r = await ejecutarConsulta(
        db.from('movimientos_tesoreria')
          .update({ estado: nuevoEst, fecha_cobrado_real: null })
          .eq('id', id),
        'reactivar cheque'
    );
    if (r !== undefined) {
        mostrarExito(nuevoEst === 'futuro' ? 'Cheque reactivado (futuro)' : 'Cheque reactivado (pendiente)');
        cerrarModal();
        await cargarTesoreria();
    }
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
    document.getElementById('ben-grupo-contratista').style.display    = tipo === 'contratista' ? '' : 'none';
    document.getElementById('ben-grupo-empleado').style.display       = tipo === 'empleado'    ? '' : 'none';
    document.getElementById('ben-grupo-arrendador').style.display     = tipo === 'arrendador'  ? '' : 'none';
    document.getElementById('ben-grupo-otro').style.display           = tipo === 'otro'        ? '' : 'none';
    // El bloque de QQ solo aparece cuando se selecciona arrendador
    const grupoQQ = document.getElementById('ben-grupo-qq-arrendador');
    if (grupoQQ) grupoQQ.style.display = tipo === 'arrendador' ? '' : 'none';
}

// ==============================================
// CREAR CONTRATISTA NUEVO INLINE (desde modal de cheque)
// ==============================================

/**
 * HTML del panel inline para crear un contratista sin salir del modal de
 * cheque. Inicialmente oculto. Se muestra/oculta con togglePanelNuevoContratista().
 */
function renderizarPanelNuevoContratista() {
    return `
        <div id="panel-nuevo-contratista" style="display:none;margin-top:var(--espacio-sm);padding:var(--espacio-sm);background:var(--color-fondo-secundario);border:1px solid var(--color-borde);border-radius:var(--radio-md);">
            <div style="font-size:var(--texto-xs);font-weight:600;color:var(--color-dorado);margin-bottom:var(--espacio-sm);">NUEVO CONTRATISTA</div>
            <div class="campo-grupo" style="margin-bottom:var(--espacio-sm);">
                <label class="campo-label" style="font-size:var(--texto-xs);">Nombre <span class="campo-requerido">*</span></label>
                <input type="text" id="nuevo-contr-nombre" class="campo-input" placeholder="Nombre o razón social">
            </div>
            <div class="campos-fila" style="margin-bottom:var(--espacio-sm);">
                <div class="campo-grupo">
                    <label class="campo-label" style="font-size:var(--texto-xs);">CUIT</label>
                    <input type="text" id="nuevo-contr-cuit" class="campo-input" placeholder="XX-XXXXXXXX-X">
                </div>
                <div class="campo-grupo">
                    <label class="campo-label" style="font-size:var(--texto-xs);">Especialidad</label>
                    <select id="nuevo-contr-especialidad" class="campo-select">
                        <option value="">Seleccionar...</option>
                        <option value="Fumigación">Fumigación</option>
                        <option value="Cosecha">Cosecha</option>
                        <option value="Siembra">Siembra</option>
                        <option value="Transporte">Transporte</option>
                        <option value="Laboreo">Laboreo</option>
                        <option value="Varios">Varios</option>
                    </select>
                </div>
            </div>
            <div style="display:flex;gap:var(--espacio-sm);justify-content:flex-end;">
                <button type="button" class="btn-secundario" onclick="togglePanelNuevoContratista()" style="padding:4px 10px;font-size:var(--texto-xs);">Cancelar</button>
                <button type="button" class="btn-primario" onclick="crearContratistaInline()" style="padding:4px 10px;font-size:var(--texto-xs);">Crear y seleccionar</button>
            </div>
        </div>
    `;
}

function togglePanelNuevoContratista() {
    const panel = document.getElementById('panel-nuevo-contratista');
    if (!panel) return;
    const abierto = panel.style.display !== 'none';
    panel.style.display = abierto ? 'none' : 'block';
    if (!abierto) {
        // Al abrirlo, limpiamos los campos y enfocamos el nombre
        document.getElementById('nuevo-contr-nombre').value = '';
        document.getElementById('nuevo-contr-cuit').value = '';
        document.getElementById('nuevo-contr-especialidad').value = '';
        setTimeout(() => document.getElementById('nuevo-contr-nombre')?.focus(), 50);
    }
}

/**
 * Crea un contratista nuevo en la BD, actualiza el cache local y
 * lo selecciona automáticamente en el dropdown de beneficiario.
 */
async function crearContratistaInline() {
    const nombre = document.getElementById('nuevo-contr-nombre')?.value?.trim();
    const cuit   = document.getElementById('nuevo-contr-cuit')?.value?.trim() || null;
    const esp    = document.getElementById('nuevo-contr-especialidad')?.value || null;

    if (!nombre) {
        mostrarError('El nombre del contratista es obligatorio.');
        return;
    }

    const insertadas = await ejecutarConsulta(
        db.from('contratistas')
          .insert({ nombre, cuit, especialidad: esp })
          .select(),
        'crear contratista'
    );
    if (!insertadas || insertadas.length === 0) return;

    const nuevo = insertadas[0];

    // Actualizar el cache local y reordenar alfabéticamente
    contratistasTesoreria.push(nuevo);
    contratistasTesoreria.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    // Reconstruir el <select> con la nueva opción y dejarlo seleccionado
    const select = document.getElementById('ben-contratista');
    if (select) {
        const opciones = ['<option value="">Seleccionar...</option>'].concat(
            contratistasTesoreria.map(c =>
                `<option value="${c.id}">${c.nombre}${c.especialidad ? ' — ' + c.especialidad : ''}</option>`
            )
        );
        select.innerHTML = opciones.join('');
        select.value = nuevo.id;
    }

    // Cerrar panel
    togglePanelNuevoContratista();
    mostrarExito(`Contratista "${nombre}" creado y seleccionado.`);
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

    const hoy = fechaHoyStr();

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
                <input type="text" data-fecha id="saldo-fecha" class="campo-input" value="${isoADDMM(hoy)}" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Saldo ($) <span class="campo-requerido">*</span></label>
                <input type="text" data-monto id="saldo-monto" class="campo-input" placeholder="Saldo actual del banco">
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
    const fecha    = ddmmAISO(document.getElementById('saldo-fecha')?.value);
    const saldo    = parseMontoInput(document.getElementById('saldo-monto')?.value);

    if (!cuentaId) { mostrarError('Seleccioná la cuenta.'); return; }
    if (!fecha)    { mostrarError('La fecha es obligatoria.'); return; }
    if (saldo == null) { mostrarError('Ingresá el saldo.'); return; }

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

    const hoy = fechaHoyStr();

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
                <input type="text" data-monto id="prest-monto" class="campo-input" placeholder="Monto total del préstamo">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Cantidad de cuotas <span class="campo-requerido">*</span></label>
                <input type="number" id="prest-cuotas" class="campo-input" placeholder="Ej: 12" min="1" max="360">
            </div>
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Fecha de otorgamiento <span class="campo-requerido">*</span></label>
                <input type="text" data-fecha id="prest-fecha" class="campo-input" value="${isoADDMM(hoy)}" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
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
    const monto      = parseMontoInput(document.getElementById('prest-monto')?.value);
    const cantCuotas = parseInt(document.getElementById('prest-cuotas')?.value);
    const fechaOtorg = ddmmAISO(document.getElementById('prest-fecha')?.value);
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
            const fechaVencStr = fechaALocalStr(fechaVenc);

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
            const fechaVencStr = fechaALocalStr(fechaVenc);

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
    const hoy = fechaHoyStr();
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

    // Para los egresos pendientes (saldo real) consideramos pendiente + futuro:
    // ambos van a salir de la cuenta, solo cambia cuándo.
    const pendientes = movimientosTesoreria.filter(m =>
        m.empresa_id === empresaActivaId &&
        (m.estado === 'pendiente' || m.estado === 'futuro')
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

    // Agrupar pendientes y futuros por balde.
    // Mostramos todos los baldes con compromisos (incluyendo vencidos que aún
    // están sin cobrar) ordenados de más viejo a más nuevo, capando en 8.
    const grupos = {};
    pendientes.forEach(m => {
        if (!m.fecha_balde) return;
        if (!grupos[m.fecha_balde]) grupos[m.fecha_balde] = [];
        grupos[m.fecha_balde].push(m);
    });
    cuotasPend.forEach(c => {
        if (!c.fecha_balde) return;
        if (!grupos[c.fecha_balde]) grupos[c.fecha_balde] = [];
        grupos[c.fecha_balde].push({ ...c, monto: c.monto_total, tipo: 'cuota', beneficiarios: { nombre: prestamosE.find(p => p.id === c.prestamo_id)?.acreedor || 'Préstamo' } });
    });

    const hoyBalde = calcularFechaBaldeJS(fechaHoyStr());
    const baldesOrdenados = Object.keys(grupos).sort().slice(0, 8);

    const fechaHoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    let texto = `📊 TESORERÍA — ${empresa.nombre.toUpperCase()}\n`;
    texto += `📅 ${fechaHoy}\n`;
    texto += `${'─'.repeat(38)}\n\n`;

    // Total de movimientos registrados (pendientes + cobrados, excluyendo anulados)
    const totalMovRegistrados = movimientosTesoreria.filter(m =>
        m.empresa_id === empresaActivaId && m.estado !== 'anulado'
    ).length;

    if (saldoBanco !== null) {
        texto += `🏦 Saldo banco (ARS):   $ ${formatearNumero(saldoBanco)}\n`;
        texto += `📋 Egresos pendientes:  $ ${formatearNumero(totalEgresos)}\n`;
        texto += `✅ Saldo real:          $ ${formatearNumero(saldoReal)}\n`;
    } else {
        texto += `⚠️ Saldo banco no cargado — actualizarlo para ver saldo real.\n`;
    }
    texto += `📌 Movimientos registrados: ${totalMovRegistrados}\n\n`;

    if (baldesOrdenados.length > 0) {
        texto += `📆 BALDES CON COMPROMISOS\n`;
        texto += `${'─'.repeat(38)}\n`;
        baldesOrdenados.forEach(balde => {
            const movs  = grupos[balde];
            const total = movs.reduce((s, m) => s + Number(m.monto), 0);
            const vencido = balde < hoyBalde;
            const marca   = vencido ? ' ⚠️ VENCIDO' : (balde === hoyBalde ? ' 📍 HOY' : '');
            texto += `\n🗓️ Balde ${formatearFecha(balde)} — $ ${formatearNumero(total)}${marca}\n`;
            movs.forEach(m => {
                const tipo = m.tipo === 'cheque' ? '  ✓ Cheque' : m.tipo === 'transferencia' ? '  → Transf.' : '  🏦 Cuota ';
                const cat  = m.categorias_gasto?.nombre ? ` (${m.categorias_gasto.nombre})` : '';
                const ben  = (m.beneficiarios?.nombre || '') + cat;
                texto += `${tipo}  ${ben.padEnd(30)} $ ${formatearNumero(m.monto)}\n`;
            });
        });
    } else {
        texto += `✅ Sin compromisos pendientes.\n`;
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
    return fechaALocalStr(balde);
}

/**
 * Devuelve el balde inmediatamente posterior al dado (que debe ser un balde
 * normalizado: día múltiplo de 5 o último día del mes).
 * Respeta los límites de mes: el balde después del 30 de mayo es el 5 de
 * junio (no el 4), y después del 25 de febrero es el 5 de marzo.
 */
function siguienteBalde(baldeStr) {
    if (!baldeStr) return baldeStr;
    const fecha = new Date(baldeStr + 'T12:00:00');
    const dia   = fecha.getDate();

    if (dia < 25) {
        // 5 → 10, 10 → 15, 15 → 20, 20 → 25
        fecha.setDate(dia + 5);
    } else if (dia === 25) {
        // Si el mes tiene día 30, el siguiente balde es 30; sino salta a 5 del mes próximo
        const ultimoDia = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0).getDate();
        if (ultimoDia >= 30) {
            fecha.setDate(30);
        } else {
            fecha.setMonth(fecha.getMonth() + 1, 5);
        }
    } else {
        // 30 → 5 del mes próximo (día 31 también cae acá tras normalizar a 30)
        fecha.setMonth(fecha.getMonth() + 1, 5);
    }
    return fechaALocalStr(fecha);
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
