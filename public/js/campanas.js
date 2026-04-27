// ==============================================
// campanas.js — CRUD de campañas agrícolas
// Crear, activar/desactivar y eliminar campañas.
// Solo una campaña puede estar activa a la vez.
// ==============================================

let campanasCargadas = [];

// ==============================================
// LEER — Cargar campañas
// ==============================================

async function cargarCampanas() {
    const data = await ejecutarConsulta(
        db.from('campanas')
            .select('*')
            .order('anio_inicio', { ascending: false }),
        'cargar campañas'
    );

    if (data === undefined) return;

    // Para cada campaña, contar contratos y saldos asociados
    const conStats = await Promise.all(data.map(async (c) => {
        const [contratos, saldos] = await Promise.all([
            // Contratos de esta campaña con su pivot — para contar arrendadores únicos
            ejecutarConsulta(
                db.from('contratos')
                    .select('id, contratos_arrendadores(arrendador_id)')
                    .eq('campana_id', c.id),
                'contar contratos campaña'
            ),
            ejecutarConsulta(
                db.from('saldos')
                    .select('id, qq_deuda_blanco, qq_deuda_negro')
                    .eq('campana_id', c.id),
                'contar saldos'
            )
        ]);

        // Arrendadores únicos con contrato en esta campaña (via pivot N:N)
        const setArr = new Set();
        (contratos || []).forEach(ct => {
            (ct.contratos_arrendadores || []).forEach(ca => {
                if (ca.arrendador_id) setArr.add(ca.arrendador_id);
            });
        });
        const arrendadoresUnicos = setArr.size;

        // Calcular QQ pendientes totales de esta campaña
        let qqTotal = 0;
        if (saldos) {
            saldos.forEach(s => {
                qqTotal += parseFloat(s.qq_deuda_blanco || 0) + parseFloat(s.qq_deuda_negro || 0);
            });
        }

        return {
            ...c,
            totalArrendadores: arrendadoresUnicos,
            totalSaldos: saldos?.length || 0,
            qqPendientes: qqTotal
        };
    }));

    campanasCargadas = conStats;
    renderizarCampanas(conStats);
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
        const esActiva = c.activa;
        const claseActiva = esActiva ? 'campana-tarjeta-activa' : '';
        const badgeActiva = esActiva
            ? '<span class="badge badge-verde">Activa</span>'
            : '<span class="badge badge-gris">Inactiva</span>';

        return `
        <div class="campana-tarjeta ${claseActiva}">
            <div class="campana-header">
                <span class="campana-nombre">${c.nombre}</span>
                ${badgeActiva}
            </div>
            <div class="campana-periodo">
                Julio ${c.anio_inicio} — Junio ${c.anio_fin}
            </div>
            <div class="campana-stats">
                <div class="campana-stat">
                    <span class="campana-stat-valor">${c.totalArrendadores}</span>
                    <span class="campana-stat-label">Arrendadores</span>
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
            ${esAdmin ? `
                <div class="campana-acciones">
                    ${!esActiva ? `
                        <button class="campana-btn campana-btn-activar" onclick="activarCampana('${c.id}', '${c.nombre}')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            Activar
                        </button>
                    ` : `
                        <button class="campana-btn" disabled style="opacity:0.5;cursor:default;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            Campaña activa
                        </button>
                        <button class="campana-btn" onclick="inicializarSaldosCampana('${c.id}', '${c.nombre.replace(/'/g, "\\'")}')" title="Crea los saldos iniciales para todos los contratos de esta campaña (no pisa saldos ya existentes)">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8"/></svg>
                            Inicializar saldos
                        </button>
                        <button class="campana-btn" onclick="recalcularSaldosCampana('${c.id}', '${c.nombre.replace(/'/g, "\\'")}')" title="Recalcula todos los saldos de la campaña desde cero, en base a los contratos y movimientos actuales. Pisa los valores existentes.">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>
                            Recalcular saldos
                        </button>
                    `}
                    <button class="campana-btn" onclick="editarCampana('${c.id}')">
                        ${ICONOS.editar}
                        Editar
                    </button>
                    ${!esActiva ? `
                        <button class="campana-btn campana-btn-eliminar" onclick="confirmarEliminarCampana('${c.id}', '${c.nombre.replace(/'/g, "\\'")}')">
                            ${ICONOS.eliminar}
                        </button>
                    ` : ''}
                </div>
            ` : ''}
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
            <input type="text" id="campo-nombre" class="campo-input" value="${datos.nombre || ''}" placeholder="Ej: 2025/26">
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
            db.from('campanas').insert(datos),
            'crear campaña'
        );
    }

    if (resultado !== undefined) {
        cerrarModal();
        mostrarExito(campanaEditandoId ? 'Campaña actualizada' : 'Campaña creada');
        campanaEditandoId = null;
        await cargarCampanas();
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
            Se eliminarán los saldos y asociaciones de lotes vinculadas a esta campaña.
            Esta acción no se puede deshacer.
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
    const resultado = await ejecutarConsulta(
        db.from('campanas').delete().eq('id', id),
        'eliminar campaña'
    );

    if (resultado !== undefined) {
        mostrarExito('Campaña eliminada');
        await cargarCampanas();
    }
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
