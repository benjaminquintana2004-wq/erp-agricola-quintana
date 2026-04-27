-- ============================================================
-- MIGRACIÓN: adelanto_fecha_vencimiento → adelanto_dia + adelanto_mes
-- ============================================================
-- El pago adelantado se repite todas las campañas en el mismo
-- día y mes del año, no en una fecha específica. Por eso
-- guardamos día (1-31) y mes (1-12) por separado.
-- ============================================================

BEGIN;

ALTER TABLE contratos
    ADD COLUMN IF NOT EXISTS adelanto_dia INTEGER
        CHECK (adelanto_dia BETWEEN 1 AND 31);

ALTER TABLE contratos
    ADD COLUMN IF NOT EXISTS adelanto_mes INTEGER
        CHECK (adelanto_mes BETWEEN 1 AND 12);

ALTER TABLE contratos DROP COLUMN IF EXISTS adelanto_fecha_vencimiento;

COMMIT;

-- Verificación:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name='contratos' AND column_name LIKE 'adelanto%';
