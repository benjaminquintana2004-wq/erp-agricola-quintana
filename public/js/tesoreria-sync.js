// ==============================================
// tesoreria-sync.js — Sincronización con Google Sheets
// Depende de: tesoreria.js (accede a movimientosTesoreria, cuentas, etc.)
// ==============================================

// ── Estado ─────────────────────────────────────────────────
const SYNC_CONFIG_KEY = 'tesoreria_sync_config';
const SYNC_LOG_KEY    = 'tesoreria_sync_log';
const SYNC_LOG_MAX    = 20; // máximo de entradas en el log

// ── Config ──────────────────────────────────────────────────

function cargarConfigSync() {
    try {
        return JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY) || '{}');
    } catch { return {}; }
}

function guardarConfigSync(config) {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
}

function obtenerUrlSync() {
    return cargarConfigSync().url || '';
}

// ── Log de sincronizaciones ──────────────────────────────────

function cargarLogSync() {
    try {
        return JSON.parse(localStorage.getItem(SYNC_LOG_KEY) || '[]');
    } catch { return []; }
}

function agregarEntradaLog(entrada) {
    const log = cargarLogSync();
    log.unshift({ ...entrada, fecha: new Date().toISOString() });
    if (log.length > SYNC_LOG_MAX) log.splice(SYNC_LOG_MAX);
    localStorage.setItem(SYNC_LOG_KEY, JSON.stringify(log));
}

// ── Renderizado de la tab ────────────────────────────────────

function renderizarSync() {
    const config = cargarConfigSync();
    const log    = cargarLogSync();

    const seccion = document.getElementById('seccion-sync');
    if (!seccion) return;

    seccion.innerHTML = `
        <!-- Configuración -->
        <div style="max-width:600px;margin-bottom:var(--espacio-xl);">
            <h3 style="font-size:var(--texto-lg);color:var(--color-texto);margin-bottom:var(--espacio-sm);">Configuración</h3>
            <p style="font-size:var(--texto-sm);color:var(--color-texto-secundario);margin-bottom:var(--espacio-lg);">
                Ingresá la URL del Google Apps Script asociado al Sheet de tesorería de Vale.
                <a href="#" onclick="mostrarInstrucciones(event)" style="color:var(--color-dorado);">¿Cómo obtenerla?</a>
            </p>
            <div class="campo-grupo">
                <label class="campo-label">URL del Apps Script</label>
                <input type="url" id="sync-url" class="campo-input"
                    value="${config.url || ''}"
                    placeholder="https://script.google.com/macros/s/AK.../exec"
                    style="font-family:var(--fuente-mono);font-size:var(--texto-sm);">
            </div>
            <div style="display:flex;gap:var(--espacio-md);margin-top:var(--espacio-md);flex-wrap:wrap;">
                <button class="btn-primario" onclick="guardarYProbarConexion()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    Guardar y probar conexión
                </button>
            </div>
            <div id="sync-estado-conexion" style="margin-top:var(--espacio-md);"></div>
        </div>

        <hr style="border-color:var(--color-borde);margin-bottom:var(--espacio-xl);">

        <!-- Acciones de sync -->
        <div style="margin-bottom:var(--espacio-xl);">
            <h3 style="font-size:var(--texto-lg);color:var(--color-texto);margin-bottom:var(--espacio-sm);">Sincronizar</h3>
            <p style="font-size:var(--texto-sm);color:var(--color-texto-secundario);margin-bottom:var(--espacio-lg);">
                <strong style="color:var(--color-texto);">Exportar</strong> envía los movimientos del ERP al Sheet de Google (el ERP manda la versión más nueva de cada registro).<br>
                <strong style="color:var(--color-texto);">Importar</strong> lee el Sheet y trae al ERP las filas nuevas o modificadas directamente en el Sheet.
            </p>
            <div style="display:flex;gap:var(--espacio-md);flex-wrap:wrap;">
                <button class="btn-primario" onclick="exportarASheets()" id="btn-exportar" ${!config.url ? 'disabled' : ''}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                    Exportar → Google Sheets
                </button>
                <button class="btn-secundario" onclick="importarDesdeSheets()" id="btn-importar" ${!config.url ? 'disabled' : ''}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="16 7 12 3 8 7"/><line x1="12" y1="21" x2="12" y2="3"/></svg>
                    Importar ← Google Sheets
                </button>
            </div>
            <div id="sync-progreso" style="margin-top:var(--espacio-lg);"></div>
        </div>

        <hr style="border-color:var(--color-borde);margin-bottom:var(--espacio-xl);">

        <!-- Log de sincronizaciones -->
        <div>
            <h3 style="font-size:var(--texto-lg);color:var(--color-texto);margin-bottom:var(--espacio-md);">Historial de sincronizaciones</h3>
            ${log.length === 0
                ? `<p style="font-size:var(--texto-sm);color:var(--color-texto-tenue);">Aún no se realizó ninguna sincronización.</p>`
                : `<div class="tabla-contenedor">
                    <table class="tabla">
                        <thead><tr>
                            <th>Fecha y hora</th><th>Tipo</th><th>Resultado</th><th>Detalle</th>
                        </tr></thead>
                        <tbody>
                        ${log.map(e => `
                            <tr>
                                <td style="white-space:nowrap;">${formatearFechaHora(e.fecha)}</td>
                                <td><span class="badge ${e.tipo === 'exportar' ? 'badge-transferencia' : 'badge-cheque'}">${e.tipo === 'exportar' ? '↓ Exportar' : '↑ Importar'}</span></td>
                                <td><span class="badge ${e.ok ? 'badge-cobrado' : 'badge-anulado'}">${e.ok ? 'OK' : 'Error'}</span></td>
                                <td style="font-size:var(--texto-sm);color:var(--color-texto-secundario);">${e.detalle || ''}</td>
                            </tr>
                        `).join('')}
                        </tbody>
                    </table>
                   </div>`
            }
        </div>
    `;
}

function mostrarInstrucciones(e) {
    e.preventDefault();
    abrirModal('Cómo obtener la URL del Apps Script', `
        <ol style="font-size:var(--texto-sm);color:var(--color-texto-secundario);line-height:2;padding-left:var(--espacio-lg);">
            <li>Abrí el Google Sheet que vas a usar para tesorería.</li>
            <li>Hacé click en <strong style="color:var(--color-texto);">Extensiones → Apps Script</strong>.</li>
            <li>Borrá el contenido del editor y pegá el código del archivo <code style="color:var(--color-dorado);">apps_script/tesoreria.js</code> del proyecto.</li>
            <li>Guardá con <strong style="color:var(--color-texto);">Ctrl + S</strong>.</li>
            <li>Hacé click en <strong style="color:var(--color-texto);">Implementar → Nueva implementación</strong>.</li>
            <li>Tipo: <strong style="color:var(--color-texto);">Aplicación web</strong>.</li>
            <li>Ejecutar como: <strong style="color:var(--color-texto);">Yo</strong>.</li>
            <li>Quién tiene acceso: <strong style="color:var(--color-texto);">Cualquier usuario</strong>.</li>
            <li>Hacé click en <strong style="color:var(--color-texto);">Implementar</strong> y autorizá los permisos.</li>
            <li>Copiá la URL que aparece y pegála acá arriba.</li>
        </ol>
        <p style="font-size:var(--texto-sm);color:var(--color-texto-tenue);margin-top:var(--espacio-md);">
            ⚠️ Cada vez que modifiques el código del script tenés que hacer una <strong>nueva implementación</strong> para que los cambios tomen efecto.
        </p>
    `, `<button class="btn-primario" onclick="cerrarModal()">Entendido</button>`);
}

// ── Conexión ────────────────────────────────────────────────

async function guardarYProbarConexion() {
    const url = document.getElementById('sync-url')?.value.trim();
    if (!url) { mostrarError('Ingresá la URL del Apps Script.'); return; }

    const estadoEl = document.getElementById('sync-estado-conexion');
    estadoEl.innerHTML = `<div style="display:flex;align-items:center;gap:var(--espacio-sm);color:var(--color-texto-secundario);font-size:var(--texto-sm);"><div class="spinner" style="width:16px;height:16px;"></div> Probando conexión...</div>`;

    try {
        const res = await llamarScript(url, 'ping');
        if (res.ok) {
            guardarConfigSync({ url });
            estadoEl.innerHTML = `
                <div style="display:flex;align-items:center;gap:var(--espacio-sm);color:var(--color-verde);font-size:var(--texto-sm);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="20 6 9 17 4 12"/></svg>
                    Conexión exitosa — ${new Date().toLocaleTimeString('es-AR')}
                </div>`;
            // Habilitar botones
            document.getElementById('btn-exportar')?.removeAttribute('disabled');
            document.getElementById('btn-importar')?.removeAttribute('disabled');
            mostrarExito('URL guardada correctamente');
        } else {
            throw new Error(res.error || 'El script respondió con error.');
        }
    } catch (err) {
        estadoEl.innerHTML = `
            <div style="display:flex;align-items:center;gap:var(--espacio-sm);color:var(--color-error);font-size:var(--texto-sm);">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                Error: ${err.message}
            </div>`;
    }
}

// ── Exportar ERP → Sheets ────────────────────────────────────

async function exportarASheets() {
    const url = obtenerUrlSync();
    if (!url) { mostrarError('Configurá primero la URL del Apps Script.'); return; }

    const progreso = document.getElementById('sync-progreso');
    progreso.innerHTML = estadoCargando('Preparando datos para exportar...');

    try {
        // Preparar filas: solo movimientos de la empresa activa
        const movs = movimientosTesoreria.filter(m => m.empresa_id === empresaActivaId);

        if (movs.length === 0) {
            progreso.innerHTML = alertaInfo('No hay movimientos para exportar en esta empresa.');
            return;
        }

        progreso.innerHTML = estadoCargando(`Enviando ${movs.length} movimientos a Google Sheets...`);

        // Mapear a formato del sheet
        const rows = movs.map(m => ({
            id:             m.id,
            empresa:        m.empresas?.nombre       || empresas.find(e => e.id === m.empresa_id)?.nombre || '',
            cuenta:         m.cuentas_bancarias?.alias || cuentas.find(c => c.id === m.cuenta_bancaria_id)?.alias || '',
            tipo:           m.tipo,
            numero_cheque:  m.numero_cheque || '',
            fecha_emision:  m.fecha_emision || '',
            fecha_cobro:    m.fecha_cobro   || '',
            fecha_balde:    m.fecha_balde   || '',
            beneficiario:   m.beneficiarios?.nombre  || '',
            categoria:      m.categorias_gasto?.nombre || '',
            monto:          m.monto,
            estado:         m.estado,
            notas:          m.notas || '',
            actualizado_en: m.actualizado_en || m.cargado_en || ''
        }));

        const res = await llamarScript(url, 'exportar', { rows });

        if (!res.ok) throw new Error(res.error || 'Error en el script.');

        const d = res.data;
        const detalle = `${d.total} enviados — ${d.agregados} nuevos, ${d.actualizados} actualizados, ${d.conservados} conservados del sheet`;

        agregarEntradaLog({ tipo: 'exportar', ok: true, detalle });
        progreso.innerHTML = alertaExito(`✓ Exportación completada. ${detalle}`);
        renderizarLogSync();

    } catch (err) {
        agregarEntradaLog({ tipo: 'exportar', ok: false, detalle: err.message });
        progreso.innerHTML = alertaError(`Error al exportar: ${err.message}`);
        renderizarLogSync();
    }
}

// ── Importar Sheets → ERP ────────────────────────────────────

async function importarDesdeSheets() {
    const url = obtenerUrlSync();
    if (!url) { mostrarError('Configurá primero la URL del Apps Script.'); return; }

    const progreso = document.getElementById('sync-progreso');
    progreso.innerHTML = estadoCargando('Leyendo Google Sheets...');

    try {
        const res = await llamarScript(url, 'importar');
        if (!res.ok) throw new Error(res.error || 'Error en el script.');

        const { nuevas, modificadas } = res.data;

        progreso.innerHTML = estadoCargando(`Procesando ${nuevas.length} nuevas y ${modificadas.length} existentes...`);

        let creadosOk   = 0;
        let actualizadosOk = 0;
        let conflictos  = 0;
        const feedbackIds = []; // para escribir UUIDs en el sheet

        // ── Filas nuevas (sin id en el sheet) ─────────────────
        for (const fila of nuevas) {
            if (!fila.tipo || !fila.monto) continue; // fila incompleta

            // Resolver empresa y cuenta
            const empresa = empresas.find(e =>
                e.nombre?.toLowerCase() === (fila.empresa || '').toLowerCase()
            );
            const cuenta = cuentas.find(c =>
                c.alias?.toLowerCase() === (fila.cuenta || '').toLowerCase() &&
                (!empresa || c.empresa_id === empresa.id)
            );

            if (!empresa || !cuenta) continue; // no se puede mapear

            const datos = {
                empresa_id:         empresa.id,
                cuenta_bancaria_id: cuenta.id,
                tipo:               fila.tipo || 'cheque',
                numero_cheque:      fila.numero_cheque || null,
                fecha_emision:      fila.fecha_emision || null,
                fecha_cobro:        fila.fecha_cobro   || null,
                fecha_balde:        fila.fecha_cobro ? calcularFechaBaldeJS(fila.fecha_cobro) : null,
                monto:              parseFloat(fila.monto) || 0,
                estado:             fila.estado || 'pendiente',
                notas:              fila.notas  || null,
                origen:             'manual'
            };

            const resultado = await ejecutarConsulta(
                db.from('movimientos_tesoreria').insert(datos).select(),
                'importar desde Sheets'
            );

            if (resultado?.[0]) {
                creadosOk++;
                movimientosTesoreria.push(resultado[0]);
                feedbackIds.push({ fila_sheet: fila._fila_sheet, id: resultado[0].id });
            }
        }

        // ── Filas existentes: actualizar si el sheet es más nuevo ─
        for (const fila of modificadas) {
            const enERP = movimientosTesoreria.find(m => m.id === fila.id);
            if (!enERP) continue;

            const tsSheet = fila.actualizado_en ? new Date(fila.actualizado_en).getTime() : 0;
            const tsERP   = enERP.actualizado_en ? new Date(enERP.actualizado_en).getTime() :
                            enERP.cargado_en ? new Date(enERP.cargado_en).getTime() : 0;

            if (tsSheet > tsERP) {
                // Sheet es más nuevo → actualizar ERP
                const datosActualizar = {};
                if (fila.estado && fila.estado !== enERP.estado) datosActualizar.estado = fila.estado;
                if (fila.notas  !== enERP.notas)                  datosActualizar.notas  = fila.notas;
                if (fila.numero_cheque !== enERP.numero_cheque)   datosActualizar.numero_cheque = fila.numero_cheque;

                if (Object.keys(datosActualizar).length > 0) {
                    const res2 = await ejecutarConsulta(
                        db.from('movimientos_tesoreria').update(datosActualizar).eq('id', fila.id),
                        'actualizar desde Sheets'
                    );
                    if (res2 !== undefined) {
                        Object.assign(enERP, datosActualizar);
                        actualizadosOk++;
                    }
                }
            } else if (tsERP > tsSheet) {
                conflictos++; // ERP es más nuevo, el próximo export va a pisar el sheet
            }
        }

        // Escribir UUIDs generados de vuelta en el sheet
        if (feedbackIds.length > 0) {
            await llamarScript(url, 'escribirIds', { updates: feedbackIds });
        }

        const detalle = `${creadosOk} creados, ${actualizadosOk} actualizados, ${conflictos} con conflicto (ganó ERP)`;
        agregarEntradaLog({ tipo: 'importar', ok: true, detalle });

        progreso.innerHTML = alertaExito(`✓ Importación completada. ${detalle}${conflictos > 0 ? ' — Hacé "Exportar" para que el Sheet quede sincronizado.' : ''}`);
        renderizarTodo(); // refrescar dashboard y movimientos
        renderizarLogSync();

    } catch (err) {
        agregarEntradaLog({ tipo: 'importar', ok: false, detalle: err.message });
        progreso.innerHTML = alertaError(`Error al importar: ${err.message}`);
        renderizarLogSync();
    }
}

// ── Llamada al Apps Script ───────────────────────────────────

async function llamarScript(url, action, body = null) {
    let response;

    if (body) {
        // POST
        response = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'text/plain' }, // Apps Script no acepta application/json en POST
            body:    JSON.stringify({ action, ...body })
        });
    } else {
        // GET
        response = await fetch(`${url}?action=${action}`);
    }

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

// ── Helpers de UI ────────────────────────────────────────────

function estadoCargando(mensaje) {
    return `<div style="display:flex;align-items:center;gap:var(--espacio-md);color:var(--color-texto-secundario);padding:var(--espacio-md) 0;">
        <div class="spinner" style="width:18px;height:18px;flex-shrink:0;"></div>
        <span style="font-size:var(--texto-sm);">${mensaje}</span>
    </div>`;
}

function alertaExito(msg) {
    return `<div style="padding:var(--espacio-md);background:rgba(74,158,110,0.1);border:1px solid var(--color-verde);border-radius:var(--radio-md);color:var(--color-verde);font-size:var(--texto-sm);">${msg}</div>`;
}

function alertaError(msg) {
    return `<div style="padding:var(--espacio-md);background:rgba(201,76,76,0.1);border:1px solid var(--color-error);border-radius:var(--radio-md);color:var(--color-error);font-size:var(--texto-sm);">${msg}</div>`;
}

function alertaInfo(msg) {
    return `<div style="padding:var(--espacio-md);background:rgba(201,168,76,0.1);border:1px solid var(--color-dorado);border-radius:var(--radio-md);color:var(--color-dorado);font-size:var(--texto-sm);">${msg}</div>`;
}

function formatearFechaHora(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function renderizarLogSync() {
    // Refresh solo el bloque del log sin re-renderizar toda la tab
    renderizarSync();
}
