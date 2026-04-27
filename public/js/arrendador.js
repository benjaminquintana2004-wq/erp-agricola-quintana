// ==============================================
// arrendador.js — Ficha integral del arrendador
// Vista detallada: datos, contratos, timeline de campañas, movimientos.
// ==============================================

/**
 * Carga todos los datos del arrendador y renderiza la ficha.
 */
async function cargarFichaArrendador(id, usuario) {
    const contenido = document.getElementById('ficha-contenido');

    // Traer en paralelo: arrendador, vínculos a contratos (con datos), movimientos, campañas
    const [arrendador, vinculosContratos, movimientos, campanas] = await Promise.all([
        ejecutarConsulta(
            db.from('arrendadores').select('*').eq('id', id).single(),
            'cargar arrendador'
        ),
        ejecutarConsulta(
            db.from('contratos_arrendadores')
                .select(`
                    es_titular_principal,
                    contratos (
                        *,
                        contratos_arrendadores ( arrendador_id, es_titular_principal, arrendadores ( id, nombre ) ),
                        campanas ( id, nombre, anio_inicio, activa )
                    )
                `)
                .eq('arrendador_id', id),
            'cargar vínculos del arrendador'
        ),
        ejecutarConsulta(
            db.from('movimientos')
                .select('*, campanas(id, nombre, anio_inicio)')
                .eq('arrendador_id', id)
                .order('fecha', { ascending: false }),
            'cargar movimientos del arrendador'
        ),
        ejecutarConsulta(
            db.from('campanas').select('*').order('anio_inicio', { ascending: false }),
            'cargar campañas'
        )
    ]);

    // Aplanar contratos del pivot
    const contratos = (vinculosContratos || [])
        .map(v => v.contratos)
        .filter(Boolean)
        .sort((a, b) => (b.fecha_inicio || '').localeCompare(a.fecha_inicio || ''));

    // Saldos: traer todos los saldos de los contratos donde aparece la persona
    let saldos = [];
    const contratoIds = contratos.map(c => c.id);
    if (contratoIds.length > 0) {
        saldos = await ejecutarConsulta(
            db.from('saldos')
                .select('*, campanas(id, nombre, anio_inicio, activa)')
                .in('contrato_id', contratoIds),
            'cargar saldos de los contratos'
        ) || [];
    }

    if (!arrendador) {
        contenido.innerHTML = `
            <div class="vacio">
                <p>No se encontró el arrendador con id <code>${id}</code>.</p>
                <a class="btn-secundario" href="/arrendadores.html">Volver al listado</a>
            </div>`;
        return;
    }

    // Actualizar título del header dinámicamente
    const tituloHeader = document.querySelector('.pagina-header h1');
    if (tituloHeader) tituloHeader.textContent = arrendador.nombre;

    // Mostrar botón editar si el rol lo permite
    if (['admin_total', 'admin'].includes(usuario?.rol)) {
        const btn = document.getElementById('btn-editar-arr');
        if (btn) {
            btn.style.display = 'inline-flex';
            btn.onclick = () => editarArrendadorDesdeFicha(arrendador);
        }
    }

    // Guardar el arrendador en memoria para edición inline
    window.__ARRENDADOR_FICHA__ = arrendador;

    // Renderizar la ficha completa
    contenido.innerHTML = `
        ${renderizarEncabezado(arrendador)}
        ${renderizarAccionesRapidas(arrendador)}
        ${renderizarStats(arrendador, contratos || [], saldos || [], movimientos || [])}
        ${renderizarNotas(arrendador, usuario)}
        ${renderizarContratos(contratos || [])}
        ${renderizarLineaTiempo(contratos || [], movimientos || [])}
        ${renderizarTimeline(campanas || [], contratos || [], saldos || [], movimientos || [])}
        ${renderizarMovimientosRecientes(movimientos || [], id)}
    `;
}

// ==============================================
// ENCABEZADO
// ==============================================
function renderizarEncabezado(a) {
    const linea1 = [];
    const tipoLabel = a.tipo === 'empresa' ? '🏢 Empresa' : '👤 Persona física';
    linea1.push(tipoLabel);
    if (a.cuit) linea1.push(`CUIT ${a.cuit}`);
    if (a.dni) linea1.push(`DNI ${a.dni}`);

    const ubicaciones = [];
    if (a.domicilio) ubicaciones.push(`🏠 ${escaparHTML(a.domicilio)}`);

    const estadoBadge = a.activo === false
        ? '<span class="badge badge-gris">Inactivo</span>'
        : '<span class="badge badge-verde">Activo</span>';

    return `
        <div class="ficha-card ficha-encabezado">
            <div class="ficha-encabezado-titulo">
                <h2>${escaparHTML(a.nombre)}</h2>
                ${estadoBadge}
            </div>
            ${linea1.length ? `<div class="ficha-encabezado-ids">${linea1.join(' · ')}</div>` : ''}
            ${ubicaciones.length ? `<div class="ficha-encabezado-ids">${ubicaciones.join(' · ')}</div>` : ''}
        </div>
    `;
}

// ==============================================
// ACCIONES RÁPIDAS (contacto)
// ==============================================

// Íconos SVG para los botones (Lucide style)
const ICONO_WHATSAPP = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>';
const ICONO_TELEFONO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
const ICONO_EMAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
const ICONO_MAPA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

/**
 * Fila de botones de contacto rápido.
 * Cada botón se habilita o deshabilita según si hay dato cargado.
 */
function renderizarAccionesRapidas(a) {
    // Teléfono limpio (solo números) para wa.me y tel:
    const telLimpio = a.telefono ? a.telefono.replace(/\D/g, '') : '';

    // Destino del mapa: domicilio del arrendador. Agregamos ", Argentina" para mejorar la búsqueda.
    const destinoMapa = a.domicilio;
    const urlMapa = destinoMapa
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destinoMapa + ', Argentina')}`
        : null;
    const etiquetaMapa = destinoMapa ? escaparHTML(destinoMapa) : 'Sin ubicación cargada';

    // Subject del email, pre-armado
    const subjectEmail = encodeURIComponent(`Agrícola Quintana — ${a.nombre}`);

    // Helper para renderizar cada botón
    const boton = (habilitado, href, target, icono, titulo, subtitulo) => {
        if (!habilitado) {
            return `
                <div class="ficha-accion ficha-accion-deshabilitada" title="No hay datos cargados">
                    <span class="ficha-accion-icono">${icono}</span>
                    <div class="ficha-accion-texto">
                        <strong>${titulo}</strong>
                        <small>${subtitulo}</small>
                    </div>
                </div>
            `;
        }
        return `
            <a class="ficha-accion" href="${href}" ${target ? `target="${target}" rel="noopener"` : ''}>
                <span class="ficha-accion-icono">${icono}</span>
                <div class="ficha-accion-texto">
                    <strong>${titulo}</strong>
                    <small>${subtitulo}</small>
                </div>
            </a>
        `;
    };

    return `
        <div class="ficha-acciones-rapidas no-imprimir">
            ${boton(
                !!telLimpio,
                `https://wa.me/${telLimpio}`,
                '_blank',
                ICONO_WHATSAPP,
                'WhatsApp',
                telLimpio ? escaparHTML(a.telefono) : 'Sin teléfono'
            )}
            ${boton(
                !!telLimpio,
                `tel:${telLimpio}`,
                null,
                ICONO_TELEFONO,
                'Llamar',
                telLimpio ? escaparHTML(a.telefono) : 'Sin teléfono'
            )}
            ${boton(
                !!a.email,
                `mailto:${a.email}?subject=${subjectEmail}`,
                null,
                ICONO_EMAIL,
                'Email',
                a.email ? escaparHTML(a.email) : 'Sin email'
            )}
            ${boton(
                !!urlMapa,
                urlMapa,
                '_blank',
                ICONO_MAPA,
                'Cómo llegar',
                etiquetaMapa
            )}
        </div>
    `;
}

// ==============================================
// STATS ROW
// ==============================================
function renderizarStats(a, contratos, saldos, movimientos) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const vigentes = contratos.filter(c => c.fecha_fin && new Date(c.fecha_fin + 'T00:00:00') >= hoy);
    const hectareasTotal = vigentes.reduce((s, c) => s + parseFloat(c.hectareas || 0), 0);

    // Saldo campaña activa: sumo los saldos de todos los contratos donde está la persona.
    // Estos números son a nivel CONTRATO (no individual), porque varias personas pueden
    // compartir un contrato y la deuda es del grupo.
    const saldosActivos = saldos.filter(s => s.campanas?.activa);
    const qqBlanco = saldosActivos.reduce((s, x) => s + parseFloat(x.qq_deuda_blanco || 0), 0);
    const qqNegro = saldosActivos.reduce((s, x) => s + parseFloat(x.qq_deuda_negro || 0), 0);
    const qqPendientes = qqBlanco + qqNegro;

    const qqEntregadosTotal = movimientos.reduce((s, m) => s + parseFloat(m.qq || 0), 0);

    const facturasPendientes = movimientos.filter(m => m.estado_factura && m.estado_factura !== 'factura_ok').length;

    return `
        <div class="ficha-stats">
            <div class="ficha-stat">
                <div class="ficha-stat-valor">${vigentes.length}</div>
                <div class="ficha-stat-label">Contratos vigentes</div>
                <div class="ficha-stat-sub">${contratos.length} total</div>
            </div>
            <div class="ficha-stat">
                <div class="ficha-stat-valor">${hectareasTotal.toLocaleString('es-AR', { maximumFractionDigits: 2 })} ha</div>
                <div class="ficha-stat-label">Hectáreas vigentes</div>
            </div>
            <div class="ficha-stat">
                <div class="ficha-stat-valor" style="color: ${qqPendientes > 0 ? 'var(--color-dorado)' : 'var(--color-verde)'};">
                    ${formatearQQ(qqPendientes)}
                </div>
                <div class="ficha-stat-label">QQ pendientes (campaña activa)</div>
                ${qqBlanco > 0 && qqNegro > 0
                    ? `<div class="ficha-stat-sub">B: ${formatearQQ(qqBlanco)} · N: ${formatearQQ(qqNegro)}</div>`
                    : qqNegro > 0 ? `<div class="ficha-stat-sub">Negro</div>`
                    : qqBlanco > 0 ? `<div class="ficha-stat-sub">Blanco</div>` : ''}
            </div>
            <div class="ficha-stat">
                <div class="ficha-stat-valor">${formatearQQ(qqEntregadosTotal)}</div>
                <div class="ficha-stat-label">QQ entregados (histórico)</div>
                <div class="ficha-stat-sub">${movimientos.length} movimientos</div>
            </div>
            ${facturasPendientes > 0 ? `
                <div class="ficha-stat ficha-stat-alerta">
                    <div class="ficha-stat-valor" style="color: var(--color-error);">${facturasPendientes}</div>
                    <div class="ficha-stat-label">Facturas pendientes</div>
                </div>
            ` : ''}
        </div>
    `;
}

// ==============================================
// CONTRATOS
// ==============================================
function renderizarContratos(contratos) {
    if (contratos.length === 0) {
        return `
            <div class="ficha-card">
                <h3 class="ficha-seccion-titulo">Contratos</h3>
                <p class="ficha-vacio">Este arrendador aún no tiene contratos cargados.</p>
            </div>
        `;
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const filas = contratos.map(c => {
        const fin = c.fecha_fin ? new Date(c.fecha_fin + 'T00:00:00') : null;
        const inicio = c.fecha_inicio ? new Date(c.fecha_inicio + 'T00:00:00') : null;
        let estado = 'Sin fecha';
        let badgeClase = 'badge-gris';
        if (fin) {
            const dias = Math.ceil((fin - hoy) / (1000 * 60 * 60 * 24));
            if (dias < 0) { estado = `Vencido hace ${Math.abs(dias)}d`; badgeClase = 'badge-rojo'; }
            else if (dias <= 90) { estado = `Vence en ${dias}d`; badgeClase = 'badge-amarillo'; }
            else { estado = 'Vigente'; badgeClase = 'badge-verde'; }
        }

        const blanco = parseFloat(c.qq_pactados_anual || 0);
        const negro = parseFloat(c.qq_negro_anual || 0);
        const totalAnual = blanco + negro;

        // Co-arrendadores en el mismo contrato (excluyendo a la persona actual)
        const otrosVinc = (c.contratos_arrendadores || [])
            .filter(v => v.arrendadores && v.arrendadores.id !== window.__ARRENDADOR_FICHA__?.id);
        const otros = otrosVinc.map(v => v.arrendadores.nombre).filter(Boolean);

        // Grupo: si hay nombre_grupo o varios arrendadores, lo mostramos
        const totalArrendadores = (c.contratos_arrendadores || []).length;
        const grupoStr = totalArrendadores > 1
            ? (c.nombre_grupo || `${totalArrendadores} arrendadores`)
            : '';

        const empresa = c.empresa || '—';
        const empresaBadge = empresa === 'Diego Quintana'
            ? '<span class="badge badge-dorado">Diego Quintana</span>'
            : empresa === 'El Ataco'
            ? '<span class="badge badge-azul">El Ataco</span>'
            : `<span class="badge badge-gris">${empresa}</span>`;

        return `
            <tr>
                <td>
                    ${grupoStr ? `<strong>${escaparHTML(grupoStr)}</strong><br>` : ''}
                    <span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">
                        ${c.campo ? '📍 ' + escaparHTML(c.campo) : '—'}
                    </span>
                    ${otros.length > 0 ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">Junto a: ${otros.map(escaparHTML).join(', ')}</span>` : ''}
                </td>
                <td>${empresaBadge}</td>
                <td>${inicio ? formatearFecha(c.fecha_inicio) : '—'} → ${fin ? formatearFecha(c.fecha_fin) : '—'}</td>
                <td>${c.hectareas ? Number(c.hectareas).toLocaleString('es-AR') + ' ha' : '—'}</td>
                <td>
                    <strong>${totalAnual > 0 ? formatearQQ(totalAnual) : '—'}</strong>
                    ${blanco > 0 && negro > 0
                        ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">B: ${formatearQQ(blanco)} · N: ${formatearQQ(negro)}</span>`
                        : negro > 0 ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">Negro</span>`
                        : blanco > 0 ? `<br><span style="font-size: var(--texto-xs); color: var(--color-texto-tenue);">Blanco</span>` : ''}
                </td>
                <td><span class="badge ${badgeClase}">${estado}</span></td>
                <td class="no-imprimir">
                    <a class="tabla-btn" href="/contratos.html?id=${c.id}" title="Ver en contratos">${ICONOS.ver}</a>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="ficha-card">
            <h3 class="ficha-seccion-titulo">Contratos (${contratos.length})</h3>
            <div class="tabla-contenedor" style="overflow-x: auto;">
                <table class="tabla">
                    <thead>
                        <tr>
                            <th>Grupo / Campo</th>
                            <th>Empresa</th>
                            <th>Vigencia</th>
                            <th>Hectáreas</th>
                            <th>QQ/año</th>
                            <th>Estado</th>
                            <th class="no-imprimir"></th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>
        </div>
    `;
}

// ==============================================
// LÍNEA DE TIEMPO — eventos cronológicos (contratos + movimientos)
// ==============================================

/**
 * Arma una lista de eventos cronológicos mezclando:
 *  - inicios de contrato
 *  - fines de contrato (pasados o futuros)
 *  - movimientos (ventas de qq)
 * Ordena del más reciente al más antiguo.
 */
function renderizarLineaTiempo(contratos, movimientos) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const eventos = [];

    // Eventos de contratos: inicio + fin
    contratos.forEach(c => {
        const empresa = c.empresa || '—';
        const has = c.hectareas ? `${Number(c.hectareas).toLocaleString('es-AR')} ha` : null;
        const blanco = parseFloat(c.qq_pactados_anual || 0);
        const negro = parseFloat(c.qq_negro_anual || 0);
        const totalAnual = blanco + negro;
        const qqTexto = totalAnual > 0 ? `${formatearQQ(totalAnual)}/año` : null;

        if (c.fecha_inicio) {
            const detalles = [has, qqTexto, `con ${empresa}`].filter(Boolean);
            eventos.push({
                fecha: c.fecha_inicio,
                tipo: 'contrato_inicio',
                titulo: 'Inicio de contrato',
                detalle: detalles.join(' · ')
            });
        }

        if (c.fecha_fin) {
            const fin = new Date(c.fecha_fin + 'T00:00:00');
            const dias = Math.ceil((fin - hoy) / (1000 * 60 * 60 * 24));
            let tipoFin, titulo;
            if (dias < 0) { tipoFin = 'contrato_vencido'; titulo = `Fin de contrato (vencido hace ${Math.abs(dias)}d)`; }
            else if (dias <= 90) { tipoFin = 'contrato_por_vencer'; titulo = `Fin de contrato (vence en ${dias}d)`; }
            else { tipoFin = 'contrato_fin'; titulo = 'Fin de contrato'; }

            eventos.push({
                fecha: c.fecha_fin,
                tipo: tipoFin,
                titulo: titulo,
                detalle: [has, `con ${empresa}`].filter(Boolean).join(' · ')
            });
        }
    });

    // Umbral para destacar movimientos grandes (ajustable)
    const UMBRAL_QQ_GRANDE = 200;

    // Eventos de movimientos
    movimientos.forEach(m => {
        const qqNum = parseFloat(m.qq || 0);
        const qqStr = `${formatearQQ(m.qq)}`;
        const precioStr = m.precio_quintal ? formatearMoneda(m.precio_quintal, m.moneda) + '/qq' : null;
        const tipoStr = m.tipo === 'negro' ? 'Negro' : 'Blanco';
        let facturaStr;
        if (m.estado_factura === 'factura_ok') facturaStr = 'Factura OK';
        else if (m.estado_factura === 'sin_factura') facturaStr = 'Sin factura';
        else if (m.estado_factura === 'reclamada') facturaStr = 'Factura reclamada';
        else facturaStr = null;

        const detalles = [qqStr, precioStr, tipoStr, facturaStr].filter(Boolean);
        const esGrande = qqNum >= UMBRAL_QQ_GRANDE;

        eventos.push({
            fecha: m.fecha,
            tipo: m.estado_factura === 'factura_ok' ? 'mov_ok' : (m.estado_factura ? 'mov_pendiente' : 'movimiento'),
            titulo: esGrande ? `Movimiento grande · ${qqStr}` : 'Movimiento',
            detalle: detalles.join(' · '),
            destacado: esGrande
        });
    });

    if (eventos.length === 0) {
        return `
            <div class="ficha-card">
                <h3 class="ficha-seccion-titulo">Línea de tiempo</h3>
                <p class="ficha-vacio">Sin eventos registrados todavía.</p>
            </div>
        `;
    }

    // Orden: más reciente arriba. Si no hay fecha, al final.
    eventos.sort((a, b) => {
        if (!a.fecha) return 1;
        if (!b.fecha) return -1;
        return b.fecha.localeCompare(a.fecha);
    });

    // Helper para renderizar un evento
    const renderEvento = (e) => {
        const claseDot = `linea-tiempo-dot linea-tiempo-dot-${e.tipo}`;
        const claseItem = e.destacado ? 'linea-tiempo-item linea-tiempo-destacado' : 'linea-tiempo-item';
        return `
            <li class="${claseItem}">
                <div class="linea-tiempo-fecha">${e.fecha ? formatearFecha(e.fecha) : '—'}</div>
                <div class="${claseDot}"></div>
                <div class="linea-tiempo-contenido">
                    <strong>${escaparHTML(e.titulo)}</strong>
                    ${e.detalle ? `<div class="linea-tiempo-detalle">${escaparHTML(e.detalle)}</div>` : ''}
                </div>
            </li>
        `;
    };

    // Paginación: mostrar primeros N eventos, resto oculto tras "Ver más"
    const LIMITE_INICIAL = 30;
    const visibles = eventos.slice(0, LIMITE_INICIAL);
    const ocultos = eventos.slice(LIMITE_INICIAL);

    const filasVisibles = visibles.map(renderEvento).join('');
    const filasOcultas = ocultos.map(renderEvento).join('');

    const botonVerMas = ocultos.length > 0 ? `
        <div class="linea-tiempo-ver-mas no-imprimir">
            <button class="btn-secundario btn-pequeno" id="btn-linea-tiempo-ver-mas"
                    onclick="mostrarTodosEventosTimeline()">
                Ver los ${ocultos.length} eventos anteriores
            </button>
        </div>
        <ul class="linea-tiempo linea-tiempo-ocultos" id="linea-tiempo-ocultos" style="display:none;">
            ${filasOcultas}
        </ul>
    ` : '';

    return `
        <div class="ficha-card">
            <h3 class="ficha-seccion-titulo">Línea de tiempo <span style="font-size: var(--texto-sm); color: var(--color-texto-tenue); font-weight: normal;">(${eventos.length} eventos)</span></h3>
            <ul class="linea-tiempo">${filasVisibles}</ul>
            ${botonVerMas}
        </div>
    `;
}

/**
 * Muestra los eventos ocultos de la línea de tiempo y esconde el botón.
 */
function mostrarTodosEventosTimeline() {
    const ocultos = document.getElementById('linea-tiempo-ocultos');
    const boton = document.getElementById('btn-linea-tiempo-ver-mas');
    if (ocultos) ocultos.style.display = '';
    if (boton) boton.parentElement.style.display = 'none';
}

// ==============================================
// TIMELINE DE CAMPAÑAS
// ==============================================
function renderizarTimeline(campanas, contratos, saldos, movimientos) {
    // Filtrar solo las campañas donde el arrendador tuvo actividad
    const idsConActividad = new Set();
    contratos.forEach(c => c.campana_id && idsConActividad.add(c.campana_id));
    saldos.forEach(s => s.campana_id && idsConActividad.add(s.campana_id));
    movimientos.forEach(m => m.campana_id && idsConActividad.add(m.campana_id));

    const campanasRelevantes = campanas.filter(c => idsConActividad.has(c.id));

    if (campanasRelevantes.length === 0) {
        return `
            <div class="ficha-card">
                <h3 class="ficha-seccion-titulo">Historial por campaña</h3>
                <p class="ficha-vacio">Sin actividad registrada por campaña todavía.</p>
            </div>
        `;
    }

    const cards = campanasRelevantes.map(camp => {
        const contratosDe = contratos.filter(c => c.campana_id === camp.id);
        // Ahora puede haber varios saldos por campaña (uno por contrato del arrendador en esa campaña)
        const saldosDe = saldos.filter(s => s.campana_id === camp.id);
        const movsDe = movimientos.filter(m => m.campana_id === camp.id);

        // QQ pactados en esta campaña = suma de contratos activos
        const pactadoBlanco = contratosDe.reduce((s, c) => s + parseFloat(c.qq_pactados_anual || 0), 0);
        const pactadoNegro = contratosDe.reduce((s, c) => s + parseFloat(c.qq_negro_anual || 0), 0);
        const pactadoTotal = pactadoBlanco + pactadoNegro;

        // QQ entregados = movimientos de esta campaña
        const entregadoTotal = movsDe.reduce((s, m) => s + parseFloat(m.qq || 0), 0);

        // QQ pendientes = saldos a nivel contrato (el saldo es del contrato, no individual)
        const pendienteBlanco = saldosDe.reduce((s, x) => s + parseFloat(x.qq_deuda_blanco || 0), 0);
        const pendienteNegro = saldosDe.reduce((s, x) => s + parseFloat(x.qq_deuda_negro || 0), 0);
        const pendienteTotal = pendienteBlanco + pendienteNegro;

        // Progreso % basado en pactado vs. entregado
        const porcentaje = pactadoTotal > 0
            ? Math.min(100, Math.round((entregadoTotal / pactadoTotal) * 100))
            : 0;

        // Badge estado
        let badge, claseBarra;
        if (camp.activa) {
            badge = '<span class="badge badge-verde">Activa</span>';
            claseBarra = 'barra-activa';
        } else if (pendienteTotal <= 0 && entregadoTotal > 0) {
            badge = '<span class="badge badge-verde">Cerrada ✓</span>';
            claseBarra = 'barra-completa';
        } else if (pendienteTotal > 0) {
            badge = '<span class="badge badge-amarillo">Con saldo</span>';
            claseBarra = 'barra-pendiente';
        } else {
            badge = '<span class="badge badge-gris">Histórica</span>';
            claseBarra = 'barra-historica';
        }

        return `
            <div class="ficha-campana">
                <div class="ficha-campana-header">
                    <div>
                        <strong>${camp.nombre || `Campaña ${camp.anio_inicio}`}</strong>
                        ${badge}
                    </div>
                    <div class="ficha-campana-meta">
                        ${contratosDe.length} contrato${contratosDe.length !== 1 ? 's' : ''} · ${movsDe.length} movimiento${movsDe.length !== 1 ? 's' : ''}
                    </div>
                </div>

                <div class="ficha-campana-cifras">
                    <div>
                        <span class="ficha-campana-label">Pactado</span>
                        <strong>${pactadoTotal > 0 ? formatearQQ(pactadoTotal) : '—'}</strong>
                        ${pactadoBlanco > 0 && pactadoNegro > 0
                            ? `<small>B: ${formatearQQ(pactadoBlanco)} · N: ${formatearQQ(pactadoNegro)}</small>` : ''}
                    </div>
                    <div>
                        <span class="ficha-campana-label">Entregado</span>
                        <strong>${formatearQQ(entregadoTotal)}</strong>
                    </div>
                    <div>
                        <span class="ficha-campana-label">Pendiente</span>
                        <strong style="color: ${pendienteTotal > 0 ? 'var(--color-dorado)' : 'var(--color-verde)'};">
                            ${formatearQQ(pendienteTotal)}
                        </strong>
                        ${pendienteBlanco > 0 && pendienteNegro > 0
                            ? `<small>B: ${formatearQQ(pendienteBlanco)} · N: ${formatearQQ(pendienteNegro)}</small>` : ''}
                    </div>
                </div>

                <div class="ficha-barra-progreso">
                    <div class="ficha-barra-relleno ${claseBarra}" style="width: ${porcentaje}%;"></div>
                </div>
                <div class="ficha-campana-porcentaje">${porcentaje}% entregado</div>
            </div>
        `;
    }).join('');

    return `
        <div class="ficha-card">
            <h3 class="ficha-seccion-titulo">Historial por campaña</h3>
            <div class="ficha-timeline">${cards}</div>
        </div>
    `;
}

// ==============================================
// MOVIMIENTOS RECIENTES
// ==============================================
function renderizarMovimientosRecientes(movimientos, arrendadorId) {
    if (movimientos.length === 0) {
        return `
            <div class="ficha-card">
                <h3 class="ficha-seccion-titulo">Movimientos recientes</h3>
                <p class="ficha-vacio">Todavía no hay movimientos registrados.</p>
            </div>
        `;
    }

    const ultimos = movimientos.slice(0, 10);
    const filas = ultimos.map(m => {
        const total = (m.qq && m.precio_quintal) ? m.qq * m.precio_quintal : null;
        const tipoBadge = m.tipo === 'negro'
            ? '<span class="badge badge-gris">Negro</span>'
            : '<span class="badge badge-verde">Blanco</span>';

        let facturaBadge = '';
        if (m.estado_factura === 'factura_ok') facturaBadge = '<span class="badge badge-verde">Factura OK</span>';
        else if (m.estado_factura) facturaBadge = `<span class="badge badge-amarillo">${m.estado_factura.replace(/_/g, ' ')}</span>`;

        return `
            <tr>
                <td>${formatearFecha(m.fecha)}</td>
                <td><strong>${formatearQQ(m.qq)}</strong></td>
                <td>${m.precio_quintal ? formatearMoneda(m.precio_quintal, m.moneda) : '—'}</td>
                <td>${total ? formatearMoneda(total, m.moneda) : '—'}</td>
                <td>${tipoBadge}</td>
                <td>${m.factura_numero || '—'}</td>
                <td>${facturaBadge}</td>
            </tr>
        `;
    }).join('');

    const hayMas = movimientos.length > 10;

    return `
        <div class="ficha-card">
            <h3 class="ficha-seccion-titulo">
                Movimientos recientes
                <span style="font-size: var(--texto-sm); color: var(--color-texto-tenue); font-weight: normal;">
                    (${ultimos.length} de ${movimientos.length})
                </span>
            </h3>
            <div class="tabla-contenedor" style="overflow-x: auto;">
                <table class="tabla">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>QQ</th>
                            <th>Precio/qq</th>
                            <th>Total</th>
                            <th>Tipo</th>
                            <th>Factura</th>
                            <th>Estado</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>
            ${hayMas ? `
                <div class="ficha-ver-todos no-imprimir">
                    <a class="btn-secundario" href="/movimientos.html?arrendador=${arrendadorId}">
                        Ver los ${movimientos.length} movimientos
                    </a>
                </div>
            ` : ''}
        </div>
    `;
}

// ==============================================
// NOTAS EDITABLES (inline)
// ==============================================

/**
 * Renderiza el bloque de notas. Modo lectura por defecto.
 * Si el usuario tiene permiso (admin/admin_total), muestra botón "Editar".
 */
function renderizarNotas(arrendador, usuario) {
    const puedeEditar = ['admin_total', 'admin'].includes(usuario?.rol);
    const notas = arrendador.notas || '';
    const vacio = !notas.trim();

    return `
        <div class="ficha-card" id="ficha-notas-card">
            <div class="ficha-notas-header">
                <h3 class="ficha-seccion-titulo" style="margin:0; border:none; padding:0;">Notas</h3>
                ${puedeEditar ? `
                    <button class="btn-secundario btn-pequeno no-imprimir"
                            id="btn-editar-notas"
                            onclick="editarNotasFicha()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        Editar
                    </button>
                ` : ''}
            </div>
            <div id="ficha-notas-contenido" class="ficha-notas-contenido ${vacio ? 'ficha-notas-vacio' : ''}">
                ${vacio
                    ? '<em>Sin notas. Hacé click en "Editar" para agregar observaciones.</em>'
                    : escaparHTML(notas).replace(/\n/g, '<br>')}
            </div>
        </div>
    `;
}

/**
 * Cambia el bloque de notas a modo edición (textarea + botones).
 */
function editarNotasFicha() {
    const arr = window.__ARRENDADOR_FICHA__;
    if (!arr) return;

    const cont = document.getElementById('ficha-notas-contenido');
    const btn = document.getElementById('btn-editar-notas');
    if (!cont) return;

    if (btn) btn.style.display = 'none';

    cont.classList.remove('ficha-notas-vacio');
    cont.innerHTML = `
        <textarea id="ficha-notas-textarea"
                  class="campo-textarea"
                  style="width:100%; min-height: 120px;"
                  placeholder="Ej: Prefiere cobrar en USD. El hijo maneja todo, llamar al 351-xxxx. Pidió que las facturas se manden por email.">${arr.notas || ''}</textarea>
        <div style="display:flex; gap: var(--espacio-sm); margin-top: var(--espacio-sm); justify-content: flex-end;">
            <button class="btn-secundario btn-pequeno" onclick="cancelarNotasFicha()">Cancelar</button>
            <button class="btn-primario btn-pequeno" onclick="guardarNotasFicha()">Guardar</button>
        </div>
    `;

    setTimeout(() => document.getElementById('ficha-notas-textarea')?.focus(), 50);
}

/**
 * Persiste las notas editadas y vuelve al modo lectura.
 */
async function guardarNotasFicha() {
    const arr = window.__ARRENDADOR_FICHA__;
    const textarea = document.getElementById('ficha-notas-textarea');
    if (!arr || !textarea) return;

    const nuevasNotas = textarea.value.trim();

    const resultado = await ejecutarConsulta(
        db.from('arrendadores').update({ notas: nuevasNotas || null }).eq('id', arr.id),
        'guardar notas'
    );

    if (resultado === undefined) return; // error ya fue mostrado

    // Actualizar memoria + UI
    arr.notas = nuevasNotas;
    mostrarNotasLectura();
    mostrarExito('Notas guardadas');
}

/**
 * Cancela la edición y vuelve al modo lectura con el valor previo.
 */
function cancelarNotasFicha() {
    mostrarNotasLectura();
}

/**
 * Renderiza el contenido en modo lectura desde el arrendador en memoria.
 */
function mostrarNotasLectura() {
    const arr = window.__ARRENDADOR_FICHA__;
    if (!arr) return;

    const cont = document.getElementById('ficha-notas-contenido');
    const btn = document.getElementById('btn-editar-notas');
    if (!cont) return;

    const notas = arr.notas || '';
    const vacio = !notas.trim();

    cont.classList.toggle('ficha-notas-vacio', vacio);
    cont.innerHTML = vacio
        ? '<em>Sin notas. Hacé click en "Editar" para agregar observaciones.</em>'
        : escaparHTML(notas).replace(/\n/g, '<br>');

    if (btn) btn.style.display = '';
}

/**
 * Escapa HTML para evitar inyecciones al renderizar notas del usuario.
 */
function escaparHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==============================================
// ACCIONES
// ==============================================
function editarArrendadorDesdeFicha(arrendador) {
    // Usa la misma función del módulo arrendadores.js
    if (typeof abrirModalArrendador === 'function') {
        arrendadorEditandoId = arrendador.id;
        abrirModalArrendador('Editar Arrendador', arrendador);
    } else {
        window.location.href = `/arrendadores.html?editar=${arrendador.id}`;
    }
}
