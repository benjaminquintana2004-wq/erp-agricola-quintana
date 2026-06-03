// ==============================================
// movimientos.js — CRUD de movimientos (ventas de quintales)
// Registrar, editar, ver y eliminar movimientos.
// Incluye: diferenciación blanco/negro, estados de factura,
// subida de factura PDF, extracción con Gemini, alertas.
// ==============================================

// Datos en memoria
let movimientosCargados = [];
let arrendadoresParaSelect = [];
let contratosParaSelect = [];        // contratos con sus arrendadores vinculados
let campanasParaSelect = [];         // todas las campañas (para el selector del modal)
let movimientoEditandoId = null;
let filtroTipoActual = 'todos';
let filtroFacturaActual = null;
let filtroEjecucionActual = 'todos';   // todos | en_curso | listo | vencido | ejecutado
let filtroArrendadorId = null;        // id del arrendador a filtrar (viene de ?arrendador=X)
let filtroArrendadorNombre = null;    // nombre mostrado en el chip
let archivoPDFFactura = null;

// ==============================================
// LEER — Cargar y mostrar movimientos
// ==============================================

async function cargarMovimientos() {
    const tbody = document.getElementById('tabla-movimientos-body');
    tbody.innerHTML = `
        <tr>
            <td colspan="8" style="text-align: center; padding: var(--espacio-xl);">
                <div class="spinner" style="margin: 0 auto;"></div>
                <p style="color: var(--color-texto-tenue); margin-top: var(--espacio-md);">Cargando movimientos...</p>
            </td>
        </tr>
    `;

    // Cargo en paralelo: movimientos + contratos vigentes con sus arrendadores + campañas
    const [data, contratos, arrendadores, campanas] = await Promise.all([
        ejecutarConsulta(
            db.from('movimientos')
                .select(`
                    *,
                    arrendadores ( nombre, cuit ),
                    contratos ( id, nombre_grupo, campo ),
                    transferencia:movimientos_tesoreria!movimiento_arrendamiento_id (
                        id, estado, fecha_cobro, fecha_cobrado_real, monto
                    )
                `)
                .order('fecha', { ascending: false }),
            'cargar movimientos'
        ),
        ejecutarConsulta(
            db.from('contratos')
                .select(`
                    id, nombre_grupo, campo, fecha_inicio, fecha_fin,
                    contratos_arrendadores (
                        arrendador_id,
                        es_titular_principal,
                        orden,
                        arrendadores ( id, nombre, cuit )
                    )
                `)
                .order('fecha_fin', { ascending: false }),
            'cargar contratos'
        ),
        ejecutarConsulta(
            db.from('arrendadores')
                .select('id, nombre, cuit')
                .eq('activo', true)
                .order('nombre'),
            'cargar arrendadores'
        ),
        ejecutarConsulta(
            db.from('campanas')
                .select('id, nombre, activa, anio_inicio, anio_fin')
                .order('anio_inicio', { ascending: false }),
            'cargar campañas'
        )
    ]);

    if (data === undefined) return;

    if (arrendadores !== undefined) {
        arrendadoresParaSelect = arrendadores;
    }
    if (contratos !== undefined) {
        contratosParaSelect = contratos;
    }
    if (campanas !== undefined) {
        campanasParaSelect = campanas;
    }

    movimientosCargados = data;

    // Si la URL trae ?arrendador=X, activar filtro por arrendador una vez
    aplicarFiltroArrendadorDesdeURL();

    // Si la URL trae ?ejec=listo|vencido|en_curso|ejecutado, aplicar filtro del semáforo
    aplicarFiltroEjecucionDesdeURL();

    renderizarTabla(movimientosCargados);
    actualizarContadores(movimientosCargados);
    mostrarAlertasFacturas(movimientosCargados);

    // Actualizar el badge del sidebar con datos frescos (listos + vencidos)
    if (typeof actualizarBadgeSidebar === 'function') {
        const urgentes = movimientosCargados.filter(m => {
            const e = calcularEstadoEjecucion(m);
            return e === 'prometido_listo' || e === 'prometido_vencido';
        }).length;
        actualizarBadgeSidebar('movimientos', urgentes);
    }
}

/**
 * Lee ?ejec=<estado> de la URL y aplica el filtro del semáforo una vez.
 * Usado por las alertas del dashboard que linkean directo al estado urgente.
 */
function aplicarFiltroEjecucionDesdeURL() {
    const params = new URLSearchParams(window.location.search);
    const ejec = params.get('ejec');
    const validos = ['todos', 'en_curso', 'listo', 'vencido', 'ejecutado'];
    if (!validos.includes(ejec)) return;
    filtroEjecucionActual = ejec;
    document.querySelectorAll('.filtro-btn[data-ejec]').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.ejec === ejec);
    });
    // Limpiar el query param para que un refresh no vuelva a aplicarlo
    const url = new URL(window.location);
    url.searchParams.delete('ejec');
    window.history.replaceState({}, '', url);
}

/**
 * Lee ?arrendador=<id> de la URL. Si existe, activa el filtro y
 * muestra un chip arriba de la tabla que se puede quitar con click.
 * Se ejecuta sólo una vez por carga — si el usuario limpia el chip
 * no vuelve a aplicarse.
 */
function aplicarFiltroArrendadorDesdeURL() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('arrendador');
    if (!id) {
        renderizarChipFiltroArrendador();
        return;
    }
    // Buscar el nombre en los movimientos ya cargados
    const mov = movimientosCargados.find(m => m.arrendador_id === id);
    const nombre = mov?.arrendadores?.nombre || 'este arrendador';

    filtroArrendadorId = id;
    filtroArrendadorNombre = nombre;
    renderizarChipFiltroArrendador();

    // Limpiar el query param de la URL para que al recargar/quitar filtro no vuelva
    const urlLimpia = window.location.pathname;
    window.history.replaceState({}, '', urlLimpia);
}

function renderizarChipFiltroArrendador() {
    const cont = document.getElementById('chip-filtro-arrendador');
    if (!cont) return;
    if (!filtroArrendadorId) {
        cont.innerHTML = '';
        return;
    }
    cont.innerHTML = `
        <div style="display:inline-flex; align-items:center; gap: var(--espacio-sm);
                    background: var(--color-dorado-suave); color: var(--color-dorado);
                    border: 1px solid var(--color-dorado); border-radius: var(--radio-completo);
                    padding: 6px 14px; margin-bottom: var(--espacio-md); font-size: var(--texto-sm);">
            <span>Filtrado por: <strong>${filtroArrendadorNombre}</strong></span>
            <button onclick="limpiarFiltroArrendador()" title="Quitar filtro"
                style="background: transparent; border: none; color: inherit; cursor: pointer;
                       font-size: var(--texto-base); line-height: 1; padding: 0 2px;">×</button>
        </div>
    `;
}

function limpiarFiltroArrendador() {
    filtroArrendadorId = null;
    filtroArrendadorNombre = null;
    renderizarChipFiltroArrendador();
    renderizarTabla(movimientosCargados);
    actualizarContadores(movimientosCargados);
}

// ==============================================
// RENDERIZAR — Tabla de movimientos
// ==============================================

function renderizarTabla(movimientos) {
    let mostrar = movimientos;

    // Filtro por arrendador (viene de ?arrendador=X en la URL)
    if (filtroArrendadorId) {
        mostrar = mostrar.filter(m => m.arrendador_id === filtroArrendadorId);
    }

    // Filtro por tipo (blanco/negro)
    if (filtroTipoActual !== 'todos') {
        mostrar = mostrar.filter(m => m.tipo === filtroTipoActual);
    }

    // Filtro por estado de factura
    if (filtroFacturaActual) {
        mostrar = mostrar.filter(m => m.estado_factura === filtroFacturaActual);
    }

    // Filtro por estado del ciclo Prometido → Ejecutado
    if (filtroEjecucionActual && filtroEjecucionActual !== 'todos') {
        const mapaFiltro = {
            en_curso:  'prometido_en_curso',
            listo:     'prometido_listo',
            vencido:   'prometido_vencido',
            ejecutado: 'ejecutado'
        };
        const estadoBuscado = mapaFiltro[filtroEjecucionActual];
        if (estadoBuscado) {
            mostrar = mostrar.filter(m => calcularEstadoEjecucion(m) === estadoBuscado);
        }
    }

    const tbody = document.getElementById('tabla-movimientos-body');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);
    const puedeEliminar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (mostrar.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="tabla-vacia">
                    No hay movimientos registrados
                    <p>Hacé click en "Nuevo Movimiento" para registrar una venta de quintales</p>
                </td>
            </tr>
        `;
        actualizarContadorTexto(0);
        return;
    }

    tbody.innerHTML = mostrar.map(m => {
        const nombreArr = m.arrendadores?.nombre || 'Sin arrendador';
        const total = (m.qq && m.precio_quintal) ? m.qq * m.precio_quintal : null;
        const tipoBadge = m.tipo === 'blanco'
            ? '<span class="badge badge-blanco">Blanco</span>'
            : '<span class="badge badge-negro">Negro</span>';
        const facturaBadge = obtenerBadgeFactura(m);
        const precioComparacion = compararPrecio(m);

        // Semáforo del ciclo Prometido → Ejecutado
        const estadoEjec = calcularEstadoEjecucion(m);
        const estadoBadge = obtenerBadgeEstadoEjecucion(estadoEjec);
        const t = transferenciaDe(m);
        const filaClase =
            estadoEjec === 'prometido_listo'   ? 'fila-listo'    :
            estadoEjec === 'prometido_vencido' ? 'fila-vencido'  :
            estadoEjec === 'ejecutado'         ? 'fila-ejecutado': '';

        // Botón "Ejecutar" sólo cuando hay transferencia pendiente y está
        // en estado amarillo o rojo (días >= 7). El verde (en curso) no muestra
        // el botón para evitar ejecutar antes de tiempo.
        const mostrarBtnEjec = puedeEditar && t && t.id
            && (estadoEjec === 'prometido_listo' || estadoEjec === 'prometido_vencido');
        const btnEjecutar = mostrarBtnEjec
            ? `<button class="tabla-btn" style="color:var(--color-verde);" title="Ejecutar transferencia" onclick="confirmarEjecutarTransferencia('${t.id}', '${nombreArr.replace(/'/g, "\\'").replace(/"/g, '&quot;')}', ${Number(t.monto || total || 0)})">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="20 6 9 17 4 12"/></svg>
               </button>`
            : '';

        return `
        <tr class="${filaClase}">
            <td>${formatearFecha(m.fecha)}</td>
            <td>
                <strong>${escaparHTML(nombreArr)}</strong>
                ${m.contratos?.nombre_grupo && m.contratos.nombre_grupo !== nombreArr
                    ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">${escaparHTML(m.contratos.nombre_grupo)}${m.contratos.campo ? ' · ' + escaparHTML(m.contratos.campo) : ''}</span>`
                    : (m.arrendadores?.cuit ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">${escaparHTML(m.arrendadores.cuit)}</span>` : '')}
            </td>
            <td><strong>${formatearQQ(m.qq)}</strong></td>
            <td>
                ${m.precio_quintal ? formatearMoneda(m.precio_quintal, m.moneda) : '—'}
                ${precioComparacion}
            </td>
            <td>${total ? formatearMoneda(total, m.moneda) : '—'}</td>
            <td>${tipoBadge}</td>
            <td>${estadoBadge}</td>
            <td>${facturaBadge}</td>
            <td>
                <div class="tabla-acciones">
                    <button class="tabla-btn" onclick="verMovimiento('${m.id}')" title="Ver detalle">
                        ${ICONOS.ver}
                    </button>
                    ${btnEjecutar}
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="editarMovimiento('${m.id}')" title="Editar">
                            ${ICONOS.editar}
                        </button>
                    ` : ''}
                    ${puedeEliminar ? `
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarMovimiento('${m.id}', '${nombreArr.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')" title="Eliminar">
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

function obtenerBadgeFactura(mov) {
    const dias = calcularDiasSinFactura(mov);
    const estados = {
        sin_factura: `<span class="badge badge-sin-factura">Sin factura${dias ? ` (${dias}d)` : ''}</span>`,
        reclamada: `<span class="badge badge-reclamada">Reclamada${dias ? ` (${dias}d)` : ''}</span>`,
        factura_ok: '<span class="badge badge-factura-ok">OK</span>'
    };
    return estados[mov.estado_factura] || '—';
}

/**
 * Devuelve el primer registro de transferencia vinculada en formato objeto.
 * El join de Supabase devuelve un array porque la columna FK no es UNIQUE,
 * pero en la práctica siempre es 0 o 1.
 */
function transferenciaDe(mov) {
    if (!mov || !mov.transferencia) return null;
    if (Array.isArray(mov.transferencia)) return mov.transferencia[0] || null;
    return mov.transferencia;
}

/**
 * Calcula los días sin factura desde la fecha de EJECUCIÓN del pago (no
 * desde la fecha del movimiento). Si todavía no se ejecutó la transferencia
 * no se cuenta — la factura recién se espera después del pago real.
 */
function calcularDiasSinFactura(mov) {
    if (mov.estado_factura === 'factura_ok') return null;
    const t = transferenciaDe(mov);
    const fechaBase = t?.fecha_cobrado_real;
    if (!fechaBase) return null;   // nunca se ejecutó: no hay factura esperada todavía
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const f = new Date(fechaBase + 'T00:00:00');
    return Math.floor((hoy - f) / (1000 * 60 * 60 * 24));
}

// ==============================================
// CICLO PROMETIDO → EJECUTADO (semáforo de transferencias)
// ==============================================

/**
 * Calcula el estado del ciclo de pago de un movimiento de arrendamiento.
 * Devuelve uno de:
 *   - 'efectivo'           (tipo='negro': pago en mano, no entra al ciclo bancario)
 *   - 'ejecutado'          (transferencia.estado = 'cobrado')
 *   - 'cancelado'          (transferencia.estado = 'anulado')
 *   - 'sin_pago'           (blanco sin precio o movimiento previo a la integración)
 *   - 'prometido_en_curso' (transferencia pendiente, 0-6 días desde fecha del mov)
 *   - 'prometido_listo'    (pendiente, 7-9 días: hay que transferir)
 *   - 'prometido_vencido'  (pendiente, 10+ días: atrasado)
 */
function calcularEstadoEjecucion(mov) {
    // Negro = efectivo en mano, no genera registro en tesorería ni entra al
    // semáforo de Prometido/Ejecutado.
    if (mov.tipo === 'negro') return 'efectivo';

    const t = transferenciaDe(mov);
    if (!t) return 'sin_pago';
    if (t.estado === 'cobrado')  return 'ejecutado';
    if (t.estado === 'anulado')  return 'cancelado';
    // Cualquier otro estado (pendiente, futuro) → calcular por días
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const f = new Date(mov.fecha + 'T00:00:00');
    const dias = Math.floor((hoy - f) / (1000 * 60 * 60 * 24));
    if (dias < 7)   return 'prometido_en_curso';
    if (dias < 10)  return 'prometido_listo';
    return 'prometido_vencido';
}

function obtenerBadgeEstadoEjecucion(estado) {
    const mapa = {
        efectivo:            '<span class="badge badge-gris">💵 Efectivo</span>',
        ejecutado:           '<span class="badge badge-verde">✓ Ejecutado</span>',
        cancelado:           '<span class="badge badge-gris">Cancelado</span>',
        sin_pago:            '<span class="badge badge-gris">Sin pago</span>',
        prometido_en_curso:  '<span class="badge badge-verde">🟢 En curso</span>',
        prometido_listo:     '<span class="badge badge-amarillo">🟡 Listo</span>',
        prometido_vencido:   '<span class="badge badge-rojo">🔴 Vencido</span>'
    };
    return mapa[estado] || '—';
}

/**
 * Modal de confirmación previo a ejecutar una transferencia.
 * Tras confirmar, marca el movimiento_tesoreria vinculado como 'cobrado'.
 */
function confirmarEjecutarTransferencia(transfId, nombreArr, monto) {
    window.__transfEjecutar = transfId;
    abrirModal('Ejecutar transferencia',
        `<p style="font-size:var(--texto-base);color:var(--color-texto);">
            ¿Confirmás que ya transferiste <strong>$ ${formatearNumero(monto)}</strong> a <strong>${nombreArr}</strong>?
        </p>
        <p style="font-size:var(--texto-sm);color:var(--color-texto-secundario);margin-top:var(--espacio-sm);">
            El movimiento queda marcado como ejecutado y se actualiza el cobro en tesorería con la fecha de hoy.
        </p>`,
        `<button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
         <button class="btn-primario" onclick="cerrarModal(); ejecutarTransferencia(window.__transfEjecutar)">Sí, ejecutar</button>`
    );
}

/**
 * Marca la transferencia como cobrada (equivalente al marcarCobrado()
 * de tesoreria.js, replicado para no acoplar archivos).
 */
async function ejecutarTransferencia(transfId) {
    if (!transfId) return;
    const hoy = fechaHoyStr();
    const r = await ejecutarConsulta(
        db.from('movimientos_tesoreria')
          .update({ estado: 'cobrado', fecha_cobrado_real: hoy })
          .eq('id', transfId),
        'ejecutar transferencia'
    );
    if (r === undefined) return;
    mostrarExito('Transferencia ejecutada.');
    await cargarMovimientos();
}

function compararPrecio(mov) {
    if (!mov.precio_quintal || !mov.precio_mercado_dia) return '';
    const diff = mov.precio_quintal - mov.precio_mercado_dia;
    const pct = ((diff / mov.precio_mercado_dia) * 100).toFixed(1);

    if (diff > 0) {
        return `<div class="precio-comparacion precio-arriba">+${pct}% vs mercado</div>`;
    } else if (diff < 0) {
        return `<div class="precio-comparacion precio-abajo">${pct}% vs mercado</div>`;
    }
    return `<div class="precio-comparacion precio-igual">= mercado</div>`;
}

// ==============================================
// CONTADORES Y FILTROS
// ==============================================

function actualizarContadores(movimientos) {
    // Si hay filtro por arrendador, los contadores reflejan sólo sus movimientos
    const base = filtroArrendadorId
        ? movimientos.filter(m => m.arrendador_id === filtroArrendadorId)
        : movimientos;

    const conteos = {
        todos: base.length,
        blanco: base.filter(m => m.tipo === 'blanco').length,
        negro: base.filter(m => m.tipo === 'negro').length,
        sin_factura: base.filter(m => m.estado_factura === 'sin_factura').length,
        reclamada: base.filter(m => m.estado_factura === 'reclamada').length
    };

    document.getElementById('cont-todos').textContent = conteos.todos;
    document.getElementById('cont-blanco').textContent = conteos.blanco;
    document.getElementById('cont-negro').textContent = conteos.negro;
    document.getElementById('cont-sin_factura').textContent = conteos.sin_factura;
    document.getElementById('cont-reclamada').textContent = conteos.reclamada;

    // Contadores del semáforo Prometido → Ejecutado
    const conteosEjec = {
        todos: base.length,
        en_curso: 0,
        listo: 0,
        vencido: 0,
        ejecutado: 0
    };
    for (const m of base) {
        const e = calcularEstadoEjecucion(m);
        if (e === 'prometido_en_curso') conteosEjec.en_curso++;
        else if (e === 'prometido_listo')    conteosEjec.listo++;
        else if (e === 'prometido_vencido')  conteosEjec.vencido++;
        else if (e === 'ejecutado')          conteosEjec.ejecutado++;
        // 'sin_pago' y 'cancelado' no se cuentan en ninguna categoría visible
    }
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setText('cont-ejec-todos',     conteosEjec.todos);
    setText('cont-ejec-en_curso',  conteosEjec.en_curso);
    setText('cont-ejec-listo',     conteosEjec.listo);
    setText('cont-ejec-vencido',   conteosEjec.vencido);
    setText('cont-ejec-ejecutado', conteosEjec.ejecutado);
}

function actualizarContadorTexto(cantidad) {
    const contador = document.getElementById('tabla-contador');
    if (contador) {
        contador.textContent = `${cantidad} movimiento${cantidad !== 1 ? 's' : ''}`;
    }
}

function filtrarPorTipo(tipo) {
    filtroTipoActual = tipo;
    filtroFacturaActual = null;

    // Sólo tocar botones con data-filtro (no los del semáforo data-ejec)
    document.querySelectorAll('.filtro-btn[data-filtro]').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.filtro === tipo);
    });

    renderizarTabla(movimientosCargados);
}

function filtrarPorFactura(estado) {
    // Si ya está activo, desactivar
    if (filtroFacturaActual === estado) {
        filtroFacturaActual = null;
        document.querySelectorAll('.filtro-btn[data-filtro]').forEach(btn => {
            btn.classList.toggle('activo', btn.dataset.filtro === filtroTipoActual);
        });
    } else {
        filtroFacturaActual = estado;
        document.querySelectorAll('.filtro-btn[data-filtro]').forEach(btn => {
            btn.classList.toggle('activo', btn.dataset.filtro === estado);
        });
    }

    renderizarTabla(movimientosCargados);
}

/**
 * Cambia el filtro del semáforo Prometido → Ejecutado.
 * Sólo afecta a los botones con data-ejec (no confundir con data-filtro).
 */
function filtrarPorEjecucion(estado) {
    filtroEjecucionActual = estado;
    document.querySelectorAll('.filtro-btn[data-ejec]').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.ejec === estado);
    });
    renderizarTabla(movimientosCargados);
}

// ==============================================
// ALERTAS DE FACTURAS PENDIENTES
// ==============================================

function mostrarAlertasFacturas(movimientos) {
    const contenedor = document.getElementById('alertas-facturas');
    if (!contenedor) return;

    let alertasHTML = '';

    // Facturas > 20 días sin recibir
    const urgentes = movimientos.filter(m => {
        if (m.estado_factura === 'factura_ok') return false;
        const dias = calcularDiasSinFactura(m);
        return dias >= 20;
    });

    if (urgentes.length > 0) {
        alertasHTML += `
            <div class="alerta-factura alerta-factura-rojo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span><strong>${urgentes.length} factura${urgentes.length > 1 ? 's' : ''} pendiente${urgentes.length > 1 ? 's' : ''} hace más de 20 días:</strong>
                ${urgentes.map(m => `${escaparHTML(m.arrendadores?.nombre || '?')} (${formatearQQ(m.qq)})`).join(', ')}</span>
            </div>
        `;
    }

    // Facturas entre 10-20 días
    const alerta = movimientos.filter(m => {
        if (m.estado_factura === 'factura_ok') return false;
        const dias = calcularDiasSinFactura(m);
        return dias >= 10 && dias < 20;
    });

    if (alerta.length > 0) {
        alertasHTML += `
            <div class="alerta-factura alerta-factura-amarillo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span><strong>${alerta.length} factura${alerta.length > 1 ? 's' : ''} pendiente${alerta.length > 1 ? 's' : ''} (10-20 días):</strong>
                ${alerta.map(m => `${escaparHTML(m.arrendadores?.nombre || '?')} (${formatearQQ(m.qq)})`).join(', ')}</span>
            </div>
        `;
    }

    contenedor.innerHTML = alertasHTML;
}

// ==============================================
// BUSCAR
// ==============================================

function buscarMovimientos(termino) {
    const t = termino.toLowerCase().trim();
    if (!t) {
        renderizarTabla(movimientosCargados);
        return;
    }

    const filtrados = movimientosCargados.filter(m =>
        (m.arrendadores?.nombre && m.arrendadores.nombre.toLowerCase().includes(t)) ||
        (m.arrendadores?.cuit && m.arrendadores.cuit.includes(t)) ||
        (m.nro_comprobante && m.nro_comprobante.includes(t)) ||
        (m.punto_venta && m.punto_venta.includes(t)) ||
        (m.observaciones && m.observaciones.toLowerCase().includes(t))
    );

    const backup = movimientosCargados;
    movimientosCargados = filtrados;
    renderizarTabla(filtrados);
    movimientosCargados = backup;
}

// ==============================================
// CREAR / EDITAR — Modal de formulario
// ==============================================

function abrirModalNuevoMovimiento() {
    movimientoEditandoId = null;
    archivoPDFFactura = null;
    abrirModalMovimiento('Nuevo Movimiento', {});
}

async function editarMovimiento(id) {
    const mov = movimientosCargados.find(m => m.id === id);
    if (!mov) {
        mostrarError('No se encontró el movimiento.');
        return;
    }
    movimientoEditandoId = id;
    archivoPDFFactura = null;
    abrirModalMovimiento('Editar Movimiento', mov);
}

function abrirModalMovimiento(titulo, datos) {
    // Contrato seleccionado: si estamos editando, viene de datos.contrato_id
    const contratoIdSel = datos.contrato_id || '';

    const opcionesContratos = contratosParaSelect.map(c => {
        const grupo = c.nombre_grupo || (c.contratos_arrendadores?.[0]?.arrendadores?.nombre) || 'Sin nombre';
        const campo = c.campo ? ' — ' + c.campo : '';
        return `<option value="${c.id}" ${contratoIdSel === c.id ? 'selected' : ''}>${grupo}${campo}</option>`;
    }).join('');

    // Arrendadores del contrato seleccionado (si hay)
    const opcionesArrendadores = construirOpcionesArrendadoresPorContrato(contratoIdSel, datos.arrendador_id);

    // Campañas: el default al crear es la campaña activa. Al editar, se respeta
    // la campana_id que ya tenía el movimiento (o la activa si está en NULL).
    const campanaActiva = campanasParaSelect.find(c => c.activa);
    const campanaIdSel = datos.campana_id || campanaActiva?.id || '';
    const opcionesCampanas = campanasParaSelect.map(c =>
        `<option value="${c.id}" ${campanaIdSel === c.id ? 'selected' : ''}>${c.nombre}${c.activa ? ' (activa)' : ''}</option>`
    ).join('');

    const hoy = fechaHoyStr();

    // Sección de PDF de factura
    let pdfSeccion = '';
    if (datos.pdf_url) {
        pdfSeccion = `
            <div class="pdf-archivo-actual" id="pdf-actual">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <div class="pdf-archivo-info">
                    <div class="pdf-archivo-nombre">Factura PDF</div>
                </div>
                <div class="pdf-archivo-acciones">
                    <button onclick="verPDFFactura('${datos.pdf_url}')">Ver PDF</button>
                    <button onclick="extraerFacturaDesdeStorage('${datos.pdf_url}')">Extraer con IA</button>
                </div>
            </div>
        `;
    }

    const contenido = `
        <div class="form-seccion-titulo">Datos del movimiento</div>

        <div class="campo-grupo">
            <label class="campo-label">Campaña <span class="campo-requerido">*</span></label>
            <select id="campo-campana" class="campo-select">
                ${campanasParaSelect.length === 0 ? '<option value="">Sin campañas cargadas</option>' : opcionesCampanas}
            </select>
            <span class="campo-ayuda">A qué campaña se imputa el pago. Útil para cargar pagos viejos o adelantos a la próxima.</span>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Contrato <span class="campo-requerido">*</span></label>
            <select id="campo-contrato" class="campo-select" onchange="actualizarArrendadoresPorContrato()">
                <option value="">Seleccionar contrato...</option>
                ${opcionesContratos}
            </select>
            <span class="campo-ayuda">Primero el contrato — después aparece quién factura.</span>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Quién factura <span class="campo-requerido">*</span></label>
            <select id="campo-arrendador" class="campo-select" ${contratoIdSel ? '' : 'disabled'}>
                <option value="">${contratoIdSel ? 'Seleccionar arrendador...' : 'Elegí primero un contrato'}</option>
                ${opcionesArrendadores}
            </select>
            <span class="campo-ayuda">Persona o empresa del contrato que emite la factura.</span>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Tipo de operación <span class="campo-requerido">*</span></label>
            <div class="tipo-selector">
                <label class="tipo-opcion ${datos.tipo === 'blanco' || !datos.tipo ? 'seleccionado' : ''}" onclick="seleccionarTipo(this, 'blanco')">
                    <input type="radio" name="tipo" value="blanco" ${datos.tipo === 'blanco' || !datos.tipo ? 'checked' : ''}>
                    Blanco (con factura)
                </label>
                <label class="tipo-opcion ${datos.tipo === 'negro' ? 'seleccionado' : ''}" onclick="seleccionarTipo(this, 'negro')">
                    <input type="radio" name="tipo" value="negro" ${datos.tipo === 'negro' ? 'checked' : ''}>
                    Negro (sin factura)
                </label>
            </div>
            <span class="campo-ayuda">Blanco = operación formal con factura ARCA. Negro = informal, sin comprobante.</span>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Fecha <span class="campo-requerido">*</span></label>
                <input type="text" data-fecha id="campo-fecha" class="campo-input" value="${isoADDMM(datos.fecha || hoy)}" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Quintales <span class="campo-requerido">*</span></label>
                <input type="number" id="campo-qq" class="campo-input" value="${datos.qq || ''}" placeholder="Ej: 140" step="0.01" min="0">
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Precio por quintal</label>
                <input type="number" id="campo-precio" class="campo-input" value="${datos.precio_quintal || ''}" placeholder="Ej: 48000" step="0.01" min="0">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Moneda</label>
                <select id="campo-moneda" class="campo-select">
                    <option value="ARS" ${datos.moneda === 'ARS' || !datos.moneda ? 'selected' : ''}>$ Pesos (ARS)</option>
                    <option value="USD" ${datos.moneda === 'USD' ? 'selected' : ''}>U$D Dólares (USD)</option>
                </select>
            </div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Observaciones</label>
            <textarea id="campo-observaciones" class="campo-textarea" rows="2" placeholder="Notas adicionales...">${escaparHTML(datos.observaciones)}</textarea>
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo" id="seccion-factura-titulo">Factura (opcional)</div>

        <div id="seccion-factura">
            <div class="campos-fila">
                <div class="campo-grupo">
                    <label class="campo-label">Punto de venta</label>
                    <input type="text" id="campo-punto-venta" class="campo-input" value="${datos.punto_venta || ''}" placeholder="Ej: 00002" maxlength="5">
                </div>
                <div class="campo-grupo">
                    <label class="campo-label">Nro. comprobante</label>
                    <input type="text" id="campo-nro-comprobante" class="campo-input" value="${datos.nro_comprobante || ''}" placeholder="Ej: 00000058" maxlength="8">
                </div>
            </div>

            <div class="campos-fila">
                <div class="campo-grupo">
                    <label class="campo-label">CAE</label>
                    <input type="text" id="campo-cae" class="campo-input" value="${datos.cae || ''}" placeholder="Código de Autorización Electrónica">
                </div>
                <div class="campo-grupo">
                    <label class="campo-label">Vencimiento CAE</label>
                    <input type="text" data-fecha id="campo-cae-venc" class="campo-input" value="${isoADDMM(datos.cae_vencimiento)}" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
                </div>
            </div>

            <div id="cae-alerta"></div>

            <div class="campo-grupo">
                <label class="campo-label">PDF de la factura</label>
                ${pdfSeccion}
                <div class="pdf-upload-area" id="pdf-upload-area">
                    <input type="file" id="campo-pdf" accept=".pdf" onchange="seleccionarPDFFactura(event)">
                    <div class="pdf-upload-icono">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:32px;height:32px;">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                    </div>
                    <div class="pdf-upload-texto">
                        <strong>Hacé click</strong> o arrastrá la factura PDF acá<br>
                        La IA extrae los datos automáticamente
                    </div>
                </div>
                <div id="gemini-estado-container"></div>
            </div>
        </div>

        <div class="campo-grupo" style="margin-top: var(--espacio-md);">
            <label class="campo-label">Estado de factura</label>
            <select id="campo-estado-factura" class="campo-select">
                <option value="sin_factura" ${datos.estado_factura === 'sin_factura' || !datos.estado_factura ? 'selected' : ''}>Sin factura</option>
                <option value="reclamada" ${datos.estado_factura === 'reclamada' ? 'selected' : ''}>Reclamada (ya se pidió)</option>
                <option value="factura_ok" ${datos.estado_factura === 'factura_ok' ? 'selected' : ''}>Factura recibida OK</option>
            </select>
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarMovimiento()">
            ${movimientoEditandoId ? 'Guardar cambios' : 'Registrar movimiento'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);

    // Listener para validar CAE en tiempo real
    const caeVenc = document.getElementById('campo-cae-venc');
    if (caeVenc) {
        caeVenc.addEventListener('input', validarCAE);
        caeVenc.addEventListener('blur', validarCAE);
    }

    // Configurar drag and drop
    configurarDragDropFactura();

    // Si abrimos el modal con un contrato ya seleccionado (caso edición o
    // navegación con contrato pre-cargado), filtrar las campañas según ese
    // contrato. Respeta la selección original si sigue siendo válida.
    if (contratoIdSel) {
        actualizarCampanasPorContrato(contratoIdSel);
        // Restaurar la selección original si quedó pisada por el filtro
        const selCampana = document.getElementById('campo-campana');
        if (selCampana && datos.campana_id) {
            const opcion = [...selCampana.options].find(o => o.value === datos.campana_id);
            if (opcion) selCampana.value = datos.campana_id;
        }
    }
}

/**
 * Arma las <option> del select "Quién factura" según el contrato elegido.
 * Devuelve string HTML.
 */
function construirOpcionesArrendadoresPorContrato(contratoId, arrendadorIdSel) {
    if (!contratoId) return '';
    const contrato = contratosParaSelect.find(c => c.id === contratoId);
    if (!contrato) return '';

    // Ordeno: titular primero, después por orden
    const vinculos = (contrato.contratos_arrendadores || [])
        .slice()
        .sort((a, b) => {
            if (a.es_titular_principal !== b.es_titular_principal) {
                return a.es_titular_principal ? -1 : 1;
            }
            return (a.orden || 0) - (b.orden || 0);
        });

    return vinculos.map(v => {
        const a = v.arrendadores;
        if (!a) return '';
        const marca = v.es_titular_principal ? ' ★' : '';
        return `<option value="${a.id}" ${arrendadorIdSel === a.id ? 'selected' : ''}>${a.nombre}${marca}</option>`;
    }).join('');
}

/**
 * Se dispara cuando el usuario cambia el select de contrato.
 * Repuebla el select de "quién factura" con los arrendadores de ese contrato.
 * Si solo hay uno, lo preselecciona automáticamente.
 */
function actualizarArrendadoresPorContrato() {
    const selContrato = document.getElementById('campo-contrato');
    const selArrendador = document.getElementById('campo-arrendador');
    if (!selContrato || !selArrendador) return;

    const contratoId = selContrato.value;
    const opciones = construirOpcionesArrendadoresPorContrato(contratoId, null);

    // Refrescar también las campañas disponibles según la vigencia del contrato
    actualizarCampanasPorContrato(contratoId);

    if (!contratoId) {
        selArrendador.innerHTML = '<option value="">Elegí primero un contrato</option>';
        selArrendador.disabled = true;
        return;
    }

    const contrato = contratosParaSelect.find(c => c.id === contratoId);
    const cantidadArr = (contrato?.contratos_arrendadores || []).length;

    selArrendador.disabled = false;
    selArrendador.innerHTML = `<option value="">Seleccionar arrendador...</option>${opciones}`;

    // Si hay un solo arrendador, lo preselecciono
    if (cantidadArr === 1) {
        const unico = contrato.contratos_arrendadores[0]?.arrendadores?.id;
        if (unico) selArrendador.value = unico;
    }
}

/**
 * Devuelve las campañas que solapan con la vigencia del contrato.
 * Una campaña X/Y solapa si el rango [anio_inicio, anio_fin] se cruza
 * con los años de [contrato.fecha_inicio, contrato.fecha_fin].
 * Si no hay contrato o no tiene fechas, devuelve todas.
 */
function campanasParaContrato(contratoId) {
    if (!contratoId || campanasParaSelect.length === 0) return campanasParaSelect;
    const c = contratosParaSelect.find(x => x.id === contratoId);
    if (!c || !c.fecha_inicio || !c.fecha_fin) return campanasParaSelect;

    const yIni = parseInt(c.fecha_inicio.slice(0, 4), 10);
    const yFin = parseInt(c.fecha_fin.slice(0, 4), 10);
    if (!Number.isFinite(yIni) || !Number.isFinite(yFin)) return campanasParaSelect;

    return campanasParaSelect.filter(camp =>
        (camp.anio_fin >= yIni) && (camp.anio_inicio <= yFin)
    );
}

/**
 * Re-renderiza el select de campaña filtrando por la vigencia del contrato.
 * Mantiene la selección actual si todavía es válida, sino selecciona la
 * activa o la primera disponible.
 */
function actualizarCampanasPorContrato(contratoId) {
    const selCampana = document.getElementById('campo-campana');
    if (!selCampana) return;

    const valorActual = selCampana.value;
    const disponibles = campanasParaContrato(contratoId);

    if (disponibles.length === 0) {
        selCampana.innerHTML = '<option value="">Sin campañas que solapen con este contrato</option>';
        return;
    }

    // Si el valor actual sigue siendo válido, lo respetamos
    const sigueValido = disponibles.some(c => c.id === valorActual);
    const activa = disponibles.find(c => c.activa);
    const seleccion = sigueValido ? valorActual : (activa?.id || disponibles[0].id);

    selCampana.innerHTML = disponibles.map(c =>
        `<option value="${c.id}" ${seleccion === c.id ? 'selected' : ''}>${c.nombre}${c.activa ? ' (activa)' : ''}</option>`
    ).join('');
}

function seleccionarTipo(label, tipo) {
    document.querySelectorAll('.tipo-opcion').forEach(l => l.classList.remove('seleccionado'));
    label.classList.add('seleccionado');
    label.querySelector('input').checked = true;
}

// ==============================================
// VALIDACIÓN DE CAE
// ==============================================

function validarCAE() {
    const caeVencISO = ddmmAISO(document.getElementById('campo-cae-venc')?.value);
    const contenedor = document.getElementById('cae-alerta');
    if (!contenedor) return;

    if (!caeVencISO) {
        contenedor.innerHTML = '';
        return;
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const venc = new Date(caeVencISO + 'T00:00:00');

    if (venc < hoy) {
        contenedor.innerHTML = `
            <div class="alerta-factura alerta-factura-rojo" style="margin-top: var(--espacio-sm);">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span><strong>CAE vencido.</strong> Esta factura podría no ser válida.</span>
            </div>
        `;
    } else {
        contenedor.innerHTML = `
            <div class="alerta-factura" style="margin-top: var(--espacio-sm); background-color: var(--color-verde-suave); border: 1px solid rgba(74,158,110,0.3); color: var(--color-verde);">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>CAE vigente — vence el ${formatearFecha(caeVenc)}</span>
            </div>
        `;
    }
}

// ==============================================
// SUBIDA DE PDF DE FACTURA
// ==============================================

function seleccionarPDFFactura(event) {
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

    archivoPDFFactura = file;

    // Actualizar UI
    const area = document.getElementById('pdf-upload-area');
    if (area) {
        area.innerHTML = `
            <div style="display:flex; align-items:center; gap:var(--espacio-md); padding:0;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;color:var(--color-verde);">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <div style="flex:1;">
                    <div style="font-weight:600; font-size:var(--texto-sm);">${file.name}</div>
                    <span class="campo-ayuda">${(file.size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
                <button class="btn-secundario" style="padding: var(--espacio-xs) var(--espacio-md); font-size: var(--texto-sm);" onclick="extraerFacturaPDFLocal()">Extraer con IA</button>
            </div>
        `;
    }

    // Intentar extraer automáticamente
    extraerFacturaPDFLocal();
}

function configurarDragDropFactura() {
    const area = document.getElementById('pdf-upload-area');
    if (!area) return;

    area.addEventListener('dragover', (e) => {
        e.preventDefault();
        area.classList.add('arrastrando');
    });
    area.addEventListener('dragleave', () => area.classList.remove('arrastrando'));
    area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.classList.remove('arrastrando');
        const file = e.dataTransfer.files[0];
        if (file) {
            archivoPDFFactura = file;
            seleccionarPDFFactura({ target: { files: [file] } });
        }
    });
}

// ==============================================
// EXTRACCIÓN DE FACTURA CON GEMINI
// ==============================================

async function extraerFacturaPDFLocal() {
    if (!archivoPDFFactura) return;

    // La clave de Gemini vive en la Edge Function; el navegador no la maneja.
    const geminiKey = 'proxy';

    const container = document.getElementById('gemini-estado-container');
    if (container) {
        container.innerHTML = `
            <div class="gemini-estado">
                <div class="spinner"></div>
                Extrayendo datos de la factura...
            </div>
        `;
    }

    try {
        const base64 = await archivoABase64Factura(archivoPDFFactura);
        const datos = await llamarGeminiFactura(geminiKey, base64);

        if (datos) {
            await autocompletarFactura(datos);
            if (container) {
                container.innerHTML = `
                    <div class="gemini-estado" style="border-color: var(--color-verde); color: var(--color-verde);">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Datos de factura extraídos. Revisá antes de guardar.
                    </div>
                `;
            }
        }
    } catch (err) {
        console.error('Error extrayendo factura:', err);
        if (container) {
            container.innerHTML = `
                <div class="gemini-estado" style="border-color: var(--color-error); color: var(--color-error);">
                    Error: ${err.message}
                </div>
            `;
        }
    }
}

function archivoABase64Factura(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function llamarGeminiFactura(apiKey, pdfBase64) {
    const prompt = `Analizá esta factura argentina (factura ARCA/AFIP) y extraé los datos en formato JSON estricto.

Si un campo no aparece, poné null. No inventes datos.

Formato de respuesta (solo JSON, sin markdown):
{
    "vendedor_nombre": "nombre del vendedor/arrendador",
    "vendedor_cuit": "CUIT en formato XX-XXXXXXXX-X",
    "fecha": "YYYY-MM-DD de la factura",
    "qq": 0,
    "precio_unitario": 0,
    "total": 0,
    "moneda": "ARS o USD",
    "punto_venta": "00002",
    "nro_comprobante": "00000058",
    "cae": "número de CAE",
    "cae_vencimiento": "YYYY-MM-DD",
    "grano": "tipo de grano (Soja/Maíz/Trigo/etc)"
}`;

    // La clave de Gemini vive en la Edge Function, no en el navegador.
    const response = await fetch(urlProxyGemini('gemini-2.5-flash'), {
        method: 'POST',
        headers: await headersProxyIA(),
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } }
                ]
            }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 16384,
                thinkingConfig: { thinkingBudget: 2048 }
            }
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Error HTTP ${response.status}`);
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

    if (!textoRespuesta) throw new Error('Gemini no devolvió respuesta.');

    let jsonStr = textoRespuesta.trim();
    if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\s*$/g, '').trim();
    }

    return JSON.parse(jsonStr);
}

async function autocompletarFactura(datos) {
    // Intentar seleccionar arrendador por CUIT o nombre
    if (datos.vendedor_cuit || datos.vendedor_nombre) {
        const select = document.getElementById('campo-arrendador');
        if (select) {
            const cuitLimpio = datos.vendedor_cuit?.replace(/[-\s]/g, '');
            let encontrado = false;
            let arrendadorEncontrado = null;

            for (const a of arrendadoresParaSelect) {
                const cuitArr = a.cuit?.replace(/[-\s]/g, '');
                if (cuitLimpio && cuitArr === cuitLimpio) {
                    select.value = a.id;
                    encontrado = true;
                    arrendadorEncontrado = a;
                    break;
                }
            }

            if (!encontrado && datos.vendedor_nombre) {
                const nombre = datos.vendedor_nombre.toLowerCase();
                for (const a of arrendadoresParaSelect) {
                    if (a.nombre.toLowerCase().includes(nombre)) {
                        select.value = a.id;
                        encontrado = true;
                        arrendadorEncontrado = a;
                        break;
                    }
                }
            }

            // Si no existe el arrendador, crearlo automáticamente
            if (!encontrado && datos.vendedor_nombre) {
                const nuevoArrendador = {
                    nombre: datos.vendedor_nombre,
                    cuit: datos.vendedor_cuit || null,
                    campo: null,
                    hectareas: null,
                    grano: datos.grano || null
                };

                const resultado = await ejecutarConsulta(
                    db.from('arrendadores').insert(nuevoArrendador).select(),
                    'crear arrendador desde factura'
                );

                if (resultado && resultado.length > 0) {
                    const nuevo = resultado[0];
                    // Agregar al select y seleccionarlo
                    arrendadoresParaSelect.push(nuevo);
                    const option = document.createElement('option');
                    option.value = nuevo.id;
                    option.textContent = nuevo.nombre;
                    option.selected = true;
                    select.appendChild(option);

                    mostrarExito(`Arrendador "${nuevo.nombre}" creado automáticamente desde la factura.`);
                }
            }
        }
    }

    if (datos.fecha) {
        const campo = document.getElementById('campo-fecha');
        if (campo) campo.value = isoADDMM(datos.fecha);
    }
    if (datos.qq) {
        const campo = document.getElementById('campo-qq');
        if (campo) campo.value = datos.qq;
    }
    if (datos.precio_unitario) {
        const campo = document.getElementById('campo-precio');
        if (campo) campo.value = datos.precio_unitario;
    }
    if (datos.moneda) {
        const campo = document.getElementById('campo-moneda');
        if (campo) campo.value = datos.moneda;
    }
    if (datos.punto_venta) {
        const campo = document.getElementById('campo-punto-venta');
        if (campo) campo.value = datos.punto_venta;
    }
    if (datos.nro_comprobante) {
        const campo = document.getElementById('campo-nro-comprobante');
        if (campo) campo.value = datos.nro_comprobante;
    }
    if (datos.cae) {
        const campo = document.getElementById('campo-cae');
        if (campo) campo.value = datos.cae;
    }
    if (datos.cae_vencimiento) {
        const campo = document.getElementById('campo-cae-venc');
        if (campo) {
            campo.value = isoADDMM(datos.cae_vencimiento);
            validarCAE(); // Validar automáticamente
        }
    }

    // Si tiene factura, poner estado factura_ok y tipo blanco
    if (datos.punto_venta || datos.cae) {
        const estadoFactura = document.getElementById('campo-estado-factura');
        if (estadoFactura) estadoFactura.value = 'factura_ok';

        // Seleccionar tipo blanco
        const labelBlanco = document.querySelector('.tipo-opcion:first-child');
        if (labelBlanco) seleccionarTipo(labelBlanco, 'blanco');
    }
}

// ==============================================
// VER PDF FACTURA
// ==============================================

async function verPDFFactura(pdfPath) {
    if (!pdfPath) {
        mostrarError('No hay factura asociada.');
        return;
    }

    if (pdfPath.startsWith('http')) {
        window.open(pdfPath, '_blank');
        return;
    }

    const { data, error } = await db.storage
        .from('facturas')
        .createSignedUrl(pdfPath, 3600);

    if (error || !data?.signedUrl) {
        mostrarError('No se pudo acceder al PDF.');
        return;
    }

    window.open(data.signedUrl, '_blank');
}

// ==============================================
// GUARDAR — Crear o actualizar movimiento
// ==============================================

async function guardarMovimiento() {
    const contratoId = document.getElementById('campo-contrato')?.value;
    const arrendadorId = document.getElementById('campo-arrendador')?.value;
    const campanaId = document.getElementById('campo-campana')?.value || null;
    const tipo = document.querySelector('input[name="tipo"]:checked')?.value;
    const fecha = ddmmAISO(document.getElementById('campo-fecha')?.value);
    const qq = document.getElementById('campo-qq')?.value;
    const precio = document.getElementById('campo-precio')?.value;
    const moneda = document.getElementById('campo-moneda')?.value;
    const observaciones = document.getElementById('campo-observaciones')?.value.trim();
    const puntoVenta = document.getElementById('campo-punto-venta')?.value.trim();
    const nroComprobante = document.getElementById('campo-nro-comprobante')?.value.trim();
    const cae = document.getElementById('campo-cae')?.value.trim();
    const caeVenc = ddmmAISO(document.getElementById('campo-cae-venc')?.value);
    const estadoFactura = document.getElementById('campo-estado-factura')?.value;

    // Validaciones
    if (!contratoId) {
        mostrarError('Seleccioná un contrato.');
        return;
    }
    if (!arrendadorId) {
        mostrarError('Seleccioná quién factura (arrendador del contrato).');
        return;
    }
    if (!campanaId) {
        mostrarError('Seleccioná la campaña a la que se imputa el pago.');
        return;
    }
    if (!tipo) {
        mostrarError('Seleccioná el tipo de operación (blanco o negro).');
        return;
    }
    if (!fecha) {
        mostrarError('La fecha es obligatoria.');
        return;
    }
    if (!qq || parseFloat(qq) <= 0) {
        mostrarError('Ingresá la cantidad de quintales.');
        return;
    }

    // Validar formato comprobante
    if (puntoVenta && puntoVenta.length !== 5) {
        mostrarError('El punto de venta debe tener 5 dígitos (ej: 00002).');
        return;
    }
    if (nroComprobante && nroComprobante.length !== 8) {
        mostrarError('El número de comprobante debe tener 8 dígitos (ej: 00000058).');
        return;
    }

    // Validar CAE
    let caeValido = null;
    if (cae && caeVenc) {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const venc = new Date(caeVenc + 'T00:00:00');
        caeValido = venc >= hoy;
    }

    // Subir PDF de factura si hay uno
    let pdfUrl = movimientoEditandoId
        ? movimientosCargados.find(m => m.id === movimientoEditandoId)?.pdf_url
        : null;

    if (archivoPDFFactura) {
        const arrendador = arrendadoresParaSelect.find(a => a.id === arrendadorId);
        const nombreArr = arrendador?.nombre || 'factura';
        pdfUrl = await subirPDFFactura(archivoPDFFactura, nombreArr);
        if (pdfUrl === null && archivoPDFFactura) return; // Error al subir
    }

    const datosMovimiento = {
        contrato_id: contratoId,
        arrendador_id: arrendadorId,
        campana_id: campanaId,
        fecha: fecha,
        qq: parseFloat(qq),
        precio_quintal: precio ? parseFloat(precio) : null,
        moneda: moneda || 'ARS',
        tipo: tipo,
        estado_factura: estadoFactura || 'sin_factura',
        pdf_url: pdfUrl || null,
        punto_venta: puntoVenta || null,
        nro_comprobante: nroComprobante || null,
        cae: cae || null,
        cae_vencimiento: caeVenc || null,
        cae_valido: caeValido,
        observaciones: observaciones || null,
        usuario_id: window.__USUARIO__?.id || null
    };

    let resultado;

    if (movimientoEditandoId) {
        // Capturar valores anteriores ANTES del update para ajustar saldos si
        // cambió la campaña, el contrato, el tipo o la cantidad.
        const previo = movimientosCargados.find(m => m.id === movimientoEditandoId);

        resultado = await ejecutarConsulta(
            db.from('movimientos').update(datosMovimiento).eq('id', movimientoEditandoId).select(),
            'actualizar movimiento'
        );

        if (resultado !== undefined && previo) {
            // Revertir el descuento viejo (contrato + campana + tipo previos)
            const campanaPrevia = previo.campana_id || (campanasParaSelect.find(c => c.activa)?.id);
            await revertirSaldoMovimiento(previo.contrato_id, previo.tipo, parseFloat(previo.qq), campanaPrevia);
            // Aplicar el descuento nuevo
            await actualizarSaldo(contratoId, tipo, parseFloat(qq), campanaId);
        }
    } else {
        resultado = await ejecutarConsulta(
            db.from('movimientos').insert(datosMovimiento).select(),
            'crear movimiento'
        );

        // Actualizar saldo del CONTRATO y, si es BLANCO con precio, crear la
        // transferencia pendiente en tesorería (fecha de cobro = fecha + 7 días).
        // NEGRO no genera transferencia bancaria: es efectivo en mano,
        // se maneja al margen del banco para no ensuciar la conciliación.
        if (resultado && resultado.length > 0) {
            await actualizarSaldo(contratoId, tipo, parseFloat(qq), campanaId);

            if (tipo === 'blanco' && precio && parseFloat(precio) > 0) {
                await crearTransferenciaTesoreria(
                    resultado[0].id,
                    arrendadorId,
                    fecha,
                    parseFloat(qq),
                    parseFloat(precio)
                );
            }
        }
    }

    if (resultado === undefined) return;

    cerrarModal();
    mostrarExito(movimientoEditandoId ? 'Movimiento actualizado' : 'Movimiento registrado');
    movimientoEditandoId = null;
    archivoPDFFactura = null;
    await cargarMovimientos();
}

/**
 * Sube un PDF de factura al bucket "facturas" de Supabase Storage.
 */
async function subirPDFFactura(archivo, arrendadorNombre) {
    const timestamp = Date.now();
    const nombreLimpio = arrendadorNombre
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '_')
        .toLowerCase();
    const path = `${nombreLimpio}_${timestamp}.pdf`;

    const { data, error } = await db.storage
        .from('facturas')
        .upload(path, archivo, {
            contentType: 'application/pdf',
            upsert: false
        });

    if (error) {
        console.error('Error subiendo factura:', error.message);
        mostrarError('No se pudo subir la factura.');
        return null;
    }

    return path;
}

// ==============================================
// ACTUALIZAR SALDO
// ==============================================

/**
 * Descuenta los qq del saldo del CONTRATO para la campaña dada.
 * Si campanaId es null/undefined, busca la activa como fallback.
 * Si no existe el registro de saldo para esa campaña, lo crea inicializándolo
 * con los qq pactados del contrato y luego descontando.
 */
async function actualizarSaldo(contratoId, tipo, qq, campanaId) {
    // Fallback a campaña activa si no se especifica (compatibilidad con
    // movimientos viejos que no tienen campana_id).
    if (!campanaId) {
        const campanas = await ejecutarConsulta(
            db.from('campanas').select('id').eq('activa', true).limit(1),
            'obtener campaña activa'
        );
        campanaId = campanas?.[0]?.id;
    }
    if (!campanaId) return;

    const saldos = await ejecutarConsulta(
        db.from('saldos')
            .select('*')
            .eq('contrato_id', contratoId)
            .eq('campana_id', campanaId),
        'buscar saldo'
    );

    const columna = tipo === 'blanco' ? 'qq_deuda_blanco' : 'qq_deuda_negro';

    if (saldos && saldos.length > 0) {
        const saldoActual = saldos[0][columna] || 0;
        const nuevoSaldo = saldoActual - qq;

        await ejecutarConsulta(
            db.from('saldos')
                .update({ [columna]: nuevoSaldo })
                .eq('id', saldos[0].id),
            'actualizar saldo'
        );
    } else {
        // Inicializar saldo desde el contrato y descontar
        const contrato = await ejecutarConsulta(
            db.from('contratos')
                .select('qq_pactados_anual, qq_negro_anual')
                .eq('id', contratoId)
                .single(),
            'buscar contrato para inicializar saldo'
        );

        let qqBlancoInicial = parseFloat(contrato?.qq_pactados_anual || 0);
        let qqNegroInicial = parseFloat(contrato?.qq_negro_anual || 0);

        if (tipo === 'blanco') qqBlancoInicial -= qq;
        else qqNegroInicial -= qq;

        await ejecutarConsulta(
            db.from('saldos').insert({
                contrato_id: contratoId,
                campana_id: campanaId,
                qq_deuda_blanco: qqBlancoInicial,
                qq_deuda_negro: qqNegroInicial
            }),
            'crear saldo inicializado'
        );
    }
}

// ==============================================
// VER DETALLE
// ==============================================

function verMovimiento(id) {
    const m = movimientosCargados.find(mov => mov.id === id);
    if (!m) {
        mostrarError('No se encontró el movimiento.');
        return;
    }

    const nombreArr = m.arrendadores?.nombre || 'Sin arrendador';
    const grupoContrato = m.contratos?.nombre_grupo
        || (m.contratos?.campo ? `Campo ${m.contratos.campo}` : '—');
    const total = (m.qq && m.precio_quintal) ? m.qq * m.precio_quintal : null;
    const tipoBadge = m.tipo === 'blanco'
        ? '<span class="badge badge-blanco">Blanco</span>'
        : '<span class="badge badge-negro">Negro</span>';
    const facturaBadge = obtenerBadgeFactura(m);
    const comprobanteCompleto = (m.punto_venta && m.nro_comprobante)
        ? `${m.punto_venta}-${m.nro_comprobante}`
        : '—';

    const contenido = `
        <div class="contrato-detalle-grid">
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Contrato</span>
                <span class="contrato-detalle-valor">${escaparHTML(grupoContrato)}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Quién facturó</span>
                <span class="contrato-detalle-valor"><strong>${escaparHTML(nombreArr)}</strong></span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Fecha</span>
                <span class="contrato-detalle-valor">${formatearFecha(m.fecha)}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Quintales</span>
                <span class="contrato-detalle-valor"><strong>${formatearQQ(m.qq)}</strong></span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Precio por quintal</span>
                <span class="contrato-detalle-valor">${m.precio_quintal ? formatearMoneda(m.precio_quintal, m.moneda) : '—'}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Total</span>
                <span class="contrato-detalle-valor"><strong>${total ? formatearMoneda(total, m.moneda) : '—'}</strong></span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Tipo</span>
                <span class="contrato-detalle-valor">${tipoBadge}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Estado factura</span>
                <span class="contrato-detalle-valor">${facturaBadge}</span>
            </div>
            <div class="contrato-detalle-item">
                <span class="contrato-detalle-label">Comprobante</span>
                <span class="contrato-detalle-valor">${comprobanteCompleto}</span>
            </div>
            ${m.cae ? `
                <div class="contrato-detalle-item">
                    <span class="contrato-detalle-label">CAE</span>
                    <span class="contrato-detalle-valor">${m.cae} ${m.cae_valido === false ? '<span class="badge badge-rojo">Vencido</span>' : m.cae_valido === true ? '<span class="badge badge-verde">Válido</span>' : ''}</span>
                </div>
                <div class="contrato-detalle-item">
                    <span class="contrato-detalle-label">Vencimiento CAE</span>
                    <span class="contrato-detalle-valor">${formatearFecha(m.cae_vencimiento)}</span>
                </div>
            ` : ''}
            ${m.precio_mercado_dia ? `
                <div class="contrato-detalle-item">
                    <span class="contrato-detalle-label">Precio mercado del día</span>
                    <span class="contrato-detalle-valor">${formatearMoneda(m.precio_mercado_dia, m.moneda)}</span>
                </div>
            ` : ''}
        </div>

        ${m.observaciones ? `
            <hr class="form-separador">
            <div class="form-seccion-titulo">Observaciones</div>
            <p style="color: var(--color-texto); font-size: var(--texto-base);">${escaparHTML(m.observaciones)}</p>
        ` : ''}

        ${m.pdf_url ? `
            <hr class="form-separador">
            <div class="form-seccion-titulo">Factura</div>
            <div class="pdf-archivo-actual">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <div class="pdf-archivo-info">
                    <div class="pdf-archivo-nombre">Factura PDF</div>
                </div>
                <div class="pdf-archivo-acciones">
                    <button onclick="verPDFFactura('${m.pdf_url}')">Ver PDF</button>
                </div>
            </div>
        ` : ''}
    `;

    const footer = `<button class="btn-secundario" onclick="cerrarModal()">Cerrar</button>`;
    abrirModal(`Movimiento — ${nombreArr}`, contenido, footer);
}

// ==============================================
// ELIMINAR
// ==============================================

function confirmarEliminarMovimiento(id, nombreArrendador) {
    window.__idEliminarMovimiento = id;

    // Si hay una transferencia ya ejecutada, advertir explícitamente.
    const mov = movimientosCargados.find(m => m.id === id);
    const t = transferenciaDe(mov);
    let avisoExtra = '';
    if (t && t.id) {
        if (t.estado === 'cobrado') {
            avisoExtra = `
                <p style="margin-top: var(--espacio-md); padding: var(--espacio-sm); background: rgba(232,183,74,0.10); border:1px solid #e8b74a; border-radius: var(--radio-sm,4px); font-size: var(--texto-sm); color: #e8b74a;">
                    ⚠️ Este movimiento ya tiene una transferencia <strong>ejecutada</strong> en tesorería. Al eliminar también se borra la transferencia. Si solo querés deshacer el movimiento de qq, considerá editarlo en vez de eliminarlo.
                </p>
            `;
        } else {
            avisoExtra = `
                <p style="margin-top: var(--espacio-sm); font-size: var(--texto-sm); color: var(--color-texto-tenue);">
                    Se eliminará también la transferencia vinculada en tesorería (estado: ${t.estado}).
                </p>
            `;
        }
    }

    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto); margin-bottom: var(--espacio-md);">
            ¿Seguro que querés eliminar este movimiento de <strong>${nombreArrendador}</strong>?
        </p>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">
            Los qq se devolverán automáticamente al saldo del arrendador.
            Esta acción no se puede deshacer.
        </p>
        ${avisoExtra}
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-peligro" onclick="cerrarModal(); eliminarMovimiento(window.__idEliminarMovimiento)">
            Sí, eliminar
        </button>
    `;
    abrirModal('Confirmar eliminación', contenido, footer);
}

async function eliminarMovimiento(id) {
    // Obtener los datos del movimiento ANTES de borrarlo (para revertir el saldo
    // y limpiar la transferencia vinculada en tesorería).
    const mov = movimientosCargados.find(m => m.id === id);

    // 1) Borrar la transferencia vinculada en tesorería (si existe).
    //    El FK movimiento_arrendamiento_id es ON DELETE SET NULL, así que si
    //    no la borramos antes queda huérfana en tesorería con el FK en null.
    const t = transferenciaDe(mov);
    if (t && t.id) {
        await ejecutarConsulta(
            db.from('movimientos_tesoreria').delete().eq('id', t.id),
            'eliminar transferencia vinculada'
        );
    }

    // 2) Borrar el movimiento
    const resultado = await ejecutarConsulta(
        db.from('movimientos').delete().eq('id', id),
        'eliminar movimiento'
    );

    if (resultado !== undefined) {
        // 3) Devolver los qq al saldo de la campaña a la que estaba imputado
        if (mov && mov.contrato_id && mov.qq) {
            await revertirSaldoMovimiento(mov.contrato_id, mov.tipo, parseFloat(mov.qq), mov.campana_id);
        }
        mostrarExito(t ? 'Movimiento, transferencia y saldo revertidos' : 'Movimiento eliminado y saldo revertido');
        await cargarMovimientos();
    }
}

/**
 * Devuelve qq al saldo del contrato (usado al eliminar/editar un movimiento).
 * Suma los qq a la columna correspondiente (blanco o negro) de la campaña dada.
 * Si campanaId es null/undefined (movimiento viejo), cae a la campaña activa.
 */
async function revertirSaldoMovimiento(contratoId, tipo, qq, campanaId) {
    if (!campanaId) {
        const campanas = await ejecutarConsulta(
            db.from('campanas').select('id').eq('activa', true).limit(1),
            'obtener campaña activa'
        );
        campanaId = campanas?.[0]?.id;
    }
    if (!campanaId) return;

    const saldos = await ejecutarConsulta(
        db.from('saldos')
            .select('*')
            .eq('contrato_id', contratoId)
            .eq('campana_id', campanaId),
        'buscar saldo para revertir'
    );

    if (saldos && saldos.length > 0) {
        const columna = tipo === 'blanco' ? 'qq_deuda_blanco' : 'qq_deuda_negro';
        const nuevo = parseFloat(saldos[0][columna] || 0) + qq;
        await ejecutarConsulta(
            db.from('saldos').update({ [columna]: nuevo }).eq('id', saldos[0].id),
            'revertir saldo'
        );
    }
}

// ==============================================
// INTEGRACIÓN CON TESORERÍA
// ==============================================

/**
 * Cuando se registra una venta de qq, crea automáticamente
 * una transferencia pendiente en tesorería.
 *
 * Regla del negocio: AGD acredita la plata y Diego transfiere
 * al arrendador 7 días después del aviso.
 *
 * @param {string} movimientoId  - ID del movimiento recién creado
 * @param {string} arrendadorId  - ID del arrendador que cobra
 * @param {string} fechaAviso    - Fecha del movimiento (YYYY-MM-DD)
 * @param {number} qq            - Quintales vendidos
 * @param {number} precioQQ      - Precio por quintal en ARS
 */
async function crearTransferenciaTesoreria(movimientoId, arrendadorId, fechaAviso, qq, precioQQ) {
    try {
        // Obtener la primera empresa activa (Diego Quintana por defecto)
        const empresas = await ejecutarConsulta(
            db.from('empresas').select('id').order('creado_en').limit(1),
            'obtener empresa para tesorería'
        );
        if (!empresas || empresas.length === 0) return;
        const empresaId = empresas[0].id;

        // Obtener cuenta ARS de esa empresa
        const cuentas = await ejecutarConsulta(
            db.from('cuentas_bancarias')
                .select('id')
                .eq('empresa_id', empresaId)
                .eq('moneda', 'ARS')
                .eq('activa', true)
                .limit(1),
            'obtener cuenta para tesorería'
        );
        if (!cuentas || cuentas.length === 0) return;
        const cuentaId = cuentas[0].id;

        // Fecha de cobro = fecha del aviso + 7 días
        const fechaCobro = new Date(fechaAviso + 'T12:00:00');
        fechaCobro.setDate(fechaCobro.getDate() + 7);
        const fechaCobroStr = fechaALocalStr(fechaCobro);

        // Calcular fecha_balde (mismo algoritmo que el trigger SQL)
        const dia = fechaCobro.getDate();
        const offset = dia % 5;
        const balde = new Date(fechaCobro);
        balde.setDate(dia - offset);
        const fechaBaldeStr = fechaALocalStr(balde);

        // Nombre del arrendador para las notas
        const arrendador = arrendadoresParaSelect.find(a => a.id === arrendadorId);
        const nombreArr = arrendador?.nombre || 'Arrendador';

        // Resolver beneficiario_id (busca el existente o crea uno nuevo del tipo
        // 'arrendador'). Así la transferencia se ve linda en tesorería con el
        // nombre del arrendador en la columna correcta en vez de solo en notas.
        const beneficiarioId = await obtenerOCrearBeneficiarioArrendador(arrendadorId, nombreArr);

        // Resolver categoría: si existe una categoría con "arrendamiento" en el
        // nombre, la usamos. Si no, queda null.
        const categoriaId = await obtenerCategoriaArrendamiento();

        const monto = qq * precioQQ;

        const transferencia = {
            empresa_id:                 empresaId,
            cuenta_bancaria_id:         cuentaId,
            tipo:                       'transferencia',
            fecha_emision:              fechaAviso,
            fecha_cobro:                fechaCobroStr,
            fecha_balde:                fechaBaldeStr,
            beneficiario_id:            beneficiarioId,
            categoria_id:               categoriaId,
            monto:                      Math.round(monto * 100) / 100,
            estado:                     'pendiente',
            origen:                     'auto_arrendamiento',
            movimiento_arrendamiento_id: movimientoId,
            notas:                      `${qq} qq × $${precioQQ.toLocaleString('es-AR')}/qq`
        };

        await ejecutarConsulta(
            db.from('movimientos_tesoreria').insert(transferencia),
            'crear transferencia en tesorería'
        );

        // Notificar al usuario (sutil, no interrumpir el flujo)
        console.info(`Tesorería: transferencia pendiente creada para ${nombreArr} — $${monto.toLocaleString('es-AR')} el ${fechaCobroStr}`);

    } catch (err) {
        // No interrumpir el flujo principal si falla la integración con tesorería
        console.error('No se pudo crear la transferencia en tesorería:', err);
    }
}

/**
 * Busca el beneficiario tipo='arrendador' del arrendador dado.
 * Si no existe, lo crea. Devuelve el beneficiario_id o null si falla.
 */
async function obtenerOCrearBeneficiarioArrendador(arrendadorId, nombreFallback) {
    if (!arrendadorId) return null;
    try {
        // 1) Buscar uno existente
        const existentes = await ejecutarConsulta(
            db.from('beneficiarios')
              .select('id')
              .eq('arrendador_id', arrendadorId)
              .limit(1),
            'buscar beneficiario arrendador'
        );
        if (existentes && existentes.length > 0) return existentes[0].id;

        // 2) No existe: crear
        const nuevos = await ejecutarConsulta(
            db.from('beneficiarios').insert({
                nombre:        nombreFallback || 'Arrendador',
                tipo:          'arrendador',
                arrendador_id: arrendadorId
            }).select(),
            'crear beneficiario arrendador'
        );
        return nuevos?.[0]?.id || null;
    } catch (err) {
        console.warn('No se pudo resolver beneficiario para arrendador:', err);
        return null;
    }
}

/**
 * Busca una categoría de gasto cuyo nombre contenga "arrendamiento".
 * Si no encuentra ninguna, devuelve null (la transferencia queda sin categoría).
 */
async function obtenerCategoriaArrendamiento() {
    try {
        const cats = await ejecutarConsulta(
            db.from('categorias_gasto')
              .select('id')
              .ilike('nombre', '%arrendamiento%')
              .limit(1),
            'buscar categoría arrendamiento'
        );
        return cats?.[0]?.id || null;
    } catch (err) {
        return null;
    }
}
