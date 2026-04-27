// ==============================================
// arrendadores.js — Directorio de GRUPOS de arrendadores
// Un grupo = conjunto de arrendadores que comparten contratos.
// Si A, B, C aparecen juntos en uno o más contratos → forman un solo grupo.
// La deuda en quintales es del CONTRATO, no de cada persona, así que se
// muestra a nivel grupo (suma de saldos de los contratos del grupo).
// Un arrendador sin contratos figura como su propio grupo unipersonal.
// ==============================================

let gruposCargados = [];
let arrendadoresCargados = []; // se mantiene para validación de duplicados y modal CRUD
let arrendadorEditandoId = null;

// ==============================================
// LEER — Cargar y agrupar
// ==============================================

async function cargarArrendadores() {
    const tbody = document.getElementById('tabla-arrendadores-body');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: var(--espacio-xl);">
                    <div class="spinner" style="margin: 0 auto;"></div>
                    <p style="color: var(--color-texto-tenue); margin-top: var(--espacio-md);">Cargando arrendadores...</p>
                </td>
            </tr>
        `;
    }

    // En paralelo: arrendadores + contratos (con pivot embebido) + saldos campaña activa + movimientos
    const [arrendadoresData, contratosData, saldosData, movimientosData] = await Promise.all([
        ejecutarConsulta(
            db.from('arrendadores').select('*').eq('activo', true).order('nombre'),
            'cargar arrendadores'
        ),
        ejecutarConsulta(
            db.from('contratos').select(`
                id, fecha_fin, estado, campo, nombre_grupo,
                adelanto_qq, adelanto_dia, adelanto_mes, adelanto_observaciones,
                contratos_arrendadores ( arrendador_id, es_titular_principal, orden )
            `),
            'cargar contratos'
        ),
        ejecutarConsulta(
            db.from('saldos')
                .select('contrato_id, qq_deuda_blanco, qq_deuda_negro, campanas!inner(activa)')
                .eq('campanas.activa', true),
            'cargar saldos campaña activa'
        ),
        ejecutarConsulta(
            db.from('movimientos')
                .select('contrato_id, arrendador_id, fecha, estado_factura')
                .order('fecha', { ascending: false }),
            'cargar movimientos'
        )
    ]);

    if (arrendadoresData === undefined) return;

    arrendadoresCargados = arrendadoresData;

    // Indexar
    const arrPorId = new Map(arrendadoresData.map(a => [a.id, a]));
    const saldoPorContrato = new Map();
    (saldosData || []).forEach(s => { if (s.contrato_id) saldoPorContrato.set(s.contrato_id, s); });
    const movsPorContrato = new Map();
    (movimientosData || []).forEach(m => {
        if (!m.contrato_id) return;
        if (!movsPorContrato.has(m.contrato_id)) movsPorContrato.set(m.contrato_id, []);
        movsPorContrato.get(m.contrato_id).push(m);
    });

    // Agrupar contratos por SET de arrendador_ids
    // clave = ids ordenados unidos por '|'  (estable, mismo set → misma clave)
    const keyToContratos = new Map();
    const keyToMemberIds = new Map();

    (contratosData || []).forEach(c => {
        const ids = (c.contratos_arrendadores || [])
            .map(p => p.arrendador_id)
            .filter(id => id && arrPorId.has(id))
            .sort();
        if (ids.length === 0) return;
        const key = ids.join('|');
        if (!keyToContratos.has(key)) {
            keyToContratos.set(key, []);
            keyToMemberIds.set(key, ids);
        }
        keyToContratos.get(key).push(c);
    });

    // Arrendadores que NO están en ningún contrato → grupo unipersonal "huérfano"
    const arrEnGrupos = new Set();
    keyToMemberIds.forEach(ids => ids.forEach(id => arrEnGrupos.add(id)));
    arrendadoresData.forEach(a => {
        if (!arrEnGrupos.has(a.id)) {
            keyToMemberIds.set(a.id, [a.id]);
            keyToContratos.set(a.id, []);
        }
    });

    // Construir grupos
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const grupos = [];

    keyToMemberIds.forEach((memberIds, key) => {
        const miembros = memberIds.map(id => arrPorId.get(id)).filter(Boolean);
        if (miembros.length === 0) return;
        const contratos = keyToContratos.get(key) || [];

        // Titular: el que aparece como es_titular_principal en algún contrato; si no, miembros[0]
        let titularId = null;
        for (const c of contratos) {
            const t = (c.contratos_arrendadores || []).find(p => p.es_titular_principal);
            if (t) { titularId = t.arrendador_id; break; }
        }
        const titular = arrPorId.get(titularId) || miembros[0];

        // Contratos vigentes / por vencer
        const cVigentes = contratos.filter(c => c.fecha_fin && new Date(c.fecha_fin + 'T00:00:00') >= hoy);
        const cPorVencer = cVigentes.filter(c => {
            const dias = Math.ceil((new Date(c.fecha_fin + 'T00:00:00') - hoy) / 86400000);
            return dias <= 90;
        });

        // QQ pendientes — suma de saldos de TODOS los contratos del grupo en campaña activa
        let qqB = 0, qqN = 0;
        contratos.forEach(c => {
            const s = saldoPorContrato.get(c.id);
            if (s) {
                qqB += parseFloat(s.qq_deuda_blanco || 0);
                qqN += parseFloat(s.qq_deuda_negro || 0);
            }
        });

        // Última entrega + facturas pendientes (sobre contratos del grupo)
        let ultimaFecha = null;
        let facturasPend = 0;
        contratos.forEach(c => {
            const ms = movsPorContrato.get(c.id) || [];
            ms.forEach(m => {
                if (!ultimaFecha || m.fecha > ultimaFecha) ultimaFecha = m.fecha;
                if (m.estado_factura && m.estado_factura !== 'factura_ok') facturasPend++;
            });
        });

        const nombre = calcularNombreGrupo(miembros, contratos);
        const tipo = calcularTipoGrupo(miembros);
        const contratoConAdelanto = contratos.find(contratoTieneAdelanto) || null;

        grupos.push({
            key,
            memberIds,
            miembros,
            titular,
            contratos,
            nombre,
            tipo,
            _contratoAdelanto: contratoConAdelanto,
            _contratosTotal: contratos.length,
            _contratosVigentes: cVigentes.length,
            _contratosPorVencer: cPorVencer.length,
            _qqBlanco: qqB,
            _qqNegro: qqN,
            _qqPendientes: qqB + qqN,
            _ultimaEntregaFecha: ultimaFecha,
            _facturasPendientes: facturasPend
        });
    });

    grupos.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    gruposCargados = grupos;

    renderizarTablaGrupos(grupos);
    actualizarContador(grupos.length);
    mostrarAlertasGrupos(grupos);
}

/**
 * Nombre del grupo:
 *  1) si todos los contratos comparten un mismo `nombre_grupo`, ese (es lo que el usuario tipeó al crearlos).
 *  2) si hay 1 miembro → su nombre.
 *  3) si todos comparten apellido → "Familia APELLIDO".
 *  4) si no → "APELLIDO1 / APELLIDO2 [+N]".
 */
function calcularNombreGrupo(miembros, contratos) {
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

/**
 * Tipo del grupo (auto):
 *  - 1 persona física → "Persona"
 *  - 1 empresa       → "Empresa"
 *  - 2+ personas, mismo apellido → "Familia"
 *  - 2+ con apellidos distintos / mezcla con empresas → "Sociedad"
 */
function calcularTipoGrupo(miembros) {
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

// ==============================================
// RENDER — Tabla
// ==============================================

function renderizarTablaGrupos(grupos) {
    const tbody = document.getElementById('tabla-arrendadores-body');
    if (!tbody) return;

    if (grupos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="tabla-vacia">
                    No hay arrendadores registrados
                    <p>Hacé click en "Nuevo Arrendador" para agregar el primero</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = grupos.map(g => {
        const tipoBadge = renderizarTipoBadge(g.tipo);
        const idsParam = g.memberIds.join(',');
        const subtitulo = g.miembros.length === 1
            ? (g.miembros[0].cuit || (g.miembros[0].dni ? `DNI ${g.miembros[0].dni}` : ''))
            : `${g.miembros.length} arrendadores`;

        return `
        <tr style="cursor:pointer;" onclick="window.location.href='/grupo.html?ids=${idsParam}'">
            <td>
                <strong>${g.nombre}</strong>
                ${subtitulo ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">${subtitulo}</span>` : ''}
            </td>
            <td>${tipoBadge}</td>
            <td onclick="event.stopPropagation();">${renderizarContactoCelda(g.titular)}</td>
            <td>${renderizarContratosCelda(g)}</td>
            <td>${renderizarQQCelda(g)}</td>
            <td>${renderizarUltimaEntregaCelda(g)}</td>
            <td>${obtenerBadgesGrupo(g)}</td>
            <td onclick="event.stopPropagation();">
                <div class="tabla-acciones">
                    <a class="tabla-btn" href="/grupo.html?ids=${idsParam}" title="Ver grupo">
                        ${ICONOS.ver}
                    </a>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function renderizarTipoBadge(tipo) {
    const map = {
        'Empresa':  '<span class="badge badge-gris" title="Empresa">🏢 Empresa</span>',
        'Persona':  '<span class="badge badge-gris" title="Persona física">👤 Persona</span>',
        'Familia':  '<span class="badge badge-gris" title="Grupo familiar">👨‍👩‍👧 Familia</span>',
        'Sociedad': '<span class="badge badge-gris" title="Sociedad / varios titulares">🤝 Sociedad</span>'
    };
    return map[tipo] || `<span class="badge badge-gris">${tipo}</span>`;
}

// ==============================================
// CELDAS
// ==============================================

function renderizarContactoCelda(a) {
    if (!a || !a.telefono) {
        return '<span style="color: var(--color-texto-tenue);">—</span>';
    }
    const soloDigitos = a.telefono.replace(/\D/g, '');
    const telWa = soloDigitos.startsWith('54') ? soloDigitos : '54' + soloDigitos;

    return `
        <div style="white-space:nowrap; display:flex; align-items:center; gap:6px;">
            <a href="tel:${a.telefono}" style="color:var(--color-texto); text-decoration:none;" title="Llamar">${a.telefono}</a>
            <a href="https://wa.me/${telWa}" target="_blank" rel="noopener"
               style="color:var(--color-verde); text-decoration:none; font-size:14px;" title="WhatsApp">
                <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px;vertical-align:middle;">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
            </a>
        </div>
    `;
}

function renderizarContratosCelda(g) {
    if (g._contratosVigentes === 0) {
        if (g._contratosTotal === 0) {
            return '<span class="badge badge-sin-contrato">Sin contrato</span>';
        }
        return '<span style="color: var(--color-texto-tenue); font-size: var(--texto-xs);">Todos vencidos</span>';
    }
    let html = `<strong>${g._contratosVigentes}</strong> vigente${g._contratosVigentes !== 1 ? 's' : ''}`;
    if (g._contratosPorVencer > 0) {
        html += `<br><span style="font-size: var(--texto-xs); color: var(--color-dorado);">⏰ ${g._contratosPorVencer} por vencer</span>`;
    }
    return html;
}

function renderizarQQCelda(g) {
    if (g._qqPendientes <= 0) {
        return '<span style="color: var(--color-verde); font-size: var(--texto-sm);">0 qq</span>';
    }
    const total = Number(g._qqPendientes).toLocaleString('es-AR', { maximumFractionDigits: 2 });
    const color = g._qqPendientes > 200 ? 'var(--color-dorado)' : 'var(--color-texto)';

    let detalle = '';
    if (g._qqBlanco > 0 && g._qqNegro > 0) {
        detalle = `B: ${Number(g._qqBlanco).toLocaleString('es-AR')} · N: ${Number(g._qqNegro).toLocaleString('es-AR')}`;
    } else if (g._qqNegro > 0) detalle = 'Negro';
    else if (g._qqBlanco > 0) detalle = 'Blanco';

    return `
        <strong style="color: ${color};">${total} qq</strong>
        ${detalle ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">${detalle}</span>` : ''}
    `;
}

function renderizarUltimaEntregaCelda(g) {
    if (!g._ultimaEntregaFecha) {
        return '<span style="color: var(--color-texto-tenue);">Sin entregas</span>';
    }
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const fecha = new Date(g._ultimaEntregaFecha + 'T00:00:00');
    const dias = Math.floor((hoy - fecha) / 86400000);

    let color = 'var(--color-texto-tenue)';
    if (dias > 60) color = 'var(--color-error)';
    else if (dias > 30) color = 'var(--color-dorado)';

    const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const fechaCorta = `${fecha.getDate()} ${meses[fecha.getMonth()]}`;

    return `${fechaCorta}<br><span style="font-size: var(--texto-xs); color: ${color};">hace ${dias}d</span>`;
}

function obtenerBadgesGrupo(g) {
    const badges = [];
    if (g._contratosTotal === 0) {
        badges.push('<span class="badge badge-sin-contrato">Sin contrato</span>');
    } else if (g._contratosVigentes === 0) {
        badges.push('<span class="badge badge-gris">Sin contrato vigente</span>');
    } else if (g._qqPendientes > 0) {
        badges.push('<span class="badge badge-amarillo">Con deuda</span>');
    } else {
        badges.push('<span class="badge badge-verde">Al día</span>');
    }
    if (g._facturasPendientes > 0) {
        badges.push(`<span class="badge badge-rojo" title="${g._facturasPendientes} movimiento${g._facturasPendientes !== 1 ? 's' : ''} sin factura OK">📄 ${g._facturasPendientes} FC</span>`);
    }
    if (g._contratoAdelanto) {
        badges.push(renderBadgeAdelanto(g._contratoAdelanto));
    }
    // Datos incompletos a nivel grupo: cualquier miembro al que le falte CUIT o teléfono
    const incompletos = g.miembros.filter(m => !m.cuit || !m.telefono);
    if (incompletos.length > 0) {
        badges.push(`<span class="badge badge-datos-incompletos" title="${incompletos.length} miembro${incompletos.length !== 1 ? 's' : ''} con datos incompletos">Completar datos</span>`);
    }
    return `<div style="display: flex; flex-direction: column; gap: 3px; align-items: flex-start;">${badges.join('')}</div>`;
}

// ==============================================
// ALERTAS
// ==============================================

function mostrarAlertasGrupos(grupos) {
    const contenedor = document.getElementById('alertas-arrendadores');
    if (!contenedor) return;

    const sinContrato = grupos.filter(g => g._contratosTotal === 0);
    if (sinContrato.length === 0) {
        contenedor.innerHTML = '';
        return;
    }
    const nombres = sinContrato.length <= 3
        ? sinContrato.map(g => g.nombre).join(', ')
        : sinContrato.slice(0, 3).map(g => g.nombre).join(', ') + ` y ${sinContrato.length - 3} más`;

    contenedor.innerHTML = `
        <div style="display:flex; align-items:center; gap:var(--espacio-sm); padding:var(--espacio-sm) var(--espacio-md); border-radius:var(--radio-md); margin-bottom:var(--espacio-md); background-color:rgba(201,76,76,0.12); border:1px solid rgba(201,76,76,0.3); color:var(--color-error); font-size:var(--texto-xs);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;flex-shrink:0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span><strong>${sinContrato.length} sin contrato:</strong> ${nombres}</span>
        </div>
    `;
}

function actualizarContador(cantidad) {
    const contador = document.getElementById('tabla-contador');
    if (contador) {
        const palabra = cantidad === 1 ? 'grupo' : 'grupos';
        contador.textContent = `${cantidad} ${palabra}`;
    }
}

// ==============================================
// BUSCAR — matchea nombre del grupo + cualquier miembro
// ==============================================

function buscarArrendadores(termino) {
    const t = (termino || '').toLowerCase().trim();
    if (!t) {
        renderizarTablaGrupos(gruposCargados);
        actualizarContador(gruposCargados.length);
        return;
    }
    const filtrados = gruposCargados.filter(g => {
        if (g.nombre && g.nombre.toLowerCase().includes(t)) return true;
        return g.miembros.some(a =>
            (a.nombre && a.nombre.toLowerCase().includes(t)) ||
            (a.apellido && a.apellido.toLowerCase().includes(t)) ||
            (a.nombre_pila && a.nombre_pila.toLowerCase().includes(t)) ||
            (a.cuit && a.cuit.includes(t)) ||
            (a.dni && a.dni.includes(t)) ||
            (a.telefono && a.telefono.includes(t)) ||
            (a.email && a.email.toLowerCase().includes(t))
        );
    });
    renderizarTablaGrupos(filtrados);
    actualizarContador(filtrados.length);
}

// ==============================================
// CREAR / EDITAR (nivel arrendador individual — sigue igual)
// El alta/edición se hace por persona; los grupos se forman implícitamente
// al cargar contratos compartidos.
// ==============================================

function abrirModalNuevoArrendador() {
    arrendadorEditandoId = null;
    abrirModalArrendador('Nuevo Arrendador', { tipo: 'persona_fisica' });
}

async function editarArrendador(id) {
    const arrendador = arrendadoresCargados.find(a => a.id === id);
    if (!arrendador) {
        mostrarError('No se encontró el arrendador.');
        return;
    }
    arrendadorEditandoId = id;
    abrirModalArrendador('Editar Arrendador', arrendador);
}

function abrirModalArrendador(titulo, datos) {
    const tipo = datos.tipo || 'persona_fisica';

    const contenido = `
        <div class="form-seccion-titulo">Tipo</div>
        <div class="campo-grupo">
            <label class="campo-label">Tipo de arrendador <span class="campo-requerido">*</span></label>
            <select id="campo-tipo" class="campo-select" onchange="toggleTipoArrendador()">
                <option value="persona_fisica" ${tipo === 'persona_fisica' ? 'selected' : ''}>Persona física</option>
                <option value="empresa" ${tipo === 'empresa' ? 'selected' : ''}>Empresa</option>
            </select>
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo">Datos identificatorios</div>

        <div class="campo-grupo">
            <label class="campo-label">Nombre completo / Razón social <span class="campo-requerido">*</span></label>
            <input type="text" id="campo-nombre" class="campo-input" value="${datos.nombre || ''}" placeholder="Ej: Roberto Mateo Rebufatti / Agropecuaria del Sur S.A.">
        </div>

        <div id="bloque-persona" style="display: ${tipo === 'persona_fisica' ? 'block' : 'none'};">
            <div class="campos-fila">
                <div class="campo-grupo">
                    <label class="campo-label">Nombre de pila</label>
                    <input type="text" id="campo-nombre-pila" class="campo-input" value="${datos.nombre_pila || ''}" placeholder="Ej: Roberto Mateo">
                </div>
                <div class="campo-grupo">
                    <label class="campo-label">Apellido</label>
                    <input type="text" id="campo-apellido" class="campo-input" value="${datos.apellido || ''}" placeholder="Ej: Rebufatti">
                    <span class="campo-ayuda">Se usa para armar "Familia X" en contratos</span>
                </div>
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
        </div>

        <div id="bloque-empresa" style="display: ${tipo === 'empresa' ? 'block' : 'none'};">
            <div class="campo-grupo">
                <label class="campo-label">CUIT</label>
                <input type="text" id="campo-cuit-empresa" class="campo-input" value="${tipo === 'empresa' ? (datos.cuit || '') : ''}" placeholder="Ej: 30-12345678-9">
            </div>
        </div>

        <div class="campo-grupo">
            <label class="campo-label">Domicilio</label>
            <input type="text" id="campo-domicilio" class="campo-input" value="${datos.domicilio || ''}" placeholder="Ej: Villa Ascasubi, Córdoba">
        </div>

        <hr class="form-separador">
        <div class="form-seccion-titulo">Contacto</div>

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
    setTimeout(() => document.getElementById('campo-nombre')?.focus(), 100);
}

function toggleTipoArrendador() {
    const tipo = document.getElementById('campo-tipo')?.value;
    const bloquePersona = document.getElementById('bloque-persona');
    const bloqueEmpresa = document.getElementById('bloque-empresa');
    if (!bloquePersona || !bloqueEmpresa) return;
    bloquePersona.style.display = tipo === 'persona_fisica' ? 'block' : 'none';
    bloqueEmpresa.style.display = tipo === 'empresa' ? 'block' : 'none';
}

async function guardarArrendador() {
    const tipo = document.getElementById('campo-tipo')?.value || 'persona_fisica';
    const nombre = document.getElementById('campo-nombre')?.value.trim();
    const nombrePila = document.getElementById('campo-nombre-pila')?.value.trim();
    const apellido = document.getElementById('campo-apellido')?.value.trim();
    const dni = tipo === 'persona_fisica' ? document.getElementById('campo-dni')?.value.trim() : '';
    const cuit = tipo === 'empresa'
        ? document.getElementById('campo-cuit-empresa')?.value.trim()
        : document.getElementById('campo-cuit')?.value.trim();
    const domicilio = document.getElementById('campo-domicilio')?.value.trim();
    const telefono = document.getElementById('campo-telefono')?.value.trim();
    const email = document.getElementById('campo-email')?.value.trim();
    const notas = document.getElementById('campo-notas')?.value.trim();

    if (!nombre) {
        const c = document.getElementById('campo-nombre');
        c.classList.add('invalido');
        c.focus();
        mostrarError('El nombre es obligatorio.');
        return;
    }

    const cuitNorm = (cuit || '').replace(/[-\s.]/g, '');
    const dniNorm = (dni || '').replace(/[-\s.]/g, '');
    const duplicado = arrendadoresCargados.find(a => {
        if (arrendadorEditandoId && a.id === arrendadorEditandoId) return false;
        if (cuitNorm && a.cuit && a.cuit.replace(/[-\s.]/g, '') === cuitNorm) return true;
        if (dniNorm && a.dni && a.dni.replace(/[-\s.]/g, '') === dniNorm) return true;
        return false;
    });

    if (duplicado) {
        const razon = (cuitNorm && duplicado.cuit && duplicado.cuit.replace(/[-\s.]/g, '') === cuitNorm)
            ? `Ya existe un arrendador con el CUIT ${duplicado.cuit} (${duplicado.nombre})`
            : `Ya existe un arrendador con el DNI ${duplicado.dni} (${duplicado.nombre})`;
        mostrarError(razon);
        return;
    }

    const datos = {
        tipo,
        nombre,
        nombre_pila: tipo === 'persona_fisica' ? (nombrePila || null) : null,
        apellido: tipo === 'persona_fisica' ? (apellido || null) : null,
        dni: tipo === 'persona_fisica' ? (dni || null) : null,
        cuit: cuit || null,
        domicilio: domicilio || null,
        telefono: telefono || null,
        email: email || null,
        notas: notas || null
    };

    let resultado;
    if (arrendadorEditandoId) {
        resultado = await ejecutarConsulta(
            db.from('arrendadores').update(datos).eq('id', arrendadorEditandoId),
            'actualizar arrendador'
        );
    } else {
        resultado = await ejecutarConsulta(
            db.from('arrendadores').insert(datos),
            'crear arrendador'
        );
    }

    if (resultado !== undefined) {
        cerrarModal();
        mostrarExito(arrendadorEditandoId ? 'Arrendador actualizado' : 'Arrendador creado');
        arrendadorEditandoId = null;
        // Recarga el listado si estamos en /arrendadores.html
        if (typeof cargarArrendadores === 'function' && document.getElementById('tabla-arrendadores-body')) {
            await cargarArrendadores();
        }
        // Hook genérico para otras páginas (ej: grupo.html, arrendador.html)
        if (typeof window.onArrendadorGuardado === 'function') {
            await window.onArrendadorGuardado();
        }
    }
}

// ==============================================
// ELIMINAR
// ==============================================

function confirmarEliminarArrendador(id, nombre) {
    window.__idEliminarArrendador = id;
    const contenido = `
        <p style="font-size: var(--texto-lg); color: var(--color-texto); margin-bottom: var(--espacio-md);">
            ¿Seguro que querés eliminar a <strong>${nombre}</strong>?
        </p>
        <p style="font-size: var(--texto-sm); color: var(--color-texto-secundario);">
            El arrendador dejará de aparecer en las listas, pero sus datos se conservan en el sistema. Si está vinculado a contratos, esos vínculos siguen existiendo.
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

async function eliminarArrendador(id) {
    const resultado = await ejecutarConsulta(
        db.from('arrendadores').update({ activo: false }).eq('id', id),
        'eliminar arrendador'
    );
    if (resultado !== undefined) {
        mostrarExito('Arrendador eliminado');
        if (typeof cargarArrendadores === 'function' && document.getElementById('tabla-arrendadores-body')) {
            await cargarArrendadores();
        }
        if (typeof window.onArrendadorGuardado === 'function') {
            await window.onArrendadorGuardado();
        }
    }
}
