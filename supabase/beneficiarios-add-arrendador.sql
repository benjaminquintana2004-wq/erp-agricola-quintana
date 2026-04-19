-- ==============================================
-- Agrega soporte de arrendadores como beneficiarios de cheques
-- Ejecutar en Supabase → SQL Editor → New Query → Run
-- ==============================================

-- 1. Agregar columna arrendador_id
ALTER TABLE beneficiarios
    ADD COLUMN IF NOT EXISTS arrendador_id UUID REFERENCES arrendadores(id) ON DELETE SET NULL;

-- 2. Actualizar el CHECK de tipo para incluir 'arrendador'
ALTER TABLE beneficiarios
    DROP CONSTRAINT IF EXISTS beneficiarios_tipo_check;

ALTER TABLE beneficiarios
    ADD CONSTRAINT beneficiarios_tipo_check
    CHECK (tipo IN ('contratista', 'empleado', 'arrendador', 'otro'));
