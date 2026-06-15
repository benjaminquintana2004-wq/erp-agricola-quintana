// ==============================================
// campanas.js — Campañas agrícolas
// El estado (Histórica / Actual / Futura) se calcula por las fechas.
// El flag campanas.activa se sincroniza automáticamente con la actual,
// para que el resto del ERP (que filtra por .eq('activa', true)) siga
// funcionando sin cambios.
// ==============================================

let campanasCargadas = [];

// ==============================================
// Helpers — Estado calculado por fechas
// ==============================================

/**
 * Devuelve el rango [inicio, fin] de una campaña como objetos Date.
 * Convención argentina: campaña 2024/25 = 1-jul-2024 → 30-jun-2025.
 */
function rangoCampana(c) {
    const inicio = new Date(c.anio_inicio, 6, 1);    // 1 de julio
    const fin    = new Date(c.anio_fin, 5, 30, 23, 59, 59);   // 30 de junio
    return { inicio, fin };
}

/**
 * Calcula el estado real de la campaña según la fecha de hoy.
 * Devuelve 'historica' | 'actual' | 'futura'.
 */
function calcularEstadoCampana(c) {
    const hoy = new Date();
    const { inicio, fin } = rangoCampana(c);
    if (hoy < inicio) return 'futura';
    if (hoy > fin)    return 'historica';
    return 'actual';
}

/**
 * Sincroniza el flag .activa en BD con la campaña que cubre el día de hoy.
 * Si la activa actual coincide con lo que diría el cálculo, no hace nada.
 * Devuelve el id de la campaña que quedó activa, o null si no hay ninguna que cubra hoy.
 */
async function sincronizarCampanaActiva(campanas) {
    const deberiaSerActiva = campanas.find(c => calcularEstadoCampana(c) === 'actual');
    if (!deberiaSerActiva) return null;

    const yaEstaBien = deberiaSerActiva.activa &&
        campanas.every(c => c.id === deberiaSerActiva.id || !c.activa);
    if (yaEstaBien) return deberiaSerActiva.id;

    // Hay que corregir: poner activa la correcta y desactivar las demás.
    await ejecutarConsulta(
        db.from('campanas').update({ activa: false }).neq('id', deberiaSerActiva.id),
        'desactivar campañas viejas'
    );
    await ejecutarConsulta(
        db.from('campanas').update({ activa: true }).eq('id', deberiaSerActiva.id),
        'activar campaña actual'
    );

    // Actualizar el cache local para que el render refleje el cambio
    campanas.forEach(c => { c.activa = (c.id === deberiaSerActiva.id); });
    return deberiaSerActiva.id;
}

// ==============================================
// LEER — Cargar campañas
// ==============================================

async function cargarCampanas() {
    const [data, contratos, movimientos] = await Promise.all([
        ejecutarConsulta(
            db.from('campanas')
                .select('*')
                .order('anio_inicio', { ascending: false }),
            'cargar campañas'
        ),
        // Traemos TODOS los contratos vigentes (no filtramos por campaña) para
        // luego calcular el solapamiento por fechas en código.
        ejecutarConsulta(
            db.from('contratos')
                .select('id, fecha_inicio, fecha_fin, hectareas, qq_pactados_anual, qq_negro_anual, contratos_arrendadores(arrendador_id)'),
            'cargar contratos para stats de campañas'
        ),
        // Movimientos imputados a cada campaña: necesarios para calcular
        // el saldo dinámico (pactado − pagado).
        ejecutarConsulta(
            db.from('movimientos')
                .select('campana_id, contrato_id, tipo, qq'),
            'cargar movimientos para stats de campañas'
        )
    ]);

    if (data === undefined) return;

    // Sincronizar la actual antes de calcular stats (así el badge "Activa" coincide)
    await sincronizarCampanaActiva(data);

    const conStats = data.map((c) => {
        // Contratos cuya vigencia solapa con el rango de la campaña
        const { inicio: ini, fin } = rangoCampana(c);
        const iniStr = `${ini.getFullYear()}-${String(ini.getMonth()+1).padStart(2,'0')}-${String(ini.getDate()).padStart(2,'0')}`;
        const finStr = `${fin.getFullYear()}-${String(fin.getMonth()+1).padStart(2,'0')}-${String(fin.getDate()).padStart(2,'0')}`;
        const contratosSolapan = (contratos || []).filter(ct => {
            if (!ct.fecha_inicio || !ct.fecha_fin) return false;
            return ct.fecha_inicio <= finStr && ct.fecha_fin >= iniStr;
        });

        const setArr = new Set();
        contratosSolapan.forEach(ct => {
            (ct.contratos_arrendadores || []).forEach(ca => {
                if (ca.arrendador_id) setArr.add(ca.arrendador_id);
            });
        });

        // QQ pendientes = pactado anual de cada contrato que solapa
        //                 - movimientos imputados a esta campaña.
        // El cálculo es dinámico: independiente de lo que diga la tabla saldos.
        let pactadoTotal = 0;
        let hectareasTotal = 0;
        contratosSolapan.forEach(ct => {
            pactadoTotal += parseFloat(ct.qq_pactados_anual || 0);
            pactadoTotal += parseFloat(ct.qq_negro_anual || 0);
            hectareasTotal += parseFloat(ct.hectareas || 0);
        });

        let pagadoTotal = 0;
        const idsContratosSolapan = new Set(contratosSolapan.map(ct => ct.id));
        (movimientos || []).forEach(m => {
            if (m.campana_id !== c.id) return;
            if (!idsContratosSolapan.has(m.contrato_id)) return;
            pagadoTotal += parseFloat(m.qq || 0);
        });

        const qqPendientes = Math.max(0, pactadoTotal - pagadoTotal);

        return {
            ...c,
            estadoCalculado:    calcularEstadoCampana(c),
            totalArrendadores:  setArr.size,
            totalContratos:     contratosSolapan.length,
            totalHectareas:     hectareasTotal,
            qqPactado:          pactadoTotal,
            qqPagado:           pagadoTotal,
            qqPendientes
        };
    });

    campanasCargadas = conStats;
    renderizarCampanas(conStats);
    mostrarAlertaCampanaActualFaltante(conStats);
}

/**
 * Si no existe ninguna campaña que cubra el día de hoy, mostrar banner
 * con botón para crearla automáticamente.
 */
function mostrarAlertaCampanaActualFaltante(campanas) {
    const cont = document.getElementById('alerta-campana-faltante');
    const hayActual = campanas.some(c => c.estadoCalculado === 'actual');
    if (!cont) return;

    if (hayActual) {
        cont.style.display = 'none';
        return;
    }

    // Calcular el nombre que debería tener la campaña actual
    const hoy = new Date();
    const anioInicio = hoy.getMonth() >= 6 ? hoy.getFullYear() : hoy.getFullYear() - 1;
    const anioFin = anioInicio + 1;
    const nombreSugerido = `${anioInicio}/${anioFin.toString().slice(-2)}`;

    cont.style.display = 'block';
    cont.innerHTML = `
        <div style="padding:var(--espacio-md);background:rgba(232,183,74,0.10);border:1px solid #e8b74a;border-radius:var(--radio-md);display:flex;align-items:center;justify-content:space-between;gap:var(--espacio-md);flex-wrap:wrap;margin-bottom:var(--espacio-lg);">
            <div style="color:#e8b74a;">
                ⚠️ <strong>La campaña actual (${nombreSugerido}) no está creada.</strong>
                El resto del ERP necesita una campaña activa para funcionar bien.
            </div>
            <button class="btn-primario" onclick="crearCampanaActualRapida(${anioInicio}, ${anioFin})">
                Crear ${nombreSugerido}
            </button>
        </div>
    `;
}

/**
 * Crea rápidamente la campaña que cubre el día de hoy. Usado por el banner
 * de "campaña actual faltante".
 */
async function crearCampanaActualRapida(anioInicio, anioFin) {
    const nombre = `${anioInicio}/${anioFin.toString().slice(-2)}`;
    const r = await ejecutarConsulta(
        db.from('campanas').insert({ nombre, anio_inicio: anioInicio, anio_fin: anioFin, activa: true }).select(),
        'crear campaña actual'
    );
    if (!r || r.length === 0) return;
    // Auto-poblar saldos de los contratos que solapan
    await asegurarSaldosContratosParaCampana(r[0]);
    mostrarExito(`Campaña ${nombre} creada con saldos iniciales.`);
    await cargarCampanas();
}

// ==============================================
// RENDERIZAR — Grid de tarjetas
// ==============================================

function renderizarCampanas(campanas) {
    const grid = document.getElementById('campanas-grid');
    const contador = document.getElementById('tabla-contador');
    const usuario = window.__USUARIO__;
    const esAdmin = ['admin_total', 'admin'].includes(usuario?.rol);

    if (contador) {
        contador.textContent = `${campanas.length} campaña${campanas.length !== 1 ? 's' : ''}`;
    }

    if (campanas.length === 0) {
        grid.innerHTML = `
            <div class="campanas-vacio">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <p>No hay campañas creadas.<br>Creá la primera para empezar a trabajar.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = campanas.map(c => {
        const estado = c.estadoCalculado || 'historica';
        const esActual = estado === 'actual';
        const claseActiva = esActual ? 'campana-tarjeta-activa' : '';

        const mapaBadge = {
            actual:    '<span class="badge badge-verde">🟢 ACTUAL</span>',
            futura:    '<span class="badge badge-amarillo">🟡 FUTURA</span>',
            historica: '<span class="badge badge-gris">⚫ HISTÓRICA</span>'
        };
        const badgeEstado = mapaBadge[estado];

        const nombreEsc = c.nombre.replace(/'/g, "\\'");

        return `
        <div class="campana-tarjeta ${claseActiva}">
            <div class="campana-header">
                <span class="campana-nombre">${escaparHTML(c.nombre)}</span>
                <div style="display:flex;align-items:center;gap:var(--espacio-sm);">
                    ${badgeEstado}
                    ${esAdmin ? `
                        <details class="campana-menu">
                            <summary class="campana-menu-btn" title="Acciones">⋮</summary>
                            <div class="campana-menu-items">
                                <button onclick="editarCampana('${c.id}')">
                                    ${ICONOS.editar}
                                    <span>Editar</span>
                                </button>
                                <button onclick="recalcularSaldosCampana('${c.id}', '${nombreEsc}')" title="Recalcula todos los saldos de la campaña desde cero, en base a los contratos y movimientos actuales.">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>
                                    <span>Recalcular saldos</span>
                                </button>
                                ${!esActual ? `
                                    <button onclick="confirmarEliminarCampana('${c.id}', '${nombreEsc}')" class="campana-menu-item-peligro">
                                        ${ICONOS.eliminar}
                                        <span>Eliminar</span>
                                    </button>
                                ` : ''}
                            </div>
                        </details>
                    ` : ''}
                </div>
            </div>
            <div class="campana-periodo">
                Julio ${c.anio_inicio} — Junio ${c.anio_fin}
            </div>
            <div class="campana-stats">
                <div class="campana-stat">
                    <span class="campana-stat-valor">${c.totalContratos}</span>
                    <span class="campana-stat-label">Contratos</span>
                </div>
                <div class="campana-stat">
                    <span class="campana-stat-valor">${c.totalArrendadores}</span>
                    <span class="campana-stat-label">Arrendadores</span>
                </div>
                <div class="campana-stat">
                    <span class="campana-stat-valor">${formatearNumero(c.totalHectareas)}</span>
                    <span class="campana-stat-label">Hectáreas</span>
                </div>
                <div class="campana-stat">
                    <span class="campana-stat-valor">${formatearQQ(c.qqPendientes)}</span>
                    <span class="campana-stat-label">QQ pendientes</span>
                </div>
            </div>
            <div class="campana-acciones">
                <a class="campana-btn campana-btn-ver" href="/campana.html?id=${c.id}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    Ver detalle
                </a>
            </div>
        </div>
        `;
    }).join('');
}

// ==============================================
// CREAR / EDITAR — Modal
// ==============================================

let campanaEditandoId = null;

function abrirModalNuevaCampana() {
    campanaEditandoId = null;

    // Sugerir siguiente campaña
    const hoy = new Date();
    const anio = hoy.getMonth() >= 6 ? hoy.getFullYear() : hoy.getFullYear() - 1;
    const sugerido = {
        nombre: `${anio}/${(anio + 1).toString().slice(2)}`,
        anio_inicio: anio,
        anio_fin: anio + 1
    };

    abrirModalCampana('Nueva Campaña', sugerido);
}

function editarCampana(id) {
    const campana = campanasCargadas.find(c => c.id === id);
    if (!campana) {
        mostrarError('No se encontró la campaña.');
        return;
    }
    campanaEditandoId = id;
    abrirModalCampana('Editar Campaña', campana);
}

function abrirModalCampana(titulo, datos) {
    const contenido = `
        <div class="campo-grupo">
            <label class="campo-label">Nombre de la campaña <span class="campo-requerido">*</span></label>
            <input type="text" id="campo-nombre" class="campo-input" value="${escaparHTML(datos.nombre)}" placeholder="Ej: 2025/26">
            <span class="campo-ayuda">Formato: año inicio / últimos 2 dígitos del año fin</span>
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Año inicio <span class="campo-requerido">*</span></label>
                <input type="number" id="campo-anio-inicio" class="campo-input" value="${datos.anio_inicio || ''}" placeholder="Ej: 2025" min="2020" max="2040">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Año fin <span class="campo-requerido">*</span></label>
                <input type="number" id="campo-anio-fin" class="campo-input" value="${datos.anio_fin || ''}" placeholder="Ej: 2026" min="2020" max="2040">
            </div>
        </div>
        <span class="campo-ayuda">Las campañas agrícolas van de julio a junio del año siguiente.</span>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarCampana()">
            ${campanaEditandoId ? 'Guardar cambios' : 'Crear campaña'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
    setTimeout(() => document.getElementById('campo-nombre')?.focus(), 100);

    // Auto-completar nombre cuando cambian los años
    const inputInicio = document.getElementById('campo-anio-inicio');
    const inputFin = document.getElementById('campo-anio-fin');
    const inputNombre = document.getElementById('campo-nombre');

    const actualizarNombre = () => {
        const inicio = inputInicio.value;
        const fin = inputFin.value;
        if (inicio && fin && fin.length >= 2) {
            inputNombre.value = `${inicio}/${fin.slice(-2)}`;
        }
    };

    inputInicio.addEventListener('change', actualizarNombre);
    inputFin.addEventListener('change', actualizarNombre);
}

async function guardarCampana() {
    const nombre = document.getElementById('campo-nombre')?.value.trim();
    const anioInicio = document.getElementById('campo-anio-inicio')?.value;
    const anioFin = document.getElementById('campo-anio-fin')?.value;

    if (!nombre) {
        mostrarError('El nombre es obligatorio.');
        return;
    }
    if (!anioInicio || !anioFin) {
        mostrarError('Los años de inicio y fin son obligatorios.');
        return;
    }
    if (parseInt(anioFin) <= parseInt(anioInicio)) {
        mostrarError('El año fin debe ser mayor al año inicio.');
        return;
    }

    // Verificar duplicados
    const duplicado = campanasCargadas.find(c => {
        if (campanaEditandoId && c.id === campanaEditandoId) return false;
        return c.nombre.toLowerCase() === nombre.toLowerCase();
    });
    if (duplicado) {
        mostrarError(`Ya existe una campaña con el nombre "${nombre}".`);
        return;
    }

    const datos = {
        nombre,
        anio_inicio: parseInt(anioInicio),
        anio_fin: parseInt(anioFin)
    };

    let resultado;

    if (campanaEditandoId) {
        resultado = await ejecutarConsulta(
            db.from('campanas').update(datos).eq('id', campanaEditandoId),
            'actualizar campaña'
        );
    } else {
        // Si es la primera campaña, activarla automáticamente
        if (campanasCargadas.length === 0) {
            datos.activa = true;
        }
        resultado = await ejecutarConsulta(
            db.from('campanas').insert(datos).select(),
            'crear campaña'
        );

        // Auto-crear saldos para los contratos que solapan con esta nueva campaña.
        // Así cada contrato queda con su deuda inicial registrada en la campaña.
        if (resultado && resultado.length > 0) {
            await asegurarSaldosContratosParaCampana(resultado[0]);
        }
    }

    if (resultado !== undefined) {
        cerrarModal();
        mostrarExito(campanaEditandoId ? 'Campaña actualizada' : 'Campaña creada');
        campanaEditandoId = null;
        await cargarCampanas();
    }
}

/**
 * Para una campaña dada, busca todos los contratos cuya vigencia solapa con
 * el rango (1-jul-anio_inicio a 30-jun-anio_fin) y crea su saldo inicial si
 * no existe. Respeta saldos ya cargados (no pisa valores).
 *
 * Se llama desde guardarCampana al crear una nueva, y desde crearCampanaActualRapida.
 */
async function asegurarSaldosContratosParaCampana(campana) {
    const iniStr = `${campana.anio_inicio}-07-01`;
    const finStr = `${campana.anio_fin}-06-30`;

    // Buscar contratos cuya vigencia solapa con la campaña
    const contratos = await ejecutarConsulta(
        db.from('contratos')
            .select('id, qq_pactados_anual, qq_negro_anual')
            .lte('fecha_inicio', finStr)
            .gte('fecha_fin', iniStr),
        'buscar contratos para inicializar saldos'
    ) || [];

    for (const c of contratos) {
        // Verificar si ya existe el saldo (no pisar)
        const existentes = await ejecutarConsulta(
            db.from('saldos').select('id')
                .eq('contrato_id', c.id)
                .eq('campana_id', campana.id)
                .limit(1),
            'verificar saldo existente'
        );
        if (existentes && existentes.length > 0) continue;

        await ejecutarConsulta(
            db.from('saldos').insert({
                contrato_id: c.id,
                campana_id: campana.id,
                qq_deuda_blanco: parseFloat(c.qq_pactados_anual || 0),
                qq_deuda_negro: parseFloat(c.qq_negro_anual || 0)
            }),
            'crear saldo contrato/campaña'
        );
    }
}

// ==============================================
// ACTIVAR — Solo una activa a la vez
// ==============================================

async function activarCampana(id, nombre) {
    // Primero desactivar todas
    const desactivar = await ejecutarConsulta(
        db.from('campanas').update({ activa: false }).neq('id', id),
        'desactivar campañas'
    );

    // Luego activar la seleccionada
    const activar = await ejecutarConsulta(
        db.from('campanas').update({ activa: true }).eq('id', id),
        'activar campaña'
    );

    if (activar !== undefined) {
        mostrarExito(`Campaña "${nombre}" activada`);
        await cargarCampanas();
    }
}

// ==============================================
// ELIMINAR
// ==============================================

function confirmarEliminarCampana(id, nombre) {
    window.__idEliminarCampana = id;
    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto); margin-bottom: var(--espacio-md);">
            ¿Seguro que querés eliminar la campaña <strong>${nombre}</strong>?
        </p>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">
            Se eliminarán los saldos auto-generados de esta campaña. Si tiene
            contratos, lotes o silobolsas asociados, no se podrá eliminar (primero
            reasignalos o eliminalos). Esta acción no se puede deshacer.
        </p>
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-peligro" onclick="cerrarModal(); eliminarCampana(window.__idEliminarCampana)">
            Sí, eliminar
        </button>
    `;
    abrirModal('Confirmar eliminación', contenido, footer);
}

async function eliminarCampana(id) {
    // ── 1) Proteger datos reales ────────────────────────────────────────────
    // La campaña tiene una FK desde varias tablas. Los SALDOS son derivados
    // (se auto-crean al crear la campaña) y se pueden borrar sin perder nada.
    // Pero contratos, lotes asociados y silobolsas son datos cargados a mano:
    // si existen, no borramos en cascada — avisamos y frenamos.
    const [contratos, lotesCamp, silos] = await Promise.all([
        ejecutarConsulta(db.from('contratos').select('id').eq('campana_id', id).limit(1),       'verificar contratos de la campaña'),
        ejecutarConsulta(db.from('lote_campanas').select('id').eq('campana_id', id).limit(1),   'verificar lotes de la campaña'),
        ejecutarConsulta(db.from('silobolsas').select('id').eq('campana_id', id).limit(1),      'verificar silobolsas de la campaña')
    ]);

    // Si alguna verificación falló, abortamos sin tocar nada.
    if (contratos === undefined || lotesCamp === undefined || silos === undefined) return;

    const bloqueos = [];
    if (contratos.length) bloqueos.push('contratos');
    if (lotesCamp.length) bloqueos.push('lotes asociados');
    if (silos.length)     bloqueos.push('silobolsas');
    if (bloqueos.length) {
        mostrarError(`No se puede eliminar: la campaña tiene ${bloqueos.join(', ')} asociados. Reasignalos o eliminalos antes de borrar la campaña.`);
        return;
    }

    // ── 2) Borrar los saldos derivados que bloquean la FK ───────────────────
    const okSaldos = await ejecutarConsulta(
        db.from('saldos').delete().eq('campana_id', id),
        'eliminar saldos de la campaña'
    );
    if (okSaldos === undefined) return;

    // ── 3) Borrar la campaña (con .select() para saber si realmente se borró) ─
    const resultado = await ejecutarConsulta(
        db.from('campanas').delete().eq('id', id).select(),
        'eliminar campaña'
    );
    if (resultado === undefined) return;

    // RLS: si el usuario no es admin_total, el DELETE no da error pero borra 0 filas.
    if (resultado.length === 0) {
        mostrarError('No se pudo eliminar la campaña. Solo el administrador total puede borrar campañas.');
        return;
    }

    mostrarExito('Campaña eliminada');
    await cargarCampanas();
}

// ==============================================
// INICIALIZAR SALDOS — Crea saldos iniciales para todos los contratos
// de la campaña (solo los que no tengan saldo creado).
// ==============================================

async function inicializarSaldosCampana(campanaId, campanaNombre) {
    if (!confirm(`Crear saldos iniciales para todos los contratos de la campaña "${campanaNombre}"?\n\nNo se pisan saldos ya existentes, solo se crean los que falten.`)) {
        return;
    }

    // Traer todos los contratos de esta campaña
    const contratos = await ejecutarConsulta(
        db.from('contratos')
            .select('id, qq_pactados_anual, qq_negro_anual')
            .eq('campana_id', campanaId),
        'cargar contratos de la campaña'
    );

    if (!contratos || contratos.length === 0) {
        mostrarAlerta('No hay contratos asociados a esta campaña.');
        return;
    }

    // Traer los saldos ya existentes (por contrato) para no pisarlos
    const saldosExistentes = await ejecutarConsulta(
        db.from('saldos').select('contrato_id').eq('campana_id', campanaId),
        'cargar saldos existentes'
    );
    const conSaldo = new Set((saldosExistentes || []).map(s => s.contrato_id));

    // Un saldo por contrato (no por arrendador, ya que el saldo es a nivel contrato)
    const aInsertar = contratos
        .filter(c => !conSaldo.has(c.id))
        .map(c => ({
            contrato_id: c.id,
            campana_id: campanaId,
            qq_deuda_blanco: parseFloat(c.qq_pactados_anual || 0),
            qq_deuda_negro: parseFloat(c.qq_negro_anual || 0)
        }));

    if (aInsertar.length === 0) {
        mostrarAlerta('Todos los contratos de esta campaña ya tienen saldo inicializado.');
        return;
    }

    const resultado = await ejecutarConsulta(
        db.from('saldos').insert(aInsertar),
        'crear saldos iniciales'
    );

    if (resultado !== undefined) {
        mostrarExito(`Se crearon ${aInsertar.length} saldo${aInsertar.length !== 1 ? 's' : ''} inicial${aInsertar.length !== 1 ? 'es' : ''}.`);
        await cargarCampanas();
    }
}

// ==============================================
// RECALCULAR SALDOS — Pisa todos los saldos de la campaña
// ==============================================
// A diferencia de "Inicializar saldos", este proceso RECALCULA desde cero
// todos los saldos existentes usando la fórmula:
//
//   qq_deuda_blanco = Σ contratos.qq_pactados_anual − Σ movimientos blanco
//   qq_deuda_negro  = Σ contratos.qq_negro_anual    − Σ movimientos negro
//
// Sirve para desinflar saldos que quedaron desalineados por contratos
// borrados antes del fix, ediciones manuales erróneas, etc.
// Si un saldo no tiene contrato vivo en la campaña, se borra.
// ==============================================

async function recalcularSaldosCampana(campanaId, campanaNombre) {
    if (!confirm(
        `Recalcular TODOS los saldos de la campaña "${campanaNombre}" desde cero?\n\n` +
        `Se pisarán los valores actuales usando:\n` +
        `  qq pendientes = qq pactados (contrato) − qq ya vendidos (movimientos del contrato)\n\n` +
        `Los saldos sin contrato vivo en esta campaña se eliminarán.\n\n` +
        `Esto no se puede deshacer.`
    )) {
        return;
    }

    // 1) Traer contratos de la campaña
    const contratos = await ejecutarConsulta(
        db.from('contratos')
            .select('id, qq_pactados_anual, qq_negro_anual')
            .eq('campana_id', campanaId),
        'cargar contratos de la campaña'
    );

    // 2) Traer movimientos de la campaña
    const movimientos = await ejecutarConsulta(
        db.from('movimientos')
            .select('contrato_id, qq, tipo')
            .eq('campana_id', campanaId),
        'cargar movimientos de la campaña'
    );

    // 3) Traer saldos actuales (para saber cuáles borrar)
    const saldosActuales = await ejecutarConsulta(
        db.from('saldos')
            .select('id, contrato_id')
            .eq('campana_id', campanaId),
        'cargar saldos actuales'
    );

    // 4) Pactados por contrato
    const pactados = {};
    for (const c of contratos || []) {
        pactados[c.id] = {
            blanco: parseFloat(c.qq_pactados_anual || 0),
            negro: parseFloat(c.qq_negro_anual || 0)
        };
    }

    // 5) Vendidos por contrato
    const vendidos = {};
    for (const m of movimientos || []) {
        if (!m.contrato_id) continue;
        if (!vendidos[m.contrato_id]) vendidos[m.contrato_id] = { blanco: 0, negro: 0 };
        const qq = parseFloat(m.qq || 0);
        if (m.tipo === 'negro') vendidos[m.contrato_id].negro += qq;
        else vendidos[m.contrato_id].blanco += qq;
    }

    // 6) Saldos finales (pactado − vendido) para cada contrato
    const finales = {};
    for (const [ctId, p] of Object.entries(pactados)) {
        const v = vendidos[ctId] || { blanco: 0, negro: 0 };
        finales[ctId] = {
            blanco: Math.max(0, p.blanco - v.blanco),
            negro: Math.max(0, p.negro - v.negro)
        };
    }

    // 7) Aplicar cambios
    const saldosPorContrato = {};
    for (const s of saldosActuales || []) {
        if (s.contrato_id) saldosPorContrato[s.contrato_id] = s.id;
    }

    let actualizados = 0;
    let creados = 0;
    let borrados = 0;

    for (const [ctId, qq] of Object.entries(finales)) {
        if (saldosPorContrato[ctId]) {
            const res = await ejecutarConsulta(
                db.from('saldos')
                    .update({ qq_deuda_blanco: qq.blanco, qq_deuda_negro: qq.negro })
                    .eq('id', saldosPorContrato[ctId]),
                'actualizar saldo recalculado'
            );
            if (res !== undefined) actualizados++;
        } else {
            const res = await ejecutarConsulta(
                db.from('saldos').insert({
                    contrato_id: ctId,
                    campana_id: campanaId,
                    qq_deuda_blanco: qq.blanco,
                    qq_deuda_negro: qq.negro
                }),
                'crear saldo recalculado'
            );
            if (res !== undefined) creados++;
        }
    }

    // Borrar saldos huérfanos (sin contrato vivo en esta campaña)
    for (const s of saldosActuales || []) {
        if (!s.contrato_id || !finales[s.contrato_id]) {
            const res = await ejecutarConsulta(
                db.from('saldos').delete().eq('id', s.id),
                'eliminar saldo huérfano'
            );
            if (res !== undefined) borrados++;
        }
    }

    mostrarExito(
        `Saldos recalculados — ${actualizados} actualizados, ${creados} creados, ${borrados} eliminados.`
    );
    await cargarCampanas();
}
