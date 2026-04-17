// ==============================================
// mapa.js — Módulo de mapa de campos y silobolsas
// Usa Leaflet.js con tres capas separadas:
//   1. Campos arrendados (fracciones_catastrales)
//   2. Lotes de producción
//   3. Silobolsas
// ==============================================

// Instancia global del mapa Leaflet
let mapaLeaflet = null;

// Grupos de capas (L.layerGroup)
let capaCampos = null;
let capaLotes = null;
let capaSilobolsas = null;

// Colores por estado de lote
const COLORES_LOTE = {
    libre:          '#6b6760',
    en_preparacion: '#c9a84c',
    sembrado:       '#4a9e6e',
    cosechado:      '#8B6914',
    barbecho:       '#5a5a3a'
};

// Colores por estado de silobolsa
const COLORES_SILOBOLSA = {
    activa:     '#4a9e6e',
    en_uso:     '#c9a84c',
    vacia:      '#6b6760',
    descartada: '#c94c4c'
};

// Etiquetas legibles para estados
const ETIQUETAS_ESTADO_LOTE = {
    libre:          'Libre',
    en_preparacion: 'En preparación',
    sembrado:       'Sembrado',
    cosechado:      'Cosechado',
    barbecho:       'Barbecho'
};

const ETIQUETAS_ESTADO_SILO = {
    activa:     'Activa',
    en_uso:     'En uso',
    vacia:      'Vacía',
    descartada: 'Descartada'
};

// ==============================================
// Punto de entrada principal
// Se llama desde mapa.html después de crearLayout
// ==============================================

async function iniciarMapa() {
    // El contenedor del mapa debe tener altura definida ANTES de instanciar Leaflet.
    // Esto se garantiza porque mapa-contenedor tiene height en CSS, y crearLayout
    // ya insertó el HTML en el DOM antes de llamar a esta función.
    const contenedor = document.getElementById('mapa-leaflet');
    if (!contenedor) {
        console.error('mapa.js: No se encontró el elemento #mapa-leaflet en el DOM.');
        return;
    }

    // Crear el mapa centrado en Córdoba, Argentina
    mapaLeaflet = L.map('mapa-leaflet', {
        center: [-31.4, -64.2],
        zoom: 9,
        zoomControl: true
    });

    // Capa base de OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(mapaLeaflet);

    // Inicializar los grupos de capas vacíos
    capaCampos     = L.layerGroup().addTo(mapaLeaflet);
    capaLotes      = L.layerGroup().addTo(mapaLeaflet);
    capaSilobolsas = L.layerGroup().addTo(mapaLeaflet);

    // Cargar datos de Supabase y poblar las capas
    mostrarCargando(true);
    try {
        const [campos, lotes, silobolsas] = await Promise.all([
            cargarFracciones(),
            cargarLotes(),
            cargarSilobolsas()
        ]);

        poblarCapaCampos(campos);
        poblarCapaLotes(lotes);
        poblarCapaSilobolsas(silobolsas);

        actualizarEstadisticas(campos, lotes, silobolsas);
        verificarSinDatos(campos, lotes, silobolsas);

        // Si hay marcadores, ajustar el zoom para mostrarlos todos
        ajustarVistaAlContenido(campos, lotes, silobolsas);

    } catch (error) {
        console.error('mapa.js: Error al cargar datos del mapa:', error);
        mostrarToast('Error al cargar datos del mapa. Revisá la consola.', 'error');
    } finally {
        mostrarCargando(false);
    }
}

// ==============================================
// Consultas a Supabase
// ==============================================

/**
 * Carga las fracciones catastrales con datos de contrato y arrendador.
 * Solo trae las que tienen lat/lng cargados.
 */
async function cargarFracciones() {
    const db = window.supabase;
    const { data, error } = await db
        .from('fracciones_catastrales')
        .select(`
            id,
            denominacion_catastral,
            hectareas,
            lat,
            lng,
            contrato_id,
            contratos (
                id,
                estado,
                arrendadores (
                    nombre
                )
            )
        `)
        .not('lat', 'is', null)
        .not('lng', 'is', null);

    if (error) {
        console.error('mapa.js: Error al cargar fracciones_catastrales:', error);
        return [];
    }
    return data || [];
}

/**
 * Carga los lotes con coordenadas GPS cargadas.
 */
async function cargarLotes() {
    const db = window.supabase;
    const { data, error } = await db
        .from('lotes')
        .select('id, nombre, hectareas, estado, campo, lat, lng')
        .not('lat', 'is', null)
        .not('lng', 'is', null);

    if (error) {
        console.error('mapa.js: Error al cargar lotes:', error);
        return [];
    }
    return data || [];
}

/**
 * Carga las silobolsas con datos del lote asociado.
 */
async function cargarSilobolsas() {
    const db = window.supabase;
    const { data, error } = await db
        .from('silobolsas')
        .select(`
            id,
            grano,
            qq_actuales,
            qq_iniciales,
            estado,
            humedad,
            lat,
            lng,
            lote_id,
            lotes (
                nombre
            )
        `)
        .not('lat', 'is', null)
        .not('lng', 'is', null);

    if (error) {
        console.error('mapa.js: Error al cargar silobolsas:', error);
        return [];
    }
    return data || [];
}

// ==============================================
// Poblar capas del mapa
// ==============================================

/**
 * Agrega marcadores de campos arrendados al grupo capaCampos.
 * Usa L.circleMarker color dorado.
 */
function poblarCapaCampos(fracciones) {
    capaCampos.clearLayers();

    for (const fraccion of fracciones) {
        const lat = parseFloat(fraccion.lat);
        const lng = parseFloat(fraccion.lng);
        if (isNaN(lat) || isNaN(lng)) continue;

        const nombreArrendador = fraccion.contratos?.arrendadores?.nombre || 'Sin arrendador';
        const estadoContrato   = fraccion.contratos?.estado || '—';
        const hectareas        = fraccion.hectareas ? `${fraccion.hectareas} ha` : '—';
        const denominacion     = fraccion.denominacion_catastral || '—';

        const marcador = L.circleMarker([lat, lng], {
            radius:      10,
            fillColor:   '#c9a84c',
            color:       '#a88830',
            weight:      2,
            opacity:     1,
            fillOpacity: 0.85
        });

        // Tooltip al pasar el cursor
        marcador.bindTooltip(nombreArrendador, {
            permanent:  false,
            direction:  'top',
            className:  'leaflet-tooltip-oscuro',
            offset:     [0, -8]
        });

        // Popup al hacer click
        marcador.bindPopup(`
            <div class="mapa-popup-titulo">${nombreArrendador}</div>
            <div class="mapa-popup-fila">
                <span class="mapa-popup-fila-label">Denominación</span>
                <span class="mapa-popup-fila-valor">${denominacion}</span>
            </div>
            <div class="mapa-popup-fila">
                <span class="mapa-popup-fila-label">Hectáreas</span>
                <span class="mapa-popup-fila-valor">${hectareas}</span>
            </div>
            <div class="mapa-popup-fila">
                <span class="mapa-popup-fila-label">Estado contrato</span>
                <span class="mapa-popup-fila-valor">${estadoContrato}</span>
            </div>
        `, { maxWidth: 280 });

        capaCampos.addLayer(marcador);
    }
}

/**
 * Agrega marcadores de lotes al grupo capaLotes.
 * Color según estado del lote.
 */
function poblarCapaLotes(lotes) {
    capaLotes.clearLayers();

    for (const lote of lotes) {
        const lat = parseFloat(lote.lat);
        const lng = parseFloat(lote.lng);
        if (isNaN(lat) || isNaN(lng)) continue;

        const color     = COLORES_LOTE[lote.estado] || '#6b6760';
        const nombre    = lote.nombre || 'Sin nombre';
        const estado    = ETIQUETAS_ESTADO_LOTE[lote.estado] || lote.estado || '—';
        const hectareas = lote.hectareas ? `${lote.hectareas} ha` : '—';
        const campo     = lote.campo || '—';

        const marcador = L.circleMarker([lat, lng], {
            radius:      9,
            fillColor:   color,
            color:       ajustarBrillo(color, -20),
            weight:      2,
            opacity:     1,
            fillOpacity: 0.85
        });

        marcador.bindTooltip(nombre, {
            permanent:  false,
            direction:  'top',
            className:  'leaflet-tooltip-oscuro',
            offset:     [0, -8]
        });

        marcador.bindPopup(`
            <div class="mapa-popup-titulo">${nombre}</div>
            <div class="mapa-popup-fila">
                <span class="mapa-popup-fila-label">Estado</span>
                <span class="mapa-popup-fila-valor">${estado}</span>
            </div>
            <div class="mapa-popup-fila">
                <span class="mapa-popup-fila-label">Hectáreas</span>
                <span class="mapa-popup-fila-valor">${hectareas}</span>
            </div>
            <div class="mapa-popup-fila">
                <span class="mapa-popup-fila-label">Campo</span>
                <span class="mapa-popup-fila-valor">${campo}</span>
            </div>
        `, { maxWidth: 260 });

        capaLotes.addLayer(marcador);
    }
}

/**
 * Agrega marcadores de silobolsas al grupo capaSilobolsas.
 * Usa L.divIcon con círculo SVG coloreado por estado.
 */
function poblarCapaSilobolsas(silobolsas) {
    capaSilobolsas.clearLayers();

    for (const silo of silobolsas) {
        const lat = parseFloat(silo.lat);
        const lng = parseFloat(silo.lng);
        if (isNaN(lat) || isNaN(lng)) continue;

        const color      = COLORES_SILOBOLSA[silo.estado] || '#6b6760';
        const estado     = ETIQUETAS_ESTADO_SILO[silo.estado] || silo.estado || '—';
        const grano      = silo.grano ? capitalizarPrimera(silo.grano) : '—';
        const qqActuales = silo.qq_actuales != null ? formatearQQ(silo.qq_actuales) : '—';
        const qqIni      = silo.qq_iniciales != null ? formatearQQ(silo.qq_iniciales) : '—';
        const humedad    = silo.humedad != null ? `${silo.humedad}%` : '—';
        const nombreLote = silo.lotes?.nombre || '—';

        // Icono circular SVG con un punto interno para indicar "silobolsa"
        const iconSVG = `
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
                <circle cx="14" cy="14" r="12" fill="${color}" fill-opacity="0.9" stroke="${ajustarBrillo(color, -20)}" stroke-width="2"/>
                <ellipse cx="14" cy="15" rx="7" ry="4" fill="rgba(0,0,0,0.25)"/>
                <ellipse cx="14" cy="13" rx="7" ry="4" fill="rgba(255,255,255,0.15)"/>
            </svg>
        `;

        const divIcon = L.divIcon({
            html:        `<div class="mapa-silobolsa-icon">${iconSVG}</div>`,
            iconSize:    [28, 28],
            iconAnchor:  [14, 14],
            popupAnchor: [0, -16],
            className:   '' // resetear clases por defecto de Leaflet
        });

        const marcador = L.marker([lat, lng], { icon: divIcon });

        marcador.bindTooltip(`Silobolsa — ${grano}`, {
            permanent:  false,
            direction:  'top',
            className:  'leaflet-tooltip-oscuro',
            offset:     [0, -8]
        });

        marcador.bindPopup(`
            <div class="mapa-popup-titulo">Silobolsa — ${grano}</div>
            <div class="mapa-popup-fila">
                <span class="mapa-popup-fila-label">Estado</span>
                <span class="mapa-popup-fila-valor">${estado}</span>
            </div>
            <div class="mapa-popup-fila">
                <span class="mapa-popup-fila-label">QQ actuales</span>
                <span class="mapa-popup-fila-valor">${qqActuales}</span>
            </div>
            <div class="mapa-popup-fila">
                <span class="mapa-popup-fila-label">QQ iniciales</span>
                <span class="mapa-popup-fila-valor">${qqIni}</span>
            </div>
            <div class="mapa-popup-fila">
                <span class="mapa-popup-fila-label">Humedad</span>
                <span class="mapa-popup-fila-valor">${humedad}</span>
            </div>
            <div class="mapa-popup-fila">
                <span class="mapa-popup-fila-label">Lote</span>
                <span class="mapa-popup-fila-valor">${nombreLote}</span>
            </div>
        `, { maxWidth: 260 });

        capaSilobolsas.addLayer(marcador);
    }
}

// ==============================================
// Panel de estadísticas
// ==============================================

/**
 * Actualiza los contadores en el panel de stats (top-right).
 */
function actualizarEstadisticas(campos, lotes, silobolsas) {
    // Total de fracciones con coordenadas (ya filtradas) vs total en BD
    contarTotalFracciones().then(total => {
        const el = document.getElementById('stat-fracciones');
        if (el) {
            el.textContent = `${campos.length} / ${total}`;
            if (campos.length === 0) el.classList.add('sin-datos');
        }
    });

    // Total de lotes con coordenadas vs total en BD
    contarTotalLotes().then(total => {
        const el = document.getElementById('stat-lotes');
        if (el) {
            el.textContent = `${lotes.length} / ${total}`;
            if (lotes.length === 0) el.classList.add('sin-datos');
        }
    });

    // Silobolsas activas y QQ totales almacenados
    const silosActivas = silobolsas.filter(s => s.estado === 'activa' || s.estado === 'en_uso');
    const qqTotales    = silobolsas.reduce((sum, s) => sum + (s.qq_actuales || 0), 0);

    const elSilos = document.getElementById('stat-silos-activas');
    const elQQ    = document.getElementById('stat-qq-total');
    if (elSilos) {
        elSilos.textContent = silosActivas.length;
        if (silosActivas.length === 0) elSilos.classList.add('sin-datos');
    }
    if (elQQ) {
        elQQ.textContent = qqTotales > 0 ? formatearQQ(qqTotales) + ' qq' : '—';
        if (qqTotales === 0) elQQ.classList.add('sin-datos');
    }
}

async function contarTotalFracciones() {
    const db = window.supabase;
    const { count } = await db
        .from('fracciones_catastrales')
        .select('id', { count: 'exact', head: true });
    return count || 0;
}

async function contarTotalLotes() {
    const db = window.supabase;
    const { count } = await db
        .from('lotes')
        .select('id', { count: 'exact', head: true });
    return count || 0;
}

// ==============================================
// Verificar si no hay ningún marcador
// ==============================================

/**
 * Si ninguna de las tres capas tiene marcadores, muestra el mensaje vacío.
 */
function verificarSinDatos(campos, lotes, silobolsas) {
    const totalMarcadores = campos.length + lotes.length + silobolsas.length;
    const msgEl = document.getElementById('mapa-sin-datos');
    if (msgEl) {
        msgEl.style.display = totalMarcadores === 0 ? 'block' : 'none';
    }
}

// ==============================================
// Ajustar vista al contenido
// ==============================================

/**
 * Si hay marcadores, hace fit bounds para mostrarlos todos.
 * Si no hay ninguno, mantiene el centro en Córdoba.
 */
function ajustarVistaAlContenido(campos, lotes, silobolsas) {
    const puntos = [];

    for (const f of campos) {
        const lat = parseFloat(f.lat);
        const lng = parseFloat(f.lng);
        if (!isNaN(lat) && !isNaN(lng)) puntos.push([lat, lng]);
    }
    for (const l of lotes) {
        const lat = parseFloat(l.lat);
        const lng = parseFloat(l.lng);
        if (!isNaN(lat) && !isNaN(lng)) puntos.push([lat, lng]);
    }
    for (const s of silobolsas) {
        const lat = parseFloat(s.lat);
        const lng = parseFloat(s.lng);
        if (!isNaN(lat) && !isNaN(lng)) puntos.push([lat, lng]);
    }

    if (puntos.length === 0) return;

    if (puntos.length === 1) {
        mapaLeaflet.setView(puntos[0], 13);
    } else {
        mapaLeaflet.fitBounds(puntos, { padding: [40, 40] });
    }
}

// ==============================================
// Toggles de capas desde los checkboxes del panel
// ==============================================

/**
 * Muestra u oculta la capa de campos arrendados.
 * Llamada desde el checkbox en el HTML.
 */
function toggleCapaCampos(visible) {
    if (!mapaLeaflet || !capaCampos) return;
    if (visible) {
        mapaLeaflet.addLayer(capaCampos);
    } else {
        mapaLeaflet.removeLayer(capaCampos);
    }
}

/**
 * Muestra u oculta la capa de lotes.
 */
function toggleCapaLotes(visible) {
    if (!mapaLeaflet || !capaLotes) return;
    if (visible) {
        mapaLeaflet.addLayer(capaLotes);
    } else {
        mapaLeaflet.removeLayer(capaLotes);
    }
}

/**
 * Muestra u oculta la capa de silobolsas.
 */
function toggleCapaSilobolsas(visible) {
    if (!mapaLeaflet || !capaSilobolsas) return;
    if (visible) {
        mapaLeaflet.addLayer(capaSilobolsas);
    } else {
        mapaLeaflet.removeLayer(capaSilobolsas);
    }
}

// ==============================================
// Utilidades
// ==============================================

/**
 * Formatea un número de quintales con separador de miles y sin decimales.
 * Ej: 1234.5 → "1.234"
 */
function formatearQQ(valor) {
    return Math.round(valor).toLocaleString('es-AR');
}

/**
 * Capitaliza la primera letra de un string.
 */
function capitalizarPrimera(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Ajusta el brillo de un color hexadecimal sumando/restando un offset.
 * Se usa para el borde de los marcadores (tono más oscuro que el relleno).
 * @param {string} hex - Color en formato #RRGGBB
 * @param {number} offset - Valor a sumar a cada canal RGB (negativo = oscurecer)
 */
function ajustarBrillo(hex, offset) {
    try {
        const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) + offset));
        const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) + offset));
        const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) + offset));
        return `rgb(${r}, ${g}, ${b})`;
    } catch {
        return hex;
    }
}

/**
 * Muestra/oculta un overlay de carga simple sobre el mapa.
 */
function mostrarCargando(activo) {
    const el = document.getElementById('mapa-cargando');
    if (el) el.style.display = activo ? 'flex' : 'none';
}
