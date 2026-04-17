-- ==============================================
-- Corrección tabla beneficiarios
-- Los cheques van a contratistas, empleados u "otro".
-- NUNCA a arrendadores (ellos cobran por transferencia o efectivo).
-- Ejecutar en Supabase → SQL Editor → New Query → Run
-- ==============================================

ALTER TABLE beneficiarios
    DROP COLUMN IF EXISTS arrendador_id,
    ADD COLUMN IF NOT EXISTS tipo           TEXT CHECK (tipo IN ('contratista', 'empleado', 'otro')) DEFAULT 'otro',
    ADD COLUMN IF NOT EXISTS contratista_id UUID REFERENCES contratistas(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS empleado_id    UUID REFERENCES empleados(id)    ON DELETE SET NULL;
