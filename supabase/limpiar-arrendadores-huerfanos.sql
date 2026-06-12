-- ==============================================
-- limpiar-arrendadores-huerfanos.sql
-- Elimina arrendadores "fantasma": fichas que quedaron sueltas (sin
-- contrato, sin movimiento, sin lote y sin beneficiario). Suelen
-- acumularse cuando se extrae el mismo contrato/factura con IA varias
-- veces (cada intento crea fichas nuevas y solo las del intento final
-- quedan vinculadas).
--
-- SEGURIDAD:
--   - Excluye cualquier arrendador referenciado por contratos_arrendadores,
--     movimientos, lotes o beneficiarios. Solo borra los realmente sueltos.
--   - La FK de contratos_arrendadores es ON DELETE RESTRICT: la base, además,
--     bloquea por las dudas el borrado de un arrendador con contrato.
--
-- CÓMO USARLO:
--   1) PRIMERO previsualizar (no borra nada) — revisá la lista:
--        Reemplazá la palabra DELETE por SELECT *  en la consulta de abajo,
--        o usá el SELECT de previsualización del final.
--   2) Si la lista son los huérfanos esperados, correr el DELETE.
--
-- El RETURNING devuelve exactamente qué filas se borraron.
-- ==============================================

DELETE FROM arrendadores a
WHERE NOT EXISTS (SELECT 1 FROM contratos_arrendadores ca WHERE ca.arrendador_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM movimientos m WHERE m.arrendador_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM lotes l WHERE l.arrendador_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM beneficiarios b WHERE b.arrendador_id = a.id)
RETURNING nombre, cuit;


-- ----------------------------------------------
-- PREVISUALIZACIÓN (correr ESTO antes de borrar, no elimina nada):
-- ----------------------------------------------
-- SELECT a.nombre, a.cuit,
--        (SELECT count(*) FROM representantes r WHERE r.empresa_id = a.id) AS representantes_que_se_borran
-- FROM arrendadores a
-- WHERE NOT EXISTS (SELECT 1 FROM contratos_arrendadores ca WHERE ca.arrendador_id = a.id)
--   AND NOT EXISTS (SELECT 1 FROM movimientos m WHERE m.arrendador_id = a.id)
--   AND NOT EXISTS (SELECT 1 FROM lotes l WHERE l.arrendador_id = a.id)
--   AND NOT EXISTS (SELECT 1 FROM beneficiarios b WHERE b.arrendador_id = a.id)
-- ORDER BY representantes_que_se_borran DESC, a.nombre;
