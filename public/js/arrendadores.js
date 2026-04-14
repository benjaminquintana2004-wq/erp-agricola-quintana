// ==============================================
// arrendadores.js — CRUD de arrendadores
// Leer, crear, editar y eliminar arrendadores.
// ==============================================

// Datos en memoria (para búsqueda local rápida)
let arrendadoresCargados = [];
let arrendadorEditandoId = null;

// ==============================================
// LEER — Cargar y mostrar arrendadores
// ==============================================

/**
 * Carga todos los arrendadores activos desde Supabase
 * y los muestra en la tabla.
 */
async function cargarArrendadores() {
    // Mostrar estado de carga
    const tbody = document.getElementById('tabla-arrendadores-body');
    tbody.innerHTML = `
        <tr>
            <td colspan="7" style="text-align: center; padding: var(--espacio-xl);">
                <div class="spinner" style="margin: 0 auto;"></div>
                <p style="color: var(--color-texto-tenue); margin-top: var(--espacio-md);">Cargando arrendadores...</p>
            </td>
        </tr>
    `;

    const data = await ejecutarConsulta(
        db.from('arrendadores')
            .select('*')
            .eq('activo', true)
            .order('nombre'),
        'cargar arrendadores'
    );

    if (data === undefined) return;

    arrendadoresCargados = data;
    renderizarTablaArrendadores(data);
    actualizarContador(data.length);
}

/**
 * Renderiza las filas de la tabla con los arrendadores dados.
 */
function renderizarTablaArrendadores(arrendadores) {
    const tbody = document.getElementById('tabla-arrendadores-body');
    const usuario = window.__USUARIO__;
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);
    const puedeEliminar = ['admin_total', 'admin'].includes(usuario?.rol);

    if (arrendadores.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="tabla-vacia">
                    No hay arrendadores registrados
                    <p>Hacé click en "Nuevo Arrendador" para agregar el primero</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = arrendadores.map(a => `
        <tr>
            <td>
                <strong>${a.nombre}</strong>
                ${a.notas ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">${a.notas.substring(0, 50)}${a.notas.length > 50 ? '...' : ''}</span>` : ''}
            </td>
            <td>${a.cuit || '—'}</td>
            <td>${a.campo || '—'}</td>
            <td>${a.hectareas ? Number(a.hectareas).toLocaleString('es-AR') + ' ha' : '—'}</td>
            <td>${a.grano || '—'}</td>
            <td>${a.telefono || '—'}</td>
            <td>
                <div class="tabla-acciones">
                    ${puedeEditar ? `
                        <button class="tabla-btn" onclick="editarArrendador('${a.id}')" title="Editar">
                            ${ICONOS.editar}
                        </button>
                    ` : ''}
                    ${puedeEliminar ? `
                        <button class="tabla-btn btn-eliminar" onclick="confirmarEliminarArrendador('${a.id}', '${a.nombre.replace(/'/g, "\\'")}')" title="Eliminar">
                            ${ICONOS.eliminar}
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Actualiza el contador de resultados.
 */
function actualizarContador(cantidad) {
    const contador = document.getElementById('tabla-contador');
    if (contador) {
        contador.textContent = `${cantidad} arrendador${cantidad !== 1 ? 'es' : ''}`;
    }
}

// ==============================================
// BUSCAR — Filtrar en tiempo real
// ==============================================

/**
 * Filtra los arrendadores cargados por nombre, CUIT o campo.
 * La búsqueda es local (no va a la base de datos cada vez).
 */
function buscarArrendadores(termino) {
    const t = termino.toLowerCase().trim();
    if (!t) {
        renderizarTablaArrendadores(arrendadoresCargados);
        actualizarContador(arrendadoresCargados.length);
        return;
    }

    const filtrados = arrendadoresCargados.filter(a =>
        (a.nombre && a.nombre.toLowerCase().includes(t)) ||
        (a.cuit && a.cuit.includes(t)) ||
        (a.campo && a.campo.toLowerCase().includes(t)) ||
        (a.telefono && a.telefono.includes(t))
    );

    renderizarTablaArrendadores(filtrados);
    actualizarContador(filtrados.length);
}

// ==============================================
// CREAR / EDITAR — Modal de formulario
// ==============================================

/**
 * Abre el modal para crear un nuevo arrendador.
 */
function abrirModalNuevoArrendador() {
    arrendadorEditandoId = null;
    abrirModalArrendador('Nuevo Arrendador', {});
}

/**
 * Carga los datos de un arrendador y abre el modal para editarlo.
 */
async function editarArrendador(id) {
    const arrendador = arrendadoresCargados.find(a => a.id === id);
    if (!arrendador) {
        mostrarError('No se encontró el arrendador.');
        return;
    }
    arrendadorEditandoId = id;
    abrirModalArrendador('Editar Arrendador', arrendador);
}

/**
 * Abre el modal de arrendador (crear o editar).
 */
function abrirModalArrendador(titulo, datos) {
    const contenido = `
        <div class="form-seccion-titulo">Datos personales</div>
        <div class="campo-grupo">
            <label class="campo-label">Nombre completo <span class="campo-requerido">*</span></label>
            <input type="text" id="campo-nombre" class="campo-input" value="${datos.nombre || ''}" placeholder="Ej: Roberto Mateo Rebufatti">
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">DNI</label>
                <input type="text" id="campo-dni" class="campo-input" value="${datos.dni || ''}" placeholder="Ej: 10.677.055">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">CUIT</label>
                <input type="text" id="campo-cuit" class="campo-input" value="${datos.cuit || ''}" placeholder="Ej: 20-10677055-8">
            </div>
        </div>
        <div class="campo-grupo">
            <label class="campo-label">Domicilio</label>
            <input type="text" id="campo-domicilio" class="campo-input" value="${datos.domicilio || ''}" placeholder="Ej: Villa Ascasubi, Córdoba">
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Teléfono</label>
                <input type="text" id="campo-telefono" class="campo-input" value="${datos.telefono || ''}" placeholder="Ej: 351-5551234">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Email</label>
                <input type="email" id="campo-email" class="campo-input" value="${datos.email || ''}" placeholder="Ej: nombre@email.com">
            </div>
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo">Datos del campo</div>

        <div class="campo-grupo">
            <label class="campo-label">Nombre del campo</label>
            <input type="text" id="campo-campo" class="campo-input" value="${datos.campo || ''}" placeholder="Ej: Estancia La Aurora">
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Hectáreas</label>
                <input type="number" id="campo-hectareas" class="campo-input" value="${datos.hectareas || ''}" placeholder="Ej: 33.30" step="0.01" min="0">
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Grano principal</label>
                <select id="campo-grano" class="campo-select">
                    <option value="">Seleccionar...</option>
                    <option value="Soja" ${datos.grano === 'Soja' ? 'selected' : ''}>Soja</option>
                    <option value="Maíz" ${datos.grano === 'Maíz' ? 'selected' : ''}>Maíz</option>
                    <option value="Trigo" ${datos.grano === 'Trigo' ? 'selected' : ''}>Trigo</option>
                    <option value="Girasol" ${datos.grano === 'Girasol' ? 'selected' : ''}>Girasol</option>
                    <option value="Sorgo" ${datos.grano === 'Sorgo' ? 'selected' : ''}>Sorgo</option>
                </select>
            </div>
        </div>
        <div class="campos-fila">
            <div class="campo-grupo">
                <label class="campo-label">Moneda</label>
                <select id="campo-moneda" class="campo-select">
                    <option value="ARS" ${datos.moneda === 'ARS' || !datos.moneda ? 'selected' : ''}>Pesos (ARS)</option>
                    <option value="USD" ${datos.moneda === 'USD' ? 'selected' : ''}>Dólares (USD)</option>
                </select>
            </div>
            <div class="campo-grupo">
                <label class="campo-label">Alerta cuando queden menos de (qq)</label>
                <input type="number" id="campo-umbral" class="campo-input" value="${datos.umbral_alerta_qq || '50'}" step="1" min="0">
                <span class="campo-ayuda">Se alerta cuando el saldo pendiente baja de este valor</span>
            </div>
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo">Notas</div>

        <div class="campo-grupo">
            <label class="campo-label">Observaciones</label>
            <textarea id="campo-notas" class="campo-textarea" placeholder="Ej: Prefiere cobrar en USD, el hijo maneja todo...">${datos.notas || ''}</textarea>
        </div>
    `;

    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarArrendador()">
            ${arrendadorEditandoId ? 'Guardar cambios' : 'Crear arrendador'}
        </button>
    `;

    abrirModal(titulo, contenido, footer);

    // Foco en el primer campo
    setTimeout(() => document.getElementById('campo-nombre')?.focus(), 100);
}

/**
 * Guarda el arrendador (crear o actualizar según si hay ID).
 */
async function guardarArrendador() {
    // Leer valores del formulario
    const nombre = document.getElementById('campo-nombre')?.value.trim();
    const dni = document.getElementById('campo-dni')?.value.trim();
    const cuit = document.getElementById('campo-cuit')?.value.trim();
    const domicilio = document.getElementById('campo-domicilio')?.value.trim();
    const telefono = document.getElementById('campo-telefono')?.value.trim();
    const email = document.getElementById('campo-email')?.value.trim();
    const campo = document.getElementById('campo-campo')?.value.trim();
    const hectareas = document.getElementById('campo-hectareas')?.value;
    const grano = document.getElementById('campo-grano')?.value;
    const moneda = document.getElementById('campo-moneda')?.value;
    const umbral = document.getElementById('campo-umbral')?.value;
    const notas = document.getElementById('campo-notas')?.value.trim();

    // Validar campo obligatorio
    if (!nombre) {
        const campoNombre = document.getElementById('campo-nombre');
        campoNombre.classList.add('invalido');
        campoNombre.focus();
        mostrarError('El nombre es obligatorio.');
        return;
    }

    // Validar duplicados: verificar si ya existe un arrendador con mismo nombre o CUIT
    const duplicado = arrendadoresCargados.find(a => {
        // No comparar consigo mismo al editar
        if (arrendadorEditandoId && a.id === arrendadorEditandoId) return false;

        // Duplicado por nombre exacto (ignorando mayúsculas)
        if (a.nombre.toLowerCase() === nombre.toLowerCase()) return true;

        // Duplicado por CUIT (si ambos tienen CUIT)
        if (cuit && a.cuit && a.cuit.replace(/[-\s]/g, '') === cuit.replace(/[-\s]/g, '')) return true;

        return false;
    });

    if (duplicado) {
        const razon = duplicado.nombre.toLowerCase() === nombre.toLowerCase()
            ? `Ya existe un arrendador con el nombre "${duplicado.nombre}"`
            : `Ya existe un arrendador con el CUIT ${duplicado.cuit} (${duplicado.nombre})`;
        mostrarError(razon);
        return;
    }

    // Armar objeto de datos
    const datos = {
        nombre,
        dni: dni || null,
        cuit: cuit || null,
        domicilio: domicilio || null,
        telefono: telefono || null,
        email: email || null,
        campo: campo || null,
        hectareas: hectareas ? parseFloat(hectareas) : null,
        grano: grano || null,
        moneda: moneda || 'ARS',
        umbral_alerta_qq: umbral ? parseFloat(umbral) : 50,
        notas: notas || null
    };

    let resultado;

    if (arrendadorEditandoId) {
        // ACTUALIZAR
        resultado = await ejecutarConsulta(
            db.from('arrendadores').update(datos).eq('id', arrendadorEditandoId),
            'actualizar arrendador'
        );
    } else {
        // CREAR
        resultado = await ejecutarConsulta(
            db.from('arrendadores').insert(datos),
            'crear arrendador'
        );
    }

    if (resultado !== undefined) {
        cerrarModal();
        mostrarExito(arrendadorEditandoId ? 'Arrendador actualizado' : 'Arrendador creado');
        arrendadorEditandoId = null;
        await cargarArrendadores();
    }
}

// ==============================================
// ELIMINAR — Soft delete (marcar como inactivo)
// ==============================================

/**
 * Muestra confirmación antes de eliminar.
 */
function confirmarEliminarArrendador(id, nombre) {
    // Guardar el ID en una variable global temporal para que el callback lo tenga
    window.__idEliminarArrendador = id;
    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto); margin-bottom: var(--espacio-md);">
            ¿Seguro que querés eliminar a <strong>${nombre}</strong>?
        </p>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">
            El arrendador dejará de aparecer en las listas, pero sus datos se conservan en el sistema.
        </p>
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-peligro" onclick="cerrarModal(); eliminarArrendador(window.__idEliminarArrendador)">
            Sí, eliminar
        </button>
    `;
    abrirModal('Confirmar eliminación', contenido, footer);
}

/**
 * Marca un arrendador como inactivo (soft delete).
 * No se borra de la base de datos, solo deja de aparecer.
 */
async function eliminarArrendador(id) {
    const resultado = await ejecutarConsulta(
        db.from('arrendadores').update({ activo: false }).eq('id', id),
        'eliminar arrendador'
    );

    if (resultado !== undefined) {
        mostrarExito('Arrendador eliminado');
        await cargarArrendadores();
    }
}
