-- ============================================================
-- MIGRACIÓN: Contratos con múltiples arrendadores
-- ============================================================
-- IMPORTANTE: esta migración destruye datos en las columnas que se
-- eliminan (umbral_alerta_qq, campo, hectareas, grano, moneda de
-- arrendadores; arrendador_id de contratos; toda la tabla saldos).
-- El usuario confirmó que re-carga los datos a mano después.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) arrendadores: ajustes
-- ------------------------------------------------------------

-- Campos nuevos para distinguir persona física vs empresa y
-- separar apellido (clave para armar "Familia X" automático)
ALTER TABLE arrendadores
    ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'persona_fisica'
        CHECK (tipo IN ('persona_fisica', 'empresa'));
ALTER TABLE arrendadores
    ADD COLUMN IF NOT EXISTS apellido TEXT;
ALTER TABLE arrendadores
    ADD COLUMN IF NOT EXISTS nombre_pila TEXT;

-- Columnas que pasan a pertenecer al contrato, no a la persona
ALTER TABLE arrendadores DROP COLUMN IF EXISTS umbral_alerta_qq;
ALTER TABLE arrendadores DROP COLUMN IF EXISTS campo;
ALTER TABLE arrendadores DROP COLUMN IF EXISTS hectareas;
ALTER TABLE arrendadores DROP COLUMN IF EXISTS grano;
ALTER TABLE arrendadores DROP COLUMN IF EXISTS moneda;

-- ------------------------------------------------------------
-- 2) contratos: nombre_grupo + campo (movido desde arrendadores)
--    y se elimina arrendador_id (lo reemplaza la tabla pivot)
-- ------------------------------------------------------------

ALTER TABLE contratos
    ADD COLUMN IF NOT EXISTS nombre_grupo TEXT;
ALTER TABLE contratos
    ADD COLUMN IF NOT EXISTS campo TEXT;

-- Drop arrendador_id (con CASCADE por si alguna vista depende)
ALTER TABLE contratos DROP COLUMN IF EXISTS arrendador_id CASCADE;

-- ------------------------------------------------------------
-- 3) Nueva tabla pivot contratos_arrendadores
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contratos_arrendadores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contrato_id UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
    arrendador_id UUID NOT NULL REFERENCES arrendadores(id) ON DELETE RESTRICT,
    es_titular_principal BOOLEAN DEFAULT false,
    orden INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(contrato_id, arrendador_id)
);

CREATE INDEX IF NOT EXISTS idx_ca_contrato
    ON contratos_arrendadores(contrato_id);
CREATE INDEX IF NOT EXISTS idx_ca_arrendador
    ON contratos_arrendadores(arrendador_id);

-- ------------------------------------------------------------
-- 4) saldos: arrendador_id → contrato_id
--    Como el usuario migra a mano, droppeamos y recreamos limpio
-- ------------------------------------------------------------

DROP TABLE IF EXISTS saldos CASCADE;
CREATE TABLE saldos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contrato_id UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
    campana_id UUID NOT NULL REFERENCES campanas(id),
    qq_deuda_blanco NUMERIC(10,2) DEFAULT 0,
    qq_deuda_negro NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(contrato_id, campana_id)
);

-- ------------------------------------------------------------
-- 5) movimientos: agregar contrato_id (factura sigue vinculada
--    a arrendador_id = persona que emite)
-- ------------------------------------------------------------

ALTER TABLE movimientos
    ADD COLUMN IF NOT EXISTS contrato_id UUID
        REFERENCES contratos(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_mov_contrato
    ON movimientos(contrato_id);

-- ------------------------------------------------------------
-- 6) RLS en la tabla nueva contratos_arrendadores
-- ------------------------------------------------------------

ALTER TABLE contratos_arrendadores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lectura para usuarios autenticados"
    ON contratos_arrendadores FOR SELECT
    USING (obtener_rol_usuario() IS NOT NULL);

CREATE POLICY "Insertar para admin"
    ON contratos_arrendadores FOR INSERT
    WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));

CREATE POLICY "Actualizar para admin"
    ON contratos_arrendadores FOR UPDATE
    USING (obtener_rol_usuario() IN ('admin_total', 'admin'));

CREATE POLICY "Eliminar solo admin_total"
    ON contratos_arrendadores FOR DELETE
    USING (obtener_rol_usuario() = 'admin_total');

-- saldos: recrear RLS porque la droppeamos
ALTER TABLE saldos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lectura para usuarios autenticados"
    ON saldos FOR SELECT
    USING (obtener_rol_usuario() IS NOT NULL);

CREATE POLICY "Insertar para admin"
    ON saldos FOR INSERT
    WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));

CREATE POLICY "Actualizar para admin"
    ON saldos FOR UPDATE
    USING (obtener_rol_usuario() IN ('admin_total', 'admin'));

CREATE POLICY "Eliminar solo admin_total"
    ON saldos FOR DELETE
    USING (obtener_rol_usuario() = 'admin_total');

COMMIT;

-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- Ejecutá estas consultas sueltas para confirmar que quedó bien:
--
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name='arrendadores' ORDER BY ordinal_position;
--
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name='contratos' ORDER BY ordinal_position;
--
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name='contratos_arrendadores' ORDER BY ordinal_position;
--
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name='saldos' ORDER BY ordinal_position;
--
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name='movimientos' ORDER BY ordinal_position;
-- ============================================================
