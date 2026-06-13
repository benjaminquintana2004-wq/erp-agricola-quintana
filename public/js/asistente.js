// ==============================================
// asistente.js — Asistente virtual del ERP
// Responde preguntas sobre los datos del negocio usando IA (Claude) con
// el patrón tool_use (function calling): Claude elige qué "herramienta"
// (consulta) usar y con qué parámetros, nosotros la corremos, y él redacta.
//
// SEGURIDAD:
//   - Solo lectura. Nunca crea, edita ni borra.
//   - Las herramientas son un menú cerrado (ASISTENTE_TOOLS). Claude solo
//     puede pedir esas; no genera SQL arbitrario.
//   - Corren bajo la sesión del usuario → RLS limita lo que puede ver.
//   - La clave de IA vive en la Edge Function (anthropic-proxy), no acá.
// ==============================================

const ASISTENTE_MODELO = 'claude-sonnet-4-5';

// Historial visible del chat (para la UI)
let __historialChat = [];

// La conversación se guarda en el navegador para que se mantenga al cambiar
// de página y sea la MISMA entre el globito flotante y la página del asistente.
const ASISTENTE_STORAGE_KEY = 'erp_asistente_chat';

function guardarHistorialAsistente() {
    try {
        const limpio = __historialChat.filter(m => m.rol === 'usuario' || m.rol === 'asistente');
        sessionStorage.setItem(ASISTENTE_STORAGE_KEY, JSON.stringify(limpio));
    } catch (e) { /* sessionStorage no disponible: ignorar */ }
}

function restaurarHistorialAsistente() {
    try {
        const raw = sessionStorage.getItem(ASISTENTE_STORAGE_KEY);
        __historialChat = raw ? (JSON.parse(raw) || []) : [];
    } catch (e) { __historialChat = []; }
}

/** Borra la conversación (botón "nueva charla"). */
function limpiarChatAsistente() {
    __historialChat = [];
    try { sessionStorage.removeItem(ASISTENTE_STORAGE_KEY); } catch (e) {}
    if (typeof location !== 'undefined') location.reload();
}

// ==============================================
// Helpers de formato
// ==============================================
function fmtQQ(n) {
    return Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' qq';
}

// Convención: campaña X/Y va de 1-jul-X a 30-jun-Y
function rangoCampanaStr(c) {
    return {
        inicio: `${c.anio_inicio}-07-01`,
        fin: `${c.anio_fin}-06-30`
    };
}

// ==============================================
// Llamada a Claude (vía anthropic-proxy)
// Devuelve el MENSAJE completo (con bloques text y/o tool_use),
// para poder hacer el loop de tool_use como en el curso.
// ==============================================
/**
 * Llama a Claude en modo STREAMING (stream: true) y va emitiendo el texto
 * a medida que llega, vía el callback onText(delta). Arma y devuelve el
 * mensaje completo { content, stop_reason } (incluye bloques tool_use).
 * Si la respuesta no llega en stream (proxy sin actualizar), igual funciona
 * (procesa todos los eventos juntos al final).
 */
async function streamClaudeMensaje({ system, messages, tools, maxTokens = 1024, onText }) {
    const body = { model: ASISTENTE_MODELO, max_tokens: maxTokens, messages, stream: true };
    if (system) body.system = system;
    if (tools) body.tools = tools;

    const resp = await fetch(urlProxyAnthropic(), {
        method: 'POST',
        headers: await headersProxyIA(),
        body: JSON.stringify(body)
    });
    if (!resp.ok || !resp.body) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error?.message || `Error HTTP ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const bloques = {};   // index -> { type, text | (id,name,_json,input) }
    let stopReason = null;

    const procesar = (evt) => {
        if (evt.type === 'content_block_start') {
            const cb = evt.content_block || {};
            bloques[evt.index] = cb.type === 'tool_use'
                ? { type: 'tool_use', id: cb.id, name: cb.name, _json: '' }
                : { type: 'text', text: '' };
        } else if (evt.type === 'content_block_delta') {
            const b = bloques[evt.index];
            if (!b) return;
            if (evt.delta?.type === 'text_delta') {
                b.text += evt.delta.text;
                if (onText) onText(evt.delta.text);
            } else if (evt.delta?.type === 'input_json_delta') {
                b._json += evt.delta.partial_json || '';
            }
        } else if (evt.type === 'content_block_stop') {
            const b = bloques[evt.index];
            if (b && b.type === 'tool_use') {
                try { b.input = JSON.parse(b._json || '{}'); } catch (e) { b.input = {}; }
                delete b._json;
            }
        } else if (evt.type === 'message_delta') {
            if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let corte;
        while ((corte = buffer.indexOf('\n\n')) !== -1) {
            const evento = buffer.slice(0, corte);
            buffer = buffer.slice(corte + 2);
            for (const linea of evento.split('\n')) {
                const l = linea.trim();
                if (!l.startsWith('data:')) continue;
                const dataStr = l.slice(5).trim();
                if (!dataStr || dataStr === '[DONE]') continue;
                let evt;
                try { evt = JSON.parse(dataStr); } catch (e) { continue; }
                procesar(evt);
            }
        }
    }

    const content = Object.keys(bloques)
        .sort((a, b) => Number(a) - Number(b))
        .map(k => {
            const b = bloques[k];
            return b.type === 'tool_use'
                ? { type: 'tool_use', id: b.id, name: b.name, input: b.input || {} }
                : { type: 'text', text: b.text };
        });

    return { content, stop_reason: stopReason };
}

/** Extrae el texto de un mensaje de Claude (junta los bloques de texto). */
function textoDeMensaje(msg) {
    return (msg.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
}

/**
 * Convierte el historial del chat a la lista de "messages" que entiende
 * la API de Claude (turnos user/assistant), igual que en el curso.
 * La API exige que el primer turno sea del usuario.
 */
function historialAMensajes(historial) {
    const msgs = (historial || []).map(m => ({
        role: m.rol === 'usuario' ? 'user' : 'assistant',
        content: m.texto
    }));
    while (msgs.length && msgs[0].role === 'assistant') msgs.shift();
    return msgs;
}

// ==============================================
// HERRAMIENTAS (tools) que Claude puede usar.
// Cada una corresponde a una consulta segura de solo-lectura (más abajo).
// Claude elige cuál usar y con qué parámetros; nosotros la corremos
// bajo los permisos del usuario (RLS) y le devolvemos el resultado.
// ==============================================
const ASISTENTE_TOOLS = [
    {
        name: 'saldo_arrendador',
        description: 'Datos de UN arrendador puntual: cuántos quintales se le deben (desglose por campaña histórica/actual/futura y total del contrato), cuántos contratos tiene, hectáreas, campos y vigencia. Usar cuando preguntan por un arrendador con nombre.',
        input_schema: {
            type: 'object',
            properties: { nombre: { type: 'string', description: 'Nombre (o parte del nombre) del arrendador' } },
            required: ['nombre']
        }
    },
    {
        name: 'saldos_campana_actual',
        description: 'Saldos de quintales de la campaña ACTUAL de TODOS los arrendadores: ranking de a quién se le debe más y el total pendiente. Usar para "a quién le debo más", "cuánto falta entregar en total esta campaña".',
        input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'facturas_pendientes_qq',
        description: 'Facturas de quintales pendientes (ventas de qq sin factura cargada): a quién hay que pedirle factura.',
        input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'movimientos_quintales',
        description: 'Entregas/ventas de quintales (movimientos de arrendamiento). Opcionalmente filtra por un arrendador. Usar para "qué movimientos hizo X", "cuántos qq le vendí a X", "últimos movimientos".',
        input_schema: {
            type: 'object',
            properties: { nombre: { type: 'string', description: 'Nombre del arrendador (opcional)' } },
            required: []
        }
    },
    {
        name: 'contratos_vencimiento',
        description: 'Estado de vencimiento de TODOS los contratos: cuáles están vencidos, cuántos vencen este año o el año que viene, y la fecha de vencimiento de cada uno.',
        input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'tesoreria_cheques_pagos',
        description: 'TESORERÍA: cheques y pagos. Trae los movimientos con número de cheque, beneficiario y su tipo (arrendador/contratista/empleado), quién lo entregó, monto, estado, fecha de cobro, fecha de carga al sistema ("subido_el", para resolver "ayer" usar el campo "hoy") y si tiene factura. Opcionalmente filtra por el nombre de un empleado o contratista. Usar para "cuántos cheques se subieron ayer", "cheques que entregó el empleado X y sus números", "cheques sin factura", "cuánta plata se le dio al contratista Y".',
        input_schema: {
            type: 'object',
            properties: { nombre: { type: 'string', description: 'Nombre de un empleado o contratista (opcional)' } },
            required: []
        }
    }
];

const ASISTENTE_SYSTEM = `Sos el asistente del ERP de un productor agropecuario argentino. Respondés en castellano rioplatense, claro y breve.
- Usá las HERRAMIENTAS para obtener los datos del negocio; NUNCA inventes números ni nombres.
- Unidad: "quintales (qq)". Un quintal son 100 kg.
- Para fechas relativas ("ayer", "esta semana"), calculá a partir del campo "hoy" que devuelven los datos de tesorería.
- Si una herramienta no devuelve datos, decilo con naturalidad (puede no haber, o puede que el usuario no tenga acceso a esa información por su rol).
- Resaltá los números clave con **negrita**. No muestres JSON ni nombres de herramientas; redactá algo humano.
- No anuncies lo que vas a hacer (no digas "déjame ver", "voy a consultar" ni similares): usá las herramientas en silencio y respondé directamente.
- Si la pregunta no tiene que ver con el negocio (arrendadores, contratos, quintales, facturas, tesorería), decí amablemente con qué temas podés ayudar.`;

// ==============================================
// Ejecuta una herramienta pedida por Claude y devuelve los datos.
// Es el "menú cerrado": Claude solo puede pedir estas; nada de SQL libre.
// ==============================================
async function ejecutarHerramienta(nombre, input) {
    input = input || {};
    if (nombre === 'saldo_arrendador') {
        if (!input.nombre) return { error: 'Falta el nombre del arrendador.' };
        return asistenteBreakdownArrendador(input.nombre);
    }
    if (nombre === 'saldos_campana_actual') {
        const { campana, saldos } = await asistenteSaldosCampanaActiva();
        if (!campana) return { sin_campana: true };
        return {
            campana: campana.nombre,
            total_qq_pendientes: Math.round(saldos.reduce((s, x) => s + x.pendiente, 0)),
            cantidad_arrendadores_con_deuda: saldos.length,
            ranking: saldos.slice(0, 30).map(s => ({ arrendador: s.nombre, qq_pendiente: Math.round(s.pendiente) }))
        };
    }
    if (nombre === 'facturas_pendientes_qq') {
        const f = await asistenteFacturasPendientes();
        return { cantidad: f.length, facturas: f.slice(0, 30).map(x => ({ arrendador: x.arrendador, qq: Math.round(x.qq), fecha: x.fecha })) };
    }
    if (nombre === 'movimientos_quintales') {
        return asistenteMovimientos(input.nombre || null);
    }
    if (nombre === 'contratos_vencimiento') {
        return asistenteContratosVencimiento();
    }
    if (nombre === 'tesoreria_cheques_pagos') {
        return asistenteTesoreria(input.nombre || null);
    }
    return { error: `Herramienta desconocida: ${nombre}` };
}

// ==============================================
// MENÚ CERRADO DE CONSULTAS SEGURAS (solo lectura, bajo RLS)
// ==============================================

/** Campaña marcada como activa. */
async function asistenteCampanaActiva() {
    const data = await ejecutarConsulta(
        db.from('campanas').select('*').eq('activa', true).limit(1),
        'consultar campaña activa'
    );
    return (data && data[0]) || null;
}

/**
 * Calcula los quintales pendientes por arrendador en la campaña activa.
 * Misma lógica que la ficha del arrendador: pactado − entregado, por
 * contrato que solapa con la campaña.
 * @returns {{campana, saldos: Array<{arrendador_id, nombre, pendiente}>}}
 */
async function asistenteSaldosCampanaActiva() {
    const campana = await asistenteCampanaActiva();
    if (!campana) return { campana: null, saldos: [] };
    const rango = rangoCampanaStr(campana);

    const [arrendadores, vinculos, contratos, movimientos] = await Promise.all([
        ejecutarConsulta(db.from('arrendadores').select('id, nombre'), 'consultar arrendadores'),
        ejecutarConsulta(db.from('contratos_arrendadores').select('arrendador_id, contrato_id'), 'consultar vínculos'),
        ejecutarConsulta(db.from('contratos').select('id, fecha_inicio, fecha_fin, qq_pactados_anual, qq_negro_anual'), 'consultar contratos'),
        ejecutarConsulta(db.from('movimientos').select('arrendador_id, contrato_id, qq').eq('campana_id', campana.id), 'consultar movimientos')
    ]);

    // Si RLS bloqueó (empleado), las listas vienen vacías
    const contratosPorId = {};
    (contratos || []).forEach(c => { contratosPorId[c.id] = c; });

    // Movimientos sumados por (arrendador, contrato)
    const pagadoPorClave = {};
    (movimientos || []).forEach(m => {
        const k = `${m.arrendador_id}|${m.contrato_id}`;
        pagadoPorClave[k] = (pagadoPorClave[k] || 0) + parseFloat(m.qq || 0);
    });

    const nombrePorId = {};
    (arrendadores || []).forEach(a => { nombrePorId[a.id] = a.nombre; });

    // Pendiente por arrendador
    const pendientePorArr = {};
    (vinculos || []).forEach(v => {
        const c = contratosPorId[v.contrato_id];
        if (!c || !c.fecha_inicio || !c.fecha_fin) return;
        // ¿el contrato solapa con la campaña activa?
        if (c.fecha_inicio > rango.fin || c.fecha_fin < rango.inicio) return;
        const pactado = parseFloat(c.qq_pactados_anual || 0) + parseFloat(c.qq_negro_anual || 0);
        const pagado = pagadoPorClave[`${v.arrendador_id}|${v.contrato_id}`] || 0;
        const pend = pactado - pagado;
        pendientePorArr[v.arrendador_id] = (pendientePorArr[v.arrendador_id] || 0) + pend;
    });

    const saldos = Object.keys(pendientePorArr)
        .map(id => ({
            arrendador_id: id,
            nombre: nombrePorId[id] || 'Sin nombre',
            pendiente: Math.max(0, pendientePorArr[id])
        }))
        .filter(s => s.pendiente > 0.01)
        .sort((a, b) => b.pendiente - a.pendiente);

    return { campana, saldos };
}

/**
 * Desglose COMPLETO de un arrendador: quintales pactados, entregados y
 * pendientes por CADA campaña (histórica/actual/futura) + totales del
 * contrato. Misma lógica que el desglose de la ficha del arrendador.
 */
async function asistenteBreakdownArrendador(nombreBuscado) {
    const arrs = await ejecutarConsulta(db.from('arrendadores').select('id, nombre'), 'consultar arrendadores');
    const aLower = (nombreBuscado || '').toLowerCase();
    const matches = (arrs || []).filter(a => (a.nombre || '').toLowerCase().includes(aLower));
    if (!matches.length) return { arrendador_buscado: nombreBuscado, encontrado: false };
    // Puede haber VARIOS registros con el mismo nombre (duplicados o
    // co-titulares). Sumamos los contratos de todos, sin duplicar contratos.
    const ids = matches.map(m => m.id);

    const [vinc, campanas, movs] = await Promise.all([
        ejecutarConsulta(db.from('contratos_arrendadores').select('arrendador_id, contratos(*)').in('arrendador_id', ids), 'consultar contratos'),
        ejecutarConsulta(db.from('campanas').select('*').order('anio_inicio', { ascending: true }), 'consultar campañas'),
        ejecutarConsulta(db.from('movimientos').select('campana_id, contrato_id, qq').in('arrendador_id', ids), 'consultar movimientos')
    ]);

    // Contratos vinculados a cualquiera de los registros, deduplicados por id
    const contratosMap = {};
    (vinc || []).forEach(v => { if (v.contratos) contratosMap[v.contratos.id] = v.contratos; });
    const contratos = Object.values(contratosMap);

    // Nombre principal = el primer registro que SÍ tiene contratos
    const idsConContrato = new Set((vinc || []).filter(v => v.contratos).map(v => v.arrendador_id));
    const conData = matches.filter(m => idsConContrato.has(m.id));
    const nombrePrincipal = (conData[0] || matches[0]).nombre;

    const hoy = new Date();
    const rango = (c) => ({
        inicio: `${c.anio_inicio}-07-01`, fin: `${c.anio_fin}-06-30`,
        iniDate: new Date(c.anio_inicio, 6, 1), finDate: new Date(c.anio_fin, 5, 30, 23, 59, 59)
    });

    const porCampana = [];
    let totPact = 0, totEntr = 0;
    for (const camp of (campanas || [])) {
        const r = rango(camp);
        let pactado = 0, entregado = 0, aplica = false;
        for (const c of contratos) {
            if (!c.fecha_inicio || !c.fecha_fin) continue;
            if (c.fecha_inicio > r.fin || c.fecha_fin < r.inicio) continue; // solapamiento
            aplica = true;
            pactado += parseFloat(c.qq_pactados_anual || 0) + parseFloat(c.qq_negro_anual || 0);
            entregado += (movs || [])
                .filter(m => m.campana_id === camp.id && m.contrato_id === c.id)
                .reduce((s, m) => s + parseFloat(m.qq || 0), 0);
        }
        if (!aplica) continue;
        const estado = hoy < r.iniDate ? 'futura' : (hoy > r.finDate ? 'histórica' : 'actual');
        porCampana.push({
            campana: camp.nombre, estado,
            pactado: Math.round(pactado),
            entregado: Math.round(entregado),
            pendiente: Math.round(Math.max(0, pactado - entregado))
        });
        totPact += pactado; totEntr += entregado;
    }

    return {
        arrendador: nombrePrincipal,
        encontrado: true,
        nombres_coincidentes: (conData.length ? conData : matches).map(m => m.nombre),
        cantidad_contratos: contratos.length,
        contratos: contratos.map(c => ({
            campo: c.campo || c.nombre_grupo || null,
            hectareas: c.hectareas ? Math.round(c.hectareas) : null,
            qq_anual: Math.round(parseFloat(c.qq_pactados_anual || 0) + parseFloat(c.qq_negro_anual || 0)),
            vigencia: `${c.fecha_inicio || '?'} a ${c.fecha_fin || '?'}`
        })),
        por_campana: porCampana,
        total_pactado: Math.round(totPact),
        total_entregado: Math.round(totEntr),
        total_pendiente: Math.round(Math.max(0, totPact - totEntr))
    };
}

/** Facturas pendientes: movimientos sin factura OK. */
async function asistenteFacturasPendientes() {
    const movs = await ejecutarConsulta(
        db.from('movimientos')
            .select('qq, fecha, estado_factura, arrendadores(nombre)')
            .neq('estado_factura', 'factura_ok')
            .order('fecha', { ascending: true }),
        'consultar facturas pendientes'
    );
    return (movs || []).map(m => ({
        arrendador: m.arrendadores?.nombre || 'Sin arrendador',
        qq: parseFloat(m.qq || 0),
        fecha: m.fecha,
        estado: m.estado_factura
    }));
}

/**
 * Movimientos (entregas/ventas de quintales). Si se pasa un nombre, trae
 * TODOS los de ese arrendador; si no, los 30 más recientes en general.
 */
async function asistenteMovimientos(nombreArr) {
    let arrIds = null;
    if (nombreArr) {
        const arrs = await ejecutarConsulta(db.from('arrendadores').select('id, nombre'), 'consultar arrendadores');
        const aLower = nombreArr.toLowerCase();
        arrIds = (arrs || []).filter(a => (a.nombre || '').toLowerCase().includes(aLower)).map(a => a.id);
        if (!arrIds.length) return { arrendador_buscado: nombreArr, encontrado: false, movimientos: [] };
    }

    let q = db.from('movimientos')
        .select('fecha, qq, precio_quintal, moneda, tipo, estado_factura, arrendadores(nombre), campanas(nombre)')
        .order('fecha', { ascending: false });
    q = arrIds ? q.in('arrendador_id', arrIds) : q.limit(30);

    const movs = await ejecutarConsulta(q, 'consultar movimientos');
    const lista = (movs || []).map(m => ({
        arrendador: m.arrendadores?.nombre || 'Sin arrendador',
        fecha: m.fecha,
        qq: Math.round(parseFloat(m.qq || 0)),
        precio: m.precio_quintal ? parseFloat(m.precio_quintal) : null,
        moneda: m.moneda || 'ARS',
        tipo: m.tipo,
        campana: m.campanas?.nombre || null,
        factura: m.estado_factura
    }));
    return {
        encontrado: true,
        cantidad: lista.length,
        total_qq: lista.reduce((s, m) => s + m.qq, 0),
        movimientos: lista.slice(0, 40)
    };
}

/**
 * Estado de vencimiento de TODOS los contratos: vencidos, por vencer,
 * y en qué año vence cada uno. La IA filtra/cuenta según lo que pregunten.
 */
async function asistenteContratosVencimiento() {
    const contratos = await ejecutarConsulta(
        db.from('contratos').select('nombre_grupo, campo, fecha_inicio, fecha_fin'),
        'consultar contratos'
    );
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const anioActual = hoy.getFullYear();

    const lista = (contratos || []).filter(c => c.fecha_fin).map(c => {
        const fin = new Date(c.fecha_fin + 'T00:00:00');
        const dias = Math.round((fin - hoy) / (1000 * 60 * 60 * 24));
        return {
            contrato: c.nombre_grupo || c.campo || 'Sin nombre',
            vence: c.fecha_fin,
            anio_vencimiento: fin.getFullYear(),
            vencido: dias < 0,
            dias_para_vencer: dias
        };
    });

    return {
        anio_actual: anioActual,
        total_contratos: lista.length,
        cantidad_vencidos: lista.filter(c => c.vencido).length,
        cantidad_vence_este_anio: lista.filter(c => !c.vencido && c.anio_vencimiento === anioActual).length,
        cantidad_vence_anio_proximo: lista.filter(c => c.anio_vencimiento === anioActual + 1).length,
        contratos: lista
    };
}

/**
 * Tesorería: cheques y pagos. Si se pasa un nombre (empleado o contratista),
 * trae TODOS los movimientos donde aparece (como beneficiario o como quien
 * entregó el cheque); si no, los más recientes. Marca cuáles cheques tienen
 * factura vinculada. La IA filtra/cuenta según lo que pregunten.
 */
async function asistenteTesoreria(nombre) {
    const limite = nombre ? 500 : 80;
    const movs = await ejecutarConsulta(
        db.from('movimientos_tesoreria')
            .select('id, tipo, numero_cheque, fecha_emision, fecha_cobro, cargado_en, monto, estado, beneficiarios(nombre, tipo), empleado_entrega:empleados!empleado_entrega_id(nombre)')
            .order('cargado_en', { ascending: false })
            .limit(limite),
        'consultar tesorería'
    );

    // ¿Qué cheques tienen factura vinculada?
    const chequeIds = (movs || []).filter(m => m.tipo === 'cheque').map(m => m.id);
    let conFactura = new Set();
    if (chequeIds.length) {
        const vinc = await ejecutarConsulta(
            db.from('cheques_facturas').select('cheque_id').in('cheque_id', chequeIds),
            'consultar facturas de cheques'
        );
        conFactura = new Set((vinc || []).map(v => v.cheque_id));
    }

    let lista = (movs || []).map(m => ({
        tipo: m.tipo,
        numero_cheque: m.numero_cheque || null,
        beneficiario: m.beneficiarios?.nombre || null,
        beneficiario_tipo: m.beneficiarios?.tipo || null,
        entregado_por: m.empleado_entrega?.nombre || null,
        monto: Math.round(parseFloat(m.monto || 0)),
        estado: m.estado,
        fecha_cobro: m.fecha_cobro,
        subido_el: m.cargado_en ? new Date(m.cargado_en).toLocaleDateString('en-CA') : null,
        tiene_factura: m.tipo === 'cheque' ? conFactura.has(m.id) : null
    }));

    if (nombre) {
        const n = nombre.toLowerCase();
        lista = lista.filter(m =>
            (m.beneficiario && m.beneficiario.toLowerCase().includes(n)) ||
            (m.entregado_por && m.entregado_por.toLowerCase().includes(n))
        );
    }

    return {
        hoy: new Date().toLocaleDateString('en-CA'),
        filtrado_por: nombre || null,
        cantidad: lista.length,
        total_monto: lista.reduce((s, m) => s + m.monto, 0),
        movimientos: lista.slice(0, 60)
    };
}

// ==============================================
// Orquestación — loop de tool_use (patrón del curso)
//   1. Mandamos la pregunta + las herramientas a Claude.
//   2. Si Claude pide una herramienta, la corremos y le devolvemos el
//      resultado, y volvemos a llamarlo.
//   3. Cuando ya no pide herramientas, devolvemos su respuesta en texto.
// ==============================================
async function responderPregunta(pregunta, historial = [], onText) {
    const messages = [...historialAMensajes(historial), { role: 'user', content: pregunta }];

    // Tope de vueltas, por las dudas (evita loops infinitos)
    for (let vuelta = 0; vuelta < 6; vuelta++) {
        const msg = await streamClaudeMensaje({
            system: ASISTENTE_SYSTEM,
            messages,
            tools: ASISTENTE_TOOLS,
            maxTokens: 1024,
            onText
        });

        // Guardar lo que respondió Claude (texto y/o pedidos de herramienta)
        messages.push({ role: 'assistant', content: msg.content });

        // ¿Terminó? (no pidió más herramientas)
        if (msg.stop_reason !== 'tool_use') {
            return textoDeMensaje(msg) || 'No pude armar una respuesta. Probá reformular la pregunta.';
        }

        // Ejecutar cada herramienta pedida y devolver los resultados
        const resultados = [];
        for (const bloque of msg.content) {
            if (bloque.type !== 'tool_use') continue;
            let salida;
            try {
                salida = await ejecutarHerramienta(bloque.name, bloque.input);
            } catch (e) {
                salida = { error: String(e?.message || e) };
            }
            resultados.push({
                type: 'tool_result',
                tool_use_id: bloque.id,
                content: JSON.stringify(salida)
            });
        }
        messages.push({ role: 'user', content: resultados });
    }

    return 'Tardé demasiado en responder. Probá con una pregunta más simple.';
}

// ==============================================
// UI del chat
// ==============================================
const PREGUNTAS_SUGERIDAS = [
    '¿Cuánto le debo a Rebufatti?',
    '¿A quién le debo más quintales?',
    '¿Cuántos contratos vencidos tengo?',
    '¿Cuántos cheques se subieron ayer?',
    '¿Qué facturas me faltan?'
];

// Avatar (estrella/destello) del asistente
const ASISTENTE_AVATAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z"/></svg>';

function renderizarChat() {
    const cont = document.getElementById('asistente-mensajes');
    if (!cont) return;
    cont.innerHTML = __historialChat.map(m => {
        if (m.rol === 'usuario') {
            return `<div class="chat-fila chat-fila-usuario">
                <div class="chat-burbuja chat-burbuja-usuario">${escaparHTML(m.texto)}</div>
            </div>`;
        }
        if (m.rol === 'pensando') {
            return `<div class="chat-fila chat-fila-asistente">
                <div class="chat-avatar">${ASISTENTE_AVATAR_SVG}</div>
                <div class="chat-burbuja chat-burbuja-asistente chat-pensando"><span class="spinner"></span> Pensando…</div>
            </div>`;
        }
        const cuerpo = escaparHTML(m.texto)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
        return `<div class="chat-fila chat-fila-asistente">
            <div class="chat-avatar">${ASISTENTE_AVATAR_SVG}</div>
            <div class="chat-burbuja chat-burbuja-asistente">${cuerpo}</div>
        </div>`;
    }).join('');
    cont.scrollTop = cont.scrollHeight;
}

async function enviarPreguntaAsistente(textoForzado) {
    const input = document.getElementById('asistente-input');
    const pregunta = (textoForzado !== undefined ? textoForzado : input.value).trim();
    if (!pregunta) return;
    if (input) input.value = '';

    // Historial previo (para que el asistente entienda preguntas de seguimiento)
    const historialPrevio = __historialChat
        .filter(m => m.rol === 'usuario' || m.rol === 'asistente')
        .slice(-6);

    __historialChat.push({ rol: 'usuario', texto: pregunta });
    __historialChat.push({ rol: 'pensando' });
    renderizarChat();
    document.getElementById('asistente-sugeridas')?.style.setProperty('display', 'none');

    const cont = document.getElementById('asistente-mensajes');

    // ---- Tipeo suave ----
    // "objetivo" = todo el texto recibido; "mostrado" = lo que ya se ve.
    // Un timer revela "mostrado" acercándose a "objetivo" a ritmo parejo,
    // así no se ve robótico aunque Claude mande el texto en bloques.
    let objetivo = '';
    let mostrado = '';
    let burbuja = null;
    let timer = null;
    let terminado = false;

    const pintar = () => {
        if (!burbuja) return;
        burbuja.innerHTML = escaparHTML(mostrado)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
        if (cont) cont.scrollTop = cont.scrollHeight;
    };

    const tick = () => {
        if (mostrado.length < objetivo.length) {
            const faltan = objetivo.length - mostrado.length;
            const paso = Math.max(2, Math.ceil(faltan / 10)); // catch-up suave
            mostrado = objetivo.slice(0, mostrado.length + paso);
            pintar();
        } else if (terminado) {
            clearInterval(timer);
            timer = null;
        }
    };

    const onText = (delta) => {
        objetivo += delta;
        if (!burbuja) {
            // Convertir la burbuja "Pensando…" en la burbuja de respuesta (sin re-render)
            const burbujas = cont ? cont.querySelectorAll('.chat-burbuja-asistente') : [];
            burbuja = burbujas[burbujas.length - 1] || null;
            if (burbuja) {
                burbuja.classList.remove('chat-pensando');
                burbuja.innerHTML = '';
            }
            timer = setInterval(tick, 18);
        }
    };

    try {
        const textoFinal = await responderPregunta(pregunta, historialPrevio, onText);
        const finalTexto = objetivo.trim() || textoFinal || 'No pude armar una respuesta.';
        objetivo = finalTexto;
        __historialChat[__historialChat.length - 1] = { rol: 'asistente', texto: finalTexto };

        if (!burbuja) {
            // No hubo streaming de texto: mostrar la respuesta directamente
            renderizarChat();
        } else {
            // Dejar que el tipeo termine de revelar el texto completo
            terminado = true;
        }
    } catch (err) {
        console.error('Error del asistente:', err);
        if (timer) { clearInterval(timer); timer = null; }
        __historialChat[__historialChat.length - 1] = {
            rol: 'asistente',
            texto: 'Uy, tuve un problema para responder. Probá de nuevo en un momento.'
        };
        renderizarChat();
    }

    // Guardar la conversación (se mantiene al cambiar de página / entre globito y página)
    guardarHistorialAsistente();
}

function manejarTeclaAsistente(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        enviarPreguntaAsistente();
    }
}

function iniciarAsistenteUI() {
    // Restaurar conversación guardada (si la hay) → se mantiene entre páginas
    restaurarHistorialAsistente();
    if (__historialChat.length > 0) {
        renderizarChat(); // reemplaza la bienvenida por la charla guardada
        return;
    }
    // Sin charla previa: mostrar las preguntas sugeridas en la bienvenida
    const cont = document.getElementById('asistente-sugeridas');
    if (cont) {
        cont.innerHTML = PREGUNTAS_SUGERIDAS.map(p =>
            `<button class="chat-sugerida" onclick="enviarPreguntaAsistente('${p.replace(/'/g, "\\'")}')">${escaparHTML(p)}</button>`
        ).join('');
    }
}
