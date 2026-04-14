// ============================================================
// BACKEND - Google Apps Script
// Pegá este código en: Extensiones → Apps Script
// Luego: Implementar → Nueva implementación → Aplicación web
// Acceso: Cualquier usuario
// ============================================================

const SS = SpreadsheetApp.getActiveSpreadsheet();

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const params = e.parameter || {};
  const body = e.postData ? JSON.parse(e.postData.contents || "{}") : {};
  const action = params.action || body.action;

  const cors = ContentService.createTextOutput();
  cors.setMimeType(ContentService.MimeType.JSON);

  try {
    let result;
    switch (action) {
      case "getArrendadores":  result = getArrendadores(); break;
      case "getMovimientos":   result = getMovimientos(); break;
      case "getContratos":     result = getContratos(); break;
      case "addContrato":      result = addContrato(body); break;
      case "getSaldos":        result = getSaldos(); break;
      case "addMovimiento":    result = addMovimiento(body); break;
      case "addArrendador":    result = addArrendador(body); break;
      case "updateArrendador": result = updateArrendador(body); break;
      default: result = { error: "Acción no reconocida: " + action };
    }
    cors.setContent(JSON.stringify({ ok: true, data: result }));
  } catch (err) {
    cors.setContent(JSON.stringify({ ok: false, error: err.message }));
  }

  return cors;
}

// ── Arrendadores ──────────────────────────────────────────────
function getArrendadores() {
  const sheet = SS.getSheetByName("Arrendadores");
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  return rows.slice(1).filter(r => r[0] !== "").map(r => toObj(headers, r));
}

function addArrendador(data) {
  const sheet = SS.getSheetByName("Arrendadores");
  const rows = sheet.getDataRange().getValues();
  const newId = rows.length; // encabezado + filas existentes
  sheet.appendRow([
    newId,
    data.nombre || "",
    data.telefono || "",
    data.campo || "",
    data.hectareas || 0,
    data.grano || "Soja",
    data.moneda || "USD",
    data.quintales_deuda || 0,
    data.alerta_umbral || 20
  ]);
  return { id: newId };
}

function updateArrendador(data) {
  const sheet = SS.getSheetByName("Arrendadores");
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      if (data.quintales_deuda !== undefined) sheet.getRange(i + 1, 9).setValue(data.quintales_deuda);
      if (data.alerta_umbral !== undefined)  sheet.getRange(i + 1, 10).setValue(data.alerta_umbral);
      if (data.nombre !== undefined)         sheet.getRange(i + 1, 2).setValue(data.nombre);
      if (data.telefono !== undefined)       sheet.getRange(i + 1, 3).setValue(data.telefono);
      return { ok: true };
    }
  }
  return { error: "Arrendador no encontrado" };
}

// ── Movimientos ───────────────────────────────────────────────
function getMovimientos() {
  const sheet = SS.getSheetByName("Movimientos");
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  return rows.slice(1).filter(r => r[0] !== "").map(r => toObj(headers, r));
}

function addMovimiento(data) {
  const sheet = SS.getSheetByName("Movimientos");
  const rows = sheet.getDataRange().getValues();
  const newId = rows.length;
  const total = (data.quintales || 0) * (data.precio_quintal || 0);

  sheet.appendRow([
    newId,
    data.fecha || new Date().toLocaleDateString("es-AR"),
    data.arrendador_id,
    data.arrendador_nombre || "",
    data.quintales || 0,
    data.precio_quintal || 0,
    data.moneda || "USD",
    total,
    data.observaciones || ""
  ]);

  // Descontar del saldo del arrendador
  const arrSheet = SS.getSheetByName("Arrendadores");
  const arrRows = arrSheet.getDataRange().getValues();
  for (let i = 1; i < arrRows.length; i++) {
    if (String(arrRows[i][0]) === String(data.arrendador_id)) {
      const saldoActual = Number(arrRows[i][7]);
      const nuevoSaldo = saldoActual - Number(data.quintales);
      arrSheet.getRange(i + 1, 8).setValue(nuevoSaldo);
      break;
    }
  }

  return { id: newId, total };
}

// ── Contratos ─────────────────────────────────────────────────
function addContrato(data) {
  const sheet = SS.getSheetByName("Contratos");
  sheet.appendRow([
    data.arrendador_id,
    data["campaña"] || "",
    data.fecha_inicio || "",
    data.fecha_fin || "",
    data.quintales_pactados || 0,
    data.tipo || "arrendamiento"
  ]);
  return { ok: true };
}

function getContratos() {
  const sheet = SS.getSheetByName("Contratos");
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  return rows.slice(1).filter(r => r[0] !== "").map(r => toObj(headers, r));
}

// ── Saldos calculados ─────────────────────────────────────────
function getSaldos() {
  const arrendadores = getArrendadores();
  const movimientos = getMovimientos();

  return arrendadores.map(a => {
    const movArr = movimientos.filter(m => String(m.arrendador_id) === String(a.id));
    const totalEntregado = movArr.reduce((s, m) => s + Number(m.quintales), 0);
    const saldoPendiente = Number(a.quintales_deuda);
    const enAlerta = saldoPendiente <= Number(a.alerta_umbral);
    return {
      ...a,
      total_entregado: totalEntregado,
      saldo_pendiente: saldoPendiente,
      en_alerta: enAlerta,
      movimientos: movArr.length
    };
  });
}

// ── Utilidad ──────────────────────────────────────────────────
function toObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i]; });
  return obj;
}
