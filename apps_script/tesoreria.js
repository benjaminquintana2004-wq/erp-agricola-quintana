// ============================================================
// TESORERÍA — Google Apps Script
// ============================================================
// Cómo instalarlo:
//   1. Abrí el Google Sheet que va a sincronizar con el ERP.
//   2. Extensiones → Apps Script → pegá este código completo.
//   3. Guardá (Ctrl+S).
//   4. Implementar → Nueva implementación → Tipo: Aplicación web.
//   5. Ejecutar como: Yo (tu cuenta de Google).
//   6. Quién tiene acceso: Cualquier usuario.
//   7. Implementar → copiar la URL generada.
//   8. Pegá esa URL en la configuración de "Sincronización" del ERP.
//
// Hojas que crea automáticamente:
//   - "Movimientos"  → cheques y transferencias de tesorería
//
// Protocolo:
//   GET  ?action=ping                    → health check
//   GET  ?action=getMovimientos          → devuelve todas las filas
//   POST {action:"exportar", rows:[...]} → sobreescribe el sheet con los datos del ERP
//   POST {action:"importar"}             → devuelve las filas nuevas/modificadas en el sheet
//   POST {action:"escribirIds", updates:[{fila, id}]} → escribe los UUIDs generados en Supabase
// ============================================================

// ── Configuración ────────────────────────────────────────────
const HOJA_MOVIMIENTOS = 'Movimientos';

// Columnas del sheet, en orden exacto. NO cambiar el orden sin actualizar el ERP.
// Si necesitás agregar columnas nuevas, hacelo SIEMPRE al final (después de actualizado_en)
// para no romper sheets existentes.
const COLS = [
  'id',                // A  — UUID de Supabase (vacío si fue agregado directo en el sheet)
  'empresa',           // B
  'cuenta',            // C
  'tipo',              // D  — cheque | transferencia
  'numero_cheque',     // E
  'fecha_emision',     // F
  'fecha_cobro',       // G
  'fecha_balde',       // H
  'beneficiario',      // I
  'categoria',         // J
  'monto',             // K
  'estado',            // L  — pendiente | cobrado | anulado
  'notas',             // M
  'actualizado_en',    // N  — ISO timestamp, para resolución de conflictos
  'empleado_entrega'   // O  — Nombre del empleado que entregó/manejó el cheque (opcional). El ERP matchea contra empleados.nombre case-insensitive.
];

// ── Router ───────────────────────────────────────────────────
function doGet(e) {
  return manejarRequest(e);
}

function doPost(e) {
  return manejarRequest(e);
}

function manejarRequest(e) {
  const params = e.parameter || {};
  const body   = e.postData ? JSON.parse(e.postData.contents || '{}') : {};
  const action = params.action || body.action;

  try {
    let resultado;
    switch (action) {
      case 'ping':
        resultado = { ok: true, timestamp: new Date().toISOString(), hoja: HOJA_MOVIMIENTOS };
        break;
      case 'getMovimientos':
        resultado = getMovimientos();
        break;
      case 'exportar':
        resultado = exportarMovimientos(body.rows || []);
        break;
      case 'importar':
        resultado = importarMovimientos();
        break;
      case 'escribirIds':
        resultado = escribirIds(body.updates || []);
        break;
      default:
        resultado = { error: 'Acción no reconocida: ' + action };
    }
    return jsonOk(resultado);
  } catch (err) {
    return jsonError(err.toString());
  }
}

// ── Helpers ──────────────────────────────────────────────────
function jsonOk(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError(mensaje) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: mensaje }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Convierte una fila de valores en objeto usando COLS como keys
function filaAObjeto(valores) {
  const obj = {};
  COLS.forEach((col, i) => {
    const v = valores[i];
    // Formatear fechas como strings YYYY-MM-DD
    if (v instanceof Date) {
      obj[col] = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      obj[col] = (v === '' || v === null || v === undefined) ? null : v;
    }
  });
  return obj;
}

// Columnas que contienen fechas en formato YYYY-MM-DD (deben mostrarse como fecha en Sheets)
const COLS_FECHA = ['fecha_emision', 'fecha_cobro', 'fecha_balde'];

// Convierte un objeto en fila de valores ordenada según COLS.
// Las columnas de fecha se convierten a Date para que Sheets las formatee correctamente.
function objetoAFila(obj) {
  return COLS.map(col => {
    const v = obj[col];
    if (v === null || v === undefined || v === '') return '';
    // Convertir fechas YYYY-MM-DD a Date (mediodía local para evitar desfase de zona horaria)
    if (COLS_FECHA.includes(col) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [anio, mes, dia] = v.split('-').map(Number);
      return new Date(anio, mes - 1, dia, 12, 0, 0);
    }
    return v;
  });
}

// Obtiene o crea la hoja de Movimientos con encabezados
function obtenerHoja() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   hoja  = ss.getSheetByName(HOJA_MOVIMIENTOS);

  if (!hoja) {
    hoja = ss.insertSheet(HOJA_MOVIMIENTOS);
    // Encabezados con formato
    const rango = hoja.getRange(1, 1, 1, COLS.length);
    rango.setValues([COLS]);
    rango.setFontWeight('bold');
    rango.setBackground('#1a1a1a');
    rango.setFontColor('#c9a84c');
    hoja.setFrozenRows(1);
    // Anchos de columna
    hoja.setColumnWidth(1, 280);  // id (UUID)
    hoja.setColumnWidth(11, 120); // monto
    hoja.setColumnWidth(14, 180); // actualizado_en
  }

  // Aplicar formato de fecha dd/mm/yyyy en columnas F (6), G (7) y H (8)
  // Se hace siempre (no solo al crear) para que las filas nuevas también queden bien
  const maxFila = Math.max(hoja.getLastRow(), 2);
  ['F', 'G', 'H'].forEach(letra => {
    hoja.getRange(`${letra}2:${letra}${maxFila}`)
        .setNumberFormat('dd/mm/yyyy');
  });

  return hoja;
}

// ── Acciones ─────────────────────────────────────────────────

/**
 * Devuelve todas las filas del sheet como array de objetos.
 * Incluye el número de fila (fila_sheet) para poder escribir de vuelta.
 */
function getMovimientos() {
  const hoja = obtenerHoja();
  const datos = hoja.getDataRange().getValues();
  if (datos.length <= 1) return []; // solo encabezado

  return datos.slice(1).map((fila, i) => {
    const obj = filaAObjeto(fila);
    obj._fila_sheet = i + 2; // fila real en el sheet (base 1, +1 por encabezado)
    return obj;
  }).filter(r => r.tipo || r.id); // ignorar filas completamente vacías
}

/**
 * Exportar: sobreescribe el sheet con los datos del ERP.
 * Estrategia: merge inteligente — conserva filas del sheet que tienen cambios
 * más recientes que el ERP. Las demás se reemplazan.
 * Devuelve un resumen de la operación.
 */
function exportarMovimientos(rowsERP) {
  const hoja        = obtenerHoja();
  const filasSheet  = getMovimientos(); // estado actual del sheet
  const mapaSheet   = {}; // id → {fila_obj, fila_numero}

  filasSheet.forEach(f => {
    if (f.id) mapaSheet[f.id] = f;
  });

  let agregados    = 0;
  let actualizados = 0;
  let conservados  = 0; // sheet tenía versión más nueva

  // Construir la nueva lista de filas a escribir
  const nuevasFilas = rowsERP.map(row => {
    const enSheet = mapaSheet[row.id];

    if (!enSheet) {
      // No estaba en el sheet → agregar
      agregados++;
      return objetoAFila(row);
    }

    // Comparar timestamps para resolver conflicto
    const tsERP   = row.actualizado_en   ? new Date(row.actualizado_en).getTime()   : 0;
    const tsSheet = enSheet.actualizado_en ? new Date(enSheet.actualizado_en).getTime() : 0;

    if (tsSheet > tsERP) {
      // Sheet tiene versión más nueva → conservar la del sheet
      conservados++;
      return objetoAFila(enSheet);
    }

    // ERP es igual o más nuevo → usar ERP
    actualizados++;
    return objetoAFila(row);
  });

  // Escribir todo de una vez (batch)
  if (nuevasFilas.length > 0) {
    // Limpiar filas de datos (sin tocar encabezado)
    const ultimaFila = Math.max(hoja.getLastRow(), 2);
    if (ultimaFila > 1) {
      hoja.getRange(2, 1, ultimaFila - 1, COLS.length).clearContent();
    }
    hoja.getRange(2, 1, nuevasFilas.length, COLS.length).setValues(nuevasFilas);
  }

  return {
    total:      rowsERP.length,
    agregados,
    actualizados,
    conservados
  };
}

/**
 * Importar: devuelve las filas del sheet que el ERP debe procesar.
 *  - Filas SIN id → son nuevas, el ERP las tiene que crear en Supabase
 *  - Filas CON id y actualizado_en más reciente que el ERP → el ERP las actualiza
 * El ERP decide qué hacer con cada una; después llama a escribirIds() si corresponde.
 */
function importarMovimientos() {
  const filasSheet = getMovimientos();

  const nuevas     = filasSheet.filter(f => !f.id || f.id === '');
  const modificadas = filasSheet.filter(f => f.id && f.id !== ''); // el ERP compara timestamps

  return {
    nuevas,
    modificadas,
    total_sheet: filasSheet.length
  };
}

/**
 * Después de que el ERP crea en Supabase los registros importados,
 * llama a esta función para escribir de vuelta los UUIDs generados.
 * updates: [{ fila_sheet: number, id: string }]
 */
function escribirIds(updates) {
  const hoja = obtenerHoja();
  const colId = 1; // columna A

  updates.forEach(upd => {
    if (upd.fila_sheet && upd.id) {
      hoja.getRange(upd.fila_sheet, colId).setValue(upd.id);
    }
  });

  return { escritos: updates.length };
}
