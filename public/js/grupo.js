// ==============================================
// grupo.js — Ficha de un grupo de arrendadores
// El "grupo" es el conjunto de personas que comparten contratos.
// La deuda en quintales es del CONTRATO; acá se suma a nivel grupo.
// ==============================================

// Estado a nivel página (para que las acciones de edición sepan qué recargar)
let __idsGrupoActual = null;
let __usuarioGrupoActual = null;
let __contratoIdsGrupoActual = [];
let __nombreGrupoActual = '';

async function cargarFichaGrupo(ids, usuario) {
    const cont = document.getElementById('grupo-contenido');
    const idsOrden = [...ids].sort();
    __idsGrupoActual = idsOrden;
    __usuarioGrupoActual = usuario;

    // Cuando se edita un arrendador desde el modal, recargar la ficha
    window.onArrendadorGuardado = async () => {
        await cargarFichaGrupo(__idsGrupoActual, __usuarioGrupoActual);
    };

    // Cargar todo en paralelo
    const [miembros, contratos, saldos, movimientos] = await Promise.all([
        ejecutarConsulta(
            db.from('arrendadores').select('*').in('id', idsOrden),
            'cargar miembros del grupo'
        ),
        ejecutarConsulta(
            db.from('contratos').select(`
                id, fecha_inicio, fecha_fin, estado, campo, nombre_grupo, notas_grupo,
                hectareas, qq_pactados_anual, qq_negro_anual,
                qq_por_hectarea, qq_negro_por_hectarea,
                adelanto_qq, adelanto_dia, adelanto_mes, adelanto_observaciones,
                contratos_arrendadores ( arrendador_id, es_titular_principal, orden )
            `),
            'cargar contratos'
        ),
        ejecutarConsulta(
            db.from('saldos')
                .select('contrato_id, qq_deuda_blanco, qq_deuda_negro, campanas!inner(id, nombre, activa)')
                .eq('campanas.activa', true),
            'cargar saldos campaña activa'
        ),
        ejecutarConsulta(
            db.from('movimientos')
                .select('id, fecha, contrato_id, arrendador_id, qq, monto_total, estado_factura, numero_factura, observaciones')
                .order('fecha', { ascending: false }),
            'cargar movimientos'
        )
    ]);

    if (!miembros) return;
    if (miembros.length === 0) {
        cont.innerHTML = '<div class="vacio"><p>No se encontraron arrendadores con esos IDs.</p></div>';
        document.getElementById('pantalla-carga').style.display = 'none';
        document.getElementById('contenido-principal').style.display = '';
        return;
    }

    // Cargar representantes para los miembros que sean empresa
    const idsEmpresas = miembros.filter(m => m.tipo === 'empresa').map(m => m.id);
    const representantesPorEmpresa = {};
    if (idsEmpresas.length > 0) {
        const reps = await ejecutarConsulta(
            db.from('representantes').select('*').in('empresa_id', idsEmpresas),
            'cargar representantes del grupo'
        ) || [];
        reps.forEach(r => {
            (representantesPorEmpresa[r.empresa_id] ||= []).push(r);
        });
    }

    // Auto-match inverso: si algún miembro persona_fisica tiene DNI que matchea
    // con un representante en la BD, mostrar las empresas que representa.
    const dnisPersonas = miembros
        .filter(m => m.tipo !== 'empresa' && m.dni)
        .map(m => normalizarDniLocal(m.dni))
        .filter(Boolean);
    const empresasRepresentadasPorPersona = {};   // dni → [{empresa, cargo}]
    if (dnisPersonas.length > 0) {
        const repsMatching = await ejecutarConsulta(
            db.from('representantes')
                .select('id, empresa_id, dni, cargo, nombre_completo, arrendadores!representantes_empresa_id_fkey ( id, nombre, cuit )')
                .in('dni', dnisPersonas),
            'buscar empresas representadas por miembros'
        ) || [];
        // Excluir representaciones de empresas que YA están en este mismo grupo
        // (ahí se ven igual en la sección de Representantes legales).
        const idsEmpresasDelGrupo = new Set(idsEmpresas);
        repsMatching.forEach(r => {
            if (!r.dni) return;
            if (idsEmpresasDelGrupo.has(r.empresa_id)) return;
            const dniN = normalizarDniLocal(r.dni);
            (empresasRepresentadasPorPersona[dniN] ||= []).push(r);
        });
    }

    // Filtrar contratos cuyo SET de arrendadores coincida exactamente con `idsOrden`
    const claveBuscada = idsOrden.join('|');
    const contratosDelGrupo = (contratos || []).filter(c => {
        const cIds = (c.contratos_arrendadores || [])
            .map(p => p.arrendador_id)
            .filter(Boolean)
            .sort();
        return cIds.join('|') === claveBuscada;
    });

    const contratoIds = new Set(contratosDelGrupo.map(c => c.id));
    const saldoPorContrato = new Map((saldos || []).map(s => [s.contrato_id, s]));
    const movsDelGrupo = (movimientos || []).filter(m => contratoIds.has(m.contrato_id));

    // Datos derivados del grupo
    const arrPorId = new Map(miembros.map(m => [m.id, m]));
    miembros.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));

    __contratoIdsGrupoActual = contratosDelGrupo.map(c => c.id);
    const nombreGrupo = calcularNombreGrupoFicha(miembros, contratosDelGrupo);
    __nombreGrupoActual = nombreGrupo;

    // Notas del grupo: se replican en todos los contratos del grupo. Tomamos
    // la primera no-nula; si difieren entre contratos, igual mostramos una
    // sola (la próxima edición las sincroniza a todas).
    const notasGrupo = (contratosDelGrupo.find(c => c.notas_grupo)?.notas_grupo) || '';
    window.__notasGrupoCargadas = notasGrupo;
    const tipoGrupo = calcularTipoGrupoFicha(miembros);

    // Titular: el que aparece como principal en el primer contrato; si no, miembros[0]
    let titularId = null;
    for (const c of contratosDelGrupo) {
        const t = (c.contratos_arrendadores || []).find(p => p.es_titular_principal);
        if (t) { titularId = t.arrendador_id; break; }
    }
    const titular = arrPorId.get(titularId) || miembros[0];

    // Totales QQ campaña activa
    let qqB = 0, qqN = 0;
    contratosDelGrupo.forEach(c => {
        const s = saldoPorContrato.get(c.id);
        if (s) {
            qqB += parseFloat(s.qq_deuda_blanco || 0);
            qqN += parseFloat(s.qq_deuda_negro || 0);
        }
    });

    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

    // Render
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);

    cont.innerHTML = `
        ${renderHeader(nombreGrupo, tipoGrupo, miembros, titular, puedeEditar, contratosDelGrupo.length)}
        ${renderTotales(qqB, qqN, contratosDelGrupo, hoy)}
        ${renderNotasGrupo(notasGrupo)}
        ${renderMiembros(miembros, contratosDelGrupo, puedeEditar)}
        ${renderRepresentantesGrupo(miembros, representantesPorEmpresa)}
        ${renderEmpresasRepresentadas(miembros, empresasRepresentadasPorPersona)}
        ${renderContratos(contratosDelGrupo, saldoPorContrato, hoy)}
        ${renderMovimientos(movsDelGrupo, arrPorId)}
    `;

    // Barra superior: solo "Agregar/Editar notas" entre Volver e Imprimir
    renderBarraAccionesGrupo(puedeEditar, contratosDelGrupo.length, !!notasGrupo);

    document.getElementById('pantalla-carga').style.display = 'none';
    document.getElementById('contenido-principal').style.display = '';
}

// ==============================================
// Helpers de cálculo (locales a esta página)
// ==============================================

function calcularNombreGrupoFicha(miembros, contratos) {
    const nombres = [...new Set((contratos || []).map(c => c.nombre_grupo).filter(Boolean))];
    if (nombres.length === 1) return nombres[0];
    if (miembros.length === 1) return miembros[0].nombre;
    const apellidos = miembros.map(m => m.apellido).filter(Boolean);
    if (apellidos.length === miembros.length && apellidos.every(ap => ap === apellidos[0])) {
        return 'Familia ' + apellidos[0].toUpperCase();
    }
    const etiquetas = miembros.map(m => m.apellido || m.nombre);
    const base = etiquetas.slice(0, 2).join(' / ');
    return miembros.length > 2 ? `${base} +${miembros.length - 2}` : base;
}

function calcularTipoGrupoFicha(miembros) {
    if (miembros.length === 1) {
        return miembros[0].tipo === 'empresa' ? 'Empresa' : 'Persona';
    }
    const todosFisicos = miembros.every(m => m.tipo !== 'empresa');
    const apellidos = miembros.map(m => m.apellido).filter(Boolean);
    if (todosFisicos && apellidos.length === miembros.length && apellidos.every(ap => ap === apellidos[0])) {
        return 'Familia';
    }
    return 'Sociedad';
}

function tipoBadge(tipo) {
    const map = {
        'Empresa':  '🏢 Empresa',
        'Persona':  '👤 Persona',
        'Familia':  '👨‍👩‍👧 Familia',
        'Sociedad': '🤝 Sociedad'
    };
    return `<span class="badge badge-gris">${map[tipo] || tipo}</span>`;
}

function fmtFecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
}

function fmtNum(n) {
    return Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

// ==============================================
// Render por sección
// ==============================================

function renderHeader(nombre, tipo, miembros, titular, puedeEditar, cantContratos) {
    const sub = miembros.length === 1
        ? (miembros[0].cuit || (miembros[0].dni ? `DNI ${miembros[0].dni}` : ''))
        : `${miembros.length} arrendadores`;

    const btnEditarNombre = (puedeEditar && cantContratos > 0)
        ? `<button class="btn-secundario" onclick="editarNombreGrupo()" title="Cambia el nombre del grupo en todos los contratos asociados" style="white-space:nowrap;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Editar nombre
           </button>`
        : '';
    const btnEliminar = puedeEditar
        ? `<button class="btn-peligro" onclick="confirmarEliminarGrupo()" title="Eliminar todos los miembros del grupo" style="white-space:nowrap;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
                Eliminar grupo
           </button>`
        : '';

    return `
        <div class="ficha-encabezado">
            <div style="display:flex; align-items:center; gap: var(--espacio-md); flex-wrap: wrap;">
                <h1 style="margin: 0;">${nombre}</h1>
                ${btnEditarNombre}
                ${btnEliminar}
            </div>
            <div style="display:flex; gap: var(--espacio-sm); align-items:center; margin-top: var(--espacio-xs); flex-wrap: wrap;">
                ${tipoBadge(tipo)}
                <span style="color: var(--color-texto-tenue);">${sub}</span>
                ${titular?.telefono ? `<span style="color: var(--color-texto-tenue);">·</span>
                  <span style="color: var(--color-texto-tenue);">Titular: <strong style="color:var(--color-texto);">${titular.nombre}</strong> · ${titular.telefono}</span>` : ''}
            </div>
        </div>
    `;
}

/**
 * Llena los contenedores de la barra superior con los botones de acción
 * del grupo (editar nombre, editar/agregar notas, eliminar grupo). Se
 * separa el botón destructivo en su propio contenedor a la derecha del
 * botón de imprimir, para que quede visualmente apartado.
 */
function renderBarraAccionesGrupo(puedeEditar, cantContratos, hayNotas) {
    const cont = document.getElementById('barra-acciones-grupo');
    const contDestr = document.getElementById('barra-acciones-grupo-destructivas');
    if (!cont || !contDestr) return;
    if (!puedeEditar) {
        cont.innerHTML = '';
        contDestr.innerHTML = '';
        return;
    }

    // En la barra superior solo queda el botón de notas (junto a Volver/Imprimir).
    // "Editar nombre" y "Eliminar grupo" ahora viven al lado del título del grupo.
    const btnNotas = cantContratos > 0
        ? `<button class="btn-secundario" onclick="editarNotasGrupo()" title="${hayNotas ? 'Editar notas del grupo' : 'Agregar notas del grupo'}" style="white-space:nowrap;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                ${hayNotas ? 'Editar notas' : 'Agregar notas'}
           </button>`
        : '';

    cont.innerHTML = btnNotas;
    contDestr.innerHTML = '';
}

function renderTotales(qqB, qqN, contratos, hoy) {
    const total = qqB + qqN;
    const cVigentes = contratos.filter(c => c.fecha_fin && new Date(c.fecha_fin + 'T00:00:00') >= hoy).length;
    return `
        <div class="ficha-tarjetas" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--espacio-md); margin-top: var(--espacio-md);">
            <div class="ficha-tarjeta">
                <div class="ficha-tarjeta-label">QQ pendientes (campaña activa)</div>
                <div class="ficha-tarjeta-valor" style="color: ${total > 0 ? 'var(--color-dorado)' : 'var(--color-verde)'};">${fmtNum(total)} qq</div>
                <div class="ficha-tarjeta-sub">B: ${fmtNum(qqB)} · N: ${fmtNum(qqN)}</div>
            </div>
            <div class="ficha-tarjeta">
                <div class="ficha-tarjeta-label">Contratos</div>
                <div class="ficha-tarjeta-valor">${contratos.length}</div>
                <div class="ficha-tarjeta-sub">${cVigentes} vigente${cVigentes !== 1 ? 's' : ''}</div>
            </div>
        </div>
    `;
}

function renderMiembros(miembros, contratos, puedeEditar) {
    const titularPorContrato = new Map();
    contratos.forEach(c => {
        const t = (c.contratos_arrendadores || []).find(p => p.es_titular_principal);
        if (t) titularPorContrato.set(c.id, t.arrendador_id);
    });
    const idsTitulares = new Set([...titularPorContrato.values()]);

    const filas = miembros.map(m => {
        const esTitular = idsTitulares.has(m.id);
        const idDoc = m.cuit || (m.dni ? `DNI ${m.dni}` : '—');
        const chipNotas = m.notas
            ? `<span class="badge badge-gris" style="margin-left:4px; cursor:help;" title="${m.notas.replace(/"/g, '&quot;')}">📝 nota</span>`
            : '';
        return `
            <tr>
                <td>
                    <a href="/arrendador.html?id=${m.id}" style="color: var(--color-texto); font-weight: 600;">${m.nombre}</a>
                    ${esTitular ? '<span style="color: var(--color-acento); margin-left:4px;" title="Titular principal en algún contrato">★</span>' : ''}
                    ${chipNotas}
                </td>
                <td>${m.tipo === 'empresa' ? 'Empresa' : 'Persona'}</td>
                <td>${idDoc}</td>
                <td>${m.telefono || '—'}</td>
                <td>${m.email || '—'}</td>
                <td>
                    <div class="tabla-acciones">
                        <a class="tabla-btn" href="/arrendador.html?id=${m.id}" title="Ver ficha individual">${ICONOS.ver}</a>
                        ${puedeEditar ? `<button class="tabla-btn" onclick="editarMiembroGrupo('${m.id}')" title="Editar datos del arrendador">${ICONOS.editar}</button>` : ''}
                        ${puedeEditar ? `<button class="tabla-btn btn-eliminar" onclick="confirmarEliminarArrendador('${m.id}', '${(m.nombre || '').replace(/'/g, "\\'")}')" title="Eliminar arrendador del directorio">${ICONOS.eliminar}</button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="ficha-seccion">
            <h2 class="ficha-seccion-titulo">Miembros del grupo (${miembros.length})</h2>
            <div class="tabla-contenedor" style="overflow-x:auto;">
                <table class="tabla">
                    <thead>
                        <tr>
                            <th>Nombre</th>
                            <th>Tipo</th>
                            <th>CUIT / DNI</th>
                            <th>Teléfono</th>
                            <th>Email</th>
                            <th style="width: 100px;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>
        </div>
    `;
}

/**
 * Normaliza un DNI sacándole puntos, guiones y espacios.
 * Devuelve string vacío si no hay nada útil.
 */
function normalizarDniLocal(dni) {
    if (!dni) return '';
    return String(dni).replace(/[.\s\-]/g, '').trim();
}

/**
 * Sección "También representa a..." — para personas-arrendador del grupo
 * cuyo DNI matchea con un representante en la BD (de una empresa que NO
 * está en este mismo grupo).
 */
function renderEmpresasRepresentadas(miembros, empresasRepresentadasPorPersona) {
    const personas = miembros.filter(m => m.tipo !== 'empresa' && m.dni);
    const filas = [];
    personas.forEach(p => {
        const dniN = normalizarDniLocal(p.dni);
        const reps = empresasRepresentadasPorPersona[dniN] || [];
        reps.forEach(r => {
            const empresa = r.arrendadores;
            if (!empresa) return;
            filas.push({ persona: p, empresa, cargo: r.cargo });
        });
    });
    if (filas.length === 0) return '';

    const html = filas.map(({ persona, empresa, cargo }) => {
        const cargoTxt = cargo ? `<span class="badge badge-gris" style="margin-left:6px;">${cargo}</span>` : '';
        const idDoc = empresa.cuit ? `CUIT ${empresa.cuit}` : '';
        return `
            <tr>
                <td>${persona.nombre}</td>
                <td>
                    <a href="/grupo.html?ids=${empresa.id}" style="color: var(--color-dorado); font-weight: 600;">
                        🏢 ${empresa.nombre}
                    </a>
                    ${cargoTxt}
                    ${idDoc ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">${idDoc}</span>` : ''}
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="ficha-seccion">
            <h2 class="ficha-seccion-titulo">También representa a</h2>
            <p style="font-size: var(--texto-xs); color: var(--color-texto-tenue); margin: 0 0 var(--espacio-md) 0;">
                Empresas en las que algún miembro de este grupo figura como representante legal (matcheo automático por DNI).
            </p>
            <div class="tabla-contenedor" style="overflow-x:auto;">
                <table class="tabla">
                    <thead>
                        <tr>
                            <th>Persona</th>
                            <th>Empresa que representa</th>
                        </tr>
                    </thead>
                    <tbody>${html}</tbody>
                </table>
            </div>
        </div>
    `;
}

/**
 * Sección "Representantes legales" — solo aparece si en el grupo hay
 * al menos una empresa con representantes cargados.
 */
function renderRepresentantesGrupo(miembros, representantesPorEmpresa) {
    const empresasConReps = miembros
        .filter(m => m.tipo === 'empresa' && (representantesPorEmpresa[m.id] || []).length > 0);

    if (empresasConReps.length === 0) return '';

    const bloques = empresasConReps.map(empresa => {
        const reps = representantesPorEmpresa[empresa.id] || [];
        const filas = reps.map(r => {
            const idDoc = r.cuit ? `CUIT ${r.cuit}` : (r.dni ? `DNI ${r.dni}` : '—');
            const cargo = r.cargo ? `<span class="badge badge-gris" style="margin-left:6px;">${r.cargo}</span>` : '';
            return `
                <tr>
                    <td><strong>${r.nombre_completo}</strong>${cargo}</td>
                    <td>${idDoc}</td>
                </tr>
            `;
        }).join('');

        // Si hay más de una empresa en el grupo, mostramos el nombre de la empresa como subtítulo
        const subtitulo = empresasConReps.length > 1
            ? `<h3 style="font-size: var(--texto-sm); color: var(--color-dorado); margin: 0 0 var(--espacio-xs) 0;">${empresa.nombre}</h3>`
            : '';

        return `
            <div style="margin-bottom: var(--espacio-md);">
                ${subtitulo}
                <div class="tabla-contenedor" style="overflow-x:auto;">
                    <table class="tabla">
                        <thead>
                            <tr>
                                <th>Nombre y cargo</th>
                                <th>CUIT / DNI</th>
                            </tr>
                        </thead>
                        <tbody>${filas}</tbody>
                    </table>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="ficha-seccion">
            <h2 class="ficha-seccion-titulo">Representantes legales</h2>
            <p style="font-size: var(--texto-xs); color: var(--color-texto-tenue); margin: 0 0 var(--espacio-md) 0;">
                Personas que firman en nombre de la empresa.
            </p>
            ${bloques}
        </div>
    `;
}

function renderContratos(contratos, saldoPorContrato, hoy) {
    if (contratos.length === 0) {
        return `
            <div class="ficha-seccion">
                <h2 class="ficha-seccion-titulo">Contratos</h2>
                <div class="vacio"><p>Este grupo no tiene contratos asociados.</p></div>
            </div>
        `;
    }

    const filas = contratos.map(c => {
        const vigente = c.fecha_fin && new Date(c.fecha_fin + 'T00:00:00') >= hoy;
        const s = saldoPorContrato.get(c.id);
        const qqB = s ? parseFloat(s.qq_deuda_blanco || 0) : 0;
        const qqN = s ? parseFloat(s.qq_deuda_negro || 0) : 0;

        // QQ/ha blanco y negro (sub-líneas dentro de la celda Pactado)
        const qqHaB = parseFloat(c.qq_por_hectarea || 0);
        const qqHaN = parseFloat(c.qq_negro_por_hectarea || 0);
        let lineaQQHa = '';
        if (qqHaB > 0 || qqHaN > 0) {
            const partes = [];
            if (qqHaB > 0) partes.push(`${fmtNum(qqHaB)} qq/ha`);
            if (qqHaN > 0) partes.push(`<span style="color:var(--color-texto-tenue);">+ ${fmtNum(qqHaN)} qq/ha negro</span>`);
            lineaQQHa = `<br><span style="font-size: var(--texto-xs); color: var(--color-dorado);">${partes.join(' · ')}</span>`;
        }

        return `
            <tr style="cursor:pointer;" onclick="window.location.href='/contratos.html?id=${c.id}'">
                <td><strong>${c.nombre_grupo || '—'}</strong></td>
                <td>${c.campo || '—'}</td>
                <td>${c.hectareas ? fmtNum(c.hectareas) + ' ha' : '—'}</td>
                <td>${fmtFecha(c.fecha_inicio)} → ${fmtFecha(c.fecha_fin)}</td>
                <td>
                    ${fmtNum(c.qq_pactados_anual)} qq/año
                    ${c.qq_negro_anual ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">+ ${fmtNum(c.qq_negro_anual)} negro</span>` : ''}
                    ${lineaQQHa}
                </td>
                <td>${qqB + qqN > 0 ? `<strong>${fmtNum(qqB + qqN)} qq</strong>` : '<span style="color: var(--color-verde);">0 qq</span>'}</td>
                <td>
                    <div style="display:flex; flex-direction:column; gap:3px; align-items:flex-start;">
                        ${vigente ? '<span class="badge badge-verde">Vigente</span>' : '<span class="badge badge-gris">Vencido</span>'}
                        ${renderBadgeAdelanto(c)}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="ficha-seccion">
            <h2 class="ficha-seccion-titulo">Contratos del grupo (${contratos.length})</h2>
            <div class="tabla-contenedor" style="overflow-x:auto;">
                <table class="tabla">
                    <thead>
                        <tr>
                            <th>Nombre</th>
                            <th>Campo</th>
                            <th>Hectáreas</th>
                            <th>Vigencia</th>
                            <th>Pactado</th>
                            <th>Pendiente (camp. activa)</th>
                            <th>Estado</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>
        </div>
    `;
}

function renderMovimientos(movs, arrPorId) {
    if (movs.length === 0) {
        return `
            <div class="ficha-seccion">
                <h2 class="ficha-seccion-titulo">Últimos movimientos</h2>
                <div class="vacio"><p>El grupo todavía no registra movimientos.</p></div>
            </div>
        `;
    }

    const filas = movs.slice(0, 30).map(m => {
        const emisor = arrPorId.get(m.arrendador_id);
        const estado = m.estado_factura === 'factura_ok'
            ? '<span class="badge badge-verde">Factura OK</span>'
            : m.estado_factura
                ? `<span class="badge badge-amarillo">${m.estado_factura.replace(/_/g, ' ')}</span>`
                : '<span class="badge badge-gris">—</span>';
        return `
            <tr>
                <td>${fmtFecha(m.fecha)}</td>
                <td>${emisor ? emisor.nombre : '—'}</td>
                <td>${fmtNum(m.qq)} qq</td>
                <td>${m.monto_total ? '$ ' + fmtNum(m.monto_total) : '—'}</td>
                <td>${m.numero_factura || '—'}</td>
                <td>${estado}</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="ficha-seccion">
            <h2 class="ficha-seccion-titulo">Últimos movimientos (${Math.min(movs.length, 30)} de ${movs.length})</h2>
            <div class="tabla-contenedor" style="overflow-x:auto;">
                <table class="tabla">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Emisor de factura</th>
                            <th>QQ</th>
                            <th>Monto</th>
                            <th>Nº factura</th>
                            <th>Estado</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>
        </div>
    `;
}

/**
 * Sección de notas del grupo. Solo se muestra si hay notas cargadas
 * (cuando no hay, se accede al modal desde el botón "Agregar notas" de
 * la barra superior). Sin contratos no se puede almacenar nada.
 */
function renderNotasGrupo(notas) {
    if (!notas) return '';
    // Escapamos HTML pero preservamos saltos de línea
    const html = notas
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    return `
        <div class="ficha-seccion">
            <h2 class="ficha-seccion-titulo">Notas del grupo</h2>
            <div style="margin-top: var(--espacio-sm); padding: var(--espacio-md); background-color: var(--color-fondo-tarjeta); border-left: 3px solid var(--color-acento); border-radius: var(--radio-sm); color: var(--color-texto); font-size: var(--texto-sm); line-height: 1.6; white-space: pre-wrap;">${html}</div>
        </div>
    `;
}

// ==============================================
// ACCIONES DE EDICIÓN
// ==============================================

/**
 * Abre el modal de arrendador (definido en arrendadores.js) para editar
 * los datos personales de un miembro del grupo. Después de guardar, el
 * hook `window.onArrendadorGuardado` recarga la ficha.
 */
async function editarMiembroGrupo(arrendadorId) {
    const { data, error } = await db.from('arrendadores').select('*').eq('id', arrendadorId).single();
    if (error || !data) {
        mostrarError('No se pudo cargar el arrendador.');
        return;
    }
    if (typeof abrirModalArrendador !== 'function') {
        mostrarError('Falta el modal de edición. Recargá la página.');
        return;
    }
    // arrendadorEditandoId vive en arrendadores.js
    arrendadorEditandoId = arrendadorId;
    abrirModalArrendador('Editar Arrendador', data);
}

/**
 * Cambia el "nombre del grupo" (etiqueta tipo "Familia BOCOLINI LOPEZ")
 * actualizando el campo `nombre_grupo` en TODOS los contratos del grupo.
 * Esto mantiene consistente la etiqueta donde aparece (lista de contratos,
 * ficha del grupo, dashboard, etc.).
 */
function editarNombreGrupo() {
    if (!__contratoIdsGrupoActual || __contratoIdsGrupoActual.length === 0) {
        mostrarError('Este grupo no tiene contratos: el nombre se calcula automáticamente.');
        return;
    }
    const contenido = `
        <div class="campo-grupo">
            <label class="campo-label">Nombre del grupo <span class="campo-requerido">*</span></label>
            <input type="text" id="campo-nombre-grupo" class="campo-input"
                   value="${(__nombreGrupoActual || '').replace(/"/g, '&quot;')}"
                   placeholder="Ej: Familia BOCOLINI LOPEZ">
            <span class="campo-ayuda">
                Se actualizará en los <strong>${__contratoIdsGrupoActual.length} contrato${__contratoIdsGrupoActual.length !== 1 ? 's' : ''}</strong> del grupo.
            </span>
        </div>
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarNombreGrupo()">Guardar</button>
    `;
    abrirModal('Editar nombre del grupo', contenido, footer);
    setTimeout(() => document.getElementById('campo-nombre-grupo')?.focus(), 100);
}

/**
 * Edita las notas del grupo. Se almacenan replicadas en `notas_grupo` de
 * todos los contratos del grupo (mismo patrón que `nombre_grupo`).
 */
function editarNotasGrupo() {
    if (!__contratoIdsGrupoActual || __contratoIdsGrupoActual.length === 0) {
        mostrarError('Este grupo no tiene contratos: agregá uno antes de tomar notas.');
        return;
    }
    // Buscamos las notas actuales (cualquier contrato del grupo las tiene)
    const notasActuales = window.__notasGrupoCargadas || '';
    const contenido = `
        <div class="campo-grupo">
            <label class="campo-label">Notas del grupo</label>
            <textarea id="campo-notas-grupo" class="campo-textarea" rows="6"
                      placeholder="Ej: Prefieren cobrar en USD. El hijo Juan maneja todo. Siempre piden anticipo en marzo.">${(notasActuales || '').replace(/</g, '&lt;')}</textarea>
            <span class="campo-ayuda">
                Estas notas son visibles para todo el grupo. Para observaciones personales de un miembro, editá el arrendador individualmente.
            </span>
        </div>
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primario" onclick="guardarNotasGrupo()">Guardar notas</button>
    `;
    abrirModal('Notas del grupo', contenido, footer);
    setTimeout(() => document.getElementById('campo-notas-grupo')?.focus(), 100);
}

async function guardarNotasGrupo() {
    const valor = document.getElementById('campo-notas-grupo')?.value.trim();
    const resultado = await ejecutarConsulta(
        db.from('contratos').update({ notas_grupo: valor || null }).in('id', __contratoIdsGrupoActual),
        'actualizar notas del grupo'
    );
    if (resultado !== undefined) {
        cerrarModal();
        mostrarExito('Notas actualizadas');
        await cargarFichaGrupo(__idsGrupoActual, __usuarioGrupoActual);
    }
}

/**
 * Elimina el grupo entero: marca como inactivos a TODOS sus miembros.
 * Es un soft delete (`activo = false`) — los datos siguen en la base y
 * los contratos NO se borran (quedan en historial). Si querés además
 * cerrar los contratos, hay que hacerlo desde la pestaña de contratos.
 */
function confirmarEliminarGrupo() {
    if (!__idsGrupoActual || __idsGrupoActual.length === 0) return;
    const cantidad = __idsGrupoActual.length;
    const nombre = __nombreGrupoActual || 'este grupo';
    const cantContratos = (__contratoIdsGrupoActual || []).length;

    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto); margin-bottom: var(--espacio-md);">
            ¿Seguro que querés eliminar el grupo <strong>${nombre}</strong>?
        </p>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario); margin-bottom: var(--espacio-sm);">
            Se van a eliminar del directorio <strong>${cantidad} arrendador${cantidad !== 1 ? 'es' : ''}</strong>.
            Los datos no se borran físicamente; quedan archivados.
        </p>
        ${cantContratos > 0 ? `
            <p style="font-size: var(--texto-sm); color: var(--color-dorado); margin-bottom: var(--espacio-sm);">
                ⚠️ Los <strong>${cantContratos} contrato${cantContratos !== 1 ? 's' : ''}</strong> del grupo
                <strong>NO</strong> se eliminan: siguen en el historial. Si querés cerrarlos,
                hacelo desde la sección Contratos.
            </p>
        ` : ''}
    `;
    const footer = `
        <button class="btn-secundario" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-peligro" onclick="cerrarModal(); eliminarGrupoCompleto()">
            Sí, eliminar grupo
        </button>
    `;
    abrirModal('Confirmar eliminación del grupo', contenido, footer);
}

async function eliminarGrupoCompleto() {
    const ids = __idsGrupoActual || [];
    if (ids.length === 0) return;

    const resultado = await ejecutarConsulta(
        db.from('arrendadores').update({ activo: false }).in('id', ids),
        'eliminar grupo completo'
    );
    if (resultado !== undefined) {
        mostrarExito(`Grupo eliminado (${ids.length} arrendador${ids.length !== 1 ? 'es' : ''})`);
        // Volvemos al listado: ya no tiene sentido quedarnos en una ficha vacía
        window.location.href = '/arrendadores.html';
    }
}

async function guardarNombreGrupo() {
    const nuevo = document.getElementById('campo-nombre-grupo')?.value.trim();
    if (!nuevo) {
        mostrarError('El nombre no puede estar vacío.');
        return;
    }
    const resultado = await ejecutarConsulta(
        db.from('contratos').update({ nombre_grupo: nuevo }).in('id', __contratoIdsGrupoActual),
        'actualizar nombre del grupo'
    );
    if (resultado !== undefined) {
        cerrarModal();
        mostrarExito('Nombre del grupo actualizado');
        await cargarFichaGrupo(__idsGrupoActual, __usuarioGrupoActual);
    }
}
