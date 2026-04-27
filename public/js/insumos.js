// ==============================================
// insumos.js — CRUD de insumos y movimientos de stock
// Alta de insumos, registro de entradas (compras)
// y salidas (aplicaciones), control de stock mínimo.
// ==============================================

let insumosCargados = [];
let insumoEditandoId = null;

// ==============================================
// LEER — Cargar insumos
// ==============================================

async function cargarInsumos() {
    const tbody = document.getElementById('tabla-insumos-body');
    tbody.innerHTML = `
        <tr>
            <td colspan="7" style="text-align: center; padding: var(--espacio-xl);">
                <div class="spinner" style="margin: 0 auto;"></div>
                <p style="color: var(--color-texto-tenue); margin-top: var(--espacio-md);">Cargando insumos...</p>
            </td>
        </tr>
    `;

    const data = await ejecutarConsulta(
        db.from('insumos')
            .select('*')
            .order('nombre'),
        'cargar insumos'
    );

    if (data === undefined) return;

    insumosCargados = data;
    renderizarTabla(data);
    actualizarContador(data.length);
    mostrarAlertasStock(data);
}

// ==============================================
// RENDERIZAR — Tabla
// ==============================================

function renderizarTabla(insumos) {
    const tbody = document.getElementById('tabla-insumos-body');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);
    const puedeEliminar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (insumos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="tabla-vacia">
                    No hay insumos registrados
                    <p>Hacé click en "Nuevo Insumo" para agregar el primero</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = insumos.map(i => {
        const stockActual = parseFloat(i.stock_actual || 0);
        const stockMinimo = parseFloat(i.stock_minimo || 0);
        const esBajo = stockMinimo > 0 && stockActual <= stockMinimo;
        const esCero = stockActual <= 0;

        let estadoBadge;
        if (esCero) {
            estadoBadge = '<span class="badge badge-stock-sin">Sin stock</span>';
        } else if (esBajo) {
            estadoBadge = '<span class="badge badge-stock-bajo">Stock bajo</span>';
        } else {
            estadoBadge = '<span class="badge badge-stock-ok">OK</span>';
        }

        // Barra de stock visual
        let porcentaje = stockMinimo > 0 ? Math.min((stockActual / (stockMinimo * 3)) * 100, 100) : 50;
        const barraClase = esBajo || esCero ? 'stock-barra-bajo' : 'stock-barra-ok';

        return `
        <tr>
            <td><strong>${i.nombre}</strong></td>
            <td>${i.tipo || '—'}</td>
            <td>
                <strong>${stockActual.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</strong>
                ${i.unidad ? `<span style="color:var(--color-texto-tenue);"> ${i.unidad}</span>` : ''}
            </td>
            <td>${stockMinimo > 0 ? stockMinimo.toLocaleString('es-AR') + (i.unidad ? ' ' + i.unidad : '') : '—'}</td>
            <td>${estadoBadge}</td>
            <td>${i.costo_promedio ? formatearMoneda(i.costo_promedio) + (i.unidad ? '/' + i.unidad : '') : '—'}</td>
            <td>
                <div class="tabla-acciones">
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="abrirModalMovInsumo('${i.id}', '${i.nombre.replace(/'/g, "\\'")}')" title="Entrada/Salida" style="color:var(--color-verde);">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                        </button>
                        <button class="tabla-btn" onclick="editarInsumo('${i.id}')" title="Editar">
                            ${ICONOS.editar}
                        </button>
                    ` : ''}
                    ${puedeEliminar ? `
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarInsumo('${i.id}', '${i.nombre.replace(/'/g, "\\'")}')" title="Eliminar">
                            ${ICONOS.eliminar}
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function actualizarContador(cantidad) {
    const contador = document.getElementById('tabla-contador');
    if (contador) {
        contador.textContent = `${cantidad} insumo${cantidad !== 1 ? 's' : ''}`;
    }
}

// ==============================================
// ALERTAS DE STOCK BAJO
// ==============================================

function mostrarAlertasStock(insumos) {
    const contenedor = document.getElementById('alertas-stock');
    if (!contenedor) return;

    const bajos = insumos.filter(i => {
        const actual = parseFloat(i.stock_actual || 0);
        const minimo = parseFloat(i.stock_minimo || 0);
        return minimo > 0 && actual <= minimo;
    });

    if (bajos.length === 0) {
        contenedor.innerHTML = '';
        return;
    }

    const nombres = bajos.length <= 4
        ? bajos.map(i => i.nombre).join(', ')
        : bajos.slice(0, 4).map(i => i.nombre).join(', ') + ` y ${bajos.length - 4} más`;

    contenedor.innerHTML = `
        <div class="alerta-stock alerta-stock-rojo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span><strong>${bajos.length} insumo${bajos.length > 1 ? 's' : ''} con stock bajo:</strong> ${nombres}</span>
        </div>
    `;
}

// ==============================================
// BUSCAR
// ==============================================

function buscarInsumos(termino) {
    const t = termino.toLowerCase().trim();
    if (!t) {
        renderizarTabla(insumosCargados);
        actualizarContador(insumosCargados.length);
        return;
    }

    const filtrados = insumosCargados.filter(i =>
        (i.nombre && i.nombre.toLowerCase().includes(t)) ||
        (i.tipo && i.tipo.toLowerCase().includes(t))
    );

    renderizarTabla(filtrados);
    actualizarContador(filtrados.length);
}

// ==============================================
// CREAR / EDITAR INSUMO — Modal
// ==============================================

function abrirModalNuevoInsumo() {
    insumoEditandoId = null;
    abrirModalInsumo('Nuevo Insumo', {});
}

function editarInsumo(id) {
    const insumo = insumosCargados.find(i => i.id === id);
    if (!insumo) {
        mostrarError('No se encontró el insumo.');
        return;
    }
    insumoEditandoId = id;
    abrirModalInsumo('Editar Insumo', insumo);
}

function abrirModalInsumo(titulo, datos) {
    const contenido = `
        <div class="campo-grupo">
            <label class="campo-label">Nombre <span class="campo-requerido">*</span></label>
            <input type="text" id="campo-nombre" class="campo-input" value="${datos.nombre || ''}" placeholder="Ej: Glifosato 48%, Urea granulada">
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Tipo</label>
                <select id="campo-tipo" class="campo-select">
                    <option value="">Seleccionar...</option>
                    <option value="Semilla" ${datos.tipo === 'Semilla' ? 'selected' : ''}>Semilla</option>
                    <option value="Herbicida" ${datos.tipo === 'Herbicida' ? 'selected' : ''}>Herbicida</option>
                    <option value="Insecticida" ${datos.tipo === 'Insecticida' ? 'selected' : ''}>Insecticida</option>
                    <option value="Fungicida" ${datos.tipo === 'Fungicida' ? 'selected' : ''}>Fungicida</option>
                    <option value="Fertilizante" ${datos.tipo === 'Fertilizante' ? 'selected' : ''}>Fertilizante</option>
                    <option value="Coadyuvante" ${datos.tipo === 'Coadyuvante' ? 'selected' : ''}>Coadyuvante</option>
                    <option value="Combustible" ${datos.tipo === 'Combustible' ? 'selected' : ''}>Combustible</option>
                    <option value="Otro" ${datos.tipo === 'Otro' ? 'selected' : ''}>Otro</option>
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Unidad de medida</label>
                <select id="campo-unidad" class="campo-select">
                    <option value="">Seleccionar...</option>
                    <option value="litros" ${datos.unidad === 'litros' ? 'selected' : ''}>Litros</option>
                    <option value="kg" ${datos.unidad === 'kg' ? 'selected' : ''}>Kilogramos</option>
                    <option value="bolsas" ${datos.unidad === 'bolsas' ? 'selected' : ''}>Bolsas</option>
                    <option value="unidades" ${datos.unidad === 'unidades' ? 'selected' : ''}>Unidades</option>
                    <option value="bidones" ${datos.unidad === 'bidones' ? 'selected' : ''}>Bidones</option>
                </select>
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Stock mínimo</label>
                <input type="number" id="campo-stock-minimo" class="campo-input" value="${datos.stock_minimo || ''}" placeholder="Alerta cuando baje de este valor" step="0.01" min="0">
                <span class="campo-ayuda">Se alerta cuando el stock actual cae por debajo de este valor</span>
            </div>
            <div class="campo-grupo">
                ${insumoEditandoId ? `
                    <label class="campo-label">Stock actual</label>
                    <input type="number" class="campo-input" value="${datos.stock_actual || 0}" disabled style="opacity:0.6;">
                    <span class="campo-ayuda">Se actualiza con entradas y salidas</span>
                ` : `
                    <label class="campo-label">Stock inicial</label>
                    <input type="number" id="campo-stock-inicial" class="campo-input" value="" placeholder="Stock actual disponible" step="0.01" min="0">
                `}
            </div>
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarInsumo()">
            ${insumoEditandoId ? 'Guardar cambios' : 'Crear insumo'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);
    setTimeout(() => document.getElementById('campo-nombre')?.focus(), 100);
}

async function guardarInsumo() {
    const nombre = document.getElementById('campo-nombre')?.value.trim();
    const tipo = document.getElementById('campo-tipo')?.value;
    const unidad = document.getElementById('campo-unidad')?.value;
    const stockMinimo = document.getElementById('campo-stock-minimo')?.value;

    if (!nombre) {
        mostrarError('El nombre es obligatorio.');
        return;
    }

    const datos = {
        nombre,
        tipo: tipo || null,
        unidad: unidad || null,
        stock_minimo: stockMinimo ? parseFloat(stockMinimo) : 0
    };

    if (insumoEditandoId) {
        const resultado = await ejecutarConsulta(
            db.from('insumos').update(datos).eq('id', insumoEditandoId),
            'actualizar insumo'
        );
        if (resultado === undefined) return;
    } else {
        const stockInicial = document.getElementById('campo-stock-inicial')?.value;
        datos.stock_actual = stockInicial ? parseFloat(stockInicial) : 0;

        const resultado = await ejecutarConsulta(
            db.from('insumos').insert(datos),
            'crear insumo'
        );
        if (resultado === undefined) return;
    }

    cerrarModal();
    mostrarExito(insumoEditandoId ? 'Insumo actualizado' : 'Insumo creado');
    insumoEditandoId = null;
    await cargarInsumos();
}

// ==============================================
// MOVIMIENTO DE INSUMO (Entrada / Salida)
// ==============================================

let movInsumoTipo = null;

function abrirModalMovInsumo(insumoId, nombreInsumo) {
    movInsumoTipo = null;
    const insumo = insumosCargados.find(i => i.id === insumoId);
    const stockActual = parseFloat(insumo?.stock_actual || 0);

    const contenido = `
        <div style="margin-bottom:var(--espacio-md); padding:var(--espacio-md); background:var(--color-fondo-secundario); border-radius:var(--radio-md);">
            <strong>${nombreInsumo}</strong> — Stock actual: <strong>${stockActual.toLocaleString('es-AR')} ${insumo?.unidad || ''}</strong>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Tipo de movimiento <span class="campo-requerido">*</span></label>
            <div class="mov-insumo-tipo">
                <button class="mov-insumo-btn" id="btn-entrada" onclick="seleccionarTipoMov('entrada')">
                    + Entrada (compra)
                </button>
                <button class="mov-insumo-btn" id="btn-salida" onclick="seleccionarTipoMov('salida')">
                    − Salida (uso)
                </button>
            </div>
        </div>

        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Cantidad <span class="campo-requerido">*</span></label>
                <input type="number" id="campo-mov-cantidad" class="campo-input" placeholder="Ej: 20" step="0.01" min="0">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Fecha</label>
                <input type="text" data-fecha id="campo-mov-fecha" class="campo-input" value="${isoADDMM(fechaHoyStr())}" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10">
            </div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Costo unitario (solo para entradas)</label>
            <input type="number" id="campo-mov-costo" class="campo-input" placeholder="Precio por unidad" step="0.01" min="0">
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarMovInsumo('${insumoId}')">
            Registrar movimiento
        </button>
    `;

    abrirModal(`Movimiento — ${nombreInsumo}`, contenido, footer);
}

function seleccionarTipoMov(tipo) {
    movInsumoTipo = tipo;
    document.getElementById('btn-entrada').className = 'mov-insumo-btn' + (tipo === 'entrada' ? ' seleccionado-entrada' : '');
    document.getElementById('btn-salida').className = 'mov-insumo-btn' + (tipo === 'salida' ? ' seleccionado-salida' : '');
}

async function guardarMovInsumo(insumoId) {
    if (!movInsumoTipo) {
        mostrarError('Seleccioná si es entrada o salida.');
        return;
    }

    const cantidad = document.getElementById('campo-mov-cantidad')?.value;
    const fecha = ddmmAISO(document.getElementById('campo-mov-fecha')?.value);
    const costoUnitario = document.getElementById('campo-mov-costo')?.value;

    if (!cantidad || parseFloat(cantidad) <= 0) {
        mostrarError('La cantidad es obligatoria.');
        return;
    }

    const cantidadNum = parseFloat(cantidad);

    // Verificar stock suficiente para salidas
    const insumo = insumosCargados.find(i => i.id === insumoId);
    if (movInsumoTipo === 'salida' && cantidadNum > parseFloat(insumo?.stock_actual || 0)) {
        mostrarError(`No hay stock suficiente. Disponible: ${parseFloat(insumo.stock_actual || 0)} ${insumo.unidad || ''}`);
        return;
    }

    // Registrar movimiento
    const resultado = await ejecutarConsulta(
        db.from('mov_insumos').insert({
            insumo_id: insumoId,
            tipo: movInsumoTipo,
            cantidad: cantidadNum,
            fecha: fecha || fechaHoyStr(),
            costo_unitario: costoUnitario ? parseFloat(costoUnitario) : null
        }),
        'registrar movimiento de insumo'
    );

    if (resultado === undefined) return;

    // Actualizar stock del insumo
    const stockActual = parseFloat(insumo?.stock_actual || 0);
    const nuevoStock = movInsumoTipo === 'entrada'
        ? stockActual + cantidadNum
        : stockActual - cantidadNum;

    // Calcular nuevo costo promedio ponderado (solo para entradas con costo)
    let actualizacion = { stock_actual: nuevoStock };

    if (movInsumoTipo === 'entrada' && costoUnitario) {
        const costoActual = parseFloat(insumo?.costo_promedio || 0);
        if (stockActual > 0 && costoActual > 0) {
            // Costo promedio ponderado
            actualizacion.costo_promedio =
                ((stockActual * costoActual) + (cantidadNum * parseFloat(costoUnitario))) / nuevoStock;
        } else {
            actualizacion.costo_promedio = parseFloat(costoUnitario);
        }
    }

    await ejecutarConsulta(
        db.from('insumos').update(actualizacion).eq('id', insumoId),
        'actualizar stock'
    );

    cerrarModal();
    mostrarExito(`${movInsumoTipo === 'entrada' ? 'Entrada' : 'Salida'} registrada`);
    await cargarInsumos();
}

// ==============================================
// ELIMINAR
// ==============================================

function confirmarEliminarInsumo(id, nombre) {
    window.__idEliminarInsumo = id;
    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto); margin-bottom: var(--espacio-md);">
            ¿Seguro que querés eliminar <strong>${nombre}</strong>?
        </p>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">
            Se eliminarán todos los movimientos asociados.
            Esta acción no se puede deshacer.
        </p>
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-peligro" onclick="cerrarModal(); eliminarInsumo(window.__idEliminarInsumo)">
            Sí, eliminar
        </button>
    `;
    abrirModal('Confirmar eliminación', contenido, footer);
}

async function eliminarInsumo(id) {
    const resultado = await ejecutarConsulta(
        db.from('insumos').delete().eq('id', id),
        'eliminar insumo'
    );

    if (resultado !== undefined) {
        mostrarExito('Insumo eliminado');
        await cargarInsumos();
    }
}
